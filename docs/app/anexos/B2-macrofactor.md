> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# B2 — MacroFactor (MacroFactor / Stronger by Science): análise de concorrente

Pesquisa feita em 13/10/2026 com fontes públicas: site oficial, central de ajuda, artigos técnicos do próprio MacroFactor, lojas de apps, imprensa especializada e avaliações de usuários. Não houve teste do app instalado, então tudo o que é visual vem de texto das fontes, não de captura de tela. Quando escrevo "não verificado", é literal: a informação não apareceu em nenhuma fonte acessível.

---

## 1) Ficha

| Item | Dado | Fonte / data |
|---|---|---|
| Desenvolvedor | MacroFactor (equipe que nasceu na Stronger by Science; Greg Nuckols assina os artigos de algoritmo) | macrofactor.com, artigos V3 e modificadores |
| Plataformas | iOS (inclui iPad, Mac M1+, Apple Watch, Vision) e Android (Google Play desde set/2021, pacote `com.sbs.diet`) | App Store BR; AppBrain (via busca) |
| Versão iOS | 5.8.9, notas "Bug fixes and performance improvements" (24/set, ano não exibido; provavelmente 2026) | App Store BR, acesso 13/10/2026 |
| Base de usuários | Mais de 185 mil usuários em 2024 (eram 35 mil em 2022 e 90 mil em 2023) | Annual Report 2024 |
| Nota | App Store BR: 4,8 (103 avaliações). App Store global: cerca de 4,8 (de 12,6 mil a 20 mil avaliações, conforme o agregador). Google Play: **não verificado** (a página não renderizou) | App Store BR; AppBrain/apppricinglab |
| Modelo de cobrança | Só assinatura, **sem plano grátis**. EUA: US$ 11,99/mês, US$ 47,99/semestre, US$ 71,99/ano; pacote com o MacroFactor Workouts US$ 89,99/ano. Teste grátis de **7 dias** segundo a loja (algumas resenhas falam em 14, divergência não resolvida) | Play/App Store (descrição); Amy Food Journal (19/09/2026); Outlift (03/02/2026) |
| Preço no Brasil | App Store BR: mensal de R$ 49,90 a R$ 66,90 (três valores listados), semestral R$ 264,90, anual R$ 399,90, pacote anual R$ 599,90 | App Store BR, acesso 13/10/2026 |
| Idioma | **Inglês e japonês** (o japonês chegou em mai/2024). **Não tem pt-BR**, e a descrição na loja brasileira está em inglês | App Store BR; Annual Report 2024 |
| Base brasileira de alimentos | O Brasil não está na lista de países com boa cobertura de código de barras (EUA, Canadá, Reino Unido, Austrália, Irlanda, Nova Zelândia, Japão, França, Espanha; a Alemanha "melhorando"). Alimentos básicos (carne, arroz, frutas) são cobertos porque variam pouco entre países | Help art. 25 |
| Proposta | "Conceptually simple, but analytically complex": descobrir quanto comer para manter, ganhar ou perder peso no ritmo desejado | macrofactor.com/welcome |

---

## 2) UX/UI

### Estrutura e navegação
- **Abas.** A ajuda e os anúncios citam Dashboard, Food Log (diário em linha do tempo), **Strategy** (metas e check-in) e **More** (configurações, integrações, exportação, base de conhecimento). Que essa seja exatamente a barra inferior é **não verificado**: nenhuma fonte descreve a barra.
- **Dashboard em 4 seções** (Help art. 22):
  1. **Nutrition Overview.** O widget *Nutrition & Targets* mostra a semana com **4 barras por dia** (kcal, proteína, gordura, carboidrato) e uma **linha cinza** marcando a meta de kcal do dia. Ao atingir ou passar a meta, a barra fica **preta (tema claro) ou branca (tema escuro)**, nunca vermelha. Tocar num dia mostra só aquele dia; desmarcar volta ao resumo da semana; dá para alternar entre "consumido" e "restante", e o app lembra a escolha. Há ainda o *Energy Balance* (30 dias, depois qualquer intervalo, em visão Metas ou Gasto) e o *Food Log Focus* (o dia em números grandes).
  2. **Insights & Analytics.** *Expenditure*, *Weight Trend* e *Goal Progress*. O Goal Progress é um **gráfico em cascata (waterfall)**: a barra da "Semana 0" é o tamanho da meta, cada semana tem sua barra (clara quando avançou, escura quando recuou) e uma barra cinza mostra o que falta. Em meta de manutenção vira um **mostrador "Under/Over"**.
  3. **Habits.** Consistência do registro de comida e de peso; tocar num dia abre a edição.
  4. **Body Metrics / Nutrition.** Peso da balança, 24 medidas, fotos de progresso em 3 ângulos e cerca de 60 nutrientes, com a opção de fixar os prioritários.
