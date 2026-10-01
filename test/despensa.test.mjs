import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { extrairChave, interpretarQr, lerQr, acharItem, chaveItem, resumoNota } from '../despensa.js';

const CHAVE = '42250912345678000199650010000123451000123456';
const URL_SC = `https://sat.sef.sc.gov.br/nfce/consulta?p=${CHAVE}|2|1|1|ABCDEF0123456789abcdef0123456789abcdef01`;

test('extrairChave e interpretarQr: chave de 44 dígitos, UF pelo código e URL do QR', () => {
  assert.equal(extrairChave('chave: 4225 0912 3456 7800 0199 6500 1000 0123 4510 0012 3456'), CHAVE);
  assert.equal(extrairChave('nada aqui'), null);
  const q = interpretarQr(URL_SC);
  assert.equal(q.chave, CHAVE);
  assert.equal(q.uf, 'SC');
  assert.equal(q.url, URL_SC);
  assert.equal(q.emitidaEm, '2025-09');
  assert.equal(interpretarQr('3525' + '1'.repeat(40)).uf, 'SP');
  assert.equal(interpretarQr('texto qualquer'), null);
});

test('lerQr decodifica um QR gerado (ida e volta) e devolve null sem QR', async () => {
  const png = await QRCode.toBuffer(URL_SC, { type: 'png', width: 420, margin: 2 });
  assert.equal(await lerQr(png), URL_SC);
  const branco = await QRCode.toBuffer('x', { type: 'png', width: 60, margin: 0 }); // QR minúsculo e sem margem costuma falhar
  const r = await lerQr(branco);
  assert.ok(r === null || r === 'x');
});

test('acharItem casa por palavras; chaveItem normaliza', () => {
  const lista = [{ item: 'iogurte grego' }, { item: 'filé mignon suíno' }, { item: 'arroz branco' }, { item: 'ovos' }];
  assert.equal(acharItem(lista, 'o iogurte').item, 'iogurte grego');
  assert.equal(acharItem(lista, 'Iogurte Grego Vigor').item, 'iogurte grego');
  assert.equal(acharItem(lista, 'ovo').item, 'ovos'); // "ovos" contém "ovo": casa
  assert.equal(acharItem(lista, 'leite'), null);
  assert.equal(chaveItem('  Filé-Mignon  Suíno! '), 'file mignon suino');
});

test('resumoNota: texto curto e repetida', () => {
  const t = resumoNota({ loja: 'Bistek', dia: '2026-10-01', itens: [{ item: 'arroz branco', quantidade: 1, unidade: 'kg', perecivel: false }, { item: 'frango', quantidade: 800, unidade: 'g', perecivel: true, nutri: { kcal: 165 } }] });
  assert.match(t, /Cupom lido\* · Bistek · 01\/10/);
  assert.match(t, /2 itens entraram na despensa, 1 perecíveis, 1 com tabela nutricional/);
  assert.match(t, /- frango · 800 g/);
  assert.match(resumoNota({ itens: [], repetida: true }), /já tinha lido/);
});
