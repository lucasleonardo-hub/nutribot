> Anexo do relatório da rodada 1 (13/10/2026). Anonimizado: as pessoas monitoradas aparecem como Pessoa A, B e C e valores reais de saúde foram omitidos.

# B1 — MyFitnessPal (Android/iOS): análise de produto e UX/UI para o NutriBot

Data da pesquisa: 13/10/2026. Para ler este documento:
- **[Oficial]** = central de ajuda (support.myfitnesspal.com, lida artigo por artigo pela API pública do Zendesk), página de preços, lojas, comunicado de imprensa.
- **[Imprensa]** = veículo especializado.
- **[Concorrente]** = blog de app rival. Só entra como indício, nunca como prova.
- **[Usuário]** = avaliação em loja, Trustpilot ou fórum. Só serve para apontar problemas que se repetem.

Não instalei nem usei o app. Toda descrição de tela vem do texto dos artigos oficiais e das lojas. Não vi as imagens das capturas.

---

## 1. Ficha

| Item | Dado | Fonte |
|---|---|---|
| Empresa | MyFitnessPal, Inc. Fundada em 2005. Comprada pela Under Armour em 2015 (US$ 475 mi) e vendida à Francisco Partners em 2020 (US$ 345 mi). CEO: Mike Fisher, desde 2024. Comprou o Intent (planejamento de refeições) e, em março de 2026, o Cal AI (registro por foto), que segue como app separado | Wikipedia; Pulse 2.0, 04/03/2026 |
| Escala declarada | "280 milhões de membros em 120+ países" e "20 milhões+ de alimentos" (números da própria empresa) | Comunicado Winter Release, 24/02/2026 |
| Plataformas | iOS 18+, Android 13+ (somente com Play Store de fábrica), site, Wear OS (só em inglês), Apple Watch | [Oficial] Supported Devices; Wear OS App |
| Versão atual | 26.40.0 na App Store (início de out/2026). Google Play BR "Atualizado em 9 de out. de 2026". Lançamento semanal, quase sempre só "correções de bugs" | App Store US/BR; Google Play BR |
| Notas nas lojas | Google Play BR: 4,8 (2,92 mi avaliações), 100 mi+ downloads, "Contém anúncios". App Store BR: 4,9 (~99 mil) | Google Play BR e App Store BR, lidos em 13/10/2026 |
| Planos | **Free** (com anúncios), **Premium** e **Premium+**. O Premium+ só é vendido em EUA, Reino Unido, Canadá, Irlanda, Nova Zelândia e Austrália; **não existe no Brasil** | [Oficial] Premium+ |
| Preço no Brasil | Site oficial em BRL (13/10/2026): Premium **R$ 31,90/mês** ou **R$ 162,90/ano** ("57% de economia"). A App Store BR lista compras de R$ 31,90 a R$ 329,90 (R$ 82,90 e R$ 329,90 com rótulos de mensal e anual), sem dizer qual oferta vale para quem | myfitnesspal.com/premium?currency=brl; App Store BR |
| Preço nos EUA (referência) | Premium US$ 19,99/mês ou US$ 79,99/ano. Premium+ US$ 99,99/ano | Comunicado de 24/02/2026; App Store US |
| Idioma | Interface em pt-BR (lista oficial de idiomas). **A central de ajuda pt-br tem 0 artigos.** O locale existe, mas o conteúdo está todo em inglês | [Oficial] How to update your preferred language; API do help center (`/hc/pt-br/articles.json` → count 0) |
| Recursos só em inglês | Meal Scan, Voice Log, importador de receitas, app Wear OS. Coach só no iOS e em 6 países anglófonos. Progress Overview e o painel de nutrientes customizável só em 6 países, em inglês. Net Carbs só EUA/CA. GLP-1 só EUA/CA | Artigos oficiais de cada recurso |
| Base brasileira (TACO/TBCA) | **Não verificado.** A empresa disse em 2014 que a tradução de 2013 ampliou a base de alimentos nacionais. A busca pública do site exige login. Nenhuma fonte oficial cita TACO ou TBCA | Baguete (2014); tentativa de busca bloqueada |

**Leitura para o NutriBot:** no Brasil, o MyFitnessPal grátis é um diário manual em português sobre uma base colaborativa. Todos os atalhos de registro com IA (foto, voz) exigem o app em inglês e assinatura. Para o público do NutriBot (3 pessoas no Brasil, registro por foto, texto e áudio em português), o concorrente direto não entrega justamente o que o NutriBot faz.

---

## 2. UX/UI

### 2.1 Navegação e estrutura (versão "Today", 2025-2026)
- **Histórico da mudança.** Teste do novo diário anunciado em 27/08/2025. Rollout forçado da aba **Today** a partir de ~03/10/2025, com anúncio oficial em 15/10/2025. A versão 26.16.0 (abr/2026) ampliou o redesenho com Progress Overview e Coach. A empresa chama a nova interface de "our path forward" e não há opção de voltar ao layout antigo. [Oficial] Your Today tab; consumerrights.wiki (com links para os posts oficiais)
- **Barra inferior** (pelos artigos oficiais): **Today** (à esquerda), **Progress**, **Plans** (só Premium+, à esquerda do +), **botão azul "+"** e **Coach** (à direita, só iOS e Premium). O menu "More" saiu da barra e foi para o ícone de perfil (silhueta) no canto superior direito da Today. [Oficial] Nutrition Coach; Progress Overview
- **Today, de cima para baixo** (texto oficial):
  1. Seletor de dia da semana. Toque num dia ou em "Today" para trocar o dia. Deslizar para os lados muda **semanas inteiras**: o deslize entre dias foi removido, e esse é um dos pontos mais reclamados.
  2. Barra de **calorias consumidas e restantes**. Um emoji aparece nessa barra quando há calorias ganhas com exercício.
  3. **Cartão de macros** no topo. No Free, só a % de calorias de cada macro. No Premium, um toque alterna entre gramas consumidos, gramas restantes e %, e as setas mostram uma quarta vista opcional ("Heart Healthy": gordura saturada, sódio e fibra; "Carb Conscious": carboidrato, açúcar e fibra).
  4. **Seções de refeição** (café, almoço, jantar, lanches) com botão **Log**. Deslizar para a direita sob o nome da refeição repete o que foi registrado ontem naquela refeição. O menu "•••" copia uma refeição inteira. Itens individuais e dias inteiros **não** podem mais ser copiados.
  5. "View All / View Diary": visão do dia inteiro em lista. É o substituto do antigo diário de uma tela só.
  6. "Complete Diary" (fechar o dia).
  7. **Healthy Habits**: água, exercício (com o ajuste de calorias do relógio) e passos.
  8. Último **peso**, no rodapé. Tocar abre o progresso de peso.
  9. "Streaks view" (sequência de dias registrados).
  Fonte: [Oficial] Your Today tab (atualizado em 02/10/2026).
