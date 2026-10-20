// whatsapp.js - Conexão com o WhatsApp (Baileys): pareamento por QR, reconexão com backoff, detecção de entrada em grupo,
// envio com pausa humana e alerta de desconexão. Quem decide o que fazer com cada mensagem é mensagens.js (via handlers).

import pino from 'pino';
import { digitandoRecente } from './consciencia.js';
import qrcodeTerminal from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  getContentType,
  jidNormalizedUser,
  WAMessageStubType,
} from '@whiskeysockets/baileys';

import { useMongoAuthState, salvarConfig } from './mongo.js';
import { paraWhatsApp, semLinhaAtualizar } from './util.js';
import { estado } from './estado.js';

const ALERTA_DESCONEXAO_MIN = Number(process.env.ALERTA_DESCONEXAO_MIN) || 10; // sem WhatsApp por mais que isso = alerta no log e no /status
// Cão de guarda: com sessão válida mas sem conseguir conectar por mais que isso, o processo se encerra e o Render sobe outro
// (estado novo em folha). Esperando QR não conta: aí só uma pessoa escaneando resolve.
const REINICIO_SEM_WHATSAPP_MIN = Number(process.env.REINICIO_SEM_WHATSAPP_MIN) || 15;
const URL_PUBLICA = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
const PORT = Number(process.env.PORT) || 3000;

import { protegerNumeros } from './util.js';

export const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

// libsignal (por baixo do Baileys) imprime via console.info cada sessão Signal fechada, objeto inteiro, com chave privada
// dentro ("Closing session: SessionEntry { ... privKey ... }"). Não serve pra nada no log do Render e não é coisa de
// deixar lá: silencia só essas duas mensagens; o resto do console.info segue normal.
{
  const infoOriginal = console.info.bind(console);
  console.info = (...args) => {
    if (typeof args[0] === 'string' && /^(Closing session|Removing old closed session):/.test(args[0])) return;
    infoOriginal(...args);
  };
}

// IDs das mensagens que o próprio bot enviou (pra não responder a si mesmo quando roda no número de um dos usuários)
export const enviadosPeloBot = new Set();

// Pausa "humana" curta antes de responder (0,6 a ~2,5 s, proporcional ao texto). Ritmo sempre igual e instantâneo
// é sinal de automação pro WhatsApp; mas resposta básica não pode demorar. O Gemini já toma o resto do tempo.
function pausaHumana(texto) {
  const base = 600 + Math.min(String(texto || '').length, 300) * 4;
  return base + Math.random() * 700;
}

// Frases instantâneas quando chega foto (sem IA): a pessoa sabe que a Nutri "tá olhando". Pode ser prato, receita ou rótulo.
export const ACKS_FOTO = [
  '👀 Deixa eu ver essa foto...',
  '🔍 Olhando aqui, segura aí.',
  'Hmm, olhando com carinho aqui... 🧐',
  'Já vi. Analisando... 🧮',
  'Peraí, dando zoom. 🔎',
  'Ó a foto chegando. Tô avaliando... 😊',
];
export const acaso = (lista) => lista[Math.floor(Math.random() * lista.length)];

/** Manda texto pro grupo (ou pessoa), no formato do WhatsApp, sem a linha ATUALIZAR, com pausa humana (salvo rapido). */
export async function enviar(jid, texto, quoted, { rapido = false } = {}) {
  const sock = estado.sock;
  if (!sock) throw new Error('WhatsApp ainda não conectado');
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  if (!rapido) await new Promise((r) => setTimeout(r, pausaHumana(texto)));
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  const r = await sock.sendMessage(jid, { text: protegerNumeros(paraWhatsApp(semLinhaAtualizar(texto))) }, quoted ? { quoted } : undefined);
  if (r?.key?.id) {
    enviadosPeloBot.add(r.key.id);
    if (enviadosPeloBot.size > 500) enviadosPeloBot.delete(enviadosPeloBot.values().next().value);
  }
  return r; // a mensagem enviada (key + message), pra quem quiser citá-la depois
}

