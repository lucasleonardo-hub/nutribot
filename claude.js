// claude.js - Claude (Anthropic) como primeiro modelo da cadeia do gerar() (gemini.js). Recebe o mesmo `contents`/config do
// Gemini e devolve no mesmo formato (texto, ou { texto, chamadas, conteudo, modelo } com bruto), então nada acima precisa
// saber quem respondeu. Falhou (erro, recusa, formato, áudio): quem chamou segue pra cadeia Gemini de sempre.
//
// Quem passa pelo Claude (CLAUDE_ESCOPO):
//   admin (padrão) : mensagens do administrador no grupo + tarefas que cruzam dados (plano, reflexão, investigação,
//                    pensamento: config.cruzar ou pensar 'alto'). CLAUDE_CRUZAR=off tira as tarefas.
//   tudo           : toda chamada do gerar() (o Gemini vira reserva).
//   off            : desligado (sem ANTHROPIC_API_KEY também).
// Áudio: o Claude não ouve; vai direto pro Gemini.
import Anthropic from '@anthropic-ai/sdk';
import { AsyncLocalStorage } from 'node:async_hooks';

const MODELO = () => process.env.CLAUDE_MODELO || 'claude-opus-5-5';
const ESCOPO = () => (process.env.CLAUDE_ESCOPO || 'admin').trim().toLowerCase();

let _cliente = null;
const cliente = () => (_cliente ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1 }));

// Marca a mensagem em processamento (mensagens.js): tudo o que ela chamar, inclusive as ferramentas, herda a marca
const contexto = new AsyncLocalStorage();
export const comoAdmin = (fn) => contexto.run({ admin: true }, fn);
export const pedidoDoAdmin = () => Boolean(contexto.getStore()?.admin);

export const claudeLigado = () => Boolean((process.env.ANTHROPIC_API_KEY || '').trim()) && ESCOPO() !== 'off';

