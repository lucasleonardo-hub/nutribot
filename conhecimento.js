// conhecimento.js - Base de conhecimento da Nutri (nutrição por foco: base, hipertrofia, emagrecimento, saúde, performance, rotina)
// - Os documentos vivem na pasta ./conhecimento/*.md do repositório (versão inicial, escrita com fontes).
// - No boot, são carregados no Mongo (collection "conhecimento") e espelhados no Drive em Conhecimento/*.md (pra ler no Obsidian).
// - Todo mês (ou com !estudar) a Nutri pesquisa no PubMed o que saiu de novo e revisa cada documento se houver mudança real.
// - Em cada resposta, os documentos relevantes pro objetivo da pessoa entram no contexto do Gemini.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colecao } from './mongo.js';
import { salvarMarkdown } from './drive.js';
import { pesquisar, formatarFontes } from './pesquisa.js';

const PASTA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'conhecimento');
const MAX_CHARS_POR_DOC = Number(process.env.CONHECIMENTO_MAX_CHARS) || 9000;

const docs = new Map(); // id -> { id, foco, titulo, versao, atualizado, consulta_en, corpo, fontesNovas }

// ---------- parsing ----------
function parse(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, corpo: md };
  const meta = {};
  for (const linha of m[1].split('\n')) {
    const i = linha.indexOf(':');
    if (i > 0) meta[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  return { meta, corpo: m[2].trim() };
}

function montarMd(doc) {
  return (
    `---\ntipo: conhecimento\nfoco: ${doc.foco}\ntitulo: ${doc.titulo}\nversao: ${doc.versao}\natualizado: ${doc.atualizado}\nconsulta_en: ${doc.consulta_en || ''}\ntags: [nutribot, conhecimento, ${doc.foco}]\n---\n\n${doc.corpo}\n`
  );
}

function lerArquivos() {
  if (!fs.existsSync(PASTA)) return [];
  return fs
    .readdirSync(PASTA)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { meta, corpo } = parse(fs.readFileSync(path.join(PASTA, f), 'utf8'));
      return {
        id: f.replace(/\.md$/, ''),
        foco: meta.foco || 'base',
        titulo: meta.titulo || f,
        versao: Number(meta.versao) || 1,
        atualizado: meta.atualizado || '',
        consulta_en: meta.consulta_en || '',
        corpo,
      };
    });
}

// ---------- persistência ----------
async function persistir(doc, pasta = 'Conhecimento') {
  await colecao('conhecimento').replaceOne({ _id: doc.id }, { _id: doc.id, ...doc, salvoEm: new Date() }, { upsert: true });
  docs.set(doc.id, doc);
  await salvarMarkdown(pasta, `${doc.id}.md`, montarMd(doc)).catch((e) => console.error('[conhecimento] drive:', e.message));
}

const slug = (t) =>
  String(t)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/**
 * Guarda o resultado de uma pesquisa que a Nutri fez no meio da conversa (quando a base não bastou),
 * pra não precisar pesquisar de novo. Vai pro Mongo e pro Drive em Conhecimento/Pesquisas/.
 */
export async function salvarPesquisa({ consulta, nota, fontes, dia }) {
  const id = `pesquisa-${slug(consulta)}`;
  const corpo =
    `# Pesquisa: ${consulta}\n\n${nota.trim()}\n\n## Fontes\n` +
    (fontes || []).slice(0, 8).map((f) => `- ${f.titulo} (${f.fonte}). ${f.url}`).join('\n');
  const doc = { id, foco: 'pesquisa', titulo: `Pesquisa: ${consulta}`, versao: (docs.get(id)?.versao || 0) + 1, atualizado: dia, consulta_en: consulta, corpo };
  await persistir(doc, 'Conhecimento/Pesquisas');
  return doc;
}

/**
 * Carrega a base: Mongo primeiro; arquivos do repo entram quando não existem no Mongo
 * ou quando a versão do arquivo é maior (atualização manual no código).
 */
export async function carregarConhecimento() {
  const noMongo = await colecao('conhecimento').find({}).toArray();
  for (const d of noMongo) docs.set(d._id, { ...d, id: d._id });

  let novos = 0;
  for (const arq of lerArquivos()) {
    const atual = docs.get(arq.id);
    if (!atual || (arq.versao > (atual.versaoArquivo || 0) && arq.versao > atual.versao)) {
      await persistir({ ...arq, versaoArquivo: arq.versao });
      novos++;
    }
  }
  console.log(`[conhecimento] ${docs.size} documentos carregados${novos ? ` (${novos} novos/atualizados do repositório)` : ''}`);
  return docs.size;
}

export function listarDocs() {
  return [...docs.values()].map((d) => ({ id: d.id, foco: d.foco, titulo: d.titulo, versao: d.versao, atualizado: d.atualizado }));
}

