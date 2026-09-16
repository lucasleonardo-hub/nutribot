# Guia Passo a Passo para Leigos - NutriBot

Só links e botões. Tudo que você gera aqui vai no arquivo `.env` (local) ou nas variáveis do Render.
Comece copiando `.env.example` para `.env`.

> ⚠️ **Nunca escaneie o QR com o seu número pessoal.** O bot usa o Baileys, um cliente NÃO oficial do WhatsApp, e o WhatsApp bane contas que usam isso. Use um número só do bot (o eSIM). Veja o passo 0.

---

## 0) Número do bot (eSIM) - antes de tudo

O número pessoal já foi desvinculado (`npm run logout`). Daqui pra frente só o número do eSIM entra no bot.

1. Instale o WhatsApp (ou WhatsApp Business) num celular com o eSIM ativo e cadastre o número novo.
2. **"Esquenta" o número por 2 a 3 dias antes de ligar o bot**: coloque foto e nome no perfil, entre no grupo, troque umas mensagens normais com vocês dois. Número recém-criado que já nasce plugado num cliente não oficial é o que mais toma ban.
3. Deixe esse celular com internet e o WhatsApp aberto de vez em quando (o aparelho conectado depende do celular estar ativo pelo menos a cada 14 dias).
4. Só então escaneie o QR (passo 4.3) com ESSE celular.

Regras pra não ser banido:
- O bot só responde em UM grupo (`ALLOWED_GROUP_ID`) e nunca manda mensagem pra quem não falou com ele. Não mude isso.
- Ele já espera uns segundos "digitando" antes de responder (parece humano). Não tire.
- Não use o número do bot pra mais nada (marketing, disparos, muitos grupos).
- Se um dia precisar trocar de número: `npm run logout` (local) ou abra `https://nutribot-5gwk.onrender.com/logout?token=SEU_ADMIN_TOKEN` e escaneie de novo em `/qr`.

---

## 1) API Key do Gemini (variável `GEMINI_API_KEY`)

1. https://aistudio.google.com/apikey
2. Botão **Create API key** (ou "Criar chave de API")
3. **Create API key in new project** → copia a chave que aparece

> O modelo já vem configurado como `gemini-3.6-flash` (1.5 e 2.5 Flash foram aposentados pelo Google para chaves novas). Não precisa mexer.

---

## 2) MongoDB Atlas grátis (variável `MONGODB_URI`)

1. Criar conta: https://www.mongodb.com/cloud/atlas/register
2. Botão **Create** (ou "Build a Database") → escolha **M0 Free** → **Create Deployment**
3. Na tela que abre ("Connect to Cluster0"):
   - Digite um **Username** e **Password** (anote a senha, sem caracteres especiais pra facilitar) → **Create Database User**
   - **Choose a connection method** → **Drivers** → copie a string que começa com `mongodb+srv://...`
   - Troque `<password>` na string pela senha que você criou
4. Liberar acesso do Render:
   https://cloud.mongodb.com/ → menu esquerdo **Network Access** → **Add IP Address** → **Allow Access From Anywhere** → **Confirm**

---

## 3) Google Drive (variáveis `DRIVE_FOLDER_ID` e `GOOGLE_SERVICE_ACCOUNT_JSON`)

> ⚠️ O Google NÃO deixa Service Account gravar em Drive pessoal (erro `storageQuotaExceeded`). Por isso o bot usa uma credencial OAuth da SUA conta, o arquivo `drive-oauth.json`. O código aceita os dois formatos, sem mudar nada.

### 3.1 Pasta no Drive
1. https://drive.google.com → **+ Novo** → **Nova pasta** → nome `NutriBot` → **Criar**
2. Abra a pasta. A URL fica `https://drive.google.com/drive/folders/1AbCdEf...` → o trecho depois de `/folders/` é o `DRIVE_FOLDER_ID`

### 3.2 Credencial - jeito rápido (via gcloud)
1. Instale o Google Cloud SDK: https://cloud.google.com/sdk/docs/install
2. No PowerShell: `gcloud auth login --enable-gdrive-access` → autorize no navegador com a sua conta
3. Copie o arquivo `%APPDATA%\gcloud\legacy_credentials\SEU_EMAIL\adc.json` para a pasta do bot com o nome `drive-oauth.json`
4. No `.env`: `GOOGLE_SERVICE_ACCOUNT_FILE=./drive-oauth.json`
   Pro Render: abra o `drive-oauth.json` no Bloco de Notas, copie TUDO e cole na variável `GOOGLE_SERVICE_ACCOUNT_JSON`.

### 3.3 Credencial - jeito permanente (cliente OAuth próprio). Use se o 3.2 parar de funcionar
1. https://console.cloud.google.com/apis/library/drive.googleapis.com → **Ativar**
2. https://console.cloud.google.com/auth/overview → **Começar** → nome `NutriBot`, seu e-mail → público-alvo **Externo** → **Criar**
3. https://console.cloud.google.com/auth/audience → **Adicionar usuários** → seu e-mail → **Salvar**
4. https://console.cloud.google.com/apis/credentials → **+ Criar credenciais** → **ID do cliente OAuth** → tipo **App para computador** → **Criar** → **Fazer download do JSON**
5. Salve como `oauth-client.json` na pasta do bot e rode `npm run drive-auth` → autorize no navegador → o `drive-oauth.json` é gerado sozinho

