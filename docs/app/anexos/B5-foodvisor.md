> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# B5 — Foodvisor (França): análise de produto, UX/UI e reconhecimento por imagem

Pesquisa feita em 13/10/2026. Convenção de evidência usada no texto:

- **[CAP]**: captura de tela oficial da Google Play, baixada e vista em 13/10/2026 (13 capturas da loja dos EUA e 21 da loja do Brasil). As capturas são material de marketing: mostram telas reais do app, mas compostas (cartões flutuando, ilustrações em volta).
- **[AJUDA]**: central de ajuda oficial (foodvisor.zendesk.com), com a data de atualização de cada artigo.
- **[LOJA]**: texto oficial das lojas (Google Play e App Store).
- **[3º]**: imprensa ou análise de terceiros. **[CONC]**: análise publicada por um app concorrente (viés comercial). **[USU]**: avaliação de usuário.

---

## 1) Ficha

| Item | Dado | Fonte |
|---|---|---|
| Empresa | Foodvisor SAS, Paris. Fundada em 2015 por Charles Boes, Yann Giret e Gabriel Samain (École Centrale Paris), com Aurore Tran (ESSEC) | Wikipedia FR [3º] |
| Lançamento | Beta iOS em 2016; lançamento oficial iOS e Android em jan/2018. Na Google Play desde 08/02/2018 | Wikipedia FR; dados da página da Play |
| Captação | ~1 M€ em 2018 (com Xavier Niel); US$ 4,5 M em nov/2019 (Agrinnovation/Demeter) | Wikipedia FR; VentureBeat 2019 [3º] |
| Dono atual | Comprada pelo grupo **Xynergy** (dono da marca "Comme j'aime"). Revelado pelo L'Informé (dez/2025); CFNEWS em 06/01/2026. Valor de 50 a 60 M€ segundo o L'Informé (conteúdo pago, **não verificado** na fonte primária) | CFNEWS; Wikipedia FR; Kalivia [3º] |
| Escala declarada | "mais de 15 milhões de utilizadores" | [LOJA] Play, out/2026 |
| Google Play | 10 mi+ downloads; nota 4,8 com ~208 mil avaliações (vitrine Brasil); "Contém anúncios"; compras de R$ 25,99 a R$ 559,99 por item; atualizado em 12/10/2026 | [LOJA] Play pt-BR, 13/10/2026 |
| App Store | EUA: 4,6 (18 mil). Brasil: 4,8 (9,8 mil). Versão 9.25.0 (out/2026); 317,9 MB; 20 idiomas, **português** entre eles | [LOJA] App Store US e BR |
| Promessa de marketing | "Perda média de 7,18 kg em 3 meses". Estudo interno com 4.419 usuários, jan/2026, IMC médio 34,72 | [LOJA] Play/App Store |
| Plataformas | Só celular (iOS e Android). **Não há versão web**: o site serve só para gerenciar a assinatura. No Mac com chip Apple roda o app de iPhone, "não otimizado" | [AJUDA] "Can I use Foodvisor on a computer?" (25/09/2026) |
| Brasil / pt-BR | App e capturas da loja em **pt-BR** ("Café da manhã", "Diário", "Treinador", "Você perdeu 6 kg"). A **descrição da loja está em pt-PT** ("utilizadores", "regista", "descarrega"). A central de ajuda tem pt-BR | [CAP]; [LOJA]; [AJUDA] pt-br |
| Base de alimentos | Alimentos reconhecidos casados com a tabela **Ciqual** (ANSES, França); produtos com código de barras via **Open Food Facts**; nos EUA, USDA e bases de código de barras. Base **brasileira (TACO etc.): nenhuma evidência**. Usuário BR: "Pão de queijo é igual couve flor" (25/06/2024) | Wikipedia FR; VentureBeat 2019; [USU] App Store BR |

**Preço (sempre com data e fonte; muda por país, loja e promoção, segundo a própria empresa):**

- A empresa não publica preço fixo: "depends on your country or region, the platform used… ongoing promotions" ([AJUDA], 08/04/2026). Indicação: a assinatura de 3 meses vem após 14 dias grátis de quem chega por indicação.
- Brasil, Google Play: faixa de R$ 25,99 a R$ 559,99 por item (13/10/2026). App Store BR: itens de R$ 47,90 a R$ 479,90 sem dizer qual plano é qual.
- EUA: US$ 14,99/mês ou US$ 83,99/ano (GGR, 02/06/2026 [3º]; NutriScan, mai/2026 [CONC]).
- França: 11,99 €/mês, 59,99 €/ano, 3 meses por 29,99 € (Kalivia, 29/08/2026 [3º]).
- **O que é grátis (fonte oficial):** a versão gratuita "allows you to track your food intake by manually logging meals". Ficam no Premium a análise de refeição por foto, as aulas diárias, os artigos, as receitas, a distribuição de macros personalizada e o resumo diário ([AJUDA] "Is Foodvisor free?", 09/04/2026). Análises de terceiros falam em "alguns scans por dia" no plano grátis. Fico com a fonte oficial e registro a divergência.
- Pacote "Sport & Meal Plan": compra única, vitalícia, com treinos em vídeo e "28 days of menus" ([AJUDA]).

---

## 2) UX/UI (seção principal)

### 2.1 Navegação e arquitetura

- **Barra de abas inferior**, com ícones de traço fino e rótulo; a aba ativa fica em tinta escura e as outras em cinza. Aparecem duas versões nas capturas oficiais [CAP]:
  - mais antiga: **Coach | Journal | Profile** (pt-BR: **Treinador | Diário | Perfil**);
  - mais nova: **Coach | Diary | Seed | Profile** (a mascote ganhou uma aba própria).
- A GGR (2026) confirma a estrutura: "just three main tabs: Coach, Journal, and Profile" [3º].
- Configurações moram em **Perfil > engrenagem > Preferências**, com "My goals", "Diary settings", "My profile" e "Health data connection" ([AJUDA], vários artigos de 2026). O Diário tem atalhos que levam direto às configurações, por exemplo tocar nas calorias queimadas no topo ([AJUDA] "How do I include physical activity…", 20/08/2026).
- O botão **"+" ao lado de cada refeição** abre a "meal experience": as abas **Photo** (com Barcode dentro), **Search** e **Smart Add**, mais favoritos e histórico. Antes de salvar, revisa-se a refeição ([AJUDA] "How to add a meal?" e "How do I log a meal eaten out", 28/09/2026).

