> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# B4 — Desrotulando: análise de concorrente (UX/UI, funcionalidades, dados e metodologia)

Pesquisa feita em 13/10/2026. As fontes são as páginas das lojas, a central de ajuda oficial (ajuda.desrotulando.com), os termos de uso e a política de privacidade, um artigo científico de 2024/2026, uma tese de 2025 e a imprensa de 2017 a 2023. Não instalei nem usei o app: tudo o que descrevo sobre interface vem de texto publicado. O que não consegui confirmar está marcado como **não verificado**.

---

## 1) Ficha

| Campo | Dado | Fonte |
|---|---|---|
| Produto | Desrotulando: app de "Food Score" para alimentos industrializados vendidos no Brasil | Google Play (13/10/2026) |
| Empresa no Brasil | **Desrotulando Ltda.**, CNPJ 39.993.634/0001-28, Porto Alegre/RS | Termos de uso (atualizados em 18/04/2026) |
| Controlador dos dados / publicador no iOS | **FoodRead Inc.**, Ottawa, Canadá | Política de privacidade (18/04/2026); App Store |
| Fundadores | Gustavo Haertel Grehs (computação) e Carolina Grehs (nutricionista). Começaram com o blog "Fechando o Zíper" (2012), viraram site de avaliação de rótulos (2013–2015) e lançaram o app em 2016 | Central de ajuda; Projeto Draft (2018); Forbes (2019) |
| Equipe | LinkedIn: 11 a 50 funcionários (13 com perfil vinculado), fundada em 2016. A central de ajuda cita nutrição, engenharia de alimentos, tecnologia, produto, ciência de dados e "cadastro/curadoria". Havia vagas de estágio em cadastro de produtos cerca de 6 meses antes da consulta | LinkedIn; central de ajuda |
| Plataformas | Android (Google Play, `com.desrotulando.app`, publicado em 12/04/2016) e iOS (id1071285904, iOS 16 ou superior) | Lojas |
| Google Play (13/10/2026) | Nota **4,6** com **68,5 mil** avaliações. **1 mi+** downloads. Atualizado em 29/09/2026. Compras no app de **R$ 1,99 a R$ 107,90 por item** | Página da Play baixada em 13/10/2026 |
| App Store | Nota **4,8** com **50 mil** classificações. Versão 3.9.116 (30/set) | App Store |
| Tamanho declarado | Base com "mais de 60 mil alimentos avaliados". Usuários: "mais de 5 milhões de pessoas" (Play, 2026), "mais de 4 milhões" (site/App Store), "mais de 3 milhões" (artigo SciELO), "mais de 2 milhões" (central de ajuda e LinkedIn) | Ver seção 4 sobre as divergências |
| Modelo | Freemium. Desde 30/09/2026 o scanner é **ilimitado e grátis**, e **alternativas e busca por nome, marca ou categoria ficam só no Premium** | Notas de versão (Play e App Store) |
| Preço (data) | **R$ 89,90/ano** via PIX, pagamento único válido por 1 ano (artigo da central de 01/09/2025). Na App Store, sem dizer a que período cada valor corresponde: Plano Mensal R$ 14,90; Plano Anual R$ 34,90 e R$ 89,90; "Clube" de R$ 11,90 a R$ 59,90 (consulta em 13/10/2026). Preços antigos: R$ 4,99 a 6,50/mês (2018); R$ 9,90/mês ou R$ 82,90/ano (2020–2021); "pague o quanto achar justo" de R$ 24,90 a 34,90/ano no "Clube" (2023) | Central de ajuda; App Store; Draft; Mobile Time; GKPB |
| Canais B2B/B2B2C | **Wellhub**: plano Starter ou superior dá Premium grátis (artigo de 13/03/2026). Importação em lote para **fabricantes** por planilha e fotos com nome igual ao EAN (artigo de 08/02/2024). Carrier billing com a Syntonic (anúncio de 2020). **Não encontrei API pública** | Central de ajuda; Mobile Time |

---

## 2) UX/UI

O que está documentado:

**Navegação e telas**
- **Barra inferior** com o botão **"SCAN"** e uma aba **"Busca"**. A busca aceita nome ou número do código de barras. Fontes: central de ajuda (2026), TechTudo (07/2023), GKPB (01/2023).
- **Perfil**: em "Salvos" ficam as listas, e em "minhas preferências" ficam restrições e assinatura. Fontes: TechTudo 2023, GKPB 2023, central de ajuda.
- **Scanner**: quadro **verde** com **linha vermelha** no meio. O artigo de suporte pede para centralizar o código e esperar alguns segundos. Fonte: artigo "A câmera não lê o código de barras" (2022).
- **Tela do produto** (reformulada no início de 2026, segundo o artigo "O Desrotulando evoluiu"):
  - Cabeçalho com nome, foto e **nota**. Um ícone de **bandeira** salva o produto numa lista (TechTudo 2023). Um ícone 📄 perto da foto leva a **"Atualizar rótulo do produto"** (central, 2024).
  - **Pontos positivos e negativos** organizados em **três pilares**: Processamento, Nutrientes e Aditivos. Cada aditivo da lista de ingredientes tem uma classificação própria.
  - Bloco **"O que combina com você?"** com um **percentual de "match"** entre o produto e o objetivo do usuário (emagrecimento, controle de pressão). O app avisa explicitamente que **a nota e o match são coisas separadas**.
  - Em "informações do produto", no canto superior direito, ficam a **lista de ingredientes e a tabela nutricional originais** (central, 2022).
  - Rolando a tela aparecem a classificação NOVA, favoritos, compartilhamento e "alternativas" (Canaltech, 2021).
- **Onboarding**: login por e-mail e senha, Google ou Facebook. Depois vêm **duas perguntas**: rotina alimentar atual e objetivo (refeições mais saudáveis, emagrecimento, controle de saúde, apoio a exercícios). Fontes: TechTudo 2023, GKPB 2023. O artigo SciELO mostra que essa "motivação declarada no cadastro" vira dado analítico: 42,4% saúde geral, 37,2% controle de peso, 8,5% esporte.

**Como a nota aparece**
- Nota de **1 a 100**, que **anda de 5 em 5** desde 2026, com **escala de cores**. O artigo SciELO dá as faixas: **vermelho 1–29, laranja 30–49, amarelo 50–69, verde-claro 70–89, verde-escuro 90–100**.
- A comunicação evita tom de proibição: verde "não significa consumo ilimitado" e vermelho "não significa proibição, pede atenção à frequência e quantidade" (artigo "Como usar no dia a dia", 02/2026).
- O mesmo produto pode ter notas diferentes quando a fórmula mudou sem mudar a embalagem. O app explica isso e manda o usuário comparar ingredientes e tabela (central, 2022).

**Alertas de ingredientes**
- O usuário escolhe alergias, intolerâncias e ingredientes a evitar no perfil, e o produto mostra um alerta quando bate. Em 2019 eram **16 categorias de restrição**, entre elas glúten, leite, soja, amendoim, açúcar, gordura trans e corantes (Showmetech).
- Indicadores nomeados depois da revisão de 25/05/2026: "Naturalmente denso em gorduras saturadas", "Minimamente processado alto em gordura saturada", "Mais de um nutriente de atenção em excesso", "Água de coco reconstituída" e "Contém fibras isoladas".
- Aditivos de **"precaução"** com lista pública. Exemplos: tartrazina, amarelo crepúsculo, vermelho 40, caramelo III/IV, dióxido de titânio, acessulfame-K, sacarina, ciclamato, aspartame, glutamato monossódico, nitrito e nitrato, TBHQ, BHA, BHT, EDTA.

**Listas**: despensa, lista de compras, desejos e favoritos, que podem ser compartilhadas. Em 2023 eram "Compras", "Desejos" e "Favoritos".

**Feedback e retorno**: quando um produto enviado é aprovado, o usuário recebe **e-mail e push** (central, 2024).

**O que deixa a leitura fácil para um leigo** (pelo que a documentação mostra):
1. Um único número com cor dá a resposta em segundos.
2. A justificativa vem em frases curtas de positivo e negativo, agrupadas em 3 pilares, sem obrigar a ler a tabela.
3. A nota (qualidade do alimento) fica separada do match (adequação à pessoa), o que evita que "bom pra mim" e "bom em geral" se confundam.
4. A linguagem é de frequência e quantidade, não de proibição.
5. A troca é feita dentro da mesma categoria: "biscoito A × biscoito B".

**Não verificado**: tipografia, paleta exata (hex), iconografia além da bandeira e do 📄, densidade das telas, modo escuro, acessibilidade (leitor de tela, contraste, tamanho de fonte), layout da comparação lado a lado, ordem exata das abas da barra inferior em 2026. As capturas das lojas não puderam ser lidas como texto.

---

## 3) Funcionalidades

