// logout.js - Desvincula o número do WhatsApp que está na sessão do Mongo e limpa a sessão.
// Uso: npm run logout
// Depois disso o bot (local ou no Render) mostra um QR novo em /qr pra você escanear com o número do bot (eSIM).

import 'dotenv/config';
import pino from 'pino';
import makeWASocket, { fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } from '@whiskeysockets/baileys';
import { conectarMongo, useMongoAuthState } from './mongo.js';

const logger = pino({ level: 'silent' });

async function main() {
  await conectarMongo();
  const { state, saveCreds, limparSessao } = await useMongoAuthState();

  if (!state.creds?.me?.id) {
    console.log('[logout] nenhuma sessão vinculada. Limpando restos e saindo.');
    await limparSessao();
    return process.exit(0);
  }
  console.log(`[logout] sessão atual: ${state.creds.me.id} (${state.creds.me.name || 'sem nome'})`);

  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  sock.ev.on('creds.update', saveCreds);

  // Se não conseguir avisar o WhatsApp em 45s, limpa a sessão mesmo assim.
  const timeout = setTimeout(async () => {
    console.log('[logout] WhatsApp não respondeu a tempo. Limpando a sessão no Mongo mesmo assim.');
    console.log('[logout] Remova o aparelho manualmente no celular: WhatsApp > Aparelhos conectados > (Ubuntu/Chrome) > Sair.');
    await limparSessao();
    process.exit(0);
  }, 45_000);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('[logout] conectado. Enviando logout pro WhatsApp (remove o aparelho do celular)...');
      try {
        await sock.logout();
        console.log('[logout] aparelho desvinculado com sucesso.');
      } catch (e) {
        console.log('[logout] logout falhou:', e.message, '- limpando a sessão mesmo assim.');
      }
      clearTimeout(timeout);
      await limparSessao();
      console.log('[logout] sessão apagada do Mongo. Próximo start do bot gera QR novo.');
      process.exit(0);
    }
    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      if (codigo === 401) {
        // já estava deslogado no celular
        clearTimeout(timeout);
        await limparSessao();
        console.log('[logout] sessão já estava inválida (401). Limpa do Mongo.');
        process.exit(0);
      }
      console.log(`[logout] conexão fechou (${codigo}), tentando de novo...`);
      setTimeout(main, 2000);
    }
  });
}

main().catch((e) => {
  console.error('[logout] erro:', e);
  process.exit(1);
});
