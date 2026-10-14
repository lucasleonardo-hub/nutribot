> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# R3 — Peso, progresso, tendências, metas, previsões, gráficos, atividade, treino e saúde

Auditoria somente-leitura do repositório `C:\Users\lucas\Downloads\BOT` (HEAD `2ae910e`, 2026-10-13), para planejar a camada visual Android. Nada foi executado nem alterado; `.env`, `drive-oauth.json`, `oauth-client.json` não foram lidos.

Legenda de estado: **(a)** implementado e coberto por teste em `test/`; **(b)** implementado sem teste; **(c)** parcial; **(d)** só planejado/comentado; **(e)** inexistente.
Legenda de "onde aparece": **P** = bloco no prompt da IA (`PROGRESSO DE PESO` / `visaoPeriodo` / `textoCurto`), **!p** = `!progresso`, **!h** = `!hoje`, **!t** = `!tendencia`, **D** = resumo de domingo (`fecharSemana`), **M** = resumo da meia-noite (`fecharDia` → `visaoDe`), **Pen** = pensamentos 11:30/17:30/21:30, **F** = ferramenta de function calling (`pesagens`, `relogio`, `treino_forca`), **!g** = `!grafico`, **!r** = `!relogio`, **!tr** = `!treino`, **!a** = `!atividade`, **Perfil** = linha do perfil que entra em toda resposta (`perfil.relogio.linha`, `perfil.treino`).

---

## 0. Arquitetura em uma página

| Camada | Arquivo | Papel |
|---|---|---|
| Fonte única do veredito | `progresso.js` (1163 linhas, funções puras) | valida pesagens, tendência 28 d com IC, veredito, comida x balança, leitura do gráfico, alertas, 3 textos, conferência do texto da IA |
| Busca no Mongo + junção | `acompanhamento.js:26-35` (`progressoDe`), `:42-73` (`visaoDe`) | lê 31 dias de refeições/pesagens, chama `analisarProgresso` com `faixaDaMeta` e `perfil.relogio.gastos`; monta prompt (`visaoPeriodo` + `analise.texto` + `proj.textoCurto` + calibração) ou zap (`visaoZap` + `resumoZap` + chegada) |
| Projeção até a etapa | `tendencia.js:135-381` (`projecaoAteMeta`), `:384-395` (`tendenciaCompleta`, 120 d de pesagens, 35 d de comida, sono, Hevy) | passado por semana, ritmo real/comida/esperado, chegada, composição, futuro semana a semana; veredito delegado a `vereditoRitmo` |
| Aposta de domingo | `previsao.js:93-185` (`preverSemana`), `:191-222` (`conferirPrevisao`) | previsão de 7 dias e conferência 7 dias depois |
| Metas | `resumo.js:422-515` (`metaBalancoPara`), `:523-533` (`faixaDaMeta`), `:541-548` (`pesoDeReferencia`), `:554-562` (`tendenciaGorduraIC`), `:571-579` (`proporEtapa`), `:929-973` (`gastoAdaptativo`) | faixa de kcal/dia e ritmo alvo ligados à meta de peso |
| Visão 7/30 dias e balanço | `resumo.js:706-795` (`calcularVisao`), `:798-843` (`visaoPeriodo`), `:846-916` (`visaoZap`), `:623-668` (`previsaoGastoDia`) | o que o `!hoje` e o prompt mostram além do progresso |
| Relógio | `relogio.js` (POST `/relogio` do app Android), `saude.js` (planilha antiga + caminho comum `aplicarDadosSaude`) | pesos, sonos, atividades, FC repouso, HRV → pesagens, indicadores do perfil, Nutri-Saude.md |
| Atividades fixas | `atividades.js` | MET × peso × horas, confirmação por localização |
| Treino | `treino.js` (Hevy), `contexto.js:212-407` (progressão, FORÇA x RECUPERAÇÃO, sugestões de carga) | |
| Calibração aprendida | `calibracao.js` | EMA semanal do viés comida−relógio x balança; correções de foto |
| Gráfico | `graficos.js` | PNG via QuickChart (Chart.js v2), 30 dias |
| Clima | `clima.js` | Open-Meteo; só contexto de conversa |
| Agendamento | `index.js:300-331` | crons |

Fluxo de dados das pesagens (coleção `pesagens`, uma por `{jid, dia}`, `mongo.js:302-310`): (1) app Relógio → `relogio.js:147-192` → `fundir` (90 d) → `saude.js:417-448` grava `fonte:'relogio'`, `hora`, `gordura` para os últimos 60 d a cada envio; (2) planilha do Health Data Export (caminho antigo) → `saude.js:396-410`; (3) peso dito na conversa (`ATUALIZAR peso_kg` ou ferramenta `atualizar_perfil`) → `mensagens.js:1146`, `ferramentas.js:261` **sem `fonte` nem `hora`** (conta como "digitada"); (4) bioimpedância em PDF/imagem da pasta → `pessoas.js:265` com `fonte:'documento'` e data do exame.

---

## 1. `progresso.js` — fonte única do veredito (desde 09/10/2026)

### 1.1 Validação de pesagens — `validarPesagens` (`progresso.js:131-186`) — estado (a)
- Descarta: data inválida/`Date` "consertado" (`diaValido`, l.39-43), data futura, peso fora de 25–300 kg (`PESO_MIN/MAX`, l.28-29), valor ~2,2× a mediana ("parece libra", l.145-150), pesagem a mais de 3 kg ou 4 % da mediana dos vizinhos ±7 d com 3+ vizinhos ("outra pessoa na balança", l.151-160).
- Uma por dia: no dia em que há pesagem `fonte:'relogio'` a digitada sai (l.170-174); várias do relógio viram média, com aviso se diferem > 1 kg (l.177); `hora` preservada só quando há uma pesagem no dia (l.178).
- Avisos (não descartes): salto > 2 kg/dia entre pesagens a ≤ 3 dias (`SALTO_KG_DIA`, l.180-184).
- `preferirPesagem` (l.194-206): entre duas medições do MESMO dia, Samsung Health vence; depois a da manhã (04:00–10:59); depois a mais cedo. Usada em `relogio.js:56,132` e `saude.js:92`.
- Testes: `test/progresso.test.mjs:123,143,156,217,736`.
- Divergência de teto: `relogio.js:52` aceita 25–400 kg, `validarPesagens` descarta > 300 kg (uma pesagem entre 300 e 400 seria gravada e depois descartada em toda conta).

### 1.2 Tendência — `regressao`, `theilSen`, `tendenciaPeso` (`progresso.js:90-289`) — estado (a)
- Regressão linear y = a + b·x (x em dias). Erro-padrão inflado por √((1+ρ)/(1−ρ)); ρ = autocorrelação lag-1 dos resíduos com correção de amostra curta (+(2+6ρ)/n), entre 0 e 0,85; graus de liberdade efetivos n(1−ρ)/(1+ρ) − 2 (piso 8, teto n−2); t de Student bicaudal 95 % tabelada até 30 gl (`T95`, l.52-53). Cobertura medida por simulação: 93 % com ρ 0,5 (l.86-88). Devolve `{ n, a, b, se, gl, ic, dp, rho }`.
- Theil-Sen: mediana das inclinações de todos os pares (l.116-122). `robustoConcorda` = |TS − reg| ≤ max(0,1; se) (l.276).
- Suficiência (l.255): span ≥ 14 d E (≥ 6 pesagens OU ≥ 4 pesagens com span ≥ 21 d). Janela padrão 28 d terminando em `dia` (`JANELA_DIAS`, l.24).
- Direção (l.263): `estavel` se IC inteiro em ±0,1 kg/sem; `subindo`/`caindo` se IC inteiro de um lado do zero; senão `indefinida`; `insuficiente` sem base.
- Campos derivados: `pesoTendenciaInicio/Fim` (a e a+b·span), `mediaInicio/mediaFim` (1ª e última semana), `variacao` (última − primeira crua), `dpResiduo`, `rho`, `gl`.
- Testes: `progresso.test.mjs:39,56,546,582` (cobertura do IC por simulação com semente fixa).

### 1.3 Oscilação curta — `oscilacaoCurta` (`progresso.js:299-311`) — estado (a)
- Últimos 7 d com ≥ 3 pesagens cobrindo ≥ 3 d; variação (última − primeira) comparada ao esperado pela tendência das pesagens ANTERIORES à semana (`tendenciaPeso` com `fim = dia−7`, piso 5 pesagens/10 d; cai na tendência de 28 d se não houver); limiar max(0,6 kg; 1,96·√2·dpResiduo). Alarme falso ~6–12 % (l.293-297). Teste `:72,594`.

### 1.4 Leitura do gráfico — `leituraDoGrafico` (`progresso.js:326-413`) — estado (a)
- Só com tendência suficiente. Janelas 7/14/21/28 d via `tendenciaPeso` com pisos menores (7 d: 4 pesagens/4 d; 14 d: 5/9; 21 d: 6/14) (l.330-335).
- Médias por semana: 4 blocos de 7 d terminando em `dia` (l.337-343).
- Média móvel de 7 d CENTRADA, só em pontos com ≥ 3 d de folga nos dois lados e ≥ 4 vizinhos (l.346-354); pico, vale, "história" (de onde partiu, extremo mais distante, virada ≥ 0,3 kg) (l.357-375); `agora` = média dos últimos 7 d com ≥ 3 pesagens (l.355-356); `recente3` = média dos últimos 3 d com ≥ 2 (l.410-411).
- Divergência de janelas: 21 d (ou 14 d) contra 28 d; dispara com |dif| ≥ 0,15 (21 d) ou 0,2 (14 d) kg/sem (l.376-395), com texto no sentido certo (subida que parou, queda que acelerou, etc.).
- Sem as pesagens fora da manhã (`hora` presente e fora de 04–11 h): tendência recalculada; `relevante` se difere ≥ 0,05 kg/sem (l.396-408).
- Testes: `progresso.test.mjs:827,846,880,893`.