- **Personalização** (nov/2024): reordenar os blocos, ligar e desligar detalhes, escolher o "Dashboard Hat" (o bloco do topo) e agregar por dia, semana ou mês. Os gráficos têm modo compacto e modo tela cheia, seletores de 3, 7, 14, 30 e 90 dias perto do polegar, pinça e arrasto, tooltip ao segurar o dedo, e médias acima do gráfico que acompanham o intervalo escolhido (dashboard-revamp, set/2024).
- **Gráfico de tendência:** o peso da balança aparece como **linha clara** e a tendência como **linha roxa escura** (Help art. 21). As fontes **não descrevem nenhuma banda de incerteza**.

### Registro de comida (o ponto mais elogiado)
- Diário em **linha do tempo de 24 horas** em vez de "café, almoço, jantar". O registro entra na hora atual por padrão; segurar uma hora permite registrar antes ou depois.
- **"Plate" (prato) como área de rascunho**: busca, código de barras, IA e Quick Add caem primeiro no prato, editável; só "Log Items/Log Foods" grava. O *Multi-Add* adiciona sem abrir o detalhe, o app **aprende os alimentos habituais de cada hora** e lembra a última porção usada. Para escolher a porção há um **teclado próprio**, com conversão automática entre g, oz, ml e xícara (new-food-logger).
- Barra de **atalhos** com código de barras, busca e os 4 favoritos acima da navegação; ela some ao rolar a tela.
- Recursos menos visíveis: copiar e colar um dia inteiro em várias datas, "explodir" uma receita em ingredientes, registrar "por caloria ou macro" (você digita 30 g de proteína e o app calcula a porção) e salvar refeições (10-features).

### Check-in semanal e "coach"
- Um alerta na aba Strategy avisa quando o check-in está disponível. O dia é **escolhido pelo usuário**, e o painel mostra contagem regressiva e um anel da meta (dashboard-revamp).
- O check-in tem **módulos de coaching**, cada um apresentado pelo "MF Coach" com o motivo de aparecer, e pode ser pulado:
  - *Partial Logging*: aponta dias que parecem incompletos e pede para marcá-los.
  - *Weigh-In*: mostra a última pesagem e oferece registrar outra.
  - *Fasting*: pergunta se os dias sem registro foram jejum.
  - *Logging Break*: explica por que o cálculo pausou.
  - *Program Update*: as novas metas.

  O "Fast Check-In" pula tudo e mostra direto as metas. O usuário pode **recusar** o check-in, e aí as metas não mudam (Help art. 247).
- **Três estilos de programa** (Help art. 91):
  - **Coached**: o app define e ajusta tudo, com piso diário de kcal e gordura mínima.
  - **Collaborative**: o app ajusta o orçamento **semanal** e a pessoa distribui kcal e macros pelos dias (dia de treino, jejum, festa). **Não tem piso de kcal nem de gordura.**
  - **Manual**: o app não define meta e sobram só os registros e as análises.

  Dá para trocar de estilo a qualquer momento sem perder dados.

### Tom e linguagem visual
- Design deliberadamente **"adherence-neutral"**: passar da meta não gera aviso, pop-up nem número vermelho. "Recommendations are informative, not punitive" (macrofactors-algorithms-and-core-philosophy). Resenhas elogiam a "neutral visual language" (Amy Food Journal, 2026) e a ausência de selos, feed social e anúncios (fitnesstoolsreviewed, abr/2026).
- **Tipografia e paleta**: não verificadas, além do roxo da linha de tendência e do preto/branco da meta atingida. Tem modo escuro (Outlift).
- **Acessibilidade** (tamanho de fonte dinâmico, leitor de tela, contraste): **não verificado**. Nenhuma fonte trata do assunto.

### Onboarding
- É um assistente que monta um programa Coached a partir de dados demográficos, antropométricos e de estilo de vida, com atividade do dia a dia separada do exercício intencional (welcome; algorithms). O assistente de meta tem 3 passos: objetivo, depois peso-alvo e ritmo (com prévia da meta de kcal e **ETA**, a data prevista de chegada), depois resumo (goal-features, 12/09/2025). O ritmo é definido em **% do peso por semana** (Help art. 222).
- Dá para informar **à mão** o gasto inicial e **retroalimentar** de 14 a 30 dias de histórico pela aba Habits (algorithms).

### Intuitivo x complexo
- **Intuitivo:** o registro (elogio recorrente), a ausência de culpa, as tendências prontas no dashboard e o check-in guiado por módulos.
- **Complexo:** a curva de aprendizado é maior que a do MyFitnessPal (fitnesstoolsreviewed; bestcalorieapps). A meta **muda sozinha**, às vezes em cerca de 100 kcal de um dia para o outro, e confunde (fitnesstoolsreviewed). Os ajustes das 2 primeiras semanas parecem defeito (bestcalorieapps: "New users sometimes mistake the algorithm's early adjustments as the product being broken"). O dashboard "can become the hobby" (Amy Food Journal).

---

## 3) Funcionalidades

