---
name: copiar-nutribot
description: Monta, do zero e de graça, uma cópia do NutriBot (bot de nutrição que vive num grupo de WhatsApp; Baileys + Google Gemini + MongoDB Atlas + Google Drive, hospedado no Render) a partir do repositório público, com persona própria, chaves próprias e integrações opcionais (IAs reserva, relógio/Health Connect, Hevy, Google Agenda, voz). Use quando o usuário pedir para instalar, clonar, configurar, personalizar ou colocar no ar esse bot.
---

# Copiar o NutriBot

Você (Claude Code) vai colocar no ar uma cópia deste bot para o seu usuário. Nada do grupo original vem junto: nem chaves,
nem persona, nem dados de pessoas. Tudo que é variável está marcado como **[PREENCHER]** e é do seu usuário.
Siga as fases na ordem. Não pule a fase 1: várias respostas dela entram em arquivos das fases seguintes.

## O que é o bot (leia antes de perguntar qualquer coisa)

Uma personagem nutricionista que mora dentro de UM grupo de WhatsApp. Ela analisa fotos e relatos de refeição (calorias, macros,
nota e dica), aprende horário e rotina de cada pessoa, cobra refeição atrasada, fecha o dia e a semana com resumo, gráfico e
previsão de peso, escreve o próprio diário e uma memória de personalidade que evolui, lê a pasta de cada pessoa no Google Drive
como memória, pesquisa no PubMed quando não sabe, e manda nota de voz. Tudo em português brasileiro.

Serviços usados e custo (todos no nível gratuito):

| Serviço | Para quê | Obrigatório? | Custo |
|---|---|---|---|
| Google Gemini (AI Studio) | cérebro: texto, foto, áudio, embeddings, voz | sim | grátis (cota por dia) |
| MongoDB Atlas M0 | banco: perfis, refeições, sessão do WhatsApp, memória vetorial | sim | grátis |
| Google Drive (conta do usuário) | notas em Markdown de cada pessoa, base de conhecimento, resumos | sim | grátis |
| Render (web service) | hospedagem 24/7 | sim | grátis (dorme sem tráfego; o bot se mantém acordado) |
| Número de WhatsApp só do bot | conta que entra no grupo | sim | um eSIM ou chip barato |
| GitHub (repositório próprio) | deploy automático no Render e keepalive por Actions | sim | grátis |
| Groq, Hugging Face, Cohere, OpenRouter | IAs reserva quando o Gemini está em alta demanda | não | grátis |
| Hevy Pro | treino de força (séries, cargas, progressão) | não | assinatura do usuário |
| Health Connect + app Health Data Export | peso, sono, passos, bioimpedância do relógio | não | grátis |
| Google Agenda | rotina real (aula, trabalho, reunião) do dono do bot | não | grátis |
| Open-Meteo, QuickChart, Microsoft Edge TTS | clima, gráficos, voz reserva | automáticos | grátis, sem chave |

Stack: Node 20+ (Render usa 22), ES modules, `@whiskeysockets/baileys` (cliente WhatsApp não oficial), `@google/genai`,
`mongodb`, `googleapis`, `express`, `node-cron`. Repositório de origem (público): `https://github.com/lucasleonardo-hub/nutribot`.

Arquivos que você vai tocar: `persona.md` (novo), `.env` (novo, nunca commitado), `render.yaml` (nome do serviço),
`conhecimento/*.md` (opcional). Todo o resto já funciona sem edição.

## Fase 1: perguntar ao usuário (uma rodada só)

Faça todas as perguntas de uma vez (com `AskUserQuestion` quando houver; senão em texto). Guarde as respostas: elas preenchem
o `persona.md`, o `.env` e o `render.yaml`.

Identidade da bot:

1. **Nome padrão da bot** [PREENCHER] (o grupo pode rebatizar depois com `!nome`).
2. **Profissão e papel** [PREENCHER]: nutricionista é o padrão; pode ser "personal e nutricionista", "coach de corrida"... As regras de análise de refeição continuam valendo.
3. **Idade aparente, história de vida em 1 frase, e 3 a 6 traços de personalidade** [PREENCHER] (ex.: "38 anos, ex-nadadora, direta, engraçada, mãezona, implica com refrigerante").
4. **Tom** [PREENCHER]: quanto de ironia (nenhuma / leve / bastante), usa gíria de internet? quais? palavrão leve permitido?
5. **O que ela ama e o que ela implica** em comida e hábitos [PREENCHER].
6. **Manias** [PREENCHER] (dá nota? comemora? cobra combinado? bordão?).
7. **Voz** (nota de voz): Sulafat (calorosa, padrão), Leda (jovem), Aoede (leve), Zephyr (viva), Laomedeia (animada), Kore (firme). Opcional: uma frase de estilo de fala.

