---
tipo: conhecimento
foco: metodo
titulo: Como os números são calculados - fontes, fórmulas e margem de erro de cada estimativa
versao: 3
atualizado: 2026-10-09
consulta_en: energy balance weight change 7700 kcal rule adaptive TDEE estimation bioimpedance day to day variability rate of weight gain lean bulk evidence MET compendium linear regression confidence interval autocorrelation
tags: [nutribot, conhecimento, metodo, estatistica]
---

# Como os números são calculados (e o quanto confiar em cada um)

Você não calcula nada de cabeça: o sistema calcula e te entrega pronto. Este documento diz de onde vem cada conta, para
você explicar quando perguntarem ("como você sabe?", "isso é confiável?") e para não vender precisão que não existe.

## Regras de ouro
- **Toda estimativa tem margem de erro.** Foto de prato: ±20 a 30% nas kcal. Gasto do relógio: ±10 a 20% (e pode errar
  sempre pro mesmo lado na mesma pessoa). Bioimpedância: oscila 0,5 a 1,5 kg de um dia pro outro por água, sal,
  carboidrato, creatina e hora do dia. Por isso o sistema só julga o ritmo com pelo menos 6 pesagens cobrindo 2 semanas (ou
  4 cobrindo 3 semanas, pra quem se pesa uma vez por semana), e sempre diz a margem de erro.
- **Duas fontes independentes valem mais que uma, mas não se misturam quando discordam.** O ritmo "pela balança"
  (regressão das pesagens) e o ritmo "pela comida" (comida registrada − gasto do relógio) são medidos separadamente.
  Quando concordam, a confiança sobe. Discordar tem UM critério, o mesmo no alerta do !progresso, na projeção do !tendencia
  e na aposta de domingo: no mesmo trecho de dias, o ritmo que o registro implica fica fora do intervalo de 95% da balança
  E a diferença passa de ~250 kcal/dia (o erro normal de foto + relógio). Discordando, uma delas está errada: o ritmo que
  vale é o da balança, e o sentido do erro diz a causa provável:
  - balança ABAIXO do que a comida prevê: o relógio subestima o gasto (musculação, esporte e a digestão de muita comida
    contam pouco) e/ou as fotos superestimam as calorias. Refeição esquecida NÃO explica, porque puxaria pro outro lado.
  - balança ACIMA do que a comida prevê: refeição ou bebida sem registro, porção maior que a estimada, ou relógio
    superestimando o gasto.
- **Semanas, não dias.** Qualquer veredito de ritmo, composição ou recuperação usa tendência de 3 a 4 semanas. Diferença
  entre duas pesagens isoladas não é ritmo.

## Faixa saudável de ritmo
- Ganho de massa: 0,25% a 0,5% do peso corporal por semana (75 kg: 0,19 a 0,38 kg/semana). Mais que isso, a maior parte
  vira gordura. Perda: 0,5% a 1% por semana (75 kg: 0,38 a 0,75 kg/semana) preserva massa magra.
- Fontes: Helms, Aragon & Fitschen 2014 (J Int Soc Sports Nutr); Garthe et al. 2011 (Int J Sport Nutr Exerc Metab); Iraki et al. 2019 (Sports).

## Progresso de peso: o veredito (bloco PROGRESSO DE PESO, comando !progresso)
- **Pesagens limpas antes da conta:** data válida e não futura; peso entre 25 e 300 kg; valor que parece libra no meio de
  quilos sai; pesagem 3 kg (ou 4%) longe da mediana dos dias vizinhos sai ("outra pessoa na balança?"); uma por dia (no
  dia em que o relógio pesou, a digitada não entra; várias do relógio viram a média). Do relógio vale a primeira medição
  da manhã (e ela continua valendo quando o envio seguinte do app traz só a da noite): depois de comer e beber o peso
  sobe 0,5 a 1,5 kg.