### 2.2 Tela Diário/Journal (a tela de trabalho), de cima para baixo [CAP]

1. **Cabeçalho em bloco colorido** (verde-água na captura), com um **anel grande central**: "1510 Cal left / restantes". O anel enche conforme se consome. À esquerda, "410 Eaten / Ingeridas"; à direita, "368 Burned / Queimadas". São três números com um só protagonista, o que resta.
   - Segundo a ajuda oficial, **a cor de fundo da página inicial é a média das notas de cor das refeições do dia** ("The background color is the average of your daily food ratings"; [AJUDA] "What do food colors and emojis mean?", 23/07/2025). O cabeçalho é ao mesmo tempo painel numérico e termômetro de qualidade.
   - Logo abaixo do ícone de sequência (streak), no canto superior direito, ficam as calorias queimadas, que também servem de atalho [AJUDA].
2. **Cartão branco "Macronutrientes"** com **4 anéis pequenos**, sempre na mesma ordem e na mesma cor: **Gordura amarela, Proteína rosa/salmão, Carboidrato azul-claro, Fibra marrom**. Dentro de cada anel, o consumido em número grande e a meta pequena embaixo ("21 /95g").
3. **Lista de refeições**: Café da manhã, Almoço, Jantar e Lanches. Cada linha traz:
   - um avatar à esquerda: **emoji de rosto colorido** quando há registro (a nota da refeição) ou ilustração do tipo de refeição quando vazia;
   - nome e **"410/490 cal"**, o orçamento por refeição;
   - **miniaturas das fotos** dos alimentos em quadrados arredondados;
   - botão **"+" em círculo escuro**.
4. **Cartão Água**: "Target 2.00 l", total (1,25 l) e uma fileira de **copos que se enchem de azul**, com copos vazios marcados "+". Registra-se tocando no copo.
5. Personalização: até 5 refeições extras ("Pré-treino"…). **Cada refeição adicionada vale 5% da meta calórica** e, ao remover uma, as calorias se redistribuem. Recurso **só no iPhone** "por enquanto" ([AJUDA] 25/08/2026).

### 2.3 Tela Coach/Início [CAP]

- **Ilustração de cabeçalho em cena** (acampamento: barraca, fogueira, pinheiros, lago, sol entre nuvens) com o título em fonte serifada: "Begin your journey to success!" / "Comece sua jornada para o sucesso!".
- Seção **"Meu objetivo"**: os mesmos 4 anéis de macros, maiores, com "32 / 73 g".
- Seção **"Minhas ferramentas"**: cartões grandes em cor pastel, cada um com um ícone ilustrado ("Meal Plans: Plan your week" em azul com calendário; "Minhas receitas: Mais de 300 receitas" em rosa com tigela).
- Aulas diárias: 2 a 3 por dia, de uma biblioteca de mais de 500 (GGR [3º]; NutriScan [CONC]). Notificação quando há aula nova (FeastGood 2023 [3º]).

### 2.4 Foto da refeição: como o reconhecimento aparece

- **Captura oficial [CAP] ("Snap your meal, leave the counting to us"):** foto do prato vista de cima com os **cantos de visor de câmera**, uma **pílula branca "332 Cal"** logo abaixo e a fileira dos 4 anéis de macros em gramas. É a mensagem central da marca: **a foto é a protagonista e o resultado vem em um número**.
- **Tela real de resultado com os itens: não verificada em captura oficial.** Nenhuma das 34 capturas mostra a lista de itens reconhecidos nem a tela de correção. Não há evidência de **overlay sobre a foto** (caixas ou rótulos por alimento). O que se sabe vem de descrições:
  - [AJUDA] "What to do when my food is not recognized?" (2022): os resultados vêm com **alternativas por item** ("if the right food appears in a different choice, you just have to select the right one by clicking on it"). Se o alimento não está entre elas, adiciona-se pela busca e volta-se à foto. Sugestões erradas **não precisam ser adicionadas**: cada item é aceito ou recusado.
  - FeastGood (2023) [3º]: depois da foto "a new window opens" onde se selecionam alimentos, ajustam porções e **trocam itens por alternativas**; há opção de deixar feedback sobre o scan.
  - [AJUDA] "How to modify the quantity" (2022): toca-se no rótulo do alimento e troca-se a quantidade e a **unidade** ("1 banana, ou 1 porção de 150 g, ou 50 g").
  - Satu Kyrölainen (UX, 29/12/2024) [3º]: captura com a lista de ingredientes identificados e quantidades estimadas. A autora **pediu "poder editar as quantidades dos itens reconhecidos"**, o que sugere que a edição naquele fluxo não era óbvia.
- **Dicas de captura que o app ensina** [AJUDA]: separar os alimentos, fotografar de cima, com boa luz, e não fotografar embalagem (há leitor próprio). Fotografar o prato **pronto, como será comido**.

### 2.5 Código de barras [CAP]

Visor com cantos arredondados sobre a embalagem e, ao ler, uma **folha inferior** com:

- **emoji de rosto** (amarelo-esverdeado, piscando) + palavra **"Good" / "Boa"** + "190 Cal";
- os 4 anéis de macros.

A nota do produto vem antes de qualquer número. Dados errados de um código podem ser corrigidos pelo usuário ("Edit data" > "Save barcode", [AJUDA]).

### 2.6 Nota de qualidade (cor e emoji)

