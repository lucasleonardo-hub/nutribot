// perguntas.js - Perguntas feitas à Nutri pelo app (POST /api/v1/perfis/:id/perguntar), guardadas na coleção `perguntas_app`
// (fase 7, docs/app/2026-10-15-mapa-ecossistema.md, seção 3). Um documento por troca:
//   { _id, perfilId, jid, nome, dia (local), hora (local), em (Date), pergunta (≤ 400), resposta (≤ 1200), tema, privado: true,
//     vistaPelaNutriEm: null }
// TTL de 180 dias no Mongo (decisão D16; o índice está em mongo.garantirIndices); para sempre no Drive (frente C).
//
// Privacidade (regra dura): pergunta do app é CONFIDÊNCIA. Ela entra só no prompt da própria pessoa (conversa, pensamento,
// reflexão e a própria resposta do app), pelo bloco de blocoPerguntasApp, e nunca no resumo do grupo, nos momentos, no
// diário da Nutri nem na memória vetorial: nenhum desses compiladores lê esta coleção (D10: a Nutri só retoma o assunto se
// a pessoa puxar).
//
// Contrato usado pelas frentes B (contexto da IA) e C (Drive):
//   guardarPergunta({ perfil, dia, pergunta, resposta })            -> doc gravado, ou null (nunca lança)
//   perguntasDe(jid | jids, { desde, antes, n })                     -> lista em ordem cronológica (a mais antiga primeiro)
//   blocoPerguntasApp(lista, { modo: 'conversa'|'pensamento'|'reflexao', nome }) -> texto pro prompt, '' sem nada (puro)

import { colecao as colecaoMongo, idDe } from './mongo.js';
import { agora, fusoDe } from './util.js';

export const COLECAO_PERGUNTAS = 'perguntas_app';
export const TTL_PERGUNTAS_DIAS = 180;
export const MAX_PERGUNTA = 400;
export const MAX_RESPOSTA = 1200;
export const TEMAS_PERGUNTA = ['comida', 'treino', 'sono', 'peso', 'humor', 'outro'];

const limpa = (t, max) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ============================================================
// Puros
// ============================================================
/** Puro. Tema da pergunta por expressão regular (sem IA): treino, sono, peso, humor, comida ou outro. */
export function temaDe(pergunta) {
  const t = semAcento(pergunta);
  if (!t.trim()) return 'outro';
  if (/\b(treino|treinar|academia|supino|agacha|agachamento|carga|muscula\w*|corrida|correr|exercicio\w*|series?|repeti\w*|halter|esteira|alongamento|hevy)\b/.test(t)) return 'treino';
  if (/\b(sono|dormi\w*|dormir|insonia|acordei|acordar|cochil\w*|cansac\w* de manha)\b/.test(t)) return 'sono';
  if (/\b(peso|pesei|pesar|balanca|emagrec\w*|engord\w*|gordura|perder \d|meta de peso|quilos?)\b/.test(t)) return 'peso';
  if (/\b(triste|ansios\w*|ansiedade|estress\w*|cansad\w*|humor|desanim\w*|feliz|chatead\w*|deprimid\w*|culpa|frustrad\w*)\b/.test(t)) return 'humor';
  if (/\b(comer|comi|como|comida|refeic\w*|almoc\w*|jant\w*|cafe|lanche|ceia|kcal|calorias?|proteinas?|carbo\w*|dieta|fome|doce|pao|fruta|beber|bebida|cerveja|agua|marmita|receita|cardapio|prato|arroz|feijao|ovo|frango|whey)\b/.test(t)) return 'comida';
  return 'outro';
}

