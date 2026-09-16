// groq.js - Reserva de emergência quando TODOS os modelos Gemini falham (503 "alta demanda", 429).
// Só texto (sem foto/áudio/PDF). Prompt reduzido pra caber na cota gratuita do Groq (tokens por minuto baixos).
// Não usamos o Groq pra pesquisa web: nos testes o groq/compound inventou URLs de artigos.
// Modelo padrão: qwen/qwen3.8-27b (melhor português/persona entre os disponíveis na chave). Troque em GROQ_MODEL.

const URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELO = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';
const MAX_CHARS_ENTRADA = Number(process.env.GROQ_MAX_CHARS) || 24000; // ~6-7k tokens

export const groqDisponivel = () => Boolean(process.env.GROQ_API_KEY);

/** Corta o meio de um texto longo, preservando começo (data/perfis) e fim (mensagem atual). */
function encurtar(texto, max = MAX_CHARS_ENTRADA) {
  if (texto.length <= max) return texto;
  const cabeca = Math.floor(max * 0.35);
  const cauda = max - cabeca;
  return `${texto.slice(0, cabeca)}\n\n[... contexto cortado por limite do modelo reserva ...]\n\n${texto.slice(-cauda)}`;
}

/**
 * Gera texto no Groq a partir do mesmo material que iria pro Gemini.
 * @param {object} p
 * @param {string} p.system      system prompt
 * @param {string} p.usuario     conteúdo do usuário (já em texto)
 * @param {boolean} [p.json]     pedir JSON
 * @param {number} [p.maxTokens]
 * @param {number} [p.temperature]
 */
export async function gerarGroq({ system, usuario, json = false, maxTokens = 1024, temperature = 0.9 }) {
  if (!groqDisponivel()) throw new Error('GROQ_API_KEY não definida');
  const body = {
    model: MODELO,
    messages: [
      { role: 'system', content: `${system || ''}\n\nFORMATO: WhatsApp. Negrito com UM asterisco (*assim*), nunca dois. Sem cabeçalhos markdown (#). Sem tabelas.${json ? ' Responda SOMENTE com JSON válido.' : ''}` },
      { role: 'user', content: encurtar(usuario) },
    ],
    max_tokens: maxTokens,
    temperature,
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`);
  const texto = data.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error('Groq respondeu vazio');
  return texto.replace(/<think>[\s\S]*?<\/think>\s*/g, ''); // Qwen às vezes devolve raciocínio
}
