> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# R4 — Agentes, prompts, memória, conhecimento, proatividade e avaliação da IA

Auditoria só de leitura do repositório `C:\Users\lucas\Downloads\BOT` (main, commit `2ae910e`), feita em 13/10/2026. Nenhum arquivo do repositório foi alterado. Não li `.env`, credenciais nem tokens; só os nomes das variáveis. Quando um dado pessoal aparece num exemplo, chamo de "pessoa A".

**Legenda de status:** (a) implementado e coberto por teste · (b) implementado, sem teste · (c) parcial · (d) só planejado ou comentado · (e) não existe.

---

## 0. Resumo para quem vai desenhar o app

1. **Não há um modelo único de "fato com fonte".** O bot guarda cerca de 25 tipos de informação por pessoa, espalhados por Mongo (perfil, coleções próprias), arquivos `.md` no Drive e memória vetorial. Só **um** desses tipos tem data, origem e confiança juntos: os documentos extraídos da pasta (`documentos_pessoa`, `pessoas.js:233-267`). O perfil guarda a data de cada campo (`perfil.atualizacoes`, `perfis.js:67-75`), mas não a origem. Notas, rotina, persona, reflexão e anotações são texto livre escrito pelo modelo, sem nenhum desses metadados.
2. **Para a maioria dos tipos, corrigir hoje é mexer à mão no Mongo e/ou no Drive.** Os próprios commits registram isso (`dcfd117`, `b7901c3`, `201b65f`: "corrigido à mão no Mongo + Nutri-Notas.md"). Só existem comandos para: registro de refeição (`!apagar`, linha REGISTRO), apelido (`!apelido`), lugares (`!lugares casa|aqui é|esquecer`) e o cadastro inteiro (`!reset`, que apaga **só** o documento `perfis`: `comandos.js:193-197`, `mongo.js:141-143`).
3. **Dados de saúde de uma pessoa vão no prompt de todas as outras.** O bloco `PERFIS DO GRUPO` (`gemini.js:250-282`) entra em toda resposta (`gemini.js:709`) e traz, de **cada** pessoa, notas (700 caracteres), rotina, a linha do relógio, o treino e os documentos com "exames fora da referência". Agenda e lugares estão isolados por pessoa; saúde, não.
4. **O prompt é muito maior que "~10 mil caracteres".** Só o system prompt fixo (persona-base 3,3 mil + REGRAS 35,8 mil, `gemini.js:52-176`) passa de 39 mil caracteres, antes de somar a memória de personalidade, as lições, a base de conhecimento (até 9 mil por documento), o dossiê (até 14 mil + 4 mil de notas) e o histórico. Ninguém mede nem guarda o tamanho (o log `[tokens]` de `gemini.js:392-406` fica só na RAM).
5. **Já existe um modelo de "fato x hipótese" que o app pode reaproveitar:** as hipóteses da reflexão (`reflexao.js:47-77`), com id, data de criação, "como verificar", sinais a favor e contra e status confirmada/refutada/aberta/inconclusiva. Também já existe a marca explícita "FATO" para onde a pessoa mora (`lugares.js:788-793`) e "probabilidade, não fato" para o roteiro do dia (`gemini.js:112`).

---

## 1. `gemini.js` (1.949 linhas): modelos, prompts e funções

### 1.1 Modelos, cadeia de reserva e parâmetros

| Item | Valor no código | Onde |
|---|---|---|
| Modelo principal | `GEMINI_MODEL` ou `gemini-3.6-flash` | `gemini.js:23` |
| Reservas Gemini (família Flash) | `GEMINI_MODELOS_RESERVA` ou `3.8-flash, 3.7-flash, 3.5-flash, 3-flash-preview` | `gemini.js:341-344` |
| Leves (Lite) | `GEMINI_MODELOS_LEVES` ou `3.5-flash-lite, 3.1-flash-lite` | `gemini.js:347-350` |
| Embeddings | `GEMINI_EMBEDDING` ou `gemini-embedding-001`, 768 dimensões | `gemini.js:1861-1876` |
| Reservas externas | Cohere, OpenRouter, Groq, Hugging Face (`reservas.js`); não fazem function calling | `gemini.js:598-623`, `635` (`semReserva`) |
| Várias chaves | `GEMINI_API_KEY` + `GEMINI_API_KEYS`; "castigo" por chave e modelo | `gemini.js:28`, `355-383` |
| Temperatura padrão | 0,95 (vale para `responder`, que não define outra) | `gemini.js:513` |
| Saída padrão | 1.024 tokens; se cortar, repete uma vez com o dobro | `gemini.js:514`, `531-541` |
| Prazo total | 75 s (conversa) / 300 s (documento longo); a 1ª família ganha 55% do tempo | `gemini.js:480-488` |
| Timeout HTTP | 30 s; 45 s com foto; 180 s longo; 300 s com `pensar:'alto'` | `gemini.js:518` |
| Raciocínio | `pensar:false` → MINIMAL/LOW; `'baixo'`; `'alto'` → HIGH; rebaixa sozinho se o modelo recusar | `gemini.js:439-461` |
| Segurança | `BLOCK_NONE` em todas as categorias | `gemini.js:39-45` |
| Aviso ao admin | quando a resposta sai por reserva (1 vez a cada 30 min) | `gemini.js:555`, `618`; `avisos.js:53-65` |

**Custo e latência:** cada chamada registra tokens de entrada, saída e cache (`contabilizar`, `gemini.js:392-406`) num acumulado diário **só em RAM** (`uso`, `gemini.js:387`), mostrado em `!status` e `/status` (`index.js:168-183`). Não há custo em dinheiro, histórico nem p50/p95 de latência. A única latência medida fica nos relatórios da avaliação (`ms` por cenário, `avaliacao/rodar.mjs:319`). Status: (b).

**Divergência com o GUIA:** a linha 177 diz que a fila Flash vai "3.6 → 3.8 → 3.7 → 3.5 → 3 → 2.5"; o padrão do código não tem 2.5 (`gemini.js:341`).

### 1.2 System prompt (`montarSystem`, `gemini.js:188-202`)

Montado nesta ordem para **toda** chamada que passa `systemInstruction`:

1. **Persona-base** (`PERSONA_PADRAO`, `gemini.js:52-64`, cerca de 3,3 mil caracteres) ou o conteúdo de `persona.md` / `PERSONA_ARQUIVO` quando existir (`gemini.js:66-77`). O modelo para preencher fica em `skill-copiar-bot/persona.template.md` (14 linhas com campos `[PREENCHER]`). Hoje não há `persona.md` na raiz.
2. **REGRAS** (`gemini.js:79-176`, cerca de 35,8 mil caracteres): COMO VOCÊ FALA, DADOS DA PESSOA (regra de ouro: o mais recente vence o documento), DICAS, VOCÊ É GENTE DO GRUPO (cerca de 45 regras: agenda, lugares, plano ≠ consumo, ritmo e progresso, gênero, despensa, cupom, força, relógio, registros, voz, produto, PESQUISAR…) e FORMATO (bloco de análise, linhas ocultas).
3. Quando `documento:true`, o aviso "não é conversa de grupo, nunca responda SILENCIO" (`gemini.js:192-196`).
4. O nome escolhido pelo grupo (`gemini.js:197`).
5. **A memória de personalidade** (`persona` no Mongo, até cerca de 700 palavras, **global**) (`gemini.js:198`).
6. **As lições ativas** (até 8 regras do caderno de aprendizado, `blocoLicoes`, `consciencia.js:170-174`; `gemini.js:199-200`).

**Linhas ocultas** que o modelo escreve e o código extrai (`separarAtualizacao`, `gemini.js:798-914`): `AUDIO`, `HABITO`, `REAGIR`, `INCERTEZA`, `PERGUNTA`, `REFEICAO` (também com cedilha), `PRODUTO`, `REGISTRO` (várias), `ATUALIZAR`, `ATIVIDADE`, `NOTA`, `DESPENSA`, além de `PESQUISAR` e `SILENCIO`. Testado em `hoje-mes.test.mjs` (importa `separarAtualizacao`) e nos casos C18, C19 e C48 de `comportamento.test.mjs`: (a).

### 1.3 Prompt da conversa (`responder`, `gemini.js:696-775`)

A ordem foi pensada para o cache implícito: o que não muda vem primeiro (`gemini.js:705-706`).

| Bloco | Fonte | Limite | Linha |
|---|---|---|---|
| SUA BASE DE CONHECIMENTO | `docsPara` (§3) | até 9.000 caracteres por documento | `708`, `303-309` |
| PERFIS DO GRUPO (**todas as pessoas**) | `blocoPerfis` | notas 700 por pessoa; documentos: últimos 6 | `709`, `250-282` |
| O QUE VOCÊ SABE SOBRE <PESSOA> (dossiê) | `dossieDe` | 14.000 + notas 4.000 | `710`, `311-314`; `pessoas.js:19-20` |
| MOMENTOS MEMORÁVEIS | `momentosRecentes(12)`, **do grupo inteiro** | 12 itens | `711`; `mensagens.js:841` |
| LEMBRANÇAS DE DIAS ANTERIORES | `lembrancasPara` (vetorial) | 4 × 500 caracteres | `712`; `memoria_semantica.js:56-79` |
| HISTÓRICO DE HOJE | memória do dia | 50 mensagens; respostas da bot cortadas em 350 caracteres | `713`, `321-337` |
| REFEIÇÕES JÁ REGISTRADAS HOJE | banco | — | `714` |
| DATA E HORA, PESSOA ATUAL, objetivos das OUTRAS pessoas (nomeados para não serem usados) | perfil | — | `716-721`, `698-702` |
| ACOMPANHAMENTO (visão 7/30 dias + PROGRESSO DE PESO + projeção + calibração) | `visaoDe` | — | `722-723`; `acompanhamento.js:42-73` |
| ANOTAÇÕES QUE VOCÊ GUARDOU | `perfil.anotacoes` | últimas 10 | `724` |
| AGENDA / LUGARES / ROTEIRO / ATIVIDADES / TREINO HOJE / FORÇA / JÁ DITO / DESPENSA | código | — | `725-732` |
| COMO VOCÊ ENTENDE <PESSOA> (síntese da reflexão) | `perfil.reflexao.sintese` | 600 caracteres | `733` |
| SEU PENSAMENTO MAIS RECENTE (só do mesmo dia) | `perfil.pensamento` | 1.200 caracteres | `734` |
| RÓTULOS (Open Food Facts) / ÂNCORAS TACO / CITAÇÃO | código | — | `735-737` |
| **Modos** (um de cada vez): `planejando`, `perguntaProgresso`, `metaConversa`, `emAndamento`, `contestacao` | flags de `mensagens.js` | — | `738-753` |
| MENSAGEM ATUAL (+ fotos, áudio) | — | — | `754-764` |

- **"Pergunta de progresso":** `gemini.js:741-743`. A rota é decidida por `rotaPerguntaProgresso` (`progresso.js`), a mesma função na produção (`mensagens.js:901`) e na avaliação (`avaliacao/rodar.mjs:273`): (a).
- **Análise de prato:** o bloco obrigatório "🕐 Refeição / 🍽️ O que eu vi / 🔥 Estimativa / ⚖️ Veredito / 💡 Dica" está em `gemini.js:158-173`. O `validadorDeFoto` (`gemini.js:783-795`) recusa a resposta a foto que "fala no lugar da pessoa": (b). As âncoras TACO têm teste em `hoje-mes.test.mjs`.
- **Caminho leve:** papo sem "motivo" vai pelos modelos Lite e **sem** dossiê, conhecimento, visão, lembranças, agenda nem lugares (`mensagens.js:837-840`, `874-877`, `902`, `929`).
- **Temperatura:** 0,95 e `pensar:false` (`gemini.js:766`).

**Tamanho (estimativa minha, sem medição no código):** system prompt cerca de 39 mil + persona acumulada cerca de 4 a 5 mil + lições cerca de 1 mil. A parte fixa do template do `responder` (linhas 707-760, sem os dados) tem cerca de 9,4 mil. Numa resposta completa para alguém com treino e relógio somam-se conhecimento (cerca de 15 a 30 mil), dossiê (até 18 mil), perfis de todos, histórico e acompanhamento. **Ordem de grandeza: 80 a 120 mil caracteres (cerca de 20 a 35 mil tokens).** Os números reais aparecem no log `[tokens] … entrada (… em cache)` de cada chamada.

### 1.4 Mapa das funções exportadas

