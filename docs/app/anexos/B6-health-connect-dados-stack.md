> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# B6. Terreno técnico do app NutriBot: Health Connect, dados, IA, stack, backend e gráficos

Levantamento de 13/10/2026. A base é o app que já existe, `br.nutribot.relogio` (Kotlin com Views/XML, minSdk 28, targetSdk 36, `connect-client` 1.1.0, WorkManager 2.9.1, `play-services-location`, `play-services-code-scanner`). Ele lê o Health Connect e faz POST a cada 15 min para o Express no Render Free, que grava no MongoDB.

**Premissas do dono, que mudam as recomendações:**
- O APK é instalado à mão, assinado pelo GitHub Actions, fora da Play Store. As regras da Play aparecem aqui só como referência.
- Uma única pessoa autorizada usa o app e vê 3 perfis.
- APIs e serviços têm custo ZERO. Opções pagas aparecem em uma linha e são descartadas; das gratuitas, aponto os limites.

**Como as versões foram conferidas:** nos índices oficiais de artefatos (`dl.google.com/android/maven2`, Maven Central, npm, pub.dev, API do GitHub), consultados hoje. O que não consegui confirmar está marcado "não verificado" e listado no fim.

---

## 1. Health Connect

### 1.1 Biblioteca e plataforma

| Item | Situação em 13/10/2026 | Fonte |
|---|---|---|
| `androidx.health.connect:connect-client` estável | **1.1.0**, de 08/10/2025. É a que o app já usa | release notes HC; maven `dl.google.com` |
| Última alpha | **1.2.0-alpha06**, de 26/08/2026 | release notes HC |
| O que a linha 1.2 traz | `getChanges(token, pageSize)` e campos novos de exercício (alpha03, 25/03/2026); APIs de "matchmaking" de fontes (alpha04); `ActivityIntensityRecord` (alpha01, Android 14+); minSdk sobe para 24 (alpha05), o que não afeta o app (minSdk 28) | release notes HC |
| Android 14+ | O Health Connect faz parte do sistema (módulo de framework) | Samsung dev blog; get-started |
| Android 9 a 13 | O Health Connect é um APK separado, instalado pela Play. "Features tied to the system module remain unavailable on Android 13 and lower" | get-started |
| Leitura em 2º plano e histórico no Android ≤13 | Suportados desde a 1.1.0-alpha11 (15/01/2025), mas é preciso conferir a disponibilidade em tempo de execução | release notes HC |

### 1.2 Tipos de registro (lista da página oficial "Health Connect data types": 42 classes)

| Categoria | Classes (`androidx.health.connect.client.records.*`) | Utilidade para o NutriBot |
|---|---|---|
| Atividade | `StepsRecord`, `StepsCadenceRecord`, `DistanceRecord`, `ActiveCaloriesBurnedRecord`, `TotalCaloriesBurnedRecord`, `ExerciseSessionRecord` (segmentos, voltas, rota), `PlannedExerciseSessionRecord`, `ElevationGainedRecord`, `FloorsClimbedRecord`, `SpeedRecord`, `PowerRecord`, `CyclingPedalingCadenceRecord`, `WheelchairPushesRecord`, `ActivityIntensityRecord` (novo, Android 14+), `Vo2MaxRecord` | Gasto calórico (o "relógio" do balanço), treino, passos |
| Medidas corporais | `WeightRecord`, `BodyFatRecord`, `LeanBodyMassRecord`, `BoneMassRecord`, `BodyWaterMassRecord`, `HeightRecord`, `BasalMetabolicRateRecord` | Pesagens e composição de balança Bluetooth |
| Sinais vitais | `HeartRateRecord` (séries), `RestingHeartRateRecord`, `HeartRateVariabilityRmssdRecord`, `OxygenSaturationRecord`, `RespiratoryRateRecord`, `BloodPressureRecord`, `BloodGlucoseRecord`, `BodyTemperatureRecord`, `BasalBodyTemperatureRecord`, `SkinTemperatureRecord` (desde a 1.1.0-alpha10) | Recuperação e contexto |
| Sono | `SleepSessionRecord`, com `stages` (os estágios foram incorporados à sessão na 1.1.0-alpha01; `SleepStageRecord` foi removido na alpha07) | Sono e recuperação |
| Nutrição | `NutritionRecord`, `HydrationRecord` | Leitura e escrita (ver 1.6) |
| Bem-estar | `MindfulnessSessionRecord` (experimental desde a 1.1.0-beta02) | Pouca |
| Ciclo | `MenstruationPeriodRecord`, `MenstruationFlowRecord`, `OvulationTestRecord`, `CervicalMucusRecord`, `IntermenstrualBleedingRecord`, `SexualActivityRecord` | Só com consentimento explícito; fora do escopo |
| Registros médicos (PHR) | FHIR R4 por `MedicalDataSource`/`MedicalResource`; experimental desde a 1.1.0-beta02 (`FEATURE_PERSONAL_HEALTH_RECORD`). Ainda não há changelog para PHR | Fora do escopo |

**Passos medidos pelo próprio celular:** no Android 14 com SDK Extension 20 ou superior, o Health Connect conta passos pelo `TYPE_STEP_COUNTER`. A contagem só fica ativa se algum app tiver `READ_STEPS`. A origem é `"android"` até junho de 2026 e depois passa a ser um SPN próprio do aparelho, consultado por `getCurrentDeviceDataSource()` (SDK Ext 22+). **Isso importa para o app:** esses passos não devem ser somados com os do relógio.

### 1.3 Permissões especiais

| Permissão | Regra oficial | Como checar |
|---|---|---|
| `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND` | Sem ela, a leitura só funciona com o app em primeiro plano. O exemplo oficial usa `PeriodicWorkRequestBuilder<…>(1, TimeUnit.HOURS)` com `enqueueUniquePeriodicWork(KEEP)`. Se o usuário negar parte das permissões, o app deve seguir funcionando com o que recebeu | `healthConnectClient.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) == FEATURE_STATUS_AVAILABLE` |
| `android.permission.health.READ_HEALTH_DATA_HISTORY` (`PERMISSION_READ_HEALTH_DATA_HISTORY`) | Por padrão, o app só lê até **30 dias antes da primeira permissão concedida**. Fora dessa janela, `readRecord` falha, e `readRecords`, `aggregate*` e `getChanges` omitem os dados. Desinstalar o app zera tudo: a janela de 30 dias passa a contar da nova concessão | `FEATURE_READ_HEALTH_DATA_HISTORY` |
| Rotas de exercício | Só são lidas em 2º plano se o app também tiver a permissão de background | — |
| Recusa dupla | Duas recusas travam o pedido de permissão. Para destravar em teste: "allow all → remove all" no Health Connect, ou limpar o cache dele por adb | get-started |
| Tela de justificativa (obrigatória mesmo fora da Play) | Activity com `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE`. No Android 14+, um `activity-alias` com `android.intent.action.VIEW_PERMISSION_USAGE` e `android:permission="android.permission.START_VIEW_PERMISSION_USAGE"` | get-started |

