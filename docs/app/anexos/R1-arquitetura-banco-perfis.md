> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# R1 — NutriBot: arquitetura, infra, banco, perfis, rotas HTTP, crons e deploy

Auditoria somente leitura do repositório `C:\Users\lucas\Downloads\BOT` (commit `2ae910e`, branch `main`, árvore limpa) feita em 2026-10-13, para planejar um app Android que será a camada visual do bot. Nenhum segredo foi lido; nomes de variáveis vêm de `.env.example`, `render.yaml` e de `process.env.*` no código.

Legenda de estado usada em todo o documento:

| Código | Significado |
|---|---|
| **(a)** | implementado e coberto por teste em `test/` |
| **(b)** | implementado, sem teste |
| **(c)** | parcial |
| **(d)** | só planejado/comentado |
| **(e)** | inexistente |

Cobertura de teste por módulo (grep de `from '../X.js'` em `test/*.test.mjs`): módulos **sem nenhum teste** — `index.js`, `whatsapp.js`, `mongo.js`, `estado.js`, `dia.js`, `drive.js`, `pessoas.js`, `cobranca.js`, `avisos.js`, `paginas.js`, `conhecimento.js`, `memoria_semantica.js`, `reservas.js`, `treino.js`, `pesquisa.js`, `acompanhamento.js`, `logout.js`, `drive-auth.js`. Ou seja: **toda a camada de infra, HTTP, banco e fila é (b)**; o que é (a) são funções puras (util, progresso, resumo, lugares, agenda-classificação, relogio-normalização, perfis.aplicarAtualizacao etc.).

---

## 1. Visão geral

### 1.1 Stack e processo

- Node ESM (`package.json:7` `"type": "module"`, `engines.node >= 20`; Render usa `NODE_VERSION=22`, `render.yaml:13`).
- Dependências de infra: `@whiskeysockets/baileys ^7.0.0-rc14`, `express ^5.2.1`, `mongodb ^7.6.0`, `node-cron ^4.6.0`, `googleapis`, `@google/genai`, `pino`, `qrcode`.
- **Um processo único**: HTTP, WhatsApp, crons e toda a lógica rodam no mesmo processo Node, no plano **Free** do Render (`render.yaml:6`), região Oregon (`render.yaml:7`), `TZ=America/Sao_Paulo` (`render.yaml:15`).
- Scripts: `start` (`node index.js`), `dev` (`--watch`), `drive-auth`, `logout`, `test` (`node --test "test/**/*.test.mjs"`), `avaliar` (`avaliacao/rodar.mjs`, suíte com modelo).

### 1.2 `index.js` — bootstrap (b)

Ordem real de inicialização (`index.js:221-331`):

1. `conectarMongo()` (`index.js:223`) → `garantirIndices()` (`:224`) → `garantirIndiceVetorial()` (`:225`, Atlas Vector Search, nunca lança).
2. `iniciarDrive()` (`:226`) — síncrono; lança se faltar `DRIVE_FOLDER_ID` ou credencial (`drive.js:46`). **Falha fatal = `process.exit(1)`** (`index.js:333-334`).
3. `carregarConhecimento()` (`:227`, Mongo `conhecimento` + `conhecimento/*.md` do repo).
4. Pré-carga assíncrona (não aguardada) do dossiê de cada perfil no Drive (`:229-231`), que pode transcrever PDFs com Gemini no boot.
5. `carregarPersona()`, `carregarAprendizados()` → `ia.definirLicoes()` (`:233-237`).
6. `lerConfig()` → `estado.config` (`:239-241`), nome da bot.
7. `carregarMemoria()` → `estado.memoria` (`:244-251`), normaliza nomes e sincroniza refeições na memória.
8. Marca o grupo como "já apresentado" se houver perfis e nenhum registro (`:255-259`).
9. `criarRetomada(...)` (`:264-275`) e `iniciarWhatsApp({...})` (`:276-294`).
10. `vigiarConexao` (cão de guarda, `:296`).
11. Agenda todos os crons (`:300-330`) — ver tabela em 1.9.

**Atenção:** o servidor Express sobe ANTES do boot assíncrono (`app.listen` em `index.js:196` está fora da IIFE). Logo `/ping` responde 200 e `/estado` responde `iniciando` mesmo sem Mongo/WhatsApp. É exatamente o cenário que motivou o `vigia.yml` (ver 1.6).

Desligamento (`index.js:343-361`): `SIGTERM`/`SIGINT` → `encerrar()` salva fila pendente no Mongo (`salvarFilaPendente`), persiste memória do dia, grava diário no Drive se sujo, fecha socket e Mongo, com teto de 8 s (`:348`). O cão de guarda usa o mesmo caminho com código 1 (`:296`, `:342`).

Porta: `PORT` ou 3000 (`index.js:49`). Health check do Render: `GET /ping` (`render.yaml:11`, `index.js:60`).

### 1.3 `whatsapp.js` — Baileys (b)

- Sessão (creds + chaves Signal) no Mongo, coleção `baileys_auth` (`mongo.js:59-116`) — por isso o restart do Render não exige QR novo.
- Socket: `Browsers.ubuntu('Chrome')`, `syncFullHistory: false`, `markOnlineOnConnect: false` (`whatsapp.js:253-262`).
- QR: `estado.ultimoQR` + status `aguardando QR` (`:281-286`); servido em `GET /qr` (`index.js:139-155`).
- Reconexão com backoff exponencial 3 s → 120 s (`:324-326`); `loggedOut` limpa a sessão e anota `config.desconectadoEm` (`:311-317`, `marcarQueda` `:176-187`); 515 (restartRequired) e 408 esperando QR reconectam em 1,5 s (`:318-322`).
- Alerta de desconexão no log a cada 30 min após `ALERTA_DESCONEXAO_MIN` (10) (`:202-209`).
- Cão de guarda: `REINICIO_SEM_WHATSAPP_MIN` (15) sem conexão COM sessão válida → `aoReiniciar` → processo sai com código 1 (`:217-231`). Esperando QR nunca reinicia.
- Histórico pós-pareamento (`messaging-history.set`/`.status`, `:334-352`) alimenta `retomada.js` (resgate de mensagens perdidas; **(a)** para a seleção pura em `test/retomada.test.mjs`).
- Entrada em grupo e novo membro: `group-participants.update`, `groups.upsert` e stub `GROUP_PARTICIPANT_ADD` (`:356-382`).
- Filtro de mensagens: `status@broadcast`, protocolMessage, reactionMessage etc. ficam fora (`:385-387`); só `type === 'notify'` e não enviada pelo próprio bot vai para `aoMensagem` (`:391`). `enviadosPeloBot` é um `Set` em memória com teto 500 (`:45`, `:73-76`).
- **Grupo x privado**: `mensagens.js:570` — tudo que não termina em `@g.us` vai para `tratarPrivado` (só admin, só `!comandos`). Grupo: se `ALLOWED_GROUP_ID` definido, qualquer outro grupo é ignorado (`mensagens.js:572-578`); se vazio, o bot adota o primeiro grupo que falar (`:601-604`) — "responde em qualquer grupo" (`estado.js:7`).
- Envio com "pausa humana" 0,6–2,5 s (`whatsapp.js:49-52`, `:66-78`), `protegerNumeros` (U+2060 depois do 1º dígito, `util.js:175`) e remoção das linhas ocultas (`util.js:158-168`).
- Presença (`presence.update`) em `Map` na memória (`:117-126`) para segurar resposta enquanto a pessoa digita.

### 1.4 `estado.js` — estado compartilhado e fila única (b)

```
estado = { memoria: { dia, grupo, mensagens[], cobrancas{} , perguntas? }, persona, config, statusConexao, ultimoQR, sock, fechandoDia, silencioAte }
```
(`estado.js:9-18`). `naFila(nome, fn)` é uma **cadeia de Promise única** (`:21-27`): mensagens, fechamento do dia, cobrança, atividades, despensa, pensamentos, revisão, pesagem, voz, oferta de plano e mês rodam **serializados**. Erros são logados e não derrubam a fila. Não há timeout na fila em si; o cão de guarda de 4 min é por mensagem (`mensagens.js:306-310`). Exceções que rodam fora da fila: `POST /relogio` e `POST /nota` (`index.js:69-70`, `:83-84`), `estudar` mensal (`index.js:326-327`), `gerarPlano` (`comandos.js:169-170` `void gerarPlano`).

`estado.memoria` é persistida em `memoria` (`_id: 'hoje'`) a cada `lembrar` (`dia.js:35-41`), então sobrevive ao restart; o resto do estado em memória **não** (ver seção 5).

### 1.5 `render.yaml` / `.render-service.json`

