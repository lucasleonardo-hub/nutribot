// O fuso da pessoa pela localização do celular (relogio.atualizarFusoPelaLocalizacao), com a gravação e a consulta
// injetadas (revisão F2, M7): pendência, troca só com 2 leituras e 30+ min, histórico `fusos`, sem rede = mantém. E a
// troca grava só `atualizacoes.fuso` (M1): o mesmo POST pode ter acabado de gravar `atualizacoes.peso` (saude.js), e
// regravar `atualizacoes` inteiro a partir do perfil lido no começo do POST desfazia isso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atualizarFusoPelaLocalizacao } from '../relogio.js';
import { marcaDeTempo } from '../util.js';

const T0 = Date.parse('2026-10-20T09:00:00Z');
const iso = (min) => new Date(T0 + min * 60_000).toISOString();
const ponto = (lat, lon, min, acc = 20) => ({ lat, lon, acc, ts: iso(min) });

/** Consulta de fuso de mentira (conta as chamadas) e gravação de mentira (guarda o que seria o $set do salvarPerfil). */
function dubles(fuso) {
  const d = { chamadas: 0, gravados: [] };
  d.buscar = async () => {
    d.chamadas++;
    return { ok: true, json: async () => ({ timezone: fuso }) };
  };
  d.salvar = async (p) => {
    d.gravados.push(p);
    return p;
  };
  return d;
}

test('viagem pra Lisboa: 1ª leitura fica pendente, 2ª antes de 30 min continua pendente, depois de 30 min troca', async () => {
  const d = dubles('Europe/Lisbon');
  const lucas = { nome: 'Lucas', jids: ['l@lid'], fuso: 'America/Sao_Paulo', atualizacoes: { fuso: '2026-09-01', peso: '2026-10-19' } };

  let r = await atualizarFusoPelaLocalizacao(lucas, [ponto(38.72, -9.14, 0)], d);
  assert.equal(r.trocou, false);
  assert.deepEqual(r.pendente, { fuso: 'Europe/Lisbon', desde: iso(0), ultima: iso(0), n: 1 });
  assert.deepEqual(d.gravados, [{ jids: ['l@lid'], fusoPendente: r.pendente }]);

  lucas.fusoPendente = r.pendente;
  r = await atualizarFusoPelaLocalizacao(lucas, [ponto(38.72, -9.14, 10)], d);
  assert.equal(r.trocou, false);
  assert.equal(r.pendente.n, 2);
  assert.equal(d.gravados.length, 2);

  lucas.fusoPendente = r.pendente;
  r = await atualizarFusoPelaLocalizacao(lucas, [ponto(38.72, -9.14, 35)], d);
  assert.deepEqual(r, { trocou: true, de: 'America/Sao_Paulo', para: 'Europe/Lisbon' });
  const g = d.gravados[2];
  assert.equal(g.fuso, 'Europe/Lisbon');
  assert.equal(g.fusoPendente, null);
  // histórico: o fuso anterior (desde a data em que foi gravado) e o novo, desde a leitura que confirmou
  assert.deepEqual(g.fusos, [
    { fuso: 'America/Sao_Paulo', desde: '2026-09-01' },
    { fuso: 'Europe/Lisbon', desde: iso(35) },
  ]);
  // M1: só o campo do fuso; `atualizacoes` inteiro (com o peso de antes do POST) não é regravado
  assert.equal(g['atualizacoes.fuso'], marcaDeTempo({ fuso: 'Europe/Lisbon' }).dia);
  assert.equal('atualizacoes' in g, false);
});

test('histórico de fusos: acrescenta ao que já existe e guarda só os 10 últimos', async () => {
  const d = dubles('Europe/Sofia');
  const fusos = Array.from({ length: 10 }, (_, i) => ({ fuso: i % 2 ? 'Europe/Lisbon' : 'America/Sao_Paulo', desde: `2026-0${(i % 9) + 1}-01` }));
  const p = { nome: 'Lucas', jids: ['l@lid'], fuso: 'America/Sao_Paulo', fusos, fusoPendente: { fuso: 'Europe/Sofia', desde: iso(0), ultima: iso(0), n: 1 }, atualizacoes: {} };
  const r = await atualizarFusoPelaLocalizacao(p, [ponto(42.70, 23.32, 40)], d);
  assert.equal(r.trocou, true);
  const g = d.gravados[0];
  assert.equal(g.fusos.length, 10);
  assert.deepEqual(g.fusos[9], { fuso: 'Europe/Sofia', desde: iso(40) });
  assert.deepEqual(g.fusos[0], fusos[1]);
});