| Recurso | Como funciona | Evidência (fonte) | Problema que resolve | Relevância para o NutriBot e por quê |
|---|---|---|---|---|
| Scanner EAN | Câmera lê o EAN e busca na base própria. Grátis e ilimitado desde 30/09/2026. Já houve limites de 3 por dia e 90 por mês | Notas de versão Play e App Store; avaliação na Play de 15/09/2026 | Decidir no corredor do mercado | **Alta.** O `despensa.js` já guarda `ean` (8 ou 12–14 dígitos) do cupom e consulta o Open Food Facts (`off.js`). O EAN é a chave que liga cupom, rótulo e nota. O NutriBot não precisa de câmera, porque o código chega pelo cupom ou pela foto |
| Busca por nome, marca ou categoria | Aba Busca e navegação por categorias. Hoje é **Premium** | Descrição da Play (2026) | Achar um produto sem tê-lo na mão | **Média.** O NFC-e traz descrições abreviadas ("BISC RECH CHOC 140G"). Buscar por nome é justamente onde o NutriBot erra (o comentário no código fala em "Aceite girasol" para refrigerante). A lição é exigir **casamento forte** antes de aceitar |
| Food Score de 1 a 100 | Três pilares (Processamento, Nutrientes, Aditivos) com pesos por critério, passos de 5 e 5 cores | Central: "Como os produtos são avaliados" (10/02/2026) e "Critérios de cada pilar" (16/05/2026); SciELO | Resumir o rótulo num número | **Média e alta.** Dá para usar como **indicador de qualidade da despensa** (ex.: "52% do que entrou esta semana é ultraprocessado"). Isso complementa kcal e macros sem competir com eles. A nota proprietária não se copia, mas os critérios públicos (NOVA, limites da RDC 429/IN 75) dão para reproduzir |
| Pontos positivos e negativos | Frases curtas por pilar e classificação de cada aditivo | Central (2026); TechTudo (2023) | Explicar o porquê da nota | **Alta.** O bot fala em texto. "Alto em açúcar adicionado; tem aromatizante; fonte de fibra" cabe numa mensagem de WhatsApp melhor que um número |
| Match por objetivo | Percentual separado da nota. Emagrecimento olha calorias, açúcar adicionado, gordura saturada e trans (negativos) e fibras e proteína (positivos). Controle de pressão dá mais peso ao sódio (base: DASH e limites latino-americanos). Os pesos não são publicados | Central: 3 artigos de 06/02/2026 | Um mesmo produto serve para uma pessoa e não para outra | **Alta.** O NutriBot atende **3 pessoas com metas diferentes**. Separar "qualidade do alimento" de "encaixa na meta de fulano" é o desenho certo e evita uma nota única que confunde quem quer ganhar e quem quer perder peso |
| Alertas por restrição | O perfil marca alergias e ingredientes a evitar, e o produto mostra alerta | Central; Sustentarea (2020); Showmetech (2019) | Alergias e escolhas (vegano, sem lactose) | **Média.** Para a despensa vale um alerta passivo na entrada do cupom ("comprou X, que tem lactose") se algum perfil tiver restrição. Hoje não há sinal de que os 3 perfis tenham |
| Alternativas e trocas | "Melhores da categoria", hoje só no Premium | Descrição da Play; TechTudo; artigo "dia a dia" (2026) | Trocar sem sair da categoria | **Média.** Fazer trocas a partir do **histórico real de compras** (a despensa) é mais útil do que um catálogo: "você compra o biscoito X toda semana; o Y da mesma prateleira tem metade do açúcar". Exige base com nota por categoria |
| Listas (despensa, compras, desejos, favoritos) | Salvar produtos e compartilhar | Central (02/2026) | Planejar compras | **Baixa a média.** O NutriBot já monta a despensa sozinho a partir do cupom, o que é uma vantagem: ninguém precisa escanear em casa. A "despensa" deles é uma lista manual |
| Cadastro colaborativo | 4 fotos (código de barras, frente, ingredientes, tabela), com recorte da lista de ingredientes. A equipe revisa **cada item**. Prazo: cerca de 30 dias para produtos muito pedidos, cerca de 15 para atualização, sem prazo para os pouco pedidos. A fila é por número de pedidos. Avisa por e-mail e push | Central (2023, 2024); notas de versão do iOS: a IA reconhece ingredientes e nutrientes da embalagem (data não verificada) | Cobrir produtos regionais e novos | **Alta.** Mostra o custo de manter uma base própria. Para 3 pessoas, a saída é: foto do rótulo no WhatsApp, leitura por IA, **cache local por EAN**, e conferência só quando o número for implausível |
| Atualizar rótulo | Ícone 📄 e "Atualizar rótulo do produto". Motivo: o fabricante muda a fórmula sem mudar a embalagem, e a RDC 429 aumentou as trocas | Central (18/11/2024) | Dado desatualizado | **Alta.** Um cache por EAN no NutriBot também envelhece. Precisa de data e fonte em cada registro e de uma forma de o usuário corrigir ("essa tabela tá errada") |
| Importação por fabricante | Planilha-modelo (rotulagem nova e antiga), ZIP com fotos nomeadas pelo EAN, e-mail com CPF e cargo. Remoção de descontinuados por lista de EANs | Central (08/02/2024); Termos | Base atualizada na fonte | **Baixa** para o NutriBot. Mostra só que o EAN é a chave universal da cadeia |
| Categorias não avaliadas | Sal, açúcar, adoçante, óleo, azeite, banha, fermento, mel, papinhas, kombucha, fórmulas infantis, suplementos, essências, ovos, água, alcoólicos, granel | Central (20/03/2026) | Evitar nota sem critério | **Alta.** Os itens que mais aparecem no cupom de uma família (ovos, óleo, açúcar, granel, hortifrúti) **ficam de fora** do Desrotulando. É aí que entra a **TACO** que o NutriBot já usa. O cupom precisa de dois caminhos: in natura e granel pela TACO, embalado pelo EAN |
| Wellhub | Premium grátis para quem tem Starter ou superior | Central (13/03/2026) | Distribuição B2B2C | Fora de escopo (uso pessoal) |
| Diário alimentar / calorias | **Não tem.** Não encontrei diário, porções nem soma de kcal no dia. O que existe é ver kcal na tabela e o critério "calorias" no match de Emagrecimento | Ausente da descrição da Play, da central e da imprensa | n/a | **Diferencial do NutriBot.** O Desrotulando avalia o produto na prateleira. O NutriBot mede o que foi comido, o peso e o relógio. Os dois se completam |
| Integração com mercado ou NFC-e | **Não existe.** Em 2020 estudavam "leitura de QR code de notas fiscais" ("teremos um big data de consumo de alimentos") e preço e local de venda. Não achei sinal de que lançaram | Mobile Time (26/02/2020) | Ligar compra e saúde | **Muito alta.** O NutriBot **já faz** o que o Desrotulando só planejou: ler o cupom. Isso abre um espaço que o concorrente não ocupa: qualidade **do carrinho real** ao longo do tempo |