### 1.5 Comida da semana x peso — `comidaRecenteXPeso` (`progresso.js:421-444`) — estado (a)
- Dias completos dos últimos 7 d (≥ 3) contra os anteriores (≥ 5) dentro dos 28 d; `delta` kcal/dia; `efeitoKgSemana = delta×7/7700`; `relevante` se |delta| ≥ 250; `dPesoSemana` = `recente3` − média da penúltima semana da leitura; "coincide" se |dPeso| ≥ 0,3 no mesmo sentido. Teste `:859`.

### 1.6 Dias completos — `diasDeComida` (`progresso.js:453-469`) — estado (a)
- Critério único: 2+ registros com estimativa, ≥ 500 kcal e ≥ 65 % da mediana diária (da janela ou `medianaRef`); só dias FECHADOS (`d < dia`). Usado por `calibrarEnergia`, `gastoAdaptativo` (`resumo.js:931`), `calcularVisao` (`resumo.js:760`), `preverSemana` (`previsao.js:104`), `analiseForca` (`contexto.js:296`). Teste `:282`.
- Divergência interna: `tendencia.js:66-83` (`semanasPassadas`) reimplementa o mesmo critério com a mediana calculada sobre as semanas carregadas (até 35 d, `tendencia.js:388`) em vez dos 28 d; e `resumo.js:978` (`diaCompleto`: 3+ registros OU 1.200+ kcal) é outra régua, usada só para sequência/placar (hábito de registro), documentada como tal em `resumo.js:814-816`.

### 1.7 Comida x balança — `calibrarEnergia` (`progresso.js:479-511`) — estado (a)
- Precisa de ≥ 10 dias completos (`MIN_DIAS_COMIDA`, l.27). Trecho = 1º dia completo até o dia seguinte ao último; tendência do peso SÓ nesse trecho, com a mesma suficiência do veredito (6/14 ou 4/21); se insuficiente devolve `{ insuficiente, motivo }`.
- `balancoBalanca = kgSemana×7700/7` com IC; `gastoReal = ingestão − balancoBalanca` com IC; `gastoRelogio` e `balancoRegistrado` só com ≥ max(5; 60 %) dos dias com relógio > 800 kcal; `ritmoPeloRegistro`; `vies = balancoRegistrado − balancoBalanca` com IC.
- Testes `:87,111,296,812`.

### 1.8 Critério "registro discorda da balança" — `registroDiscordaDaBalanca` (`progresso.js:601-605`) — estado (a)
- |ritmoRegistro − ritmoBalança| em kcal/dia > 250 (`VIES_RUIDO`, l.33) E ritmoRegistro fora do IC 95 % da balança. Usado no alerta (l.674), em `tendencia.js:183` e `previsao.js:84`. Teste `:798`.

### 1.9 Alvo e veredito — `direcaoDoObjetivo`, `alvoKgSemana`, `julgarRitmo`, `vereditoRitmo` (`progresso.js:515-593`) — estado (a)
- Direção: sinal de `faixa.ritmoKgSemana`; `fase === 'manutencao'` → 0; senão regex no texto do objetivo (l.515-523).
- Alvo kg/sem: `faixa.ritmoKgSemana` ou centro da faixa kcal convertido (l.525-530); em `projecaoAteMeta` o `alvoPadrao` é o "necessário pro prazo dentro do saudável" (`tendencia.js:214`).
- Teto saudável (`limite`): +0,5 %/sem do peso de tendência no ganho, −1 %/sem na perda (l.590-591).
- `julgarRitmo` (l.537-579): tolerância max(0,03; 10 % do alvo); `abaixo` se x < a − tol, com p = P_t((a−x)/se); `acima` se x > 1,15·limite; senão `no_alvo` com p unilateral de não estar abaixo e `pRapido` = P(x > 1,15·lim); confiança alta ≥ 97,5 %, média ≥ 80 %, baixa abaixo; `se` piso 0,02; t de Student com os gl da regressão (`pT`, l.67). Status `neutro` sem direção/alvo; `inconclusivo` sem tendência.
- Testes `:314,397,431,504,568,638`.

### 1.10 Meta em kcal, situação da ingestão — `analisarProgresso` (`progresso.js:641-733`) — estado (a)
- `metaKcal` (l.656-668): base `balanca` = r10(round(gastoReal) + faixa.min/max) com `icGasto`; senão base `relogio` = média dos gastos > 800 kcal dos 28 d (≥ 7 dias) + faixa. `folga` = max(100; meia largura do IC do gasto). `situacaoIngestao` = abaixo/dentro/acima com a folga; `naFaixa` = dentro com margem fixa de 100 (senão "compatível").
- `pesoEsperadoHoje` e `desvioKg` (l.646-647): linha do alvo partindo do peso de tendência no início.
- `ingestaoRecente`: média dos dias completos dos últimos 7 d (l.653-654).
- `conselhoDeComida` (l.612-631): frase da conclusão; nunca manda comer mais quem está `acima`; avisa janelas diferentes quando a comida começa ≥ 5 d depois da tendência.
- Testes `:619,638`.

### 1.11 Alertas e limitações (`progresso.js:673-719`) — estado (a)
Tipos: `registro_acima_da_balanca` / `registro_abaixo_da_balanca` (com rótulo "REGISTRO DIZ SUPERÁVIT/DÉFICIT, BALANÇA NÃO ACOMPANHA" quando o balanço registrado já cobre a faixa e o veredito é `abaixo`), `curto_vs_longo`, `janelas_divergem`, `dados_insuficientes`, `tendencia_fragil`, `meta_mudou` (campos `perfil.atualizacoes.{metaPeso,metaPrazo,objetivo,ritmo,metaModo}` com data dentro da janela), `pesagem_suspeita` (avisos), `pesagem_descartada`. Limitações: dp da balança, "calorias são estimativas", dias incompletos fora, período curto (< 21 d), pesagens fora da manhã relevantes. Testes `:87,111,172,191,827`.

### 1.12 Textos (`progresso.js:752-913`) — estado (a)
- `vereditoCurto` (l.752): uma linha, usada na correção da IA e no `!hoje`.
- `textoPrompt` (l.759-804): bloco `PROGRESSO DE PESO` com período, tendência, LEITURA DO GRÁFICO, COMIDA DA SEMANA x PESO, alvo, VEREDITO, comida x balança, meta, ALERTAS, LIMITES, CONCLUSÃO e a instrução "COMO RESPONDER".
- `textoZap` (l.807-895): `!progresso` completo (sem o alerta `janelas_divergem`, que já está na Leitura).
- `resumoZap` (l.898-913): `!hoje` (tendência+IC, alvo→status com probabilidade, meta, alertas principais, janela recente, comida da semana).
- Testes `:431,504,619`.

### 1.13 Pergunta de progresso e conferência da IA (`progresso.js:951-1163`) — estado (a)
- `pareceProgresso`/`rotaPerguntaProgresso` (l.951-975): regexes com fronteira de palavra Unicode (`B`, l.925); exclui treino, outra pessoa, outro assunto, foto/áudio, contestação, meta-conversa, refeição em andamento, relato de refeição e correção. Usado em `mensagens.js:901`. Testes `:275,653`.
- `conferirTextoProgresso` (l.1074-1143): por frase, por oração (separadores l.1020), ignora negação/dúvida/finalidade (`RE_NAO_AFIRMA`, l.1022), hipótese (l.1024), pergunta, janela curta (l.986), prato, treino; confere a direção contra a janela que a própria frase diz (`refDe`, l.1100-1104: < 10 d não confere, 10–17 → 14 d, 18–24 → 21 d, ≥ 25 ou nada → 28 d). Tipos: `direcao_oposta`, `direcao_sem_base`, `ritmo_oposto`, `ritmo_sem_base`, `excesso_sem_balanca`. Aplicada em `mensagens.js:1019-1029` (refaz só a parte de peso, `problemaDeProgresso`; em análise de prato tira só a frase, `tirarFrases`) e `mensagens.js:1058` (segunda checagem). Testes `:191,249,678,725,893`.

---

## 2. Módulos satélites

### 2.1 `tendencia.js` — projeção até a etapa — estado (a) (`test/tendencia.test.mjs:31-133`, `progresso.test.mjs:431,798,812`)
- `semanasPassadas` (l.47-127): até 12 semanas de 7 d contadas de trás, só as com pesagem: peso/gordura/magra médios, kcal (dias completos), gasto (> 800), balanço (dias com os dois), treinos (Hevy), sono. Devolvido ao `!tendencia`, ao domingo e a `calibrarNoDomingo`.
- `projecaoAteMeta` (l.135-381): exige ≥ 4 pesagens validadas; `ritmoReal` = regressão com IC (`regressaoComIC` de progresso.js) nas pesagens dos últimos 28 d (ou últimas 6, l.149-154); `magraSem/gorduraSem/gorduraPpSem` por regressão simples nas pesagens com gordura (≥ 4) (l.155-158); `pesoAtual` = `pesoDeReferencia` (l.161-162); `ritmoBalanco` = média do balanço das últimas 3 semanas com ≥ 3 dias, corrigido por `corrigirBalanco` (EMA da calibração, só com confiança ≥ 0,5) (l.165-170); `ritmoEsperado` = média ponderada 1/σ² (σ balança = max(se; 0,08), σ comida = 0,25) SÓ quando não discordam pelo critério único no trecho de 28 d (l.180-197), senão balança; `incerteza` = √(σ² + (|real−balanço|/4)²) entre 0,06 e 0,5 (l.198-200); `necessario` = falta/semanas até o prazo, `necessarioSaudavel` limitado por `faixaSaudavel` (l.202-210); veredito via `vereditoRitmo` (l.214); `chegada` só com tendência suficiente e ritmo ≥ 0,03 na direção certa, ≤ 104 semanas (l.218-222); `chegadaSaudavel`, `janelaChegada` (±incerteza) (l.223-237); `composicao` = primeira x última semana com bioimpedância, `parteMagra` (l.239-247); `gorduraNaMeta` (l.248); `futuro` semana a semana até max(prazo, chegada, 4) ≤ 20 (l.267-273); `ajusteKcal` = (alvo − ritmo medido)×7700/7 (l.277-278); avisos sono < 6h30, < 2,5 treinos/sem, balança x comida ≥ 0,2 (l.281-296); `status` ok/abaixo/acima/acima_gordura/neutro com `gorduraSubindo` (> 0,2 pp/sem) e `magraCaindo` (< −0,15) (l.313-334); textos `texto`, `textoCurto`, `zap`, `resumoZap`.
- Aparece: !t (`comandos.js:550`), D (`dia.js:372`), P (`acompanhamento.js:54-64`, `textoCurto`), F `pesagens` (`ferramentas.js:221`).

