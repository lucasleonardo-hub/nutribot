// drive-auth.js - Gera o arquivo drive-oauth.json (credencial OAuth da SUA conta Google)
// Uso: coloque o arquivo oauth-client.json (baixado do Google Cloud > Credenciais > ID do cliente OAuth > tipo "App para computador")
// na pasta do bot e rode:  npm run drive-auth
// O navegador abre, você autoriza, e o drive-oauth.json é salvo. Aponte GOOGLE_SERVICE_ACCOUNT_FILE=./drive-oauth.json no .env.

import fs from 'node:fs';
import http from 'node:http';
import { exec } from 'node:child_process';
import { google } from 'googleapis';

const ARQ_CLIENTE = process.argv[2] || './oauth-client.json';
const ARQ_SAIDA = './drive-oauth.json';
const PORTA = 8085;

if (!fs.existsSync(ARQ_CLIENTE)) {
  console.error(`Arquivo ${ARQ_CLIENTE} não encontrado. Baixe o JSON do cliente OAuth (tipo "App para computador") em https://console.cloud.google.com/apis/credentials`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(ARQ_CLIENTE, 'utf8'));
const cfg = raw.installed || raw.web || raw;
const redirect = `http://localhost:${PORTA}/`;
const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, redirect);

const url = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const servidor = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get('code');
  if (!code) return res.end('Aguardando código...');
  try {
    const { tokens } = await oauth2.getToken(code);
    const saida = {
      type: 'authorized_user',
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      refresh_token: tokens.refresh_token,
    };
    fs.writeFileSync(ARQ_SAIDA, JSON.stringify(saida, null, 2));
    res.end('<h2>Pronto! Pode fechar esta aba.</h2>');
    console.log(`\n✅ ${ARQ_SAIDA} salvo. Coloque no .env: GOOGLE_SERVICE_ACCOUNT_FILE=${ARQ_SAIDA}`);
  } catch (e) {
    res.end('Erro: ' + e.message);
    console.error(e);
  } finally {
    setTimeout(() => process.exit(0), 500);
  }
});

servidor.listen(PORTA, () => {
  console.log('Abrindo o navegador para autorizar o acesso ao Drive...\n' + url);
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
});