| Função | Linha | Uso | Modelo / parâmetros |
|---|---|---|---|
| `responder` | 696 | conversa | Flash (Lite se papo), 0,95, `pensar:false`; ferramentas opcionais |
| `separarAtualizacao` | 798 | extrai linhas ocultas | código |
| `gerarComFerramentas` | 632 | laço de function calling | `semReserva`; a última rodada força texto (`mode:'NONE'`); 1 rodada extra se insistir |
| `montarSystem`, `SYSTEM_PROMPT`, `definirNomeBot`, `nomeDaBot`, `definirLicoes`, `licoesAtuais` | 178-209 | system prompt | — |
| `limparEco`, `falasDe` | 216, 289 | limpeza de eco da reserva; filtra falas de UMA pessoa (evita misturar rotinas) | código; testados em `hoje-mes.test.mjs` |
| `usoDeHoje`, `situacaoModelos`, `ultimasRespostas`, `ultimaFoiExterna`, `creditosEsgotados`, `totalDeChaves` | 17-434 | status e cota | código |
| `pedirOnboarding`, `extrairDadosOnboarding`, `boasVindas`, `cobrarDadosFaltando` | 919-974 | cadastro | Lite; extração em JSON com temperatura 0,1 |
| `resumoDiario` | 984 | resumo das 23:59 | Flash, `pensar:false`, 3.000 tokens |
| `resumoSemanal` | 1014 | domingo | Flash, 5.000 tokens, raciocínio padrão |
| `resumoMensal` | 1112 | dia 1 | Flash, 3.600 tokens |
| `extrairGirias` | 1034 | noite | Lite, JSON, 0,2 |
| `evoluirPersona` | 1071 | noite | Flash, 0,8, 3.600 tokens, `estrito` |
| `diarioDaNutri` | 1093 | noite | Lite, 0,9, 600 tokens |
| `extrairMomentos` | 1217 | noite | Lite, JSON, 0,3 |
| `atualizarRotina` | 1275 | noite | Lite, 0,3, 1.200 tokens, `estrito` |
| `atualizarNotas` | 1785 | noite | Lite, 0,3, 900 tokens, `estrito` |
| `revisarErros` | 1403 | caderno de aprendizado | Flash, 0,4, JSON, raciocínio padrão |
| `estimarRefeicaoManual` | 1123 | `!refeicao` | Lite, JSON |
| `revisarRespostaReserva` | 1161 | `revisao.js` | só Gemini, 0,3, JSON, prazo de 90 s |
| `conferirResposta` | 1439 | consciência (contestação) | Lite, 0,1, JSON; **em caso de erro devolve ok=true** |
| `julgarFragmento` | 1468 | mensagem parcelada | Lite, 0,1, JSON |
| `cobrarRefeicao` | 1260 | cobrança | Lite, 400 tokens |
| `pesquisarNaWeb` | 1299 | grounding | **desligada por padrão** (`PESQUISA_WEB`) |
| `revisarConhecimento`, `notaDeEstudo` | 1498, 1515 | base de conhecimento | 0,2 / Lite 0,3 |
| `extrairDadosDocumento` | 1336 | pasta da pessoa | Lite, 0,1, JSON (tipo, data, confiança, medidas, exames) |
| `transcreverPdf`, `descreverImagemDocumento` | 1527, 1542 | pasta / nota | 0,1 |
| `extrairItensCupom`, `extrairItensTexto`, `normalizarItensNota` | 1558-1631 | despensa | JSON |
| `investigarPessoa` | 1655 | antes do pensamento | Lite, 0,4, ferramentas (5 rodadas, só `anotar_memoria` de escrita) |
| `pensarSobrePessoa` | 1672 | pensamento | Flash, 0,6, JSON (`vale_falar`, `confianca`) |
| `redigirIntervencao` | 1638 | proatividade | Lite, 0,7, 300 tokens; pode devolver SILENCIO |
| `refletirSobrePessoa` | 1762 | domingo | Flash, 0,8, 2.200 tokens, ferramentas (4 rodadas) |
| `verificarHipoteses`, `extrairHipoteses` | 1710, 1735 | domingo | 0,2, JSON |
| `planoSemanal` | 1879 | `!plano` | `pensar:'alto'`, 24.000 tokens, 0,7, `estrito`, ferramentas (5 rodadas), `soPrincipal` |
| `falaProgramada` | 1937 | voz de segunda e sexta | 0,9, 900 tokens |
| `apresentacao`, `boasVindasNovoMembro`, `extrairNomeBot`, `reagirAoNome` | 1804-1855 | grupo | — |
| `embutir` | 1861 | embeddings | tenta todas as chaves; devolve null se falhar |

### 1.5 Function calling (fases 1 a 4)

| Fase | O que faz | Onde | Chave | Status |
|---|---|---|---|---|
| 1 — leitura | 13 ferramentas: `refeicoes_periodo`, `padrao_alimentar`, `agenda`, `semana_tipica`, `lugares`, `treino_forca`, `relogio`, `pesagens`, `despensa`, `conhecimento`, `lembrancas`, `mercados_perto`, `reflexao`. Teto de 7.000 caracteres (10.000 em `pesagens`). Só entram as que a pessoa tem. | `ferramentas.js:54-100`, `132-308`; uso em `planoSemanal` e `investigarPessoa` | — | (a) `ferramentas.test.mjs` (5 testes), C28 |
| 2 — conversa | Texto que é pergunta ou pedido, sem foto, áudio, contestação ou meta-conversa. Máximo de 2 rodadas. O prompt vai **sem** despensa, lugares e força. Se falhar, segue pelo caminho normal. | `mensagens.js:918-928`; `gemini.js:692-694`, `768-772` | `FERRAMENTAS_CONVERSA` (on por padrão), `mensagens.js:160` | (a) C15-C17; avaliação C19b, C20b, C44 |
| 3 — escrita | `anotar_memoria` (seletiva: recusa temporário, menos de 15 caracteres e duplicado com Jaccard ≥ 0,6) e `atualizar_perfil` (pelo mesmo `aplicarAtualizacao`) | `ferramentas.js:104-115`, `242-263` | conversa: `escrita:true`; investigação: só `anotar` (`pensamentos.js:65`) | (a) C25-C27 |
| 4 — reflexão | `refletirSobrePessoa` com até 4 rodadas | `gemini.js:1759-1782`; `reflexao.js:133-149` | — | (b) |

`PROATIVIDADE` (on por padrão; `off` desliga) fica em `proatividade.js:73`.

### 1.6 Consciência: resposta barrada e refeita (`mensagens.js:993-1065`)

Roda só na via completa (`motivo`). A resposta é refeita **uma vez** com o aviso "CONFERÊNCIA DO SISTEMA…":