| Recurso | Como funciona | Evidência (fonte) | Problema que resolve | Relevância para o NutriBot + por quê |
|---|---|---|---|---|
| Gasto adaptativo (Expenditure V3) | Rearranja o balanço energético: gasto = ingestão registrada − variação de energia armazenada (tirada da tendência de peso). Atualiza diariamente; as metas mudam no check-in semanal | Help art. 26; expenditure-v3 | Fórmulas de TMB/TDEE erram de 100 a 500 kcal | **Alta.** É o mesmo princípio do `calibrarEnergia`. Ver §4 |
| Tendência de peso | Média móvel com peso maior para os dias recentes; dias sem pesagem preenchidos por interpolação linear | Help art. 21 | Ruído de água, glicogênio e intestino | **Alta.** É o contraponto à regressão de 28 dias do NutriBot. Ver §4 |
| Status "updating/holding" | O gasto **congela** ("holding") sem pesagem em 7 dias ou com mais de 3 dias sem comida numa janela de 7; volta a calcular quando os dados voltam | Help art. 109; expenditure-v3 | Evita estimar no escuro | **Alta.** Rótulo simples para "dados insuficientes" no app |
| Check-in semanal com módulos | Dia escolhido pela pessoa; módulos que corrigem dados (registro parcial, jejum, pesagem) **antes** de recalcular a meta; dá para recusar | Help art. 247 | Lixo na entrada vira meta errada | **Muito alta.** O NutriBot pode fazer isso em conversa: "terça parece incompleta, foi jejum ou faltou registrar?" |
| Coached / Collaborative / Manual | Três níveis de controle sobre as metas | Help art. 91 | Usuários com nível de conhecimento diferente ou com nutricionista próprio | **Média.** Para 3 pessoas, o "Manual" serve a quem segue a meta de um nutricionista |
| Manutenção dinâmica | Dentro de ±1,5 lb (0,68 kg) do alvo, meta = gasto; fora dessa faixa, déficit ou superávit de 0,15% do peso por semana | Help art. 125 | Manutenção sem efeito sanfona | **Média-alta.** Regra simples e transparente para a fase pós-meta |
| Foto com IA (MacroFactor AI) | Foto, foto + texto ou upload; a IA **monta o prato a partir de itens do banco de alimentos** ("does not rely solely on LLMs"), e cada item fica editável antes de gravar. Beta aberto desde 30/03/2025 | version-5-0-0; Help art. 258 | Busca manual demorada em pratos compostos | **Alta.** O NutriBot já faz foto; a diferença é ancorar em entradas de banco auditáveis |
| AI Describe (texto/voz) | Descreve a refeição por voz ou texto; busca no banco de "common foods" | Página do Food Logger (macrofactorapp) | Registro sem câmera | **Média.** O NutriBot já faz texto e áudio pelo WhatsApp |
| Leitor de rótulo | Lê tabela nutricional em vários formatos e idiomas; cria alimento pela foto da frente + rótulo (jul/2026) | mm-july-2026; Help art. 25 | Produto fora do banco | **Alta para o Brasil.** É a saída em regiões sem cobertura de código de barras |
| Código de barras | Produtos de marca no banco curado + submissões validadas por máquina e pela comunidade Open Food Facts; é possível ligar um código a um alimento próprio | release 2.7.0; Help art. 25 | Registro rápido de industrializados | **Baixa-média.** Cobertura brasileira não confirmada |
| Banco de alimentos | ~1,15 milhão de itens (2022). "Common foods" curados, licenciados de bases de pesquisa (NCC citada); submissões de usuários revisadas por humanos; mais de 70 mil submissões em 2024 | new-food-logger; Annual Report 2024; busca (help art. 46) | Confiabilidade nutricional | **Média.** Lição: separar "comum curado" de "marca"; no Brasil o equivalente seria a TACO/TBCA |
| Micronutrientes | Cerca de 60 nutrientes, "contribuidores" por alimento, fixar prioritários | Help art. 22; 10-features | Qualidade da dieta | **Baixa** para o foco atual |
| Peso, medidas e fotos | Peso, 24 medidas, fotos em 3 ângulos | Help art. 22 | Progresso além da balança | **Média** |
| Meta com ETA | Prévia da kcal e data prevista; a meta pode encerrar pela balança ou esperar a **tendência** chegar ao alvo | goal-features; mm-feb-2022 | Expectativa realista | **Média-alta.** O NutriBot só dá data com pesagens suficientes; é a mesma ideia |
| Health Connect / Apple Health | Integrações principais. Peso nos **dois sentidos** (2.9.3). A prioridade é fixa: manual > registro do app > integração, e uma entrada manual bloqueia a sincronização do dia. O Fitbit direto foi descontinuado | Help data_sources; version-2-9-3 | Pesagem automática pela balança inteligente | **Alta.** É o mesmo canal que o NutriBot usa com o relógio |
| Passos (modificador) | "Step-Informed Updates" (out/2025, opcional): a tendência de passos **acelera** a atualização do gasto quando aumenta a confiança; **não** soma kcal de passos à meta do dia | expenditure-modifiers; version-5-5-0 | Mudança de atividade demora a aparecer no gasto | **Alta.** O NutriBot usa o gasto do relógio diretamente; ver §4 |
| Ajuste preditivo de meta | Ao mudar de objetivo, ajusta o gasto em cerca de 4 × (ritmo semanal em % do peso), por exemplo −4% para uma meta de −1%/semana | expenditure-modifiers | Atraso entre a nova meta e a resposta do peso | **Média** |
| Gasto estático | Opção de congelar o gasto e parar de ajustar as metas | Help art. 64 | Quem não quer metas mudando | **Baixa-média** |
| Exportação | Quick Export ou Granular Export em planilha (nutrição, peso e mais) | Help art. 356 | Portabilidade | **Média.** O NutriBot já tem planilha |
| Copiar dia / refeições salvas / receitas | Copia um dia para várias datas, salva grupos de alimentos, importa receita por link ou foto | 10-features | Repetição | **Média.** Equivalente em conversa: "mesmo café de ontem" |
| Sem recursos sociais | Não tem feed nem badges | Outlift; fitnesstoolsreviewed | — | Confirma que o valor não vem de gamificação |
| Roteiro (votos) | Mais votados em consideração: importar sono (14.376), sub-metas de peso (7.039), plano de refeições (6.767), lembrete de pesagem (6.733). Planejados: água, web app, calculadora de álcool | feedback.macrofactorapp.com/roadmap | — | **Média.** Sinal do que usuários avançados pedem: lembrete de pesagem e marcos intermediários |

