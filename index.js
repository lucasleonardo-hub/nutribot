// index.js - NutriBot: nutricionista de bolso ácida no WhatsApp
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
} from './mongo.js';
import { iniciarDrive, salvarMarkdown, lerMarkdown, registrarLog, frontmatter, mdInteracao, mdPerfil } from './drive.js';
import * as ia from './gemini.js';
import { carregarConhecimento, docsPara, atualizarConhecimento, listarDocs, salvarPesquisa } from './conhecimento.js';
import { pesquisar, formatarFontes } from './pesquisa.js';
import { dossieDe, notasDe, salvarNotas, salvarFicha, listarDocumentosDe } from './pessoas.js';

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
function agora() {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
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
const DIAS_ROTINA = 21; // janela pra aprender horários

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

async function lembrar(entrada) {
  memoria.mensagens.push(entrada);
  if (memoria.mensagens.length > 600) memoria.mensagens.splice(0, memoria.mensagens.length - 600);
  persistirMemoria(memoria).catch((e) => console.error('[memoria] falha ao persistir:', e.message));
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
  'Hmm, verificando isso aqui... 🧐',
  'Calma que eu tô olhando essa comida. 👀🍽️',
  'Já vi. Calculando o estrago... 🧮',
  'Peraí, dando zoom no prato. 🔎',
  'Ó a foto chegando. Tô avaliando... 🤨',
];
const acaso = (lista) => lista[Math.floor(Math.random() * lista.length)];

async function enviar(jid, texto, quoted, { rapido = false } = {}) {
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  if (!rapido) await new Promise((r) => setTimeout(r, pausaHumana(texto)));
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  const r = await sock.sendMessage(jid, { text: paraWhatsApp(texto) }, quoted ? { quoted } : undefined);
  if (r?.key?.id) {
    enviadosPeloBot.add(r.key.id);
    if (enviadosPeloBot.size > 500) enviadosPeloBot.delete(enviadosPeloBot.values().next().value);
  }
}

function jidsDoRemetente(key) {
  let lista = [key.participant, key.participantAlt].filter(Boolean);
  // Mensagem digitada no próprio celular do bot (fromMe) pode vir sem participant
  if (key.fromMe && !lista.length) lista = [sock.user?.id, sock.user?.lid].filter(Boolean);
  return [...new Set(lista.map((j) => jidNormalizedUser(j)))];
}

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
      statusConexao = 'conectado';
      console.log('[wa] conectado como', sock.user?.id, sock.user?.name ? `(${sock.user.name})` : '');
      garantirDiaAtual().catch((e) => console.error('[bot] erro na virada de dia:', e.message));
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      ultimoQR = null; // QR antigo não vale mais; /qr mostra "gerando" até vir outro
      statusConexao = codigo === DisconnectReason.timedOut ? 'gerando QR novo' : `desconectado (${codigo})`;
      if (codigo === DisconnectReason.loggedOut) {
        console.log('[wa] sessão deslogada. Limpando sessão no Mongo e gerando novo QR...');
        await limparSessao();
      } else {
        console.log('[wa] conexão caiu, reconectando em 3s...', codigo);
      }
      setTimeout(conectarWhatsApp, 3000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      console.log(`[msg] tipo=${type} chat=${msg.key.remoteJid} fromMe=${msg.key.fromMe} conteudo=${getContentType(msg.message) || 'vazio'}`);
    }
    for (const msg of messages) {
      // 'notify' = mensagem nova de outra pessoa; 'append' + fromMe = digitada no celular do próprio bot
      if (type === 'notify' || (msg.key.fromMe && !enviadosPeloBot.has(msg.key.id))) enfileirar(msg);
    }
  });
}

// Processa uma mensagem por vez pra não embaralhar o contexto do dia
let fila = Promise.resolve();
function enfileirar(msg) {
  fila = fila.then(() => processar(msg)).catch((e) => console.error('[bot] erro ao processar:', e));
}

