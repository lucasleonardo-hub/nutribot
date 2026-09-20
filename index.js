// index.js - NutriBot: nutricionista de bolso (simpática, sincera e engraçada) no WhatsApp
// Baileys (WhatsApp) + MongoDB Atlas (sessão/perfis) + Gemini (IA) + Google Drive (cérebro .md)

import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import cron from 'node-cron';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  extractMessageContent,
  getContentType,
  jidNormalizedUser,
  WAMessageStubType,
} from '@whiskeysockets/baileys';

import {
  conectarMongo,
  useMongoAuthState,
  buscarPerfil,
  salvarPerfil,
  listarPerfis,
  apagarPerfil,
  carregarMemoria,
  persistirMemoria,
  carregarPersona,
  salvarPersona,
  registrarRefeicao,
  refeicoesDesde,
  refeicoesDoDia,
  lerConfig,
  salvarConfig,
  garantirIndices,
  fecharMongo,
  registrarMomentos,
  momentosRecentes,
} from './mongo.js';
import { iniciarDrive, salvarMarkdown, lerMarkdown, registrarLog, frontmatter, mdDiario, mdMomento, mdPerfil } from './drive.js';
import * as ia from './gemini.js';
import { carregarConhecimento, docsPara, atualizarConhecimento, listarDocs, salvarPesquisa } from './conhecimento.js';
import { pesquisar, formatarFontes } from './pesquisa.js';
import { dossieDe, notasDe, salvarNotas, salvarFicha, listarDocumentosDe } from './pessoas.js';
import { compilarRefeicoes } from './resumo.js';

// ============================================================
// Configuração
// ============================================================
const TZ = process.env.TZ || 'America/Sao_Paulo';
const PORT = Number(process.env.PORT) || 3000;
const GRUPO_PERMITIDO = (process.env.ALLOWED_GROUP_ID || '').trim(); // vazio = responde em qualquer grupo
const MANTER_COLCHETES = process.env.MANTER_COLCHETES_NO_ZAP === 'true';
const IDADE_MAX_MSG_S = 6 * 60 * 60; // ignora mensagens com mais de 6h (flood após o bot voltar do sleep)
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim(); // protege /logout e /status
// URL pública do serviço. O Render preenche RENDER_EXTERNAL_URL sozinho; KEEPALIVE_URL serve pra outros hosts.
const KEEPALIVE_URL = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
const KEEPALIVE_MIN = Number(process.env.KEEPALIVE_MINUTES) || 10; // Render free dorme após 15 min sem tráfego

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

// ============================================================
// Data / hora no fuso certo
// ============================================================
function fusoValido(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('sv-SE', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
const fusoDe = (perfil) => (fusoValido(perfil?.fuso) ? perfil.fuso : TZ);

function agora(tz = TZ) {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());
  const g = (t) => partes.find((p) => p.type === t)?.value;
  return {
    dia: `${g('year')}-${g('month')}-${g('day')}`,
    hora: `${g('hour')}:${g('minute')}`,
    horaArquivo: `${g('hour')}-${g('minute')}-${g('second')}`,
    domingo: g('weekday')?.toLowerCase().startsWith('sun') || g('weekday')?.toLowerCase().startsWith('dom'),
  };
}

function semanaISO(diaStr) {
  const d = new Date(`${diaStr}T12:00:00Z`);
  const diaSemana = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana);
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d - inicioAno) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