- `render.yaml`: 1 serviço `web`, `runtime: node`, `plan: free`, `buildCommand: npm install`, `startCommand: npm start`, `healthCheckPath: /ping`. Env vars fixas: `NODE_VERSION=22`, `TZ`, `GEMINI_MODEL`, `GEMINI_MODELOS_RESERVA`, `GEMINI_MODELOS_LEVES`, `MANTER_COLCHETES_NO_ZAP=false`, `KEEPALIVE_MINUTES=10`, `LOG_LEVEL=warn`, `GROQ_MODEL`; `ADMIN_TOKEN` com `generateValue: true`; `sync: false` (preenchidas à mão): `GEMINI_API_KEY`, `GEMINI_API_KEYS`, `ADMIN_JID`, `MONGODB_URI`, `DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `ALLOWED_GROUP_ID`, `GROQ_API_KEY`, `HF_API_KEY`, `COHERE_API_KEY`, `OPENROUTER_API_KEY`, `HEVY_CHAVES`, `AGENDA_DONO`, `AGENDA_ICS_URL`.
- **Divergência**: `RELOGIO_TOKENS` (obrigatório para `/relogio` e `/nota`) **não está no `render.yaml`** — só em `.env.example:118`. Idem `CONTATO_EMAIL`, `CONTATO_NOME`, `PESQUISA_WEB`, `VOZ_*`, `FERRAMENTAS_CONVERSA`, `PROATIVIDADE`. Precisam ser criadas à mão no painel.
- `.render-service.json` (gitignored, `.gitignore:6`, mas presente no disco): `serviceId srv-daktqflbedkc73d3njpg`, URL `https://nutribot-5gwk.onrender.com`, `deployId`, link do dashboard. O `serviceId` também está hardcoded em `deploy.yml:34` e a URL em `keepalive.yml:16`, `vigia.yml:19`, `android/.../Prefs.kt:11` (URL padrão do app) e no GUIA.

### 1.6 `.github/workflows`

| Workflow | Gatilho | O que faz | Segredos |
|---|---|---|---|
| `deploy.yml` | push em `main`, PR, manual | job `test`: `npm ci`, `npm test`, `node --check` em todos os `*.js`; job `deploy` (só fora de PR): `POST https://api.render.com/v1/services/srv-…/deploys` com `clearCache: do_not_clear`, exige HTTP 201 | `RENDER_API_KEY` |
| `keepalive.yml` | cron `*/5 * * * *`, manual | `curl /ping`, falha se != 200 | nenhum |
| `vigia.yml` | cron `*/10 * * * *`, manual | lê `GET /estado` (JSON `status`); se ≠ `conectado` em 2 leituras (90 s), abre 1 issue "🔴 NutriBot fora do WhatsApp" (dedupe por título); fecha quando volta | `GITHUB_TOKEN` (issues: write) |
| `android.yml` | push em `main` com mudanças em `android/**` ou no próprio yml, manual | Java 17 + Gradle 8.13, `gradle -p android assembleRelease`, keystore PKCS12 de secret, publica `relogio-nutribot.apk` na release fixa `relogio` (`--clobber`) | `RELOGIO_KEYSTORE_B64`, `RELOGIO_KEYSTORE_PASS` |
| `avaliacao.yml` | cron `0 10 * * 1` (seg 07:00 BRT), manual (inputs `so`, `modelo`) | `node avaliacao/rodar.mjs --sem-falhar`; sem o secret termina verde sem rodar; relatório como artefato 30 dias; **não bloqueia deploy** | `AVALIACAO_GEMINI_API_KEY` |

Observações: (1) O GUIA (`GUIA-PASSO-A-PASSO.md:87`) diz "o Render redeploya sozinho a cada push", mas `deploy.yml:1-2` diz que o repo NÃO está conectado via GitHub App e o deploy é disparado pela API — a verdade é a do workflow. (2) `GUIA:118` lembra que o GitHub desativa crons após 60 dias sem commit. (3) `keepalive.yml` e `vigia.yml` dependem de o repo ser público (grátis) — `GUIA:81` diz "privado"; memória do usuário diz público. Divergência no GUIA.

### 1.7 Outros módulos de infra

- `logout.js` (b): script CLI; conecta com a sessão do Mongo, chama `sock.logout()`, limpa `baileys_auth` (`logout.js:12-69`); fallback em 45 s limpa mesmo assim.
- `paginas.js` (b): HTML estático de `/` e `/privacidade` (exigência do Google para publicar o app OAuth; `paginas.js:1-3`). Usa `CONTATO_NOME`/`CONTATO_EMAIL`. Política datada "25 de setembro de 2026" (`:43`), lista escopos `drive` e `calendar.readonly` (`:77-79`).
- `util.js` (a — `test/util.test.mjs`): `TZ` (`util.js:3`), `agora(tz)` devolve `{ dia: 'YYYY-MM-DD', hora: 'HH:MM', horaArquivo, domingo }` via `Intl` (`:21-41`); `fusoDe(perfil)` cai no TZ do grupo se o fuso do perfil for inválido (`:18`); `SLOTS` de refeição (`:92-100`); `slotDaHora` (madrugada <5h = ceia do dia anterior, `:108-112`); `paraWhatsApp`, `semLinhaAtualizar` (linhas ocultas AUDIO/HABITO/REGISTRO/REFEICAO/ATIVIDADE/NOTA/DESPENSA/ATUALIZAR, `:158-168`); `parseJsonTolerante` (`:261-313`); `comTempo` (timeout de Promise, `:229-235`).
- `avisos.js` (b): frases de erro sem IA, 1 por tipo a cada `AVISO_ERRO_MIN` (10 min) (`avisos.js:7`, `:71-86`); `avisarAdmin(tipo, texto)` manda ao `ADMIN_JID` no privado, 1 por tipo a cada 30 min (`:49-65`).
- `cobranca.js` (b): cron de 10 min; só cobra slot com horário **aprendido** (3+ registros, `cobranca.js:36`), entre 7h e 23h no fuso da pessoa (`:30-32`), `ATRASO_COBRANCA_MIN` (75) + `JANELA_COBRANCA_MIN` (120) (`:15-16`), uma vez por slot/dia via `estado.memoria.cobrancas['Nome:slot']` (`:40-44`), não cobra em aula/reunião/trabalho/viagem/saúde (agenda, `:55-59`) nem em restaurante/bar/café/padaria/academia (localização, `:61-65`).
- `agenda.js` (classificação **(a)** em `hoje-mes.test.mjs`; leitura de API/ICS **(b)**): só a pessoa cujo primeiro nome bate com `AGENDA_DONO` tem agenda (`agenda.js:20-25`, `:405-410`). Fontes: API Google Calendar (`calendar.readonly`, todas as agendas visíveis, `:233-266`) e/ou `AGENDA_ICS_URL` (várias URLs, `:85-89`, `:182-204`). Cache em memória `AGENDA_CACHE_MIN` (15) (`:15-17`). Desliga-se sozinha se faltar escopo ou API desativada (`:294-298`), e só volta com restart.

### 1.8 Cadeia de IA (só para contexto)

`gemini.js` (1949 linhas): modelo principal `GEMINI_MODEL`, reservas `GEMINI_MODELOS_RESERVA`, leves `GEMINI_MODELOS_LEVES`, várias chaves (`GEMINI_API_KEY` + `GEMINI_API_KEYS`), castigo por modelo/chave em `Map` na memória (`gemini.js:355`), uso do dia em objeto na memória (`:387`). Reservas externas em `reservas.js` (Cohere, OpenRouter, Groq, HF). Detalhes ficam para o agente de integrações.

### 1.9 TABELA de tarefas agendadas (`node-cron`, todas com `timezone: TZ` = `America/Sao_Paulo`)

Todas em `index.js`; todas (b). "Fila" = passam por `naFila` (serializadas com as mensagens).