---

## 4) Cálculos e dados

### 4.1 Gasto energético (Expenditure)

**Princípio declarado.** Algoritmos "purely deterministic", baseados em "Calories out = Calories in − Change in stored energy". A variação de energia armazenada sai da **tendência** de peso, nunca da pesagem crua (Help art. 26; algorithms).

**Estimativa inicial.** Usa "custom equations" para a TMB (a Stronger by Science cita Cunningham como base em texto antigo) com multiplicadores próprios que separam atividade do dia a dia e exercício. Os valores numéricos ficam em imagens que não consegui ler, então os coeficientes estão **não verificados**. O próprio app avisa: "will change. Don't get too attached to it". O erro típico de equação de TMB é de 100 a 200 kcal/dia, e no indivíduo pode chegar a 400–500 kcal (Help art. 26).

**Janela e atualização.**
- Começa a atualizar no **dia 3**; a estimativa estabiliza em **3 a 4 semanas** (algorithm-accuracy). A ajuda fala em 2 a 3 semanas para "dial in" e de 1 a 2 semanas para absorver mudanças de atividade (art. 26).
- A **janela exata é proprietária**. O artigo da V3 mostra janelas de 1 semana (responde rápido, mas é ruidosa) e de 1 ano (estável, mas lenta) e diz apenas que a V3 melhora a "fronteira de eficiência" entre estabilidade e responsividade: cerca de 19% mais responsiva com a mesma estabilidade, e quase 30% com os dois modificadores (expenditure-modifiers).
- Nos primeiros ~30 dias o app aceita **passos maiores** para corrigir rápido o erro inicial, o que gera um **overshoot de 50 a 150 kcal** que se acomoda em 3 a 4 semanas (Help art. 26).
- A V3 detecta virada de tendência de **1 a 5 dias antes** da V2, com mudanças diárias cerca de 35% menores (expenditure-v3). A mudança média do gasto é de ~7,25 kcal/dia por dia (expenditure-modifiers).

**Dias sem registro de comida.**
- A V3 **estima internamente a ingestão** dos dias não registrados. O erro médio é de ~13%, e mais de 90% dos erros ficam abaixo de 30%.
- O cálculo só **pausa** quando há **mais de 3 dias sem comida numa janela de 7**. A V2 pausava com 2 ou mais dias faltando.
- No teste, apagaram aleatoriamente metade dos dias do autor, 10 vezes, e o resultado ficou próximo do completo (expenditure-v3).
- Há divergência entre as fontes: a Help art. 26 ainda diz "pelo menos 6 de 7 dias", enquanto a art. 222 e o artigo da V3 dizem 4 de 7. Provavelmente a art. 26 é anterior à V3.

**Registro parcial (o "calcanhar de Aquiles" declarado).**
- O app **não tem como saber** que faltou o jantar: trata o dia como de ingestão baixa, e o gasto sai subestimado.
- A recomendação é **apagar o dia** (o algoritmo lida bem com dia vazio) ou fazer **Quick Add com uma estimativa** do total (Help art. 29, pela busca; a página não renderizou).
- Em números: registro parcial em **mais de ~5% dos dias** já piora a precisão de forma perceptível, e **acima de 10%** piora muito (algorithm-accuracy).
- O módulo *Partial Logging* do check-in pede para marcar os dias suspeitos.
- **Omissões pequenas e constantes** (itens abaixo de ~50 kcal, temperos, "um pouco de creme") são absorvidas: o gasto calculado já desconta o que nunca é registrado, e a meta fica "na régua do seu registro" (Help art. 140).

**Pesagens faltando.**
- Basta **1 pesagem a cada 7 dias**; o ideal é diário ou 3 ou mais por semana.
- Sem pesagem, o status passa a **"holding"**. Na volta, "catch up immediately", interpolando linearmente o intervalo; isso só falha em lacunas longas com subidas e descidas no meio (Help art. 109).
- Durante uma pausa (doença, viagem), o app usa o último gasto de **"high confidence"** (algorithms).

