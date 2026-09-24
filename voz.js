// voz.js - Voz da Nutri: texto -> nota de voz do WhatsApp (ogg/opus), sem custo.
// Síntese pelo serviço de leitura do Microsoft Edge (msedge-tts, não oficial, como o Baileys) e conversão pelo ffmpeg-static.
// Uso: quem ligou `!voz` recebe em áudio a resposta a um áudio que mandou; o resumo do dia também sai em áudio se alguém ligou.

import { spawn } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpegPath from 'ffmpeg-static';

const VOZ = process.env.VOZ_TTS || 'pt-BR-FranciscaNeural'; // feminina, natural; alternativa: pt-BR-ThalitaMultilingualNeural
const MAX_CHARS = Number(process.env.VOZ_MAX_CHARS) || 1100; // ~70 s de fala
const TIMEOUT_MS = 40_000;

/** Tira o que não se fala: asteriscos, [[links]], emojis, cabeçalhos do bloco de refeição viram frases. */
export function textoParaFala(texto) {
  return String(texto || '')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\*+/g, '')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/^\s*[🕐🍽️🔥⚖️💡]\s*/gmu, '')
    .replace(/\bO que (eu )?vi:/gi, 'O que eu vi:')
    .replace(/\((\d)\/10\)/g, 'nota $1')
    .replace(/(\d+(?:[.,]\d+)?)\s*kcal/gi, '$1 calorias')
    .replace(/(\d+(?:[.,]\d+)?)\s*g\b/gi, '$1 gramas')
    .replace(/\b(\d{1,2})h(\d{2})\b/g, '$1 horas e $2')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, MAX_CHARS);
}

async function lerStream(stream) {
  const partes = [];
  for await (const chunk of stream) partes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(partes);
}

function paraOggOpus(entrada) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '40k', '-ar', '48000', '-ac', '1', '-application', 'voip', '-f', 'ogg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const saida = [];
    const erros = [];
    ff.stdout.on('data', (d) => saida.push(d));
    ff.stderr.on('data', (d) => erros.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(saida)) : reject(new Error(`ffmpeg saiu com ${code}: ${Buffer.concat(erros).toString().slice(0, 200)}`))));
    ff.stdin.on('error', () => {});
    ff.stdin.end(entrada);
  });
}

/** Texto -> Buffer ogg/opus pronto pra sock.sendMessage({ audio, ptt: true }). Lança se falhar (quem chama decide se cai pro texto). */
export async function sintetizar(texto) {
  const fala = textoParaFala(texto);
  if (!fala) throw new Error('nada pra falar');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOZ, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
  const r = tts.toStream(fala);
  const stream = r?.audioStream || r;
  const webm = await Promise.race([lerStream(stream), new Promise((_, rej) => setTimeout(() => rej(new Error('TTS demorou demais')), TIMEOUT_MS))]);
  try { tts.close?.(); } catch {}
  if (!webm?.length) throw new Error('TTS devolveu vazio');
  return paraOggOpus(webm);
}