| Checagem | Como | Se insistir | Status |
|---|---|---|---|
| (a) total do dia inventado | `numerosSuspeitos` (`consciencia.js:34-50`): número ≥ 1.500 kcal perto de "total/hoje/bateu…", fora de metas e gasto, comparado com os registros com tolerância de 8% | envia assim mesmo e grava no log (`mensagens.js:1046-1047`) | (a) `hoje-mes.test.mjs` |
| (b) contestação | `conferirResposta` com o modelo leve (`gemini.js:1439-1463`) | — ; **falha aberta** (ok=true) | (b) |
| (c) objetivo trocado | `vocabularioErrado` / `ladoDoObjetivo` (`consciencia.js:97-123`) | tira as frases (`removerFrasesCom`) | (a) C13, C14, `hoje-mes.test.mjs` |
| (d) progresso contraditório | `conferirTextoProgresso` (`progresso.js`) | anexa "📏 Conferindo nas contas: <veredito>"; em análise de prato só a frase sai | (a) `progresso.test.mjs` (45 testes), P01-P05 |
| Pós-envio, sem IA | plano com bloco de refeição (`1067-1078`), papo curto (`1079-1086`), repetição em 2 h (`1087-1094`), bordão, gíria e vocativo (`1096-1106`) | — | (a) `consciencia.test.mjs` (7), `plano.test.mjs`, C01-C08, C33, C36 |

`test/consciencia.test.mjs` cobre **só** bordões, gírias, vocativos e `prepararCobranca`. O resto de `consciencia.js` é testado em `hoje-mes.test.mjs` e `plano.test.mjs`.

**Limite assumido (GUIA:214):** o bot não percebe um erro que ninguém contesta quando o dado já está errado na origem. As estimativas por refeição não são conferidas (só as âncoras TACO e a calibração por correções).

### 1.7 `revisao.js`: revisão das respostas de reserva

Quando uma resposta sai por reserva externa, ela vai para `revisoes_pendentes` (`revisao.js:45-61`). O cron de hora em hora no minuto 37 (`index.js:311`) apaga o que passou de 24 h e, **por amostragem**, confere UMA resposta (no máximo 2 por semana, intervalo de 20 h, chance de 0,2 por hora; `revisao.js:22-24`, `68-75`). Se estiver errada, corrige no grupo citando a mensagem, com um pedido de desculpas, e corrige ou apaga o registro da refeição (`revisao.js:136-173`). Só `montarCorrecao` e `DESCULPAS` têm teste (`hoje-mes.test.mjs:17`): (b).

---

## 2. Inventário do que o bot sabe por pessoa

Abreviaturas: **M** = Mongo; **D** = Drive (pasta da pessoa, ou `Perfis/` para o que é global); **P** = entra no prompt.