- **Progress** (aba própria desde 26.16.0, só para inglês e 6 países): semana em cards de **Calorias** (consumo diário × meta), **Peso** (gráfico ao longo do tempo), **Macros** (dicas de ação só no Premium) e **Reports**. "Everything updates as you log." [Oficial] Introducing Progress Overview
- **Gráficos de pizza**: tocar no cartão de calorias abre a pizza das calorias por refeição. Tocar no cartão de macros abre a pizza dos macros do dia (na visão semanal vira gráfico). O artigo oficial insiste que a pizza mostra **proporção** e não quanto falta, e usa o exemplo de "97% gordura" depois de uma colher de manteiga. Ou seja, o próprio suporte precisa explicar o gráfico. [Oficial] What does the Pie Chart represent

### 2.2 Hierarquia visual, tipografia, cores e iconografia
- O que se verifica nos textos oficiais: botão principal "**blue plus (+)**", botão de disparo redondo azul no Meal Scan, faixa amarela do Premium, ícone de lápis para nova conversa no Coach e emoji na barra de calorias. Há **modo escuro**: as versões 26.20 e 26.25 corrigem o botão Log e o Meal Scan/Voice Log no tema escuro. [Oficial]; App Store, histórico de versões
- Tipografia e paleta exatas: **não verificado**, porque não vi as imagens. Um review descreve a interface como "very text-heavy", com fonte pequena e visual datado, e dá nota 2/5 em design. Esse review é anterior ou paralelo ao redesenho, atualizado em 29/07/2026. [Imprensa/afiliado] choosingtherapy.com
- Reclamações sobre a nova hierarquia: **negrito em lugares estranhos**, semana começando no domingo (a configuração existe no iOS e ainda está chegando ao Android) e informação nutricional mais difícil de achar. [Imprensa] PiunikaWeb, 05/05/2026; [Oficial] Your Today tab

### 2.3 Densidade de informação e facilidade de achar
- **Antes:** o diário mostrava o dia inteiro, com todos os itens e totais fixos no topo.
- **Agora:** um card por refeição, que precisa ser aberto. A avaliação mais útil da Google Play BR (11 votos) diz: *"O grande diferencial do app sempre foi a simplicidade e a visualização rápida de todas as refeições sem precisar clicar uma por uma"* (Thamires Yasmin, 08/09/2026). Outra: *"com a informação de consumo total de macros que estava sempre fixo no topo da tela… A atualização removeu essas 2 funções"* (Antonio S, 18/08/2026, sobre a 26.31). [Usuário] Google Play BR
- O próprio suporte publica um artigo "Commonly Missed Features", que admite que recursos são difíceis de achar. Várias funções só existem no **site**: medidas extras, ajuste negativo de calorias, relatório imprimível e restaurar itens apagados das listas. [Oficial]

### 2.4 Onboarding
- Pede idade, altura, peso, sexo, nível de atividade, ritmo semanal desejado e peso-meta. O peso-meta "só serve para relatar quanto falta" e não entra na conta de calorias. [Oficial] How does MyFitnessPal calculate my initial goals
- Mostra uma **data aproximada** para chegar à meta **uma única vez**. Depois não guarda data-alvo, "porque cumprir uma data pode exigir perda mais rápida que o saudável". [Oficial] Where can I find my target date
- Pergunta se a pessoa usa GLP-1 e, se sim, liga o rastreador (só EUA/CA). [Oficial] GLP-1 Support
- Termina oferecendo teste grátis do Premium. [Imprensa] choosingtherapy

### 2.5 Feedback ao registrar e elementos lúdicos
- **Quick Log:** o "+" ao lado de cada resultado registra na hora, com aviso de sucesso, e permite continuar adicionando. [Oficial] Quick Log
- **Diary Food Insights:** dica nutricional contextual ao registrar certos alimentos, baseada em revisão de nutricionista. Dá para desligar. [Oficial]
- **Complete Diary:** projeção do peso em **5 semanas** "assumindo que cada dia será igual a este" e aviso de comer pouco abaixo de 1.200 kcal (mulheres) ou 1.500 kcal (homens). Abaixo de 1.000/1.200, não projeta nada. [Oficial] Complete This Entry
- **Streaks:** duas sequências, login e registro de comida. O usuário pode corrigir a de login por um formulário. [Oficial] How to fix an incorrect streak
- **Progress Bar / Nutrition Score** (só EUA): barra até 100% que combina adesão a 13 nutrientes com "Engagement Score". Ela não desce, salvo se a pessoa apagar comida. Se a pessoa registrar em outro dia, conta no dia do consumo, "para não incentivar burlar o sistema". [Oficial] Progress Bar FAQ
- Animações: **não verificado**.

### 2.6 Acessibilidade
- Há suporte a texto grande: a versão 26.35 corrige o aviso de GLP-1 cortado em tamanhos grandes. Não há documentação oficial de leitor de tela nem de contraste: **não verificado**. Esconder dados atrás de toques (cards fechados, totais que rolam com a tela) piora a vida de quem quer conferir números rapidamente, conforme as avaliações acima.

### 2.7 O que é intuitivo e onde complica
- **Intuitivo:** um "+" único que concentra todos os modos de registro (busca, código de barras, Meal Scan, voz, Quick Add, peso, exercício, água). Listas Recentes e Frequentes automáticas. "Repetir a refeição de ontem" com um deslize. O app promete registro "em 30 segundos" depois de alguns dias de uso.
- **Complexo demais:** três planos com mais de 20 recursos travados (tabela oficial). Configurações espalhadas entre app e site. Duas sequências diferentes. Calorias líquidas com ajuste de relógio positivo e negativo. O suporte precisa de artigos explicando a pizza e o "Based on" da tela de ajuste.

---

## 3. Funcionalidades

Na coluna de relevância, a pergunta é: faria sentido no NutriBot (WhatsApp, 3 pessoas, IA, Health Connect)?