- **Escala oficial atual, 4 níveis** ([AJUDA] 23/07/2025; pt-BR 03/08/2026): 🟦 **Azul = Muito bom**, 🟩 **Verde = Bom**, 🟧 **Laranja = Correto**, 🟥 **Vermelho = Atenção**. Cada alimento e cada refeição recebe a nota; o dia é a média.
- **Ressalva oficial:** a cor mede "a qualidade das refeições, não o equilíbrio nutricional do dia". Para o equilíbrio, há o **Resumo Diário**, que é Premium.
- **A fórmula da nota não é pública**: não há evidência de que seja Nutri-Score.
- Versões antigas usavam vermelho, laranja, amarelo e verde, com **rosto sorrindo no verde e rosto bravo no vermelho** (GGR, teste de 2023 [3º]). Um usuário em 2025 descreve "Blue, teal, orange, red being the worst" [USU].
- Críticas: a GGR diz que a cor "definitely made me want to exclude foods" e alerta para quem tem histórico de transtorno alimentar. A NutriScan [CONC] diz que **não dá para desligar** as cores. Desligamento das cores: **não verificado** na fonte oficial (a ajuda só confirma que a gamificação não se desliga).

### 2.7 Resumo diário e celebração [CAP]

- Tela **"Daily summary"** com fundo verde-limão, a **mascote (um abacate com pernas, de óculos escuros)** e a mensagem "Congratulations! You achieved your goal today!".
- Linha de anéis com **"60 Cal left"** (anel verde) e as 4 macros.
- Abaixo, **barras horizontais por nutriente** ("Fiber 47/24 g" em marrom, "Fat 46/50 g" em amarelo).
- Para cada nutriente, a **lista dos alimentos do dia que mais contribuíram, com miniatura** ("The food item you ate today with fiber": muesli, abacate, pão integral).
- É Premium; os passos aparecem só aqui ([AJUDA] "Why don't my steps show up", 24/09/2026).
- Satu (dez/2024) reclamou que, ao bater a meta de peso, "no acknowledgment" apareceu. As capturas atuais mostram tela de parabéns: **o comportamento atual não foi verificado**.

### 2.8 Peso [CAP]

- Ilustração de **troféu "1" segurado pela mascote** com confete, e o título personalizado "Parabéns, Ana! Você perdeu 6 kg até o momento. Você está no caminho certo para atingir sua meta em 1 mês."
- **Dois chips de número**: "−6 kg Desde o início" e "−1 kg Desde a última pesagem".
- **Gráfico de linha** com pontos mensais (set. a dez.), área preenchida azul-clara, **linha tracejada da meta** e **etiqueta laranja** num ponto.
- **A captura pt-BR é incoerente**: a curva vai de 78 kg a 68 kg (−10 kg), o chip diz −6 kg e a etiqueta "62 kg" fica num ponto acima do final de 68. Na versão em inglês (160 → 147 → 140 lb, "−13 lbs") também há ambiguidade entre a etiqueta e o fim da curva.
- Só se acompanha **peso**, sem medidas nem % de gordura (FeastGood; GGR [3º]). Um usuário BR pediu "colocarmos as medidas do corpo… as vezes o peso não muda mas as medidas estão mudando" [USU Play BR, 2026].

### 2.9 Aulas (Coach) [CAP]

- Tela com **barra de progresso fina no topo** e o título da aula numa pílula ("Como equilibrar sua refeição?"), seguida da pergunta grande "Qual é o almoço perfeito?".
- **Prato desenhado como gráfico de pizza** (50% frutas e legumes, 25% alimentos com amido, 25% proteínas), com **etiquetas coloridas** apontando as fatias.
- Lista "Você também pode adicionar" com ícones (porção de gordura, fruta, laticínio) e **botão pílula escuro "Próximo"**.
- Uma tela por ideia, em formato de cartão de quiz.

### 2.10 Jejum intermitente [CAP]

- **Arco semicircular** (salmão) com **ícones das fases** ao longo dele (gotas, chama, DNA), um cronômetro grande "4:00:00", o estado "Fat burning" e "fasting".
- **Chips editáveis** de início e fim ("Today 1 PM" / "Today 9 PM") e o CTA pílula escuro **"Start fasting"**.
- Carrossel horizontal "Advice to fast" e uma lista de protocolos (16:8, 17:9, "18:6 Expert fasting") com ícone de rosca.
- Um usuário BR (14/09/2026) diz que o horário de início e fim é fixo e queria "iniciar e finalizar o jejum" na hora [USU].

### 2.11 Mascote e gamificação ("Seed")

- **[CAP]:** aba "Seed": cenário de jardim (céu, cerca branca, grama), **semente marrom com olhinhos e um broto**, "Level 1" com barra verde "8/20", e os botões **"Shop"** e **"My items"**.
- **[LOJA]:** "cada boa refeição, cada copo de água, cada hábito mantido faz crescer a tua semente. Vê-a florescer, veste-a, decora o seu jardim".
- **[AJUDA] (25/08/2026, a fonte mais importante desta seção):** há semente (mascote), **missões (quests), loja, baús e gemas** e **animações com vibração e som** "em particular após registrar uma refeição ou completar uma sequência". **Nada disso se desliga.** A própria empresa escreve: "We're well aware of the large volume of negative feedback on this topic, received in every language" e diz que a opção de desligar "isn't planned in the short term".
- **Regras da sequência** [AJUDA, 25/08/2026]: o dia conta **registrando uma refeição ou lendo a aula do dia**. Porém a "surpresa" (desbloquear a semente) **só abre se o dia foi completado por refeição**: quem lê a aula antes de registrar fica travado. A empresa reconhece e manda "registre antes de ler".
- Monetização dentro do jogo: **renomear a semente custa 500 gemas**, e as gemas podem ser compradas na mesma tela ([AJUDA] 11/09/2026, só iPhone).
- Outros: "freezes" de sequência como recompensa (ScreensDesign [3º]); widget de tela inicial com o progresso do dia e "playful animations" ao manter a sequência (App Store Story [LOJA], iOS).
- Recepção dividida: "Amei o broto, é um incentivo para adicionar os alimentos" [USU Play BR, 13/04/2026] contra "acessórios para um avatar… infantil" [USU App Store FR, 2025].

### 2.12 Onboarding e paywall

