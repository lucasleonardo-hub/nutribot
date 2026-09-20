// whatsapp.js - Conexão com o WhatsApp (Baileys): pareamento por QR, reconexão com backoff, detecção de entrada em grupo,
// envio com pausa humana e alerta de desconexão. Quem decide o que fazer com cada mensagem é mensagens.js (via handlers).

import pino from 'pino';
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

import { useMongoAuthState } from './mongo.js';
import { paraWhatsApp, semLinhaAtualizar } from './util.js';
import { estado } from './estado.js';

const ALERTA_DESCONEXAO_MIN = Number(process.env.ALERTA_DESCONEXAO_MIN) || 10; // sem WhatsApp por mais que isso = alerta no log e no /status
const URL_PUBLICA = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
const PORT = Number(process.env.PORT) || 3000;

export const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

// IDs das mensagens que o próprio bot enviou (pra não responder a si mesmo quando roda no número de um dos usuários)
export const enviadosPeloBot = new Set();

// Pausa "humana" curta antes de responder (0,6 a ~2,5 s, proporcional ao texto). Ritmo sempre igual e instantâneo
// é sinal de automação pro WhatsApp; mas resposta básica não pode demorar. O Gemini já toma o resto do tempo.
function pausaHumana(texto) {
  const base = 600 + Math.min(String(texto || '').length, 300) * 4;
  return base + Math.random() * 700;
}

// Frases instantâneas quando chega foto de comida (sem IA): a pessoa sabe que a Nutri "tá olhando"
export const ACKS_FOTO = [
  '👀 Deixa eu ver esse prato...',
  '🔍 Analisando essa refeição, segura aí.',
  'Hmm, olhando com carinho aqui... 🧐',
  'Calma que eu tô olhando essa comida. 👀🍽️',
  'Já vi. Fazendo as contas... 🧮',
  'Peraí, dando zoom no prato. 🔎',
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
  const r = await sock.sendMessage(jid, { text: paraWhatsApp(semLinhaAtualizar(texto)) }, quoted ? { quoted } : undefined);
  if (r?.key?.id) {
    enviadosPeloBot.add(r.key.id);
    if (enviadosPeloBot.size > 500) enviadosPeloBot.delete(enviadosPeloBot.values().next().value);
  }
}

/** Baixa a mídia (foto/áudio) de uma mensagem como Buffer. */
export function baixarMidia(msg) {
  return downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: estado.sock.updateMediaMessage });
}

// JIDs do próprio bot (número e LID), normalizados
export const meusJids = () => [estado.sock?.user?.id, estado.sock?.user?.lid].filter(Boolean).map((j) => jidNormalizedUser(j));

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

export const desconectadoHaMin = () => (desconectadoDesde ? Math.round((Date.now() - desconectadoDesde) / 60_000) : 0);

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
 * Conecta (e reconecta sozinho). Handlers:
 *  - aoMensagem(msg): mensagem nova a processar
 *  - aoEntrarNoGrupo(jidGrupo, motivo): o bot foi adicionado a um grupo
 *  - aoConectar(): conexão aberta
 */
export async function iniciarWhatsApp({ aoMensagem, aoEntrarNoGrupo, aoConectar }) {
  const { state, saveCreds, limparSessao } = await useMongoAuthState();
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  const sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });
  estado.sock = sock;

  sock.ev.on('creds.update', saveCreds);

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
      if (desconectadoDesde && Date.now() - desconectadoDesde > ALERTA_DESCONEXAO_MIN * 60_000) {
        console.warn(`[alerta] WhatsApp voltou depois de ${desconectadoHaMin()} min fora`);
      }
      desconectadoDesde = null;
      estado.statusConexao = 'conectado';
      console.log('[wa] conectado como', sock.user?.id, sock.user?.name ? `(${sock.user.name})` : '');
      Promise.resolve(aoConectar?.()).catch((e) => console.error('[wa] erro ao conectar:', e.message));
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const aguardavaQR = estado.statusConexao === 'aguardando QR' || estado.statusConexao === 'gerando QR novo';
      desconectadoDesde ||= Date.now();
      estado.ultimoQR = null; // QR antigo não vale mais; /qr mostra "gerando" até vir outro
      estado.statusConexao = codigo === DisconnectReason.timedOut ? 'gerando QR novo' : `desconectado (${codigo})`;
      if (encerrando) return;
      let espera = 3000;
      if (codigo === DisconnectReason.loggedOut) {
        console.log('[wa] sessão deslogada. Limpando sessão no Mongo e gerando novo QR...');
        await limparSessao();
        quedasSeguidas = 0;
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
      setTimeout(() => iniciarWhatsApp({ aoMensagem, aoEntrarNoGrupo, aoConectar }).catch((e) => console.error('[wa] falha ao reconectar:', e.message)), espera);
    }
  });

  // Entrou num grupo? Se apresenta. Nesta versão do Baileys a adição chega como mensagem de sistema (stub) no
  // messages.upsert, sem conteúdo; group-participants.update e groups.upsert ficam como caminhos alternativos.
  sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    if (action !== 'add') return;
    if ((participants || []).some(souEu)) aoEntrarNoGrupo(id, 'adicionada ao grupo');
  });
  sock.ev.on('groups.upsert', (grupos) => {
    for (const g of grupos || []) if (g?.id?.endsWith('@g.us')) aoEntrarNoGrupo(g.id, 'grupo criado comigo dentro');
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      console.log(`[msg] tipo=${type} chat=${msg.key.remoteJid} fromMe=${msg.key.fromMe} conteudo=${getContentType(msg.message) || (msg.messageStubType ? `stub:${WAMessageStubType[msg.messageStubType]}` : 'vazio')}`);
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
        continue;
      }
      // 'notify' = mensagem nova de outra pessoa; 'append' + fromMe = digitada no celular do próprio bot
      if (type === 'notify' || (msg.key.fromMe && !enviadosPeloBot.has(msg.key.id))) aoMensagem(msg);
    }
  });
}