Operação:

8. **Fuso horário do grupo** [PREENCHER] no formato IANA (ex.: `America/Sao_Paulo`). Cada pessoa depois cadastra a própria cidade.
9. **Nome do serviço no Render** [PREENCHER] (vira a URL `https://NOME.onrender.com`; só letras minúsculas, números e hífen).
10. **Nome e e-mail de contato** [PREENCHER] para a página de privacidade (o Google exige para liberar Drive e Agenda).
11. **WhatsApp pessoal do administrador** [PREENCHER] (DDI+DDD+número, ex.: `5511999999999`) para receber avisos técnicos no privado.
12. **Número do bot**: confirmar que existe um número SÓ para o bot, num celular que fica ligado. Nunca o número pessoal (risco de banimento do cliente não oficial).

Integrações opcionais (sim/não para cada; só configure as que o usuário quiser):

13. IAs reserva (Groq, Hugging Face, Cohere, OpenRouter).
14. Hevy (treino de força; precisa de Hevy Pro).
15. Relógio / Health Connect (peso, sono, passos, bioimpedância).
16. Google Agenda do dono (aula, trabalho, reunião; só ele vê comentários sobre a agenda).

## Fase 2: repositório e instalação

```bash
git clone https://github.com/lucasleonardo-hub/nutribot.git NOME-DO-PROJETO
cd NOME-DO-PROJETO
npm install
npm test          # deve passar; ~50 testes de funções puras
```

Depois desconecte do repositório de origem e crie o repositório do usuário (o Render e o keepalive por GitHub Actions
precisam de um repositório dele):

```bash
git remote remove origin
gh repo create NOME-DO-PROJETO --private --source=. --push   # ou crie no site e faça git remote add origin ... && git push -u origin main
```

Confirme que `.gitignore` já contém `.env`, `oauth-client.json` e `drive-oauth.json` (contém). Nunca commite esses arquivos.

## Fase 3: persona.md

Copie `skill-copiar-bot/persona.template.md` para `persona.md` na raiz do projeto e preencha cada [PREENCHER] com as respostas
1 a 6 da fase 1. Regras ao escrever:

- Mantenha a frase "Você NÃO é uma IA, é uma personagem": é ela que sustenta o comportamento no grupo.
- Mantenha o parágrafo "VOCÊ TEM VIDA PRÓPRIA" (a memória de personalidade e o diário dependem dele).
- Termine com a lista "QUEM VOCÊ É" em tópicos; entre 150 e 500 palavras no total.
- Não coloque regras de formato, de refeição ou de dados: isso já está no código (bloco REGRAS em `gemini.js`) e vem depois da persona.
- Não escreva nomes das pessoas do grupo: ela aprende sozinha no cadastro.

`gemini.js` lê o arquivo no boot (`PERSONA_ARQUIVO`, padrão `./persona.md`); se ele tiver menos de 80 caracteres ou não existir,
vale a persona padrão embutida. Rode `node -e "import('./gemini.js').then(m=>console.log(m.SYSTEM_PROMPT.slice(0,300)))"`
e confira que o texto é o do usuário.

## Fase 4: .env

`cp .env.example .env` e preencha. Cada variável, o que é e onde consegue:

**Obrigatórias**

| Variável | Valor | Onde conseguir |
|---|---|---|
| `GEMINI_API_KEY` | chave do Gemini | https://aistudio.google.com/apikey → Create API key → "in new project" |
| `GEMINI_API_KEYS` | mais chaves, separadas por vírgula (opcional, mas recomendado: 2 ou 3) | mesma página, cada uma **em outro projeto Google** (a cota grátis é por projeto) |
| `MONGODB_URI` | string `mongodb+srv://...` com a senha no lugar de `<password>` | fase 5.2 |
| `MONGODB_DB` | `nutribot` (ou o nome que quiser) | |
| `DRIVE_FOLDER_ID` | trecho depois de `/folders/` na URL da pasta | fase 5.3 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | conteúdo inteiro do `drive-oauth.json` em uma linha (no Render) ou deixe vazio e use `GOOGLE_SERVICE_ACCOUNT_FILE=./drive-oauth.json` local | fase 5.3 |
| `ALLOWED_GROUP_ID` | vazio na primeira subida; depois o ID que `!id` responder | fase 6 |
| `ADMIN_TOKEN` | senha longa inventada (o `render.yaml` gera sozinha no Render) | |
| `ADMIN_JID` | `NUMERO@s.whatsapp.net` do administrador (resposta 11) | |
| `TZ` | resposta 8 | |
| `BOT_NOME` | resposta 1 | |
| `PERSONA_ARQUIVO` | `./persona.md` | |
| `CONTATO_NOME`, `CONTATO_EMAIL` | resposta 10 | |
| `REPO_URL` | URL do repositório do usuário | |

