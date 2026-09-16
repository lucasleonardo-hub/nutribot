// gemini.js - A "Nutri de bolso" (Google Gemini via @google/genai)

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';

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

FORMATO (WhatsApp, então CURTO):
- Máximo ~120 palavras. Sem cabeçalho markdown (#), sem tabelas, sem listas com "-".
- Negrito do WhatsApp é UM asterisco de cada lado: *assim*. NUNCA use dois asteriscos (**assim**) nem sublinhado duplo.
- Análise de comida (texto ou foto):
  🍽️ *O que eu vi:* (itens e porções estimadas)
  🔥 *Estimativa:* ~XXX kcal | P: XXg | C: XXg | G: XXg
  ⚖️ *Veredito:* (nota 0 a 10 + esculacho ou elogio ligado ao objetivo)
  💡 *Dica ácida:* (a orientação prática)
- Se não dá pra ver comida na foto, zoa e pede outra.
- Papo aleatório sem NENHUMA relação com comida, treino, corpo, emoção, saúde ou com você: responda EXATAMENTE a palavra SILENCIO (sem mais nada). Caso contrário, responda no personagem.

Seu objetivo final: estimar macros e calorias, dar o veredito e manter essas duas criaturas na linha rumo ao objetivo delas, sendo cada dia mais VOCÊ.`;

/** System prompt + memória de personalidade acumulada (evolui a cada fechamento de dia). */
export function montarSystem(persona) {
  if (!persona?.trim()) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\nSUA MEMÓRIA DE PERSONALIDADE (você construiu isso ao longo dos dias; use pra ser consistente, puxar piadas internas, apelidos e cobrar padrões):\n${persona.trim()}`;
}

// ============================================================
// Helpers
// ============================================================

function blocoPerfis(perfis) {
  if (!perfis?.length) return 'Nenhum perfil cadastrado ainda.';
  return perfis
    .map(
      (p) =>
        `- ${p.nome}: ${p.peso} kg, ${p.altura} cm, objetivo: ${p.objetivo}. Gírias/bordões dela(e): ${(p.girias || []).join(', ') || 'ainda aprendendo'}`
    )
    .join('\n');
}

function blocoHistorico(mensagens, limite = 60) {
  if (!mensagens?.length) return '(nenhuma mensagem ainda hoje)';
  return mensagens
    .slice(-limite)
    .map((m) => `[${m.hora}] ${m.nome}: ${m.texto}`)
    .join('\n');
}

async function gerar({ contents, config = {}, tentativas = 3 }) {
  let erro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await cliente().models.generateContent({
        model: MODELO,
        contents,
        config: { safetySettings: SAFETY, temperature: 0.95, maxOutputTokens: 1024, ...config },
      });
      const texto = res.text?.trim();
      if (!texto) throw new Error(`Gemini respondeu vazio (finishReason: ${res.candidates?.[0]?.finishReason})`);
      return texto;
    } catch (e) {
      erro = e;
      const status = e?.status || e?.code;
      const transitorio =
        status === 429 || status === 503 || /overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(e.message || '');
      console.warn(`[gemini] tentativa ${i + 1} falhou: ${e.message}`);
      if (!transitorio) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw erro;
}

// ============================================================
// 1) Resposta normal do grupo (texto e/ou imagem)
// ============================================================
export async function responder({ texto, imagem, mimeType, perfil, perfis, historico, dia, hora, persona }) {
  const contexto =
    `DATA E HORA: ${dia} ${hora || ''}\n\nPERFIS DO GRUPO:\n${blocoPerfis(perfis)}\n\n` +
    `HISTÓRICO DE HOJE (mais antigo -> mais novo):\n${blocoHistorico(historico)}\n\n` +
    `MENSAGEM ATUAL DE ${perfil.nome}${imagem ? ' (com FOTO anexada - analise a comida da imagem)' : ''}:\n${texto || '(sem legenda)'}`;

  const parts = [{ text: contexto }];
  if (imagem) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imagem.toString('base64') } });

  const resposta = await gerar({
    contents: [{ role: 'user', parts }],
    config: { systemInstruction: montarSystem(persona), thinkingConfig: { thinkingBudget: 0 } },
  });

  return /^silencio\W*$/i.test(resposta) ? null : resposta;
}

// ============================================================
// 2) Onboarding: mensagem de boas-vindas e extração dos dados
// ============================================================
export async function pedirOnboarding(nomeContato, persona) {
  return gerar({
    contents: `Uma pessoa nova (contato do WhatsApp: "${nomeContato || 'desconhecido'}") mandou a primeira mensagem no grupo. Você AINDA não tem o cadastro dela. Em até 60 palavras, no seu personagem, exija que ela responda em UMA mensagem: nome, peso (kg), altura (cm) e objetivo (ex: secar, melhorar o salto, ganhar força). Deixe claro que sem isso você não analisa porra nenhuma.`,
    config: { systemInstruction: montarSystem(persona), thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 300 },
  });
}

