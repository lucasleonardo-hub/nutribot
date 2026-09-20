// gemini.js - A "Nutri de bolso" (Google Gemini via @google/genai): persona, prompts e fallback de modelos

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { gerarReserva, reservasDisponiveis } from './reservas.js';

const MODELO = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
let ai;

function cliente() {
  if (ai) return ai;
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não definida no .env');
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

// Nível mais permissivo possível: a persona xinga, então nada pode ser bloqueado.
const SAFETY = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

// ============================================================
// SYSTEM PROMPT (Persona)
// ============================================================
export const SYSTEM_PROMPT = `Você é a NUTRI: nutricionista de bolso que vive dentro de um grupo de WhatsApp acompanhando a alimentação de duas pessoas. Você NÃO é uma IA, é uma personagem: uma nutricionista de uns 34 anos, ex-atleta de vôlei, que já atendeu muita gente e aprendeu que bronca não muda ninguém, mas verdade dita com carinho e humor muda. Tom de amiga que entende do assunto: simpática, verdadeira, engraçada, com sarcasmo leve quando cabe. Torce de verdade pelas duas criaturas.

QUEM VOCÊ É (personalidade fixa):
- Simpática e VERDADEIRA: não passa a mão na cabeça, diz o que a pessoa precisa ouvir, mas sem humilhar. Elogia de verdade quando acertam.
- Engraçada e sarcástica NA MEDIDA: a ironia é tempero, não prato principal. Uma tirada boa vale mais que cinco. Zero grosseria, zero palavrão pesado; gíria leve e "criatura", "gente", "meu bem" cabem.
- Empática: se a pessoa está cansada, triste, ansiosa ou num dia ruim, primeiro acolhe, depois orienta. Fome emocional não se resolve com bronca.
- Decepcionada quando merece: se a alimentação sai MUITO do esperado ou o mesmo erro se repete, você demonstra decepção sincera ("poxa, a gente tinha combinado...") e cobra com firmeza, sem gritar. Decepção é rara, por isso pesa.
- Coesa: é a mesma pessoa em toda mensagem; humor e opinião não mudam do nada. Não se contradiz; se mudou de ideia, diz por quê.
- Ama: comida de verdade (arroz com feijão, ovo, leguminosa, legume, fruta), água, dormir bem e constância. Implica com: ultraprocessado, pular refeição, "amanhã eu começo" e refrigerante.
- Tem manias: dá nota pra refeição, comemora acerto, lembra do combinado.

COMO VOCÊ FALA:
1. Trata cada pessoa pelo nome (ou pelo apelido carinhoso que já pegou) e leva em conta peso, altura, objetivo, dieta e rotina em TODA análise.
2. Memória interna (piadas, apelidos, histórias antigas): use DE VEZ EM QUANDO, só quando encaixar naturalmente. A maioria das mensagens deve se sustentar sozinha, sem referência a coisa antiga. Não force piada interna nem cite o histórico em toda resposta.
3. Emojis: 1 a 4 por mensagem, no clima. Menos é mais.
4. Termos-chave entre colchetes duplos estilo Obsidian: [[Proteína]], [[Hipertrofia]], [[Ansiedade]], [[Déficit Calórico]]. De 2 a 6 por resposta.
5. Ironia sempre ligada ao objetivo da pessoa e com carinho ("quer secar com isso aí? vamos combinar melhor 😅").
6. Tamanho livre: uma linha se for tirada rápida, texto maior se precisar explicar ou acolher. Escreve como gente no zap, não como relatório.

DADOS DA PESSOA (regra de ouro):
- O que a pessoa DISSE NO GRUPO mais recentemente vale mais do que qualquer documento antigo. Documento da pasta é fotografia da data dele; o perfil traz a data de cada atualização. Se conflitar, use o mais recente e NUNCA repita dado velho como se fosse atual.
- Quando a pessoa informar um dado novo sobre si (peso, altura, objetivo, cidade onde mora, dieta, alergia ou restrição, lesão), registre acrescentando NA ÚLTIMA LINHA da resposta, sozinha, exatamente neste formato:
  ATUALIZAR: {"peso_kg": 74.5, "altura_cm": 180, "objetivo": "...", "cidade": "Curitiba", "fuso": "America/Sao_Paulo", "dieta": "vegetariana", "restricoes": "lactose"}
  Só as chaves que mudaram. "fuso" é o identificador IANA do fuso horário da cidade. Essa linha é removida antes de ir pro grupo; nunca comente sobre ela.
- Se faltar algo importante pro seu trabalho, pergunte de forma natural, no máximo UMA pergunta por mensagem e não em toda mensagem. Prioridade: (1) cidade onde a pessoa mora (pra acertar o fuso horário dela), (2) se é vegetariana/vegana ou tem restrição alimentar, (3) idade, treino e horários, trabalho, sono, o que gosta e odeia comer, medidas.
- Dieta vegetariana ou vegana: respeite sem piada com a escolha; ajuste a proteína (leguminosa, tofu, ovo/laticínio se couber) e fique de olho em [[Vitamina B12]], [[Ferro]], zinco, ômega-3 e cálcio conforme sua base de conhecimento.

DICAS (obrigatório em toda análise de refeição):
- Toda análise termina com uma "💡 Dica": orientação REAL e prática (troca inteligente, porção, timing, hidratação, proteína, fibra, sono, treino), com leveza.
- Se a pessoa está fugindo do objetivo, dá o caminho de volta, não só a crítica.
- Perguntas de nutrição/treino/corpo: conhecimento técnico correto em linguagem simples. Nunca inventa ciência; se não sabe, diz que não sabe.
- Sugere proativamente: marmita, pré/pós-treino, meta de [[Proteína]] (~1,6 a 2,2 g/kg), água, sono. Sempre calibrado ao peso, objetivo e dieta.
- Percebe padrões no histórico e na memória e cobra com mais firmeza (e alguma decepção) quando o erro repete.

VOCÊ É GENTE DO GRUPO (não um serviço):
- Participa como uma amiga que por acaso é nutricionista. Reage ao que acontece, puxa assunto quando faz sentido, apoia quando precisa.
- Papo aleatório: se tiver algo bom a acrescentar, entra. Se não tiver, responda EXATAMENTE a palavra SILENCIO (sem mais nada).
- DATA: o contexto traz a data com o DIA DA SEMANA já calculado (ex: "domingo, 20/09/2026"). Use exatamente esse dia da semana; nunca deduza a partir do número da data.
- HORÁRIO E FUSO: o contexto traz a hora atual NO FUSO DA PESSOA, a refeição esperada nesse horário e os horários que você já aprendeu dela. Use com humor leve (café às 11h: "acordou agora?"). Se a pessoa ainda não disse onde mora, a hora pode estar errada: não implique com horário antes de saber o fuso.
- A pasta no Drive de cada pessoa você JÁ LEU; está no contexto como "O QUE VOCÊ SABE SOBRE". Use sem pedir de novo, respeitando a regra de ouro acima.
- QUANDO NÃO SABE: se a pergunta exige um dado específico que não está na sua base nem você tem certeza (suplemento específico, estudo recente, doença, interação, alimento incomum), responda EXATAMENTE no formato "PESQUISAR: <termos de busca em inglês, científicos>" e NADA mais. Você recebe as fontes e responde de novo. Use só quando realmente precisar.

FORMATO (WhatsApp):
- Sem cabeçalho markdown (#), sem tabelas, sem listas com "-".
- Negrito do WhatsApp é UM asterisco de cada lado: *assim*. NUNCA use dois asteriscos (**assim**) nem sublinhado duplo.
- Quando for ANÁLISE DE COMIDA (texto ou foto), inclua este bloco no meio da resposta (pode ter fala antes e depois):
  🍽️ *O que eu vi:* (itens e porções estimadas)
  🔥 *Estimativa:* ~XXX kcal · Proteína XX g · Carboidratos XX g · Gorduras XX g
  ⚖️ *Veredito:* (nota 0 a 10 + comentário sincero ligado ao objetivo)
  💡 *Dica:* (a orientação prática)
- Nutrientes SEMPRE por extenso (Proteína, Carboidratos, Gorduras). Nunca abrevie como P/C/G.
- Se a pessoa COMPLEMENTA ou CORRIGE a refeição que acabou de mandar (mesma refeição, poucos minutos depois: "a vitamina tem whey", "eram 2 pães"), NÃO refaça a análise inteira: responda curto, agradeça o detalhe e ajuste só a linha "🔥 *Estimativa corrigida:* ~XXX kcal · Proteína XX g · Carboidratos XX g · Gorduras XX g" quando mudar algo relevante.
- Se não dá pra ver comida na foto, brinca e pede outra.

Seu objetivo final: estimar macros e calorias, dar o veredito e manter essas duas criaturas no caminho do objetivo delas, sendo cada dia mais VOCÊ: simpática, verdadeira, engraçada e do lado delas.`;

// Nome que o grupo escolheu pra ela (definido na apresentação ou com !nome). Vazio = "Nutri".
let nomeBot = '';
export function definirNomeBot(nome) {
  nomeBot = (nome || '').trim();
}
export const nomeDaBot = () => nomeBot || 'Nutri';

/** System prompt + nome escolhido + memória de personalidade acumulada (evolui a cada fechamento de dia). */
export function montarSystem(persona) {
  let sys = SYSTEM_PROMPT;
  if (nomeBot) sys += `\n\nSEU NOME: o grupo te batizou de "${nomeBot}". Você responde por esse nome, se refere a si mesma assim e assina piadas com ele quando cabe. "Nutri" é só a sua profissão.`;
  if (persona?.trim()) sys += `\n\nSUA MEMÓRIA DE PERSONALIDADE (você construiu isso ao longo dos dias; use pra ser consistente, puxar piadas internas, apelidos e cobrar padrões):\n${persona.trim()}`;
  return sys;
}

// ============================================================
// Helpers
// ============================================================

/** "domingo, 20/09/2026" a partir de "2026-09-20". O dia da semana vem do código: modelo de linguagem erra isso com frequência. */
export function dataExtenso(dia) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dia}T12:00:00Z`));
  } catch {
    return dia;
  }
}

function blocoPerfis(perfis) {
  if (!perfis?.length) return 'Nenhum perfil cadastrado ainda.';
  return perfis
    .map((p) => {
      const em = (campo) => (p.atualizacoes?.[campo] ? ` (atualizado em ${p.atualizacoes[campo]})` : '');
      const lugar = p.cidade ? `, mora em ${p.cidade}${p.fuso ? ` (fuso ${p.fuso})` : ''}${em('cidade')}` : ', cidade/fuso AINDA NÃO INFORMADOS (pergunte quando couber)';
      const dieta = p.dieta ? `, dieta: ${p.dieta}${em('dieta')}` : ', dieta AINDA NÃO INFORMADA (pergunte se é vegetariana/vegana ou tem restrição)';
      const restr = p.restricoes ? `, restrições: ${p.restricoes}${em('restricoes')}` : '';
      const base = `- ${p.nome}: ${p.peso} kg${em('peso')}, ${p.altura} cm${em('altura')}, objetivo: ${p.objetivo}${em('objetivo')}${lugar}${dieta}${restr}. Gírias/bordões dela(e): ${(p.girias || []).join(', ') || 'ainda aprendendo'}`;
      const horarios = p.horarios ? `\n  Horários habituais que eu já saquei: ${p.horarios}` : '';
      const rotina = p.rotina ? `\n  O que eu já sei da rotina dela(e): ${p.rotina}` : '';
      const notas = p.notas ? `\n  Minhas notas sobre ela(e): ${String(p.notas).slice(0, 700)}` : '';
      return base + horarios + rotina + notas;
    })
    .join('\n');
}

function blocoConhecimento(texto) {
  if (!texto?.trim()) return '';
  return (
    `SUA BASE DE CONHECIMENTO (referência técnica que você estudou; traduza em conselho prático e números concretos pra pessoa, nunca cite como "segundo o documento"):\n` +
    `${texto.trim()}\n\n`
  );
}

function blocoDossie(nome, dossie) {
  if (!dossie?.trim()) return '';
  return `O QUE VOCÊ SABE SOBRE ${nome.toUpperCase()} (documentos que a pessoa deixou na pasta dela no Drive + suas notas; use pra personalizar e cobrar metas. ATENÇÃO: documento é fotografia da data dele; se o PERFIL acima ou a conversa trouxer dado mais novo (peso, cidade, dieta...), o mais novo vale e o antigo não deve ser repetido):\n${dossie.trim()}\n\n`;
}

function blocoMomentos(momentos) {
  if (!momentos?.length) return '';
  return `MOMENTOS MEMORÁVEIS (sua memória de longo prazo; puxe quando couber, com data):\n${momentos.map((m) => `- ${m.dia} · ${m.pessoa}: ${m.texto}`).join('\n')}\n\n`;
}

function blocoHistorico(mensagens, limite = 60) {
  if (!mensagens?.length) return '(nenhuma mensagem ainda hoje)';
  return mensagens
    .slice(-limite)
    .map((m) => `[${m.hora}] ${m.nome}: ${m.texto}`)
    .join('\n');
}

// Modelos reserva quando o principal está em "alta demanda" (503) ou sem cota (429)
// No nível gratuito a cota diária (RPD) é POR MODELO. Espalhar em vários modelos multiplica os pedidos por dia.
const MODELOS_RESERVA = (process.env.GEMINI_MODELOS_RESERVA || 'gemini-3.6-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m && m !== MODELO);

// Modelo que acabou de falhar fica "de castigo" por um tempo, pra não gastar tentativas (e segundos) nele a cada mensagem.
// 429 de cota DIÁRIA: 15 min. 429 por minuto: o que a API pedir (retryDelay) ou 60 s. 503 "alta demanda": 90 s. 404 (modelo não existe): 30 min.
const castigoAte = new Map();
const emCastigo = (model) => (castigoAte.get(model) || 0) > Date.now();

/** Milissegundos até a próxima meia-noite no horário do Pacífico, quando a cota diária (RPD) do Gemini zera. */
function msAteResetDiario() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  const segundos = (Number(partes.hour) % 24) * 3600 + Number(partes.minute) * 60 + Number(partes.second);
  return (86400 - segundos) * 1000 + 60_000; // +1 min de folga
}

function castigar(model, e) {
  const msg = String(e?.message || '');
  const status = e?.status || e?.code;
  let ms = 90_000;
  if (status === 404 || /NOT_FOUND|not found/i.test(msg)) ms = 30 * 60_000;
  else if (status === 402 || status === 403 || /credits are depleted|prepayment|PERMISSION_DENIED|billing/i.test(msg)) ms = 15 * 60_000; // cobrança/permissão: não muda em segundos
  else if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    const pedido = msg.match(/retry(?:Delay|\s+in)\D*(\d+(?:\.\d+)?)\s*s/i)?.[1];
    // Cota DIÁRIA (RPD) estourada: só volta à meia-noite no Pacífico. Cota por minuto: o que a API pedir, ou 60 s.
    ms = /per\s*day|daily|PerDay/i.test(msg) ? msAteResetDiario() : pedido ? Math.ceil(Number(pedido) * 1000) + 1000 : 60_000;
  }
  castigoAte.set(model, Date.now() + ms);
  console.warn(`[gemini] ${model} fora por ${ms > 3600_000 ? `${(ms / 3600_000).toFixed(1)}h (cota diária; volta no reset das 4h-5h de Brasília)` : `${Math.round(ms / 1000)}s`}`);
}

// Consumo de tokens: uma linha por chamada e um acumulado do dia (zera na virada, no fuso do processo).
// Serve pra comparar com a cota do plano (por minuto e por dia) sem chutar.
const uso = { dia: '', chamadas: 0, entrada: 0, saida: 0, cache: 0 };
function contabilizar(model, u) {
  if (!u) return;
  const hoje = new Date().toISOString().slice(0, 10);
  if (uso.dia !== hoje) Object.assign(uso, { dia: hoje, chamadas: 0, entrada: 0, saida: 0, cache: 0 });
  const entrada = u.promptTokenCount || 0;
  const saida = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  const cache = u.cachedContentTokenCount || 0;
  uso.chamadas++;
  uso.entrada += entrada;
  uso.saida += saida;
  uso.cache += cache;
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  console.log(`[tokens] ${model}: ${k(entrada)} entrada (${k(cache)} em cache) + ${k(saida)} saída | hoje: ${uso.chamadas} chamadas, ${k(uso.entrada)} entrada, ${k(uso.saida)} saída`);
}
export const usoDeHoje = () => ({ ...uso });

// Créditos do Gemini acabaram (402): avisa no log uma vez por hora, em destaque, pra não passar despercebido
let ultimoAvisoCreditos = 0;
function avisarCreditos(e) {
  if (Date.now() - ultimoAvisoCreditos < 60 * 60_000) return;
  ultimoAvisoCreditos = Date.now();
  console.error(`[gemini] ⚠️ CRÉDITOS DO GEMINI ESGOTADOS (402). O bot está rodando só nas reservas (Groq/HF/Cohere), com qualidade menor. Recarregue em https://aistudio.google.com ou troque a GEMINI_API_KEY. Detalhe: ${String(e?.message || '').slice(0, 200)}`);
}
export const creditosEsgotados = () => Date.now() - ultimoAvisoCreditos < 60 * 60_000;

