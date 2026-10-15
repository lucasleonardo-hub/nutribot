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
import { contextoDoDia, blocoTreinoRefeicoes, blocoForcaRecuperacao } from './contexto.js';
import { agora, fusoDe, diasAnteriores, marcaDeTempo } from './util.js';
import { estado } from './estado.js';
import * as ia from './gemini.js';
import { ferramentasPara } from './ferramentas.js';
import { considerarIntervencao } from './proatividade.js';
import { humorDe, eventosDe } from './mongo.js';
import { blocoHumorDias, blocoEventosApp, perguntasRecentes, perguntasParaPrompt, moduloDePerguntas, confidenciasDe, corpoCompacto, semConfidencias, semCorpoSensivel, assuntoConfidencial, protegerFerramentas } from './contexto-app.js';

const MAX_SINAIS_POR_HIPOTESE = 14;

/** Puro. Assinatura do que mudou desde o último pensamento: se igual, não vale gastar uma chamada. */
export function assinaturaNovidade({ refeicoes = 0, visitas = 0, notas = 0, atividades = 0, passos = 0, hora = '', app = 0 } = {}) {
  // passos arredondados a 2.000 e a hora em blocos de 6 h: relógio mandando ponto não é novidade por si só. `app` (fase 7):
  // humor, eventos e perguntas do app no dia; entra só quando há algo, pra assinatura de quem não usa o app não mudar
  return `r${refeicoes}v${visitas}n${notas}a${atividades}p${Math.round(passos / 2000)}h${Math.floor((Number(hora.slice(0, 2)) || 0) / 6)}${app > 0 ? `x${app}` : ''}`;
}

/**
 * Fase 7: o que chega pelo app pro pensamento (prompt particular): humor da semana com o texto (confidência), eventos de
 * hoje e amanhã, as perguntas feitas no app hoje e o corpo (sono, energia, atividade). Oxigênio e temperatura NÃO entram:
 * o texto do pensamento é lido de novo no grupo (D12). Devolve { texto, confidencias, contagem }.
 */
async function doApp(perfil, diaP) {
  const jids = perfil.jids || [];
  if (!jids.length) return { texto: '', confidencias: [], contagem: 0 };
  const desde = new Date(Date.now() - 36 * 3600_000);
  const [humores, eventos, perguntas, modulo] = await Promise.all([
    humorDe(jids, diasAnteriores(diaP, 7)[0], diaP).catch(() => []),
    eventosDe(jids, diaP, proximoDia(diaP)).catch(() => []),
    perguntasRecentes(perfil, { desde }).catch(() => []),
    moduloDePerguntas().catch(() => null),
  ]);
  const pergHoje = perguntas.filter((p) => !p.dia || p.dia === diaP);
  const texto = [
    blocoHumorDias(humores, { hoje: diaP, dias: 7, confidencia: true }),
    blocoEventosApp(eventos, { hoje: diaP, dias: 1 }),
    perguntasParaPrompt(pergHoje, { modo: 'pensamentos', hoje: diaP, fuso: fusoDe(perfil), modulo }),
    // sem oxigênio e temperatura (D12): o pensamento é republicado (!pensamentos no grupo, mensagem espontânea)
    corpoCompacto(perfil.relogio),
  ]
    .filter(Boolean)
    .join('\n\n');
  const contagem = humores.filter((h) => h.dia === diaP).length + eventos.length + pergHoje.length;
  return { texto, confidencias: confidenciasDe({ perguntas, humores }), contagem };
}
const proximoDia = (dia) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function retratoDoDia(perfil, dia) {
  const [comExtras] = await enriquecerPerfis([perfil], dia);
  // "hoje até agora" é o dia LOCAL da pessoa (as refeições são gravadas nele desde 13/10)
  const diaP = marcaDeTempo(perfil).dia;
  const [hoje, ult28, rel, despensa, contexto, app] = await Promise.all([
    refeicoesDoDia(diaP).then((rs) => rs.filter((r) => (perfil.jids || []).includes(r.jid))).catch(() => []),
    refeicoesDesde(perfil.jids, diasAnteriores(dia, 28)[0]).catch(() => []),
    perfil.relogio ? situacaoRelogio(perfil, dia).catch(() => null) : null,
    blocoDespensa(perfil).catch(() => ''),
    contextoDoDia(perfil, dia).catch(() => ''),
    doApp(perfil, diaP).catch(() => ({ texto: '', confidencias: [], contagem: 0 })),
  ]);
  const padrao = padraoAlimentar(ult28, { periodoDias: 28 });
  const forca = await blocoForcaRecuperacao(perfil, dia).catch(() => '');
  const hojeTexto = hoje.length ? resumirHoje(hoje, [perfil], diaP) : '(nenhuma refeição registrada até agora)';
  const visitasHoje = (contexto.match(/Lugares de hoje: ([^\n]+)/) || [])[1] || '';
  const assinatura = assinaturaNovidade({ refeicoes: hoje.length, visitas: visitasHoje ? visitasHoje.split(' · ').length : 0, notas: /Compras de hoje/.test(contexto) ? 1 : 0, atividades: (perfil.atividadesFeitas?.[dia] || []).length, passos: rel?.passosHoje || 0, hora: agora(fusoDe(perfil)).hora, app: app.contagem });
  const texto =
    `HOJE ATÉ AGORA (${agora(fusoDe(perfil)).hora}, fuso ${fusoDe(perfil)}):\n${hojeTexto}\n\n` +
    `${padrao.texto}\n\n` +
    (comExtras._roteiro ? `${comExtras._roteiro}\n\n` : '') +
    (comExtras._lugares?.bloco ? `${comExtras._lugares.bloco}\n\n` : '') +
    (rel ? `RELÓGIO HOJE: ${rel.passosHoje ? `${rel.passosHoje} passos` : 'passos ?'}${rel.caloriasHoje ? `, gasto ${Math.round(rel.caloriasHoje)} kcal até agora` : ''}${rel.ultimaNoite ? `, sono da última noite ${Math.floor(rel.ultimaNoite.total / 60)}h${String(Math.round(rel.ultimaNoite.total % 60)).padStart(2, '0')}` : ''}${rel.treinosHoje?.length ? `, treinos: ${rel.treinosHoje.map((t) => `${t.nome} ${t.min || '?'} min`).join(', ')}` : ''}\n\n` : '') +
    (comExtras._atividades ? `${comExtras._atividades}\n\n` : '') +
    (comExtras._treinoHoje ? `${comExtras._treinoHoje}\n\n` : '') +
    (forca ? `${forca}\n\n` : '') +
    (despensa ? `${despensa}\n\n` : '') +
    (contexto ? `${contexto}\n\n` : '') +
    (app.texto ? `PELO APP E PELO RELÓGIO (particular desta pessoa):\n${app.texto}\n\n` : '');
  return { texto, assinatura, comExtras, confidencias: app.confidencias };
}

