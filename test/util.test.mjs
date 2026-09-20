import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agora,
  dataExtenso,
  semanaISO,
  diaSeguinte,
  diasAnteriores,
  ehDomingo,
  formatarDuracao,
  formatarTokens,
  slotDaHora,
  minutosDe,
  hhmmDe,
  horariosHabituais,
  paraWhatsApp,
  semLinhaAtualizar,
  fusoValido,
  mencionaNome,
} from '../util.js';

test('agora respeita o fuso pedido', () => {
  const instante = new Date('2026-09-20T02:30:00Z'); // 23:30 do dia 19 em São Paulo, 02:30 do dia 20 em Lisboa (UTC+1)
  assert.equal(agora('America/Sao_Paulo', instante).dia, '2026-09-19');
  assert.equal(agora('America/Sao_Paulo', instante).hora, '23:30');
  assert.equal(agora('Europe/Lisbon', instante).dia, '2026-09-20');
  assert.equal(agora('Europe/Lisbon', instante).hora, '03:30');
});

test('dataExtenso calcula o dia da semana', () => {
  assert.equal(dataExtenso('2026-09-20'), 'domingo, 20/09/2026');
  assert.equal(dataExtenso('2026-09-19'), 'sábado, 19/09/2026');
  assert.equal(dataExtenso('lixo'), 'lixo');
});

test('datas: semana ISO, dia seguinte, dias anteriores, domingo', () => {
  assert.equal(semanaISO('2026-09-20'), '2026-W38');
  assert.equal(diaSeguinte('2026-09-30'), '2026-10-01');
  assert.deepEqual(diasAnteriores('2026-09-20', 3), ['2026-09-18', '2026-09-19', '2026-09-20']);
  assert.equal(ehDomingo('2026-09-20'), true);
  assert.equal(ehDomingo('2026-09-19'), false);
});

test('fusoValido', () => {
  assert.equal(fusoValido('America/Sao_Paulo'), true);
  assert.equal(fusoValido('Marte/Cratera'), false);
  assert.equal(fusoValido(''), false);
});

test('formatadores', () => {
  assert.equal(formatarDuracao(45_000), '45s');
  assert.equal(formatarDuracao(12 * 60_000), '12min');
  assert.equal(formatarDuracao(7.3 * 3600_000), '7.3h');
  assert.equal(formatarTokens(17300), '17.3k');
  assert.equal(formatarTokens(999), '999');
});

test('slots de refeição', () => {
  assert.equal(slotDaHora('08:30').id, 'cafe');
  assert.equal(slotDaHora('12:49').id, 'almoco');
  assert.equal(slotDaHora('17:27').id, 'lanche');
  assert.equal(slotDaHora('20:53').id, 'jantar');
  assert.equal(slotDaHora('23:10').id, 'ceia');
  assert.equal(slotDaHora('01:30').id, 'ceia'); // madrugada = ceia do dia anterior
  assert.equal(minutosDe('12:49'), 769);
  assert.equal(hhmmDe(769), '12:49');
});

test('horário habitual só depois de 3 registros', () => {
  const hab = horariosHabituais([
    { slot: 'almoco', minutos: 740 },
    { slot: 'almoco', minutos: 760 },
  ]);
  assert.equal(hab.almoco.aprendido, false);
  assert.equal(hab.almoco.minutos, 12 * 60 + 30); // padrão
  const hab3 = horariosHabituais([
    { slot: 'almoco', minutos: 740 },
    { slot: 'almoco', minutos: 760 },
    { slot: 'almoco', minutos: 800 },
  ]);
  assert.equal(hab3.almoco.aprendido, true);
  assert.equal(hab3.almoco.minutos, 760); // mediana
});

test('paraWhatsApp converte markdown e colchetes', () => {
  assert.equal(paraWhatsApp('## Título\n**forte** e [[Proteína]]\n- item', { manterColchetes: false }), 'Título\n*forte* e *Proteína*\n• item');
  assert.equal(paraWhatsApp('[[Proteína]]', { manterColchetes: true }), '[[Proteína]]');
});

test('semLinhaAtualizar remove só a linha final', () => {
  assert.equal(semLinhaAtualizar('Boa!\n\nATUALIZAR: {"peso_kg": 74.5}'), 'Boa!');
  assert.equal(semLinhaAtualizar('sem nada'), 'sem nada');
});

test('mencionaNome: palavra inteira, sem acento, nomes curtos', () => {
  assert.equal(mencionaNome('Dona benta, e aí?', 'Dona Benta'), true);
  assert.equal(mencionaNome('benta!', 'Dona Benta'), true);
  assert.equal(mencionaNome('dona de casa', 'Dona Flor'), true); // "dona" é parte do nome: aceito (falso positivo raro e barato)
  assert.equal(mencionaNome('Ana, isso é saudável', 'Ana'), true);
  assert.equal(mencionaNome('banana', 'Ana'), false);
  assert.equal(mencionaNome('oi Nutrí', 'Nutri'), true);
  assert.equal(mencionaNome('sem nada', 'Dona Benta'), false);
});