/** Manda uma imagem (Buffer PNG/JPEG) com legenda opcional. */
export async function enviarImagem(jid, buffer, legenda, quoted) {
  const sock = estado.sock;
  if (!sock) throw new Error('WhatsApp ainda não conectado');
  const r = await sock.sendMessage(jid, { image: buffer, caption: legenda ? protegerNumeros(paraWhatsApp(legenda)) : undefined }, quoted ? { quoted } : undefined);
  if (r?.key?.id) enviadosPeloBot.add(r.key.id);
  return r;
}

/** Manda uma nota de voz (Buffer ogg/opus). */
export async function enviarAudio(jid, buffer, quoted) {
  const sock = estado.sock;
  if (!sock) throw new Error('WhatsApp ainda não conectado');
  await sock.sendPresenceUpdate('recording', jid).catch(() => {});
  const r = await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, quoted ? { quoted } : undefined);
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  if (r?.key?.id) enviadosPeloBot.add(r.key.id);
  return r;
}

/** Reação (emoji) numa mensagem: "vi, já respondo". Nunca lança. */
export async function reagir(jid, key, emoji = '👀') {
  const sock = estado.sock;
  if (!sock || !key) return;
  await sock.sendMessage(jid, { react: { text: emoji, key } }).catch(() => {});
}

/** Baixa a mídia (foto/áudio) de uma mensagem como Buffer. */
export function baixarMidia(msg) {
  return downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: estado.sock.updateMediaMessage });
}

// JIDs do próprio bot (número e LID), normalizados
export const meusJids = () => [estado.sock?.user?.id, estado.sock?.user?.lid].filter(Boolean).map((j) => jidNormalizedUser(j));

/** No privado não há participant: o remetente é o próprio chat (número ou LID; o Baileys 7 traz o outro em remoteJidAlt). */
// Presença dos participantes do grupo (composing/paused): deixa a bot esperar quem ainda está digitando a refeição em partes.
const presencas = new Map(); // jid normalizado -> { estado, em }
export const presencasAtuais = () => presencas;
/** A pessoa (qualquer um dos jids dela) estava digitando ou gravando nos últimos segundos? */
export function estaDigitando(jids, janelaMs = 10_000) {
  return digitandoRecente(presencas, jids, Date.now(), janelaMs);
}
export async function assinarPresenca(jid) {
  if (!estado.sock || !jid) return;
  await estado.sock.presenceSubscribe(jid).catch((e) => console.warn('[wa] presença:', e.message));
}

export function jidsDoPrivado(key) {
  return [...new Set([key.remoteJid, key.remoteJidAlt].filter(Boolean).map((j) => jidNormalizedUser(j)))];
}

export function jidsDoRemetente(key) {
  let lista = [key.participant, key.participantAlt].filter(Boolean).map((j) => jidNormalizedUser(j));
  // Mensagem digitada no próprio celular do bot (fromMe) pode vir sem participant
  if (key.fromMe && !lista.length) lista = meusJids();
  return [...new Set(lista)];
}

// Um participante (string ou objeto {id, phoneNumber, lid}) é o próprio bot?
export function souEu(p) {
  const meus = meusJids();
  const ids = typeof p === 'string' ? [p] : [p?.id, p?.phoneNumber, p?.lid];
  return ids.filter(Boolean).some((j) => meus.includes(jidNormalizedUser(j)));
}

export const numeroDoBot = () => estado.sock?.user?.id || null;
export const nomeNoWhatsApp = () => estado.sock?.user?.name || null;

/** Desvincula o aparelho atual (o próximo start gera QR novo). */
export async function desvincular() {
  await estado.sock?.logout().catch((e) => console.warn('[admin] sock.logout falhou:', e.message));
}

/** Fecha o socket sem deslogar (usado no shutdown). */
export function encerrarSocket() {
  encerrando = true;
  estado.sock?.end?.(undefined);
}

// ---------- reconexão e alerta ----------
let quedasSeguidas = 0; // pra reconectar com espera crescente (3 s, 6 s, 12 s... até 2 min) em vez de martelar o WhatsApp
let encerrando = false;
let desconectadoDesde = Date.now(); // quando o WhatsApp caiu (ou o processo subiu) e ainda não conectou
let ultimoAlertaDesconexao = 0;
let semSessao = false; // sem credenciais registradas = esperando alguém escanear o QR (reiniciar o processo não resolve)
let handlersAtuais = null; // os handlers da última chamada, pra reconectar e pro cão de guarda