**Correção de densidade energética (V3).** A regra de 3.500 kcal/lb (~7.700 kcal/kg) supõe cerca de 78% gordura e 22% massa magra. As versões antigas tratavam ganho e perda de forma assimétrica, com viés de ~80 kcal para cima; a V3 corrigiu, com impacto de 0 a 130 kcal/dia, geralmente para baixo. A constante final por kg **não é publicada**.

**Wearables.**
- O MacroFactor **não usa** o gasto calórico do relógio nem as calorias de exercício registradas.
- A justificativa vem de estudos com o gasto de wearables: erro acima de 10% em 82% dos casos em vida livre e MAPE de 14,9% a 47,8% (estudo de 2022). Também há compensação energética: +100 kcal de atividade viram cerca de **+72 kcal** de gasto total.
- Desde out/2025, o modificador opcional usa **apenas passos**, e só como sinal para **acelerar** a atualização, "We do NOT attempt to directly assign an expenditure value to your steps" (wearables; expenditure-modifiers).

**Validação publicada** (interna, sem revisão por pares; algorithm-accuracy):
- Amostra: 748 usuários novos do desafio de 2025, acompanhados por 100 dias, excluindo quem registrava parcialmente de forma crônica (menos de 10%).
- Erro do gasto em 3 a 4 semanas: **mediana de 135 kcal/dia** contra 335 kcal da fórmula. O erro cumulativo é de ~110 kcal/dia (4,4% do TDEE) e cai para ~80 kcal/dia (3,25%) depois que o algoritmo assume.
- Correlação entre previsto e observado: r = 0,869 na variação mensal e r = 0,94 em 100 dias.
- Com os modificadores, a mediana de 100 dias foi de 108 para 89 kcal.
- O critério é **validade preditiva**: o gasto estimado prevê o peso futuro? Não houve comparação com câmara metabólica nem com água duplamente marcada.

### 4.2 Tendência de peso
- É uma "moving average... that places greater emphasis on more recent weigh-ins", com influência "over a pretty long time scale". O formato é compatível com uma média exponencial (EWMA), mas **o método exato e a constante não são publicados**.
- A tendência **olha só para trás**: fica abaixo da balança quando o peso sobe e acima quando desce, ou seja, tem **atraso**.
- Desvios de 1 ou 2 dias quase não movem a tendência; se persistirem até o "dia 4 ou 5", sobretudo acelerando, o app ajusta.
- Lacunas são preenchidas por **interpolação linear** (exemplo: 151 → ? → 150 vira 150,5 no dia do meio) (Help art. 21; algorithms).
- **Não exibe intervalo de confiança** nem banda. As fontes só descrevem as linhas da balança e da tendência.
- O MacroFactor Monthly de jul/2026 cita um "**Weight Trend V2**" experimental em beta, que suavizaria de forma mais robusta, **revisaria valores passados** (deixaria de olhar só para trás) e permitiria basear a tendência em peso, em ritmo da meta ou numa mistura. **Não consegui confirmar** em outra fonte: a ajuda ainda descreve a V1. Se for real, é o MacroFactor admitindo o problema do atraso da média só retrospectiva.

### 4.3 Atualização das metas (check-in semanal)
- Meta = gasto estimado ± o déficit ou superávit correspondente ao ritmo, que é definido em **% do peso por semana**: 0,5%/semana são 1 lb a 200 lb e 0,9 lb a 180 lb (Help art. 222).
- O ajuste **não acompanha 1:1** a variação do gasto. No exemplo da ajuda, 3 semanas de estagnação baixam a meta em 200 a 300 kcal, não nos 500 que a conta direta daria. A confiança "much more" vem só com 3 a 4 semanas consistentes.
- **Cada semana é independente**: quem ficou atrás não recebe meta mais apertada para "compensar", e quem passou da meta e comeu mais vê a meta **subir** se a balança não acompanhou (exemplo: comeu 2.600 com meta de 2.500, e 2.600 passa a ser a meta adequada). "Informative, not punitive."
- Estar adiantado **não** é motivo para cortar mais: a meta só cai se o gasto cair.
- **Sem teto explícito** de mudança semanal; mudanças podem ser menores que 10 kcal.
- Proteína pela massa magra e categoria; o restante vai para gordura e carboidrato conforme o tipo de dieta, com **piso de gordura**.
- Quando há retenção persistente de água (creatina, mudança de carboidrato), o erro costuma ficar abaixo de 10% do gasto e some em cerca de 2 semanas. A sugestão é **pular 1 ou 2 check-ins** (Help art. 26).

### 4.4 Como comunica incerteza
- **Não usa número de incerteza.** Não há IC, faixa ou probabilidade na interface, ou ao menos nenhuma fonte descreve isso; o artigo dos modificadores diz explicitamente que não trata de IC.
- A incerteza é comunicada por **estados e textos**:
  - o status "holding/updating";
  - a explicação de que a estimativa inicial "vai mudar";
  - artigos explicando o overshoot e a demora;
  - o módulo *Logging Break*, que diz por que o cálculo pausou e quando volta;
  - a ideia de último valor de "alta confiança".