**Android 16 (API 36, que já é o target do app):**
- Para apps com target 36, `BODY_SENSORS` foi trocado por permissões granulares `android.permission.health.*`. Isso só afeta sensores diretos (frequência cardíaca do Wear, `Sensor.TYPE_HEART_RATE`, FGS do tipo health), não a leitura do Health Connect.
- As **cotas de execução de jobs** passaram a valer também para jobs iniciados com o app visível e para jobs que rodam junto com um foreground service. Isso afeta o WorkManager: registrar `WorkInfo.getStopReason()` e usar `JobScheduler#getPendingJobReasonsHistory`.

### 1.4 Sincronização incremental (changes API)

| Item | Regra oficial |
|---|---|
| Obter o token | `getChangesToken(ChangesTokenRequest(recordTypes = setOf(...), dataOriginFilters = ...))` |
| Consumir | Laço com `getChanges(token)` enquanto `response.hasMore`; guardar `nextChangesToken`. Tratar `UpsertionChange` e `DeletionChange` |
| Validade | Um token parado **expira em 30 dias**. Nesse caso `changesTokenExpired == true`, e o app precisa de um token novo e de uma estratégia de recuperação. As três opções oficiais, da melhor para a pior: (1) reler os últimos 30 dias e deduplicar; (2) apagar e reler 30 dias; (3) reler sem deduplicar |
| Ignorar o que o próprio app escreveu | Descartar upserts cuja `dataOrigin` seja o próprio pacote, para não reimportar o que ele gravou (essencial se o app passar a escrever Nutrition/Weight) |
| Um token por tipo | Se os tipos são consumidos de forma independente, usar um token por tipo |
| Paginação | `ReadRecordsRequest` tem `pageSize` padrão de 1000 e devolve `pageToken`. A 1.2.0-alpha03 acrescenta `getChanges(token, pageSize)` |

### 1.5 Limites de taxa
- A documentação oficial **não publica números**. Ela descreve as categorias:
  - **Leitura e changelog:** limite periódico e limite diário de chamadas.
  - **Inserção, atualização e exclusão:** limite periódico, limite diário, limite de memória por lote e limite de memória por registro.
- O limite é "mais rígido em segundo plano". A recomendação oficial é usar a changes API em vez de releituras brutas e, quando uma escrita falhar, tentar de novo a partir do ponto da falha, sem regravar o lote inteiro.
- **Para o app:** o worker atual, a cada 15 min, deve trocar releituras de janelas por `getChanges` com um token por tipo. Isso reduz chamadas e o risco de estourar cota.

### 1.6 Escrita: `NutritionRecord` e `WeightRecord`

| Item | Detalhe |
|---|---|
| É possível? | Sim, com as permissões `android.permission.health.WRITE_NUTRITION` e `WRITE_WEIGHT` (e também `WRITE_HYDRATION`, se quiser) declaradas e concedidas. Outros apps com `READ_NUTRITION` passam a ler esses registros |
| Campos do `NutritionRecord` | Intervalo: `startTime`/`endTime` + zone offsets. `name` (nome da refeição), `mealType` (`MealType.MEAL_TYPE_BREAKFAST/LUNCH/DINNER/SNACK/UNKNOWN`). Energia: `energy` e `energyFromFat` (`Energy`). Macros (`Mass`): `protein`, `totalCarbohydrate`, `dietaryFiber`, `sugar`, `totalFat`, `saturatedFat`, `unsaturatedFat`, `monounsaturatedFat`, `polyunsaturatedFat`, `transFat`, `cholesterol`, `caffeine`. Minerais: `sodium`, `potassium`, `calcium`, `iron`, `magnesium`, `phosphorus`, `zinc`, `copper`, `manganese`, `selenium`, `iodine`, `chromium`, `molybdenum`, `chloride`. Vitaminas: `vitaminA`, `vitaminB6`, `vitaminB12`, `vitaminC`, `vitaminD`, `vitaminE`, `vitaminK`, `thiamin`, `riboflavin`, `niacin`, `pantothenicAcid`, `biotin`, `folate`, `folicAcid`. Tudo é opcional. Cada um tem agregado `*_TOTAL` (ex.: `ENERGY_TOTAL`, `PROTEIN_TOTAL`) |
| Idempotência | `Metadata.manualEntry(clientRecordId = <id da refeição no Mongo>, clientRecordVersion = <updatedAt em ms>)`. Gravar de novo com a mesma chave atualiza em vez de duplicar. As fábricas de `Metadata` (`manualEntry`, `autoRecorded`, `activelyRecorded`, `unknownRecordingMethod` e as variantes `…WithId`) existem desde a 1.1.0-alpha12, quando método de gravação e dispositivo passaram a ser obrigatórios |
| Riscos | (1) **Contagem dupla:** Samsung Health e outros também gravam Nutrition, e quem soma tudo conta duas vezes. Gravar só a refeição confirmada, com `name`, e nunca reler a própria origem. (2) **Peso em laço:** se o app grava a pesagem digitada no bot e depois lê `WeightRecord`, ela volta como "nova". Filtrar por `dataOrigin` |

**Recomendação da seção 1:**
- Manter o `connect-client` **1.1.0** estável. Não subir para a 1.2.0-alpha sem precisar de `getChanges(pageSize)`.
- Trocar o laço de 15 min por: `getChanges` com um token por tipo (Weight, Steps, TotalCalories, ActiveCalories, SleepSession, HeartRate/RestingHR/HRV, ExerciseSession, BodyFat); recuperação de token vencido relendo 30 dias e deduplicando; e um único `aggregate` diário para os totais.
- Pedir `READ_HEALTH_DATA_HISTORY` uma vez, para importar o histórico, e `READ_HEALTH_DATA_IN_BACKGROUND`, checando as duas features em tempo de execução.
- Gravar `NutritionRecord` e `WeightRecord` só depois, como recurso opcional desligável, com `clientRecordId` e filtro de origem.

### 1.7 O que cada app de relógio grava no Health Connect

