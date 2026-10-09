import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const P = await import('../progresso.js');
const { analisarProgresso, validarPesagens, tendenciaPeso, oscilacaoCurta, regressao, theilSen, diasDeComida, calibrarEnergia, julgarRitmo, vereditoRitmo, conferirTextoProgresso, problemaDeProgresso, somarDias, diaValido, phi } = P;
const { projecaoAteMeta } = await import('../tendencia.js');
const { gastoAdaptativo, calcularVisao, visaoZap, visaoPeriodo, faixaDaMeta, previsaoGastoAmanha } = await import('../resumo.js');
const { preverSemana } = await import('../previsao.js');

// ---------- fábrica de cenários (dados fictícios) ----------
const DIA = '2030-03-29';
const ganho = { ritmoKgSemana: 0.38, min: 320, max: 520, rotulo: 'superávit de ~420 kcal/dia (+0,38 kg/semana)', fonte: 'meta' };
const perfilGanho = { nome: 'Pessoa A', objetivo: 'Hipertrofia: ganhar massa', metaPeso: 80, metaPrazo: '2030-07-15', metaModo: 'etapa', ritmo: 'maximo', peso: 75 };
/** pesagens diárias por `dias` dias até `dia`, com inclinação (kg/semana) e um ruído determinístico (amplitude em kg) */
function serie({ dia = DIA, dias = 28, inicio = 75, kgSemana = 0, ruido = 0, pular = [] } = {}) {
  const out = [];
  for (let i = dias - 1; i >= 0; i--) {
    if (pular.includes(i)) continue;
    const t = dias - 1 - i;
    const r = ruido ? ruido * Math.sin(t * 2.3) * (t % 3 === 0 ? 1 : -0.6) : 0; // oscila sem tendência
    out.push({ dia: somarDias(dia, -i), peso: Math.round((inicio + (kgSemana * t) / 7 + r) * 10) / 10 });
  }
  return out;
}
/** comida: `dias` dias fechados antes de `dia`, 2 refeições por dia somando kcal; gasto do relógio por dia */
function comida({ dia = DIA, dias = 27, kcal = 3000, gasto = 2600 } = {}) {
  const refeicoes = [];
  const gastos = {};
  for (let i = 1; i <= dias; i++) {
    const d = somarDias(dia, -i);
    refeicoes.push({ dia: d, estimativa: { kcal: kcal * 0.55, p: 70 } }, { dia: d, estimativa: { kcal: kcal * 0.45, p: 60 } });
    gastos[d] = gasto;
  }
  return { refeicoes, gastos };
}

// ---------- 1. tendência positiva, negativa e estável ----------
test('tendência: positiva, negativa e estável com intervalo de confiança', () => {
  const sobe = tendenciaPeso(serie({ kgSemana: 0.4, ruido: 0.3 }), { dia: DIA });
  assert.equal(sobe.direcao, 'subindo', JSON.stringify(sobe.ic95));
  assert.ok(Math.abs(sobe.kgSemana - 0.4) < 0.12, `ritmo ${sobe.kgSemana}`);
  assert.ok(sobe.ic95[0] > 0 && sobe.ic95[0] < sobe.kgSemana && sobe.ic95[1] > sobe.kgSemana);
  const cai = tendenciaPeso(serie({ kgSemana: -0.5, ruido: 0.3 }), { dia: DIA });
  assert.equal(cai.direcao, 'caindo');
  assert.ok(Math.abs(cai.kgSemana + 0.5) < 0.12);
  const parado = tendenciaPeso(serie({ kgSemana: 0, ruido: 0.15 }), { dia: DIA });
  assert.equal(parado.direcao, 'estavel', `${parado.kgSemana} ${parado.ic95}`);
  // sem ruído: regressão exata
  const exata = regressao([0, 1, 2, 3, 4], [10, 10.5, 11, 11.5, 12]);
  assert.ok(Math.abs(exata.b - 0.5) < 1e-12 && exata.se < 1e-9);
  assert.equal(regressao([1, 1, 1], [1, 2, 3]), null); // x todo igual
  assert.equal(regressao([1, 2], [1, 2]), null); // poucos pontos
});

test('regressão: intervalo inflado pela autocorrelação das pesagens; Theil-Sen resiste a pesagem extrema', () => {
  // resíduos em bloco (3 dias acima, 3 abaixo): autocorrelados -> erro-padrão maior que o "ingênuo"
  const xs = Array.from({ length: 24 }, (_, i) => i);
  const ys = xs.map((x) => 75 + 0.02 * x + (Math.floor(x / 3) % 2 ? 0.4 : -0.4));
  const r = regressao(xs, ys);
  assert.ok(r.rho > 0.3, `rho ${r.rho}`);
  const ingenuo = Math.sqrt(r.dp ** 2 / xs.reduce((a, x) => a + (x - 11.5) ** 2, 0));
  assert.ok(r.se > ingenuo * 1.3, `se ${r.se} x ingênuo ${ingenuo}`);
  // uma pesagem absurda no fim puxa a regressão, não a mediana das inclinações
  const ys2 = xs.map((x) => 75 + 0.05 * x);
  ys2[23] = 80;
  assert.ok(Math.abs(theilSen(xs, ys2) - 0.05) < 1e-9);
  assert.ok(regressao(xs, ys2).b > 0.08);
});

// ---------- 2. oscilação diária x tendência ----------
test('oscilação: subida de poucos dias sobre uma tendência estável vira alerta, não tendência', () => {
  const base = serie({ kgSemana: 0, ruido: 0.2, dias: 28 });
  // últimos 3 dias +1,3 kg (água/carboidrato)
  for (const p of base.slice(-3)) p.peso = Math.round((p.peso + 1.3) * 10) / 10;
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens: base, faixa: ganho });
  assert.ok(a.curto && a.curto.sentido === 'subiu', JSON.stringify(a.curto));
  assert.ok(a.alertas.some((x) => x.tipo === 'curto_vs_longo'));
  assert.notEqual(a.tendencia.direcao, 'caindo');
  assert.match(a.zap, /OSCILAÇÃO CURTA/);
  // oscilação dentro do ruído não gera alerta
  const calmo = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens: serie({ kgSemana: 0.38, ruido: 0.3 }), faixa: ganho });
  assert.equal(calmo.curto, null);
});

// ---------- 3. consumo acima da meta com peso caindo ----------
test('comida acima da meta pelo relógio com balança caindo: alerta no sentido certo, veredito pela balança, meta recalibrada', () => {
  const pesagens = serie({ kgSemana: -0.2, ruido: 0.2 });
  const { refeicoes, gastos } = comida({ kcal: 3600, gasto: 2600 }); // relógio: +1.000 kcal/dia, ~+0,9 kg/semana
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes, gastos, faixa: ganho });
  assert.equal(a.veredito.status, 'abaixo');
  const alerta = a.alertas.find((x) => x.tipo === 'registro_acima_da_balanca');
  assert.ok(alerta, JSON.stringify(a.alertas.map((x) => x.tipo)));
  assert.match(alerta.texto, /REGISTRO DIZ SUPERÁVIT, BALANÇA NÃO ACOMPANHA/);
  assert.match(alerta.texto, /Refeição esquecida NÃO explica/); // o sentido do erro descarta essa explicação
  // gasto real = ingestão − balanço pela balança: 3.600 + 0,2 × 1.100 ≈ 3.820 (com ruído, faixa larga)
  assert.ok(a.energia.gastoReal > 3600 && a.energia.gastoReal < 4100, `gasto ${a.energia.gastoReal}`);
  assert.equal(a.metaKcal.base, 'balanca');
  assert.ok(a.metaKcal.min > 3900, JSON.stringify(a.metaKcal));
  assert.equal(a.situacaoIngestao, 'abaixo'); // come 3.600 registradas; a balança pede ~4.100+
  // o !hoje não pode dizer "acima do alvo" pelo relógio cru quando a meta calibrada diz o contrário
  const v = calcularVisao({ refeicoes, pesagens, perfil: perfilGanho, dia: DIA, gastos });
  assert.equal(v.meta.status, 'calibrado');
  assert.equal(v.balanco.situacaoRelogio, 'acima'); // pelo relógio: +1.000 contra +320 a +520
  assert.equal(v.balanco.situacao, 'abaixo'); // pela balança
  assert.match(visaoZap({ refeicoes, pesagens, perfil: perfilGanho, dia: DIA, gastos }), /A balança indica gasto real de ~3\.\d{3} kcal\/dia \(o relógio marca ~2\.600 kcal\): o saldo do relógio não é o real/);
  assert.match(visaoPeriodo({ refeicoes, pesagens, perfil: perfilGanho, dia: DIA, gastos }), /JULGAMENTO pela meta calibrada pela balança: .* -> ABAIXO do alvo/);
});

// ---------- 4. consumo abaixo da meta com peso subindo ----------
test('comida abaixo da meta pelo relógio com balança subindo: explicação é refeição sem registro ou relógio alto', () => {
  const pesagens = serie({ kgSemana: 0.5, ruido: 0.2 });
  const { refeicoes, gastos } = comida({ kcal: 2400, gasto: 2600 }); // relógio: −200 kcal/dia
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes, gastos, faixa: ganho });
  const alerta = a.alertas.find((x) => x.tipo === 'registro_abaixo_da_balanca');
  assert.ok(alerta, JSON.stringify(a.alertas.map((x) => x.tipo)));
  assert.match(alerta.texto, /refeição ou bebida sem registro/);
  assert.ok(a.energia.gastoReal < 2400, `gasto real ${a.energia.gastoReal}`); // a balança sobe com 2.400 registradas
  assert.notEqual(a.veredito.status, 'abaixo');
});