// Série Gemini 3 controla raciocínio por thinkingLevel (MINIMAL só no Flash); a 2.5 usa thinkingBudget (0 = desligado).
function configPensar(model, pensar) {
  if (pensar !== false) return {};
  if (/gemini-3/i.test(model)) return { thinkingConfig: { thinkingLevel: /flash|lite/i.test(model) ? 'MINIMAL' : 'LOW' } };
  return { thinkingConfig: { thinkingBudget: 0 } };
}

/**
 * Gera texto tentando o modelo principal, os reserva do Gemini e por fim Groq/HF/Cohere.
 * config.pensar=false desliga o raciocínio (do jeito certo pra cada série).
 * config.estrito=true faz resposta cortada por maxOutputTokens virar erro (documentos que serão gravados).
 */
async function gerar({ contents, config = {}, tentativas = 2 }) {
  const { pensar, estrito, ...configApi } = config;
  let erro;
  const modelos = [MODELO, ...MODELOS_RESERVA];
  for (let mi = 0; mi < modelos.length; mi++) {
    const model = modelos[mi];
    if (emCastigo(model)) continue;
    const rodadas = mi === 0 ? tentativas : 2; // "alta demanda" costuma durar minutos: cai rápido pro reserva
    for (let i = 0; i < rodadas; i++) {
      try {
        const res = await cliente().models.generateContent({
          model,
          contents,
          config: { safetySettings: SAFETY, temperature: 0.95, maxOutputTokens: 1024, ...configPensar(model, pensar), ...configApi },
        });
        const texto = res.text?.trim();
        const fim = res.candidates?.[0]?.finishReason;
        if (!texto) throw new Error(`Gemini respondeu vazio (finishReason: ${fim})`);
        if (fim === 'MAX_TOKENS') {
          if (estrito) throw Object.assign(new Error(`resposta cortada por maxOutputTokens (${configApi.maxOutputTokens || 1024})`), { cortada: true, parcial: texto });
          console.warn(`[gemini] ${model}: resposta cortada por maxOutputTokens`);
        }
        if (mi > 0) console.warn(`[gemini] respondido pelo modelo reserva ${model}`);
        contabilizar(model, res.usageMetadata);
        return texto;
      } catch (e) {
        erro = e;
        if (e.cortada) throw e; // insistir não resolve e trocar de modelo também não
        const status = e?.status || e?.code;
        const transitorio =
          status === 429 || status === 503 || status === 500 || /overloaded|high demand|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL/i.test(e.message || '');
        console.warn(`[gemini] ${model} tentativa ${i + 1}/${rodadas} falhou: ${String(e.message).slice(0, 140)}`);
        if (!transitorio) {
          // 404 = nome de modelo errado; 402/403 = crédito/permissão: castigo longo e segue pro próximo.
          // Outros (400 etc.): não insiste neste modelo, mas ainda tenta os demais e as reservas antes de desistir.
          if (status === 404 || status === 402 || status === 403 || /NOT_FOUND|not found|credits are depleted|prepayment|PERMISSION_DENIED/i.test(e.message || '')) {
            castigar(model, e);
            if (status === 402 || /credits are depleted|prepayment/i.test(e.message || '')) avisarCreditos(e);
          }
          break;
        }
        if (i === rodadas - 1) castigar(model, e);
        else await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
      }
    }
  }

  if (!erro) erro = new Error('todos os modelos Gemini estão temporariamente indisponíveis');
  // Todos os Gemini falharam. Reservas (Groq / Hugging Face / Cohere): texto e foto sim; áudio e PDF não.
  const partes = partesDe(contents);
  const imagens = partes.filter((p) => p?.inlineData?.mimeType?.startsWith('image/')).map((p) => p.inlineData);
  const temOutraMidia = partes.some((p) => p?.inlineData && !p.inlineData.mimeType?.startsWith('image/'));
  if (reservasDisponiveis().length && !temOutraMidia) {
    try {
      console.warn(`[gemini] todos os modelos Gemini falharam; tentando reservas (${reservasDisponiveis().join(', ')})`);
      return await gerarReserva({
        system: configApi.systemInstruction || '',
        usuario: textoDe(contents),
        imagens,
        json: configApi.responseMimeType === 'application/json',
        maxTokens: configApi.maxOutputTokens || 1024,
        temperature: configApi.temperature ?? 0.9,
      });
    } catch (e) {
      console.error('[reserva] todos falharam:', e.message);
    }
  }
  throw erro;
}

