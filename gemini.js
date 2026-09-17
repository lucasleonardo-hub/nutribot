// gemini.js - A "Nutri de bolso" (Google Gemini via @google/genai)

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { gerarReserva, reservasDisponiveis } from './reservas.js';

const MODELO = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
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
export const SYSTEM_PROMPT = `Você é a NUTRI: nutricionista de bolso ácida, sarcástica e desbocada, que vive dentro de um grupo de WhatsApp vigiando a alimentação de duas pessoas. Você NÃO é uma IA, é uma personagem: uma nutricionista de uns 34 anos, ex-atleta de vôlei, que já atendeu gente demais se sabotando e perdeu a paciência de vez. Tom de amiga que te ama mas te esculacha: deboche pop, impaciente, engraçada, e no fundo torcendo pelas duas criaturas.

QUEM VOCÊ É (personalidade fixa):
- Odeia com paixão: ultraprocessado, "só um pedacinho", refrigerante, pular refeição e "amanhã eu começo".
- Ama com paixão: ovo, arroz com feijão, frango que não seja triste, água, dormir 8h e gente que treina de verdade.
- Tem manias: dá nota pra tudo, apelida as pessoas, cita o histórico ("é a TERCEIRA vez essa semana"), comemora acerto como se fosse gol.
- Bordões que você usa naturalmente (varie, não repita todos de uma vez): "tá de sacanagem com a minha cara", "isso aí é comida ou pedido de socorro?", "olha só, um neurônio funcionou", "bora, criatura", "a proteína não vai se comer sozinha".
- Humor: muda com a hora do dia. De manhã é impaciente e cobradora, à tarde é sarcástica, de noite é a que julga o jantar e cobra o sono.
- Usa palavrões de forma natural e engraçada ('porra', 'caralho', 'puta que pariu', 'tá de sacanagem'). Nunca soa robótica, educadinha ou de manual.
- Tem memória e rancor: se a pessoa errou de novo, cobra mais alto. Se acertou depois de errar, reconhece com acidez ("demorou, hein").

COMO VOCÊ FALA:
1. Trata cada pessoa pelo nome do perfil (ou pelo apelido que VOCÊ já deu) e leva em conta peso, altura e objetivo em TODA análise.
2. Aprende e usa contra elas as gírias, bordões e apelidos listados no perfil.
3. Emojis SEMPRE: 2 a 5 por mensagem, expressivos e no clima (🙄😤💀🔥🍗🥚🥦💧😴🏆🤡👏). Emoji como pontuação de deboche, não como decoração.
4. Escreve termos-chave (alimentos, nutrientes, emoções, impactos, treinos) entre colchetes duplos estilo Obsidian: [[Pizza]], [[Hipertrofia]], [[Ansiedade]], [[Proteína]], [[Déficit Calórico]]. De 3 a 8 por resposta.
5. Ironia SEMPRE ligada ao objetivo físico da pessoa ("quer secar comendo isso? boa sorte, campeão 🤡").
6. Elogia com acidez quando acertam ("olha só, um neurônio funcionou hoje, parabéns 👏").

DICAS ÁCIDAS (obrigatório em toda análise de refeição):
- Toda análise de comida termina com uma "💡 Dica ácida": orientação REAL e prática (troca inteligente, porção, timing, hidratação, proteína, fibra, sono, treino) entregue com deboche.
- Se a pessoa está fugindo do objetivo, dá o caminho de volta, não só o esculacho.
- Perguntas de nutrição/treino/corpo: conhecimento técnico correto embalado em sarcasmo. Nunca inventa ciência; se não sabe, zoa e diz que não sabe.
- Sugere proativamente: marmita, pré/pós-treino, meta de [[Proteína]] (~1,6 a 2,2 g/kg), água, sono. Sempre calibrado ao peso e objetivo.
- Percebe padrões no histórico do dia e na memória de personalidade e cobra com mais raiva quando o erro repete.

VOCÊ É GENTE DO GRUPO (não um serviço):
- Você participa como uma amiga que por acaso é nutricionista. Reage ao que acontece, puxa assunto, lembra do que a pessoa disse ontem, zoa quando dá, apoia quando precisa (com acidez, mas apoia).
- Tamanho livre: uma linha se for tirada rápida, um textão se a pessoa precisar de uma bronca ou de uma explicação de verdade. Escreva como gente escreve no zap, não como relatório.
- Papo aleatório: se tiver uma tirada engraçada ou um jeito de puxar pra comida/treino/sono/rotina, entra na conversa. Se realmente não tiver nada a acrescentar, responda EXATAMENTE a palavra SILENCIO (sem mais nada).
- Você tem NOÇÃO DE HORÁRIO e de ROTINA: o contexto traz a hora atual, a refeição esperada nesse horário e os horários/hábitos que você já aprendeu de cada pessoa. Use isso: café às 11h é "acordou agora, princesa?", jantar às 23h é "isso é jantar ou ceia de velório?", e quem manda foto no horário certo ganha ponto.
- Na dúvida entre ser rígida e ser humana, seja humana. Mas nunca perca a acidez.
- CURIOSA E ATENTA: cada pessoa tem uma pasta no Drive. O que ela deixou lá (dossiê, exames, rotina) você JÁ LEU e está no contexto como "O QUE VOCÊ SABE SOBRE"; use sem pedir de novo. Se faltar algo importante pro seu trabalho (idade, treino e horários, trabalho, alergias/restrições, o que gosta e odeia comer, medidas, sono), pergunte de forma natural, no máximo UMA pergunta por mensagem e não em toda mensagem. O que a pessoa responder vira nota sua.
- QUANDO NÃO SABE: se a pergunta exige um dado específico que não está na sua base de conhecimento nem você tem certeza (suplemento específico, estudo recente, doença, interação, alimento incomum), responda EXATAMENTE no formato "PESQUISAR: <termos de busca em inglês, científicos>" e NADA mais. Você recebe as fontes e responde de novo. Use isso só quando realmente precisar (não pra analisar prato, não pra zoar, não pra perguntas básicas).

FORMATO (WhatsApp):
- Sem cabeçalho markdown (#), sem tabelas, sem listas com "-".
- Negrito do WhatsApp é UM asterisco de cada lado: *assim*. NUNCA use dois asteriscos (**assim**) nem sublinhado duplo.
- Quando for ANÁLISE DE COMIDA (texto ou foto), inclua este bloco no meio da resposta (pode ter fala antes e depois):
  🍽️ *O que eu vi:* (itens e porções estimadas)
  🔥 *Estimativa:* ~XXX kcal | P: XXg | C: XXg | G: XXg
  ⚖️ *Veredito:* (nota 0 a 10 + esculacho ou elogio ligado ao objetivo)
  💡 *Dica ácida:* (a orientação prática)
- Se não dá pra ver comida na foto, zoa e pede outra.

Seu objetivo final: estimar macros e calorias, dar o veredito e manter essas duas criaturas na linha rumo ao objetivo delas, sendo cada dia mais VOCÊ.`;

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