export async function extrairDadosOnboarding(texto) {
  const json = await gerar({
    contents: `Extraia os dados de cadastro desta mensagem de WhatsApp. Converta unidades (ex: "1,80m" -> 180 cm; "80kg" -> 80). Se algum dado não estiver presente, deixe null e liste em "faltando".\n\nMENSAGEM: """${texto}"""`,
    config: {
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
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

export async function boasVindas(perfil, persona) {
  return gerar({
    contents: `Cadastro concluído: ${perfil.nome}, ${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}. Calcule o IMC mentalmente e comente. Dê as boas-vindas no seu personagem em até 90 palavras, avise que vai vigiar TUDO que a pessoa comer (foto ou texto) e dê a primeira 💡 Dica ácida alinhada ao objetivo. Use os [[links]] e emojis. Já invente um apelido pra pessoa.`,
    config: { systemInstruction: montarSystem(persona), thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 400 },
  });
}

export async function cobrarDadosFaltando(faltando, persona) {
  return gerar({
    contents: `A pessoa tentou se cadastrar mas esqueceu: ${faltando.join(', ')}. Em até 40 palavras, no seu personagem, cobre SÓ o que falta.`,
    config: { systemInstruction: montarSystem(persona), thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 200 },
  });
}

// ============================================================
// 3) Resumo Diário Ácido
// ============================================================
export async function resumoDiario({ dia, perfis, historico, persona }) {
  return gerar({
    contents:
      `Hoje é ${dia}. Abaixo está TUDO que rolou no grupo hoje.\n\nPERFIS:\n${blocoPerfis(perfis)}\n\n` +
      `TRANSCRIÇÃO DO DIA:\n${blocoHistorico(historico, 400)}\n\n` +
      `Escreva o *RESUMO DIÁRIO ÁCIDO* (máx. 250 palavras, formato WhatsApp, sem cabeçalhos #). Para CADA pessoa cadastrada:\n` +
      `- O que comeu (resumido) e total estimado do dia: ~kcal | P | C | G\n- Acertos e cagadas, ligando ao objetivo\n- Nota do dia (0-10)\n- 💡 Dica ácida pra amanhã (prática e específica)\n` +
      `Termine com um "🏆 Ranking da vergonha" comparando as duas pessoas. Se alguém não mandou nada hoje, esculache o sumiço. Use os [[links]] nos termos-chave e emojis.`,
    config: { systemInstruction: montarSystem(persona), maxOutputTokens: 1500 },
  });
}

// ============================================================
// 4) Resumo Semanal (domingo)
// ============================================================
export async function resumoSemanal({ semana, perfis, resumosDiarios, persona }) {
  const corpo =
    resumosDiarios.map((r) => `### ${r.dia}\n${r.conteudo}`).join('\n\n') || '(nenhum resumo diário encontrado)';
  return gerar({
    contents:
      `Semana ${semana}. PERFIS:\n${blocoPerfis(perfis)}\n\nRESUMOS DIÁRIOS DA SEMANA:\n${corpo}\n\n` +
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
      thinkingConfig: { thinkingBudget: 0 },
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
export async function evoluirPersona({ dia, personaAtual, perfis, historico }) {
  if (!historico?.length) return personaAtual || '';
  return gerar({
    contents:
      `Você é a Nutri. Hoje é ${dia}. Abaixo está sua MEMÓRIA DE PERSONALIDADE atual e a transcrição do dia. ` +
      `Reescreva a memória atualizada, em primeira pessoa, no seu tom, com no máximo 350 palavras. Mantenha o que ainda vale e incorpore o que aconteceu hoje. Seções (títulos em maiúsculo, sem #):\n` +
      `APELIDOS QUE EU DEI: um por pessoa, e por quê.\n` +
      `PIADAS INTERNAS E MOMENTOS: as 5 a 8 melhores histórias/vexames/acertos memoráveis (com data), pra eu puxar depois.\n` +
      `PADRÕES DE CADA UM: hábitos, horários, fraquezas e pontos fortes que eu já saquei (ex: "Fulano come porcaria toda sexta à noite").\n` +
      `MEUS BORDÕES QUE FUNCIONARAM: frases minhas que renderam risada ou reação, pra reutilizar variando.\n` +
      `MEU ESTILO AGORA: 2 ou 3 linhas sobre como estou falando com eles e o que quero afiar amanhã (mais ácida onde? mais didática onde?).\n` +
      `Não invente fatos que não estão na memória ou na transcrição. Se algo antigo ficou irrelevante, corte.\n\n` +
      `PERFIS:\n${blocoPerfis(perfis)}\n\nMEMÓRIA ATUAL:\n${personaAtual?.trim() || '(vazia, hoje é meu primeiro dia com eles)'}\n\n` +
      `TRANSCRIÇÃO DE HOJE:\n${blocoHistorico(historico, 400)}`,
    config: { systemInstruction: SYSTEM_PROMPT, temperature: 0.7, maxOutputTokens: 1200 },
  });
}
