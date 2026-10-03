---
tipo: conhecimento
foco: metodo
titulo: Como os números são calculados - fontes, fórmulas e margem de erro de cada estimativa
versao: 1
atualizado: 2026-10-03
consulta_en: energy balance weight change 7700 kcal rule adaptive TDEE estimation bioimpedance day to day variability rate of weight gain lean bulk evidence MET compendium
tags: [nutribot, conhecimento, metodo, estatistica]
---

# Como os números são calculados (e o quanto confiar em cada um)

Você não calcula nada de cabeça: o sistema calcula e te entrega pronto. Este documento diz de onde vem cada conta, para
você explicar quando perguntarem ("como você sabe?", "isso é confiável?") e para não vender precisão que não existe.

## Regras de ouro
- **Toda estimativa tem margem de erro.** Foto de prato: ±20 a 30% nas kcal. Gasto do relógio: ±10 a 20%. Bioimpedância:
  oscila 0,5 a 1,5 kg de um dia pro outro por água, sal, creatina e hora do dia. Por isso o sistema só opina sobre
  tendência com médias semanais e pelo menos 4 pesagens em 10 dias.
- **Duas fontes independentes valem mais que uma.** O ritmo "pela balança" (regressão das pesagens) e o ritmo "pela
  comida" (balanço calórico) são medidos separadamente; quando concordam, a confiança sobe; quando discordam, o sistema
  avisa e a causa provável é refeição sem registro ou água.
- **Semanas, não dias.** Qualquer veredito de ritmo, composição ou recuperação usa janelas de 7 dias e tendência de 3 a 4 semanas.

## Faixa saudável de ritmo
- Ganho de massa: 0,25% a 0,5% do peso corporal por semana (75 kg: 0,19 a 0,38 kg/semana). Mais que isso, a maior parte
  vira gordura. Perda: 0,5% a 1% por semana (75 kg: 0,38 a 0,75 kg/semana) preserva massa magra.
- Fontes: Helms, Aragon & Fitschen 2014 (J Int Soc Sports Nutr); Garthe et al. 2011 (Int J Sport Nutr Exerc Metab); Iraki et al. 2019 (Sports).

## Balanço energético e a régua de 7.700 kcal por kg
- Fórmula do sistema: ritmo pela comida = (kcal ingeridas − kcal gastas, média diária) × 7 ÷ 7.700.
- 7.700 kcal/kg é a regra de Wishnofsky (1958) para tecido adiposo. É uma aproximação: ganho magro custa menos por kg
  (músculo é ~75% água) e o corpo adapta o gasto. Modelos dinâmicos (Hall et al. 2011, Lancet; Thomas et al. 2014) são
  mais exatos, mas precisam de dados que o grupo não tem. Use a régua como ordem de grandeza, nunca como promessa.
- Dia mal registrado não entra no balanço: só dias com 2 ou mais registros e pelo menos 65% da mediana diária da pessoa.

## Gasto adaptativo
- O gasto diário real é estimado como nos apps de referência: começa pelo relógio (ou por Mifflin-St Jeor × atividade) e
  é corrigido pela variação de peso observada contra a comida registrada ("energy balance method"). Com 2 a 3 semanas de
  dados a estimativa fica dentro de ±150 a 250 kcal/dia.
- Fontes: Mifflin et al. 1990 (Am J Clin Nutr); Hall et al. 2011; o método é o mesmo de ferramentas como MacroFactor.

## Ritmo e projeção
- Ritmo pela balança: regressão linear das pesagens dos últimos 28 dias (kg/dia × 7). O erro-padrão da inclinação vira a
  incerteza do ritmo; com 3 semanas de bioimpedância fica em ±0,10 a 0,15 kg/semana.
- Ritmo esperado = média ponderada pelo inverso da variância: a balança (erro-padrão da regressão, mínimo 0,08) pesa muito
  mais que o balanço (σ fixo de 0,25 kg/semana, o erro típico de foto e relógio). A balança manda; a comida confere.
  Incerteza = raiz da soma dos quadrados da incerteza do esperado e de um quarto da discordância entre os dois (mínimo
  0,06, máximo 0,5 kg/semana).
- Projeção: peso em N semanas = peso atual + ritmo × N, com banda de ±incerteza × N (o erro no ritmo acumula linearmente).
  Chegada à meta: falta ÷ ritmo; a janela provável usa ritmo ± incerteza. Uma projeção de 15 semanas carrega ±1,5 kg.
- "Necessário": o que falta até a etapa dividido pelas semanas até o prazo, limitado à faixa saudável.

## Composição corporal
- Massa magra = peso × (1 − % de gordura da bioimpedância). A composição da mudança compara médias semanais (primeira
  x última semana): quanto do ganho/perda foi massa magra e quanto foi gordura.
- Bioimpedância de relógio tem erro de 3 a 5 pontos percentuais em valor absoluto, mas é razoável em TENDÊNCIA quando
  medida no mesmo horário e em semanas. Nunca leia um dia isolado.
- Fontes: Kyle et al. 2004 (Clin Nutr, posicionamento ESPEN sobre BIA); Buckinx et al. 2018.

## Atividades e treino
- Gasto de esporte sem relógio: MET × peso (kg) × horas (Compêndio de Atividades Físicas, Ainsworth et al. 2011).
  Vôlei de quadra 4 a 6 MET; vôlei de areia 6 a 8. Erro de ±20%.
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
- Creatina: 3 a 5 g/dia, saturação em 3 a 4 semanas, +1 a 2 kg de água no início (Kreider et al. 2017, ISSN). A tendência
  de peso desconta isso quando a creatina começa.

## Como falar disso
- Dê o número com a margem: "ritmo esperado +0,35 kg/semana, provavelmente entre +0,25 e +0,45".
- Data com janela: "80 kg por volta de 02/01, provavelmente entre meados de dezembro e começo de fevereiro".
- Quando as duas fontes discordam, diga qual é a provável causa e peça o registro que falta, sem acusar.
- Nunca diga "exatamente", "com certeza" ou "cientificamente comprovado" sobre uma estimativa.