- **76 passos** de questionário, segundo a ScreensDesign [3º]; a GGR fala em "about 10 minutes" [3º].
- Perguntas: objetivo, peso, altura, sexo ao nascer, gravidez e amamentação (há artigo de ajuda só disso), condições médicas, contexto de vida (estudante, dinheiro, equilíbrio trabalho-vida, apoio de família e amigos), eventos recentes que mexeram no peso, tentativas anteriores, hábitos. Exemplo citado: "Would you say that snacking is an issue for you?", que a GGR achou "kind of accusatory".
- **Data prevista para atingir a meta, atualizada ao vivo** conforme se responde: elogiada como mecanismo de engajamento (ScreensDesign).
- Metas de calorias, macros e água saem do questionário e podem ser sobrescritas no Perfil.
- Paywall no fim do onboarding com **"roleta de desconto" (spin the wheel)**, **contador regressivo** e, depois de recusado, um **banner fixo de oferta** (ScreensDesign [3º]).
- Teste grátis exige cartão; há relatos de cobrança antes do esperado (seção 6).

### 2.13 Linguagem visual (das capturas oficiais)

| Elemento | O que se vê [CAP] |
|---|---|
| Paleta | Fundos **pastel** por contexto (verde-menta, pêssego, amarelo-manteiga, azul-claro, rosa); cartões brancos; **texto azul-marinho escuro** (nunca preto puro); CTA principal em **pílula marinho com texto branco** |
| Cores semânticas fixas | Gordura amarela, Proteína rosa, Carbo azul, Fibra marrom, repetidas em **todas** as telas (Diário, Coach, foto, código de barras, resumo). Água em azul de copo. Nota do alimento em azul, verde, laranja e vermelho |
| Tipografia | **Serifada de exibição** nos títulos ("Macronutrientes", "Comece sua jornada", aulas) + **sem serifa arredondada** para números e rótulos. Os números ficam em peso médio e grandes; as metas em cinza pequeno ("/95g") |
| Formas | Cartões com **raio grande**, sombras suaves, cartões que se sobrepõem; anéis com traço grosso e trilha clara (a cor da macro em versão desbotada) |
| Ilustração | Comida em ilustração **chapada** (biscoito, hambúrguer, mirtilo, laranja, azeitona); cenas de paisagem nos cabeçalhos; **mascotes**: abacate com pernas (celebração) e semente (jogo) |
| Emoção | Rostos-emoji para a nota, confete e troféu no peso, textos em 2ª pessoa com o nome da pessoa ("Parabéns, Ana!") |
| Densidade | Diário: cerca de 8 números visíveis + miniaturas, organizados em 3 camadas (anel grande, anéis pequenos, lista). As demais telas trazem **uma ideia por tela** (aula, jejum, peso) |

### 2.14 Notificações

- Há "manage my notifications", com escolha de **tipo e horário** (FeastGood, 2023 [3º]).
- Problemas relatados: **lembrete de refeição que já tinha sido registrada minutos antes**, e tipos escolhidos (peso, conselhos) que nunca chegaram (FeastGood [3º]).
- Lembretes de refeição pedem para fotografar antes de comer (Progress Form, 2025 [3º]).
- Conteúdo atual das notificações: **não verificado**.

### 2.15 Acessibilidade

- **Contraste insuficiente**: texto branco sobre cinza e sobre verde-claro, com captura (Satu Kyrölainen, 12/2024 [3º]). Nas capturas oficiais, rótulos cinza-claro sobre pastel ("/278 g", "Target 2.00 l") também parecem de baixo contraste (observação minha sobre a captura, sem medição).
- Cor carrega significado (nota), mas **vem junto com emoji de rosto e palavra** ("Boa"), o que ajuda daltônicos. Não verifiquei o mesmo reforço em todas as telas.
- Unidade padrão em gramas (reclamação de usuários americanos [USU]).
- Idioma trocado sozinho para finlandês após atualização, com tradução ruim (Satu [3º]).
- iPad: "stretched phone UI" (Nutrola [CONC]).
- Suporte a leitor de tela e fonte grande: **não verificado**.

### 2.16 Android x iOS (fonte oficial)

**Só no iPhone hoje** [AJUDA, ago-set/2026]:

- refeições extras;
- **exportação CSV**;
- renomear a semente;
- plano família, que no Android exige ativação manual pelo suporte.

Outros pontos de plataforma:

- Saúde: o app lê **Health Connect** no Android e Apple Health no iOS. **A descrição da Play ainda diz "Sincronização com o Google Fit"** [LOJA], desatualizada em relação à ajuda.
- Restaurar compra a cada abertura é um problema com artigo próprio na ajuda.
- Android 9 ou superior (Uptodown [3º]).

### 2.17 Princípios de design transferíveis

1. **Um protagonista por cartão.** O cabeçalho do Diário tem um anel e um número grande ("restam 1510"), com dois coadjuvantes menores (ingeridas, queimadas). Cada anel de macro tem o consumido grande e a meta pequena.
2. **Cor semântica fixa e global por nutriente.** As 4 cores nunca mudam de lugar nem de significado. Depois de uma semana, o usuário lê a cor antes do rótulo.
3. **A foto como unidade de memória.** A refeição aparece no diário como miniaturas da própria comida, não como texto. A lista vira um álbum.
4. **Orçamento por refeição** ("410/490"): a meta do dia quebrada em metas pequenas, que dão ação no momento ("ainda cabem 80 no café").
5. **Nota qualitativa com redundância** (cor + rosto + palavra), separada do equilíbrio numérico do dia, que fica no resumo.
6. **Uma ideia por tela** nos fluxos educativos e de estado (aula, jejum, peso): título serifado, um gráfico e um botão.
7. **Celebração ancorada em fato.** O parabéns traz o número ("−6 kg desde o início, −1 kg desde a última pesagem") e um prazo.
8. **Registro tátil de hábitos** (copos que enchem, toque = +250 ml) para o que não precisa de IA.
9. **Explicar o porquê do número.** A ajuda dá a fórmula com exemplo ("1.800 + 300 − 1.200 = 900") e explica quando ligar ou desligar a atividade na meta.
10. **Correção por escolha entre alternativas** em vez de digitação: o reconhecimento propõe opções por item, o usuário toca na certa e recusa as erradas.
11. **Ilustração e mascote como tom**, não como informação: as cenas e personagens trazem calor sem disputar com os números.

### 2.18 O que NÃO copiar