---

## 4) Dados e metodologia

**De onde vêm os dados**
- O rótulo físico é fotografado por usuários (4 fotos) ou enviado em lote por fabricantes (planilha e fotos). A equipe técnica valida cada item (central; SciELO: "entradas dos usuários validadas pela equipe técnica").
- Os termos dizem que a empresa **não faz análise laboratorial**, **não se considera fonte primária** e **não responde pela exatidão** dos dados. A base é tratada como propriedade intelectual e o **algoritmo como segredo empresarial, sem auditoria de terceiros**. Os termos também admitem **publicidade paga** "com separação entre análise técnica e comercial". Em 2018 os sócios diziam não usar patrocínio nem publicidade.
- Um produto só é aceito com rótulo em português e seguindo a legislação brasileira. Produtos in natura, sem registro sanitário ou de mercado restrito podem ser recusados.

**Evolução da base declarada**: 20 mil itens e 266 mil na fila (2019) → 22 mil (2020) → 45 mil (2021) → mais de 55 mil (artigo SciELO, dados de 2016 a 2023; a Discussão do mesmo artigo fala em mais de 37 mil "tipos") → mais de 60 mil (2026). Em 2023 entravam "mais de 100 por dia" (Consumidor Moderno, via busca, texto completo não lido). Os números de usuários (2, 3, 4 ou 5 milhões) são **autodeclarados e inconsistentes**. O único número público com recorte de período é o do artigo SciELO: **116.594 cadastros** e **1.286.114 escaneamentos** entre set/2022 e jan/2023.

