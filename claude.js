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

// ---------- gasto e orçamento ----------
// preço por milhão (out/2026): Opus 5.5 4/20, Sonnet 5.5 2/10, Haiku 5.5 0,10/0,50; leitura de cache = 10% da entrada
const PRECO = { opus: [4, 20], sonnet: [2, 10], haiku: [0.1, 0.5], fable: [10, 50] };
// Dia e mês no fuso do grupo (vira à meia-noite de Brasília). O gasto fica no Mongo (coleção uso_claude, um documento por
// dia): deploy e reinício não zeram a conta, senão o teto furava a cada religada.
const diaBRT = (quando = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: process.env.TZ_GRUPO || 'America/Sao_Paulo' }).format(quando);
const zerado = (dia) => ({ dia, chamadas: 0, entrada: 0, cache: 0, saida: 0, usd: 0 });
let uso = zerado('');
let gastoMesAntes = { mes: '', usd: 0 }; // gasto do mês até ontem (lido do Mongo)

let _colecao = null; // injetável em teste; em produção, a do mongo.js
const col = async () => _colecao || (await import('./mongo.js')).colecao('uso_claude');
export const _usarColecao = (c) => (_colecao = c);

/** Lê do Mongo o gasto de hoje e o do mês até ontem. Boot (index.js) e virada do dia. Nunca lança. */
export async function carregarUsoClaude(hoje = diaBRT()) {
  try {
    const c = await col();
    const docs = await c.find({ _id: { $regex: `^${hoje.slice(0, 7)}-` } }).toArray();
    const deHoje = docs.find((d) => d._id === hoje);
    if (uso.dia !== hoje || (deHoje && deHoje.usd > uso.usd)) uso = { ...zerado(hoje), ...(deHoje ? { chamadas: deHoje.chamadas || 0, entrada: deHoje.entrada || 0, cache: deHoje.cache || 0, saida: deHoje.saida || 0, usd: deHoje.usd || 0 } : {}) };
    gastoMesAntes = { mes: hoje.slice(0, 7), usd: docs.filter((d) => d._id < hoje).reduce((s, d) => s + (d.usd || 0), 0) };
    console.log(`[claude] gasto: hoje US$ ${uso.usd.toFixed(2)}, mês até ontem US$ ${gastoMesAntes.usd.toFixed(2)}, teto de hoje US$ ${tetoDeHoje(hoje).toFixed(2)}`);
  } catch (e) {
    console.warn(`[claude] não li o gasto do Mongo (${String(e.message).slice(0, 80)}); conta só da memória`);
  }
}

function contabilizar(model, u = {}) {
  const dia = diaBRT();
  if (uso.dia !== dia) {
    if (uso.dia && uso.dia.slice(0, 7) === dia.slice(0, 7)) gastoMesAntes = { mes: dia.slice(0, 7), usd: gastoMesAntes.usd + uso.usd };
    else if (uso.dia) gastoMesAntes = { mes: dia.slice(0, 7), usd: 0 };
    uso = zerado(dia);
    carregarUsoClaude(dia).catch(() => {}); // confere com o Mongo (outro processo pode ter gastado)
  }
  const [pin, pout] = PRECO[Object.keys(PRECO).find((k) => model.includes(k))] || PRECO.opus;
  const entrada = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const cache = u.cache_read_input_tokens || 0;
  const saida = u.output_tokens || 0;
  const usd = (entrada * pin * (u.cache_creation_input_tokens ? 1.05 : 1) + cache * pin * 0.1 + saida * pout) / 1e6;
  uso.chamadas++;
  uso.entrada += entrada;
  uso.cache += cache;
  uso.saida += saida;
  uso.usd += usd;
  col()
    .then((c) => c.updateOne({ _id: dia }, { $inc: { chamadas: 1, entrada, cache, saida, usd }, $set: { atualizadoEm: new Date() } }, { upsert: true }))
    .catch(() => {});
  console.log(`[tokens] ${model}: ${entrada} entrada (${cache} em cache) + ${saida} saída | hoje: ${uso.chamadas} chamadas, US$ ${uso.usd.toFixed(2)} de ${tetoDeHoje(dia).toFixed(2)}`);
}

// Orçamento do mês (CLAUDE_ORCAMENTO_MES_USD, padrão 100): o teto de hoje é o que sobra do mês dividido pelos dias que
// faltam (hoje incluso), recalculado todo dia; dia econômico deixa sobra pros outros. CLAUDE_TETO_USD_DIA, se houver, é
// um limite extra por dia (0 = sem limite extra). Passou do teto: o resto do dia vai pro Gemini.
const ORCAMENTO = () => Number(process.env.CLAUDE_ORCAMENTO_MES_USD ?? 100);
export function tetoDeHoje(dia = diaBRT()) {
  const [a, m, d] = dia.split('-').map(Number);
  const diasNoMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const antes = gastoMesAntes.mes === dia.slice(0, 7) ? gastoMesAntes.usd : 0;
  // mês em que o Claude começou (CLAUDE_INICIO, AAAA-MM-DD): só a parte proporcional do orçamento, senão os dias que
  // sobraram do mês dividiriam o valor inteiro (começar no dia 23 dava ~US$ 11/dia)
  const inicio = String(process.env.CLAUDE_INICIO || '');
  const proporcao = inicio.slice(0, 7) === dia.slice(0, 7) ? (diasNoMes - Number(inicio.slice(8, 10)) + 1) / diasNoMes : 1;
  const doMes = ORCAMENTO() > 0 ? Math.max(0, ORCAMENTO() * proporcao - antes) / (diasNoMes - d + 1) : Infinity;
  const extra = Number(process.env.CLAUDE_TETO_USD_DIA) || Infinity;
  return Math.min(doMes, extra);
}
export const usoClaudeHoje = () => ({ ...uso, modelo: MODELO(), escopo: claudeLigado() ? ESCOPO() : 'off', teto: tetoDeHoje(), orcamentoMes: ORCAMENTO(), gastoMes: (gastoMesAntes.mes === diaBRT().slice(0, 7) ? gastoMesAntes.usd : 0) + (uso.dia === diaBRT() ? uso.usd : 0) });

let avisouTeto = '';
function passouDoTeto() {
  const dia = diaBRT();
  const teto = tetoDeHoje(dia);
  if (uso.dia !== dia || uso.usd < teto) return false;
  if (avisouTeto !== dia) {
    avisouTeto = dia;
    console.warn(`[claude] teto de hoje (US$ ${teto.toFixed(2)}) atingido; Gemini com os exemplos do Claude até a meia-noite`);
    import('./avisos.js').then((a) => a.avisarAdmin('claude-teto', `o Claude usou o teto de hoje (US$ ${teto.toFixed(2)}, pra o orçamento de US$ ${ORCAMENTO()} durar o mês); até a meia-noite o Gemini responde imitando as respostas dele.`)).catch(() => {});
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