/** Este pedido do gerar() vai primeiro pro Claude? */
export function claudeAtende(config = {}, contents) {
  if (!claudeLigado()) return false;
  if (passouDoTeto()) return false;
  if (partesDe(contents).some((p) => p?.inlineData && /^audio\//.test(p.inlineData.mimeType || ''))) return false;
  if (ESCOPO() === 'tudo') return true;
  if (pedidoDoAdmin()) return true;
  return !/^(off|nao|não|false|0)$/i.test(process.env.CLAUDE_CRUZAR || '') && (config.cruzar === true || config.pensar === 'alto');
}

// ---------- uso do dia (pro !status) ----------
// preço por milhão (out/2026): Opus 5.5 4/20, Sonnet 5.5 2/10, Haiku 5.5 0,10/0,50; leitura de cache = 10% da entrada
const PRECO = { opus: [4, 20], sonnet: [2, 10], haiku: [0.1, 0.5], fable: [10, 50] };
let uso = { dia: '', chamadas: 0, entrada: 0, cache: 0, saida: 0, usd: 0 };
function contabilizar(model, u = {}) {
  const dia = new Date().toISOString().slice(0, 10);
  if (uso.dia !== dia) uso = { dia, chamadas: 0, entrada: 0, cache: 0, saida: 0, usd: 0 };
  const [pin, pout] = PRECO[Object.keys(PRECO).find((k) => model.includes(k))] || PRECO.opus;
  const entrada = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const cache = u.cache_read_input_tokens || 0;
  const saida = u.output_tokens || 0;
  uso.chamadas++;
  uso.entrada += entrada;
  uso.cache += cache;
  uso.saida += saida;
  uso.usd += (entrada * pin * (u.cache_creation_input_tokens ? 1.05 : 1) + cache * pin * 0.1 + saida * pout) / 1e6;
  console.log(`[tokens] ${model}: ${entrada} entrada (${cache} em cache) + ${saida} saída | hoje: ${uso.chamadas} chamadas, US$ ${uso.usd.toFixed(2)}`);
}
export const usoClaudeHoje = () => ({ ...uso, modelo: MODELO(), escopo: claudeLigado() ? ESCOPO() : 'off', teto: TETO() });

// Teto de gasto por dia (UTC), em dólar: passou, o resto do dia vai pro Gemini. CLAUDE_TETO_USD_DIA=0 tira o teto.
const TETO = () => Number(process.env.CLAUDE_TETO_USD_DIA ?? 5);
let avisouTeto = '';
function passouDoTeto() {
  const dia = new Date().toISOString().slice(0, 10);
  if (!TETO() || uso.dia !== dia || uso.usd < TETO()) return false;
  if (avisouTeto !== dia) {
    avisouTeto = dia;
    console.warn(`[claude] teto de US$ ${TETO()} do dia atingido; Gemini até a virada (21h BRT)`);
    import('./avisos.js').then((a) => a.avisarAdmin('claude-teto', `o Claude bateu o teto de US$ ${TETO()} de hoje; até as 21h o Gemini responde. CLAUDE_TETO_USD_DIA muda o teto.`)).catch(() => {});
  }
  return true;
}

// ---------- conversão Gemini -> Claude ----------
function partesDe(contents) {
  if (typeof contents === 'string') return [{ text: contents }];
  const lista = Array.isArray(contents) ? contents : [contents];
  return lista.flatMap((c) => (c?.parts ? c.parts : [c]));
}

function blocoDeMidia(d) {
  if (/^image\//.test(d.mimeType)) return { type: 'image', source: { type: 'base64', media_type: d.mimeType, data: d.data } };
  if (/pdf/.test(d.mimeType)) return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data } };
  throw new Error(`mídia ${d.mimeType} não suportada no Claude`);
}

const textoDoResultado = (r) => (typeof r === 'string' ? r : JSON.stringify(r ?? ''));

/** contents do Gemini (string, partes ou turnos com functionCall/functionResponse) -> messages do Claude. */
export function paraMensagens(contents) {
  const turnos = typeof contents === 'string' || !Array.isArray(contents) || !contents.some((c) => c?.role)
    ? [{ role: 'user', parts: partesDe(contents) }]
    : contents;
  const msgs = [];
  let pendentes = []; // ids dos tool_use do último turno do modelo, na ordem (turno vindo do Gemini não traz id)
  turnos.forEach((t, ti) => {
    if (t.role === 'model') {
      if (t._claude) {
        msgs.push({ role: 'assistant', content: t._claude });
        pendentes = t._claude.filter((b) => b.type === 'tool_use').map((b) => b.id);
        return;
      }
      const content = [];
      pendentes = [];
      for (const p of t.parts || []) {
        if (p.text && !p.thought) content.push({ type: 'text', text: p.text });
        if (p.functionCall) {
          const id = p.functionCall.id || `toolu_g${ti}_${pendentes.length}`;
          pendentes.push(id);
          content.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args || {} });
        }
      }
      if (content.length) msgs.push({ role: 'assistant', content });
      return;
    }
    const content = [];
    let k = 0;
    for (const p of t.parts || []) {
      if (p.functionResponse) {
        const id = p.functionResponse.id && pendentes.includes(p.functionResponse.id) ? p.functionResponse.id : pendentes[k];
        k++;
        content.push({ type: 'tool_result', tool_use_id: id, content: textoDoResultado(p.functionResponse.response?.resultado ?? p.functionResponse.response) });
      } else if (p.inlineData) content.push(blocoDeMidia(p.inlineData));
      else if (p.text) content.push({ type: 'text', text: p.text });
    }
    // resultados de ferramenta vêm antes de qualquer texto no mesmo turno
    content.sort((a, b) => (b.type === 'tool_result') - (a.type === 'tool_result'));
    if (content.length) msgs.push({ role: 'user', content });
  });
  return msgs;
}

// esquema do Gemini (OBJECT/STRING, nullable) -> JSON Schema
function esquema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type') out.type = String(v).toLowerCase();
    else if (k === 'nullable') continue;
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([n, p]) => [n, esquema(p)]));
    else if (k === 'items') out.items = esquema(v);
    else out[k] = v;
  }
  if (s.nullable && out.type) out.type = [out.type, 'null'];
  if (!out.type) out.type = 'object';
  return out;
}