| Recurso | Como funciona | Evidência | Problema que resolve | Relevância para o NutriBot |
|---|---|---|---|---|
| Registro manual por busca | Busca na base, escolha de porção e "Log". Quick Log ("+") registra com a porção atual. Sugestões de busca enquanto digita (v23.3+) | [Oficial] Quick Log; Suggested Searches | Achar e registrar rápido | **Baixa** na forma: o NutriBot recebe texto livre. **Média** na ideia: a porção "atual" (última usada) vira padrão |
| Recentes, Frequentes, My Meals | Listas automáticas por frequência. Refeições salvas. Deslize repete a refeição de ontem. Cópia por refeição. Multi-Day Logging (até 7 dias, Premium) | [Oficial] Recent/Frequent; Your Today tab; Multi-Day Logging | Rotina repetitiva custa poucos toques | **Alta**: "igual ontem no café" ou "o de sempre" por mensagem e um "repete" vindo do histórico da pessoa. O NutriBot tem o histórico e não precisa de tela |
| Quick Add | Calorias diretas sem busca (grátis). Macros no Quick Add (Premium). Não aceita rótulo, só nota | [Oficial] Quick Add | Registrar quando só se sabe o número | **Média**: "300 kcal de lanche na rua" como registro de baixa confiança, marcado como tal |
| Código de barras | Câmera traseira lê o código e puxa o item da base. **Premium desde 01/10/2022**. Se o produto não existe, o usuário cria pelo rótulo e ele fica salvo | [Oficial] How to use the Barcode Scanner | Industrializados sem digitar | **Média**: foto do código ou do rótulo no WhatsApp funciona hoje via visão. A base de códigos BR é o gargalo (Open Food Facts é opção, mas não verifiquei) |
| Meal Scan (foto) | "+", Meal Scan, foto (ou upload no iOS), **lista de sugestões**, a pessoa escolhe cada item e ajusta a porção, depois "Add more" busca o que faltou. Visão computacional "treinada em milhões de fotos" sugere itens da base verificada. Premium, Android 13+/iOS 18+, **app em inglês**, sem site | [Oficial] How to use the Meal Scanner (16/09/2026); Passio (parceira) | Registrar prato montado sem buscar item a item | **Alta**, como contraste: o MFP trata a foto como "ponto de partida, não resposta final" e põe o usuário para escolher em lista. O NutriBot já estima porções. Vale copiar a frase de humildade e o passo "faltou algo?" |
| Upload de foto para registrar depois | Fotografa o prato e registra mais tarde (iOS, Premium) | Comunicado de 24/02/2026 | Registro atrasado sem perder a refeição | **Alta**: o NutriBot já aceita foto atrasada. Copiar a semântica de "registrar depois com a hora da foto" |
| Voice Log | Fala livre ("For breakfast, I had…"), lista de itens (cada um vira uma entrada separada), ajuste item a item e "Log". Não registra My Foods, receitas, Quick Add, peso, exercício nem água. Precisa de internet, Premium e inglês | [Oficial] How to log food with your voice. Segundo resumo de busca do case da Tribe AI, a extração é feita por LLM (Claude via Bedrock); **não li o case diretamente** | Registro com as mãos ocupadas | **Alta**: o NutriBot faz isso por áudio no WhatsApp. Lição: separar cada alimento numa entrada editável e dizer o que a voz **não** faz |
| Base de alimentos | "19 mi" (Check Marked), "20,5 mi" (lojas) ou "22 mi" (Today tab): números oficiais que não batem entre si. Mistura itens da empresa com itens de usuários, que "podem adicionar e compartilhar" | [Oficial] Where does MFP get its food data; Check Marked items | Cobertura enorme, inclusive restaurantes e marcas | **Média**: para 3 pessoas no Brasil, uma base curada (TACO/TBCA + rótulos das marcas que elas compram) vale mais que milhões de entradas duplicadas |
| Selo de verificação (check mark) | Marca o item "revisado ou adicionado pelo MFP e considerado preciso", mas "itens com selo também podem ter erros" e itens sem selo "não são necessariamente errados". Botão "Report Food" com 6 motivos, revisão humana, correção não imediata | [Oficial] Check Marked items; How to report incorrect food | Sinalizar confiança | **Alta**: o NutriBot deveria marcar a **origem** de cada valor (TACO, rótulo, estimativa da IA) e aceitar "esse valor está errado" |
| Importador de receitas | Cola o link da receita, a IA casa os ingredientes com a base, a pessoa revisa e define porções. Só em inglês. "Bulk import" de lista de ingredientes | [Oficial] Recipe Importer | Receita caseira sem digitar ingrediente | **Média**: "receita da Pessoa C: link ou lista", dividida por porções. Útil para panela que dura vários dias |
| Cálculo de kcal e macros | Soma da base. Pizza por calorias (4/4/9 kcal/g). Macros em % (Free) ou gramas (Premium). Metas por refeição e por dia da semana (Premium) | [Oficial] Pie Chart; Macro Goals by Meal; Calorie Goals by Meal | Equilíbrio do dia e de cada refeição | **Média**: a meta por refeição ajuda a "corrigir no almoço em vez de na hora de dormir", palavras do próprio artigo. O NutriBot pode avisar no meio do dia sem criar metas novas |
| Micronutrientes | Dezenas de nutrientes por item. Painel "Heart Healthy"/"Carb Conscious" (Premium, inglês). Medidas extras só pelo site | [Oficial] Customize Nutrient Dashboard; Progress Bar FAQ | Quem acompanha sódio, fibra, açúcar | **Baixa** agora: a própria empresa admite que "muitos alimentos da base não têm" vitaminas e ferro. Micronutriente sobre base incompleta vira número falso |
| Histórico e edição | Editar ou apagar entradas. Mudar a meta não reescreve dias passados. Peso uma vez por dia. Peso inicial editável | [Oficial] Can I change my calorie goal without affecting history; Starting Weight FAQs | Corrigir sem perder histórico | **Alta**: "a meta de cada dia é a meta que valia naquele dia" é a regra certa para o veredito. Confirmar que o NutriBot guarda a meta por dia |
| Timestamps | Horário por item, desligado por padrão (Premium). "No Time" permitido. Itens do mesmo instante são agrupados | [Oficial] Food Timestamps | Ver efeito do horário das refeições | **Média**: o NutriBot já guarda a hora. Copiar o "sem hora" explícito em vez de inventar uma |
| Metas | Fórmula de manutenção (não divulgada) pelo nível de atividade (PAL), menos ou mais o ritmo semanal (até 2 lb/sem para perder, 1 lb/sem para ganhar). Pisos de 1.200 kcal (mulheres) e 1.500 kcal (homens). Recalcular é **oferecido a cada 10 lb** (~4,5 kg) perdidas. Macros padrão 50/20/30 | [Oficial] initial goals; updated nutrition goals; force goals to update; target date | Meta inicial sem nutricionista | **Média**: o NutriBot já calibra pela balança. O que vale copiar são os **pisos de segurança** e a regra de não prometer data |
| Calorias líquidas e exercício | Meta em calorias líquidas (comida − exercício). Exercício registrado devolve calorias no dia, divididas pelos macros. Premium pode desligar. Exercício por METs com o peso do perfil. Força não gera calorias | [Oficial] Net Calories; Why goal changes when you log exercise; exercise calories | Comer mais em dia ativo | **Média**: é o ponto onde o NutriBot já viu o relógio superestimar. O MFP deixa desligar a devolução; o NutriBot deveria usar o gasto medido com desconto, como já faz |
| Ajuste de calorias pelo relógio | O parceiro de "Total Daily Calorie" manda o gasto real até a hora atual. O MFP **projeta o resto do dia** pelo ritmo até ali e compara com a própria estimativa (meta + déficit + cardio, sem dupla contagem). A diferença vira um exercício chamado "Calorie Adjustment". Positivo por padrão. **Negativo só por opção no site**, recomendado só para quem usa o relógio o dia todo e sincroniza várias vezes. Tela com a decomposição A/B/C/D | [Oficial] Understanding your Calorie Adjustment; Negative Calorie Adjustments; Total Daily Calorie partners | Meta do dia que acompanha a atividade real | **Alta**: é a mesma decisão do NutriBot (relógio cru × registro). Copiar a **decomposição explícita** e a **projeção do dia parcial**. Assimetria positivo/negativo por padrão: não copiar, porque infla a meta |
| Health Connect (Android 10+, app 22.22+) | **Envia** calorias comidas (resumo por refeição, não por alimento), água e cardio. **Recebe** passos, sono e glicose (Dexcom G6). A tabela oficial **não lista peso** entre os dados recebidos do Health Connect, só do Google Health. Uma fonte de passos por vez. Não liga ao mesmo tempo que o Google Health, "para não contar passos duas vezes". Sincroniza periodicamente ou à força pelo menu. Dados antigos não sincronizam | [Oficial] Health Connect FAQ; The difference between Google Health and Health Connect (12/10/2026) | Integrar relógio e balança | **Alta**: regra de **uma fonte por tipo de dado** e aviso explícito de dupla contagem. Conferir se o NutriBot deduplica Health Connect × app do relógio |
| Outras integrações | 35-40+ parceiros (Garmin, Samsung Health, Google Health/Fitbit, Apple Health, Withings, RENPHO etc.). Balança parceira sincroniza peso (1 casa decimal) e % de gordura | [Oficial] Scale partners; Supported apps | Hub de dados | **Baixa** além do Health Connect, para 3 pessoas |
| Peso, medidas e fotos | Peso uma vez por dia. Gráfico por período ("1 mês", "desde o peso inicial"). Fotos de progresso privadas, recortadas em quadrado e ligadas à pesagem. Medidas extras (gordura %, pressão, glicemia) **só pelo site**. **Recomenda pesar 1 vez por semana**, sempre nas mesmas condições | [Oficial] record weight; How often should I record; Progress Photos FAQs; additional measurements | Acompanhar o corpo | **Média**: o gráfico do MFP é simples. O NutriBot já faz mais (regressão + IC). A recomendação semanal do MFP contradiz a pesagem diária que dá precisão. Ver seção 4 |
| Tendências e projeções | Projeção de 5 semanas no "Complete Diary" (repete o dia atual). Data-alvo só no cadastro. Progress Overview mostra a "trend" do mês. Nenhum artigo oficial descreve suavização (média móvel ou EMA) | [Oficial] Complete This Entry; target date; Progress Overview | Motivação | **Alta**, como anti-exemplo: projeção que supõe "todo dia igual a hoje" é exatamente o erro que o NutriBot corrigiu com o veredito por tendência medida |
| Relatórios | **Weekly Digest** gerado num horário fixo de domingo (foto do momento, atualizada se a pessoa registrar depois): calorias da semana × meta semanal, 3 alimentos mais frequentes (empate vai para o mais calórico), exercício, previsão da sequência e "Food Group Insights" (vegetais, frutas, proteínas, doces/snacks, álcool). Free vê os 2 últimos | [Oficial] Weekly Digest | Revisão semanal | **Alta**: o NutriBot já tem domingo. Os "grupos" (doces, álcool, vegetais) e os "mais frequentes" são leitura de hábito barata e útil por mensagem |
| Exportação e compartilhamento | Premium: 3 CSV por e-mail num ZIP (nutrição por refeição com timestamps, progresso/medidas, exercício com passos e gasto do relógio). Free: relatório imprimível no site e diário compartilhado (o profissional precisa ter conta) | [Oficial] Export your data; share your diary | Levar dados ao nutricionista | **Média**: um "!exportar" em CSV/planilha para o nutricionista das 3 pessoas. O NutriBot já tem planilha |
| Coach (IA conversacional) | Aba Coach. Lê o diário (hoje + "últimas semanas"), metas, refeições e receitas salvas, base, receitas do MFP e passos. **Não registra comida, não muda metas, "não acessa histórico de peso (ainda)"**. Sugere perguntas prontas e de continuação. Conversa salva, lápis para recomeçar. Premium, iOS, inglês, 6 países. Diretrizes USDA/NIH/CDC. Aviso "AI-generated… watch out for mistakes". A versão 26.40 aceita várias imagens num prompt | [Oficial] Introducing Nutrition Coach; App Store 26.40; [Imprensa] 9to5Mac, 16/06/2026 | Transformar o diário em decisão ("o que como com 400 kcal e 20 g de proteína faltando?") | **Alta**: é o que o NutriBot é. Lição: **lista pública do que a IA lê e do que não faz**. Notável: o Coach do MFP **não vê o peso**, e o NutriBot vê |
| Progress Overview | Visão semanal de calorias, peso, macros (dicas no Premium) e relatórios. "Não registra, não muda metas, não é conselho médico." Recomenda conferir uma vez por semana | [Oficial] Introducing Progress Overview | Ver padrão sem abrir dia a dia | **Média**: equivale ao !progresso. Copiar o bloco "o que isto não faz" |
| Hábitos semanais | Uma meta de hábito por 7 dias (mais proteína, mais vegetais, mais água), feita com nutricionistas e no formato SMART. Grátis em territórios anglófonos | Comunicado Winter Release 2025 (resumo de busca; o press release não abriu) | Mudança de comportamento pequena | **Média**: "esta semana: proteína no café" combina com o formato de bot |
| Lembretes | Lembrete por refeição "se eu ainda não registrei", com horário próprio. Vários lembretes. Só no app | [Oficial] How to set up logging reminders | Esquecimento | **Alta**: condicionar o lembrete a **não ter registrado** é o que evita incomodar à toa. O NutriBot tem proatividade e deve usar essa condição |
| Jejum intermitente, Net Carbs, GLP-1 | Timer de jejum (Premium). Net Carbs = carbo − fibra − poliol (EUA/CA). GLP-1: dose, local de aplicação, lembrete e efeitos colaterais com gravidade (EUA/CA, inglês) | [Oficial] artigos correspondentes | Nichos de dieta e medicação | **Baixa**, salvo se alguma das 3 pessoas usar GLP-1. Nesse caso o modelo de "dose + efeitos colaterais + comida no mesmo dia" é bom |
| Meal Planner (Premium+) | Semana de refeições por meta, orçamento e tempo. 1.500+ receitas, lista de compras, Instacart (EUA). Não vendido no Brasil | [Oficial] Premium+; Meal Planner | Decidir o que comer | **Baixa** |
| Grátis × pago | Free: registro de comida e exercício, peso e medidas, receitas, macros em %, metas em % (passos de 5%), integrações, relatório no site. **Pago:** código de barras, Meal Scan, Voice Log, macros em gramas, metas por dia/refeição, exportação, sem anúncios, painel e timestamps | [Oficial] The difference between Free, Premium and Premium+ (05/10/2026) | Monetização | **Média**: o paywall do código de barras é a reclamação nº 1 (ver seção 6). Sinal de que o atrito de registro é o que o usuário mais valoriza |
| Sincronização e offline | Contas sincronizam app e site. Reinstalar sem sincronizar perde dados ("qualquer informação não sincronizada será perdida") | [Oficial] Health Connect FAQ; Known Issues Android | Multi-dispositivo | **Média**: o NutriBot é servidor-primeiro. Um app Android futuro precisa de fila offline que não perca registro |
| Comunidade, amigos, grupos | Fóruns, grupos, diário público ou para amigos | [Oficial] vários | Motivação social | **Baixa**: 3 pessoas que já se conhecem num grupo de WhatsApp |