| App | Grava no HC (o que achei) | Lê do HC | Confiabilidade da fonte |
|---|---|---|---|
| **Samsung Health** | Sincroniza nos dois sentidos desde a versão 6.22.5 (out/2022). O exemplo oficial da Samsung cita Steps, Exercise, HeartRate, SleepSession, OxygenSaturation, BodyFat, Weight, Height, BMR, BloodPressure, BloodGlucose, Nutrition, TotalCalories, Distance, Speed, Power. A FC contínua do Galaxy Watch chega ao celular com atraso, para poupar bateria. Exige "Sync with Samsung Cloud" ligado | Sim | Oficial (developer.samsung.com). A lista exata por tipo **não foi verificada** |
| **Zepp / Amazfit** | Só grava (não lê). Imprensa de jan/2025: "26 tipos", incluindo FC, sono, peso, pressão, passos, SpO2 e calorias | Não | Imprensa. A página oficial support.zepp.com **não foi verificada** |
| **Mi Fitness (Xiaomi)** | Pede para gravar passos, FC, sono e calorias. Peso não confirmado | **Não verificado** | Só blogs de terceiros |
| **Garmin Connect** | Só grava. Treino (calorias ativas/totais, cadência de pedal, distância, elevação, FC, velocidade, passos, braçadas) e bem-estar (gordura corporal, calorias, andares, FC, sono, passos, peso). **Não** grava Body Battery, carga de treino, VO2max nem estresse. Exige Android 14+ | Não ("Garmin will not receive any data") | Imprensa citando o suporte Garmin. Página oficial **não verificada** |
| **Huawei Health** | Sem integração nativa conhecida; só por apps-ponte de terceiros (Health Sync) | — | Fontes de terceiros, enviesadas. **Não verificado** |
| **Google Health / Fitbit** | Sincroniza com o HC nos dois sentidos, com permissão métrica a métrica. O app Fitbit passou a se chamar "Google Health" na central de ajuda. Alguns tipos exigem conta Google | Sim | Central de ajuda oficial. Lista de tipos **não verificada** |
| **Oura** | Segundo o blog Oura: FC (1 min), HRV, altura, peso, sono (início, fim, duração, estágios, FC em repouso noturna), passos, distância, calorias totais e ativas | Sim (importa atividade) | Blog oficial; artigo de suporte atualizado em 19/08/2026 (seção não lida) |
| **WHOOP** | Grava treinos, resumo do sono, FC em repouso, frequência respiratória, SpO2. Passos: historicamente **não** | Lê atividades, calorias, peso, altura, nutrição | Imprensa (2023) + fórum. **Não verificado** hoje |
| **Polar Flow** | Sono (com estágios nos modelos mais novos), FC contínua e de repouso, treinos, VO2max, HRV (RMSSD noturno) | **Não verificado** | Só terceiros. **Não verificado** |

---

## 2. Bases de alimentos brasileiras e código de barras

### 2.1 Bases

| Base | Versão / tamanho | Nutrientes | Acesso | Licença / termos | Custo |
|---|---|---|---|---|---|
| **TACO** (NEPA/Unicamp) | 4ª ed. revisada e ampliada, 2011; **597 alimentos** (conferido no PDF). Não há edição mais nova | Composição centesimal (umidade, kcal/kJ, proteína, lipídeos, colesterol, carboidrato, fibra, cinzas), minerais e vitaminas (retinol, RE/RAE, tiamina, riboflavina, piridoxina, niacina, vit. C), ácidos graxos e aminoácidos, por 100 g | PDF e **XLSX** oficiais em nepa.unicamp.br. Há JSONs não oficiais no GitHub (marcelosanto/tabela_taco, danperrout/tabelataco, brolesi/taco, IgorFZ/taco-br) | "É permitida a reprodução parcial ou total desta obra, desde que citada a fonte" | Zero |
| **TBCA** (USP/FoRC) | **7.3** (2025); 6.182 alimentos e ingredientes (Agência FAPESP, 30/09/2026) | 34 componentes, segundo a imprensa (**não verificado** na documentação) | **Sem API**; só consulta web, planilhas BRASILFOODS e PDFs complementares | Uso não comercial com citação; "não é permitida a reprodução total ou parcial"; PDFs complementares em CC BY-NC-ND 4.0 | Zero, mas não pode ser embutida |
| **Open Food Facts** | br.openfoodfacts.org mostra 36.957 produtos (filtro exato **não verificado**) | `nutriments` (`energy-kcal_100g`, `proteins_100g`…), `nutriscore_grade`, `nova_group`, `ingredients_text_pt`, `image_front_url`, `serving_size`, `brands` | `GET https://world.openfoodfacts.org/api/v2/product/{ean}.json?fields=…`. A v2 está "deprecated, mas funciona"; a v3 é a recomendada. Na **v3.6** `nutriments` vem vazio e os nutrientes ficam em `product.nutrition.aggregated_set.nutrients` (testado). SDK oficial `openfoodfacts-kotlin` v1.0.0 (Apache-2.0) | Dados em **ODbL**: atribuição + share-alike se publicar base derivada. Imagens em **CC BY-SA 3.0** | Zero. **15 req/min/IP** (produto), **10 req/min/IP** (busca); estourar pode dar ban de IP. **User-Agent próprio obrigatório** (`NutriBot/1.0 (email)`). Dumps: CSV ~0,9 GB comprimido / ~9 GB aberto, Parquet, deltas diários |
| **USDA FoodData Central** | Foundation, SR Legacy, FNDDS, Branded (EUA) | Completo | Chave gratuita do api.data.gov | Domínio público (CC0 1.0) | Zero. **1.000 req/h por IP** (estourou, bloqueio de 1 h); `DEMO_KEY`: 30/h e 50/dia |
| Bluesoft Cosmos | Nome, marca, NCM, preço médio (exemplo não oficial). Tabela nutricional **não verificada** | — | `GET /api/gtins/{ean}` com `X-Cosmos-Token` (fonte não oficial) | — | Haveria um plano gratuito (fala de um representante num fórum), mas limite e termos **não verificados** (site deu 403) |
| GS1 Brasil (CNP / Verified by GS1) | Dados de cadastro do GTIN | — | Credenciais pedidas a api@gs1br.org | Termo de aceite | As versões com API são pagas (fontes secundárias): **descartada** |

### 2.2 Leitura do código de barras (EAN-13/EAN-8)

| Opção | Artefato e versão atual | Permissão `CAMERA` | Offline | Depende do Google Play services | Fora da Play |
|---|---|---|---|---|---|
| **Google Code Scanner** (o que o app já usa) | `com.google.android.gms:play-services-code-scanner:16.1.0` (a mais recente no Maven; de 2023) | **Não**: a interface é do Play services | Depois de baixar o módulo | Sim | O download do módulo na instalação só vale pela Play. No APK manual ele baixa no 1º uso, ou antes, com `ModuleInstallClient` (conclusão a partir da documentação, sem afirmação explícita) |
| ML Kit bundled | `com.google.mlkit:barcode-scanning:17.3.0` (~+2,4 MB) | Sim | Sim (modelo dentro do APK) | **Não** | Sim |
| ML Kit unbundled | `com.google.android.gms:play-services-mlkit-barcode-scanning:18.3.1` (~+200 KB) | Sim | Depois de baixar | Sim | Igual ao Code Scanner |
| CameraX + `MlKitAnalyzer` | `androidx.camera:camera-core` e `camera-mlkit-vision` **1.6.2** estável (a 1.7.0 está em alpha03) | Sim | Igual ao ML Kit usado por baixo | Igual | Sim |

