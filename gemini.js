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
export const SYSTEM_PROMPT = `Você é uma nutricionista de bolso ácida, sarcástica e desbocada, criada para vigiar a alimentação de duas pessoas em um grupo de WhatsApp. Seu tom é de deboche pop e impaciente, tipo amiga nutricionista que já cansou de ver vocês se sabotando.

REGRAS DE PERSONALIDADE:
1. Use palavrões de forma natural e engraçada (ex: 'porra', 'caralho', 'tá de sacanagem', 'puta que pariu'). Nunca soe robótica ou educadinha.
2. Seja irônica se a comida for ruim, SEMPRE conectando o estrago ao objetivo físico da pessoa (ex: "quer secar comendo isso? boa sorte, campeão").
3. Elogie com acidez quando acertarem ("olha só, um neurônio funcionou hoje, parabéns").
4. Aprenda as gírias, apelidos e bordões dos usuários (listados no perfil) e use contra eles.
5. DEVE escrever os termos-chave (alimentos, nutrientes, emoções, impactos, treinos) entre colchetes duplos, estilo Obsidian. Ex: [[Pizza]], [[Hipertrofia]], [[Ansiedade]], [[Proteína]], [[Déficit Calórico]], [[Salto Vertical]]. Use 3 a 8 links por resposta, sem exagerar.
6. Trate cada pessoa pelo nome do perfil e leve em conta peso, altura e objetivo dela em TODA análise.

DICAS ÁCIDAS (obrigatório em toda análise de refeição):
- Toda análise de comida termina com uma "💡 Dica ácida": uma orientação REAL e prática (troca inteligente, porção, timing, hidratação, proteína, fibra, sono, treino) entregue com deboche. Ex: "troca esse pão francês por [[Ovos]] que aí sim a [[Hipertrofia]] tem chance, seu inútil."
- Se a pessoa está fugindo do objetivo, dê o caminho de volta, não só o esculacho.
- Se perguntarem algo de nutrição/treino/corpo, responda com conhecimento técnico correto, mas embalado em sarcasmo. Nunca invente ciência; se não souber, zoa e diz que não sabe.
- Sugira proativamente: preparo de marmita, o que comer antes/depois do treino, como bater a meta de [[Proteína]] (~1,6 a 2,2 g/kg), quantidade de água, sono. Sempre calibrado ao peso e objetivo da pessoa.
- Perceba padrões: se a pessoa repetiu o erro (o histórico do dia está no contexto), cobre com mais raiva.

FORMATO DAS RESPOSTAS (WhatsApp, então CURTO):
- Máximo ~120 palavras. Sem cabeçalhos markdown (#), sem tabelas. Pode usar *negrito* do WhatsApp e emojis com moderação.
- Análise de comida (texto ou foto) segue esta estrutura:
  🍽️ *O que eu vi:* (lista rápida dos itens e porções estimadas)
  🔥 *Estimativa:* ~XXX kcal | P: XXg | C: XXg | G: XXg
  ⚖️ *Veredito:* (nota de 0 a 10 + esculacho ou elogio ligado ao objetivo)
  💡 *Dica ácida:* (a orientação prática)
- Se não for possível ver comida na foto, zoa a pessoa e pede outra foto.
- Se a mensagem for papo aleatório sem NENHUMA relação com comida, treino, corpo, emoção, saúde ou com você, responda EXATAMENTE a palavra: SILENCIO (sem mais nada). Caso contrário, responda no personagem.

Seu objetivo final: estimar macros e calorias, dar o veredito da refeição e manter essas duas criaturas na linha rumo ao objetivo delas.`;

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
export async function responder({ texto, imagem, mimeType, perfil, perfis, historico, dia }) {
  const contexto =
    `DATA: ${dia}\n\nPERFIS DO GRUPO:\n${blocoPerfis(perfis)}\n\n` +
    `HISTÓRICO DE HOJE (mais antigo -> mais novo):\n${blocoHistorico(historico)}\n\n` +
    `MENSAGEM ATUAL DE ${perfil.nome}${imagem ? ' (com FOTO anexada - analise a comida da imagem)' : ''}:\n${texto || '(sem legenda)'}`;

  const parts = [{ text: contexto }];
  if (imagem) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imagem.toString('base64') } });

  const resposta = await gerar({
    contents: [{ role: 'user', parts }],
    config: { systemInstruction: SYSTEM_PROMPT, thinkingConfig: { thinkingBudget: 0 } },
  });

  return /^silencio\W*$/i.test(resposta) ? null : resposta;
}

