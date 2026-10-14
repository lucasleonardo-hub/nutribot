> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# R2 — Registro de refeições, banco de alimentos e cálculos nutricionais

Auditoria somente leitura do repositório `C:\Users\lucas\Downloads\BOT` (HEAD `2ae910e`, 13/10/2026). Escopo: como uma mensagem vira refeição, onde e como ela é guardada, que banco de alimentos existe e como o dia é somado. A estatística do progresso de peso fica com o agente R3; aqui só aponto onde ela mora.

Legenda de status usada em todo o relatório:

- **(a)** implementado e coberto por teste em `test/`
- **(b)** implementado, sem teste
- **(c)** parcial
- **(d)** só planejado ou comentado
- **(e)** inexistente

"Coberto por teste" quer dizer que existe teste unitário da função pura. Nenhum teste exercita `mensagens.processar` nem `mongo.registrarRefeicao` de ponta a ponta. Os dois não têm teste nenhum.

---

## 0. Resumo para quem vai desenhar o app

1. **A refeição é um documento solto na coleção `refeicoes`**, com estimativa só de kcal, proteína, carboidrato e gordura. Não guarda fibra, micronutrientes, itens estruturados, foto nem histórico de edição. A lista de itens é uma string (`descricao`, até 220 caracteres).
2. **Quem decide o que é refeição, o tipo e os números é a IA** (linha oculta `REFEICAO: {...}`). O código cerca essa decisão com regex e heurísticas de tempo. Não existe uma API de "registrar refeição" separada do fluxo do WhatsApp. O único caminho fora da conversa é o `!refeicao` (comandos.js:322).
3. **Não existe banco de alimentos consultável pelo usuário.** A TACO (597 itens) e o Open Food Facts servem só de âncora dentro do prompt. Não há busca por nome exposta, leitura de código de barras por imagem nem pesagem de porção.
4. **Nada do dia é persistido como agregado.** Totais, médias de 7 e 30 dias, metas, sequência e placar são recalculados a cada chamada a partir de `refeicoes`, `pesagens`, `habitos` e `perfil.relogio.gastos`. Para o app, ou se reimplementam essas funções puras, ou o servidor passa a expô-las.
5. **As fotos das refeições não são guardadas.** Só ficam em `revisoes_pendentes` por até 24 h, e apenas quando a resposta saiu por um modelo reserva (revisao.js:51). Um app que queira mostrar a foto do prato precisa de armazenamento novo.

---

## 1. Diagrama: mensagem → registro → resumo

```
WhatsApp (Baileys) ── whatsapp.js ──► enfileirarMensagem (mensagens.js:137)
        │  espera de lote: 6 s, teto de 20 s (ESPERA_LOTE_MS / _MAX_MS)
        ▼
drenar (mensagens.js:270)
  ├─ agruparFotos (91): fotos seguidas da mesma pessoa (≤ 6, ≤ 300 s) viram UMA análise
  ├─ ainda digitando? → iniciarEsperaFragmento(porDigitacao) (249/286)
  ├─ deveEsperarFragmento (189):
  │     foto sem legenda e sem refeição nos últimos 30 min → espera 20 s (209)
  │     candidatoAFragmento (consciencia.js:79) + IA leve julgarFragmento (gemini.js:1468) → espera 45 s (teto 90 s)
  └─ processar (566), com cão de guarda de 4 min
        ├─ fora do grupo → tratarPrivado (492): só o admin, só !comandos, cupom de teste
        ├─ tratarComando (comandos.js:174) ── !refeicao / !apagar / !hoje ... (retorna aqui)
        ├─ onboarding (649), nota fiscal em texto ou PDF (689), aceite do plano (710), atividade pendente (712)
        ├─ foto: aviso imediato (ACKS_FOTO) → baixa a mídia → tem QR de NFC-e? → despensa (749-773) e retorna
        ├─ áudio: baixa e manda o binário ao Gemini (776); não há transcrição separada
        ├─ prioridade (472) / dirigidaAOutro (458) / emLote / !silencio → só vai pro histórico
        ├─ rótulo puro ("era o almoço") ≤ 45 min → atualizarRefeicao(slot) e retorna (858-871)
        ├─ monta o contexto: refeições de hoje, visão 7/30 (acompanhamento.js), código de barras → OFF (880),
        │     emAndamento (≤ 30 min, 892-897), planejando, contestação, metaConversa, perguntaProgresso
        ├─ ia.responder (gemini.js:696)  [âncoras TACO, rótulos OFF, despensa, calibração]
        │     └─ separarAtualizacao (gemini.js:798) → texto + linhas ocultas
        │          REFEICAO · REGISTRO · HABITO · INCERTEZA · PERGUNTA · PRODUTO · DESPENSA · NOTA · ATUALIZAR …
        ├─ PESQUISAR (940) / PRODUTO (976) → segunda chamada à IA
        ├─ CONFERÊNCIA ANTES DE ENVIAR (997-1065): numerosSuspeitos, conferirResposta (contestação),
        │     vocabularioErrado, conferirTextoProgresso → refaz uma vez ou corta a frase
        ├─ plano: tira o bloco de refeição (1068) · papo curto (1080) · repetição e bordões (1088-1106)
        ├─ enviar(resposta)
        ├─ HABITO → registrarHabito (coleção habitos, $inc) (1189)
        ├─ REGISTRO → apagarRefeicaoPorId / atualizarRefeicao (só registros de HOJE da própria pessoa) (1194-1234)
        │                 + correcoes_dia + correcoes_estimativa
        └─ foiRefeicao? (1135) → registrarRefeicao(...) (1254)   ◄── sem await (fire and forget)
                │
                ▼
      mongo.registrarRefeicao (mongo.js:187)
        ├─ manual && ±10 min de um registro da pessoa → SUBSTITUI estimativa e descrição (198-207)
        ├─ último registro ≤ 30 min, mesmo slot (ou slot não explícito) → FUNDE (212-247)
        │     correção (ou descrição parecida, pareceMesmaDescricao) → substitui; complemento → soma kcal/p/c/g
        │     correção com estimativa anterior → correcoes_estimativa (calibração)
        └─ senão → insertOne
                │
                ▼
  Leitura (sempre recalculada, nada é agregado em disco):
   !hoje ───── resumirHoje (resumo.js:191) + visaoZap (resumo.js:846) via visaoDe (acompanhamento.js:42)
   prompt ──── registradasHojeParaPrompt (resumo.js:287) + visaoPeriodo (resumo.js:798) + PROGRESSO (progresso.js)
   23:59 ───── fecharDia (dia.js:131): compilarRefeicoesDoBanco (resumo.js:109) + correcoes_dia
               → IA resumoDiario → grupo + Drive Resumos/AAAA-MM-DD.md (o texto, não os números)
   domingo ─── fecharSemana (dia.js:324): compilarSemana + placarSemana + previsão + calibração + gráfico QuickChart
   dia 1 ───── fecharMes (dia.js:521): compilarMes
```