**Opcionais** (deixe vazio o que o usuário não quiser):

| Variável | Para quê | Onde conseguir |
|---|---|---|
| `GROQ_API_KEY` | IA reserva de texto | https://console.groq.com/keys |
| `HF_API_KEY` | IA reserva de texto e foto | https://huggingface.co/settings/tokens (token de leitura) |
| `COHERE_API_KEY` | IA reserva de texto e foto (trial 1.000/mês) | https://dashboard.cohere.com/api-keys |
| `OPENROUTER_API_KEY` | IA reserva (modelos `:free`, 50 pedidos/dia) | https://openrouter.ai/keys |
| `HEVY_CHAVES` | `primeironome=chave,outro=chave` | Hevy Pro → https://hevy.com/settings?developer |
| `AGENDA_DONO` | primeiro nome de quem é dono da agenda | resposta 16 |
| `AGENDA_ICS_URL` | endereço secreto iCal da agenda (um ou mais, separados por vírgula) | Google Agenda → Configurações da agenda → Integrar agenda → "Endereço secreto no formato iCal" |
| `AGENDA_PALAVRAS_TRABALHO` | palavras que marcam evento de trabalho (nome da empresa) | usuário |
| `VOZ_GEMINI_VOZ`, `VOZ_ESTILO` | voz e estilo da nota de voz | resposta 7 |
| `KEEPALIVE_URL` | só fora do Render (URL pública do serviço) | |

Os demais valores de `.env.example` (modelos, intervalos, cache) podem ficar como estão.

## Fase 5: serviços obrigatórios

### 5.1 Gemini
Crie a chave conforme a tabela. Se o usuário tiver 2 ou 3 contas Google, uma chave em cada uma multiplica a cota grátis.
O bot reveza chaves e modelos sozinho e mostra o consumo com `!status` no grupo.

### 5.2 MongoDB Atlas
1. https://www.mongodb.com/cloud/atlas/register → **Create** → **M0 Free** → **Create Deployment**.
2. Crie usuário e senha do banco (senha sem caracteres especiais facilita); **Drivers** → copie a string `mongodb+srv://...` e troque `<password>`.
3. **Network Access** → **Add IP Address** → **Allow Access From Anywhere** → Confirm (o Render não tem IP fixo).
O bot cria coleções e o índice vetorial (Vector Search, grátis no M0) sozinho no boot.

### 5.3 Google Drive (e Agenda) com cliente OAuth próprio
O Google não deixa Service Account gravar em Drive pessoal, por isso usa-se uma credencial OAuth da conta do usuário. Faça
tudo na conta Google dona da pasta:
1. Drive → **Nova pasta** com o nome da bot. Abra; o `DRIVE_FOLDER_ID` é o trecho após `/folders/` na URL.
2. Ative as APIs: https://console.cloud.google.com/apis/library/drive.googleapis.com e, se for usar agenda, https://console.cloud.google.com/apis/library/calendar-json.googleapis.com.
3. https://console.cloud.google.com/auth/overview → Começar → nome do app, e-mail, público **Externo** → Criar.
4. https://console.cloud.google.com/auth/branding → página inicial `https://NOME.onrender.com/`, política de privacidade `https://NOME.onrender.com/privacidade` (as duas páginas já existem no bot, com `CONTATO_NOME`/`CONTATO_EMAIL`), e em **Domínios autorizados** exatamente `NOME.onrender.com` (não `onrender.com`: ele é sufixo público e o Google recusa).
5. https://console.cloud.google.com/auth/audience → **Publicar app**. Em modo de teste a autorização expira a cada 7 dias e o bot pararia toda semana.
6. https://console.cloud.google.com/apis/credentials → Criar credenciais → **ID do cliente OAuth** → **App para computador** → baixar o JSON → salvar como `oauth-client.json` na raiz do projeto.
7. `npm run drive-auth` → o navegador abre; escolha a conta dona da pasta; em "app não verificado" clique Avançado → continuar; aceite Drive (e Agenda). O script grava `drive-oauth.json` e mostra a conta e os escopos.
8. Local: `GOOGLE_SERVICE_ACCOUNT_FILE=./drive-oauth.json`. Render: copie o conteúdo inteiro de `drive-oauth.json` para `GOOGLE_SERVICE_ACCOUNT_JSON`.