**Metodologia da nota (publicada como princípio, sem fórmula)**
- **Processamento**: NOVA, do Guia Alimentar de 2014. Aditivos pesam conforme a função: baixo impacto para conservação e estabilidade, médio para textura e sabor que reforçam o ingrediente real, alto para sabor ou cor que **substituem** o alimento. Também contam o "efeito coquetel" de muitos aditivos, ingredientes compostos que não declaram composição, regras por categoria e o selo **Orgânico Brasil** (positivo).
- **Nutrientes**: sódio, açúcar adicionado e gordura saturada pelos **limites de "alto em" da RDC 429/2020 e IN 75/2020**, com tabelas de limiares para sólidos e líquidos. A gordura trans é penalizada quando há gordura modificada nos ingredientes e o valor na tabela é maior que 0 g. Fibra e proteína somam como "fonte" ou "alto teor" pelo %VD. A "régua" foi recalibrada em 25/05/2026 para não tratar castanha e cacau como ultraprocessado gorduroso.
- **Aditivos**: classes sem risco (nutricional), baixo, moderado, desconhecido, não especificado (sem nome técnico ou INS) e **precaução** (princípio da precaução da UE, Reg. CE 178/2002; alertas de FDA, EFSA e ANVISA). O app avisa que todos os aditivos à venda são aprovados no Brasil e que a ideia não é alarmar.
- **Referências declaradas** (artigo de 03/2023): Guia Alimentar 2014; RDC 429/2020; IN 75/2020; RDC 632/2022 (trans); RDC 26/2015 (alergênicos); RDC 54/2012 (informação complementar); manual chileno de rotulagem (2019); OMS (trans, 2018); Monteiro et al. (2018/2019); Davidou et al. (2020, classificação Siga); Lawrence & Baker (BMJ 2019); Diretriz SBC de gorduras (2013).
- **O que não se sabe**: pesos, fórmula, como os pilares se combinam e o limiar exato de cada cor. Os pesos do match também não são públicos.

**Alinhamento com ANVISA e NOVA**: o critério de nutrientes **usa os mesmos limiares da lupa frontal** (RDC 429/IN 75). Logo, todo produto com lupa "alto em" é penalizado no pilar Nutrientes. Mas a nota **não é** a lupa: acrescenta NOVA, aditivos, fibra e proteína. A fundadora defendia em 2019 o modelo chileno de advertências.

**Validação externa**
- Artigo em *Ciência & Saúde Coletiva* (UFMG, publicado em 19/12/2024, edição de março de 2026): é **descritivo**, sem validação da nota contra desfecho. Encontrou 52,4% de ultraprocessados entre os escaneados e 44,2% deles no vermelho.
- Tese de doutorado da UFLA (08/2025, entrevistas): o app **reduziu a saudabilidade percebida e a intenção de compra de forma mais consistente que a lupa**, sobretudo contra o efeito halo de termos como "integral". Os autores são independentes da empresa, mas a amostra é qualitativa.

**Dados incompletos ou desatualizados**: sem prazo para produtos pouco pedidos. Atualização de rótulo em cerca de 15 dias. O mesmo produto pode ter duas notas quando a fórmula muda. Pedido de exclusão é recusado salvo se o produto saiu do mercado. Mudar a nota exige dado técnico.

---

## 5) Pontos fortes

1. **Metodologia explicada em linguagem simples e com as normas citadas** (RDC 429, IN 75, NOVA, lista de aditivos de precaução nomeada). Para um app de nota proprietária, é bastante transparente.
2. **Nota separada do match**. É o desenho conceitual mais aproveitável.
3. **Tom sem terrorismo** ("vermelho não é proibido"), coerente com o Guia Alimentar.
4. **Curadoria humana** em cada produto, com fila por demanda e aviso ao usuário. Isso dá credibilidade e foi o que fez o app "virar referência" (viral em 2019, 1º lugar na App Store).
5. **Base brasileira grande** (mais de 60 mil EANs), com regras por categoria e revisão contínua (25/05/2026).
6. **Evidência acadêmica independente de efeito sobre a percepção** (UFLA 2025) e uso em pesquisa (SciELO).

---

## 6) Pontos fracos e reclamações recorrentes