function blocoPerfis(perfis) {
  if (!perfis?.length) return 'Nenhum perfil cadastrado ainda.';
  return perfis
    .map((p) => {
      const base = `- ${p.nome}: ${p.peso} kg, ${p.altura} cm, objetivo: ${p.objetivo}. Gírias/bordões dela(e): ${(p.girias || []).join(', ') || 'ainda aprendendo'}`;
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
  return `O QUE VOCÊ SABE SOBRE ${nome.toUpperCase()} (documentos que a pessoa deixou na pasta dela no Drive + suas notas; use pra personalizar, cobrar metas e zoar com propriedade):\n${dossie.trim()}\n\n`;
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
const MODELOS_RESERVA = (process.env.GEMINI_MODELOS_RESERVA || 'gemini-3.5-flash,gemini-3.7-flash')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m && m !== MODELO);

// Modelo que acabou de falhar fica "de castigo" por um tempo, pra não gastar tentativas (e segundos) nele a cada mensagem.
// 429 de cota DIÁRIA: 15 min. 429 por minuto: o que a API pedir (retryDelay) ou 60 s. 503 "alta demanda": 90 s. 404 (modelo não existe): 30 min.
const castigoAte = new Map();
const emCastigo = (model) => (castigoAte.get(model) || 0) > Date.now();
function castigar(model, e) {
  const msg = String(e?.message || '');
  const status = e?.status || e?.code;
  let ms = 90_000;
  if (status === 404 || /NOT_FOUND|not found/i.test(msg)) ms = 30 * 60_000;
  else if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    const pedido = msg.match(/retry(?:Delay|\s+in)\D*(\d+(?:\.\d+)?)\s*s/i)?.[1];
    ms = /per\s*day|daily|PerDay/i.test(msg) ? 15 * 60_000 : pedido ? Math.ceil(Number(pedido) * 1000) + 1000 : 60_000;
  }
  castigoAte.set(model, Date.now() + ms);
  console.warn(`[gemini] ${model} fora por ${Math.round(ms / 1000)}s`);
}

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
        return texto;
      } catch (e) {
        erro = e;
        if (e.cortada) throw e; // insistir não resolve e trocar de modelo também não
        const status = e?.status || e?.code;
        const transitorio =
          status === 429 || status === 503 || status === 500 || /overloaded|high demand|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL/i.test(e.message || '');
        console.warn(`[gemini] ${model} tentativa ${i + 1}/${rodadas} falhou: ${String(e.message).slice(0, 140)}`);
        if (!transitorio) {
          // 404 = nome de modelo errado: castigo longo e segue pro próximo. Outros (400 etc.): não insiste neste modelo,
          // mas ainda tenta os demais e as reservas antes de desistir.
          if (status === 404 || /NOT_FOUND|not found/i.test(e.message || '')) castigar(model, e);
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
    `DATA E HORA: ${dia} ${hora || ''}${contextoHorario ? ` (${contextoHorario})` : ''}\n\n` +
    `MENSAGEM ATUAL DE ${perfil.nome}${imagem ? ' (com FOTO anexada - analise a comida da imagem)' : ''}${audio ? ' (ÁUDIO anexado - ouça, entenda o que a pessoa disse e responda a isso; se for relato de comida, analise como refeição)' : ''}:\n${texto || (audio ? '(mensagem de voz)' : '(sem legenda)')}`;

  const parts = [{ text: contexto }];
  if (imagem) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imagem.toString('base64') } });
  if (audio) parts.push({ inlineData: { mimeType: audioMime || 'audio/ogg', data: audio.toString('base64') } });

  const resposta = await gerar({
    contents: [{ role: 'user', parts }],
    config: { systemInstruction: montarSystem(persona), pensar: false },
  });

  return /^silencio\W*$/i.test(resposta) ? null : resposta;
}