O passo 4 precisa da URL do Render, então crie o serviço (fase 6) antes de concluir o 4 ou volte aqui depois; o bot roda sem Drive, só reclama nos logs.

### 5.4 Número do bot
Um número só para o bot, num celular que fica ligado e com internet. Antes de conectar ao bot, use o número normalmente por
2 ou 3 dias (foto, nome, entrar no grupo, trocar mensagens): número novo que nasce plugado num cliente não oficial é o que mais
toma ban. O bot só responde em um grupo, espera "digitando" antes de responder e nunca inicia conversa com desconhecidos. Não mude isso.

## Fase 6: subir no Render

1. Em `render.yaml`, troque `name: nutribot` pelo nome escolhido (resposta 9) e `TZ` pelo fuso (resposta 8). Commit e push.
2. https://dashboard.render.com/blueprints → **New Blueprint Instance** → repositório do usuário → Connect. O blueprint já define plano Free, Node 22, `npm start`, health check em `/ping` e gera `ADMIN_TOKEN`. Ele pede as variáveis marcadas `sync: false`: preencha com o `.env` (deixe `ALLOWED_GROUP_ID` vazio por enquanto).
3. Adicione também, em **Environment**, as variáveis que não estão no blueprint: `BOT_NOME`, `CONTATO_NOME`, `CONTATO_EMAIL`, `REPO_URL`, `PERSONA_ARQUIVO`, `VOZ_GEMINI_VOZ` e as opcionais escolhidas. (O `persona.md` vai no repositório, ele não tem segredo.)
4. Espere o deploy. Abra `https://NOME.onrender.com/qr` e escaneie com o celular do bot (WhatsApp → Aparelhos conectados → Conectar um aparelho).
5. Coloque o número do bot no grupo. Mande `!id`; ele responde o ID do grupo. Cole em `ALLOWED_GROUP_ID` no Render e salve. O Render reinicia; a sessão fica no Mongo, não precisa escanear de novo.
6. Keepalive: o bot já bate em `/ping` a cada 10 min (`RENDER_EXTERNAL_URL`), e `.github/workflows/keepalive.yml` faz o GitHub bater a cada 5 min. Confira que o workflow está habilitado em Actions. Opcional: UptimeRobot em `https://NOME.onrender.com/ping` a cada 5 min.
7. `https://NOME.onrender.com/status?token=ADMIN_TOKEN` mostra número, grupo, keepalive e uptime; `/logout?token=...` desvincula o número e gera QR novo.

Limite do Free: 750 h/mês de instância, um serviço 24/7 gasta ~744. Só esse serviço pode ficar na conta Free do Render.

## Fase 7: integrações opcionais

Configure só as que o usuário disse sim na fase 1.

**IAs reserva.** Só entram quando todos os modelos Gemini falharem por alta demanda ou cota. Basta preencher as chaves; a ordem
e os modelos já estão em `reservas.js`. Respostas que saíram por reserva são conferidas por amostragem pelo Gemini depois
(`REVISOES_POR_SEMANA`), e a bot corrige no grupo se errou.

**Hevy (treino de força).** Cada pessoa com Hevy Pro gera a própria chave em hevy.com/settings?developer e manda ao
administrador; `HEVY_CHAVES=ana=chave,joao=chave` (primeiro nome igual ao do cadastro no grupo). O bot sincroniza de hora em
hora e calcula séries por grupo muscular, volume, RPE e progressão de carga; `!treino` mostra o bloco.

**Relógio / Health Connect (Android).** Sem API própria: a pessoa instala o app *Health Data Export* (Play Store,
`com.teqxnology.healthdataexport`), liga a exportação automática para uma planilha Google (abas Activity, Body Measurements,
Sleep) e coloca essa planilha dentro da pasta dela no Drive da bot, com "saude", "health", "galaxy", "watch" ou "relogio" no nome.
O bot lê pela Sheets API com a mesma credencial do Drive. Nada a configurar no `.env`.

**Google Agenda.** Duas formas, da mais simples para a mais completa: (a) `AGENDA_ICS_URL` com o endereço secreto iCal da
agenda do dono (é segredo; só no `.env`/Render); (b) com o cliente OAuth próprio autorizado com o escopo de Agenda na fase 5.3,
o bot lê todas as agendas da conta pela API, com título e sem atraso. Em ambas, `AGENDA_DONO` é o primeiro nome do dono, e a
bot só comenta a agenda com ele. Agendas de feriados, aniversários e entretenimento são ignoradas (`AGENDA_IGNORAR`).
Eventos com nome de matéria são aula; "Trabalho", nome da empresa (`AGENDA_PALAVRAS_TRABALHO`) e reuniões são trabalho.

