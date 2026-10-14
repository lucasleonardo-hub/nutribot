> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# R5 — Integrações externas, Google Drive e app Relógio

Auditoria somente leitura do repositório `C:\Users\lucas\Downloads\BOT` (commit `2ae910e`, 13/10/2026), para planejar o app Android que vai ser a camada visual do NutriBot e absorver o app "Relógio" (`android/`, `br.nutribot.relogio` v1.6).

**Contexto do dono, recebido durante a auditoria:** o app novo é instalado à mão (APK fora da Play Store), só o dono usa (uma pessoa autorizada, vendo os 3 perfis) e o custo de API tem que ser zero. As recomendações da seção 6 já levam isso em conta.

**Legenda de estado** (vale em todo o relatório):
- **(a)** implementado e coberto por teste
- **(b)** implementado, sem teste
- **(c)** parcial
- **(d)** só planejado ou citado em comentário
- **(e)** inexistente

Não li nem cito `.env`, `drive-oauth.json`, `oauth-client.json`, keystore nem tokens. Aparecem só nomes de variáveis e de segredos.

---

## 0. Os 12 achados que mais pesam no app novo

1. **Não existe API de leitura.** O servidor HTTP tem só estas rotas: `/`, `/privacidade`, `/ping`, `/estado`, `/qr`, `/status?token=`, `/logout?token=`, `GET/POST /relogio` e `POST /nota` (`index.js:60-196`). Todo dado que o app novo for mostrar precisa de rota nova. Status **(e)**.
2. **Tudo que vem do relógio para uma pessoa entra por um token de pessoa** (`RELOGIO_TOKENS=nome=token`, `relogio.js:19-27`, verificado em `relogio.js:148-151` e `index.js:87-93`). Não há token de dono que enxergue os 3 perfis. O mais perto disso é o `ADMIN_TOKEN`, que vai por *query string* (`index.js:157-167`). Status **(e)** para "dono vê os 3".
3. **Pesagem é "última gravação vence" por (jid, dia)** (`mongo.js:302-310`, `replaceOne({jid, dia})`). A cada POST do app (de 15 em 15 min), `aplicarDadosSaude` regrava **todas** as pesagens dos últimos 60 dias com `fonte:'relogio'` (`saude.js:424-429`). Consequências:
   - o peso dito no chat no mesmo dia (`mensagens.js:1146`, `ferramentas.js:261`, sem `fonte`) some no envio seguinte;
   - a pesagem tirada de bioimpedância em PDF (`pessoas.js:265`, `fonte:'documento'`) some do mesmo jeito.
   
   Não há regra de conflito entre fontes. Status **(c)**.
4. **Escrita pesada a cada 15 min por pessoa.** Cada POST `/relogio` faz, de forma síncrona e antes de responder:
   - até 60 upserts em `pesagens`;
   - 1–2 `salvarPerfil`;
   - um `Nutri-Saude.md` reescrito no Drive (`saude.js:443-446`);
   - o `replaceOne` em `saude_relogio`.
   
   O comentário de `drive.js:12` ("regerado quando a planilha muda") está desatualizado: hoje o arquivo é regravado a cada envio.
5. **O app não preenche lacunas maiores que 3 dias.** O primeiro envio cobre 14 dias e os seguintes, 3 dias contados de agora (`SyncWorker.kt:41`). Se o celular ficar mais de 3 dias sem enviar (offline, app morto pela bateria, Render fora), os dias mais antigos nunca chegam. Os dados continuam no Health Connect, mas ninguém os pede. Status **(c)**.
6. **Leituras do Health Connect sem paginação.** Nenhum `readRecords` usa `pageToken` (`Leitor.kt:65,68,71,83,119,123,126,139,158`; grep por `pageToken` não acha nada). No envio de 14 dias, a série de batimentos (`HeartRateRecord`) pode passar do limite de uma página e cortar sem aviso, o que distorce o "batimento de repouso".
7. **Sono e treino não são filtrados por app de origem.** A `fonte` é registrada, mas:
   - sessões de sono de dois apps no mesmo dia **somam** (`relogio.js:71-83`);
   - treinos repetidos só se juntam se tiverem a mesma hora e o mesmo nome (`relogio.js:110`);
   - só o peso prefere Samsung (`relogio.js:40,56`).
   
   Passos e gasto vêm do agregado do próprio Health Connect, que já deduplica (`Leitor.kt:108-114`).
8. **Os campos `kcal` de treino e `altura` nunca vêm do app.** O servidor lê `t.kcal` e `p.altura` (`relogio.js:55,111`), mas o `Leitor.kt` não envia nenhum dos dois (`Leitor.kt:73-79,163-169`). O app também não pede permissão de `Height` nem de `ActiveCaloriesBurned` (`AndroidManifest.xml:9-19`). Status **(c)**.
9. **O Drive é fonte de leitura em dois pontos**, não só um espelho:
   - `Nutri-Notas.md` é relido e manda sobre o cache (`pessoas.js:147-150`);
   - os resumos diários `Resumos/AAAA-MM-DD.md` são relidos para montar o resumo semanal (`dia.js:328-331`).
   
   Os documentos e a planilha da pessoa também só existem no Drive.
10. **O APK sai de uma release pública e fixa** (tag `relogio`, `--clobber`, `.github/workflows/android.yml:42-48`). O `versionCode` é manual (`build.gradle.kts:14`) e não há checagem de atualização dentro do app. A assinatura é estável pelos segredos `RELOGIO_KEYSTORE_B64` e `RELOGIO_KEYSTORE_PASS`, a chave mais importante a preservar para o app novo atualizar por cima do antigo.
11. **Leitura em segundo plano no Health Connect.** A permissão `READ_HEALTH_DATA_IN_BACKGROUND` é pedida, mas a falta dela é **tolerada** (`SyncWorker.kt:39`). Sem ela, o worker cai em exceção genérica, tenta 3 vezes e termina em "ERRO" (`SyncWorker.kt:54-60`). O código não confere se o recurso de segundo plano existe no aparelho.
12. **"Usado só pelo dono" ≠ "lê o celular só do dono".** Hoje cada pessoa instala o Relógio no próprio celular. Se o app novo absorver o Relógio e só o dono instalar, os outros 2 perfis perdem relógio, localização e cupom, a menos que continuem com o Relógio antigo ou instalem o novo em modo "coletor". Ver Perguntas em aberto.

---

## 1. App Relógio (`android/`)

### 1.1 Build, distribuição e assinatura

| Item | O que o código faz | Onde | Estado |
|---|---|---|---|
| Identidade | `namespace`/`applicationId` `br.nutribot.relogio`; `versionCode 7`, `versionName "1.6"` | `android/app/build.gradle.kts:7,11,14-15` | (b) |
| SDK | `minSdk 28` (Android 9), `targetSdk 36`, `compileSdk 36` (exigência do connect-client 1.1.0) | `build.gradle.kts:8,12-13` | (b) |
| Dependências | core-ktx 1.13.1, appcompat 1.7.0, activity-ktx 1.9.3, `health.connect:connect-client:1.1.0`, `work-runtime-ktx:2.9.1`, `play-services-location:21.3.0`, `play-services-code-scanner:16.1.0`, coroutines 1.8.1 | `build.gradle.kts:52-61` | (b) |
| Plugins | AGP 8.11.1, Kotlin 2.0.21, Gradle 8.13 (no CI), Java 17 | `android/build.gradle.kts:3-4`, `android.yml:22-24`, `build.gradle.kts:43-49` | (b) |
| Minificação | desligada (`isMinifyEnabled = false`) | `build.gradle.kts:36` | (b) |
| Assinatura | PKCS12, alias `relogio`; caminho e senha vêm de `RELOGIO_KEYSTORE`/`RELOGIO_KEYSTORE_PASS`; sem essas variáveis, o release sai **sem** assinatura | `build.gradle.kts:20-38` | (b) |
| CI | `android.yml` roda em push na `main` que mexe em `android/**` (ou manual): decodifica `secrets.RELOGIO_KEYSTORE_B64`, roda `gradle assembleRelease`, renomeia para `relogio-nutribot.apk`, sobe como artefato e anexa à release `relogio` com `--clobber`, `--latest=false` | `.github/workflows/android.yml:5-48` | (b) |
| Distribuição | link fixo `github.com/lucasleonardo-hub/nutribot/releases/tag/relogio` (repositório público, então qualquer pessoa baixa o APK; sem token ele não envia nada). Instalação manual com "fontes desconhecidas" | `android.yml:2,47`, `GUIA-PASSO-A-PASSO.md:189` | (b) |
| Atualização no aparelho | nenhuma checagem de versão nova; a pessoa tem que baixar de novo | — | (e) |
| Backup | `android:allowBackup="false"` (o token não vai para o backup do Google) | `AndroidManifest.xml:26` | (b) |
| Testes Android | não há `src/test` nem `src/androidTest` | — | (e) |