export const desconectadoHaMin = () => (desconectadoDesde ? Math.round((Date.now() - desconectadoDesde) / 60_000) : 0);
export const aguardandoQR = () => semSessao;

// ---------- pareamento pelo número (20/10: "você já tem o número dela, faça uma conexão") ----------
// Em vez do QR (que precisa de outra tela), o WhatsApp gera um código de 8 letras pro número da bot; no celular dela:
// Aparelhos conectados > Conectar aparelho > "Conectar com número de telefone". O número fica no Render (WHATSAPP_NUMERO),
// nunca no código (o repositório é público).
const NUMERO_BOT = String(process.env.WHATSAPP_NUMERO || '').replace(/\D/g, '');
let sockIniciadoEm = 0;
let codigoAtual = null; // { codigo, em, sock }
export const temNumeroParaParear = () => NUMERO_BOT.length >= 10;

// ---------- histórico sob pedido (20/10: o resgate fechou antes do histórico chegar e 17 h de grupo ficaram sem resposta) ----------
const ancorasGrupo = new Map(); // jid do grupo -> { key, ts } da mensagem mais recente vista
/**
 * Pede ao celular da bot as `quantas` mensagens do grupo ANTERIORES à mais recente vista (a âncora). O celular precisa
 * estar online; a resposta chega pelo messaging-history.set (tipo ON_DEMAND) e passa pelo aoHistorico de sempre.
 */
export async function pedirHistoricoDoGrupo(jidGrupo, quantas = 50, { desdeMs = 0 } = {}) {
  const ancora = ancorasGrupo.get(jidGrupo);
  if (!ancora) throw new Error('ainda não vi nenhuma mensagem do grupo desde que liguei: mande qualquer mensagem no grupo e tente de novo');
  if (!estado.sock?.fetchMessageHistory) throw new Error('WhatsApp não conectado');
  // o celular responde em páginas (20/10: veio 1 página de 3 mensagens): cada lote do grupo faz pedir a página anterior,
  // a partir da mais antiga recebida, até passar de `desdeMs` ou chegar no teto de páginas
  paginacao = { jid: jidGrupo, desdeMs, quantas, paginas: 1, ultimaId: ancora.key.id };
  await estado.sock.fetchMessageHistory(quantas, ancora.key, ancora.ts);
  return ancora;
}
const MAX_PAGINAS_HISTORICO = 15;
let paginacao = null; // { jid, desdeMs, quantas, paginas, ultimaId }
const HISTORICO_SOB_PEDIDO = 6; // proto.HistorySync.HistorySyncType.ON_DEMAND

/** Lote do histórico sob pedido: pede a página anterior se ainda não chegou no começo do período. */
function continuarPaginacao(messages) {
  const p = paginacao;
  if (!p || !estado.sock?.fetchMessageHistory) return;
  const doGrupo = (messages || []).filter((m) => m?.key?.remoteJid === p.jid && m.key.id && Number(m.messageTimestamp) > 0);
  if (!doGrupo.length) {
    console.log(`[wa] histórico sob pedido, página ${p.paginas}: nenhuma mensagem do grupo nesse lote`);
    paginacao = null;
    return;
  }
  const maisAntiga = doGrupo.reduce((a, b) => (Number(b.messageTimestamp) < Number(a.messageTimestamp) ? b : a));
  const ts = Number(maisAntiga.messageTimestamp) * 1000;
  console.log(`[wa] histórico sob pedido, página ${p.paginas}: ${doGrupo.length} do grupo, a mais antiga de ${new Date(ts).toISOString()}`);
  if (ts <= p.desdeMs || p.paginas >= MAX_PAGINAS_HISTORICO || maisAntiga.key.id === p.ultimaId) {
    paginacao = null;
    return;
  }
  p.paginas++;
  p.ultimaId = maisAntiga.key.id;
  estado.sock
    .fetchMessageHistory(p.quantas, { remoteJid: p.jid, id: maisAntiga.key.id, fromMe: Boolean(maisAntiga.key.fromMe) }, ts)
    .catch((e) => {
      console.warn('[wa] página seguinte do histórico falhou:', e.message);
      paginacao = null;
    });
}

/**
 * Pede ao WhatsApp um código de pareamento pro número da bot. O código só vale enquanto o socket atual estiver de pé
 * (~2 min de ciclo de QR): socket com mais de 40 s é renovado antes, e o mesmo código é devolvido por 50 s (recarregar
 * a página não invalida o que a pessoa já está digitando). Lança com mensagem curta quando não dá.
 */
