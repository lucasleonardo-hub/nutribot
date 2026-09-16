// pesquisa.js - Busca científica SEM chave paga, pra Nutri revisar a base de conhecimento.
// Fontes: PubMed (artigos, via E-utilities do NIH) e Wikipedia. Opcional: Brave Search se BRAVE_API_KEY existir.
// A busca do Google integrada ao Gemini não está disponível na cota gratuita, por isso este módulo.
//
// pesquisar({ pt, en }) -> [{ fonte, titulo, url, trecho }]

const TIMEOUT_MS = 15_000;
const UA = 'NutriBot/1.0 (bot pessoal de nutricao; github.com/lucasleonardo-hub/nutribot)';

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url.slice(0, 80)}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url.slice(0, 80)}`);
  return res.text();
}

const limpar = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ---------- PubMed: revisões, meta-análises e diretrizes recentes ----------
export async function pubmed(consulta, { limite = 5, anoMin = 2018 } = {}) {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const termo = `${consulta} AND (review[pt] OR meta-analysis[pt] OR guideline[pt] OR systematic review[pt] OR "position stand"[ti])`;
  const busca = await getJSON(
    `${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(termo)}&retmax=${limite}&sort=date&retmode=json&datetype=pdat&mindate=${anoMin}&maxdate=2035`
  );
  const ids = busca.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const xml = await getText(`${base}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml&rettype=abstract`);
  const artigos = [];
  for (const bloco of xml.split('<PubmedArticle>').slice(1)) {
    const pmid = bloco.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    const titulo = limpar(bloco.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1]);
    const ano = bloco.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] || '';
    const revista = limpar(bloco.match(/<Title>([\s\S]*?)<\/Title>/)?.[1]);
    const abstract = limpar([...bloco.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) => m[1]).join(' ')).slice(0, 1600);
    if (pmid && titulo) artigos.push({ fonte: `PubMed ${ano}${revista ? ` · ${revista}` : ''}`, titulo, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, trecho: abstract || '(sem resumo)' });
  }
  return artigos;
}

// ---------- Wikipedia ----------
export async function wikipedia(consulta, lang = 'pt', limite = 2) {
  const busca = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(consulta)}&srlimit=${limite}&format=json&utf8=1`);
  const titulos = (busca.query?.search || []).map((r) => r.title);
  if (!titulos.length) return [];
  const extratos = await getJSON(
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&exchars=1000&inprop=url&titles=${encodeURIComponent(titulos.join('|'))}&format=json&utf8=1`
  );
  return Object.values(extratos.query?.pages || {})
    .filter((p) => p.extract)
    .map((p) => ({ fonte: `Wikipedia (${lang})`, titulo: p.title, url: p.fullurl, trecho: limpar(p.extract) }));
}

// ---------- Brave Search (opcional, 2.000 buscas/mês grátis) ----------
export async function brave(consulta, limite = 5) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  const d = await getJSON(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(consulta)}&count=${limite}&search_lang=pt-br`, { 'X-Subscription-Token': key });
  return (d.web?.results || []).map((r) => ({ fonte: 'Web', titulo: r.title, url: r.url, trecho: limpar(r.description) }));
}

/** Pesquisa combinada; falha em uma fonte não derruba as outras. */
export async function pesquisar({ pt, en }) {
  const tarefas = [pubmed(en || pt), wikipedia(pt || en, 'pt', 2), brave(pt || en, 5)];
  const resultados = await Promise.allSettled(tarefas);
  const itens = [];
  for (const r of resultados) {
    if (r.status === 'fulfilled') itens.push(...r.value);
    else console.warn('[pesquisa] fonte falhou:', r.reason?.message);
  }
  const vistos = new Set();
  return itens.filter((i) => i.url && !vistos.has(i.url) && vistos.add(i.url));
}

/** Formata os resultados pra entrar no prompt do Gemini. */
export function formatarFontes(itens, max = 10) {
  if (!itens.length) return '(nenhuma fonte nova encontrada)';
  return itens
    .slice(0, max)
    .map((i, n) => `[${n + 1}] ${i.titulo} (${i.fonte})\nURL: ${i.url}\n${i.trecho}`)
    .join('\n\n');
}
