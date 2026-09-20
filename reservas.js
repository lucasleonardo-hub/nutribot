// reservas.js - Provedores de IA reserva, usados SÓ quando todos os modelos Gemini falham (503 "alta demanda", 429).
// Todos falam o formato OpenAI (chat/completions). Ordem = prioridade. Cada um tem uma chave opcional no .env;
// sem a chave, o provedor é simplesmente pulado.
//
//   TEXTO : Cohere (command-a, o mais estável) -> Groq (qwen/qwen3.8-27b, rápido) -> Hugging Face (Qwen2.5-72B)
//   FOTO  : Cohere (command-a-vision) -> Hugging Face (gemma-3-27b-it) -> Hugging Face (Qwen3-VL-30B)
//   ÁUDIO / PDF: só o Gemini faz. Sem reserva.
//
// Limites gratuitos (set/2026): Groq ~6-30k tokens/min; Hugging Face crédito mensal pequeno (402 quando acaba);
// Cohere trial ~1.000 chamadas/mês, 20/min. Por isso o prompt é encurtado e cada provedor tenta uma vez.

const MAX_CHARS_ENTRADA = Number(process.env.RESERVA_MAX_CHARS) || 24000; // ~6-7k tokens (HF, Cohere)
const MAX_CHARS_GROQ = Number(process.env.RESERVA_MAX_CHARS_GROQ) || 12000; // Groq on_demand devolve 413 acima de ~6k tokens por pedido

const PROVEDORES = [
  // Ordem = o que respondeu de fato nos logs: Cohere estável; Groq rápido mas recusa prompt grande (413) e estoura por minuto;
  // Hugging Face lento (timeouts de 60 s) e com crédito curto.
  {
    id: 'cohere',
    url: 'https://api.cohere.com/v2/chat',
    chave: () => process.env.COHERE_API_KEY,
    texto: process.env.COHERE_MODEL || 'command-a-03-2025',
    visao: process.env.COHERE_MODEL_VISAO || 'command-a-vision-07-2025',
    timeoutMs: 60_000,
  },
  {
    id: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    chave: () => process.env.GROQ_API_KEY,
    texto: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
    visao: null,
    maxChars: MAX_CHARS_GROQ,
    timeoutMs: 45_000,
  },
  {
    id: 'huggingface',
    url: 'https://router.huggingface.co/v1/chat/completions',
    chave: () => process.env.HF_API_KEY,
    texto: process.env.HF_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
    visao: process.env.HF_MODEL_VISAO || 'google/gemma-3-27b-it',
    timeoutMs: 40_000,
  },
  {
    id: 'huggingface-2',
    url: 'https://router.huggingface.co/v1/chat/completions',
    chave: () => process.env.HF_API_KEY,
    texto: null,
    visao: process.env.HF_MODEL_VISAO_2 || 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    timeoutMs: 40_000,
  },
];

export const reservasDisponiveis = () => PROVEDORES.filter((p) => p.chave()).map((p) => p.id);

/** Corta o meio de um texto longo, preservando começo (data/perfis) e fim (mensagem atual). */
function encurtar(texto, max = MAX_CHARS_ENTRADA) {
  if (texto.length <= max) return texto;
  const cabeca = Math.floor(max * 0.35);
  return `${texto.slice(0, cabeca)}\n\n[... contexto cortado por limite do modelo reserva ...]\n\n${texto.slice(-(max - cabeca))}`;
}

function extrairTexto(data) {
  // OpenAI-like (Groq, HF) ou Cohere v2
  const t = data?.choices?.[0]?.message?.content ?? data?.message?.content?.map?.((c) => c.text).join('\n');
  return typeof t === 'string' ? t.trim().replace(/<think>[\s\S]*?<\/think>\s*/g, '') : '';
}

/**
 * Gera com o primeiro provedor reserva que responder.
 * @param {object} p
 * @param {string}  p.system       system prompt
 * @param {string}  p.usuario      texto do usuário (contexto completo já montado)
 * @param {Array<{mimeType:string,data:string}>} [p.imagens]  imagens em base64 (só as de image/*)
 * @param {boolean} [p.json]
 * @param {number}  [p.maxTokens]
 * @param {number}  [p.temperature]
 */
export async function gerarReserva({ system, usuario, imagens = [], json = false, maxTokens = 1024, temperature = 0.9 }) {
  const precisaVisao = imagens.length > 0;
  const candidatos = PROVEDORES.filter((p) => p.chave() && (precisaVisao ? p.visao : p.texto));
  if (!candidatos.length) throw new Error(`nenhum provedor reserva disponível para ${precisaVisao ? 'imagem' : 'texto'}`);

  const systemFinal = `${system || ''}\n\nFORMATO: WhatsApp. Negrito com UM asterisco (*assim*), nunca dois. Sem cabeçalhos markdown (#). Sem tabelas.${json ? ' Responda SOMENTE com JSON válido.' : ''}`;

  let ultimoErro;
  for (const prov of candidatos) {
    const model = precisaVisao ? prov.visao : prov.texto;
    const texto = encurtar(usuario, prov.maxChars || MAX_CHARS_ENTRADA);
    const conteudoUsuario = precisaVisao
      ? [{ type: 'text', text: texto }, ...imagens.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mimeType};base64,${im.data}` } }))]
      : texto;
    const body = {
      model,
      messages: [
        { role: 'system', content: systemFinal },
        { role: 'user', content: conteudoUsuario },
      ],
      max_tokens: Math.min(maxTokens, 2048),
      temperature,
    };
    if (json && prov.id !== 'cohere') body.response_format = { type: 'json_object' };
    try {
      const res = await fetch(prov.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${prov.chave()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(precisaVisao ? Math.max(prov.timeoutMs || 60_000, 90_000) : prov.timeoutMs || 60_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error?.message || data?.message || JSON.stringify(data).slice(0, 160)}`);
      const texto = extrairTexto(data);
      if (!texto) throw new Error('resposta vazia');
      console.warn(`[reserva] respondido por ${prov.id} (${model})`);
      return texto;
    } catch (e) {
      ultimoErro = e;
      console.warn(`[reserva] ${prov.id} (${model}) falhou: ${String(e.message).slice(0, 160)}`);
    }
  }
  throw ultimoErro;
}
