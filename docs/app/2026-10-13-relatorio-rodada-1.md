# NutriBot App — Relatório da primeira rodada

**Data da pesquisa:** 13/10/2026 · **Commit analisado:** `2ae910e` (main, árvore limpa) · **Fase:** análise e planejamento (nenhum arquivo de aplicação foi alterado)

Este documento responde às Etapas 1 a 12 do briefing. Ele é a síntese; a evidência detalhada (arquivo:linha no código, URLs nas referências) está nos anexos em [`anexos/`](anexos/). Todos os anexos foram anonimizados: as três pessoas monitoradas aparecem como Pessoa A, B e C, e nenhum dado de saúde real foi incluído, porque o repositório é público.

**Como ler as afirmações.** Usei três marcas:

- **[F]** fato verificado, com a fonte entre parênteses (anexo e seção, ou arquivo:linha);
- **[H]** hipótese ou inferência que ainda precisa de confirmação;
- **[R]** recomendação minha.

Estado de implementação no código, quando aparece: **(a)** implementado e testado · **(b)** implementado sem teste · **(c)** parcial · **(d)** só planejado · **(e)** inexistente.

**Restrições do dono que orientam tudo:** WhatsApp continua como canal principal · app Android instalado à mão (fora da Play Store) · uma pessoa autorizada (o dono) acompanha os três perfis · custo zero de APIs e serviços.

> **Decisões do dono sobre a seção 9 (13/10/2026).** Elas prevalecem sobre as recomendações do corpo do texto.
>
> - **D1:** o app novo substitui o Relógio só no celular do dono; as outras pessoas seguem com o Relógio atual.
> - **D2:** o bloco de perfis no prompt **fica como está**: dados de saúde das outras pessoas continuam visíveis para a IA. A separação por pessoa vale **no app**.
> - **D3:** uma pesagem por fonte por dia. Para o valor do dia: média das pesagens da manhã que concordam entre si (até 0,5 kg de diferença); se discordarem, vence a balança e a outra fica marcada.
> - **D4:** o Mongo é a fonte oficial, mas **tudo** também fica no Drive (espelho completo) e aparece no app. Isso inclui o diário da Nutri, as reflexões e avaliações, as notas e as hipóteses.
> - **D5:** MVP como na seção 7.
> - **D6:** guardar foto e texto das refeições.
> - **D7:** a direção visual muda para **tons pastel, mascote, formas arredondadas, gráficos bonitos e animações fluidas** (inspirada no Foodvisor, com identidade própria). A seção 4.2 vira histórico; a direção vigente está no protótipo.
> - **D8:** gamificação permitida, com punição leve: o "brotinho" murcha quando falta registro e se recupera ao registrar.
> - **D9:** só uma pessoa mora em outro fuso, e o dono viaja para lá. O **fuso de cada pessoa passa a seguir a localização** enviada pelo app (corrige P6 e cobre viagens).

---

## Sumário