// ---------- 5. pesagens irregulares, ausentes, duplicadas e fora de ordem ----------
test('pesagens: fora de ordem, duplicadas no dia, buracos e saltos', () => {
  const ordenada = serie({ kgSemana: 0.3, ruido: 0.2, pular: [2, 3, 9, 10, 11, 15] });
  const baguncada = [...ordenada].reverse();
  baguncada.push({ dia: ordenada[5].dia, peso: ordenada[5].peso + 1.4 }); // 2ª pesagem no mesmo dia (noite)
  const v = validarPesagens(baguncada, { dia: DIA });
  assert.deepEqual(v.pontos.map((p) => p.dia), ordenada.map((p) => p.dia));
  const dup = v.pontos.find((p) => p.dia === ordenada[5].dia);
  assert.equal(dup.n, 2);
  assert.ok(Math.abs(dup.peso - (ordenada[5].peso + 0.7)) < 1e-9); // média das duas
  assert.ok(v.avisos.some((a) => /2 pesagens em .* diferindo 1,4 kg/.test(a)), v.avisos.join(' | '));
  // a tendência sai igual com a lista em qualquer ordem
  const t1 = tendenciaPeso(validarPesagens(ordenada, { dia: DIA }).pontos, { dia: DIA });
  const t2 = tendenciaPeso(validarPesagens([...ordenada].reverse(), { dia: DIA }).pontos, { dia: DIA });
  assert.equal(t1.kgSemana, t2.kgSemana);
  assert.equal(t1.n, ordenada.length);
  // salto de 3 kg de um dia pro outro é avisado
  const salto = validarPesagens([{ dia: '2030-03-01', peso: 75 }, { dia: '2030-03-02', peso: 78.2 }, { dia: '2030-03-03', peso: 75.1 }]);
  assert.ok(salto.avisos.some((a) => /salto de \+3,2 kg entre 01\/03 e 02\/03/.test(a)), salto.avisos.join(' | '));
});

test('pesagens: outra pessoa na balança sai da conta; no mesmo dia, a do relógio vence a digitada', () => {
  const base = serie({ kgSemana: 0.2, ruido: 0.2 });
  const comIntrusa = base.map((p, i) => (i === 14 ? { ...p, peso: 62.3 } : p)); // no 15º dia quem subiu na balança foi outra pessoa
  const v = validarPesagens(comIntrusa, { dia: DIA });
  assert.ok(v.descartadas.some((d) => d.peso === 62.3 && /fora da curva/.test(d.motivo)), JSON.stringify(v.descartadas));
  assert.equal(v.pontos.some((p) => p.peso === 62.3), false);
  // pesagem digitada de roupa à tarde (77,0) no dia em que o relógio pesou 75,4 de manhã
  const dois = validarPesagens([...base, { dia: base[20].dia, peso: 77.0, fonte: 'conversa' }].map((p) => (p.fonte ? p : { ...p, fonte: 'relogio' })), { dia: DIA });
  const dia20 = dois.pontos.find((p) => p.dia === base[20].dia);
  assert.equal(dia20.peso, base[20].peso);
  assert.ok(dois.avisos.some((a) => /pesagem digitada \(77,0 kg\) ficou de fora: vale a do relógio/.test(a)), dois.avisos.join(' | '));
});

test('peso do dia: a primeira da manhã vale (não a última, que pode ser depois do jantar)', async () => {
  const { preferirPesagem } = P;
  const samsung = (f) => /shealth/.test(f || '');
  const manha = { hora: '07:10', peso: 75.6, fonte: 'com.sec.android.app.shealth' };
  const noite = { hora: '22:18', peso: 76.9, fonte: 'com.sec.android.app.shealth' };
  assert.equal(preferirPesagem(manha, noite, samsung), manha);
  assert.equal(preferirPesagem(noite, manha, samsung), manha);
  assert.equal(preferirPesagem({ hora: '08:30', peso: 75.8, fonte: 'x' }, { hora: '07:05', peso: 75.5, fonte: 'x' }).hora, '07:05'); // as duas de manhã: a mais cedo
  assert.equal(preferirPesagem({ hora: '22:00', fonte: 'outro' }, { hora: '21:00', fonte: 'com.sec.android.app.shealth' }, samsung).fonte, 'com.sec.android.app.shealth'); // Samsung vence
  // o app do relógio manda as duas medições do dia: fica a da manhã
  const { normalizarEnvio } = await import('../relogio.js');
  const d = normalizarEnvio({ pesos: [{ t: '2030-03-10T10:10:00Z', kg: 75.6, fonte: 'com.sec.android.app.shealth' }, { t: '2030-03-11T01:18:00Z', kg: 76.9, fonte: 'com.sec.android.app.shealth' }] }, 'America/Sao_Paulo');
  assert.deepEqual(d.pesos.map((p) => [p.dia, p.hora, p.peso]), [['2030-03-10', '07:10', 75.6]]);
});

// ---------- 6. meta alterada no período ----------
test('meta: o alvo é o vigente (sem número velho guardado) e a mudança no período vira alerta', () => {
  const pesagens = serie({ kgSemana: 0.3, ruido: 0.2 });
  const perfil = { ...perfilGanho, atualizacoes: { metaPrazo: somarDias(DIA, -10), metaPeso: somarDias(DIA, -40) } };
  const a = analisarProgresso({ perfil, dia: DIA, pesagens, faixa: ganho });
  const alerta = a.alertas.find((x) => x.tipo === 'meta_mudou');
  assert.ok(alerta);
  assert.match(alerta.texto, /prazo em \d\d\/\d\d/);
  assert.doesNotMatch(alerta.texto, /peso-alvo/); // a de 40 dias atrás é de antes do período
  // trocar a meta muda o alvo na hora (faixaDaMeta recalcula do perfil, nada fica em cache)
  const f1 = faixaDaMeta({ ...perfilGanho, ritmo: 'medio', metaPrazo: '2030-12-31' }, DIA, pesagens);
  const f2 = faixaDaMeta({ ...perfilGanho, ritmo: 'medio', metaPrazo: '2030-05-31' }, DIA, pesagens);
  assert.ok(f2.ritmoKgSemana > f1.ritmoKgSemana, `${f1.ritmoKgSemana} -> ${f2.ritmoKgSemana}`);
  const v1 = vereditoRitmo({ pontos: validarPesagens(pesagens).pontos, dia: DIA, faixa: f1, objetivo: perfilGanho.objetivo });
  const v2 = vereditoRitmo({ pontos: validarPesagens(pesagens).pontos, dia: DIA, faixa: f2, objetivo: perfilGanho.objetivo });
  assert.equal(v1.alvo, f1.ritmoKgSemana);
  assert.equal(v2.alvo, f2.ritmoKgSemana);
});

// ---------- 7. poucos dados ----------
test('poucos dados: sem veredito categórico, e texto que crava direção ou ritmo é apontado', () => {
  const pesagens = serie({ kgSemana: 0.5, dias: 6 }); // 6 pesagens em 6 dias
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, faixa: ganho });
  assert.equal(a.tendencia.suficiente, false);
  assert.equal(a.tendencia.direcao, 'insuficiente');
  assert.equal(a.veredito.status, 'inconclusivo');
  assert.ok(a.alertas.some((x) => x.tipo === 'dados_insuficientes'));
  assert.match(a.conclusao, /Ainda não dá pra dizer/);
  assert.match(a.texto, /VEREDITO DO RITMO: ainda não dá pra julgar o ritmo/);
  const div = conferirTextoProgresso('Seu peso está subindo bem, você está no ritmo da etapa!', a);
  assert.deepEqual(div.map((x) => x.tipo).sort(), ['direcao_sem_base', 'ritmo_sem_base']);
  // uma ou duas pesagens (quem se pesa pouco): os textos saem sem quebrar
  for (const k of [1, 2]) {
    const pouca = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens: serie({ dias: k }), faixa: ganho });
    assert.equal(pouca.tendencia.n, k);
    assert.match(pouca.texto, k === 1 ? /uma só: 75,0 kg/ : /primeira 75,0 kg .* variação/);
    assert.match(pouca.zap, /ainda não dá pra julgar|precisa de 6\+ pesagens/);
    assert.match(pouca.resumoZap, /precisa de 6\+ pesagens/);
  }
  // sem pesagem nenhuma
  const vazio = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens: [], faixa: ganho });
  assert.match(vazio.zap, /Sem pesagens nos últimos 28 dias/);
  assert.equal(vazio.veredito.status, 'inconclusivo');
});

// ---------- 8. data, unidade e arredondamento ----------
test('validação: data inválida ou futura, peso impossível, libra no meio de quilo; formato pt-BR e sinal', () => {
  assert.equal(diaValido('2030-02-30'), false);
  assert.equal(diaValido('2030-13-01'), false);
  assert.equal(diaValido('30/03/2030'), false);
  assert.equal(diaValido('2030-02-28'), true);
  const v = validarPesagens(
    [
      { dia: '2030-03-01', peso: 75 },
      { dia: '2030-03-02', peso: 75.2 },
      { dia: '2030-03-03', peso: 165.8 }, // 75,2 kg em libra
      { dia: '2030-03-04', peso: 7.5 }, // vírgula perdida
      { dia: '2030-02-30', peso: 75 },
      { dia: '2030-04-10', peso: 75 }, // futuro
      { dia: '2030-03-05', peso: '75,4' }, // texto com vírgula não vira número
      { dia: '2030-03-06', peso: 75.3 },
    ],
    { dia: '2030-03-29' },
  );
  assert.deepEqual(v.pontos.map((p) => p.peso), [75, 75.2, 75.3]);
  const motivos = v.descartadas.map((d) => d.motivo).join(' | ');
  assert.match(motivos, /parece libra \(75,2 kg\?\)/);
  assert.match(motivos, /peso fora do possível/);
  assert.match(motivos, /data inválida/);
  assert.match(motivos, /data no futuro/);
  // arredondamento e sinal: −0,004 kg/semana não vira "−0,00"; vírgula decimal e milhar com ponto
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens: serie({ kgSemana: 0, ruido: 0 }), faixa: ganho, refeicoes: comida({ kcal: 3456 }).refeicoes, gastos: comida({ gasto: 2600 }).gastos });
  assert.match(a.texto, /Tendência .*: 0,00 kg\/semana \(0 g\/dia\)/);
  assert.match(a.texto, /ingestão registrada 3\.456 kcal\/dia/);
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-9 && Math.abs(phi(1.96) - 0.975) < 1e-3);
});