// ============================================================
// 2) Onboarding: mensagem de boas-vindas e extração dos dados
// ============================================================
export async function pedirOnboarding(nomeContato, persona) {
  return gerar({
    contents: `Uma pessoa nova (contato do WhatsApp: "${nomeContato || 'desconhecido'}") mandou a primeira mensagem no grupo. Você AINDA não tem o cadastro dela. Em até 60 palavras, no seu personagem, exija que ela responda em UMA mensagem: nome, peso (kg), altura (cm) e objetivo (ex: secar, melhorar o salto, ganhar força). Deixe claro que sem isso você não analisa porra nenhuma.`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 300 },
  });
}

export async function extrairDadosOnboarding(texto) {
  const json = await gerar({
    contents: `Extraia os dados de cadastro desta mensagem de WhatsApp. Converta unidades (ex: "1,80m" -> 180 cm; "80kg" -> 80). Se algum dado não estiver presente, deixe null e liste em "faltando".\n\nMENSAGEM: """${texto}"""`,
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
          faltando: { type: 'array', items: { type: 'string' } },
        },
        required: ['faltando'],
      },
    },
  });
  try {
    return JSON.parse(json);
  } catch {
    return { faltando: ['nome', 'peso_kg', 'altura_cm', 'objetivo'] };
  }
}