### 2.2 `previsao.js` — aposta de domingo e legado
- `registroXBalanca` (l.81-85) (a): mesma conta do alerta, reaproveita `analise.energia` quando vem.
- `preverSemana` (l.93-185) (a, `hoje-mes.test.mjs:689,711`, `progresso.test.mjs:463,481`): método 1 = média (comida − relógio) nos dias completos da semana com relógio > 800 (≥ 3 dias) ×7/7700; se discorda, subtrai `vies` da calibração (`base: 'balanço corrigido pela balança'`, confiança média se meia largura do IC do viés ≤ 300, senão baixa); método 2 = regressão simples das pesagens validadas de 21 d (≥ 4 pontos, ≥ 10 d) (l.53-65); pesagem inicial = mais próxima de `dia` em ±3 d; divisão magra/gordura por `fracaoMagra` (proteína ≥ 1,6 g/kg e treinos ≥ 2 → 45 % magra no ganho) (l.67-73); confiança alta com ≥ 5 dias de balanço.
- `conferirPrevisao` (l.191-222) (a, `hoje-mes.test.mjs:729`): erro ≤ 0,3 cheio, ≤ 0,7 perto, senão errou; composição real pela bioimpedância nas duas pontas. Salva/lê em `previsoes` (`mongo.js:364-382`).
- `linhaDeTendencia` (l.234-305) (a, `resumo.test.mjs:132`): legado com veredito próprio (limiares ±0,05, alvo −0,12, faixa.max×1,15) **sem IC e sem validação de pesagens**; hoje é só fallback quando `tendenciaCompleta` devolve null (< 4 pesagens em 120 d) em `comandos.js:550`, `dia.js:372`, `acompanhamento.js:55`, `ferramentas.js:222`, e fonte de `magraSem` para o bloco de força em `mensagens.js:175` (uso em produção).
- `avaliarRitmo` (l.313-344) e `projetarMeta` (l.350-395): exportadas e testadas (`hoje-mes.test.mjs:760,774`) mas **não chamadas em produção** (grep: só definição e comentário em `dia.js:361-362`). Estado: código morto testado; o GUIA ainda descreve `projetarMeta` ("Sem meta, ela projeta a tendência em 1, 3 e 6 meses", `GUIA-PASSO-A-PASSO.md:186`) — divergência doc x código.
- `faixaSaudavel` (l.307-310) (a): ganho 0,25–0,5 %/sem, perda 0,5–1 %/sem.

### 2.3 `calibracao.js` — estado (a) (`test/calibracao.test.mjs:10-64`, `progresso.test.mjs:362`)
- `viesDaSemana` (l.20-24): balanço da semana − ritmoBalança×7700/7, limitado a ±1.200; semana só com ≥ 4 dias de balanço.
- `atualizarCalibracaoEnergia` (l.30-46): EMA α 0,3 sobre a última semana FECHADA, viés final limitado a ±600, confiança n/4 (1 com 4 semanas), histórico de 12; roda no domingo (`calibrarNoDomingo`, l.159-166, chamada em `dia.js:377` com `tend.ritmo.real`).
- `corrigirBalanco` (l.49-54): aplica −viés×confiança só com confiança ≥ 0,5 (usado em `tendencia.js:168`).
- `descreverCalibracaoEnergia` (l.59-69): **não vai mais ao prompt** (`acompanhamento.js:63` chama `blocoCalibracao` com `energia:false`); fica só a calibração das correções de foto (`estatisticasCorrecoes`/`descreverCorrecoes`, l.86-123).
- Observação: coexistem DOIS estimadores do mesmo viés (EMA semanal do perfil x `calibrarEnergia` do trecho de 28 d com IC). O prompt, o `!progresso` e a aposta usam o segundo; a projeção do `!tendencia` (`ritmoBalanco`) usa o primeiro. Documentado como escolha em `GUIA:240`.

### 2.4 `graficos.js` — estado (a) (`hoje-mes.test.mjs:244` cobre `configGrafico`; `renderizar` sem teste, depende de rede)
- Um único gráfico, PNG 1000×520 via POST em `https://quickchart.io/chart` (Chart.js v2, `QUICKCHART_URL` opcional), timeout 20 s (l.63-79). Conteúdo (l.21-60): barras de kcal comidas por dia (30 d, eixo esquerdo), linha "Gasto (relógio)", faixa "Meta (mín/máx)" preenchida (vem de `gastoAdaptativo(...).alvo`, `comandos.js:462`, `dia.js:443`), linha "Massa magra (kg)" (≥ 3 pontos com gordura) e "Peso (kg)" (eixo direito, `suggestedMin/Max` ±1,5), título com dias com registro e proteína média. **Pesagens cruas** (não passam por `validarPesagens`; `pesoPorDia` pega a última do dia). Não há gráfico de tendência/IC, nem de sono, passos, FC, treino. Onde: !g (`comandos.js:447-468`, também `!grafico todos`) e D (`dia.js:438-449`, para quem tem ≥ 5 registros+pesagens).

### 2.5 `resumo.js` — metas e visão
- `metaBalanco` (l.410-415) (a): faixa genérica por objetivo (+250..+500 ganho; −600..−300 perda; ±150).
- `metaBalancoPara` (l.422-515) (a, `resumo.test.mjs:70,103`, `progresso.test.mjs:342,751`): ver §3.
- `faixaDaMeta` (l.523-533) (a): ponto único de entrada — pesagens validadas → `pesoDeReferencia` → `tendenciaGorduraIC` dos 28 d (freio só com IC inteiro de um lado do zero) → `metaBalancoPara`. Chamada por `progressoDe`, `calcularVisao` (l.754), `gastoAdaptativo` (l.934), `tendenciaCompleta`, `!tendencia`, domingo, `blocoForcaDe`.
- `pesoDeReferencia` (l.541-548) (a): peso de tendência (fim da regressão) → média das pesagens de 7 d (≥ 2) → última → perfil.
- `tendenciaGorduraIC` (l.554-562) (a): regressão (a mesma com autocorrelação) da gordura %, ≥ 6 leituras e ≥ 14 d, em pp/28 d com IC.
- `proporEtapa` (l.571-579) (a): próxima etapa = ⌈p+3,5⌉ (ganho) ou ⌊p−3,5⌋, prazo = |Δ|/(0,5 % ou 0,75 % do peso) + 2 semanas.
- `gastoAdaptativo` (l.929-973) (a, `hoje-mes.test.mjs:206`): status `calibrado` (gasto, IC, folga, alvo, trecho) / `relogio` (provisória: média 28 d > 800 + faixa) / `calibrando`; usa `calibrarEnergia` (mesma conta do `!progresso`).
- `previsaoGastoDia/Amanha` (l.619-668) (a, `hoje-mes.test.mjs:385`): média das últimas 4 ocorrências do mesmo dia da semana (≥ 2) ou últimos 14 d, ×fator = gastoReal/relógio28 limitado 0,7–1,6 quando calibrado; alvo = previsto + faixa; `previsaoSemana` (l.693-704) gera a meta por dia do `!plano` (`plano.test.mjs:71`). **Docstring desatualizada** em `resumo.js:616` ("limitada a 0,8-1,25"); o código (l.642) e `Metodos-de-Calculo.md:103-105` dizem 0,7–1,6.
- `calcularVisao` (l.706-795) (a, `hoje-mes.test.mjs:145,422`, `progresso.test.mjs:783`): 7 e 30 dias FECHADOS (comida) e até hoje (peso): dias com registro/estimativa, kcal e proteína médias, peso início/fim cru e médias das metades; `sequencia` (`sequenciaDe`, l.984-999, régua de hábito); `meta` = `gastoAdaptativo`; `balanco`: hoje (incompleto), último dia completo, `media7` pelo relógio (dias completos com relógio > 800), `ingestao7` contra a meta com folga, `situacaoRelogio`, `situacao`, `naFaixa`; `amanha`; `metaP` = 1,6–2,2 g/kg.
- `placarSemana` (l.1002-1020) (a): dias completos (régua de hábito) ×2 + dias com proteína ≥ 1,6 g/kg; usado nas notas de voz (`dia.js:478`).