| # | Tipo de informação | Onde mora | Formato | Quem escreve | Quando | Data? | Origem? | Confiança / fato x inferência | Entra no prompt como | Como corrigir hoje | Risco de mistura | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Cadastro: peso, altura, objetivo, cidade, fuso, dieta, restrições, gênero, meta, prazo, ritmo, modo da meta, biotipo | M `perfis` | campos | onboarding (`mensagens.js:~650-679`); linha ATUALIZAR (`mensagens.js:1141-1149` → `perfis.js:67-122`); ferramenta `atualizar_perfil`; relógio no peso (`saude.js:430-434`); etapa batida (`dia.js:413`) | na hora | **sim**, por campo (`perfil.atualizacoes`) | **não** (conversa, relógio e sistema gravam igual) | fato declarado ou medido; sem marca | PERFIS DO GRUPO (de todos) + PESSOA ATUAL | falar no grupo; `!reset` apaga o perfil inteiro | baixo; os objetivos alheios vão nomeados como "de outra pessoa" (`gemini.js:698-720`) | (a) `perfis.test.mjs` |
| 2 | Apelido / sem apelido | M `perfis` | string, booleano | pessoa (`!apelido`, `comandos.js:371-394`) | na hora | não | implícita | fato | PERFIS | `!apelido X` / `!apelido nenhum` | baixo | (b) |
| 3 | Gírias da pessoa | M `perfis.girias` (últimas 15) + `Nutri-Ficha.md` | lista | LLM leve (`extrairGirias`, `dia.js:186-193`) | toda noite | não | não | inferência, sem marca | PERFIS | só à mão | médio: o LLM atribui por nome numa transcrição do grupo | (b) |
| 4 | Horários habituais | calculado a cada uso (`perfis.js:29-30`, 21 dias); vai para `Nutri-Ficha.md` | texto | código | por mensagem | implícita | registros | derivado | PERFIS | corrigindo as refeições | baixo | (a) `util.test.mjs` |
| 5 | Ficha de rotina | M `perfis.rotina` + D `Nutri-Ficha.md` (`mdPerfil`, `drive.js:278-311`) | texto até 150 palavras | LLM leve (`atualizarRotina`, `gemini.js:1275-1290`; `dia.js:194-205`) | toda noite; recusa texto cortado | não | não | inferência apresentada como fato ("O que eu já sei da rotina") | PERFIS (de todos) | só à mão (o Drive é sobrescrito à noite a partir do Mongo) | mitigado por `falasDe` (`gemini.js:284-301`) depois de um caso real de mistura | (b) só `falasDe` tem teste |
| 6 | Notas da Nutri | D `Nutri-Notas.md` + M `perfis.notas` + M `memoria_vetorial` (`notas:<nome>`) | tópicos; data "quando for medida" | LLM leve (`atualizarNotas`, `gemini.js:1785-1799`; `dia.js:206-221`) | toda noite, se a pessoa falou; descarta se encolher mais de 60% | **parcial** (pedida no prompt, não validada) | não | mistura fato dito e observação, sem marca | dossiê (4.000) + PERFIS de todos (700) + lembranças | editar o `.md` no Drive (relido por `modifiedTime`, `pessoas.js:102-104`, `147-150`) **e** o Mongo; a cópia vetorial só muda na noite seguinte | **alto**: já copiou um bairro do PDF antigo (commit `dcfd117`); hoje recebe `ondeMora` como contexto (`dia.js:210-211`) | (b) |
| 7 | Dossiê: documentos da pasta (PDF, Docs, imagem, .md) | D pasta da pessoa; texto em cache em M `arquivos_pessoa` (`id:modifiedTime`) | texto transcrito | a **pessoa** coloca; Gemini transcreve | lido a cada 10 min | não (só se o texto tiver data) | sim: nome do arquivo | "fotografia da data dele" (regra `gemini.js:88`, `313`) | dossiê (até 14.000) | trocar ou apagar o arquivo no Drive | **médio**: a pasta é achada pelo nome (`pessoas.js:41-81`; empate cria pasta nova) | (b) |
| 8 | Documentos estruturados (bioimpedância, exames, avaliação) | M `documentos_pessoa` + `perfis.documentos` (últimos 20) + `Nutri-Ficha.md` | JSON: tipo, **data**, **confiança** alta/média/baixa + motivo, medidas, exames, resumo | LLM leve (`extrairDadosDocumento`, `gemini.js:1336-1397`; `pessoas.js:233-267`) | 1 vez por versão do arquivo | **sim** (data do documento; nunca chuta hoje) | **sim** (arquivo) | **sim**; regra "confiança baixa não é verdade" (`gemini.js:277`) | PERFIS **de todos** (últimos 6, com exames fora da referência) | não há; apagar o arquivo **não** limpa `documentos_pessoa` nem `perfis.documentos` (não há limpeza no código) | **alto (privacidade)**: exames de A no prompt de B | (b) |
| 9 | Relógio (passos, gasto, sono, batimento de repouso, peso) | M `saude_relogio` (`_id` = jid) + `perfis.relogio` {linha, atualizado, gastos} + D `Nutri-Saude.md` | números por dia | app Android (`POST /relogio`) ou planilha (`saude.js`) | a cada 15 min | sim | sim (relógio) | medido | PERFIS (linha, de todos) + dossiê + ferramenta `relogio` | não há (reenvio do app) | médio: a linha de A vai para o prompt de B | (a) `hoje-mes.test.mjs` (`normalizarEnvio`, `fundir`, `saude`) |
| 10 | Pesagens | M `pesagens` {jid, dia, peso, gordura, **fonte**, hora} | 1 por dia | conversa, relógio, documento | na hora | sim | **sim** (`fonte`) | medido; `progresso.js` valida (outra pessoa na balança, libra…) | PROGRESSO DE PESO | não há comando; dizer o peso de novo sobrescreve o dia | baixo | (a) `progresso.test.mjs` |
| 11 | Refeições registradas | M `refeicoes` (+ `incerteza`) | estimativa kcal/P/C/G | LLM (linha REFEICAO) + código de fusão (`mongo.js:187-250`) | na hora | sim | parcial (`resumo`, `correcao`) | estimativa; `INCERTEZA` | REGISTRADAS HOJE, visão | `!apagar`, linha REGISTRO; correções em `correcoes_dia` e `correcoes_estimativa` | baixo | (a) |
| 12 | Lugares / casa aprendida | M `perfis.lugares` (papel, tipo, nome, bairro, cidade, noites, visitas, padrão, **manual**, candidatos) + `visitas` (90 d) + `locais_brutos` (TTL 7 d) | estruturado | código + OpenStreetMap (`lugares.js:608-652`) | a cada envio | sim (`ultimaVez`) | sim (celular, OSM, `manual`) | **"FATO"** só para onde mora com 3+ noites (`lugares.js:788-793`); roteiro = "probabilidade" (`gemini.js:112`) | LUGARES **só da própria pessoa** (`contextoLugares`, `lugares.js:761-781`) | `!lugares casa`, `!lugares aqui é X`, `!lugares esquecer` (`comandos.js:612-635`); o manual vence (`lugares.js:620-627`) | baixo na conversa; **mas `Nutri-Ficha.md` grava o bairro de casa** (`drive.js:287-292`) | (a) `lugares.test.mjs` (25), inclui `ondeMora` |
| 13 | Anotações de longo prazo | M `perfis.anotacoes` (últimas 20: {dia, tipo, texto}) + `memoria_vetorial` (`anotacao:<jid>:<ts>`) | frase + tipo (preferência, aversão, restrição, rotina, combinado, contexto) | LLM via `anotar_memoria`, **também na investigação** (sem fala da pessoa) | na hora | sim | **não** (não guarda mensagem nem quem disse) | o prompt chama de "fatos" (`gemini.js:724`), mas pode ser inferência da investigação | ANOTAÇÕES (últimas 10) | não há; à mão no Mongo; a cópia vetorial não sai | médio | (a) C25-C27, C17b |
| 14 | Memória vetorial (lembranças) | M `memoria_vetorial` {_id chave, tipo, **pessoa = nome**, dia, texto, vetor 768} + índice Atlas | texto + embedding | código, toda noite (`indexarDia`, `memoria_semantica.js:85-100`) | 23:59 | sim | tipo (conversa, notas, resumo, momento, diário, anotação) | sem marca | LEMBRANÇAS (4 com score ≥ 0,74; pessoa + "grupo" + "nutri" + citados) | não há; `!reset` não apaga | **alto**: "grupo" (resumo e momentos) e "nutri" (diário) falam de todos; a chave é o **nome** (renomear desliga a ligação) | (c) sem teste unitário; só o cenário C18b com modelo |
| 15 | Momentos memoráveis | M `momentos` + D `Perfis/Nutri-Momentos.md` (só acrescenta) | {dia, pessoa, texto, tipo} | LLM leve (`extrairMomentos`; `dia.js:169-183`) | toda noite | sim | não | inferência ("vexame", "meta") | MOMENTOS (os **12 mais recentes do grupo inteiro** em toda conversa, `mensagens.js:841`) | **nunca reescreve**; só à mão | **alto**: momentos de A no prompt de B | (b) |
| 16 | Memória de personalidade (persona) | M `persona` (_id nutri) + `persona_historico` + D `Perfis/Nutri.md` | texto até ~700 palavras, com seções por pessoa (apelidos, favoritos, padrões, piadas) | LLM Flash (`evoluirPersona`; `dia.js:271-291`) | toda noite; descarta se encolher mais de 60% | só a data da versão | não | opinião e inferência da bot; "não invente fatos" no prompt | **system prompt de toda chamada** | só à mão; `!persona` só mostra; voltar versão = copiar de `persona_historico` | **alto**: global, fala de todos, entra em tudo | (b) |
| 17 | Diário da Nutri | M `diario_nutri` + D `Perfis/Nutri-Diario.md` | texto por noite | LLM leve | toda noite | sim | não | opinião | `evoluirPersona` (últimos 3) + vetorial "nutri" | só à mão | médio (vai para as lembranças de todos) | (b) |
| 18 | Caderno de aprendizado (lições) | M `aprendizados` + `aprendizados_historico` + D `Perfis/Nutri-Aprendizados.md` | documento + até 8 regras | Flash (`revisarErros`; `dia.js:245-266`) | à noite, se houve correção ou contestação | sim (Última) | evidência (correções, contestações) | regra | **system prompt de toda chamada** | `!licoes` mostra; edição só à mão | médio (lição sobre A vale para todos) | (a) só `blocoLicoes`, `contestacoesDoDia` |
| 19 | Pensamentos particulares | M `pensamentos` {jid, dia, hora, consultas, assunto, confiança, investigação, texto, notar, sinais, valeFalar} + `perfis.pensamento` | texto + campos | Flash (`pensarSobre`, `pensamentos.js:56-97`) | 11:30, 17:30 e 21:30, só com novidade (`assinaturaNovidade`) | sim | sim (as ferramentas usadas ficam em `consultas`) | **explicitamente particular**; tem `confianca` 0-1 | só o pensamento do **mesmo dia** (`gemini.js:734`) | `!pensamentos` mostra 3; `!pensamentos agora` força um; não há edição | baixo | (a) só `assinaturaNovidade` (`plano.test.mjs:238`) |
| 20 | Reflexão (caderno livre) | M `reflexoes` (histórico) + `perfis.reflexao` {dia, síntese} + D `Nutri-Reflexoes.md` | até 700 palavras + "Em uma frase" | Flash + ferramentas (`reflexao.js:93-177`) | domingo ou `!reflexao nova` | sim | não | opinião; regra "números nunca daqui" (`gemini.js:733`) | síntese (600 caracteres) | `!reflexao nova` reescreve; não há edição | baixo ("nada sobre outras pessoas", `gemini.js:1777`) | (a) `extrairSintese` |
| 21 | **Hipóteses** | M `perfis.hipoteses` (até 8 abertas) + `hipoteses` (fechadas) | {id, texto, comoVerificar, criadaEm, status, sinais[{dia, hora, direção, evidência}], evidência, semanasAbertas} | LLM (`extrairHipoteses`, `verificarHipoteses`) + código (`fundirHipoteses`, `aplicarVereditos`) | domingo; sinais 3 vezes ao dia | sim | evidência por sinal | **fato x hipótese explícito**: aberta, confirmada, refutada, inconclusiva (6 semanas) | só pela ferramenta `reflexao` e pelos pensamentos | não há | baixo | (a) `plano.test.mjs:139` |
| 22 | Calibração (viés registro x balança; correções de estimativa) | M `perfis.calibracao` + `correcoes_estimativa` | números | código | domingo / a cada correção | sim | sim | com confiança (n/4, n/8) | CALIBRAÇÃO DAS SUAS ESTIMATIVAS | não há | baixo | (a) `calibracao.test.mjs` |
| 23 | Produtos fixos | M `perfis.produtos` (últimos 10, com `em`) | porção + macros | ATUALIZAR / ferramenta | na hora | sim | rótulo | fato | PERFIS + PESSOA ATUAL | dizer de novo (substitui pelo nome) | baixo | (a) `hoje-mes.test.mjs` |
| 24 | Despensa / notas de compra | M `despensa`, `notas`, `notas_brutas` (3 d) | itens | código + LLM | por nota / linha DESPENSA | sim | sim (nota) | estado tem/acabando/acabou; validade **estimada** | DESPENSA (só da pessoa) | `!despensa add/tirar/acabando/limpar` | baixo | (a) `despensa.test.mjs` |
| 25 | Treino (Hevy), sugestões de carga, atividades fixas, hábitos, previsões, intervenções | M `treinos`, `perfis.sugestoesCarga`, `perfis.atividades`/`atividadesFeitas`, `habitos`, `previsoes`, `intervencoes` | estruturado | código | vários | sim | sim | medido / calculado | blocos FORÇA, TREINO x REFEIÇÕES, ATIVIDADES | `!atividade`; o resto não tem | baixo (a linha de treino vai em PERFIS de todos) | (a) parcialmente (`lugares.test.mjs`, `plano.test.mjs`, `resumo.test.mjs`) |
| 26 | Progresso / visão / tendência | **não fica guardado** (calculado; `perfil._progresso` é transitório) | texto | código (`progresso.js`, `acompanhamento.js`) | por mensagem | sim | sim | intervalo de confiança, veredito com confiança | ACOMPANHAMENTO | corrigindo pesagens e refeições | baixo | (a) `progresso.test.mjs` (45), `tendencia.test.mjs` |