| Cron | Horário (BRT) | Fila? | Função | O que faz / para onde manda |
|---|---|---|---|---|
| `59 23 * * *` | 23:59 todo dia | sim (`cron`) | `fecharDia()` (`dia.js:131`) | Resumo do dia no GRUPO; `Resumos/YYYY-MM-DD.md` no Drive; momentos (Mongo `momentos` + `Perfis/Nutri-Momentos.md`); gírias/rotina no perfil; `Nutri-Notas.md` e `Nutri-Ficha.md` por pessoa; diário (`diario_nutri` + `Perfis/Nutri-Diario.md`); aprendizados; memória vetorial; persona (`persona` + `Perfis/Nutri.md`); domingo: `fecharSemana` + `refletirTodos`; zera `estado.memoria` para o dia seguinte (`dia.js:314-318`). `index.js:300` |
| `*/10 * * * *` | a cada 10 min | sim (`cobranca`) | `verificarCobrancas` | Cobrança de refeição atrasada no grupo. `index.js:304` |
| `7,22,37,52 * * * *` | a cada 15 min | sim (`atividades`) | `verificarAtividades({ lembrar })` (`atividades.js`) | Confere atividade fixa pela localização 10 min após o fim; pergunta no grupo se ambíguo. `index.js:305` |
| `30 18 * * *` | 18:30 | sim (`despensa`) | `perguntarValidades({ lembrar })` (`despensa.js:411`) | Pergunta de validade de itens, 1 por pessoa/dia, no grupo. `index.js:306` |
| `30 11,17,21 * * *` | 11:30, 17:30, 21:30 | sim (`pensamentos`) | `pensarTodos({ lembrar })` (`pensamentos.js:100`) | Pensamento particular por pessoa (Mongo `pensamentos` + `perfil.pensamento`); pode virar intervenção no grupo (`proatividade.js`, máx. 1/dia). `index.js:308` |
| `37 * * * *` | de hora em hora | sim (`revisao`) | `revisarPendentes` (`revisao.js:86`) | Limpa `revisoes_pendentes` > 24 h; por sorteio (`REVISAO_CHANCE`, máx. `REVISOES_POR_SEMANA`) confere 1 resposta de reserva com Gemini e corrige no grupo. `index.js:311` |
| `0 9 * * 0` | domingo 09:00 | sim (`pesagem`) | `pedirPesagem` (`dia.js:494`) | Pede o peso no grupo de quem não tem relógio (sem IA). `index.js:316` |
| `0 8 * * 1` | segunda 08:00 | sim (`voz-segunda`) | `falaProgramada('segunda')` (`dia.js:462`) | Nota de voz abrindo a semana, no grupo (desligável `!voz off`). `index.js:318` |
| `0 18 * * 5` | sexta 18:00 | sim (`voz-sexta`) | `falaProgramada('sexta')` | Nota de voz fechando a semana. `index.js:319` |
| `0 12 * * 5` | sexta 12:00 | sim (`oferta-plano`) | `oferecerPlano` (`comandos.js`) | Oferta do plano da semana no grupo; aceite "quero" até domingo (`config.ofertaPlano`). `index.js:320` |
| `0 8 1 * *` | dia 1, 08:00 | sim (`mes`) | `fecharMes` (`dia.js:521`) | Relatório do mês anterior no grupo e `Resumos/Mes-YYYY-MM.md`. `index.js:322` |
| `0 4 1 * *` | dia 1, 04:00 | **não** | `estudar({ motivo: 'revisão mensal' })` (`dia.js:550`) | Pesquisa PubMed e reescreve base de conhecimento (Mongo `conhecimento` + Drive `Conhecimento/`). `index.js:327` |
| `20 7 * * *` | 07:20 | não | `checarDrive()` (`index.js:211-216`) | `verificarCredencial()`; se falhar, `avisarAdmin('drive', …)` no privado. `index.js:330` |
| `setInterval` | a cada `KEEPALIVE_MINUTES` (10) | não | `fetch(KEEPALIVE_URL/ping)` | Auto-ping anti-sleep (`index.js:200-209`); desligado sem `RENDER_EXTERNAL_URL`/`KEEPALIVE_URL`. |
| `setInterval` 60 s | — | não | alerta de desconexão (`whatsapp.js:202-209`) | log |
| `setInterval` 60 s | — | não | `vigiarConexao` (`whatsapp.js:217-231`) | reinicia o processo |
| `setTimeout` debounce 30 s | — | não | `gravarDiario` (`dia.js:43-64`) | `Diario/YYYY-MM-DD.md` no Drive |

Virada de dia fora do cron: `garantirDiaAtual()` (`dia.js:123-129`) é chamada em cada mensagem, na cobrança e ao conectar; se `memoria.dia < hoje`, fecha o dia anterior (cobre o caso do bot dormindo às 23:59, `GUIA:268`).

Os crons semanais (`fecharSemana`, `refletirTodos`, `calibrarNoDomingo`, previsão de domingo) **não são crons próprios**: disparam dentro de `fecharDia` quando `ehDomingo(dia)` (`dia.js:294-298`). `!resumo` forçado no domingo não dispara o semanal, salvo `FORCAR_SEMANAL=true`.

---

## 2. Banco de dados (MongoDB Atlas)

### 2.1 Conexão (`mongo.js:11-22`)

`MONGODB_URI` obrigatória; banco `MONGODB_DB` ou `nutribot` (`mongo.js:19`). Pool `maxPoolSize: 5`, `serverSelectionTimeoutMS 15 s`, `socketTimeoutMS 45 s`, `waitQueueTimeoutMS 20 s` (`:17`). `colecao(nome)` lança se não conectado (`:50-53`). Não há schema/validação no Mongo; não há migrações; não há camada de repositório única — 30+ módulos chamam `colecao('...')` direto.

### 2.2 Índices (`mongo.js:25-41`, criados no boot, erro só é logado)

| Coleção | Índice | Unicidade / TTL |
|---|---|---|
| `perfis` | `{ jids: 1 }` | — |
| `refeicoes` | `{ jid: 1, dia: 1 }`, `{ dia: 1 }` | — |
| `arquivos_pessoa` | `{ arquivoId: 1 }` | — |
| `momentos` | `{ dia: -1 }` | — |
| `pesagens` | `{ jid: 1, dia: 1 }` | **não é unique** (a unicidade é por `replaceOne({jid,dia}, upsert)` em `mongo.js:309`) |
| `locais_brutos` | `{ jid: 1, ts: 1 }` | **unique**; `{ ts: 1 }` TTL 7 dias |
| `visitas` | `{ jid: 1, inicio: 1 }` | **unique** |
| `notas_brutas` | `{ criadoEm: 1 }` | TTL 3 dias |
| `intervencoes` | `{ dia: 1 }` | — |
| `correcoes_estimativa` | `{ jid: 1, criadoEm: -1 }` | — |
| `memoria_vetorial` | search index `vetor` (vectorSearch, 768 dims, cosine, filtros `tipo`, `pessoa`) | `memoria_semantica.js:17-35` |

Sem índice: `saude_relogio` (usa `_id = jid`), `treinos` (`_id` = id do Hevy; consultas por `jid`+`inicio` sem índice), `despensa` (consultas `{jid, k}` sem índice), `notas` (`{chave}` sem índice), `pensamentos`, `reflexoes`, `hipoteses`, `habitos` (`{jid, dia}` upsert sem índice), `previsoes` (`{jid, feitaEm}` upsert sem índice), `documentos_pessoa`, `correcoes_dia`, `config`, `memoria`, `persona*`, `aprendizados*`, `diario_nutri`, `fila_pendente`, `revisoes_pendentes`, `conhecimento`, `produtos`, `cidades`, `osm_cache`, `hevy_exercicios`, `baileys_auth`.

### 2.3 Convenções de identidade e data

- **Identidade de pessoa**: `jid` normalizado (`jidNormalizedUser`) — ex.: `55DD…@s.whatsapp.net` ou `…@lid`. Um perfil tem **lista** `jids` (número e LID, `mongo.js:120-135`). As coleções de dados gravam **só `jids[0]`** (`relogio.js:158`, `despensa.js:244`, `lugares.js:489`, `treino.js:75`, `pensamentos.js:81`, `reflexao.js:162`, `proatividade.js:99`, `pessoas.js:237`, `saude.js:423`) e leem com `{ jid: { $in: perfil.jids } }` na maioria (`mongo.js:292-319`, `contexto.js:151`), mas **algumas leem só por `jids[0]`** (`contexto.js:34` `notas`, `relogio.js:198/206`, `ferramentas.js:197`, `pensamentos.js:58/115/122`, `reflexao.js:102`). Risco: se a ORDEM de `jids` mudar (o `salvarPerfil` faz união preservando a ordem do existente, `mongo.js:129`), dados gravados com `_id = jid` antigo deixam de ser achados. Hoje a ordem é estável porque o existente vem primeiro.
- Cobranças, memória do dia e `momentos` usam **`nome`** (string) como chave (`cobranca.js:40`, `dia.js:87`, `mongo.js:180`), não `jid`. Mudança de nome do perfil exige `renomearNaMemoria` (`dia.js:68-78`).
- **Datas**: `dia` é string `'YYYY-MM-DD'` **no fuso** (TZ do grupo em `agora()`; fuso da pessoa onde o módulo usa `agora(fusoDe(p))`, ex. `despensa.js:251`, `relogio.js:47`). Horas são `'HH:MM'`. Timestamps de auditoria (`criadoEm`, `atualizadoEm`, `salvoEm`, `em`) são `Date` (UTC). `locais_brutos.ts` e `visitas.inicio/fim` são `Date`; `treinos.inicio/fim` são **string ISO** do Hevy (comparadas com string, `contexto.js:399`, `tendencia.js:390`). `memoria.mensagens[].hora` é no fuso do grupo (`cobranca.js:93`), mas a refeição grava `hora` + `horaLocal` + `minutos` no fuso da pessoa (`mongo.js:189-219`).
- Mistura de fusos: `refeicoes.dia` vem de `agora()` (fuso do GRUPO, `mensagens.js:609`) enquanto `minutos`/`horaLocal` são no fuso da pessoa; `pesagens.dia` do relógio é no fuso da pessoa (`relogio.js:50-57`). Para uma pessoa em outro fuso (Pessoa B, `avaliacao/cenarios.mjs:21`) o "dia" da refeição pode diferir do "dia" da pesagem.

