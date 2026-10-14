> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# F0: o que o Mongo de produção diz (13/10/2026)

Consultas **somente de leitura** no banco `nutribot` (find, countDocuments, estimatedDocumentCount, aggregate sem $out/$merge, listCollections, dbStats, $collStats, indexes). Nada foi gravado. Scripts: `consulta.mjs` e `consulta2.mjs` nesta pasta; saída bruta agregada em `saida.json`. Sem jids, valores de peso ou textos; perfis pelo primeiro nome.

## 1. Tamanho

| Métrica (dbStats) | Valor |
|---|---|
| Coleções | 36 |
| Documentos | 7.861 |
| dataSize | 4,76 MB |
| storageSize | 5,18 MB |
| indexSize | 1,87 MB |
| **Total (storage + índices)** | **7,05 MB** |
| Limite M0 | 512 MB |
| **Folga** | **~505 MB (uso de ~1,4%)** |

Coleções que mais pesam (storage + índice):

| Coleção | Docs | Storage MB | Índices MB | Média/doc |
|---|---:|---:|---:|---:|
| memoria_vetorial | 166 | 2,00 | 0,04 | 10,6 KB (vetor de 768) |
| baileys_auth | 5.455 | 1,22 | 0,35 | 348 B |
| pensamentos | 112 | 0,21 | 0,04 | 1,9 KB |
| visitas | 961 | 0,12 | 0,11 | 190 B |
| locais_brutos | 537 | 0,08 | 0,14 | 158 B (TTL 7 dias ativo) |
| refeicoes | 260 | 0,10 | 0,11 | 478 B (máx. 683 B) |
| persona_historico | 26 | 0,16 | 0,04 | 3,6 KB |
| conhecimento | 10 | 0,14 | 0,04 | 6,4 KB |
| perfis | 3 | 0,07 | 0,07 | 15 KB |
| revisoes_pendentes | 3 | 0,04 | 0,04 | 2,2 KB |

Todas as demais têm menos de 0,1 MB cada (pesagens 31 docs, saude_relogio 1 doc de 20 KB, hevy_exercicios 1 doc de 70 KB, memoria 1 doc de 25 KB, notas 1 doc de 22 KB). `notas_brutas` está vazia (TTL 3 dias).

Ritmo: `memoria_vetorial` cresce ~6 docs/dia × 10,6 KB, ou seja ~65 KB/dia (~25 MB/ano). O resto é desprezível. Não há risco de bater no limite do M0 em anos.

## 2. Perfis

3 documentos, **3 onboarded true**, 0 false, 0 sem o campo. Nenhum jid compartilhado entre perfis.

| Perfil | jids | Formatos | jids[0] | fuso | pastaId | relogio.atualizado | metaPeso | metaPrazo |
|---|---:|---|---|---|---|---|---|---|
| Pessoa A | 2 | lid, num | @lid | America/Sao_Paulo | sim | 2026-10-12 | sim | sim |
| Pessoa B | 2 | lid, num | @lid | **fuso europeu** | sim | (sem `relogio`) | sim | sim |
| Pessoa C | 2 | lid, num | @lid | America/Sao_Paulo | sim | (sem `relogio`) | sim | sim |

`jids[0]` é LID nos 3 de 3. Só o Pessoa A tem o subobjeto `relogio` (atualizado, peso, gordura, pesoEm, ultimaNoite, sonoMedioMin, deitaMedia, levantaMedia, passosMedia, treinos7d, fcRepouso, fcMedia, recuperacao, hrv, gastos, linha). Perfis com 25 a 41 chaves na raiz.

## 3. Pesagens

| Métrica | Valor |
|---|---|
| Total | 31 (de 13/09 a 13/10) |
| Pares {jid, dia} com mais de 1 doc | **0** |
| Mesmo perfil e dia com jids diferentes (LID x número) | 0 |
| fonte = relogio | 30 |
| fonte ausente (digitada) | 1 |
| fonte = documento | **0** |
| Com `hora` | 30 (todas as do relógio) |