### 1.2 Tela e botões (uma Activity, XML)

Layout em `res/layout/activity_main.xml`; textos em `res/values/strings.xml`.

| Elemento | Comportamento | Onde |
|---|---|---|
| Campo "Endereço do bot" | padrão `https://nutribot-5gwk.onrender.com/relogio`; `trim()` ao salvar | `Prefs.kt:9-11`, `activity_main.xml:31-36` |
| Campo "Seu primeiro nome" | precisa bater com o primeiro nome do cadastro (sem acento, minúsculo) | `Prefs.kt:13-15`, `relogio.js:150-152` |
| Campo "Token" | `textVisiblePassword`, guardado em texto puro em `SharedPreferences("relogio")` | `activity_main.xml:58-64`, `Prefs.kt:17-19` |
| Botão 1 "Permissões do Health Connect" | sem HC disponível, abre a Play Store do `com.google.android.apps.healthdata`; senão pede `Leitor.permissoes`; com tudo concedido, roda `SyncWorker.agora` | `MainActivity.kt:39-43,74-82` |
| Botão 2 "Sincronizar agora" | exige url, nome e token; agenda o periódico e dispara o imediato | `MainActivity.kt:83-89` |
| Botão 4 "Localização" (liga/desliga) | pede fina e aproximada, depois "o tempo todo" (Android 10+); um segundo toque desliga só a flag local | `MainActivity.kt:45-57,90-99` |
| Botão 3 "Liberar da economia de bateria" | abre `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` | `MainActivity.kt:100-103` |
| Botão "Ler cupom" | leitor de QR do Google (`GmsBarcodeScanning`, sem permissão de câmera) | `MainActivity.kt:104-108,151-162` |
| WebView (oculto) | abre a página da SEFAZ; aparece depois de 5 s sem nota | `activity_main.xml:98-103`, `Cupom.kt:53` |
| Status | último resultado do sync e da nota, e o estado da localização | `MainActivity.kt:204-209` |
| Entradas por intent | `ACTION_SEND text/plain` (compartilhar link) e `ACTION_VIEW` em 6 hosts de SEFAZ (sat.sef.sc.gov.br, nfce.fazenda.sp.gov.br, sefaz.rs.gov.br, fazenda.pr.gov.br, nfce.fazenda.mg.gov.br, nfce.fazenda.gov.br) | `AndroidManifest.xml:39-56`, `MainActivity.kt:138-148` |
| Justificativa do HC | `ACTION_SHOW_PERMISSIONS_RATIONALE` e o alias `VIEW_PERMISSION_USAGE` (Android 14+), exigidos pelo Health Connect | `AndroidManifest.xml:57-73` |

### 1.3 Permissões declaradas

`AndroidManifest.xml:4-19`:
- `INTERNET`;
- `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`;
- Health Connect: `READ_WEIGHT`, `READ_BODY_FAT`, `READ_LEAN_BODY_MASS`, `READ_SLEEP`, `READ_STEPS`, `READ_TOTAL_CALORIES_BURNED`, `READ_EXERCISE`, `READ_RESTING_HEART_RATE`, `READ_HEART_RATE`, `READ_HEART_RATE_VARIABILITY`, `READ_HEALTH_DATA_IN_BACKGROUND`.

O que **não** é pedido:
- `CAMERA`, porque o leitor de QR do Google não precisa;
- `POST_NOTIFICATIONS`, serviço em primeiro plano e `RECEIVE_BOOT_COMPLETED`, porque o WorkManager religa sozinho;
- no Health Connect: `READ_HEIGHT`, `READ_ACTIVE_CALORIES_BURNED`, `READ_BASAL_METABOLIC_RATE` e `READ_HEALTH_DATA_HISTORY` (leitura de mais de 30 dias antes da concessão; não é necessária com janela de 14 dias).

O `<queries>` cita `com.google.android.apps.healthdata` (`AndroidManifest.xml:21-23`).

### 1.4 O que lê do Health Connect

Leitura em `Leitor.kt:54-179`. Janela: `agora − dias`, com `dias` de 14 no primeiro envio e 3 nos seguintes (`SyncWorker.kt:41`).

| Registro do HC | Como é lido | Vira | Onde | Estado |
|---|---|---|---|---|
| `WeightRecord` | `readRecords` (sem paginação) | `pesos[]` com `t`, `kg` (2 casas), `fonte` = `dataOrigin.packageName` | `Leitor.kt:71-80` | (a) servidor / (b) app |
| `BodyFatRecord` | junta com o peso pelo mesmo **bucket de hora UTC** (`epochSecond/3600`) | `pesos[].gordura` (1 casa) | `Leitor.kt:63-66,76` | (b). Gordura gravada em outra hora, ou sem peso, é descartada |
| `LeanBodyMassRecord` | igual ao de cima | `pesos[].magra` (2 casas) | `Leitor.kt:64,68-70,77` | (b) |
| `SleepSessionRecord` | fases somadas em minutos: LIGHT+SLEEPING→`leve`, DEEP, REM, AWAKE/AWAKE_IN_BED/OUT_OF_BED→`acordado`; **lido duas vezes** (de novo em `:126` para o batimento de repouso) | `sonos[]` | `Leitor.kt:82-101,126` | (a) servidor / (b) app |
| `StepsRecord.COUNT_TOTAL` e `TotalCaloriesBurnedRecord.ENERGY_TOTAL` | `aggregateGroupByPeriod` por dia local (o HC deduplica entre fontes) | `dias[].passos`, `dias[].calorias` | `Leitor.kt:104-114,142-155` | (a)/(b) |
| `RestingHeartRateRecord` | se existir, vale por dia | `dias[].fcRepouso` | `Leitor.kt:118-121` | (b) |
| `HeartRateRecord` | calcula o batimento de repouso: média dos 20% menores **durante a noite mais longa que termina no dia** (mín. 10 amostras); sem sono, os 10% menores do dia; aceita 30–120 bpm | `dias[].fcRepouso` | `Leitor.kt:122-137` | (b) |
| `HeartRateVariabilityRmssdRecord` | média por dia | `dias[].hrv` | `Leitor.kt:138-146` | (b) |
| `ExerciseSessionRecord` | título ou nome em pt-BR do tipo (`nomeDoTipo`, 27 tipos); `fcMedia` pelo agregado `BPM_AVG` dentro da sessão | `treinos[]` | `Leitor.kt:157-170,187-215` | (b) |
| Height, ActiveCaloriesBurned, BasalMetabolicRate, Distance, Nutrition, Hydration, BloodPressure, OxygenSaturation, BodyTemperature, Vo2Max | não lidos | — | — | (e) |

**Apps de origem.** Não há filtro por app no aparelho: tudo que estiver no HC entra, com `fonte` = pacote. O servidor só reconhece Samsung por `/shealth|samsung/i` (`relogio.js:40`) para preferir o peso dele (`progresso.js:194-206`). Pelo GUIA, a cadeia é Galaxy Watch → Samsung Health → Health Connect. Nada no código restringe a isso.

### 1.5 Frequência, retentativas e offline

| Aspecto | Comportamento | Onde | Estado |
|---|---|---|---|
| Periódico | `PeriodicWorkRequest` de 15 min, exige rede `CONNECTED`, backoff LINEAR de 2 min, `UPDATE`, nome único `relogio-periodico` | `SyncWorker.kt:74-80` | (b) |
| Imediato | `OneTimeWork` `relogio-agora`, `REPLACE`, `manual=true` | `SyncWorker.kt:82-89` | (b) |
| Anti-duplo | periódico que cai menos de 60 s depois do último envio é pulado | `SyncWorker.kt:34-36` | (b) |
| Pré-checagens | não configurado → sucesso silencioso; sem HC → falha; falta permissão (fora a de segundo plano) → falha | `SyncWorker.kt:31,37-39` | (b) |
| Retentativa | UnknownHost, SocketTimeout, Connect, HTTP 502 ou 503 → "SEM CONEXÃO", até 5 tentativas; outros erros, até 3; depois `failure` (o periódico continua no próximo ciclo) | `SyncWorker.kt:54-60` | (b) |
| Timeouts HTTP | conexão 30 s, leitura 90 s (Render acordando) | `Envio.kt:13-14` | (b) |
| Offline | sem fila local de envios: cada execução **relê** o HC. Mais de 3 dias sem enviar = os dias antigos nunca saem (ver achado 5). O ponto de localização de uma tentativa que falhou se perde (o próximo ciclo colhe outro) | `SyncWorker.kt:41-47` | (c) |
| Nota de cupom pendente | o sync reagenda o `NotaWorker` se houver nota pendente | `SyncWorker.kt:33` | (b) |