---

## 2. Entrada: como uma mensagem vira refeição

### 2.1 mensagens.js

| Item | Onde | Status | Observação |
|---|---|---|---|
| Lote de mensagens (6 s, teto de 20 s) | mensagens.js:132-148 | (b) | Os 20 s daqui são o teto do lote. A espera de 20 s pela legenda é outra regra (linha seguinte). |
| Várias fotos = uma análise | `agruparFotos` mensagens.js:91 | (a) hoje-mes.test.mjs:642 | Até 6 fotos (`MAX_FOTOS_JUNTAS`), no máximo 300 s entre elas. O texto que vem entre as fotos entra como legenda. |
| Foto sem legenda espera 20 s | mensagens.js:209, `ESPERA_FOTO_SEM_LEGENDA_MS` | (b) | Só quando não há refeição da pessoa nos últimos 30 min. Reage com 👀. |
| Refeição em partes (fragmento) | `deveEsperarFragmento` 189, `liberarFragmentos` 232, `juntarFragmento` 260 | (c) | O pré-filtro `candidatoAFragmento` tem teste (hoje-mes.test.mjs:510). O julgamento é da IA leve (`julgarFragmento`, gemini.js:1468) e não tem teste. A espera é de 45 s, com teto de 90 s. |
| Ainda digitando | mensagens.js:286, 236 | (b) | Confere a presença a cada 3 s. `digitandoRecente` (consciencia.js:88) não é importado em nenhum teste. |
| Parte da mesma refeição (≤ 30 min) | `parteDaMesma`/`emAndamento` mensagens.js:894-897 | (b) | Foto com legenda de até 60 caracteres ou texto de até 80, sem plano e sem nomear outra refeição. O prompt recebe "REFEIÇÃO EM ANDAMENTO" (gemini.js:747-749). |
| Correção logo depois | `correcaoRecente` mensagens.js:1132-1134; `pareceCorrecao` util.js:251 | (c) | `pareceCorrecao` e `parecePedidoOuPlano` têm teste (util.test.mjs:130,145; C34). A decisão em `processar` não tem. |
| Correção horas depois ("não teve chocolate…") | linha REFEICAO com `hora` → `retroativa` (1130-1131) → `manual: true` → substituição ±10 min (mongo.js:198) | (b) | Depende da IA pôr `hora` igual à do registro original. Não há teste. |
| "Não teve X" / "não tem Y" | só o prompt (gemini.js:749: "NÃO repita item que ela negou") | (c) | Não há remoção de item em código: o item é texto livre em `descricao`. |
| Plano × relato | `parecePedidoOuPlano`/`pareceConsumo` util.js:240-249; strip do bloco mensagens.js:1068; `ehPedido` 1120 | (a) util.test.mjs:130,145; C34 | A decisão olha também a mensagem citada (`textoDecisao`, 848). |
| Citação | `citacaoDe` mensagens.js:439 | (b) | Exportada, sem teste. Vai para o prompt (gemini.js:737). |
| Mensagem dirigida a outra pessoa | `dirigidaAOutro` mensagens.js:458; uso em 790 | (b) | Citar ou marcar a si mesmo não conta (correção de 04/10). Sem teste. |
| Rótulo puro ("lanche da tarde") | `lerRotuloRefeicao` resumo.js:313; mensagens.js:858 | (a) hoje-mes.test.mjs:132 | Só troca o `slot` do último registro (≤ 45 min). Não chama a IA. |
| Conversa sobre o bot | `pareceMetaConversa` consciencia.js:150 | (a) C35, hoje-mes.test.mjs:456 | Bloqueia o registro. |
| Áudio | mensagens.js:776-786; gemini.js:764 | (b) | **Divergência com o pedido da auditoria:** `voz.js` é só TTS de saída (texto → ogg; voz.js:1-10). O áudio de entrada vai cru ao Gemini, sem transcrição salva. O registro fica com `resumo: '[áudio]'` e a descrição sai da análise. |
| Atraso / resgate após queda | mensagens.js:580-583, 822-828 | (a) parcial em retomada.test.mjs | Fora do escopo; afeta a hora do registro (abaixo, §6). |

### 2.2 Quando a mensagem vira registro (`foiRefeicao`, mensagens.js:1135)

```
foiRefeicao = !ehPedido && !metaConversa && !blocoDeSugestao &&
              (estruturada || temBloco || correcaoRecente || (temImagem && resposta && !naoEhComida))
```

- `estruturada`: linha REFEICAO com 0 < kcal < 8000 (1127).
- `temBloco`: regex sobre o texto visível, "Refeição: café|almoço…" ou "O que eu vi" (1111).
- O fallback de foto registra mesmo sem bloco, quando o modelo reserva o esquece (1135). Pode registrar sem estimativa.
- Números, em ordem de preferência: linha REFEICAO, depois `lerEstimativa` sobre o texto (resumo.js:18, testado em resumo.test.mjs:7), depois `estimarRefeicaoManual` na IA leve (gemini.js:1123, 1250).
- Tipo, em ordem: slot da refeição corrigida, `tipo` da linha, hora dita (retroativa), "Refeição:" no texto e por fim `slotDaHora` (1243).

Status: (c). As peças puras têm teste. A expressão composta e a chamada de `registrarRefeicao` não têm.

### 2.3 comandos.js (todos os `!`)

`tratarComando` (comandos.js:174). Comando desconhecido iniciado por `!` é engolido em silêncio (662).