// ---------- 9. conferência do texto da IA ----------
test('conferência: aponta texto que contradiz as contas e deixa passar o que bate (ou fala de outra coisa)', () => {
  const pesagens = serie({ kgSemana: 0.2, ruido: 0.15 });
  const { refeicoes, gastos } = comida({ kcal: 3600, gasto: 2600 });
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes, gastos, faixa: ganho });
  assert.equal(a.veredito.status, 'abaixo');
  const tipos = (t) => conferirTextoProgresso(t, a).map((x) => x.tipo);
  // contradições
  assert.deepEqual(tipos('Lucas, seu peso está caindo nas últimas semanas.'), ['direcao_oposta']);
  assert.deepEqual(tipos('Você está no ritmo da etapa, só manter!'), ['ritmo_oposto']);
  assert.deepEqual(tipos('Pelo relógio você está comendo além do objetivo, com balanço acima do alvo.'), ['excesso_sem_balanca']);
  // coerentes ou fora do assunto: nada
  assert.deepEqual(tipos('Seu peso não está caindo: a tendência é de leve subida, abaixo do ritmo alvo.'), []);
  assert.deepEqual(tipos('Hoje seu peso caiu 0,3 kg em relação a ontem, normal de oscilação.'), []);
  assert.deepEqual(tipos('Que pós-treino icônico! 130 kg na cadeira flexora, no caminho certo.'), []);
  assert.deepEqual(tipos('Proteína acima do alvo hoje, perfeito pra hipertrofia.'), []);
  assert.deepEqual(tipos('Esse almoço está ótimo: arroz, feijão e frango.'), []);
  // finalidade não é afirmação (falso positivo da avaliação com o modelo, cenário P02)
  assert.deepEqual(tipos('Meta calibrada pela balança: pra subir no ritmo que você quer, precisamos de 3.910 a 4.110 kcal/dia.'), []);
  assert.deepEqual(tipos('Veredito: No ritmo perfeito da etapa!'), ['ritmo_oposto']);
  // a instrução de refazer cita o trecho e os números certos
  const prob = problemaDeProgresso(conferirTextoProgresso('Seu peso está caindo.', a));
  assert.match(prob, /direção do peso contrária à tendência medida \("Seu peso está caindo\."\)/);
  assert.match(prob, /O que os números dizem: Peso de \d\d\/\d\d a \d\d\/\d\d \(\d+ pesagens\)/);
  assert.equal(problemaDeProgresso([]), '');
});

test('pergunta de progresso: com ou sem "?" vai pro modo próprio; pergunta de treino não', () => {
  const { pareceProgresso } = P;
  for (const t of ['como está meu progresso?', 'como está meu progresso', 'to abaixo do ganho esperado?', 'tô ganhando peso?', 'qual meu ritmo de ganho', 'meu peso tá caindo mesmo treinando pesado', 'minha tendência na balança tá subindo', 'quantos kg eu ganhei esse mês']) assert.equal(pareceProgresso(t), true, t);
  for (const t of ['qual o ritmo do treino de hoje?', 'o peso no supino subiu!', 'como está meu progresso no supino?', 'terminei a primeira série, ritmo bom', 'bati a meta de proteína?', 'esse almoço tá bom?', 'comi 2 ovos e pão']) assert.equal(pareceProgresso(t), false, t);
});

// ---------- critérios de comida e calibração ----------
test('comida: dia de hoje, dia com um registro só e dia muito abaixo da mediana ficam fora das contas', () => {
  const refeicoes = [
    { dia: '2030-03-20', estimativa: { kcal: 1500 } }, { dia: '2030-03-20', estimativa: { kcal: 1500 } },
    { dia: '2030-03-21', estimativa: { kcal: 1600 } }, { dia: '2030-03-21', estimativa: { kcal: 1400 } },
    { dia: '2030-03-22', estimativa: { kcal: 900 } }, // um registro só
    { dia: '2030-03-23', estimativa: { kcal: 600 } }, { dia: '2030-03-23', estimativa: { kcal: 500 } }, // 1.100 < 65% de 3.000
    { dia: '2030-03-29', estimativa: { kcal: 400 } }, { dia: '2030-03-29', estimativa: { kcal: 300 } }, // hoje
  ];
  const c = diasDeComida(refeicoes, { dia: '2030-03-29' });
  assert.deepEqual(c.completos.map((x) => x.dia), ['2030-03-20', '2030-03-21']);
  assert.deepEqual(c.incompletos.map((x) => x.dia), ['2030-03-22', '2030-03-23']);
  assert.equal(c.dias.some((x) => x.dia === '2030-03-29'), false);
});

test('calibração: a tendência usada é só a do trecho com comida registrada (o bug da meta adaptativa de 09/10)', () => {
  // 4 dias subindo forte ANTES do primeiro registro, depois 3 semanas estáveis comendo 3.500 com relógio 2.600
  const pesagens = [...serie({ dia: somarDias(DIA, -22), dias: 5, inicio: 73, kgSemana: 7 }), ...serie({ dia: DIA, dias: 22, inicio: 76, kgSemana: 0, ruido: 0.1 })];
  const { refeicoes, gastos } = comida({ kcal: 3500, gasto: 2600, dias: 21 });
  const c = diasDeComida(refeicoes, { dia: DIA });
  const cal = calibrarEnergia({ pontos: validarPesagens(pesagens, { dia: DIA }).pontos, completos: c.completos, gastos });
  assert.equal(cal.de, somarDias(DIA, -21));
  assert.ok(Math.abs(cal.tendencia.kgSemana) < 0.15, `tendência no trecho ${cal.tendencia.kgSemana}`);
  assert.ok(Math.abs(cal.gastoReal - 3500) < 200, `gasto real ${cal.gastoReal}`);
  assert.ok(cal.vies > 700, `viés ${cal.vies}`);
  // a meta adaptativa usa a MESMA conta (antes a regressão pegava a subida de antes do registro e o gasto saía baixo)
  const g = gastoAdaptativo({ refeicoes, pesagens, perfil: perfilGanho, dia: DIA, gastos });
  assert.equal(g.status, 'calibrado');
  assert.equal(g.gasto, Math.round(cal.gastoReal));
  const tudo = tendenciaPeso(validarPesagens(pesagens).pontos, { dia: DIA });
  assert.ok(tudo.kgSemana > 0.2, `a janela de 28 dias inteira sobe ${tudo.kgSemana}`); // ~+0,26: é isso que a meta antiga usava
});

test('julgarRitmo: status, probabilidade e confiança, no ganho e na perda', () => {
  const t = (kgSemana, se) => ({ suficiente: true, kgSemana, seKgSemana: se, ic95: [kgSemana - 2 * se, kgSemana + 2 * se], direcao: 'indefinida' });
  const longe = julgarRitmo({ tend: t(0.1, 0.05), alvo: 0.38, limite: 0.38, direcao: 1 });
  assert.equal(longe.status, 'abaixo');
  assert.equal(longe.confianca, 'alta');
  const incerto = julgarRitmo({ tend: t(0.3, 0.15), alvo: 0.38, limite: 0.38, direcao: 1 });
  assert.equal(incerto.status, 'abaixo');
  assert.equal(incerto.confianca, 'baixa');
  assert.match(incerto.texto, /ainda incerto/);
  assert.equal(julgarRitmo({ tend: t(0.37, 0.05), alvo: 0.38, limite: 0.38, direcao: 1 }).status, 'no_alvo');
  assert.equal(julgarRitmo({ tend: t(0.7, 0.05), alvo: 0.38, limite: 0.38, direcao: 1 }).status, 'acima');
  const perda = julgarRitmo({ tend: t(-0.1, 0.05), alvo: -0.6, limite: -0.8, direcao: -1 });
  assert.equal(perda.status, 'abaixo');
  assert.match(perda.texto, /perdendo abaixo do ritmo alvo/);
  assert.equal(julgarRitmo({ tend: t(-0.6, 0.05), alvo: -0.6, limite: -0.8, direcao: -1 }).status, 'no_alvo');
  assert.equal(julgarRitmo({ tend: t(-1.2, 0.05), alvo: -0.6, limite: -0.8, direcao: -1 }).status, 'acima');
  assert.equal(julgarRitmo({ tend: t(0.2, 0.05), alvo: null, direcao: 0 }).status, 'neutro');
});

test('gasto de atividade sem relógio entra líquido do repouso (o relógio já conta o basal das 24 h)', async () => {
  const { somarGastosExtras } = await import('../atividades.js');
  // vôlei de 2 h estimado em 758 kcal (MET bruto) com 75,5 kg: o repouso dessas 2 h (~151 kcal) já está no total do relógio
  const rel = somarGastosExtras({ peso: 75.5, gastos: { '2030-03-10': 2773 } }, { '2030-03-10': [{ kcal: 758, minutos: 120 }] });
  assert.equal(rel.gastos['2030-03-10'], 2773 + 758 - 151);
  // sem duração conhecida, soma como veio
  assert.equal(somarGastosExtras({ gastos: { '2030-03-10': 2500 } }, { '2030-03-10': [{ kcal: 900 }] }).gastos['2030-03-10'], 3400);
});

test('meta: passar da etapa segue o objetivo (não vira déficit) e o freio da gordura vale mesmo com prazo', async () => {
  const { metaBalancoPara } = await import('../resumo.js');
  // 80,6 kg com etapa de 80 e objetivo de ganho: antes saía "déficit de ~890 kcal/dia"
  const passou = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 80.6, metaPeso: 80, dia: '2030-03-01', ritmo: 'maximo', metaModo: 'etapa' });
  assert.ok(passou.min > 0 && passou.ritmoKgSemana > 0, JSON.stringify(passou));
  assert.equal(passou.etapaBatida, true);
  assert.match(passou.detalhe, /passou 0,6 kg da etapa/);
  // perda em etapa, passou pra baixo: segue perdendo
  const perdeu = metaBalancoPara({ objetivo: 'emagrecer', peso: 69, metaPeso: 70, dia: '2030-03-01', ritmo: 'medio', metaModo: 'etapa' });
  assert.ok(perdeu.max < 0 && perdeu.ritmoKgSemana < 0, JSON.stringify(perdeu));
  // meta final passada continua sendo manutenção/redução (não muda)
  const final = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 80.6, metaPeso: 80, dia: '2030-03-01', ritmo: 'maximo', metaModo: 'final' });
  assert.ok(final.ritmoKgSemana <= 0, JSON.stringify(final));
  // freio: gordura subindo 1,6 pp em 28 dias com prazo apertado -> ritmo no mínimo saudável, não o "necessário" do prazo
  const semFreio = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 76.5, metaPeso: 80, metaPrazo: '2030-06-01', dia: '2030-03-01', ritmo: 'medio' });
  const comFreio = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 76.5, metaPeso: 80, metaPrazo: '2030-06-01', dia: '2030-03-01', ritmo: 'medio', gorduraTend: 1.6 });
  assert.ok(Math.abs(comFreio.ritmoKgSemana - 76.5 * 0.0025) < 1e-9, `${comFreio.ritmoKgSemana}`);
  assert.ok(semFreio.ritmoKgSemana > comFreio.ritmoKgSemana);
});