### 1.6 Localização (para `lugares.js`)

| Aspecto | Comportamento | Onde | Estado |
|---|---|---|---|
| Quando | um ponto por sync (15 min), só com a flag ligada e permissão aproximada | `SyncWorker.kt:44-47` | (b) |
| Precisão | primeiro `PRIORITY_HIGH_ACCURACY` por até 25 s (só com permissão fina); se vier nada ou acc > 100 m, `BALANCED` por 10 s e fica o melhor; senão `lastLocation`; ponto com mais de 30 min é descartado | `Local.kt:46-63` | (b) |
| Formato | `{lat, lon (6 casas), acc (m, int ou null), vel (m/s, 1 casa ou null), prov ("alta"/"equilibrada"/"ultima" + "/provedor"), ts (UTC "yyyy-MM-ddTHH:mm:ssZ")}` | `Local.kt:64-72` | (b) |
| Desligar | só local: o servidor não é avisado. Os brutos somem por TTL de 7 dias | `MainActivity.kt:92-96`, `mongo.js:35` | (b) |

### 1.7 Cupom (NFC-e → SEFAZ → `/nota`)

| Etapa | Comportamento | Onde | Estado |
|---|---|---|---|
| Entrada | QR do Google, compartilhar link ou "Abrir com"; aceita link http com chave de 44 dígitos | `MainActivity.kt:138-162`, `Cupom.kt:17,23-24` | (b) |
| Leitura | WebView com JS e DOM storage; a cada 1,5 s lê `document.body.innerText`; nota pronta = regex de "Qtde/Vl. Unit/Código" e mais de 200 caracteres; mostra a página depois de 5 s; reconhece desafio anti-robô (Turnstile etc.) em pt/en; desiste em 150 s | `Cupom.kt:19-21,32-69` | (b) |
| Tela | `FLAG_KEEP_SCREEN_ON` durante a leitura | `MainActivity.kt:168,177` | (b) |
| Envio | `NotaWorker` guarda **uma** nota pendente em `Prefs.notaPendente` (a nova substitui a anterior), rede `CONNECTED`, backoff LINEAR de 1 min; sem rede, até 6 tentativas; outros erros, até 2; depois descarta e pede a foto no grupo | `NotaWorker.kt:28-83` | (b) |
| Diagnóstico | se não virou nota em 150 s, POST `/nota` com `diagnostico:true`, `motivo`, até 4.000 caracteres da página; o servidor guarda em `notas_brutas` (TTL de 3 dias, CPF mascarado) | `Cupom.kt:78-90`, `MainActivity.kt:179-188`, `index.js:99-105`, `mongo.js:37` | (b) |
| URL | trocar `/relogio` por `/nota` na URL do bot | `Cupom.kt:79,94` | (b) |

### 1.8 Esquema JSON do `POST /relogio`

Montado em `Leitor.kt:172-178`, `Local.kt:65-72` e `SyncWorker.kt:42-47`; lido em `relogio.js:47-116,147-192` e `index.js:71-79`. Limite do corpo: 4 MB (`index.js:71`).

Cabeçalhos:

```
POST {url}/relogio
Content-Type: application/json; charset=utf-8
x-relogio-token: <token da pessoa em RELOGIO_TOKENS>
User-Agent: NutriBot-Relogio/1.6
```

Corpo:

```jsonc
{
  "pessoa": "lucas",                    // primeiro nome; o servidor tira acento e põe em minúsculas
  "app": "relogio/1.6",
  "fuso": "America/Sao_Paulo",          // ZoneId do aparelho; o servidor USA este fuso em vez do do perfil (relogio.js:155)
  "enviadoEm": "2026-10-13T12:00:00Z",  // ignorado pelo servidor
  "pesos": [
    { "t": "ISO-instante", "kg": 77.14, "gordura": 18.2, "magra": 60.3, "fonte": "com.sec.android.app.shealth" }
    // gordura e magra são opcionais; o servidor também aceitaria "altura" (o app não manda)
  ],
  "sonos": [
    { "inicio": "ISO", "fim": "ISO", "leve": 240, "profundo": 60, "rem": 90, "acordado": 25, "fonte": "pkg" }  // em minutos
  ],
  "dias": [
    { "dia": "2026-10-13", "passos": 8123, "calorias": 2650, "fcRepouso": 54, "hrv": 41 }  // todos opcionais, exceto "dia"
  ],
  "treinos": [
    { "inicio": "ISO", "fim": "ISO", "tipo": "Musculação", "fonte": "pkg", "fcMedia": 118 }
    // o servidor aceitaria "nome", "min" e "kcal" (o app não manda kcal)
  ],
  "locais": [                           // só com a localização ligada; zero ou um item
    { "lat": -27.6, "lon": -48.5, "acc": 12, "vel": 0.0, "prov": "alta/fused", "ts": "2026-10-13T11:59:40Z" }
  ]
}
```

Validação e normalização no servidor (`relogio.js:47-116`):

**Pesos**
- descarta se não tiver data ou se o peso estiver fora de 25–400 kg;
- dia e hora calculados no fuso;
- um por dia: Samsung vence; depois a primeira da manhã (04:00–11:00); depois a mais cedo (`progresso.js:194-206`).

**Sonos**
- o dia é o do **fim** da sessão;
- a sessão mais longa define deitou/levantou;
- várias sessões no mesmo dia somam;
- sem fases, a duração é deitado − acordado e entra tudo como "leve".

**Dias**
- `passos` fica com o maior valor;
- `calorias` só se > 300;
- `fcRepouso` só se entre 30 e 120;
- `hrv` só se > 0.

**Treinos**
- o dia é o da hora de início;
- a duração vem de `fim − inicio`;
- duplicata = mesma hora **e** mesmo nome.

**Locais** (`lugares.js:491-506`)
- no máximo os últimos 200;
- descarta lat/lon inválida e acc > 500 m;
- deduplica pelo índice único `(jid, ts)` (`mongo.js:34`).

Resposta 200:

```jsonc
{
  "ok": true,
  "pessoa": "Pessoa A",
  "recebidos": { "pesos": 2, "sonos": 1, "dias": 3, "treinos": 1 },
  "resumo": "8123 passos hoje · sono 2026-10-13: 7h10 · peso 2026-10-13: XX,X kg · em casa desde 22:10"
}
```

O app mostra `resumo` (`SyncWorker.kt:49-52`).

Erros:
- 503 se `RELOGIO_TOKENS` estiver vazio;
- 401 para token ou pessoa inválidos;
- 404 sem perfil com aquele primeiro nome;
- 500 para outras falhas.

Todos no formato `{ok:false, erro}` (`relogio.js:148-153`, `index.js:75-78`). JSON malformado cai no 400 padrão do Express, em HTML.

**`POST /nota`** (`Cupom.kt:93-103`, `index.js:82-138`): corpo `{pessoa, app, chave|null, url, texto (≤60.000)}`, ou o diagnóstico `{…, diagnostico:true, motivo, texto (≤4.000)}`. O servidor responde **200 na hora** (`{ok, recebido, resumo}`) e processa em segundo plano, com teto de 5 min (`index.js:112,124`). O resultado vai para o grupo do WhatsApp, não para o app. Recusas: 401, 404 e 400 (texto com menos de 50 caracteres).

### 1.9 Servidor do relógio (`relogio.js`)

