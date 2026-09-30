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

### 3.3 Credencial - jeito permanente (cliente OAuth próprio). RECOMENDADO: o Google avisou que vai bloquear o escopo de Drive no cliente do gcloud (3.2)
1. Ative as duas APIs: https://console.cloud.google.com/apis/library/drive.googleapis.com e https://console.cloud.google.com/apis/library/calendar-json.googleapis.com → **Ativar**
2. https://console.cloud.google.com/auth/overview → **Começar** → nome `NutriBot`, seu e-mail → público-alvo **Externo** → **Criar**
3. https://console.cloud.google.com/auth/branding → preencha: página inicial `https://nutribot-5gwk.onrender.com/`, política de privacidade `https://nutribot-5gwk.onrender.com/privacidade` (as duas páginas existem no próprio bot) e, em **Domínios autorizados**, `nutribot-5gwk.onrender.com`.
   > Atenção: é `nutribot-5gwk.onrender.com` inteiro, não `onrender.com`. O `onrender.com` está na lista pública de sufixos (como `github.io`), então pro Google o domínio "privado" é o subdomínio do serviço. Digitar só `onrender.com` dá "domínio inválido".
4. https://console.cloud.google.com/auth/audience → **Publicar app** (confirmar). Em modo de teste o Google expira a autorização a cada 7 dias e o bot pararia toda semana; publicado, mesmo sem verificação, ela não expira. Vai aparecer "app não verificado" na hora de autorizar: **Avançado** → continuar.
5. https://console.cloud.google.com/apis/credentials → **+ Criar credenciais** → **ID do cliente OAuth** → tipo **App para computador** → **Criar** → **Fazer download do JSON**
6. Salve como `oauth-client.json` na pasta do bot e rode `npm run drive-auth` → escolha a conta dona da pasta do Drive → aceite Drive e Agenda → o `drive-oauth.json` é gerado sozinho (o script mostra a conta e se os dois acessos entraram)
7. Cole o conteúdo do `drive-oauth.json` novo na variável `GOOGLE_SERVICE_ACCOUNT_JSON` do Render. A partir daí a Agenda passa a ler pela API (tempo real, todas as agendas), sem depender do endereço iCal.

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
3. Coloque o número do bot no grupo com as 2 pessoas. Ela se apresenta sozinha, pergunta como querem chamá-la e pede o cadastro de cada um.
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

## 6) Desenvolvimento: testes antes do deploy

- `npm test` roda os testes das funções puras (compilação de refeições, estimativas, datas, fusos, formatação pro WhatsApp). Leva 1 segundo.
- A cada push na `main` o GitHub roda `npm test` e a checagem de sintaxe de todos os módulos ANTES de disparar o deploy no Render. Se algo quebrar, o deploy não acontece e o bot continua na versão anterior.
- Módulos: `index.js` é só o boot (servidor HTTP, crons, desligamento). `mensagens.js` é o fluxo de cada mensagem; `comandos.js` os `!comandos`; `dia.js` memória do dia, daily note, fechamento do dia/semana e revisão mensal; `cobranca.js` a cobrança de refeição; `whatsapp.js` conexão e envio; `perfis.js` perfis com horários e atualização de dados; `estado.js` o estado compartilhado e a fila única; `util.js` funções puras; `resumo.js` compilação de refeições e semana em código.

## Comandos no grupo

