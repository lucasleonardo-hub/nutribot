// proatividade.js - A Nutri toma a iniciativa quando um pensamento particular diz que vale falar, com freio de verdade:
// no máximo UMA intervenção por dia no grupo, só entre 8h e 21h da pessoa, só com confiança, assunto novo (não dito hoje
// nem em intervenção recente), nunca logo depois de a pessoa falar (aí ela responde no fluxo), e pausa de 3 dias quando as
// últimas 3 intervenções foram ignoradas. Tudo fica em `intervencoes` (quando, por quê, gatilho, assunto, confiança, texto,
// se houve resposta) pra ela aprender a não ser inconveniente. podeIntervir é pura (testável).
import { colecao } from './mongo.js';
import { estado } from './estado.js';
import { enviar } from './whatsapp.js';
import * as ia from './gemini.js';
import { agora, fusoDe, minutosDe } from './util.js';
import { concordarVocativos, corrigirGirias } from './consciencia.js';

export const LIMITE_POR_DIA = 1;
const CONFIANCA_MINIMA = 0.6;
const PAUSA_DIAS_IGNORADA = 3;
const JANELA_PESSOA_MIN = 30;
const HORA_INI = 8;
const HORA_FIM = 21;

const somarDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const FRACAS = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'um', 'uma', 'que', 'pra', 'para', 'com', 'sem', 'por', 'se', 'hoje', 'ontem', 'ela', 'ele', 'dela', 'dele', 'esta', 'este', 'isso']);
const palavras = (t) =>
  new Set(
    String(t || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !FRACAS.has(w))
  );
// semelhança por CONTENÇÃO (quanto do conjunto menor está no maior): um assunto de 4 palavras dentro de uma frase de 12
// é o mesmo assunto, embora o Jaccard clássico dê só 0,3
const semelhanca = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.min(a.size, b.size);
};

/**
 * Puro. Decide se vale intervir agora. `ultimas` = intervenções mais recentes primeiro (qualquer pessoa).
 * Devolve { ok, motivo }.
 */
export function podeIntervir({ hora, dia, hojeNoGrupo = 0, ultimas = [], mensagensBotHoje = [], assunto = '', confianca = 0, minutosDesdeMsgPessoa = Infinity } = {}) {
  const h = Number(String(hora || '').slice(0, 2));
  if (!(h >= HORA_INI && h < HORA_FIM)) return { ok: false, motivo: `fora do horário (${HORA_INI}h-${HORA_FIM}h)` };
  if (hojeNoGrupo >= LIMITE_POR_DIA) return { ok: false, motivo: 'já houve intervenção hoje' };
  if (!(Number(confianca) >= CONFIANCA_MINIMA)) return { ok: false, motivo: `confiança ${confianca} abaixo de ${CONFIANCA_MINIMA}` };
  if (minutosDesdeMsgPessoa < JANELA_PESSOA_MIN) return { ok: false, motivo: 'a pessoa acabou de falar: responde no fluxo, não intervém' };
  const tres = ultimas.slice(0, 3);
  if (tres.length === 3 && tres.every((i) => i.respondida === false) && dia && tres[0].dia >= somarDias(dia, -PAUSA_DIAS_IGNORADA)) {
    return { ok: false, motivo: `as últimas 3 intervenções foram ignoradas: pausa de ${PAUSA_DIAS_IGNORADA} dias` };
  }
  const pa = palavras(assunto);
  if (pa.size) {
    const recentes = dia ? ultimas.filter((i) => i.dia >= somarDias(dia, -7)) : ultimas;
    if (recentes.some((i) => semelhanca(pa, palavras(`${i.assunto || ''} ${i.texto || ''}`)) >= 0.6)) return { ok: false, motivo: 'assunto já tratado numa intervenção dos últimos 7 dias' };
    if (mensagensBotHoje.some((m) => semelhanca(pa, palavras(m)) >= 0.6)) return { ok: false, motivo: 'assunto já apareceu hoje no grupo' };
  }
  return { ok: true, motivo: 'vale falar' };
}

/**
 * Avalia e, se valer, manda a intervenção no grupo. `pensamento` = { texto, valeFalar, assunto, confianca, valeFalarPor }.
 * Nunca lança; devolve o documento gravado ou null.
 */