| Função | O que faz | Onde | Estado |
|---|---|---|---|
| `tokensRelogio` | lê `RELOGIO_TOKENS="nome=token,…"` (nome sem acento) | `relogio.js:19-27` | (a) `hoje-mes.test.mjs:12` |
| Autenticação | `tokens[pessoa] !== String(token)` (comparação simples, sem tempo constante, sem limite de tentativas) | `relogio.js:150-151` | (b) |
| Achar o perfil | primeiro nome normalizado; **dois perfis com o mesmo primeiro nome colidem** (`find` pega o primeiro) | `relogio.js:152` | (b) |
| `normalizarEnvio` | ver 1.8 | `relogio.js:47-116` | (a) `hoje-mes.test.mjs:290`, `progresso.test.mjs:166` |
| `fundir` | por dia, o novo vence, exceto pesagem: mesma hora → substitui (pode trazer a gordura que faltava); hora diferente → `preferirPesagem`; corta em 90 dias (`DIAS_GUARDADOS`) | `relogio.js:14,125-134` | (a) `progresso.test.mjs:737` |
| `receberEnvio` | `saude_relogio` com `_id = perfil.jids[0]`: `{nome, pesos, sonos, atividades, texto, ultimoEnvio, app, recebidos}`; chama `aplicarDadosSaude`, `receberLocais` e, ao sair de mercado, `perguntarCompra` (fora do caminho da resposta) | `relogio.js:147-192` | (b) |
| `textoRelogio` | o texto do dossiê só vale se `ultimoEnvio` tiver no máximo 36 h (`FRESCO_H`); depois disso a planilha volta a valer | `relogio.js:15,195-201` | (b) |
| `situacaoRelogio` | dados do `!relogio` (último envio, passos e gasto de hoje, treinos, última noite, último peso) | `relogio.js:204-219`, `comandos.js:395-418` | (b) |

**Risco.** O `_id` de `saude_relogio` é `jids[0]`. Se a ordem de `jids` mudar (número × LID; `salvarPerfil` faz união em `mongo.js:129`), o histórico fica órfão sob o jid antigo.

### 1.10 `saude.js` — o que o relógio vira

`aplicarDadosSaude(perfil, dados, {hoje, fonteNome, pastaId})` (`saude.js:417-448`) é o caminho comum do app e da planilha:

1. **Texto do dossiê** (`resumoSaude`, `saude.js:222-331`): 14 dias de peso e gordura (marca as pesagens fora da manhã), 14 noites, RECUPERAÇÃO (batimento de repouso e HRV contra a média de 14 dias, `recuperacao`, `saude.js:185-220`) e 7 dias de atividade (sem os treinos vindos do Hevy quando a pessoa tem Hevy). Status (a): `hoje-mes.test.mjs:21,88`.
2. **Pesagens**: todo peso dos últimos 60 dias (contados da última pesagem) vira `registrarPesagem({fonte:'relogio', hora})`. Status (b). Conflito no achado 3.
3. **`perfil.peso`**: acompanha a última medição se ela for de dia ≥ `atualizacoes.peso` e a diferença for de 0,1 kg ou mais (`saude.js:431-435`). Status (b).
4. **`perfil.relogio`** (`indicadoresRelogio`, `saude.js:337-387`): linha curta para todo prompt, mais `peso`, `gordura`, `ultimaNoite`, `sonoMedioMin`, `deitaMedia`, `levantaMedia`, `passosMedia`, `treinos7d`, `fcRepouso`, `recuperacao`, `hrv` e `gastos{dia:kcal}` de 30 dias (usado por meta, gráfico e previsão). Soma o gasto de atividades fixas confirmadas (`somarGastosExtras`, `saude.js:440`). Status (a) para a função pura, (b) para a gravação.
5. **`Nutri-Saude.md`** na pasta da pessoa no Drive (`saude.js:443-446`). Status (b).

### 1.11 `lugares.js` — localização

| Parte | Comportamento | Onde | Estado |
|---|---|---|---|
| `receberLocais` | insere em `locais_brutos` (`{jid, ts, dia, lat, lon, acc, vel, prov, em}`, TTL de 7 dias); liga `perfil.lugaresAtivo`; recalcula (`atualizarLugares` sem OSM); calcula a transição `saiu_de_compra` comparando com `perfil.ultimaSituacao`; classifica pelo OSM em segundo plano | `lugares.js:491-531` | (b) |
| Agrupamento | raio de 150 m, parada de 20 min ou mais (com +10 min de crédito), buraco de 3 h fecha a estadia, `vel > 2 m/s` = em movimento | `lugares.js:9-15,60-107` | (a) `lugares.test.mjs:34,61,263` |
| Casa e trabalho aprendidos | casa = onde mais dorme (estadias de 4 h ou mais começando à noite ou terminando de manhã; 2+ noites); trabalho = mais dias úteis em horário comercial (≥3); o que foi marcado à mão manda | `lugares.js:110-166` | (a) `lugares.test.mjs:67,153,177` |
| `ondeMora` | casa com bairro e 3+ noites vira FATO no prompt e na reescrita das notas | `lugares.js:788-793`, `dia.js:211` | (a) `lugares.test.mjs:5` |
| Tipo do lugar | Nominatim (bairro, cidade, rua) → Photon (POIs + "universidade/shopping/hospital") → Overpass (3 espelhos) se faltar; escolha por plausibilidade de uso; cache `osm_cache` de 30 dias (1 h se incompleto); até 3 por rodada | `lugares.js:169-486,553-589` | (a) partes puras / (b) rede |
| `descreverSituacao`/`situacaoAtual` | casa, lugar, fora ou sem_sinal (último ponto vale 45 min); "desde" | `lugares.js:655-681,737-742` | (a) `lugares.test.mjs:132` |
| Persistência | `visitas` (índice único jid+inicio, janela de leitura de 90 dias), `perfil.lugares` (máx. 25), `perfil.ultimaSituacao`, `perfil.mercados` (cache de 14 dias) | `lugares.js:595-652,861-886` | (b) |
| Linha do Tempo do Google | JSON na pasta do Drive da pessoa vira visitas (`origem:'timeline'`, 180 dias) | `lugares.js:996-1046`, `pessoas.js:83-98` | (a) `lerTimeline` / (b) importação |

**Divergência com o GUIA** (`:220`): o guia fala em "Overpass + Nominatim". O código usa Nominatim e Photon primeiro, com Overpass só como reserva (`lugares.js:452-473`).

### 1.12 `despensa.js` — cupom

| Caminho | Onde | Estado |
|---|---|---|
| `/nota` do app → `receberNotaDoApp`: `parsearTextoNfce` (modelo SC/SP/RS/PR/MG); se não achar itens, `ia.extrairItensTexto` e guarda o texto cru em `notas_brutas` | `despensa.js:114-152` | (a) parser `despensa.test.mjs:47` / (b) fluxo |
| Foto do cupom no grupo → `lerQr` (jsqr + jimp) + `ia.extrairItensCupom` | `mensagens.js:749-766`, `despensa.js:38-53` | (a) `lerQr` / (b) fluxo |
| Texto colado ou PDF da nota | `mensagens.js:688-705` | (b) |
| Consulta à SEFAZ pelo servidor (`testarConsultaSefaz`) | só no modo de teste do admin no privado; nada é gravado | `mensagens.js:513-533`, `despensa.js:96-108` | (b) |
| `padronizarItens`: IA leve, mais TACO (in natura) ou OFF por código de barras ou nome (até 10 buscas por nome por nota), e filtro de não-alimento | `despensa.js:189-241` | (a) `nomeBate`, `pareceNaoAlimento` / (b) resto |
| `registrarNota`: dedup por `chave` com `findOne` e depois `insertOne`; **sem índice único em `notas.chave`** (grep em `mongo.js` não acha), então duas notas iguais em paralelo duplicam. Nota sem chave (foto sem QR, texto colado) nunca é deduplicada | `despensa.js:246-255` | (c) |
| `perguntarCompra` (saiu de mercado ou padaria depois de 10 min ou mais; 1 por dia; não pergunta se houve nota nas últimas 3 h) | `despensa.js:388-404` | (a) `transicaoDeSaida` / (b) envio |

---

## 2. Google Drive

### 2.1 Credenciais, cliente e tratamento de erro