- **Gamificação obrigatória**, sem opção de desligar, com som e vibração e loja de gemas paga. A própria empresa admite "large volume of negative feedback… in every language".
- **Regras escondidas de sequência** (ler a aula antes de registrar trava a recompensa): incentivo que pune a ordem "errada".
- **Rosto bravo ou vermelho em alimento** e cor como julgamento moral, sem opção de desligar; risco documentado para quem tem relação difícil com comida.
- **Número único sem incerteza** ("332 Cal") quando a porção é a parte mais fraca do reconhecimento.
- **Gráfico de peso com números incoerentes** (captura pt-BR) e promessa "no caminho certo para atingir sua meta em 1 mês" sem método publicado.
- **Paywall de pressão**: roleta, contador regressivo, banner fixo, teste que cobra.
- **Funções básicas só no iOS** (CSV, refeições extras) e descrição da loja em pt-PT para o Brasil.
- Passos visíveis só num relatório pago: o dado de atividade some da tela principal.

---

## 3) Funcionalidades

| Recurso | Como funciona | Evidência (fonte) | Problema que resolve | Relevância para o NutriBot e por quê |
|---|---|---|---|---|
| Foto com IA, vários itens | Foto do prato pronto → itens reconhecidos com porção estimada → alternativas por item → aceitar ou recusar → salvar. Premium | [AJUDA] "Is Foodvisor free?", "How to add a meal", "not recognized"; FeastGood [3º] | Atrito de registrar item a item | **Alta.** É o núcleo do NutriBot (Gemini). Copiar a confirmação por alternativas, não o número sem faixa |
| Smart Add (texto livre) | "I had a mixed salad at a restaurant" → IA estima. Premium | [AJUDA] 28/09/2026 | Refeição sem foto (restaurante, esquecimento) | **Alta.** O NutriBot já faz texto e áudio pelo WhatsApp. Usuário BR elogia: "apenas descrever o que comi e as gramas… é muito útil" |
| Voz | "Fala diretamente com a app" ("pear, 100 grams") | [LOJA]; Satu [3º] | Registro de mãos ocupadas | **Média.** O NutriBot já recebe áudio |
| Busca manual | Aba Search; marcas de redes de restaurante; pedido de inclusão | [AJUDA]; [USU] Play EN 2026: busca usa "only one or two of the keywords" | Alimento específico | **Média.** O app Android precisa de busca boa em pt-BR com sinônimos regionais |
| Código de barras | Leitor dedicado; folha com nota, kcal e macros; edição dos dados pelo usuário | [CAP]; [AJUDA]; GGR: "the easiest and most accurate way" [3º]; [USU] "only works half the time" | Industrializados com rótulo exato | **Média/alta.** Fonte mais confiável que a foto; Open Food Facts tem produtos BR |
| Favoritos, histórico, receitas próprias | Estrela; criar alimento ou receita | [AJUDA]; [LOJA] | Refeições repetidas | **Alta.** As 3 pessoas monitoradas repetem cafés da manhã |
| Nota de qualidade (cor e emoji) | 4 níveis; o fundo da home é a média do dia; fórmula não publicada | [AJUDA] 2025/2026; [CAP] | Feedback qualitativo imediato | **Média, com cuidado.** Útil como reforço; precisa ser desligável e sem rosto bravo |
| Resumo diário | Kcal restantes, macros em barras, alimentos que mais contribuíram, passos, recomendações. Premium | [CAP]; [AJUDA] | "Meu dia foi equilibrado?" | **Alta.** O NutriBot já tem !hoje; o resumo visual com "quem contribuiu" é ótimo para o app |
| Metas de kcal e macros | Calculadas do perfil (peso, altura, idade, nível de atividade); macros em % da kcal; distribuição editável; meta por refeição | [AJUDA] (vários, 2026) | Meta inicial | **Média.** O NutriBot já calibra a meta pela balança; o Foodvisor não adapta (FeastGood 2023) |
| Atividade na meta (opcional) | Lê Health Connect ou Apple Health (uma fonte por vez); "Include activity in goal": restante = meta + queimadas − comidas; recomenda **desligado para perder peso** | [AJUDA] 15/09/2026 | Comer de volta as calorias do exercício | **Alta.** O NutriBot já lida com relógio superestimando; vale mostrar a fórmula e a escolha explícita |
| Passos e treinos | Só lê de Health Connect ou Apple Health; sincroniza ao abrir o app; só sessões depois da permissão; duplicidade quando duas fontes escrevem | [AJUDA] 19 e 24/08-09/2026 | Integração com relógios | **Alta.** O guia de permissões do Health Connect deles é modelo de texto de onboarding |
| Peso | Registro ilimitado; gráfico; chips "desde o início" e "desde a última"; previsão de chegada | [CAP]; FeastGood; GGR [3º] | Ver progresso | **Alta, mas aqui o NutriBot é superior** (tendência com IC). Pegar só a forma visual |
| Hidratação | Copos que enchem, meta em litros | [CAP] | Hábito simples | **Baixa/média.** Não é foco do NutriBot |
| Jejum intermitente | Protocolos 16:8, 17:9, 18:6; arco de fases; horários fixos | [CAP]; [USU] Play BR 2026 | Quem pratica jejum | **Baixa.** Fora do escopo das 3 pessoas |
| Coach: aulas, artigos e receitas | 2 a 3 aulas por dia de 500+; 300+ receitas; cardápios no pacote pago | GGR; NutriScan [CONC]; [AJUDA]; [USU] cardápio de US$ 394/semana | Educação e hábito | **Baixa/média.** O NutriBot conversa; aula curta tipo cartão pode virar conteúdo do app |
| Nutricionista humano | Existiu (chat; respostas em horas, das 9h às 19h, FeastGood 2023); **removido do Premium** segundo GGR (06/2026) e NutriScan (05/2026) | [3º]; [CONC] | Dúvidas | **Informativo.** Mostra que o humano não escalou; o NutriBot usa IA + dono |
| Gamificação (semente) | Nível, missões, loja, gemas pagas, baús, animações; não desliga | [AJUDA]; [CAP]; [LOJA] | Retenção | **Baixa.** Se houver, opt-in e leve |
| Comunidade | Prometida na loja; usuário diz que não encontrou | [LOJA]; [USU] Play EN 2024 | Apoio social | **Baixa.** O grupo de WhatsApp já faz esse papel |
| Exportação | CSV por e-mail em algumas horas; Premium; só iPhone | [AJUDA] 16/09/2026 | Portabilidade | **Média.** O NutriBot já tem planilha; manter export aberto |
| Micronutrientes | "vitaminas, minerais, micronutrientes" no Premium | [LOJA] | Detalhe nutricional | **Baixa.** Estimativa por foto já é incerta nas macros |
| Plano família | Até 5 membros via Apple; Android manual | [AJUDA] 26/08/2026 | Casa toda | **Informativo.** O NutriBot já é multiusuário (3 pessoas) |
| Widget | Progresso do dia na tela inicial (iOS) | App Store Story [LOJA] | Olhar sem abrir | **Alta.** Widget Android com anel de kcal restante é barato e útil |
| Web | Não existe | [AJUDA] | — | **Oportunidade**: painel web simples para o dono acompanhar as 3 pessoas |

