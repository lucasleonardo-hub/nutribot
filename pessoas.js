// pessoas.js - "Cérebro" de cada pessoa no Drive.
// Na raiz do Drive existe uma pasta com o nome de cada usuário (ex.: "Lucas Leonardo Alves da Silveira Vitória", "Heitor Salvalágio").
// - O que a PESSOA coloca lá (PDF, Google Docs, .md, .txt) a Nutri lê e usa como memória sobre ela.
// - O que a NUTRI aprende vai pra arquivos "Nutri-*.md" na mesma pasta (Nutri-Notas.md, Nutri-Ficha.md).
// Textos extraídos ficam em cache no Mongo (collection arquivos_pessoa) por id+modifiedTime, então o PDF só é transcrito uma vez.

import { colecao, salvarPerfil } from './mongo.js';
import { listarPastasRaiz, listarArquivos, baixarArquivo, pastaNaRaiz, salvarEmPasta } from './drive.js';
import * as ia from './gemini.js';

const PASTAS_SISTEMA = new Set(['conhecimento', 'logs', 'diario', 'resumos', 'perfis']);
const CACHE_LISTA_MS = 10 * 60_000; // relista a pasta no máximo a cada 10 min
const MAX_CHARS_DOSSIE = Number(process.env.DOSSIE_MAX_CHARS) || 14000;
const MAX_CHARS_NOTAS = 4000;
const ARQ_NOTAS = 'Nutri-Notas.md';
const ARQ_FICHA = 'Nutri-Ficha.md';

const normalizar = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((x) => x && !['de', 'da', 'do', 'dos', 'das', 'e'].includes(x));

const cache = new Map(); // nome -> { pastaId, pastaNome, arquivos, textos: Map, notas, listadoEm }

function estado(perfil) {
  const chave = perfil.nome;
  if (!cache.has(chave)) cache.set(chave, { pastaId: perfil.pastaId || null, pastaNome: null, arquivos: [], textos: new Map(), notas: perfil.notas || '', listadoEm: 0 });
  return cache.get(chave);
}

/** Acha a pasta da pessoa na raiz pelo nome (tolerante a nome completo x apelido). Cria se não existir. */
export async function pastaDe(perfil) {
  const st = estado(perfil);
  if (st.pastaId) return st.pastaId;

  const pastas = (await listarPastasRaiz()).filter((p) => !PASTAS_SISTEMA.has(normalizar(p.name).join(' ')));
  const alvo = normalizar(perfil.nome);
  // Precisa bater o primeiro nome E (se o nome tiver sobrenome) pelo menos mais uma parte; empate = não escolhe (cria nova).
  // Evita duas pessoas com o mesmo primeiro nome caírem na mesma pasta. O ID da pasta fica gravado no perfil e vale dali em diante.
  const minimo = Math.min(2, alvo.length);
  let melhor = null;
  let melhorPontos = 0;
  let empate = false;
  for (const p of pastas) {
    const tokens = normalizar(p.name);
    if (!alvo.length || tokens[0] !== alvo[0]) continue; // primeiro nome tem que bater
    const pontos = alvo.filter((t) => tokens.includes(t)).length;
    const pastaInteiraBate = tokens.every((t) => alvo.includes(t)); // pasta "Heitor" pra "Heitor Almeida": vale
    if (pontos < minimo && !pastaInteiraBate) continue;
    if (pontos > melhorPontos) {
      melhor = p;
      melhorPontos = pontos;
      empate = false;
    } else if (pontos === melhorPontos) empate = true;
  }
  if (empate) {
    console.warn(`[pessoas] mais de uma pasta parecida com "${perfil.nome}"; criando uma própria pra não misturar`);
    melhor = null;
  }
  if (!melhor) {
    const id = await pastaNaRaiz(perfil.nome);
    melhor = { id, name: perfil.nome };
    console.log(`[pessoas] pasta criada no Drive para ${perfil.nome}`);
  } else {
    console.log(`[pessoas] ${perfil.nome} -> pasta "${melhor.name}"`);
  }
  st.pastaId = melhor.id;
  st.pastaNome = melhor.name;
  if (perfil.jids) await salvarPerfil({ jids: perfil.jids, pastaId: melhor.id, pastaNome: melhor.name }).catch(() => {});
  return st.pastaId;
}