### 2.4 LISTA DE COLEÇÕES (campos reais lidos/escritos)

| Coleção | Chave / unicidade | Campos (como o código grava) | Quem escreve / lê | Também no Drive? |
|---|---|---|---|---|
| `baileys_auth` | `_id` = `'creds'` ou `'<tipo>-<id>'` | `data` (JSON BufferJSON), `atualizadoEm` | `mongo.js:59-116`; `whatsapp.js`, `logout.js` | não |
| `perfis` | `jids[]` (índice não-unique); busca `{ jids: { $in } }` | ver 3.2 | `mongo.js:120-143`; `mensagens.js`, `perfis.js`, `saude.js`, `lugares.js`, `atividades.js`, `despensa.js`, `ferramentas.js`, `comandos.js`, `dia.js`, `pensamentos.js`, `reflexao.js`, `pessoas.js` | `Nutri-Ficha.md` (ficha), `Nutri-Notas.md` (notas) na pasta da pessoa |
| `memoria` | `_id: 'hoje'` (1 doc) | `dia`, `grupo`, `mensagens[{ hora, jid, nome, texto, tipo: 'texto'/'bot'/'pessoa'/..., refeicao? }]` (teto 600, `dia.js:38`), `cobrancas{ 'Nome:slot': true }`, `perguntas{ jid: { hora, pergunta } }` | `mongo.js:147-153`; `dia.js:35-41`, `cobranca.js:45`, `index.js:244-251` | `Diario/YYYY-MM-DD.md` (daily note regerada) |
| `config` | `_id: 'bot'` (1 doc) | `nomeBot`, `apresentadoEm{ chaveGrupo: ISO }` (ponto do JID vira `_`, `mensagens.js:406`), `aguardandoNomeDesde`, `desconectadoEm`, `desconectadoMotivo`, `ofertaPlano{ ate, atendidos[] }`, `vozLigada`, `audiosEspontaneos[]`, `revisoesAmostra[]`, `atualizadoEm` | `mongo.js:398-409`; `whatsapp.js:180`, `mensagens.js:65/168/417`, `revisao.js:79`, `index.js:256/272` | não |
| `persona` / `persona_historico` | `_id: 'nutri'` / insert | `texto`, `dia`, `atualizadoEm` / `texto`, `dia`, `substituidoEm` | `mongo.js:157-169`; `dia.js:281` | `Perfis/Nutri.md` |
| `aprendizados` / `aprendizados_historico` | `_id: 'nutri'` / insert | `documento`, `regras[]`, `dia`, `atualizadoEm` | `mongo.js:258-268`; `dia.js:253`, `comandos.js:248` | `Perfis/Nutri-Aprendizados.md` |
| `momentos` | insert (sem unicidade) | `dia`, `pessoa` (nome), `texto`, `tipo`, `criadoEm` | `mongo.js:173-183`; `dia.js:176` | `Perfis/Nutri-Momentos.md` (append) |
| `diario_nutri` | `_id = dia` | `dia`, `texto`, `criadoEm` | `mongo.js:323-330`; `dia.js:236` | `Perfis/Nutri-Diario.md` (append) |
| `refeicoes` | insert; fusão por regra (±30 min mesmo slot / ±10 min manual) — **sem unicidade** | `jid`, `nome`, `dia`, `hora`, `horaLocal`, `minutos`, `slot` (`cafe|lanche_manha|almoco|lanche|jantar|ceia`), `resumo`, `descricao` (≤220), `estimativa{ kcal, p, c, g }`, `manual`, `correcao`, `correcaoEstimativa`, `incerteza`, `criadoEm`, `atualizadoEm` | `mongo.js:187-298`, `:412`; `mensagens.js`, `comandos.js` (`!refeicao`, `!apagar`), `contexto.js`, `resumo.js`, `dia.js` | só via resumos/diário |
| `pesagens` | `replaceOne({ jid, dia })` upsert (1 por pessoa/dia) | `jid`, `nome`, `dia`, `peso`, `gordura?`, `fonte?` (`relogio`/`documento`/ausente = dito no grupo), `hora?` (HH:MM, só relógio), `criadoEm` | `mongo.js:302-319`; `saude.js:428`, `pessoas.js:265`, `mensagens.js:1146`, `ferramentas.js:261` | `Nutri-Saude.md` (resumo) |
| `habitos` | `updateOne({ jid, dia })` upsert com `$inc` | `jid`, `nome`, `dia`, `agua_ml`, `alcool_doses`, `criadoEm`, `atualizadoEm` | `mongo.js:384-394` | não |
| `previsoes` | `replaceOne({ jid, feitaEm })` upsert | `jid`, `nome`, `feitaEm`, `alvoDia`, `pesoInicial`, `diaInicial`, `deltaKg`, `pesoPrevisto`, `magraKg`, `gorduraKg`, `base`, `confianca…`, `conferida`, `resultado`, `conferidaEm`, `criadoEm` | `mongo.js:364-380`; `dia.js:419` | resumo de domingo |
| `correcoes_dia` | insert | `dia`, `pessoa`, `texto` (≤300), `em` | `mongo.js:273-278` | não |
| `correcoes_estimativa` | insert | `jid`, `nome`, `dia`, `slot`, `antes{ kcal, p }`, `depois{ kcal, p }`, `origem`, `descricao`, `texto`, `criadoEm` | `mongo.js:227-229`, `calibracao.js:130/140` | não |
| `fila_pendente` | `deleteMany` + `insertMany` no shutdown; drenada no boot | `id`, `b64` (WebMessageInfo), `salvoEm` | `mongo.js:334-346`; `mensagens.js:331-354` | não |
| `revisoes_pendentes` | insert / delete por `_id` | `jidGrupo`, `jid`, `perfil{ nome, apelido, objetivo, peso, dieta }`, `texto`, `imagem` (base64!), `mimeType`, `resposta`, `dia`, `hora`, `horaLocal`, `enviadoB64`, `refeicao`, `criadoEm` | `mongo.js:350-360`; `revisao.js:45-61` | não |
| `saude_relogio` | `_id = jids[0]` (1 doc por pessoa) | `nome`, `pesos[{ dia, hora, peso, gordura, altura, magra, fonte }]`, `sonos[{ dia, inicio, fim, principal, leve, profundo, rem, acordado, sessoes, total }]`, `atividades[{ dia, passos, calorias, fcRepouso, hrv, treinos[{ nome, min, hora, fonte, kcal, fcMedia }] }]` (90 dias), `texto`, `ultimoEnvio`, `app`, `recebidos{}` | `relogio.js:157-168`, `:198`, `:206`; `contexto.js:282`, `ferramentas.js:197`, `tendencia.js:389` | `Nutri-Saude.md` |
| `locais_brutos` | unique `{ jid, ts }`; TTL 7 d | `jid`, `ts` (Date), `dia`, `lat`, `lon`, `acc`, `vel`, `prov`, `em` | `lugares.js:491-531`, `:613`, `:658`, `:689-690`, `:821`, `:855`; `atividades.js:134/261` | não |
| `visitas` | unique `{ jid, inicio }` | `jid`, `lugarId`, `inicio` (Date), `fim`, `min`, `dia`, `dow`, `hIni`, `hFim` | `lugares.js:595-602`, `:593`, `:703`, `:855`; `despensa.js:443` | não |
| `osm_cache` | `_id` = chave de coordenada | `dado`, `em`, `completo` | `lugares.js:433-484` | não |
| `cidades` | `_id` = cidade normalizada | coords `{ lat, lon, nome, fuso }` | `clima.js:81-93` | não |
| `produtos` | `_id` = código/nome | `itens`, `salvoEm` (cache OFF 30 d) | `off.js:57-62` | não |
| `notas` | insert; dedupe por `chave` (NFC-e, 44 dígitos) quando houver | `jid`, `nome`, `chave`, `loja`, `dia`, `origem` (`app`/`foto`/…), `itens[{ item, descricaoOriginal, categoria, quantidade, unidade, granel, perecivel, validadeDias, alimento, preco, ean }]`, `criadoEm` | `despensa.js:246-255`, `:395`, `:434`, `:165` | não |
| `despensa` | `replaceOne({ jid, k })` (1 doc por pessoa+item) | `jid`, `k` (chave normalizada), `item`, `categoria`, `unidade`, `granel`, `perecivel`, `alimento`, `quantidade`, `estado` (`tem|acabando|acabou`), `compradoEm`, `validadeEm`, `acabouEm`, `loja`, `preco`, `nutri{ kcal, p, c, g, fonte }`, `compras`, `perguntadoEm`, `atualizadoEm` | `despensa.js:257-323` | não |
| `notas_brutas` | insert; TTL 3 d | `jid`, `chave`, `motivo`, `url?`, `texto` (CPF mascarado), `criadoEm` | `despensa.js:154-160`, `index.js:103` | não |
| `treinos` | `_id` = id do workout no Hevy | `jid`, `nome`, `titulo`, `inicio` (ISO string), `fim`, `exercicios[]` (bruto do Hevy), `salvoEm` | `treino.js:64-82`, `:236`; `contexto.js:151/281/399`, `tendencia.js:390` | não |
| `hevy_exercicios` | `_id: 'catalogo'` | `mapa{ id: { titulo, primario, secundarios, equipamento, tipo } }`, `salvoEm` (7 d) | `treino.js:46-59` | não |
| `arquivos_pessoa` | `_id = '<fileId>:<modifiedTime>'`; índice `arquivoId` | `arquivoId`, `nome`, `texto` (transcrição), `salvoEm` | `pessoas.js:84-129`, `saude.js:396-409` | cache do Drive |
| `documentos_pessoa` | `_id = '<fileId>:<modifiedTime>'` | `arquivoId`, `jid`, `nome`, `modificado`, `tipo`, `data`, `confianca`, `motivo`, `medidas{}`, `exames[]`, `resumo`, `relevante`, `salvoEm` | `pessoas.js:233-267` | `Nutri-Ficha.md` (seção) |
| `conhecimento` | `_id` = id do doc | `foco`, `titulo`, `versao`, `versaoArquivo`, `atualizado`, `consulta_en`, `corpo`, `salvoEm` | `conhecimento.js:57-104` | `Conhecimento/*.md`, `Conhecimento/Pesquisas/` |
| `memoria_vetorial` | `_id` = chave estável (`conversa:dia:Nome`, `notas:Nome`, `resumo:dia`, `momento:dia:i`, `diario:dia`, `anotacao:jid:ts`) | `tipo`, `pessoa` (nome/`grupo`/`nutri`), `dia`, `texto` (≤6000), `vetor[768]`, `criadoEm` | `memoria_semantica.js:38-100`, `ferramentas.js:252` | não |
| `pensamentos` | insert | `jid`, `nome`, `dia`, `hora`, `consultas[]`, `assunto`, `confianca`, `investigacao`, `texto`, `notar[]`, `sinais[]`, `valeFalar`, `assinatura`, `criadoEm` | `pensamentos.js:58-82`, `:115`, `:122` | não |
| `intervencoes` | insert | `dia`, `hora`, `jid`, `nome`, `gatilho`, `assunto`, `confianca`, `motivo`, `texto`, `respondida`, `respondidaEm`, `demoraMin`, `criadoEm` | `proatividade.js:76-137` | não |
| `reflexoes` | insert | `jid`, `nome`, `dia`, `motivo`, `texto`, `sintese`, `hipotesesAbertas[]`, `hipotesesFechadas[]`, `criadoEm` | `reflexao.js:102`, `:162` | `Nutri-Reflexoes.md` na pasta da pessoa |
| `hipoteses` | insert (fechadas) | hipótese + `jid`, `nome` | `reflexao.js:125` | não |

