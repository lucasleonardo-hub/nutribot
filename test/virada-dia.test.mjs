// Virada do dia local (revisão F2, I2): desde 13/10 a refeição vai pro dia LOCAL da pessoa, e a virada é a meia-noite dela
// (Heitor em Sofia: 18:00 de São Paulo, quando ele ainda come). Os fluxos que procuram "o registro anterior" atravessam a
// meia-noite local, só perto dela: retroativa com hora "depois" de agora é de ontem; na 1ª hora do dia, sem registro hoje,
// a última refeição (correção, REGISTRO de apagar/corrigir, !apagar) é a de ontem. Longe da virada nada muda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diaDoRetroativo, registrosDaVirada, ultimaRefeicao, destinoDaRefeicao, decidirGravacaoRefeicao, minutosDe } from '../util.js';
import { acharRegistro } from '../resumo.js';

const ONTEM = '2026-10-13';
const HOJE = '2026-10-14';
const jantar = { _id: 'j1', dia: ONTEM, minutos: 21 * 60, horaLocal: '21:00', slot: 'jantar', resumo: '[foto]', descricao: 'arroz, feijão e carne', estimativa: { kcal: 700, p: 40, c: 80, g: 20 } };
const ceia = { _id: 'c1', dia: ONTEM, minutos: 23 * 60 + 55, horaLocal: '23:55', slot: 'ceia', resumo: '[foto]', descricao: '1 iogurte natural', estimativa: { kcal: 120, p: 8, c: 10, g: 5 } };
const cafeHoje = { _id: 'h1', dia: HOJE, minutos: 15, horaLocal: '00:15', slot: 'ceia', resumo: 'biscoito', descricao: 'biscoito', estimativa: { kcal: 90 } };

test('retroativa: "jantei às 23h" dito à 00:30 vai pro dia anterior; longe da virada continua hoje', () => {
  assert.equal(diaDoRetroativo(HOJE, '23:00', '00:30'), ONTEM);
  assert.equal(diaDoRetroativo('2026-10-01', '23:30', '00:10'), '2026-09-30'); // virada de mês
  assert.equal(diaDoRetroativo('2026-01-01', '22:00', '01:00'), '2025-12-31'); // e de ano
  // o café das 08:20 informado às 15:27 (o caso que criou a retroativa): hoje, como antes
  assert.equal(diaDoRetroativo(HOJE, '08:20', '15:27'), HOJE);
  // hora "depois" de agora fora da madrugada não muda nada (era hoje antes, continua hoje)
  assert.equal(diaDoRetroativo(HOJE, '20:00', '15:00'), HOJE);
  // hora dita antes de agora, mesmo na madrugada: hoje
  assert.equal(diaDoRetroativo(HOJE, '00:10', '01:30'), HOJE);
  // até 1 h "depois" de agora é imprecisão da hora dita, não ontem
  assert.equal(diaDoRetroativo(HOJE, '01:20', '00:30'), HOJE);
});

test('destino da refeição: retroativa da madrugada grava ontem, na hora dita; refeição comum, hoje', () => {
  assert.deepEqual(destinoDaRefeicao({ diaHoje: HOJE, horaAgora: '00:30', horaDita: '23:00', retroativa: true }), { dia: ONTEM, minutos: 23 * 60, horaLocal: '23:00' });
  assert.deepEqual(destinoDaRefeicao({ diaHoje: HOJE, horaAgora: '15:27', horaDita: '08:20', retroativa: true }), { dia: HOJE, minutos: 8 * 60 + 20, horaLocal: '08:20' });
  assert.deepEqual(destinoDaRefeicao({ diaHoje: HOJE, horaAgora: '12:30' }), { dia: HOJE, minutos: 12 * 60 + 30, horaLocal: '12:30' });
  // hora dita sem ser retroativa (a 20 min de agora): a hora de agora, como antes
  assert.deepEqual(destinoDaRefeicao({ diaHoje: HOJE, horaAgora: '12:30', horaDita: '12:10', retroativa: false }), { dia: HOJE, minutos: 12 * 60 + 30, horaLocal: '12:30' });
});