- **Erro de registro**: tratado como algo que o algoritmo **absorve** (omissão constante) ou que o usuário **conserta** (registro parcial: apagar o dia ou estimar o total). Não há um número "seu registro está X kcal acima ou abaixo da balança".
- **Transparência**: o princípio é explicado em artigos longos com gráficos e números de validação, mas fórmulas, janelas e constantes são proprietárias.

### 4.5 Comparação com o NutriBot

O que o NutriBot já faz, segundo o código e os commits 41f73c3 e 2ae910e:
- regressão linear sobre 28 dias, com IC de 95% corrigido por autocorrelação (graus de liberdade efetivos) e Theil-Sen como checagem robusta;
- veredito do ritmo só quando o IC permite;
- mínimo de 6 pesagens em 14 dias para julgar ritmo, e 4 pesagens em 21 dias para pesagem semanal;
- `calibrarEnergia` com pelo menos 10 dias completos de comida e 7.700 kcal/kg;
- a regra `registroDiscordaDaBalanca`, com tolerância de 250 kcal;
- leitura do gráfico em janelas de 7, 14, 21 e 28 dias, com média móvel centrada de 7 dias;
- conferência do texto da IA antes de enviar;
- gasto do relógio (Health Connect) usado na conta do balanço.

| Aspecto | MacroFactor | NutriBot | Avaliação |
|---|---|---|---|
| Tendência de peso | Média ponderada para os dias recentes, só retrospectiva; atraso de alguns dias; parâmetros fechados | Regressão de 28 dias + Theil-Sen + leitura em 7/14/21/28 dias + MM7 centrada | **NutriBot melhor na honestidade estatística** (IC e checagem robusta). **MacroFactor melhor na responsividade**: a média exponencial reage em 4 a 5 dias, enquanto a regressão de 28 dias "arrasta" uma virada por semanas. As janelas curtas do NutriBot (`janelas_divergem`) compensam em parte |
| Incerteza | Estados (holding/updating) e textos; nenhum número | IC de 95% e probabilidade do veredito; direção só quando o IC permite | **NutriBot mais rigoroso.** O MacroFactor é **mais simples de entender**. Lição: mostrar o IC como *estado* ("ainda não dá para dizer", "subindo com segurança"), não como intervalo numérico |
| Gasto | Gasto **inferido** de comida + tendência, atualizado todo dia e suavizado; o relógio nunca entra como kcal | Combina o relógio (com piso de 800 kcal) com a comida registrada e calibra contra a balança | **Diferença de filosofia.** O MacroFactor evita o erro do wearable por construção. O NutriBot pode se beneficiar de tratar a kcal do relógio como **sinal de mudança** (como os passos no MacroFactor) e deixar a balança fixar o nível |
| Viés registro × balança | **Absorvido em silêncio**: a meta fica "na régua do seu registro" (viés constante não importa) | Medido e exposto (algumas centenas de kcal/dia (valor real omitido) no caso real); a meta é expressa em "kcal registradas" | **Equivalentes no efeito.** O NutriBot é **mais transparente**, mas corre o risco de soar acusatório. O MacroFactor mostra que, se o viés é constante, a meta calibrada basta e não é preciso explicar a origem a cada mensagem |
| Dias sem registro | Estima a ingestão do dia (erro de ~13%); pausa com mais de 3 dias faltando em 7 | Usa só os dias completos (mínimo de 10) | **MacroFactor melhor no aproveitamento** dos dados; o NutriBot é mais conservador. Vale testar a imputação pela mediana pessoal do dia da semana |
| Registro parcial | Pede para apagar o dia ou estimar; módulo no check-in; quantifica o dano (mais de 5% dos dias já prejudica) | Já marca dia "completo" ou não ("hábito de registro") | **Equivalentes.** O NutriBot pode **perguntar no chat** no momento certo, uma vantagem de UX do bot |
| Pesagens faltando | 1 por semana basta; holding; interpolação linear | 6 pesagens em 28 dias ou 4 em 21 (semanal) | Parecido. O MacroFactor é **mais tolerante** |
| Início | Começa no dia 3; passos maiores nos primeiros 30 dias; overshoot de 50 a 150 kcal explicado | Meta provisória até haver dados; veredito só com IC | O NutriBot evita o overshoot. O MacroFactor dá **resposta mais cedo** |
| Ajuste das metas | Semanal, amortecido (menos que 1:1), sem compensar semanas perdidas, ritmo em % do peso | Meta adaptativa em janela alinhada; não manda comer mais quem está acima do ritmo | Princípios quase iguais. **Adotar o ritmo em % do peso e o amortecimento explícito** |
| Validação | Validade preditiva publicada (n = 748; erro mediano de 135 → ~80 a 110 kcal) | Testes com casos reais e simulações com semente; cobertura do IC medida em ~93% | **Ideia a copiar:** medir o próprio erro preditivo (gasto estimado → peso de 30 dias depois) nos 3 usuários |
| Densidade energética | Ganho e perda simétricos na V3 (cerca de 78/22) | 7.700 kcal/kg fixo | Equivalentes em ordem de grandeza |

