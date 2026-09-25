// index.js - NutriBot: nutricionista de bolso (simpática, sincera e engraçada) no WhatsApp
// Baileys (WhatsApp) + MongoDB Atlas (sessão/perfis) + Gemini (IA) + Google Drive (cérebro .md)
//
// Este arquivo é só o boot: carrega o estado, sobe o servidor HTTP (anti-sleep, QR, admin), conecta o WhatsApp,
// agenda os crons e cuida do desligamento. A lógica vive nos módulos:
//   mensagens.js  fluxo de cada mensagem (apresentação, cadastro, resposta da IA, registro de refeição)
//   comandos.js   !comandos do grupo
//   dia.js        memória do dia, daily note, fechamento do dia/semana, revisão mensal
//   cobranca.js   cobrança de refeição atrasada
//   revisao.js    revisão (pelo Gemini) do que saiu por reserva externa; corrige no grupo se errou
//   whatsapp.js   conexão, reconexão, envio
//   perfis.js     perfis com horários habituais e atualização de dados
//   estado.js     estado compartilhado e fila única

import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import QRCode from 'qrcode';

import { conectarMongo, garantirIndices, fecharMongo, listarPerfis, carregarMemoria, persistirMemoria, carregarPersona, lerConfig, salvarConfig, refeicoesDoDia } from './mongo.js';
import { iniciarDrive, verificarCredencial } from './drive.js';
import * as ia from './gemini.js';
import { carregarConhecimento } from './conhecimento.js';
import { dossieDe } from './pessoas.js';
import { reservasDisponiveis } from './reservas.js';
import { TZ, agora } from './util.js';
import { estado, naFila, GRUPO_PERMITIDO } from './estado.js';
import { iniciarWhatsApp, numeroDoBot, nomeNoWhatsApp, desvincular, encerrarSocket, desconectadoHaMin } from './whatsapp.js';
import { garantirDiaAtual, fecharDia, estudar, gravarDiario, diarioPendente, normalizarNomesNaMemoria, sincronizarRefeicoesNaMemoria, pedirPesagem, fecharMes, falaProgramada } from './dia.js';
import { avisarAdmin } from './avisos.js';
import { paginaInicial, paginaPrivacidade } from './paginas.js';
import { verificarCobrancas, ATRASO_COBRANCA_MIN } from './cobranca.js';
import { revisarPendentes } from './revisao.js';
import { garantirIndiceVetorial } from './memoria_semantica.js';
import { enfileirarMensagem, apresentarNaFila, receberNovoMembro, chaveGrupo, salvarFilaPendente, restaurarFilaPendente } from './mensagens.js';

// ============================================================
// Configuração
// ============================================================
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim(); // protege /logout e /status
// URL pública do serviço. O Render preenche RENDER_EXTERNAL_URL sozinho; KEEPALIVE_URL serve pra outros hosts.
const KEEPALIVE_URL = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
const KEEPALIVE_MIN = Number(process.env.KEEPALIVE_MINUTES) || 10; // Render free dorme após 15 min sem tráfego

// ============================================================
// Servidor anti-sleep + QR na web + rotas de administração
// ============================================================
const app = express();