### 2.1 Como hoje se evita misturar pessoas (e onde ainda vaza)

Já funcionam:
- objetivos alheios nomeados como proibidos (`gemini.js:698-720`) e conferência do vocabulário do objetivo (§1.6);
- `falasDe` na rotina e nas notas (`gemini.js:289-301`, `1284`, `1786`);
- agenda só do dono (`agenda.js:22-25`, `ferramentas.js:286`);
- lugares só no prompt da própria pessoa (`gemini.js:112`; `ferramentas.js:284`), e o cenário C06b testa com modelo que ela não revela onde outra pessoa está;
- ferramentas limitadas ao que a pessoa tem (`ferramentas.js:279-292`);
- `ondeMora` vence dossiê e notas (`dcfd117`);
- "QUEM DISSE O QUÊ" (`gemini.js:144`);
- pasta do Drive com o ID gravado depois da primeira escolha (`pessoas.js:76-79`).

Ainda vaza: itens 3, 5, 6, 8, 9, 14, 15 e 16 da tabela.

---

## 3. Base de conhecimento (`conhecimento/*.md`, `conhecimento.js`)

- **10 arquivos, cerca de 65 KB:** 00-Base 5,6 KB; Emagrecimento 5,2 KB; Hipertrofia 5,0 KB; Metodos-de-Calculo 14,4 KB (v3, 09/10); Performance-Salto 5,0 KB; Rotina-Timing-Marmita 5,3 KB; Saude-Indices 5,4 KB; Suplementos-Recuperacao 6,4 KB (foco `treino`); Treino-Forca 4,2 KB; Vegetariana 8,5 KB. Cada um tem frontmatter `foco`, `versao`, `atualizado`, `consulta_en`.
- **Carga:** no boot, o Mongo `conhecimento` vem primeiro; o arquivo do repositório só substitui quando a `versao` dele é maior (`conhecimento.js:90-104`). Uma cópia vai para o Drive `Conhecimento/` (`conhecimento.js:57-61`).
- **Seleção por pessoa** (`docsPara`, `conhecimento.js:138-176`): sempre `base`; os focos pelo objetivo (regex, `111-121`; sem casamento vira `saude`); `treino` se a mensagem fala de treino **ou** se a pessoa tem Hevy; `rotina` e `metodo` só por palavra-chave na mensagem; `vegetariana` pela dieta. Pesquisas avulsas: até 4 relevantes por palavra, 1.800 caracteres cada. **Corte de 9.000 caracteres por documento** (`CONHECIMENTO_MAX_CHARS`), então Metodos-de-Calculo vai truncado. Sem texto (resumos) vai a base completa.
- **Não vai inteira:** só os focos da pessoa. Para alguém de hipertrofia com Hevy entram cerca de 21 mil caracteres (base + hipertrofia + 2 documentos de treino) e mais 9 mil se a mensagem falar de cálculo.
- **Revisão mensal** (dia 1 às 04:00, `index.js:327`; `!estudar`): PubMed/Wikipedia. Reescrita descartada se encolher mais de 30% ou perder o título (`conhecimento.js:186-212`). Pesquisa durante a conversa vira `Conhecimento/Pesquisas/` (`conhecimento.js:76-84`; `mensagens.js:939-973`).
- **Status:** `docsPara` e a carga sem teste (b). Na avaliação a base vai vazia (`conhecimento: ''`, `avaliacao/rodar.mjs:255`).
- **Divergência:** o GUIA:173 lista 6 documentos; existem 10.