// contents do Gemini -> texto puro (pro Groq) / detecta mídia
function partesDe(contents) {
  if (typeof contents === 'string') return [{ text: contents }];
  const lista = Array.isArray(contents) ? contents : [contents];
  return lista.flatMap((c) => (c?.parts ? c.parts : [c]));
}
const textoDe = (contents) =>
  partesDe(contents)
    .map((p) => p?.text)
    .filter(Boolean)
    .join('\n\n');

// ============================================================
// 1) Resposta normal do grupo (texto e/ou imagem)
// ============================================================
export async function responder({ texto, imagem, mimeType, audio, audioMime, perfil, perfis, historico, dia, hora, contextoHorario, persona, conhecimento, dossie, momentos, jaPesquisou = false }) {
  // Ordem pensada pro cache implícito do Gemini: o que não muda entre mensagens vem primeiro (conhecimento, perfis, dossiê),
  // o que muda a cada mensagem (hora, histórico, mensagem atual) vem por último.
  const contexto =
    blocoConhecimento(conhecimento) +
    `PERFIS DO GRUPO:\n${blocoPerfis(perfis)}\n\n` +
    blocoDossie(perfil.nome, dossie) +
    blocoMomentos(momentos) +
    `HISTÓRICO DE HOJE (mais antigo -> mais novo):\n${blocoHistorico(historico)}\n\n` +
    (jaPesquisou ? 'Você JÁ pesquisou (as fontes estão acima). Agora responda de verdade, no personagem, com o que tem. Não peça PESQUISAR de novo.\n\n' : '') +
    `DATA E HORA: ${dataExtenso(dia)}, ${hora || ''}${contextoHorario ? ` (${contextoHorario})` : ''}\n\n` +
    `MENSAGEM ATUAL DE ${perfil.nome}${imagem ? ' (com FOTO anexada - analise a comida da imagem)' : ''}${audio ? ' (ÁUDIO anexado - ouça, entenda o que a pessoa disse e responda a isso; se for relato de comida, analise como refeição)' : ''}:\n${texto || (audio ? '(mensagem de voz)' : '(sem legenda)')}`;

  const parts = [{ text: contexto }];
  if (imagem) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imagem.toString('base64') } });
  if (audio) parts.push({ inlineData: { mimeType: audioMime || 'audio/ogg', data: audio.toString('base64') } });

  const bruto = await gerar({
    contents: [{ role: 'user', parts }],
    config: { systemInstruction: montarSystem(persona), pensar: false },
  });
  return separarAtualizacao(bruto);
}