function ferramentasDe(tools = []) {
  return tools.flatMap((t) => t.functionDeclarations || []).map((d) => ({
    name: d.name,
    description: d.description || '',
    input_schema: esquema(d.parameters || { type: 'OBJECT', properties: {} }),
  }));
}

const tirarCercas = (t) => t.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

// pensar (convenção do gemini.js) -> effort. O Opus 5.5 sempre raciocina; o effort é o único controle.
const esforco = (pensar) => (pensar === 'alto' ? 'high' : pensar === false || pensar === 'baixo' ? 'low' : 'medium');

/**
 * Mesmo contrato do gerar() do gemini.js para UMA tentativa no Claude. Lança em qualquer falha (quem chama cai pro Gemini).
 * Erros com `cortada` (estrito) e `invalida` (validar) têm o mesmo significado que lá.
 */
export async function gerarClaude({ contents, config = {}, _cliente = cliente() }) {
  const { pensar, estrito, validar, bruto = false, systemInstruction, maxOutputTokens = 1024, responseMimeType, responseSchema, tools, toolConfig } = config;
  const model = MODELO();
  const json = responseMimeType === 'application/json';
  const declaracoes = ferramentasDe(tools);
  let system = typeof systemInstruction === 'string' ? systemInstruction : partesDe(systemInstruction || '').map((p) => p.text).filter(Boolean).join('\n');
  system += '\n\nFORMATO: WhatsApp. Negrito com UM asterisco (*assim*), nunca dois. Sem cabeçalhos markdown (#). Sem tabelas.';
  if (json) system += `\n\nResponda SOMENTE com JSON válido, sem cercas de código e sem texto antes ou depois.${responseSchema ? ` Formato exato (JSON Schema): ${JSON.stringify(esquema(responseSchema))}` : ''}`;

  const pedido = {
    model,
    // o raciocínio conta no max_tokens: folga pra ele não engolir a resposta
    max_tokens: Math.min(Math.max(maxOutputTokens * 2, 4000), 64000),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: paraMensagens(contents),
    output_config: { effort: esforco(pensar) },
    ...(declaracoes.length ? { tools: declaracoes, tool_choice: { type: toolConfig?.functionCallingConfig?.mode === 'NONE' ? 'none' : 'auto' } } : {}),
  };
  const res = await _cliente.messages.stream(pedido, { timeout: pensar === 'alto' ? 540_000 : 120_000 }).finalMessage();
  contabilizar(model, res.usage);

  if (res.stop_reason === 'refusal') throw new Error(`Claude recusou (${res.stop_details?.category || 'sem categoria'})`);
  const chamadas = res.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
  let texto = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (bruto && chamadas.length && res.stop_reason === 'tool_use') {
    // o conteúdo bruto (com o raciocínio) volta inteiro na próxima rodada; não-enumerável pra não vazar pro Gemini se ele assumir
    const conteudo = { role: 'model', parts: chamadas.map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.args } })) };
    Object.defineProperty(conteudo, '_claude', { value: res.content, enumerable: false });
    return { texto, chamadas, conteudo, modelo: model };
  }
  if (json) {
    texto = tirarCercas(texto);
    JSON.parse(texto); // JSON quebrado: falha aqui e o Gemini (com responseSchema de verdade) assume
  }
  if (!texto) throw new Error(`Claude respondeu vazio (stop_reason: ${res.stop_reason})`);
  if (res.stop_reason === 'max_tokens') {
    if (estrito) throw Object.assign(new Error(`resposta cortada por max_tokens (${pedido.max_tokens})`), { cortada: true, parcial: texto });
    console.warn(`[claude] ${model}: resposta cortada por max_tokens`);
  }
  if (validar && !validar(texto)) throw Object.assign(new Error(`resposta de ${model} fora do formato esperado`), { invalida: true });
  return bruto ? { texto, chamadas: [], conteudo: null, modelo: model } : texto;
}
