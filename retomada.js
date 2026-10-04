// retomada.js - O que a bot faz quando volta depois de ter ficado FORA do WhatsApp (sessão derrubada, QR escaneado de novo).
//
// Quando o aparelho vinculado é removido (401 device_removed / loggedOut), o WhatsApp não guarda as mensagens que
// chegaram nesse meio tempo pro aparelho novo: ao parear de novo, tudo que foi dito no grupo durante a queda só chega
// pelo histórico (messaging-history.set) que o celular manda logo depois do pareamento. Este módulo:
//   1. guarda em `config.desconectadoEm` o instante em que a sessão caiu (sobrevive ao restart do processo);
//   2. ao religar, separa do histórico o que foi dirigido a ela nesse período (menção, resposta a uma fala dela,
//      nome dela no texto, foto ou áudio) e devolve pra fila como mensagens "resgatadas";
//   3. a primeira resgatada leva um pedido de desculpas pela demora (mensagens.js monta a nota pro modelo);
//   4. se o histórico não trouxe nada do grupo (celular não mandou), ela avisa no grupo que voltou e pede pra repetirem.
// Nada aqui chama IA: é seleção em código, testável sem WhatsApp (test/retomada.test.mjs).

import { extractMessageContent, jidNormalizedUser, toNumber } from '@whiskeysockets/baileys';
import { mencionaNome } from './util.js';

export const RESGATE_MAX = Number(process.env.RESGATE_MAX) || 6; // teto de mensagens respondidas de uma vez ao voltar
export const RESGATE_IDADE_MAX_H = Number(process.env.RESGATE_IDADE_MAX_H) || 48; // mais velho que isso nem no resgate
export const ATRASO_DESCULPAS_MIN = Number(process.env.ATRASO_DESCULPAS_MIN) || 15; // responder depois disso = pedir desculpas

/** Segundos da mensagem (Long do protobuf, número ou string) como número. */
export function segundosDaMensagem(msg) {
  const t = msg?.messageTimestamp;
  if (t == null) return 0;
  if (typeof t === 'object') return Number(toNumber(t)) || 0;
  return Number(t) || 0;
}

/** Texto visível da mensagem (texto, legenda da foto) ou ''. */
export function textoDaMensagem(msg) {
  const c = extractMessageContent(msg?.message);
  return String(c?.conversation || c?.extendedTextMessage?.text || c?.imageMessage?.caption || '').trim();
}

/**
 * A mensagem foi dirigida à bot (ou é algo que ela sempre analisa)?
 *   - menção (@) a um dos jids dela, ou resposta citando uma fala dela
 *   - nome dela (ou "nutri") no texto
 *   - foto ou áudio (refeição: ela analisa mesmo sem ser chamada)
 * @returns {'mencao'|'resposta-a-ela'|'nome'|'midia'|null}
 */
export function motivoDoResgate(msg, { meusJids = [], nomeBot = '' } = {}) {
  const c = extractMessageContent(msg?.message);
  if (!c) return null;
  if (c.imageMessage || c.audioMessage) return 'midia';
  const texto = textoDaMensagem(msg);
  const ctx = c.extendedTextMessage?.contextInfo || c.imageMessage?.contextInfo;
  const meus = meusJids.map((j) => jidNormalizadoSeguro(j)).filter(Boolean);
  const mencionados = (ctx?.mentionedJid || []).map((j) => jidNormalizadoSeguro(j));
  if (mencionados.some((j) => meus.includes(j))) return 'mencao';
  if (ctx?.participant && meus.includes(jidNormalizadoSeguro(ctx.participant))) return 'resposta-a-ela';
  if (texto && ((nomeBot && mencionaNome(texto, nomeBot)) || /\bnutri\b/i.test(texto))) return 'nome';
  return null;
}

function jidNormalizadoSeguro(j) {
  try {
    return jidNormalizedUser(j);
  } catch {
    return String(j || '');
  }
}

/**
 * Separa, do histórico recebido ao religar, o que ela precisa responder agora.
 * @param {object[]} mensagens  WAMessage[] (vindas de messaging-history.set, em qualquer ordem, com repetição)
 * @param {object} opts
 * @param {number} opts.desdeMs   instante em que a sessão caiu (ms) — só o que chegou DEPOIS conta
 * @param {number} [opts.ateMs]   instante em que a conexão reabriu — o que chegou depois disso veio ao vivo e já foi tratado
 * @param {number} [opts.agoraMs]
 * @param {string} opts.grupo     jid do grupo dela
 * @param {string[]} opts.meusJids
 * @param {string} opts.nomeBot
 * @param {number} [opts.max]
 * @returns {{ resgatadas: object[], vistasDoGrupo: number, motivos: string[] }}
 *   resgatadas: em ordem cronológica, cada uma com `_resgatada: true`, `_liberada: true` e `_motivoResgate`
 *   vistasDoGrupo: quantas mensagens do grupo (de outros, no período) o histórico trouxe — 0 = o celular não mandou nada
 */