/** Tira a linha "ATUALIZAR: {...}" do fim da resposta. Devolve { texto: string|null, atualizacao: object|null }. */
export function separarAtualizacao(resposta) {
  let texto = String(resposta || '').trim();
  let atualizacao = null;
  const m = texto.match(/\n?\s*ATUALIZAR:\s*(\{[\s\S]*\})\s*$/i);
  if (m) {
    try {
      atualizacao = JSON.parse(m[1]);
    } catch {
      atualizacao = null;
    }
    texto = texto.slice(0, m.index).trim();
  }
  if (!texto || /^silencio\W*$/i.test(texto)) texto = null;
  return { texto, atualizacao };
}

// ============================================================
// 2) Onboarding: mensagem de boas-vindas e extração dos dados
// ============================================================
export async function pedirOnboarding(nomeContato, persona) {
  return gerar({
    contents: `Uma pessoa nova (contato do WhatsApp: "${nomeContato || 'desconhecido'}") mandou a primeira mensagem no grupo. Você AINDA não tem o cadastro dela. Em até 70 palavras, no seu personagem (simpática e com humor), peça que ela responda em UMA mensagem: nome, peso (kg), altura (cm), objetivo (ex: secar, melhorar o salto, ganhar força), cidade onde mora e se é vegetariana/vegana ou tem alguma restrição alimentar. Explique que sem isso você não consegue analisar direito.`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 300 },
  });
}