### 2.6 `saude.js` / `relogio.js` — relógio e indicadores de saúde
- Entrada A (app Android `android/app/src/main/java/br/nutribot/relogio/Leitor.kt`, POST `/relogio` a cada 15 min): `normalizarEnvio` (`relogio.js:47-116`) (a, `hoje-mes.test.mjs:290`): pesos (kg 25–400, gordura, altura, magra, fonte, hora local, `preferirPesagem`), sonos por noite (leve/profundo/REM/acordado; sessão mais longa define deitou/levantou; sem fases usa deitado−acordado), dias (passos = maior valor, calorias totais > 300, `fcRepouso` 30–120, `hrv` > 0), treinos (nome, min, hora, fonte, kcal, fcMedia). `fundir` (l.125-134): por dia, novo vence, 90 d; para pesos aplica `preferirPesagem` entre horas diferentes.
- Entrada B (planilha Health Data Export via Sheets API): `interpretarAbas` (`saude.js:63-161`) (a, `hoje-mes.test.mjs:88`): abas Body/Sleep/Activity; não traz FC de repouso nem HRV.
- Caminho comum `aplicarDadosSaude` (`saude.js:417-448`) (b — efeitos no Mongo/Drive sem teste): `resumoSaude` (texto do dossiê, l.222-331, testado), grava pesagens dos últimos 60 d (`fonte:'relogio'`, `hora`), atualiza `perfil.peso` se a medição é mais nova que `atualizacoes.peso`, salva `perfil.relogio` = `indicadoresRelogio` (l.337-387, testado) + `somarGastosExtras`, escreve `Nutri-Saude.md` na pasta da pessoa.
- `recuperacao` (`saude.js:185-220`) (a, `hoje-mes.test.mjs:325`): FC de repouso dos últimos 14 d; `acima` se ≥ média+5 por 2+ dias; `abaixo` se ≤ média−5; HRV reforça se < 80 % da média de ≥ 3 leituras.
- Onde aparece: Perfil (`perfil.relogio.linha`: peso/gordura mais recentes, última noite, média de sono 14 noites, deita/levanta médios, passos/dia 7 d, treinos7d, FC repouso/média/sinal), dossiê (`resumoSaude`), !r (`comandos.js:395-419`), Pen (`pensamentos.js:46`), F `relogio` (`ferramentas.js:79`), FORÇA x RECUPERAÇÃO (`contexto.js:282,327`), `tendencia.js` (sono por semana), `previsao.js:110` (treinos7d).

### 2.7 `atividades.js` — atividades fixas sem relógio — estado (a) (`plano.test.mjs:160`, `progresso.test.mjs:333,907`)
- `kcalAtividade` (l.18) = MET×peso×min/60 (bruto); `kcalLiquida` (l.61) = bruto − 1 MET (só o que passa do repouso, porque o relógio já conta o basal); `somarGastosExtras` (l.64-72) soma o líquido em `relogio.gastos[dia]` a cada sincronização; `avaliarPresenca` (l.36-54) exige ≥ 2 pontos no raio de 300 m; `verificarAtividades` cron `7,22,37,52 * * * *` (`index.js:305`); pendente sem resposta vira "não feita" no fechamento (`fecharPendentes`, `dia.js:134`); relato na conversa via linha oculta `ATIVIDADE` (`registrarRelato`, l.174-195, desfaz o líquido anterior). Onde: P (bloco ATIVIDADES FIXAS), roteiro, !a (`atividadesZap`).

### 2.8 `treino.js` + `contexto.js` — Hevy
- `sincronizarTreinos` (`treino.js:64-82`) (b): até 6 páginas de 10 treinos, 28 d, coleção `treinos`; chave por pessoa em `HEVY_CHAVES`; sincroniza no máximo 1×/h (`perfis.js:16-23`).
- `analisarTreinos` (`treino.js:97-160`) (b — **sem teste em `test/`**): 4 semanas; por semana: sessões, séries válidas (exclui warmup), volume kg×reps, séries por grupo (secundário conta 0,5), RPE médio, melhor 1RM Epley por exercício; `variacaoVolume` contra a média das semanas anteriores com treino; `progressao` = 1RM desta semana x melhor das 3 anteriores. Onde: Perfil (`linhaTreino`), D (`blocoTreino`, `dia.js:426`), !tr (`treinoZap`), F `treino_forca`, `previsao.js:110,174` (treinos e carga subindo).
- `progressaoForca` (`contexto.js:212-248`) (a, `lugares.test.mjs:370,401`): 8 semanas, exercícios com ≥ 3 sessões e carga > 0; melhor carga por sessão; `parado` ≥ 2 semanas sem subir carga ou reps; `caindo`.
- `analiseForca`/`blocoForcaRecuperacao` (`contexto.js:270-333`) (c — leitura testada indiretamente; a função que lê Mongo não): sono médio 7 noites, FC repouso/sinal, kcal/proteína dos 7 d fechados completos contra a faixa (com `folga`), massa magra/sem (de `linhaDeTendencia`!), suplementos (creatina/whey/hipercalórico, l.250-265), LEITURA na ordem sono → comida → composição → estímulo; `podePuxar`. Onde: P só quando `falaDeTreino` (`mensagens.js:902`), Pen (`pensamentos.js:37`), D (`dia.js:378`), reflexão.
- Sugestões de carga (`contexto.js:337-407`) (a, `lugares.test.mjs:414`): no domingo até 3 exercícios parados; conferidas contra o Hevy; resultado no domingo seguinte (`dia.js:381-399`).
- Pré/pós-treino x refeições (`contexto.js:60-205`) (a, `lugares.test.mjs:308,328,360`).

### 2.9 `clima.js` — estado (a) (`hoje-mes.test.mjs:874,891`)
- Para quê: só contexto de conversa ("com esse frio a sopa cai bem"), nunca entra em conta nenhuma. Open-Meteo sem chave; cache 30 min por cidade; estação por hemisfério. Não é indicador de saúde.

### 2.10 Pergunta "quem usa o quê" — mapa de chamadas
- `visaoDe` (prompt completo): `mensagens.js:874` (só nas respostas com `motivo`: foto, áudio, comando, pergunta, menção, assunto dela), `dia.js:157` (M), `reflexao.js:98`, `comandos.js:75`.
- `progressoDe`: `acompanhamento.js:51`, `dia.js:357` (D, antes da aposta), `comandos.js:566` (!p), `ferramentas.js:221` (F).

---

## 3. Metas — como são definidas e mudam

| Campo do perfil | Origem | Quem pode mudar | Onde é lido |
|---|---|---|---|
| `objetivo` (texto livre; regex ganhar/perder) | onboarding; linha oculta `ATUALIZAR` da IA; ferramenta `atualizar_perfil` | a própria pessoa falando no grupo (a IA interpreta); não há comando `!meta` | `direcaoDoObjetivo`, `metaBalancoPara`, `projecaoAteMeta` |
| `metaPeso` (kg, 25–400) | `ATUALIZAR meta_peso_kg` (`perfis.js:88-89`); `proporEtapa` no domingo (`dia.js:406-418`) | pessoa (via IA) ou o sistema (etapa batida) | `metaBalancoPara`, `projecaoAteMeta` (`falta`, `chegada`) |
| `metaPrazo` (AAAA-MM-DD; AAAA-MM vira dia 28) | `ATUALIZAR meta_prazo` (`perfis.js:90-91`); `proporEtapa` | idem | `necessario`, `prazoApertado`, `marcaPrazo` |
| `ritmo` (`maximo|medio|minimo`) | `ATUALIZAR ritmo` (`perfis.js:93-94`) | pessoa | ponto da faixa saudável (l.458); no `maximo` o prazo é só referência (l.463-467) |
| `metaModo` (`etapa|final`) | `ATUALIZAR meta_modo` (`perfis.js:97-98`) | pessoa | etapa não é teto (l.455-456), não desacelera a 1 kg (l.496-501), domingo propõe a próxima |
| `sem_meta_peso: true` | `ATUALIZAR` (`perfis.js:99-103`) | pessoa | zera `metaPeso/metaPrazo` |
| `atualizacoes.{campo}` (data) | `aplicarAtualizacao` (`perfis.js:71-75`) | automático | alerta `meta_mudou` (`progresso.js:705-709`) |

- Não há kcal nem proteína "alvo" guardadas no perfil: a faixa de kcal/dia é recalculada a cada uso (`faixaDaMeta` → `metaBalancoPara`), em módulo ±100 kcal em volta do centro = ritmo×7700/7, limitada a +100..+700 (ganho) ou −900..−100 (perda) (l.504-509); proteína = 1,6–2,2 g/kg do peso do perfil (`resumo.js:719`), 1,6 g/kg mínimo no placar e no bloco de força (`contexto.js:300`).
- Histórico de mudanças: só a ÚLTIMA data por campo em `perfil.atualizacoes`; **não há histórico de valores** (o alerta diz "meta alterada em dd/mm" mas não sabe o valor anterior; `progresso.test.mjs:172` cobre). A etapa batida grava `atualizacoes.metaPeso = dia` (`dia.js:413`).
- Fases da faixa (`fase`): `curso`, `aproximacao` (≤ 1 kg da meta final: ritmo/2), `manutencao` (≤ 0,3 kg, meta final: ±150), `etapa_batida` (segue no ritmo até o domingo). `prazoApertado` quando o necessário passa do teto saudável ou o freio da gordura baixa o ritmo.
- Freio da gordura: `gorduraTend` ≥ 1,5 pp/28 d → `minimo`; ≥ 0,8 e pedido `maximo` → `medio`; ≤ −0,5 → só texto "ganho limpo" (l.434-438); vale com prazo e com `minimo` pedido (l.488-494). Só liga com IC significativo (`faixaDaMeta`, l.530-531).
- Rótulo da fonte da faixa: `fonte: 'meta' | 'ritmo' | 'objetivo'`; `!hoje` só mostra "Ritmo alvo" com `meta` ou `ritmo` (`resumo.js:868,876`).
- Confirmado contra `Metodos-de-Calculo.md:53-58` (alvo, peso de tendência, freio, etapa) — batem.

---

## 4. CATÁLOGO DE INDICADORES

Unidades: kg, kg/sem, kcal/dia, pp (pontos percentuais), min, bpm, ms. "IC" = intervalo de 95 %. Fonte: **B** = balança/bioimpedância (coleção `pesagens`), **R** = relógio (`perfil.relogio.gastos`, `saude_relogio`), **C** = refeições registradas (`refeicoes.estimativa`), **H** = Hevy (`treinos`), **L** = localização (`locais_brutos`), **Pf** = perfil.

