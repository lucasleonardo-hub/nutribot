// voz.js - Voz da Nutri: texto -> nota de voz do WhatsApp (ogg/opus), sem custo.
// Motor principal: TTS do Gemini (gemini-3.8-flash-lite-tts / gemini-3.8-flash-tts), que aceita uma instrução de estilo em
// linguagem natural e fala português brasileiro com entonação de conversa: é o que deixa a voz no personagem (jovem, calorosa,
// bem-humorada) em vez de locutora. Usa as mesmas chaves gratuitas do Gemini, em rodízio; cota estourada ou alta demanda numa
// chave passa pra próxima. Reserva: o serviço de leitura do Microsoft Edge (msedge-tts), que era o motor antigo.
// Conversão pro formato do WhatsApp pelo ffmpeg-static.

import { spawn } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import ffmpegPath from 'ffmpeg-static';

const MAX_CHARS = Number(process.env.VOZ_MAX_CHARS) || 1100; // ~70 s de fala
const MOTOR = (process.env.VOZ_MOTOR || 'gemini').toLowerCase(); // gemini | edge

// ---- Gemini TTS
const CHAVES = [...new Set([process.env.GEMINI_API_KEY, ...String(process.env.GEMINI_API_KEYS || '').split(',')].map((k) => (k || '').trim()).filter(Boolean))];
const MODELOS_TTS = (process.env.VOZ_GEMINI_MODELOS || 'gemini-3.8-flash-lite-tts,gemini-3.8-flash-tts').split(',').map((m) => m.trim()).filter(Boolean);
const VOZ_GEMINI = process.env.VOZ_GEMINI_VOZ || 'Sulafat'; // "warm"; outras que combinam: Leda (jovem), Aoede (leve), Zephyr (viva), Laomedeia (animada)
// Estilo no formato que o Google documenta pro TTS ("Diga com voz X: <texto>"), curto e SEM meta-instrução: um parágrafo
// longo terminando em "não leia estas instruções em voz alta" foi lido em voz alta na nota de segunda 28/09.
const ESTILO_PADRAO = 'Diga com voz jovem, calorosa e bem-humorada, sotaque brasileiro natural, ritmo de áudio de WhatsApp entre amigas, com leve ironia carinhosa, sem tom de locutora:';
const ESTILO = process.env.VOZ_ESTILO || ESTILO_PADRAO;
const CONFERIR = !/^(off|false|0|n[ãa]o)$/i.test(process.env.VOZ_CONFERIR || 'on'); // transcreve e checa se a instrução vazou
const TIMEOUT_GEMINI_MS = Number(process.env.VOZ_TIMEOUT_MS) || 50_000; // o TTS é lento (10 a 40 s por áudio)
const ORCAMENTO_MS = 110_000; // tempo total que aceitamos gastar em tentativas antes de cair pro Edge
const castigoAte = new Map(); // "chave:modelo" -> timestamp (cota estourada / alta demanda, não insiste por um tempo)
let proximaChave = 0;

// ---- Edge TTS (reserva)
const VOZ_EDGE = process.env.VOZ_TTS || 'pt-BR-FranciscaNeural'; // alternativa: pt-BR-ThalitaMultilingualNeural
const TIMEOUT_EDGE_MS = 40_000;

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

/** Prompt do TTS no formato documentado: "Diga com voz X:" e, depois de uma linha em branco, só o texto a falar. */
export function promptDeVoz(fala, estilo = ESTILO) {
  const e = estilo.trim().replace(/[.\s]+$/, '');
  return `${e}${e.endsWith(':') ? '' : ':'}\n\n${fala}`;
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * A transcrição do áudio deve conter só a fala. Vazou se aparecer palavra do ESTILO que não está na fala
 * ("calorosa", "sotaque", "locutora", "instruções"...) ou se a transcrição for bem maior que o texto pedido.
 * Puro: (transcricao, fala, estilo) -> { vazou, motivo }.
 */
export function vazouInstrucao(transcricao, fala, estilo = ESTILO) {
  const t = semAcento(transcricao);
  const f = semAcento(fala);
  const marcadores = [...new Set([...semAcento(estilo).split(/[^a-z0-9-]+/).filter((w) => w.length >= 6), 'instrucoes', 'instrucao', 'voz alta', 'diga com voz', 'exatamente isto'])].filter((w) => !f.includes(w));
  const achado = marcadores.find((w) => t.includes(w));
  if (achado) return { vazou: true, motivo: `transcrição contém "${achado}"` };
  if (t.length > f.length * 1.35 + 80) return { vazou: true, motivo: `transcrição ${t.length} chars para uma fala de ${f.length}` };
  return { vazou: false, motivo: '' };
}

/** Transcreve o WAV com o modelo leve e confere se a instrução vazou. Falha na conferência = { vazou: null } (quem chama não aceita o áudio às cegas). */
async function conferirFala(wav, fala, ci) {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': CHAVES[ci], 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }, { text: 'Transcreva este áudio na íntegra, só o que é falado, sem comentários.' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1200 },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status !== 200) return { vazou: null, motivo: `conferência HTTP ${r.status}` };
    const transcricao = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    if (!transcricao.trim()) return { vazou: null, motivo: 'conferência vazia' };
    return vazouInstrucao(transcricao, fala);
  } catch (e) {
    return { vazou: null, motivo: `conferência falhou: ${String(e.message).slice(0, 60)}` };
  }
}

