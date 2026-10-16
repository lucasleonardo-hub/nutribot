// Desconfiômetro (auditoria.js) e o filtro de reação antes da IA (mensagens.soReacao): pedido do dono em 15/10.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/teste';
const A = await import('../auditoria.js');

test('refeição: suplemento numa quantidade que não cabe numa tomada pede confirmação (400 g de whey -> 40 g?)', () => {
  const r = A.auditarRefeicao({ kcal: 1700, proteina: 320, carbo: 30, gordura: 20, itens: 'shake de whey' }, 'tomei um shake com 400g de whey e 300ml de leite');
  assert.equal(r.suspeito, true);
  assert.equal(r.pergunta, 'foram 400 g de whey mesmo, ou 40 g?');
  assert.ok(r.motivos.some((m) => /400 g de whey/.test(m)));
  assert.equal(A.auditarRefeicao({ kcal: 300, proteina: 40, carbo: 15, gordura: 8 }, 'shake com 40g de whey e 300ml de leite').suspeito, false);
  assert.equal(A.auditarRefeicao({ kcal: 30, proteina: 0, carbo: 0, gordura: 0 }, '50 g de creatina').suspeito, true);
  assert.equal(A.auditarRefeicao({ kcal: 0 }, '5 g de creatina').suspeito, false);
});

test('refeição: item gigante, refeição acima do teto; comida normal não é suspeita', () => {
  assert.equal(A.auditarRefeicao({ kcal: 2600, proteina: 50, carbo: 560, gordura: 5 }, 'almocei 2kg de arroz').suspeito, true);
  assert.equal(A.auditarRefeicao({ kcal: 3600, proteina: 120, carbo: 300, gordura: 200 }, 'rodízio').suspeito, true);
  assert.equal(A.auditarRefeicao({ kcal: 800, proteina: 230, carbo: 10, gordura: 10 }, 'frango').suspeito, true);
  for (const [r, t] of [
    [{ kcal: 780, proteina: 45, carbo: 95, gordura: 22 }, 'almocei 250 g de arroz, 100 g de feijão e 150 g de patinho moído'],
    [{ kcal: 315, proteina: 16, carbo: 44, gordura: 9 }, '2 fatias de pão de aipim com frango e requeijão'],
    [{ kcal: 420, proteina: 34, carbo: 12, gordura: 26 }, '[foto]'],
  ]) assert.equal(A.auditarRefeicao(r, t).suspeito, false, t);
});

test('refeição: kcal que não fecha com os macros só marca (a conta é da bot); bebida alcoólica fica fora', () => {
  const r = A.auditarRefeicao({ kcal: 1500, proteina: 30, carbo: 40, gordura: 10 }, 'sanduíche');
  assert.equal(r.suspeito, false);
  assert.match(r.motivos.join(), /não fecha com os macros/);
  assert.deepEqual(A.auditarRefeicao({ kcal: 600, proteina: 2, carbo: 40, gordura: 0 }, '3 latas de cerveja').motivos, []);
});

test('confirmação curta: "isso" grava, "não, errei" descarta, número novo segue pela IA', () => {
  for (const t of ['isso', 'Isso mesmo', 'sim', 'foi isso', 'exato!', 'pode anotar']) assert.equal(A.confirmaSemNumero(t), true, t);
  for (const t of ['isso, 40g', 'não, errei', 'sim mas foram 40', 'nossa que horas são', '', null]) assert.equal(A.confirmaSemNumero(t), false, String(t));
  for (const t of ['não', 'errei', 'cancela', 'foi engano']) assert.equal(A.negaSemNumero(t), true, t);
  assert.equal(A.negaSemNumero('não, foram 40g'), false);
});

test('treino: salto de carga irreal sobre a mediana das anteriores; progressão normal passa', () => {
  assert.deepEqual(A.saltoDeCarga([30, 30, 32.5, 30, 80]), { ultima: 80, referencia: 30, salto: 50 });
  assert.equal(A.saltoDeCarga([30, 32.5, 35, 37.5]), null, 'subida normal');
  assert.equal(A.saltoDeCarga([10, 10, 14]), null, '+40% mas só 4 kg');
  assert.equal(A.saltoDeCarga([60, 80]), null, 'pouco histórico');
  assert.deepEqual(A.saltoDeCarga([100, 100, 100, 140]), { ultima: 140, referencia: 100, salto: 40 });
});

test('1RM: Epley e Brzycki (média até 10 repetições)', () => {
  assert.equal(A.umRM(100, 1), 100);
  assert.equal(A.umRM(100, 5), 114.6); // Epley 116,7 e Brzycki 112,5: média 114,6
  assert.equal(A.umRM(50, 12), 70); // acima de 10: só Epley
  assert.equal(A.umRM(0, 5), null);
});

test('sugestão de carga: salto irreal não vira "+2,5 kg"; pergunta e fica na referência', async () => {
  const { sugerirCargaExercicio } = await import('../api-montadores.js');
  const hist = [30, 30, 32.5, 30, 80].map((kg, i) => ({ dia: `2026-10-0${i + 1}`, kg, reps: 10 }));
  const s = sugerirCargaExercicio({ nome: 'Supino Reto (Halter)', historico: hist });
  assert.deepEqual([s.acao, s.conferir, s.sugeridoKg], ['manter', true, 30]);
  assert.match(s.frase, /80 kg da última vez, bem acima das anteriores \(~30 kg\)/);
  const normal = sugerirCargaExercicio({ nome: 'Supino Reto (Halter)', historico: hist.slice(0, 4) });
  assert.equal(normal.conferir, undefined);
});

test('antes da IA: só risada, emoji ou "ok/top/valeu" não gasta chamada; "sim", "bom dia" e perguntas seguem', async () => {
  const { soReacao } = await import('../mensagens.js');
  for (const t of ['kkkkk', 'KKKK', 'rsrs', 'hahaha', '😂😂', 'top', 'ok', 'show!', 'valeu tmj', 'kkk boa', '👍']) assert.equal(soReacao(t), true, t);
  for (const t of ['sim', 'não', 'isso', 'bom dia', 'boa noite', 'kkk comi demais hoje', 'ok, e o jantar?', 'tomei 400g de whey', '']) assert.equal(soReacao(t), false, t);
});