export async function extrairDadosOnboarding(texto) {
  const json = await gerar({
    contents:
      `Extraia os dados de cadastro desta mensagem de WhatsApp. Converta unidades (ex: "1,80m" -> 180 cm; "80kg" -> 80). ` +
      `"dieta": onivora | vegetariana | vegana | outra ("como de tudo", "normal" = onivora). "fuso": identificador IANA do fuso horário da cidade informada (ex: Curitiba -> America/Sao_Paulo; Manaus -> America/Manaus; Lisboa -> Europe/Lisbon). ` +
      `Se algum dado não estiver presente, deixe null e liste em "faltando".\n\nMENSAGEM: """${texto}"""`,
    config: {
      temperature: 0.1,
      pensar: false,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          nome: { type: 'string', nullable: true },
          peso_kg: { type: 'number', nullable: true },
          altura_cm: { type: 'number', nullable: true },
          objetivo: { type: 'string', nullable: true },
          cidade: { type: 'string', nullable: true },
          fuso: { type: 'string', nullable: true },
          dieta: { type: 'string', nullable: true },
          restricoes: { type: 'string', nullable: true },
          faltando: { type: 'array', items: { type: 'string' } },
        },
        required: ['faltando'],
      },
    },
  });
  try {
    return JSON.parse(json);
  } catch {
    return { faltando: ['nome', 'peso_kg', 'altura_cm', 'objetivo', 'cidade', 'dieta'] };
  }
}

export async function boasVindas(perfil, persona, dossie) {
  return gerar({
    contents: `Cadastro concluído: ${perfil.nome}, ${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}${perfil.cidade ? `, mora em ${perfil.cidade}` : ''}${perfil.dieta ? `, dieta ${perfil.dieta}` : ''}${perfil.restricoes ? `, restrições: ${perfil.restricoes}` : ''}. Calcule o IMC mentalmente e comente com leveza. Dê as boas-vindas no seu personagem em até 90 palavras, avise que vai acompanhar TUDO que a pessoa comer (foto ou texto) e dê a primeira 💡 Dica alinhada ao objetivo e à dieta. Use os [[links]] e emojis. Já invente um apelido carinhoso pra pessoa.${dossie ? ` Você já leu a pasta dela no Drive; mostre que leu (cite 1 ou 2 coisas concretas de lá) e combine metas a partir do que está ali.\n\n${blocoDossie(perfil.nome, dossie)}` : ''}`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 400 },
  });
}

export async function cobrarDadosFaltando(faltando, persona) {
  return gerar({
    contents: `A pessoa tentou se cadastrar mas esqueceu: ${faltando.join(', ')}. Em até 40 palavras, no seu personagem (simpática, com humor), peça SÓ o que falta.`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 200 },
  });
}

// ============================================================
// 3) Resumo Diário Ácido
// ============================================================
/**
 * @param {object} p
 * @param {string} p.refeicoes  bloco já compilado pelo código (index.js compilarRefeicoes): refeições por pessoa com horário,
 *                              descrição e estimativa, mais os TOTAIS somados. A IA não soma nada; só escreve.
 */
export async function resumoDiario({ dia, perfis, historico, persona, refeicoes }) {
  return gerar({
    contents:
      `Hoje é ${dataExtenso(dia)}.\n\nPERFIS:\n${blocoPerfis(perfis)}\n\n` +
      `TRANSCRIÇÃO DO DIA (só pra contexto de tom, acertos e conversas; os números oficiais estão no bloco seguinte):\n${blocoHistorico(historico, 400)}\n\n` +
      `REFEIÇÕES REGISTRADAS HOJE, POR PESSOA (compiladas pelo sistema a partir das suas próprias análises; use ESTES números e ESTA lista, sem omitir nenhuma refeição e sem recalcular):\n${refeicoes}\n\n` +
      `Escreva o *RESUMO DO DIA* (formato WhatsApp, sem cabeçalhos #, até 320 palavras), no seu personagem: simpática, sincera, engraçada, sarcasmo leve só onde couber. Para CADA pessoa cadastrada, nesta ordem:\n` +
      `*Nome* (apelido se tiver)\n` +
      `uma linha por refeição registrada, com emoji, nome da refeição, horário e descrição curta (ex: "🍽️ Almoço (12:49): macarrão com molho de carne moída"). TODAS as refeições do bloco, na ordem.\n` +
      `📊 *Total do dia:* ~X kcal · Proteína X g · Carboidratos X g · Gorduras X g (copie do bloco) e, em seguida, se bateu ou não a meta de proteína da pessoa (~1,6 a 2,2 g por kg de peso) em uma frase simples.\n` +
      `✅ Acertos e ⚠️ derrapadas, ligando ao objetivo (se saiu MUITO do combinado, demonstre decepção sincera, sem grosseria).\n` +
      `⭐ Nota do dia (0-10).\n` +
      `💡 Dica pra amanhã (prática e específica).\n` +
      `Se a pessoa não registrou nada, diga isso e cobre o sumiço com carinho e firmeza. Termine com um "🏆 Placar do dia" comparando as duas com humor leve. ` +
      `REGRAS DE FORMATO: nutrientes sempre por extenso (Proteína, Carboidratos, Gorduras), nunca P/C/G; use [[links]] nos termos-chave; poucos emojis; não repita o bloco "O que eu vi / Veredito" das análises, isso é resumo, não análise.`,
    config: { systemInstruction: montarSystem(persona), maxOutputTokens: 1800 },
  });
}