---

## 4. Proatividade (o que o bot faz sozinho)

| Horário (fuso do grupo) | O que faz | Freio | Onde |
|---|---|---|---|
| 23:59 | fecha o dia: resumo, momentos, gírias, rotina, notas, ficha, diário, lições, memória vetorial, persona; domingo: semana + reflexão | `estado.fechandoDia` | `index.js:300`; `dia.js:131-322` |
| a cada 10 min | cobra refeição atrasada | só depois de aprender o horário (3+ registros); 75 min de atraso; 1 por refeição por dia; 7h-23h | `index.js:304`; GUIA:178 |
| :07, :22, :37, :52 | confere atividade fixa pela localização; pergunta se não souber | 1 pergunta | `index.js:305` |
| 18:30 | pergunta a validade de itens da despensa | 1 por pessoa por dia | `index.js:306` |
| 11:30 / 17:30 / 21:30 | investigação + pensamento → talvez uma intervenção | só com novidade; ver `podeIntervir` | `index.js:308`; `pensamentos.js` |
| :37 de hora em hora | revisão das respostas de reserva | até 2 por semana | `index.js:311` |
| domingo 09:00 | pede o peso de quem não tem relógio | — | `index.js:316` |
| segunda 08:00 / sexta 18:00 | nota de voz programada | `!voz off` | `index.js:318-319` |
| sexta 12:00 | oferece o plano da semana | aceite até domingo | `index.js:320` |
| dia 1 às 08:00 / 04:00 | relatório do mês / revisão da base | — | `index.js:322`, `327` |
| 07:20 | checa o Drive | — | `index.js:330` |
| ao sair de mercado | pergunta se comprou algo | 1 por dia; só sem nota nas últimas 3 h | GUIA:235 |
| ao voltar de queda | resgata mensagens dirigidas a ela (até 6, de até 48 h) ou avisa no grupo | volta em silêncio se ficou fora menos de 30 min | `retomada.js`; (a) `retomada.test.mjs` (12) |

**Intervenção espontânea** (`proatividade.js:48-65`, função pura): no máximo 1 por dia **no grupo inteiro**, só entre 8h e 21h da pessoa, confiança ≥ 0,6, nunca até 30 min depois de a pessoa falar, assunto novo (contenção ≥ 0,6 contra os últimos 7 dias e contra o que a bot já disse hoje), pausa de 3 dias depois de 3 intervenções ignoradas. Texto com mais de 420 caracteres ou SILENCIO não sai. Tudo fica em `intervencoes`, com `respondida` marcado se a pessoa falar em até 3 h (`proatividade.js:119-132`). Status: (a) `proatividade.test.mjs` + C20-C24 e C37; o envio e a redação, (b).

**Avisos de erro** (`avisos.js`): frases prontas por tipo, no máximo 1 por tipo a cada 10 min no grupo (`AVISO_ERRO_MIN`) e 1 a cada 30 min no privado do admin. (b)

**O que vale mostrar no app (já existe nos dados):** "o que a bot notou" = `pensamentos.notar` + `sinais`; hipóteses abertas e fechadas com evidência; intervenções com motivo, confiança e se houve resposta; anotações; a fila de revisão de reserva; lições; o histórico da persona.

---

## 5. Avaliação

- **`npm test`** (`node --test test/**/*.test.mjs`): 15 arquivos. Contagem de `test(`: progresso 45, hoje-mes 46, lugares 25, plano 15, util 15, retomada 12, despensa 8, resumo 8, consciencia 7, tendencia 6, calibracao 5, ferramentas 5, proatividade 3, perfis 2. `comportamento.test.mjs` tem **40** casos `caso(...)` determinísticos (C01-C49).
- **`npm run avaliar`** (`avaliacao/rodar.mjs`): monta o prompt real (`ia.responder`) com perfis, histórico e ferramentas falsos (`FIXAS`, linhas 76-96), aplica **as mesmas guardas** de `mensagens.js` (linhas 121-200), confere deve/não deve, tamanho, linha REFEICAO, ferramentas usadas, pergunta ou incerteza e contradição de progresso. Status: ✅, 🟡 (a guarda segurou), ❌ ou ⚠️. Relatório JSON em `avaliacao/relatorios/` (9 relatórios de 04/10 e 09/10). Usa `AVALIACAO_GEMINI_API_KEY` (fila Flash) ou, sem ela, a chave do `.env` na fila Lite. Pausa de 1,5 s (Lite) ou 4 s (Flash); limite de 150 s por cenário. **Custo:** cerca de 1 chamada por cenário, mais 1 por refação e 1 a 2 rodadas de ferramenta. O workflow `.github/workflows/avaliacao.yml` existe (o GUIA:242 diz que roda toda segunda às 07:00; não abri o arquivo).
- **Cenários (`avaliacao/cenarios.mjs`): 38.** Gênero (C01, C02, C12), bordão (C05, C32), repetição (C08), lugares (C09, C06b), objetivo (C13, C14), C34, C39, C35, C40, C36, C41, estimativa (C42, C43), memória (C17b, C18b), ferramentas (C19b, C20b, C44), C21b, C24b-C28b, C33b, C45-C47 e progresso P01-P05.
  - **C34:** "ia ser iogurte" é plano: sem bloco e sem REFEICAO.
  - **C39:** "foram 3 fatias" vira `correcao:true` com kcal maior.
  - **C41:** "como está meu ritmo pra chegar nos 80?" exige 0,xx kg e "80", sem "exatamente" nem "garantido".
  - **P01/P02/P05:** a análise tem o formato do caso real anonimizado de 09/10 (`cenarios.mjs:32-46`). P01 pede pesagens, alvo, margem e balança. P02 explica relógio x balança x foto. P05 mostra qual janela (3 x 4 semanas) explica a sensação da pessoa.
  - **P03:** com poucas pesagens, não crava o ritmo. **P04:** peso estável não vira "caindo".
- **Limites da avaliação:** conhecimento, dossiê e momentos vão vazios (`rodar.mjs:255-257`), então não mede o prompt de produção nem o vazamento entre pessoas pelos blocos reais. Não mede latência de produção nem tamanho do prompt.
- **Divergência com o GUIA:242:** o GUIA fala em "39 casos determinísticos" e "33 cenários com modelo"; o código tem 40 e 38.

