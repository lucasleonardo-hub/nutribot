// despensa.js - O que a pessoa tem em casa, a partir do cupom do mercado (NFC-e): foto do cupom (QR lido no servidor + itens
// pela visão da IA) ou chave de 44 dígitos. Os itens são padronizados (nome canônico, categoria, perecível, validade típica),
// cruzados com a tabela nutricional do Open Food Facts e viram a despensa da pessoa. A despensa entra na conversa (sugestão
// com o que há, âncora nutricional), no plano (compras descontam o que já tem) e na reflexão. Baixa por refeição, por fala
// ("acabou o iogurte") e por pergunta de validade. Da nota ficam só itens, loja e data: CPF e total não são guardados.

import jsQR from 'jsqr';
import { Jimp } from 'jimp';
import { colecao, listarPerfis } from './mongo.js';
import { buscarPorCodigo, buscarPorNome } from './off.js';
import { ancorasDe } from './taco.js';
import { enviar } from './whatsapp.js';
import { estado } from './estado.js';
import { agora, fusoDe, diasAnteriores } from './util.js';
import * as ia from './gemini.js';

const MAX_ITENS_BLOCO = 18;
const OFF_POR_NOTA = 10; // consultas por nome ao Open Food Facts por nota (as por código de barras não contam)
const UF_POR_CODIGO = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const VALIDADE_PADRAO = { carne: 3, peixe: 2, frango: 3, laticínio: 10, 'fruta': 6, verdura: 5, legume: 8, pão: 4, ovo: 21, congelado: 90, mercearia: 180, bebida: 120, limpeza: 365, higiene: 365, outro: 60 };