1. [Diagnóstico do NutriBot atual](#1-diagnóstico-do-nutribot-atual)
2. [Benchmark dos cinco aplicativos](#2-benchmark-dos-cinco-aplicativos)
3. [Oportunidades para o NutriBot](#3-oportunidades-para-o-nutribot)
4. [Proposta de UX/UI](#4-proposta-de-uxui)
5. [Arquitetura das integrações](#5-arquitetura-das-integrações)
6. [Modelo de dados e API](#6-modelo-de-dados-e-api)
7. [Escopo recomendado do MVP](#7-escopo-recomendado-do-mvp)
8. [Riscos e dependências](#8-riscos-e-dependências)
9. [Perguntas para você](#9-perguntas-para-você)
10. [Plano de implementação](#10-plano-de-implementação)
11. [Fontes e método](#11-fontes-e-método)

---

## 1. Diagnóstico do NutriBot atual

### 1.1 Arquitetura em uma página

| Camada | Como é hoje | Fonte |
|---|---|---|
| Processo | Um único processo Node 22 (ESM) no Render Free: HTTP (Express 5), WhatsApp (Baileys 7), 13 tarefas agendadas e toda a lógica. 512 MB de RAM, dorme após 15 min sem tráfego (mantido acordado por auto-ping e GitHub Actions). | [F] R1 §1.1, §1.9, §5.4 |
| Fila | Uma cadeia de Promise única (`naFila`) serializa mensagens, fechamento do dia, cobranças, pensamentos etc. `POST /relogio` e `POST /nota` rodam fora da fila. | [F] R1 §1.4 |
| Banco | MongoDB Atlas M0 (0,5 GB), cerca de 35 coleções, sem schema nem camada de repositório: 30+ módulos chamam `colecao('...')` direto. | [F] R1 §2 |
| IA | Gemini (várias chaves e modelos de reserva, cota gratuita) com reservas externas (Groq, Cohere, OpenRouter, HF). System prompt fixo passa de 39 mil caracteres. | [F] R4 §0.4, R1 §1.8 |
| Google Drive | OAuth de usuário, escopo `drive` completo. É espelho (Obsidian), caixa de entrada de documentos e, em dois pontos, fonte de leitura. | [F] R5 §2 |
| App Android "Relógio" | Kotlin + Views, `br.nutribot.relogio` v1.6, minSdk 28. Lê Health Connect, GPS e cupom fiscal (NFC-e) e envia ao servidor. **Não mostra nenhum dado.** APK assinado pelo GitHub Actions, release pública fixa. | [F] R1 §7, R5 §1 |
| CI/CD | `deploy.yml` (testes + deploy por API do Render), `android.yml` (APK), `keepalive.yml`, `vigia.yml`, `avaliacao.yml`. | [F] R1 §1.6 |
| Testes | 242 testes de funções puras (progresso, resumo, lugares, util...). Camada HTTP, banco, fila e handlers de comando: **sem teste**. | [F] R1 intro, R2 §7.3 |

### 1.2 O que já funciona bem (e o app deve aproveitar, não refazer)

- **Progresso de peso com rigor estatístico** (a): tendência de 28 dias por regressão com IC 95% corrigido por autocorrelação, Theil-Sen de checagem, veredito com probabilidade, leitura do gráfico em janelas de 7/14/21/28 dias, média móvel centrada, divergência de janelas, comida da semana contra peso. São **86 indicadores catalogados**, quase todos funções puras e testadas, que já devolvem objetos serializáveis. [F] R3 §4
- **Calibração comida x balança** (a): mede o viés entre o que é registrado e o que a balança acompanha e define a meta em "kcal registradas". [F] R3 §1.7
- **Registro por foto, texto e áudio no WhatsApp** com fusão de partes, correções retroativas, espera da legenda, cálculo por TACO no prompt. [F] R2 §2
- **Health Connect** (peso, gordura, sono com estágios, passos, gasto total, FC de repouso, treinos) a cada 15 min. [F] R5 §1
- **Cupom fiscal → despensa** (NFC-e via WebView no app), Hevy (treino de força), localização e lugares aprendidos, agenda do dono, clima. [F] R1 §2.4, R5 §3
- **Hipóteses com status** (aberta/confirmada/refutada/inconclusiva, com sinais e evidência): o embrião do "fato x hipótese" que a área de Conhecimento da IA precisa. [F] R4 §0.5

### 1.3 O que falta para o app existir

1. **Não há nenhuma rota de leitura de dados.** Refeições, peso, progresso, despensa, treinos: tudo só sai como texto pelo WhatsApp. (e) [F] R1 §4, R5 §0.1
2. **Não há autenticação de "dono que vê os três perfis".** O token do relógio é por pessoa (e identificado pelo primeiro nome); o `ADMIN_TOKEN` vai na URL. (e) [F] R5 §0.2
3. **A refeição é pobre como dado:** kcal + 3 macros + descrição de até 220 caracteres. Sem itens com gramas, sem fibra, sem foto, sem origem, sem histórico de edição; exclusão é definitiva. [F] R2 §0
4. **Fotos não são guardadas** (só 24 h, e só quando a resposta saiu de modelo reserva). [F] R2 §0.5
5. **Nada do dia é persistido como agregado**: totais, médias e metas são recalculados a cada chamada. Isso é bom (uma fonte só), desde que o app consuma as mesmas funções. [F] R2 §0.4
6. **Quase nada do que a IA sabe tem origem, data e confiança registradas.** Corrigir hoje é editar à mão no Mongo e no Drive. [F] R4 §0.1-0.2

### 1.4 Problemas encontrados que valem correção independente do app

Estes são defeitos do sistema atual, achados durante a auditoria. Nenhum foi corrigido (esta rodada é só de análise).

| # | Problema | Efeito | Fonte | Gravidade |
|---|---|---|---|---|
| P1 | **Envio do relógio regrava 60 dias de pesagens a cada 15 min** (`replaceOne({jid, dia})`) | o peso dito no chat e o de bioimpedância em PDF somem no envio seguinte | [F] R5 §0.3, R3 D7 | alta |
| P2 | **Dados de saúde de cada pessoa entram no prompt das outras** (bloco PERFIS DO GRUPO: notas, relógio, treino, exames fora da referência; momentos e persona globais) | a separação entre pessoas depende só do modelo obedecer a instrução | [F] R4 §0.3, §6.1 | alta (privacidade) |
| P3 | `!refeicao` a até 10 min de outro registro **substitui** a refeição anterior em vez de criar nova | perda de registro | [F] R2 §7.1.1 | média |
| P4 | `GET /estado` e `GET /qr` são públicos | expõem o id do grupo; o QR permitiria parear outra sessão | [F] R1 §4 | média |
| P5 | App Relógio só reenvia os últimos 3 dias; leituras do Health Connect sem paginação; sono de dois apps no mesmo dia soma | lacunas e séries cortadas sem aviso | [F] R5 §0.5-0.7 | média |
| P6 | `dia` da refeição no fuso do grupo, hora no fuso da pessoa | quem está em outro fuso tem o dia dividido errado | [F] R2 §7.1.2 | baixa hoje (1 caso de teste) |
| P7 | Identidade por primeiro nome em `RELOGIO_TOKENS`, `HEVY_CHAVES`, `AGENDA_DONO`; memória vetorial chaveada por nome | colisão se duas pessoas tiverem o mesmo primeiro nome | [F] R1 §3.3, R4 §6.1 | baixa hoje |
| P8 | Meta guarda só a data da última mudança, não o valor anterior | o app não consegue desenhar a linha do alvo ao longo do tempo | [F] R3 §3 | baixa |
| P9 | `!reset` apaga só o documento do perfil (notas, memória vetorial, momentos, documentos ficam) | o "direito de apagar" da página de privacidade não é cumprido por completo | [F] R4 §6.1, R1 §8.10 | média |

### 1.5 Os "três perfis"

**[F]** Não existem papéis no banco: "três perfis" são **três pessoas monitoradas** num grupo de WhatsApp, cada uma um documento em `perfis`, identificadas pelos seus identificadores do WhatsApp (número e LID). Os únicos papéis são implícitos e vêm de variáveis de ambiente: administrador (`ADMIN_JID`), dono da agenda, pessoa com relógio, pessoa com Hevy. Nenhum comando de grupo é restrito ao administrador (qualquer membro pode `!reset` do próprio perfil ou `!resumo` para todos). (R1 §3.1, §3.4)

**[R]** Modelo recomendado para o app: **uma conta de operador (você) com acesso aos três perfis**, autenticada por token de aparelho; as pessoas monitoradas **não** precisam de conta. Os perfis são endereçados pelo `_id` do documento `perfis` (estável), nunca pelo nome. Cada escrita feita pelo app registra autor (`app:dono`), momento e valor anterior. Detalhes em 6.4.

---

## 2. Benchmark dos cinco aplicativos

Relatórios completos com fontes: [B1 MyFitnessPal](anexos/B1-myfitnesspal.md) · [B2 MacroFactor](anexos/B2-macrofactor.md) · [B3 Cronometer](anexos/B3-cronometer.md) · [B4 Desrotulando](anexos/B4-desrotulando.md) · [B5 Foodvisor](anexos/B5-foodvisor.md). Matriz comparativa da Etapa 3: [S1](anexos/S1-matriz-comparativa.md).

**Limitação de método, valendo para os cinco:** nenhum agente instalou os apps. A análise de interface vem de capturas oficiais das lojas, centrais de ajuda, documentação e imprensa. Cores exatas, tipografia e telas não exibidas nas capturas estão marcadas como "não verificado" nos anexos. Não usei engenharia reversa dos APKs dos concorrentes: o briefing pede análise competitiva legítima.

### 2.1 Ficha comparativa

| | MyFitnessPal | MacroFactor | Cronometer | Desrotulando | Foodvisor |
|---|---|---|---|---|---|
| Foco | diário de calorias de massa | metas adaptativas por algoritmo | precisão nutricional (80+ nutrientes) | nota de produtos industrializados | registro por foto, visual e lúdico |
| pt-BR / Brasil | interface pt-BR; IA (foto, voz, Coach) só em inglês em 6 países | sem pt-BR | pt-BR desde set/2026; sem base brasileira | brasileiro; 60 mil+ EANs com curadoria | descrição em pt-PT; sem base brasileira verificada |
| Preço (13/10/2026) | Premium R$ 31,90/mês ou R$ 162,90/ano | R$ 399,90/ano (App Store BR) | Gold US$ 10,99/mês ou 59,99/ano | scan grátis; busca e alternativas R$ 89,90/ano | premium (valor varia; paywall agressivo) |
| Ponto mais forte | resumo do dia, integração ampla | gasto adaptativo e check-in semanal | origem de cada valor, "vazio ≠ zero" | qualidade por critérios brasileiros (NOVA, ANVISA) | foto como protagonista, anéis e cores fixas |
| Ponto mais fraco | "Hoje" esconde o dia atrás de cliques; base colaborativa com erros | tendência sem incerteza, sem pt-BR | anúncios, tendência de peso rudimentar | sem diário, sem calorias | gamificação imposta, número único sem faixa |
| Fontes | B1 §1, §6 | B2 §1, §4 | B3 §1, §2 | B4 §1, §6 | B5 §1, §2 |

### 2.2 O que cada um ensina (lições selecionadas)

**MyFitnessPal** (B1 §7)
- O dia inteiro precisa caber numa tela; a reclamação mais repetida é a aba "Hoje" que esconde informação. [F]
- Projeção "se todo dia fosse igual a hoje" sem incerteza é o anti-exemplo. [F]
- IA que itemiza a foto e deixa editar cada item antes de gravar é o padrão do mercado. [F]

**MacroFactor** (B2 §4, §7)
- O gasto vem de comida registrada x tendência de peso; o relógio só sinaliza mudança (desde out/2025, passos aceleram a atualização). É o mesmo raciocínio do NutriBot, que já faz isso com mais rigor (IC, viés exposto). [F]
- Check-in semanal que **limpa os dados antes** de mexer na meta, ajuste amortecido, metas em % do peso. [F]
- Estima a comida dos dias sem registro em vez de descartá-los, e mede o próprio erro de previsão. [F]

**Cronometer** (B3 §2, §7)
- Mostra a origem de cada valor (laboratório, compilado, rótulo) e o grau de completude de cada nutriente: **vazio não é zero**. [F]
- Densidade organizada em camadas fixas: destaques no topo, relatório do dia em blocos, toque na barra para ver fontes. Prova de que dá para mostrar muito sem virar planilha. [F]
- O Cronometer Pro (profissional acompanhando clientes, com trava de metas) é o modelo mais próximo do caso "uma pessoa autorizada acompanha três perfis". [F]

**Desrotulando** (B4 §4, §7)
- Separar **qualidade do produto** (critérios públicos: NOVA, avisos "alto em" da RDC 429/2020) de **adequação à meta da pessoa**. [F]
- Eles planejaram ler o QR da nota fiscal em 2020 e não lançaram; o NutriBot já tem o cupom → despensa. A qualidade do carrinho real é um diferencial natural. [F]
- Lição de produto: mudar as regras do plano gratuito gera a maior reclamação. [F]

**Foodvisor** (B5 §2.17, §2.18, §7)
- Um protagonista por cartão; cores fixas e globais por nutriente; a refeição como álbum de fotos; orçamento por refeição ("410/490"); celebração ancorada em fato; correção por escolha entre alternativas. [F]
- Não copiar: gamificação obrigatória (a empresa admite muitas reclamações), rosto bravo em comida, número único sem incerteza, gráfico de peso com números incoerentes na versão pt-BR, paywall de pressão. [F]
- Não verificado: a tela real de resultado da foto não aparece em nenhuma captura oficial. [F]

### 2.3 Onde o NutriBot já é melhor que os cinco

- **Honestidade estatística**: nenhum dos cinco mostra intervalo de confiança na tendência de peso ou na estimativa de calorias (B2 §4, B3 §4, B5 §4.2, B1 §4). O NutriBot calcula os dois.
- **Calibração contra a balança com viés exposto**: só o MacroFactor faz algo parecido, e esconde a incerteza (B2 §4).
- **Registro sem atrito pelo WhatsApp** (foto, texto, áudio) num canal que as pessoas já usam.
- **Cupom fiscal → despensa** e **contexto de vida** (lugares, agenda, treino Hevy): nenhum dos cinco tem.

### 2.4 Onde está claramente atrás

- Não há **interface visual** nenhuma: tudo é texto.
- Não há **itens estruturados** na refeição, nem busca de alimento, nem código de barras pela câmera.
- Não há **micronutrientes** nem fibra registrada (a fibra existe na TACO e é descartada: R2 §7.2).
- Não há **edição com histórico** nem desfazer.

---

## 3. Oportunidades para o NutriBot

Classificação completa, item a item, com complexidade e dependências: [S1](anexos/S1-matriz-comparativa.md). Resumo da minha posição:

### Aproveitar (já existe no NutriBot; o app só precisa mostrar)

- Tendência de peso com banda de IC, média móvel e leitura do gráfico (R3 §4, itens 2 a 15).
- Veredito do ritmo com probabilidade, meta em kcal registradas, alertas (R3 §4, itens 28 a 34).
- Gasto adaptativo e viés registro x balança (R3 §4, itens 18 a 24, 59).
- Dados do relógio: sono, passos, gasto, FC de repouso, treinos (R3 §4, itens 66 a 74).
- Hipóteses da reflexão como base do "fato x hipótese" (R4 §2, item 21).
- Despensa e notas fiscais (R1 §2.4).

### Adaptar (ideia dos concorrentes, ajustada ao nosso contexto)

- **Anel do dia com faixa** (Foodvisor) → anel de kcal cuja borda mostra a faixa de incerteza, e cor ligada ao veredito, não a julgamento de comida.
- **Cores fixas de macros** (Foodvisor) → paleta própria, idêntica no app e nas imagens que o bot manda no WhatsApp.
- **Refeição como foto** (Foodvisor) → as fotos que as pessoas **já mandam no WhatsApp** viram o diário visual (exige guardar as fotos: decisão D6).
- **Correção por alternativas** (Foodvisor, MyFitnessPal) → chips de item com porção ½ / 1 / 1½ / 2 (exige itens estruturados: fase 2).
- **Origem do valor e "vazio ≠ zero"** (Cronometer) → cada número com selo de origem: foto, texto, TACO, rótulo, relógio, balança, digitado.
- **Check-in semanal** (MacroFactor) → o domingo já tem resumo e aposta; virar um cartão "Semana" no app.
- **Qualidade de produto por critérios públicos** (Desrotulando) → na despensa, NOVA e avisos "alto em" a partir do Open Food Facts (fase 3).
- **Modo profissional** (Cronometer Pro) → seletor de perfis e visão "três pessoas lado a lado".

### Investigar mais

- Estimar a comida dos dias sem registro (MacroFactor) em vez de descartá-los: mudaria as contas do `progresso.js`; precisa de estudo com os dados reais.
- Gravar refeições e peso **no** Health Connect para outros apps lerem (B6 §1): útil, mas sem demanda clara.

### Descartar (com motivo)

| Ideia | Por que não |
|---|---|
| Coach/chat de IA dentro do app | O WhatsApp **é** o chat. Duplicar aumenta custo de IA e cria duas conversas divergentes. |
| Gamificação com sequências punitivas, gemas, loja | O próprio Foodvisor admite reclamações (B5 §2.18). Celebração só ancorada em fato e desligável. |
| Planos de refeição e receitas novos | O bot já gera plano da semana (`!plano`); um segundo gerador no app duplica. |
| Jejum intermitente | Fora do objetivo do NutriBot hoje. |
| Paywall / monetização | Uso pessoal. |
| Play Store | Conta paga e exigências de dados de saúde (B6 §4.2); APK manual atende. |
| APIs pagas de reconhecimento (LogMeal, Passio...) | Custo zero; o Gemini já faz o trabalho no servidor (B6 §3). |
| TBCA embutida no app | Os termos da TBCA proíbem reprodução (B6 §2). TACO pode. |
| OCR próprio de rótulo | O Gemini já lê foto de rótulo pelo pipeline existente. |
| Reescrita em React Native ou Flutter | Perde o código Kotlin de Health Connect e o pipeline de assinatura (B6 §4.2). |

---

## 4. Proposta de UX/UI

### 4.1 Princípios de experiência

1. **Entender em 5 segundos.** Ao abrir: como está o dia de comida, como está o peso, se algo precisa de atenção. Um protagonista por cartão.
2. **Toda estimativa mostra a faixa.** "≈ 520 kcal (420–650)". O NutriBot é o único que calcula incerteza; o app torna isso visível e bonito, não assustador.
3. **Cada número diz de onde veio.** Selo de origem (foto, texto, TACO, rótulo, relógio, balança, digitado, calculado) e, no toque, como foi calculado.
4. **O WhatsApp registra, o app mostra e corrige.** O app não compete com a conversa: mostra o que foi registrado lá, permite corrigir, e registra quando for mais rápido (ex.: digitar "pão com ovo").
5. **Fato é fato, hipótese é hipótese.** Visualmente distintos em todas as telas que falam do que a IA sabe.
6. **Lúdico que não julga.** Fotos de comida, a voz da Nutri, pequenas celebrações quando o dado sustenta. Nunca cor de reprovação em alimento, nunca sequência que pune.
7. **Uma pessoa por vez.** O perfil ativo fica sempre visível; dados de duas pessoas nunca se misturam numa mesma conta ou gráfico.

### 4.2 Direção visual recomendada: "Feira honesta" [R]

Segui o processo do skill `frontend-design` (plano → revisão contra os padrões genéricos → só então código). A direção parte do assunto: comida brasileira de verdade, fotografada no celular, com uma nutricionista sincera que mede incerteza.

**Paleta (núcleo)**

| Nome | Hex | Papel |
|---|---|---|
| Açaí | `#4B2C82` | cor da marca, ações principais, anel de kcal |
| Urucum | `#D9480F` | proteína |
| Milho | `#E9B300` | carboidrato |
| Abacate | `#6A994E` | gordura |
| Feijão | `#1F2421` | texto principal |
| Polvilho | `#F5F7F4` | fundo claro (neutro frio, não creme) |

Modo escuro: fundo `#15121C`, superfícies `#1F1A28`, as cores de macro clareadas 15% para contraste AA. Estados de veredito com ícone + palavra + cor: "no ritmo" `#1E7A5A`, "atenção" `#B26B00`, "incerto" cinza tracejado. **Vermelho não é usado** para julgar comida nem pessoa.

**Tipografia** (Google Fonts, baixadas sob demanda no Android, sem custo)

- **Bricolage Grotesque** para títulos e números grandes: tem personalidade, largura variável, lê bem em tamanhos grandes.
- **Atkinson Hyperlegible Next** para texto, rótulos e números de tabela (algarismos tabulares): criada para legibilidade, ajuda acessibilidade.

**O elemento memorável: a faixa.** Toda estimativa aparece como uma barra com o ponto central e a faixa em hachura translúcida da mesma cor. O anel de kcal tem a borda "desfocada" exatamente na largura da incerteza; a linha de tendência do peso carrega a banda de IC; o card de refeição mostra a faixa de kcal. É a assinatura visual do produto e é **a verdade estatística**, não decoração. O resto da interface é calmo para a faixa se destacar.

**O lúdico vem de três fontes reais**, sem ilustração cara:

1. **As fotos da comida** que as pessoas já mandam (o diário vira álbum).
2. **A voz da Nutri**: cards de "a Nutri notou" com o avatar da bot e o tom da persona, com o número que sustenta a frase.
3. **Movimento que responde a ação**: Material 3 Expressive (formas que se transformam ao salvar, anel que enche ao registrar). Um único momento orquestrado por tela, `prefers-reduced-motion` respeitado.

**Revisão contra os padrões genéricos (o que evitei e por quê):** creme com serifa e destaque terracota (é o padrão mais comum de interface gerada por IA e também o do Foodvisor); fundo quase preto com um verde ácido; kit de cards idênticos com a mesma sombra; rótulos em caixa alta acima de tudo. O verde, cor óbvia de "nutrição", ficou só como uma das cores de macro; a marca é açaí, que é brasileiro e não é clichê do setor.

### 4.3 Alternativa: "Caderno da Nutri" (para você comparar)

Visual de diário ilustrado: tons quentes e suaves, a Nutri como personagem desenhada em cada tela, títulos manuscritos, mais ilustração e menos gráfico.

| | Feira honesta (recomendada) | Caderno da Nutri |
|---|---|---|
| Sensação | vivo, moderno, confiável | acolhedor, íntimo, mais lúdico |
| Força | a faixa de incerteza vira identidade; gráficos legíveis | personalidade forte da persona |
| Custo | baixo: fotos reais + componentes Material 3 | alto: ilustrações próprias (sem orçamento, dependeria de gerar e manter imagens) |
| Risco | ficar "app de dados" se os cards da Nutri forem tímidos | ilustração competir com os números; datar rápido |

**[R] Próximo passo visual:** antes de qualquer código no app, publicar um **protótipo navegável em HTML** (página privada isolada, sem tocar no repositório) com as telas Hoje, Refeição, Progresso e Nutri nas duas direções, usando números fictícios. Você escolhe vendo, não lendo.

### 4.4 Navegação

**[R]** Quatro abas na barra inferior + seletor de perfil fixo no topo + menu secundário.

```
┌──────────────────────────────────────────────┐
│ (A)  (B)  (C)   ·  Todos         ⟳ há 4 min  ⚙ │  ← seletor de perfil + estado de sincronização
├──────────────────────────────────────────────┤
│                                              │
│              conteúdo da aba                 │
│                                              │
├──────────────────────────────────────────────┤
│   Hoje      Comida      Progresso     Nutri  │
└──────────────────────────────────────────────┘
```

| Aba | O que reúne | Por que assim |
|---|---|---|
| **Hoje** | visão geral do dia da pessoa ativa | é o que se abre 90% das vezes |
| **Comida** | diário do dia, histórico (calendário), detalhe da refeição, registrar/editar, nutrientes do dia/semana | "Alimentação" e "Nutrição" juntas: nutrição é o aprofundamento da comida, não um lugar separado |
| **Progresso** | peso e tendência, energia (meta, gasto, viés), atividade, sono, treino, semana (check-in) | evolução no tempo, separada do dia |
| **Nutri** | o que a IA sabe da pessoa (fatos, hipóteses, notas, documentos), correções, "a Nutri notou" | transparência é um diferencial e merece aba própria |

No ⚙ (secundário): **Integrações** (também acessível tocando no indicador de sincronização), perfis, relatórios (resumos de dia, semana e mês), configurações, segurança, sobre.

**"Todos"** não soma números de pessoas diferentes (somar calorias de três pessoas não tem significado). Mostra três linhas lado a lado com o estado de cada uma: kcal do dia na faixa da meta, veredito do peso, última sincronização. Tocar numa linha abre aquela pessoa.

**Telas maiores** (tablet, celular dobrável na horizontal): barra lateral (navigation rail) no lugar da barra inferior e dois painéis (lista + detalhe) em Comida e Nutri. Compose com classes de tamanho de janela.

### 4.5 Telas principais

**Hoje**

```
┌──────────────────────────────────────────────┐
│ Pessoa A · terça, 13 out          ⟳ há 4 min │
│                                              │
│        ╭───────────╮   Restam ≈ 640 kcal     │
│       ╱ ░░▓▓▓▓▓▓▓▓  ╲  faixa da meta         │
│      │  1.870 kcal   │ 2.300–2.500           │
│       ╲  comidas    ╱  ● no ritmo            │
│        ╰───────────╯                         │
│  P 128/150 g   C 210/280 g   G 61/75 g       │  ← barras nas cores fixas
├──────────────────────────────────────────────┤
│ Refeições                                    │
│ [foto][foto] Café  07:40   ≈ 520 (420–650)   │
│ [foto]       Almoço 12:30  ≈ 780 (650–920)   │
│ [ + ] Jantar ainda não registrado            │
├──────────────────────────────────────────────┤
│ Peso   68,2 kg tendência · +0,15 kg/sem      │
│        ▁▂▂▃▃▄▄▅ ░ banda IC     ver mais ›    │
├──────────────────────────────────────────────┤
│ 💬 A Nutri notou                              │
│ "Nas últimas 2 semanas o peso parou, mas a   │
│  comida subiu ~400 kcal/dia nesta semana."   │
│  de onde vem isso ›                          │
├──────────────────────────────────────────────┤
│ Sono 7h10 · Passos 8.123 · Treino 52 min     │
└──────────────────────────────────────────────┘
```

Dados: `calcularVisao`, `gastoAdaptativo`, refeições do dia, `analisarProgresso` (resumo), `perfil.relogio`. Os números da imagem são fictícios.

**Detalhe da refeição e edição**

```
┌──────────────────────────────────────────────┐
│ ‹ Almoço · 12:30 · Pessoa A                  │
│ [ foto grande do prato ]                     │
│ ≈ 780 kcal   ├────░░░●░░░────┤ 650–920       │
│ P 42 g · C 85 g · G 28 g                     │
│ Origem: foto no WhatsApp 12:31 · estimativa  │
│ por IA com TACO · editado por você 14:02     │
├──────────────────────────────────────────────┤
│ Itens  (fase 2: chips editáveis)             │
│ [arroz branco ▾][1 ▾] [feijão ▾][1½ ▾] ...   │
├──────────────────────────────────────────────┤
│ Editar valores   Mudar horário   Apagar      │
│ Histórico de mudanças ›                      │
└──────────────────────────────────────────────┘
```

**Registrar uma refeição pelo app** (MVP: texto; fase 2: foto)

1. Botão "+" (no card do jantar ou na aba Comida) → campo de texto livre ("pão francês com ovo e café com leite"), seletor de refeição e horário já preenchidos pelo horário atual.
2. O servidor estima com o mesmo motor do WhatsApp e devolve a faixa e os itens. Estado "calculando…" com a faixa aparecendo.
3. Tela de confirmação: ajustar e salvar. Ao salvar, o anel do Hoje enche (um único movimento) e a refeição aparece também para o bot. O bot **não** comenta no grupo (o registro foi feito por você no app).

**Progresso**

```
┌──────────────────────────────────────────────┐
│ Peso · 28 dias           [7][14][21][28][90] │
│   ·  ·      ·  ·   ·                         │
│ ░░░░░░░░░░░░░░░░░░░░░░░░ banda IC 95%        │
│ ───────────────────────── tendência          │
│ - - - - - - - - - - - - - linha do alvo      │
│ +0,15 kg/sem (−0,10 a +0,40) · alvo +0,30    │
│ ● abaixo do alvo, provável (75%)             │
│ "Nas últimas 2 semanas ficou parado; a subida│
│  do período ficou mais no começo."           │
├──────────────────────────────────────────────┤
│ Energia: meta 2.700–2.900 kcal registradas   │
│ registro x balança: +300 kcal/dia ⓘ          │
├──────────────────────────────────────────────┤
│ Semana · Sono · Atividade · Treino     ›     │
└──────────────────────────────────────────────┘
```

Pontos validados em cor cheia, descartados em cinza com motivo no toque (R3 §7.2), pesagens sem hora marcadas. O gráfico de banda é desenhado em Canvas próprio: o Vico não tem banda entre duas linhas (B6 §6). Os números da imagem são ilustrativos.

**Nutri (Conhecimento da IA)**

```
┌──────────────────────────────────────────────┐
│ O que a Nutri sabe sobre a Pessoa A          │
│ [Fatos] [Hipóteses] [Notas] [Documentos]     │
├──────────────────────────────────────────────┤
│ ✔ FATO · disse no grupo · 02/10              │
│   Objetivo: ganhar massa, meta 72 kg até mar │
│   corrigir ›                                 │
│ ✔ FATO · medido · relógio · hoje 07:12       │
│   Peso 68,2 kg                               │
│ ◐ HIPÓTESE · aberta há 2 semanas             │
│   "Come menos nos dias de treino pesado"     │
│   2 sinais a favor · 1 contra · como verifica│
│ ⚠ CONFLITO · ficha diz bairro X, localização │
│   diz Y (localização vence) · revisar ›      │
└──────────────────────────────────────────────┘
```

Cada item: natureza (fato declarado, fato medido, inferência, hipótese), origem, data, confiança quando houver. Ação "corrigir" ou "apagar" só onde a correção se propaga (ver 6.3).

**Integrações**

```
┌──────────────────────────────────────────────┐
│ Fontes da Pessoa A                           │
│ ● WhatsApp      conectado · última msg 12:31 │
│ ● Relógio (HC)  há 9 min · app 1.6 · 6 tipos │
│ ◐ Hevy          há 2 dias · sem treino novo  │
│ ● Drive         credencial ok · 07:20        │
│ ○ Agenda        não configurada              │
│ ● Cupom fiscal  última nota 10/10            │
└──────────────────────────────────────────────┘
```

Estados: ● ok, ◐ atrasado (passou do esperado), ⚠ erro (com o motivo e o que fazer), ○ não configurado. O indicador do topo ("⟳ há 4 min") resume o pior estado.

### 4.6 Componentes reutilizáveis

| Componente | Uso | Precisão necessária |
|---|---|---|
| `FaixaEstimativa` | toda estimativa: kcal da refeição, meta, gasto | ponto + faixa + rótulo; acessível ("entre 650 e 920, estimativa 780") |
| `AnelDoDia` | kcal do dia | progresso + borda com largura da incerteza + cor do veredito |
| `BarraMacro` | proteína, carbo, gordura (fibra depois) | cor fixa por nutriente em todo o app |
| `CartaoRefeicao` | listas de refeições | miniaturas, horário, faixa, selo de origem |
| `SeloOrigem` | ao lado de qualquer número | ícone + texto curto; toque abre "como calculamos" |
| `ChipNatureza` | fato / medido / inferência / hipótese / conflito | forma + ícone + cor, nunca só cor |
| `GraficoTendencia` | peso, gordura | pontos, tendência, banda IC, média móvel, alvo, descartados |
| `CartaoNutriNotou` | insights | avatar da Nutri, frase, número de suporte, "de onde vem isso" |
| `EstadoSync` | topo e Integrações | ok / atrasado / erro / não configurado, com tempo relativo |
| `SeletorPerfil` | topo | avatar + nome; "Todos" separado |
| Estados vazios / carregando / erro | todas as telas | vazio = convite a agir; carregando com skeleton; "acordando o servidor…" (Render Free leva até ~1 min) com o cache local na tela |

### 4.7 Acessibilidade e móvel

- Contraste AA nos dois temas; nunca informação só por cor (veredito com ícone + palavra).
- Tamanho de fonte do sistema respeitado (a faixa e os anéis se reorganizam em coluna).
- TalkBack: cada gráfico tem descrição textual equivalente (os textos do `progresso.js` já existem para isso).
- Alvos de toque de 48 dp; movimento reduzido respeitado.

---

## 5. Arquitetura das integrações

### 5.1 Princípio

**[R]** Um único backend (o servidor atual) é dono dos dados. WhatsApp e app são duas **interfaces** do mesmo conjunto de dados no Mongo. O app nunca fala com Mongo, Gemini, Drive ou Hevy diretamente; tudo passa por uma API nova no mesmo Express, que reaproveita as funções puras já testadas. Nada de segundo serviço.

```
           WhatsApp (Baileys)                 App Android (novo)
                 │                         ┌───────┴────────┐
                 ▼                         │ UI (Compose)   │
        mensagens.js / comandos.js         │ Room (cache)   │
                 │                         │ Workers: HC,   │
                 │                         │ GPS, cupom,    │
                 │                         │ sync da API    │
                 │                         └───────┬────────┘
                 ▼                                 ▼
   ┌─────────────────────── Servidor (Render) ─────────────────────┐
   │ regras de domínio (registrarRefeicao, progresso.js, resumo.js)│
   │ API /api/v1 (nova) ── auth de aparelho ── log de alterações   │
   │ /relogio, /nota (existentes, inalterados)                     │
   └───────┬───────────────┬──────────────┬───────────────┬────────┘
           ▼               ▼              ▼               ▼
        MongoDB         Google Drive     Gemini          Hevy
     (fonte oficial)  (entrada de docs,  (estimativas,   (treinos)
                       espelho, fotos?)   no servidor)
```

### 5.2 Fonte oficial por entidade

| Entidade | Fonte oficial | Quem escreve | Observação |
|---|---|---|---|
| Refeição | Mongo `refeicoes` | WhatsApp (bot) e app, **pela mesma função do servidor** | o app nunca grava direto; ganha `uuid`, `versao`, `origem`, exclusão lógica (6.2) |
| Pesagem | Mongo `pesagens` | relógio, chat, documento, app | **mudar para uma linha por fonte por dia** e deixar `validarPesagens` escolher (corrige P1; decisão D3) |
| Perfil e meta | Mongo `perfis` | conversa (IA), app, sistema | criar histórico de valores da meta (P8) |
| Dados do relógio | Mongo `saude_relogio` | app (Health Connect) | sem mudança de contrato |
| Notas da Nutri | **hoje ambíguo** (Drive relido manda) | IA à noite; você no Obsidian | decisão D4: recomendo Mongo oficial, Drive só espelho |
| Resumos dia/semana/mês, plano, conversa histórica | hoje **só no Drive** | bot | passar a gravar também no Mongo para o app ler |
| Documentos da pessoa (PDF, exames) | Drive (é a caixa de entrada) | a pessoa | extração continua em `documentos_pessoa` |
| Treinos | Mongo `treinos` | sync do Hevy | — |
| Fotos das refeições | (não existe) | — | decisão D6: recomendo pasta da pessoa no Drive |
| Conhecimento da IA | Mongo (vários lugares) | IA, código | camada de leitura normalizada (6.3) |

### 5.3 Fluxo por integração

| Integração | Dados | Perfil | Auth | Mecanismo | Frequência | Duplicação / conflito | Falhas |
|---|---|---|---|---|---|---|---|
| WhatsApp → servidor | refeições, peso, conversa, comandos | remetente (número/LID → perfil) | sessão Baileys | evento | tempo real | fusão por janela de tempo (existente); passa a gravar `msgId` para idempotência | fila pendente salva no desligamento (existente) |
| App → servidor (leitura) | tudo que é exibido | perfil escolhido; token só vê os 3 perfis autorizados | token de aparelho (Bearer, guardado no Keystore, liberado por biometria) | pull: `GET /changes?since=cursor` | ao abrir + a cada 30-60 min em segundo plano | cursor por `atualizadoEm` + `_id`; exclusões lógicas propagam | Render dormindo: mostra cache + "acordando o servidor…" |
| App → servidor (escrita) | refeição, correção, item de conhecimento | perfil escolhido | idem | `PUT` idempotente por `uuid` gerado no app; fila no WorkManager | na hora (ou quando houver rede) | `versao` no corpo: se o servidor tiver versão mais nova, responde 409 com o valor atual e o app mostra "isto mudou no WhatsApp" | retry exponencial; nunca retry em 401/409 |
| Health Connect → servidor | peso, gordura, sono, passos, gasto, FC, treinos, GPS | pessoa dona do celular | token por pessoa (existente) | `POST /relogio` (existente) | 15 min | por dia (existente); **corrigir**: janela "desde o último envio confirmado − 1 dia", paginação, sono por app de origem (P5) | 3 tentativas (existente) |
| Cupom → servidor | itens da nota | pessoa | token por pessoa | `POST /nota` (existente) | ao ler | por chave da NFC-e (existente) | WorkManager (existente) |
| Drive ↔ servidor | documentos (entrada); espelhos .md (saída); fotos (D6) | pasta da pessoa (`perfil.pastaId`) | OAuth de usuário (existente) | leitura a cada 10 min; escrita por evento | — | cache por `id:modifiedTime` (existente) | checagem diária + aviso (existente) |
| Hevy → servidor | treinos | pessoa da chave | chave por pessoa | pull | periódico | `_id` do treino | — |

**Alterações simultâneas WhatsApp x app.** Exemplo: você edita o almoço no app enquanto a pessoa manda "não teve feijão" no grupo. As duas escritas passam pela mesma função do servidor, que incrementa `versao`. A segunda a chegar com versão antiga recebe 409 (app) ou é aplicada sobre a versão atual (bot, que sempre lê o estado atual antes de fundir). O app mostra a versão vencedora e o histórico das duas mudanças. **[R]** last-write-wins com verificação de versão; sem mescla automática de campos.

**Registro recebido de novo** (retry do app, mensagem reprocessada após restart): `uuid` (app) e `msgId` (WhatsApp) tornam a gravação idempotente.

### 5.4 Relógio e os outros dois perfis

**[F]** Hoje cada pessoa instala o Relógio no próprio celular (R5 §0.12). **[R]** O app novo substitui o Relógio **no seu celular** (mesmo `applicationId` e mesma chave de assinatura, então instala por cima e mantém as permissões). As outras duas pessoas continuam com o Relógio atual, cujo contrato com o servidor não muda. Um "modo coletor" do app novo para elas fica para depois, se fizer falta. Decisão D1.

---

## 6. Modelo de dados e API

### 6.1 Entidades: existe, ajustar ou criar

| Entidade | Situação | Ação recomendada |
|---|---|---|
| Perfis monitorados | existe (`perfis`) | usar `_id` como identificador na API; não expor `jids` ao app |
| Refeições | existe, pobre | **ajustar** (aditivo): `uuid`, `versao`, `origem` (`whatsapp:foto`, `whatsapp:texto`, `app`, `comando`), `msgId`, `atualizadoPor`, `apagadaEm` (exclusão lógica); fase 2: `itens[]` com gramas e fonte, `fibra`, `midia[]` |
| Alimentos | TACO em `dados/taco.json` (597 itens); OFF em cache (`produtos`) | **não criar coleção nova** no MVP; expor busca TACO e OFF por API na fase 3 |
| Valores nutricionais | dentro da refeição | idem acima |
| Metas | campos em `perfis` | **criar** `metas_historico` (valor anterior, novo, quem, quando) |
| Pesagens | existe (`pesagens`) | **ajustar**: chave `{jid, dia, fonte}` em vez de `{jid, dia}`; índice único |
| Relógio | existe (`saude_relogio`, `perfil.relogio`) | só leitura |
| Dados importados | existe (`documentos_pessoa`, `notas`, `despensa`, `treinos`) | só leitura no MVP |
| Conhecimento da IA | espalhado em ~25 tipos | **não migrar**; criar uma camada de leitura que normaliza (6.3) |
| Histórico de alterações | não existe | **criar** `alteracoes` (entidade, id, campo, antes, depois, autor, origem, em) |
| Estado das integrações | espalhado (logs, `saude_relogio.ultimoEnvio`, `config`) | **calcular** na API a partir do que já existe; sem coleção nova |
| Logs de sincronização | só `console.log` | registrar só erros e últimos envios por fonte (pequeno, com TTL) |
| Aparelhos autorizados | não existe | **criar** `dispositivos` (hash do token, perfis permitidos, criado, revogado) |

Tudo **aditivo**: nenhum campo existente muda de significado, nenhuma coleção é apagada, nenhuma migração destrutiva. As mudanças de pesagem e refeição exigem backfill não destrutivo (preencher campos novos) com cópia de segurança antes (`mongodump`).

### 6.2 API `/api/v1` (planejamento)

Convenções: JSON; `Authorization: Bearer <token-do-aparelho>`; perfis por `_id`; datas `YYYY-MM-DD` no fuso da pessoa; erros no formato `{ "erro": { "codigo": "conflito_versao", "mensagem": "...", "detalhes": {...} } }` com status HTTP coerente (400, 401, 403, 404, 409, 422, 429, 503); paginação por cursor opaco.

| Método e rota | Faz | Reaproveita | Novo? |
|---|---|---|---|
| `POST /auth/parear` | troca um código de uso único (gerado pelo bot no seu privado) por um token de aparelho | `ADMIN_JID` | novo |
| `POST /auth/girar`, `DELETE /auth/aparelho` | gira ou revoga o token | — | novo |
| `GET /perfis` | os perfis que o aparelho pode ver | `listarPerfis` | novo |
| `GET /perfis/:id/hoje?dia=` | visão do dia: refeições, totais, meta, faixa, balanço, relógio resumido, "a Nutri notou" | `calcularVisao`, `gastoAdaptativo`, `refeicoesDoDia` | novo |
| `GET /perfis/:id/refeicoes?de=&ate=&cursor=` | histórico paginado por dia | `mongo.js` | novo |
| `POST /perfis/:id/refeicoes/estimar` | texto → estimativa (faixa e itens), **sem gravar** | motor de estimativa do bot (extraído do fluxo do WhatsApp) | novo |
| `PUT /perfis/:id/refeicoes/:uuid` | cria ou atualiza (idempotente, com `versao`) | `registrarRefeicao` (corrigido) | novo |
| `DELETE /perfis/:id/refeicoes/:uuid` | exclusão lógica | `apagarRefeicaoPorId` (adaptado) | novo |
| `GET /perfis/:id/refeicoes/:uuid/historico` | trilha de alterações | `alteracoes` | novo |
| `GET /perfis/:id/progresso` | objeto do `analisarProgresso` + série validada + leitura do gráfico + projeção | `progressoDe`, `tendenciaCompleta` | novo |
| `GET /perfis/:id/atividade?de=&ate=` | sono, passos, gasto, FC, treinos | `saude_relogio`, `treinos` | novo |
| `GET /perfis/:id/conhecimento` | itens normalizados (6.3) | várias coleções | novo |
| `PATCH/DELETE /perfis/:id/conhecimento/:item` | corrige ou apaga, com propagação | `aplicarAtualizacao` etc. | novo (fase 2 para a maioria dos tipos) |
| `GET /perfis/:id/integracoes` | estado de cada fonte | `saude_relogio.ultimoEnvio`, `checarDrive`, `statusConexao` | novo |
| `GET /changes?since=` | o que mudou desde o cursor, para o cache local | índices `{jid, atualizadoEm}` | novo |
| `POST /relogio`, `POST /nota` | inalterados | — | existentes |
| `GET /estado`, `GET /qr` | passar a exigir token | — | ajuste (P4) |

**Atualização dos painéis depois de uma alteração:** a resposta de toda escrita devolve o objeto atualizado **e** o "hoje" recalculado do dia afetado, então o app redesenha sem nova ida ao servidor. Para o que mudou pelo WhatsApp, o app pega no próximo `GET /changes` (ao abrir e periodicamente). Push (FCM) é gratuito, mas acrescenta Firebase; com um único usuário, **[R]** não usar no MVP.

**Lógica privilegiada no servidor:** estimativas (Gemini), regras de fusão, validação de pesagens, cálculos de progresso e permissões ficam no servidor. O app só desenha e envia intenções.

### 6.3 Conhecimento da IA: camada de leitura normalizada

**[F]** Hoje são ~25 tipos de informação por pessoa, em Mongo, Drive e memória vetorial, quase sem metadados (R4 §2). **[R]** Em vez de migrar tudo para uma coleção nova, a API monta itens num formato comum:

```json
{
  "id": "perfil:objetivo",
  "tipo": "objetivo",
  "valor": "ganhar massa",
  "natureza": "fato_declarado | fato_medido | inferencia | hipotese | conflito",
  "origem": "conversa | relogio | documento | ia_noturna | codigo | voce_no_app",
  "evidencia": "texto curto ou referência (arquivo, sinal)",
  "atualizadoEm": "2026-10-02",
  "confianca": "alta | media | baixa | null",
  "editavel": true
}
```

A natureza vem de uma tabela fixa por tipo (ex.: campos do perfil = fato declarado; relógio = fato medido; notas e rotina = inferência; hipóteses = hipótese com status; documentos = medido com a confiança extraída). Conflitos aparecem quando duas fontes discordam e já existe regra de quem vence (ex.: onde mora = localização vence o PDF, R4 §2 item 12).

**Correção que não volta:** corrigir ou apagar precisa propagar para o Mongo, para o `.md` do Drive e para a memória vetorial, e marcar o item como "corrigido por você" para a reescrita noturna não desfazer (R4 §8). Isso é trabalho real e fica para a fase 2, exceto o simples: campos do perfil e meta (que já têm caminho único) e apagar anotações.

**Separação entre pessoas:** a API filtra por perfil no servidor. Itens globais (persona da Nutri, momentos do grupo, lições) **não** aparecem na tela de uma pessoa até serem separados por pessoa (decisão D2).

### 6.4 Segurança e privacidade

- Token de aparelho: 32 bytes aleatórios, o servidor guarda só o hash; no app, cifrado por chave do Android Keystore liberada por biometria ou PIN do aparelho (`BiometricPrompt`). `EncryptedSharedPreferences` está depreciado (B6 §5.4).
- Comparação em tempo constante; limite de taxa; `helmet`; nunca registrar token ou corpo com dados de saúde no log.
- Pareamento inicial: o bot manda um código de uso único **no seu privado** (já existe o canal de admin), que o app troca pelo token. Sem senha.
- `mongodump` semanal por GitHub Actions (o M0 não tem backup; B6 §5.3), guardado fora do repositório público.
- O APK é público na release do GitHub (R5 §1): sem token, ele não acessa nada.

---

## 7. Escopo recomendado do MVP

### 7.1 Classificação

**Essencial (MVP)**

| Funcionalidade | Benefício | Complexidade | Dependências | Risco | Evidência |
|---|---|---|---|---|---|
| Fundações no servidor: API v1 de leitura, token de aparelho, fechar `/estado` e `/qr` | sem isso não há app | média | Express atual | baixo (aditivo) | R1 §4, R5 §6.2 |
| Correções P1 (pesagem por fonte) e P3 (`!refeicao`) | o app vai exibir esses dados; exibir dado errado destrói a confiança | baixa | testes | médio (mexe em dado em produção; backfill) | R5 §0.3, R2 §7.1.1 |
| Seletor de perfil + "Todos" | uso real: acompanhar três pessoas | baixa | API | baixo | R1 §3.1, B3 (Cronometer Pro) |
| **Hoje** com anel, faixa, macros, refeições, peso resumido, "a Nutri notou" | entender o dia em 5 s | média | API hoje | baixo | B5 §2.17, B1 §6 |
| **Progresso**: peso com banda de IC, média móvel, janelas, veredito, energia | diferencial que nenhum concorrente tem | média-alta (gráfico próprio) | API progresso | baixo | R3 §4, B2 §4 |
| **Comida**: diário, histórico, detalhe com origem, editar valores e horário, apagar (lógico) | corrigir sem depender do WhatsApp nem do Mongo à mão | média | `uuid`/`versao`/`alteracoes` | médio (concorrência com o bot) | R2 §7.2 |
| Registrar refeição por **texto** no app | registro rápido quando o WhatsApp não é prático | média | extrair o motor de estimativa | médio (cota do Gemini) | R2 §8 |
| **Incerteza como estados** ("calibrando", "firme", "pausado") e tela "como cheguei na meta" (a conta, a partir da balança) | confiança: a meta deixa de ser um número mágico | baixa | API progresso | baixo | S1, B2 §4 |
| **Um único critério de "dia completo"** no calendário e nas médias (hoje convivem três) | a tela exporia a contradição | baixa | ajuste em `resumo.js`/`tendencia.js` | baixo | R2 §5.1, R3 D5 |
| **Integrações** (estado das fontes) | saber se os dados estão atualizados | baixa | API | baixo | R5 §0 |
| **Nutri (leitura)**: fatos do perfil, hipóteses, documentos, notas, conflitos; corrigir campos do perfil e meta | transparência pedida no briefing | média | camada 6.3 | baixo | R4 §2, §8 |
| Cache local e uso sem rede (só leitura) | Render dorme; abrir o app não pode travar | média | Room | baixo | B6 §5.1 |
| Absorver o Relógio no seu celular (Health Connect, GPS, cupom) | um app só | baixa | reaproveitar Kotlin | baixo | R5 §6.1 |

**Alto valor, segunda fase**

- Foto pelo app com o mesmo pipeline; **fotos no diário** (exige guardar as fotos: D6).
- **Itens estruturados** com gramas, chips de alternativa e porção (mexe no prompt e no esquema da refeição: tem de ser validado na suíte de avaliação).
- Fibra registrada e mostrada.
- Edição e exclusão com propagação total no Conhecimento da IA (notas, anotações, memória vetorial, trava contra reescrita noturna).
- Cartão "Semana" (check-in no estilo MacroFactor, a partir do resumo de domingo).
- Correções P5 (Health Connect: janela, paginação, origem do sono).
- Widget com o anel do dia.

**Futuro (esperar evidência de necessidade)**

- Micronutrientes (exige itens com gramas + TACO completa por item).
- Código de barras pela câmera + Open Food Facts (gratuito, 15 req/min; a cobertura brasileira é parcial).
- Despensa com qualidade de produto (NOVA, avisos "alto em").
- Treino Hevy e sono em telas dedicadas; relatórios exportáveis.
- Estimar dias sem registro (MacroFactor); escrever no Health Connect; modo coletor para as outras pessoas; layout de tablet refinado.

**Não recomendado agora** — ver tabela "Descartar" na seção 3: coach no app, gamificação punitiva, planos e receitas novos, jejum, paywall, Play Store, APIs pagas, TBCA embutida, OCR próprio, reescrita multiplataforma, push no MVP.

### 7.2 O que o MVP deliberadamente não tem

Foto pelo app, itens editáveis por chip, micronutrientes, código de barras e escrita no Health Connect. Cada um tem valor, mas depende de uma base de dados de refeição mais rica, e colocar tudo junto atrasaria o que mais importa: ver e corrigir com confiança.

---

## 8. Riscos e dependências

| Risco | Impacto | Probabilidade | Mitigação |
|---|---|---|---|
| **Cota gratuita do Gemini** consumida também pelo app (estimar por texto, foto na fase 2) | o bot responde pior ou com modelo reserva | média | estimativa no app usa modelo leve; contador por dia; app avisa e cai para "registrar sem estimativa" |
| **Render Free**: 5 GB/mês de banda, 750 h, dorme, 512 MB | app lento ao abrir; fotos podem estourar a banda | média | cache local; respostas pequenas; miniaturas; fotos servidas com cache longo; plano B gratuito: Oracle Always Free (B6 §5.2) |
| **Atlas M0 0,5 GB** | coleções novas (`alteracoes`, histórico) crescem | baixa-média | TTL nos logs; fotos fora do Mongo; medir o tamanho antes (pergunta aberta R1 §8.6) |
| **Mudanças em dados de produção** (pesagem por fonte, campos novos em refeições) | regressão no bot | média | só aditivo; `mongodump` antes; testes; avaliação com modelo (P01-P05, C41); deploy em horário tranquilo |
| **Concorrência** entre o processo do bot e a API (mesmo processo, fila única) | escrita do app no meio de um `fecharDia` | baixa | escritas do app passam por `naFila` quando mexem na memória do dia; leituras não |
| **Health Connect em segundo plano** sem a permissão específica | sincronização falha calada | média | tela de permissões explícita; estado na aba Integrações |
| **Verificação de desenvolvedor Android** (expansão global em 2027) | APK manual deixaria de instalar | certa em 2027 | registrar a chave numa conta gratuita de "distribuição limitada" (até 20 aparelhos) antes (B6 §4.2) |
| **Privacidade entre pessoas** (P2) | a IA vazar dado de saúde de uma pessoa para outra | existente hoje | decisão D2; o app em si já separa por perfil no servidor |
| **Repositório público** | documentação ou APK expondo dados | baixa | anexos anonimizados; segredos nunca no repo; token obrigatório na API |
| **Credencial do Drive** revogada | fotos e espelhos param | baixa | checagem diária existente |
| **Escopo crescer** (vontade de pôr tudo no MVP) | atraso, app mediano em tudo | média | fases com critério de aceite e sua aprovação em cada uma |

**Dependências externas que não controlamos:** cota gratuita do Gemini; planos gratuitos de Render e Atlas; Health Connect e a forma como cada relógio grava nele (o Galaxy Watch não grava HRV, R3 §6.1); Open Food Facts (limites por IP).

**Incertezas que só os dados reais resolvem** (perguntas abertas dos anexos R1 §8 e R5 §7): volume das coleções, duplicatas existentes em `pesagens`/`perfis`, ordem dos `jids`, versão do Relógio instalada em cada celular, se a planilha "Health Data Export" ainda é usada. Respondo com consultas só de leitura quando autorizar a fase 0.

---

## 9. Perguntas para você

Uma rodada só, com o impacto de cada resposta e minha recomendação. O resto decido tecnicamente.

| # | Decisão | Opções | Impacto | Minha recomendação |
|---|---|---|---|---|
| **D1** | Os outros dois perfis e o app Relógio | (a) o app novo substitui o Relógio só no seu celular; as outras duas pessoas seguem com o Relógio atual · (b) o app novo tem um "modo coletor" para elas desde já | (b) aumenta o escopo do MVP e exige instalar nos celulares delas | **(a)** |
| **D2** | Dados de saúde de uma pessoa no prompt das outras (muda o comportamento do bot) | (a) manter como está · (b) nos prompts, das outras pessoas vão só nome, objetivo, dieta e restrições; saúde, notas e exames só da pessoa da conversa | (b) reduz vazamento e tamanho do prompt; a bot perde a capacidade de comentar a saúde de alguém para outra pessoa | **(b)**, com testes de avaliação antes |
| **D3** | Pesagens de fontes diferentes no mesmo dia (muda como o bot grava peso) | (a) uma pesagem por fonte por dia, e o `validarPesagens` escolhe (o relógio vence a digitada, como hoje) · (b) manter "a última gravação vence" | (b) mantém o bug P1 | **(a)** |
| **D4** | Quem manda nas notas da Nutri | (a) Mongo oficial; o Drive vira só espelho (editar no Obsidian deixa de valer) · (b) manter o Drive relido como hoje | (a) é necessária para corrigir pelo app sem a noite desfazer | **(a)**; se você edita notas no Obsidian, me diga |
| **D5** | Escopo do MVP | (a) como na seção 7 (registro por texto e Nutri em leitura + correção de perfil) · (b) MVP só de leitura, sem nenhuma escrita · (c) incluir foto pelo app já no MVP | (b) entrega mais cedo mas não resolve "corrigir sem Mongo à mão"; (c) depende de D6 e pesa na cota do Gemini | **(a)** |
| **D6** | Guardar as fotos das refeições | (a) sim, na pasta da pessoa no Drive (15 GB grátis da sua conta), miniatura servida pelo servidor · (b) não guardar (o app mostra só ícone e texto) | (a) habilita o "diário em fotos"; exige aviso às pessoas de que as fotos passam a ser guardadas | **(a)**, a partir da fase 2, com consentimento das três pessoas |
| **D7** | Direção visual | (a) Feira honesta · (b) Caderno da Nutri · (c) decidir depois de ver o protótipo HTML das duas | — | **(c)**: autorizo o protótipo isolado? |
| **D8** | Elementos lúdicos | (a) celebração só ancorada em fato, sem sequência que pune, desligável · (b) nenhum · (c) gamificação com pontos e sequência | — | **(a)** |
| **D9** | Fuso do "dia" de cada pessoa | alguém mora ou passa temporadas fora do fuso de Brasília? | se sim, corrigir P6 antes do app exibir histórico | responder sim/não |

---

## 10. Plano de implementação

Cada fase termina com sua aprovação antes da próxima. Antes de codar cada fase, escrevo a especificação curta e o plano de tarefas (skills `brainstorming` → `writing-plans`). Sem prazos com falsa precisão; o esforço vai em termos relativos.

### Fase 0 — Protótipo visual e fundações no servidor (sem mudar o que o bot fala)

| Passo | Entrega | Critério de validação |
|---|---|---|
| 0.0 | Backup do Mongo (`mongodump` semanal por GitHub Actions, guardado fora do repositório público) | primeiro dump restaurado com sucesso num banco local de teste |
| 0.1 | Protótipo HTML navegável das duas direções (página privada, fora do repositório) | você escolhe a direção (D7) |
| 0.2 | Consultas **só de leitura** no Mongo para responder às incertezas da seção 8 | relatório com os números, sem dado pessoal |
| 0.3 | Correção P1 (pesagem por fonte) e P3 (`!refeicao`), com testes | `npm test` verde; avaliação P01-P05 e C41 passando; `!progresso` igual antes e depois para o mesmo período |
| 0.4 | Campos aditivos em `refeicoes` (`uuid`, `versao`, `origem`, `msgId`, `apagadaEm`), coleções `alteracoes`, `metas_historico`, `dispositivos`; backfill com `mongodump` antes | contagens iguais antes/depois; bot sem erro nos logs por 48 h |
| 0.5 | API `/api/v1` de leitura + pareamento + token; `/estado` e `/qr` protegidos (ajustando o `vigia.yml`) | teste "ouro": para 7 dias reais, os números da API batem com `!hoje` e `!progresso` |
| 0.6 | Fuso por localização (D9): o `dia` de refeições e pesagens segue o fuso de onde a pessoa está; o perfil guarda o fuso vigente e o histórico de trocas | teste com viagem simulada (Brasil → Europa → Brasil) sem dia duplicado nem perdido |
| 0.7 | Espelho completo no Drive (D4): resumos, plano, conversa, diário, reflexões e avaliações gravados no Mongo **e** no Drive; o Mongo passa a mandar nas notas | nada que existe hoje só no Drive deixa de existir no Mongo |

### Fase 1 — App MVP (Kotlin + Compose evoluindo `br.nutribot.relogio`)

| Passo | Entrega | Critério de validação |
|---|---|---|
| 1.1 | Base: Compose, tokens de design, componentes da 4.6, navegação, seletor de perfil, Room, pareamento por biometria | instala por cima do Relógio 1.6 sem perder permissões; sincronização do Health Connect continua |
| 1.2 | Hoje e Progresso (leitura) | mesmos números do WhatsApp; abre com cache sem rede; "acordando o servidor" quando o Render dorme |
| 1.3 | Comida: diário, histórico, detalhe com origem, editar, apagar, registrar por texto | edição no app aparece na próxima resposta do bot; edição simultânea gera 409 tratado; reenvio não duplica |
| 1.4 | Nutri (leitura + correção de perfil e meta) e Integrações | itens com natureza e origem corretas para as três pessoas; nada de uma pessoa aparece em outra |
| 1.5 | Uso real por 1-2 semanas | lista de atritos anotada; nenhuma correção manual no Mongo necessária no período |

### Fase 2 — Riqueza do registro

Fotos (D6), foto pelo app, itens estruturados e chips, fibra, Conhecimento com edição e propagação, cartão Semana, correções do Health Connect (P5), widget. Critério: a suíte de avaliação com modelo continua passando depois da mudança do formato da refeição.

### Fase 3 — Expansão

Código de barras + Open Food Facts, despensa com qualidade de produto, micronutrientes, telas de treino e sono, relatórios, tablet, modo coletor (se D1 mudar). Cada item entra só com evidência de uso das fases anteriores.

---

## 11. Fontes e método

**Repositório:** auditoria somente leitura do commit `2ae910e` por cinco agentes (arquitetura e banco; refeições e nutrição; progresso, metas e atividade; IA e memória; integrações). Nenhum segredo (`.env`, credenciais OAuth, keystore) foi lido. Nenhuma consulta ao Mongo, ao Drive ou a serviço externo foi feita nesta rodada. Os 242 testes **não** foram executados nesta rodada (não houve mudança de código).

**Referências:** pesquisa na web em 13/10/2026 por seis agentes, priorizando sites oficiais, centrais de ajuda, documentação e páginas das lojas; avaliações de usuários só como complemento. Os apps **não** foram instalados. Cada anexo tem a seção "Não verificado" e a lista de URLs.

**Páginas das lojas (referências visuais públicas):**
- MyFitnessPal: <https://apps.apple.com/BR/app/id341232718>
- MacroFactor: <https://apps.apple.com/br/app/id1553503471>
- Cronometer: <https://play.google.com/store/apps/details?id=com.cronometer.android.gold&hl=pt_BR&gl=BR>
- Desrotulando: <https://play.google.com/store/apps/details?id=com.desrotulando.app>
- Foodvisor: <https://apps.apple.com/br/app/foodvisor-contador-de-calorias/id1064020872>

As capturas de tela não foram copiadas para o repositório (direitos de imagem dos fabricantes); os anexos descrevem o que cada captura mostra e apontam a página oficial.

**Anexos:**

| Anexo | Conteúdo |
|---|---|
| [R1](anexos/R1-arquitetura-banco-perfis.md) | arquitetura, coleções, perfis, rotas, tarefas agendadas, deploy |
| [R2](anexos/R2-refeicoes-nutricao.md) | fluxo de registro de refeição, esquema, banco de alimentos, bugs |
| [R3](anexos/R3-progresso-metas-atividade.md) | catálogo de 86 indicadores, metas, relatórios periódicos |
| [R4](anexos/R4-ia-memoria-conhecimento.md) | prompts, inventário do que a IA sabe por pessoa, riscos |
| [R5](anexos/R5-integracoes-drive-relogio.md) | app Relógio, Google Drive, Hevy, cupom, contratos JSON |
| [B1](anexos/B1-myfitnesspal.md) · [B2](anexos/B2-macrofactor.md) · [B3](anexos/B3-cronometer.md) · [B4](anexos/B4-desrotulando.md) · [B5](anexos/B5-foodvisor.md) | benchmarks com fontes |
| [B6](anexos/B6-health-connect-dados-stack.md) | Health Connect, bases de alimentos BR, reconhecimento por foto, stack, backend gratuito, gráficos |
| [S1](anexos/S1-matriz-comparativa.md) | matriz comparativa crítica (Etapa 3) |
| [S2](anexos/S2-mapa-bot-para-app.md) | tudo que o bot responde (35 comandos, 15 ferramentas, gatilhos, envios automáticos) → onde aparece no app, 58 rotas `/api/v1` com fase |
| [F0](anexos/F0-dados-reais.md) | consultas só de leitura nos dados reais (tamanho do banco, perfis, pesagens, refeições, fuso), base das correções da fase 0 |