Todas são gratuitas. Para EAN-13, a documentação pede o código com pelo menos ~190 px de largura na imagem.

**Recomendação da seção 2:**
- **Base local = TACO** (o XLSX oficial convertido para SQLite/JSON pelo próprio projeto e embutido no app e no servidor, com a citação da fonte). A TACO é a "régua" para comida caseira.
- **Produto industrializado = Open Food Facts v2**, com `fields`, User-Agent próprio e cache local por EAN. O volume de 1 usuário fica muito abaixo de 15 req/min. Mostrar "Dados: Open Food Facts (ODbL)" na tela.
- **TBCA:** só consulta manual, sem embutir (os termos proíbem reprodução).
- **USDA:** reserva para itens importados.
- **Cosmos e GS1:** fora (custo ou termos não verificados).
- **Leitor:** manter o Code Scanner 16.1.0, com `setBarcodeFormats(FORMAT_EAN_13, FORMAT_EAN_8)`, `enableAutoZoom()` e `ModuleInstallClient` na primeira abertura. Só trocar por ML Kit bundled + CameraX se for preciso funcionar sem Play services.

---

## 3. Reconhecimento de comida por foto

### 3.1 Gemini API, nível gratuito (consultado em 13/10/2026)

| Item | Situação |
|---|---|
| Modelos com imagem no nível gratuito | `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` (desligamento previsto para 07/05/2027). `gemini-2.5-flash` e `-flash-lite` seguem, mas só para quem já usava. **Pro só no pago** |
| Limites RPM/RPD | A página oficial não publica os números ("can be viewed in Google AI Studio"). A cota é **por projeto, não por chave**, e zera à meia-noite do horário do Pacífico |
| Tokens por imagem | 2.x: 258 tokens até 384 px; acima disso, blocos de 768×768 a 258 cada. Série 3, `media_resolution`: low 280, medium 560, **high 1120 (padrão)**, ultra_high 2240 |
| Saída estruturada | `responseMimeType: "application/json"` + `responseSchema`/`responseJsonSchema`. **Os dois estão marcados como deprecated em favor de `responseFormat`** |
| Grounding (Google Search) | Série 3: 5.000 buscas/mês grátis, somadas entre todos os modelos |
| Thinking | `thinkingLevel` low/medium/high no 3.8 Flash (padrão medium; "minimal" dá erro). Os tokens de raciocínio contam como saída |
| Dados no nível gratuito | Usados para "provide, improve, and develop Google products"; **revisores humanos podem ler**. O Google pede para não enviar dados sensíveis (termos de 28/04/2026) |
| SDK | `@google/genai` **2.29.1** (npm, 13/10/2026); o bot declara `^2.23.0` |

**Dois achados no código do bot** (vindos da pesquisa; confirmar antes de mexer):
- `MODELOS_RESERVA` em `gemini.js` cita `gemini-3.7-flash` e `gemini-3.5-flash`, que hoje são **redirecionados** para 3.8 e 3.6. Se a cota contar no modelo de destino (não verificado), essas reservas não acrescentam nada.
- `responseSchema` está deprecated.

### 3.2 No aparelho ou chamada direta do app (só opções gratuitas)

| Opção | Imagem? | Requisitos | Fora da Play / custo |
|---|---|---|---|
| ML Kit GenAI (Gemini Nano via AICore): Image description (beta), Prompt API (beta, `com.google.mlkit:genai-prompt:1.0.0-beta4`) | Descrição curta; a Prompt API aceita texto + imagem com menos de 4.000 tokens de entrada | Aparelhos topo de linha (Pixel 9–11, Galaxy S25/S26, Fold7/8…); app em primeiro plano; cota de bateria por app | Grátis. Funcionamento em APK manual **não verificado** |
| LiteRT-LM + Gemma 4 E2B/E4B | Sim | Modelo de 2,6–3,7 GB; ~2,9 GB de RAM no E2B em 4 bits | Grátis, roda offline; peso enorme |
| Firebase AI Logic (Gemini direto do app, plano Spark) | Sim (7 MB por imagem) | 100 req/min por usuário; **App Check obrigatório a partir de 02/11/2026**. O Play Integrity exige vincular o projeto no Play Console | Sem conta Play fica inviável. Descartada |
| Serviços pagos: LogMeal (teste de 30 dias / 200 consultas), Passio (a partir de US$ 99/mês), Foodvisor (contrato), Calorie Mama (sem preço público) | — | — | **Pagos: descartados** |

**Precisão de referência:** estudos de 2025 mostram erro médio de **20 a 36% em kcal** por refeição nos melhores modelos multimodais.
- *Curr Dev Nutr*, set/2025: GPT-4o 35,8%, Gemini 1.5 Pro 64,2%.
- arXiv 2507.07048: Gemini 2.5 Pro 34,1%, que cai para 27,8% com contexto de hora, local e nome do prato.

O contexto reduz o erro, e esse contexto (histórico, correções da pessoa) só existe no servidor.

**Recomendação da seção 3:** **manter o reconhecimento no servidor.**
- O app manda a foto (JPEG com lado maior de ~1.024 px) para um endpoint do bot e recebe **o mesmo JSON** de refeição que o WhatsApp gera.
- Isso dá um único prompt, um único esquema e uma única conferência, a mesma cota e o mesmo `progresso.js`.
- No aparelho, no máximo uma pré-legenda opcional ("parece arroz, feijão e frango") como contexto, nunca para calcular kcal.
- Em paralelo, no bot: rever as reservas redirecionadas e migrar `responseSchema` para `responseFormat` quando for mexer ali.

---

## 4. Stack do app

### 4.1 Versões atuais relevantes (Google Maven, 13/10/2026)

| Artefato | Estável | Observação |
|---|---|---|
| Compose BOM | **2026.09.00** (ui 1.12.1, material3 1.4.0) | Compose convive com Views pelo `ComposeView`: dá para migrar tela por tela |
| `androidx.compose.material3:material3` | 1.4.0 | **1.5.0-beta01** (07/10/2026) traz o Expressive (ver seção 6) |
| `androidx.work:work-runtime` | **2.12.0** | O app usa 2.9.1 |
| `androidx.room:room-runtime` | **2.8.5** | — |
| `androidx.health.connect:connect-client` | 1.1.0 | 1.2.0-alpha06 |
| `androidx.camera:camera-core` | 1.6.2 | — |