---

## 6. Riscos

1. **Dados de uma pessoa aparecendo para outra**
   - `blocoPerfis` manda notas, rotina, relógio, treino e documentos com exames fora da referência de **todos** em toda resposta e em todo resumo (`gemini.js:250-282`).
   - Os momentos são do grupo inteiro (`mensagens.js:841`).
   - A persona e as lições são globais e vão no system prompt.
   - A memória vetorial devolve itens "grupo" e "nutri" e usa o nome como chave (`memoria_semantica.js:64`, `89-97`).
   - A pasta é escolhida pelo nome (`pessoas.js:41-81`).
   - `!reset` não apaga notas, memória vetorial, momentos, pensamentos nem documentos.
   - O que segura hoje: regras do prompt e o cenário C18b. Não há filtro em código.
2. **Número inventado**
   - Barrado em código só o "total do dia" com 1.500 kcal ou mais (`consciencia.js:34-50`) e a contradição de progresso.
   - Contestação passa por um modelo leve que **falha aberto**.
   - Números do relógio citados na conversa, estimativas por refeição e números da reflexão ou da persona não são conferidos.
   - `redigirIntervencao` só pede "sem número que não esteja no pensamento" (`gemini.js:1646`).
3. **Fato x inferência sem marca**
   - `anotar_memoria` chamado pela investigação (sem fala da pessoa) vira "fato de longo prazo" no prompt (`pensamentos.js:65`; `gemini.js:724`, `1661`).
   - A rotina e as notas misturam o que a pessoa disse com o que a bot deduziu.
4. **Prompt crescendo**
   - Persona até cerca de 700 palavras, lições, conhecimento por foco (9 mil por documento), dossiê de 14 mil + 4 mil, todos os perfis (cresce com o número de pessoas) e 50 mensagens.
   - Não há orçamento total nem medição persistida.
   - O cache implícito depende da ordem (`gemini.js:705-706`), e a persona muda toda noite.
5. **Latência**
   - Uma mensagem pode somar: ferramentas (até 2 rodadas), PESQUISAR ou PRODUTO (+1 chamada), conferência de contestação (+1 leve) e refação (+1 completa).
   - Os prazos são de 75 s e 300 s.
   - O dossiê tem limite de 20 s (`mensagens.js:839`), as lembranças 6 s, a visão 8 s.
   - Não existe p50/p95.
6. **Cota da API e modelo reserva**
   - Nível gratuito por modelo (GUIA:177: Flash 20/dia, Lite 500/dia); castigo até o reset diário (`gemini.js:376-380`).
   - O uso só existe em RAM (zera no restart).
   - As reservas externas não fazem function calling e respondem com qualidade menor; a revisão é só por amostragem (2 por semana).
   - `PESQUISA_WEB` está desligada por falta de cota de grounding (`gemini.js:1300-1303`).
7. **Correção que não se propaga**
   - Editar só o Mongo ou só o Drive deixa as duas cópias divergindo (notas: `pessoas.js:147-150` lê o Drive, `blocoPerfis` lê o Mongo).
   - A cópia vetorial (`notas:<nome>`, anotações) continua antiga.
   - A reescrita noturna pode reintroduzir o erro a partir do dossiê.

---

## 7. Divergências entre o GUIA e o código

| GUIA | Código |
|---|---|
| :173: base com 6 documentos | 10 documentos (`conhecimento/`) |
| :177: fila Flash termina em 2.5 | sem 2.5 no padrão (`gemini.js:341`) |
| :242: 39 casos determinísticos / 33 com modelo | 40 / 38 |
| :153-169: tabela de comandos | faltam `!apagar`, `!apelido`, `!hoje`, `!licoes`, `!pensamentos`, `!reflexao`, `!lugares`, `!plano`, `!despensa` e outros (citados soltos no texto; lista completa em `comandos.js:178-658`) |
| :175: notas "reescritas toda noite" | só se a pessoa falou no dia (`gemini.js:1787`), e são descartadas se encolherem mais de 60% (`dia.js:212`) |
| :251: memória vetorial guarda conversa, resumo, momentos, notas e diário | também anotações (`ferramentas.js:252`) |

---

## 8. Implicações para a área "Conhecimento da IA" do app

- **Não existe API de leitura nem de escrita** para nada disso. O Express só tem `/ping`, `/`, `/privacidade`, `/estado`, `/status` (com token de admin), `/relogio`, `/nota`, `/qr` e `/logout` (`index.js:60-186`). Status: (e).
- **Um item editável precisa de um esquema comum** que hoje não existe: `pessoa (jid)`, `tipo`, `texto/valor`, `fonte` (pessoa, relógio, documento, modelo, código), `evidência` (mensagem, arquivo, sinal), `data`, `confiança`, `natureza` (fato declarado, medido, inferido, hipótese) e `status`. Os modelos mais próximos são `documentos_pessoa` e `perfis.hipoteses`.
- **Corrigir ou apagar precisa propagar** para o Mongo (perfil e coleção), o arquivo `.md` no Drive e a memória vetorial (remover pela chave), e travar a reescrita noturna. Sem isso, a próxima noite desfaz a correção.

---

## Perguntas em aberto

1. Dados de saúde (exames, linha do relógio, notas) de cada pessoa devem continuar indo no prompt das outras? Ou o bloco PERFIS deve levar só nome, objetivo, gênero e dieta das outras pessoas?
2. A persona global (com seções por pessoa) e os momentos do grupo devem ser separados por pessoa para o app poder mostrar e editar "o que a bot acha de mim"?
3. Qual é a fonte da verdade quando a pessoa edita no app: o Mongo (e o Drive passa a ser só espelho) ou o `.md` do Drive (como as notas são lidas hoje)?
4. Uma anotação criada pela investigação, sem fala da pessoa, deve ser marcada como inferência e ficar fora do bloco "fatos"?
5. `!reset` e a futura exclusão pelo app devem apagar também memória vetorial, momentos, pensamentos, reflexões, hipóteses, documentos e as pastas do Drive (direito de apagar)?
6. Quanto tamanho de prompt é aceitável? Vale gravar `promptTokenCount` e latência por chamada no Mongo para o app mostrar custo e tempo?
7. A memória vetorial deve passar a usar o jid como chave em vez do nome?
8. O app deve permitir confirmar ou refutar hipóteses (fechando o ciclo que hoje é só da IA no domingo)?
9. O `avaliacao.yml` roda de fato com o secret configurado? Qual foi o último resultado (os relatórios locais vão até 09/10)?
10. Documento apagado do Drive deve sair de `documentos_pessoa` e `perfis.documentos`? Hoje continua lá.