test('calibração semanal: semana velha não entra de novo; "pode confiar" só com confiança', async () => {
  const { atualizarCalibracaoEnergia, descreverCalibracaoEnergia } = await import('../calibracao.js');
  const atual = { energia: { viesKcalDia: 300, confianca: 0.5, semanas: 2, ultimaSemana: '2030-03-10', historico: [] } };
  const velha = atualizarCalibracaoEnergia(atual, { semanas: [{ idx: 1, fim: '2030-03-03', balanco: 900, diasBalanco: 5 }], ritmoReal: 0, dia: '2030-03-17' });
  assert.equal(velha, atual.energia);
  assert.doesNotMatch(descreverCalibracaoEnergia({ energia: { viesKcalDia: 30, confianca: 0.25, semanas: 1 } }), /Pode confiar/);
  assert.match(descreverCalibracaoEnergia({ energia: { viesKcalDia: 30, confianca: 0.75, semanas: 3 } }), /Pode confiar/);
});

test('avaliarRitmo: "lento" mede o que falta até a borda de BAIXO da faixa', async () => {
  const { avaliarRitmo } = await import('../previsao.js');
  // 74 kg: faixa 185 a 370 g/semana; +0,10 -> faltam ~85 g = ~90 kcal/dia (antes: 270 g e 300 kcal, até a borda de cima)
  assert.match(avaliarRitmo({ peso: 74, deltaKg: 0.1, objetivo: 'Hipertrofia' }), /faltam ~85 g\/semana, ou seja 90 kcal\/dia a mais/);
  assert.match(avaliarRitmo({ peso: 80, deltaKg: -0.2, objetivo: 'emagrecer' }), /LENTO .* faltam ~200 g\/semana, ou seja 220 kcal\/dia a menos/);
});

// ---------- 10. o cenário real que originou a investigação (anonimizado) ----------
// Pessoa com objetivo de ganho (ritmo máximo, alvo +0,38 kg/semana); datas deslocadas, pesos com deslocamento constante e
// calorias arredondadas a 50: a forma da série é a real (26 pesagens de relógio em 27 dias; 22 dias com registro).
const BASE = '2030-03-01'; // "13/09"
const PESOS = [70.3, 70.7, 70.4, 71.7, 71.2, 71.9, null, 71.3, 71.7, 71.7, 73.0, 71.7, 71.9, 71.7, 71.3, 71.1, 71.7, 72.9, 71.8, 71.3, 71.0, 71.0, 71.0, 71.1, 72.2, 72.1, 72.4];
const KCAL = { 4: [1300, 2], 5: 3150, 6: [2100, 3], 7: 2950, 8: 2850, 9: 3550, 10: 3350, 11: 3500, 12: 2900, 13: 3000, 14: 3750, 15: 2700, 16: 4250, 17: 3650, 18: 3300, 19: 3650, 20: 3300, 21: 3350, 22: 4400, 23: 4750, 24: 4500, 25: 4150 };
const GASTO = [1750, 2700, 2700, 3500, 2800, 2550, 2100, 1800, 2650, 2700, 2400, 3100, 2500, 1700, 1800, 2650, 2600, 3850, 2500, 2550, 2100, 1900, 3500, 3050, 3450, 3700, 2350];
function cenarioReal({ ultimoPeso = 26 } = {}) {
  const pesagens = PESOS.map((p, i) => (p == null || i > ultimoPeso ? null : { dia: somarDias(BASE, i), peso: p, fonte: 'relogio' })).filter(Boolean);
  const refeicoes = [];
  for (const [i, v] of Object.entries(KCAL)) {
    const [kcal, n] = Array.isArray(v) ? v : [v, 5];
    for (let k = 0; k < n; k++) refeicoes.push({ dia: somarDias(BASE, Number(i)), estimativa: { kcal: kcal / n, p: 35 } });
  }
  const gastos = Object.fromEntries(GASTO.map((g, i) => [somarDias(BASE, i), g]));
  return { pesagens, refeicoes, gastos, dia: somarDias(BASE, 26) };
}
const perfilReal = { nome: 'Pessoa A', objetivo: 'Hipertrofia com definição: ganhar massa o mais rápido possível dentro do saudável', metaPeso: 76, metaPrazo: '2030-07-03', metaModo: 'etapa', ritmo: 'maximo', peso: 72.4 };

test('cenário real anonimizado: tendência incerta, abaixo do alvo como o lado mais provável (não certo), registro x balança não batem', () => {
  const { pesagens, refeicoes, gastos, dia } = cenarioReal();
  const faixa = faixaDaMeta(perfilReal, dia, pesagens);
  assert.ok(Math.abs(faixa.ritmoKgSemana - 0.005 * 72.4) < 0.01, `alvo ${faixa.ritmoKgSemana}`); // ritmo máximo: 0,5% do peso
  const a = analisarProgresso({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa });
  // a balança: ~+0,2 kg/semana, intervalo que inclui o zero e o alvo -> sem direção firme
  assert.equal(a.tendencia.n, 26);
  assert.ok(a.tendencia.kgSemana > 0.1 && a.tendencia.kgSemana < 0.3, `ritmo ${a.tendencia.kgSemana}`);
  assert.ok(a.tendencia.ic95[0] < 0 && a.tendencia.ic95[1] > faixa.ritmoKgSemana, JSON.stringify(a.tendencia.ic95));
  assert.equal(a.tendencia.direcao, 'indefinida');
  // veredito: abaixo, sem certeza. Com o IC corrigido (revisão de 09/10: o ρ dos resíduos é ~0,5, os graus de liberdade
  // efetivos caem pra 8 e o intervalo vai de ~−0,27 a ~+0,66), "abaixo" é o lado mais provável (~78%), não conclusão firme:
  // confiança baixa, e o texto pede mais 1 a 2 semanas. Antes da correção saía 'media', com um IC estreito demais.
  assert.equal(a.veredito.status, 'abaixo');
  assert.equal(a.veredito.confianca, 'baixa');
  assert.ok(a.veredito.prob > 0.7 && a.veredito.prob < 0.8, `prob ${a.veredito.prob}`);
  assert.match(a.veredito.texto, /ainda incerto \(\d+%\): mais 1 a 2 semanas de pesagem decidem/);
  // comida x balança no trecho com registro: o registro diz ~+900 kcal/dia de sobra; a balança, ~0
  assert.ok(a.energia.balancoRegistrado > 750 && a.energia.balancoRegistrado < 1050, `registrado ${a.energia.balancoRegistrado}`);
  assert.ok(Math.abs(a.energia.tendencia.kgSemana) < 0.2, `balança no trecho ${a.energia.tendencia.kgSemana}`);
  assert.ok(a.energia.vies > 600, `viés ${a.energia.vies}`);
  assert.ok(a.alertas.some((x) => x.tipo === 'registro_acima_da_balanca'));
  // +1,4 kg nos últimos 6 dias: nesta série (dp ~0,5 kg entre pesagens, com picos de 73,0 e 72,9 antes) fica dentro de ~2
  // desvios da diferença entre duas pesagens (1,96·√2·dp ≈ 1,4 kg), então NÃO vira alerta de oscilação. Com o limiar antigo
  // (1,5 dp sobre a janela inteira) o alerta saía em ~30% dos dias sem evento nenhum (revisão de 09/10).
  assert.ok(!a.alertas.some((x) => x.tipo === 'curto_vs_longo'));
  // meta de calorias que a balança sustenta: ~3.900-4.150 registradas; a última semana (~4.000) está dentro
  assert.ok(a.metaKcal.min >= 3800 && a.metaKcal.max <= 4300, JSON.stringify(a.metaKcal));
  assert.equal(a.situacaoIngestao, 'dentro');
  // a conclusão não manda comer mais: a comida já bate com o que a balança pede; manter e conferir
  assert.match(a.conclusao, /já é compatível com o que a balança pede .*: manter e conferir a tendência em 1 a 2 semanas/);
  assert.doesNotMatch(a.conclusao, /kcal\/dia a mais/);
});

test('cenário real anonimizado: !tendencia, !hoje e prompt dizem a mesma coisa que o !progresso', () => {
  const { pesagens, refeicoes, gastos, dia } = cenarioReal();
  const faixa = faixaDaMeta(perfilReal, dia, pesagens);
  const a = analisarProgresso({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa });
  const proj = projecaoAteMeta({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa });
  // antes: "+0,29 esperado" (balança +0,16 misturada com +0,82 da comida) e "um pouco abaixo, coma +47 kcal"
  assert.equal(proj.discordante, true);
  assert.equal(proj.ritmo.esperado, proj.ritmo.real); // não mistura balança com comida descalibrada
  assert.equal(proj.julgamento.status, a.veredito.status);
  assert.equal(proj.status, 'abaixo');
  // a mesma confiança do !progresso (com o IC corrigido, "abaixo" é o lado mais provável, ~78%, não conclusão firme)
  assert.equal(proj.julgamento.confianca, a.veredito.confianca);
  assert.match(proj.veredito, /abaixo do ritmo da etapa \(\+0,\d\d kg\/semana pela balança contra \+0,36 kg do alvo; ainda incerto \(\d+%\)\)/);
  assert.doesNotMatch(proj.veredito, /kcal\/dia a mais/);
  assert.ok(proj.avisos.some((x) => /balança fica ABAIXO do que o registro prevê/.test(x)));
  assert.ok(proj.avisos.every((x) => !/refeição sem registro, ou é água/.test(x)));
  // !hoje: o balanço não diz "acima do alvo" pelo relógio cru
  const v = calcularVisao({ refeicoes, pesagens, perfil: perfilReal, dia, gastos });
  assert.equal(v.meta.status, 'calibrado');
  assert.equal(v.meta.gasto, Math.round(a.energia.gastoReal)); // meta adaptativa = mesma conta do progresso
  assert.deepEqual(v.meta.alvo, { min: a.metaKcal.min, max: a.metaKcal.max }); // a mesma meta de calorias, ao kcal
  assert.equal(v.balanco.situacao, a.situacaoIngestao); // e o mesmo julgamento da comida da última semana
  assert.equal(v.balanco.situacaoRelogio, 'acima');
  assert.equal(v.balanco.situacao, 'dentro');
  // e a média dos 7 dias é de dias fechados (hoje fora)
  assert.equal(v.sete.ate, somarDias(dia, -1));
  // amanhã: a faixa do dia é a mesma da meta adaptativa
  const amanha = previsaoGastoAmanha({ gastos, dia, objetivo: perfilReal.objetivo, metaAdaptativa: v.meta, perfil: perfilReal });
  assert.equal(amanha.alvo.max - amanha.alvo.min, v.meta.alvo.max - v.meta.alvo.min);
  assert.ok(amanha.fator > 1.25, `fator ${amanha.fator}`); // o limite antigo (1,25) cortava a correção
});