function diaSeguinte(diaStr) {
  const d = new Date(`${diaStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function diasAnteriores(diaStr, n) {
  const base = new Date(`${diaStr}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

// ============================================================
// Refeições e horários
// ============================================================
const SLOTS = [
  { id: 'cafe', nome: 'café da manhã', ini: 5 * 60, fim: 10 * 60 + 30, padrao: 8 * 60 + 30, cobrar: true },
  { id: 'almoco', nome: 'almoço', ini: 10 * 60 + 30, fim: 14 * 60 + 30, padrao: 12 * 60 + 30, cobrar: true },
  { id: 'lanche', nome: 'lanche da tarde', ini: 14 * 60 + 30, fim: 18 * 60, padrao: 16 * 60, cobrar: false },
  { id: 'jantar', nome: 'jantar', ini: 18 * 60, fim: 22 * 60 + 30, padrao: 20 * 60, cobrar: true },
  { id: 'ceia', nome: 'ceia', ini: 22 * 60 + 30, fim: 29 * 60, padrao: 23 * 60, cobrar: false }, // até 5h
];
const ATRASO_COBRANCA_MIN = Number(process.env.ATRASO_COBRANCA_MIN) || 75; // minutos depois do horário habitual
const JANELA_COBRANCA_MIN = Number(process.env.JANELA_COBRANCA_MIN) || 120; // depois disso não cobra mais (fica pro resumo do dia)
const DIAS_ROTINA = 21; // janela pra aprender horários
const PAPO_INTERVALO_MIN = Number(process.env.PAPO_INTERVALO_MIN) || 10; // papo aleatório: ela entra no máximo 1x a cada N min

const minutosDe = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const hhmmDe = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function slotDaHora(hhmm) {
  let min = minutosDe(hhmm);
  if (min < 5 * 60) min += 24 * 60; // madrugada conta como ceia do dia anterior
  return SLOTS.find((s) => min >= s.ini && min < s.fim) || SLOTS[SLOTS.length - 1];
}

const mediana = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

/** Horário habitual de cada refeição pra uma pessoa, a partir do que ela já mandou (mediana; precisa de 3+ registros). */
function horariosHabituais(refeicoes) {
  const out = {};
  for (const s of SLOTS) {
    const mins = refeicoes.filter((r) => r.slot === s.id).map((r) => r.minutos);
    out[s.id] = { minutos: mins.length >= 3 ? mediana(mins) : s.padrao, aprendido: mins.length >= 3, amostras: mins.length };
  }
  return out;
}

function descreverHorarios(hab) {
  return SLOTS.filter((s) => s.cobrar || hab[s.id].aprendido)
    .map((s) => `${s.nome} ~${hhmmDe(hab[s.id].minutos)}${hab[s.id].aprendido ? '' : ' (chute, ainda aprendendo)'}`)
    .join(', ');
}

async function enriquecerPerfis(perfis, dia) {
  const desde = diasAnteriores(dia, DIAS_ROTINA)[0];
  return Promise.all(
    perfis.map(async (p) => {
      const refs = await refeicoesDesde(p.jids, desde).catch(() => []);
      const hab = horariosHabituais(refs);
      return { ...p, horarios: descreverHorarios(hab), _hab: hab, _refs: refs };
    })
  );
}

// ============================================================
// Memória do dia (RAM + backup no Mongo)
// ============================================================
let memoria = { dia: agora().dia, grupo: GRUPO_PERMITIDO || null, mensagens: [], cobrancas: {} };
let fechandoDia = false;
let persona = ''; // memória de personalidade da Nutri (evolui a cada fechamento de dia)
let config = { apresentadoEm: {} }; // { nomeBot, apresentadoEm: { [jidGrupo]: ISO }, aguardandoNomeDesde }

async function lembrar(entrada) {
  memoria.mensagens.push(entrada);
  if (memoria.mensagens.length > 600) memoria.mensagens.splice(0, memoria.mensagens.length - 600);
  persistirMemoria(memoria).catch((e) => console.error('[memoria] falha ao persistir:', e.message));
  agendarDiario();
}

// Daily note no Drive (Diario/YYYY-MM-DD.md): regerada a partir da memória do dia, no máximo uma escrita a cada 30 s.
// Substitui o arquivo-por-mensagem: 1 chamada ao Drive em vez de 3 por mensagem, e sem corrida de pasta duplicada.
const DIARIO_DEBOUNCE_MS = 30_000;
let diarioTimer = null;
let diarioSujo = false;
function agendarDiario() {
  diarioSujo = true;
  if (diarioTimer) return;
  diarioTimer = setTimeout(() => {
    diarioTimer = null;
    gravarDiario().catch((e) => console.error('[drive] falha ao salvar diário:', e.message));
  }, DIARIO_DEBOUNCE_MS);
  diarioTimer.unref?.();
}
async function gravarDiario(snapshot = memoria) {
  if (!diarioSujo && snapshot === memoria) return;
  diarioSujo = false;
  if (!snapshot.mensagens?.length) return;
  await salvarMarkdown('Diario', `${snapshot.dia}.md`, mdDiario({ dia: snapshot.dia, mensagens: snapshot.mensagens, nomeBot: ia.nomeDaBot() }));
}

// ============================================================
// Servidor anti-sleep + QR na web
// ============================================================
const app = express();
let ultimoQR = null;
let statusConexao = 'iniciando';

app.get('/ping', (_req, res) => res.send('pong'));
app.get('/', (_req, res) =>
  res.json({ status: statusConexao, dia: memoria.dia, mensagensHoje: memoria.mensagens.length, grupo: memoria.grupo })
);
app.get('/qr', async (_req, res) => {
  const pagina = (corpo, recarregarEm) =>
    res.send(
      `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NutriBot QR</title></head>` +
        `<body style="font-family:sans-serif;text-align:center;padding:16px">${corpo}` +
        `<p><small>Status: ${statusConexao} · página recarrega a cada ${recarregarEm}s</small></p>` +
        `<script>setTimeout(()=>location.reload(),${recarregarEm * 1000})</script></body></html>`
    );
  if (statusConexao === 'conectado') return pagina(`<h2>✅ WhatsApp conectado</h2><p>${sock?.user?.id || ''}</p><p>Não precisa escanear nada.</p>`, 60);
  if (!ultimoQR) return pagina(`<h2>⏳ Gerando QR novo...</h2><p>Aguarde alguns segundos, a página atualiza sozinha.</p>`, 5);
  const img = await QRCode.toDataURL(ultimoQR, { width: 360 });
  pagina(
    `<h2>Escaneie no WhatsApp do número do BOT</h2><p>⋮ &rarr; Aparelhos conectados &rarr; Conectar um aparelho</p><img src="${img}" style="max-width:100%"/>` +
      `<p>O código muda a cada 20s. Deixe a câmera pronta antes de abrir.</p>`,
    20
  );
});
// Rotas de administração (exigem ?token=ADMIN_TOKEN)
function autorizado(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(403).send('Defina ADMIN_TOKEN nas variáveis de ambiente pra usar esta rota.');
    return false;
  }
  if (req.query.token !== ADMIN_TOKEN) {
    res.status(401).send('token inválido');
    return false;
  }
  return true;
}
app.get('/status', (req, res) => {
  if (!autorizado(req, res)) return;
  res.json({
    status: statusConexao,
    numero: sock?.user?.id || null,
    nome: sock?.user?.name || null,
    dia: memoria.dia,
    mensagensHoje: memoria.mensagens.length,
    grupo: memoria.grupo,
    keepalive: KEEPALIVE_URL ? `${KEEPALIVE_URL}/ping a cada ${KEEPALIVE_MIN} min` : 'desligado',
    uptimeMin: Math.round(process.uptime() / 60),
    tokensGeminiHoje: ia.usoDeHoje(),
  });
});
// Troca de número sem redeploy: desvincula o aparelho atual e gera um QR novo em /qr
app.get('/logout', async (req, res) => {
  if (!autorizado(req, res)) return;
  try {
    console.log('[admin] logout solicitado via HTTP');
    await sock?.logout().catch((e) => console.warn('[admin] sock.logout falhou:', e.message));
    res.send('<h2>Desvinculado.</h2><p>Abra <a href="/qr">/qr</a> em alguns segundos e escaneie com o número do bot.</p>');
  } catch (e) {
    res.status(500).send('erro: ' + e.message);
  }
});
app.listen(PORT, () => console.log(`[http] servidor na porta ${PORT} (GET /ping, GET /qr, GET /status?token=, GET /logout?token=)`));

// Anti-sleep interno: o próprio bot bate na URL pública. Combine com um monitor externo (UptimeRobot / cron-job.org)
// pra cobrir o intervalo em que o processo está reiniciando.
if (KEEPALIVE_URL) {
  setInterval(() => {
    fetch(`${KEEPALIVE_URL}/ping`, { signal: AbortSignal.timeout(15_000) }).catch((e) =>
      console.warn('[keepalive] falhou:', e.message)
    );
  }, KEEPALIVE_MIN * 60_000).unref();
  console.log(`[keepalive] ping em ${KEEPALIVE_URL}/ping a cada ${KEEPALIVE_MIN} min`);
} else {
  console.log('[keepalive] desligado (sem RENDER_EXTERNAL_URL/KEEPALIVE_URL). Local isso é normal.');
}

// ============================================================
// WhatsApp
// ============================================================
let sock;
let gruposIgnoradosLogados = new Set();

// Converte o markdown que o Gemini insiste em mandar pro formato do WhatsApp
// (negrito é UM asterisco de cada lado; **dois** aparecem literalmente no zap).
export function paraWhatsApp(texto) {
  let t = String(texto || '');
  if (!MANTER_COLCHETES) t = t.replace(/\[\[([^\]]+)\]\]/g, '*$1*');
  return t
    .replace(/^#{1,6}\s*/gm, '') // cabeçalhos markdown
    .replace(/\*\*\*(.+?)\*\*\*/g, '*$1*') // ***x*** -> *x*
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // **x** -> *x*
    .replace(/__(.+?)__/g, '_$1_') // __x__ -> _x_
    .replace(/^\s*[-*•]\s+/gm, '• ') // bullets -> •
    .replace(/\*{2,}/g, '*') // sobras de asterisco
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// IDs das mensagens que o próprio bot enviou (pra não responder a si mesmo quando roda no número de um dos usuários)
const enviadosPeloBot = new Set();

// Pausa "humana" curta antes de responder (0,6 a ~2,5 s, proporcional ao texto). Ritmo sempre igual e instantâneo
// é sinal de automação pro WhatsApp; mas resposta básica não pode demorar. O Gemini já toma o resto do tempo.
function pausaHumana(texto) {
  const base = 600 + Math.min(texto.length, 300) * 4;
  return base + Math.random() * 700;
}

// Frases instantâneas quando chega foto de comida (sem IA): a pessoa sabe que a Nutri "tá olhando"
const ACKS_FOTO = [
  '👀 Deixa eu ver esse prato...',
  '🔍 Analisando essa refeição, segura aí.',
  'Hmm, olhando com carinho aqui... 🧐',
  'Calma que eu tô olhando essa comida. 👀🍽️',
  'Já vi. Fazendo as contas... 🧮',
  'Peraí, dando zoom no prato. 🔎',
  'Ó a foto chegando. Tô avaliando... 😊',
];
const acaso = (lista) => lista[Math.floor(Math.random() * lista.length)];

async function enviar(jid, texto, quoted, { rapido = false } = {}) {
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  if (!rapido) await new Promise((r) => setTimeout(r, pausaHumana(texto)));
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  const limpo = String(texto || '').replace(/\n?\s*ATUALIZAR:\s*\{[\s\S]*\}\s*$/i, '').trim();
  const r = await sock.sendMessage(jid, { text: paraWhatsApp(limpo) }, quoted ? { quoted } : undefined);
  if (r?.key?.id) {
    enviadosPeloBot.add(r.key.id);
    if (enviadosPeloBot.size > 500) enviadosPeloBot.delete(enviadosPeloBot.values().next().value);
  }
}

// JIDs do próprio bot (número e LID), normalizados
const meusJids = () => [sock?.user?.id, sock?.user?.lid].filter(Boolean).map((j) => jidNormalizedUser(j));

function jidsDoRemetente(key) {
  let lista = [key.participant, key.participantAlt].filter(Boolean).map((j) => jidNormalizedUser(j));
  // Mensagem digitada no próprio celular do bot (fromMe) pode vir sem participant
  if (key.fromMe && !lista.length) lista = meusJids();
  return [...new Set(lista)];
}

let quedasSeguidas = 0; // pra reconectar com espera crescente (3 s, 6 s, 12 s... até 2 min) em vez de martelar o WhatsApp
let encerrando = false;

async function conectarWhatsApp() {
  const { state, saveCreds, limparSessao } = await useMongoAuthState();
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      ultimoQR = qr;
      statusConexao = 'aguardando QR';
      console.log(`\n[wa] Escaneie o QR abaixo OU abra http://localhost:${PORT}/qr (no Render: ${KEEPALIVE_URL || 'https://SEU-APP.onrender.com'}/qr)\n`);
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === 'open') {
      ultimoQR = null;
      quedasSeguidas = 0;
      statusConexao = 'conectado';
      console.log('[wa] conectado como', sock.user?.id, sock.user?.name ? `(${sock.user.name})` : '');
      garantirDiaAtual().catch((e) => console.error('[bot] erro na virada de dia:', e.message));
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const aguardavaQR = statusConexao === 'aguardando QR' || statusConexao === 'gerando QR novo';
      ultimoQR = null; // QR antigo não vale mais; /qr mostra "gerando" até vir outro
      statusConexao = codigo === DisconnectReason.timedOut ? 'gerando QR novo' : `desconectado (${codigo})`;
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
      setTimeout(() => conectarWhatsApp().catch((e) => console.error('[wa] falha ao reconectar:', e.message)), espera);
    }
  });

  // Entrou num grupo? Se apresenta. Nesta versão do Baileys a adição chega como mensagem de sistema (stub) no
  // messages.upsert, sem conteúdo; group-participants.update e groups.upsert ficam como caminhos alternativos.
  sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    if (action !== 'add') return;
    if ((participants || []).some(souEu)) apresentarNaFila(id, 'adicionada ao grupo');
  });
  sock.ev.on('groups.upsert', (grupos) => {
    for (const g of grupos || []) if (g?.id?.endsWith('@g.us')) apresentarNaFila(g.id, 'grupo criado comigo dentro');
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
        if (adicionados.some(souEu)) apresentarNaFila(msg.key.remoteJid, 'adicionada ao grupo');
        continue;
      }
      // 'notify' = mensagem nova de outra pessoa; 'append' + fromMe = digitada no celular do próprio bot
      if (type === 'notify' || (msg.key.fromMe && !enviadosPeloBot.has(msg.key.id))) enfileirar(msg);
    }
  });
}