- **Tendência:** regressão linear das pesagens dos últimos 28 dias, em kg/semana, com intervalo de 95%. Pesagens vizinhas
  não são independentes (água retida dura dias), então o erro-padrão é corrigido pela autocorrelação dos resíduos (com o
  viés de amostra curta corrigido) e a t de Student usa os graus de liberdade efetivos, que caem junto. Medido em
  simulação, o "95%" cobre 93% com autocorrelação 0,5 e 97% sem ela (sem a correção, 73 a 88%). Theil-Sen (mediana das
  inclinações) confere se poucas pesagens extremas estão puxando o resultado. Com bioimpedância diária e 4 semanas, o
  intervalo costuma ficar em ±0,4 a 0,5 kg/semana.
- **Direção:** "subindo" ou "caindo" só se o intervalo inteiro estiver de um lado do zero; "estável" só se o intervalo
  inteiro couber em ±0,1 kg/semana; no resto, "sem direção firme" (com o lado provável).
- **Alvo:** o mesmo ritmo de onde sai a meta de calorias (ritmo máximo = 0,5% do peso por semana; com prazo e ritmo médio,
  o necessário pro prazo dentro da faixa saudável). O peso usado pro alvo, pro "faltam" e pra etapa batida é o de
  tendência (ou a média das pesagens dos últimos 7 dias, com poucas pesagens), nunca uma pesagem isolada, que pode ser
  água. Freio da gordura: só com a tendência da gordura subindo de verdade (intervalo de 95% inteiro acima de zero, porque
  a bioimpedância do relógio oscila ~1,3 ponto por leitura); ligado, vale mesmo com prazo e mesmo pra quem pediu ritmo
  mínimo. Etapa não é teto: passou dela, segue no objetivo até o domingo propor a próxima.
- **Veredito:** o ritmo MEDIDO pela balança contra o alvo, com tolerância de 10% do alvo, e a probabilidade de o ritmo real
  estar do lado dito, pela mesma t do intervalo (alta ≥ 97,5%, ou seja, o alvo fora do intervalo impresso; média ≥ 80%;
  baixa abaixo disso). "Abaixo do alvo, provável (83%)" quer dizer isso: provável, não certo; "ainda incerto (78%)" é só o
  lado mais provável. "No alvo" mede a chance de não estar abaixo e avisa quando pode estar passando do teto saudável.
- **Comida x balança no MESMO período:** só dias completos (2 ou mais registros, 500 kcal ou mais e pelo menos 65% da
  mediana diária da pessoa nos 28 dias, a mesma régua em todo lugar) e só dias fechados (hoje fica à parte); dia em que o
  relógio marcou 800 kcal ou menos (fora do pulso, sincronização parcial) não entra no gasto. A tendência usada nessa conta
  é a das pesagens do primeiro dia completo até a manhã seguinte ao último, pra comida e peso falarem do mesmo trecho.
- **Alertas:** registro x balança discordando (o critério único das regras de ouro); subida ou queda curta (últimos 7
  dias) que a tendência das semanas ANTERIORES não explica, além de ~2 desvios da diferença entre duas pesagens (assim o
  alarme falso fica em ~6 a 12% dos dias, contra ~30% da primeira versão); poucas pesagens; tendência frágil; meta alterada
  no meio do período; pesagens suspeitas ou descartadas.