export async function considerarIntervencao({ perfil, pensamento, dia, persona, lembrar }) {
  try {
    if (/^(off|false|0|n[ãa]o)$/i.test(process.env.PROATIVIDADE || 'on')) return null;
    if (!pensamento?.valeFalar || !estado.memoria?.grupo || estado.statusConexao !== 'conectado') return null;
    const { hora } = agora(fusoDe(perfil));
    const col = colecao('intervencoes');
    const hojeNoGrupo = await col.countDocuments({ dia }).catch(() => 0);
    const ultimas = await col.find({}).sort({ criadoEm: -1 }).limit(10).toArray().catch(() => []);
    const msgs = estado.memoria.mensagens || [];
    const mensagensBotHoje = msgs.filter((m) => m.tipo === 'bot').map((m) => m.texto || '');
    const horasPessoa = msgs.filter((m) => m.tipo !== 'bot' && m.jid && (perfil.jids || []).includes(m.jid)).map((m) => m.hora).filter(Boolean);
    const ultimaHora = horasPessoa[horasPessoa.length - 1];
    const minutosDesdeMsgPessoa = ultimaHora ? minutosDe(hora) - minutosDe(ultimaHora) : Infinity;
    const assunto = pensamento.assunto || pensamento.texto;
    const decisao = podeIntervir({ hora, dia, hojeNoGrupo, ultimas, mensagensBotHoje, assunto, confianca: pensamento.confianca ?? CONFIANCA_MINIMA, minutosDesdeMsgPessoa });
    console.log(`[proatividade] ${perfil.nome.split(' ')[0]}: ${decisao.ok ? 'vou falar' : 'não falo'} (${decisao.motivo})`);
    if (!decisao.ok) return null;
    const texto = await ia.redigirIntervencao({ perfil, pensamento, persona, dia, jaDito: mensagensBotHoje.slice(-6) }).catch((e) => (console.warn('[proatividade] redação falhou:', e.message), ''));
    const limpo = concordarVocativos(corrigirGirias(String(texto || '').trim()), { genero: perfil.genero });
    if (!limpo || limpo.length > 420 || /^silencio\W*$/i.test(limpo)) {
      console.log(`[proatividade] ${perfil.nome.split(' ')[0]}: a redação desistiu (${limpo ? `${limpo.length} chars` : 'vazio'})`);
      return null;
    }
    await enviar(estado.memoria.grupo, limpo);
    if (lembrar) await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: limpo, tipo: 'bot' }).catch(() => {});
    const doc = {
      dia,
      hora,
      jid: perfil.jids?.[0] || null,
      nome: perfil.nome,
      gatilho: 'pensamento',
      assunto: String(assunto || '').slice(0, 120),
      confianca: pensamento.confianca ?? null,
      motivo: String(pensamento.valeFalarPor || '').slice(0, 200),
      texto: limpo,
      respondida: false,
      criadoEm: new Date(),
    };
    await col.insertOne(doc).catch(() => {});
    console.log(`[proatividade] intervenção enviada pra ${perfil.nome.split(' ')[0]}: ${limpo.slice(0, 100)}`);
    return doc;
  } catch (e) {
    console.error('[proatividade]', e.message);
    return null;
  }
}

/** A pessoa falou: se havia intervenção de hoje pra ela sem resposta (até 3 h), marca como respondida. Nunca lança. */
export async function marcarResposta(jids, dia, hora) {
  try {
    if (!jids?.length) return false;
    const col = colecao('intervencoes');
    const aberta = await col.find({ dia, jid: { $in: jids }, respondida: false }).sort({ criadoEm: -1 }).limit(1).next();
    if (!aberta) return false;
    const demora = minutosDe(hora) - minutosDe(aberta.hora);
    if (demora < 0 || demora > 180) return false;
    await col.updateOne({ _id: aberta._id }, { $set: { respondida: true, respondidaEm: hora, demoraMin: demora } });
    return true;
  } catch {
    return false;
  }
}

/** Pra !status / !proativa: as últimas intervenções e a taxa de resposta. */
export async function resumoProatividade(dias = 14) {
  const desde = somarDias(agora().dia, -dias);
  const lista = await colecao('intervencoes').find({ dia: { $gte: desde } }).sort({ criadoEm: -1 }).toArray().catch(() => []);
  const respondidas = lista.filter((i) => i.respondida).length;
  return { total: lista.length, respondidas, ignoradas: lista.length - respondidas, ultimas: lista.slice(0, 5) };
}