// ============================================================
// Lógica principal
// ============================================================
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
  const { dia, hora, horaArquivo } = agora();

  // ---------- Comandos utilitários ----------
  if (texto.startsWith('!')) {
    const cmd = texto.toLowerCase().split(/\s+/)[0];
    if (cmd === '!id') return enviar(jidGrupo, `ID deste grupo: ${jidGrupo}\nSeu ID: ${jids.join(' / ')}`, msg);
    if (cmd === '!resumo') return fecharDia({ forcado: true });
    if (cmd === '!reset') {
      await apagarPerfil(jids);
      return enviar(jidGrupo, 'Perfil apagado. Manda qualquer coisa que eu te cadastro de novo, criatura.', msg);
    }
    if (cmd === '!perfil') {
      const p = await buscarPerfil(jids);
      const [pe] = p?.onboarded ? await enriquecerPerfis([p], dia) : [null];
      const ficha = pe
        ? `${pe.nome}: ${pe.peso} kg, ${pe.altura} cm, objetivo: ${pe.objetivo}.\nGírias que eu já peguei: ${(pe.girias || []).join(', ') || 'nenhuma ainda'}\nHorários: ${pe.horarios}\nRotina: ${pe.rotina || 'ainda te observando 👀'}`
        : 'Você nem cadastro tem, porra.';
      return enviar(jidGrupo, ficha, msg);
    }
    if (cmd === '!dossie' || cmd === '!pasta') {
      const p = await buscarPerfil(jids);
      if (!p?.onboarded) return enviar(jidGrupo, 'Você nem cadastro tem, porra.', msg);
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
      await enviar(jidGrupo, 'Tá, vou revisar meu material. Isso leva uns minutos, não me enche. 📚🙄', msg);
      estudar({ dia, motivo: 'pedido no grupo' }).catch((e) => console.error('[conhecimento] falha ao estudar:', e.message));
      return;
    }
    if (cmd === '!persona') {
      return enviar(jidGrupo, persona ? `🧠 *Minha memória de personalidade:*\n\n${persona}` : 'Ainda tô te conhecendo, criatura. Volta depois do primeiro resumo do dia. 🙄', msg);
    }
    if (cmd === '!ajuda') return enviar(jidGrupo, 'Comandos: !id, !perfil, !dossie (sua pasta no Drive e minhas notas sobre você), !persona (o que eu já sei de vocês), !fontes (o que eu estudei), !estudar (revisa a base com estudos novos), !reset, !resumo (fecha o dia agora), !ajuda', msg);
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
    if (!texto) return enviar(jidGrupo, 'Foto e áudio não são cadastro, gênio. Manda nome, peso, altura e objetivo em TEXTO.', msg);
    const d = await ia.extrairDadosOnboarding(texto);
    const parcial = { jids };
    if (d.nome) parcial.nome = d.nome;
    if (d.peso_kg) parcial.peso = d.peso_kg;
    if (d.altura_cm) parcial.altura = d.altura_cm;
    if (d.objetivo) parcial.objetivo = d.objetivo;
    perfil = await salvarPerfil(parcial);

    const faltando = [];
    if (!perfil.peso) faltando.push('peso');
    if (!perfil.altura) faltando.push('altura');
    if (!perfil.objetivo) faltando.push('objetivo');
    if (!perfil.nome) faltando.push('nome');
    if (faltando.length) return enviar(jidGrupo, await ia.cobrarDadosFaltando(faltando, persona), msg);

    perfil = await salvarPerfil({ jids, onboarded: true });
    const dossieNovo = await dossieDe(perfil).catch((e) => (console.error('[pessoas]', e.message), ''));
    const bemVindo = await ia.boasVindas(perfil, persona, dossieNovo);
    await enviar(jidGrupo, bemVindo);
    await lembrar({ hora, jid: jids[0], nome: 'Nutri', texto: bemVindo, tipo: 'bot' });
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
      return enviar(jidGrupo, 'Tua foto não baixou, tá de sacanagem com minha conexão? Manda de novo.', msg);
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
      return enviar(jidGrupo, 'Teu áudio não baixou. Digita, criatura, ou manda de novo.', msg);
    }
  }

  const perfis = await enriquecerPerfis(await listarPerfis(), dia);
  const eu = perfis.find((p) => p.jids?.some((j) => jids.includes(j))) || perfil;
  const slot = slotDaHora(hora);
  const habitual = eu._hab ? hhmmDe(eu._hab[slot.id].minutos) : hhmmDe(slot.padrao);
  const contextoHorario = `horário de ${slot.nome}; ${perfil.nome} costuma mandar ${slot.nome} ~${habitual}`;
  const dossie = await dossieDe(eu).catch((e) => (console.error('[pessoas]', e.message), ''));
  const entradaTexto = temImagem ? `📷 [foto de comida]${texto ? ` ${texto}` : ''}` : temAudio ? '🎤 [áudio]' : texto;
  const historico = [...memoria.mensagens];
  await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto: entradaTexto, tipo: temImagem ? 'foto' : temAudio ? 'audio' : 'texto' });

  let resposta;
  try {
    resposta = await ia.responder({ texto, imagem, mimeType, audio, audioMime, perfil: eu, perfis, historico, dia, hora, contextoHorario, persona, conhecimento: docsPara(eu), dossie });
  } catch (e) {
    // Gemini (todos) e Groq fora do ar: avisa em vez de ficar muda
    console.error('[ia] falha total:', e.message);
    memoria.mensagens.pop(); // não deixa a mensagem sem resposta no histórico como se tivesse sido ignorada
    return enviar(
      jidGrupo,
      acaso([
        'Meu cérebro travou agora (a IA tá fora do ar). Me manda isso de novo daqui a 1 min, criatura. 🤯',
        'Puta que pariu, minha conexão com a IA caiu. Repete em um minutinho que eu respondo. 🔌',
        'Tô offline da cabeça por uns segundos, o servidor da IA engasgou. Manda de novo já já. 😵‍💫',
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
    resposta = await ia.responder({
      texto, imagem, mimeType, audio, audioMime, perfil: eu, perfis, historico, dia, hora, contextoHorario, persona, dossie, jaPesquisou: true,
      conhecimento: `${docsPara(eu)}\n\n### Pesquisa que você acabou de fazer sobre "${consulta}"\n${fontesTxt}`,
    });
    if (fontes.length) {
      ia.notaDeEstudo({ consulta, fontes: fontesTxt, dia })
        .then((nota) => salvarPesquisa({ consulta, nota, fontes, dia }))
        .then((d) => console.log(`[pesquisa] nota salva: ${d.id}`))
        .catch((e) => console.error('[pesquisa] falha ao salvar nota:', e.message));
    }
  }

  if (resposta && !/^\s*PESQUISAR:/i.test(resposta)) {
    await enviar(jidGrupo, resposta, msg, { rapido: temImagem }); // foto já teve o aviso, não precisa de pausa
    await lembrar({ hora, jid: jids[0], nome: 'Nutri', texto: resposta, tipo: 'bot' });
  }

  // Foi refeição? (foto, ou a Nutri analisou comida) -> registra pra aprender a rotina e não cobrar depois
  const foiRefeicao = temImagem || /O que eu vi|Estimativa:/i.test(resposta || '');
  const resumoRefeicao = texto || (temImagem ? '[foto]' : temAudio ? '[áudio]' : '');
  if (foiRefeicao) {
    registrarRefeicao({
      jid: jids[0],
      nome: perfil.nome,
      dia,
      hora,
      minutos: minutosDe(hora),
      slot: slot.id,
      resumo: resumoRefeicao.slice(0, 120),
    }).catch((e) => console.error('[refeicoes] falha ao registrar:', e.message));
    const ultima = memoria.mensagens[memoria.mensagens.length - (resposta ? 2 : 1)];
    if (ultima) ultima.refeicao = slot.id;
  }

  // Cérebro no Drive (não bloqueia a conversa)
  const nomeArquivo = `${horaArquivo}-${perfil.nome.replace(/[^\w\-]+/g, '_')}.md`;
  salvarMarkdown(
    `Diario/${dia}`,
    nomeArquivo,
    mdInteracao({
      dia,
      hora,
      nome: perfil.nome,
      tipo: temImagem ? 'refeicao-foto' : temAudio ? 'audio' : 'conversa',
      entrada: entradaTexto,
      resposta: resposta || '_(sem resposta - SILENCIO)_',
    })
  ).catch((e) => console.error('[drive] falha ao salvar interação:', e.message));
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
          ? `📚 Revisei tudo. Nenhuma novidade que mude o que eu já falo pra vocês. O problema continua sendo vocês, não a ciência. 🙄`
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
  const { dia, hora } = agora();
  const agoraMin = minutosDe(hora);
  if (agoraMin < 7 * 60 || agoraMin > 23 * 60) return; // ninguém merece cobrança de madrugada

  const perfis = await enriquecerPerfis(await listarPerfis(), dia);
  const hoje = await refeicoesDoDia(dia).catch(() => []);
  memoria.cobrancas ||= {};

  for (const p of perfis) {
    // pega só a refeição atrasada mais recente (se o bot ficou fora, não dispara 3 cobranças de uma vez)
    const pendentes = SLOTS.filter((s) => s.cobrar).filter((s) => {
      const limite = p._hab[s.id].minutos + ATRASO_COBRANCA_MIN;
      const jaMandou = hoje.some((r) => r.slot === s.id && p.jids.includes(r.jid));
      return agoraMin >= limite && !jaMandou && !memoria.cobrancas[`${p.nome}:${s.id}`];
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
        await lembrar({ hora, jid: null, nome: 'Nutri', texto: msg, tipo: 'bot' });
        console.log(`[cobranca] ${p.nome} sem ${slot.nome} (habitual ${hhmmDe(p._hab[slot.id].minutos)})`);
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
  if (memoria.dia !== agora().dia && !fechandoDia) {
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
      const resumo = await ia.resumoDiario({ dia, perfis, historico, persona, conhecimento: docsPara(perfis) });
      await enviar(grupo, `📋 *RESUMO DO DIA ${dia}*\n\n${resumo}`);
      await salvarMarkdown(
        'Resumos',
        `${dia}.md`,
        frontmatter({ tipo: 'resumo-diario', data: dia, tags: ['nutribot', 'resumo'] }) +
          `\n# Resumo do dia [[${dia}]]\n\n${resumo}\n\n---\nInterações do dia: pasta \`Diario/${dia}\`\n`
      );

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
          if (notas?.trim() && notas.trim() !== notasAtuais.trim()) {
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
        const nova = await ia.evoluirPersona({ dia, personaAtual: persona, perfis, historico });
        if (nova?.trim()) {
          persona = nova.trim();
          await salvarPersona(persona);
          await salvarMarkdown(
            'Perfis',
            'Nutri.md',
            frontmatter({ tipo: 'persona', atualizado: dia, tags: ['nutribot', 'persona'] }) + `\n# Nutri (memória de personalidade)\n\n${persona}\n`
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
    if (grupo) await enviar(grupo, `Deu merda no meu resumo (${e.message}). Amanhã eu cobro em dobro.`).catch(() => {});
  } finally {
    // Limpa a RAM e começa o próximo dia
    memoria = { dia: agora().dia, grupo, mensagens: [], cobrancas: {} };
    await persistirMemoria(memoria).catch(() => {});
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
      `\n# Semana [[${semana}]]\n\n${resumo}\n\n---\nDias: ${resumosDiarios.map((r) => `[[${r.dia}]]`).join(' · ')}\n`
  );
}

// ============================================================
// Boot
// ============================================================
(async () => {
  try {
    await conectarMongo();
    iniciarDrive();
    await carregarConhecimento().catch((e) => console.error('[conhecimento] falha ao carregar:', e.message));
    // Pré-carrega a pasta de cada pessoa (transcreve PDFs novos agora, não na primeira mensagem do dia)
    listarPerfis()
      .then((ps) => Promise.all(ps.map((p) => dossieDe(p).then((d) => console.log(`[pessoas] dossiê de ${p.nome}: ${d.length} chars`)))))
      .catch((e) => console.error('[pessoas] pré-carga falhou:', e.message));

    persona = await carregarPersona().catch(() => '');
    if (persona) console.log(`[persona] carregada (${persona.length} chars)`);

    const salva = await carregarMemoria();
    if (salva?.mensagens) {
      memoria = { dia: salva.dia, grupo: salva.grupo || GRUPO_PERMITIDO || null, mensagens: salva.mensagens, cobrancas: salva.cobrancas || {} };
      console.log(`[memoria] restaurada: ${memoria.mensagens.length} mensagens de ${memoria.dia}`);
      // se a data mudou enquanto o bot dormia, o dia antigo é fechado assim que o WhatsApp conectar
    }

    await conectarWhatsApp();

    // 23:59 todo dia (fuso TZ). Domingo o fecharDia também dispara o semanal.
    cron.schedule('59 23 * * *', () => fecharDia(), { timezone: TZ });
    console.log(`[cron] resumo diário agendado para 23:59 (${TZ})`);

    // A cada 10 min: alguém pulou a refeição do horário de costume? Cobra.
    cron.schedule('*/10 * * * *', () => verificarCobrancas().catch((e) => console.error('[cobranca] erro:', e.message)), { timezone: TZ });
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