**Duplicações / fontes múltiplas da mesma informação (ponto de atenção para o app):**

1. **Peso**: `perfis.peso` (+ `atualizacoes.peso`), `pesagens` (fonte única do progresso, `progresso.js`), `saude_relogio.pesos[]` (histórico cru 90 d do app), `perfis.relogio.peso` (indicador curto, `saude.js:351`), `documentos_pessoa.medidas.peso_kg`. O `progresso.js` reconcilia (`preferirPesagem`, "a do relógio vence a digitada"), mas um app deve ler **`pesagens`** como verdade e tratar o resto como derivado.
2. **Gasto energético diário**: `saude_relogio.atividades[].calorias` (cru) e `perfis.relogio.gastos{ dia: kcal }` (30 dias, com atividades fixas somadas, `saude.js:382-384`, `atividades.js:104-107`). Os cálculos usam `perfil.relogio.gastos`.
3. **Treinos**: `treinos` (Hevy) e `saude_relogio.atividades[].treinos[]` (relógio); `contexto.js` funde por horário.
4. **Notas da Nutri sobre a pessoa**: `perfis.notas` (Mongo) e `Nutri-Notas.md` (Drive) — o Drive é a origem lida (`pessoas.js:147-150`), o Mongo é cópia (`pessoas.js:218`).
5. **Lugares**: `perfis.lugares[]` (derivado) de `visitas` (derivado) de `locais_brutos` (cru, 7 d).
6. **Memória do dia**: `memoria` (Mongo) e `Diario/YYYY-MM-DD.md` (Drive).
7. **Config do bot x env**: nome da bot em `config.nomeBot` com fallback `BOT_NOME`; grupo em `memoria.grupo` com fallback `ALLOWED_GROUP_ID`.

### 2.5 O que está no Google Drive (só apontado; o agente de integrações detalha)

Raiz `DRIVE_FOLDER_ID`: `Diario/`, `Resumos/` (dia e `Mes-YYYY-MM.md`), `Perfis/` (`Nutri.md`, `Nutri-Momentos.md`, `Nutri-Diario.md`, `Nutri-Aprendizados.md`), `Conhecimento/` (+ `Pesquisas/`), `logs` (`registrarLog`, `drive.js:237`) e **uma pasta por pessoa** com o nome dela (`pessoas.js:41-81`), contendo o que a pessoa deixa (PDF, docs, planilha Health Data Export, `Timeline.json`) e os arquivos `Nutri-*.md` que a bot escreve (`Nutri-Notas.md`, `Nutri-Ficha.md`, `Nutri-Saude.md`, `Nutri-Plano.md`, `Nutri-Reflexoes.md`). Pastas de sistema ignoradas: `conhecimento, logs, diario, resumos, perfis` (`pessoas.js:17`). A credencial é OAuth de usuário (não service account), escopos `drive` + `calendar.readonly` (`drive.js:22`).

---

## 3. Perfis, pessoas e permissões

### 3.1 O que são os "três perfis de usuário"

Não existem papéis formais no código. "Três perfis" = **três pessoas monitoradas** no grupo (fixtures e comentários: Pessoa A, Pessoa B e Pessoa C — `avaliacao/cenarios.mjs:20-22`; comentários em `mongo.js:195-223`, `comandos.js`, `GUIA`). Cada uma é um documento em `perfis` com `onboarded: true`. O GUIA (`:110`) fala em "o grupo com as 2 pessoas" — divergência de contagem, irrelevante para o código (N pessoas).

Papéis implícitos, todos resolvidos por **env var** e não por campo do banco:

| Papel | Como é identificado | O que libera | Arquivo |
|---|---|---|---|
| **Administrador** | `ADMIN_JID` (jid completo, ex. `55…@s.whatsapp.net`) comparado aos jids do remetente no privado (`mensagens.js:498-501`: `jidsPriv.includes(ADMIN_PRIVADO) || perfil.jids.includes(ADMIN_PRIVADO)`) | `!comandos` no privado com o bot (todos exceto `!resumo`, `mensagens.js:541-558`); teste de cupom/QR no privado sem gravar (`:513-535`); texto da SEFAZ colado no privado **grava** na despensa (`:502-512`); recebe `avisarAdmin` (`avisos.js:51-65`); marcado no prompt como "ADMINISTRADOR do sistema" (`gemini.js:260`) | `mensagens.js`, `avisos.js`, `gemini.js` |
| **Dono da agenda** | `AGENDA_DONO` = primeiro nome (sem acento) comparado a `perfil.nome.split(' ')[0]` (`agenda.js:22-25`) | único que recebe bloco de agenda, `!agenda`, ferramenta `agenda`, freio de cobrança por compromisso | `agenda.js`, `perfis.js:34`, `ferramentas.js` |
| **Pessoa com relógio** | `RELOGIO_TOKENS="nome=token,…"` por primeiro nome (`relogio.js:19-27`); token no header `x-relogio-token` + campo `pessoa` no corpo | `POST /relogio`, `POST /nota`; `perfil.relogio` preenchido; `!relogio`; ferramenta `relogio` | `relogio.js`, `index.js:71-138` |
| **Pessoa com Hevy** | `HEVY_CHAVES="nome=chave,…"` por primeiro nome (`treino.js:16-27`) | sincronização de treinos, `!treino`, ferramenta `treino_forca` | `treino.js` |
| **Pessoa com localização** | flag `perfil.lugaresAtivo` (gravada quando chega o 1º ponto, `lugares.js:515`; `!lugares esquecer` desliga, `:856`) | blocos de lugares, `!lugares`, atividades por localização, `mercados_perto` | `lugares.js` |

**Não há** (e): papel "nutricionista/observador", permissão por pessoa para ver dados de outra, ACL por coleção, convite/cadastro fora do grupo, múltiplos grupos (há `apresentadoEm` por grupo, mas `memoria.grupo` é um só e `ALLOWED_GROUP_ID` restringe a um).