app.get('/ping', (_req, res) => res.send('pong'));
// Página inicial e política de privacidade: o Google exige as duas URLs pra publicar o app OAuth (Drive + Agenda).
// O status em JSON, que era a raiz, continua em /estado.
app.get('/', (_req, res) => res.type('html').send(paginaInicial()));
app.get('/privacidade', (_req, res) => res.type('html').send(paginaPrivacidade()));
app.get('/estado', (_req, res) =>
  res.json({ status: estado.statusConexao, dia: estado.memoria.dia, mensagensHoje: estado.memoria.mensagens.length, grupo: estado.memoria.grupo })
);
app.get('/qr', async (_req, res) => {
  const pagina = (corpo, recarregarEm) =>
    res.send(
      `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NutriBot QR</title></head>` +
        `<body style="font-family:sans-serif;text-align:center;padding:16px">${corpo}` +
        `<p><small>Status: ${estado.statusConexao} · página recarrega a cada ${recarregarEm}s</small></p>` +
        `<script>setTimeout(()=>location.reload(),${recarregarEm * 1000})</script></body></html>`
    );
  if (estado.statusConexao === 'conectado') return pagina(`<h2>✅ WhatsApp conectado</h2><p>${numeroDoBot() || ''}</p><p>Não precisa escanear nada.</p>`, 60);
  if (!estado.ultimoQR) return pagina(`<h2>⏳ Gerando QR novo...</h2><p>Aguarde alguns segundos, a página atualiza sozinha.</p>`, 5);
  const img = await QRCode.toDataURL(estado.ultimoQR, { width: 360 });
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
    status: estado.statusConexao,
    numero: numeroDoBot(),
    nome: nomeNoWhatsApp(),
    dia: estado.memoria.dia,
    mensagensHoje: estado.memoria.mensagens.length,
    grupo: estado.memoria.grupo,
    keepalive: KEEPALIVE_URL ? `${KEEPALIVE_URL}/ping a cada ${KEEPALIVE_MIN} min` : 'desligado',
    uptimeMin: Math.round(process.uptime() / 60),
    desconectadoHaMin: estado.statusConexao === 'conectado' ? 0 : desconectadoHaMin(),
    tokensGeminiHoje: ia.usoDeHoje(),
    modelos: ia.situacaoModelos(),
    reservasExternas: reservasDisponiveis(),
  });
});
// Troca de número sem redeploy: desvincula o aparelho atual e gera um QR novo em /qr
app.get('/logout', async (req, res) => {
  if (!autorizado(req, res)) return;
  try {
    console.log('[admin] logout solicitado via HTTP');
    await desvincular();
    res.send('<h2>Desvinculado.</h2><p>Abra <a href="/qr">/qr</a> em alguns segundos e escaneie com o número do bot.</p>');
  } catch (e) {
    res.status(500).send('erro: ' + e.message);
  }
});
app.listen(PORT, () => console.log(`[http] servidor na porta ${PORT} (GET /, /privacidade, /ping, /qr, /estado, /status?token=, /logout?token=)`));

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

async function checarDrive() {
  const problema = await verificarCredencial();
  if (!problema) return;
  console.error(`[drive] ${problema}`);
  await avisarAdmin('drive', `o acesso ao Google Drive parou: ${problema}`).catch(() => {});
}