| Comando | Linha | O que mostra ou faz | Relevância para refeição |
|---|---|---|---|
| `!refeicao [tipo] descrição` | 322 | IA leve estima (`estimarRefeicaoManual` com âncoras TACO) e grava com `manual: true` | **Registro direto.** Veja o bug §7.1. |
| `!apagar HH:MM` / `!apagar ultimo` | 301 | Apaga um registro de **hoje** da própria pessoa e grava em `correcoes_dia` | Exclusão definitiva. |
| `!hoje` / `!hoje todos` | 285 | `resumirHoje` (cada refeição, total, água e álcool) + `visaoDe(formato 'zap')` | Tela "Hoje". |
| `!grafico [todos]` | 447 | PNG via QuickChart: kcal por dia, gasto do relógio, faixa da meta, peso, massa magra (graficos.js:21) | Gráfico de 30 dias. |
| `!progresso` | 558 | `progressoDe(...).zap` | R3 |
| `!tendencia` | 540 | `tendenciaCompleta` ou `linhaDeTendencia` | R3 |
| `!despensa` (add / tirar / acabando / limpar), `!nota` | 470 | Despensa | §3.3 |
| `!plano [pedido]` | 637, `gerarPlano` 60 | Plano da semana com lista de compras (IA Flash + ferramentas) | Usa `padraoAlimentar` (resumo.js:356). |
| `!perfil` | 198 | Ficha, incluindo os "Produtos fixos" com kcal | Os produtos fixos são uma âncora nutricional (perfis.js:105). |
| `!treino`, `!relogio`, `!agenda`, `!lugares`, `!atividade`, `!pensamentos`, `!reflexao`, `!proativa` | 435, 395, 420, 612, 507, 571, 590, 530 | Fora do escopo | — |
| `!id`, `!nome`, `!resumo`, `!reset`, `!dossie`, `!fontes`, `!estudar`, `!licoes`, `!persona`, `!status`, `!silencio`, `!falar`, `!apelido`, `!voz`, `!ajuda` | 178-261, 360-394, 648-661 | Utilitários | `!resumo` força o fechamento do dia. |

Status geral: (b). Só `duracaoDe` tem teste (hoje-mes.test.mjs:61).

### 2.4 ferramentas.js (function calling)

**Nenhuma ferramenta registra, edita ou apaga refeição.** O comentário em ferramentas.js:102-103 diz isso explicitamente: o registro continua pela linha oculta REFEICAO. As ferramentas ligadas a refeição são todas de leitura:

- `refeicoes_periodo` (ferramentas.js:137): lista de até 120 registros e totais por dia, com o dia completo marcado por `diasDeComida`.
- `padrao_alimentar` (160).
- `despensa` (230).

As ferramentas de escrita são só `anotar_memoria` e `atualizar_perfil` (104-115). Status: (a) para declarações, executores e escrita (ferramentas.test.mjs:9; C25-C28).

### 2.5 gemini.js: análise do prato

- **Regras do prompt** (gemini.js:134-173): formato do bloco 🕐/🍽️/🔥/⚖️/💡 (158-168), "legenda manda" (154), foto que não é refeição (155), rótulo do que foi consumido (156), sugestão sem bloco (157), âncora da despensa (170), INCERTEZA + PERGUNTA (171), linha REFEICAO obrigatória (172) e correção curta (173). Status: (c). São instruções ao modelo, verificadas pela suíte `avaliacao/` (C34, C39, C42, C43, C46, C47) com chamada real. Não fazem parte do `npm test`.
- **Formato da linha** (gemini.js:172): `REFEICAO: {"tipo","itens","kcal","proteina","carbo","gordura","correcao","hora"}`. Sem fibra e sem itens estruturados.
- **Parser** `separarAtualizacao` (gemini.js:798-914). Aceita "REFEIÇÃO" com cedilha (844) e descarta kcal ≤ 0 (848). Status: (a) para REFEICAO, PRODUTO, REGISTRO, HABITO e INCERTEZA (hoje-mes.test.mjs:268, 534, 610; C18, C19, C48). A variante com cedilha não tem teste. `semLinhaAtualizar` (util.js:163) só remove `REFEICAO:` sem cedilha.
- **Validador de foto** `validadorDeFoto` (gemini.js:783) recusa a resposta que fala "como a pessoa". Status: (b).
- **Âncoras** `blocoAncoras` vão no prompt só quando não é modo leve (gemini.js:697, 736) e em `estimarRefeicaoManual` (1128).
- **Porções**: texto livre dentro de "itens" ou "O que eu vi". Nenhum campo de gramas por item.

### 2.6 consciencia.js e a conferência antes do envio

| Guarda | Onde | Status |
|---|---|---|
| Total "do dia" citado que não existe nos registros | `numerosSuspeitos` consciencia.js:34; mensagens.js:1003 | (a) hoje-mes.test.mjs:549 |
| Contestação → IA leve confere contra os registros | `pareceContestacao` :9; `ia.conferirResposta` gemini.js:1439; mensagens.js:1007 | (c): regex testada, conferência por IA sem teste |
| Vocabulário do objetivo oposto | `vocabularioErrado` :118 | (a) C13, C14, hoje-mes.test.mjs:489 |
| Progresso contraditório | `conferirTextoProgresso` (progresso.js:1074) | (a) progresso.test.mjs (R3) |
| Repetição, bordão, gíria, vocativo, papo curto | :252, :349, :377, :394, :179 | (a) consciencia.test.mjs, C01-C08, C36 |
| Bloco de refeição em plano é retirado | mensagens.js:1068-1078 | (b) |

---

## 3. Banco de alimentos

### 3.1 TACO: taco.js, dados/taco.json, scripts/gerar-taco.mjs