---

## 4) Cálculos e dados

### 4.1 Reconhecimento da foto (o que é público)

- **Classificação** por deep learning. Histórico: cerca de 20 alimentos no início, mais de 1.000 no fim de 2017 (Wikipedia FR) e "1,200 types of food" em 2019 (VentureBeat). A Wikipedia FR diz que o modelo usa "cor, tamanho, forma e brilho" e que cada alimento novo exige "várias centenas" de exemplos. **Nenhum número atual, artigo científico ou benchmark da empresa** foi encontrado.
- **Porção:** a única descrição técnica pública é da TechCrunch (2019):
  1. distância prato-celular pelos **dados do autofoco** da câmera;
  2. **área** de cada alimento;
  3. **volume extrapolado por tipo de alimento**, convertido em peso.

  Não encontrei menção a LiDAR, sensor de profundidade ou várias fotos, nem atualização posterior do método. Tecnologia atual: **não verificada**.
- **Nutrientes** vêm da Ciqual (França) e do Open Food Facts (Wikipedia FR); nos EUA, do USDA (VentureBeat).
- **Cru x cozido** [AJUDA, 2020]:
  - foto sempre do prato pronto; sem indicação, o alimento é tratado como cozido;
  - massa e arroz "always considered raw" salvo indicação, com a regra "150 g cooked pasta = 50 g raw pasta" (proporção 3:1, acima do 2,2 a 2,5:1 usual para massa; registro, não verifiquei a origem);
  - massa com molho é sempre porção cozida.

  É uma fonte de erro sistemático que o NutriBot deve evitar.
- **Precisão observada por terceiros (não oficial):**
  - Kalivia (2026): 24 de 30 pratos prontos reconhecidos contra 18 do YAZIO; arroz, frango e brócolis em menos de 5 s, com porção de arroz a corrigir para cima.
  - Ensopados, pratos cobertos de molho, bowls e óleo, manteiga e molho escondidos são os pontos fracos: GGR, FeastGood, Progress Form, Satu e Nutrola [CONC] ("tende a subestimar óleos, castanhas e molhos").
  - Usuário BR: "A IA sempre erra… gastamos mais tempo corrigindo do que simplesmente descrevendo o prato" [USU Play BR, 06/05/2026].
  - Um estudo de 2024 na *Nutrients* (Li et al., 7 apps, 46% a 97% de acerto) é citado pela NutriScan [CONC], mas o Foodvisor **não** foi avaliado individualmente. Não li o artigo: **não verificado**.

### 4.2 Como comunica a incerteza

- **Não comunica.** Em todas as capturas oficiais o resultado é um número único ("332 Cal", "190 Cal") sem faixa, sem "confiança" e sem aviso.
- A incerteza é tratada só **pela correção**: alternativas por item, edição de porção e unidade, dicas de foto.
- A ajuda empurra o ônus para o usuário: separar os alimentos, fotografar de cima, com luz.
- Um usuário FR nota "análises às vezes contraditórias de uma refeição para outra" [USU App Store FR, 2025].

### 4.3 Metas

- Meta base "calculated from your profile: weight, height, age, activity level, etc." e "doesn't change on its own" ([AJUDA] 15/09/2026). **A fórmula não é publicada** (Mifflin, Harris-Benedict etc.: não verificado).
- Macros em **% da meta calórica**, editável. Com atividade incluída, todas as macros sobem proporcionalmente.
- Refeições: cada refeição extra vale 5% da meta; a distribuição por refeição é editável.
- Piso: planos "evitam por padrão dias abaixo de 1.200 kcal" (Kalivia [3º]; não verificado na fonte oficial).
- **A meta não se adapta à tendência de peso** (FeastGood 2023 [3º]). A afirmação da Kalivia de "ajuste diário conforme a progressão" não tem detalhe: **não verificado**.
- Previsão: no onboarding, "data de chegada" ao vivo; no peso, "no caminho certo para atingir a meta em 1 mês". **Método não publicado.** Usuário FR: "a IA tinha previsto uma perda de 11 kg em 3 meses!!!" [USU App Store FR, 2025].

### 4.4 Tendência de peso

- O gráfico liga as pesagens (mensais nas capturas) e mostra o **delta desde o início e desde a última pesagem**.
- **Nenhuma evidência de média móvel, suavização, regressão ou intervalo de confiança.** "Desde a última pesagem" é justamente a métrica mais sensível a água e sal.

### 4.5 Dados incompletos e transparência

- Atividade: só sessões registradas depois da permissão; sincroniza ao abrir o app; uma fonte de saúde por vez; duplicidade quando duas apps escrevem treinos. Tudo documentado [AJUDA] e honesto.
- Passos só no relatório Premium.
- A ajuda explica bem as fórmulas de meta e atividade, com exemplo numérico. Por outro lado, a **nota de qualidade, a estimativa de porção e a previsão de chegada são caixas-pretas**.
- O marketing usa "−7,18 kg em 3 meses" de um estudo interno sem método, com amostra de IMC médio 34,7 (viés de seleção provável).

---

## 5) Pontos fortes