// Um participante (string ou objeto {id, phoneNumber, lid}) é o próprio bot?
function souEu(p) {
  const meus = meusJids();
  const ids = typeof p === 'string' ? [p] : [p?.id, p?.phoneNumber, p?.lid];
  return ids.filter(Boolean).some((j) => meus.includes(jidNormalizedUser(j)));
}

function apresentarNaFila(jidGrupo, motivo) {
  if (GRUPO_PERMITIDO && jidGrupo !== GRUPO_PERMITIDO) return;
  fila = fila.then(() => apresentar(jidGrupo, motivo)).catch((e) => console.error('[apresentacao]', e.message));
}

// Processa uma mensagem por vez pra não embaralhar o contexto do dia
let fila = Promise.resolve();
function enfileirar(msg) {
  fila = fila.then(() => processar(msg)).catch((e) => console.error('[bot] erro ao processar:', e));
}

// ============================================================
// Apresentação e nome
// ============================================================
// Chave do grupo dentro de config.apresentadoEm (JID tem ponto em "@g.us" e o Mongo não aceita ponto em nome de campo)
const chaveGrupo = (jid) => jid.replace(/\./g, '_');
const jaApresentada = (jidGrupo) => Boolean(config.apresentadoEm?.[chaveGrupo(jidGrupo)]);

async function apresentar(jidGrupo, motivo) {
  if (jaApresentada(jidGrupo)) return;
  const meta = await sock.groupMetadata(jidGrupo).catch(() => null);
  console.log(`[apresentacao] ${motivo} em "${meta?.subject || jidGrupo}"`);
  if (!memoria.grupo) memoria.grupo = jidGrupo;
  const texto = await ia.apresentacao({ grupoNome: meta?.subject, membros: meta?.participants?.length, persona });
  await enviar(jidGrupo, texto);
  // Só marca como apresentada DEPOIS que a mensagem saiu: se a IA ou o envio falhar, tenta de novo na próxima
  config = await salvarConfig({ [`apresentadoEm.${chaveGrupo(jidGrupo)}`]: new Date().toISOString(), aguardandoNomeDesde: config.nomeBot ? null : new Date().toISOString() });
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto, tipo: 'bot' });
}

async function batizar(nome, quem, jidGrupo, msg) {
  config = await salvarConfig({ nomeBot: nome, aguardandoNomeDesde: null });
  ia.definirNomeBot(nome);
  console.log(`[apresentacao] batizada de "${nome}" por ${quem}`);
  const reacao = await ia.reagirAoNome({ nome, quem, persona });
  await enviar(jidGrupo, reacao, msg);
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: reacao, tipo: 'bot' });
}

// ============================================================
// Quando ela responde: sempre a foto, áudio, comando, pergunta, menção/resposta a ela e assunto dela (comida, treino,
// sono, peso). Papo aleatório entre eles: no máximo uma vez a cada PAPO_INTERVALO_MIN, e nesse intervalo nem chama a IA.
// ============================================================
const ASSUNTO_DELA =
  /(?<![\p{L}\p{N}])(comi|comer|comendo|comida|almo[cç]\p{L}*|jant\p{L}*|caf[eé]|lanch\p{L}*|ceia|marmita|prato|refei[cç][aã]o|bebi|beber|[aá]gua|treino|treinei|treinar|academia|corrid\p{L}*|v[oô]lei|dormi\p{L}*|sono|acordei|peso|pesei|balan[cç]a|dieta|fome|pizza|hamb[uú]rguer|refri\p{L}*|cerveja|doce\p{L}*|chocolate|bolo|sorvete|p[aã]o|p[aã]es|massa|macarr[aã]o|ifood|delivery|whey|creatina|prote[ií]na|kcal|caloria\p{L}*|macro\p{L}*|carbo\p{L}*|gordura|salada|frango|ovo\p{L}*|arroz|feij[aã]o|fruta\p{L}*|suplemento|jejum|nutri)(?![\p{L}\p{N}])/iu;