/** Um pensamento sobre uma pessoa, se houver novidade. Devolve o pensamento salvo ou null. */
export async function pensarSobre(perfil, { dia, persona, forcar = false, lembrar = null } = {}) {
  const retrato = await retratoDoDia(perfil, dia);
  const ultimo = await colecao('pensamentos').find({ jid: perfil.jids?.[0] }).sort({ criadoEm: -1 }).limit(1).next().catch(() => null);
  if (!forcar && ultimo?.dia === dia && ultimo.assinatura === retrato.assinatura) {
    console.log(`[pensamentos] ${perfil.nome.split(' ')[0]}: nada novo desde ${ultimo.hora}; não pensei`);
    return null;
  }
  const abertas = (perfil.hipoteses || []).filter((h) => h.status === 'aberta');
  // function calling (fase 1): antes de pensar, ela investiga o que quiser nos dados (refeições, treino, relógio, lugares, lembranças...)
  // confidência do app não vira anotação nem memória vetorial (D10), mesmo que a investigação tente
  const confidencias = retrato.confidencias || [];
  // com confidência no retrato, a investigação não anota nada (uma paráfrase da confidência iria pra memória vetorial com o
  // nome da pessoa e voltaria no prompt de outra pessoa no grupo); a guarda continua valendo pro oxigênio e a temperatura
  const ferramentas = protegerFerramentas(ferramentasPara(retrato.comExtras || perfil, { dia, escrita: confidencias.length ? false : 'anotar' }), confidencias);
  const investigacao = await ia
    .investigarPessoa({ perfil: retrato.comExtras || perfil, retrato: retrato.texto, sintese: perfil.reflexao?.sintese || '', persona, dia, ferramentas })
    .catch((e) => (console.warn('[pensamentos] investigação falhou:', e.message), ''));
  const r = await ia.pensarSobrePessoa({
    perfil: retrato.comExtras,
    retrato: retrato.texto,
    anterior: ultimo?.dia === dia ? ultimo.texto : ultimo ? `(ontem ou antes) ${ultimo.texto}` : '',
    hipoteses: abertas,
    sintese: perfil.reflexao?.sintese || '',
    persona,
    dia,
    investigacao,
  });
  if (!r?.pensamento) return null;
  const hora = agora(fusoDe(perfil)).hora;
  const g = guardarPensamento(r, { confidencias, investigacao });
  if (g.removidas) console.log(`[pensamentos] ${perfil.nome.split(' ')[0]}: ${g.removidas} frase(s) com confidência do app ou oxigênio/temperatura retirada(s)`);
  if ((g.confidencial || g.privado) && r.vale_falar) console.log(`[pensamentos] ${perfil.nome.split(' ')[0]}: assunto vem de confidência do app; não vira mensagem no grupo`);
  const confidencial = g.confidencial;
  const doc = { jid: perfil.jids?.[0], nome: perfil.nome, dia, hora, consultas: [...new Set(ferramentas.usadas)], assunto: r.assunto || null, confianca: typeof r.confianca === 'number' ? r.confianca : null, investigacao: g.investigacao, texto: g.texto, notar: g.notar, sinais: g.sinais, valeFalar: g.valeFalar, privado: g.privado, assinatura: retrato.assinatura, criadoEm: new Date() };
  if (!doc.texto.trim()) return null;
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
  // proatividade com freio: o pensamento disse que vale falar; podeIntervir decide (1 por dia, horário, assunto novo, confiança)
  await considerarIntervencao({ perfil, pensamento: { texto: doc.texto, valeFalar: doc.valeFalar, assunto: r.assunto, confianca: typeof r.confianca === 'number' ? r.confianca : null, valeFalarPor: confidencial ? null : r.vale_falar_por }, dia, persona, lembrar, confidencias }).catch(() => null);
  return doc;
}

