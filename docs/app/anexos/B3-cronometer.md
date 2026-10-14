> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# B3: Cronometer (análise de concorrente)

> Coleta em 13/10/2026. As fontes primárias são a central de ajuda oficial (lida pela API pública do Zendesk; cada artigo traz a data de atualização), o site, as notas de versão do blog oficial, a página da Google Play em pt-BR e a da App Store dos EUA. Reviews de terceiros entram só como complemento. Quando não deu para conferir, está escrito **não verificado**.

---

## 1) Ficha

| Item | Dado | Fonte |
|---|---|---|
| Empresa | Cronometer Software Inc. (Canadá) | Google Play; App Store |
| Plataformas | Android, iOS, Apple Watch, Wear OS e web. O web é a versão mais completa: exportar e imprimir relatórios "use o site" | Play (descrição pt-BR); [Mobile - Nutrition Report](https://support.cronometer.com/hc/en-us/articles/360019864891) |
| Público declarado | De quem conta calorias a nutricionistas, médicos, atletas e pesquisa. Tem versão Pro para profissionais | [cronometer.com/pro](https://cronometer.com/pro/) |
| Usuários | "15M users worldwide" (página Pro, out/2026). O press release de 08/09/2025 dizia "more than 13 million" | Pro; [PR Newswire](https://www.prnewswire.com/news-releases/cronometer-launches-premium-photo-logging-fast-verified-nutrition-tracking-for-real-life-302549752.html) |
| Downloads e notas | Play: "5 mi+" downloads, com o selo "Contém anúncios" e "Compras no app". App Store EUA: 4,8 com cerca de 99 mil avaliações. A nota da Play **não verificada** (o HTML traz várias notas e não dá para saber qual é a do app) | Play pt-BR; App Store |
| Última versão | Play: atualizado em 6/out/2026. iOS: 4.59.5 (início de out/2026) | Play; App Store |
| Preço do Gold (EUA, 13/10/2026) | **US$ 10,99/mês** ou **US$ 59,99/ano** (a página anuncia "US$ 4,99/mês cobrado anualmente, economize 54%") | [cronometer.com/gold](https://cronometer.com/gold/); App Store (IAP) |
| Preço do Pro | **US$ 39,99/mês** com 10 vagas de cliente, mais US$ 2,50 por vaga extra por mês e 30 dias grátis | [cronometer.com/pro](https://cronometer.com/pro/) |
| Preço em R$ | **Não verificado.** A Play não mostrou o valor no HTML. Uma review BR de 2025 reclama que o preço não cabe na realidade brasileira | Play pt-BR (review 06/08/2025) |
| pt-BR | **Chegou em set/2026.** A nota da versão iOS 4.58.3 (4/set/2026) diz "Added Brazilian Portuguese language support", e a Play BR mostra o banner "O português já está disponível!". A central de ajuda continua só em inglês (locales = `en-us`). Antes vieram francês (mar/2025) e alemão (out/2025) | App Store; Play; API Zendesk `locales.json`; [notas de versão](https://cronometer.com/blog/cronometer-updates-whats-new-improved/) |
| Base brasileira (TACO/TBCA) | **Nenhuma.** A página oficial de fontes lista NCCDB, USDA SR28, CNF, IFCDB, NEVO, CoFID, NUTTAB e CFCD (compilado de BLS, Frida, FDC Foundation e CoFID). Nem TACO nem TBCA aparecem. As reviews BR de 2024 a 2026 cobram exatamente isso | [Data Sources](https://support.cronometer.com/hc/en-us/articles/360018239472) (atualizado em 13/10/2026); Play pt-BR |

---

## 2) UX/UI

### 2.1 Estrutura de navegação (mobile)
- **Abas confirmadas nos artigos:** *Diary* (tela inicial), *Discover* (com Dashboard, Report e Charts), *Foods*, *More* (Targets, Display, Fasting, Account, Connect Apps & Devices, Sharing). A ordem exata e os ícones da barra **não foram verificados**. Fontes: [Mobile - Diary Overview](https://support.cronometer.com/hc/en-us/articles/360018593112), [Mobile - Fasting](https://support.cronometer.com/hc/en-us/articles/360036016612), [Mobile - Nutrition Report](https://support.cronometer.com/hc/en-us/articles/360019864891).
- **Um único botão de ação:** o "+" laranja fica no centro da parte de baixo e abre Suggest Food, Add Food, Scan Food, Add Note, Add Biometric, Add Exercise, além de Photo, Voice e New Fast no Gold. Uma review de fev/2026 elogia "the big plus button at the bottom center". Cada grupo do diário (café, almoço…) também tem um "+" verde de atalho, configurável por grupo para foto, voz, código de barras etc. ([Mobile - Display](https://support.cronometer.com/hc/en-us/articles/360020863072)).

### 2.2 Como ele mostra muita informação sem virar planilha
O Cronometer é o mais denso dos cinco apps. O que impede que pareça planilha é a **divulgação progressiva em camadas fixas**:

1. **Banner de topo deslizável no Diary.** São cartões independentes que o usuário passa para o lado: *Energy Summary* (três círculos: Consumed, Expenditure e Target ou Balance), *Macronutrient Breakdown*, *Highlighted Nutrients* (**até 8** nutrientes escolhidos pelo usuário) e *Nutrition Scores* (até 8, só no Gold). Cada cartão pode ser ligado ou desligado em More > Display. Fontes: [Diary Overview](https://support.cronometer.com/hc/en-us/articles/360018593112), [Nutrition 101 (blog)](https://cronometer.com/blog/nutrition-101-using-cronometer), [Nutrition Scores (blog)](https://cronometer.com/blog/nutrition-scores/).
2. **Lista do diário** por grupos renomeáveis (Uncategorized, Breakfast, Lunch, Dinner, Snacks). Por padrão, cada item mostra **uma só coluna de resumo** (kcal), que pode ser trocada por outro nutriente. O subtotal do grupo pode ser nenhum, kcal ou macros ([Mobile - Display](https://support.cronometer.com/hc/en-us/articles/360020863072)).
3. **Relatório do dia (Daily Report)**, aberto no menu ⋮ ou ao tocar numa barra. Tem 6 blocos fixos: Energy Summary, Macronutrient Targets, Highlighted Targets, Nutrition Scores, *Complete Nutrient Summary* (todos os nutrientes por categoria) e *Nutrient Balance* ([Mobile - Daily Report](https://support.cronometer.com/hc/en-us/articles/32689033683220)).
4. **Toque numa barra:** mostra os **top contribuidores do dia** para aquele nutriente (no web, os "top 10 sources") e permite editar a meta ali mesmo.
5. **Seleção como filtro:** no web, selecionar um ou mais itens, ou o cabeçalho de um grupo, faz as barras mostrarem só aquela seleção. Na prática vira um "raio-x da refeição" sem tela nova ([Nutrient Targets Summary](https://support.cronometer.com/hc/en-us/articles/360018069532)).

### 2.3 Gramática visual das barras de meta
Documentada em [Nutrient Targets Summary](https://support.cronometer.com/hc/en-us/articles/360018069532) e [Daily Report](https://support.cronometer.com/hc/en-us/articles/32689033683220):
- **Cinza:** ainda abaixo do mínimo. **Verde:** mínimo atingido sem passar do máximo. **Vermelho:** acima do máximo (UL).
- **Pontos** dentro da barra separam três estados: *nada registrado*, *valor registrado sem meta estabelecida* e *valor com meta*. Cinza claro quer dizer sem meta e sem valor; cinza escuro, sem meta mas com valor.
- Nutrientes sem DRI (colesterol, oxalato, fibra insolúvel) aparecem como **"Target Not Set"**. Não inventam meta.
- A meta tem **mínimo e máximo opcionais**. A regra mostrada ao usuário é "atingir pelo menos 100% do mínimo e não passar do máximo".
- **Nutrient Balance** é um mostrador com faixa verde para razões entre nutrientes: Ca:Mg 1,7–2,8; K:Na 2–10; Zn:Cu 8–15; ω6:ω3 1–4; Ca:oxalato >1,3. O texto ensina a corrigir: "se o ponteiro está abaixo da faixa, aumente o 1º nutriente" ([Nutrient Balances](https://support.cronometer.com/hc/en-us/articles/360018348631), Gold).
- **Ícones de procedência na busca:** um béquer vermelho de laboratório marca dados analisados (NCCDB/USDA) e um ícone de código de barras marca dados de rótulo ([Data Confidence Scores](https://support.cronometer.com/hc/en-us/articles/360042550452)).
- Quantidade e porção editáveis aparecem **em verde sublinhado** no resultado da foto e da voz ([Photo-Logging](https://support.cronometer.com/hc/en-us/articles/39013533811092)).
- Tipografia, paleta exata e iconografia completa: **não verificadas** (as capturas não puderam ser lidas). Em 23/06/2026 (4.57.0) houve "Fresh Look": ícone novo e "refreshed nutrition visualizations". Em 11/03/2025 (4.38.0), "Nutrient Target UI Update" ([notas de versão](https://cronometer.com/blog/cronometer-updates-whats-new-improved/)).

### 2.4 Onboarding
Verificado em [Mobile - Quick Start Guide](https://support.cronometer.com/hc/en-us/articles/360021677792), atualizado em 13/10/2026: dados pessoais, **slider** de nível de atividade, meta de perda ou ganho, **ritmo** da meta, **revisão do plano com "goal forecast"** (projeção), e só depois e-mail e senha. Ou seja, o usuário vê o plano antes de criar a conta. Macros (Fixed, Ratios, Keto) e integrações ficam para depois, nas configurações. Se o usuário escolher uma meta de energia baixa, aparece uma mensagem "Goal Weight Review" com **checkbox obrigatório** para seguir ([Mobile - Weight Goal](https://support.cronometer.com/hc/en-us/articles/32978027080980)).

### 2.5 Feedback ao registrar
- As barras do topo "enchem" conforme o usuário adiciona comida (Quick Start).
- Foto e voz mostram o **Energy Summary dos itens casados antes de confirmar**, junto do aviso "Always check if your foods have been matched correctly".
- Jejum: opção "Ask to stop fast when adding food" ([Mobile - Fasting](https://support.cronometer.com/hc/en-us/articles/360036016612)).
- *Streaks* (dias seguidos registrando) no Dashboard. Itens importados de aparelhos e registros retroativos **não contam** ([Streaks](https://support.cronometer.com/hc/en-us/articles/16510105155988)).
- O gasto do dia começa com BMR + atividade basal já lançados à 0h. A central explica isso porque os usuários estranham ver "kcal queimadas" logo cedo ([Mobile - Energy Summary](https://support.cronometer.com/hc/en-us/articles/30300963266452)).

### 2.6 Acessibilidade
- Fonte ajustável de 0,75× a 1,5× desde 27/08/2025 (4.45.0). Tema claro, escuro ou sistema ([notas de versão](https://cronometer.com/blog/cronometer-updates-whats-new-improved/); [Mobile - Display](https://support.cronometer.com/hc/en-us/articles/360020863072)).
- Leitor de tela (TalkBack/VoiceOver) e contraste: **não verificados**.
- A codificação cinza/verde/vermelho depende de cor. Não achei confirmação de redundância por ícone ou texto além dos "pontos".

### 2.7 Onde é intuitivo e onde é complexo
- **Intuitivo:** um único "+", a camada do topo personalizável (até 8 nutrientes em destaque), o toque na barra que leva às fontes do nutriente, e o fato de o modo "Balance" ou "Target" ser um toggle explícito.
- **Complexo:** as configurações de energia têm muitos conceitos (Baseline Activity, Adjusted Baseline, Expenditure Above Baseline, Target × Balance, Show Weight Goal). Isso está documentado mas é pesado. As reviews confirmam: "certa curva de aprendizado devido à quantidade de informações" (Play BR, 17/12/2024), "às vezes complexo demais" (Play BR, 09/05/2026), "The interface isn't intuitive, and it's continuously changing… [micronutrient] tracks but impossible to find" (Play US, 09/09/2026).

---

## 3) Funcionalidades

| Recurso | Como funciona | Evidência (fonte) | Problema que resolve | Relevância para o NutriBot + por quê |
|---|---|---|---|---|
| **Busca textual** | Fragmentos separados por espaço ("soup car" acha "Carrot Soup"). Também busca por número do alimento ou código de barras. Ranking por casamento de nome **+ popularidade**. Abas All, Favorites, **Common** (bases de laboratório), Supplements, **Brands**, Custom, Restaurants. Dá para filtrar por base específica (ex.: só NCCDB). Tem Multi-add | [Mobile - Add a Food](https://support.cronometer.com/hc/en-us/articles/360018955211) | Escolher o registro com mais nutrientes, não o primeiro que aparece | **Alta.** Quando a IA casa "arroz" com a TACO, o NutriBot também escolhe entre registros. Vale preferir o genérico mais completo (TACO) ao de rótulo, como a aba "Common" |
| **"Better Alternative"** | A curadoria marca produtos de marca, com poucos nutrientes, que têm um genérico equivalente mais completo, e os nutrientes que faltam são preenchidos | [Mobile - Add a Food](https://support.cronometer.com/hc/en-us/articles/360018955211) | Rótulo com cerca de 15 nutrientes zera os micronutrientes do dia | **Alta.** Quando a refeição vem de rótulo (pão de forma, iogurte), completar os micronutrientes pelo item TACO equivalente e dizer isso |
| **Código de barras** | Grátis. Lê sozinho, sem botão, ou aceita o número digitado. É alimentado pela **Nutritionix** (mais de 400 mil rótulos) e pelo FDC Branded. Se não acha, "Create New": foto da tabela nutricional + foto da frente da embalagem, revisadas pela curadoria antes de entrar na base pública (CRDB) | [Mobile - Scan Food](https://support.cronometer.com/hc/en-us/articles/360020441392); [Data Sources](https://support.cronometer.com/hc/en-us/articles/360018239472) | Registrar industrializado sem digitar | **Média.** A cobertura de produtos brasileiros é fraca (review BR de 2024: "Nenhum produto brasileiro… conta para ser escaneado"). Já o fluxo "duas fotos, tabela + frente" é exatamente o que o NutriBot recebe no WhatsApp |
| **Leitura de rótulo (NFP)** | Na criação de alimento, "se o rótulo for americano, porção e nutrição são preenchidas automaticamente" a partir da foto | [Mobile - Scan Food](https://support.cronometer.com/hc/en-us/articles/360020441392) | Digitar a tabela | **Média.** O OCR só vale para rótulo dos EUA. O NutriBot com LLM já lê rótulo brasileiro (por 100 g/porção, %VD) |
| **Foto com IA (Photo Logging)** | Gold. Beta em 01/06/2025, lançamento em 01/08/2025 (4.43.0). Foto ou galeria → lista de **alimentos casados com a base curada (NCC)** → o usuário edita porção (verde sublinhado), troca (ícone swap ou "Search For More"), apaga (deslizar) → vê o Energy Summary → "Add To Diary". **"Do you also have…?"** sugere o que costuma acompanhar mas não aparece na foto (manteiga, óleo, condimentos; melhorado em 21/04/2026). Uma foto nova **substitui** a análise anterior. Dá para virar Custom Meal ou Recipe. O blog recomenda pôr talher ou moeda na foto para escala, e o "snap and log later" usa o horário da foto | [Photo-Logging](https://support.cronometer.com/hc/en-us/articles/39013533811092); [notas de versão](https://cronometer.com/blog/cronometer-updates-whats-new-improved/); Play pt-BR ("A IA utiliza registros verificados do banco de dados NCC") | Registrar rápido sem perder a rastreabilidade de micronutrientes: a IA **só escolhe registros da base**, não inventa números | **Muito alta.** É o mesmo princípio que o NutriBot deveria seguir com a TACO: a IA identifica e estima a porção, o número vem da tabela. A pergunta por gordura escondida ataca o erro sistemático da foto. O horário da foto como horário da refeição resolve o "café das 8h registrado às 10h". Acurácia medida da IA: **não verificada** |
| **Voz e texto livre (Voice Logging)** | Gold, desde 29/04/2026 (4.53.1). O usuário dita **ou digita** uma descrição → "Match Foods" → mesma tela de revisão da foto. Editar a descrição e casar de novo **substitui** os itens. Também há registro via Siri | [Mobile - Voice Logging](https://support.cronometer.com/hc/en-us/articles/47549391461780) | Refeição mista sem buscar item por item | **Alta.** É o caso de uso central do NutriBot (texto e áudio no WhatsApp). Diferença: o Cronometer exige confirmação explícita antes de gravar |
| **Assistente com IA (Crono Coach)** | Gold. Fica no Dashboard. Revisa o resumo do dia, sugere refeições, analisa configurações e incentiva. O usuário define objetivos, restrições e **instruções livres** (ex.: "Please notify me if I am under my fiber target"). Exige aceitar um disclaimer | [Mobile - Crono Coach](https://support.cronometer.com/hc/en-us/articles/49995994334100); [Dashboard](https://support.cronometer.com/hc/en-us/articles/10570212821268) | Interpretar a densidade de dados | **Alta.** É concorrente direto do papel conversacional do NutriBot. As "instruções livres" equivalem às notas por pessoa do bot. Qualidade das respostas e modelo usado: **não verificados** |
| **Banco de alimentos** | Bases de laboratório: NCCDB (Univ. Minnesota, "mais de 17.000 alimentos, 70 nutrientes, maior parte da base"), USDA SR28 (mais de 8.000), CNF 2015, IFCDB (~1.000), NEVO (600+), CoFID (750+), NUTTAB (800+). Mais a **CFCD**, própria, que combina BLS, Frida, FDC Foundation e CoFID "com métodos padronizados". Rótulos: CRDB (envios de usuários **revisados pela curadoria**), Nutritionix, FDC UPC. Custom foods são privados | [Data Sources](https://support.cronometer.com/hc/en-us/articles/360018239472) | Dados completos e auditáveis | **Muito alta como modelo.** Hierarquia de fontes explícita: laboratório > compilado > rótulo > usuário. O NutriBot pode ter TACO > TBCA > rótulo > estimativa da IA |
| **Cobertura de nutrientes** | "Up to 92 nutrients and compounds" (fev/2026, 4.51.1: fibra solúvel e insolúvel, subtipos de ω-3 e ω-6, fitato). O site e a loja dizem "95+", e a página Gold diz "95" num bloco e "84" no outro. Inclui aminoácidos e ácidos graxos. Nutrientes com pouco dado ficam **ocultos por padrão** | [notas de versão](https://cronometer.com/blog/cronometer-updates-whats-new-improved/); [Gold](https://cronometer.com/gold/); [Are there nutrients missing?](https://support.cronometer.com/hc/en-us/articles/360000329986) | Acompanhar micronutrientes de verdade | **Média.** A TACO tem bem menos nutrientes que o NCCDB (aminoácidos e ácidos graxos estão em tabela separada da TACO). Lição: **esconder por padrão o que a base cobre mal**, como o Cronometer faz |
| **Data Confidence / Data Quality** | Para cada nutriente, mostra a % do total que vem de alimentos *com* valor para ele (ex.: Mg em 50% quando 1 de 2 barras não tem Mg). Aparece no popup do nutriente, no rodapé de cada Nutrition Score e como "Data Quality" geral, que dá para plotar no tempo. **Vazio ≠ zero** | [Data Confidence Scores](https://support.cronometer.com/hc/en-us/articles/360042550452); [How are Nutrition Scores calculated?](https://support.cronometer.com/hc/en-us/articles/44414065586836) | Total subestimado quando o alimento não tem dado | **Muito alta.** Ver a lição 1 |
| **Metas de nutrientes** | Padrão: DRI (USDA/IOM) por idade, sexo e fase de vida. Gestante e lactante reconfiguram as metas e o BMR. Cada meta pode ter mínimo e máximo, ser personalizada e ficar visível ou oculta. **Não há preset de atleta** | [Mobile - Edit Nutrient Targets](https://support.cronometer.com/hc/en-us/articles/360020571571); [Targets + Profile](https://support.cronometer.com/hc/en-us/articles/31308427612180) | Meta individual | **Média.** O NutriBot precisa de faixas por pessoa (3 perfis). O padrão DRI com override é um bom modelo |
| **Macros** | Três modos: **Ratios** (recalcula quando a energia muda), **Fixed** (gramas fixos) e **Keto** (proteína máx. pela massa magra, carbo máx., o resto em gordura). Carbo total ou líquido (líquido = total − fibra − polióis). **Macro Scheduler** (Gold) troca metas por dia da semana. Usuários reclamam de não poder fixar só a proteína | [Mobile - Macro & Energy Targets](https://support.cronometer.com/hc/en-us/articles/33113157685652); fórum (via busca) | Treino × descanso | **Média.** Proteína fixa com carbo flexível, que o Cronometer não tem, é útil para quem treina |
| **Nutrition Scores** | Gold. 15 categorias (imunidade, eletrólitos, antioxidantes, ossos, sangue, mulher, homem, keto, plant-based, data quality…). Cada nutriente pesa igual, e o score cai abaixo do mínimo **e** acima do máximo. Desde fev/2026 há também o Calcium Absorption Score (desconta fitato e oxalato) | [Nutrition Scores (blog)](https://cronometer.com/blog/nutrition-scores/); [How are… calculated?](https://support.cronometer.com/hc/en-us/articles/44414065586836) | Resumir dezenas de barras num número | **Baixa ou média.** Útil como "nota" no !hoje, mas um nutriente sem dado derruba o score (a staff admite isso no fórum) |
| **Sugestões (Oracle)** | Gold. "Suggest Foods" propõe alimentos que completam metas pendentes sem estourar limites, com filtros (vegano, sem frutos do mar, sem nozes…). O "Nutrient Oracle" ranqueia fontes de um nutriente por densidade e popularidade | [Oracle Food Suggestions](https://support.cronometer.com/hc/en-us/articles/360018348471); [Ask The Oracle](https://support.cronometer.com/hc/en-us/articles/360018510531) | "O que eu como para fechar o dia?" | **Alta.** Pergunta natural no WhatsApp ("o que janto pra bater proteína?"). Dá para fazer com TACO + restrições por pessoa |
| **Biometria** | Peso, % de gordura, PA, FC, glicemia, colesterol e outros. **Custom biometrics** no Gold. Gráficos de **Lipid Panel**, Weight + Body Fat, Weight + Waist, GKI e **CGM** (Dexcom, jan/2025). *Snapshots*: fotos do corpo com sinais vitais | [Charts](https://support.cronometer.com/hc/en-us/articles/360018298812); [Trends Overview](https://support.cronometer.com/hc/en-us/articles/360018298272); [notas de versão](https://cronometer.com/blog/cronometer-updates-whats-new-improved/) | Cruzar comida com saúde | **Média.** Exames de sangue só como biometria digitada, sem importar laudo |
| **Gráficos e Trends** | Gráficos configuráveis com período livre. **Filtro de tipo de dia**: All, Non-Empty ou **Complete Days**. "Show Trend" mostra uma "rolling average" (janela **não documentada**), linha de meta (faixa verde) e jejum sobreposto. Custom chart cruza 2 séries (biometria × nutriente). Exporta imagem ou documento | [Charts](https://support.cronometer.com/hc/en-us/articles/360018298812); [Custom Charts](https://support.cronometer.com/hc/en-us/articles/360029499271) | Ver padrão ao longo do tempo | **Alta.** Ver a lição 3 (dia completo) e a seção 4 (a tendência é fraca) |
| **Nutrition Report** | Média diária no período. Grátis: **só 7 dias**. Gold: qualquer período. Toggles **"Include Today"** e **"Include Supplements"**, além de All, Non-Empty ou Complete Days. Desde 04/07/2025 tem widget no Dashboard | [Nutrition Report](https://support.cronometer.com/hc/en-us/articles/360018569691); [notas de versão](https://cronometer.com/blog/cronometer-updates-whats-new-improved/) | Média sem distorção de dia aberto | **Muito alta.** É o mesmo bug corrigido no NutriBot em 09/10 (a média de 7 dias incluía o café de hoje) |
| **Jejum** | Gold. Timer crescente ou decrescente, jejum agendado e recorrente, histórico e estatísticas, aviso ao adicionar comida, sobreposição nos gráficos | [Mobile - Fasting](https://support.cronometer.com/hc/en-us/articles/360036016612) | Jejum intermitente junto com a nutrição | **Baixa**, salvo se alguma das 3 pessoas fizer jejum |
| **Integrações** | Apple Health/Watch, **Health Connect**, Samsung Health, Fitbit, Garmin, WHOOP, Oura (inclui ciclo), Dexcom, Polar, Withings, Suunto, Keto-Mojo. Google Fit descontinuado em 18/02/2025. Health Connect **importa** glicose, PA, gordura, temperatura, água corporal, FC, FC de repouso, VFC, altura, SpO₂, sono, FR, peso, exercício e "general activity", e **exporta** os mesmos biométricos mais comida e água. Só **um** app de saúde Android por vez. Uma review de 09/2026 reclama que o Samsung Health troca poucos dados | [Health Connect](https://support.cronometer.com/hc/en-us/articles/22731903751316); [sync devices](https://cronometer.com/features/sync-devices.html); busca no blog Health Connect; Play US | Gasto real e peso sem digitar | **Muito alta.** O NutriBot já lê o relógio pelo Health Connect. Ver na seção 4 como o Cronometer evita contar o gasto duas vezes |
| **Exportação** | **Grátis.** CSV por período de Servings, Daily Nutrition (opção de linhas por grupo ou refeição), Exercises, Biometrics e Notes. Há também exclusão em massa e apagar a conta. "Ability to export ALL raw data" vale para todos | [Account Settings](https://support.cronometer.com/hc/en-us/articles/360018760151); [Subscription Types](https://support.cronometer.com/hc/en-us/articles/360028026971) | Portabilidade e análise externa | **Média.** Exportar por pessoa (CSV) é barato e gera confiança |
| **Timestamps** | O horário de cada item **só aparece no Gold** | [Mobile - Display](https://support.cronometer.com/hc/en-us/articles/360020863072) | — | **Baixa.** O NutriBot já tem o horário da mensagem |
| **Receitas e refeições** | Custom recipe com peso cozido, Recipe Importer por URL (Gold), Repeat Items (Gold), Diary Groups e copiar/colar | [Subscription Types](https://support.cronometer.com/hc/en-us/articles/360028026971); [Gold](https://cronometer.com/gold/) | Comida que se repete | **Alta.** "O mesmo café de ontem" deveria ser trivial no bot |
| **Gold × Grátis** | O grátis inclui dados de laboratório, CRDB, custom foods, sincronização, **código de barras**, grupos, **exportação total**, relatórios de 7 dias e **anúncios**. O Gold acrescenta foto, voz, recipe importer, timestamps, scheduler, jejum, custom biometrics, repeat items, scores, custom charts, Oracle, compartilhar receitas, PDF, períodos livres, Crono Coach e zero anúncios | [cronometer.com/gold](https://cronometer.com/gold/); [Subscription Types](https://support.cronometer.com/hc/en-us/articles/360028026971) | — | Referência de recorte: **a IA de registro é o principal recurso pago** |
| **Cronometer Pro** | No web e no app Pro. Perfil **compartilhado** (o cliente registra, aceita o convite por e-mail, que vale 7 dias) ou **interno** (o profissional registra sozinho). Grupos de clientes, convite em lote por CSV, edição do diário, metas e scheduler do cliente, **Pro Lock** (trava as metas do cliente), **"Hide All Nutrition Information"** (pensado para transtorno alimentar), mensagens criptografadas, notas e fotos, relatórios para EMR, branding próprio, diretório. Os clientes ganham Gold. HIPAA/GDPR/CCPA com BAA opcional. "10 mins avg. time to complete a 24-hr recall". Página Pro: "também é opção para famílias… monitorar a dieta de familiares" | [Pro - Client Tab](https://support.cronometer.com/hc/en-us/articles/360018673051); [Pro - Client Settings Menu](https://support.cronometer.com/hc/en-us/articles/360024707231); [Subscription Types](https://support.cronometer.com/hc/en-us/articles/360028026971); [cronometer.com/pro](https://cronometer.com/pro/) | Acompanhar vários clientes | **Muito alta.** É o modelo mais próximo do NutriBot (1 operador e 3 pessoas). Ver a lição 6 |
| **Compartilhamento entre amigos** | Gold. Compartilha **só alimentos e receitas**, nunca o diário | [Sharing](https://support.cronometer.com/hc/en-us/articles/360018867471) | Casal ou família com as mesmas receitas | **Média.** No NutriBot, comida em comum (Pessoa A e Pessoa C) pode ter receita compartilhada |
| **Relatório para imprimir** | Gold. PDF com perfil, resumo nutricional, diário e gráficos escolhidos | [Trends Overview](https://support.cronometer.com/hc/en-us/articles/360018298272) | Levar ao nutricionista | **Média** |

---

## 4) Cálculos e dados

### 4.1 Gasto energético (documentado em detalhe)
Fontes: [Energy Expenditure](https://support.cronometer.com/hc/en-us/articles/31974307318420), [Mobile - Energy Summary](https://support.cronometer.com/hc/en-us/articles/30300963266452), [Energy Target](https://support.cronometer.com/hc/en-us/articles/31975503009044).
- **TDEE = BMR + Baseline Activity + Tracker Activity + Exercise + TEF.**
- **BMR por Mifflin-St Jeor** (idade, sexo, altura, peso), com ajuste para gestante e lactante e opção de BMR **fixo** personalizado.
- **Atividade basal como fração do BMR** (não é o multiplicador clássico de 1,2 a 1,9): Sedentary **BMR×0,2** (padrão), Lightly **×0,375**, Moderately **×0,5**, Very **×0,9**, "No Activity" e Custom. Equivale a TDEE de 1,2 / 1,375 / 1,5 / 1,9 × BMR. O exemplo oficial bate: BMR 1394 dá basal 279.
- **TEF desligado por padrão.** A porcentagem usada **não está documentada**.
- **Anti contagem dupla:** a basal é distribuída por **16 h acordado**. A atividade do relógio vai **substituindo** a basal ao longo do dia ("Adjusted Baseline Activity"), e o exercício desconta a basal pelo tempo de treino. Exemplo oficial: basal de 279 kcal dá cerca de 18 kcal/h, e 30 min de exercício deixam 270. Se o relógio fica fora do pulso, a basal garante o "crédito" do tempo não medido.
- **Meta de energia:** `Baseline Target ± Weight Goal + Expenditure Above Baseline − Consumed`. O "Expenditure Above Baseline" vem **ligado por padrão com Weight Goal e desligado com meta fixa**. Um toggle alterna entre modo **Target** (quanto falta) e modo **Balance** (gasto − consumo). O botão "Show Breakdown" mostra a fórmula com os números do usuário.
- **Conversão entre ritmo de peso e kcal/dia:** **não verificada** (o artigo só diz que "+/−" ajustam o déficit ou superávit).
- **TDEE adaptativo pelo peso real** (calibrar o gasto pela balança): **não encontrado** na documentação oficial. No fórum aparece como pedido de usuário, não como recurso. Ou seja, o Cronometer confia na equação e no relógio e não fecha o ciclo com a balança.

### 4.2 Tendência de peso
- O Dashboard mostra "Weight Change" (diferença entre o menor e o maior peso no período) e "Goal Forecast" ([Dashboard](https://support.cronometer.com/hc/en-us/articles/10570212821268)).
- Nos gráficos, "Show Trend" desenha "the rolling average of your data" ([Charts](https://support.cronometer.com/hc/en-us/articles/360018298812)). **Janela e método não documentados.** Há pedidos antigos no fórum por média móvel configurável e média semanal ao estilo TrendWeight, e usuários que exportam para planilha ou usam TrendWeight, Happy Scale ou Libra (via busca; não abri cada tópico).
- **Sem intervalo de confiança, sem veredito de ritmo e sem confronto entre consumo registrado e balança.** É aqui que o NutriBot (progresso.js: regressão com IC corrigido por autocorrelação, Theil-Sen, calibrarEnergia) está à frente.

### 4.3 Dados incompletos e confiança
- O princípio declarado é que "**blank ≠ zero**": nutriente ausente fica fora da soma, e o total do dia pode estar **subestimado**. A **Data Confidence** quantifica isso por nutriente e por score. O exemplo oficial é Mg com 50% quando 1 de 2 itens não tem o dado ([Data Confidence Scores](https://support.cronometer.com/hc/en-us/articles/360042550452), atualizado em 01/10/2026).
- Limitação apontada por usuário no fórum (via busca): a confiança conta **itens**, não **massa**. Um tempero sem dado pesa o mesmo que 300 g de arroz. A adoção dessa mudança **não foi verificada**.
- Nutrientes com pouca cobertura ficam **ocultos por padrão**, com o aviso de que "os valores podem estar significativamente abaixo do real".
- O score de nutrição cai quando falta dado, e a staff admite que "depende da qualidade dos dados disponíveis".

### 4.4 Médias e dias incompletos
- O usuário marca o dia como **completo** (o padrão é incompleto). Relatórios e gráficos filtram All, Non-Empty ou **Complete**.
- O relatório tem **"Include Today"**, com a justificativa explícita: "if you are only part-way through the current day… it will bring your averages down".

### 4.5 Transparência
É alta no método (fórmulas, multiplicadores e fontes com versão, como USDA SR28 e CNF 2015) e há mecanismo de **reportar erro** com foto do rótulo. É baixa no que é IA: a acurácia de foto e voz não é publicada, e o modelo do Crono Coach também não. Há pequenas inconsistências na própria documentação: Expenditure Above Baseline aparece como 483 num artigo e 482 no outro, e a contagem de nutrientes varia entre 84, 92 e 95.

---

## 5) Pontos fortes
1. **Procedência como parte da interface.** O ícone de laboratório ou de rótulo, a aba "Common" e a "Better Alternative" mostram de onde vem cada número, e a "Data Confidence" diz quanto falta.
2. **Densidade organizada em camadas fixas.** O topo deslizável mostra até 8 destaques, o Daily Report tem 6 blocos sempre na mesma ordem e o toque leva às fontes do nutriente. A densidade é opcional.
3. **Gramática visual curta:** cinza, verde e vermelho, pontos para "sem meta" e "Target Not Set" em vez de meta inventada.
4. **A IA de foto e voz só casa com a base curada,** sempre com revisão antes de gravar e com a pergunta pela gordura escondida.
5. **Gasto energético explicável:** fórmula aberta, "Show Breakdown" e substituição da basal pelo relógio sem contagem dupla.
6. **O Pro é uma operação real de acompanhamento:** perfil interno ou compartilhado, travas, ocultar números e exportação por cliente.
7. **Exportação completa grátis** e central de ajuda muito detalhada, atualizada em 2026.

## 6) Pontos fracos e reclamações recorrentes
| Problema | Evidência |
|---|---|
| **Anúncios agressivos na versão grátis** (tela cheia, espera para fechar, no meio da busca), piores desde 2025 | Play US: 05/05/2025, 11/06/2025, 28/07/2025, 25/02/2026 ("the first week is really misleading — ads get a LOT worse"), 24/08/2026, 08/09/2026, 17/09/2026 |
| **Sem base brasileira (TACO/TBCA)** e poucos produtos BR no código de barras | Play BR: 20/08/2026 ("não tem as bases de dados brasileiras, ex. TACO… prefiro o myfitnesspal"), 24/09/2025, 07/09/2025, 17/05/2026, 12/05/2024; [Data Sources](https://support.cronometer.com/hc/en-us/articles/360018239472) |
| **Só em inglês até set/2026** (central de ajuda ainda só em inglês) | Play BR: 06/09/2025, 01/10/2024, 09/05/2026; App Store 4.58.3; API `locales` |
| **Preço em dólar** pesado para o Brasil. Em 2024 houve relato de cartão brasileiro recusado | Play BR 06/08/2025; 12/05/2024 (pode estar desatualizado) |
| **Registro lento** em prato misto (sem a IA paga) | Play US 20/08/2026 ("takes much longer to add foods if you wanna be precise"); Play BR 03/01/2020 (5 min procurando uma torta) |
| **Interface muda com frequência** e micronutriente é "difícil de achar" | Play US 09/09/2026 |
| **Recurso essencial no pago:** relatório além de 7 dias, timestamps, compartilhar receita | [Gold](https://cronometer.com/gold/); Play US 03/09/2026 |
| **Integração Samsung Health limitada** em comparação com Apple Health; só um app de saúde Android por vez | Play US 07/09/2026; [blog Health Connect](https://cronometer.com/blog/health-connect/) (via busca) |
| **Tendência de peso rudimentar** (sem janela configurável nem média semanal) | Fórum (via busca) |
| Avaliações de terceiros (bentobunny, unstar etc.) citam suporte lento e regressões na edição de receitas | Agregadores (fracos, só sinal) |

---

## 7) Lições concretas para o NutriBot

1. **Mostrar a "confiança do dado" por nutriente e distinguir vazio de zero.** A TACO marca valores como traço ("Tr") e não analisado ("NA"/"*"). Guardar isso como `null` ≠ `0` e, no !hoje e no !progresso, dizer: "ferro: 9 mg (dado completo em 70% do que você comeu hoje; pode estar subestimado)". Ponderar pela **massa** (gramas com dado ÷ gramas totais), corrigindo a falha que o fórum aponta no Cronometer. Nutrientes que a TACO cobre mal não entram em meta nem em alerta por padrão.

2. **A IA identifica, a tabela dá os números, e a procedência fica gravada.** Igual ao Photo Logging: o LLM só escolhe **itens da TACO** (ou rótulo lido) e estima gramas. O kcal e os micronutrientes saem da tabela, e cada item guarda `fonte: TACO|TBCA|rotulo|estimativa_IA`. Na resposta, um selo curto por item (ex.: "arroz (TACO) 150 g · pão (rótulo)"). Quando só houver rótulo, completar os micronutrientes pelo genérico TACO, como a "Better Alternative" faz.

3. **Estado explícito de "dia completo", usado em todas as médias.** O Cronometer separa All, Non-Empty e Complete e tem "Include Today". O NutriBot já tropeçou nisso (média de 7 dias com o café de hoje, corrigida em 09/10). Proposta: dia completo = o bot perguntou à noite e a pessoa confirmou, ou houve janta mais lanche registrados. Médias, calibração registro × balança e o veredito de ritmo usam **só dias completos**, e a mensagem diz quantos foram ("média de 5 dias completos").

4. **Perguntar pela gordura e pelo molho que não aparecem na foto.** É o "Do you also have…?". Depois de cada foto de prato quente, uma pergunta curta e opcional ("foi com óleo/manteiga? quanto, 1 colher?") resolve o viés mais comum da foto. Também vale usar o **horário EXIF da foto** como horário da refeição quando ela é enviada depois.

5. **Gasto do relógio: substituir a estimativa, não somar, e mostrar a conta.** Adotar a regra da basal distribuída em 16 h, substituída progressivamente pela atividade do Health Connect e descontada pelo tempo de exercício, com o "piso" para horas sem relógio. E ter um comando ou trecho "como cheguei na meta de hoje" no formato do *Show Breakdown*: `BMR 1.650 + atividade 410 + treino 300 − consumido 1.900 = faltam 460`.

6. **Copiar do Cronometer Pro o modelo de acompanhamento de 3 pessoas.** Por pessoa: perfil "interno" (o operador registra) ou "compartilhado", **trava de metas** (a pessoa não muda a meta sem o operador), opção de **ocultar números** (kcal e macros) para quem não deve vê-los, mantendo o registro, exportação CSV por pessoa e relatório do período para levar ao nutricionista. Compartilhamento entre pessoas só de **receitas e alimentos**, nunca do diário, a menos que haja consentimento explícito.

7. **Densidade no WhatsApp: um topo fixo de até 8 destaques, o resto sob demanda.** O !hoje traz sempre, na mesma ordem: energia (consumido / meta / saldo), macros e até 8 nutrientes escolhidos por pessoa, com status em texto (abaixo / ok / acima do máximo) e não só por cor. "Detalhar ferro" responde com os **top 3 alimentos que contribuíram**, como o toque na barra. Nutriente sem meta aparece como "sem meta" e nunca recebe uma meta inventada.

**Onde o NutriBot já está à frente e deve manter:** tendência de peso com IC, veredito de ritmo e calibração entre consumo registrado e balança, que o Cronometer não tem. A base TACO e o idioma pt-BR também, num segmento em que as reviews BR pedem exatamente isso.

---

## 8) Não verificado / limitações
- **Tipografia, paleta exata, ícones da barra inferior e ordem das abas:** não verificados (capturas não legíveis via texto).
- **Acessibilidade com leitor de tela e contraste:** não verificada.
- **Acurácia da foto e da voz e modelo de IA** (foto, voz, Crono Coach): não publicados. O press release fala em "verified", a central só diz "always check".
- **Janela e método do "Show Trend"** (rolling average): não documentados.
- **Conversão de ritmo de peso em kcal/dia e % do TEF:** não documentadas.
- **TDEE adaptativo pela balança:** não encontrado (aparentemente inexistente).
- **Preço em R$ na Play Brasil e aceitação de cartão brasileiro hoje:** não verificados.
- **Nota da Google Play:** não extraída com segurança. A nota iOS (4,8, ~99 mil) vem da App Store dos EUA.
- **Quantidade de nutrientes:** a fonte oficial é inconsistente (84 / 92 / 95). Usei "até 92" das notas de versão de fev/2026.
- **Fórum da comunidade:** citado apenas a partir de resumos de busca, sem ler cada tópico. Tratar como sinal.
- **Barcode grátis:** confirmado pelo site e pela Play. Um review de terceiro afirmando o contrário está desatualizado.
- Não testei o app instalado. Tudo aqui vem de documentação, lojas e reviews.

## 9) Fontes
Oficiais (central de ajuda: lidas em 13/10/2026 pela API `support.cronometer.com/api/v2/help_center/en-us/articles/{id}.json`):
- Data Sources: https://support.cronometer.com/hc/en-us/articles/360018239472
- Data Confidence Scores: https://support.cronometer.com/hc/en-us/articles/360042550452
- How are Nutrition Scores calculated?: https://support.cronometer.com/hc/en-us/articles/44414065586836
- Mobile - Photo-Logging: https://support.cronometer.com/hc/en-us/articles/39013533811092
- Mobile - Voice Logging: https://support.cronometer.com/hc/en-us/articles/47549391461780
- Mobile - Crono Coach: https://support.cronometer.com/hc/en-us/articles/49995994334100
- Mobile - Daily Report: https://support.cronometer.com/hc/en-us/articles/32689033683220
- Nutrient Targets Summary: https://support.cronometer.com/hc/en-us/articles/360018069532
- Nutrient Targets: https://support.cronometer.com/hc/en-us/articles/360060170532
- Mobile - Edit Nutrient Targets: https://support.cronometer.com/hc/en-us/articles/360020571571
- Are there nutrients missing from Cronometer?: https://support.cronometer.com/hc/en-us/articles/360000329986
- Nutrient Balances: https://support.cronometer.com/hc/en-us/articles/360018348631
- Energy Expenditure: https://support.cronometer.com/hc/en-us/articles/31974307318420
- Mobile - Energy Summary: https://support.cronometer.com/hc/en-us/articles/30300963266452
- Energy Target: https://support.cronometer.com/hc/en-us/articles/31975503009044
- Mobile - Macro & Energy Targets: https://support.cronometer.com/hc/en-us/articles/33113157685652
- Targets + Profile: https://support.cronometer.com/hc/en-us/articles/31308427612180
- Mobile - Weight Goal: https://support.cronometer.com/hc/en-us/articles/32978027080980
- Health Connect: https://support.cronometer.com/hc/en-us/articles/22731903751316
- Subscription Types: https://support.cronometer.com/hc/en-us/articles/360028026971
- Mobile - Diary Overview: https://support.cronometer.com/hc/en-us/articles/360018593112
- Mobile - Display: https://support.cronometer.com/hc/en-us/articles/360020863072
- Mobile - Add a Food: https://support.cronometer.com/hc/en-us/articles/360018955211
- Search Food: https://support.cronometer.com/hc/en-us/articles/360018239512
- Mobile - Scan Food: https://support.cronometer.com/hc/en-us/articles/360020441392
- Publishing a food to the CRDB: https://support.cronometer.com/hc/en-us/articles/360018652672
- Charts: https://support.cronometer.com/hc/en-us/articles/360018298812
- Charts - Custom Charts: https://support.cronometer.com/hc/en-us/articles/360029499271
- Trends Overview: https://support.cronometer.com/hc/en-us/articles/360018298272
- Nutrition Report: https://support.cronometer.com/hc/en-us/articles/360018569691
- Mobile - Nutrition Report: https://support.cronometer.com/hc/en-us/articles/360019864891
- Dashboard: https://support.cronometer.com/hc/en-us/articles/10570212821268
- Streaks: https://support.cronometer.com/hc/en-us/articles/16510105155988
- Mobile - Fasting: https://support.cronometer.com/hc/en-us/articles/360036016612
- Oracle Food Suggestions: https://support.cronometer.com/hc/en-us/articles/360018348471
- Ask The Oracle: https://support.cronometer.com/hc/en-us/articles/360018510531
- Mobile - Quick Start Guide: https://support.cronometer.com/hc/en-us/articles/360021677792
- Account Settings (export): https://support.cronometer.com/hc/en-us/articles/360018760151
- Sharing: https://support.cronometer.com/hc/en-us/articles/360018867471
- Pro - Client Tab: https://support.cronometer.com/hc/en-us/articles/360018673051
- Pro - Client Settings Menu: https://support.cronometer.com/hc/en-us/articles/360024707231

Site, blog e lojas:
- https://cronometer.com/
- https://cronometer.com/gold/ (preços, 13/10/2026)
- https://cronometer.com/pro/ (preço Pro, 13/10/2026)
- https://cronometer.com/features/sync-devices.html
- https://cronometer.com/blog/cronometer-updates-whats-new-improved/ (notas de versão 2025–2026)
- https://cronometer.com/blog/nutrition-scores/
- https://cronometer.com/blog/nutrition-101-using-cronometer
- https://cronometer.com/blog/photo-logging/ (via resumo de busca)
- https://cronometer.com/blog/health-connect/ (via resumo de busca)
- https://www.prnewswire.com/news-releases/cronometer-launches-premium-photo-logging-fast-verified-nutrition-tracking-for-real-life-302549752.html (via resumo de busca)
- Google Play pt-BR: https://play.google.com/store/apps/details?id=com.cronometer.android.gold&hl=pt_BR&gl=BR (descrição, reviews BR)
- Google Play en-US: https://play.google.com/store/apps/details?id=com.cronometer.android.gold&hl=en_US&gl=US (reviews US)
- App Store EUA: https://apps.apple.com/us/app/cronometer-calorie-counter/id1145935738 (preços IAP, notas de versão, 4.58.3 pt-BR)

Complementares (sinal fraco, conflitos de preço entre si):
- https://forums.cronometer.com/discussion/7095/weigh-the-data-confidence-score-by-food-mass-not-entry-count
- https://forums.cronometer.com/discussion/3530/view-weight-trends-with-smoothing-averages
- https://forums.cronometer.com/discussion/2852/fixed-protein-dynamic-carbs-fats-and-calories
- https://independent-app-reviews.org/reviews/cronometer-review/
- https://www.bentobunny.app/reviews/cronometer-review
- https://unstar.app/app/1145935738?platform=ios&country=us