let ultimoPapoEm = 0;

function prioridade({ texto, temImagem, temAudio, conteudo, msg }) {
  if (temImagem || temAudio) return 'midia';
  if (/\?/.test(texto)) return 'pergunta';
  const nome = ia.nomeDaBot().toLowerCase();
  if (texto.toLowerCase().includes(nome) || /\bnutri\b/i.test(texto)) return 'mencao';
  const ctx = conteudo.extendedTextMessage?.contextInfo;
  if (ctx?.stanzaId && enviadosPeloBot.has(ctx.stanzaId)) return 'resposta-a-ela';
  if (ctx?.participant && meusJids().includes(jidNormalizedUser(ctx.participant))) return 'resposta-a-ela';
  if ((ctx?.mentionedJid || []).some((j) => meusJids().includes(jidNormalizedUser(j)))) return 'mencao';
  if (ASSUNTO_DELA.test(texto)) return 'assunto';
  return null; // papo aleatório
}

// Traduz a linha ATUALIZAR da IA em campos do perfil, com a data de cada mudança em perfil.atualizacoes
function aplicarAtualizacao(perfil, a, dia) {
  const novo = { jids: perfil.jids, atualizacoes: { ...(perfil.atualizacoes || {}) } };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(',', '.')) || null);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  const set = (campo, valor) => {
    if (valor == null || valor === perfil[campo]) return;
    novo[campo] = valor;
    novo.atualizacoes[campo] = dia;
  };
  const peso = num(a.peso_kg ?? a.peso);
  if (peso && peso > 25 && peso < 400) set('peso', peso);
  const altura = num(a.altura_cm ?? a.altura);
  if (altura && altura > 100 && altura < 250) set('altura', altura);
  set('objetivo', str(a.objetivo));
  set('cidade', str(a.cidade));
  if (fusoValido(a.fuso)) set('fuso', a.fuso);
  set('dieta', str(a.dieta)?.toLowerCase());
  set('restricoes', str(a.restricoes));
  return Object.keys(novo).length > 2 ? novo : null;
}

