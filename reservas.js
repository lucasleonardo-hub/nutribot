// reservas.js - Provedores de IA reserva, usados SÓ quando todos os modelos Gemini falham (503 "alta demanda", 429).
// Todos falam o formato OpenAI (chat/completions). Ordem = prioridade. Cada um tem uma chave opcional no .env;
// sem a chave, o provedor é simplesmente pulado.
//
//   TEXTO : Cohere (command-a, o mais estável) -> OpenRouter (Nemotron 3 Super 120B, grátis) -> Groq (qwen/qwen3.8-27b)
//           -> Hugging Face (Qwen2.5-72B)
//   FOTO  : Cohere (command-a-vision) -> Hugging Face (gemma-3-27b-it) -> Hugging Face (Qwen3-VL-30B) -> OpenRouter (Qwen3.8-27B)
//   OpenRouter gratuito: 50 pedidos/dia no total e os modelos ":free" vivem saturados (429 "rate-limited upstream"),
//   principalmente os de visão — por isso é reserva da reserva, nunca principal. O "openrouter/free" (roteador automático)
//   NÃO serve: nos testes caiu num modelo de moderação que responde "User Safety: safe". Sempre modelo nomeado.
//   Os modelos da NVIDIA raciocinam em inglês dentro da resposta; por isso o pedido vai com reasoning desligado.
//   ÁUDIO / PDF: só o Gemini faz. Sem reserva.
//
// Limites gratuitos (set/2026): Groq ~6-30k tokens/min; Hugging Face crédito mensal pequeno (402 quando acaba);
// Cohere trial ~1.000 chamadas/mês, 20/min. Por isso o prompt é encurtado e cada provedor tenta uma vez.

const MAX_CHARS_ENTRADA = Number(process.env.RESERVA_MAX_CHARS) || 24000; // ~6-7k tokens (HF, Cohere)
const MAX_CHARS_GROQ = Number(process.env.RESERVA_MAX_CHARS_GROQ) || 12000; // Groq on_demand devolve 413 acima de ~6k tokens por pedido

// OpenRouter pede esses cabeçalhos pra identificar o app (aparece no painel deles; sem eles funciona, mas fica anônimo)
const OPENROUTER_HEADERS = { 'HTTP-Referer': process.env.REPO_URL || 'https://github.com/lucasleonardo-hub/nutribot', 'X-Title': process.env.BOT_NOME || 'NutriBot' };