async function textoDoArquivo(arq) {
  const col = colecao('arquivos_pessoa');
  const chave = `${arq.id}:${arq.modifiedTime}`;
  const emCache = await col.findOne({ _id: chave });
  if (emCache) return emCache.texto;

  let texto = null;
  try {
    const { texto: t, buffer } = await baixarArquivo(arq);
    if (t != null) texto = t;
    else if (buffer && arq.mimeType === 'application/pdf') {
      console.log(`[pessoas] transcrevendo PDF "${arq.name}" (${Math.round(buffer.length / 1024)} KB) com o Gemini...`);
      texto = await ia.transcreverPdf(buffer);
    } else if (buffer && arq.mimeType.startsWith('image/')) {
      texto = await ia.descreverImagemDocumento(buffer, arq.mimeType);
    }
  } catch (e) {
    console.error(`[pessoas] falha ao ler "${arq.name}":`, e.message);
    // Documento longo demais pro limite de saída: guarda o que veio, com aviso, em vez de tentar de novo a cada 10 min
    if (!e.cortada || !e.parcial) return null;
    texto = `${e.parcial}

[... documento longo: transcrição cortada aqui ...]`;
  }
  if (texto) {
    await col.replaceOne({ _id: chave }, { _id: chave, arquivoId: arq.id, nome: arq.name, texto, salvoEm: new Date() }, { upsert: true });
    await col.deleteMany({ arquivoId: arq.id, _id: { $ne: chave } }); // versões antigas do mesmo arquivo
  }
  return texto;
}

/** Relê a pasta (com cache de 10 min) e carrega os textos dos documentos que a pessoa deixou. */
async function sincronizar(perfil, { forcar = false } = {}) {
  const st = estado(perfil);
  if (!forcar && Date.now() - st.listadoEm < CACHE_LISTA_MS) return st;
  const pastaId = await pastaDe(perfil);
  const arquivos = (await listarArquivos(pastaId)).filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
  st.arquivos = arquivos;
  st.listadoEm = Date.now();

  for (const arq of arquivos) {
    if (arq.name === ARQ_NOTAS) {
      const t = await textoDoArquivo(arq);
      if (t != null) st.notas = t.replace(/^---[\s\S]*?---\n/, '').trim();
      continue;
    }
    if (arq.name.startsWith('Nutri-')) continue; // coisas dela mesma (ficha), não entram no dossiê
    const chave = `${arq.id}:${arq.modifiedTime}`;
    if (!st.textos.has(chave)) {
      const t = await textoDoArquivo(arq);
      st.textos.set(chave, { nome: arq.name, texto: t });
    }
  }
  // limpa textos de arquivos que sumiram/mudaram
  const validas = new Set(arquivos.map((a) => `${a.id}:${a.modifiedTime}`));
  for (const k of [...st.textos.keys()]) if (!validas.has(k)) st.textos.delete(k);
  return st;
}

/** Tudo que a Nutri sabe sobre a pessoa: documentos da pasta + notas dela. Pronto pra entrar no prompt. */
export async function dossieDe(perfil) {
  const st = await sincronizar(perfil);
  const partes = [];
  let usados = 0;
  for (const { nome, texto } of st.textos.values()) {
    if (!texto) continue;
    const restante = MAX_CHARS_DOSSIE - usados;
    if (restante <= 500) break;
    const corte = texto.length > restante ? texto.slice(0, restante) + '\n[...]' : texto;
    partes.push(`--- Documento "${nome}" (deixado pela própria pessoa na pasta dela) ---\n${corte}`);
    usados += corte.length;
  }
  if (st.notas) partes.push(`--- Suas notas sobre ${perfil.nome} (${ARQ_NOTAS}) ---\n${st.notas.slice(0, MAX_CHARS_NOTAS)}`);
  return partes.join('\n\n');
}

export async function notasDe(perfil) {
  const st = await sincronizar(perfil);
  return st.notas || '';
}

export async function listarDocumentosDe(perfil) {
  const st = await sincronizar(perfil, { forcar: true });
  return st.arquivos.map((a) => ({ nome: a.name, tipo: a.mimeType.replace('application/vnd.google-apps.', 'google-'), daNutri: a.name.startsWith('Nutri-'), lido: a.name.startsWith('Nutri-') || [...st.textos.values()].some((t) => t.nome === a.name && t.texto) }));
}

/** Notas da Nutri sobre a pessoa (reescritas no fechamento do dia). Vai pro Drive e pro Mongo. */
export async function salvarNotas(perfil, texto, dia) {
  const st = estado(perfil);
  const pastaId = await pastaDe(perfil);
  st.notas = texto.trim();
  const md = `---\ntipo: notas-nutri\npessoa: ${perfil.nome}\natualizado: ${dia}\ntags: [nutribot, pessoa, notas]\n---\n\n# O que a Nutri sabe sobre ${perfil.nome}\n\n${st.notas}\n`;
  await salvarEmPasta(pastaId, ARQ_NOTAS, md);
  if (perfil.jids) await salvarPerfil({ jids: perfil.jids, notas: st.notas }).catch(() => {});
}

/** Ficha (peso, altura, objetivo, gírias, horários, rotina) na pasta da pessoa. */
export async function salvarFicha(perfil, md) {
  const pastaId = await pastaDe(perfil);
  await salvarEmPasta(pastaId, ARQ_FICHA, md);
}