---

## 4. Cálculos e qualidade de dados

### 4.1 Meta de calorias
- **O que o oficial diz:** a manutenção vem de idade, altura, peso, sexo e "nível de atividade diária normal, sem exercício opcional". Depois se subtrai ou soma o ritmo semanal. A empresa diz que o cálculo "se alinha aos valores de PAL do Institute of Medicine (IOM)" e que os níveis Lightly Active, Active e Very Active ganharam "aumento modesto". A equação de metabolismo basal **não é divulgada** em nenhum dos 254 artigos da central. [Oficial] initial goals; updated nutrition goals
- **Indício não oficial:** uma resposta atribuída à equipe do MFP no Reddit lista PAL 1,4 / 1,6 / 1,8 / 2,0 (Sedentary, Lightly Active, Active, Very Active). Não consegui abrir o post. **Não verificado.**
- A suposição de que a base é Mifflin-St Jeor vem só de blogs: **não verificado**.
- **Atualização:** a meta muda quando o peso do perfil muda. O app oferece recalcular a cada 10 lb registradas. Para forçar o recálculo pelo app, o artigo oficial manda **trocar o peso atual para um valor errado, salvar e voltar ao valor certo**. É uma gambiarra documentada. A mudança vale daqui para frente, sem reescrever a meta de dias passados. [Oficial] force goals to update; change calorie goal without affecting history
- **Transparência:** a empresa admite que as metas se baseiam em médias estatísticas e diz que "milhões de usuários demonstraram que são precisas o bastante". Para precisão, recomenda o relógio.