- **Origem:** TACO 4ª ed. (NEPA/UNICAMP), via o CSV de github.com/brolesi/taco (gerar-taco.mjs:1-13). Mais 28 "rótulos típicos" (whey, hipercalórico, hommus…). Gerado em 24/09/2026.
- **Cobertura:** 597 alimentos + 28 extras, **209 apelidos** (verificado lendo o JSON). Campos por 100 g: `kcal, p, c, g, fibra`. **Não há micronutrientes**, embora a TACO tenha.
- **Consulta:** `ancorasDe(texto)` (taco.js:125) faz regex sobre o texto livre (apelidos do mais longo para o mais curto) e lê a quantidade antes ou depois do nome ("200 g de arroz", "2 ovos", "3 fatias de pão"). Usa medidas caseiras de `MEDIDAS` (taco.js:30-78), com no máximo 10 itens. `blocoAncoras` (177) monta o texto para o prompt.
- **Uso:**
  1. âncora no prompt da conversa (gemini.js:697, 736);
  2. `!refeicao` e a estimativa de reserva (gemini.js:1128);
  3. nutrição de itens in natura da despensa (despensa.js:222-231).
- **Não há** busca por nome exposta ao usuário, comando, endpoint nem lista de alimentos. O casamento depende de o apelido estar entre os 209 cadastrados. "Alcatra" mapeia para patinho (gerar-taco.mjs, comentário no array).
- Status: (a) hoje-mes.test.mjs:189 (arroz 200 g = 257 kcal, fatias, scoop de whey, texto sem comida). Busca por nome livre: (e).

### 3.2 Open Food Facts: off.js

- **Código de barras:** só quando a pessoa **digita** os dígitos (EAN-8/12/13/14) no texto (`codigosDeBarras`, off.js:14; `rotulosPara`, 122; mensagens.js:880). **Não há leitura de código de barras em imagem.** O `jsQR` só lê o QR da NFC-e (despensa.js:38).
- **Por nome:** a IA responde `PRODUTO: <nome>` e o sistema chama `buscarPorNome` (off.js:78) no `search.openfoodfacts.org`, com ranking por palavra e marca e Brasil primeiro. Em seguida responde de novo (mensagens.js:976-991).
- **Cache:** coleção `produtos`, por 30 dias (off.js:56-63).
- **Normalização:** `normalizarProduto` (off.js:22) traz kcal, proteína, carbo, gordura, açúcares, fibras, sódio, porção, NOVA e Nutri-Score. **Fibra, sódio, NOVA e Nutri-Score só vão para o prompt**; nada disso chega ao registro.
- **Leitura de rótulo por foto:** só via visão do Gemini, por instrução do prompt (gemini.js:156). Não há OCR em código.
- Status: (a) para `codigosDeBarras`, `normalizarProduto` e `blocoRotulos` (hoje-mes.test.mjs:351). Busca HTTP: (b).

### 3.3 Despensa: despensa.js (NFC-e → o que tem em casa)

- **Entradas:**
  1. foto do cupom, com o QR lido no servidor e os itens lidos pela visão (`extrairItensCupom`, mensagens.js:749-773);
  2. linha `NOTA` da IA quando não há QR legível (mensagens.js:1169);
  3. texto da página da SEFAZ colado ou em PDF (mensagens.js:689; `parsearTextoNfce` despensa.js:114);
  4. app Android "Ler cupom", que abre a nota num WebView e faz POST `/nota` (index.js:82; android/.../Cupom.kt).
- **Processamento:** `padronizarItens` (despensa.js:189). A IA leve normaliza o nome e a categoria; itens não alimentares são descartados (`pareceNaoAlimento`, 172). A nutrição vem da TACO para in natura, do OFF por EAN, ou do OFF por nome com até 10 buscas por nota.
- **Coleções:** `notas` (sem CPF e sem total; despensa.js:252), `despensa` (um documento por pessoa e item, com `k` normalizado, quantidade, estado tem/acabando/acabou, validade estimada e `nutri` por 100 g; 257-287) e `notas_brutas` (TTL de 3 dias).
- **Uso nas refeições:**
  1. bloco DESPENSA no prompt como âncora nutricional (despensa.js:338; gemini.js:170);
  2. baixa pela linha `DESPENSA: [{item, acao, qtd}]` (`aplicarLinhaDespensa`, 326; mensagens.js:1165).

  **Não há ligação estrutural** entre o registro de refeição e o item da despensa (nenhum id cruzado).
- **Proativo:** pergunta de validade às 18:30 (`perguntarValidades`, 411; index.js:306) e "comprou algo?" ao sair do mercado (388).
- Status: (a) para chave, QR, parser SEFAZ, `acharItem`, `nomeBate`, `pareceNaoAlimento` e confirmação (despensa.test.mjs; C30). `ajustarItem`, `entrarNaDespensa` e `padronizarItens`: (b).

### 3.4 calibracao.js: calibração de quê

Duas coisas, ambas por pessoa:

1. **Energia** (`perfil.calibracao.energia`): viés semanal de "comida registrada − relógio" contra a balança. Média móvel exponencial com α 0,3 e confiança plena em 4 semanas (calibracao.js:20-54), atualizada no domingo (`calibrarNoDomingo`, 159; dia.js:377). Desde 09/10 **não entra mais no prompt** (acompanhamento.js:61-63, `energia: false`), porque o PROGRESSO traz o viés medido.
2. **Correções da própria pessoa** (coleção `correcoes_estimativa`): pares "antes x depois" gravados em mongo.js:226-230 (fusão com `correcaoEstimativa`) e em mensagens.js:1227 (linha REGISTRO). `estatisticasCorrecoes` (86) dá a mediana da razão e as categorias (pão, arroz/massa, carne, doce, bebida, gordura). Com 3 correções ou mais, vira o bloco "CALIBRAÇÃO DAS SUAS ESTIMATIVAS" no prompt (`descreverCorrecoes`, 110). `ehCorrecaoDeEstimativa` (175) separa a correção de quantidade do simples acréscimo de item.

Status: (a) calibracao.test.mjs; C32, C49.

### 3.5 O que de fato existe

| Recurso | Status | Onde |
|---|---|---|
| Leitura de rótulo por foto | (c): só visão do LLM por instrução, sem extração estruturada | gemini.js:156 |
| Código de barras digitado | (a) | off.js:14 |
| Código de barras por câmera ou imagem | (e) | — |
| Busca de alimento por texto (usuário) | (e) | só âncora interna por regex (taco.js:125) e `buscarPorNome` interno do OFF |
| Pesagem ou balança de cozinha para porção | (e) | — |
| Produtos fixos da pessoa (rótulo salvo) | (b) | perfis.js:105-120; prompt gemini.js:140, 717 |
| Medidas caseiras → gramas | (a) | taco.js:30-115 |