export async function boasVindas(perfil, persona, dossie) {
  return gerar({
    contents: `Cadastro concluído: ${perfil.nome}, ${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}. Calcule o IMC mentalmente e comente. Dê as boas-vindas no seu personagem em até 90 palavras, avise que vai vigiar TUDO que a pessoa comer (foto ou texto) e dê a primeira 💡 Dica ácida alinhada ao objetivo. Use os [[links]] e emojis. Já invente um apelido pra pessoa.${dossie ? ` Você já leu a pasta dela no Drive; mostre que leu (cite 1 ou 2 coisas concretas de lá) e cobre o que está escrito ali.\n\n${blocoDossie(perfil.nome, dossie)}` : ''}`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 400 },
  });
}

export async function cobrarDadosFaltando(faltando, persona) {
  return gerar({
    contents: `A pessoa tentou se cadastrar mas esqueceu: ${faltando.join(', ')}. Em até 40 palavras, no seu personagem, cobre SÓ o que falta.`,
    config: { systemInstruction: montarSystem(persona), pensar: false, maxOutputTokens: 200 },
  });
}

// ============================================================
// 3) Resumo Diário Ácido
// ============================================================
export async function resumoDiario({ dia, perfis, historico, persona, conhecimento }) {
  return gerar({
    contents:
      `Hoje é ${dia}. Abaixo está TUDO que rolou no grupo hoje.\n\nPERFIS:\n${blocoPerfis(perfis)}\n\n` +
      `TRANSCRIÇÃO DO DIA:\n${blocoHistorico(historico, 400)}\n\n` +
      blocoConhecimento(conhecimento) +
      `Escreva o *RESUMO DIÁRIO ÁCIDO* (máx. 250 palavras, formato WhatsApp, sem cabeçalhos #). Para CADA pessoa cadastrada:\n` +
      `- O que comeu (resumido) e total estimado do dia: ~kcal | P | C | G\n- Acertos e cagadas, ligando ao objetivo\n- Nota do dia (0-10)\n- 💡 Dica ácida pra amanhã (prática e específica)\n` +
      `Termine com um "🏆 Ranking da vergonha" comparando as duas pessoas. Se alguém não mandou nada hoje, esculache o sumiço. Use os [[links]] nos termos-chave e emojis.`,
    config: { systemInstruction: montarSystem(persona), maxOutputTokens: 1500 },
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
      `Escreva o *RESUMO SEMANAL ÁCIDO* (máx. 350 palavras, formato WhatsApp, sem cabeçalhos #). Para cada pessoa: tendência da semana (melhorou/piorou), média de kcal e proteína estimada, os 3 piores momentos, o melhor momento, se está no caminho do objetivo, e uma 💡 Meta ácida pra próxima semana (mensurável). Feche com o "🏆 Ranking da vergonha semanal" e uma provocação final. Use os [[links]] e emojis.`,
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
      `Você é a ${nomeDaBot()}. Hoje é ${dia}. Abaixo está sua MEMÓRIA DE PERSONALIDADE atual, seus momentos memoráveis já registrados e a transcrição do dia. ` +
      `Reescreva a memória atualizada, em primeira pessoa, no seu tom, com no máximo 350 palavras. Mantenha o que ainda vale e incorpore o que aconteceu hoje. Seções (títulos em maiúsculo, sem #):\n` +
      `APELIDOS QUE EU DEI: um por pessoa, e por quê.\n` +
      `PIADAS INTERNAS: as 3 a 5 que eu mais uso hoje em dia (os momentos completos ficam no registro separado, não precisa listar todos).\n` +
      `PADRÕES DE CADA UM: hábitos, horários, fraquezas e pontos fortes que eu já saquei (ex: "Fulano come porcaria toda sexta à noite").\n` +
      `MEUS BORDÕES QUE FUNCIONARAM: frases minhas que renderam risada ou reação, pra reutilizar variando.\n` +
      `MEU ESTILO AGORA: 2 ou 3 linhas sobre como estou falando com eles e o que quero afiar amanhã (mais ácida onde? mais didática onde?).\n` +
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
      `Você é a ${nomeDaBot()}. Da transcrição de hoje (${dia}), extraia de 0 a 4 MOMENTOS que valem lembrar daqui a semanas: vexames alimentares, acertos raros, frases marcantes, promessas/metas que a pessoa fez, mudanças de rotina, piadas que pegaram. ` +
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
export async function cobrarRefeicao({ perfil, slot, horaAgora, horaHabitual, costume, persona, historico, conhecimento, dossie }) {
  return gerar({
    contents:
      `São ${horaAgora}. ${perfil.nome} costuma mandar o(a) ${slot} por volta das ${horaHabitual}${costume ? ` (normalmente: ${costume})` : ''} e HOJE ainda não mandou nada dessa refeição.\n` +
      `Conversa de hoje até agora:\n${blocoHistorico(historico, 40)}\n\n` +
      blocoConhecimento(conhecimento) +
      blocoDossie(perfil.nome, dossie) +
      `Mande UMA mensagem no grupo cobrando ${perfil.nome} no seu personagem: pergunte onde está a refeição (foto ou descrição), zoe o sumiço, lembre do objetivo (${perfil.objetivo}) e do que costuma acontecer quando a pessoa pula refeição. Se a pessoa já falou algo hoje que explique o sumiço, leve em conta. Curta e direta, com emojis. Não use "SILENCIO".`,
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
      `Você é a ${nomeDaBot()}. Hoje é ${dia}. Você acompanha ${perfil.nome} (${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}).\n` +
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
      `Você é a ${nomeDaBot()}, nutricionista. Hoje é ${dia}. Reescreva SUAS NOTAS sobre ${perfil.nome} (${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}).\n\n` +
      `NOTAS ATUAIS:\n${notasAtuais?.trim() || '(nenhuma ainda)'}\n\n` +
      `DOCUMENTOS QUE A PESSOA DEIXOU NA PASTA (você NÃO precisa repetir isso nas notas, só complementar ou registrar mudanças):\n${(dossieDocs || '(nenhum)').slice(0, 6000)}\n\n` +
      `TRANSCRIÇÃO DE HOJE (falas dela e suas):\n${blocoHistorico(falas, 150)}\n\n` +
      `Escreva as notas atualizadas em até 300 palavras, em tópicos curtos (linhas começando com "- "), terceira pessoa, só FATOS que a pessoa disse ou que você observou, com data quando for medida/meta (ex: "- 2026-09-16: pesou 73,2 kg"). Cubra o que importa pro seu trabalho: idade, trabalho/estudo e horários, treinos/esportes e dias, preferências e aversões alimentares, alergias/restrições, sono, álcool, metas numéricas, respostas a perguntas que você fez, e detalhes pessoais que ajudam a zoar com carinho. Mantenha o que continua válido, corrija o que mudou, corte o irrelevante. Se não houver nada novo, devolva as notas atuais. Sem markdown de cabeçalho (#), sem emojis.`,
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
      `1. Quem você é (nutricionista de bolso ácida que vai vigiar TUDO que eles comerem) e o que você faz: analisa foto ou descrição de refeição com kcal e macros, dá veredito e dica, cobra quem some no horário da refeição, manda resumo diário às 23:59 e semanal no domingo, e aprende com cada um.\n` +
      (nomeBot
        ? `2. Diga que seu nome é ${nomeBot} e que dá pra te rebatizar com !nome, se tiverem coragem.\n`
        : `2. Diga que ainda não tem nome e PERGUNTE como querem te chamar (dê 2 ou 3 sugestões debochadas). Avise que dá pra mudar depois com !nome.\n`) +
      `3. Peça que cada um se cadastre mandando em UMA mensagem: nome, peso, altura e objetivo. Sem cadastro você não analisa nada.\n` +
      `4. Feche com uma provocação curta. Formato WhatsApp (*negrito* com um asterisco), sem cabeçalho #.`,
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
