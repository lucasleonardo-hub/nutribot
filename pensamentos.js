// pensamentos.js - A Nutri pensa sobre cada pessoa ao longo do dia, em silêncio. Três vezes por dia (fim da manhã, fim da
// tarde, noite) ela recebe o retrato do dia até ali (refeições x padrão, lugares, relógio, despensa, atividades, hipóteses
// abertas) e escreve um pensamento curto, particular: o que está notando, sinais a favor ou contra as hipóteses que tem,
// fatos que quer lembrar. Nada vai pro grupo. O último pensamento entra como pano de fundo nas conversas com a pessoa, os
// da semana entram na reflexão de domingo, e os sinais entram na conferência das hipóteses. Só pensa quando há dado novo.

import { colecao, salvarPerfil, listarPerfis, refeicoesDoDia, refeicoesDesde } from './mongo.js';
import { enriquecerPerfis } from './perfis.js';
import { padraoAlimentar, resumirHoje } from './resumo.js';
import { situacaoRelogio } from './relogio.js';
import { blocoDespensa } from './despensa.js';
import { contextoDoDia } from './contexto.js';
import { agora, fusoDe, diasAnteriores } from './util.js';
import { estado } from './estado.js';
import * as ia from './gemini.js';

const MAX_SINAIS_POR_HIPOTESE = 14;

/** Puro. Assinatura do que mudou desde o último pensamento: se igual, não vale gastar uma chamada. */
export function assinaturaNovidade({ refeicoes = 0, visitas = 0, notas = 0, atividades = 0, passos = 0, hora = '' } = {}) {
  // passos arredondados a 2.000 e a hora em blocos de 6 h: relógio mandando ponto não é novidade por si só
  return `r${refeicoes}v${visitas}n${notas}a${atividades}p${Math.round(passos / 2000)}h${Math.floor((Number(hora.slice(0, 2)) || 0) / 6)}`;
}

async function retratoDoDia(perfil, dia) {
  const [comExtras] = await enriquecerPerfis([perfil], dia);
  const [hoje, ult28, rel, despensa, contexto] = await Promise.all([
    refeicoesDoDia(dia).then((rs) => rs.filter((r) => (perfil.jids || []).includes(r.jid))).catch(() => []),
    refeicoesDesde(perfil.jids, diasAnteriores(dia, 28)[0]).catch(() => []),
    perfil.relogio ? situacaoRelogio(perfil, dia).catch(() => null) : null,
    blocoDespensa(perfil).catch(() => ''),
    contextoDoDia(perfil, dia).catch(() => ''),
  ]);
  const padrao = padraoAlimentar(ult28, { periodoDias: 28 });
  const hojeTexto = hoje.length ? resumirHoje(hoje, [perfil], dia) : '(nenhuma refeição registrada até agora)';
  const visitasHoje = (contexto.match(/Lugares de hoje: ([^\n]+)/) || [])[1] || '';
  const assinatura = assinaturaNovidade({ refeicoes: hoje.length, visitas: visitasHoje ? visitasHoje.split(' · ').length : 0, notas: /Compras de hoje/.test(contexto) ? 1 : 0, atividades: (perfil.atividadesFeitas?.[dia] || []).length, passos: rel?.passosHoje || 0, hora: agora(fusoDe(perfil)).hora });
  const texto =
    `HOJE ATÉ AGORA (${agora(fusoDe(perfil)).hora}, fuso ${fusoDe(perfil)}):\n${hojeTexto}\n\n` +
    `${padrao.texto}\n\n` +
    (comExtras._roteiro ? `${comExtras._roteiro}\n\n` : '') +
    (comExtras._lugares?.bloco ? `${comExtras._lugares.bloco}\n\n` : '') +
    (rel ? `RELÓGIO HOJE: ${rel.passosHoje ? `${rel.passosHoje} passos` : 'passos ?'}${rel.caloriasHoje ? `, gasto ${Math.round(rel.caloriasHoje)} kcal até agora` : ''}${rel.ultimaNoite ? `, sono da última noite ${Math.floor(rel.ultimaNoite.total / 60)}h${String(Math.round(rel.ultimaNoite.total % 60)).padStart(2, '0')}` : ''}${rel.treinosHoje?.length ? `, treinos: ${rel.treinosHoje.map((t) => `${t.nome} ${t.min || '?'} min`).join(', ')}` : ''}\n\n` : '') +
    (comExtras._atividades ? `${comExtras._atividades}\n\n` : '') +
    (despensa ? `${despensa}\n\n` : '') +
    (contexto ? `${contexto}\n\n` : '');
  return { texto, assinatura, comExtras };
}