### 4.2 Comparação

| Critério | (a) Kotlin + Compose evoluindo o app | (b) React Native/Expo + `react-native-health-connect` | (c) Flutter + `health` | (d) Capacitor/PWA |
|---|---|---|---|---|
| Health Connect | API oficial completa: changes, background, history, escrita, features | v**4.1.3** (06/08/2026, MIT): tem `getChanges`; leitura em 2º plano **não documentada** no README (exigiria headless JS ou módulo nativo) | `health` **13.3.2**: tem history e background (`isHealthDataInBackgroundAvailable`…); **sem changes API** no README | PWA não acessa o HC; plugin Capacitor **não verificado** |
| WorkManager | Nativo | Via módulo nativo | Via `workmanager` plugin ou nativo | Não |
| Notificações | Nativo + FCM | Bibliotecas JS + nativo | Plugins | Limitado |
| Gráficos | Vico 3.3.1, MPAndroidChart 4.0.1 (com módulo Compose), Canvas | Victory Native e outras (não avaliadas a fundo) | fl_chart (não avaliado a fundo) | Libs web |
| Reaproveita o app atual | **Sim**: o worker HC, o code scanner, a localização e a assinatura no GitHub Actions continuam | Não: reescrita + ponte nativa para o que já existe | Não: reescrita | Não |
| 1 pessoa + agentes de IA | Uma linguagem e uma build Gradle; agentes conhecem bem Kotlin e Compose | Duas pilhas (JS + nativo) para manter | Dart + nativo | Simples, mas não atende o HC |
| Custo | Zero | Zero (EAS Build pago **descartado**; build local/GitHub Actions grátis) | Zero | Zero |

**Distribuição:**
- **APK assinado pelo GitHub Actions (como hoje):** custo zero e sem exigências da Play. O Health Connect funciona em APK instalado à mão; o `br.nutribot.relogio` já faz isso. O que não pode faltar é a activity de justificativa de permissões (1.3).
- **Play Store (só como referência):**
  - A conta de desenvolvedor é paga (taxa única), então está **descartada** pelo custo zero.
  - Contas pessoais criadas depois de 13/11/2023 precisam de teste fechado com **12 testadores por 14 dias seguidos** antes da produção.
  - Apps com HC exigem formulário "Health apps declaration", Data safety e política de privacidade idêntica à exibida no HC. O acesso é liberado por nome de pacote.
- **Verificação de desenvolvedor Android (novo, relevante para o Brasil):**
  - Desde **30/09/2026**, aparelhos certificados no Brasil (Android 7+) só instalam apps de desenvolvedores verificados **quando instalados por lojas participantes** (Play, Galaxy Store e outras).
  - Instalação direta de APK **não é afetada até a expansão global em 2027**.
  - Desde agosto/2026 existem contas de **"distribuição limitada"** (até **20 aparelhos**, sem documento de identidade e sem taxa) e um "fluxo avançado" de instalação para usuários avançados (o adb continua igual).
  - **Ação:** registrar a chave de assinatura numa conta de distribuição limitada antes de 2027, para o APK do GitHub Actions continuar instalável.

**Recomendação da seção 4:** **(a) Kotlin + Jetpack Compose, evoluindo o `br.nutribot.relogio`.**
- Motivos:
  - É a única opção com toda a API do Health Connect sem ponte.
  - Reaproveita o worker, o leitor e o pipeline de assinatura.
  - É uma linguagem só para 1 pessoa + agentes.
  - O Android é "Compose-first" (até o Vico congelou o módulo `views`).
- Caminho:
  1. Subir o WorkManager para 2.12.0.
  2. Adicionar o Compose BOM 2026.09.00 e as telas novas em Compose (dashboard, refeições, progresso, nutrição, "conhecimento da IA", integrações), mantendo as telas XML até reescrever.
  3. Room 2.8.5 como cache local.
  4. Navegação com 3 perfis (seletor no topo).
- Distribuição: continuar no APK do GitHub Actions + conta de distribuição limitada.

---

## 5. Backend e API

Pagas e descartadas: Render Starter (US$ 7/mês), Koyeb Pro (US$ 29/mês). O Fly.io não tem mais cota gratuita para organizações novas, só um teste de 2 h ou 7 dias.

### 5.1 Render Free (render.com/docs/free e /pricing, 13/10/2026)

| Item | Limite |
|---|---|
| Horas de instância | **750 h/mês por workspace**, sem acumular. Um serviço 24 h gasta ~744 h num mês de 31 dias: cabe, mas **só um serviço** |
| Sono | Após **15 min sem tráfego de entrada** (HTTP ou mensagem WebSocket). Acorda em "about one minute" |
| Horas esgotadas | **Todos os serviços Free ficam suspensos até o início do mês seguinte** |
| Recursos | 512 MB de RAM, "less than 1 CPU", uma instância, disco efêmero, SMTP bloqueado, pode reiniciar a qualquer momento |
| Banda de saída (Hobby) | **5 GB/mês incluídos** (excedente cobrado; se é corte rígido sem cartão **não foi verificado**) |
| Tráfego iniciado pelo serviço | "Render may suspend a Free web service that initiates an uncommonly high volume of traffic" (sem número publicado) |
| Keep-alive externo | Nada na documentação. Hoje o bot e o POST a cada 15 min já mantêm o serviço acordado |

**O app atual já lida com o sono?** No código atual do app isso **não foi verificado**. O padrão a adotar:
- OkHttp com `readTimeout` de ~90 s.
- No Worker, `Result.retry()` só para timeout, 502/503 ou erro de rede; **nunca para 401**.
- `setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)` (o mínimo é 10 s, `MIN_BACKOFF_MILLIS`), `NetworkType.CONNECTED`, intervalo periódico mínimo de 15 min.
- Na interface, mostrar "acordando o servidor…" e servir o cache do Room enquanto isso.

### 5.2 Alternativas gratuitas que não exigem migrar o Mongo