export function selecionarResgate(mensagens, { desdeMs, ateMs = Infinity, agoraMs = Date.now(), grupo, meusJids = [], nomeBot = '', max = RESGATE_MAX } = {}) {
  const vistos = new Set();
  const doGrupo = [];
  const limiteIdadeS = RESGATE_IDADE_MAX_H * 3600;
  for (const m of mensagens || []) {
    if (!m?.key || m.key.remoteJid !== grupo) continue;
    if (m.key.fromMe) continue;
    if (!m.message) continue; // stub de sistema (entrou/saiu), apagada, etc.
    const id = m.key.id || '';
    if (id && vistos.has(id)) continue;
    const s = segundosDaMensagem(m);
    if (!s || s * 1000 <= desdeMs) continue; // antes da queda: a bot já viu (ou já respondeu) na época
    if (s * 1000 > ateMs) continue; // depois de religar: chegou ao vivo pelo caminho normal, não é resgate
    if (agoraMs / 1000 - s > limiteIdadeS) continue;
    if (id) vistos.add(id);
    doGrupo.push(m);
  }
  doGrupo.sort((a, b) => segundosDaMensagem(a) - segundosDaMensagem(b));
  const candidatas = [];
  for (const m of doGrupo) {
    const motivo = motivoDoResgate(m, { meusJids, nomeBot });
    if (!motivo) continue;
    const texto = textoDaMensagem(m);
    if (motivo !== 'midia' && texto.startsWith('!')) continue; // comando antigo não se executa horas depois
    candidatas.push({ m, motivo });
  }
  // quando passa do teto, ficam as MAIS RECENTES (as antigas já perderam o momento)
  const escolhidas = candidatas.slice(-max);
  const resgatadas = escolhidas.map(({ m, motivo }) => Object.assign(m, { _resgatada: true, _liberada: true, _motivoResgate: motivo }));
  return { resgatadas, vistasDoGrupo: doGrupo.length, motivos: escolhidas.map((e) => e.motivo) };
}

/** "há 5 h", "há 25 min", "há 2 dias": pro texto da nota ao modelo e pro log. */
export function descreverAtraso(minutos) {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `há ${m} min`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r >= 10 ? `há ${h} h e ${r} min` : `há ${h} h`;
  }
  return `há ${Math.round(m / 1440)} dias`;
}

/**
 * Nota que entra no contexto do modelo quando a resposta sai muito depois da mensagem (bot fora do ar).
 * `primeira`: só a primeira mensagem respondida depois da volta pede desculpas; as seguintes só não fingem que foi agora.
 * @returns {string} vazio quando o atraso é pequeno
 */
export function notaDeAtraso(minutos, { primeira = true, motivo = '' } = {}) {
  if (!(minutos >= ATRASO_DESCULPAS_MIN)) return '';
  const quando = descreverAtraso(minutos);
  const causa = motivo ? ` (${motivo})` : '';
  if (primeira) {
    return (
      `ATENÇÃO: esta mensagem foi enviada ${quando} e você só está vendo AGORA, porque ficou fora do ar${causa}. ` +
      `Comece a resposta pedindo desculpas pela demora, de forma breve, sincera e no seu jeito (uma frase; sem drama e sem explicar detalhe técnico), ` +
      `depois responda normalmente ao que a pessoa disse. Se a pessoa falou de uma refeição, considere que já passou tempo: não trate como "agora".`
    );
  }
  return (
    `ATENÇÃO: esta mensagem também foi enviada ${quando} (você estava fora do ar${causa}) e você JÁ pediu desculpas pela demora na resposta anterior: ` +
    `não peça de novo; responda direto, sem fingir que a mensagem acabou de chegar.`
  );
}

/**
 * Minutos entre o envio da mensagem e agora (0 quando a mensagem não tem hora).
 */
export function atrasoEmMinutos(msg, agoraMs = Date.now()) {
  const s = segundosDaMensagem(msg);
  if (!s) return 0;
  return Math.max(0, (agoraMs / 1000 - s) / 60);
}

