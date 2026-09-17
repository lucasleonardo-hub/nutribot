// drive.js - "Cérebro" do bot: salva tudo como .md no Google Drive (compatível com Obsidian)
// Estrutura criada automaticamente dentro da pasta raiz (DRIVE_FOLDER_ID):
//   Diario/YYYY-MM-DD.md                 -> daily note: todas as conversas do dia (regerada a partir da memória do dia)
//   Resumos/YYYY-MM-DD.md                -> resumo diário ácido
//   Resumos/Semana-YYYY-Www.md           -> resumo semanal
//   Perfis/Nutri.md                      -> memória de personalidade (reescrita toda noite; histórico no Mongo)
//   Perfis/Nutri-Momentos.md             -> momentos memoráveis (só acrescenta, nunca reescreve)
//   Conhecimento/*.md                    -> base de conhecimento por foco (revisada mensalmente)
//   Conhecimento/Pesquisas/*.md          -> notas de estudo de pesquisas feitas no meio da conversa
//   <Nome da pessoa>/                    -> pasta de cada usuário: docs que ELE deixa + Nutri-Notas.md e Nutri-Ficha.md (pessoas.js)
//   Logs/YYYY-MM-DD.md                   -> log técnico do dia

import { google } from 'googleapis';
import { Readable } from 'node:stream';
import fs from 'node:fs';

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const ROOT_ID = process.env.DRIVE_FOLDER_ID;

let drive;
const cachePastas = new Map(); // "parentId/nome" -> Promise<folderId> (a Promise em andamento também entra, pra duas escritas simultâneas não criarem a pasta duas vezes)

function carregarCredenciais() {
  // Opção 1: conteúdo do JSON direto na variável (bom pro Render)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
    const texto = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(texto);
  }
  // Opção 2: caminho do arquivo (Secret File do Render ou local)
  const caminho = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json';
  if (!fs.existsSync(caminho)) {
    throw new Error(`Service Account não encontrada. Defina GOOGLE_SERVICE_ACCOUNT_JSON ou coloque o arquivo em ${caminho}`);
  }
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

export function iniciarDrive() {
  if (drive) return drive;
  if (!ROOT_ID) throw new Error('DRIVE_FOLDER_ID não definida no .env');
  const auth = new google.auth.GoogleAuth({ credentials: carregarCredenciais(), scopes: SCOPES });
  drive = google.drive({ version: 'v3', auth });
  console.log('[drive] cliente pronto. Pasta raiz:', ROOT_ID);
  return drive;
}

const escapar = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function garantirPasta(nome, parentId = ROOT_ID) {
  const chave = `${parentId}/${nome}`;
  if (cachePastas.has(chave)) return cachePastas.get(chave);
  const promessa = criarOuAcharPasta(nome, parentId).catch((e) => {
    cachePastas.delete(chave); // falhou: próxima chamada tenta de novo
    throw e;
  });
  cachePastas.set(chave, promessa);
  return promessa;
}