---

## 4. Armazenamento

### 4.1 Coleção `refeicoes`: esquema do documento

Índices: `{jid:1, dia:1}` e `{dia:1}` (mongo.js:28-29). Gravação em `registrarRefeicao` (mongo.js:187), chamada em mensagens.js:1254, comandos.js:342 e revisao.js:158.

```jsonc
{
  "_id": ObjectId,                 // único identificador; não há id estável próprio
  "jid": "55DD...@s.whatsapp.net", // jids[0] do remetente (pode ser LID); leituras usam $in perfil.jids
  "nome": "Pessoa A",        // nome no momento do registro (compilarRefeicoesDoBanco também casa por nome)
  "dia": "2026-10-13",             // dia no FUSO DO GRUPO (agora(), mensagens.js:609), não no fuso da pessoa
  "hora": "15:27",                 // hora da mensagem no fuso do grupo
  "horaLocal": "08:28",            // hora no fuso da pessoa; na retroativa, a hora em que COMEU
  "minutos": 508,                  // minutos de horaLocal (chave de fusão/ordenação/!apagar)
  "slot": "cafe",                  // cafe | lanche_manha | almoco | lanche | jantar | ceia
  "resumo": "texto da pessoa ou [foto]/[3 fotos]/[áudio]",   // ≤120; fusões concatenam com " + " ou anexam " (corrigido)" (≤200)
  "descricao": "itens da linha REFEICAO ou 'O que eu vi'",    // ≤220 (≤160 por descricaoDaAnalise)
  "estimativa": { "kcal": 930, "p": 59, "c": 112, "g": 30 },  // pode faltar (null) — registro sem estimativa existe
  "incerteza": "alta|media|baixa",   // opcional; só no insert (não atualizado na fusão); ninguém lê depois
  "correcao": false,                 // flag do momento do registro (persistida porque ...r é gravado inteiro)
  "correcaoEstimativa": false,       // idem
  "manual": false,                   // true em !refeicao e em retroativa
  "criadoEm": ISODate,
  "atualizadoEm": ISODate            // só após fusão/correção/REGISTRO
}
```

Legado lido em `ferramentas.js:148-149`: `r.kcal` e `r.proteina` como fallback, o que sugere documentos antigos sem `estimativa`. Status: (b).

**Campos que não existem:** fibra, açúcar, sódio, micronutrientes, lista estruturada de itens com gramas, foto ou URL de mídia, id da mensagem do WhatsApp, fonte (foto, texto, áudio ou manual; só se deduz por `resumo`/`manual`), modelo de IA que estimou, histórico de versões, soft delete e "registrado por" diferente do dono.

### 4.2 Edição, substituição e exclusão

| Operação | Caminho | Efeito | Status |
|---|---|---|---|
| Fusão de complemento (≤ 30 min, mesmo slot ou slot não explícito) | mongo.js:209-247 | Soma kcal/p/c/g; descrição "A (+ B)"; resumo "A + B" | (b) |
| Correção na fusão | `r.correcao` ou `pareceMesmaDescricao` (mongo.js:217; util.js:206) | Substitui estimativa e descrição; resumo "(corrigido)" | (c): `pareceMesmaDescricao` testado em util.test.mjs:26; o resto não |
| Retroativa ou manual, ±10 min | mongo.js:198-207 | Substitui estimativa e descrição do registro mais cedo da janela | (b) |
| REGISTRO `{hora, kcal, proteina, carbo, gordura, tipo, mover_para, descricao}` | mensagens.js:1194-1234 | `$set` parcial; move a hora | (c): parse e `acharRegistro` testados (hoje-mes.test.mjs:268); execução não |
| REGISTRO `{apagar}` / `!apagar` | mensagens.js:1202; comandos.js:301 | `deleteOne` definitivo + texto em `correcoes_dia` | (b) |
| Rótulo puro | `atualizarRefeicao(slot)` mensagens.js:861 | Troca o slot | (a) para o leitor |
| Revisão de resposta de reserva | revisao.js:149-172 | Apaga por `{jid,dia,slot,minutos}` ou reinsere com `correcao` (cai na fusão) | (a) só `montarCorrecao` (hoje-mes.test.mjs:82) |

**Histórico de edição:** (e). Os únicos rastros são `correcoes_dia` (texto livre, consumido no fechamento do dia: dia.js:151; mongo.js:273), `correcoes_estimativa` (pares antes x depois) e o sufixo "(corrigido)".

### 4.3 Como se evita duplicação

1. A janela de lote e o agrupamento de fotos fazem várias mensagens virarem uma análise.
2. A espera por fragmento ou digitação produz uma resposta só.
3. Na gravação:
   - fusão por proximidade (≤ 30 min);
   - `pareceMesmaDescricao` (metade das "palavras de comida" em comum) faz substituir em vez de somar (caso Pessoa C de 06/10);
   - retroativa ±10 min substitui (caso Pessoa A de 06/10).
4. Não há chave única no banco nem idempotência por id de mensagem. Uma mensagem reprocessada depois de restart (fila_pendente, mensagens.js:331-354) ou de resgate pode gerar registro duplicado se cair fora das janelas de fusão.

### 4.4 Registros retroativos

- Só **no mesmo dia** e só com hora (`HH:MM`, mensagens.js:1130). "Ontem eu jantei…" não tem campo de data: (e). O registro cai no dia de hoje, com a hora dita.
- A retroativa exige diferença de mais de 45 min da hora atual (1131). Com menos que isso, é tratada como refeição normal.
- REGISTRO e `!apagar` só enxergam os registros de hoje (mensagens.js:1196; comandos.js:309). Corrigir ontem só é possível à mão no Mongo, como os commits b7901c3 e 201b65f relatam ("Registros … corrigidos à mão no Mongo").

---

## 5. Cálculo do dia, metas e "fechamento"

### 5.1 Somas e visões