test('correção logo depois da meia-noite: "eram 2 iogurtes" à 00:03 corrige a ceia das 23:55 de ontem, sem refeição nova', () => {
  const agora = minutosDe('00:03');
  const u = ultimaRefeicao([], [jantar, ceia], agora);
  assert.equal(u._id, 'c1');
  assert.equal(u.dia, ONTEM);
  // os minutos ficam relativos a hoje: "minutos desde a última" é 8, dentro dos 30/45 min da correção
  assert.equal(agora - u.minutos, 8);
  assert.equal(u.minutosNoDia, 23 * 60 + 55);
  // a correção grava no dia e nos minutos do registro corrigido...
  const destino = destinoDaRefeicao({ diaHoje: HOJE, horaAgora: '00:03', correcaoDe: u });
  assert.equal(destino.dia, ONTEM);
  assert.equal(destino.minutos, 23 * 60 + 55);
  // ...e, no banco (registrarRefeicao lê os registros do dia `destino.dia`), funde com a ceia e substitui a estimativa
  const nova = { minutos: destino.minutos, slot: u.slot, correcao: true, estimativa: { kcal: 240, p: 16, c: 20, g: 10 }, descricao: '2 iogurtes naturais' };
  const d = decidirGravacaoRefeicao(nova, [jantar, ceia]);
  assert.equal(d.acao, 'fundir');
  assert.equal(d.alvo._id, 'c1');
  assert.equal(d.correcao, true);
});

test('última refeição: longe da virada, ou com registro hoje, nada muda', () => {
  // já tem registro hoje: é ele, com os minutos de sempre
  const u = ultimaRefeicao([cafeHoje], [jantar, ceia], minutosDe('00:20'));
  assert.equal(u._id, 'h1');
  assert.equal(u.minutos, 15);
  assert.equal(u.minutosNoDia, undefined);
  // passou da 1ª hora do dia: ontem não conta mais
  assert.equal(ultimaRefeicao([], [jantar, ceia], minutosDe('01:30')), undefined);
  assert.equal(ultimaRefeicao([], [jantar, ceia], minutosDe('12:00')), undefined);
  // sem nada ontem nem hoje
  assert.equal(ultimaRefeicao([], [], minutosDe('00:05')), undefined);
  // o destino de uma correção de hoje é o de sempre (dia de hoje, minutos do registro corrigido)
  assert.deepEqual(destinoDaRefeicao({ diaHoje: HOJE, horaAgora: '00:20', correcaoDe: u }), { dia: HOJE, minutos: 15, horaLocal: '00:20' });
});

test('REGISTRO de apagar/corrigir e !apagar: na 1ª hora do dia, sem registro hoje, acham o de ontem', () => {
  // "apaga o jantar das 21h" às 00:10
  const lista = registrosDaVirada([], [jantar, ceia], minutosDe('00:10'));
  assert.equal(acharRegistro(lista, '21:00')?._id, 'j1');
  // !apagar ultimo às 00:10: a ceia de ontem
  assert.equal(acharRegistro(lista, 'ultimo')?._id, 'c1');
  // com registro hoje: só os de hoje (o de ontem não é apagado por engano)
  assert.deepEqual(registrosDaVirada([cafeHoje], [jantar, ceia], minutosDe('00:20')).map((r) => r._id), ['h1']);
  // depois da 1ª hora: só hoje (vazio)
  assert.deepEqual(registrosDaVirada([], [jantar, ceia], minutosDe('01:00')), []);
  assert.deepEqual(registrosDaVirada([], [jantar, ceia], minutosDe('14:00')), []);
  // sem a lista de ontem (quem chama só busca ontem na 1ª hora), nada quebra
  assert.deepEqual(registrosDaVirada(undefined, undefined, minutosDe('00:10')), []);
});