/** Puro. O documento da coleção a partir da troca (sem _id). `quando` = instante da resposta. */
export function documentoPergunta({ perfil, dia, pergunta, resposta, hora = null, quando = new Date() }) {
  const p = limpa(pergunta, MAX_PERGUNTA);
  if (!p) return null;
  const local = agora(fusoDe(perfil), quando);
  return {
    perfilId: perfil?._id != null ? String(perfil._id) : null,
    jid: perfil?.jids?.[0] || null,
    nome: perfil?.nome || null,
    dia: /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? String(dia) : local.dia,
    hora: /^\d{2}:\d{2}$/.test(String(hora || '')) ? hora : local.hora,
    em: quando,
    pergunta: p,
    resposta: String(resposta ?? '').trim().slice(0, MAX_RESPOSTA),
    tema: temaDe(p),
    privado: true,
    vistaPelaNutriEm: null,
  };
}

/** Puro. O filtro do Mongo de perguntasDe (exportado pro teste). */
export function filtroPerguntas(jid, { desde = null, antes = null } = {}) {
  const jids = (Array.isArray(jid) ? jid : [jid]).filter(Boolean).map(String);
  const f = { jid: { $in: jids } };
  const instante = (v) => (v instanceof Date ? v : typeof v === 'number' ? new Date(v) : typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v) : null);
  if (typeof desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(desde)) f.dia = { $gte: desde };
  else if (desde != null) {
    const d = instante(desde);
    if (d && !Number.isNaN(d.getTime())) f.em = { $gte: d };
  }
  if (antes != null) {
    const a = instante(antes);
    if (a && !Number.isNaN(a.getTime())) f.em = { ...(f.em || {}), $lt: a };
  }
  return f;
}

/** Puro. Uma troca no formato da API: { id, dia, hora, em, pergunta, resposta, tema }. */
export function montarPergunta(doc) {
  return {
    id: String(doc?._id ?? ''),
    dia: doc?.dia || null,
    hora: doc?.hora || null,
    em: doc?.em instanceof Date ? doc.em.toISOString() : doc?.em ? new Date(doc.em).toISOString() : null,
    pergunta: doc?.pergunta || '',
    resposta: doc?.resposta || '',
    tema: TEMAS_PERGUNTA.includes(doc?.tema) ? doc.tema : 'outro',
  };
}

const corta = (t, max) => {
  const s = limpa(t, 4000);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
/** O essencial da resposta: a primeira frase (ou o começo), sem quebrar no meio de uma palavra. */
const essencial = (t, max) => {
  const s = limpa(t, 4000);
  const frase = (s.match(/^.+?[.!?](?=\s|$)/) || [s])[0];
  return corta(frase.length >= 20 ? frase : s, max);
};
const ddmm = (dia) => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '');
const ordenadas = (lista) =>
  (Array.isArray(lista) ? lista : [])
    .filter((x) => x && limpa(x.pergunta, 10))
    .sort((a, b) => new Date(a.em || 0) - new Date(b.em || 0) || String(a.dia || '').localeCompare(String(b.dia || '')) || String(a.hora || '').localeCompare(String(b.hora || '')));

/**
 * Puro. Bloco das perguntas do app pra um prompt que já existe (nenhuma chamada nova de IA). '' sem pergunta.
 *  - 'conversa'  (resposta no WhatsApp, que sai no grupo): as 3 últimas da lista recebida, uma linha cada, marcadas como
 *                confidência; quem chama passa só as da própria pessoa das últimas 48 h.
 *  - 'pensamento' (privado): todas as da lista (quem chama passa as do dia), com a hora e o essencial da resposta.
 *  - 'reflexao'  (privado, domingo): contagem por tema e até 10 perguntas, como sinal pras hipóteses.
 * O texto nunca manda citar: a regra é levar em conta e só retomar se a pessoa puxar o assunto (D10).
 */