// ============================================================
// Boot
// ============================================================
(async () => {
  try {
    await conectarMongo();
    await garantirIndices();
    await garantirIndiceVetorial(); // memória de longo prazo por significado (Atlas Vector Search, grátis no M0)
    iniciarDrive();
    await carregarConhecimento().catch((e) => console.error('[conhecimento] falha ao carregar:', e.message));
    // Pré-carrega a pasta de cada pessoa (transcreve PDFs novos agora, não na primeira mensagem do dia)
    listarPerfis()
      .then((ps) => Promise.all(ps.map((p) => dossieDe(p).then((d) => console.log(`[pessoas] dossiê de ${p.nome}: ${d.length} chars`)))))
      .catch((e) => console.error('[pessoas] pré-carga falhou:', e.message));

    estado.persona = await carregarPersona().catch(() => '');
    if (estado.persona) console.log(`[persona] carregada (${estado.persona.length} chars)`);
    estado.config = await lerConfig().catch(() => ({ apresentadoEm: {} }));
    estado.config.apresentadoEm ||= {};
    if (estado.config.nomeBot) ia.definirNomeBot(estado.config.nomeBot);
    console.log(`[config] nome: ${ia.nomeDaBot()}; grupos apresentados: ${Object.keys(estado.config.apresentadoEm).length}`);

    const salva = await carregarMemoria();
    if (salva?.mensagens) {
      estado.memoria = { dia: salva.dia, grupo: salva.grupo || GRUPO_PERMITIDO || null, mensagens: salva.mensagens, cobrancas: salva.cobrancas || {} };
      console.log(`[memoria] restaurada: ${estado.memoria.mensagens.length} mensagens de ${estado.memoria.dia}`);
      // se a data mudou enquanto o bot dormia, o dia antigo é fechado assim que o WhatsApp conectar
      normalizarNomesNaMemoria(await listarPerfis().catch(() => []));
      sincronizarRefeicoesNaMemoria(await refeicoesDoDia(estado.memoria.dia).catch(() => []));
    }

    // Grupo onde ela já trabalhava antes de existir a apresentação: marca como apresentada, senão ela "chega" num grupo
    // onde já está há semanas e pede cadastro de quem já tem.
    if (!Object.keys(estado.config.apresentadoEm).length && estado.memoria.grupo && (await listarPerfis()).length) {
      estado.config = await salvarConfig({ [`apresentadoEm.${chaveGrupo(estado.memoria.grupo)}`]: new Date().toISOString() });
      estado.config.apresentadoEm ||= {};
      console.log(`[config] grupo ${estado.memoria.grupo} marcado como já apresentado (bot já ativo nele)`);
    }

    let restaurou = false;
    await iniciarWhatsApp({
      aoMensagem: enfileirarMensagem,
      aoEntrarNoGrupo: apresentarNaFila,
      aoNovoMembro: receberNovoMembro,
      aoConectar: async ({ foraPorMin = 0 } = {}) => {
        if (foraPorMin > 10) avisarAdmin('reconexao', `WhatsApp voltou depois de ${foraPorMin} min desconectado (uptime do processo: ${Math.round(process.uptime() / 60)} min).`).catch(() => {});
        await garantirDiaAtual().catch((e) => console.error('[bot] erro na virada de dia:', e.message));
        if (!restaurou) {
          restaurou = true;
          await restaurarFilaPendente().catch((e) => console.error('[bot] falha ao restaurar pendentes:', e.message));
        }
      },
    });

    // Tudo que mexe na memória do dia passa pela mesma fila das mensagens: fechamento e cobrança nunca rodam no meio de uma resposta.
    // 23:59 todo dia (fuso TZ). Domingo o fecharDia também dispara o semanal.
    cron.schedule('59 23 * * *', () => naFila('cron', () => fecharDia()), { timezone: TZ });
    console.log(`[cron] resumo diário agendado para 23:59 (${TZ})`);

    // A cada 10 min: alguém pulou a refeição do horário de costume? Cobra.
    cron.schedule('*/10 * * * *', () => naFila('cobranca', verificarCobrancas), { timezone: TZ });
    // Conferência por amostragem das respostas que saíram por reserva externa (poucas por semana, em hora aleatória)
    cron.schedule('37 * * * *', () => naFila('revisao', revisarPendentes), { timezone: TZ });
    console.log('[cron] conferência por amostragem das respostas de reserva (de hora em hora, no máximo 2 por semana)');
    console.log(`[cron] cobrança de refeições a cada 10 min (atraso tolerado: ${ATRASO_COBRANCA_MIN} min)`);

    // Domingo 09:00: pesagem semanal (sem IA), a tempo do resumo da semana. Dia 1 às 08:00: relatório do mês anterior.
    cron.schedule('0 9 * * 0', () => naFila('pesagem', pedirPesagem), { timezone: TZ });
    // Notas de voz dela: segunda 08:00 abre a semana, sexta 18:00 fecha (desligáveis com !voz off)
    cron.schedule('0 8 * * 1', () => naFila('voz-segunda', () => falaProgramada('segunda')), { timezone: TZ });
    cron.schedule('0 18 * * 5', () => naFila('voz-sexta', () => falaProgramada('sexta')), { timezone: TZ });
    cron.schedule('0 8 1 * *', () => naFila('mes', fecharMes), { timezone: TZ });
    console.log('[cron] pesagem todo domingo 09:00; relatório mensal dia 1 às 08:00');

    // Dia 1 de cada mês, 4h: a Nutri estuda o que saiu de novo e revisa a base de conhecimento.
    // Fora da fila de propósito: demora minutos, tem a própria guarda (estudando) e não mexe na memória do dia.
    cron.schedule('0 4 1 * *', () => estudar({ dia: agora().dia, motivo: 'revisão mensal' }).catch((e) => console.error('[conhecimento]', e.message)), { timezone: TZ });
    // Saúde da credencial do Google: se o Drive parar (bloqueio do cliente do gcloud, autorização revogada), eu quero
    // saber no mesmo dia, não quando faltar uma semana de anotações.
    cron.schedule('20 7 * * *', () => checarDrive(), { timezone: TZ });
    console.log('[cron] revisão mensal da base de conhecimento (dia 1, 04:00)');
  } catch (e) {
    console.error('[boot] falha fatal:', e);
    process.exit(1);
  }
})();

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

// Render manda SIGTERM a cada deploy: salva o que está pendente e fecha as conexões em vez de morrer no meio de uma escrita
let encerrando = false;
async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[boot] ${sinal} recebido, encerrando...`);
  const limite = setTimeout(() => process.exit(0), 8000).unref();
  try {
    await salvarFilaPendente().catch((e) => console.error('[bot] falha ao salvar pendentes:', e.message));
    await persistirMemoria(estado.memoria).catch(() => {});
    if (diarioPendente()) await gravarDiario().catch(() => {});
    encerrarSocket();
    await fecharMongo();
  } finally {
    clearTimeout(limite);
    process.exit(0);
  }
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