| # | Indicador | módulo:função | Unidade | Janela | Método | Incerteza | Fonte | Onde aparece | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Pesagens válidas / descartadas / avisos | progresso:validarPesagens (131) | lista | todas as carregadas (31 d no prompt, 120 d no !t) | §1.1 | — | B | !p (contagem), P, alertas `pesagem_*` | a |
| 2 | Tendência do peso (kgSemana) | progresso:tendenciaPeso (227) | kg/sem | 28 d até hoje | regressão linear | IC 95 % com ρ e gl efetivos; `seKgSemana`; `dpResiduo` | B | P, !p, !h, !t (`ritmoReal`), D, F | a |
| 3 | Theil-Sen / `robustoConcorda` | progresso:theilSen (116) | kg/sem | 28 d | mediana das inclinações | — | B | P, !p, alerta `tendencia_fragil` | a |
| 4 | Direção (`subindo/caindo/estavel/indefinida/insuficiente`) | progresso:tendenciaPeso (263) | categoria | 28 d | IC inteiro vs 0 e vs ±0,1 | herda o IC | B | P, !p, !h, conferência | a |
| 5 | Peso de tendência hoje / no início | progresso:tendenciaPeso (285-286) | kg | 28 d | a + b·x | — | B | P, !p, meta (`pesoDeReferencia`) | a |
| 6 | Primeira/última pesagem e variação crua | progresso:tendenciaPeso (239-241) | kg | 28 d | diferença simples | nenhuma (dito como "não é ritmo") | B | P, !p | a |
| 7 | Média da 1ª e da última semana | progresso:tendenciaPeso (265-266) | kg | 7 d nas pontas | média | — | B | P, !p | a |
| 8 | ρ (autocorrelação), gl efetivos | progresso:regressao (108-110) | — | 28 d | lag-1 dos resíduos | — | B | só interno | a |
| 9 | Oscilação curta | progresso:oscilacaoCurta (299) | kg em N dias | 7 d vs tendência anterior | §1.3 | limiar 1,96·√2·dp | B | alerta `curto_vs_longo` (P, !p, !h) | a |
| 10 | Tendência por janela 7/14/21/28 d | progresso:leituraDoGrafico (330) | kg/sem | 7/14/21/28 d | regressão por janela | IC por janela | B | P, !p (Leitura), !h (só se diverge) | a |
| 11 | Médias por semana (4) | progresso:leituraDoGrafico (337) | kg | 4×7 d | média | — | B | P, !p | a |
| 12 | Média móvel 7 d centrada, pico, vale, história | progresso:leituraDoGrafico (346-375) | kg | 28 d (sem as pontas) | média ±3 d, ≥ 4 pontos | — | B | P, !p | a |
| 13 | "Agora" (média 7 d) e `recente3` | progresso:leituraDoGrafico (355,410) | kg | 7 d / 3 d | média | — | B | P, !p, comidaRecenteXPeso | a |
| 14 | Divergência de janelas | progresso:leituraDoGrafico (376) | kg/sem (dif) | 21 (ou 14) vs 28 d | limiar 0,15/0,2 | IC da janela curta | B | alerta `janelas_divergem` (P), !p, !h | a |
| 15 | Tendência sem pesagens fora da manhã | progresso:leituraDoGrafico (396) | kg/sem | 28 d | regressão sem `hora` ∉ 04–11 h | — | B (com `hora`) | P, !p, limitação | a |
| 16 | Comida recente x anteriores (`delta`, `efeitoKgSemana`, `dPesoSemana`) | progresso:comidaRecenteXPeso (421) | kcal/dia; kg/sem; kg | 7 d vs 8–28 d | médias de dias completos; ×7/7700 | — (viés das fotos se cancela) | C, B | P, !p, !h (se relevante) | a |
| 17 | Dias completos / incompletos / mediana | progresso:diasDeComida (453) | lista; kcal | 28 d fechados | §1.6 | — | C | limitação, metas | a |
| 18 | Ingestão média no trecho (`energia.ingestao`) | progresso:calibrarEnergia (483) | kcal/dia | 1º→último dia completo | média | — | C | P, !p, !h (meta adaptativa) | a |
| 19 | Balanço pela balança (`balancoBalanca`) | progresso:calibrarEnergia (487) | kcal/dia | trecho | kgSemana×1100 | `icBalanca` | B | P, !p | a |
| 20 | Gasto real implícito (`gastoReal`) | progresso:calibrarEnergia (503) | kcal/dia | trecho | ingestão − balanço balança | `icGasto` | C+B | P, !p, !h (`gastoAdaptativo.gasto`), !g (meta) | a |
| 21 | Gasto do relógio no trecho (`gastoRelogio`) | progresso:calibrarEnergia (491) | kcal/dia | trecho, dias > 800 | média | — | R | P, !p, !h | a |
| 22 | Balanço registrado (`balancoRegistrado`) e `ritmoPeloRegistro` | progresso:calibrarEnergia (492,507) | kcal/dia; kg/sem | trecho | comida − relógio | — | C+R | P, !p | a |
| 23 | Viés registro x balança (`vies`) | progresso:calibrarEnergia (493) | kcal/dia | trecho | balancoRegistrado − balancoBalanca | `icVies` | C+R+B | alertas `registro_*` (P, !p, !h), aposta D | a |
| 24 | Registro discorda da balança (bool) | progresso:registroDiscordaDaBalanca (601) | bool | trecho | > 250 e fora do IC | — | — | alerta, !t (`discordante`), aposta | a |
| 25 | Direção do objetivo (±1/0) | progresso:direcaoDoObjetivo (515) | — | — | faixa ou regex | — | Pf | veredito | a |
| 26 | Alvo kg/sem | progresso:alvoKgSemana (525); resumo:metaBalancoPara (`ritmoKgSemana`) | kg/sem | — | §3 | — | Pf+B | P, !p, !h, !t | a |
| 27 | Teto saudável (`limite`) | progresso:vereditoRitmo (591) | kg/sem | — | 0,5 %/1 % do peso de tendência | — | B | veredito `acima` | a |
| 28 | Veredito do ritmo (`status`, `prob`, `confianca`, `pRapido`) | progresso:julgarRitmo (537) | categoria; % | 28 d | t de Student unilateral | probabilidade explícita | B+Pf | P, !p, !h, !t, D, F, conferência | a |
| 29 | Peso esperado hoje pela linha do alvo / desvio | progresso:analisarProgresso (646-647) | kg | 28 d | início + alvo×dias/7 | — | B+Pf | P, !p | a |
| 30 | Meta em kcal registradas (`metaKcal.min/max`, `base`, `folga`) | progresso:analisarProgresso (656-668); resumo:gastoAdaptativo (929) | kcal/dia | trecho (balança) ou 28 d (relógio) | gasto + faixa; r10 | `folga` = max(100; IC/2) | C+B / R | P, !p, !h, !g, FORÇA x RECUPERAÇÃO | a |
| 31 | Ingestão recente (7 d) e situação (`abaixo/dentro/acima`, `naFaixa`) | progresso:analisarProgresso (653,669-670); resumo:calcularVisao (773-776) | kcal/dia; categoria | 7 d completos | média vs meta com folga | folga | C | P, !p, !h, conclusão | a |
| 32 | Alertas (9 tipos) | progresso:analisarProgresso (673-711) | texto | — | §1.11 | — | — | P (todos), !p (menos janelas), !h (3 principais) | a |
| 33 | Limitações | progresso:analisarProgresso (713-719) | texto | — | — | — | — | P, !p | a |
| 34 | Conclusão + conselho de comida | progresso:analisarProgresso (722-725), conselhoDeComida (612) | texto | — | regras por status | — | — | P, !p | a |
| 35 | Veredito curto | progresso:vereditoCurto (752) | texto | 28 d | — | — | — | !h (indireto), correção da IA | a |
| 36 | Contradições no texto da IA | progresso:conferirTextoProgresso (1074) | lista | — | §1.13 | — | — | `mensagens.js:1019-1058` | a |
| 37 | Semanas passadas (peso, gordura, magra, kcal, gasto, balanço, treinos, sono por semana) | tendencia:semanasPassadas (47) | kg; %; kcal/dia; n; min | até 12 semanas | médias por semana | — | B+C+R+H | !t, D, P (`textoCurto` não lista semanas), F | a |
| 38 | Ritmo real (`ritmo.real`) e `seSem` | tendencia:projecaoAteMeta (149-154) | kg/sem | 28 d (ou 6 últimas) | regressão com IC | `seSem` | B | !t, D, P, F | a |
| 39 | Massa magra/sem, gordura kg/sem, gordura pp/sem | tendencia:projecaoAteMeta (155-158); previsao:linhaDeTendencia (266-268) | kg/sem; pp/sem | 28 d (≥ 4 com gordura) | regressão simples | nenhuma | B (bioimpedância) | !t, D, FORÇA x RECUPERAÇÃO (`magraSem` via linhaDeTendencia) | a |
| 40 | Ritmo pela comida (`ritmo.balanco`, `balancoDia`, `balancoCorrigido`) | tendencia:projecaoAteMeta (165-170) | kg/sem; kcal/dia | últimas 3 semanas com ≥ 3 dias | média ×7/7700, EMA da calibração | σ fixo 0,25 | C+R | !t, D, P | a |
| 41 | Ritmo esperado e `incerteza` | tendencia:projecaoAteMeta (180-200) | kg/sem | — | média ponderada 1/σ² se concordam | √(σ²+disc²), 0,06–0,5 | B+C+R | !t, D, P | a |
| 42 | Peso atual (`pesoAtual`, rótulo) e `falta` | tendencia:projecaoAteMeta (161,206); resumo:pesoDeReferencia (541) | kg | 28 d / 7 d | tendência → média 7 d → última → perfil | — | B | !t, D, P, meta | a |
| 43 | Necessário pro prazo / `necessarioSaudavel` / `prazoInviavel` | tendencia:projecaoAteMeta (205-210,301) | kg/sem; bool | até `metaPrazo` | falta/semanas | — | Pf+B | !t, D, P | a |
| 44 | Chegada (`chegada`, `janelaChegada`, `chegadaSaudavel`) | tendencia:projecaoAteMeta (218-237) | data; semanas | ≤ 104 sem | falta/ritmo esperado ± incerteza | janela cedo/tarde | B+C | !t, D, P, !h (linha "No ritmo esperado…") | a |
| 45 | Composição da mudança (`dPeso`, `dMagra`, `dGord`, `parteMagra`, gordura de→para) | tendencia:projecaoAteMeta (239-247) | kg; % | 1ª vs última semana com bioimpedância | diferença de médias semanais | nenhuma (BIA ±3–5 pp absoluto) | B | !t, D, P | a |
| 46 | Gordura projetada na meta (`gorduraNaMeta`) | tendencia:projecaoAteMeta (248) | % | até a chegada | gordura atual + pp/sem×semanas, 4–45 % | nenhuma | B | !t, D | a |
| 47 | Futuro semana a semana (`projetado`, `banda`, `linhaAlvo`, `marcaPrazo`) | tendencia:projecaoAteMeta (267-273) | kg | 4–20 semanas | pesoAtual + ritmo×i | banda = incerteza×i | B+C | !t, D | a |
| 48 | Ajuste kcal pro alvo (`ajusteKcal`) | tendencia:projecaoAteMeta (277-278) | kcal/dia | — | (alvo − ritmo medido)×1100 | — | B | só no objeto (não impresso) | b |
| 49 | Avisos (sono < 6h30, < 2,5 treinos/sem, balança x comida ≥ 0,2) | tendencia:projecaoAteMeta (281-296) | texto | 2 últimas semanas | — | — | R+H+B+C | !t, D, P | a |
| 50 | Status da linha (`ok/abaixo/acima/acima_gordura/neutro`) | tendencia:projecaoAteMeta (299-334) | categoria | 28 d | tradução do veredito + gordura/magra | herda | — | !t (ícone), D | a |
| 51 | Aposta de domingo (`deltaKg`, `pesoPrevisto`, `base`, `confianca`, `magraKg`, `gorduraKg`) | previsao:preverSemana (93) | kg | próximos 7 d, a partir da semana corrente | §2.2 | confiança alta/média/baixa; sem IC numérico | C+R (ou B) | D; coleção `previsoes` | a |
| 52 | Conferência da aposta (`realKg`, `erroKg`, `acerto`, composição real) | previsao:conferirPrevisao (191) | kg | 7 d | pesagem perto (±3 d) | limiares 0,3/0,7 | B | D | a |
| 53 | Faixa saudável de ritmo | previsao:faixaSaudavel (307) | kg/sem | — | 0,25–0,5 % / 0,5–1 % | — | Pf/B | !t, metas | a |
| 54 | Linha de tendência pessoal (legado: semanas, pesoSem, magraSem, gorduraSem, veredito próprio) | previsao:linhaDeTendencia (234) | kg/sem | 6 semanas (4 no prompt/força) | regressão simples, pesagens cruas | nenhuma | B | fallback de !t/D/P/F; `magraSem` do bloco de força | a (legado) |
| 55 | `avaliarRitmo`, `projetarMeta` | previsao (313,350) | texto | — | — | — | — | **nenhum lugar** | código morto testado |
| 56 | Faixa de balanço da meta (`min/max`, `rotulo`, `detalhe`, `ritmoKgSemana`, `fase`, `freio`, `prazoApertado`, `etapaBatida`, `falta`) | resumo:metaBalancoPara (422) via faixaDaMeta (523) | kcal/dia; kg/sem | recalculada a cada uso | §3 | ±100 em volta do centro | Pf+B | P (`detalhe`), !h ("Ritmo alvo"), !p (`rotulo` do alvo), !t, !g | a |
| 57 | Tendência da gordura (pp/28 d, IC) e freio | resumo:tendenciaGorduraIC (554), metaBalancoPara (434-438) | pp/28 d | 28 d, ≥ 6 leituras/14 d | regressão com ρ | IC | B | `faixa.freio` (P, !h) | a |
| 58 | Próxima etapa (`proporEtapa`) | resumo:proporEtapa (571) | kg; data | — | ±4 kg inteiro; prazo pelo ritmo máx + 2 sem | — | B+Pf | D (anúncio), perfil | a |
| 59 | Meta adaptativa (`status`, `gasto`, `ic`, `folga`, `alvo`, `diasCompletos`, `de/ate`, `gastoRelogio`) | resumo:gastoAdaptativo (929) | kcal/dia | 28 d fechados | = calibrarEnergia + faixa | `ic`, `folga` | C+B+R | P (`meta.texto`), !h, M, !g, FORÇA x RECUPERAÇÃO, plano | a |
| 60 | Previsão de gasto de amanhã (`previsto`, `fator`, `criterio`, `alvo`, `mediaGeral`) | resumo:previsaoGastoDia (623) | kcal/dia | últimas 4 ocorrências do dia da semana ou 14 d; fator por 28 d | média × fator 0,7–1,6 | nenhuma | R (+B via meta) | P, !h, M; `previsaoSemana` no !plano | a |
| 61 | Visão 7 e 30 dias (dias com registro/estimativa, kcal, proteína, peso início/fim, médias das metades) | resumo:calcularVisao (720-747) | n; kcal/dia; g/dia; kg | 7/30 d fechados (comida), até hoje (peso) | médias; pesagens cruas | nenhuma | C+B | P, !h, M | a |
| 62 | Sequência de dias registrando | resumo:sequenciaDe (984) | dias | até ontem/hoje | régua de hábito (3+ registros ou 1.200 kcal) | — | C | P, !h | a |
| 63 | Balanço energético (hoje, último dia completo, `media7` pelo relógio, `ingestao7` vs meta, `situacao`) | resumo:calcularVisao (752-792) | kcal/dia | hoje; 7 d fechados completos | §2.5 | folga | C+R | P, !h, M | a |
| 64 | Meta de proteína | resumo:calcularVisao (719); contexto:analiseForca (300) | g/dia | — | 1,6–2,2 g/kg do `perfil.peso` | — | Pf | P, !h, placar, força | a |
| 65 | Placar da semana | resumo:placarSemana (1002) | pontos | 7 d | completos×2 + proteína batida | — | C | notas de voz, D (via `fecharSemana`? só voz: `dia.js:478`) | a |
| 66 | Peso/gordura/altura/magra por dia (relógio) | relogio:normalizarEnvio (49-57); saude:interpretarAbas (69-94) | kg; %; m | 90 d (app) / 60 d gravados | 1ª da manhã, Samsung vence | BIA oscila 0,5–1,5 kg/dia | R | pesagens, Perfil, dossiê, !r, F `relogio` | a |
| 67 | IMC | saude:resumoSaude (243) | kg/m² | última medição | peso/altura² | — | R (altura) | dossiê (Nutri-Saude.md) | a |
| 68 | Média de peso 7 d vs 7 anteriores; médias por semana ISO | saude:resumoSaude (240-267) | kg; pp | 14 d; 6 semanas | média | — | R | dossiê | a |
| 69 | Sono por noite (total, leve, profundo, REM, acordado, deitou, levantou, sessões) | relogio:normalizarEnvio (59-84); saude:interpretarAbas (96-129) | min; hh:mm | 14 noites listadas; 90 d guardados | sessão mais longa = noite; cochilo soma | parcial < 180 min marcado | R | dossiê, Perfil (última noite), !r, Pen, F, tendencia (média/semana), força (7 noites) | a |
| 70 | Sono médio, hora média de deitar/levantar | saude:indicadoresRelogio (359-365); resumoSaude (278-288) | min; hh:mm | 14 noites (perfil) / 7 (dossiê) | média (madrugada = 24 h+) | — | R | Perfil, dossiê | a |
| 71 | Passos por dia e média 7 d | relogio:normalizarEnvio (96-97); saude:indicadoresRelogio (367-372) | passos | 7 d | maior valor do dia | — | R | Perfil, dossiê, !r, Pen, F | a |
| 72 | Gasto total do dia (calorias) → `perfil.relogio.gastos[dia]` | relogio:normalizarEnvio (98-99); saude:indicadoresRelogio (381-384) | kcal/dia | 30 d no perfil; 90 d na coleção | aggregate do Health Connect (> 300); piso 800 nas contas | ±10–20 % (doc) | R | todas as contas de balanço, !g, !r, Pen | a |
| 73 | Treinos detectados pelo relógio (nome, min, hora, kcal, fcMedia) e `treinos7d` | relogio:normalizarEnvio (103-112); saude:indicadoresRelogio (370) | n; min; bpm | 7 d | linhas de exercício; Hevy filtrado se ligado | — | R | Perfil, dossiê, !r, roteiro, pré/pós-treino | a |
| 74 | FC de repouso por dia, média 14 d, dias acima, status, HRV | relogio:normalizarEnvio (100-101); saude:recuperacao (185) | bpm; ms | 14 d | app: média dos 20 % menores batimentos do sono; servidor: ≥ média+5 por 2+ dias | — | R (só app; planilha não traz) | Perfil (`fcRepouso`, `recuperacao`), dossiê (RECUPERAÇÃO), força, Pen | a (HRV: c — código pronto, relógio não grava: `GUIA:225`) |
| 75 | Atividade fixa feita/não/pendente, kcal bruta e líquida somada | atividades:kcalAtividade (18), kcalLiquida (61), avaliarPresenca (36), registrar (94) | kcal; min | por dia; 60 d em `atividadesFeitas` | MET×peso×h; − 1 MET; presença ≥ 2 pontos/300 m | ±20 % (doc) | L+Pf | P (ATIVIDADES FIXAS), !a, roteiro, `relogio.gastos` | a |
| 76 | Sessões, séries, volume, variação de volume, séries por grupo, RPE médio, progressão 1RM (Epley) | treino:analisarTreinos (97) | n; kg; %; RPE | 7 d vs 3 semanas anteriores | §2.8 | — | H | Perfil (`linhaTreino`), !tr, D (`blocoTreino`), F `treino_forca`, aposta (treinos, carga subindo) | b (sem teste) |
| 77 | Progressão por exercício (melhor carga, reps, semanas parado, `parado/subindo/caindo`) | contexto:progressaoForca (212) | kg; semanas | 8 semanas, ≥ 3 sessões | §2.8 | — | H | FORÇA x RECUPERAÇÃO (P se fala de treino, Pen, D, reflexão) | a |
| 78 | Suplementos pelos registros (creatina dias, whey g/dia, hipercalórico) | contexto:suplementosPelosRegistros (250) | dias; g/dia; n | 14 d | regex nas descrições | — | C | FORÇA x RECUPERAÇÃO | a |
| 79 | LEITURA força x recuperação, `podePuxar` | contexto:analiseForca (304-321) | texto; bool | 7 d (sono, comida), 8 sem (carga) | regras sono→comida→composição→estímulo | folga da meta | H+R+C+B | P (treino), Pen, D | c (lógica testada por partes; função com Mongo não) |
| 80 | Sugestões de carga (`deKg→paraKg`, `status`) | contexto:gerarSugestoesCarga (349), conferirSugestoes (363) | kg; reps | semana | incremento por tipo | — | H | D, P (treino), `perfil.sugestoesCarga` | a |
| 81 | Pré/pós-treino e cobertura (proteína pós ≥ 0,3 g/kg; energia pré+pós) | contexto:treinoXRefeicoes (60), resumirSessaoHevy (107) | g; kcal | hoje (±90 min) | regras | — | H+R+C | P (TREINO x REFEIÇÕES HOJE), Pen | a |
| 82 | Calibração de energia aprendida (`viesKcalDia`, `confianca`, `semanas`, `historico`) | calibracao:atualizarCalibracaoEnergia (30) | kcal/dia | EMA semanal, 12 de histórico | α 0,3, ±600 | confiança n/4 | C+R+B | só `corrigirBalanco` no !t; texto desligado do prompt | a |
| 83 | Calibração das estimativas de foto (mediana depois/antes, por categoria) | calibracao:estatisticasCorrecoes (86) | razão; n | últimas 40 correções | mediana | confiança n/8 | C (correções) | P (análise de foto, ≥ 3 correções) | a |
| 84 | Gráfico de 30 dias (PNG) | graficos:configGrafico (21), renderizar (63) | imagem | 30 d | Chart.js v2 via QuickChart | — | C+R+B+meta | !g, D | a (config) / b (render) |
| 85 | Clima/estação | clima:linhaClima (144) | °C; texto | agora, hoje, amanhã | Open-Meteo | — | API | P (contexto) | a |
| 86 | Resumo mensal (`compilarMes`: peso, médias por semana, dias sem registro) | resumo:compilarMes (216) | tabela | mês anterior | — | — | C+B | grupo dia 1 08:00 + Drive (`dia.js:521-544`) | a (`hoje-mes.test.mjs:42`) |