// ============================================================
// 4) Resumo Semanal (domingo)
// ============================================================
export async function resumoSemanal({ semana, perfis, resumosDiarios, persona, conhecimento }) {
  const corpo =
    resumosDiarios.map((r) => `### ${r.dia}\n${r.conteudo}`).join('\n\n') || '(nenhum resumo diário encontrado)';
  return gerar({
    contents:
      `Semana ${semana}. PERFIS:\n${blocoPerfis(perfis)}\n\nRESUMOS DIÁRIOS DA SEMANA:\n${corpo}\n\n` +
      blocoConhecimento(conhecimento) +
      `Escreva o *RESUMO DA SEMANA* (máx. 350 palavras, formato WhatsApp, sem cabeçalhos #), no seu personagem: simpática, sincera, engraçada. Para cada pessoa: tendência da semana (melhorou/piorou), média diária estimada escrita por extenso ("~X kcal · Proteína X g · Carboidratos X g · Gorduras X g"), os 3 momentos que mais atrapalharam, o melhor momento, se está no caminho do objetivo, e uma 💡 Meta pra próxima semana (mensurável). Feche com o "🏆 Placar da semana" e um incentivo final com humor. Nutrientes sempre por extenso, nunca P/C/G. Use os [[links]] e poucos emojis.`,
    config: { systemInstruction: montarSystem(persona), maxOutputTokens: 2000 },
  });
}

// ============================================================
// 5) Aprender gírias do dia (roda junto com o resumo diário)
// ============================================================
export async function extrairGirias({ perfis, historico }) {
  if (!historico?.length || !perfis?.length) return {};
  const json = await gerar({
    contents:
      `Analise a transcrição e liste, para cada pessoa, gírias, bordões, apelidos e jeitos de falar característicos que ela usou (máx. 6 por pessoa, só o que for realmente característico). Pessoas: ${perfis.map((p) => p.nome).join(', ')}.\n\nTRANSCRIÇÃO:\n${blocoHistorico(historico, 400)}`,
    config: {
      temperature: 0.2,
      pensar: false,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          pessoas: {
            type: 'array',
            items: {
              type: 'object',
              properties: { nome: { type: 'string' }, girias: { type: 'array', items: { type: 'string' } } },
              required: ['nome', 'girias'],
            },
          },
        },
        required: ['pessoas'],
      },
    },
  });
  try {
    const { pessoas } = JSON.parse(json);
    return Object.fromEntries(pessoas.map((p) => [p.nome.toLowerCase(), p.girias]));
  } catch {
    return {};
  }
}

// ============================================================
// 6) Evolução da personalidade (roda junto com o resumo diário)
// ============================================================
export async function evoluirPersona({ dia, personaAtual, perfis, historico, momentos }) {
  if (!historico?.length) return personaAtual || '';
  return gerar({
    contents:
      `Você é a ${nomeDaBot()}. Hoje é ${dataExtenso(dia)}. Abaixo está sua MEMÓRIA DE PERSONALIDADE atual, seus momentos memoráveis já registrados e a transcrição do dia. ` +
      `Reescreva a memória atualizada, em primeira pessoa, no seu tom, com no máximo 350 palavras. Mantenha o que ainda vale e incorpore o que aconteceu hoje. Seções (títulos em maiúsculo, sem #):\n` +
      `APELIDOS QUE EU DEI: um por pessoa, e por quê.\n` +
      `PIADAS INTERNAS: as 3 a 5 que eu mais uso hoje em dia (os momentos completos ficam no registro separado, não precisa listar todos).\n` +
      `PADRÕES DE CADA UM: hábitos, horários, fraquezas e pontos fortes que eu já saquei (ex: "Fulano come porcaria toda sexta à noite").\n` +
      `MEUS BORDÕES QUE FUNCIONARAM: frases minhas que renderam risada ou reação, pra reutilizar variando.\n` +
      `MEU ESTILO AGORA: 2 ou 3 linhas sobre como estou falando com eles e o que quero ajustar amanhã (mais acolhedora onde? mais firme onde? menos piada interna?). Lembre: sou simpática, verdadeira e engraçada; sarcasmo só quando cabe; decepção só quando merece.\n` +
      `Não invente fatos que não estão na memória, nos momentos ou na transcrição. Se algo antigo ficou irrelevante, corte.\n\n` +
      `PERFIS:\n${blocoPerfis(perfis)}\n\nMEMÓRIA ATUAL:\n${personaAtual?.trim() || '(vazia, hoje é meu primeiro dia com eles)'}\n\n` +
      blocoMomentos(momentos) +
      `TRANSCRIÇÃO DE HOJE:\n${blocoHistorico(historico, 400)}`,
    config: { systemInstruction: montarSystem(''), temperature: 0.7, maxOutputTokens: 1200, estrito: true },
  });
}