### 3.2 Documento `perfis` (campos que o código grava)

Identidade e cadastro (`mensagens.js:635-686`, `perfis.js:67-122`): `jids[]`, `nome`, `onboarded`, `girias[]`, `criadoEm`, `atualizadoEm`, `peso`, `altura`, `objetivo`, `cidade`, `fuso`, `dieta`, `restricoes`, `genero` (`masculino|feminino|outro`), `metaPeso`, `metaPrazo` (`YYYY-MM-DD`), `metaModo` (`etapa|final`), `ritmo` (`maximo|medio|minimo`), `biotipo`, `produtos[{ nome, porcao, kcal, proteina, carbo, gordura, em }]` (≤10), `atualizacoes{ campo: dia }` (data de cada mudança), `apelido`, `semApelido`, `pastaId`, `pastaNome`, `notas`, `rotina`, `planoPedido`, `documentos[]` (≤20, `pessoas.js:255-259`).

Derivados/telemetria: `relogio{ atualizado, peso, gordura, pesoEm, ultimaNoite{}, sonoMedioMin, deitaMedia, levantaMedia, passosMedia, treinos7d, fcRepouso, fcMedia, recuperacao, hrv, gastos{ dia: kcal }, linha }` (`saude.js:337-387`), `lugares[]` (`lugares.js:650`), `lugaresAtivo`, `lugaresAtualizadoEm`, `ultimaSituacao{ estado, lugar, desde, minutos, em }`, `mercados{ em, texto, falhou }`, `atividades[{ id, nome, dias, inicio, fim, met, lugar, criadoEm }]`, `atividadesFeitas{ dia: [...] }`, `atividadesPendentes[]`, `despensaPerguntaEm`, `anotacoes[{ dia, tipo, texto }]` (≤20, `ferramentas.js:248-250`), `pensamento{ dia, hora, texto, notar }`, `hipoteses[]`, `reflexao{ sintese, … }`, `sugestoesCarga[]`.

O documento de perfil é, na prática, o **"cache agregado por pessoa"**: um app que mostre "a tela da pessoa" lê 80% do que precisa daqui, mas precisa entender que `relogio`, `lugares`, `pensamento` e `reflexao` são cópias desnormalizadas recalculadas por crons.

### 3.3 Como o bot sabe "quem falou" numa mensagem de grupo

1. `jidsDoRemetente(msg.key)` (`whatsapp.js:132-137`): `[key.participant, key.participantAlt]` normalizados (número e LID, Baileys 7). Se `fromMe` e sem participant → jids do próprio bot.
2. `buscarPerfil(jids)` = `findOne({ jids: { $in: jids } })` (`mongo.js:120-122`). O perfil guarda os dois identificadores e `salvarPerfil` faz a união (`mongo.js:127-131`), então a pessoa é reconhecida tanto pelo número quanto pelo LID.
3. Sem perfil: cria um `onboarded: false` com `nome = pushName || número` e pede cadastro (`mensagens.js:634-639`). O onboarding é por IA (`extrairDadosOnboarding`) exigindo nome, peso, altura, objetivo, cidade e dieta (`:649-686`); só então `onboarded: true` e a ficha vai para o Drive.
4. No privado: `jidsDoPrivado(key)` = `[remoteJid, remoteJidAlt]` (`whatsapp.js:128-130`).
5. No histórico resgatado, o remetente vem em `msg.participant` e `retomada.js` copia para `key` (**(a)** `test/retomada.test.mjs`).

**Onde a separação de pessoas pode falhar:**

- **Pasta do Drive por nome** (`pessoas.js:41-81`): duas pessoas com o mesmo primeiro nome e empate de pontuação viram pastas separadas (ok), mas uma pasta "João" pré-existente é adotada por "João Almeida" — só o primeiro cadastro leva; o `pastaId` fica gravado e vale dali em diante.
- **Tokens e chaves por primeiro nome** (`RELOGIO_TOKENS`, `HEVY_CHAVES`, `AGENDA_DONO`): duas pessoas com o mesmo primeiro nome colidem; `/relogio` acha o perfil por `listarPerfis().find(primeiro nome === pessoa)` (`relogio.js:152`) — pega o **primeiro** que bater. Mesmo em `/nota` (`index.js:94`).
- **Memória do dia e cobranças por `nome`** (string): se duas pessoas tiverem o mesmo `nome`, as marcações se misturam (`cobranca.js:40`, `dia.js:87`).
- **`refeicoes` fundem por `jid` + janela de 30 min** (`mongo.js:209-212`): a refeição de outra pessoa não se mistura, mas uma pessoa com dois jids (número e LID) grava `jid = jids[0]` do remetente da mensagem — **`r.jid` vem de `jids[0]` do REMETENTE naquela mensagem**, não do perfil (`mensagens.js:606`, `:683`). Se uma mensagem vier só com LID e outra só com número, há risco de `jids[0]` diferente entre mensagens e a fusão de "mesma refeição" não acontecer; a leitura usa `$in: perfil.jids`, então não some, só pode duplicar.
- **`pesagens` ditas no grupo**: `registrarPesagem({ jid: jids[0] … })` (`mensagens.js:1146`) — mesmo risco de jid variável; `progresso.js` tolera "outra pessoa na balança" por heurística (**(a)**).
- **Agenda / lugares no prompt**: entram só na conversa com a própria pessoa (`agenda.js:4-5`, `perfis.js:35`); a regra de não comentar com outra pessoa é **de prompt**, não de código — vazamento depende do modelo.
- **Privado**: qualquer pessoa que não seja `ADMIN_JID` é ignorada em silêncio (`mensagens.js:489`, `:501`). Não há canal privado por pessoa para dados sensíveis.

### 3.4 Comandos e quem pode usá-los

`comandos.js:174-663`: **nenhum comando é restrito a admin no grupo**. Qualquer membro pode `!reset` (apaga o próprio perfil, `:193-197`), `!resumo` (fecha o dia para todos, `:189-192`), `!estudar` (dispara pesquisa mensal, `:241-245`), `!nome` (rebatiza a bot, `:182-188`), `!persona`, `!status`, `!licoes`. Os comandos "pessoais" (`!hoje`, `!perfil`, `!progresso`, `!relogio`, `!lugares`, `!despensa` …) filtram por `jids` do remetente; `!hoje todos` / `!grafico todos` mostram o grupo inteiro (`:286-289`, `:437`, `:448-450`). A única restrição por papel é **privado = admin** (`mensagens.js:492-564`).

---

## 4. Rotas HTTP (Express 5, `index.js`)

Todas (b). Não há CORS, rate-limit, versionamento, paginação, logging estruturado nem validação de schema. Só `/relogio` e `/nota` têm `express.json` (limites 4 MB e 2 MB).

| Método/caminho | Auth | Corpo | Resposta | Quem chama hoje | Linha |
|---|---|---|---|---|---|
| `GET /ping` | nenhuma | — | `pong` (text) | Render health check, auto-ping interno, `keepalive.yml`, UptimeRobot | `index.js:60` |
| `GET /` | nenhuma | — | HTML (`paginaInicial`) | Google OAuth review, navegador | `:63` |
| `GET /privacidade` | nenhuma | — | HTML | idem | `:64` |
| `GET /estado` | **nenhuma** | — | JSON `{ status, dia, mensagensHoje, grupo }` (expõe o JID do grupo publicamente) | `vigia.yml` | `:65-67` |
| `POST /relogio` | header `x-relogio-token` + `pessoa` no corpo (token por primeiro nome) | JSON `{ pessoa, app, fuso?, pesos[{t,kg,gordura,altura,magra,fonte}], sonos[{inicio,fim,leve,profundo,rem,acordado}], dias[{dia,passos,calorias,fcRepouso,hrv}], treinos[{inicio,fim,tipo/nome,min,fonte,kcal,fcMedia}], locais[{lat,lon,acc,ts,vel,prov}] }` | 200 `{ ok, pessoa, recebidos{}, resumo }`; 401 token/pessoa; 404 sem perfil; 503 sem `RELOGIO_TOKENS`; 500 | app Android `SyncWorker` a cada 15 min (`android/.../SyncWorker.kt`), 14 dias no 1º envio e 3 depois | `:71-79`, `relogio.js:147-192` |
| `GET /relogio` | nenhuma | — | texto explicativo | navegador | `:80` |
| `POST /nota` | mesmo token do relógio | JSON `{ pessoa, app, chave?, url?, texto, diagnostico?, motivo? }` | 200 imediato `{ ok, recebido, resumo }` e processa em 2º plano (teto 5 min); 200 `diagnóstico recebido`; 400 texto < 50 chars; 401; 404; 500 | app Android `NotaWorker`/`Cupom.kt` | `:82-138` |
| `GET /qr` | **nenhuma** | — | HTML com QR (data URL) que recarrega a cada 20 s; mostra número se conectado | pessoa pareando no navegador | `:139-155` |
| `GET /status?token=` | query `token === ADMIN_TOKEN` (403 se não configurado, 401 se errado) | — | JSON `{ status, numero, nome, dia, mensagensHoje, grupo, keepalive, uptimeMin, desconectadoHaMin, tokensGeminiHoje, modelos, reservasExternas }` | admin no navegador | `:157-184` |
| `GET /logout?token=` | idem | — | HTML "Desvinculado" | admin no navegador | `:186-195` |