---

## 5. Relatórios periódicos — indicador x local

### 5.1 Agenda (`index.js:300-331`, fuso `TZ`)
| Quando | O quê | Função |
|---|---|---|
| 23:59 todo dia | Resumo do dia (IA) com `ACOMPANHAMENTO POR PESSOA` = `visaoDe(p, dia)` (prompt: visão 7/30, meta adaptativa, balanço, amanhã, PROGRESSO DE PESO, RITMO ATÉ A ETAPA, calibração de fotos) | `dia.js:131-322` |
| 23:59 de domingo | + Resumo da semana: conferência da aposta anterior, nova aposta, `analise.texto` (PROGRESSO), `tendenciaCompleta.texto` (ou linha legada), `calibrarNoDomingo`, FORÇA x RECUPERAÇÃO + resultado/sugestões de carga, etapa batida → próxima, bloco Hevy, lugares; depois gráfico PNG por pessoa; depois reflexão | `dia.js:324-456` |
| 09:00 domingo | Pede o peso a quem não tem pesagem `relogio` nos últimos 3 d | `dia.js:494-516` |
| 11:30 / 17:30 / 21:30 | Pensamento particular por pessoa (retrato: refeições x padrão, roteiro, lugares, RELÓGIO HOJE: passos, gasto até agora, sono, treinos; atividades; TREINO x REFEIÇÕES; FORÇA x RECUPERAÇÃO; despensa), só com novidade | `pensamentos.js:27-110` |
| 7,22,37,52 min | Atividades fixas pela localização | `atividades.js:118` |
| 08:00 dia 1 | Relatório do mês anterior | `dia.js:521` |
| 08:00 seg / 18:00 sex | Notas de voz com tabela da semana + placar | `dia.js:462-489` |
| 15 min (app) | POST `/relogio` → pesagens/indicadores | `relogio.js:147` |