---

## 5) Pontos fortes
1. **Registro rápido e editável antes de gravar** (o "Plate"), com uma IA que monta o prato a partir de **itens do banco** em vez de inventar números, o que dá para auditar.
2. **Algoritmo de gasto robusto a dados faltando**: imputa a ingestão, pausa só com mais de 3 dias faltando em 7 e tem estados claros ("holding/updating").
3. **Validação pública com números** (n = 748, mediana de 135 kcal, r = 0,87), algo raro no setor.
4. **Tom sem culpa**: nada de vermelho, a semana é independente, nunca compensa "o que ficou para trás".
5. **Check-in com módulos que limpam os dados** (registro parcial, jejum, pesagem) antes de recalcular.
6. **Três níveis de autonomia** (Coached, Collaborative, Manual) e manutenção dinâmica com regra clara (±0,68 kg; 0,15% por semana).
7. **Postura cética e fundamentada sobre wearables**, com estudos citados; passos usados só como sinal.

## 6) Pontos fracos e reclamações recorrentes
1. **Sem plano grátis**; a cobrança depois do teste incomoda (justuseapp, citações de usuários; Amy Food Journal; fitnesstoolsreviewed).
2. **Curva de aprendizado e metas que "mudam sozinhas"** (cerca de 100 kcal de um dia para o outro), e o começo parece defeito (fitnesstoolsreviewed; bestcalorieapps; justuseapp: "difficult to navigate just to do something simple").
3. **Exige disciplina**: pesagem frequente e registro de 4 a 6 dias em 7. Para quem desiste em 3 dias, é "the wrong starting product" (Amy Food Journal).
4. **Registro parcial distorce o gasto**, e o app não detecta sozinho, só sinaliza no check-in (Help art. 29 e 140; algorithm-accuracy).
5. **IA de foto imprecisa nas porções**: ±15% em teste interno de terceiro (bestcalorieapps, metodologia não publicada); "AI input does not remove portion uncertainty" (Amy); a própria ajuda mostra arroz subestimado (art. 258).
6. **Atraso da tendência** e efeito de água persistente (creatina, carboidrato) causam ajustes errados por 1 a 2 semanas, admitidos pelo próprio app (algorithms; Help art. 26).
7. **Banco com lacunas fora dos países anglófonos**: "doesn't have enough of the items I eat" (justuseapp); o Brasil não é coberto.
8. **Sem pt-BR**: só inglês e japonês.
9. Estimativa inicial alta demais para alguns ("set my initial energy expenditure pretty high", justuseapp) e subestimação histórica para magros em ganho de peso, que o Outlift diz estar "Fixed/Mostly fixed".

---

## 7) Lições concretas para o NutriBot
1. **Traduzir o IC em estados, não em números.** Criar 3 estados visíveis no app e nas mensagens, equivalentes ao "holding/updating" do MacroFactor: "calibrando (faltam N pesagens / N dias)", "estimativa firme" e "pausado: sem pesagem desde dd/mm". O IC continua por trás, decidindo o estado. Ganha-se clareza sem perder o rigor que o NutriBot já tem.
2. **Check-in semanal em conversa, com limpeza de dados antes da meta.** Copiar os módulos: (a) "terça teve só 600 kcal registradas: foi jejum, faltou registrar ou quer que eu estime o total?"; (b) lembrete de pesagem se a última tem mais de 6 dias; (c) depois disso, a meta da semana com o porquê. O bot faz isso melhor que o app, porque pergunta no canal que a pessoa já usa.
3. **Kcal do relógio como sinal, não como nível.** Como no "Step-Informed Updates": a balança fixa o nível do gasto pela calibração, e a variação do relógio ou dos passos só **acelera** a detecção de mudança. Isso ataca o viés de ~950 kcal/dia sem precisar atribuí-lo a cada mensagem.
4. **Imputar dias sem registro em vez de descartá-los, e medir o erro.** Testar a estimativa da ingestão de dias não registrados (mediana pessoal, por exemplo por dia da semana), pausando só com mais de 3 dias faltando em 7, e validar como o MacroFactor fez: apagar dias aleatórios de séries reais e comparar.
5. **Publicar (para os 3 usuários) a própria validade preditiva.** Todo mês, comparar o peso previsto pelo gasto calibrado com a tendência 30 dias depois e mostrar "nossa estimativa errou X kcal/dia no último mês". Esse número dá mais confiança que o IC.
6. **Ritmo em % do peso por semana, ajuste amortecido e semana independente.** Expressar metas em % do peso (0,25 a 1%) e limitar a mudança semanal a uma fração da variação estimada, nunca "compensar" semana perdida. Para a fase pós-meta, adotar a manutenção dinâmica (±0,7 kg; 0,15% por semana).
7. **IA de foto ancorada em base brasileira e "prato" editável no app Android.** No app, mostrar a refeição da IA como lista de itens (TACO/TBCA ou banco próprio) com porção editável antes de confirmar, além do leitor de rótulo pela foto da frente + tabela, a saída do próprio MacroFactor onde o código de barras não cobre.

---

