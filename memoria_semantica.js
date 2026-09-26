// memoria_semantica.js - Memória de longo prazo por significado (Atlas Vector Search no cluster grátis + embeddings do Gemini).
// O que entra, toda noite no fechamento do dia: o que cada pessoa falou no dia (resumido em texto), o resumo do dia,
// os momentos memoráveis, as notas de cada pessoa e o diário da Nutri. Na conversa, antes de responder (só na via
// completa), ela busca as 4 lembranças mais parecidas com a mensagem atual, de dias anteriores, e recebe como bloco.
// Se o índice ou o embedding falharem, nada quebra: ela responde sem lembranças.

import { colecao } from './mongo.js';
import * as ia from './gemini.js';

const COLECAO = 'memoria_vetorial';
const INDICE = 'vetor';
const DIMENSOES = 768;
const SCORE_MINIMO = Number(process.env.MEMORIA_SCORE_MIN) || 0.74; // vectorSearchScore de cosseno: (1+cos)/2; 0,74 ≈ bem parecido
let indicePronto = false;

/** Cria a coleção e o índice vetorial se não existirem. Nunca lança. */
export async function garantirIndiceVetorial() {
  try {
    const col = colecao(COLECAO);
    const existentes = await col.listSearchIndexes().toArray().catch(() => null);
    if (existentes === null) return console.warn('[memoria] cluster sem suporte a índice de busca; memória semântica desligada');
    if (!existentes.some((i) => i.name === INDICE)) {
      await col.insertOne({ _id: '_semente', tipo: 'semente', pessoa: 'sistema', dia: '', texto: '', vetor: Array(DIMENSOES).fill(0), criadoEm: new Date() }).catch(() => {});
      await col.createSearchIndex({
        name: INDICE,
        type: 'vectorSearch',
        definition: { fields: [{ type: 'vector', path: 'vetor', numDimensions: DIMENSOES, similarity: 'cosine' }, { type: 'filter', path: 'tipo' }, { type: 'filter', path: 'pessoa' }] },
      });
      console.log('[memoria] índice vetorial criado (fica pronto em ~1 min)');
    }
    indicePronto = true;
  } catch (e) {
    console.warn('[memoria] índice vetorial indisponível:', e.message);
  }
}

/** Guarda (ou substitui) uma lembrança. chave = identidade estável (ex.: "conversa:2026-09-24:Ana"). Nunca lança. */
export async function guardarLembranca({ chave, tipo, pessoa, dia, texto }) {
  try {
    const t = String(texto || '').trim();
    if (t.length < 20) return false;
    const vetor = await ia.embutir(t.slice(0, 6000), 'RETRIEVAL_DOCUMENT');
    if (!vetor) return false;
    await colecao(COLECAO).replaceOne({ _id: chave }, { _id: chave, tipo, pessoa, dia, texto: t.slice(0, 6000), vetor, criadoEm: new Date() }, { upsert: true });
    return true;
  } catch (e) {
    console.warn(`[memoria] falha ao guardar ${chave}:`, e.message);
    return false;
  }
}

/**
 * Lembranças de dias anteriores parecidas com a consulta. Devolve o bloco pronto pro prompt ('' se nada).
 * @param {object} p { consulta, pessoa, excluirDia, limite = 4 }
 */
export async function lembrancasPara({ consulta, pessoa, outros = [], excluirDia, limite = 4 }) {
  if (!indicePronto) return '';
  const q = String(consulta || '').trim();
  if (q.length < 12) return '';
  try {
    const vetor = await ia.embutir(q.slice(0, 2000), 'RETRIEVAL_QUERY');
    if (!vetor) return '';
    // lembranças da própria pessoa, do grupo, da Nutri e de quem foi citado na mensagem ("o João tem trauma de ovo?")
    const pessoas = [...new Set([pessoa, 'grupo', 'nutri', ...outros].filter(Boolean))];
    const docs = await colecao(COLECAO)
      .aggregate([
        { $vectorSearch: { index: INDICE, path: 'vetor', queryVector: vetor, numCandidates: 80, limit: 12, filter: { pessoa: { $in: pessoas } } } },
        { $project: { _id: 0, tipo: 1, pessoa: 1, dia: 1, texto: 1, score: { $meta: 'vectorSearchScore' } } },
      ])
      .toArray();
    const uteis = docs.filter((d) => d.score >= SCORE_MINIMO && d.dia !== excluirDia && d.tipo !== 'semente').slice(0, limite);
    if (!uteis.length) return '';
    const dm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : 'sem data');
    return uteis.map((d) => `- [${dm(d.dia)} · ${d.tipo}${d.pessoa && d.pessoa !== 'grupo' ? ` · ${d.pessoa}` : ''}] ${d.texto.slice(0, 500).replace(/\s+/g, ' ')}`).join('\n');
  } catch (e) {
    console.warn('[memoria] busca falhou:', e.message);
    return '';
  }
}

/**
 * Fechamento do dia: indexa o que vale lembrar. Recebe o que o fecharDia já tem em mãos. Nunca lança.
 * @param {object} p { dia, perfis, historico, resumo, momentos, diario, falasDe }
 */
export async function indexarDia({ dia, perfis, historico, resumo, momentos, diario, falasDe }) {
  let n = 0;
  for (const p of perfis) {
    const falas = falasDe(historico, p.nome).filter((m) => m.tipo !== 'bot').map((m) => `${m.hora} ${m.texto}`.trim()).filter((t) => t.length > 6);
    if (falas.length) n += (await guardarLembranca({ chave: `conversa:${dia}:${p.nome}`, tipo: 'conversa', pessoa: p.nome, dia, texto: `O que ${p.nome} disse em ${dia}:\n${falas.join('\n')}` })) ? 1 : 0;
    if (p.notas) n += (await guardarLembranca({ chave: `notas:${p.nome}`, tipo: 'notas', pessoa: p.nome, dia, texto: `Notas da Nutri sobre ${p.nome} (atualizadas ${dia}):\n${p.notas}` })) ? 1 : 0;
  }
  if (resumo) n += (await guardarLembranca({ chave: `resumo:${dia}`, tipo: 'resumo do dia', pessoa: 'grupo', dia, texto: `Resumo do dia ${dia}:\n${resumo}` })) ? 1 : 0;
  for (const [i, m] of (momentos || []).entries()) {
    const texto = typeof m === 'string' ? m : m.texto;
    if (texto) n += (await guardarLembranca({ chave: `momento:${dia}:${i}`, tipo: 'momento', pessoa: 'grupo', dia, texto: `Momento de ${dia}: ${texto}` })) ? 1 : 0;
  }
  if (diario) n += (await guardarLembranca({ chave: `diario:${dia}`, tipo: 'diário da Nutri', pessoa: 'nutri', dia, texto: `Diário da Nutri em ${dia}:\n${diario}` })) ? 1 : 0;
  console.log(`[memoria] ${n} lembrança(s) indexada(s) de ${dia}`);
  return n;
}