### 5.2 Comandos
| Comando | Conteúdo | Função |
|---|---|---|
| `!hoje` | refeições de hoje + `visaoZap` (7/30 d, sequência, ritmo alvo, meta adaptativa/provisória, balanço, amanhã) + `resumoZap` do progresso + linha de chegada | `comandos.js:285-300`, `acompanhamento.js:56-60` |
| `!progresso` | `textoZap` completo (§1.12) | `comandos.js:558-569` |
| `!tendencia` | `projecaoAteMeta.zap` (passado por semana, ritmo, composição, projeção, chegada, veredito, avisos) ou linha legada | `comandos.js:540-557` |
| `!grafico [todos]` | PNG 30 d | `comandos.js:447-468` |
| `!treino [todos]` | `treinoZap` | `comandos.js:435-445` |
| `!relogio` | último envio, passos/gasto de hoje, treinos de hoje, última noite, último peso | `comandos.js:395-419` |
| `!atividade` | agenda fixa, status de hoje | `atividades.js:239-250` |

### 5.3 Tabela indicador x local (resumo)
| Indicador | P | !p | !h | !t | D | M | Pen | F | !g |
|---|---|---|---|---|---|---|---|---|---|
| Tendência 28 d + IC + direção | x | x | x | x (ritmo real) | x | x | — | x | — |
| Leitura do gráfico (janelas, semanas, média móvel) | x | x | só divergência | — | x (via analise.texto) | x | — | x | — |
| Comida da semana x peso | x | x | se relevante | — | x | x | — | x | — |
| Alvo e veredito (prob/confiança) | x | x | x | x | x | x | — | x | — |
| Comida x balança (gasto real, viés) | x | x | meta adaptativa | — | x | x | — | x | meta |
| Meta kcal (calibrada/provisória) + situação 7 d | x | x | x | — | x | x | — | x | faixa |
| Alertas | x | x | 3 tipos | avisos próprios | x | x | — | x | — |
| Semanas passadas (peso/gordura/magra/kcal/gasto/balanço/treino/sono) | só textoCurto | — | — | x | x | só textoCurto | — | x | — |
| Ritmo pela comida / esperado / chegada / janela | x | — | chegada | x | x | x | — | x | — |
| Composição da mudança / gordura na meta | x | — | — | x | x | x | — | x | magra (linha) |
| Futuro semana a semana | — | — | — | x | x | — | — | x | — |
| Aposta e conferência | — | — | — | — | x | — | — | — | — |
| Visão 7/30 d, sequência, balanço do dia, amanhã | x | — | x | — | — | x | — | — | barras/linha |
| Relógio: passos, gasto, sono, FC, HRV | Perfil (linha) | — | — | sono/semana | treinos/sono | — | x | x (`relogio`) | gasto |
| Treino Hevy (volume, progressão, RPE) | Perfil (linha) / bloco se fala de treino | — | — | treinos/semana | x | — | x | x (`treino_forca`) | — |
| FORÇA x RECUPERAÇÃO + sugestões de carga | se fala de treino | — | — | — | x | — | x | — | — |
| Atividades fixas | x | — | — | — | — | — | x | — | — |

---

## 6. Limitações conhecidas, divergências e cobertura de testes

### 6.1 Limitações já registradas no código/GUIA/commits
1. **Registro ~950 kcal/dia acima do que a balança acompanha** (commit `41f73c3`; `progresso.js:3-7`): relógio baixo e/ou fotos altas; os dados não separam as duas. Tratado pela meta calibrada em "kcal registradas", pelo alerta e pela aposta corrigida. Isso implica que todo número "kcal" mostrado é na régua das fotos, não fisiológico.
2. **Pesagens antigas guardadas como a última do dia** (`progresso.js:188-192`, `relogio.js:53-54`, `saude.js:230`): até 09/10 o app e a planilha gravavam a última medição do dia; as pesagens de antes disso podem ter hora noturna (0,5–1,5 kg a mais). Mitigação: `leituraDoGrafico.semForaDaManha` quando há `hora`; sem `hora` (pesagens antigas e digitadas) não há como saber.
3. **Degrau na série** ao corrigir a regra "manhã vence" só daqui pra frente (observação `0015` do task-observer): pesagens anteriores a 09/10 ficam com a regra antiga.
4. **Sequência e placar por régua de hábito** (3+ registros ou 1.200 kcal), diferente de "dia completo" das contas de calorias (`resumo.js:814-816, 978-982`). Dois nomes parecidos para duas réguas.
5. **HRV**: código pronto no app e no servidor, mas o Galaxy Watch não grava HRV no Health Connect (`GUIA:225`: 0 dias em 22). `Metodos-de-Calculo.md:137-138` diz que "hoje esse dado não entra" — coerente.
6. **Bioimpedância de relógio**: erro absoluto 3–5 pp; composição só em tendência (`Metodos:122-123`); `magraSem/gorduraSem` saem sem IC (`tendencia.js:155-158`).
7. **Creatina**: o sistema NÃO desconta a água dos primeiros 2–4 semanas (`Metodos:143-144`; commit `514e787`).
8. **7.700 kcal/kg** é ordem de grandeza (`progresso.js:23`).
9. **Gasto do relógio ≤ 800 kcal** descartado como dia fora do pulso em todas as contas (`progresso.js:489`, `resumo.js:757,937`, `tendencia.js:86`, `previsao.js:117`).
10. **Pesagem semanal** (protocolo de domingo): 4 pesagens em 21 d já bastam (`progresso.js:253-255`), resolvido após a observação `0014`.
11. **Alarme falso da oscilação curta** 6–12 % dos dias (`progresso.js:295-296`).
12. **Meta alterada**: o alerta sabe a data, não o valor anterior (§3).
13. **Função calling `pesagens`** tem teto de 10.000 caracteres (`ferramentas.js:26`) — o bloco completo + linha de 120 d pode ser cortado.