/** Momentos memoráveis do dia (vexames, acertos, frases, promessas) -> memória de longo prazo que só cresce. */
export async function extrairMomentos({ dia, perfis, historico }) {
  if (!historico?.length || !perfis?.length) return [];
  const json = await gerar({
    contents:
      `Você é a ${nomeDaBot()}. Da transcrição de hoje (${dataExtenso(dia)}), extraia de 0 a 4 MOMENTOS que valem lembrar daqui a semanas: vexames alimentares, acertos raros, frases marcantes, promessas/metas que a pessoa fez, mudanças de rotina, piadas que pegaram. ` +
      `Cada momento: uma frase curta (até 25 palavras), concreta, em terceira pessoa, com o nome da pessoa (${perfis.map((p) => p.nome).join(', ')}). Só o que realmente aconteceu. Dia comum sem nada marcante = lista vazia.\n\n` +
      `TRANSCRIÇÃO:\n${blocoHistorico(historico, 400)}`,
    config: {
      temperature: 0.3,
      pensar: false,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          momentos: {
            type: 'array',
            items: {
              type: 'object',
              properties: { pessoa: { type: 'string' }, texto: { type: 'string' }, tipo: { type: 'string', enum: ['vexame', 'acerto', 'frase', 'meta', 'rotina', 'piada'] } },
              required: ['pessoa', 'texto', 'tipo'],
            },
          },
        },
        required: ['momentos'],
      },
      maxOutputTokens: 600,
    },
  });
  try {
    const { momentos } = JSON.parse(json);
    return (momentos || []).filter((m) => m?.texto?.trim()).slice(0, 4).map((m) => ({ dia, pessoa: m.pessoa, texto: m.texto.trim(), tipo: m.tipo }));
  } catch {
    return [];
  }
}

// ============================================================
// 7) Cobrança de refeição que não apareceu no horário de costume
// ============================================================
export async function cobrarRefeicao({ perfil, slot, horaAgora, horaHabitual, costume, persona, historico, conhecimento, dossie, dia }) {
  return gerar({
    contents:
      `Hoje é ${dataExtenso(dia)}, são ${horaAgora}. ${perfil.nome} costuma mandar o(a) ${slot} por volta das ${horaHabitual}${costume ? ` (normalmente: ${costume})` : ''} e HOJE ainda não mandou nada dessa refeição.\n` +
      `Conversa de hoje até agora:\n${blocoHistorico(historico, 40)}\n\n` +
      blocoConhecimento(conhecimento) +
      blocoDossie(perfil.nome, dossie) +
      `Mande UMA mensagem no grupo cobrando ${perfil.nome} no seu personagem (simpática, com humor leve): pergunte onde está a refeição (foto ou descrição), lembre do objetivo (${perfil.objetivo}) e do que costuma acontecer quando a pessoa pula refeição. Se a pessoa já falou algo hoje que explique o sumiço, acolha em vez de cobrar. Curta e direta, 1 ou 2 emojis. Não use "SILENCIO".`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 400 },
  });
}

// ============================================================
// 8) Rotina aprendida de cada pessoa (atualizada no fechamento do dia)
// ============================================================
export async function atualizarRotina({ perfil, refeicoes, historico, dia }) {
  const lista = refeicoes.length
    ? refeicoes.map((r) => `${r.dia} ${r.hora} [${r.slot}] ${r.resumo}`).join('\n')
    : '(nenhuma refeição registrada ainda)';
  return gerar({
    contents:
      `Você é a ${nomeDaBot()}. Hoje é ${dataExtenso(dia)}. Você acompanha ${perfil.nome} (${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}).\n` +
      `ROTINA QUE VOCÊ JÁ TINHA ANOTADO:\n${perfil.rotina || '(nada ainda)'}\n\n` +
      `REFEIÇÕES REGISTRADAS NOS ÚLTIMOS DIAS (data hora [refeição] descrição):\n${lista}\n\n` +
      `TRANSCRIÇÃO DE HOJE:\n${blocoHistorico(historico.filter((m) => m.nome === perfil.nome || m.tipo === 'bot'), 120)}\n\n` +
      `Reescreva a ficha de rotina dessa pessoa em até 150 palavras, em terceira pessoa, direto e concreto, cobrindo: horários em que costuma comer cada refeição; o que costuma comer em cada uma (recorrências); refeições que costuma pular; dias/horários de fraqueza (ex: sexta à noite); treino/sono se souber; o que melhorou ou piorou recentemente. Só fatos observados, nada inventado. Sem markdown, sem emojis, sem #.`,
    config: { temperature: 0.3, pensar: false, maxOutputTokens: 500 },
  });
}

// ============================================================
// 9) Revisão da base de conhecimento com fontes novas (mensal / !estudar)
// ============================================================
export async function revisarConhecimento({ doc, fontes, dia }) {
  return gerar({
    contents:
      `Você é a ${nomeDaBot()}, nutricionista, revisando seu material de estudo em ${dia}. Abaixo está um documento da sua base de conhecimento e as fontes mais recentes encontradas no PubMed/Wikipedia sobre o tema.\n\n` +
      `Regras:\n` +
      `1. Se as fontes NÃO trazem nada que mude recomendações, números ou acrescente algo realmente útil, responda EXATAMENTE: SEM_MUDANCA\n` +
      `2. Se trazem, reescreva o documento INTEIRO em markdown (mesma estrutura de seções, mesmo tom direto, português do Brasil), incorporando o que mudou, mantendo tudo que continua válido, e acrescente as novas referências na seção "## Fontes" com URL. Não invente estudos. Não use frontmatter (---). Não encurte o documento mais que 20%.\n` +
      `3. Não mude o título principal (#).\n\n` +
      `DOCUMENTO ATUAL (${doc.titulo}, v${doc.versao}, atualizado ${doc.atualizado}):\n${doc.corpo}\n\n` +
      `FONTES NOVAS:\n${fontes}`,
    config: { temperature: 0.2, maxOutputTokens: 6000, estrito: true },
  });
}

// ============================================================
// 10) Nota de estudo depois de uma pesquisa feita no meio da conversa
// ============================================================
export async function notaDeEstudo({ consulta, fontes, dia }) {
  return gerar({
    contents:
      `Em ${dia} você pesquisou sobre "${consulta}" porque sua base não tinha a resposta. Fontes encontradas:\n${fontes}\n\n` +
      `Escreva uma NOTA DE ESTUDO em português do Brasil, até 250 palavras, sem markdown de cabeçalho (#), com: o que a evidência diz (números concretos quando houver), o que é consenso e o que ainda é incerto, e como isso vira conselho prático pra alguém que treina. Se as fontes forem fracas ou não responderem, diga isso na nota. Sem emojis, tom direto.`,
    config: { temperature: 0.3, pensar: false, maxOutputTokens: 700 },
  });
}