const PROVEDORES = [
  // Ordem = o que respondeu de fato nos logs: Cohere estável; Groq rápido mas recusa prompt grande (413) e estoura por minuto;
  // Hugging Face lento (timeouts de 60 s) e com crédito curto.
  {
    id: 'cohere',
    url: 'https://api.cohere.com/v2/chat',
    chave: () => process.env.COHERE_API_KEY,
    texto: process.env.COHERE_MODEL || 'command-a-03-2025',
    visao: process.env.COHERE_MODEL_VISAO || 'command-a-vision-07-2025',
    timeoutMs: 45_000,
  },
  {
    id: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    chave: () => process.env.OPENROUTER_API_KEY,
    texto: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free',
    visao: null, // a visão dele fica por último (openrouter-visao), porque os modelos de foto grátis quase sempre dão 429
    timeoutMs: 60_000, // a fila gratuita do OpenRouter às vezes leva 45 s pra responder
    headers: OPENROUTER_HEADERS,
    extra: { reasoning: { enabled: false } },
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
  {
    id: 'openrouter-visao',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    chave: () => process.env.OPENROUTER_API_KEY,
    texto: null,
    visao: process.env.OPENROUTER_MODEL_VISAO || 'qwen/qwen3.8-27b:free',
    timeoutMs: 60_000, // a fila gratuita do OpenRouter às vezes leva 45 s pra responder
    headers: OPENROUTER_HEADERS,
    extra: { reasoning: { enabled: false } },
  },
];

export const reservasDisponiveis = () => PROVEDORES.filter((p) => p.chave()).map((p) => p.id);

// Qual reserva respondeu por último (pro !status e pro aviso do admin dizerem o nome certo)
let ultimaReserva = null;
export const ultimaReservaUsada = () => ultimaReserva;

/** Corta o meio de um texto longo, preservando começo (data/perfis) e fim (mensagem atual). */
function encurtar(texto, max = MAX_CHARS_ENTRADA) {
  if (texto.length <= max) return texto;
  const cabeca = Math.floor(max * 0.35);
  return `${texto.slice(0, cabeca)}\n\n[... contexto cortado por limite do modelo reserva ...]\n\n${texto.slice(-(max - cabeca))}`;
}

function extrairTexto(data, nomePersonagem = 'Nutri') {
  // OpenAI-like (Groq, HF) ou Cohere v2
  const t = data?.choices?.[0]?.message?.content ?? data?.message?.content?.map?.((c) => c.text).join('\n');
  if (typeof t !== 'string') return '';
  const semThink = t.trim().replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  // a deixa "Nome:" às vezes volta no começo da resposta
  const esc = nomePersonagem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return semThink.replace(new RegExp(`^\\s*\\*?(?:${esc}|Nutri)\\*?\\s*:\\s*`, 'i'), '').trim();
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

  const systemFinal =
    `${system || ''}\n\nVOCÊ É A PERSONAGEM descrita acima e está respondendo dentro do grupo. Nunca fale dela em terceira pessoa nem responda como se fosse outra pessoa do grupo. ` +
    `O texto do usuário traz o contexto (base de conhecimento, perfis, histórico com o nome de quem falou em cada linha) e termina na MENSAGEM ATUAL: responda a ela, em primeira pessoa, direto pra quem mandou.` +
    `\n\nFORMATO: WhatsApp. Negrito com UM asterisco (*assim*), nunca dois. Sem cabeçalhos markdown (#). Sem tabelas.${json ? ' Responda SOMENTE com JSON válido.' : ''}`;
  const nomePersonagem = (String(system || '').match(/te batizou de "([^"]+)"/) || [])[1] || 'Nutri';
  const usuarioFinal =
    `${usuario}\n\n(Responda agora como ${nomePersonagem}, a nutricionista do grupo, em primeira pessoa, falando COM quem mandou a MENSAGEM ATUAL, usando o objetivo da PESSOA ATUAL. ` +
    `Você NÃO é essa pessoa: não narre o que ela comeu como se fosse você. Analise SOMENTE o que está nesta mensagem (legenda manda; foto complementa); NÃO copie análises anteriores do histórico, que são de outras refeições e outras pessoas. ` +
    `Se for foto de comida consumida, use o bloco 🕐 Refeição / 🍽️ O que eu vi / 🔥 Estimativa / ⚖️ Veredito / 💡 Dica; se for pedido de sugestão ou plano, use 💡 Sugestão e nenhum bloco. Não comece a resposta com o seu nome.)\n\n${nomePersonagem}:`;

  let ultimoErro;
  for (const prov of candidatos) {
    const model = precisaVisao ? prov.visao : prov.texto;
    const texto = encurtar(usuarioFinal, prov.maxChars || MAX_CHARS_ENTRADA);
    const conteudoUsuario = precisaVisao
      ? [{ type: 'text', text: texto }, ...imagens.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mimeType};base64,${im.data}` } }))]
      : texto;
    const body = {
      model,
      messages: [
        { role: 'system', content: systemFinal },
        { role: 'user', content: conteudoUsuario },
      ],
      max_tokens: Math.min(maxTokens, 4096),
      temperature,
      ...(prov.extra || {}),
    };
    if (json && prov.id !== 'cohere') body.response_format = { type: 'json_object' };
    try {
      const res = await fetch(prov.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${prov.chave()}`, 'Content-Type': 'application/json', ...(prov.headers || {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(precisaVisao ? Math.max(prov.timeoutMs || 60_000, 90_000) : prov.timeoutMs || 60_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error?.message || data?.message || JSON.stringify(data).slice(0, 160)}`);
      const texto = extrairTexto(data, nomePersonagem);
      if (!texto) throw new Error('resposta vazia');
      console.warn(`[reserva] respondido por ${prov.id} (${model})`);
      ultimaReserva = { id: prov.id, modelo: model };
      return texto;
    } catch (e) {
      ultimoErro = e;
      console.warn(`[reserva] ${prov.id} (${model}) falhou: ${String(e.message).slice(0, 160)}`);
    }
  }
  throw ultimoErro;
}