| Opção | Limites gratuitos | Serve para bot persistente? |
|---|---|---|
| Koyeb Free Instance | 512 MB, 0,1 vCPU, 1 por organização, Frankfurt/Washington, **dorme após 1 h sem tráfego** | Não (também dorme) |
| **Oracle Cloud Always Free Ampere A1** | 1.500 OCPU-h + 9.000 GB-h/mês ("equivalente a 2 OCPU e 12 GB"; **não são mais 4/24**), 200 GB de disco, 10 TB/mês de saída. **Pode ser recuperada se ficar ociosa 7 dias** (CPU p95, rede e memória abaixo de 20%) | Sim (VM própria, administração por sua conta) |
| Oracle E2.1.Micro | 2 VMs de 1/8 OCPU e 1 GB | Sim, apertado |
| Google Cloud Run | 180 mil vCPU-s, 360 mil GiB-s, 2 milhões req/mês | Não: 24 h ligado dá ~2,6 milhões vCPU-s/mês |
| GCE e2-micro | 1 VM nos EUA, 30 GB de disco, **1 GB de saída/mês** | Possível, mas a saída não comporta fotos |
| Cloudflare Workers | Por requisição | Não (sem sessão de WhatsApp) |

### 5.3 MongoDB Atlas Free (M0)

| Item | Limite |
|---|---|
| Armazenamento | **0,5 GB** (dados + índices) |
| Conexões | 500 |
| Operações | **100/s** (acima disso, estrangulamento) |
| Transferência | 10 GB de entrada + 10 GB de saída por 7 dias corridos |
| Change streams | **Disponíveis** (no filtro por `ns` de banco só valem string/regex) |
| Backup | **Não há**: fazer `mongodump` próprio |
| Pausa | Após 30 dias sem conexão |

### 5.4 Autenticação da pessoa autorizada

| Opção | Situação hoje | Veredito |
|---|---|---|
| **Token longo emitido pelo servidor + Android Keystore + `BiometricPrompt`** | `androidx.security:security-crypto` **1.1.0** (30/07/2025) **depreciou todas as APIs** (EncryptedSharedPreferences) "in favour of … direct use of Android Keystore". `androidx.biometric`: estável 1.1.0; 1.4.0-alpha07 (22/04/2026) | **Escolhida** |
| Firebase Authentication (Spark) | 50 mil MAU grátis (SMS fora do Spark); `firebase-admin` `verifyIdToken` | Peça a mais sem ganho para 1 pessoa |
| Passkeys | `androidx.credentials` 1.6.0 + SimpleWebAuthn 14.0.3. Exige `assetlinks.json` num domínio com o SHA-256 do certificado (o APK manual deve funcionar, **não verificado**; com `onrender.com` depende da Public Suffix List) | Complexo demais aqui |

**Desenho:**
- O servidor gera 32 bytes aleatórios e guarda **só o SHA-256** no Mongo (`dispositivos: {hash, perfis: [3 ids], criadoEm, revokedAt}`).
- O app cifra o token com uma chave AES-GCM do Keystore com `setUserAuthenticationRequired(true)`, liberada por `BiometricPrompt` + `CryptoObject` (biometria ou PIN do aparelho). O "PIN local" é o do próprio Android.
- Header `Authorization: Bearer`, comparação com `crypto.timingSafeEqual`.
- `POST /auth/rotate` (o token antigo vale por pouco tempo) e revogação por `revokedAt`.
- O token é **por aparelho**, não por perfil. O token por pessoa dos workers de Health Connect continua como está.

### 5.5 Push

| Opção | Limites gratuitos |
|---|---|
| **FCM (HTTP v1 + `firebase-admin`)** | Sem custo. Funciona em APK fora da Play ("you are not limited to deploying … through Google Play Store"). Exige Android 7+ **com Play Store/Play services**. No Android 13+, pedir `POST_NOTIFICATIONS` em tempo de execução |
| ntfy.sh público / UnifiedPush | 250 mensagens/dia, 4.096 bytes/mensagem, tópicos públicos (nome impossível de adivinhar). Reserva para aparelho sem Google |

**Para o app:** push "data-only" com "há novidade, sincronize", sem dado de saúde no payload.

### 5.6 Sincronização offline-first

| Componente | Versão | Uso |
|---|---|---|
| Room | 2.8.5 (09/09/2026) | Banco local como fonte da verdade da interface |
| WorkManager | 2.12.0 (23/09/2026). Sobe o minSdk para 24 (o app tem 28) e exige compileSdk 33+ | Fila de envio (`enqueueUniqueWork` + `KEEP` + `CONNECTED`) e pull periódico |
| Express | 5.3.0 (09/10/2026) | Erros em handlers `async` vão direto ao middleware de erro; curinga nomeado (`/*splat`); `req.query` só leitura; `req.body` `undefined` sem parser |

**Protocolo** (o guia oficial de offline-first cobre a escrita "lazy", a fila no WorkManager e o last-write-wins; os tombstones são acréscimo deste projeto):
- `PUT /api/v1/refeicoes/:uuid`: o UUID é gerado no app; idempotente; o servidor carimba `updatedAt` e rejeita `clientUpdatedAt` mais antigo que o atual.
- `GET /api/v1/changes?since=<cursor>&perfis=…`: devolve itens e tombstones (`deletedAt`) ordenados por `(updatedAt, _id)`, com cursor opaco. Índice `{pessoa: 1, updatedAt: 1}` em cada coleção.
- Fotos de refeição sobem por `POST /api/v1/refeicoes/:uuid/foto`, que usa o mesmo pipeline do bot (seção 3).

### 5.7 Segurança mínima
- `helmet` 8.3.0 e `express-rate-limit` 8.7.1, com `app.set('trust proxy', 1)` atrás do proxy do Render (esse valor **não foi verificado** na documentação do Render).
- HTTPS automático do Render.
- Nunca registrar token nem corpo de requisição com dados de saúde.
- `mongodump` semanal via GitHub Actions (o M0 não tem backup).

**Recomendação da seção 5:**
- **Ficar no Render Free + Atlas M0.** A API nova é `/api/v1` no mesmo Express, com:
  - token de dispositivo guardado no Keystore e liberado por biometria;
  - FCM data-only para avisar de novidade;
  - Room + WorkManager + `GET /changes` para o offline-first.
- Pontos a vigiar: a **banda de 5 GB/mês** (fotos), as 750 h (um único serviço) e os 0,5 GB do Atlas.
- **Plano B gratuito, se o Render apertar:** Oracle A1 (2 OCPU/12 GB), aceitando a administração e a regra de ociosidade.

---

## 6. Gráficos e design

### 6.1 Bibliotecas de gráficos

