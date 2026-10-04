import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { viesDaSemana, atualizarCalibracaoEnergia, corrigirBalanco, descreverCalibracaoEnergia, estatisticasCorrecoes, descreverCorrecoes } = await import('../calibracao.js');

// semana registrada com +812 kcal/dia, mas a balança subiu só 0,29 kg/semana (~ +319 kcal/dia): viés ~ +493
const semana = (fim, balanco, dias = 5, idx = 1) => ({ idx, fim, balanco, diasBalanco: dias });

test('viesDaSemana: balanço registrado − balanço implícito pela balança; sem base devolve null', () => {
  const v = viesDaSemana(semana('2026-10-03', 812), 0.29);
  assert.ok(Math.abs(v - (812 - (0.29 * 7700) / 7)) < 0.01, `vies ${v}`);
  assert.equal(viesDaSemana(semana('2026-10-03', 812, 2), 0.29), null); // poucos dias
  assert.equal(viesDaSemana(semana('2026-10-03', null), 0.29), null);
  assert.equal(viesDaSemana(semana('2026-10-03', 812), null), null);
});

test('atualizarCalibracaoEnergia: começa conservador, acumula semanas, não conta a mesma semana duas vezes, limita o viés', () => {
  const s1 = atualizarCalibracaoEnergia(null, { semanas: [semana('2026-09-26', 500), semana('2026-10-03', 100, 5, 0)], ritmoReal: 0.3, dia: '2026-10-04' });
  assert.equal(s1.semanas, 1);
  assert.equal(s1.confianca, 0.25);
  assert.equal(s1.ultimaSemana, '2026-09-26'); // só a semana FECHADA (idx 1) conta; a atual (idx 0) não
  assert.ok(s1.viesKcalDia > 150 && s1.viesKcalDia < 200, `vies ${s1.viesKcalDia}`); // 500 − 330 = 170
  // mesma semana de novo: nada muda
  const s1b = atualizarCalibracaoEnergia({ energia: s1 }, { semanas: [semana('2026-09-26', 500)], ritmoReal: 0.3, dia: '2026-10-05' });
  assert.equal(s1b, s1);
  // segunda semana com viés muito maior: a média móvel anda só 30% do caminho
  const s2 = atualizarCalibracaoEnergia({ energia: s1 }, { semanas: [semana('2026-10-03', 900)], ritmoReal: 0.3, dia: '2026-10-11' });
  assert.equal(s2.semanas, 2);
  assert.equal(s2.confianca, 0.5);
  const esperado = s1.viesKcalDia + 0.3 * (900 - 330 - s1.viesKcalDia);
  assert.ok(Math.abs(s2.viesKcalDia - esperado) <= 1, `${s2.viesKcalDia} x ${esperado}`);
  assert.equal(s2.historico.length, 2);
  // viés absurdo é limitado a 600
  const s3 = atualizarCalibracaoEnergia(null, { semanas: [semana('2026-10-10', 3000)], ritmoReal: 0, dia: '2026-10-11' });
  assert.equal(s3.viesKcalDia, 600);
  // sem ritmo da balança: devolve o que tinha
  assert.equal(atualizarCalibracaoEnergia({ energia: s1 }, { semanas: [semana('2026-10-10', 500)], ritmoReal: null }), s1);
});

test('corrigirBalanco: só aplica com confiança >= 0,5, proporcional à confiança', () => {
  assert.deepEqual(corrigirBalanco(800, { energia: { viesKcalDia: 400, confianca: 0.25 } }), { valor: 800, aplicado: false, ajuste: 0 });
  const meio = corrigirBalanco(800, { energia: { viesKcalDia: 400, confianca: 0.5 } });
  assert.equal(meio.aplicado, true);
  assert.equal(meio.valor, 600);
  const cheio = corrigirBalanco(800, { energia: { viesKcalDia: 400, confianca: 1 } });
  assert.equal(cheio.valor, 400);
  assert.equal(corrigirBalanco(null, { energia: { viesKcalDia: 400, confianca: 1 } }).valor, null);
  assert.equal(corrigirBalanco(800, null).aplicado, false);
});

test('descreverCalibracaoEnergia: diz a direção, a confiança e o que fazer', () => {
  assert.equal(descreverCalibracaoEnergia(null), '');
  const t = descreverCalibracaoEnergia({ energia: { viesKcalDia: 420, confianca: 0.5, semanas: 2 } });
  assert.match(t, /\+420 kcal\/dia ACIMA/);
  assert.match(t, /confiança média/);
  assert.match(t, /desconte isso/);
  const baixa = descreverCalibracaoEnergia({ energia: { viesKcalDia: -300, confianca: 0.25, semanas: 1 } });
  assert.match(baixa, /ABAIXO/);
  assert.match(baixa, /poucas semanas/);
  assert.match(descreverCalibracaoEnergia({ energia: { viesKcalDia: 20, confianca: 1, semanas: 5 } }), /batem com a balança/);
});

test('estatisticasCorrecoes e descreverCorrecoes: direção, tamanho e tipo de comida', () => {
  assert.equal(estatisticasCorrecoes([]), null);
  const corr = [
    { antes: { kcal: 400 }, depois: { kcal: 560 }, descricao: '2 fatias de pão com queijo' }, // +40%
    { antes: { kcal: 500 }, depois: { kcal: 650 }, descricao: 'pão francês com manteiga' }, // +30%
    { antes: { kcal: 800 }, depois: { kcal: 760 }, descricao: 'arroz, feijão e bife' }, // −5% (perto)
    { antes: { kcal: 300 }, depois: { kcal: 390 }, descricao: 'bolo de chocolate' }, // +30%
    { antes: { kcal: 0 }, depois: { kcal: 300 }, descricao: 'inválida' },
  ];
  const s = estatisticasCorrecoes(corr);
  assert.equal(s.n, 4);
  assert.equal(s.paraCima, 3);
  assert.equal(s.paraBaixo, 0);
  assert.ok(s.mediana >= 1.25 && s.mediana <= 1.4, `mediana ${s.mediana}`);
  const pao = s.categorias.find((c) => c.nome === 'pão');
  assert.ok(pao && pao.n === 2 && pao.mediana > 1.25, JSON.stringify(s.categorias));
  const txt = descreverCorrecoes('Lucas Leonardo', s);
  assert.match(txt, /CALIBRAÇÃO DAS SUAS ESTIMATIVAS PARA LUCAS/);
  assert.match(txt, /ABAIXO do real/);
  assert.match(txt, /pão subestimado em ~[34]\d%/);
  assert.match(txt, /sem aplicar fator cego/);
  // menos de 3 correções: nada no prompt
  assert.equal(descreverCorrecoes('Ale', estatisticasCorrecoes(corr.slice(0, 2))), '');
});