/** Um pensamento sobre uma pessoa, se houver novidade. Devolve o pensamento salvo ou null. */
export async function pensarSobre(perfil, { dia, persona, forcar = false } = {}) {
  const retrato = await retratoDoDia(perfil, dia);
  const ultimo = await colecao('pensamentos').find({ jid: perfil.jids?.[0] }).sort({ criadoEm: -1 }).limit(1).next().catch(() => null);
  if (!forcar && ultimo?.dia === dia && ultimo.assinatura === retrato.assinatura) {
    console.log(`[pensamentos] ${perfil.nome.split(' ')[0]}: nada novo desde ${ultimo.hora}; não pensei`);
    return null;
  }
  const abertas = (perfil.hipoteses || []).filter((h) => h.status === 'aberta');
  const r = await ia.pensarSobrePessoa({
    perfil: retrato.comExtras,
    retrato: retrato.texto,
    anterior: ultimo?.dia === dia ? ultimo.texto : ultimo ? `(ontem ou antes) ${ultimo.texto}` : '',
    hipoteses: abertas,
    sintese: perfil.reflexao?.sintese || '',
    persona,
    dia,
  });
  if (!r?.pensamento) return null;
  const hora = agora(fusoDe(perfil)).hora;
  const doc = { jid: perfil.jids?.[0], nome: perfil.nome, dia, hora, texto: String(r.pensamento).slice(0, 1200), notar: (r.notar || []).slice(0, 4), sinais: (r.sinais || []).slice(0, 8), valeFalar: Boolean(r.vale_falar), assinatura: retrato.assinatura, criadoEm: new Date() };
  await colecao('pensamentos').insertOne(doc);
  // sinais entram nas hipóteses abertas (evidência acumulada pra conferência de domingo)
  let hipoteses = perfil.hipoteses || [];
  if (doc.sinais.length && abertas.length) {
    hipoteses = hipoteses.map((h) => {
      const s = doc.sinais.find((x) => x.id === h.id && x.direcao && x.direcao !== 'neutro');
      if (!s) return h;
      return { ...h, sinais: [...(h.sinais || []), { dia, hora, direcao: s.direcao, evidencia: String(s.evidencia || '').slice(0, 160) }].slice(-MAX_SINAIS_POR_HIPOTESE) };
    });
  }
  await salvarPerfil({ jids: perfil.jids, pensamento: { dia, hora, texto: doc.texto, notar: doc.notar }, hipoteses }).catch(() => {});
  console.log(`[pensamentos] ${perfil.nome.split(' ')[0]} ${hora}: ${doc.texto.slice(0, 100)}${doc.sinais.length ? ` · ${doc.sinais.length} sinal(is)` : ''}`);
  return doc;
}

/** Cron (11:30, 17:30, 21:30): pensa sobre cada pessoa com cadastro, uma chamada por pessoa, só se houver novidade. */
export async function pensarTodos({ forcar = false } = {}) {
  if (estado.statusConexao !== 'conectado' && !forcar) return;
  const dia = agora().dia;
  for (const p of (await listarPerfis().catch(() => [])).filter((x) => x.onboarded)) {
    try {
      await pensarSobre(p, { dia, persona: estado.persona, forcar });
    } catch (e) {
      console.error(`[pensamentos] ${p.nome}:`, e.message);
    }
  }
}

/** Pensamentos da semana (pra reflexão de domingo). '' sem nada. */
export async function pensamentosDaSemana(perfil, dia) {
  const desde = diasAnteriores(dia, 7)[0];
  const lista = await colecao('pensamentos').find({ jid: perfil.jids?.[0], dia: { $gte: desde } }).sort({ criadoEm: 1 }).toArray().catch(() => []);
  if (!lista.length) return '';
  return `SEUS PENSAMENTOS DA SEMANA (particulares, escritos ao longo dos dias; o que você foi notando em tempo real):\n${lista.map((p) => `- ${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)} ${p.hora}: ${p.texto}`).join('\n')}`;
}

/** !pensamentos: os últimos pensamentos dela sobre a pessoa. */
export async function pensamentosZap(perfil) {
  const lista = await colecao('pensamentos').find({ jid: perfil.jids?.[0] }).sort({ criadoEm: -1 }).limit(3).toArray().catch(() => []);
  if (!lista.length) return 'Ainda não pensei em você hoje. Eu penso três vezes por dia, quando há dado novo: fim da manhã, fim da tarde e noite.';
  return `💭 *O que eu andei pensando sobre você*\n\n${lista.map((p) => `*${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)} ${p.hora}*\n${p.texto}${p.notar?.length ? `\n_Anotei: ${p.notar.join('; ')}_` : ''}`).join('\n\n')}\n\n_Pensamento é particular: não mando no grupo, só uso de pano de fundo._`;
}