async function processar(msg) {
  if (!msg.message) return;
  if (msg.key.fromMe && enviadosPeloBot.has(msg.key.id)) return; // resposta do próprio bot
  const jidGrupo = msg.key.remoteJid;
  if (!jidGrupo?.endsWith('@g.us')) return; // só grupos

  if (GRUPO_PERMITIDO && jidGrupo !== GRUPO_PERMITIDO) {
    if (!gruposIgnoradosLogados.has(jidGrupo)) {
      gruposIgnoradosLogados.add(jidGrupo);
      console.log(`[bot] ignorando grupo ${jidGrupo} (ALLOWED_GROUP_ID=${GRUPO_PERMITIDO})`);
    }
    return;
  }

  const ts = Number(msg.messageTimestamp) || 0;
  if (ts && Date.now() / 1000 - ts > IDADE_MAX_MSG_S) return;

  const conteudo = extractMessageContent(msg.message);
  if (!conteudo) return;
  const texto = (conteudo.conversation || conteudo.extendedTextMessage?.text || conteudo.imageMessage?.caption || '').trim();
  const temImagem = Boolean(conteudo.imageMessage);
  const temAudio = Boolean(conteudo.audioMessage);
  if (!texto && !temImagem && !temAudio) return; // sticker, vídeo, documento etc.

  await garantirDiaAtual();
  if (!GRUPO_PERMITIDO && memoria.grupo !== jidGrupo) {
    memoria.grupo = jidGrupo;
    console.log(`[bot] respondendo no grupo ${jidGrupo}. Dica: coloque ALLOWED_GROUP_ID=${jidGrupo} no .env`);
  }

  const jids = jidsDoRemetente(msg.key);
  if (!jids.length) return;
  const nomeContato = msg.pushName || jids[0].split('@')[0];
  const { dia, hora } = agora();

  // Primeira vez que ela vê esse grupo (ex.: entrou enquanto o bot estava offline): se apresenta antes de tudo
  if (!jaApresentada(jidGrupo)) await apresentar(jidGrupo, 'primeira mensagem vista no grupo').catch((e) => console.error('[apresentacao]', e.message));

  // Escolha do nome dela (nas 48h após a apresentação). Só mensagens curtas e SEM número: "Lucas, 80kg, 1,80m, secar" é cadastro,
  // não batismo, e não pode gastar uma chamada de IA nem virar nome da bot.
  if (!config.nomeBot && config.aguardandoNomeDesde && texto && !texto.startsWith('!') && texto.length <= 40 && !/\d/.test(texto)) {
    const horas = (Date.now() - new Date(config.aguardandoNomeDesde).getTime()) / 36e5;
    if (horas <= 48) {
      const nome = await ia.extrairNomeBot(texto).catch(() => null);
      if (nome) {
        await batizar(nome, nomeContato, jidGrupo, msg);
        return;
      }
    }
  }

  // ---------- Comandos utilitários ----------
  if (texto.startsWith('!')) {
    const cmd = texto.toLowerCase().split(/\s+/)[0];
    if (cmd === '!id') return enviar(jidGrupo, `ID deste grupo: ${jidGrupo}\nSeu ID: ${jids.join(' / ')}`, msg);
    if (cmd === '!nome') {
      const novo = texto.slice(5).trim().replace(/^["']|["']$/g, '');
      if (!novo) return enviar(jidGrupo, `Meu nome é *${ia.nomeDaBot()}*. Quer trocar? Manda "!nome NovoNome", criatura.`, msg);
      if (novo.length > 40) return enviar(jidGrupo, 'Nome com mais de 40 letras? Tá me batizando ou escrevendo TCC? Encurta isso.', msg);
      return batizar(novo, nomeContato, jidGrupo, msg);
    }
    if (cmd === '!resumo') return fecharDia({ forcado: true });
    if (cmd === '!reset') {
      await apagarPerfil(jids);
      return enviar(jidGrupo, 'Perfil apagado. Manda qualquer coisa que eu te cadastro de novo, criatura.', msg);
    }
    if (cmd === '!perfil') {
      const p = await buscarPerfil(jids);
      const [pe] = p?.onboarded ? await enriquecerPerfis([p], dia) : [null];
      const em = (c) => (pe?.atualizacoes?.[c] ? ` (desde ${pe.atualizacoes[c]})` : '');
      const ficha = pe
        ? `${pe.nome}: ${pe.peso} kg${em('peso')}, ${pe.altura} cm, objetivo: ${pe.objetivo}${em('objetivo')}.\nMora em: ${pe.cidade ? `${pe.cidade} (fuso ${fusoDe(pe)})` : 'ainda não me contou 🗺️'}\nDieta: ${pe.dieta || 'ainda não me contou'}${pe.restricoes ? ` · restrições: ${pe.restricoes}` : ''}\nGírias que eu já peguei: ${(pe.girias || []).join(', ') || 'nenhuma ainda'}\nHorários (no seu fuso): ${pe.horarios}\nRotina: ${pe.rotina || 'ainda te observando 👀'}`
        : 'Você ainda não tem cadastro, criatura. Manda nome, peso, altura, objetivo, cidade e se é vegetariana(o) que eu te cadastro. 😉';
      return enviar(jidGrupo, ficha, msg);
    }
    if (cmd === '!dossie' || cmd === '!pasta') {
      const p = await buscarPerfil(jids);
      if (!p?.onboarded) return enviar(jidGrupo, 'Você ainda não tem cadastro, criatura. Manda nome, peso, altura, objetivo, cidade e se é vegetariana(o) que eu te cadastro. 😉', msg);
      const docs = await listarDocumentosDe(p).catch(() => []);
      const notas = await notasDe(p).catch(() => '');
      const lista = docs.map((d) => `• ${d.nome}${d.daNutri ? ' (meu)' : d.lido ? ' ✅ lido' : ' ⚠️ não consegui ler'}`).join('\n') || '(pasta vazia)';
      return enviar(jidGrupo, `📂 *Sua pasta no Drive:*\n${lista}\n\n🧠 *Minhas notas sobre você:*\n${notas ? notas.slice(0, 1200) : 'ainda nada, mas eu tô de olho 👀'}`, msg);
    }
    if (cmd === '!fontes') {
      const lista = listarDocs().map((d) => `• ${d.titulo} (v${d.versao}, ${d.atualizado})`).join('\n');
      return enviar(jidGrupo, `📚 *O que eu já estudei:*\n${lista || 'nada ainda'}\n\nTá tudo no Drive, pasta Conhecimento. Manda !estudar se quiser que eu revise com o que saiu de novo.`, msg);
    }
    if (cmd === '!estudar') {
      await enviar(jidGrupo, 'Tá, vou revisar meu material. Isso leva uns minutos, já volto. 📚', msg);
      estudar({ dia, motivo: 'pedido no grupo' }).catch((e) => console.error('[conhecimento] falha ao estudar:', e.message));
      return;
    }
    if (cmd === '!persona') {
      return enviar(jidGrupo, persona ? `🧠 *Minha memória de personalidade:*\n\n${persona}` : 'Ainda tô te conhecendo, criatura. Volta depois do primeiro resumo do dia. 🙄', msg);
    }
    if (cmd === '!ajuda') return enviar(jidGrupo, 'Comandos: !id, !nome NovoNome (me rebatiza), !perfil, !dossie (sua pasta no Drive e minhas notas sobre você), !persona (o que eu já sei de vocês), !fontes (o que eu estudei), !estudar (revisa a base com estudos novos), !reset, !resumo (fecha o dia agora), !ajuda', msg);
  }

  // ---------- Onboarding ----------
  let perfil = await buscarPerfil(jids);

  if (!perfil) {
    await salvarPerfil({ jids, nome: nomeContato, onboarded: false, girias: [], criadoEm: new Date() });
    const pedido = await ia.pedirOnboarding(nomeContato, persona);
    await enviar(jidGrupo, pedido, msg);
    return;
  }

  if (!perfil.onboarded) {
    if (!texto) return enviar(jidGrupo, 'Foto e áudio não valem como cadastro 😅 Manda em TEXTO: nome, peso, altura, objetivo, cidade onde mora e se é vegetariana(o) ou tem restrição.', msg);
    const d = await ia.extrairDadosOnboarding(texto);
    const parcial = { jids, atualizacoes: { ...(perfil.atualizacoes || {}) } };
    const marcar = (campo, valor) => {
      parcial[campo] = valor;
      parcial.atualizacoes[campo] = dia;
    };
    if (d.nome) marcar('nome', d.nome);
    if (d.peso_kg) marcar('peso', d.peso_kg);
    if (d.altura_cm) marcar('altura', d.altura_cm);
    if (d.objetivo) marcar('objetivo', d.objetivo);
    if (d.cidade) marcar('cidade', d.cidade);
    if (fusoValido(d.fuso)) marcar('fuso', d.fuso);
    if (d.dieta) marcar('dieta', d.dieta);
    if (d.restricoes) marcar('restricoes', d.restricoes);
    perfil = await salvarPerfil(parcial);

    const faltando = [];
    if (!perfil.nome) faltando.push('nome');
    if (!perfil.peso) faltando.push('peso');
    if (!perfil.altura) faltando.push('altura');
    if (!perfil.objetivo) faltando.push('objetivo');
    if (!perfil.cidade) faltando.push('cidade onde mora');
    if (!perfil.dieta) faltando.push('se é vegetariana(o)/vegana(o) ou come de tudo');
    if (faltando.length) return enviar(jidGrupo, await ia.cobrarDadosFaltando(faltando, persona), msg);

    perfil = await salvarPerfil({ jids, onboarded: true });
    const dossieNovo = await dossieDe(perfil).catch((e) => (console.error('[pessoas]', e.message), ''));
    const bemVindo = await ia.boasVindas(perfil, persona, dossieNovo);
    await enviar(jidGrupo, bemVindo);
    await lembrar({ hora, jid: jids[0], nome: ia.nomeDaBot(), texto: bemVindo, tipo: 'bot' });
    salvarFicha(perfil, mdPerfil(perfil)).catch((e) => console.error('[drive]', e.message));
    return;
  }

  // ---------- Fluxo normal: texto e/ou foto ----------
  let imagem = null;
  let mimeType = null;
  if (temImagem) {
    // aviso imediato: a análise da foto demora alguns segundos
    enviar(jidGrupo, acaso(ACKS_FOTO), msg, { rapido: true }).catch(() => {});
    try {
      imagem = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      mimeType = conteudo.imageMessage.mimetype || 'image/jpeg';
    } catch (e) {
      console.error('[wa] falha ao baixar imagem:', e.message);
      return enviar(jidGrupo, 'Tua foto não chegou inteira aqui. Manda de novo? 🙏', msg);
    }
  }

  let audio = null;
  let audioMime = null;
  if (temAudio) {
    try {
      audio = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      audioMime = (conteudo.audioMessage.mimetype || 'audio/ogg').split(';')[0];
    } catch (e) {
      console.error('[wa] falha ao baixar áudio:', e.message);
      return enviar(jidGrupo, 'Teu áudio não baixou. Manda de novo ou digita pra mim? 🙏', msg);
    }
  }

  const motivo = prioridade({ texto, temImagem, temAudio, conteudo, msg });
  const papoLiberado = Date.now() - ultimoPapoEm >= PAPO_INTERVALO_MIN * 60_000;
  if (!motivo && !papoLiberado) {
    // Papo entre eles dentro do intervalo: só guarda no histórico (ela "ouviu"), sem gastar IA nem responder
    await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto, tipo: 'texto' });
    return;
  }

  const perfis = await enriquecerPerfis(await listarPerfis(), dia);
  const eu = perfis.find((p) => p.jids?.some((j) => jids.includes(j))) || perfil;
  // Hora no fuso da pessoa (cidade informada no cadastro/conversa); sem cidade, usa o fuso do grupo
  const horaLocal = agora(fusoDe(eu)).hora;
  const slot = slotDaHora(horaLocal);
  const habitual = eu._hab ? hhmmDe(eu._hab[slot.id].minutos) : hhmmDe(slot.padrao);
  const contextoHorario =
    `hora local de ${perfil.nome}: ${horaLocal}${eu.cidade ? ` em ${eu.cidade}` : ' (cidade/fuso ainda não informados, pode estar errada)'}; ` +
    `horário de ${slot.nome}; ${perfil.nome} costuma mandar ${slot.nome} ~${habitual}`;
  const dossie = await dossieDe(eu).catch((e) => (console.error('[pessoas]', e.message), ''));
  const momentos = await momentosRecentes(12).catch(() => []);
  const entradaTexto = temImagem ? `📷 [foto de comida]${texto ? ` ${texto}` : ''}` : temAudio ? '🎤 [áudio]' : texto;
  const historico = [...memoria.mensagens];
  await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto: entradaTexto, tipo: temImagem ? 'foto' : temAudio ? 'audio' : 'texto' });

  let resposta;
  let atualizacao = null;
  try {
    ({ texto: resposta, atualizacao } = await ia.responder({ texto, imagem, mimeType, audio, audioMime, perfil: eu, perfis, historico, dia, hora, contextoHorario, persona, conhecimento: docsPara(eu), dossie, momentos }));
  } catch (e) {
    // Gemini (todos) e Groq fora do ar: avisa em vez de ficar muda
    console.error('[ia] falha total:', e.message);
    memoria.mensagens.pop(); // não deixa a mensagem sem resposta no histórico como se tivesse sido ignorada
    persistirMemoria(memoria).catch(() => {});
    return enviar(
      jidGrupo,
      acaso([
        'Meu cérebro travou agora (a IA tá fora do ar). Me manda isso de novo daqui a 1 min? 🤯',
        'Minha conexão com a IA caiu. Repete em um minutinho que eu respondo. 🔌',
        'Tô offline da cabeça por uns segundos, o servidor engasgou. Manda de novo já já. 😵‍💫',
      ]),
      msg,
      { rapido: true }
    );
  }

  // A Nutri não sabia: pesquisa (PubMed/Wikipedia), responde de novo e guarda a nota de estudo no Drive
  const pedido = resposta?.match(/^\s*PESQUISAR:\s*(.+?)\s*$/im);
  if (pedido) {
    const consulta = pedido[1].replace(/["*]/g, '').trim();
    console.log(`[pesquisa] Nutri pediu pra pesquisar: ${consulta}`);
    enviar(jidGrupo, acaso(['Boa pergunta. Deixa eu conferir isso direito antes de falar besteira. 📚', 'Isso eu não vou chutar. Pesquisando... 🔎', 'Segura que eu vou ler sobre isso rapidinho. 🤓']), msg, { rapido: true }).catch(() => {});
    const fontes = await pesquisar({ en: consulta, pt: texto }).catch((e) => (console.error('[pesquisa]', e.message), []));
    const fontesTxt = formatarFontes(fontes, 8);
    const r2 = await ia.responder({
      texto, imagem, mimeType, audio, audioMime, perfil: eu, perfis, historico, dia, hora, contextoHorario, persona, dossie, momentos, jaPesquisou: true,
      conhecimento: `${docsPara(eu)}\n\n### Pesquisa que você acabou de fazer sobre "${consulta}"\n${fontesTxt}`,
    });
    resposta = r2.texto;
    atualizacao = r2.atualizacao || atualizacao;
    if (fontes.length) {
      ia.notaDeEstudo({ consulta, fontes: fontesTxt, dia })
        .then((nota) => salvarPesquisa({ consulta, nota, fontes, dia }))
        .then((d) => console.log(`[pesquisa] nota salva: ${d.id}`))
        .catch((e) => console.error('[pesquisa] falha ao salvar nota:', e.message));
    }
  }

  // Foi refeição? (foto, ou a Nutri analisou comida) -> registra pra aprender a rotina e não cobrar depois
  const foiRefeicao = temImagem || /O que eu vi|Estimativa:/i.test(resposta || '');

  // Papo aleatório avaliado pela IA (respondendo ou não): o próximo só daqui a PAPO_INTERVALO_MIN
  if (!motivo && !foiRefeicao) ultimoPapoEm = Date.now();

  // A pessoa contou um dado novo (peso, cidade, dieta...): sobrescreve o perfil agora, com a data, e a ficha no Drive
  if (atualizacao && typeof atualizacao === 'object') {
    const novo = aplicarAtualizacao(perfil, atualizacao, dia);
    if (novo) {
      perfil = await salvarPerfil(novo).catch((e) => (console.error('[perfil] falha ao atualizar:', e.message), perfil));
      console.log(`[perfil] ${perfil.nome} atualizado: ${Object.keys(novo).filter((k) => !['jids', 'atualizacoes'].includes(k)).join(', ')}`);
      salvarFicha(perfil, mdPerfil(perfil)).catch(() => {});
    }
  }

  if (resposta && !/^\s*PESQUISAR:/i.test(resposta)) {
    await enviar(jidGrupo, resposta, msg, { rapido: temImagem }); // foto já teve o aviso, não precisa de pausa
    await lembrar({ hora, jid: jids[0], nome: ia.nomeDaBot(), texto: resposta, tipo: 'bot' });
  }

  const resumoRefeicao = texto || (temImagem ? '[foto]' : temAudio ? '[áudio]' : '');
  if (foiRefeicao) {
    registrarRefeicao({
      jid: jids[0],
      nome: perfil.nome,
      dia,
      hora,
      minutos: minutosDe(horaLocal), // no fuso da pessoa: é assim que ela aprende o horário habitual
      slot: slot.id,
      resumo: resumoRefeicao.slice(0, 120),
    }).catch((e) => console.error('[refeicoes] falha ao registrar:', e.message));
    const ultima = memoria.mensagens[memoria.mensagens.length - (resposta ? 2 : 1)];
    if (ultima) ultima.refeicao = slot.id;
  }
  // A daily note do Drive é regerada a partir da memória (agendarDiario, chamado por lembrar)
}

// ============================================================
// Estudo: revisa a base de conhecimento com o que saiu de novo (PubMed)
// ============================================================
let estudando = false;
async function estudar({ dia, motivo }) {
  if (estudando) return;
  estudando = true;
  try {
    console.log(`[conhecimento] revisando base (${motivo})...`);
    const relatorio = await atualizarConhecimento({ ia, dia });
    const mudou = relatorio.filter((l) => /ATUALIZADO/.test(l));
    console.log('[conhecimento]\n' + relatorio.join('\n'));
    await registrarLog(dia, `revisão da base de conhecimento (${motivo}): ${mudou.length} doc(s) atualizados`);
    if (memoria.grupo && statusConexao === 'conectado') {
      const texto = mudou.length
        ? `📚 Revisei meu material com estudos novos. Atualizei:\n${mudou.join('\n')}\n\nTá tudo no Drive, pasta Conhecimento. Preparem-se, agora eu sei mais. 😈`
        : motivo === 'pedido no grupo'
          ? `📚 Revisei tudo. Nenhuma novidade que mude o que eu já falo pra vocês. Ou seja: a ciência tá tranquila, agora é com a gente. 😉`
          : null;
      if (texto) await enviar(memoria.grupo, texto);
    }
  } finally {
    estudando = false;
  }
}

// ============================================================
// Cobrança: "cadê a refeição de hoje?"
// ============================================================
async function verificarCobrancas() {
  if (statusConexao !== 'conectado' || !memoria.grupo || fechandoDia) return;
  await garantirDiaAtual();
  const { dia } = agora();

  const perfis = await enriquecerPerfis(await listarPerfis(), dia);
  const hoje = await refeicoesDoDia(dia).catch(() => []);
  memoria.cobrancas ||= {};

  for (const p of perfis) {
    // tudo no fuso da pessoa: hora atual, janela de 7h-23h e horário habitual aprendido
    const hora = agora(fusoDe(p)).hora;
    const agoraMin = minutosDe(hora);
    if (agoraMin < 7 * 60 || agoraMin > 23 * 60) continue; // ninguém merece cobrança de madrugada
    // pega só a refeição atrasada mais recente (se o bot ficou fora, não dispara 3 cobranças de uma vez)
    const pendentes = SLOTS.filter((s) => s.cobrar).filter((s) => {
      const h = p._hab[s.id];
      if (!h.aprendido) return false; // só cobra horário que ela JÁ aprendeu (3+ refeições registradas nesse slot)
      const limite = h.minutos + ATRASO_COBRANCA_MIN;
      if (agoraMin < limite || agoraMin > limite + JANELA_COBRANCA_MIN) return false; // passou da janela: fica pro resumo do dia
      const jaMandou = hoje.some((r) => r.slot === s.id && p.jids.includes(r.jid));
      return !jaMandou && !memoria.cobrancas[`${p.nome}:${s.id}`];
    });
    if (!pendentes.length) continue;
    const slot = pendentes[pendentes.length - 1];
    for (const s of pendentes) memoria.cobrancas[`${p.nome}:${s.id}`] = true; // marca todas, cobra só a última
    persistirMemoria(memoria).catch(() => {});

    const costume = p._refs
      .filter((r) => r.slot === slot.id)
      .slice(-5)
      .map((r) => r.resumo)
      .filter((r) => r && r !== '[foto]')
      .join('; ');
    try {
      const msg = await ia.cobrarRefeicao({
        perfil: p,
        dia,
        slot: slot.nome,
        horaAgora: hora,
        horaHabitual: hhmmDe(p._hab[slot.id].minutos),
        costume,
        persona,
        historico: memoria.mensagens,
        conhecimento: docsPara(p),
        dossie: await dossieDe(p).catch(() => ''),
      });
      if (msg && !/^silencio\W*$/i.test(msg)) {
        await enviar(memoria.grupo, msg);
        await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: msg, tipo: 'bot' });
        console.log(`[cobranca] ${p.nome} sem ${slot.nome} (habitual ${hhmmDe(p._hab[slot.id].minutos)}, fuso ${fusoDe(p)})`);
      }
    } catch (e) {
      console.error('[cobranca] falha:', e.message);
    }
  }
}

