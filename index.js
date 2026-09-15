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
} from './mongo.js';
import { iniciarDrive, salvarMarkdown, lerMarkdown, registrarLog, frontmatter, mdInteracao, mdPerfil } from './drive.js';
import * as ia from './gemini.js';

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
// Memória do dia (RAM + backup no Mongo)
// ============================================================
let memoria = { dia: agora().dia, grupo: GRUPO_PERMITIDO || null, mensagens: [] };
let fechandoDia = false;

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
  if (!ultimoQR) return res.send(`<h2>Status: ${statusConexao}</h2><p>Sem QR pendente. Se já conectou, tá tudo certo.</p>`);
  const img = await QRCode.toDataURL(ultimoQR, { width: 360 });
  res.send(`<html><body style="font-family:sans-serif;text-align:center"><h2>Escaneie no WhatsApp</h2><p>Aparelhos conectados &rarr; Conectar aparelho</p><img src="${img}"/><p><small>A página recarrega a cada 20s</small></p><script>setTimeout(()=>location.reload(),20000)</script></body></html>`);
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

function paraWhatsApp(texto) {
  return MANTER_COLCHETES ? texto : texto.replace(/\[\[([^\]]+)\]\]/g, '*$1*');
}

// IDs das mensagens que o próprio bot enviou (pra não responder a si mesmo quando roda no número de um dos usuários)
const enviadosPeloBot = new Set();

// Pausa "humana" antes de responder: entre 1,5 s e ~6 s, proporcional ao tamanho do texto.
// Responder instantâneo e sempre no mesmo ritmo é um dos sinais que o WhatsApp usa pra detectar automação.
function pausaHumana(texto) {
  const base = 1500 + Math.min(texto.length, 400) * 8;
  return base + Math.random() * 1500;
}

async function enviar(jid, texto, quoted) {
  await sock.sendPresenceUpdate('composing', jid).catch(() => {});
  await new Promise((r) => setTimeout(r, pausaHumana(texto)));
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
      statusConexao = `desconectado (${codigo})`;
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
  if (!texto && !temImagem) return; // áudio, sticker, etc.

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
      const ficha = p?.onboarded
        ? `${p.nome}: ${p.peso} kg, ${p.altura} cm, objetivo: ${p.objetivo}.\nGírias que eu já peguei: ${(p.girias || []).join(', ') || 'nenhuma ainda'}`
        : 'Você nem cadastro tem, porra.';
      return enviar(jidGrupo, ficha, msg);
    }
    if (cmd === '!ajuda') return enviar(jidGrupo, 'Comandos: !id, !perfil, !reset, !resumo (fecha o dia agora), !ajuda', msg);
  }

  // ---------- Onboarding ----------
  let perfil = await buscarPerfil(jids);

  if (!perfil) {
    await salvarPerfil({ jids, nome: nomeContato, onboarded: false, girias: [], criadoEm: new Date() });
    const pedido = await ia.pedirOnboarding(nomeContato);
    await enviar(jidGrupo, pedido, msg);
    return;
  }

  if (!perfil.onboarded) {
    if (!texto) return enviar(jidGrupo, 'Foto não é cadastro, gênio. Manda nome, peso, altura e objetivo em TEXTO.', msg);
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
    if (faltando.length) return enviar(jidGrupo, await ia.cobrarDadosFaltando(faltando), msg);

    perfil = await salvarPerfil({ jids, onboarded: true });
    const bemVindo = await ia.boasVindas(perfil);
    await enviar(jidGrupo, bemVindo);
    await lembrar({ hora, jid: jids[0], nome: 'Nutri', texto: bemVindo, tipo: 'bot' });
    salvarMarkdown('Perfis', `${perfil.nome}.md`, mdPerfil(perfil)).catch((e) => console.error('[drive]', e.message));
    return;
  }

  // ---------- Fluxo normal: texto e/ou foto ----------
  let imagem = null;
  let mimeType = null;
  if (temImagem) {
    try {
      imagem = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      mimeType = conteudo.imageMessage.mimetype || 'image/jpeg';
    } catch (e) {
      console.error('[wa] falha ao baixar imagem:', e.message);
      return enviar(jidGrupo, 'Tua foto não baixou, tá de sacanagem com minha conexão? Manda de novo.', msg);
    }
  }

  const perfis = await listarPerfis();
  const entradaTexto = temImagem ? `📷 [foto de comida]${texto ? ` ${texto}` : ''}` : texto;
  const historico = [...memoria.mensagens];
  await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto: entradaTexto, tipo: temImagem ? 'foto' : 'texto' });

  const resposta = await ia.responder({ texto, imagem, mimeType, perfil, perfis, historico, dia });

  if (resposta) {
    await enviar(jidGrupo, resposta, msg);
    await lembrar({ hora, jid: jids[0], nome: 'Nutri', texto: resposta, tipo: 'bot' });
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
      tipo: temImagem ? 'refeicao-foto' : 'conversa',
      entrada: entradaTexto,
      resposta: resposta || '_(sem resposta - SILENCIO)_',
    })
  ).catch((e) => console.error('[drive] falha ao salvar interação:', e.message));
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
    const perfis = await listarPerfis();
    const historico = [...memoria.mensagens];

    if (grupo && (perfis.length || forcado)) {
      const resumo = await ia.resumoDiario({ dia, perfis, historico });
      await enviar(grupo, `📋 *RESUMO DO DIA ${dia}*\n\n${resumo}`);
      await salvarMarkdown(
        'Resumos',
        `${dia}.md`,
        frontmatter({ tipo: 'resumo-diario', data: dia, tags: ['nutribot', 'resumo'] }) +
          `\n# Resumo do dia [[${dia}]]\n\n${resumo}\n\n---\nInterações do dia: pasta \`Diario/${dia}\`\n`
      );

      // Aprende gírias e atualiza fichas
      const girias = await ia.extrairGirias({ perfis, historico }).catch(() => ({}));
      for (const p of perfis) {
        const novas = girias[p.nome.toLowerCase()] || [];
        if (novas.length) {
          const conjunto = [...new Set([...(p.girias || []), ...novas])].slice(-15);
          p.girias = conjunto;
          await salvarPerfil({ jids: p.jids, girias: conjunto });
        }
        await salvarMarkdown('Perfis', `${p.nome}.md`, mdPerfil(p)).catch(() => {});
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
    memoria = { dia: agora().dia, grupo, mensagens: [] };
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
  const resumo = await ia.resumoSemanal({ semana, perfis, resumosDiarios });
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

    const salva = await carregarMemoria();
    if (salva?.mensagens) {
      memoria = { dia: salva.dia, grupo: salva.grupo || GRUPO_PERMITIDO || null, mensagens: salva.mensagens };
      console.log(`[memoria] restaurada: ${memoria.mensagens.length} mensagens de ${memoria.dia}`);
      // se a data mudou enquanto o bot dormia, o dia antigo é fechado assim que o WhatsApp conectar
    }

    await conectarWhatsApp();

    // 23:59 todo dia (fuso TZ). Domingo o fecharDia também dispara o semanal.
    cron.schedule('59 23 * * *', () => fecharDia(), { timezone: TZ });
    console.log(`[cron] resumo diário agendado para 23:59 (${TZ})`);
  } catch (e) {
    console.error('[boot] falha fatal:', e);
    process.exit(1);
  }
})();

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