### 4.2 Gasto energético e o relógio
- O ajuste diário compara o gasto **projetado para o dia inteiro** (real até agora + estimativa do resto, pelo ritmo até ali) com o total do MFP (meta + déficit planejado + cardio registrado). A diferença vira um exercício "Calorie Adjustment" recalculado a cada sincronização. À meia-noite, projetado e real coincidem. [Oficial] Understanding your Calorie Adjustment; Total Daily Calorie partners
- O ajuste negativo só existe como opção no site. O próprio artigo recomenda deixá-lo **desligado** para quem sincroniza tarde. Essa assimetria deixa a meta subir e nunca descer, e favorece comer mais.
- Há um bug conhecido na tela: o "Based on" aparece errado para Google Fit, Samsung Health e Apple. A empresa diz que a projeção total está certa. [Oficial]
- Exercício manual é estimado por METs × peso do perfil. Calorias de musculação não são calculadas. [Oficial]

### 4.3 Peso: tendência, médias e incerteza
- **Não há** descrição oficial de suavização, média móvel, regressão ou intervalo de confiança. O que existe:
  - gráfico de peso por período e "como o peso mudou ao longo do tempo" (Progress Overview);
  - **peso inicial** como referência de "quanto perdeu", editável, e ao editar "atualizamos o app inteiro";
  - **projeção de 5 semanas** supondo todos os dias iguais ao dia fechado, "só para motivação", "muitos perdem mais que o projetado, alguns menos";
  - **recomendação de pesar 1 vez por semana**, mesmo dia e mesma hora, porque o peso "oscila bastante de um dia para o outro". O app aceita no máximo uma pesagem por dia.
- **Leitura:** o MFP resolve o ruído da balança pedindo menos dados, ou seja, uma pesagem semanal. O NutriBot resolve com mais dados e estatística. Com uma pesagem por semana, qualquer regressão de 28 dias tem 4 pontos e IC largo. O NutriBot já viu isso no piso de suficiência (4 pesagens em 21 dias).
- **Dados incompletos:**
  - um "dia completo" é escolha do usuário ("Complete Diary"), e a sequência conta qualquer dia com pelo menos um alimento;
  - o Weekly Digest é uma foto de domingo que se atualiza se a pessoa registrar dias atrasados;
  - no Progress Bar, registro feito depois conta no dia do consumo;
  - **nenhum** artigo descreve como dias sem registro entram nas médias semanais: **não verificado**.

### 4.4 Origem e qualidade dos dados de alimentos
- **Mistura empresa + usuários.** O suporte reconhece no artigo do Progress Bar que há alimentos com "100000 calorias e 16000 g de potássio" e muitos sem vitamina A e ferro, e recomenda escolher "Verified" ou "Best match", conferir antes de registrar e usar o código de barras. [Oficial] Progress Bar FAQ
- O selo de verificação não garante nada, nas palavras do próprio suporte. [Oficial] Check Marked items
- Um estudo de caso de fornecedor diz que o MFP passou a usar a base **Nutritionix** porque não conseguia verificar as entradas colaborativas no ritmo em que chegavam (Syndigo). Material promocional: **não verificado oficialmente**.
- Auditoria de concorrente (Nutrola, 12/04/2026): 38 a 67 entradas por alimento comum e amplitude de 27 a 105 kcal na mesma porção. Amostra pequena e método opaco: só indício.
- **Brasil:** TACO e TBCA não aparecem em nenhuma fonte oficial. A cobertura de produtos nacionais e de códigos de barras BR **não foi verificada**, porque a busca exige login.