| Visão | Função | Regra | Status |
|---|---|---|---|
| Lista e total de hoje (`!hoje`) | `resumirHoje` resumo.js:191 | Soma `estimativa` dos registros do dia; água e álcool de `habitos`; meta de proteína = peso × 1,6 a 2,2 | (a) hoje-mes.test.mjs:29, 367 |
| Linha do prompt "já registradas hoje" | `registradasHojeParaPrompt` :287 | Total rotulado como "DIA" | (a) hoje-mes.test.mjs:70 |
| 7 e 30 dias | `calcularVisao` :706 → `visaoPeriodo` :798 / `visaoZap` :846 | Dias **fechados** (hoje fora); a média usa os dias **com estimativa**, não os completos | (a) hoje-mes.test.mjs:145, 422 |
| Balanço do relógio | `calcularVisao` :752-792 | Só dias completos (`diasDeComida`) com gasto acima de 800; o julgamento vem da meta calibrada ou provisória | (a) progresso.test.mjs:619 |
| Resumo da meia-noite | `fecharDia` dia.js:131 → `compilarRefeicoesDoBanco` resumo.js:109 | Números do banco + `correcoes_dia`; a IA só redige; o texto vai ao grupo e ao Drive | (a) para a compilação (hoje-mes.test.mjs:456); `fecharDia` (b) |
| Semana | `compilarSemana` :147 + `placarSemana` :1002 | Média nos dias com estimativa; placar = dias completos × 2 + dias com proteína batida | (a) resumo.test.mjs:45; hoje-mes.test.mjs:232 |
| Mês | `compilarMes` :216 | Média por semana do mês, peso inicial → final, dias sem registro | (a) hoje-mes.test.mjs:42 |
| Gráfico | `configGrafico` graficos.js:21 | kcal/dia, proteína média, gasto, faixa da meta, peso, massa magra | (a) hoje-mes.test.mjs:244 |

**Três réguas de "dia" convivem.** É o ponto mais confuso para o app:

1. **"dia com registro"** = qualquer registro. A média de 7 e 30 dias usa os dias com estimativa (resumo.js:726-728).
2. **"hábito de registro"** (`diaCompleto`, resumo.js:978) = 3 registros ou mais, **ou** 1.200 kcal ou mais. Serve à sequência e ao placar. O texto foi renomeado em 09/10 (resumo.js:814-816).
3. **"dia completo" das contas** (`diasDeComida`, progresso.js:453-468) = 2 registros ou mais com estimativa, 500 kcal ou mais e pelo menos 65 % da mediana de 28 dias. Serve à meta adaptativa, ao balanço e ao PROGRESSO.

Consequência: a "Média 7 dias" do `!hoje` (régua 1) inclui dia incompleto, enquanto a linha "Últimos N dias completos" do balanço, na mesma tela, usa a régua 3.

### 5.2 O que é "meta" (só a origem)

- **Proteína:** `peso × 1,6` a `peso × 2,2` g, fixo no código em cinco lugares (resumo.js:92, 121, 207, 719, 1012). Não depende do objetivo nem da dieta.
- **Calorias:** `gastoAdaptativo` (resumo.js:929) tem três estados:
  - `calibrado`: gasto real pela balança, via `calibrarEnergia` (progresso.js:479). Exige 10 dias completos e 6 pesagens cobrindo 14 dias (progresso.js:25-27).
  - `relogio`: média do relógio em 28 dias.
  - `calibrando`: nenhum dos dois ainda.

  Faixa = gasto + `faixaDaMeta` (resumo.js:523), que vem de `metaBalancoPara` (resumo.js:422): ritmo até `metaPeso`/`metaPrazo` dentro de 0,25-0,5 %/semana no ganho e 0,5-1 % na perda, freio pela gordura e etapas. A meta está **em calorias registradas** (a régua das fotos), não em calorias "reais". Detalhe estatístico: R3.
- **Carboidrato, gordura, fibra e água:** sem meta. (e)
- **Previsão de amanhã:** `previsaoGastoDia` (resumo.js:623), só com relógio.

### 5.3 Micronutrientes, água, fibra, álcool, suplementos, vegetariana

| Tema | Status | Onde |
|---|---|---|
| Micronutrientes | (e) no registro e no cálculo. Só aparecem como texto no prompt para vegetarianos (gemini.js:94) e no doc `conhecimento/Vegetariana.md` | — |
| Fibra | (c): existe na TACO (`fibra`), no OFF (`fibras`) e no bloco de âncoras (taco.js:183), mas **não entra** em REFEICAO nem em `estimativa` e se perde | taco.js:166 |
| Sódio, açúcar, NOVA | (c): só no bloco OFF do prompt | off.js:41-46 |
| Água | (b) a gravação; (a) o parse. Coleção `habitos` `{jid, dia, agua_ml, alcool_doses}` com `$inc`, teto de 5000 ml por mensagem (mongo.js:384-394), via linha HABITO. Só aparece no `!hoje` (resumo.js:195). Sem meta, sem desfazer, sem comando | hoje-mes.test.mjs:610 |
| Álcool | (b), no mesmo esquema: doses, teto 20. Não converte em kcal; a kcal só entra se a IA registrar a bebida como refeição | — |
| Suplementos | (c): não há registro estruturado. `suplementosPelosRegistros` (contexto.js:250) infere creatina, whey em g e hipercalórico por regex sobre `descricao` (30 g por padrão). O conhecimento está em `conhecimento/Suplementos-Recuperacao.md`, foco `treino` | sem teste próprio verificado |
| Vegetariana | (c): o perfil `dieta`/`restricoes` liga o doc `Vegetariana.md` (conhecimento.js:149) e a regra do prompt (gemini.js:94). Não há validação em código; a avaliação com modelo tem C25b ("vegetariano não recebe sugestão com carne") | — |

---

## 6. Qualidade dos dados

- **Origem da incerteza de uma estimativa por foto:** o próprio modelo marca `INCERTEZA: alta|media|baixa` e no máximo uma `PERGUNTA` (gemini.js:171). Os dois são extraídos em gemini.js:829-840.
  - É guardada em `refeicoes.incerteza` só no insert (mensagens.js:1265). Na fusão (mongo.js:213-247) não se atualiza.
  - **O usuário não vê** o nível; só vê a pergunta no texto. **Nenhum cálculo usa** o campo (grep: nenhum leitor). Não há faixa ± por refeição.
  - A pergunta fica em `estado.memoria.perguntas[jid]` (RAM + backup `memoria`) para não repetir em 45 min (mensagens.js:162, 1154).