## Leitura do gráfico (o que uma pessoa leria olhando as pesagens)
- Além das 4 semanas, o sistema mede a tendência em 7, 14 e 21 dias (a de 7 é só referência: oscila muito) e as médias de
  peso por semana. Quando a janela recente conta outra história (diferença de 0,15 kg/semana ou mais entre 21 e 28 dias),
  isso vira alerta: as duas leituras são verdadeiras ao mesmo tempo, e é dessa janela que vem a sensação da pessoa ("parece
  que caiu", "travou"). O veredito continua sendo o das 4 semanas.
- Média móvel de 7 dias centrada (só onde há 3 dias dos dois lados, pra não inventar pico ou vale nas pontas), lida como
  se lê um gráfico: de onde partiu, até onde foi e onde virou; e a média dos últimos 7 dias como "agora".
- Pesagens fora da manhã (04h a 11h) têm 0,5 a 1,5 kg a mais: o sistema dá a tendência também sem elas, e avisa quando muda.
- Comida da semana x peso: a ingestão registrada da última semana contra a das semanas anteriores (mesma régua das fotos dos
  dois lados, então o viés do registro quase se cancela), o efeito esperado no peso (diferença × 7 ÷ 7.700 por semana) e a
  média dos últimos 3 dias contra a semana anterior. Mudança de comida aparece primeiro como água e glicogênio, e só em 1 a
  3 semanas como tendência.

## Balanço energético e a régua de 7.700 kcal por kg
- Fórmula: ritmo pela comida = (kcal ingeridas − kcal gastas, média diária) × 7 ÷ 7.700.
- 7.700 kcal/kg é a regra de Wishnofsky (1958) para tecido adiposo. É uma aproximação: ganho magro custa menos por kg
  (músculo é ~75% água) e o corpo adapta o gasto. Modelos dinâmicos (Hall et al. 2011, Lancet; Thomas et al. 2014) são
  mais exatos, mas precisam de dados que o grupo não tem. Use a régua como ordem de grandeza, nunca como promessa.

## Gasto adaptativo e meta de calorias
- Gasto real implícito = ingestão média registrada − (tendência do peso no mesmo trecho × 7.700 ÷ 7), o "energy balance
  method" de ferramentas como MacroFactor (Hall et al. 2011). O intervalo vem do intervalo da tendência: com
  bioimpedância diária e 3 semanas, ±300 a 500 kcal/dia.
- A meta de calorias = gasto real + o superávit (ou déficit) do alvo, em calorias REGISTRADAS: a mesma régua das fotos.
  Por isso ela já desconta o viés do registro e do relógio, sem precisar saber qual dos dois erra.
- A meta herda a incerteza do gasto real (meia largura do intervalo, mínimo 100 kcal). A comida da semana só é "abaixo"
  ou "acima" da meta fora dessa incerteza; fora da faixa mas dentro da incerteza é "compatível" (mais 1 a 2 semanas de
  pesagem decidem). Enquanto não calibra, a meta é provisória (gasto do relógio em 28 dias + objetivo, margem de 100), e o
  !hoje, o !progresso e o bloco de força julgam a semana pela MESMA meta.
- O saldo "pelo relógio" (comida − gasto do relógio) continua aparecendo como dado, mas quando a balança mostra que o
  relógio está descalibrado pra pessoa, quem diz se ela come de mais ou de menos é a meta calibrada, não o relógio.
- O "mire" de cada dia é o gasto do relógio naquele dia da semana corrigido pela razão gasto real ÷ relógio (limite de
  0,7 a 1,6), mais o superávit do alvo. Essa razão está na régua das calorias registradas: vem do relógio baixo e/ou das
  fotos altas, e os dados não separam as duas.
- Fontes: Mifflin et al. 1990 (Am J Clin Nutr); Hall et al. 2011.

## Projeção
- Peso em N semanas = peso de referência (o de tendência, o mesmo da meta) + ritmo esperado × N, com banda de ±incerteza
  × N (o erro no ritmo acumula). Ritmo esperado = média ponderada da balança e da comida SÓ quando elas concordam (o
  critério único); discordando, segue a balança. Uma projeção de 15 semanas carrega ±1,5 kg ou mais.
- "Necessário pro prazo": o que falta até a etapa dividido pelas semanas até o prazo. Aparece como informação; o veredito
  é contra o alvo da meta de calorias.
- Aposta de domingo ("nesse ritmo, no próximo domingo..."): balanço comida − relógio dos dias completos DESTA semana (conta
  a mudança de comida da semana). Se o registro não bate com a balança, esse balanço é corrigido pelo viés medido nas
  semanas anteriores (o mesmo do alerta), com confiança baixa quando o viés tem incerteza de mais de ±300 kcal/dia. Sem
  relógio, vale a tendência das pesagens de 21 dias. Ritmo nunca é julgado pela aposta, só pelo que a balança mediu.

## Composição corporal
- Massa magra = peso × (1 − % de gordura da bioimpedância). A composição da mudança compara médias semanais (primeira
  x última semana): quanto do ganho/perda foi massa magra e quanto foi gordura.
- Bioimpedância de relógio tem erro de 3 a 5 pontos percentuais em valor absoluto, mas é razoável em TENDÊNCIA quando
  medida no mesmo horário e em semanas. Nunca leia um dia isolado.
- Fontes: Kyle et al. 2004 (Clin Nutr, posicionamento ESPEN sobre BIA); Buckinx et al. 2018.

## Atividades e treino
- Gasto de esporte sem relógio: MET × peso (kg) × horas (Compêndio de Atividades Físicas, Ainsworth et al. 2011).
  Vôlei de quadra 4 a 6 MET; vôlei de areia 6 a 8. Erro de ±20%. Somado ao gasto TOTAL do relógio, entra só o que passa do
  repouso (MET − 1), porque o relógio já conta o metabolismo de repouso das 24 horas.
- Progressão de força: melhor carga por exercício por sessão; "parado" = 2 semanas ou mais sem subir carga nem repetições.
  Volume = séries × repetições × carga (Schoenfeld et al. 2017).

## Recuperação e sono
- Sono: 7 a 9 h (Hirshkowitz et al. 2015, National Sleep Foundation). Abaixo de 6h30 recorrente derruba força e
  aumenta apetite (Spiegel et al. 2004; Dattilo et al. 2011).
- Batimento de repouso: 5 a 10 bpm acima da média pessoal de 14 dias por 2 ou mais dias = recuperação incompleta ou
  doença chegando (Buchheit 2014, Front Physiol). HRV (RMSSD) reforça o sinal quando existe; o relógio da Samsung não
  manda HRV pelo Health Connect, então hoje esse dado não entra.

## Proteína e suplementos
- Proteína: 1,6 a 2,2 g/kg/dia (Morton et al. 2018, Br J Sports Med; Jäger et al. 2017, ISSN), 20 a 40 g por refeição,
  3 a 5 refeições.
- Creatina: 3 a 5 g/dia, saturação em 3 a 4 semanas, +1 a 2 kg de água no início (Kreider et al. 2017, ISSN). O sistema
  NÃO desconta isso sozinho: nas 2 a 4 primeiras semanas de creatina, leia a balança sabendo que parte do ganho é água.

## Como falar disso
- Progresso: o período, quantas pesagens, o peso do início e do fim, a tendência com a margem ("+0,20 kg/semana, entre
  −0,27 e +0,66"), o alvo e o veredito com a confiança dele. Sem isso, não é resposta de progresso.
- Data com janela: "80 kg por volta de 02/01, provavelmente entre meados de dezembro e começo de fevereiro".
- Quando as duas fontes discordam, explique o que cada uma mostra e o sentido do erro (acima); não escolha um número no
  chute e não acuse ninguém de esquecer registro quando a balança está abaixo da comida.
- Nunca diga que a pessoa come "além do objetivo" pelo saldo do relógio se a balança não acompanha o registro.
- Nunca diga "exatamente", "com certeza" ou "cientificamente comprovado" sobre uma estimativa.
- O sistema confere a sua resposta contra as contas antes de enviar: peso "caindo" com a tendência subindo (ou o
  contrário), "no ritmo"/"no caminho certo" com o veredito abaixo, "abaixo/atrasado" com o veredito no alvo, "rápido demais"
  sem estar, "comendo além do objetivo" quando a balança não acompanha o registro. Frase negada ou em dúvida ("não dá pra
  dizer se..."), hipótese ou finalidade ("pra andar no alvo, a balança pede..."), pergunta, janela curta (hoje, essa
  semana, a oscilação curta, o trecho da calibração) e análise de prato não contam como contradição.
