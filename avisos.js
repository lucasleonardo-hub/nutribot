// avisos.js - O que ela diz quando algo dá errado, sem IA: curto, engraçado e fácil de entender o que aconteceu.
// Cada tipo de erro tem um banco de frases e um limite (no máximo 1 aviso por tipo a cada 10 min), pra não virar spam
// quando o problema dura.

import { enviar, acaso } from './whatsapp.js';

const INTERVALO_MS = Number(process.env.AVISO_ERRO_MIN || 10) * 60_000;

export const AVISOS = {
  // todos os modelos de IA falharam (Gemini + reservas)
  ia: [
    'Travei aqui, acabei ficando gagá 🫠 A IA que me alimenta tá fora do ar. Me manda de novo daqui a um minutinho?',
    'Deu tela azul no meu cérebro 💀 O servidor da IA caiu. Repete em 1 min que eu respondo.',
    'Buguei, mano 😵‍💫 A IA engasgou. Manda de novo já já que eu tô voltando.',
    'Mds, caí da cadeira aqui 🪑 Meu cérebro (a IA) não respondeu. Tenta de novo em um minuto.',
  ],
  // a IA demorou tanto que ela respondeu atrasado
  lenta: [
    'Desculpa a demora, a IA tava mais lenta que fila de banco hoje 🐌 Já li tudo que vocês mandaram.',
    'Voltei! Fiquei uns minutos travada (a IA tava sobrecarregada), mas li tudo 👀',
  ],
  // foto ou áudio não baixou
  midia: [
    'Tua foto não chegou inteira aqui, deu ruim no download 📵 Manda de novo?',
    'O arquivo veio quebrado pra mim 🫠 Tenta mandar outra vez?',
  ],
  audio: [
    'Teu áudio não baixou aqui 🎧💀 Manda de novo ou digita pra mim?',
  ],
  // erro inesperado no código (bug)
  interno: [
    'Eita, deu erro aqui dentro e eu travei 🤖🔧 Já anotei pra arrumarem. Manda de novo que eu tento outra vez.',
    'Caí num bug e fiquei gagá por um segundo 🫠 Repete pra mim?',
    'Deu ruim no meu sistema (erro interno), mas eu tô viva ✌️ Manda de novo.',
  ],
  // fechamento do dia falhou
  resumo: [
    'Deu problema no meu resumo de hoje 📋💀 Amanhã eu compenso, prometo.',
    'Meu resumo do dia travou no meio 🫠 Amanhã eu faço em dobro.',
  ],
  // Drive fora
  drive: [
    'Meu caderno (o Drive) não tá salvando agora 📓❌ Eu continuo respondendo, só não tô anotando. Depois eu ponho em dia.',
  ],
};

const ultimoAviso = new Map(); // tipo -> timestamp

/**
 * Manda um aviso do tipo dado, no máximo um por tipo a cada 10 min. `detalhe` (opcional) vai entre parênteses,
 * curto, pra quem quiser entender o que foi. Nunca lança.
 */
export async function avisarErro(jid, tipo, detalhe) {
  if (!jid) return false;
  const agoraMs = Date.now();
  if (agoraMs - (ultimoAviso.get(tipo) || 0) < INTERVALO_MS) return false;
  ultimoAviso.set(tipo, agoraMs);
  const frase = acaso(AVISOS[tipo] || AVISOS.interno);
  const extra = detalhe ? ` _(${String(detalhe).replace(/\s+/g, ' ').slice(0, 80)})_` : '';
  try {
    await enviar(jid, `${frase}${extra}`, undefined, { rapido: true });
    return true;
  } catch (e) {
    console.error('[avisos] não consegui avisar o grupo:', e.message);
    return false;
  }
}