| Problema | Evidência |
|---|---|
| **O grátis muda toda hora e virou o atrito principal** (2018 grátis amplo → 2023 "pague quanto achar justo" → limite de 3 por dia / 90 por mês → 30/09/2026 scan ilimitado, mas busca e alternativas pagas) | Avaliações na Play de 15/07, 11/09 e 15/09/2026 ("impossível usar normalmente sem ter uma inscrição"; "o valor que era opcional... agora está bastante alto"; "premium muito caro para um plano anual"); App Store, 26/01/2023 (nutricionista que deixou de indicar o app a pacientes); Reclame Aqui ("se diz gratuito, mas para consultar qualquer produto tem que pagar", via resultado de busca; página bloqueada com 403) |
| Preços confusos | A App Store lista 10 itens (Mensal R$ 14,90; Anual R$ 34,90 e R$ 89,90; "Clube" de R$ 11,90 a 59,90) sem dizer a periodicidade; o PIX é R$ 89,90/ano |
| Bugs e login | TechTudo (ficha sem data): "muitos bugs e erros em funções básicas", app "em reformulação", Performance 7/10. Reclame Aqui: login depois de atualização, cobrança duplicada, exclusão de conta (títulos via busca). App Store em 2018–2019: lentidão, câmera, pedido de e-mail a cada abertura |
| Cobertura | Produto regional ausente e fila de cerca de 30 dias ou sem prazo. **Categorias básicas não avaliadas** (óleo, açúcar, ovos, granel). Há pedidos para incluir óleo de soja (Reclame Aqui, via busca) |
| Opacidade da fórmula | Algoritmo sem auditoria (Termos). Pesos não publicados |
| Números de alcance inconsistentes | 2, 3, 4 ou 5 milhões de usuários em fontes oficiais diferentes; o próprio artigo SciELO traz 55 mil e 37 mil no mesmo texto |
| Higiene do site | A landing page desrotulando.com tinha, na consulta de 13/10/2026, **meta description com spam de cassino** ("1xbit", "playjonny casino"), sinal de site comprometido ou mal mantido. A página "Premium Vitalício" aparece no índice de busca, mas devolveu 404 |
| Reclame Aqui (jul/2025–jun/2026) | 10 reclamações avaliadas, nota do consumidor 4,3 e 70% resolvidas (via resultado de busca; não consegui abrir a página) |

---

## 7) Lições concretas para o NutriBot

1. **O EAN como chave e um cache próprio com data e fonte.** A despensa já extrai `ean` do cupom (`despensa.js:209`) e consulta o OFF (`despensa.js:224`). Proposta: guardar por EAN um registro `{tabela, ingredientes, fonte: OFF|foto-rotulo|IA, data, conferido}`. Quando o OFF não tiver o produto, pedir **uma foto do rótulo pelo WhatsApp** e ler com IA (é o caminho que o Desrotulando adotou com "IA reconhece ingredientes e nutrientes"). Assim o produto não volta a ser buscado a cada cupom. Como o Desrotulando, incluir "tá errado" para atualizar o rótulo, já que fórmulas mudam sem mudar a embalagem.

2. **Dois caminhos no cupom, como manda a lista de exclusões deles.** Itens que o Desrotulando nem avalia (ovos, óleo, açúcar, granel, hortifrúti) vão para a **TACO**. Embalados com EAN vão para tabela e rótulo. O código já segue essa direção (`inNatura → TACO`). Falta deixar a regra explícita para óleo, açúcar, sal e granel e **nunca buscar por nome no OFF** nesses casos.

3. **Separar "qualidade do produto" de "encaixa na meta da pessoa".** Com 3 pessoas monitoradas e metas diferentes (ganho × perda), não dar uma nota única. Mostrar (a) indicadores objetivos do rótulo, iguais para todos: lupa "alto em" pelos limiares da RDC 429/IN 75 e NOVA pela lista de ingredientes; (b) a leitura por pessoa: "pra tua meta de ganho isso ajuda pelas kcal e proteína; o ponto de atenção é o açúcar adicionado".

4. **Não criar um "score 0–100" próprio. Usar critérios públicos e reproduzíveis.** A nota deles é segredo comercial, sem auditoria, e muda de régua (25/05/2026). Para um bot que já confere os próprios números (progresso.js), o certo é mostrar fatos verificáveis: "alto em açúcar adicionado (≥15 g/100 g)", "ultraprocessado: tem aromatizante e emulsificante", "fonte de fibra". O texto de "precaução" de aditivos pode servir de referência, com a ressalva que eles mesmos fazem ("todos aprovados, não é alarme").

5. **Ocupar o espaço que eles só planejaram: a qualidade do carrinho real.** Em 2020 o Desrotulando queria ler QR de nota fiscal e não lançou. O NutriBot já lê. Exemplo de relatório semanal ou mensal da despensa: "% das kcal compradas que são ultraprocessadas", "itens com lupa 'alto em' que mais se repetem" e **trocas na mesma categoria a partir do que a pessoa compra de fato** (não de um catálogo).