1. **Linguagem visual coerente e calorosa**: pastel, ilustração chapada, serifada nos títulos, 4 cores fixas de macro em todas as telas, mascote. É a "cara" que o dono quer como referência.
2. **Diário escaneável em 3 camadas**: anel do que resta, anéis de macro, refeições com fotos e orçamento por refeição.
3. **Vários caminhos de registro no mesmo "+"**: foto, código, busca, texto livre e voz, com favoritos.
4. **Correção por alternativas**, em vez de digitar do zero.
5. **Central de ajuda excelente e atual** (2026): fórmulas com exemplo, guia passo a passo de permissões do Health Connect e Apple Health, admissão franca de limitações ("not a bug", "not planned").
6. Escolha **explícita** sobre comer de volta as calorias do exercício, com recomendação por objetivo.
7. Aulas em formato de cartão, uma ideia por tela.
8. Escala e reputação: 10 mi+ downloads, nota 4,6 a 4,8, prêmio "Android Excellence" exibido nas capturas.

## 6) Pontos fracos e reclamações recorrentes

| Problema | Evidência |
|---|---|
| Foto erra o alimento e principalmente a porção; pratos mistos, molho e óleo | [USU] Play BR 06/05/2026; [USU] App Store BR 25/06/2024 ("pão de queijo = couve-flor"); Trustpilot 12/10/2026 ("not always accurate… ingredients or the weight"); GGR; FeastGood; Satu; Progress Form |
| Base de alimentos com entradas de usuários duplicadas ou divergentes; busca fraca | GGR ("hundreds of user entries"); [USU] Play EN 09/04/2026; [USU] App Store FR (fast-food ausente) |
| Cobrança, teste grátis e reembolso | [USU] App Store BR 24 e 28/06/2024 ("cobrou o valor de 90,00"); [USU] Play BR 2026 ("Google nega o pedido de reembolso"); [USU] App Store US 2023/2025; NutriScan [CONC] |
| Gamificação impossível de desligar | [AJUDA] 25/08/2026 (admissão oficial de feedback negativo em todos os idiomas); [USU] App Store FR 2025 |
| Cor e rosto nos alimentos podem prejudicar a relação com a comida | GGR (2023/2026); NutriScan [CONC] citando nutricionista |
| Bugs de código de barras e sincronização de atividade | [USU] App Store US 2024/2025; Satu (Fitbit); Progress Form (Apple Health e Google Fit) |
| Notificações duplicadas ou ausentes | FeastGood 2023 |
| Android atrás do iOS | [AJUDA] (CSV, refeições extras, renomear, família só no iPhone) |
| Paywall agressivo e muitos anúncios no grátis | ScreensDesign (roleta, contador, banner); Nutrola [CONC]; "Contém anúncios" [LOJA] |
| Nutricionista humano removido | GGR 06/2026; NutriScan [CONC] |
| Conselhos simplistas | [USU] Play BR (trocar doce por "caqui (?!)"; "minilições bem superficiais"); NutriScan (mirtilo e margarita ambos "high sugar") |
| Acessibilidade: contraste e idioma | Satu 12/2024 |
| Incerteza com o novo dono | Kalivia 2026 ("vigilância editorial 2026-2027") |

---

## 7) Lições concretas para o NutriBot (app Android)

1. **Cabeçalho do dia = anel de "kcal restantes" + Ingeridas | Queimadas**, com o anel enchendo e a cor do anel ligada ao **veredito estatístico** do NutriBot (dentro, acima ou abaixo do ritmo), não à "qualidade" da comida. Logo abaixo, os 4 anéis de macro com **cores fixas e globais** (definir as do NutriBot uma vez e repetir no app, no widget, nos cartões e nas imagens enviadas pelo WhatsApp).
2. **A refeição é a foto**: no diário do app, cada refeição mostra as miniaturas das fotos que a pessoa mandou no WhatsApp, o horário e "x/y kcal". Isso integra os dois canais e dá a "dinâmica" que o dono quer sem gamificação.
3. **Mostrar a faixa onde o Foodvisor mostra um número só**: "≈ 520 kcal (420–650)", com os itens em **chips com alternativas** (toque troca "arroz branco" por "arroz integral" e ajusta a porção por botões "½ / 1 / 1½ / 2"). É a diferença honesta em relação ao Foodvisor, e o NutriBot já tem a cultura do IC.
4. **Orçamento por refeição**: quebrar a meta em café, almoço, jantar e lanches (editável), porque dá ação no momento. O Foodvisor faz isso com "410/490".
5. **Atividade na meta: escolha explícita e fórmula visível** ("restante = meta + gasto do relógio − comido"), desligada por padrão para perda de peso, como o Foodvisor recomenda. No NutriBot, somar a correção do relógio já medida contra a balança e dizer isso na tela.
6. **Tela de peso no estilo deles, com o rigor do NutriBot**: chips "desde o início" e "tendência de 28 dias ± IC", em vez de "desde a última pesagem" como destaque. Pesagens como pontos, a tendência como linha, a meta tracejada, e **nenhuma previsão de data sem pesagens suficientes**. Testar as imagens do gráfico contra os dados (a captura pt-BR deles é incoerente).
7. **Celebração só quando o dado sustenta**: mascote ou ilustração e confete no resumo diário quando a meta do dia fechou ou a tendência confirmou o ritmo, com o número no texto ("−0,4 kg/semana nas últimas 4 semanas"). Nunca "no caminho certo" com veredito abaixo (o que a conferência de texto do NutriBot já barra).
8. **Lúdico opcional e sem punição**: se houver mascote ou sequência, opt-in, desligável, sem loja paga, contando qualquer forma de registro (foto, texto, áudio). Nada de rosto bravo em comida: se houver nota de qualidade, palavra neutra + cor, desligável.
9. **Onboarding do Health Connect copiado em espírito da ajuda deles**: passos curtos, "um app escreve, o NutriBot lê", tela de prioridade de fontes, aviso de que só entram dados posteriores à permissão e de que sincroniza ao abrir. O Foodvisor mostra que esse é o ponto que mais gera suporte.
10. **Brasil de verdade**: base TACO/IBGE e preparações brasileiras (pão de queijo, feijão, cuscuz, tapioca, açaí), rótulos em pt-BR (não pt-PT) e massa e arroz sempre como "cozido" por padrão, porque é o que se fotografa.