- **Como se corrige:**
  - resposta à pergunta ou "eram 3 fatias" → fusão com correção;
  - "esse jantar foi 600 kcal" → REGISTRO;
  - `!apagar` + `!refeicao`;
  - Mongo à mão (frequente pelos commits).

  Cada correção alimenta `correcoes_estimativa` → calibração por pessoa (§3.4).
- **Outras fontes de erro conhecidas:**
  - o modelo reserva sem a linha REFEICAO leva a `lerEstimativa` por regex (resumo.js:18) ou a `estimarRefeicaoManual` pela descrição, sem ver a foto (mensagens.js:1250);
  - 2 conferências por semana, por amostragem, das respostas de reserva (revisao.js:22).
- **Registro × balança (só apontando onde mora):**
  - `registroDiscordaDaBalanca` (progresso.js:601, `VIES_RUIDO` 250 kcal em :33);
  - `calibrarEnergia` (progresso.js:479);
  - `calibracao.js` (viés semanal);
  - o texto de `previsaoGastoDia` (resumo.js:649-651) e `visaoPeriodo` com `base: 'balanca'` (resumo.js:825-829);
  - as notas de memória dizem que o registro fica algumas centenas de kcal/dia (valor real omitido) acima da balança no caso real (commit 41f73c3).

---

## 7. Limitações, bugs e pontos frágeis

### 7.1 Bugs prováveis encontrados na leitura

1. **`!refeicao` pode sobrescrever uma refeição existente em vez de criar outra.** `!refeicao` grava `manual: true` com `minutos` = agora (comandos.js:348-353). `registrarRefeicao` trata **qualquer** `manual` a ±10 min de um registro da pessoa como correção e substitui estimativa e descrição, sem olhar o slot (mongo.js:198-207). Exemplo: foto do almoço às 12:30, depois `!refeicao lanche barra de cereal` às 12:35. O almoço vira a barra, e a `AJUDA` (comandos.js:37) promete "registra à mão uma refeição que ficou sem registro". Sem teste. (b)
2. **`dia` no fuso do grupo × `horaLocal` no fuso da pessoa.** mensagens.js:609 usa `agora()` (fuso do grupo) para `dia`. Para quem está em outro fuso (perfil do Pessoa B na avaliação), uma ceia às 00:30 local é gravada com o `dia` do Brasil (ainda "ontem" no Brasil) e `horaLocal` 00:30. `slotDaHora` trata a madrugada como ceia do dia anterior (util.js:110). Isso é coerente só por acaso. Totais e "dia completo" de quem tem outro fuso podem dividir o dia errado. (b)
3. **`registrarRefeicao` sem `await`** (mensagens.js:1254-1271). `refeicaoRegistrada` é montado mesmo se a gravação falhar, e uma mensagem seguinte muito rápida (fila já liberada) pode ler `refeicoesDoDia` antes do insert e não fundir. A fila `naFila('bot')` serializa as mensagens, mas não espera essa promessa. (b)
4. **Fusão com o último registro de qualquer slot** (mongo.js:209-212). Uma correção com `correcao: true` cai em `correcaoRecente` usando `minhaUltima.minutos` (mensagens.js:1260), o registro mais recente por `minutos`. Depois de um `mover_para` para 08:20, "a última" passa a ser outra refeição, e a correção pode ir para o registro errado. (b)
5. **Revisão apaga por `{jid, dia, slot, minutos}`** (revisao.js:152; mongo.js:287). Se o slot ou a hora mudaram depois (rótulo, `mover_para`, fusão), o `deleteOne` não acha nada e o registro errado fica. (b)
6. **`semLinhaAtualizar` não cobre "REFEIÇÃO" com cedilha** (util.js:163), ao contrário de `separarAtualizacao` (gemini.js:844). Esse foi o vazamento de 04/10 (commit 201b65f); o caminho principal já está corrigido. Sem teste da variante. (c)
7. **`incerteza` perde-se na fusão** e não é lida por ninguém (§6).

### 7.2 Fragilidades de desenho

- A decisão "é refeição?" depende de regex sobre o texto livre do modelo (`temBloco`, `RE_NAO_COMIDA`, `blocoDeSugestao`; mensagens.js:1111-1118) e de várias janelas mágicas: 20 s, 30 min, 45 min, ±10 min, 45 s, 90 s, 300 s. Um app que registre direto evita isso.
- **Itens não estruturados:** "não teve X" depende de a IA reescrever a lista inteira. Não dá para editar um item no app sem refazer a estimativa toda.
- **Sem idempotência** por id de mensagem (§4.3).
- **Exclusão definitiva** e sem histórico. O app não tem como mostrar "o que mudou" nem desfazer.
- **Correção de dias anteriores** só no Mongo à mão. Os commits b7901c3 e 201b65f registram correções manuais em 04/10 e 06/10; a memória do projeto cita "Nota do Pessoa A corrigida à mão" (dcfd117).
- **Fotos não persistidas** (só base64 em `revisoes_pendentes` por 24 h, quando a resposta veio de reserva).
- **Três réguas de "dia"** (§5.1).
- **Meta de proteína fixa** (1,6-2,2 g/kg) espalhada em cinco lugares.
- **Fibra existe nas fontes e é descartada** no registro.
- Nenhum `TODO`/`FIXME` no código (grep). Os "bugs conhecidos" estão nos comentários datados ("até 09/10…", "Pessoa C, 06/10…", "28/09…") e nas mensagens de commit.

### 7.3 O que os testes cobrem e o que não cobrem

**Cobrem** (`npm test` = `node --test "test/**/*.test.mjs"`, sem IA e sem banco):