export async function pedirCodigoPareamento() {
  if (!temNumeroParaParear()) throw new Error('WHATSAPP_NUMERO não está definido no Render');
  if (!semSessao) throw new Error('a sessão já está conectada (ou conectando com sessão salva)');
  if (codigoAtual && codigoAtual.sock === estado.sock && Date.now() - codigoAtual.em < 50_000) return codigoAtual.codigo;
  if (!estado.sock || Date.now() - sockIniciadoEm > 40_000) {
    const antigo = estado.sock;
    antigo?.end?.(new Error('novo socket pro código de pareamento'));
    // espera o socket novo (reconectar) ficar pronto pra pedir o código
    for (let i = 0; i < 40 && (estado.sock === antigo || !estado.sock); i++) await new Promise((ok) => setTimeout(ok, 500));
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  if (!estado.sock) throw new Error('o WhatsApp ainda está iniciando; tente de novo em alguns segundos');
  const codigo = await estado.sock.requestPairingCode(NUMERO_BOT);
  codigoAtual = { codigo, em: Date.now(), sock: estado.sock };
  console.log('[wa] código de pareamento por número gerado (vale ~2 min)');
  return codigo;
}

/**
 * Marca no Mongo QUANDO a sessão caiu de verdade (deslogada / aparelho removido). Sobrevive ao restart: quando alguém
 * escanear o QR de novo, retomada.js usa esta hora pra achar no histórico o que ficou sem resposta. Só grava se ainda
 * não houver uma marca (a primeira queda é a que vale).
 */
async function marcarQueda(motivo) {
  if (estado.config?.desconectadoEm) return;
  const iso = new Date().toISOString();
  try {
    estado.config = await salvarConfig({ desconectadoEm: iso, desconectadoMotivo: motivo });
    estado.config.apresentadoEm ||= {};
    console.log(`[wa] queda da sessão anotada em ${iso} (${motivo}); ao religar, as mensagens perdidas serão resgatadas do histórico`);
  } catch (e) {
    estado.config = { ...(estado.config || {}), desconectadoEm: iso, desconectadoMotivo: motivo };
    console.warn('[wa] não consegui anotar a queda no Mongo (fica só na memória):', e.message);
  }
}

// Reconecta e, se a própria tentativa falhar (Mongo fora na hora, DNS), tenta de novo em 30 s em vez de desistir em silêncio:
// antes, um erro em iniciarWhatsApp() durante a reconexão deixava o bot sem WhatsApp até o próximo deploy.
function reconectar(espera) {
  setTimeout(() => {
    if (encerrando || !handlersAtuais) return;
    iniciarWhatsApp(handlersAtuais).catch((e) => {
      console.error('[wa] falha ao reconectar, tento de novo em 30 s:', e.message);
      reconectar(30_000);
    });
  }, espera);
}

// Alerta de desconexão: a cada minuto, se está fora há mais de ALERTA_DESCONEXAO_MIN, grita no log (a cada 30 min) e aparece no /status
setInterval(() => {
  if (estado.statusConexao === 'conectado' || !desconectadoDesde) return;
  const min = desconectadoHaMin();
  if (min >= ALERTA_DESCONEXAO_MIN && Date.now() - ultimoAlertaDesconexao > 30 * 60_000) {
    ultimoAlertaDesconexao = Date.now();
    console.error(`[alerta] ⚠️ WhatsApp desconectado há ${min} min (estado: ${estado.statusConexao}). Abra ${URL_PUBLICA || 'o serviço'}/qr se precisar escanear de novo.`);
  }
}, 60_000).unref();

/**
 * Cão de guarda da conexão. Chame uma vez no boot. A cada minuto: se há sessão (não é espera de QR) e o WhatsApp está
 * fora há REINICIO_SEM_WHATSAPP_MIN ou mais, chama `aoReiniciar(motivo)` (o index.js salva o que está pendente e encerra
 * o processo com código 1; o Render sobe outro). Socket zumbi, reconexão que nunca completa, estado 'iniciando' preso:
 * tudo cai aqui. Esperando QR nunca reinicia: só uma pessoa escaneando resolve, e o /qr precisa continuar de pé.
 */
export function vigiarConexao({ aoReiniciar }) {
  let disparado = false;
  setInterval(() => {
    if (disparado || encerrando) return;
    if (estado.statusConexao === 'conectado' || !desconectadoDesde) return;
    if (semSessao) return;
    const min = desconectadoHaMin();
    if (min < REINICIO_SEM_WHATSAPP_MIN) return;
    disparado = true;
    const motivo = `WhatsApp fora há ${min} min com sessão válida (estado: ${estado.statusConexao}); reiniciando o processo pra começar limpo`;
    console.error(`[alerta] 🔁 ${motivo}`);
    Promise.resolve(aoReiniciar?.(motivo)).catch((e) => console.error('[alerta] reinício falhou:', e.message));
  }, 60_000).unref();
  console.log(`[wa] cão de guarda ligado: reinicia o processo se ficar ${REINICIO_SEM_WHATSAPP_MIN} min sem WhatsApp com sessão válida`);
}

/**
 * Conecta (e reconecta sozinho). Handlers:
 *  - aoMensagem(msg): mensagem nova a processar
 *  - aoEntrarNoGrupo(jidGrupo, motivo): o bot foi adicionado a um grupo
 *  - aoNovoMembro(jidGrupo, participantes): outra pessoa foi adicionada ao grupo (lista de {id, phoneNumber, lid})
 *  - aoConectar({ foraPorMin, relogada, desdeMs }): conexão aberta; `relogada` = primeira conexão depois de uma queda de
 *    sessão anotada (QR escaneado de novo), `desdeMs` = quando a sessão caiu
 *  - aoHistorico({ messages, syncType, progress }): lote do histórico que o celular manda depois do pareamento
 *  - aoHistoricoCompleto({ syncType, status }): o histórico de um tipo terminou (ou travou)
 */
export async function iniciarWhatsApp(handlers) {
  const { aoMensagem, aoEntrarNoGrupo, aoNovoMembro, aoConectar, aoHistorico, aoHistoricoCompleto } = handlers;
  handlersAtuais = handlers;
  const { state, saveCreds, limparSessao } = await useMongoAuthState();
  // pedido de código pelo número que não terminou: o Baileys grava `me` antes do pareamento, mas a conta (`account`, a
  // assinatura que vem no pair-success) não existe. Com esse `me` pela metade ele tentaria logar e cairia em 401; volta a
  // ser "sem sessão" e o próximo código/QR começa limpo.
  if (state.creds?.me?.id && !state.creds?.account) {
    console.log('[wa] pareamento pelo número não terminou da última vez; começando limpo');
    delete state.creds.me;
    delete state.creds.pairingCode;
  }
  // sem `me` = nunca pareou (ou a sessão foi limpa): vai pedir QR. (creds.registered não serve: o Baileys 7 nunca o liga.)
  semSessao = !state.creds?.me?.id;
  // sem credenciais = vai pedir QR; se ninguém anotou quando a sessão caiu (processo reiniciou no meio), a marca é agora
  if (semSessao) marcarQueda('sem sessão ao iniciar (esperando QR)').catch(() => {});
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  // 20/10: registrado como navegador (Chrome/Ubuntu) e sem pedir o histórico completo, o celular mandava só uma fatia
  // mínima do grupo ao parear (as 13 últimas + a criação) e o pedido sob demanda não ia além; 17 h de refeições ficaram
  // sem resposta. Como aplicativo de computador (Windows/Desktop) com `syncFullHistory`, o celular manda o histórico
  // inteiro (FULL), que fica guardado 3 dias pro !resgatar. WA_HISTORICO_COMPLETO=off volta ao de antes.
  const historicoCompleto = !/^(off|false|0|n[ãa]o)$/i.test(process.env.WA_HISTORICO_COMPLETO || 'on');
  const sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: historicoCompleto ? Browsers.windows('Desktop') : Browsers.ubuntu('Chrome'),
    syncFullHistory: historicoCompleto,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });
  estado.sock = sock;
  sockIniciadoEm = Date.now();

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('presence.update', ({ id, presences }) => {
    for (const [jid, p] of Object.entries(presences || {})) {
      const est = p?.lastKnownPresence;
      if (!est) continue;
      try {
        const j = jidNormalizedUser(jid);
        const antes = presencas.get(j);
        presencas.set(j, { estado: est, em: Date.now(), chat: id });
        // uma linha por mudança de estado (composing -> paused), pra dar pra ver no log que a presença do grupo chega
        if (antes?.estado !== est && (est === 'composing' || est === 'recording')) console.log(`[wa] presença: ${j.split('@')[0]} ${est}`);
      } catch {}
    }
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      estado.ultimoQR = qr;
      estado.statusConexao = 'aguardando QR';
      console.log(`\n[wa] Escaneie o QR abaixo OU abra http://localhost:${PORT}/qr (no Render: ${URL_PUBLICA || 'https://SEU-APP.onrender.com'}/qr)\n`);
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === 'open') {
      estado.ultimoQR = null;
      quedasSeguidas = 0;
      semSessao = false;
      const foraPorMin = desconectadoDesde ? desconectadoHaMin() : 0;
      if (foraPorMin > ALERTA_DESCONEXAO_MIN) console.warn(`[alerta] WhatsApp voltou depois de ${foraPorMin} min fora`);
      desconectadoDesde = null;
      estado.statusConexao = 'conectado';
      console.log('[wa] conectado como', sock.user?.id, sock.user?.name ? `(${sock.user.name})` : '');
      // primeira conexão depois de uma queda de sessão anotada: a retomada vai procurar no histórico o que ficou sem resposta
      const desdeMs = estado.config?.desconectadoEm ? Date.parse(estado.config.desconectadoEm) : 0;
      const relogada = Number.isFinite(desdeMs) && desdeMs > 0;
      if (relogada) console.log(`[wa] religada depois de queda de sessão em ${estado.config.desconectadoEm} (${estado.config.desconectadoMotivo || 'motivo não anotado'})`);
      Promise.resolve(aoConectar?.({ foraPorMin, relogada, desdeMs: relogada ? desdeMs : 0 })).catch((e) => console.error('[wa] erro ao conectar:', e.message));
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const aguardavaQR = estado.statusConexao === 'aguardando QR' || estado.statusConexao === 'gerando QR novo';
      desconectadoDesde ||= Date.now();
      estado.ultimoQR = null; // QR antigo não vale mais; /qr mostra "gerando" até vir outro
      // 408 só é "QR expirou" quando estava esperando QR; com sessão válida, 408 é queda de rede como qualquer outra
      estado.statusConexao = codigo === DisconnectReason.timedOut && aguardavaQR ? 'gerando QR novo' : `desconectado (${codigo})`;
      if (encerrando) return;
      let espera = 3000;
      if (codigo === DisconnectReason.loggedOut) {
        const detalhe = lastDisconnect?.error?.data?.content?.[0]?.attrs?.type || lastDisconnect?.error?.message || '';
        console.log(`[wa] sessão deslogada${detalhe ? ` (${detalhe})` : ''}. Limpando sessão no Mongo e gerando novo QR...`);
        await limparSessao();
        semSessao = true;
        quedasSeguidas = 0;
        await marcarQueda(`sessão deslogada pelo WhatsApp${detalhe ? ` (${detalhe})` : ''}`).catch(() => {});
      } else if (codigo === DisconnectReason.restartRequired || (codigo === DisconnectReason.timedOut && aguardavaQR)) {
        // 515 = reinício normal logo depois de parear; 408 esperando QR = o QR expirou. Nada de backoff aqui.
        espera = 1500;
        quedasSeguidas = 0;
        console.log(codigo === DisconnectReason.restartRequired ? '[wa] reinício pedido pelo WhatsApp (pós-pareamento), reconectando...' : '[wa] QR expirou, gerando outro...');
      } else {
        espera = Math.min(3000 * 2 ** quedasSeguidas, 120_000);
        quedasSeguidas++;
        console.log(`[wa] conexão caiu (${codigo}), reconectando em ${Math.round(espera / 1000)}s...`);
      }
      reconectar(espera);
    }
  });

  // Histórico que o celular manda depois de um pareamento novo (INITIAL_BOOTSTRAP e RECENT): é por aqui que a bot vê
  // o que foi dito no grupo enquanto a sessão estava derrubada (retomada.js decide o que responder).
  sock.ev.on('messaging-history.set', ({ messages, syncType, progress, isLatest }) => {
    const n = messages?.length || 0;
    if (n) console.log(`[wa] histórico recebido: ${n} mensagem(ns) (tipo ${syncType ?? '?'}, progresso ${progress ?? '?'}${isLatest ? ', mais recente' : ''})`);
    if (n && syncType === HISTORICO_SOB_PEDIDO) continuarPaginacao(messages);
    if (n && aoHistorico) {
      try {
        aoHistorico({ messages, syncType, progress, isLatest });
      } catch (e) {
        console.error('[wa] erro ao tratar histórico:', e.message);
      }
    }
  });
  sock.ev.on('messaging-history.status', (s) => {
    console.log(`[wa] histórico tipo ${s?.syncType ?? '?'}: ${s?.status}${s?.explicit === false ? ' (por tempo)' : ''}`);
    try {
      aoHistoricoCompleto?.(s || {});
    } catch (e) {
      console.error('[wa] erro ao fechar histórico:', e.message);
    }
  });

  // Entrou num grupo? Se apresenta. Nesta versão do Baileys a adição chega como mensagem de sistema (stub) no
  // messages.upsert, sem conteúdo; group-participants.update e groups.upsert ficam como caminhos alternativos.
  sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    if (action !== 'add') return;
    const lista = (participants || []).map((p) => (typeof p === 'string' ? { id: p } : p));
    if (lista.some(souEu)) aoEntrarNoGrupo(id, 'adicionada ao grupo');
    else aoNovoMembro?.(id, lista);
  });
  sock.ev.on('groups.upsert', (grupos) => {
    for (const g of grupos || []) if (g?.id?.endsWith('@g.us')) aoEntrarNoGrupo(g.id, 'grupo criado comigo dentro');
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      console.log(`[msg] tipo=${type} chat=${msg.key.remoteJid} fromMe=${msg.key.fromMe} conteudo=${getContentType(msg.message) || (msg.messageStubType ? `stub:${WAMessageStubType[msg.messageStubType]}` : 'vazio')}`);
      // âncora do pedido de histórico (!resgatar): a mensagem mais recente de um grupo, com o horário em ms
      const ts = Number(msg.messageTimestamp) * 1000;
      if (msg.key?.remoteJid?.endsWith('@g.us') && msg.key.id && Number.isFinite(ts) && ts > 0 && ts >= (ancorasGrupo.get(msg.key.remoteJid)?.ts || 0)) {
        ancorasGrupo.set(msg.key.remoteJid, { key: { remoteJid: msg.key.remoteJid, id: msg.key.id, fromMe: Boolean(msg.key.fromMe) }, ts });
      }
    }
    for (const msg of messages) {
      if (!msg.message && msg.messageStubType === WAMessageStubType.GROUP_PARTICIPANT_ADD && msg.key.remoteJid?.endsWith('@g.us')) {
        const adicionados = (msg.messageStubParameters || []).map((p) => {
          try {
            return JSON.parse(p);
          } catch {
            return { id: p };
          }
        });
        if (adicionados.some(souEu)) aoEntrarNoGrupo(msg.key.remoteJid, 'adicionada ao grupo');
        else aoNovoMembro?.(msg.key.remoteJid, adicionados);
        continue;
      }
      // status de contatos e mensagens de protocolo (chaves, sincronização) não são conversa: fora da fila. Dentro dela,
      // elas roubavam o lugar de "última do lote" e a menção de verdade virava só histórico (04/10 13:11, sem resposta).
      if (msg.key.remoteJid === 'status@broadcast') continue;
      const tipoConteudo = getContentType(msg.message);
      if (tipoConteudo && /^(protocolMessage|senderKeyDistributionMessage|reactionMessage|pollUpdateMessage|keepInChatMessage)$/.test(tipoConteudo)) continue;
      // 'notify' = mensagem nova (de outra pessoa, ou digitada no celular do próprio bot: fromMe sem estar em enviadosPeloBot).
      // 'append' é mensagem antiga (histórico/offline): depois de um pareamento novo o WhatsApp despeja as falas antigas
      // da própria bot como append+fromMe, e tratá-las como "digitadas agora" faria ela se cadastrar e responder a si mesma.
      if (type === 'notify' && (!msg.key.fromMe || !enviadosPeloBot.has(msg.key.id))) aoMensagem(msg);
    }
  });
}