// ============================================================
// Fechamento do dia / semana
// ============================================================
async function garantirDiaAtual() {
  // "<" e não "!==": depois do fechamento das 23:59 a memória já aponta pro dia seguinte, e isso não pode disparar outro fechamento
  if (memoria.dia < agora().dia && !fechandoDia) {
    console.log(`[bot] virada de dia detectada (${memoria.dia} -> ${agora().dia}); fechando o dia anterior`);
    await fecharDia({ diaAlvo: memoria.dia });
  }
}

async function fecharDia({ forcado = false, diaAlvo } = {}) {
  if (fechandoDia) return;
  fechandoDia = true;
  const dia = diaAlvo || memoria.dia;
  const grupo = memoria.grupo;
  try {
    const perfis = await enriquecerPerfis(await listarPerfis(), dia);
    const historico = [...memoria.mensagens];

    if (grupo && (perfis.length || forcado)) {
      const compilado = compilarRefeicoes(historico, perfis);
      console.log(`[resumo] refeições compiladas:\n${compilado.texto}`);
      const resumo = ia.separarAtualizacao(await ia.resumoDiario({ dia, perfis, historico, persona, refeicoes: compilado.texto })).texto || '(sem resumo)';
      await enviar(grupo, `📋 *RESUMO DO DIA ${dia}*\n\n${resumo}`);
      await salvarMarkdown(
        'Resumos',
        `${dia}.md`,
        frontmatter({ tipo: 'resumo-diario', data: dia, tags: ['nutribot', 'resumo'] }) +
          `\n# Resumo do dia ${dia}\n\n${resumo}\n\n---\nConversa completa: [[Diario/${dia}|Diário de ${dia}]]\n`
      );

      // Momentos memoráveis do dia -> memória de longo prazo (Mongo + Perfis/Nutri-Momentos.md, só acrescenta)
      try {
        const momentos = await ia.extrairMomentos({ dia, perfis, historico });
        if (momentos.length) {
          await registrarMomentos(momentos);
          const atual = (await lerMarkdown('Perfis', 'Nutri-Momentos.md').catch(() => null)) || frontmatter({ tipo: 'momentos', tags: ['nutribot', 'momentos'] }) + `\n# Momentos memoráveis\n`;
          await salvarMarkdown('Perfis', 'Nutri-Momentos.md', `${atual.trimEnd()}\n${momentos.map(mdMomento).join('\n')}\n`).catch(() => {});
          console.log(`[momentos] ${momentos.length} registrados`);
        }
      } catch (e) {
        console.error('[momentos] falha:', e.message);
      }

      // Aprende gírias, rotina de cada um e atualiza fichas
      const girias = await ia.extrairGirias({ perfis, historico }).catch(() => ({}));
      for (const p of perfis) {
        const novas = girias[p.nome.toLowerCase()] || [];
        if (novas.length) {
          const conjunto = [...new Set([...(p.girias || []), ...novas])].slice(-15);
          p.girias = conjunto;
          await salvarPerfil({ jids: p.jids, girias: conjunto });
        }
        try {
          const rotina = await ia.atualizarRotina({ perfil: p, refeicoes: p._refs || [], historico, dia });
          if (rotina?.trim()) {
            p.rotina = rotina.trim();
            await salvarPerfil({ jids: p.jids, rotina: p.rotina });
          }
        } catch (e) {
          console.error(`[rotina] falha para ${p.nome}:`, e.message);
        }
        // Notas da Nutri sobre a pessoa (o que ela contou hoje, respostas às perguntas, metas) -> pasta da pessoa no Drive
        try {
          const notasAtuais = await notasDe(p);
          const dossieDocs = (await dossieDe(p)).split('--- Suas notas sobre')[0];
          const notas = await ia.atualizarNotas({ perfil: p, notasAtuais, dossieDocs, historico, dia });
          const encolheuDemais = notasAtuais.trim().length > 300 && (notas?.trim().length || 0) < notasAtuais.trim().length * 0.4;
          if (encolheuDemais) console.warn(`[pessoas] notas de ${p.nome} descartadas: reescrita perdeu mais de 60% do conteúdo`);
          if (notas?.trim() && !encolheuDemais && notas.trim() !== notasAtuais.trim()) {
            await salvarNotas(p, notas, dia);
            p.notas = notas.trim();
            console.log(`[pessoas] notas de ${p.nome} atualizadas`);
          }
        } catch (e) {
          console.error(`[pessoas] falha nas notas de ${p.nome}:`, e.message);
        }
        await salvarFicha(p, mdPerfil(p)).catch(() => {});
      }

      // A Nutri revisa quem ela é: apelidos, piadas internas, padrões e o que afiar amanhã
      try {
        const momentos = await momentosRecentes(30).catch(() => []);
        const nova = await ia.evoluirPersona({ dia, personaAtual: persona, perfis, historico, momentos });
        if (persona.length > 300 && (nova?.trim().length || 0) < persona.length * 0.4) {
          console.warn('[persona] reescrita descartada: perdeu mais de 60% do conteúdo');
        } else if (nova?.trim()) {
          persona = nova.trim();
          await salvarPersona(persona, dia);
          await salvarMarkdown(
            'Perfis',
            'Nutri.md',
            frontmatter({ tipo: 'persona', atualizado: dia, tags: ['nutribot', 'persona'] }) + `\n# ${ia.nomeDaBot()} (memória de personalidade)\n\n${persona}\n\n---\nMomentos memoráveis: [[Nutri-Momentos]]\n`
          ).catch(() => {});
          console.log(`[persona] atualizada (${persona.length} chars)`);
        }
      } catch (e) {
        console.error('[persona] falha ao evoluir:', e.message);
      }

      const dataAlvo = new Date(`${dia}T12:00:00Z`);
      if (dataAlvo.getUTCDay() === 0 || (forcado && process.env.FORCAR_SEMANAL === 'true')) {
        await fecharSemana({ dia, perfis, grupo });
      }
    } else {
      console.log('[bot] nada pra resumir hoje (sem grupo ou sem perfis).');
    }

    await registrarLog(dia, `${agora().hora} dia fechado (${historico.length} mensagens)`);
  } catch (e) {
    console.error('[bot] erro ao fechar o dia:', e);
    if (grupo) await enviar(grupo, `Deu problema no meu resumo de hoje (${e.message}). Amanhã eu compenso. 🙏`).catch(() => {});
  } finally {
    if (forcado) {
      // !resumo no meio do dia: fecha o resumo mas NÃO apaga a memória, senão a tarde começa sem contexto
      agendarDiario();
    } else {
      // Daily note final do dia fechado, depois começa o próximo. Se o cron das 23:59 terminou antes da meia-noite,
      // o próximo dia é "amanhã" (senão a virada às 00:00 fecharia o mesmo dia de novo, com resumo vazio).
      await gravarDiario(memoria).catch(() => {});
      const proximo = agora().dia > dia ? agora().dia : diaSeguinte(dia);
      memoria = { dia: proximo, grupo, mensagens: [], cobrancas: {} };
      diarioSujo = false;
      await persistirMemoria(memoria).catch(() => {});
    }
    fechandoDia = false;
  }
}