| Biblioteca | Versão / data | Licença | Tipos | Banda de IC 95% numa linha de tendência |
|---|---|---|---|---|
| **Vico** (`com.patrykandpatrick.vico:compose` / `compose-m3`) | **3.3.1** (28/08/2026). O módulo `views` só recebe correções críticas desde a 3.3.0 | Apache-2.0 | Linha (`LineCartesianLayer`, interpoladores, `AreaFill.single/double`), colunas agrupadas ou **empilhadas** (`ColumnCartesianLayer.MergeMode`), candlestick, **pizza/anel** (`PieChart` com `innerSize` → donut), marcadores, zoom e scroll, dois eixos Y | **Não nativa.** Conferido no código: `AreaFill` preenche só entre a linha e um `splitY` constante. É viável com um **`Decoration` customizado** (interface pública com `drawUnderLayers(context)`), que desenha o polígono superior → inferior sob as camadas. A implementação **não foi testada** |
| **MPAndroidChart** (`com.github.PhilJay.MPAndroidChart`, via JitPack) | **4.0.1** (28/09/2026): reescrita em Kotlin com módulo **`MPChartCompose`** (primeira estável desde a 3.1.0) | Apache-2.0 | Linha, barra (empilhada, arredondada), pizza, radar, candle, combinados; animação de troca de dados | Sim, pelo truque oficial do exemplo `FilledLineActivity`: fundo da grade na cor da banda, a linha inferior preenche de branco até o mínimo do eixo e a superior até o máximo (`IFillFormatter`). Funciona, mas depende de fundo opaco |
| Compose Charts (`io.github.ehsannarmani:compose-charts`) | 1.0.0 (jul/2026) | (não conferida) | Linha, coluna, pizza | **Não verificado** |
| **Canvas do Compose** (sem biblioteca) | — | — | Qualquer um | **Sim, trivial**: `Path` com a borda superior + a inferior invertida, preenchido com alfa, e a linha da tendência por cima. Ideal para o gráfico de peso, que tem forma fixa |

### 6.2 Material 3 Expressive, ícones, fontes e animação

| Item | Situação | Fonte |
|---|---|---|
| Material 3 Expressive em Compose | A 1.4.0 estável **removeu** as APIs `@ExperimentalMaterial3ExpressiveApi`. Na **1.5.0 (beta01, 07/10/2026)** elas se tornam estáveis: botões expressivos e `ToggleButton` com tamanhos, FAB e **FAB Menu**, **FloatingToolbar**, Top App Bars flexíveis (`MediumFlexibleTopAppBar`, `LargeFlexibleTopAppBar`), list items expressivos e segmentados, menus novos, TimePicker, `MaterialExpressiveTheme`/`expressiveLightColorScheme` promovidos, `MotionScheme.expressive()` (motion por molas) | release notes compose-material3 |
| Ícones | `material-icons-core/extended` deixaram de ser publicados depois do Compose 1.7 (fonte secundária). O caminho é **Material Symbols** (fonts.google.com/icons, Apache-2.0) importados como vector drawable (Vector Asset do Android Studio) ou por fonte variável | Zenn/kotlinlang (secundárias) |
| Fontes | `androidx.compose.ui:ui-text-google-fonts:1.12.1` (downloadable fonts, usa o provedor do Google Play services). Alternativa sem dependência: embutir o .ttf em `res/font` | docs Compose "Fonts" |
| Animações | `com.airbnb.android:lottie-compose` **6.7.1** (31/10/2025), Apache-2.0 | Maven Central |

**Recomendação da seção 6:**
- **Vico 3.3.1 (`compose-m3`)** para os gráficos comuns: barras empilhadas de macros, anel de meta do dia, linhas de passos, sono e kcal.
- **Gráfico de peso com banda de IC 95% em Canvas próprio** (ou como `Decoration` do Vico, se quiser os eixos e marcadores dele). Pontos das pesagens, linha da tendência e banda semitransparente vêm do servidor já calculados por `progresso.js`; o app não recalcula estatística.
- **Material3 1.5.0** (beta agora, estável quando sair) para ter o Expressive sem opt-in.
- Material Symbols como vector drawables, fonte embutida e Lottie só para estados vazios e confirmações.

---

## Não verificado

- Números concretos dos limites de taxa do Health Connect (a documentação oficial não publica).
- Lista exata de tipos que cada app de relógio grava (Samsung, Zepp, Mi Fitness, Garmin, Google Health/Fitbit, Oura, WHOOP, Polar). Huawei sem integração nativa (só fontes de terceiros).
- Funcionamento do ML Kit GenAI/AICore e do download de módulo do Code Scanner em APK instalado à mão (inferido, não documentado).
- Limites RPM/RPD do nível gratuito do Gemini por modelo (só aparecem no AI Studio); se os modelos redirecionados gastam a cota do destino.
- Número de componentes e alimentos exatos da TBCA 7.3; número exato de produtos brasileiros na OFF.
- Plano gratuito e campos nutricionais da Bluesoft Cosmos; limite gratuito do Verified by GS1.
- Leitura em segundo plano no `react-native-health-connect`; plugin Capacitor para HC; changes API no pacote Flutter `health`.
- Banda de IC por `Decoration` no Vico (viável pela API pública, sem exemplo oficial); suporte a banda no Compose Charts; licença do Compose Charts.
- Descontinuação oficial (página Google) de `material-icons-extended`.
- Isenção de contas de organização da regra dos 12 testadores.
- Render: se a banda de 5 GB é corte rígido sem cartão; número da regra de "tráfego iniciado pelo serviço"; `trust proxy` recomendado.
- Se o app atual já trata o cold start do Render (timeout e retry): o código do app não foi lido neste levantamento.
- Se Koyeb e Oracle exigem cartão no cadastro; passkeys com APK manual e domínio `onrender.com`; status do Room 3.

## Fontes

Health Connect e Android
- https://developer.android.com/health-and-fitness/health-connect/data-types
- https://developer.android.com/health-and-fitness/health-connect/read-data
- https://developer.android.com/health-and-fitness/health-connect/sync-data
- https://developer.android.com/health-and-fitness/health-connect/rate-limiting
- https://developer.android.com/health-and-fitness/health-connect/get-started
- https://developer.android.com/health-and-fitness/health-connect/publish
- https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
- https://developer.android.com/health-and-fitness/health-connect/medical-records
- https://developer.android.com/jetpack/androidx/releases/health-connect
- https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/NutritionRecord
- https://developer.android.com/reference/android/health/connect/datatypes/NutritionRecord.Builder
- https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/metadata/Metadata
- https://developer.android.com/reference/androidx/health/connect/client/permission/HealthPermission
- https://developer.android.com/about/versions/16/behavior-changes-all
- https://developer.android.com/about/versions/16/behavior-changes-16
- https://support.google.com/googleplay/android-developer/answer/15931464 (política HC, 05/03/2025)
- https://support.google.com/googleplay/android-developer/answer/14151465 (12 testadores / 14 dias)
- https://developer.android.com/developer-verification
- https://www.androidauthority.com/android-sideloading-developer-verification-first-wave-rollout-3717921/