| Perfil | Pesagens | Dias com pesagem (60 d) | Fonte | jid usado |
|---|---:|---:|---|---|
| Pessoa A | 30 | 30 | 30 relógio | LID |
| Pessoa C | 1 | 1 | 1 digitada (fim de setembro, sem hora nem gordura) | LID |
| Pessoa B | 0 | 0 | — | — |

Sobrescrita (P1): pesagens digitadas em dia em que `saude_relogio.pesos` também tem pesagem = **0**. Os 30 dias de peso do relógio do Pessoa A têm todos doc em `pesagens`, e todos com fonte relogio.

## 4. Refeições

| Métrica | Valor |
|---|---|
| Total | 260 (desde 17/09; todas nos últimos 30 dias) |
| `manual: true` | **4** (Pessoa A 3, Pessoa C 1); `manual: false` 145; sem o campo 111 |
| Com `incerteza` | 102 |
| Pares da mesma pessoa e dia a ≤10 min | **0** (por perfil, por jid, adjacentes ou todos os pares) |
| Pares a ≤30 min | 2 (tipos diferentes, ambos entre 11 e 30 min) |
| Menor intervalo entre duas refeições da mesma pessoa no mesmo dia | 19 min |
| Docs com `atualizadoEm` (fundidos ou corrigidos depois) | 65 |
| Resumo com "(corrigido)" | 20 (Pessoa A 9, Pessoa C 8, Pessoa B 3); nenhum deles `manual: true` |
| Resumo com " + " (complemento somado) | 15 |

| Perfil | Total | Dias com registro (30 d) | jid nas refeições |
|---|---:|---:|---|
| Pessoa A | 132 | 27 | 1 jid só, LID |
| Pessoa B | 73 | 24 | 1 jid só, LID |
| Pessoa C | 55 | 21 | 1 jid só, LID |

O jid **não varia** (sempre o LID = jids[0]).

Chaves e frequência (em 260): `_id, jid, nome, dia, hora, horaLocal, minutos, slot, resumo, descricao, estimativa, criadoEm` 260; `correcao` 218; `manual` 149; `correcaoEstimativa` 102; `incerteza` 102; `atualizadoEm` 65; `estimativaRetro` 13; `corrigidoManualmente` 4; `estimadoDepois` 1.

`hora` x `horaLocal`: `minutos` bate com `horaLocal` em 260 de 260. No Pessoa B, `hora` ≠ `horaLocal` nos 73 (hora = relógio de SP, horaLocal/minutos = fuso europeu). No Pessoa A e na Pessoa C, `hora` ≠ `horaLocal` em 18 e 9 docs (retroativos e correções).

## 5. saude_relogio

1 documento (só o Pessoa A; `_id` = jids[0], LID).

| Campo | Valor |
|---|---|
| app | relogio/1.6 |
| ultimoEnvio | 2026-10-13 22:50 UTC |
| pesos | 30 dias (todos com hora) |
| sonos | 31 noites |
| atividades | 32 dias (desde 12/09) |
| atividades com fcRepouso | 16 |
| atividades com hrv | **0** |
| Chaves na raiz | nome, pesos, sonos, atividades, texto, ultimoEnvio, app, recebidos |

## 6. Planilha Health Data Export

`arquivos_pessoa`: 5 docs, o mais recente salvo hoje. Docs com nome contendo saude|health|galaxy|watch|relógio: **0**. Nenhuma planilha de saúde aparece no cache (nem nos últimos 30 dias). O relógio chega só pelo app.

## 7. Fuso e dia (P6)

Só o Pessoa B tem fuso diferente (fuso europeu, 6 h à frente de SP).

| Métrica | Valor |
|---|---|
| Refeições do Pessoa B | 73 |
| `criadoEm` cai em dias diferentes em fuso europeu e em SP | 1 |
| Desses, `dia` gravado = dia de SP (errado pra ele) | **1** |
| Desses, `dia` = dia de fuso europeu | 0 |
| Controle, todos os perfis: `dia` ≠ dia de `criadoEm` no fuso da pessoa | 1 (o mesmo caso) |

Dimensão do P6: 1 refeição em 73. A janela de risco é pequena (registro entre 00:00 e 06:00 em fuso europeu), mas quando acontece o dia é o de SP.

## 8. Outras