| Comando   | O que faz                                   |
|-----------|---------------------------------------------|
| `!id`     | Mostra o ID do grupo (pro `ALLOWED_GROUP_ID`)|
| `!nome X` | Rebatiza a Nutri (ela pergunta o nome ao entrar no grupo) |
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
- **Pasta de cada pessoa no Drive** (raiz, com o nome da pessoa): tudo que a pessoa colocar lá (PDF, Google Docs, .md, .txt, imagem de exame) a Nutri lê e usa como memória sobre ela (PDF e imagem são transcritos pelo Gemini uma vez e ficam em cache). O que ela aprende conversando vai pra `Nutri-Notas.md` na mesma pasta, reescrito toda noite; a ficha (peso, altura, horários, rotina) fica em `Nutri-Ficha.md`. Ela faz perguntas quando falta algo (no máximo uma por mensagem). A pasta é achada pelo nome (primeiro nome mais uma parte do sobrenome, ou uma pasta só com o primeiro nome) e o ID fica gravado no perfil dali em diante; se não existir, ela cria.
- **Rotina de cada pessoa**: cada refeição analisada é registrada com horário. Com 3+ registros ela aprende o horário habitual de café, almoço e jantar; no fechamento do dia reescreve a ficha de rotina (`<Nome da pessoa>/Nutri-Ficha.md`).
- **Modelos e cota**: a cota gratuita do Gemini é por modelo (Flash: 20 pedidos/dia; Flash Lite: 500/dia). Foto, comida, pergunta, menção, resumos e persona usam a fila Flash (3.6 -> 3.8 -> 3.7 -> 3.5 -> 3 -> 2.5); papo, cadastro, notas, rotina, cobrança e extrações usam a fila Lite. `!status` no grupo mostra o consumo do dia e quem está de castigo.
- **Cobrança**: a cada 10 min ela checa quem passou 75 min do horário habitual sem mandar a refeição e cobra no grupo (uma vez por refeição por dia, só entre 7h e 23h). Ela só cobra depois de APRENDER o horário da pessoa (3+ refeições registradas naquele slot) e só até 2 h depois do limite; antes disso, nada de cobrança. `ATRASO_COBRANCA_MIN` e `JANELA_COBRANCA_MIN` ajustam.
- **Cadastro**: nome, peso, altura, objetivo, cidade onde mora (define o fuso horário da pessoa: horários de refeição e cobrança são no fuso dela) e dieta (vegetariana/vegana/onívora, restrições). Dado novo dito no grupo ("pesei 74,5", "me mudei pra Curitiba", "virei vegetariano") sobrescreve o perfil na hora, com data, e vale mais que documento antigo da pasta.
- **Quando ela fala**: sempre em foto, áudio, comando, pergunta, menção/resposta a ela e assunto dela (comida, treino, sono, peso). Papo aleatório entre vocês: ela entra no máximo uma vez a cada 10 min (`PAPO_INTERVALO_MIN`) e, nesse intervalo, nem gasta chamada de IA, só guarda no histórico.
- **Personalidade**: `Perfis/Nutri.md` é a memória que ela mesma reescreve toda noite (apelidos, piadas internas, padrões, bordões). Reescrita que encolhe demais é descartada, e as versões anteriores ficam no Mongo (`persona_historico`).
- **Diário dela**: `Perfis/Nutri-Diario.md` ganha uma entrada por noite, em primeira pessoa, com o que ela achou do dia e de cada um. Junto com a memória de personalidade (agora livre, até 700 palavras, com favoritos, implicâncias e opiniões), é a história dela.
- **Clima e estação do ano**: pela cidade do cadastro, ela recebe a estação (certa para cada hemisfério: primavera em Florianópolis é outono em Paris) e o tempo agora com a previsão do dia e de amanhã, da Open-Meteo (grátis, sem chave). Coordenadas ficam guardadas por cidade (coleção `cidades`) e o tempo tem cache de 30 min. A regra é usar quando encaixar (sopa em noite fria, água em dia quente) e nunca inventar o tempo quando a linha não vier.
- **Google Agenda** (`AGENDA_DONO` com o primeiro nome do dono da conta Google): ela lê os compromissos de hoje e amanhã (aula, trabalho, reunião, treino, refeição, saúde, viagem) e as janelas livres, e usa pra encaixar a comida na rotina real: não cobra refeição no meio de aula ou reunião, avisa na véspera quando o dia seguinte começa cedo, e o `!plano` monta a semana em cima dos horários livres. `!agenda` mostra o que ela está vendo. **A agenda é de uma pessoa só e ela nunca comenta a agenda de alguém com outra pessoa do grupo.** Duas formas de ligar, nesta ordem de preferencia: (1) **endereco secreto no formato iCal** em `AGENDA_ICS_URL` (Google Agenda > Configuracoes da agenda > a agenda > Integrar agenda > *Endereco secreto no formato iCal*): e so leitura, nao precisa de OAuth, de app publicado nem de dominio proprio, e e o caminho recomendado; trate a URL como segredo. (2) API do Google Agenda, que exige o escopo `calendar.readonly` na credencial (`npm run drive-auth`) e o app OAuth publicado. Sem nenhuma das duas, o recurso se desliga sozinho e o resto continua igual.
- **Treino de força (Hevy)**: com a chave da API na variável `HEVY_CHAVES` (`lucas=xxx,heitor=yyy`; precisa de Hevy Pro, chave em hevy.com/settings?developer), o bot sincroniza os treinos no máximo de hora em hora e calcula em código: sessões, séries por grupo muscular na semana, volume (peso × repetições), RPE médio e progressão de carga por exercício (1RM estimado pela fórmula de Epley, semana atual contra as 3 anteriores). Uma linha curta entra no perfil (vale em toda resposta) e o bloco completo vai pro resumo de domingo e pro comando `!treino`. O documento `conhecimento/Treino-Forca.md` ensina ela a ler esses números (10 a 20 séries por grupo por semana, sobrecarga progressiva, RPE, deload) e a ligar com a comida. Treino que já vem do Hevy é filtrado da planilha do relógio, pra mesma sessão não contar duas vezes.
- **Meta com prazo**: quando a pessoa diz aonde quer chegar e até quando ("quero 80 kg até março"), isso vira `metaPeso`/`metaPrazo` no perfil (pela linha ATUALIZAR) e, no domingo, uma projeção: em quantas semanas chega no ritmo atual, se está adiantada, no cronograma ou atrasada, e se o ritmo que o prazo exige cabe na faixa saudável. Sem meta, ela projeta a tendência em 1, 3 e 6 meses.
- **Aposta da semana** (domingo, junto do resumo e dos gráficos): o sistema calcula, por pessoa, quanto ela tende a ganhar ou perder até o domingo seguinte (pelo balanço energético do relógio, ou pela tendência da balança de quem não tem relógio) e divide em massa magra e gordura por uma estimativa guiada por proteína e treino. A previsão fica salva (coleção `previsoes`) e, no domingo seguinte, ela mesma confere contra a balança e diz se acertou, chegou perto ou errou, com a diferença em gramas. Quem tem bioimpedância no relógio ganha também a conferência de massa magra. Sem pesagem ou sem dias completos, ela não chuta: diz o que falta.
- **Pesagem e mês**: todo domingo 09:00 ela pede o peso de quem não tem relógio mandando (fica em `pesagens`, com data). Dia 1 às 08:00 sai o relatório do mês anterior no grupo e em `Resumos/Mes-YYYY-MM.md`. `!hoje` mostra os totais do dia sem gastar IA; `!silencio 2h` a segura fora do papo; `!apelido` fixa ou tira o apelido.
- **Dados do relógio direto do celular (app Relógio, recomendado)**: o app em `android/` (APK compilado pelo GitHub Actions, download em `https://github.com/lucasleonardo-hub/nutribot/releases/tag/relogio`) lê o Health Connect no próprio celular e faz POST em `/relogio` a cada 15 min (mínimo do Android), com internet. Instalação: baixar o APK no celular e permitir "fontes desconhecidas"; abrir; preencher o primeiro nome (igual ao cadastro) e o token; tocar em **Permissões** e marcar tudo, inclusive "em segundo plano"; **Sincronizar agora**; e **Liberar da economia de bateria** (senão o Samsung adormece o app). O token é o valor de `RELOGIO_TOKENS` (`lucas=xxx,heitor=yyy`, no Render). O primeiro envio leva 14 dias, os seguintes 3, e o servidor funde por dia (coleção `saude_relogio`, 90 dias). Quando há envio nas últimas 36 h, a planilha abaixo nem é lida. `!relogio` mostra o último envio e os números de hoje. Desde a versão 1.1 o app calcula no próprio celular o **batimento de repouso** de cada dia (média dos 20% menores batimentos durante o sono; o Samsung Health não grava esse dado pronto), a HRV quando o relógio gravar, e a média de batimentos por treino; no bot isso vira o bloco RECUPERAÇÃO do dossiê e um trecho da linha do relógio (acima da média há 2+ dias = segurar; na média ou abaixo = pode empurrar), usado na conversa e no resumo de domingo. Não entra na conta de calorias. Limite honesto: o próprio Samsung Health só grava no Health Connect de tempos em tempos (abrir o app Samsung Health força), então "tempo real" é uns 15 a 30 min.
- **Dados do relógio pela planilha (caminho antigo)**: uma planilha Google na pasta da pessoa cujo nome tenha "saude", "health", "galaxy", "watch" ou "relogio" é lida pela Sheets API (mesma credencial do Drive), não como CSV. Formato esperado: o do app *Health Data Export* (Play Store, `com.teqxnology.healthdataexport`), abas Activity / Body Measurements / Sleep. Ela vira um resumo curto no dossiê (14 dias de peso e gordura, 14 noites de sono por fase, 7 dias de passos e treinos, médias e tendência), cada peso da manhã vira uma pesagem com data (fonte `relogio`), o peso do perfil acompanha a última medição e um `Nutri-Saude.md` fica na pasta. Domingo ela não pede o peso de quem tem relógio. Setup no celular: Samsung Health → Configurações → Health Connect (liberar peso, composição corporal e sono); no app de exportação, só Body Measurements e Sleep (frequência cardíaca gera milhares de linhas), destino Google Sheets, Auto Export a cada 24 h; mover a planilha pra pasta da pessoa no Drive. O resumo só é refeito quando a planilha muda (cache por `modifiedTime`).
- **Tabela TACO como âncora** (`dados/taco.json`, gerado por `scripts/gerar-taco.mjs` a partir da TACO 4ª ed. + rótulos típicos de whey, hipercalórico, hommus etc.): porção declarada no texto ("200 g de arroz", "2 ovos", "3 fatias de pão integral", "1 scoop de whey") vira número oficial no prompt e na estimativa do `!refeicao`; a IA copia esses e estima só o resto. Sem porção, vai o valor por 100 g do alimento reconhecido.
- **Meta calórica adaptativa** (código, sem IA): com 10 dias completos de registro e pesagens cobrindo 7 dias, o gasto real = ingestão média − tendência do peso × 7700, e a meta vira uma faixa (superávit/déficit do objetivo). Antes disso, usa o gasto do relógio se houver. Aparece no `!hoje`, no prompt da pessoa e no gráfico.
- **Acompanhamento em código**: `!hoje` traz 7/30 dias, sequência de dias completos, meta, balanço energético (quem tem relógio) e água/álcool ditos no dia (linha oculta `HABITO`). O resumo semanal fecha com um placar (dias completos, proteína batida, sequência).
- **Apagar e corrigir registros**: `!apagar 11:03` (hora como aparece no `!hoje`) ou `!apagar ultimo` apaga um registro seu de hoje. Em linguagem natural também funciona ("remove esse almoço das 11:03", "esse jantar foi 600 kcal"): a IA escreve a linha oculta `REGISTRO: {...}` e o sistema apaga ou corrige; sem a linha nada muda, e a regra manda ela não prometer que "já ajustou". Rótulo ou tabela mandados até 30 min depois de uma análise corrigem aquele registro em vez de virar uma segunda refeição, e qualquer registro da mesma pessoa em até 30 min do anterior é a mesma refeição (sobremesa 7 min depois da janta soma na janta). Resposta a foto que não tem cara de análise (modelo leve falando "no lugar" da pessoa) é recusada e a cadeia tenta o próximo modelo.
- **Padrão de formato para leitura**: tudo que vai pro grupo ou pro privado segue a mesma cartilha: título de seção em negrito, um dado por linha, listas com marcador ("•" nos textos gerados em código; "- " nos textos da IA, que o WhatsApp mostra como marcador), parágrafos de no máximo 2 linhas, negrito só em número-chave, veredito e nome da refeição, nunca "~". Vale para os comandos (`!status` também), para o resumo do dia, o resumo de domingo, o relatório do mês, o `!plano` e para as respostas normais quando passam de 4 linhas. A regra antiga do prompt que proibia listas com "-" (de quando o WhatsApp não renderizava marcador) foi trocada por essa.
- **Um dado por linha nos comandos**: quebra de linha custa um token, então os comandos que vocês leem saem em linhas: `!hoje` (refeição = título, calorias, descrição; 7/30 dias, sequência, meta, balanço e amanhã com um dado por tópico), `!perfil` (um campo por linha), `!treino` (`treinoZap`: sessões, séries, volume, esforço, grupos, carga subindo/caindo) e `!agenda` (`agendaZap`: um compromisso por linha). Os textos corridos continuam existindo só para o prompt da IA, onde compactar economiza contexto.
- **Números azuis no WhatsApp**: o app trata sequências de 4+ dígitos ("4.227", código de barras, "16.925 passos") como telefone e pinta de azul. Na hora de enviar (`protegerNumeros`, em `enviar` e `enviarImagem`) entra um separador invisível (U+2060) depois do primeiro dígito, que quebra a detecção sem mudar a aparência; memória, banco e voz continuam com o número limpo. O destaque passou a ser negrito só no valor das calorias (bloco de análise, `!hoje` e total do dia).
- **Comandos no privado (só o administrador)**: quem é o `ADMIN_JID` pode mandar qualquer `!comando` na conversa privada com o número do bot e recebe a resposta ali, sem poluir o grupo (`!hoje`, `!grafico`, `!licoes`, `!relogio`...). Só `!resumo` é recusado no privado, porque fecha o dia e manda no grupo. Texto sem "!" no privado ganha uma dica (a cada 6 h) de que ali só entram comandos; qualquer outra pessoa no privado é ignorada em silêncio. Nada do privado entra na memória do grupo.
- **Números sem "~" e um por linha**: no bloco de análise a estimativa virou título ("🔥 *Estimativa:*") com Calorias, Proteína, Carboidratos e Gorduras uma por linha (o leitor `lerEstimativa` entende os dois formatos); no `!hoje` cada refeição tem título ("☕ *Café da manhã* · 08:20") e as informações na linha de baixo, e o total do dia sai em linhas (`formatarEstimativaLinhas`); resumo do dia e da semana também sem "~".
- **Previsão de gasto de amanhã** (só com relógio, `previsaoGastoAmanha`): média das últimas semanas no MESMO dia da semana (sábado gasta menos que terça; com menos de 2 amostras do dia, média dos últimos 14 dias), corrigida pela razão gasto real / relógio quando a meta adaptativa está calibrada (limitada a 0,8–1,25); vira o alvo de amanhã pelo objetivo (superávit/déficit). Aparece no `!hoje` ("*Amanhã* (quinta): você costuma gastar 2.650 kcal → mire 2.900 a 3.150") e no resumo da meia-noite como tópico "• Amanhã", e vai no texto do acompanhamento que a IA lê.
- **`!hoje` em tópicos e com um critério só**: a parte de 7/30 dias, sequência, meta e balanço sai em seções com "•" (`visaoZap`), e os contadores passaram a usar UM critério: "dia com registro" = qualquer registro no dia; médias só sobre dias com estimativa (e diz quantos). Antes o `!hoje` dizia "10 de 30 dias com registro" e "13 dias seguidos" ao mesmo tempo, porque os registros de 17 a 19/09 não tinham estimativa gravada (foram preenchidos a partir das respostas da época na daily note; 3 duplicatas antigas apagadas). O prompt da IA continua recebendo a versão em texto com as dicas anti-confusão (`visaoPeriodo`), calculada pela mesma função (`calcularVisao`).
- **Resumo do dia pelo banco e em seções**: os números do resumo da meia-noite (e dos outros textos noturnos) vêm dos registros do banco, já corrigidos e fundidos, não da transcrição (que em 28/09 deu 247 kcal de um item no lugar dos 870 do almoço). O formato é fixo: uma seção por pessoa com "*Nome* · objetivo" e tópicos "•" de números, balanço (só com gasto do relógio), destaque e ajuste; placar no fim; proibido falar de agenda, clima, sono, treino ou do sistema.
- **Hora em que comeu ≠ hora da mensagem**: "esqueci de informar meu café da manhã, foi às 8h20" registra o café às 08:20 (campo `hora` da linha REFEICAO), como refeição retroativa que não se funde com a última; "o café foi às 8h20, não agora" move um registro existente (`mover_para` na linha REGISTRO). Complemento da mesma refeição (sobremesa 18 min depois) SOMA na estimativa; correção substitui.
- **Conversa sobre a bot**: "vou ajustar isso amanhã", "pode mandar ela ajustar", "ela cismou", "tá com problema de visão" é detectado como conversa sobre o sistema: não vira refeição, correção nem fragmento, e ela responde como gente. O administrador (`ADMIN_JID`) aparece marcado nos perfis como quem cuida do código dela.
- **Reação com emoji**: a IA pode acrescentar a linha oculta `REAGIR: ⭐` e o sistema reage na mensagem da pessoa (prato nota 9+, piada, conquista), com parcimônia e nunca em contestação.
- **"Parece só um pedaço de informação"** (julgado pela IA, não por regra): mensagem curta de quem registrou refeição há pouco passa pelo modelo leve, que responde como uma pessoa julgaria: é pedaço da refeição em andamento? vem mais coisa? Se sim, a bot reage com 👀, segura a resposta até 45 s de silêncio da pessoa (teto 90 s; `ESPERA_FRAGMENTO_MS`/`_MAX_MS`), junta tudo que ela mandar nesse tempo (fotos e textos) e responde UMA vez. Se não der pra saber se é parte da refeição ou coisa nova, ela pergunta em uma linha em vez de analisar. Mensagem completa continua respondida na hora.
- **Mensagens parceladas = uma refeição**: foto de mais um item, "tem X", "não tem Y", "pra substituir Z" até 30 min depois do último registro da pessoa entram como *refeição em andamento*: a IA recebe a lista já registrada, aplica a mudança sem repetir item negado e responde curto com a estimativa corrigida do total; o registro é ajustado, não duplicado. **Saída de reserva limpa**: eco da mensagem com o nome na frente, "MENSAGEM ATUAL" e caracteres de outro alfabeto no começo (coisas que o Cohere fez em 28/09 numa hora de "alta demanda" geral do Gemini) são removidos antes de tudo, e nas fotos a ordem das reservas passou a ser Qwen3.8 27B → Qwen3-VL → Gemma 3 → Cohere (`RESERVA_VISAO_ORDEM`).
- **Registro estruturado**: em toda análise de comida consumida a IA escreve uma linha oculta `REFEICAO: {tipo, itens, kcal, proteina, carbo, gordura, correcao}` (removida antes de ir pro grupo) e é por ela que o sistema registra a refeição; ler os números do texto virou reserva pra modelo externo que esqueça a linha. Acabou a dependência do formato da frase.
- **Rótulos pelo Open Food Facts** (grátis, sem chave): código de barras na mensagem vira a tabela nutricional oficial antes de ela responder; produto com marca citado em texto ou foto ("iogurte Vigor", "whey Growth") faz a IA pedir `PRODUTO: <nome ou código>`, o sistema busca (Brasil primeiro; produtos franceses também aparecem) e ela responde de novo com os valores por 100 g/ml "pelo rótulo". Cache de 30 dias na coleção `produtos`.
- **Documentos da pasta viram dados**: PDF, imagem ou doc novo na pasta da pessoa (bioimpedância InBody ou de balança, exame de sangue, avaliação física) é transcrito uma vez e depois extraído em dados: tipo, **data do documento** (nunca a de hoje), **confiança** alta/média/baixa com motivo (laboratório com data = alta; balança doméstica ou print sem data = média; ilegível, incoerente ou de outra pessoa = baixa), medidas (peso, gordura, massa magra, água, visceral, TMB, cintura) e exames (valor, unidade, referência, fora da faixa). Vai pra coleção `documentos_pessoa`, pra seção "Documentos e medições" da `Nutri-Ficha.md` e pra linha do perfil que a IA vê em toda resposta (com a instrução de não tratar confiança baixa como verdade nem documento sem data como atual). Bioimpedância confiável com data entra na evolução de peso com a data do exame.
- **Busca na web (Google) pela IA**: pronta no código (`PESQUISA_WEB=on`), mas o nível gratuito do Gemini dá cota zero de grounding pros modelos 3.x; fica desligada até o projeto ter faturamento. Sem ela, a pesquisa continua por PubMed/Wikipedia (e Brave com chave).
- **Caderno de aprendizado** (`Perfis/Nutri-Aprendizados.md`, coleção `aprendizados`): no fechamento do dia, se houve correção de registro ou alguém a contestou, ela reescreve (com raciocínio ligado) um caderno de lições: erro, causa, regra, quantas vezes aconteceu e quando. As regras ativas (até 8) entram no system prompt de TODA resposta, ao lado da memória de personalidade: é isso que transforma o erro em comportamento novo. `!licoes` mostra. Versões anteriores ficam em `aprendizados_historico`.
- **Objetivo trocado não passa**: antes de enviar, a resposta é conferida contra o objetivo da pessoa; vocabulário do objetivo oposto ("[[Hipertrofia]]", "superávit" pra quem quer emagrecer; "déficit", "secar" pra quem quer ganhar) barra o envio e ela reescreve; se a reescrita ainda trouxer o termo (ou falhar), a frase é removida da resposta. "Massa magra" e "definição" não contam. Antes era só um aviso no log, e a reserva Qwen3-VL fechou uma dica do Heitor com "ritmo da Hipertrofia" em 28/09.
- **Consciência durante a conversa** (`consciencia.js`): (a) antes de enviar, o código confere todo total de calorias "do dia" citado na resposta contra os registros; número que não existe barra o envio e ela responde de novo com o problema apontado; (b) mensagem que contesta o que ela disse ("tá errado", "remove", "não foi isso") liga uma instrução de conferir os registros antes de defender qualquer número e ceder quando não houver evidência; (c) nesses casos o modelo leve faz uma segunda olhada na resposta pronta contra os registros. Limite honesto: ela continua sem perceber erro que ninguém contesta e cujos dados estão errados na origem.
- **Nada sai cortado**: quando um modelo estoura o limite de saída (os 3.x gastam parte dele raciocinando), a chamada é repetida uma vez com o dobro do limite antes de aceitar ou recusar o texto; o resumo do dia roda sem raciocínio e com limite maior. Foi assim que o resumo de 26/09 saiu pela metade.
- **Correções do dia entram na memória**: registro apagado ou corrigido (linha REGISTRO ou `!apagar`) fica anotado (coleção `correcoes_dia`) e vai pro fechamento do dia junto dos totais compilados; resumo, momentos, diário, memória de personalidade e notas recebem a regra de que números vêm SÓ do bloco compilado e que o que a conversa disse antes da correção está errado. Foi assim que "4.700 kcal" de registros duplicados virou memória em 26/09.
- **Ficha de rotina**: a reescrita noturna agora recusa texto cortado no meio (limite maior e verificação de ponto final); a anterior fica.
- **Produtos fixos**: "vai ser sempre esse hipercalórico, deixa salvo" com o rótulo vira `produtos` no perfil (porção e números); daí em diante ela copia esses números em vez de estimar (300 ml de leite não viram 300 g de pó).
- **Gráficos** (`!grafico`, `!grafico todos`, e no domingo junto do resumo da semana): PNG via QuickChart (grátis) com calorias por dia, gasto do relógio, faixa da meta e peso dos últimos 30 dias.
- **Lugares** (`lugares.js`, opcional, botão 4 do app Relógio v1.2): o app manda um ponto de localização aproximada junto de cada envio de 15 min (`locais` no mesmo POST `/relogio`). O servidor guarda o ponto bruto por 7 dias (índice TTL em `locais_brutos`), agrupa paradas de 20 min+ num raio de 150 m em visitas (`visitas`, 90 dias) e mantém em `perfil.lugares` os lugares significativos: casa (onde dorme), trabalho (dias úteis), e o tipo dos outros pelo OpenStreetMap (Overpass em 120 m + Nominatim pro bairro; sem chave; `CONTATO_EMAIL` vai no User-Agent), no máximo 3 consultas por rodada. Cada lugar ganha padrão semanal ("seg, qua, sex · 18h30 às 20h · 6 visitas"). Entra no prompt só na conversa com a própria pessoa (bloco LUGARES, com a regra de nunca escrever endereço e de não anunciar que sabe onde ela está), na cobrança (não cobra quem está em restaurante/bar/padaria/academia), no `!plano` (rotina de lugares + mercados e feiras a 800 m de casa/trabalho/faculdade, cache de 14 dias) e no resumo de domingo (só tipos: "academia 3x, almoço fora 1x"). Comandos: `!lugares`, `!lugares casa`, `!lugares aqui é academia X`, `!lugares esquecer` (apaga tudo). Semente opcional: a exportação da Linha do Tempo do Google (Timeline.json, feita no app do Maps > Linha do tempo > exportar) colocada na pasta da pessoa no Drive é importada uma vez (`importarTimeline`: visitas dos últimos 180 dias, HOME/WORK viram casa/trabalho) e nunca entra no dossiê.
- **Uma resposta pra refeição em partes**: a bot assina a presença do grupo (`presenceSubscribe`) e, quando quem mandou a mensagem ainda está digitando (`estaDigitando`, presença composing/recording nos últimos 10 s), segura a resposta e confere a cada 3 s, soltando 6 s depois que a pessoa para (teto de 90 s; 👀 só se passar de 8 s). A espera por fragmento (juiz Lite) também se estende enquanto ela digita, e uma mensagem que só anuncia a refeição ("meu almoço hoje vai ser adaptado", "não consigo sair do serviço") pode esperar mesmo sem refeição em andamento (`RE_ANUNCIO` em candidatoAFragmento).
- **Reflexão livre por pessoa** (`reflexao.js`, `Nutri-Reflexoes.md` na pasta da pessoa): aos domingos, depois do resumo da semana, a bot escreve em primeira pessoa e sem formato o que pensa de cada um, juntando notas, números, padrão alimentar, relógio, treino, lugares e documentos, podendo se corrigir em relação ao texto anterior (histórico na coleção `reflexoes`). O último parágrafo ("Em uma frase:") vira `perfil.reflexao.sintese` e entra como pano de fundo na conversa com a própria pessoa e no `!plano`. `!reflexao` mostra a síntese; `!reflexao nova` reescreve na hora.
- **Plano da semana** (`!plano`): uma chamada Flash monta 7 dias só com as refeições que a pessoa de fato registra (padrão real dos últimos 28 dias calculado em código: quais refeições, horário mediano, kcal típica e itens frequentes; refeição ausente é marcada "não prescreva"), variando com o que circula no grupo, produtos fixos e ingredientes comuns e baratos na cidade dela; `!plano <observação>` (orçamento, mercado perto, o que não quer) fica guardado no perfil pros próximos planos e `!plano limpar` esquece; pra quem tem relógio o plano recebe a meta calórica de cada dia da semana (gasto do mesmo dia da semana nas últimas semanas + faixa do objetivo); de sexta a domingo cobre a semana que vem; inclui uma seção "Compra esperta" com itens baratos e rendosos que podem entrar ou substituir (frango desfiado feito no domingo, ovos, PTS), respeitando dieta e objetivo; toda sexta 12:00 (cron `oferecerPlano`) ela pergunta no grupo quem quer o plano da semana que vem e um "quero" (até domingo, `pareceAceitePlano`) gera o plano da pessoa; com lista de compras; vai pro grupo e pra `<Nome>/Nutri-Plano.md`.
- **Voz**: nota de voz em três situações. (1) Quando alguém pede ("manda em áudio", "me dá o resumo de hoje em áudio"): a resposta sai em texto e em áudio. (2) Programadas: segunda 08:00 abrindo a semana e sexta 18:00 fechando, com os números e as comidas da semana, no personagem. (3) Espontâneas: quando ela marca a resposta como momento de voz (linha oculta `AUDIO: sim`), com teto de 1 por dia e 2 por semana, nunca em análise de prato. `!voz off` desliga (2) e (3); pedido explícito sempre funciona. Síntese pelo TTS do Gemini (grátis, mesmas chaves, modelos `gemini-3.8-flash-lite-tts` e `gemini-3.8-flash-tts` em rodízio de chaves), que recebe uma instrução de estilo e fala como a personagem: jovem, calorosa, bem-humorada, sotaque brasileiro; `VOZ_GEMINI_VOZ` troca a voz (padrão Sulafat) e `VOZ_ESTILO` a instrução (formato curto "Diga com voz X:", sem meta-instrução: um parágrafo longo terminando em "não leia isto em voz alta" foi lido em voz alta em 28/09). Cada áudio é transcrito pelo modelo leve antes de sair (`VOZ_CONFERIR`, ligado por padrão): se a instrução vazou ou o áudio é bem maior que a fala, ele é descartado e refeito com outra chave/modelo, e no limite cai pro Edge, que nunca lê instrução. Se o Gemini estourar cota ou estiver em alta demanda, ela cai sozinha pro leitor do Microsoft Edge (msedge-tts, voz `VOZ_TTS`), o motor antigo. Conversão pro formato do WhatsApp pelo ffmpeg-static.
- **Memória de longo prazo por significado**: coleção `memoria_vetorial` com índice Vector Search (criado no boot, grátis no M0) e embeddings `gemini-embedding-001`. Toda noite entram o que cada um disse, o resumo, os momentos, as notas e o diário dela; na conversa (via completa) ela busca até 4 lembranças de dias anteriores parecidas com a mensagem, incluindo as de quem foi citado. Se índice ou embedding falharem, ela responde sem lembranças.
- **Conferência das reservas por amostragem**: resposta que saiu por reserva externa fica pendente; de hora em hora o bot limpa o que passou de 24 h e, no máximo 2 vezes por semana (`REVISOES_POR_SEMANA`), sorteia UMA pendente e manda o Gemini conferir. Se estava errada, ela corrige no grupo citando a mensagem e ajusta o registro da refeição. Serve pra medir a qualidade das reservas sem gastar a cota grátis conferindo tudo.
- **Momentos memoráveis**: `Perfis/Nutri-Momentos.md` só cresce, nunca é reescrito: toda noite ela extrai até 4 momentos do dia (vexames, acertos, metas, frases) e usa os mais recentes nas respostas e na evolução da personalidade.
- **Diário**: `Diario/YYYY-MM-DD.md` é uma daily note com toda a conversa do dia (wikilinks pra cada pessoa, `#refeicao/almoco` etc.), regerada a partir da memória do dia a cada 30 s.
- **Reservas de IA** (só quando todos os Gemini falharem com 503 "alta demanda"): texto pelo Cohere → OpenRouter (Nemotron 3 Super 120B grátis, 50 pedidos/dia) → Groq → Hugging Face; **foto** pelo Cohere → Hugging Face (Gemma 3 27B, depois Qwen3-VL) → OpenRouter (Qwen3.8 27B). Áudio e PDF só o Gemini faz. Se tudo cair, ela avisa no grupo que travou em vez de ficar muda. As chaves são opcionais; sem elas o bot roda só com Gemini.
- **Várias fotos de uma vez**: fotos seguidas da mesma pessoa (prato de vários ângulos, prato + copo + sobremesa, ou prato + foto do rótulo do que ela bebeu) viram UMA análise só, com todas as imagens no mesmo pedido e as legendas juntas. Sai uma resposta e UM registro de refeição, em vez de uma análise por foto. Rótulo de algo que a pessoa disse que consumiu entra na conta pelos valores da tabela nutricional vezes a quantidade dita ("pelo rótulo"); rótulo de algo que ela só quer avaliar fica de fora da estimativa. Até 6 fotos por análise (`MAX_FOTOS_JUNTAS`), dentro de 5 min (`JANELA_FOTOS_S`); mensagem de outra pessoa ou comando fecham o bloco.
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
