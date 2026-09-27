// off.js - Rótulos de produtos industrializados pelo Open Food Facts (base aberta e gratuita, forte no Brasil e na França).
// Código de barras na mensagem vira rótulo automático; produto com marca citado em texto ou foto, a IA pede pela linha
// "PRODUTO: <nome ou código>" e recebe a tabela. Os valores são por 100 g/ml; a IA multiplica pela quantidade dita.
// Resultados ficam em cache no Mongo (coleção produtos) por 30 dias.

import { colecao } from './mongo.js';

const UA = `NutriBot/1.0 (bot pessoal de nutricao; ${process.env.REPO_URL || 'github.com/lucasleonardo-hub/nutribot'})`;
const TIMEOUT_MS = 12_000;
const CAMPOS = 'code,product_name,product_name_pt,product_name_fr,brands,quantity,serving_size,nutriments,countries_tags,nutriscore_grade,nova_group';
const CACHE_DIAS = 30;

/** EAN-8, EAN-13 (ou 12/14 dígitos) sozinho ou dentro do texto. Devolve os códigos achados. */
export function codigosDeBarras(texto) {
  return [...String(texto || '').matchAll(/(?<!\d)(\d{8}|\d{12,14})(?!\d)/g)].map((m) => m[1]).filter((c) => !/^(19|20)\d{6}$/.test(c)); // 8 dígitos que parecem data (20260926) ficam de fora
}
export const ehCodigoBarras = (t) => /^\d{8}$|^\d{12,14}$/.test(String(t || '').trim());

const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);

/** Normaliza um produto da API pro que a IA precisa. null se não tiver nem calorias nem macros. */
export function normalizarProduto(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  const kcal = num(n['energy-kcal_100g'] ?? (n.energy_100g ? n.energy_100g / 4.184 : null));
  const prot = num(n.proteins_100g);
  const carb = num(n.carbohydrates_100g);
  const gord = num(n.fat_100g);
  if (kcal == null && prot == null && carb == null && gord == null) return null;
  const nome = p.product_name_pt || p.product_name || p.product_name_fr || '';
  return {
    codigo: p.code || '',
    nome: String(nome).trim(),
    marca: String(Array.isArray(p.brands) ? p.brands.join(', ') : p.brands || '').trim(),
    quantidade: p.quantity || '',
    porcao: p.serving_size || '',
    kcal,
    proteina: prot,
    carbo: carb,
    gordura: gord,
    acucares: num(n.sugars_100g),
    fibras: num(n.fiber_100g),
    sodio_mg: n.sodium_100g != null ? Math.round(Number(n.sodium_100g) * 1000) : null,
    porcaoKcal: num(n['energy-kcal_serving']),
    nova: p.nova_group || null,
    nutriscore: p.nutriscore_grade || null,
  };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Open Food Facts HTTP ${r.status}`);
  return r.json();
}

async function doCache(chave) {
  const d = await colecao('produtos').findOne({ _id: chave }).catch(() => null);
  if (!d || Date.now() - new Date(d.salvoEm).getTime() > CACHE_DIAS * 86400000) return null;
  return d.itens;
}
async function guardar(chave, itens) {
  await colecao('produtos').replaceOne({ _id: chave }, { _id: chave, itens, salvoEm: new Date() }, { upsert: true }).catch(() => {});
}

/** Um produto pelo código de barras (null se não existir ou não tiver tabela). */
export async function buscarPorCodigo(codigo) {
  const c = String(codigo).replace(/\D/g, '');
  const chave = `ean:${c}`;
  const cache = await doCache(chave);
  if (cache) return cache[0] || null;
  const d = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=${CAMPOS}`);
  const p = d?.status === 1 ? normalizarProduto(d.product) : null;
  await guardar(chave, p ? [p] : []);
  return p;
}

/** Até `limite` produtos pelo nome (busca do OFF em português; produtos do Brasil primeiro quando houver). */
export async function buscarPorNome(nome, { limite = 4, lang = 'pt' } = {}) {
  const termo = String(nome || '').trim().toLowerCase().slice(0, 80);
  if (!termo) return [];
  const chave = `nome:${lang}:${termo}`;
  const cache = await doCache(chave);
  if (cache) return cache;
  const d = await getJSON(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(termo)}&langs=${lang}&page_size=${limite * 4}&fields=${CAMPOS}`);
  const hits = d?.hits || [];
  const itens = hits.map(normalizarProduto).filter(Boolean);
  // Relevância: cada palavra do pedido achada no nome ou na marca conta 1; palavra igual à marca conta mais (é o que
  // distingue "iogurte grego Vigor natural" do grego de outra marca). Empate: produto do Brasil primeiro.
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palavras = semAcento(termo).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const pontos = (p) => {
    const nome = semAcento(p.nome);
    const marca = semAcento(p.marca);
    let s = 0;
    for (const w of palavras) {
      if (marca.split(/[^a-z0-9]+/).includes(w)) s += 3;
      else if (nome.includes(w) || marca.includes(w)) s += 1;
    }
    return s;
  };
  const doBrasil = (p) => Number((hits.find((h) => h.code === p.codigo)?.countries_tags || []).includes('en:brazil'));
  const ordenados = [...itens].sort((a, b) => pontos(b) - pontos(a) || doBrasil(b) - doBrasil(a)).slice(0, limite);
  await guardar(chave, ordenados);
  return ordenados;
}

/** Bloco pro prompt: uma linha por produto, valores por 100 g/ml (e por porção quando o rótulo traz). */
export function blocoRotulos(itens) {
  if (!itens?.length) return '';
  return itens
    .map((p) => {
      const cab = `${p.nome || '(sem nome)'}${p.marca ? ` (${p.marca})` : ''}${p.quantidade ? `, embalagem ${p.quantidade}` : ''}${p.codigo ? ` [código ${p.codigo}]` : ''}`;
      const cem = `por 100 g/ml: ${p.kcal ?? '?'} kcal · Proteína ${p.proteina ?? '?'} g · Carboidratos ${p.carbo ?? '?'} g · Gorduras ${p.gordura ?? '?'} g${p.acucares != null ? ` (açúcares ${p.acucares} g)` : ''}${p.fibras != null ? ` · Fibras ${p.fibras} g` : ''}${p.sodio_mg != null ? ` · Sódio ${p.sodio_mg} mg` : ''}`;
      const porcao = p.porcao ? ` · porção do rótulo: ${p.porcao}${p.porcaoKcal != null ? ` = ${p.porcaoKcal} kcal` : ''}` : '';
      const extra = p.nova ? ` · NOVA ${p.nova}${p.nova >= 4 ? ' (ultraprocessado)' : ''}` : '';
      return `- ${cab}\n  ${cem}${porcao}${extra}`;
    })
    .join('\n');
}

/** Rótulos automáticos pra uma mensagem: só quando ela traz código de barras. '' sem código ou sem achado. Nunca lança. */
export async function rotulosPara(texto) {
  const codigos = codigosDeBarras(texto).slice(0, 3);
  if (!codigos.length) return '';
  const achados = [];
  for (const c of codigos) {
    try {
      const p = await buscarPorCodigo(c);
      if (p) achados.push(p);
    } catch (e) {
      console.warn('[rotulo] código', c, String(e.message).slice(0, 80));
    }
  }
  return blocoRotulos(achados);
}