6. **Tom das mensagens.** Copiar o "vermelho não é proibido, é frequência e quantidade" e as frases curtas de positivo e negativo. Isso combina com a regra do NutriBot de nunca mandar comer mais quem está acima do ritmo: o texto de rótulo também não deve moralizar.

7. **Não depender de paywall nem de limite de uso.** A queixa nº 1 dos usuários é a mudança das regras do grátis. Para um bot pessoal isso não se aplica, mas vale o princípio: **o recurso central (ler o que entrou na despensa) não pode ter limite que a pessoa sinta**. Se houver custo de IA por foto de rótulo, o cache por EAN (lição 1) é o que mantém esse custo baixo.

---

## 8) Não verificado e limitações

- **Não instalei o app.** A interface vem de texto (central de ajuda, imprensa, lojas). Tipografia, paleta, iconografia, densidade, acessibilidade e o layout da comparação lado a lado **não foram verificados**.
- **Fórmula da nota e pesos do match**: não publicados (proprietários). Descrevi só os princípios.
- **Correspondência entre preços e planos** na App Store: não verificada. O preço confirmado com data é R$ 89,90/ano via PIX (01/09/2025). O resto é lista de compras no app sem rótulo de periodicidade.
- **Onde fica hoje o filtro de restrições e alertas (grátis ou Premium)**: não verificado. Em 2018–2020 era Premium; a Wellhub cita "filtros avançados" como Premium.
- **Data de lançamento do cadastro com IA**: aparece nas notas de versão do iOS (resumo de busca), sem data.
- **Reclame Aqui** e **Projeto Draft/TecMundo/Tecnoblog/Revista Oeste**: as páginas bloquearam o acesso (403) ou redirecionaram. Os dados do Reclame Aqui vêm de resultados de busca.
- **Lista de compras integrada a supermercado, preços e e-commerce**: não encontrei. Leitura de NFC-e: só a intenção de 2020.
- **API ou licença de dados**: não encontrei. Os termos tratam a base como propriedade exclusiva.
- **Quantidade de produtos com a rotulagem nova (RDC 429) × antiga na base**: não verificado. Existem dois modelos de planilha, o que indica que convivem.
- Os números de usuários são autodeclarados e se contradizem (ver seção 4).

---

## 9) Fontes

