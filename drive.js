// drive.js - "Cérebro" do bot: salva tudo como .md no Google Drive (compatível com Obsidian)
// Estrutura criada automaticamente dentro da pasta raiz (DRIVE_FOLDER_ID):
//   Diario/YYYY-MM-DD/HH-mm-ss-nome.md   -> cada interação
//   Resumos/YYYY-MM-DD.md                -> resumo diário ácido
//   Resumos/Semana-YYYY-Www.md           -> resumo semanal
//   Perfis/Nome.md                       -> ficha de cada pessoa
//   Logs/YYYY-MM-DD.md                   -> log técnico do dia

import { google } from 'googleapis';
import { Readable } from 'node:stream';
import fs from 'node:fs';

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const ROOT_ID = process.env.DRIVE_FOLDER_ID;

let drive;
const cachePastas = new Map(); // "parentId/nome" -> folderId

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

async function garantirPasta(nome, parentId = ROOT_ID) {
  const chave = `${parentId}/${nome}`;
  if (cachePastas.has(chave)) return cachePastas.get(chave);

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
  cachePastas.set(chave, id);
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

/**
 * Salva (ou sobrescreve) um arquivo .md
 * @param {string} caminhoPasta  ex: "Resumos" ou "Diario/2026-09-15"
 * @param {string} nomeArquivo   ex: "2026-09-15.md"
 * @param {string} conteudo      texto markdown
 */
export async function salvarMarkdown(caminhoPasta, nomeArquivo, conteudo) {
  iniciarDrive();
  const pastaId = await resolverCaminho(caminhoPasta);
  const existente = await acharArquivo(nomeArquivo, pastaId);
  const media = { mimeType: 'text/markdown', body: Readable.from([conteudo]) };

  if (existente) {
    await drive.files.update({ fileId: existente, media, supportsAllDrives: true });
    return existente;
  }
  const res = await drive.files.create({
    requestBody: { name: nomeArquivo, mimeType: 'text/markdown', parents: [pastaId] },
    media,
    fields: 'id',
    supportsAllDrives: true,
  });
  return res.data.id;
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

export function mdInteracao({ dia, hora, nome, tipo, entrada, resposta }) {
  return (
    frontmatter({ tipo, data: dia, hora, usuario: `"[[${nome}]]"`, tags: ['nutribot', tipo] }) +
    `\n# ${hora} · [[${nome}]] · ${tipo}\n\n` +
    `## Entrada\n${entrada}\n\n` +
    `## Veredito da Nutri\n${resposta}\n\n` +
    `---\nDia: [[${dia}]]\n`
  );
}

export function mdPerfil(p) {
  return (
    frontmatter({ tipo: 'perfil', nome: p.nome, peso_kg: p.peso, altura_cm: p.altura, objetivo: `"${p.objetivo}"`, tags: ['nutribot', 'perfil'] }) +
    `\n# ${p.nome}\n\n- Peso: ${p.peso} kg\n- Altura: ${p.altura} cm\n- Objetivo: [[${p.objetivo}]]\n` +
    `- Gírias aprendidas: ${(p.girias || []).map((g) => `[[${g}]]`).join(', ') || 'nenhuma ainda'}\n` +
    `- Cadastro: ${p.criadoEm ? new Date(p.criadoEm).toISOString().slice(0, 10) : ''}\n`
  );
}