| Item | Comportamento | Onde | Estado |
|---|---|---|---|
| Credencial | `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON cru ou base64) ou `GOOGLE_SERVICE_ACCOUNT_FILE` (padrão `./service-account.json`); passada a `GoogleAuth({credentials})`, que aceita conta de serviço **ou** `authorized_user` | `drive.js:29-42,47` | (b) |
| Tipo em uso | **OAuth de usuário** (`type: authorized_user` + refresh token) gerado por `npm run drive-auth` com cliente OAuth próprio "App para computador", porta 8085; conta de serviço não grava em Drive pessoal (`storageQuotaExceeded`) | `drive-auth.js:1-75`, `GUIA:52,65-76` | (b) |
| Escopos | `drive` (completo) e `calendar.readonly`; o `drive-auth` pede também `userinfo.email` e `openid` | `drive.js:22`, `drive-auth.js:28-33` | (b) |
| Sheets | mesma credencial (`autenticacaoGoogle`) para a planilha de saúde | `drive.js:79-82`, `saude.js:27-37` | (b) |
| Pasta raiz | `DRIVE_FOLDER_ID` (obrigatória; sem ela `iniciarDrive` lança, e o boot falha em `index.js:226`) | `drive.js:23,46` | (b) |
| Timeout | global de 25 s para o googleapis (`DRIVE_TIMEOUT_MS`) | `drive.js:48` | (b) |
| Pastas | resolvidas por nome com cache em memória (Promise, para não criar duas vezes) | `drive.js:86-124` | (b) |
| Escrita | `salvarEmPasta`: **lista para achar e depois `update` ou `create`** (2 chamadas por gravação); fila por arquivo serializa as escritas | `drive.js:136-168` | (b) |
| Saúde da credencial | `verificarCredencial` diário às 07:20; avisa o admin no WhatsApp (`invalid_grant`, bloqueio de escopo, cota) | `drive.js:62-76`, `index.js:211-216,330` | (b) |
| Erros | quase sempre `.catch(console.error)`; a falha do diário avisa o grupo (`dia.js:52-55`); não há retentativa | vários | (b) |
| Publicação do app OAuth | `/` e `/privacidade` existem para cumprir a exigência do Google | `paginas.js:1-95`, `index.js:61-64` | (b) |

### 2.2 Inventário de arquivos e pastas no Drive

Raiz = `DRIVE_FOLDER_ID`. Mapa geral no comentário de `drive.js:2-14`, que está incompleto: faltam `Nutri-Aprendizados.md`, `Nutri-Plano.md` e `Nutri-Reflexoes.md`.

#### Globais

| Caminho | Formato | Quem escreve e quando | Quem lê | Cópia no Mongo | Fonte oficial sugerida |
|---|---|---|---|---|---|
| `Diario/AAAA-MM-DD.md` | .md (Obsidian, wikilinks) | `gravarDiario` com debounce durante o dia e no desligamento (`dia.js:59-64`, `index.js:352`) | ninguém no código (Obsidian) | `memoria` guarda **só o dia corrente** (`mongo.js:147-153`); trechos indexados na memória vetorial | Mongo (falta guardar a conversa histórica; hoje o Drive é o único arquivo completo) |
| `Resumos/AAAA-MM-DD.md` | .md | `fecharDia` às 23:59 (`dia.js:162-167`) | **`fecharSemana` relê** os 7 do domingo (`dia.js:328-331`) | não há coleção de resumos (só a memória vetorial) | Mongo (hoje o Drive é dependência de leitura) |
| `Resumos/Semana-AAAA-Www.md` | .md | `fecharSemana` (`dia.js:450-455`) | ninguém | não | Mongo |
| `Resumos/Mes-AAAA-MM.md` | .md | `fecharMes`, dia 1 às 08:00 (`dia.js:539-543`) | ninguém | não | Mongo |
| `Perfis/Nutri.md` | .md | `evoluirPersona` toda noite (`dia.js:282-286`) | ninguém | `persona` + `persona_historico` (`mongo.js:157-169`) | Mongo |
| `Perfis/Nutri-Momentos.md` | .md (só acrescenta; ler, alterar, gravar) | toda noite (`dia.js:177-178`) | ninguém | `momentos` (`mongo.js:173-183`) | Mongo |
| `Perfis/Nutri-Diario.md` | .md (só acrescenta) | toda noite (`dia.js:237-238`) | ninguém | `diario_nutri` (`mongo.js:323-330`) | Mongo |
| `Perfis/Nutri-Aprendizados.md` | .md | quando há correção ou contestação (`dia.js:255-260`) | ninguém | `aprendizados` + `_historico` (`mongo.js:258-268`) | Mongo |
| `Conhecimento/<id>.md` | .md com frontmatter | no boot e na revisão mensal ou `!estudar` (`conhecimento.js:57-60`) | ninguém (o boot lê de `./conhecimento/*.md` do repositório, `conhecimento.js:37-53`) | `conhecimento` | repositório (semente) + Mongo (versão viva) |
| `Conhecimento/Pesquisas/<id>.md` | .md | pesquisa no meio da conversa (`conhecimento.js:74-82`) | ninguém | `conhecimento` | Mongo |
| `Logs/AAAA-MM-DD.md` | .md (ler, alterar, gravar) | fechamento do dia, estudo (`drive.js:237-247`, `dia.js:303,558`) | ninguém | não | logs do Render; dispensável |

#### Por pessoa — pasta `<Nome>/` na raiz

A pasta é achada por nome em `pessoas.js:42-81` (primeiro nome e mais uma parte do nome; em caso de empate, cria uma pasta nova) e o id fica gravado em `perfil.pastaId` e `perfil.pastaNome`.

| Arquivo | Formato | Quem escreve e quando | Quem lê | Cópia no Mongo | Fonte oficial sugerida |
|---|---|---|---|---|---|
| `Nutri-Notas.md` | .md | `salvarNotas` toda noite (`pessoas.js:212-219`, `dia.js:215`) | **`sincronizar` relê a cada 10 min e manda sobre o cache** (`pessoas.js:147-150`); vai para o dossiê | `perfil.notas` | **conflito hoje**: edição à mão no Drive vale até a próxima reescrita noturna, que parte dela. Decidir (Mongo oficial + editor no app?) |
| `Nutri-Ficha.md` | .md (`mdPerfil`) | cadastro (`mensagens.js:684`), ATUALIZAR (`mensagens.js:1147`), toda noite (`dia.js:222`), documento novo (`pessoas.js:261`) | ninguém (`Nutri-*` é ignorado no dossiê, `pessoas.js:152`) | derivado de `perfis` | Mongo (`perfis`) |
| `Nutri-Saude.md` | .md | **a cada POST `/relogio`** (15 min) e quando a planilha muda (`saude.js:443-446`) | ninguém | `saude_relogio.texto` | Mongo (`saude_relogio`) |
| `Nutri-Plano.md` | .md | `!plano` e o aceite de sexta (`comandos.js:129-130`) | ninguém | não guarda o texto do plano (verificar) | Mongo |
| `Nutri-Reflexoes.md` | .md | domingo (`reflexao.js:164-174`) | ninguém | `reflexoes` + `perfil.reflexao`/`hipoteses` | Mongo |
| Documentos da pessoa (PDF, imagem, Google Docs exportado como texto, Google Sheets como CSV, .md, .txt, .csv, .json) | vários | **a pessoa**, à mão | `textoDoArquivo` (PDF e imagem pelo Gemini) com cache `arquivos_pessoa` por `id:modifiedTime` (`pessoas.js:100-129`); `analisarDocumento` → `documentos_pessoa`, `perfil.documentos`, pesagem `fonte:'documento'` (`pessoas.js:233-267`) | texto e extração | **Drive** (é a entrada) |
| Planilha de saúde (Google Sheets do "Health Data Export"; nome com saude, health, galaxy, watch ou relógio) | Sheets, abas Activity / Body Measurements / Sleep | o app *Health Data Export* (`com.teqxnology.healthdataexport`), exportação a cada 24 h | `sincronizarSaude` pela Sheets API, cache por `modifiedTime` (`saude.js:22,396-410`), **só quando não houver envio do app nas últimas 36 h** (`pessoas.js:142-158`) | `arquivos_pessoa` + o efeito de `aplicarDadosSaude` | legado; a substituir pelo app |
| Linha do Tempo (`*timeline*.json`) | JSON (até 80 MB) | a pessoa | `importarTimelineDoArquivo` (`pessoas.js:83-98`) | `visitas`, `perfil.lugares` | Mongo depois de importar |

**Planilha "Health Data Export".** Ainda funciona, status (b) e (a) para `interpretarAbas`. Entra em ação quando `textoRelogio` volta `null`: sem envio do app há mais de 36 h, ou pessoa sem app.

Efeito colateral: quando ela é lida, também grava pesagens `fonte:'relogio'` e reescreve `perfil.relogio`. Se o app voltar depois, as duas fontes se alternam por "última gravação vence".

Inconsistência possível: um texto de planilha já guardado em cache não é removido de `st.textos` quando o app volta a ficar fresco (`pessoas.js:154-156` só pula a leitura nova). O dossiê pode carregar os dois blocos "DADOS DO RELÓGIO". Status (c).

### 2.3 O que está duplicado entre Drive e Mongo

- **Duplicado (Mongo é a verdade, Drive é espelho para Obsidian):** persona, momentos, diário da Nutri, aprendizados, conhecimento, ficha, saúde, reflexões.
- **Só no Drive:** histórico completo da conversa (Diario), resumos diário/semanal/mensal, plano da semana, logs.
- **Nos dois sentidos:** `Nutri-Notas.md`.
- **Só entrada:** documentos da pessoa, planilha de saúde, Timeline.

**Recomendação para o app:** o app lê **só do Mongo**, por API. O Drive vira (i) saída para o Obsidian e (ii) caixa de entrada de documentos. Para isso, falta gravar no Mongo os resumos (dia, semana, mês), o plano e o histórico da conversa. Também é preciso decidir quem manda em `Nutri-Notas.md`.

---

## 3. Uma tabela por integração (campos do item 4)

### 3.1 App Relógio → `POST /relogio` (Health Connect)

| Campo | Valor |
|---|---|
| Fonte | Health Connect no celular da pessoa (na prática, Galaxy Watch → Samsung Health → HC) |
| Tipos | peso, gordura, massa magra, sono por fase, passos, gasto total, batimento de repouso (calculado no aparelho), HRV, sessões de exercício com FC média, ponto de localização |
| Perfil dono | o campo `pessoa` (primeiro nome) mais o token; o perfil é o primeiro com aquele primeiro nome (`relogio.js:152`) |
| Autenticação | `x-relogio-token`, igual ao token da pessoa em `RELOGIO_TOKENS`; HTTPS do Render |
| Mecanismo | push do app (WorkManager) |
| Frequência | 15 min com rede, mais o botão manual; janela de 14 dias no primeiro envio e 3 depois |
| Validação | faixas de 1.8; fuso do aparelho |
| Idempotência | chave estável = dia (pesos, sonos, atividades) e `(jid, ts)` nos locais; reenviar não duplica (o app conta com isso, `Leitor.kt:53`) |
| Conflito | dentro do relógio: Samsung > manhã > mais cedo; sonos e atividades: "o novo vence" por dia. **Com outras fontes de peso** (chat, documento, planilha): última gravação em `pesagens` vence, e o relógio regrava 60 dias a cada envio |
| Falhas | o app tenta de novo (1.5); servidor: Drive e pesagens com `.catch`; a resposta só sai depois de Drive e Mongo (`relogio.js:161-168`) |
| Origem e data | `saude_relogio.app`, `ultimoEnvio`, `recebidos`; `fonte` = pacote em cada item; `pesagens.fonte='relogio'` + `hora` |
| Coleções e arquivos | `saude_relogio`, `pesagens`, `perfis` (`peso`, `atualizacoes.peso`, `relogio`, `lugares*`, `ultimaSituacao`), `locais_brutos`, `visitas`, `osm_cache`; Drive `<Nome>/Nutri-Saude.md` |
| Estado | (a) normalização e fusão; (b) recebimento, efeitos e app; (c) preenchimento de lacunas, conflito de fontes |

### 3.2 App Relógio → `POST /nota` (NFC-e)

| Campo | Valor |
|---|---|
| Fonte | página da SEFAZ aberta no WebView do celular (innerText) |
| Tipos | itens (descrição, código, qtd, unidade, valores), loja, data de emissão; chave de 44 dígitos |
| Perfil dono | `pessoa` + token (mesmo esquema do relógio) |
| Autenticação | `x-relogio-token`, mesma comparação (`index.js:87-93`) |
| Mecanismo | push (NotaWorker); o servidor responde 200 e processa em segundo plano |
| Frequência | sob demanda |
| Validação | texto com 50 caracteres ou mais; parser e, se falhar, IA; filtro de não-alimento |
| Idempotência | `notas.chave` com `findOne` (sem índice único; nota sem chave nunca é deduplicada); despensa por `(jid, k)` com upsert que **soma** quantidade (reenvio da mesma nota sem chave = quantidade em dobro) |
| Conflito | não se aplica (soma) |
| Falhas | app: 6 ou 2 tentativas; servidor: falha avisa o grupo pedindo a foto (`index.js:125-133`); texto cru 3 dias em `notas_brutas` |
| Origem e data | `notas.origem='app'`, `dia` (emissão ou hoje), `criadoEm` |
| Coleções | `notas`, `despensa`, `notas_brutas`, `produtos` (cache OFF) |
| Estado | (a) parser e QR; (b) fluxo; (c) dedup |

### 3.3 Google Drive (pasta da pessoa e "cérebro")

| Campo | Valor |
|---|---|
| Fonte | Drive da conta dona (`DRIVE_FOLDER_ID`) |
| Tipos | ver 2.2 |
| Perfil dono | pasta `<Nome>` achada por nome e fixada em `perfil.pastaId` |
| Autenticação | OAuth de usuário (refresh token), escopo `drive` completo |
| Mecanismo | pull (lista a pasta a cada 10 min sob demanda, `pessoas.js:18,132-176`) + push (escritas) |
| Frequência | leitura ao montar o dossiê (mensagem, cobrança, cron); escrita noturna e a cada envio do relógio |
| Validação | cache por `id:modifiedTime`; PDF longo cortado e guardado (`pessoas.js:118-123`) |
| Idempotência | escrita por nome (lista → update ou create); fila por arquivo |
| Conflito | Notas: o Drive vence a leitura, a reescrita noturna parte do Drive; documentos: versão por `modifiedTime` |
| Falhas | log; saúde diária da credencial; sem retentativa |
| Origem e data | frontmatter com `atualizado`; `arquivos_pessoa.salvoEm` |
| Coleções | `arquivos_pessoa`, `documentos_pessoa`, `perfis.pastaId/notas/documentos`, `pesagens` (`fonte:'documento'`) |
| Estado | (b) tudo de Drive; (a) só os formatadores puros indiretamente |

### 3.4 Planilha "Health Data Export" (Sheets API)

| Campo | Valor |
|---|---|
| Fonte | Google Sheets na pasta da pessoa, gerado pelo app de terceiros |
| Tipos | peso, gordura, altura, magra; sono por fase; passos, gasto total, exercícios |
| Perfil dono | a pasta onde está |
| Autenticação | mesma credencial do Drive |
| Mecanismo | pull |
| Frequência | quando `modifiedTime` muda (a exportação é a cada 24 h) e não há push fresco do app |
| Validação | colunas por prefixo do nome; número com vírgula; altura no formato `data=valor` (`saude.js:42-57`) |
| Idempotência | cache em `arquivos_pessoa` por `id:modifiedTime`; pesagens upsert por dia |
| Conflito | igual a 3.1 (mesmos efeitos e `fonte:'relogio'`) |
| Falhas | log; o dossiê segue sem o bloco |
| Coleções | `arquivos_pessoa`, `pesagens`, `perfis`, Drive `Nutri-Saude.md` |
| Estado | (a) `interpretarAbas`/`resumoSaude`; (b) leitura; legado |

### 3.5 Hevy (`treino.js`)

| Campo | Valor |
|---|---|
| Fonte | `https://api.hevyapp.com/v1` (Hevy Pro) |
| Tipos | treinos (título, início, fim, exercícios com séries: carga, reps, RPE, tipo), catálogo de exercícios (grupo muscular primário e secundários) |
| Perfil dono | `HEVY_CHAVES="nome=chave,…"` pelo primeiro nome (`treino.js:16-27`) |
| Autenticação | cabeçalho `api-key` (`treino.js:30`) |
| Mecanismo | pull dentro de `enriquecerPerfis` (mensagem, cobrança, cron) e das ferramentas |
| Frequência | no máximo 1 vez por hora por pessoa (`HEVY_SYNC_MIN`, mapa em memória que zera no restart; `perfis.js:16-23`); até 6 páginas de 10, para ao passar de 28 dias (`treino.js:64-82`); catálogo a cada 7 dias (`treino.js:46-59`) |
| Validação | séries de aquecimento e vazias saem da análise (`treino.js:103`) |
| Idempotência | `treinos` com `replaceOne({_id: workout.id})`; treino apagado no Hevy **continua** no Mongo |
| Conflito | com o relógio: no texto, treinos do Hevy saem da linha do relógio (`saude.js:309,370`); em `contexto.js:170-177` a sessão é unida por proximidade de 45 min |
| Falhas | `treinoDe` nunca lança, só loga (`treino.js:230-243`) |
| Origem e data | `treinos.salvoEm`, `inicio` |
| Coleções | `treinos`, `hevy_exercicios` |
| Estado | (b) `treino.js` (nenhum teste importa `treino.js`); (a) análises em `contexto.js` (`lugares.test.mjs:328,370,414`) |

### 3.6 Google Agenda (`agenda.js`)

| Campo | Valor |
|---|---|
| Fonte | Calendar API (todas as agendas visíveis da conta do Drive) e/ou URLs iCal secretas (`AGENDA_ICS_URL`) |
| Tipos | eventos (título, descrição de até 200 caracteres, início, fim, dia todo, convidados, recorrência, local, nome da agenda) → tipo (aula, trabalho, reunião, treino, refeição, saúde, viagem) |
| Perfil dono | **uma pessoa só**: `AGENDA_DONO` (primeiro nome) (`agenda.js:20-25`); só entra na conversa com ela |
| Autenticação | `calendar.readonly` da credencial do Drive; iCal sem autenticação (a URL é o segredo) |
| Mecanismo | pull |
| Frequência | cache de 15 min em memória (`AGENDA_CACHE_MIN`), 3 a 14 dias à frente |
| Validação | ignora feriados, aniversários e feeds de entretenimento (`AGENDA_IGNORAR`); sem escopo, desliga a API até o restart |
| Idempotência | dedup `inicio|título`; remove "Busy" sobreposto |
| Falhas | agenda isolada que falha não derruba as outras; `agendaDe` nunca lança |
| Coleções | nenhuma (só memória) |
| Estado | (a) classificação, bloco e normalização (`hoje-mes.test.mjs:792-858`); (b) rede |

### 3.7 Clima (`clima.js`)

Open-Meteo (geocoding e forecast), grátis e sem chave. Usa `perfil.cidade` e `perfil.fuso`. Pull ao montar a resposta, com prazo de 5 s (`mensagens.js:819`).

- Cache das coordenadas na coleção `cidades`, para sempre (`clima.js:76-99`).
- Cache da previsão em memória por 30 min; se a previsão falhar, usa o cache velho (`clima.js:104-137`).
- Serve para dar estação, tempo agora, hoje e amanhã ao prompt.
- Estado: (a) partes puras (`hoje-mes.test.mjs:874,891`); (b) rede.

### 3.8 Open Food Facts (`off.js`)

`world.openfoodfacts.org/api/v2/product/<ean>` e `search.openfoodfacts.org/search`, sem chave, com User-Agent próprio. Pull.

Usado:
- quando a mensagem traz código de barras (`rotulosPara`, `mensagens.js:880`);
- na linha `PRODUTO:` da IA (`mensagens.js:978`);
- na despensa (`despensa.js:224-229`).

Cache de 30 dias na coleção `produtos` (`off.js:56-63`). Estado: (a) partes puras (`hoje-mes.test.mjs:13`); (b) rede.

### 3.9 Pesquisa (`pesquisa.js`)

- PubMed E-utilities: revisões, meta-análises e diretrizes desde 2018.
- Wikipedia em pt.
- Brave Search opcional (`BRAVE_API_KEY`, que **não** está no `.env.example`).

Pull, usado na revisão mensal do conhecimento (`conhecimento.js:192`) e no `PESQUISAR` da conversa (`mensagens.js:947`). Os resultados viram `Conhecimento/Pesquisas/*.md` + `conhecimento`. Estado: (b), sem testes.

### 3.10 Voz (`voz.js`)

- Gemini TTS (`gemini-3.8-flash-lite-tts`, `gemini-3.8-flash-tts`; voz `Sulafat`), com rodízio das chaves `GEMINI_API_KEY(S)`.
- Conferência por transcrição com `gemini-3.5-flash-lite` para ver se a instrução de estilo vazou.
- Reserva: `msedge-tts` (serviço de leitura do Edge, não oficial).
- `ffmpeg-static` converte para ogg/opus.

Disparos: notas de voz programadas (segunda 08:00, sexta 18:00; `index.js:318-319`, `dia.js:482`) e pedidos na conversa (`mensagens.js:1179`). Estado: (a) partes puras (`hoje-mes.test.mjs:263,593,620`); (b) síntese.

### 3.11 Outras citadas

- **`cobranca.js`**: não é integração externa. É um cron de 10 min (`index.js:304`) que, para cada perfil, decide cobrar refeição atrasada a partir do horário habitual aprendido, do Google Agenda (`ocupadoAgora`) e da localização (restaurante ou academia), e gera o texto pelo Gemini. Estado (b), sem teste do módulo; guardas em `consciencia.js` testadas.
- **`graficos.js`**: QuickChart (`QUICKCHART_URL`, grátis) gera PNG. Estado (a) `configGrafico` (`hoje-mes.test.mjs:244`); (b) render.
- **`paginas.js`**: só HTML estático (início e privacidade). **Não é API.**
- **`skill-copiar-bot/`**: `SKILL.md` + `persona.template.md`, instruções para o Claude Code montar uma cópia do bot. **Divergência:** descreve o relógio só pelo caminho antigo, "Health Data Export → planilha" (`SKILL.md:31,200-203`), sem o app Relógio nem `RELOGIO_TOKENS`.
- **IAs** (fora do foco): Gemini (`gemini.js`) e reservas Cohere, OpenRouter, Groq e Hugging Face (`reservas.js:1-30`), todas no nível gratuito.

---

## 4. Rotas HTTP existentes

Todas em `index.js`. Nenhuma está em `paginas.js`.

| Rota | Autenticação | O que faz | Linha |
|---|---|---|---|
| `GET /ping` | nenhuma | "pong" (keepalive) | 60 |
| `GET /`, `/privacidade` | nenhuma | HTML de `paginas.js` | 63-64 |
| `GET /estado` | **nenhuma** | `{status, dia, mensagensHoje, grupo}`: expõe o JID do grupo; usado pelo `vigia.yml` | 65-67 |
| `POST /relogio` | `x-relogio-token` | ver 1.8 | 71-79 |
| `GET /relogio` | nenhuma | texto de ajuda | 80 |
| `POST /nota` | `x-relogio-token` | ver 1.8 | 82-138 |
| `GET /qr` | **nenhuma** | QR de pareamento do WhatsApp quando desconectado | 139-155 |
| `GET /status?token=` | `ADMIN_TOKEN` por query | status técnico, uso do Gemini, modelos, reservas | 168-184 |
| `GET /logout?token=` | `ADMIN_TOKEN` por query | desvincula o WhatsApp | 186-195 |

**Leitura de dados para o app:** status **(e)**. As funções que já montam as visões existem e retornam texto ou objeto, mas nada as expõe por HTTP:
- `situacaoRelogio` (`relogio.js:204`);
- `visaoDe`/`progressoDe` (`acompanhamento.js`);
- `contextoLugares`/`lugaresZap` (`lugares.js:761,804`);
- `listarDespensa`/`despensaZap` (`despensa.js:288,359`);
- `refeicoesDesde`, `pesagensDesde` (`mongo.js:292,317`);
- `treinoDe` (`treino.js:230`);
- `configGrafico` (`graficos.js:21`).

Também não há rota de **escrita** do app para refeição, peso, correção ou exclusão. Hoje tudo isso entra pelo WhatsApp (`mensagens.js`, `comandos.js`).

---

## 5. Divergências entre o GUIA ou os comentários e o código

| # | Documento | O que diz | O que o código faz |
|---|---|---|---|
| 1 | `drive.js:12` | `Nutri-Saude.md` "regerado quando a planilha muda" | também a **cada POST `/relogio`** (`saude.js:443`) |
| 2 | `drive.js:2-14` | lista de arquivos | faltam `Perfis/Nutri-Aprendizados.md`, `<Nome>/Nutri-Plano.md`, `<Nome>/Nutri-Reflexoes.md` |
| 3 | `GUIA:220` | tipo do lugar por "Overpass + Nominatim" | Nominatim → Photon → Overpass como reserva (`lugares.js:441-473`) |
| 4 | `SKILL.md:31,200-203` | relógio = Health Data Export + planilha | o caminho recomendado é o app Relógio (`GUIA:189`) |
| 5 | `GUIA:189` | "marcar tudo, inclusive em segundo plano" | o worker aceita a falta da permissão de segundo plano (`SyncWorker.kt:39`) e falha só na leitura |
| 6 | `GUIA:189` | "o servidor funde por dia" e mandar de novo não duplica | certo para o relógio; para lacunas maiores que 3 dias não há recuperação (`SyncWorker.kt:41`) |
| 7 | `relogio.js:55,111` (servidor) | aceita `altura` e `kcal` | o app não manda nenhum dos dois |
| 8 | `mongo.js:303` | "fonte 'relogio' = veio da planilha do Galaxy Watch" | também vem do app (mesma `fonte`, impossível separar) |
| 9 | `ferramentas.js:226` | mostra `p.magra` das pesagens | `registrarPesagem` não grava `magra` (`mongo.js:302-310`) |
| 10 | `GUIA:185` | "sincroniza no máximo de hora em hora" | certo, mas o controle é em memória e zera a cada restart ou deploy (`perfis.js:16`) |

---

## 6. Avaliação para o app novo

### 6.1 Reaproveitável como está

- **`Leitor.kt` (lógica de leitura do HC)**: dá para reaproveitar, com correções:
  - paginação com `pageToken`;
  - sono lido uma vez só;
  - opcional: `Height`, `ActiveCaloriesBurned`, kcal por sessão (agregado `TotalCaloriesBurned` no intervalo);
  - juntar gordura e peso por proximidade de minutos em vez do bucket de hora;
  - opção de filtrar por app de origem.
- **`SyncWorker`/`NotaWorker`/`Envio.kt` (padrão WorkManager + HttpURLConnection)**: reaproveitáveis. Mudar a janela de 3 dias para "desde o último envio confirmado − 1 dia" (resolve o achado 5).
- **`Local.kt`**: reaproveitável inteiro.
- **`Cupom.kt` (WebView)**: reaproveitável. A UI precisa de espaço para o WebView quando houver desafio.
- **Contrato de servidor `/relogio` e `/nota`**: manter igual, para os outros 2 perfis seguirem com o app antigo se for o caso.
- **Assinatura**: reusar a mesma keystore (`RELOGIO_KEYSTORE_B64`) e, se a ideia é **substituir** o Relógio no celular do dono, o mesmo `applicationId` `br.nutribot.relogio` com `versionCode` maior que 7. Assim a instalação por cima preserva permissões do HC e `SharedPreferences`. Com `applicationId` novo, os dois apps coexistem e mandam em dobro (inofensivo pela fusão por dia, mas gasta bateria e regrava Drive e pesagens 2x).
- **CI** (`android.yml`): reaproveitável. Sugestão: tag por versão, além da `relogio` fixa.

### 6.2 O que precisa mudar para o app também **ler**

1. **Servidor: API de leitura nova**, status (e) hoje. Rotas mínimas, todas em JSON a partir do Mongo:
   - perfis (os 3);
   - refeições por dia e período;
   - totais e meta;
   - progresso de peso (`progressoDe`);
   - pesagens;
   - relógio (`saude_relogio`);
   - lugares (`perfil.lugares` + situação);
   - despensa;
   - treinos do Hevy (análise);
   - resumos (hoje só no Drive: passar a gravar no Mongo).
2. **Autenticação de dono**: token novo (ex.: `APP_TOKEN`) em **cabeçalho** (`Authorization: Bearer`), separado de `RELOGIO_TOKENS` (que só escreve dados de 1 pessoa) e de `ADMIN_TOKEN` (que hoje vai por query e controla logout). Dono único = um token que vê os 3 perfis. Comparação em tempo constante. No app, guardar em armazenamento cifrado pelo Android Keystore, não em `SharedPreferences` em texto puro (`Prefs.kt:17-19`).
3. **Escrita a partir do app** (se houver correção de refeição ou peso): passar pelas mesmas funções do WhatsApp (`registrarRefeicao`, `apagarRefeicaoPorId`, `aplicarAtualizacao` + `registrarPesagem`), para não criar um terceiro caminho de regra. Antes disso, decidir a **precedência de fontes de peso**: manual > documento > relógio? Hoje vence a última gravação.
4. **Custo zero**: todas as integrações atuais são gratuitas. Uma API de leitura só com Mongo e cálculo em código não gasta Gemini. Evitar rotas que chamem IA a cada abertura do app (ex.: `!resumo`, `!plano`). Notificação por push exigiria FCM (grátis, mas adiciona Firebase); com dono único, sondagem (*polling*) ao abrir o app basta.

### 6.3 Riscos

| Risco | Detalhe | Mitigação existente | Onde |
|---|---|---|---|
| Render Free dormindo e partida a frio | dorme após 15 min sem tráfego; a primeira chamada pode levar dezenas de segundos | auto-ping a cada 10 min + GitHub Actions a cada 5 min; timeouts de 30/90 s no app | `index.js:51-53,200-209`, `keepalive.yml:5-17`, `Envio.kt:13-14` |
| Instância única com o WhatsApp | cada POST `/relogio` faz Drive e Mongo de forma síncrona no mesmo processo do bot; leituras do app competem pelo pool Mongo de 5 conexões | pool com `waitQueueTimeoutMS` | `mongo.js:17` |
| Health Connect em segundo plano | sem `READ_HEALTH_DATA_IN_BACKGROUND` (ou em versão sem o recurso), a leitura no worker falha; antes dessa permissão existir, o HC só lia com o app em primeiro plano | nenhuma (o worker tolera a falta e falha depois) | `SyncWorker.kt:39` |
| Samsung adormecendo o app | WorkManager atrasado ou parado | botão de economia de bateria | `MainActivity.kt:100-103` |
| Samsung Health → HC com atraso | o Samsung só grava no HC de tempos em tempos | — (citado no GUIA) | `GUIA:189` |
| Localização em segundo plano | Android 10+ exige "permitir o tempo todo" em passo separado | fluxo em dois passos | `MainActivity.kt:45-57` |
| APK fora da loja | Play Protect avisa; atualização manual | release fixa | `android.yml:42-48` |
| Colisão de primeiro nome | dois perfis com o mesmo primeiro nome: relógio, Hevy e agenda vão para o primeiro | — | `relogio.js:152`, `treino.js:26`, `agenda.js:22-25` |
| `/estado` e `/qr` públicos | expõem o JID do grupo e o QR de pareamento | — | `index.js:65-67,139-155` |
| Credencial do Drive | se o refresh token for revogado ou o app OAuth estiver em modo teste (7 dias), as escritas param | checagem diária às 07:20 + aviso ao admin | `index.js:330`, `drive.js:62-76` |

---

## 7. Perguntas em aberto

1. **Os outros 2 perfis**: continuam com o app Relógio antigo (contrato `/relogio` e `/nota` intacto), ou o app novo terá um modo "coletor" instalável no celular deles? Com o app novo só no celular do dono, eles perdem relógio, localização e cupom.
2. **`applicationId`**: o app novo substitui `br.nutribot.relogio` (instala por cima, mantém permissões e token) ou é um pacote novo que convive com o antigo?
3. **Precedência de fontes de peso**: quando relógio, chat e bioimpedância em PDF dão pesos diferentes no mesmo dia, qual vale? E o relógio deve parar de regravar 60 dias a cada envio?
4. **Fonte oficial de `Nutri-Notas.md`**: o dono edita as notas à mão no Drive (Obsidian) e quer continuar? Se o app passar a mostrar e editar as notas, quem manda?
5. **Resumos, plano e conversa histórica**: aceita passar a gravá-los no Mongo (hoje só no Drive), para o app ler sem depender da API do Drive?
6. **O que o app escreve**: só lê, ou também registra e corrige refeição e peso, e marca lugar? Se escrever, deve passar pelas mesmas regras do WhatsApp.
7. **Planilha "Health Data Export"**: alguém ainda usa? Se não, aposentar (tira um caminho de conflito de pesagens e o bloco duplicado no dossiê).
8. **Recuperação de lacunas**: implementar "desde o último envio confirmado", com teto de 30 dias, no lugar da janela fixa de 3 dias?
9. **Dados extras do HC** (altura, calorias ativas, kcal por treino, SpO2, distância): interessam para a camada visual, ou mantém o escopo atual?
10. **Segurança das rotas abertas** (`/estado` com JID do grupo, `/qr` público): fechar junto com a criação da API do app?
11. **Atualização do APK**: o app deve checar sozinho a release do GitHub (sem custo, API pública) e avisar que há versão nova?