test('cenário real anonimizado: a aposta de domingo desconta o viés que a balança mede quando o balanço da comida não bate', () => {
  const { pesagens, refeicoes, gastos } = cenarioReal();
  const domingo = somarDias(BASE, 21); // "04/10"
  const p = preverSemana({ perfil: { ...perfilReal, peso: 71.0 }, refeicoes, pesagens: pesagens.filter((x) => x.dia <= domingo), gastos, dia: domingo });
  // revisão de 09/10: a 1ª correção trocava a aposta pela inclinação de 21 dias (janela diferente, sem erro-padrão, pesagens
  // cruas). Agora o balanço DESTA semana é corrigido pelo viés registro x balança medido no trecho alinhado (o mesmo critério e
  // a mesma conta do alerta do !progresso), com confiança baixa porque o viés tem incerteza de centenas de kcal
  assert.equal(p.base, 'balanço corrigido pela balança', p.texto);
  assert.equal(p.confianca, 'baixa');
  assert.match(p.texto, /o registro não bate com a balança: de \d\d\/\d\d a \d\d\/\d\d ele ficou ~[\d.]+ kcal\/dia acima do que o peso mostrou/);
  assert.ok(p.deltaKg < 0.4, `delta ${p.deltaKg}`); // antes: +0,79 kg pela comida, com "confiança alta"
  // passando a análise do mesmo dia (como o domingo faz), o viés é o mesmo do !progresso
  const analise = analisarProgresso({ perfil: perfilReal, dia: domingo, pesagens: pesagens.filter((x) => x.dia <= domingo), refeicoes, gastos });
  const comAnalise = preverSemana({ perfil: { ...perfilReal, peso: 71.0 }, refeicoes, pesagens: pesagens.filter((x) => x.dia <= domingo), gastos, dia: domingo, analise });
  assert.ok(analise.alertas.some((x) => x.tipo === 'registro_acima_da_balanca'));
  assert.equal(comAnalise.deltaKg, p.deltaKg);
});

test('aposta de domingo: começar o bulk na semana não vira "registro descalibrado", e pesagem de outra pessoa não decide', () => {
  // 3 semanas comendo 2.600 com o relógio marcando 2.600 e o peso parado; nesta semana, 3.200 (+600/dia)
  const dia = '2030-03-28';
  const refeicoes = [];
  const gastos = {};
  for (let i = 27; i >= 0; i--) {
    const d = somarDias(dia, -i);
    const kcal = i < 7 ? 3200 : 2600;
    for (let k = 0; k < 4; k++) refeicoes.push({ dia: d, estimativa: { kcal: kcal / 4, p: 40 } });
    gastos[d] = 2600;
  }
  const pesagens = Array.from({ length: 28 }, (_, i) => ({ dia: somarDias(dia, -27 + i), peso: 75 + (i % 2 ? 0.2 : -0.2), fonte: 'relogio' }));
  const p = preverSemana({ perfil: { peso: 75, objetivo: 'hipertrofia' }, refeicoes, pesagens, gastos, dia });
  assert.equal(p.base, 'balanço energético', p.texto); // registro e balança bateram nas semanas anteriores
  assert.ok(Math.abs(p.deltaKg - (600 * 7) / 7700) < 0.02, `delta ${p.deltaKg}`); // +0,55 kg: a mudança da semana conta
  assert.doesNotMatch(p.texto, /descalibrad|não bate/);
  // outra pessoa na balança no sábado (62,3 kg): sai na validação e não mexe na aposta
  const comIntrusa = preverSemana({ perfil: { peso: 75, objetivo: 'hipertrofia' }, refeicoes, pesagens: [...pesagens.filter((x) => x.dia !== somarDias(dia, -1)), { dia: somarDias(dia, -1), peso: 62.3, fonte: 'manual' }], gastos, dia });
  assert.equal(comIntrusa.base, 'balanço energético');
  assert.ok(Math.abs(comIntrusa.deltaKg - p.deltaKg) < 0.01);
  assert.ok(comIntrusa.pesoInicial > 70, `peso inicial ${comIntrusa.pesoInicial}`);
});

test('cenário real anonimizado às 06:51 (antes da pesagem do dia): veredito igual em todos os caminhos', () => {
  const { pesagens, refeicoes, gastos, dia } = cenarioReal({ ultimoPeso: 25 });
  const faixa = faixaDaMeta(perfilReal, dia, pesagens);
  const a = analisarProgresso({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa });
  const proj = projecaoAteMeta({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa });
  assert.equal(a.veredito.status, 'abaixo');
  assert.equal(proj.julgamento.status, 'abaixo');
  assert.equal(proj.julgamento.prob, a.veredito.prob);
  // o texto da conversa que dissesse "no ritmo" ou "comendo além do objetivo" seria barrado
  assert.ok(conferirTextoProgresso('Você está no ritmo da etapa!', a).length);
  assert.ok(conferirTextoProgresso('Seu balanço está acima do alvo: está comendo além do objetivo.', a).length);
});

// ---------- 11. revisão adversarial de 09/10 (39 achados confirmados) ----------
/** gerador determinístico (mulberry32) + normal por Box-Muller, pras simulações abaixo */
function aleatorio(semente) {
  let a = semente;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { rnd, normal };
}
/** 28 pesagens diárias com ruído AR(1) (autocorrelação f, desvio sigma) em volta de uma reta de kgSemana */
function serieAR(normal, { f = 0.5, sigma = 0.5, kgSemana = 0.2, n = 28 } = {}) {
  let e = (normal() * sigma) / Math.sqrt(1 - f * f);
  return Array.from({ length: n }, (_, i) => {
    e = f * e + normal() * sigma;
    return { dia: somarDias(DIA, -(n - 1 - i)), peso: 75 + (kgSemana * i) / 7 + e };
  });
}

test('IC da tendência: a probabilidade do veredito usa a mesma t do intervalo, e o "95%" cobre perto de 95% com pesagens autocorrelacionadas', () => {
  const { pT, t95 } = P;
  // pT (t de Student, aproximação de Hill) inverte t95: o veredito "alta" (≥ 97,5%) só sai com o alvo fora do IC impresso
  for (const gl of [3, 8, 15, 30]) assert.ok(Math.abs(pT(t95(gl), gl) - 0.975) < 0.002, `gl ${gl}: ${pT(t95(gl), gl)}`);
  assert.ok(Math.abs(pT(0, 8) - 0.5) < 1e-9);
  assert.ok(pT(2, 8) < phi(2) - 0.01); // cauda mais pesada que a normal: com 8 graus de liberdade, 2 desvios não são 97,7%
  // cobertura medida (antes da correção do ρ e dos graus de liberdade: 73% a 88%); 1.500 séries por caso, semente fixa
  const cobertura = (f, semente) => {
    const { normal } = aleatorio(semente);
    let cobre = 0;
    for (let r = 0; r < 1500; r++) {
      const t = tendenciaPeso(serieAR(normal, { f }), { dia: DIA });
      if (t.ic95[0] <= 0.2 && 0.2 <= t.ic95[1]) cobre++;
    }
    return cobre / 1500;
  };
  const c0 = cobertura(0, 2026);
  const c5 = cobertura(0.5, 2031);
  assert.ok(c0 > 0.94 && c0 < 0.99, `ruído independente: ${c0}`);
  assert.ok(c5 > 0.9, `autocorrelação 0,5: ${c5}`);
});

test('julgarRitmo: "no alvo" com confiança unilateral e aviso de que pode estar passando do teto', () => {
  const tend = { suficiente: true, kgSemana: 0.4, seKgSemana: 0.08, gl: 20, n: 28, direcao: 'subindo' };
  const v = julgarRitmo({ tend, alvo: 0.38, limite: 0.375, direcao: 1 });
  assert.equal(v.status, 'no_alvo');
  assert.equal(v.confianca, 'baixa'); // P(ritmo > alvo − tolerância) ~76%
  assert.ok(v.pRapido > 0.3 && v.pRapido < 0.4, `pRapido ${v.pRapido}`);
  assert.match(v.texto, /ainda incerto \(\d+%\): mais 1 a 2 semanas de pesagem decidem; pode estar passando do teto saudável \(35%\)/);
  // a conferência não barra "rápido demais" quando o próprio veredito diz que pode estar passando do teto
  const a = { tendencia: { suficiente: true, direcao: 'subindo', kgSemana: 0.4 }, veredito: v, alertas: [], vereditoCurto: 'X' };
  assert.deepEqual(conferirTextoProgresso('Você pode estar ganhando rápido demais, de olho na gordura.', a), []);
  assert.deepEqual(conferirTextoProgresso('Seu peso está subindo rápido demais.', a), []);
  assert.deepEqual(conferirTextoProgresso('Seu peso está subindo rápido demais.', { ...a, veredito: { ...v, pRapido: 0.05 } }).map((x) => x.tipo), ['ritmo_oposto']);
});