async function criarOuAcharPasta(nome, parentId) {
  const { data } = await drive.files.list({
    q: `name = '${escapar(nome)}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  let id = data.files?.[0]?.id;
  if (!id) {
    const res = await drive.files.create({
      requestBody: { name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    });
    id = res.data.id;
  }
  return id;
}

/** Resolve caminho tipo "Diario/2026-09-15" criando as subpastas que faltarem. */
async function resolverCaminho(caminho) {
  let parent = ROOT_ID;
  for (const parte of caminho.split('/').filter(Boolean)) {
    parent = await garantirPasta(parte, parent);
  }
  return parent;
}

async function acharArquivo(nome, parentId) {
  const { data } = await drive.files.list({
    q: `name = '${escapar(nome)}' and '${parentId}' in parents and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return data.files?.[0]?.id || null;
}

/** Salva (ou sobrescreve) um arquivo texto dentro de uma pasta pelo ID dela. */
export async function salvarEmPasta(pastaId, nomeArquivo, conteudo, mimeType = 'text/markdown') {
  iniciarDrive();
  const existente = await acharArquivo(nomeArquivo, pastaId);
  const media = { mimeType, body: Readable.from([conteudo]) };
  if (existente) {
    await drive.files.update({ fileId: existente, media, supportsAllDrives: true });
    return existente;
  }
  const res = await drive.files.create({
    requestBody: { name: nomeArquivo, mimeType, parents: [pastaId] },
    media,
    fields: 'id',
    supportsAllDrives: true,
  });
  return res.data.id;
}

/**
 * Salva (ou sobrescreve) um arquivo .md
 * @param {string} caminhoPasta  ex: "Resumos" ou "Diario/2026-09-15"
 * @param {string} nomeArquivo   ex: "2026-09-15.md"
 * @param {string} conteudo      texto markdown
 */
export async function salvarMarkdown(caminhoPasta, nomeArquivo, conteudo) {
  iniciarDrive();
  const pastaId = await resolverCaminho(caminhoPasta);
  return salvarEmPasta(pastaId, nomeArquivo, conteudo);
}

/** Lista arquivos e subpastas de uma pasta (sem lixeira). */
export async function listarArquivos(pastaId) {
  iniciarDrive();
  const { data } = await drive.files.list({
    q: `'${pastaId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    pageSize: 200,
    orderBy: 'folder,name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return data.files || [];
}

/** Pastas na raiz (DRIVE_FOLDER_ID). */
export async function listarPastasRaiz() {
  return (await listarArquivos(ROOT_ID)).filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
}

/** Cria (ou acha) uma pasta direto na raiz e devolve o ID. */
export async function pastaNaRaiz(nome) {
  iniciarDrive();
  return garantirPasta(nome, ROOT_ID);
}

/**
 * Baixa o conteúdo de um arquivo. Google Docs/Sheets são exportados como texto;
 * texto/markdown vem como string; qualquer outro (PDF, imagem) vem como Buffer.
 */
export async function baixarArquivo(arquivo) {
  iniciarDrive();
  const { id, mimeType } = arquivo;
  if (mimeType === 'application/vnd.google-apps.document' || mimeType === 'application/vnd.google-apps.spreadsheet') {
    const exportMime = mimeType.endsWith('spreadsheet') ? 'text/csv' : 'text/plain';
    const res = await drive.files.export({ fileId: id, mimeType: exportMime }, { responseType: 'text' });
    return { texto: String(res.data) };
  }
  if (mimeType.startsWith('application/vnd.google-apps.')) return { texto: null }; // slides, forms etc.
  const res = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(res.data);
  if (mimeType.startsWith('text/') || /\.(md|txt|csv|json)$/i.test(arquivo.name)) return { texto: buffer.toString('utf8') };
  return { buffer };
}

/** Lê um .md; retorna null se não existir. */
export async function lerMarkdown(caminhoPasta, nomeArquivo) {
  iniciarDrive();
  const pastaId = await resolverCaminho(caminhoPasta);
  const id = await acharArquivo(nomeArquivo, pastaId);
  if (!id) return null;
  const res = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'text' });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

/** Acrescenta uma linha ao log técnico do dia (Logs/YYYY-MM-DD.md). */
export async function registrarLog(dia, linha) {
  try {
    const atual = (await lerMarkdown('Logs', `${dia}.md`)) || `---\ntipo: log\ndata: ${dia}\ntags: [nutribot, log]\n---\n`;
    await salvarMarkdown('Logs', `${dia}.md`, `${atual}\n- ${linha}`);
  } catch (e) {
    console.error('[drive] falha ao registrar log:', e.message);
  }
}

// ---------- Helpers de formatação Obsidian ----------

export function frontmatter(campos) {
  const linhas = Object.entries(campos).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`
  );
  return `---\n${linhas.join('\n')}\n---\n`;
}

/** Daily note do dia: toda a conversa, na ordem, com wikilinks pra cada pessoa (Obsidian). */
export function mdDiario({ dia, mensagens, nomeBot }) {
  const pessoas = [...new Set(mensagens.filter((m) => m.tipo !== 'bot').map((m) => m.nome))];
  const icone = { foto: '📷', audio: '🎤', bot: '', texto: '' };
  const linhas = mensagens.map((m) => {
    const quem = m.tipo === 'bot' ? `**${nomeBot}**` : `[[${m.nome}]]`;
    const marca = m.refeicao ? ` #refeicao/${m.refeicao}` : '';
    return `- **${m.hora}** ${icone[m.tipo] || ''}${quem}:${marca}\n  ${String(m.texto || '').replace(/\n/g, '\n  ')}`;
  });
  return (
    frontmatter({ tipo: 'diario', data: dia, pessoas: pessoas.map((n) => `"[[${n}]]"`), mensagens: mensagens.length, tags: ['nutribot', 'diario'] }) +
    `\n# Diário ${dia}\n\n${linhas.join('\n') || '_(nenhuma conversa ainda)_'}\n\n---\nResumo do dia: [[Resumos/${dia}|${dia}]]\n`
  );
}

/** Uma linha nova no registro de momentos memoráveis (Perfis/Nutri-Momentos.md). */
export function mdMomento(m) {
  return `- ${m.dia} · [[${m.pessoa}]] · #${m.tipo}: ${m.texto}`;
}

export function mdPerfil(p) {
  return (
    frontmatter({ tipo: 'perfil', nome: p.nome, peso_kg: p.peso, altura_cm: p.altura, objetivo: `"${p.objetivo}"`, tags: ['nutribot', 'perfil'] }) +
    `\n# ${p.nome}\n\n- Peso: ${p.peso} kg\n- Altura: ${p.altura} cm\n- Objetivo: [[${p.objetivo}]]\n` +
    `- Gírias aprendidas: ${(p.girias || []).map((g) => `[[${g}]]`).join(', ') || 'nenhuma ainda'}\n` +
    (p.horarios ? `- Horários habituais: ${p.horarios}\n` : '') +
    (p.rotina ? `\n## Rotina observada\n${p.rotina}\n` : '') +
    `- Cadastro: ${p.criadoEm ? new Date(p.criadoEm).toISOString().slice(0, 10) : ''}\n`
  );
}