> Pra abrir no Obsidian: instale o Google Drive para desktop (https://www.google.com/drive/download/) e aponte o Vault do Obsidian pra pasta `NutriBot`.

---

## 4) Subir no Render (grátis) e deixar 100% online

O código já está no GitHub em https://github.com/lucasleonardo-hub/nutribot (privado). Se mudar algo, na pasta do bot:
```
git add .
git commit -m "ajuste"
git push
```
O Render redeploya sozinho a cada push.

### 4.1 Criar o serviço (Blueprint, 1 clique)
1. https://dashboard.render.com/register → entre com o GitHub
2. https://dashboard.render.com/blueprints → **New Blueprint Instance** → escolha o repositório `nutribot` → **Connect**
3. O `render.yaml` já configura Free, Node 22, `npm start`, health check e gera o `ADMIN_TOKEN` sozinho. Ele só vai pedir as chaves:
   - `GEMINI_API_KEY`
   - `MONGODB_URI`
   - `DRIVE_FOLDER_ID`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (o conteúdo inteiro do `drive-oauth.json` colado)
   - `ALLOWED_GROUP_ID` (deixe vazio por enquanto)
4. **Apply** e espere o deploy terminar. A URL é https://nutribot-5gwk.onrender.com (painel: https://dashboard.render.com/web/srv-daktqflbedkc73d3njpg).

> Se preferir sem Blueprint: https://dashboard.render.com/select-repo?type=web → `nutribot` → Free, Build `npm install`, Start `npm start` → adicione as variáveis acima mais `TZ=America/Sao_Paulo`, `KEEPALIVE_MINUTES=10` e um `ADMIN_TOKEN` inventado por você.

### 4.2 Pegar o ADMIN_TOKEN
No Render: serviço `nutribot` → **Environment** → copie o valor de `ADMIN_TOKEN`. Ele libera:
- `https://nutribot-5gwk.onrender.com/status?token=TOKEN` → mostra número conectado, grupo, keepalive, uptime
- `https://nutribot-5gwk.onrender.com/logout?token=TOKEN` → desvincula o número atual e gera QR novo

### 4.3 Escanear o QR Code (com o celular do eSIM!)
1. Abra `https://nutribot-5gwk.onrender.com/qr`
2. No celular do BOT: WhatsApp → **⋮** → **Aparelhos conectados** → **Conectar um aparelho** → escaneie
3. Coloque o número do bot no grupo com as 2 pessoas.
4. Mande `!id` no grupo. O bot responde o ID do grupo. Copie e cole em `ALLOWED_GROUP_ID` no Render (**Environment** → salvar). O Render reinicia sozinho e a sessão continua salva no Mongo (não precisa escanear de novo).

### 4.4 Ficar 100% online (anti-sleep em 2 camadas)
O plano Free do Render desliga o serviço após 15 min sem tráfego. O bot resolve isso de dois jeitos, use os dois:

**Camada 1 - automática (já no código):** o próprio bot bate em `/ping` na URL pública a cada 10 min usando a `RENDER_EXTERNAL_URL` que o Render preenche sozinho. Confira em `/status?token=...` o campo `keepalive`.

**Camada 2 - GitHub Actions (já configurada):** o arquivo `.github/workflows/keepalive.yml` faz o GitHub bater em `/ping` a cada 5 min. Acompanhe em https://github.com/lucasleonardo-hub/nutribot/actions. Atenção: o GitHub desativa agendamentos se o repositório ficar 60 dias sem nenhum commit; se isso acontecer, é só fazer qualquer commit ou clicar em **Enable workflow**.

**Camada 3 - opcional (UptimeRobot):** https://dashboard.uptimerobot.com/monitors → **+ New Monitor** → HTTP(s) · URL `https://nutribot-5gwk.onrender.com/ping` · 5 minutes.

Limites do Free que você precisa saber:
- 750 horas/mês de instância grátis. Um serviço 24/7 gasta ~744. Ou seja: **só pode ter ESSE serviço** rodando na conta Free do Render.
- O Render reinicia o serviço em todo deploy e de vez em quando por manutenção. A sessão do WhatsApp fica no Mongo, então ele volta sozinho em ~30 s sem QR novo.
- Se quiser zero risco de sleep, o plano **Starter** (US$ 7/mês) não dorme e dispensa a camada 2.

---

## 5) Rodar no seu PC (opcional, pra testar antes)

```
npm install
npm start
```
O QR aparece no terminal e também em http://localhost:3000/qr

> Não rode local e no Render ao mesmo tempo com a mesma sessão: um derruba o outro. Pra desvincular o número atual: `npm run logout`.

---

## Comandos no grupo

| Comando   | O que faz                                   |
|-----------|---------------------------------------------|
| `!id`     | Mostra o ID do grupo (pro `ALLOWED_GROUP_ID`)|
| `!perfil` | Mostra seu cadastro e as gírias aprendidas   |
| `!persona`| Mostra a memória de personalidade da Nutri (apelidos, piadas internas, padrões) |
| `!dossie` | Mostra o que há na sua pasta do Drive (o que ela conseguiu ler) e as notas dela sobre você |
| `!fontes` | Lista os documentos da base de conhecimento (pasta Conhecimento no Drive) |
| `!estudar`| Manda a Nutri revisar a base com estudos novos do PubMed (roda sozinho todo dia 1) |
| `!reset`  | Apaga seu cadastro pra refazer o onboarding  |
| `!resumo` | Força o Resumo Diário Ácido agora            |
| `!ajuda`  | Lista os comandos                            |

## Como a Nutri funciona por dentro

- **Base de conhecimento** (`conhecimento/*.md` no código → Mongo → Drive `Conhecimento/`): Base, Hipertrofia, Emagrecimento, Saúde-Índices, Performance-Salto e Rotina. Os documentos do foco de cada pessoa entram em toda resposta. Todo dia 1 às 4h ela pesquisa no PubMed e reescreve o que mudou; `!estudar` força isso.
- **Pesquisa sob demanda**: quando a base não basta, ela pesquisa (PubMed/Wikipedia), responde e salva uma nota de estudo em `Conhecimento/Pesquisas/` pra não pesquisar de novo.
- **Pasta de cada pessoa no Drive** (raiz, com o nome da pessoa): tudo que a pessoa colocar lá (PDF, Google Docs, .md, .txt, imagem de exame) a Nutri lê e usa como memória sobre ela (PDF e imagem são transcritos pelo Gemini uma vez e ficam em cache). O que ela aprende conversando vai pra `Nutri-Notas.md` na mesma pasta, reescrito toda noite; a ficha (peso, altura, horários, rotina) fica em `Nutri-Ficha.md`. Ela faz perguntas quando falta algo (no máximo uma por mensagem). A pasta é achada pelo primeiro nome; se não existir, ela cria.
- **Rotina de cada pessoa**: cada refeição analisada é registrada com horário. Com 3+ registros ela aprende o horário habitual de café, almoço e jantar; no fechamento do dia reescreve a ficha de rotina (`Perfis/Nome.md`).
- **Cobrança**: a cada 10 min ela checa quem passou 75 min do horário habitual sem mandar a refeição e cobra no grupo (uma vez por refeição por dia, só entre 7h e 23h). `ATRASO_COBRANCA_MIN` muda a tolerância.
- **Personalidade**: `Perfis/Nutri.md` é a memória que ela mesma reescreve toda noite (apelidos, piadas internas, padrões, bordões).
- **Reservas de IA** (só quando todos os Gemini falharem com 503 "alta demanda"): texto pelo Groq → Hugging Face → Cohere; **foto** pelo Hugging Face (Gemma 3 27B, depois Qwen3-VL) → Cohere. Áudio e PDF só o Gemini faz. Se tudo cair, ela avisa no grupo que travou em vez de ficar muda. As chaves são opcionais; sem elas o bot roda só com Gemini.
- **Áudio**: mensagem de voz é entendida pelo Gemini direto (sem transcrição separada). Vale como relato de refeição.
- **Velocidade**: texto responde em 1 a 3 s. Foto recebe um "deixa eu ver esse prato..." na hora e a análise vem em seguida.

## Se der erro

- **`storageQuotaExceeded` ao salvar no Drive:** você está usando Service Account em Drive pessoal. Use a credencial OAuth da sua conta (passo 3.2 ou 3.3).
- **`invalid_grant` no Drive:** a credencial OAuth expirou ou foi revogada. Refaça o passo 3.2 (ou 3.3) e atualize `GOOGLE_SERVICE_ACCOUNT_JSON` no Render.
- **Bot deslogou (`loggedOut`):** ele limpa a sessão no Mongo sozinho. Abra `/qr` de novo e escaneie com o celular do eSIM.
- **Número do bot foi banido:** peça revisão dentro do próprio WhatsApp (geralmente libera em horas quando é a primeira vez). Se não liberar, novo eSIM → passo 0 → `/logout?token=` → `/qr`.
- **Quer trocar o número do bot:** `https://nutribot-5gwk.onrender.com/logout?token=ADMIN_TOKEN` → depois `/qr`. Localmente: `npm run logout`.
- **`/status` diz `keepalive: desligado` no Render:** a variável `RENDER_EXTERNAL_URL` não veio. Adicione `KEEPALIVE_URL=https://nutribot-5gwk.onrender.com` no Environment.
- **Resumo não chegou às 23:59:** o bot estava dormindo (confira o UptimeRobot). Na primeira mensagem do dia seguinte ele fecha o dia anterior automaticamente.