Oficiais
- https://www.desrotulando.com/ (landing; metadados com spam, consulta de 13/10/2026)
- https://www.desrotulando.com/termos-de-uso/ (18/04/2026)
- https://www.desrotulando.com/politica-de-privacidade/ (18/04/2026)
- https://play.google.com/store/apps/details?id=com.desrotulando.app (baixada em 13/10/2026: nota 4,6, 68,5 mil avaliações, 1 mi+, atualizado em 29/09/2026, avaliações de 15/07, 11/09 e 15/09/2026)
- https://apps.apple.com/br/app/desrotulando/id1071285904
- https://www.linkedin.com/company/desrotulando
- Central de ajuda (https://ajuda.desrotulando.com/pt-BR/):
  - /articles/6304289-como-os-produtos-sao-avaliados
  - /articles/6304657-quais-sao-os-criterios-de-avaliacao
  - /articles/7897460-entenda-a-nossa-avaliacao-de-aditivos
  - /articles/6304576-por-que-alguns-aditivos-sao-classificados-como-precaucao
  - /articles/6300219-quais-as-referencias-que-utilizamos
  - /articles/7897441-como-usar-o-desrotulando-no-seu-dia-a-dia
  - /articles/6301226-como-usar-o-desrotulando-para-escolher-produtos-mais-saudaveis
  - /articles/6301097-o-que-e-o-desrotulando
  - /articles/6304160-como-surgiu-a-ideia-do-aplicativo
  - /articles/13644301-05-02-26-o-desrotulando-evoluiu-confira-as-novidades-no-seu-app
  - /articles/15249943-25-05-26-atualizacao-de-criterios
  - /articles/13644368-entenda-o-percentual-alinhado-aos-seus-objetivos
  - /articles/13644374-entenda-o-objetivo-controle-de-pressao-e-seus-criterios-no-app
  - /articles/13644380-entenda-o-objetivo-emagrecimento-e-seus-criterios-no-app
  - /articles/6304370-posso-enviar-um-produto-para-avaliacao-como-faco-isso
  - /articles/6303553-quanto-tempo-demora-para-que-o-produto-enviado-para-avaliacao-apareca-no-aplicativo
  - /articles/6304469-a-composicao-de-um-produto-no-aplicativo-esta-diferente-do-rotulo-que-estou-em-maos-e-possivel-atualizar
  - /articles/6304414-sou-fabricante-e-gostaria-de-incluir-atualizar-produtos-como-fazer
  - /articles/6303589-encontrei-um-mesmo-produto-com-avaliacoes-diferentes-por-que
  - /articles/6303638-quais-sao-as-categorias-de-produtos-nao-avaliadas-pelo-aplicativo
  - /articles/3724044-a-camera-do-celular-nao-esta-abrindo-nao-le-o-codigo-de-barras
  - /articles/6304035-como-recortar-a-lista-de-ingredientes
  - /articles/7129903-posso-pagar-o-premium-com-pix
  - /articles/12626464-o-que-e-a-parceria-entre-o-desrotulando-e-a-wellhub

Acadêmicas
- Andrade, Lopes, Lopes, Costa. *Ciência & Saúde Coletiva* 31(3), 2026, DOI 10.1590/1413-81232026313.10032024: https://www.scielo.br/j/csc/a/MN9Hvk8559cb6XC4ZKJqDcL/
- Oliveira, C. C. Tese, UFLA, 2025: https://bdtd.ibict.br/vufind/Record/UFLA_1c9e27d8c15ffc7df763e7c080a0729c
- Sustentarea/USP (2020): https://sustentarea.fsp.usp.br/2020/07/14/sustentarea-indica-desrotulando/

Imprensa
- Mobile Time, 26/02/2020: https://www.mobiletime.com.br/noticias/26/02/2020/app-desrotulando-tera-carrier-billing-com-operadoras-brasileiras/
- Mobile Time, 12/06/2023: https://www.mobiletime.com.br/?p=761096
- TechTudo, 15/07/2023: https://www.techtudo.com.br/dicas-e-tutoriais/2023/07/desrotulando-app-traduz-rotulos-de-alimentos-e-sugere-opcoes-mais-saudaveis-um-so-planeta-edqualcomprarghtml.ghtml
- TechTudo, ficha "tudo sobre" (sem data): https://www.techtudo.com.br/tudo-sobre/desrotulando/
- Canaltech, 12/03/2021: https://canaltech.com.br/apps/como-usar-desrotulando/
- GKPB, 31/01/2023: https://gkpb.com.br/115451/desrotulando/
- InovaSocial, 01/02/2023: https://inovasocial.com.br/tecnologias-sociais/desrotulando/
- O Joio e O Trigo, 02/2019: https://ojoioeotrigo.com.br/2019/02/desrotulando-o-app-que-virou-sucesso-se-inspira-no-guia-alimentar/
- Forbes Brasil, 19/02/2019: https://forbes.com.br/colunas/2019/02/app-desrotulando-desvenda-rotulos-de-alimentos-industrializados/
- Projeto Draft, 31/10/2018: https://www.projetodraft.com/totalmente-digital-o-desrotulando-explica-os-ingredientes-dos-alimentos-e-diz-se-fazem-bem-ou-nao/
- Saúde é Vitalidade / Revista Saúde, 24/05/2019: https://www.saudevitalidade.com/app-brasileiro-avalia-rotulos-de-alimentos/
- Showmetech, 03/03/2019: https://www.showmetech.com.br/desrotulando-escaneia-e-verifica-alimentos/
- Revista Cenarium, 12/05/2021: https://revistacenarium.com.br/desrotulando-aplicativo-escaneia-produtos-e-ajuda-a-escolher-alimentos-saudaveis/
- Jornal Atual, 07/03/2017: https://jornalatual.info/noticia/geral/aplicativo-que-resume-rotulos-dos-alimentos-vira-febre-entre-consumidores
- Consumidor Moderno, 13/06/2023 (só via resultado de busca): https://consumidormoderno.com.br/2023/06/13/app-identificacao-rotulos-de-alimentos/

Reclamações (só via resultado de busca; acesso direto bloqueado)
- https://www.reclameaqui.com.br/empresa/desrotulando-app/
- https://www.reclameaqui.com.br/empresa/desrotulando-app/lista-reclamacoes/
- Fórum Bastter, 25/02/2020: https://bastter.com/mercado/forum/875981/alguem-daqui-e-usuario-do-app-desrotulandocom-parece-ser-confiavel-sei-la