/** PCM 16 bits mono -> WAV (o ffmpeg precisa de cabeçalho ou de formato explícito; cabeçalho é mais simples). */
export function wavDePcm(pcm, taxa = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(taxa, 24);
  h.writeUInt32LE(taxa * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
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

// ============================================================
// Gemini TTS
// ============================================================
const chaveCastigo = (ci, modelo) => `${ci}:${modelo}`;
const emCastigo = (ci, modelo) => (castigoAte.get(chaveCastigo(ci, modelo)) || 0) > Date.now();

function castigar(ci, modelo, status) {
  const min = status === 429 ? 30 : 3; // cota do dia/minuto estourada: meia hora; alta demanda ou tempo esgotado: 3 min
  castigoAte.set(chaveCastigo(ci, modelo), Date.now() + min * 60_000);
}

/** Uma tentativa: chave ci, modelo. Devolve WAV (Buffer). Lança com .status quando a API recusa. */
async function geminiTtsUmaVez(ci, modelo, fala, { voz, estilo }) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': CHAVES[ci], 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptDeVoz(fala, estilo) }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_GEMINI_MS),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status !== 200) {
    const e = new Error(`${r.status} ${String(d?.error?.message || '').slice(0, 120)}`);
    e.status = r.status;
    throw e;
  }
  const parte = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!parte) throw new Error(`sem áudio na resposta (${d.candidates?.[0]?.finishReason || d.promptFeedback?.blockReason || '?'})`);
  const mime = String(parte.inlineData.mimeType || '');
  const bytes = Buffer.from(parte.inlineData.data, 'base64');
  if (/wav/i.test(mime)) return bytes;
  return wavDePcm(bytes, Number(mime.match(/rate=(\d+)/)?.[1]) || 24000);
}

/** Roda chaves x modelos até uma responder, dentro do orçamento de tempo. Lança se nenhuma servir. */
export async function sintetizarGemini(fala, { voz = VOZ_GEMINI, estilo = ESTILO } = {}) {
  if (!CHAVES.length) throw new Error('sem chave do Gemini');
  const inicio = Date.now();
  const erros = [];
  for (const modelo of MODELOS_TTS) {
    for (let n = 0; n < CHAVES.length; n++) {
      const ci = (proximaChave + n) % CHAVES.length;
      if (emCastigo(ci, modelo)) continue;
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      try {
        const wav = await geminiTtsUmaVez(ci, modelo, fala, { voz, estilo });
        proximaChave = (ci + 1) % CHAVES.length; // espalha a cota entre as chaves
        // o modelo às vezes lê a instrução de estilo junto: transcreve e confere antes de mandar pro grupo
        if (CONFERIR) {
          let c = await conferirFala(wav, fala, ci);
          // conferência indisponível nesta chave (503, cota): tenta com as outras antes de desistir
          for (let k = 1; k < CHAVES.length && c.vazou === null; k++) c = await conferirFala(wav, fala, (ci + k) % CHAVES.length);
          if (c.vazou === null) {
            // sem conferência não arrisco: em 02/10 18:02 a instrução de estilo foi lida em voz alta porque a conferência falhou e o áudio passou
            console.warn(`[voz] áudio sem conferência (${modelo}, chave ${ci + 1}): ${c.motivo}; não mando sem conferir`);
            erros.push(`chave ${ci + 1}/${modelo}: sem conferência (${c.motivo})`);
            continue;
          }
          if (c.vazou) {
            console.warn(`[voz] áudio descartado (${modelo}, chave ${ci + 1}): ${c.motivo}; tentando de novo`);
            erros.push(`chave ${ci + 1}/${modelo}: instrução vazou (${c.motivo})`);
            continue; // próxima chave/modelo; se todas vazarem, cai pro Edge, que nunca lê instrução
          }
        }
        console.log(`[voz] gemini ${modelo} voz ${voz} chave ${ci + 1} em ${Date.now() - inicio} ms`);
        return wav;
      } catch (e) {
        erros.push(`chave ${ci + 1}/${modelo}: ${e.message}`);
        if (e.status === 429 || e.status === 503 || e.name === 'TimeoutError') castigar(ci, modelo, e.status);
        else if (e.status && e.status !== 500) break; // 400/403/404: erro nosso ou do modelo, não é a chave
      }
    }
  }
  throw new Error(`Gemini TTS falhou: ${erros.join(' | ') || 'todas as chaves de castigo'}`);
}

// ============================================================
// Edge TTS (reserva)
// ============================================================
export async function sintetizarEdge(fala) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOZ_EDGE, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
  const r = tts.toStream(fala);
  const stream = r?.audioStream || r;
  const webm = await Promise.race([lerStream(stream), new Promise((_, rej) => setTimeout(() => rej(new Error('TTS demorou demais')), TIMEOUT_EDGE_MS))]);
  try { tts.close?.(); } catch {}
  if (!webm?.length) throw new Error('TTS devolveu vazio');
  return webm;
}

// ============================================================
// Entrada única
// ============================================================
/** Texto -> Buffer ogg/opus pronto pra sock.sendMessage({ audio, ptt: true }). Lança se falhar (quem chama decide se cai pro texto). */
export async function sintetizar(texto, opcoes = {}) {
  const fala = textoParaFala(texto);
  if (!fala) throw new Error('nada pra falar');
  if (MOTOR !== 'edge' && CHAVES.length) {
    try {
      return await paraOggOpus(await sintetizarGemini(fala, opcoes));
    } catch (e) {
      console.warn('[voz] caindo pro Edge:', e.message.slice(0, 300));
    }
  }
  const webm = await sintetizarEdge(fala);
  console.log(`[voz] edge ${VOZ_EDGE}`);
  return paraOggOpus(webm);
}

/** Pra !status: motor, voz e modelos em uso. */
export const situacaoVoz = () => ({ motor: MOTOR !== 'edge' && CHAVES.length ? 'gemini' : 'edge', voz: MOTOR !== 'edge' && CHAVES.length ? VOZ_GEMINI : VOZ_EDGE, modelos: MODELOS_TTS, chaves: CHAVES.length });