test('perfil com atualizacoes nulo: grava o objeto (o caminho com ponto falharia no Mongo)', async () => {
  const d = dubles('Asia/Tokyo');
  const p = { nome: 'X', jids: ['x@lid'], fuso: 'America/Sao_Paulo', atualizacoes: null, fusoPendente: { fuso: 'Asia/Tokyo', desde: iso(0), ultima: iso(0), n: 1 } };
  const r = await atualizarFusoPelaLocalizacao(p, [ponto(35.68, 139.69, 31)], d);
  assert.equal(r.trocou, true);
  const g = d.gravados[0];
  assert.deepEqual(g.atualizacoes, { fuso: marcaDeTempo({ fuso: 'Asia/Tokyo' }).dia });
  assert.equal('atualizacoes.fuso' in g, false);
  // histórico começa com o fuso anterior, sem data conhecida
  assert.deepEqual(g.fusos[0], { fuso: 'America/Sao_Paulo', desde: null });
  // sem o campo (ausente no documento): o caminho com ponto funciona e não pisa num `atualizacoes` gravado no mesmo POST
  const d2 = dubles('Asia/Tokyo');
  const semCampo = { ...p, atualizacoes: undefined };
  await atualizarFusoPelaLocalizacao(semCampo, [ponto(35.68, 139.69, 31)], d2);
  assert.equal(d2.gravados[0]['atualizacoes.fuso'], marcaDeTempo({ fuso: 'Asia/Tokyo' }).dia);
  assert.equal('atualizacoes' in d2.gravados[0], false);
});

test('em casa: leitura igual (ou equivalente) não grava nada; voltando pra casa, a pendência é zerada', async () => {
  const d = dubles('America/Sao_Paulo');
  const p = { nome: 'Lucas', jids: ['l@lid'], fuso: 'America/Sao_Paulo' };
  let r = await atualizarFusoPelaLocalizacao(p, [ponto(-27.6, -48.5, 0)], d);
  assert.deepEqual(r, { trocou: false, pendente: null });
  assert.equal(d.gravados.length, 0);
  // Salvador (America/Bahia) é equivalente a São Paulo: não vira pendência
  const bahia = dubles('America/Bahia');
  r = await atualizarFusoPelaLocalizacao(p, [ponto(-12.97, -38.5, 0)], bahia);
  assert.equal(r.pendente, null);
  assert.equal(bahia.gravados.length, 0);
  // havia pendência (uma leitura em Lisboa) e a leitura seguinte é de casa: pendência zerada, uma gravação
  const casa = dubles('America/Sao_Paulo');
  const comPendencia = { ...p, fusoPendente: { fuso: 'Europe/Lisbon', desde: iso(0), ultima: iso(0), n: 1 } };
  r = await atualizarFusoPelaLocalizacao(comPendencia, [ponto(-23.55, -46.63, 20)], casa);
  assert.equal(r.pendente, null);
  assert.deepEqual(casa.gravados, [{ jids: ['l@lid'], fusoPendente: null }]);
});

test('sem rede, sem ponto bom ou sem perfil: mantém tudo e não grava', async () => {
  const gravados = [];
  const salvar = async (p) => gravados.push(p);
  const semRede = async () => {
    throw new Error('fetch failed');
  };
  const p = { nome: 'Lucas', jids: ['l@lid'], fuso: 'America/Sao_Paulo', fusoPendente: { fuso: 'Europe/Lisbon', desde: iso(0), ultima: iso(0), n: 1 } };
  assert.equal(await atualizarFusoPelaLocalizacao(p, [ponto(48.85, 2.35, 40)], { buscar: semRede, salvar }), null);
  // precisão pior que 500 m: nem consulta
  const d = dubles('Europe/Paris');
  assert.equal(await atualizarFusoPelaLocalizacao(p, [ponto(48.86, 2.36, 40, 2000)], d), null);
  assert.equal(d.chamadas, 0);
  assert.equal(await atualizarFusoPelaLocalizacao(p, [], d), null);
  assert.equal(await atualizarFusoPelaLocalizacao({ nome: 'Sem jid' }, [ponto(48.86, 2.36, 40)], d), null);
  assert.equal(gravados.length + d.gravados.length, 0);
  // o ponto mais recente é o que vale (fora de ordem no envio)
  const lisboa = dubles('Europe/Lisbon');
  await atualizarFusoPelaLocalizacao({ ...p, fusoPendente: null }, [ponto(38.70, -9.10, 50), ponto(-23.55, -46.63, 10)], lisboa);
  assert.equal(lisboa.gravados[0].fusoPendente.desde, iso(50));
});