| Item | Valor |
|---|---|
| `fila_pendente` | **não existe** (nunca criada ou já removida; vazia na prática) |
| `revisoes_pendentes` | 3 docs, média 2,15 KB (máx. 3,0 KB), todos criados hoje |
| `memoria_vetorial` por tipo | momento 61, conversa 54, resumo do dia 26, diário da Nutri 21, notas 3, semente 1 |
| `alteracoes` | não existe |
| `dispositivos` | não existe |
| `metas_historico` | não existe |
| Também existe | `documentos_pessoa` (1 doc), `correcoes_estimativa` (5), `treinos` (38), `hipoteses` (9) |

## Implicações para as correções P1 (pesagem por fonte), P3 (!refeicao), P6 (fuso) e para o backup

- **P1, pesagem por fonte.** Hoje não há nenhum conflito pra migrar: 0 duplicatas {jid, dia}, 0 digitadas em dia de relógio, 0 com fonte `documento`. Mudar a chave pra {jid, dia, fonte} (ou guardar as duas fontes) não pede migração de dados, só o índice novo. Ressalva: o estado atual só mostra o último que gravou. Como o relógio regrava os últimos dias a cada envio, uma digitada sobrescrita já teria sido trocada de volta e não deixa rastro. O risco real está concentrado no Pessoa A (único com relógio, pesa todo dia). As pesagens digitadas não têm `hora`, e a leitura "só manhã" do progresso vai descartá-las ou tratá-las à parte.
- **P3, !refeicao.** É raro: 4 registros manuais em 260, e nenhum par a ≤10 min sobrevive no banco. Isso é esperado, porque a fusão grava por cima. O banco não mostra quantos !refeicao foram absorvidos (nenhum manual tem "(corrigido)", o que sugere que não aconteceu nos 4 casos registrados). A correção não precisa de migração. Para medir, só os logs do Render ou um campo novo (`fundidoDe`/contador) a partir da correção.
- **P6, fuso.** Afeta só o Pessoa B; 1 refeição gravada no dia de SP. Corrigir à mão é 1 doc (fora do escopo desta leitura). Para o app: usar `minutos`/`horaLocal` (sempre no fuso da pessoa); `hora` é o relógio de SP e não deve ser exibido pra quem está em outro fuso. Em toda a base `dia` só diverge do `criadoEm` local nesse caso, então os registros retroativos estão coerentes.
- **jid.** Tudo (refeições, pesagens, saude_relogio) está gravado no LID = jids[0], nos 3 perfis. O app pode identificar a pessoa pelo `_id` do perfil e consultar por `jids[0]` sem medo de dados espalhados entre LID e número.
- **Backup.** O banco inteiro tem ~7 MB. Um dump diário completo cabe folgado em qualquer destino (Drive, GitHub privado, artifact do Actions). Dois cuidados:
  1. `baileys_auth` (5.455 docs, 1,2 MB) é segredo de sessão do WhatsApp. Ou fica fora do backup, ou vai criptografado.
  2. `memoria_vetorial` é 28% do total e dá pra regerar a partir dos textos. Pode ir sem o campo `vetor` se quiser um backup enxuto (~0,1 MB).

  `locais_brutos` e `notas_brutas` têm TTL e não precisam de backup. Não existem `alteracoes`/`dispositivos`/`metas_historico`, então a fase 0 começa do zero nelas, sem conflito de nome.

## Não deu para responder

- **Espaço em disco do cluster** (`fsUsedSize`/`fsTotalSize`): o M0 não informa. A folga foi calculada só por storage + índices contra 512 MB.
- **Quantas vezes o P1 já aconteceu no passado**: o upsert por {jid, dia} apaga a versão anterior e o relógio regrava os dias recentes. Sem log histórico, não dá pra saber.
- **Quantos !refeicao foram absorvidos (P3)**: a fusão é destrutiva. Só os logs do Render, com a linha de "descrição repete" ou o comando, mostrariam isso.
- **Planilha por perfil**: `arquivos_pessoa` não tem campo de dono, então não dá pra atribuir arquivo a perfil sem abrir os textos (não abri). `documentos_pessoa` (1 doc) não foi inspecionada além da contagem.