// ---------- seleção por objetivo ----------
const FOCOS = [
  { foco: 'emagrecimento', re: /secar|emagrec|perder|gordura|defini|barriga|peso|cutting|magr/i },
  { foco: 'hipertrofia', re: /hipertrof|massa|ganhar|for[çc]a|crescer|bulk|muscul/i },
  { foco: 'performance', re: /salto|performance|explos|corr|velocidade|v[oô]lei|basquete|futebol|quadra|atleta|resist[êe]ncia|condicionamento/i },
  { foco: 'saude', re: /sa[uú]de|press[ãa]o|glicem|colesterol|exame|diabet|m[ée]dico|triglic/i },
];

function focosDe(objetivo) {
  const achados = FOCOS.filter((f) => f.re.test(objetivo || '')).map((f) => f.foco);
  return achados.length ? achados : ['saude'];
}

/**
 * Texto de conhecimento pra entrar no prompt: Base + documentos dos focos das pessoas.
 * Aceita um perfil ou uma lista de perfis. Sempre inclui "rotina" (horários/marmita).
 */
export function docsPara(perfilOuLista) {
  const perfis = Array.isArray(perfilOuLista) ? perfilOuLista : [perfilOuLista];
  const focos = new Set(['base', 'rotina']);
  for (const p of perfis) for (const f of focosDe(p?.objetivo)) focos.add(f);

  const escolhidos = [...docs.values()].filter((d) => focos.has(d.foco)).sort((a, b) => (a.foco === 'base' ? -1 : b.foco === 'base' ? 1 : a.id.localeCompare(b.id)));
  // pesquisas recentes que ela mesma fez no meio da conversa (as 4 mais novas, resumidas)
  const pesquisas = [...docs.values()]
    .filter((d) => d.foco === 'pesquisa')
    .sort((a, b) => String(b.atualizado).localeCompare(String(a.atualizado)))
    .slice(0, 4);
  if (!escolhidos.length && !pesquisas.length) return '';
  const cortar = (t, n) => (t.length > n ? t.slice(0, n) + '\n[...]' : t);
  return [
    ...escolhidos.map((d) => `### ${d.titulo} (atualizado ${d.atualizado || '?'})\n${cortar(d.corpo, MAX_CHARS_POR_DOC)}`),
    ...pesquisas.map((d) => `### ${d.titulo} (você pesquisou em ${d.atualizado})\n${cortar(d.corpo, 1800)}`),
  ].join('\n\n');
}

// ---------- revisão periódica ("a Nutri estuda") ----------
/**
 * Pra cada documento: busca revisões/diretrizes recentes no PubMed e pede pro Gemini revisar SÓ se houver mudança real.
 * @param {object} ia módulo gemini.js (usa ia.revisarConhecimento)
 * @param {string} dia YYYY-MM-DD
 * @param {string[]} [apenas] ids pra restringir
 * @returns {Promise<string[]>} relatório humano, uma linha por documento
 */
export async function atualizarConhecimento({ ia, dia, apenas }) {
  const relatorio = [];
  for (const doc of [...docs.values()]) {
    if (apenas?.length && !apenas.includes(doc.id)) continue;
    if (!doc.consulta_en || doc.foco === 'pesquisa') continue; // pesquisas avulsas não entram na revisão mensal
    try {
      const fontes = await pesquisar({ en: doc.consulta_en, pt: doc.titulo });
      const resposta = await ia.revisarConhecimento({ doc, fontes: formatarFontes(fontes), dia });
      if (!resposta || /^\s*SEM_MUDANCA/i.test(resposta)) {
        relatorio.push(`• ${doc.titulo}: sem novidade relevante (${fontes.length} fontes checadas)`);
        continue;
      }
      const corpo = resposta.trim();
      // Revisão que encolheu demais ou perdeu o título = resposta truncada ou fora das regras: não sobrescreve o documento.
      if (corpo.length < doc.corpo.length * 0.7 || !/^#\s/m.test(corpo)) {
        relatorio.push(`• ${doc.titulo}: revisão descartada (veio com ${corpo.length} chars, original ${doc.corpo.length})`);
        continue;
      }
      const revisado = { ...doc, corpo, versao: (doc.versao || 1) + 1, atualizado: dia, fontesNovas: fontes.slice(0, 10).map((f) => ({ titulo: f.titulo, url: f.url })) };
      await persistir(revisado);
      relatorio.push(`• ${doc.titulo}: ATUALIZADO pra v${revisado.versao} (${fontes.length} fontes)`);
    } catch (e) {
      relatorio.push(`• ${doc.titulo}: falhou (${e.message})`);
    }
  }
  return relatorio;
}