**Bônus (barato e de alto valor):** widget Android com o anel de kcal restantes, e um painel web simples para o dono ver as 3 pessoas (o Foodvisor não tem web).

---

## 8) Não verificado / limitações

- **Tela real de resultado da foto** (lista ou overlay dos itens, layout dos chips de alternativa, edição de porção): nenhuma captura oficial a mostra. A descrição vem da ajuda (2022) e de terceiros.
- Fórmula da **nota de qualidade** (azul, verde, laranja, vermelho), da **meta calórica** e da **previsão de chegada**: não publicadas.
- Método **atual** de estimativa de porção (o único público é o da TechCrunch, 2019): não verificado se ainda vale. Precisão oficial: inexistente.
- Se as **cores dos alimentos** podem ser desligadas: só fontes de terceiros ou concorrentes dizem que não.
- Conteúdo e frequência atuais das **notificações**; existência de **comunidade** dentro do app; suporte a leitor de tela e fonte grande; existência de widget no Android.
- **Base de alimentos brasileira**: sem evidência de que exista. Só há um relato negativo.
- Valor da aquisição pela Xynergy (50 a 60 M€): fonte primária com paywall.
- Diferença de plano grátis: a ajuda oficial (04/2026) diz que a foto é Premium; terceiros dizem "alguns scans por dia". Pode variar por região ou teste A/B.
- Avaliações de usuários foram amostradas das páginas públicas (poucas por loja); Trustpilot com 93% de 5 estrelas e aviso da própria plataforma de que a empresa não convida avaliações recentes.
- Páginas não acessíveis: foodvisor.io (conteúdo renderizado por JS; só o título veio), Numerama, Sciences et Avenir, Reclame Aqui (403), AppBrain (403). Não usei vídeos.
- As medidas de cor são descrições visuais das capturas, sem hex medido.

---

## 9) Fontes

**Oficiais**
- Google Play (vitrine BR, pt-BR, e EUA; descrição, notas, preços, avaliações e 34 capturas baixadas em 13/10/2026): https://play.google.com/store/apps/details?id=io.foodvisor.foodvisor&hl=pt_BR&gl=BR, https://play.google.com/store/apps/details?id=io.foodvisor.foodvisor&hl=en_US&gl=US
- App Store EUA: https://apps.apple.com/us/app/foodvisor-ai-calorie-counter/id1064020872 (avaliações: `?see-all=reviews`)
- App Store Brasil: https://apps.apple.com/br/app/foodvisor-contador-de-calorias/id1064020872
- App Store França (avaliações): https://apps.apple.com/fr/app/foodvisor-calorie-et-r%C3%A9gime/id1064020872?see-all=reviews&platform=iphone
- App Store Story (sequência, widget): https://apps.apple.com/dk/ipad/story/id1809996349
- Central de ajuda (foodvisor.zendesk.com/hc/en-us/…):
  - Categoria Features: /categories/360002609319-Foodvisor-Features
  - Gamificação: /articles/29837275543196
  - Surpresa da semente: /articles/29832610618268
  - Renomear semente: /articles/30241266098460
  - Cores e emojis: /articles/360013181779 (pt-BR: /hc/pt-br/articles/360013181779)
  - Grátis x Premium: /articles/360013600800
  - Preço: /articles/26650824663580
  - Família: /articles/26205926590620
  - Atividade na meta: /articles/29730797711260 e /articles/29730707853340
  - Atividades e Health Connect: /articles/29705431764636
  - Passos: /articles/29703858829724
  - Macros: /articles/14528462985628
  - Refeições extras: /articles/29837551027356
  - CSV: /articles/30362785419420
  - Computador/web: /articles/30574159496348
  - Refeição fora: /articles/30631165940508
  - Adicionar refeição: /articles/360013100720
  - Não reconhecido: /articles/360013101720
  - Quantidade: /articles/360013672119
  - Cru x cozido: /articles/360013601660
  - Editar código de barras: /articles/360013103080

**Imprensa e análises**
- TechCrunch, 14/10/2019: https://techcrunch.com/2019/10/14/foodvisor-automatically-tracks-what-you-eat-using-deep-learning/
- VentureBeat, 2019: https://venturebeat.com/ai/foodvisor-raises-4-5-million-for-its-ai-driven-app-that-helps-track-what-you-eat
- Wikipedia FR: https://fr.wikipedia.org/wiki/Foodvisor
- CFNEWS, 06/01/2026: https://www.cfnews.net/L-actualite/M-A-Corporate/Operations/Majoritaire/Xynergy-avale-une-application-de-suivi-alimentaire-553686
- Garage Gym Reviews (atualizada em 02/06/2026): https://www.garagegymreviews.com/foodvisor-review
- FeastGood, 23/10/2023: https://feastgood.com/foodvisor-review/
- Satu Kyrölainen, "Foodvisor: The Good, the Bad, and the UX", 29/12/2024: http://www.satukyrolainen.com/foodvisor-the-good-the-bad-and-the-ux/
- ScreensDesign (onboarding e paywall): https://screensdesign.com/showcase/foodvisor-calorie-counter
- Kalivia (29/08/2026): https://kalivia.fr/applications/nutrition/foodvisor/
- Progress Form (28/05/2025): https://www.progress-form.fr/foodvisor-avis-test-app/
- Comme un vélo: https://www.commeunvelo.com/avis-foodvisor-compteur-calories/
- The Fitness Theory (2017, patrocinado): https://thefitnesstheory.fr/jai-teste-lapp-foodvisor-tracker-calories-assiette/
- KWCH "App of the day", 27/05/2023: https://www.kwch.com/2023/05/27/what-tech-app-day-foodvisor/
- Uptodown (Android): https://foodvisor.en.uptodown.com/android
- Trustpilot: https://www.trustpilot.com/review/foodvisor.io

**Concorrentes (viés comercial)**
- NutriScan: https://nutriscan.app/blog/posts/foodvisor-worth-it-2026-review-73e3363135
- Nutrola, 19/04/2026: https://nutrola.app/en/blog/foodvisor-review-2026
- Bento Bunny, 12/10/2026: https://www.bentobunny.app/guides/is-foodvisor-free