**Pasta de cada pessoa no Drive.** Cada participante pode ter uma pasta com o próprio nome na raiz da pasta da bot; PDFs, Docs,
Markdown e imagens de exame que ele colocar lá viram memória sobre ele. A bot cria `Nutri-Ficha.md`, `Nutri-Notas.md` e
`Nutri-Plano.md` lá dentro.

**Clima, gráficos, voz.** Já funcionam sem chave: clima pela cidade do cadastro (Open-Meteo), gráficos pelo QuickChart, voz pelo
TTS do Gemini com o leitor do Edge como reserva.

## Fase 8: verificação

Rode e confira, nesta ordem:

1. `npm test` verde; `node --check` passa em todos os `.js` (o workflow de CI faz isso a cada push).
2. `curl https://NOME.onrender.com/estado` → `{"status":"conectado", ...}`.
3. No grupo: `!id`, `!status` (modelos e cota), `!ajuda`. A bot se apresenta sozinha ao entrar e pergunta como querem chamá-la e o cadastro de cada um (nome, peso, altura, objetivo, cidade, dieta).
4. Mande uma foto de prato: chega um "deixa eu ver..." e depois a análise com o bloco Refeição / O que eu vi / Estimativa / Veredito / Dica.
5. `!hoje` mostra o total do dia. No Drive aparecem `Diario/AAAA-MM-DD.md`, `Perfis/` e a pasta `Conhecimento/`.
6. Peça "manda em áudio" e confira que a nota de voz chega com a voz escolhida.
7. Se ligou agenda: `!agenda`; Hevy: `!treino`; relógio: `!dossie` mostra "DADOS DO RELÓGIO" depois da primeira exportação.

## Regras que não se mexe

- Um grupo só (`ALLOWED_GROUP_ID`), nunca mensagens para quem não falou com ela, pausa "digitando" antes de responder: são as proteções contra banimento.
- Segredos só em `.env` local e nas variáveis do Render. `.env`, `oauth-client.json`, `drive-oauth.json` nunca vão para o git.
- Não rode local e no Render ao mesmo tempo com a mesma sessão de WhatsApp: um derruba o outro (`npm run logout` para desvincular).
- Não misture o número pessoal do usuário com o bot.

## Onde mexer para personalizar mais

- **Base de conhecimento**: `conhecimento/*.md` (sobe para o Mongo e o Drive no boot; todo dia 1 ela revisa com PubMed). Adicione documentos do foco do grupo.
- **Comandos**: `comandos.js`. **Horários programados** (fechamento do dia, resumo de domingo, pesagem, notas de voz de segunda e sexta, relatório do mês): `index.js` e `dia.js`.
- **Ritmo no grupo**: `PAPO_INTERVALO_MIN`, `ATRASO_COBRANCA_MIN`, `JANELA_COBRANCA_MIN`, `MAX_FOTOS_JUNTAS`.
- **Modelos**: `GEMINI_MODEL`, `GEMINI_MODELOS_RESERVA`, `GEMINI_MODELOS_LEVES` (cota grátis é por modelo; a cadeia soma as cotas).

## Problemas comuns

- `storageQuotaExceeded` ao salvar no Drive: está usando Service Account; use a credencial OAuth da fase 5.3.
- `invalid_grant` no Drive: credencial expirada ou revogada (app em modo de teste expira em 7 dias). Publique o app e refaça `npm run drive-auth`.
- HTTP 429 do Gemini com "limit: 0": modelo sem nível gratuito (os Pro). Fique nos Flash.
- HTTP 402 "prepayment credits are depleted": o projeto Google da chave está em modo pré-pago sem saldo; use uma chave de projeto no nível gratuito ou compre crédito.
- 503 "high demand" em todos os modelos: normal em horários de pico; as reservas assumem se houver chaves.
- Bot deslogou (`loggedOut`): ele limpa a sessão; abra `/qr` e escaneie de novo com o celular do bot.
- "Domínio inválido" no console do Google: o domínio autorizado é `NOME.onrender.com` inteiro.

## O que não vem na cópia

Nenhum dado do grupo original: perfis, refeições, memória de personalidade, diário, momentos e lembranças começam vazios. A
personalidade nasce do `persona.md` e evolui sozinha com o grupo novo.