export function blocoPerguntasApp(lista, { modo = 'conversa', nome = '' } = {}) {
  const l = ordenadas(lista);
  if (!l.length) return '';
  const quem = String(nome || '').trim().split(/\s+/)[0];
  const de = quem ? ` DE ${quem.toUpperCase()}` : '';
  if (modo === 'pensamento') {
    return (
      `PERGUNTAS${de} AO APP HOJE (privado, só pro seu raciocínio; não é pra citar no grupo):\n` +
      l.map((x) => `- Às ${x.hora || '?'} perguntou no app "${corta(x.pergunta, 200)}"; respondi: ${essencial(x.resposta, 240) || '(sem resposta guardada)'}`).join('\n')
    );
  }
  if (modo === 'reflexao') {
    const contagem = new Map();
    for (const x of l) {
      const t = TEMAS_PERGUNTA.includes(x.tema) ? x.tema : temaDe(x.pergunta);
      contagem.set(t, (contagem.get(t) || 0) + 1);
    }
    const temas = [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ');
    return (
      `PERGUNTAS${de} AO APP NA SEMANA (privado; sinal pras hipóteses, nunca pra citar): ${l.length} pergunta(s); temas: ${temas}.\n` +
      l.slice(-10).map((x) => `- ${ddmm(x.dia)} ${x.hora || ''}: "${corta(x.pergunta, 160)}"`.replace(/\s+:/, ':')).join('\n')
    );
  }
  // conversa: a resposta sai no grupo
  return (
    `PERGUNTAS${de} AO APP (EM CONFIDÊNCIA: leve em conta e retome só se ela(e) puxar o assunto; não cite nem parafraseie no grupo):\n` +
    l.slice(-3).map((x) => `- ${ddmm(x.dia)} ${x.hora || ''}: "${corta(x.pergunta, 120)}" (respondi: ${essencial(x.resposta, 140) || 'sem resposta guardada'})`.replace(/\s+:/, ':')).join('\n')
  );
}

// ============================================================
// Banco (a coleção é injetável no segundo argumento, pro teste)
// ============================================================
const colecaoPadrao = () => colecaoMongo(COLECAO_PERGUNTAS);
const avisar = (onde, e) => {
  // sem Mongo (testes, boot) é esperado: não polui o log
  if (/conectarMongo/.test(String(e?.message))) return;
  console.warn(`[perguntas] ${onde}:`, e?.message || e);
};

/**
 * Grava uma troca (melhor esforço: se falhar, devolve null e a resposta ao app sai mesmo assim). Nunca lança.
 * @param {{ perfil: object, dia: string, pergunta: string, resposta: string, hora?: string, quando?: Date }} troca
 */
export async function guardarPergunta(troca, { col = null } = {}) {
  try {
    const doc = documentoPergunta(troca || {});
    if (!doc || !doc.jid) return null;
    const r = await (col || colecaoPadrao()).insertOne(doc);
    return { _id: r?.insertedId ?? null, ...doc };
  } catch (e) {
    avisar('não gravei a pergunta do app', e);
    return null;
  }
}

/**
 * As trocas da pessoa, em ordem cronológica (a mais antiga primeiro), as `n` mais recentes do filtro.
 * `desde`: Date, milissegundos, ISO, ou 'YYYY-MM-DD' (compara com o dia local da troca); `antes`: Date/ISO (paginação).
 * Lança se o banco falhar (quem chama decide o que fazer).
 */
export async function perguntasDe(jid, { desde = null, antes = null, n = 20 } = {}, { col = null } = {}) {
  const limite = Math.max(1, Math.min(200, Number(n) || 20));
  const docs = await (col || colecaoPadrao()).find(filtroPerguntas(jid, { desde, antes })).sort({ em: -1 }).limit(limite).toArray();
  return docs.reverse();
}

/** Apaga uma troca da pessoa (o filtro pelos jids garante que ninguém apaga a de outra). Devolve quantas apagou. */
export async function apagarPergunta(jids, id, { col = null } = {}) {
  const r = await (col || colecaoPadrao()).deleteOne({ _id: idDe(String(id || '')), jid: { $in: (jids || []).map(String) } });
  return r?.deletedCount || 0;
}

/** Apaga todas as trocas da pessoa. Devolve quantas apagou. */
export async function apagarPerguntasDe(jids, { col = null } = {}) {
  const r = await (col || colecaoPadrao()).deleteMany({ jid: { $in: (jids || []).map(String) } });
  return r?.deletedCount || 0;
}