**Avaliação para reaproveitar como API do app novo:**

- Reaproveitável como está: `POST /relogio` e `POST /nota` (já são "API de app"; contrato JSON definido em `relogio.js:47-116` e `Cupom.kt:93-103`). Fraquezas: token estático por primeiro nome em texto puro no env; autenticação por nome é colidível; sem versionamento (há só `app: "relogio/1.6"` informativo); resposta de `/nota` é assíncrona sem endpoint de consulta do resultado (o resultado vai para o grupo de WhatsApp).
- **Não existe nenhuma rota de leitura de dados da pessoa** (refeições, pesagens, progresso, despensa, lugares, treinos, pensamentos) — tudo isso só sai pelo WhatsApp (`!hoje`, `!progresso`, …). Para o app visual será preciso criar GET autenticados sobre as funções puras que já existem (`acompanhamento.visaoDe/progressoDe`, `resumo.resumirHoje`, `tendencia.tendenciaCompleta`, `despensa.listarDespensa`, `lugares.lugaresZap`, `relogio.situacaoRelogio`, `treino.treinoDe`), que hoje formatam texto para WhatsApp (`formato: 'zap'`) e precisariam de um formato JSON.
- `GET /estado` e `GET /qr` são públicos: qualquer um com a URL vê o JID do grupo e pode escanear o QR (sequestro de sessão). Devem ficar atrás de token se o app for distribuído.
- `ADMIN_TOKEN` vai em **query string** (fica em logs de proxy/navegador). `/logout` é GET com efeito colateral destrutivo.
- Falta: CORS (irrelevante para app nativo, relevante se houver webview/PWA), paginação, erros padronizados (hoje mistura text/html/json), `express.json` global, limite de taxa, auditoria de quem chamou.
- Toda a lógica de leitura passa por `estado` global e pela fila; rotas GET de leitura pura podem ir direto ao Mongo sem fila (como `/relogio` já faz), mas escrita que afete `estado.memoria` precisa entrar em `naFila` ou chamar `lembrar`.

---

## 5. Limitações e pontos frágeis

### 5.1 TODO/FIXME no código

Grep por `TODO|FIXME|XXX|HACK|pendência|limitação` em `*.js`: **nenhum TODO/FIXME formal**. As limitações estão documentadas em comentários narrativos e no GUIA. Trechos explícitos:

- `lugares.js:618`: lugar da Linha do Tempo que saiu da lista "não dá pra recriar (sem coordenadas); ignora".
- `agenda.js:297`: API desligada só volta "depois de um restart com credencial nova".
- `GUIA:214` "Limite honesto: ela continua sem perceber erro que ninguém contesta".
- `GUIA:189` "tempo real é uns 15 a 30 min" (Samsung Health grava no Health Connect de tempos em tempos).
- `GUIA:211` busca web do Gemini "fica desligada até o projeto ter faturamento" (**(d)**: código pronto, `PESQUISA_WEB=off`).
- `GUIA:225` "o Galaxy Watch não grava HRV no Health Connect (0 dias em 22)" — campo `hrv` existe no app e no servidor, mas vem vazio (**(c)**).
- `GUIA:222` consulta por chave na SEFAZ pelo servidor bloqueada por Cloudflare; contornada pelo WebView do app.
- `GUIA:243`: decisões de NÃO adotar promptfoo/DeepEval, Transformers.js, tesseract, USDA, Mem0.
- `drive.js:55-59`: alerta de que o Google vai bloquear o escopo de Drive no cliente do gcloud; `checarDrive` diário existe por isso.

### 5.2 Estado em memória que se perde no restart (Render Free reinicia a cada deploy e por manutenção)

| Estado | Onde | Consequência |
|---|---|---|
| Uso/cota do Gemini do dia, castigo por modelo/chave, últimas respostas | `gemini.js:12,355,387`; `voz.js:26-27` | `!status` e `/status` mostram zero depois do restart; pode voltar a bater em modelo em castigo |
| `enviadosPeloBot` (ids das próprias mensagens) | `whatsapp.js:45` | após restart, mensagem antiga do próprio bot que chegue como `notify`/`fromMe` pode ser tratada como digitada no celular (mitigado por `append` ser ignorado, `:388-391`) |
| Presenças (`presencas`), espera de lote/fragmento, `ultimoPapoEm`, `ultimaDesculpaEm`, `dicaPrivadoEm` | `whatsapp.js:117`, `mensagens.js:44,134-135,157,436,491` | fragmentos em espera no momento do SIGTERM: `salvarFilaPendente` salva `processando` + `pendentes`, **mas não as mensagens em `esperaFragmentos`** (`mensagens.js:323-325`) → perdidas |
| Caches: dossiê por pessoa (10 min), agenda (15 min), clima, coords, `ultimaSync` do Hevy, catálogo Drive | `pessoas.js:33`, `agenda.js:17`, `clima.js:11-12`, `perfis.js:16`, `drive.js:27` | só custo; re-transcrição de PDF não ocorre (cache no Mongo) |
| `agenda.desligada` | `agenda.js:18` | restart reativa a tentativa (comportamento desejado) |
| Timer de `gravarDiario` | `dia.js:45` | coberto no `encerrar` (`index.js:352`) |
| `estado.silencioAte` (`!silencio`) | `estado.js:17` | restart cancela o silêncio |

Persistidos (sobrevivem): sessão WhatsApp, `memoria` do dia, `config`, fila pendente (`fila_pendente`), persona, aprendizados.

### 5.3 Concorrência e idempotência

- **Fila única sem timeout global**: `naFila` serializa tudo; um `fecharDia` (dezenas de chamadas de IA + Drive) bloqueia respostas a mensagens até terminar. `fecharDia` não está cercado por `comTempo`; o cão de guarda de 4 min cobre só `processar` (`mensagens.js:306-310`).
- **`/relogio` roda fora da fila** e grava `perfis` (`salvarPerfil` em `saude.js:433/441`, `lugares.js:515/525/650`) enquanto a fila pode estar gravando o mesmo perfil → `updateOne($set)` por campo mitiga, mas `lugares` relê e regrava a lista inteira (`lugares.js:548-549`, `:570-584`): há um comentário reconhecendo a corrida ("relê antes de gravar: outro envio pode ter mexido", `:569`) sem lock.
- **`salvarPerfil` por `jids`** faz `findOne` + `updateOne` (não atômico, `mongo.js:124-135`); dois cadastros simultâneos do mesmo jid podem criar dois perfis (índice `jids` não é unique).
- **`/nota` idempotente** por `chave` da NFC-e (`despensa.js:250`); sem chave (texto colado) duplica. O app reenvia por backoff (`NotaWorker.kt`), então a dedupe por chave é essencial e existe (**(b)**).
- **`/relogio` idempotente** por fusão por dia (`relogio.js:125-134`, **(a)** `hoje-mes.test.mjs` "relógio (app)", `progresso.test.mjs` "envio de 72 h"); `locais_brutos` dedupe por índice unique `{jid, ts}`.
- **`fila_pendente`**: `carregarPendentes` apaga ao ler (`mongo.js:344`); se o processo cair durante o reprocessamento, as mensagens somem. `salvarPendentes` faz `deleteMany` + `insertMany` sem transação.
- **Duas instâncias** (deploy com overlap, ou local + Render): Baileys derruba uma a outra (`GUIA:141`), e os crons rodariam em dobro. O Render Free faz troca de instância no deploy (o `vigia.yml` espera 90 s por isso).
- **`!resumo` e virada de dia**: `estado.fechandoDia` evita reentrância (`dia.js:138-139`), mas `garantirDiaAtual` usa `<` para não fechar duas vezes (`dia.js:124-125`) — fechamento às 23:59 que termine depois da meia-noite é tratado (`dia.js:315`).
- **Pesagens**: `replaceOne({jid, dia})` sem índice unique → corrida pode gerar dois docs no mesmo dia; `progresso.validarPesagens` tolera ("uma por dia", **(a)**).

### 5.4 Outras fragilidades relevantes para o app