- parsers das linhas ocultas: REFEICAO, REGISTRO, HABITO, INCERTEZA, PERGUNTA, PRODUTO, SILENCIO (hoje-mes.test.mjs:268, 534, 610; C18, C19, C48);
- `acharRegistro`, `lerRotuloRefeicao`, `lerEstimativa`, `descricaoDaAnalise`, `lerTipoRefeicao`;
- `agruparFotos`;
- `parecePedidoOuPlano`/`pareceConsumo`/`pareceCorrecao` (C34; util.test.mjs) e `pareceMesmaDescricao`;
- `candidatoAFragmento`, `pareceMetaConversa`, `mencionaOutraRefeicao`;
- `numerosSuspeitos`, `vocabularioErrado`;
- TACO;
- OFF (puro);
- despensa (puro);
- calibração (C32, C49);
- `resumirHoje`, `compilarRefeicoesDoBanco`, `compilarSemana`, `compilarMes`, `visaoPeriodo`/`visaoZap`, `gastoAdaptativo`, `sequenciaDe`/`placarSemana`, `configGrafico`.

**Não cobrem:**

- `mongo.registrarRefeicao` (fusão, correção, retroativa ±10 min, gravação em `correcoes_estimativa`);
- `apagarRefeicaoEm`/`apagarRefeicaoPorId`;
- `mensagens.processar` (`foiRefeicao`, `correcaoRecente`, `retroativa`, execução das linhas REGISTRO, HABITO e DESPENSA);
- `deveEsperarFragmento`/`liberarFragmentos`;
- `dirigidaAOutro`, `citacaoDe`;
- `comandos.tratarComando` (`!refeicao`, `!apagar`, `!hoje` de ponta a ponta);
- `fecharDia`;
- `despensa.ajustarItem`/`entrarNaDespensa`/`padronizarItens`;
- `off.buscarPorNome` (rede);
- `revisarPendentes`;
- `registrarHabito`;
- a variante "REFEIÇÃO" com cedilha.

A suíte `avaliacao/` (38 cenários, `npm run avaliar`, chama o Gemini de verdade) cobre o comportamento do modelo: C34, C39, C42, C43, C46, C47 e P01-P05. Ela fica fora do `npm test`.

### 7.4 Divergências GUIA × código

| GUIA | Código |
|---|---|
| A meta adaptativa exige "10 dias completos de registro e pesagens cobrindo 7 dias" (GUIA-PASSO-A-PASSO.md:192) | Exige 6 pesagens cobrindo 14 dias (progresso.js:25-27; teste hoje-mes.test.mjs:220 confirma que 13 dias não calibram) |
| `!hoje` traz "sequência de dias completos" (GUIA:193) e o placar "dias completos" | Renomeado para "hábito de registro" em 09/10 (resumo.js:814-816, 866); o placar ainda diz "dias com as refeições registradas" (resumo.js:1019) |
| Tabela "Comandos no grupo" (GUIA:153-169) | Omite `!refeicao`, `!apagar`, `!hoje`, `!grafico`, `!despensa`, `!nota`, `!plano` e outros. Estão na `AJUDA` (comandos.js:37) e espalhados nas seções do GUIA |
| Comentário de cabeçalho de comandos.js:1 | Lista só os comandos antigos |
| Pedido desta auditoria: "áudio via voz.js" | `voz.js` é saída (TTS). O áudio de entrada vai direto ao Gemini (GUIA:257 está correto) |
| "Fragmento espera até 45 s" (GUIA:206) e "foto sem legenda 20 s" | Batem com o código (mensagens.js:154-156) |

---

## 8. Implicações diretas para o app Android (camada visual)

- **Leitura:** quase tudo que o app precisa mostrar é calculado por funções **puras** em `resumo.js`, `progresso.js` e `acompanhamento.js`, que recebem arrays de `refeicoes`, `pesagens` e `perfil`. Expor endpoints no `index.js` (hoje existem `/relogio`, `/nota`, `/estado`, `/status`; nenhum de refeições) é mais seguro do que reimplementar no Kotlin.
- **Escrita:** registrar pelo app exige um caminho novo que não passe pela heurística do WhatsApp. O mais próximo hoje é o fluxo do `!refeicao` (estimativa por IA leve + `registrarRefeicao`), mas ele carrega o bug §7.1.1.
- **Esquema:** para editar item a item, mostrar foto, fonte e incerteza, ou ter histórico, é preciso estender `refeicoes`: `itens[]` com gramas e fonte TACO/OFF, `fibra`, `midia`, `origem`, `msgId` para idempotência, `versoes[]` ou soft delete.
- **Fuso:** decidir se `dia` passa a ser o do fuso da pessoa antes de o app exibir histórico (§7.1.2).
- **Já existe** um projeto Android (`android/`, pacote `br.nutribot.relogio`: SyncWorker, NotaWorker, Cupom/WebView, Local) com token por pessoa (`x-relogio-token`, index.js:71, 82). Não tem nada de refeição; é o canal natural para estender.

---

## Perguntas em aberto

1. O `!refeicao` dentro de 10 minutos de um registro existente deve criar uma refeição nova? Se sim, a regra ±10 min de mongo.js:198 precisa olhar o slot ou se restringir à retroativa vinda da linha REFEICAO.
2. `dia` deve seguir o fuso da pessoa? Hoje segue o do grupo (mensagens.js:609). Existe base com perfis fora de America/Sao_Paulo além do cenário de teste "Pessoa B em outro fuso"?
3. O app vai registrar refeições sem passar pelo WhatsApp? Nesse caso a análise de foto precisa de endpoint próprio (hoje está acoplada a `ia.responder`, com persona, histórico do grupo e linhas ocultas).
4. Vale passar a gravar a foto (Drive ou outro storage) para o app mostrar o prato? Há implicação de privacidade e custo.
5. A "Média 7 dias" exibida deve usar os dias completos (`diasDeComida`) em vez dos dias com estimativa, para bater com o balanço da mesma tela?
6. Fibra, sódio e açúcar já chegam da TACO e do OFF. Devem entrar em `estimativa` e no formato da linha REFEICAO?
7. A meta de proteína deve variar por objetivo ou dieta, e ser centralizada numa função (hoje aparece em cinco lugares)?
8. Há documentos antigos em `refeicoes` com `kcal`/`proteina` na raiz (fallback em ferramentas.js:148)? Quantos? Uma migração antes de o app ler a coleção resolveria isso.
9. Correções em dias anteriores (hoje só no Mongo à mão) devem ser liberadas no app? Com que trilha de auditoria, se `correcoes_dia` é texto livre?
10. O campo `incerteza` deve virar faixa ± visível e entrar nos cálculos, ou ser descartado?