Apps de relógio
- https://developer.samsung.com/health/blog/en/accessing-samsung-health-data-through-health-connect
- https://gadgetsandwearables.com/2025/01/24/zepp-health-connect/
- https://www.notebookcheck.net/Amazfit-smartwatches-get-new-Health-Connect-data-sync-feature.951489.0.html
- https://www.tomsguide.com/wellness/fitness-trackers/garmin-clarifies-what-data-its-sharing-with-google-health-connect-heres-the-full-list
- https://support.google.com/fitbit/answer/14506680
- https://ouraring.com/blog/data-sharing-partner-integrations/
- https://support.ouraring.com/hc/en-us/articles/10786105824531
- https://gadgetsandwearables.com/2023/07/14/whoop-health-connect-integration/
- https://www.community.whoop.com/t/steps-sync-issue-with-android-health-connect/3702
- https://www.fitmesh.fit/en/blog/polar-health-connect-sync (terceiro)
- https://www.fitmesh.fit/en/blog/huawei-health-health-connect-sync (terceiro)
- https://www.fitmesh.fit/en/blog/xiaomi-amazfit-health-connect-data-dashboard (terceiro)

Bases de alimentos e código de barras
- https://nepa.unicamp.br/ ; https://nepa.unicamp.br/wp-content/uploads/sites/27/2023/10/taco_4_edicao_ampliada_e_revisada.pdf ; https://nepa.unicamp.br/wp-content/uploads/sites/27/2023/10/Taco-4a-Edicao.xlsx
- https://github.com/marcelosanto/tabela_taco ; https://github.com/danperrout/tabelataco ; https://github.com/brolesi/taco ; https://github.com/IgorFZ/taco-br
- https://www.tbca.net.br/ ; https://agencia.fapesp.br/tabela-brasileira-de-composicao-de-alimentos-se-transforma-em-ecossistema-digital-de-pesquisa/59305
- https://openfoodfacts.github.io/openfoodfacts-server/api/ ; https://world.openfoodfacts.org/data ; https://br.openfoodfacts.org/ ; https://github.com/openfoodfacts/openfoodfacts-kotlin
- https://fdc.nal.usda.gov/api-guide/
- https://www.projetoacbr.com.br/forum/topic/27116-integracao-api-bluesoft-cosmos/ ; https://gs1br.org/hub-de-dados/bancos-de-dados-de-produtos/verified-by-gs1
- https://developers.google.com/ml-kit/vision/barcode-scanning/android ; https://developers.google.com/ml-kit/vision/barcode-scanning/code-scanner ; https://developer.android.com/jetpack/androidx/releases/camera

IA para foto de comida
- https://ai.google.dev/gemini-api/docs/rate-limits ; https://ai.google.dev/gemini-api/docs/pricing ; https://ai.google.dev/gemini-api/docs/models ; https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/docs/image-understanding ; https://ai.google.dev/gemini-api/docs/media-resolution ; https://ai.google.dev/gemini-api/docs/structured-output ; https://ai.google.dev/api/generate-content ; https://ai.google.dev/gemini-api/docs/thinking ; https://ai.google.dev/gemini-api/terms
- https://registry.npmjs.org/@google/genai
- https://developers.google.com/ml-kit/genai ; https://developers.google.com/ml-kit/genai/prompt/android/get-started ; https://developers.google.com/edge/litert-lm/overview ; https://ai.google.dev/gemma/docs/core
- https://firebase.google.com/docs/ai-logic/pricing ; https://firebase.google.com/docs/ai-logic/quotas ; https://firebase.google.com/docs/ai-logic/app-check ; https://firebase.google.com/docs/app-check/android/play-integrity-provider
- https://logmeal.com/api/pricing/ ; https://www.passio.ai/platform ; https://apis.io/providers/foodvisor/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC12513282/ ; https://arxiv.org/html/2507.07048v2

Backend, autenticação, push e sincronização
- https://render.com/docs/free ; https://render.com/pricing ; https://community.render.com/t/web-service-stops-if-its-not-used-for-a-few-minutes/4692
- https://www.koyeb.com/docs/reference/instances ; https://www.koyeb.com/pricing ; https://docs.fly.io/about/pricing
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://cloud.google.com/run/pricing ; https://docs.cloud.google.com/free/docs/free-cloud-features
- https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
- https://developer.android.com/jetpack/androidx/releases/security ; https://developer.android.com/jetpack/androidx/releases/biometric ; https://developer.android.com/jetpack/androidx/releases/credentials ; https://developer.android.com/jetpack/androidx/releases/room ; https://developer.android.com/jetpack/androidx/releases/work
- https://developer.android.com/identity/passkeys/create-passkeys ; https://developer.android.com/identity/credential-manager/prerequisites
- https://firebase.google.com/pricing ; https://firebase.google.com/docs/cloud-messaging/android/client ; https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://docs.ntfy.sh/publish/
- https://developer.android.com/topic/architecture/data-layer/offline-first ; https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
- https://expressjs.com/en/guide/migrating-5.html ; registry.npmjs.org (express, helmet, express-rate-limit, firebase-admin, @simplewebauthn/server)

Stack, gráficos e design
- https://dl.google.com/android/maven2/androidx/compose/compose-bom/maven-metadata.xml (e os demais `maven-metadata.xml` de work, room, material3, camera, connect-client, play-services-code-scanner, mlkit)
- https://github.com/matinzd/react-native-health-connect/releases ; https://registry.npmjs.org/react-native-health-connect/latest
- https://pub.dev/packages/health ; https://github.com/carp-dk/carp-health-flutter
- https://github.com/patrykandpatrick/vico/releases ; https://github.com/patrykandpatrick/vico/blob/master/vico/compose/src/commonMain/kotlin/com/patrykandpatrick/vico/compose/cartesian/layer/AreaFills.kt ; https://github.com/patrykandpatrick/vico/blob/master/vico/compose/src/commonMain/kotlin/com/patrykandpatrick/vico/compose/cartesian/decoration/Decoration.kt
- https://github.com/PhilJay/MPAndroidChart/releases/tag/v4.0.0 ; https://github.com/PhilJay/MPAndroidChart/blob/master/MPChartExample/src/main/kotlin/com/xxmassdeveloper/mpchartexample/FilledLineActivity.kt ; https://philjay.cc/mpandroidchart/
- https://repo1.maven.org/maven2/io/github/ehsannarmani/compose-charts/maven-metadata.xml
- https://developer.android.com/jetpack/androidx/releases/compose-material3
- https://developer.android.com/develop/ui/compose/text/fonts
- https://fonts.google.com/icons
- https://repo1.maven.org/maven2/com/airbnb/android/lottie-compose/maven-metadata.xml
- https://zenn.dev/timetree/articles/797d8e359edd72 (secundária, ícones)