async function fecharSemana({ dia, perfis, grupo }) {
  const semana = semanaISO(dia);
  const resumosDiarios = [];
  for (const d of diasAnteriores(dia, 7)) {
    const conteudo = await lerMarkdown('Resumos', `${d}.md`).catch(() => null);
    if (conteudo) resumosDiarios.push({ dia: d, conteudo: conteudo.replace(/^---[\s\S]*?---\n/, '') });
  }
  const resumo = await ia.resumoSemanal({ semana, perfis, resumosDiarios, persona, conhecimento: docsPara(perfis) });
  await enviar(grupo, `📆 *RESUMO DA SEMANA ${semana}*\n\n${resumo}`);
  await salvarMarkdown(
    'Resumos',
    `Semana-${semana}.md`,
    frontmatter({ tipo: 'resumo-semanal', semana, tags: ['nutribot', 'resumo', 'semanal'] }) +
      `\n# Semana ${semana}\n\n${resumo}\n\n---\nDias: ${resumosDiarios.map((r) => `[[Resumos/${r.dia}|${r.dia}]]`).join(' · ')}\n`
  );
}

// ============================================================
// Boot
// ============================================================
(async () => {
  try {
    await conectarMongo();
    await garantirIndices();
    iniciarDrive();
    await carregarConhecimento().catch((e) => console.error('[conhecimento] falha ao carregar:', e.message));
    // Pré-carrega a pasta de cada pessoa (transcreve PDFs novos agora, não na primeira mensagem do dia)
    listarPerfis()
      .then((ps) => Promise.all(ps.map((p) => dossieDe(p).then((d) => console.log(`[pessoas] dossiê de ${p.nome}: ${d.length} chars`)))))
      .catch((e) => console.error('[pessoas] pré-carga falhou:', e.message));

    persona = await carregarPersona().catch(() => '');
    if (persona) console.log(`[persona] carregada (${persona.length} chars)`);
    config = await lerConfig().catch(() => ({ apresentadoEm: {} }));
    config.apresentadoEm ||= {};
    if (config.nomeBot) ia.definirNomeBot(config.nomeBot);
    console.log(`[config] nome: ${ia.nomeDaBot()}; grupos apresentados: ${Object.keys(config.apresentadoEm).length}`);

    const salva = await carregarMemoria();
    if (salva?.mensagens) {
      memoria = { dia: salva.dia, grupo: salva.grupo || GRUPO_PERMITIDO || null, mensagens: salva.mensagens, cobrancas: salva.cobrancas || {} };
      console.log(`[memoria] restaurada: ${memoria.mensagens.length} mensagens de ${memoria.dia}`);
      // se a data mudou enquanto o bot dormia, o dia antigo é fechado assim que o WhatsApp conectar
    }

    // Grupo onde ela já trabalhava antes de existir a apresentação: marca como apresentada, senão ela "chega" num grupo
    // onde já está há semanas e pede cadastro de quem já tem.
    if (!Object.keys(config.apresentadoEm).length && memoria.grupo && (await listarPerfis()).length) {
      config = await salvarConfig({ [`apresentadoEm.${chaveGrupo(memoria.grupo)}`]: new Date().toISOString() });
      config.apresentadoEm ||= {};
      console.log(`[config] grupo ${memoria.grupo} marcado como já apresentado (bot já ativo nele)`);
    }

    await conectarWhatsApp();

    // Tudo que mexe na memória do dia passa pela mesma fila das mensagens: fechamento e cobrança nunca rodam no meio de uma resposta.
    const naFila = (nome, fn) => () => {
      fila = fila.then(fn).catch((e) => console.error(`[${nome}] erro:`, e.message));
    };

    // 23:59 todo dia (fuso TZ). Domingo o fecharDia também dispara o semanal.
    cron.schedule('59 23 * * *', naFila('cron', () => fecharDia()), { timezone: TZ });
    console.log(`[cron] resumo diário agendado para 23:59 (${TZ})`);

    // A cada 10 min: alguém pulou a refeição do horário de costume? Cobra.
    cron.schedule('*/10 * * * *', naFila('cobranca', verificarCobrancas), { timezone: TZ });
    console.log(`[cron] cobrança de refeições a cada 10 min (atraso tolerado: ${ATRASO_COBRANCA_MIN} min)`);

    // Dia 1 de cada mês, 4h: a Nutri estuda o que saiu de novo e revisa a base de conhecimento
    cron.schedule('0 4 1 * *', () => estudar({ dia: agora().dia, motivo: 'revisão mensal' }).catch((e) => console.error('[conhecimento]', e.message)), { timezone: TZ });
    console.log('[cron] revisão mensal da base de conhecimento (dia 1, 04:00)');
  } catch (e) {
    console.error('[boot] falha fatal:', e);
    process.exit(1);
  }
})();

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

// Render manda SIGTERM a cada deploy: salva o que está pendente e fecha as conexões em vez de morrer no meio de uma escrita
async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[boot] ${sinal} recebido, encerrando...`);
  const limite = setTimeout(() => process.exit(0), 8000).unref();
  try {
    await persistirMemoria(memoria).catch(() => {});
    if (diarioSujo) await gravarDiario().catch(() => {});
    sock?.end?.(undefined);
    await fecharMongo();
  } finally {
    clearTimeout(limite);
    process.exit(0);
  }
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