/** Aviso que ela manda no grupo quando voltou de uma queda longa e o histórico não trouxe nada (sem IA). */
export function avisoDeVolta(minutosFora) {
  const quanto = descreverAtraso(minutosFora).replace(/^há /, '');
  return `Voltei! 🙋‍♀️ Fiquei fora do ar por ${quanto} (meu WhatsApp caiu e precisou ser religado), desculpa a demora. Se alguém me chamou ou mandou foto nesse meio tempo, manda de novo que eu respondo agora. 🙏`;
}

export const RESGATE_ESPERA_MS = Number(process.env.RESGATE_ESPERA_MS) || 60_000; // quanto esperar o histórico depois de religar
export const AVISO_VOLTA_MIN = Number(process.env.AVISO_VOLTA_MIN) || 30; // fora por menos que isso: volta em silêncio
const TIPO_RECENT = 2; // proto.HistorySync.HistorySyncType.RECENT (INITIAL_BOOTSTRAP = 0)

/**
 * Orquestra a volta: abre uma janela ao religar, junta o histórico que chegar, e ao fechar (RECENT completo ou
 * RESGATE_ESPERA_MS) devolve pra fila o que ficou sem resposta. Dependências injetadas pra ser testável sem WhatsApp.
 * @param {object} deps
 * @param {() => string} deps.grupo            jid do grupo dela (agora)
 * @param {() => string[]} deps.meusJids
 * @param {() => string} deps.nomeBot
 * @param {(msgs: object[]) => number|Promise<number>} deps.enfileirar      mensagens.js enfileirarResgatadas
 * @param {(jid: string, texto: string) => Promise} deps.enviar
 * @param {() => Promise} deps.limparMarca     apaga config.desconectadoEm (a queda foi tratada)
 * @param {() => number} [deps.agora]
 */
export function criarRetomada({ grupo, meusJids, nomeBot, enfileirar, enviar, limparMarca, agora = Date.now }) {
  let janela = null; // { desdeMs, ateMs, buffer, timer }

  async function concluir(porque) {
    if (!janela) return null;
    const { desdeMs, ateMs, buffer, timer } = janela;
    janela = null;
    clearTimeout(timer);
    const agoraMs = agora();
    const minutosFora = Math.max(0, (ateMs - desdeMs) / 60_000);
    const jidGrupo = grupo();
    const r = selecionarResgate(buffer, { desdeMs, ateMs, agoraMs, grupo: jidGrupo, meusJids: meusJids(), nomeBot: nomeBot() });
    console.log(`[retomada] fechando (${porque}): fora por ${descreverAtraso(minutosFora).replace(/^há /, '')}, ${buffer.length} mensagem(ns) no histórico, ${r.vistasDoGrupo} do grupo no período, ${r.resgatadas.length} pra responder${r.motivos.length ? ` (${r.motivos.join(', ')})` : ''}`);
    let acao = 'silencio';
    if (r.resgatadas.length) {
      const n = await enfileirar(r.resgatadas);
      acao = n ? 'resgate' : 'silencio';
    } else if (jidGrupo && minutosFora >= AVISO_VOLTA_MIN && r.vistasDoGrupo === 0) {
      // o celular não mandou o histórico do grupo: ela não sabe se foi chamada, então avisa que voltou e pede pra repetirem
      await enviar(jidGrupo, avisoDeVolta(minutosFora)).catch((e) => console.error('[retomada] aviso de volta falhou:', e.message));
      acao = 'aviso';
    }
    await limparMarca().catch((e) => console.error('[retomada] não consegui apagar a marca da queda:', e.message));
    return { ...r, minutosFora, acao };
  }

  return {
    /** Chame no 'open'. Só abre a janela quando foi uma volta de queda de sessão (relogada). */
    aoConectar({ relogada, desdeMs }) {
      if (!relogada || !desdeMs) return false;
      if (janela) clearTimeout(janela.timer);
      janela = { desdeMs, ateMs: agora(), buffer: [], timer: setTimeout(() => concluir('tempo esgotado').catch(() => {}), RESGATE_ESPERA_MS) };
      janela.timer.unref?.();
      console.log(`[retomada] religada; esperando o histórico por até ${Math.round(RESGATE_ESPERA_MS / 1000)} s pra resgatar o que ficou sem resposta desde ${new Date(desdeMs).toISOString()}`);
      return true;
    },
    aoHistorico({ messages }) {
      if (!janela || !messages?.length) return;
      janela.buffer.push(...messages);
    },
    aoHistoricoCompleto({ syncType, status }) {
      if (!janela) return;
      if (syncType === TIPO_RECENT && (status === 'complete' || status === 'paused')) concluir(`histórico recente ${status}`).catch(() => {});
    },
    aberta: () => Boolean(janela),
    concluir,
  };
}