// ---------- puros: chave, QR, texto ----------
/** Chave de acesso NFC-e: 44 dígitos (aceita com espaços). */
export function extrairChave(texto) {
  const m = String(texto || '').replace(/\s+/g, '').match(/\d{44}/);
  return m ? m[0] : null;
}
/** Do texto do QR (URL da SEFAZ) ou da chave: { chave, url, uf }. */
export function interpretarQr(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const url = /^https?:\/\//i.test(t) ? t : null;
  const chave = extrairChave(url ? decodeURIComponent(url).replace(/\|/g, ' ') : t);
  if (!chave) return null;
  return { chave, url, uf: UF_POR_CODIGO[Number(chave.slice(0, 2))] || null, emitidaEm: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}` };
}
/** Lê um QR numa foto (JPEG/PNG). null se não houver QR legível. */
export async function lerQr(buffer) {
  try {
    const img = await Jimp.read(buffer);
    // fotos de celular são grandes: reduz pra acelerar; se não achar, tenta no tamanho original
    for (const largura of [900, 1600, null]) {
      const c = img.clone();
      if (largura && c.bitmap.width > largura) c.resize({ w: largura });
      const { data, width, height } = c.bitmap;
      const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height, { inversionAttempts: 'attemptBoth' });
      if (r?.data) return r.data;
    }
  } catch (e) {
    console.warn('[despensa] QR:', e.message);
  }
  return null;
}
/** Normaliza nome pra casar itens ("Iogurte Grego Vigor" ~ "iogurte grego"). */
export const chaveItem = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Acha na despensa o item mais parecido com o texto (inclusão de palavras); null se nada bate. */
export function acharItem(lista, texto) {
  const alvo = chaveItem(texto);
  if (!alvo) return null;
  const palavras = alvo.split(' ').filter((w) => w.length > 2);
  let melhor = null;
  for (const it of lista || []) {
    const k = chaveItem(it.item);
    if (k === alvo) return it;
    const acertos = palavras.filter((w) => k.includes(w)).length;
    const score = acertos / Math.max(1, palavras.length) + (k.includes(alvo) || alvo.includes(k) ? 0.5 : 0);
    if (score >= 0.6 && (!melhor || score > melhor.score)) melhor = { it, score };
  }
  return melhor?.it || null;
}
const somaDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtQtd = (q, u) => (q == null ? '' : `${Number.isInteger(q) ? q : String(Math.round(q * 100) / 100).replace('.', ',')} ${u || 'un'}`.trim());

// ---------- consulta ao site da SEFAZ (teste e, se passar, caminho principal) ----------
const UA_NAV = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const textoDeHtml = (html) =>
  String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(tr|p|div|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
/**
 * Abre o link do QR como um navegador de celular faria (sem resolver desafio nenhum). Devolve
 * { status: 'ok' | 'captcha' | 'erro', http, itensEstimados, amostra, texto } sem gravar nada.
 */
export async function testarConsultaSefaz(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA_NAV, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const html = await r.text();
    const captcha = /SecurityVerify|turnstile|hcaptcha|recaptcha|CaptchaField/i.test(html);
    const texto = textoDeHtml(html);
    // linhas que parecem item de cupom: descrição + quantidade + "UN/KG" + valor
    const itensEstimados = (texto.match(/(?:Qtde\.?|Qtd\.?|Quantidade)[^\n]{0,40}\d/gi) || []).length || (texto.match(/\b(UN|KG|PC|L|G|ML)\b[^\n]{0,30}\d+[.,]\d{2}/g) || []).length;
    return { status: captcha ? 'captcha' : r.ok && itensEstimados ? 'ok' : r.ok ? 'sem_itens' : 'erro', http: r.status, urlFinal: r.url, itensEstimados, amostra: texto.slice(0, 700), texto };
  } catch (e) {
    return { status: 'erro', erro: e.message, itensEstimados: 0, amostra: '' };
  }
}

/**
 * Puro. Itens a partir do TEXTO da página da NFC-e (innerText), no modelo usado por SC/SP/RS/PR/MG:
 * "DESCRIÇÃO (Código: 123) Qtde.: 0,84 UN: KG Vl. Unit.: 39,90 Vl. Total 33,52". Devolve { loja, data, itens }.
 */
export function parsearTextoNfce(texto) {
  const t = String(texto || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const num = (s) => (s == null ? null : Number(String(s).replace(/\./g, '').replace(',', '.')) || null);
  const itens = [];
  const re = /([^\n]+?)\s*\(\s*C[óo]d(?:igo)?\.?:?\s*([^)]*?)\s*\)\s*Qtde\.?:?\s*([\d.,]+)\s*UN:?\s*([A-Za-z]{1,4})\s*Vl\.?\s*Unit\.?:?\s*([\d.,]+)\s*(?:Vl\.?\s*Total:?\s*)?([\d.,]+)/g;
  let m;
  while ((m = re.exec(t))) {
    const descricao = m[1].replace(/^\d+\s*[-–.]?\s*/, '').trim();
    if (!descricao) continue;
    itens.push({ descricao, codigo: m[2].trim() || null, qtd: num(m[3]), unidade: m[4].toUpperCase(), valorUnit: num(m[5]), valorTotal: num(m[6]) });
  }
  const loja = (t.match(/^\s*([^\n]{3,80})\n[^\n]*CNPJ/m) || [])[1]?.trim() || null;
  const d = t.match(/Emiss[ãa]o:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const data = d ? `${d[3]}-${d[2]}-${d[1]}` : null;
  return { loja, data, itens };
}
/**
 * Rota /nota: o app abriu a página da nota no celular (onde a verificação do site passa) e mandou o texto.
 * Extrai os itens (parser; se não bater, IA), padroniza, grava e avisa no grupo. Devolve { ok, itens, resumo }.
 */
export async function receberNotaDoApp({ perfil, chave, url, texto, dia, avisarGrupo }) {
  let lido = parsearTextoNfce(texto);
  if (!lido.itens.length) {
    // página num modelo diferente: a IA extrai do texto
    const r = await ia.extrairItensTexto({ texto: String(texto || '').slice(0, 20000) }).catch(() => null);
    if (r?.itens?.length) lido = { loja: r.loja || lido.loja, data: r.data || lido.data, itens: r.itens };
  }
  if (!lido.itens.length) return { ok: false, erro: 'não reconheci itens no texto da nota', itens: 0 };
  const itens = await padronizarItens(lido.itens, { perfil, dia });
  if (!itens.length) return { ok: true, itens: 0, loja: lido.loja, resumoCompleto: resumoNota({ loja: lido.loja, itens, ignorados: itens.ignorados }), resumo: `nenhum alimento nessa compra (${lido.itens.length} itens não alimentares)` };
  const r = await registrarNota({ perfil, chave: chave || extrairChave(url) || null, loja: lido.loja, data: lido.data, itens, origem: 'app' });
  const resumo = resumoNota({ loja: lido.loja, dia: r.dia, itens, repetida: r.repetida });
  if (avisarGrupo && r.nova) await avisarGrupo(resumo).catch(() => {});
  return { ok: true, itens: itens.length, repetida: Boolean(r.repetida), loja: lido.loja, resumoCompleto: resumo, resumo: r.repetida ? 'nota já lida antes' : `${itens.length} itens na despensa${lido.loja ? ` (${lido.loja})` : ''}` };
}
/** !despensa limpar: zera despensa e notas da pessoa (começar do zero depois de um teste). */
export async function limparDespensa(perfil) {
  const jid = jidDe(perfil);
  if (!jid) return 0;
  const [a, b] = await Promise.all([colecao('despensa').deleteMany({ jid }), colecao('notas').deleteMany({ jid })]);
  return (a.deletedCount || 0) + (b.deletedCount || 0);
}

// não alimentar pelo nome (reforço ao julgamento da IA): higiene, limpeza, pet, remédio, utensílio, papelaria
const RE_NAO_ALIMENTO = /\b(desodorante|des\.? ?(rexona|dove|nivea)|sabonete|shampoo|xampu|condicionador|creme dental|pasta de dente|escova|fio dental|absorvente|fralda|papel (higi[êe]nico|toalha|alum[íi]nio|filme)|guardanapo|detergente|sab[ãa]o|amaciante|alvejante|desinfetante|multiuso|esponja|saco (de )?lixo|inseticida|repelente|vela|pilha|l[âa]mpada|ra[çc][ãa]o|areia (de|para) gato|petisco (canino|felino)|rem[ée]dio|dipirona|paracetamol|ibuprofeno|vitamina c efervescente|prote[çc][ãa]o solar|protetor solar|hidratante|perfume|l[âa]mina|barbear|gilete|preservativo|cotonete|algod[ãa]o|caneta|caderno|carv[ãa]o|g[áa]s|isqueiro|f[óo]sforo|sacola|copo descart|prato descart|talher descart)\b/i;
/** Puro. Item que NÃO é comida/bebida: não entra na despensa, por nenhum caminho. */
export const pareceNaoAlimento = (item) => !!item && (item.alimento === false || ['limpeza', 'higiene', 'pet', 'remédio', 'utensílio', 'papelaria'].includes(String(item.categoria || '').toLowerCase()) || RE_NAO_ALIMENTO.test(`${item.item || ''} ${item.descricaoOriginal || ''}`));

/** Puro. O produto achado por nome no OFF bate com o item? Metade das palavras do item (3+ letras) precisa aparecer no nome do produto. */
export function nomeBate(item, nomeProduto) {
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const palavras = norm(item).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (!palavras.length) return false;
  const nome = norm(nomeProduto);
  const acertos = palavras.filter((w) => nome.includes(w)).length;
  return acertos / palavras.length >= 0.5;
}

// ---------- padronização + nutrição ----------
/**
 * Itens crus do cupom -> itens canônicos (IA leve) + tabela nutricional (Open Food Facts por código de barras ou nome).
 * cru = [{ descricao, qtd, unidade, valorUnit, valorTotal, codigo }]
 */
export async function padronizarItens(cru, { perfil, dia } = {}) {
  if (!cru?.length) return [];
  const canon = await ia.normalizarItensNota({ itens: cru, nome: perfil?.nome?.split(' ')[0] });
  const saida = [];
  const ignorados = [];
  let buscasNome = 0;
  for (let i = 0; i < canon.length; i++) {
    const c = canon[i];
    const bruto = cru[c.indice ?? i] || cru[i] || {};
    const item = {
      item: String(c.nome || bruto.descricao || '').toLowerCase().trim(),
      descricaoOriginal: String(bruto.descricao || '').slice(0, 80),
      categoria: String(c.categoria || 'outro').toLowerCase(),
      quantidade: Number(c.quantidade) || Number(bruto.qtd) || 1,
      unidade: String(c.unidade || bruto.unidade || 'un').toLowerCase(),
      granel: Boolean(c.granel),
      perecivel: Boolean(c.perecivel),
      validadeDias: Number(c.validade_dias) || VALIDADE_PADRAO[String(c.categoria || '').toLowerCase()] || VALIDADE_PADRAO.outro,
      alimento: c.alimento !== false,
      preco: Number(bruto.valorTotal) || null,
      ean: /^\d{8}$|^\d{12,14}$/.test(String(bruto.codigo || c.ean || '')) ? String(bruto.codigo || c.ean) : null,
    };
    if (!item.item) continue;
    // só comida e bebida entram (desodorante, detergente, ração... ficam de fora em qualquer caminho: app, PDF, foto, texto)
    if (pareceNaoAlimento(item)) {
      ignorados.push(item.item);
      continue;
    }
    if (item.alimento) {
      try {
        // in natura (fruta, verdura, legume, carne, frango, peixe, ovo): tabela TACO, não busca por nome no OFF
        // (a busca por nome devolvia "Aceite girasol" pra refrigerante e "Refrigerante com Bergamota" pra bergamota)
        const inNatura = ['fruta', 'verdura', 'legume', 'carne', 'frango', 'peixe', 'ovo'].includes(item.categoria);
        const taco = ancorasDe(item.item)[0];
        if (inNatura && taco && !taco.gramas) item.nutri = { kcal: taco.kcal, p: taco.p, c: taco.c, g: taco.g, fonte: `TACO: ${taco.nome}` };
        let prod = !item.nutri && item.ean ? await buscarPorCodigo(item.ean).catch(() => null) : null;
        if (!item.nutri && !prod && !inNatura && buscasNome < OFF_POR_NOTA) {
          buscasNome += 1;
          const achado = (await buscarPorNome(item.item, { limite: 3 }).catch(() => []))?.find((p) => nomeBate(item.item, p.nome)) || null;
          prod = achado;
        }
        if (!item.nutri && prod?.kcal != null) item.nutri = { kcal: Math.round(prod.kcal), p: Math.round(prod.proteina ?? prod.p ?? 0), c: Math.round(prod.carbo ?? prod.c ?? 0), g: Math.round(prod.gordura ?? prod.g ?? 0), fonte: prod.nome || 'Open Food Facts' };
        if (!item.nutri && taco && !taco.gramas) item.nutri = { kcal: taco.kcal, p: taco.p, c: taco.c, g: taco.g, fonte: `TACO: ${taco.nome}` };
      } catch (e) {
        console.warn('[despensa] nutrição:', e.message);
      }
    }
    saida.push(item);
  }
  if (ignorados.length) console.log(`[despensa] ${ignorados.length} item(ns) não alimentar(es) ignorado(s): ${ignorados.join(', ')}`);
  Object.defineProperty(saida, 'ignorados', { value: ignorados.length, enumerable: false });
  return saida;
}

// ---------- banco ----------
const jidDe = (perfil) => perfil?.jids?.[0] || null;
/** Guarda a nota (sem CPF/total) e põe os itens na despensa. Repetida (mesma chave) não entra duas vezes. */
export async function registrarNota({ perfil, chave = null, loja = null, data = null, itens, origem = 'foto' }) {
  const jid = jidDe(perfil);
  if (!jid || !itens?.length) return { nova: false, itens: 0 };
  const notas = colecao('notas');
  if (chave && (await notas.findOne({ chave }))) return { nova: false, itens: 0, repetida: true };
  const dia = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : agora(fusoDe(perfil)).dia;
  await notas.insertOne({ jid, nome: perfil.nome, chave, loja, dia, origem, itens: itens.map(({ nutri, ...r }) => r), criadoEm: new Date() });
  await entrarNaDespensa(perfil, itens, { dia, loja });
  return { nova: true, itens: itens.length, dia };
}
/** Itens entram/somam na despensa (um documento por pessoa+item). */
export async function entrarNaDespensa(perfil, itens, { dia, loja = null } = {}) {
  const jid = jidDe(perfil);
  const col = colecao('despensa');
  for (const it of itens) {
    if (!it.item) continue;
    const k = chaveItem(it.item);
    const existente = await col.findOne({ jid, k });
    const validadeEm = somaDias(dia, it.validadeDias || VALIDADE_PADRAO.outro);
    const doc = {
      jid,
      k,
      item: it.item,
      categoria: it.categoria || existente?.categoria || 'outro',
      unidade: it.unidade || existente?.unidade || 'un',
      granel: it.granel ?? existente?.granel ?? false,
      perecivel: it.perecivel ?? existente?.perecivel ?? false,
      alimento: it.alimento ?? existente?.alimento ?? true,
      quantidade: (existente && existente.estado !== 'acabou' ? Number(existente.quantidade) || 0 : 0) + (Number(it.quantidade) || 1),
      estado: 'tem',
      compradoEm: dia,
      validadeEm,
      loja,
      preco: it.preco ?? existente?.preco ?? null,
      nutri: it.nutri || existente?.nutri || null,
      compras: (existente?.compras || 0) + 1,
      perguntadoEm: null,
      atualizadoEm: new Date(),
    };
    await col.replaceOne({ jid, k }, doc, { upsert: true });
  }
}
export async function listarDespensa(perfil, { incluirAcabou = false } = {}) {
  const jid = jidDe(perfil);
  if (!jid) return [];
  const q = incluirAcabou ? { jid } : { jid, estado: { $ne: 'acabou' } };
  return colecao('despensa').find(q).sort({ validadeEm: 1 }).toArray();
}
/**
 * Baixa/ajuste: acao = 'acabou' | 'acabando' | 'usei' (qtd opcional) | 'comprei' (qtd) | 'tem' (confirmou que ainda tem).
 * Devolve o item afetado ou null.
 */
export async function ajustarItem(perfil, { item, acao, qtd, unidade }, { dia } = {}) {
  const jid = jidDe(perfil);
  if (!jid || !item) return null;
  const col = colecao('despensa');
  const lista = await col.find({ jid }).toArray();
  let alvo = acharItem(lista, item);
  const hoje = dia || agora(fusoDe(perfil)).dia;
  if (!alvo && acao !== 'comprei') return null;
  if (!alvo) {
    await entrarNaDespensa(perfil, [{ item: String(item).toLowerCase(), quantidade: Number(qtd) || 1, unidade: unidade || 'un', categoria: 'outro', validadeDias: VALIDADE_PADRAO.outro }], { dia: hoje });
    return (await col.findOne({ jid, k: chaveItem(item) })) || null;
  }
  const set = { atualizadoEm: new Date() };
  if (acao === 'acabou') Object.assign(set, { estado: 'acabou', quantidade: 0, acabouEm: hoje });
  else if (acao === 'acabando') Object.assign(set, { estado: 'acabando' });
  else if (acao === 'tem') Object.assign(set, { estado: alvo.estado === 'acabou' ? 'tem' : alvo.estado, perguntadoEm: null, validadeEm: somaDias(hoje, Math.max(2, Math.round((alvo.validadeDias || 7) / 2))) });
  else if (acao === 'comprei') Object.assign(set, { estado: 'tem', quantidade: (alvo.estado === 'acabou' ? 0 : Number(alvo.quantidade) || 0) + (Number(qtd) || 1), compradoEm: hoje, validadeEm: somaDias(hoje, alvo.validadeDias || VALIDADE_PADRAO[alvo.categoria] || 30), compras: (alvo.compras || 0) + 1 });
  else if (acao === 'usei') {
    if (alvo.granel) set.estado = alvo.estado === 'tem' ? 'tem' : alvo.estado; // granel não se controla por grama
    else {
      const q = Math.max(0, (Number(alvo.quantidade) || 0) - (Number(qtd) || 1));
      Object.assign(set, { quantidade: q, estado: q <= 0 ? 'acabou' : q <= 1 ? 'acabando' : 'tem', ...(q <= 0 ? { acabouEm: hoje } : {}) });
    }
  }
  await col.updateOne({ _id: alvo._id }, { $set: set });
  return { ...alvo, ...set };
}
/** Linha oculta DESPENSA da IA: [{ item, acao, qtd, unidade }]. Devolve resumo curto do que mudou (pro log). */
export async function aplicarLinhaDespensa(perfil, lista, { dia } = {}) {
  const feitos = [];
  for (const l of (Array.isArray(lista) ? lista : []).slice(0, 12)) {
    const r = await ajustarItem(perfil, { item: l.item, acao: String(l.acao || 'usei').toLowerCase(), qtd: l.qtd, unidade: l.unidade }, { dia }).catch(() => null);
    if (r) feitos.push(`${r.item}: ${l.acao}${l.qtd ? ` ${l.qtd}` : ''} → ${r.estado}${r.quantidade != null ? ` (${fmtQtd(r.quantidade, r.unidade)})` : ''}`);
  }
  return feitos;
}

// ---------- textos ----------
const diasAte = (validadeEm, hoje) => Math.round((new Date(`${validadeEm}T12:00:00Z`) - new Date(`${hoje}T12:00:00Z`)) / 86400_000);
/** Bloco pro prompt: o que há em casa, o que vence, âncoras nutricionais. '' sem despensa. */
export async function blocoDespensa(perfil) {
  const lista = await listarDespensa(perfil).catch(() => []);
  if (!lista.length) return '';
  const hoje = agora(fusoDe(perfil)).dia;
  const alimentos = lista.filter((i) => i.alimento !== false);
  const vencendo = alimentos.filter((i) => i.perecivel && diasAte(i.validadeEm, hoje) <= 2);
  const linha = (i) => {
    const d = diasAte(i.validadeEm, hoje);
    const val = i.perecivel ? (d < 0 ? ', provavelmente vencido' : d <= 2 ? `, vence em ${d} dia(s)` : '') : '';
    const n = i.nutri ? ` [${i.nutri.kcal} kcal/100 g, P ${i.nutri.p} g]` : '';
    return `- ${i.item}${i.granel ? ` (${i.estado === 'acabando' ? 'acabando' : 'tem'})` : i.quantidade ? ` (${fmtQtd(i.quantidade, i.unidade)}${i.estado === 'acabando' ? ', acabando' : ''})` : ''}${val}${n}`;
  };
  const top = [...vencendo, ...alimentos.filter((i) => !vencendo.includes(i)).sort((a, b) => (b.compras || 0) - (a.compras || 0))].slice(0, MAX_ITENS_BLOCO);
  const ultimaNota = lista.map((i) => i.compradoEm).sort().pop();
  return (
    `DESPENSA DE ${perfil.nome.split(' ')[0]} (o que tem em casa pelas notas de mercado e pelas baixas; última compra ${ultimaNota}; use pra sugerir refeição com o que HÁ, pra lembrar o que vence e como âncora nutricional quando ela(e) comer um item destes; não invente item que não está aqui):\n` +
    top.map(linha).join('\n') +
    (lista.length > top.length ? `\n(+${lista.length - top.length} itens)` : '')
  );
}
/** !despensa */
export async function despensaZap(perfil) {
  const lista = await listarDespensa(perfil).catch(() => []);
  if (!lista.length) return '🧺 *Despensa vazia*\n\nManda a foto do cupom do mercado (com o QR) que eu leio os itens e monto a tua despensa. Também vale "!despensa add 2 kg arroz".';
  const hoje = agora(fusoDe(perfil)).dia;
  const porCat = new Map();
  for (const i of lista) porCat.set(i.categoria || 'outro', [...(porCat.get(i.categoria || 'outro') || []), i]);
  const blocos = [...porCat.entries()].map(([cat, itens]) => `*${cat[0].toUpperCase()}${cat.slice(1)}*\n${itens.map((i) => { const d = diasAte(i.validadeEm, hoje); return `- ${i.item}${i.granel ? (i.estado === 'acabando' ? ' · acabando' : '') : i.quantidade ? ` · ${fmtQtd(i.quantidade, i.unidade)}` : ''}${i.perecivel ? (d < 0 ? ' · ⚠️ vencido?' : d <= 2 ? ` · vence em ${d}d` : '') : ''}`; }).join('\n')}`);
  return `🧺 *Tua despensa* (${lista.length} itens)\n\n${blocos.join('\n\n')}\n\n_Baixa: "acabou o iogurte", "usei 2 ovos", ou !despensa tirar iogurte · !despensa add 1 kg frango · foto do cupom pra entrar compra nova._`;
}
/** Texto curto depois de ler um cupom. */
export function resumoNota({ loja, dia, itens, repetida, ignorados = itens?.ignorados || 0 }) {
  if (repetida) return 'Essa nota eu já tinha lido. Nada mudou na despensa.';
  if (!itens?.length) return `🧾 *Cupom lido*${loja ? ` · ${loja}` : ''}\n\nNenhum alimento nessa compra${ignorados ? ` (${ignorados} item(ns) de higiene/limpeza/outros, que eu não guardo)` : ''}.`;
  const comNutri = itens.filter((i) => i.nutri).length;
  const perec = itens.filter((i) => i.perecivel).length;
  const lista = itens.slice(0, 12).map((i) => `- ${i.item}${i.quantidade ? ` · ${fmtQtd(i.quantidade, i.unidade)}` : ''}`).join('\n');
  return `🧾 *Cupom lido*${loja ? ` · ${loja}` : ''}${dia ? ` · ${dia.slice(8, 10)}/${dia.slice(5, 7)}` : ''}\n\n${itens.length} ${itens.length === 1 ? 'alimento entrou' : 'alimentos entraram'} na despensa${perec ? `, ${perec} perecíveis` : ''}${comNutri ? `, ${comNutri} com tabela nutricional` : ''}${ignorados ? ` (${ignorados} item(ns) não alimentar(es) de fora)` : ''}.\n\n${lista}${itens.length > 12 ? `\n(+${itens.length - 12})` : ''}\n\n_!despensa mostra tudo. Quando algo acabar, é só me dizer._`;
}

// ---------- saiu do mercado: pergunta se comprou (uma vez por dia; só se nenhuma nota chegou nas últimas 3 h) ----------
export async function perguntarCompra(perfil, lugar, { lembrar } = {}) {
  const grupo = estado.memoria.grupo;
  if (!grupo || estado.statusConexao !== 'conectado' || !perfil?.onboarded) return false;
  const { dia, hora } = agora(fusoDe(perfil));
  const h = Number(hora.slice(0, 2));
  if (h < 7 || h >= 23) return false;
  if (perfil.despensaPerguntaEm === dia) return false; // uma por dia
  const recente = await colecao('notas').findOne({ jid: jidDe(perfil), criadoEm: { $gte: new Date(Date.now() - 3 * 3600_000) } }).catch(() => null);
  if (recente) return false; // já mandou a nota
  const onde = lugar?.nome ? `no ${lugar.nome}` : `no ${lugar?.tipo || 'mercado'}`;
  const texto = `${perfil.nome.split(' ')[0]}, vi que você passou ${onde} agora há pouco. Comprou algo pra despensa? Manda a foto do cupom (ou lê o QR no app) que eu anoto. Se não foi comida, só diz "nada". 🧺`;
  await salvarPerfilDespensa(perfil, { despensaPerguntaEm: dia });
  await enviar(grupo, texto).catch(() => {});
  if (lembrar) await lembrar({ hora: agora().hora, jid: null, nome: 'bot', texto, tipo: 'bot' }).catch(() => {});
  console.log(`[despensa] perguntei a ${perfil.nome} se comprou algo (${onde})`);
  return true;
}
async function salvarPerfilDespensa(perfil, patch) {
  const { salvarPerfil } = await import('./mongo.js');
  await salvarPerfil({ jids: perfil.jids, ...patch }).catch(() => {});
}

// ---------- validade: pergunta uma vez por dia por pessoa ----------
export async function perguntarValidades({ lembrar } = {}) {
  const grupo = estado.memoria.grupo;
  if (!grupo || estado.statusConexao !== 'conectado') return;
  for (const perfil of (await listarPerfis().catch(() => [])).filter((p) => p.onboarded)) {
    const hoje = agora(fusoDe(perfil)).dia;
    const lista = await listarDespensa(perfil).catch(() => []);
    const vencidos = lista.filter((i) => i.perecivel && i.alimento !== false && i.estado !== 'acabou' && diasAte(i.validadeEm, hoje) <= 0 && i.perguntadoEm !== hoje && (!i.perguntadoEm || diasAte(hoje, i.perguntadoEm) <= -3));
    if (!vencidos.length) continue;
    const alvo = vencidos.sort((a, b) => a.validadeEm.localeCompare(b.validadeEm))[0];
    const outros = vencidos.length > 1 ? ` (e mais ${vencidos.length - 1} perecível(is) na mesma situação)` : '';
    const texto = `${perfil.nome.split(' ')[0]}, ainda tem ${alvo.item} aí? Comprou dia ${alvo.compradoEm.slice(8, 10)}/${alvo.compradoEm.slice(5, 7)} e já passou o prazo típico${outros}. Me diz "tem" ou "acabou" que eu acerto a despensa. 🧺`;
    await colecao('despensa').updateMany({ _id: { $in: vencidos.map((v) => v._id) } }, { $set: { perguntadoEm: hoje } });
    await enviar(grupo, texto).catch(() => {});
    if (lembrar) await lembrar({ hora: agora().hora, jid: null, nome: 'bot', texto, tipo: 'bot' }).catch(() => {});
    console.log(`[despensa] perguntei a ${perfil.nome} sobre ${alvo.item}`);
  }
}

/** Resumo pra reflexão/plano: consumo x desperdício nas últimas 4 semanas. '' sem dados. */
export async function resumoDespensaPeriodo(perfil, dia) {
  const jid = jidDe(perfil);
  if (!jid) return '';
  const desde = diasAnteriores(dia, 28)[0];
  const [notas, lista] = await Promise.all([colecao('notas').find({ jid, dia: { $gte: desde } }).toArray().catch(() => []), listarDespensa(perfil, { incluirAcabou: true }).catch(() => [])]);
  if (!notas.length && !lista.length) return '';
  const gasto = notas.reduce((a, n) => a + n.itens.reduce((b, i) => b + (Number(i.preco) || 0), 0), 0);
  const recorrentes = lista.filter((i) => (i.compras || 0) >= 2).map((i) => i.item).slice(0, 10);
  const vencidos = lista.filter((i) => i.perecivel && i.estado !== 'acabou' && diasAte(i.validadeEm, dia) < -2).map((i) => i.item).slice(0, 8);
  // idas a lugar de compra (pela localização) x notas lidas: o que ela compra e não conta
  let idas = 0;
  try {
    const idsCompra = new Set((perfil.lugares || []).filter((l) => ['mercado', 'padaria', 'feira', 'hortifruti', 'açougue', 'shopping'].includes(String(l.tipo || '').toLowerCase())).map((l) => l.id));
    if (idsCompra.size) idas = await colecao('visitas').countDocuments({ jid, lugarId: { $in: [...idsCompra] }, dia: { $gte: desde }, min: { $gte: 10 } });
  } catch {}
  return (
    `DESPENSA (últimos 28 dias): ${notas.length} nota(s) de mercado${gasto ? `, ~R$ ${Math.round(gasto)} em itens lidos` : ''}; ${lista.filter((i) => i.estado !== 'acabou').length} itens em casa.` +
    (idas ? ` Idas a mercado/padaria pela localização: ${idas}${notas.length < idas ? ` (${idas - notas.length} sem nota lida: compras que você não viu)` : ''}.` : '') +
    (recorrentes.length ? ` Compra sempre: ${recorrentes.join(', ')}.` : '') +
    (vencidos.length ? ` Perecíveis passados do prazo sem baixa (desperdício provável): ${vencidos.join(', ')}.` : '')
  );
}