/**
 * Puro. Fase 7 (D10 e D12), em código: o pensamento é lido de novo (conversa, !pensamentos no grupo, mensagem espontânea),
 * então sai a frase que copia uma pergunta do app ou o texto do humor e a que fala de oxigênio ou temperatura da pele.
 * `privado` = o texto ainda divide o assunto com uma confidência (paráfrase): não aparece no grupo e não vira mensagem
 * espontânea. `confidencial` = o assunto/motivo de falar nasceu de confidência. `r` = a saída de pensarSobrePessoa.
 */
export function guardarPensamento(r, { confidencias = [], investigacao = '' } = {}) {
  const limpar = (t) => {
    const a = semConfidencias(String(t || ''), confidencias);
    const b = semCorpoSensivel(a.texto);
    return { texto: b.texto, removidas: a.removidas.length + b.removidas.length };
  };
  const limpo = limpar(r?.pensamento);
  const texto = (limpo.texto || '').slice(0, 1200);
  const notar = (r?.notar || []).filter((n) => !limpar(n).removidas).slice(0, 4);
  const confidencial = assuntoConfidencial(`${r?.assunto || ''} ${r?.vale_falar_por || ''}`, confidencias);
  const privado = Boolean(confidencias.length) && assuntoConfidencial(texto, confidencias);
  return {
    texto,
    notar,
    removidas: limpo.removidas,
    investigacao: limpar(investigacao).texto.slice(0, 1500),
    sinais: (r?.sinais || []).slice(0, 8).map((s) => ({ ...s, evidencia: limpar(s?.evidencia).texto })),
    confidencial,
    privado,
    valeFalar: Boolean(r?.vale_falar) && !confidencial && !privado,
  };
}

/** Puro. O texto de um pensamento pra mostrar no GRUPO: o privado (nascido de confidência) não aparece. */
export function pensamentoParaGrupo(p) {
  if (!p) return '';
  if (p.privado) return '(esse pensamento fica só comigo)';
  return `${semCorpoSensivel(String(p.texto || '')).texto}${p.notar?.length ? `\n_Anotei: ${p.notar.join('; ')}_` : ''}`;
}

/** Cron (11:30, 17:30, 21:30): pensa sobre cada pessoa com cadastro, uma chamada por pessoa, só se houver novidade. */
export async function pensarTodos({ forcar = false, lembrar = null } = {}) {
  if (estado.statusConexao !== 'conectado' && !forcar) return;
  const dia = agora().dia;
  for (const p of (await listarPerfis().catch(() => [])).filter((x) => x.onboarded)) {
    try {
      await pensarSobre(p, { dia, persona: estado.persona, forcar, lembrar });
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
  // o !pensamentos responde NO GRUPO: o pensamento nascido de confidência do app não aparece, e oxigênio/temperatura saem (D10, D12)
  return `💭 *O que eu andei pensando sobre você*\n\n${lista.map((p) => `*${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)} ${p.hora}*\n${pensamentoParaGrupo(p)}`).join('\n\n')}\n\n_Pensamento é particular: não mando no grupo, só uso de pano de fundo._`;
}