test('pesagem semanal (o protocolo de quem não tem relógio): 4 pesagens cobrindo 3 semanas já dão tendência e veredito', () => {
  const semanal = [0, 7, 14, 21].map((d, i) => ({ dia: somarDias(DIA, -21 + d), peso: 75 + 0.35 * i }));
  const t = tendenciaPeso(semanal, { dia: DIA });
  assert.equal(t.suficiente, true, t.motivo);
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens: semanal, faixa: ganho });
  assert.notEqual(a.veredito.status, 'inconclusivo');
  // 3 pesagens em 2 semanas ainda não; o motivo diz o que falta
  const curta = tendenciaPeso(semanal.slice(1), { dia: DIA });
  assert.equal(curta.suficiente, false);
  assert.match(curta.motivo, /ou 4\+ cobrindo 21\+ dias, pra quem pesa uma vez por semana/);
});

test('oscilação curta: com peso andando no ritmo e ruído normal o alerta é raro (a 1ª versão disparava em ~30% dos dias)', () => {
  const taxa = (f, sigma, semente) => {
    const { normal } = aleatorio(semente);
    let alarmes = 0;
    for (let r = 0; r < 400; r++) {
      const pts = serieAR(normal, { f, sigma });
      if (oscilacaoCurta(pts, tendenciaPeso(pts, { dia: DIA }), { dia: DIA })) alarmes++;
    }
    return alarmes / 400;
  };
  const independente = taxa(0, 0.4, 77);
  const autocorrelado = taxa(0.5, 0.4, 82);
  assert.ok(independente < 0.1, `ruído independente: ${independente}`);
  assert.ok(autocorrelado < 0.18, `autocorrelação 0,5: ${autocorrelado}`);
  // e um salto de verdade (+1,5 kg nos 3 últimos dias, σ 0,3) continua sendo pego
  const { normal } = aleatorio(991);
  let pega = 0;
  for (let r = 0; r < 200; r++) {
    const pts = serieAR(normal, { f: 0.3, sigma: 0.3, kgSemana: 0 });
    for (const p of pts.slice(-3)) p.peso += 1.5;
    if (oscilacaoCurta(pts, tendenciaPeso(pts, { dia: DIA }), { dia: DIA })) pega++;
  }
  assert.ok(pega / 200 > 0.85, `sensibilidade ${pega / 200}`);
});

test('comida contra a meta calibrada: dentro da incerteza da meta é "compatível", e o !hoje diz a mesma coisa', () => {
  // a série real (IC largo: ±~635 kcal na meta) com a última semana comendo 400 kcal/dia a menos
  const { pesagens, refeicoes, gastos, dia } = cenarioReal();
  const menos = refeicoes.map((r) => (r.dia >= somarDias(BASE, 19) ? { ...r, estimativa: { ...r.estimativa, kcal: r.estimativa.kcal - 400 / (refeicoes.filter((x) => x.dia === r.dia).length) } } : r));
  const faixa = faixaDaMeta(perfilReal, dia, pesagens);
  const a = analisarProgresso({ perfil: perfilReal, dia, pesagens, refeicoes: menos, gastos, faixa });
  assert.ok(a.ingestaoRecente.kcal < a.metaKcal.min - 100, `${a.ingestaoRecente.kcal} x ${a.metaKcal.min}`); // fora da faixa
  assert.ok(a.metaKcal.folga > 400, `folga ${a.metaKcal.folga}`);
  assert.equal(a.situacaoIngestao, 'dentro'); // mas dentro da incerteza dela: não é "abaixo"
  assert.equal(a.naFaixa, false);
  assert.match(a.resumoZap, /\(compatível, dentro da incerteza de ±\d{3} kcal\)/);
  assert.match(a.conclusao, /já é compatível com o que a balança pede .*fora da faixa, mas dentro da incerteza dela/);
  const v = calcularVisao({ refeicoes: menos, pesagens, perfil: perfilReal, dia, gastos });
  assert.equal(v.balanco.situacao, a.situacaoIngestao);
  assert.equal(v.balanco.naFaixa, a.naFaixa);
  assert.equal(Math.round(v.balanco.folga), Math.round(a.metaKcal.folga)); // a mesma folga, ao kcal
  assert.match(visaoZap({ refeicoes: menos, pesagens, perfil: perfilReal, dia, gastos }), /→ compatível \(dentro da incerteza de ±\d{3} kcal\)/);
});