## 8) Não verificado / limitações
- **Fórmulas proprietárias:** constante e janela da tendência de peso (se é EWMA ou não), janela do gasto na V3, coeficientes da TMB inicial e multiplicadores de atividade (em imagens), constante de kcal/kg após a correção da V3.
- **Weight Trend V2 "experimental"**: só aparece no resumo do MacroFactor Monthly de jul/2026 obtido pela ferramenta de leitura; não confirmado em outra fonte.
- **Google Play**: nota, número de avaliações, downloads e preço em R$ no Android não verificados (a página não renderizou). Os preços em R$ são da **App Store BR**.
- **Prazo do teste grátis**: 7 dias (loja) contra 14 dias (duas resenhas de 2026).
- Barra de navegação inferior, tipografia, paleta (além do roxo e do preto/branco), acessibilidade e layout exato da tela de check-in não verificados.
- Os artigos da ajuda 29 e 140 não renderizaram integralmente. O conteúdo veio de trechos da busca e de uma renderização parcial (art. 140).
- A validação de precisão é **interna** (sem revisão por pares) e exclui quem registra parcialmente de forma crônica.
- Avaliações de usuários vieram de agregadores (justuseapp, com amostra pequena e sentimento automático contraditório) e de resenhas, algumas de **concorrentes** (Amy Food Journal, Nutrola), sinalizadas como tal. Não consegui ler threads do Reddit (os espelhos recusaram a conexão).
- Cobertura real de alimentos e códigos de barras brasileiros só se confirma testando no app.

---

## 9) Fontes (URLs)
- https://macrofactor.com/expenditure-v3/
- https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/
- https://macrofactor.com/algorithm-accuracy/
- https://macrofactor.com/expenditure-modifiers/
- https://macrofactor.com/version-5-5-0/
- https://macrofactor.com/wearables/
- https://macrofactor.com/version-5-0-0/
- https://macrofactor.com/ai-food-logging/
- https://macrofactor.com/new-food-logger/
- https://macrofactor.com/10-macrofactor-features/
- https://macrofactor.com/dashboard-revamp/
- https://macrofactor.com/dashboard-customization/
- https://macrofactor.com/goal-features/
- https://macrofactor.com/mm-july-2026/
- https://macrofactor.com/mm-february-2022/
- https://macrofactor.com/annual-report-2024/
- https://macrofactor.com/welcome/
- https://macrofactor.com/version-2-9-3/
- https://macrofactor.com/version-2-7-0/
- https://help.macrofactorapp.com/en/articles/21-weight-trend
- https://help.macrofactorapp.com/dashboard/weight_trend/
- https://help.macrofactorapp.com/en/articles/22-get-to-know-your-dashboard
- https://help.macrofactorapp.com/en/articles/25-how-robust-is-the-database-coverage-in-my-region
- https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure
- https://help.macrofactorapp.com/en/articles/29-how-do-macrofactors-coaching-algorithms-deal-with-partially-logged-days
- https://help.macrofactorapp.com/en/articles/64-how-to-change-your-expenditure-estimate-from-dynamic-to-static
- https://help.macrofactorapp.com/en/articles/91-program-styles
- https://help.macrofactorapp.com/en/articles/109-how-frequently-do-i-need-to-log-my-weight-for-the-expenditure-algorithm-and-weekly-coaching-updates
- https://help.macrofactorapp.com/en/articles/125-how-does-dynamic-maintenance-work-in-macrofactor
- https://help.macrofactorapp.com/en/articles/140-do-i-need-to-log-everything-i-eat-and-drink-to-have-an-accurate-expenditure-and-use-macrofactors-coaching-features
- https://help.macrofactorapp.com/en/articles/222-how-does-macrofactor-make-adjustments-for-a-weight-gain-or-weight-loss-goal
- https://help.macrofactorapp.com/en/articles/242-create-a-new-macro-program
- https://help.macrofactorapp.com/en/articles/247-introduction-to-check-ins-and-coaching-modules
- https://help.macrofactorapp.com/en/articles/258-ai-food-logging
- https://help.macrofactorapp.com/en/articles/356-export-your-data
- https://help.macrofactorapp.com/settings/data_sources/
- https://help.macrofactorapp.com/en/articles/227-google-fit-to-health-connect
- https://feedback.macrofactorapp.com/roadmap
- https://apps.apple.com/br/app/id1553503471
- https://play.google.com/store/apps/details?id=com.sbs.diet
- https://www.amyfoodjournal.com/blog/macrofactor-review (concorrente; 19/09/2026)
- https://outlift.com/macrofactor-review/ (03/02/2026)
- https://bestcalorieapps.com/en/reviews/macrofactor/ (atualizado em 11/10/2026)
- https://fitnesstoolsreviewed.com/app-reviews/macrofactor-review-is-this-nutrition-app-worth-it/ (12/04/2026)
- https://justuseapp.com/en/app/1553503471/macrofactor-macro-tracker/reviews
- https://www.garagegymreviews.com/equipment/macrofactor
- https://nutrola.app/en/blog/macrofactor-not-working-for-weight-loss-heres-why (concorrente)