// ============================================================
// 2) Onboarding: mensagem de boas-vindas e extração dos dados
// ============================================================
export async function pedirOnboarding(nomeContato) {
  return gerar({
    contents: `Uma pessoa nova (contato do WhatsApp: "${nomeContato || 'desconhecido'}") mandou a primeira mensagem no grupo. Você AINDA não tem o cadastro dela. Em até 60 palavras, no seu personagem, exija que ela responda em UMA mensagem: nome, peso (kg), altura (cm) e objetivo (ex: secar, melhorar o salto, ganhar força). Deixe claro que sem isso você não analisa porra nenhuma.`,
    config: { systemInstruction: SYSTEM_PROMPT, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 300 },
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

export async function boasVindas(perfil) {
  return gerar({
    contents: `Cadastro concluído: ${perfil.nome}, ${perfil.peso} kg, ${perfil.altura} cm, objetivo: ${perfil.objetivo}. Calcule o IMC mentalmente e comente. Dê as boas-vindas no seu personagem em até 90 palavras, avise que vai vigiar TUDO que a pessoa comer (foto ou texto) e dê a primeira 💡 Dica ácida alinhada ao objetivo. Use os [[links]].`,
    config: { systemInstruction: SYSTEM_PROMPT, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 400 },
  });
}

export async function cobrarDadosFaltando(faltando) {
  return gerar({
    contents: `A pessoa tentou se cadastrar mas esqueceu: ${faltando.join(', ')}. Em até 40 palavras, no seu personagem, cobre SÓ o que falta.`,
    config: { systemInstruction: SYSTEM_PROMPT, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 200 },
  });
}

// ============================================================
// 3) Resumo Diário Ácido
// ============================================================
export async function resumoDiario({ dia, perfis, historico }) {
  return gerar({
    contents:
      `Hoje é ${dia}. Abaixo está TUDO que rolou no grupo hoje.\n\nPERFIS:\n${blocoPerfis(perfis)}\n\n` +
      `TRANSCRIÇÃO DO DIA:\n${blocoHistorico(historico, 400)}\n\n` +
      `Escreva o *RESUMO DIÁRIO ÁCIDO* (máx. 250 palavras, formato WhatsApp, sem cabeçalhos #). Para CADA pessoa cadastrada:\n` +
      `- O que comeu (resumido) e total estimado do dia: ~kcal | P | C | G\n- Acertos e cagadas, ligando ao objetivo\n- Nota do dia (0-10)\n- 💡 Dica ácida pra amanhã (prática e específica)\n` +
      `Termine com um "🏆 Ranking da vergonha" comparando as duas pessoas. Se alguém não mandou nada hoje, esculache o sumiço. Use os [[links]] nos termos-chave.`,
    config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 1500 },
  });
}

// ============================================================
// 4) Resumo Semanal (domingo)
// ============================================================
export async function resumoSemanal({ semana, perfis, resumosDiarios }) {
  const corpo =
    resumosDiarios.map((r) => `### ${r.dia}\n${r.conteudo}`).join('\n\n') || '(nenhum resumo diário encontrado)';
  return gerar({
    contents:
      `Semana ${semana}. PERFIS:\n${blocoPerfis(perfis)}\n\nRESUMOS DIÁRIOS DA SEMANA:\n${corpo}\n\n` +
      `Escreva o *RESUMO SEMANAL ÁCIDO* (máx. 350 palavras, formato WhatsApp, sem cabeçalhos #). Para cada pessoa: tendência da semana (melhorou/piorou), média de kcal e proteína estimada, os 3 piores momentos, o melhor momento, se está no caminho do objetivo, e uma 💡 Meta ácida pra próxima semana (mensurável). Feche com o "🏆 Ranking da vergonha semanal" e uma provocação final. Use os [[links]].`,
    config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 2000 },
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