test('conclusão: quem está acima do ritmo nunca recebe "coma mais", mesmo com a última semana abaixo da faixa', () => {
  // 28 dias subindo +0,8 kg/semana (acima do teto de ~0,38) e a última semana comendo bem menos
  const pesagens = serie({ kgSemana: 0.8, ruido: 0.1 });
  const { refeicoes, gastos } = comida({ kcal: 3500, gasto: 2600 });
  const ultima = refeicoes.map((r) => (distDiasTeste(r.dia, DIA) <= 7 ? { ...r, estimativa: { ...r.estimativa, kcal: (r.estimativa.kcal * 2400) / 3500 } } : r));
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes: ultima, gastos, faixa: ganho });
  assert.equal(a.veredito.status, 'acima');
  assert.equal(a.situacaoIngestao, 'abaixo');
  assert.match(a.conclusao, /o peso andou rápido demais: não aumente; segure e confira em 1 a 2 semanas/);
  assert.doesNotMatch(a.conclusao, /Pra andar no alvo|kcal\/dia a mais/);
});
function distDiasTeste(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

test('pergunta de progresso: o que é do peso de quem mandou entra; papo alheio, peso de outra pessoa e treino não', () => {
  const { pareceProgresso, rotaPerguntaProgresso } = P;
  const sim = [
    'meu peso estagnou?', 'será que tô no caminho certo pra meta?', 'quanto eu engordei esse mês?', 'o que acha do meu ganho até agora?', 'emagreci?',
    'travado nos 72 kg', 'como tá meu progresso com esse treino novo?', 'to engordando muito rápido?', 'pq vc disse que eu to abaixo do ganho esperado se eu como acima da meta?',
    'qual meu ritmo?', 'como tô indo?', 'tô no caminho certo?', 'meu progresso?', 'quanto falta pros 80?', 'e o ritmo?', 'Você disse que o ritmo tá abaixo, por quê?',
  ];
  const nao = [
    'o ritmo do trabalho hoje tá insano', 'qual a próxima etapa da obra?', 'a tendência é chover amanhã à tarde', 'meu progresso na faculdade tá ótimo',
    'a evolução do bebê tá linda', 'qual a tendência do dólar?', 'Parabéns pelo progresso, Ale!', 'a Ale tá perdendo peso rápido', 'vc tá engordando hein',
    'faltam 80 g de proteína', 'quanto falta pra meta de hoje?', 'como tô indo no trabalho?', 'subi 10 kg no agachamento', 'faltam 45 dias pra viagem',
  ];
  for (const t of sim) assert.equal(pareceProgresso(t), true, t);
  for (const t of nao) assert.equal(pareceProgresso(t), false, t);
  // a rota da produção (e da avaliação): relato de refeição, refeição em andamento, foto e conversa sobre o sistema ficam no
  // caminho de sempre, pra refeição não deixar de ser registrada
  assert.equal(rotaPerguntaProgresso({ texto: 'tô engordando?' }), true);
  assert.equal(rotaPerguntaProgresso({ texto: 'comi 2 ovos e pão, tô engordando?' }), false);
  // "mesmo comendo muito" é hábito, não refeição: continua sendo pergunta de progresso
  assert.equal(rotaPerguntaProgresso({ texto: 'parece que meu peso ta caindo mesmo comendo muito, ta errado isso?' }), true);
  assert.equal(rotaPerguntaProgresso({ texto: 'tô engordando?', emAndamento: { hora: '12:00' } }), false);
  assert.equal(rotaPerguntaProgresso({ texto: 'tô engordando?', temImagem: true }), false);
  assert.equal(rotaPerguntaProgresso({ texto: 'tô engordando?', metaConversa: true }), false);
});

test('conferência: negação, dúvida, finalidade, pergunta, janela curta e prato não são contradição; as contradições reais são', () => {
  const base = { vereditoCurto: 'X', alertas: [], situacaoIngestao: 'dentro' };
  const REAL = { ...base, tendencia: { suficiente: true, direcao: 'indefinida', kgSemana: 0.2 }, veredito: { status: 'abaixo', confianca: 'media' }, alertas: [{ tipo: 'registro_acima_da_balanca' }] };
  const ALTA = { ...REAL, veredito: { status: 'abaixo', confianca: 'alta' } };
  const PERDA = { ...base, tendencia: { suficiente: true, direcao: 'caindo', kgSemana: -0.33 }, veredito: { status: 'no_alvo', confianca: 'alta' } };
  const GANHO = { ...base, tendencia: { suficiente: true, direcao: 'subindo', kgSemana: 0.4 }, veredito: { status: 'no_alvo', confianca: 'alta', pRapido: 0 } };
  const INSUF = { ...base, tendencia: { suficiente: false, direcao: 'insuficiente', kgSemana: null }, veredito: { status: 'inconclusivo' } };
  const tipos = (t, a) => conferirTextoProgresso(t, a).map((x) => x.tipo).sort().join(',');
  const passam = [
    [REAL, 'O relógio diz saldo de +888 kcal/dia, mas isso não significa que você está comendo demais pro objetivo.'],
    [INSUF, 'Com 4 pesagens não dá pra dizer se o peso está subindo.'],
    [INSUF, 'Ainda não dá pra dizer se você está no ritmo da etapa.'],
    [GANHO, 'Seu peso não está parado: subiu de 70 para 71,3 kg.'],
    [ALTA, '⚖️ *Veredito:* 9/10, prato redondo que tá no alvo pro ganho de massa.'],
    [ALTA, '💡 *Dica:* pra subir no ritmo da etapa, põe mais uma concha de arroz no jantar.'],
    [GANHO, 'Almoço atrasado hoje, mas o seu peso segue no alvo.'],
    [PERDA, 'OSCILAÇÃO CURTA: de 03/10 a 09/10 o peso subiu 0,9 kg, quando a tendência de 4 semanas explicaria −0,3 kg.'],
    [PERDA, 'Nos últimos 5 dias o peso subiu 1,2 kg, mas é água e sal.'],
    [REAL, 'Pra andar no alvo, a balança pede 3.920 a 4.120 kcal/dia.'],
    [ALTA, 'Se comer uns 4.000 kcal por dia, você fica no alvo da etapa.'],
    [REAL, 'Tá no ritmo da etapa? Ainda não: +0,20 contra +0,38 kg/semana.'],
    [ALTA, 'O ritmo certo da etapa é +0,38 kg/semana.'],
    [REAL, 'Você come acima da média do grupo.'],
    // poucas pesagens e frase que se diz provisória: descreve a variação, não crava tendência (avaliação, cenário P03)
    [INSUF, 'Por enquanto, o peso subiu e isso é ótimo pra quem quer ganhar, mas ainda é cedo pra dizer se a velocidade está certa.'],
  ];
  for (const [a, f] of passam) assert.equal(tipos(f, a), '', f);
  const barradas = [
    [REAL, 'Você está no caminho certo pro alvo, segue assim!', 'ritmo_oposto'],
    [REAL, 'Seu ritmo tá bom, só manter.', 'ritmo_oposto'],
    [ALTA, 'Você está ganhando no ritmo.', 'ritmo_oposto'],
    [PERDA, 'Você engordou esse mês.', 'direcao_oposta'],
    [PERDA, 'Você ganhou 1,5 kg no mês.', 'direcao_oposta'],
    [PERDA, 'Seu peso não está caindo, está subindo.', 'direcao_oposta'],
    [GANHO, 'Você perdeu 2 kg no mês.', 'direcao_oposta'],
    [PERDA, 'Seu peso está subindo; capricha no jantar.', 'direcao_oposta'],
    [PERDA, 'De 12/09 a 09/10 o peso subiu 0,8 kg.', 'direcao_oposta'],
    [INSUF, 'Seu peso está subindo bem!', 'direcao_sem_base'],
    [PERDA, 'Até agora o peso subiu.', 'direcao_oposta'], // com dados bastantes, "até agora" não livra a contradição
    [REAL, 'Pelo relógio você está comendo além do objetivo, com balanço acima do alvo.', 'excesso_sem_balanca'],
  ];
  for (const [a, f, esperado] of barradas) assert.equal(tipos(f, a), esperado, f);
  // fronteira de palavra com acento: "essa manhã" no fim da frase é janela curta (com o \b do JS, que só conhece ASCII, o
  // "manhã" final não casava e a frase virava direção oposta à tendência de subida)
  assert.equal(tipos('Seu peso caiu bastante essa manhã', GANHO), '');
});

test('análise de prato com frase de progresso contraditória: só a frase sai (não refaz a análise inteira)', () => {
  const { tirarFrases } = P;
  const a = { vereditoCurto: 'X', alertas: [], tendencia: { suficiente: true, direcao: 'subindo', kgSemana: 0.2 }, veredito: { status: 'abaixo', confianca: 'alta' } };
  const resposta = '🍽️ *O que eu vi:* arroz, feijão e frango\n🔥 *Estimativa:* ~750 kcal\nVocê está no ritmo da etapa, segue assim. Proteína ótima nesse prato.';
  const achados = conferirTextoProgresso(resposta, a);
  assert.deepEqual(achados.map((x) => x.tipo), ['ritmo_oposto']);
  const limpa = tirarFrases(resposta, achados.map((x) => x.frase));
  assert.equal(limpa, '🍽️ *O que eu vi:* arroz, feijão e frango\n🔥 *Estimativa:* ~750 kcal\nProteína ótima nesse prato.');
  assert.deepEqual(conferirTextoProgresso(limpa, a), []);
});

test('relógio: a pesagem da manhã guardada não vira a da noite quando o envio de 72 h chega só com a noite', async () => {
  const { fundir } = await import('../relogio.js');
  const manha = { dia: '2030-03-06', hora: '07:10', peso: 75.6, fonte: 'com.sec.android.app.shealth' };
  const noite = { dia: '2030-03-06', hora: '22:18', peso: 76.9, fonte: 'com.sec.android.app.shealth' };
  const vazio = { sonos: [], atividades: [] };
  // envio de 09/10 12:00: a janela começa em 06/10 12:00 e traz desse dia só a pesagem da noite
  const r = fundir({ pesos: [manha], ...vazio }, { pesos: [noite], ...vazio }, '2030-03-09');
  assert.deepEqual(r.pesos.map((p) => [p.hora, p.peso]), [['07:10', 75.6]]);
  // a mesma medição chegando de novo (mesma hora) é atualizada: pode trazer a gordura que faltava
  const comGordura = fundir({ pesos: [manha], ...vazio }, { pesos: [{ ...manha, gordura: 18.2 }], ...vazio }, '2030-03-09');
  assert.equal(comGordura.pesos[0].gordura, 18.2);
  // guardada a da noite (regra antiga) e chega a da manhã: fica a da manhã
  assert.equal(fundir({ pesos: [noite], ...vazio }, { pesos: [manha], ...vazio }, '2030-03-09').pesos[0].hora, '07:10');
});

test('meta: freio da gordura também com "mínimo" pedido e prazo; ruído da bioimpedância não liga o freio; peso de referência suavizado', async () => {
  const { metaBalancoPara, pesoDeReferencia, tendenciaGorduraIC } = await import('../resumo.js');
  // pedido 'minimo' + prazo apertado + gordura subindo 1,6 pp: o ritmo é o mínimo saudável (antes ficava o do prazo, 0,383)
  const minimo = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 76.5, metaPeso: 80, metaPrazo: '2030-04-15', dia: '2030-03-01', ritmo: 'minimo', gorduraTend: 1.6 });
  assert.ok(Math.abs(minimo.ritmoKgSemana - 76.5 * 0.0025) < 1e-9, `${minimo.ritmoKgSemana}`);
  // gordura parada com ruído de ~±1,3 pp (o do relógio real): a inclinação crua dá +1,3 pp/28 dias, mas o IC cruza o zero
  const ruidoG = [0.9, -1.3, 0.4, 1.1, -0.8, -1.5, 1.6, 0.2, -0.4, 1.2, -1.1, 0.7, -0.2, 1.4, -1.6, 0.3, 0.9, -0.7, 1.3, -1.2, 0.5, 1.5, -0.9, -0.3, 1.0, -1.4, 0.6, 1.7];
  const ruidosa = serie({ kgSemana: 0.2, ruido: 0.2 }).map((p, i) => ({ ...p, gordura: Math.round((18 + 0.035 * i + ruidoG[i]) * 10) / 10 }));
  const g = tendenciaGorduraIC(ruidosa);
  assert.ok(g.pp28 > 0.8 && g.ic[0] < 0, JSON.stringify(g));
  const semFreio = faixaDaMeta({ ...perfilGanho, ritmo: 'maximo' }, DIA, ruidosa);
  assert.equal(semFreio.freio, '');
  // gordura subindo de verdade (2 pp em 28 dias, pouco ruído): freia
  const subindo = serie({ kgSemana: 0.2, ruido: 0.2 }).map((p, i) => ({ ...p, gordura: Math.round((18 + (2.0 * i) / 27 + (i % 2 ? 0.2 : -0.2)) * 10) / 10 }));
  const comFreio = faixaDaMeta({ ...perfilGanho, ritmo: 'maximo' }, DIA, subindo);
  assert.match(comFreio.freio, /gordura corporal subindo 2,1 pontos em 28 dias/);
  assert.ok(comFreio.ritmoKgSemana < semFreio.ritmoKgSemana);
  // peso de referência: o de tendência, não a última pesagem com pico de água (+1 kg)
  const pico = serie({ kgSemana: 0.2, ruido: 0.1 });
  pico[pico.length - 1] = { ...pico[pico.length - 1], peso: pico[pico.length - 1].peso + 1.0 };
  const ref = pesoDeReferencia(validarPesagens(pico, { dia: DIA }).pontos, DIA, perfilGanho);
  assert.equal(ref.rotulo, 'peso de tendência');
  assert.ok(pico[pico.length - 1].peso - ref.peso > 0.5, `${ref.peso}`);
  assert.match(faixaDaMeta(perfilGanho, DIA, pico).detalhe, /está em [\d,]+ kg \(peso de tendência\)/);
  // e o pico perto da etapa não liga "etapa batida" (a linha de tendência ainda diz que falta)
  const etapa = faixaDaMeta({ ...perfilGanho, metaPeso: 76.6 }, DIA, pico);
  assert.equal(etapa.etapaBatida, false);
  // poucas pesagens: média das dos últimos 7 dias
  const poucas = pesoDeReferencia(validarPesagens([{ dia: somarDias(DIA, -20), peso: 74 }, { dia: somarDias(DIA, -5), peso: 75 }, { dia: DIA, peso: 75.6 }], { dia: DIA }).pontos, DIA, perfilGanho);
  assert.deepEqual(poucas, { peso: 75.3, rotulo: 'média das 2 pesagens dos últimos 7 dias' });
});

test('!hoje: dia com o relógio fora do pulso (≤ 800 kcal) fica fora do saldo de 7 dias, como em todas as outras contas', () => {
  const refeicoes = [];
  const gastos = {};
  for (let i = 1; i <= 8; i++) {
    const d = somarDias(DIA, -i);
    refeicoes.push({ dia: d, estimativa: { kcal: 1500, p: 60 } }, { dia: d, estimativa: { kcal: 1500, p: 60 } });
    gastos[d] = i === 2 ? 450 : 2700; // anteontem o relógio ficou no carregador
  }
  const v = calcularVisao({ refeicoes, pesagens: [], perfil: { peso: 75, objetivo: 'hipertrofia' }, dia: DIA, gastos });
  assert.equal(v.balanco.diasMedia7, 6);
  assert.equal(Math.round(v.balanco.media7), 300); // sem o dia de 450: +300, dentro de +250 a +500 (com ele, +664 e "acima")
  assert.equal(v.balanco.situacaoRelogio, 'dentro');
  assert.equal(v.balanco.ultimoCompleto.dia, somarDias(DIA, -1));
});