### 4.5 Transparência das recomendações
- **Boas práticas:**
  - o Coach declara quais dados lê, o que não faz e quais diretrizes segue;
  - o Progress Overview diz o que não faz;
  - o Meal Scan se apresenta como "ponto de partida";
  - os pisos de 1.200/1.500 kcal são justificados pelo NIH;
  - há página de recursos sobre transtornos alimentares, com um grupo citado para o Brasil.
- **Pontos opacos:** a fórmula de metabolismo basal, o critério do selo, o algoritmo do Meal Scan (só "machine learning e visão computacional") e a ausência de qualquer incerteza mostrada ao usuário, seja na meta, no gasto ou no peso.

---

## 5. Pontos fortes
1. **Atrito mínimo para o que se repete:** Recentes e Frequentes automáticos, Quick Log com "+", deslize para repetir a refeição de ontem, Multi-Day Logging, refeições salvas. O app promete "logar em 30 segundos" depois de alguns dias. Avaliação de 245 votos na Play BR elogia que o app "guarda a última medida de cada alimento adicionado".
2. **Amplitude da base**, inclusive restaurantes e marcas. É elogiada até nas avaliações negativas (Unstar, 27/07/2026). A mesma avaliação BR destaca porções por gramas e por unidade "pra quem não tem balança".
3. **Ajuste pelo relógio bem engenhado e documentado:** projeção do dia parcial, prevenção de dupla contagem, decomposição visível e "uma fonte de passos por vez".
4. **Integrações amplas**, Health Connect com documentação de direção por tipo de dado.
5. **Linguagem honesta nos artigos novos** sobre limites da IA (Meal Scan, Coach, Progress).
6. **Revisão semanal** (Weekly Digest) com regras claras: snapshot de domingo, desempate e grupos de alimentos.

## 6. Pontos fracos e reclamações recorrentes
1. **Redesenho "Today" (out/2025 a abr/2026):** o dia não aparece mais de uma vez, os totais não ficam fixos, há mais toques, a cópia de itens individuais sumiu e o deslize entre dias também. A empresa recusa reverter.
   - Google Play BR: Thamires Yasmin (08/09/2026) e Antonio S (18/08/2026).
   - Trustpilot: "Since the Diary was replaced by Today, everything is spread across different screens" (05/10/2026).
   - PiunikaWeb (05/05/2026). consumerrights.wiki, com links para os threads do Reddit.
   - MyNetDiary, concorrente: nota mensal na App Store US caiu para 1,82 em maio/2026.
2. **Paywall do código de barras (desde 10/2022)** e de outros recursos que eram grátis, como macros em gramas e o percentual que voltou ao Free.
   - Unstar: 29% das 202 avaliações negativas na Play US citam paywall, 13% citam o leitor.
   - Trustpilot: "Also paywalled barcode scanning for new customers" (29/09/2026).
3. **Qualidade da base colaborativa:** duplicatas, valores errados, nutrientes faltando, inclusive em itens lidos por código de barras. O próprio suporte admite, e a Trustpilot repete: "Some scanned foods are incorrect so you need to check before selecting" (11/10/2026). Pesquisa de 2024 citada por concorrente (Banal et al., BMJ NPH) achou subestimação de energia: só indício.
4. **Sincronização e confiabilidade:**
   - Known Issues Android: dados que não sincronizavam do Android para a web, corrigido em 26.18.2.
   - Login pelo Facebook travado.
   - Unstar: 8% citam logout com perda de histórico, 10% citam relógio "conectado mas sem dados".
   - O suporte manda reinstalar o app, avisando que dados não sincronizados se perdem.
5. **Anúncios** no Free, inclusive em tela cheia (Unstar 9%; MyNetDiary).
6. **Desigualdade regional:** IA, Coach, Progress Overview e painel novo só em inglês e em 6 países. Ajuda pt-br vazia. Premium+ não vendido no Brasil. Para quem está no Brasil, o produto é a versão de 2022.
7. **Meta estática e projeção ingênua:** meta só muda com o peso do perfil (oferecida a cada 10 lb, forçada com gambiarra). Projeção de 5 semanas "todo dia igual a hoje". Nenhuma leitura de comida × balança. Concorrente (Fitia) critica a meta estática que causa platô: só indício.
8. **Risco para transtorno alimentar** apontado por review (choosingtherapy). Mitigado em parte pelos pisos e pela página de recursos.

## 7. O que o NutriBot deveria aprender daqui

1. **Nunca esconder o dia inteiro atrás de cliques: o resumo do dia deve caber numa mensagem.** A maior crise do MFP veio de trocar "ver todas as refeições e os totais de uma vez" por cards. No NutriBot, o equivalente é o !hoje ficar sempre completo e estável: todas as refeições com kcal, total e restante no topo. E qualquer mudança no formato de mensagens recorrentes deve ser **opcional ou gradual, com caminho de volta**, nunca imposta.

2. **Tratar a IA como "ponto de partida" e quebrar em itens editáveis.** Meal Scan e Voice Log transformam a entrada em **uma entrada por alimento**, cada uma ajustável antes de salvar, com "Add more" para o que a câmera não viu. No WhatsApp, isso vira resposta itemizada ("1) arroz 150 g ~195 kcal; 2) feijão…") com correção por número ("2 era 1 concha") e a pergunta "faltou algo?". Também vale declarar o que a voz e a foto **não** fazem.

3. **Mostrar a origem e a confiança de cada número, e aceitar "isso está errado".** O selo do MFP não garante nada e a base colaborativa é a reclamação perene. O NutriBot pode fazer melhor com uma base pequena e curada (TACO/TBCA + rótulos das marcas que as 3 pessoas compram), marcando cada valor como TACO, rótulo ou estimativa da IA. Uma correção do usuário vira regra pessoal na hora, sem fila de revisão.

4. **Copiar a decomposição do ajuste do relógio e não copiar a assimetria.** O MFP projeta o gasto do dia parcial pelo ritmo até agora e mostra a conta em partes. Para evitar dupla contagem, aceita uma fonte por tipo de dado (Health Connect ou Google Health, nunca os dois). Isso é útil para o "!hoje" do NutriBot e para a deduplicação Health Connect × app do relógio. Já o "positivo sempre, negativo só se pedir" infla a meta; o NutriBot deve continuar com o gasto calibrado pela balança.

5. **Publicar a lista do que a IA lê e do que não faz.** O Coach do MFP diz: lê diário, metas, receitas e passos; não registra, não muda metas, não vê peso. No NutriBot, um "!sobre" ou a primeira mensagem do dia poderia dizer o que o bot usa (fotos, relógio, balança) e o que ele não faz (não muda a meta sozinho, não dá conselho médico). Isso reduz respostas fora de escopo e sustenta a confiança quando o veredito diverge do que a pessoa sente.