### 6.2 Divergências encontradas (código x documentação x código)
| # | Onde | O que diverge |
|---|---|---|
| D1 | `GUIA:192` ("pesagens cobrindo 7 dias") x `progresso.js:25-26,255` | a meta adaptativa exige 6 pesagens/14 d ou 4/21 d (regra do veredito), não 7 d. `Metodos:19-20` está certo. |
| D2 | `GUIA:186` ("Sem meta, ela projeta a tendência em 1, 3 e 6 meses") x `previsao.js:350` | `projetarMeta` (e `avaliarRitmo`) não são chamadas em lugar nenhum (`dia.js:361-362` explica a remoção). Doc desatualizada; código morto com teste. |
| D3 | `resumo.js:616` (docstring "limitada a 0,8-1,25") x `resumo.js:642` e `Metodos:104` | fator real 0,7–1,6. Só o comentário está velho. |
| D4 | `GUIA:228` ("Linha de tendência pessoal … Entra no resumo de domingo e no `!tendencia`") x `comandos.js:550`, `dia.js:372` | só como fallback quando `tendenciaCompleta` devolve null; mas ainda é a fonte de `magraSem` no bloco de força (`mensagens.js:175`), com pesagens cruas e sem validação. |
| D5 | `progresso.js:453-469` x `tendencia.js:66-83` | "critério único" de dia completo reimplementado em `semanasPassadas` com mediana de outra janela (35 d). Pode divergir em bordas. |
| D6 | `relogio.js:52` (≤ 400 kg) x `progresso.js:29` (≤ 300 kg) | tetos diferentes; irrelevante na prática. |
| D7 | `mongo.js:302-310` (`replaceOne` por `{jid, dia}`) x `mensagens.js:1146` e `ferramentas.js:261` | peso dito na conversa sobrescreve a pesagem do relógio do mesmo dia (perde `fonte`, `hora`, `gordura`) até o próximo envio do app regravar os 60 d. Na janela entre os dois, `validarPesagens` vê a digitada como única do dia. |
| D8 | `graficos.js:30` x `validarPesagens` | o gráfico plota pesagens cruas (inclui libra/outra pessoa/descartadas) e "a última do dia" se houver duplicata. |
| D9 | `calibracao.js` (EMA) x `progresso.js:calibrarEnergia` | dois estimadores do mesmo viés; o EMA só alimenta `ritmoBalanco` do `!tendencia`. Documentado em `GUIA:240`, mas um app teria de escolher um. |
| D10 | `Metodos:35-36` (ganho 0,25–0,5 %, perda 0,5–1 %) x `resumo.js:575` (`proporEtapa` usa 0,5 % ganho e 0,75 % perda para o prazo) | coerente (ponto dentro da faixa), apenas não documentado. |
| D11 | `GUIA:166-167` (tabela de comandos) | faltam `!hoje`, `!grafico`, `!treino`, `!relogio`, `!atividade` na tabela (estão descritos no corpo do GUIA). |

### 6.3 O que os testes cobrem (arquivos pedidos)
- `test/progresso.test.mjs` (914 linhas, 46 testes): tendência ±/estável com IC (39), autocorrelação e Theil-Sen (56), oscilação (72, 594), comida acima/abaixo com balança contrária (87, 111), pesagens fora de ordem/duplicadas/saltos (123), outra pessoa na balança e relógio vence digitada (143), 1ª da manhã (156), meta alterada vira alerta (172), poucos dados (191, 812), validação/formato pt-BR (217), conferência da IA (249, 678, 725, 893), pergunta de progresso (275, 653), dias completos (282), calibração só no trecho (296), `julgarRitmo` (314, 568), atividade líquida (333, 907), etapa/freio (342, 751), calibração semanal (362), `avaliarRitmo` legado (371), cenário real anonimizado em 4 variantes (397, 431, 463, 504), cobertura do IC por simulação (546), pesagem semanal (582), "compatível" (619), conclusão nunca manda comer mais (638), fusão do envio de 72 h (736), relógio ≤ 800 (783), critério único no !t (798), leitura do gráfico (827, 846, 880), comida x peso (859).
- `test/tendencia.test.mjs` (6 testes): `semanasPassadas` (31, 123), `projecaoAteMeta` ritmo/projeção/chegada/veredito (49), no ritmo/prazo inviável/sem meta (80), avisos (98), incerteza/janela/banda/composição (105).
- `test/hoje-mes.test.mjs` (relevantes): `compilarMes` (42), saúde/planilha (88), `visaoPeriodo` (145), `gastoAdaptativo` (206), sequência/placar (232), `configGrafico` (244), app Relógio normalizar/fundir (290), recuperação FC/HRV (325), previsão de amanhã (385), visão 7/30 em tópicos (422), `preverSemana` (689, 711), `conferirPrevisao` (729), `pesagemPerto` (753), `avaliarRitmo`/`projetarMeta` legados (760, 774), clima (874, 891).
- `test/calibracao.test.mjs` (5 testes): `viesDaSemana`, EMA, `corrigirBalanco`, `descreverCalibracaoEnergia`, correções de foto.
- Também relevantes: `test/resumo.test.mjs:70,103,132` (`metaBalancoPara`, etapas/freio, `linhaDeTendencia`), `test/plano.test.mjs:71,160` (`previsaoSemana`, atividades), `test/lugares.test.mjs:308-451` (treino x refeições, Hevy, `progressaoForca`, sugestões de carga).
- **Sem teste**: `treino.js:analisarTreinos/linhaTreino/blocoTreino/treinoZap`, `graficos.js:renderizar`, `saude.js:aplicarDadosSaude/sincronizarSaude`, `relogio.js:receberEnvio`, `acompanhamento.js`, `dia.js:fecharSemana` (fluxo de domingo inteiro), `comandos.js` (handlers), `clima.js:climaDe`.

---

## 7. Perguntas em aberto (para o app Android)

1. **Qual é a API?** Hoje não existe endpoint de leitura: `index.js` expõe só `/relogio` (POST), `/nota` (POST), `/ping` e rotas de admin. O app visual precisará de um `GET` por pessoa que devolva o objeto de `analisarProgresso` + `projecaoAteMeta` + `calcularVisao` (todos já são JSON-serializáveis, exceto `seriesPorGrupo` em `analisarTreinos`, que é `Map`). Reusar `progressoDe`/`tendenciaCompleta`/`gastoAdaptativo` ou expor os textos prontos?
2. **Série de pesagens para o gráfico**: usar `validarPesagens(...).pontos` (com `descartadas` marcadas) ou as cruas como o `!grafico` faz hoje (D8)? Sugestão: pontos validados + descartadas em cinza + linha de tendência com banda do IC (`pesoTendenciaInicio/Fim`, `ic95`) + média móvel centrada (`leitura.movel`) — nada disso é desenhado hoje.
3. **Fonte única do viés**: o app deve mostrar o viés de `calibrarEnergia` (com IC) ou o EMA de `perfil.calibracao.energia` (D9)? Hoje o usuário vê o primeiro; o segundo só mexe na projeção.
4. **Pesagem digitada x relógio no mesmo dia** (D7): manter `replaceOne` por `{jid, dia}` ou gravar as duas com `fonte` e deixar `validarPesagens` escolher (já faz isso quando ambas chegam)? O app vai permitir digitar peso?
5. **Histórico de metas**: `perfil.atualizacoes` guarda só a data. Um app que mostre "linha do alvo" ao longo do tempo precisa do valor anterior de `metaPeso/metaPrazo/ritmo`. Criar coleção de histórico de metas?
6. **`!tendencia` sem `tendenciaCompleta`** cai na linha legada sem validação de pesagens nem IC (D4). Vale remover a legada e devolver "sem base" quando há < 4 pesagens? E trocar a fonte de `magraSem` do bloco de força por `projecaoAteMeta.magraSem`?
7. **Horário das pesagens antigas**: sem `hora` não dá para separar manhã/noite nas pesagens anteriores a 09/10 e nas digitadas. O app deve pedir hora ao digitar? Marcar visualmente as sem hora?
8. **`treino.js:analisarTreinos` sem teste** e com `Map` no retorno: antes de servir ao app, converter para objeto e cobrir com teste.
9. **Aposta de domingo**: salva em `previsoes` com `base`, `confianca`, `deltaKg`, `magraKg`; o app pode mostrar o histórico de acertos (`acerto`, `erroKg` via `marcarPrevisaoConferida`). Há interesse em expor a taxa de acerto por método?
10. **FC de repouso**: calculada no app Android (20 % menores batimentos do sono) e não no Samsung Health; o app visual mostra o valor do servidor (`saude_relogio.atividades[].fcRepouso`) ou recalcula localmente? A média de 14 d e o status só existem no servidor (`recuperacao`).
11. **Dois "dias completos"** (D5, item 4 de §6.1): o app precisa rotular claramente "dias com registro" x "dias completos (contas)" x "sequência (hábito)".
12. **Docs**: GUIA:186, 192 e 228 e a docstring `resumo.js:616` estão desatualizados; `projetarMeta`/`avaliarRitmo` podem ser apagados (com os testes) ou mantidos como utilitários do app.