test('registro x balança: a projeção do !tendencia decide "não batem" pela mesma conta e na mesma janela do alerta do !progresso', () => {
  const casos = [
    cenarioReal(), // o caso real: registro ~+900 kcal/dia acima da balança
    { ...cenarioReal(), gastos: Object.fromEntries(Object.entries(cenarioReal().gastos).map(([d, g]) => [d, g + 900])) }, // relógio corrigido: batem
  ];
  for (const { pesagens, refeicoes, gastos, dia } of casos) {
    const faixa = faixaDaMeta(perfilReal, dia, pesagens);
    const a = analisarProgresso({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa });
    const proj = projecaoAteMeta({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa });
    const alerta = a.alertas.some((x) => x.tipo === 'registro_acima_da_balanca' || x.tipo === 'registro_abaixo_da_balanca');
    assert.equal(proj.discordante, alerta, `discordante ${proj.discordante} x alerta ${alerta}`);
  }
});

test('poucas pesagens: sem veredito, também sem "meta pela balança", sem julgar a comida por ela e sem data de chegada', () => {
  // 5 pesagens em 9 dias e 12 dias completos de comida, sem relógio (cenário da revisão de 09/10): antes o mesmo !progresso
  // dizia "ainda não dá pra julgar o ritmo" e "meta calibrada pela balança: 2.610 a 2.810 → acima"
  const pesagens = serie({ kgSemana: 0.45, ruido: 0.1, dias: 10 }).filter((_, i) => i % 2 === 0);
  const { refeicoes } = comida({ kcal: 3000, dias: 12 });
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes, faixa: ganho });
  assert.equal(a.veredito.status, 'inconclusivo');
  assert.ok(!a.metaKcal || a.metaKcal.base !== 'balanca', JSON.stringify(a.metaKcal));
  assert.equal(a.situacaoIngestao, null);
  assert.doesNotMatch(a.zap, /calibrada pela balança/);
  const proj = projecaoAteMeta({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes, gastos: {}, faixa: ganho });
  assert.equal(proj?.chegada ?? null, null);
});

// ---------- 12. leitura do gráfico (o que uma pessoa leria olhando as pesagens) ----------
test('leitura do gráfico, caso real: as últimas 3 semanas paradas contra +0,20 em 4 semanas, e a média móvel com pico e vale', () => {
  const { pesagens, refeicoes, gastos, dia } = cenarioReal();
  const a = analisarProgresso({ perfil: perfilReal, dia, pesagens, refeicoes, gastos, faixa: faixaDaMeta(perfilReal, dia, pesagens) });
  const l = a.leitura;
  assert.deepEqual(l.janelas.map((j) => j.dias), [7, 14, 21, 28]);
  const j21 = l.janelas.find((j) => j.dias === 21);
  assert.ok(Math.abs(j21.kgSemana) < 0.1, `21 dias ${j21.kgSemana}`); // parado nas últimas 3 semanas
  assert.ok(a.tendencia.kgSemana > 0.15); // e subindo nas 4
  assert.match(l.divergencia.texto, /^nas últimas 3 semanas o peso ficou praticamente parado .*enquanto as 4 semanas dão \+0,\d\d kg\/semana: a subida do período ficou mais no começo/);
  assert.ok(a.alertas.some((x) => x.tipo === 'janelas_divergem'));
  // a média móvel: sobe até o pico (~"22/09") e desce até o vale (~"04/10"), sem pico ou vale inventado nas pontas
  assert.match(l.historia, /^a média móvel de 7 dias começou em [\d,]+ kg \(\d\d\/\d\d\), subiu até [\d,]+ kg em \d\d\/\d\d, desceu até [\d,]+ kg em \d\d\/\d\d; a média dos últimos 7 dias está em/);
  assert.equal(l.semanas.length, 4);
  // vai pros três lugares: prompt, !progresso e !hoje
  assert.match(a.texto, /LEITURA DO GRÁFICO .*tendência por janela: 7 dias .* 21 dias .* 28 dias/);
  assert.match(a.zap, /\*Leitura do gráfico\*\n• Por janela:/);
  assert.match(a.resumoZap, /📉 Janela recente: nas últimas 3 semanas/);
});

test('leitura do gráfico: quem perde peso tem a divergência dita no sentido certo; série sem virada não ganha pico inventado', () => {
  // perda: caindo ~1,4 kg na primeira semana e parado nas últimas 3
  const pesagens = Array.from({ length: 28 }, (_, i) => ({ dia: somarDias(DIA, -27 + i), peso: Math.round((i < 7 ? 80 - 0.2 * i : 78.6 + (i % 2 ? 0.1 : -0.1)) * 10) / 10 }));
  const perda = analisarProgresso({ perfil: { objetivo: 'emagrecer' }, dia: DIA, pesagens, faixa: { ritmoKgSemana: -0.5, min: -600, max: -300, fonte: 'meta' } });
  assert.ok(perda.leitura.divergencia, JSON.stringify(perda.leitura.janelas));
  assert.match(perda.leitura.divergencia.texto, /a queda do período ficou mais no começo; nas últimas 3 semanas parou/);
  // subida reta: a média móvel só sobe (sem "desceu até")
  const reta = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens: serie({ kgSemana: 0.4, ruido: 0.05 }), faixa: ganho });
  assert.match(reta.leitura.historia, /subiu até/);
  assert.doesNotMatch(reta.leitura.historia, /desceu até/);
  assert.equal(reta.leitura.divergencia, null);
});

test('comida da semana x peso: semana comendo +700 kcal liga com a subida dos últimos dias (régua das fotos dos dois lados)', () => {
  const pesagens = serie({ kgSemana: 0, ruido: 0.1 });
  for (const p of pesagens.slice(-3)) p.peso = Math.round((p.peso + 0.8) * 10) / 10; // a balança respondeu nos últimos dias
  const refeicoes = [];
  for (let i = 1; i <= 27; i++) {
    const kcalDia = i <= 7 ? 3700 : 3000;
    refeicoes.push({ dia: somarDias(DIA, -i), estimativa: { kcal: kcalDia / 2, p: 70 } }, { dia: somarDias(DIA, -i), estimativa: { kcal: kcalDia / 2, p: 70 } });
  }
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes, faixa: ganho });
  const c = a.comidaRecente;
  assert.equal(c.relevante, true);
  assert.ok(Math.abs(c.delta - 700) < 1, `delta ${c.delta}`);
  assert.ok(Math.abs(c.efeitoKgSemana - (700 * 7) / 7700) < 0.01);
  assert.match(c.texto, /700 kcal a mais que as semanas anteriores .*isso puxa o peso uns \+0,64 kg\/semana se continuar; a média dos últimos 3 dias está em .*: coincide com a mudança da comida/);
  assert.match(a.texto, /COMIDA DA SEMANA x PESO: A última semana teve 3\.700 kcal\/dia/);
  // comida parecida: diz que não muda o rumo
  const igual = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, refeicoes: comida({ kcal: 3000 }).refeicoes, faixa: ganho });
  assert.equal(igual.comidaRecente.relevante, false);
  assert.match(igual.comidaRecente.texto, /ficou parecida com a das semanas anteriores/);
});

test('pesagens fora da manhã: a hora vem junto e a leitura dá a tendência sem elas', () => {
  const pesagens = serie({ kgSemana: 0.2, ruido: 0.1 }).map((p, i) => ({ ...p, hora: '07:10' }));
  // as 6 primeiras foram à noite (regra antiga do relógio: a última do dia), ~1 kg mais altas
  for (const p of pesagens.slice(0, 6)) Object.assign(p, { hora: '22:15', peso: Math.round((p.peso + 1) * 10) / 10 });
  assert.equal(validarPesagens(pesagens, { dia: DIA }).pontos[0].hora, '22:15');
  const a = analisarProgresso({ perfil: perfilGanho, dia: DIA, pesagens, faixa: ganho });
  const s = a.leitura.semForaDaManha;
  assert.equal(s.n, 6);
  assert.ok(s.kgSemana > a.tendencia.kgSemana + 0.2, `${s.kgSemana} x ${a.tendencia.kgSemana}`); // as da noite no começo achatavam a subida
  assert.equal(s.relevante, true);
  assert.ok(a.limitacoes.some((x) => /6 pesagem\(ns\) fora da manhã .*sem elas a tendência seria/.test(x)));
});

test('conferência: frase com a própria janela é conferida contra a leitura daquela janela, não contra as 4 semanas', () => {
  const a = {
    vereditoCurto: 'X',
    alertas: [],
    tendencia: { suficiente: true, direcao: 'subindo', kgSemana: 0.3 },
    veredito: { status: 'no_alvo', confianca: 'alta' },
    leitura: { janelas: [{ dias: 7 }, { dias: 14, suficiente: true, direcao: 'indefinida', kgSemana: 0.05 }, { dias: 21, suficiente: true, direcao: 'estavel', kgSemana: 0.01 }, { dias: 28, suficiente: true, direcao: 'subindo', kgSemana: 0.3 }] },
  };
  const tipos = (t) => conferirTextoProgresso(t, a).map((x) => x.tipo);
  assert.deepEqual(tipos('Nas últimas 3 semanas o peso ficou parado, mas no mês ele subiu.'), []); // verdade nas duas janelas
  assert.deepEqual(tipos('Nas últimas 3 semanas o peso subiu.'), ['direcao_oposta']); // a de 21 dias está parada
  assert.deepEqual(tipos('O peso ficou parado.'), ['direcao_oposta']); // sem janela dita: vale a de 4 semanas
});

test('atividade sem relógio: o gasto do dia recebe o LÍQUIDO do repouso, no registro e na sincronização', async () => {
  const { kcalLiquida, somarGastosExtras } = await import('../atividades.js');
  assert.equal(Math.round(kcalLiquida(758, 120, 75.5)), 607); // 758 − 75,5 × 2 h
  assert.equal(kcalLiquida(900, 0, 75), 900); // sem duração, vai como veio
  assert.equal(kcalLiquida(100, 120, 75), 0); // nunca negativo
  const rel = somarGastosExtras({ peso: 75.5, gastos: { '2030-03-10': 2773 } }, { '2030-03-10': [{ kcal: 758, minutos: 120 }] });
  assert.equal(rel.gastos['2030-03-10'], 2773 + Math.round(kcalLiquida(758, 120, 75.5)));
});