- **Render Free dorme em 15 min** sem tráfego; o app Android já prevê `connectTimeout 30 s` / `readTimeout 90 s` (`Envio.kt:13-14`) e retry em 502/503. Qualquer API nova herda essa latência de "acordar".
- **512 MB de RAM** (`GUIA:243`), um processo: a transcrição de PDF, `imagem` base64 em `revisoes_pendentes` e `syncFullHistory` desligado são escolhas por isso.
- **Drive é dependência de boot**: sem `DRIVE_FOLDER_ID`/credencial, `process.exit(1)` (`index.js:226`, `drive.js:46`). O app visual não deveria depender do Drive.
- **Identidade por primeiro nome** em três lugares diferentes (`RELOGIO_TOKENS`, `HEVY_CHAVES`, `AGENDA_DONO`) e por `nome` na memória do dia.
- **`dia` no fuso do grupo x fuso da pessoa** (2.3).
- **Segredos no disco**: `.env`, `drive-oauth.json`, `oauth-client.json`, `.render-service.json` existem no diretório (gitignorados, `.gitignore:1-6`); não lidos nesta auditoria.
- **Logs**: `console.log` puro; `LOG_LEVEL` só afeta o pino do Baileys (`whatsapp.js:31`). Leitura de logs é pela API do Render (memória do usuário).
- O GUIA é extenso e majoritariamente fiel ao código; divergências encontradas: deploy automático x API (1.6), repositório privado x público (1.6), "2 pessoas" x 3 perfis (3.1), `RELOGIO_TOKENS` ausente do `render.yaml` (1.5), tabela "Comandos no grupo" (`GUIA:153-169`) lista 13 comandos enquanto `comandos.js` implementa 33 (`AJUDA` em `comandos.js:36-37` é a lista completa).

---

## 6. Variáveis de ambiente (nomes apenas; origem: `.env.example`, `render.yaml`, `process.env.*`)

| Grupo | Variáveis | Onde é lida |
|---|---|---|
| Infra/HTTP | `PORT`, `TZ`, `LOG_LEVEL`, `ADMIN_TOKEN`, `KEEPALIVE_URL`, `RENDER_EXTERNAL_URL`, `KEEPALIVE_MINUTES`, `ALERTA_DESCONEXAO_MIN`, `REINICIO_SEM_WHATSAPP_MIN` | `index.js`, `whatsapp.js`, `util.js` |
| Mongo | `MONGODB_URI`, `MONGODB_DB` | `mongo.js` |
| WhatsApp/pessoas | `ALLOWED_GROUP_ID`, `ADMIN_JID`, `BOT_NOME`, `PERSONA_ARQUIVO`, `MANTER_COLCHETES_NO_ZAP`, `PAPO_INTERVALO_MIN`, `ATRASO_COBRANCA_MIN`, `JANELA_COBRANCA_MIN`, `MAX_FOTOS_JUNTAS`, `JANELA_FOTOS_S`, `ESPERA_LOTE_MS`, `ESPERA_LOTE_MAX_MS`, `ESPERA_FRAGMENTO_MS`, `ESPERA_FRAGMENTO_MAX_MS`, `ESPERA_FOTO_SEM_LEGENDA_MS`, `FERRAMENTAS_CONVERSA`, `PROATIVIDADE`, `AVISO_ERRO_MIN`, `RESGATE_MAX`, `RESGATE_IDADE_MAX_H`, `ATRASO_DESCULPAS_MIN`, `RESGATE_ESPERA_MS`, `AVISO_VOLTA_MIN`, `FORCAR_SEMANAL` | `estado.js`, `mensagens.js`, `avisos.js`, `cobranca.js`, `retomada.js`, `proatividade.js`, `dia.js` |
| Google | `DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SERVICE_ACCOUNT_FILE`, `DRIVE_TIMEOUT_MS`, `AGENDA_DONO`, `AGENDA_ICS_URL`, `AGENDA_CACHE_MIN`, `AGENDA_IGNORAR`, `AGENDA_PALAVRAS_TRABALHO` | `drive.js`, `agenda.js` |
| IA | `GEMINI_API_KEY`, `GEMINI_API_KEYS`, `GEMINI_MODEL`, `GEMINI_MODELOS_RESERVA`, `GEMINI_MODELOS_LEVES`, `GEMINI_EMBEDDING`, `PESQUISA_WEB`, `PESQUISA_WEB_MODELOS`, `HISTORICO_MAX_CHARS_BOT`, `DOSSIE_MAX_CHARS`, `CONHECIMENTO_MAX_CHARS`, `MEMORIA_SCORE_MIN`, `REVISOES_POR_SEMANA`, `REVISAO_GAP_H`, `REVISAO_CHANCE`, `AVALIACAO_GEMINI_API_KEY` | `gemini.js`, `memoria_semantica.js`, `revisao.js`, `avaliacao/rodar.mjs` |
| Reservas de IA | `GROQ_API_KEY`, `GROQ_MODEL`, `HF_API_KEY`, `HF_MODEL`, `HF_MODEL_VISAO`, `HF_MODEL_VISAO_2`, `COHERE_API_KEY`, `COHERE_MODEL`, `COHERE_MODEL_VISAO`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_MODEL_VISAO`, `RESERVA_VISAO_ORDEM`, `RESERVA_MAX_CHARS`, `RESERVA_MAX_CHARS_GROQ`, `BRAVE_API_KEY`, `REPO_URL` | `reservas.js`, `pesquisa.js`, `off.js` |
| Voz | `VOZ_MOTOR`, `VOZ_GEMINI_VOZ`, `VOZ_GEMINI_MODELOS`, `VOZ_ESTILO`, `VOZ_CONFERIR`, `VOZ_TTS`, `VOZ_MAX_CHARS`, `VOZ_TIMEOUT_MS` | `voz.js` |
| App/relógio/outros | `RELOGIO_TOKENS`, `HEVY_CHAVES`, `HEVY_SYNC_MIN`, `QUICKCHART_URL`, `CLIMA_CACHE_MIN`, `CONTATO_NOME`, `CONTATO_EMAIL` | `relogio.js`, `treino.js`, `perfis.js`, `graficos.js`, `clima.js`, `paginas.js`, `lugares.js` |

Segredos do GitHub Actions: `RENDER_API_KEY`, `RELOGIO_KEYSTORE_B64`, `RELOGIO_KEYSTORE_PASS`, `AVALIACAO_GEMINI_API_KEY`.

---

## 7. App Android existente (`android/`) — o que já é "camada visual"

Pacote `br.nutribot.relogio`, `versionCode 7`, `versionName 1.6` (`build.gradle.kts:14-15`). Telas: uma `MainActivity` com URL do bot, primeiro nome, token, botões Permissões / Sincronizar / Bateria / Localização / Ler cupom (`strings.xml`). Workers: `SyncWorker` (15 min, Health Connect → `POST /relogio`), `NotaWorker` (cupom → `POST /nota`, com `Prefs.notaPendente`). Intent filters para links das SEFAZ (SC, SP, RS, PR, …) (`AndroidManifest.xml:46-53`). Permissões: INTERNET, localização (coarse/fine/background), `health.READ_*` (peso, gordura, massa magra, sono, passos, calorias, exercício, FC repouso, FC, HRV, background). **Não exibe nenhum dado do bot** além do `resumo` da última resposta — é só coletor. Build assinado por `android.yml` e publicado em release fixa.

---

## 8. Perguntas em aberto (não determináveis pelo código)

1. **Quantas pessoas estão de fato cadastradas em `perfis`** e se há perfis `onboarded: false` órfãos (número de quem entrou e nunca se cadastrou) — só o Mongo responde.
2. **Qual é a ordem real de `jids`** em cada perfil (número primeiro ou LID primeiro) — determina se os `_id = jids[0]` de `saude_relogio`, `despensa`, `visitas` etc. são números ou LIDs.
3. **Existem documentos duplicados em `pesagens` (mesmo `jid`+`dia`) ou em `perfis` (mesmo jid)**, dado que os índices não são unique.
4. **`RELOGIO_TOKENS`, `HEVY_CHAVES` e `AGENDA_DONO` estão configurados no Render** (não constam do `render.yaml`); quem são os "nomes" cadastrados em cada um.
5. **O repositório é público ou privado** (GUIA diz privado; crons de GitHub grátis e a memória do usuário dizem público).
6. **Volume real das coleções** (`refeicoes`, `locais_brutos`, `memoria_vetorial`) e se o cluster M0 (512 MB) está perto do limite — relevante para `revisoes_pendentes` com imagem em base64.
7. **Se o vigia já abriu issues** e como o admin reage (processo operacional).
8. **Se existe monitor UptimeRobot** (camada 3, opcional no GUIA).
9. **Quantas instâncias do app Relógio estão instaladas** e em que versão (`saude_relogio.app` guarda a versão por pessoa).
10. **Política de retenção**: a privacidade diz "apagados a pedido"; não há rotina de apagamento por pessoa além de `!reset` (só o perfil), `!lugares esquecer` e `!despensa limpar` — refeições, pesagens, pensamentos e memória vetorial de uma pessoa não têm comando de exclusão (**(e)**).
11. **Como o app novo vai autenticar**: o único mecanismo existente é token estático por primeiro nome; não há usuários, sessões nem JWT.