6. **Lembretes e revisão semanal condicionados ao comportamento.** O lembrete do MFP dispara "se eu ainda não registrei [refeição]". O Weekly Digest sai num horário fixo de domingo, se atualiza com registros atrasados, mostra os 3 alimentos mais frequentes e agrupa a semana em vegetais, frutas, proteínas, doces/snacks e álcool. São leituras de hábito baratas e boas para mensagem. O NutriBot já tem o domingo; vale acrescentar os grupos e os "mais frequentes" e garantir que a proatividade nunca cobre quem já registrou.

7. **Onde o NutriBot já está à frente, manter e explicar: peso por tendência medida, não projeção ingênua.** O MFP pede pesagem semanal, projeta 5 semanas supondo "todo dia igual a hoje", não mostra incerteza e só recalcula a meta a cada ~4,5 kg. O NutriBot tem regressão com IC, veredito pelo ritmo medido e comida × balança. Mas o conselho do MFP (mesmo horário, mesmas condições) e os **pisos de segurança** (1.200/1.500 kcal, aviso de comer pouco, recurso para transtorno alimentar) merecem entrar. O NutriBot deve também deixar claro quantas pesagens por semana tornam o veredito possível.

---

## 8. Não verificado e limitações
- **Telas reais:** não instalei o app nem vi as imagens. Cores, tipografia, ícones, animações e o layout exato (anéis × barras) estão **não verificados**. A descrição da Today vem só do texto oficial. "Barra de calorias restantes" está no texto ("calories remaining bar"); a forma gráfica do cartão de macros não é descrita.
- **Fórmulas:**
  - equação de metabolismo basal e valores exatos de PAL: não divulgados (os números 1,4/1,6/1,8/2,0 vêm de um post do Reddit que não abri);
  - método do gráfico e da "trend" de peso: não descrito em nenhum artigo;
  - algoritmo do Meal Scan: só "ML e visão computacional" (parceria com a Passio, segundo a Passio);
  - modelo do Voice Log: só por resumo do case da Tribe AI (Claude via Bedrock), que não abri diretamente.
- **Base brasileira:** a busca pública exige login, então não verifiquei TACO/TBCA nem a cobertura de produtos e códigos de barras nacionais.
- **Preço BR:** o site mostra R$ 31,90/mês e R$ 162,90/ano (13/10/2026). A App Store BR lista também R$ 82,90, R$ 129,90 e R$ 329,90 sem dizer a qual oferta cada um corresponde. Pode haver teste A/B de preço ou preço de entrada.
- **Inconsistências oficiais:**
  - tamanho da base: 19 mi, 20,5 mi ou 22 mi conforme o artigo;
  - Health Connect: o FAQ de julho/2026 diz que o cardio de terceiros entra no MFP; a tabela de 12/10/2026 lista só passos, sono e glicose como recebidos;
  - Meal Scan: a App Store fala em "Meal Scan launch" na 26.22 (jun/2026), mas o recurso existe pelo menos desde 2020 (o id do artigo é de 2020), o que sugere relançamento.
- **Datas do redesenho:** variam entre fontes (out/2025, mar/2026, abr/2026). O suporte oficial confirma o formulário "April 2026 New App Design Feedback".
- **Notas e percentuais de reclamação:** MyNetDiary e Nutrola são concorrentes; Unstar é um terceiro com amostra de 300 avaliações dos EUA. Servem como indício de problemas que se repetem, não como medida.
- **Páginas que falharam:** myfitnesspal.com/features (403), comunicados em agregadores (410/403), Reddit (espelhos fora do ar), Android Authority (403), case completo da Tribe AI.

## 9. Fontes