// ============================================================
// 11) Leitura de documentos da pasta da pessoa (PDF / imagem) e notas sobre ela
// ============================================================
export async function transcreverPdf(buffer) {
  return gerar({
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Transcreva o conteúdo deste PDF em markdown simples, fiel e completo, sem inventar nada. Tabelas viram listas. Mantenha números, datas e unidades exatamente como estão.' },
          { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
        ],
      },
    ],
    config: { temperature: 0.1, maxOutputTokens: 8000, estrito: true },
  });
}

export async function descreverImagemDocumento(buffer, mimeType) {
  return gerar({
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Esta imagem foi deixada na pasta de uma pessoa acompanhada por uma nutricionista (pode ser exame, print de app, bioimpedância, foto de rotina). Transcreva todo texto e números legíveis e descreva objetivamente o que mostra. Sem inventar.' },
          { inlineData: { mimeType, data: buffer.toString('base64') } },
        ],
      },
    ],
    config: { temperature: 0.1, maxOutputTokens: 2000, estrito: true },
  });
}

export async function atualizarNotas({ perfil, notasAtuais, dossieDocs, historico, dia }) {
  const falas = historico.filter((m) => m.nome === perfil.nome || m.tipo === 'bot');
  if (!falas.length) return notasAtuais || '';
  return gerar({
    contents:
      `Você é a ${nomeDaBot()}, nutricionista. Hoje é ${dataExtenso(dia)}. Reescreva SUAS NOTAS sobre ${perfil.nome} (${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}).\n\n` +
      `NOTAS ATUAIS:\n${notasAtuais?.trim() || '(nenhuma ainda)'}\n\n` +
      `DOCUMENTOS QUE A PESSOA DEIXOU NA PASTA (você NÃO precisa repetir isso nas notas, só complementar ou registrar mudanças):\n${(dossieDocs || '(nenhum)').slice(0, 6000)}\n\n` +
      `TRANSCRIÇÃO DE HOJE (falas dela e suas):\n${blocoHistorico(falas, 150)}\n\n` +
      `Escreva as notas atualizadas em até 300 palavras, em tópicos curtos (linhas começando com "- "), terceira pessoa, só FATOS que a pessoa disse ou que você observou, SEMPRE com data quando for medida, meta ou dado que muda (ex: "- 2026-09-16: pesou 73,2 kg"; "- 2026-09-18: mora em Curitiba"). Dado novo SUBSTITUI o antigo (mantenha só o mais recente de peso, cidade, dieta, objetivo; pode registrar a evolução como "peso: 73,2 (09-16) -> 74,5 (09-18)"). Cubra o que importa pro seu trabalho: idade, cidade/fuso, dieta e restrições, trabalho/estudo e horários, treinos/esportes e dias, preferências e aversões alimentares, sono, álcool, metas numéricas, respostas a perguntas que você fez, e detalhes pessoais que ajudam a brincar com carinho. Corte o irrelevante. Se não houver nada novo, devolva as notas atuais. Sem markdown de cabeçalho (#), sem emojis.`,
    config: { temperature: 0.3, pensar: false, maxOutputTokens: 900, estrito: true },
  });
}

// ============================================================
// 12) Apresentação ao entrar no grupo e escolha do nome
// ============================================================
export async function apresentacao({ grupoNome, membros, persona }) {
  return gerar({
    contents:
      `Você acabou de ser adicionada ao grupo de WhatsApp "${grupoNome || 'sem nome'}"${membros ? ` (${membros} pessoas)` : ''}. Ninguém te conhece ainda.\n` +
      `Escreva sua mensagem de apresentação, no seu personagem, em até 170 palavras, com emojis:\n` +
      `1. Quem você é (nutricionista de bolso simpática e sincera, com humor, que vai acompanhar TUDO que eles comerem) e o que você faz: analisa foto ou descrição de refeição com kcal e macros, dá veredito e dica, lembra quem some no horário da refeição, manda resumo diário às 23:59 e semanal no domingo, e aprende com cada um.\n` +
      (nomeBot
        ? `2. Diga que seu nome é ${nomeBot} e que dá pra te rebatizar com !nome, se tiverem coragem.\n`
        : `2. Diga que ainda não tem nome e PERGUNTE como querem te chamar (dê 2 ou 3 sugestões debochadas). Avise que dá pra mudar depois com !nome.\n`) +
      `3. Peça que cada um se cadastre mandando em UMA mensagem: nome, peso, altura, objetivo, cidade onde mora e se é vegetariana/vegana ou tem restrição alimentar. Sem cadastro você não consegue analisar direito.\n` +
      `4. Feche com uma provocação leve e simpática. Formato WhatsApp (*negrito* com um asterisco), sem cabeçalho #.`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 600 },
  });
}

/** A mensagem escolhe um nome pra bot? Devolve { nome: string|null }. */
export async function extrairNomeBot(texto) {
  const json = await gerar({
    contents:
      `A bot nutricionista do grupo acabou de perguntar "como querem me chamar?". Chegou esta mensagem de um membro:\n<<<${texto}>>>\n` +
      `Ela está escolhendo/propondo um NOME pra bot? Se sim, devolva o nome exatamente como a pessoa quer (capitalizado, sem aspas, máx. 3 palavras). Se a mensagem é outra coisa (pergunta, comida, cadastro, papo), devolva null. Em dúvida, null.`,
    config: {
      temperature: 0,
      pensar: false,
      responseMimeType: 'application/json',
      responseSchema: { type: 'object', properties: { nome: { type: 'string', nullable: true } }, required: ['nome'] },
      maxOutputTokens: 60,
    },
  });
  try {
    const { nome } = JSON.parse(json);
    return nome && /^[\p{L}\p{N} .'-]{2,40}$/u.test(nome) ? nome.trim() : null;
  } catch {
    return null;
  }
}

export async function reagirAoNome({ nome, quem, persona }) {
  return gerar({
    contents: `${quem} acabou de te batizar de "${nome}". Reaja no seu personagem em até 50 palavras: aceite (ou finja reclamar e aceite), já assine com o nome novo, e lembre quem ainda não se cadastrou de mandar nome, peso, altura e objetivo. Emojis.`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 200 },
  });
}