**Oficiais: central de ajuda** (support.myfitnesspal.com/hc/en-us, lidas em 13/10/2026; entre parênteses, a data de atualização de cada artigo):
- Your Today tab (02/10/2026): https://support.myfitnesspal.com/hc/en-us/articles/39985611667341-Your-Today-tab
- New App Experience: Today Tab and More: https://support.myfitnesspal.com/hc/en-us/articles/45276346234637
- Introducing Progress Overview: https://support.myfitnesspal.com/hc/en-us/articles/45246617814669
- Introducing Nutrition Coach: https://support.myfitnesspal.com/hc/en-us/articles/45212266254221
- How does MyFitnessPal calculate my initial goals?: https://support.myfitnesspal.com/hc/en-us/articles/360032625391
- A Message about MyFitnessPal's updated nutrition goals: https://support.myfitnesspal.com/hc/en-us/articles/360032626031
- What are Net Calories?: https://support.myfitnesspal.com/hc/en-us/articles/360032273692
- Understanding your Calorie Adjustment: https://support.myfitnesspal.com/hc/en-us/articles/360032623871
- Negative Calorie Adjustments: https://support.myfitnesspal.com/hc/en-us/articles/360032272152
- Total Daily Calorie partners: https://support.myfitnesspal.com/hc/en-us/articles/360032624171
- How step tracking works: https://support.myfitnesspal.com/hc/en-us/articles/360032273612
- Health Connect FAQ and Troubleshooting: https://support.myfitnesspal.com/hc/en-us/articles/10553948248973
- The difference between Google Health (Fitbit) and Health Connect: https://support.myfitnesspal.com/hc/en-us/articles/49553147148685
- Check Marked items: https://support.myfitnesspal.com/hc/en-us/articles/360032273292
- Where does MyFitnessPal get its food data?: https://support.myfitnesspal.com/hc/en-us/articles/360032271252
- How to report incorrect food items: https://support.myfitnesspal.com/hc/en-us/articles/360032274312
- How to use the Meal Scanner: https://support.myfitnesspal.com/hc/en-us/articles/360045761612
- How to log food with your voice: https://support.myfitnesspal.com/hc/en-us/articles/30332897072269
- How to use the Barcode Scanner: https://support.myfitnesspal.com/hc/en-us/articles/360032624771
- The difference between Free, Premium, and Premium+: https://support.myfitnesspal.com/hc/en-us/articles/34889191368077
- What is included in the free version?: https://support.myfitnesspal.com/hc/en-us/articles/15457546881805
- MyFitnessPal Premium features: https://support.myfitnesspal.com/hc/en-us/articles/360032625951
- Premium+: https://support.myfitnesspal.com/hc/en-us/articles/34347930588557
- How do I record my weight and other measurements?: https://support.myfitnesspal.com/hc/en-us/articles/360032624431
- How often should I record my weight?: https://support.myfitnesspal.com/hc/en-us/articles/360032272992
- Where can I find my target date?: https://support.myfitnesspal.com/hc/en-us/articles/360032271632
- Complete This Entry / Finish logging: https://support.myfitnesspal.com/hc/en-us/articles/360032624131
- How can I force my calorie goals to update?: https://support.myfitnesspal.com/hc/en-us/articles/360032271472
- Can I change my calorie goal without affecting history?: https://support.myfitnesspal.com/hc/en-us/articles/360032624071
- Starting Weight FAQs: https://support.myfitnesspal.com/hc/en-us/articles/360032273972
- Progress Photos FAQs: https://support.myfitnesspal.com/hc/en-us/articles/360032625271
- Additional measurements: https://support.myfitnesspal.com/hc/en-us/articles/360032624891
- Pie Chart: https://support.myfitnesspal.com/hc/en-us/articles/360032623691
- Progress Bar FAQ: https://support.myfitnesspal.com/hc/en-us/articles/21330878903181
- Weekly Digest: https://support.myfitnesspal.com/hc/en-us/articles/360032622591
- Diary Food Insights: https://support.myfitnesspal.com/hc/en-us/articles/360032270352
- Export your data: https://support.myfitnesspal.com/hc/en-us/articles/360032273352
- Share your diary: https://support.myfitnesspal.com/hc/en-us/articles/360032623371
- Customize your nutritional goals: https://support.myfitnesspal.com/hc/en-us/articles/360032274432
- Customize Nutrient Dashboard: https://support.myfitnesspal.com/hc/en-us/articles/360032272532
- Macro Goals by Meal: https://support.myfitnesspal.com/hc/en-us/articles/360032625151
- Calorie Goals By Meal: https://support.myfitnesspal.com/hc/en-us/articles/360032273792
- Food Timestamps: https://support.myfitnesspal.com/hc/en-us/articles/360036224752
- Multi-Day Logging: https://support.myfitnesspal.com/hc/en-us/articles/33535658002061
- Recent and Frequent lists: https://support.myfitnesspal.com/hc/en-us/articles/360032622071
- Suggested Searches: https://support.myfitnesspal.com/hc/en-us/articles/12338510991117
- Quick Log: https://support.myfitnesspal.com/hc/en-us/articles/360032622491
- Quick Add: https://support.myfitnesspal.com/hc/en-us/articles/360032621971
- Logging reminders: https://support.myfitnesspal.com/hc/en-us/articles/360032622391
- How to fix an incorrect streak: https://support.myfitnesspal.com/hc/en-us/articles/360032624931
- Serving size not available: https://support.myfitnesspal.com/hc/en-us/articles/360032272852
- Recipe Importer (apps): https://support.myfitnesspal.com/hc/en-us/articles/360032623231
- Why goal changes when you log exercise: https://support.myfitnesspal.com/hc/en-us/articles/360032623851
- Understanding changes in your exercise calories: https://support.myfitnesspal.com/hc/en-us/articles/360032272372
- Net Carbs: https://support.myfitnesspal.com/hc/en-us/articles/360032622531
- GLP-1 Support: https://support.myfitnesspal.com/hc/en-us/articles/40936733058445
- Wear OS App: https://support.myfitnesspal.com/hc/en-us/articles/4407940713869
- Supported Devices: https://support.myfitnesspal.com/hc/en-us/articles/4402625100941
- Known Issues: Android App: https://support.myfitnesspal.com/hc/en-us/articles/360032274332
- How to update your preferred language: https://support.myfitnesspal.com/hc/en-us/articles/360032623951
- Commonly Missed Features: https://support.myfitnesspal.com/hc/en-us/articles/360054012372
- Website × App differences: https://support.myfitnesspal.com/hc/en-us/articles/360032623031
- Eating Disorder Resources: https://support.myfitnesspal.com/hc/en-us/articles/360032625071
- Scale partners: https://support.myfitnesspal.com/hc/en-us/articles/360032273252

**Oficiais: preços, lojas e comunicados:**
- Premium em BRL: https://www.myfitnesspal.com/premium (lido em 13/10/2026)
- Google Play BR: https://play.google.com/store/apps/details?id=com.myfitnesspal.android&hl=pt_BR&gl=BR
- App Store BR: https://apps.apple.com/BR/app/id341232718
- App Store US (histórico de versões e compras): https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718
- Winter Release 2026 (GlobeNewswire via AOL, 24/02/2026): https://lite.aol.com/sports/other/story/0022/20260224/9659625.htm
- Google Android Developers Blog, Health Connect (14/11/2022): https://android-developers.googleblog.com/2022/11/leading-health-and-fitness-apps-roll-out-health-connect-integrations.html

**Imprensa e terceiros:**
- 9to5Mac, AI Coach (16/06/2026): https://9to5mac.com/2026/06/16/myfitnesspal-adds-ai-powered-coach-for-personalized-nutrition-guidance/
- PiunikaWeb, redesenho (05/05/2026): https://piunikaweb.com/2026/05/05/myfitnesspal-new-design-update-is-here-to-stay/
- Pulse 2.0, aquisição do Cal AI (04/03/2026): https://pulse2.com/myfitnesspal-acquires-cal-ai-to-expand-ai-powered-nutrition-tracking-portfolio
- Wikipedia: https://en.wikipedia.org/wiki/MyFitnessPal
- Consumer Rights Wiki, "regressive upgrade" (links para os posts oficiais e o Reddit): https://consumerrights.wiki/w/MyFitnessPal_regressive_upgrade
- Passio, case Meal Scan: https://www.passio.ai/case-studies/myfitnesspal
- choosingtherapy.com, review (atualizado em 29/07/2026): https://www.choosingtherapy.com/myfitnesspal-review/
- calorie-trackers.com, atualizações de mar/2026: https://calorie-trackers.com/calorie-tracker-app-updates-march-2026/
- Baguete, MFP no Brasil (2014): https://www.baguete.com.br/noticias/myfitnesspal-abre-em-em-sao-paulo

**Usuários e concorrentes (só indício):**
- Trustpilot: https://www.trustpilot.com/review/www.myfitnesspal.com
- Unstar, 300 avaliações da Play US (27/07/2026): https://unstar.app/blog/is-myfitnesspal-premium-worth-it-paywall-app-reviews-2026
- MyNetDiary Scorecard maio/2026 (concorrente): https://www.mynetdiary.com/diet-app-scorecard-may-2026.html
- Nutrola, auditoria da base (concorrente, 12/04/2026): https://nutrola.app/en/blog/how-reliable-is-myfitnesspal-calorie-data
- Fitia, alternativas (concorrente, 12/05/2026): https://fitia.app/learn/article/best-myfitnesspal-alternatives-2026/
