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
  assert.match(t, /2 alimentos entraram na despensa, 1 perecíveis, 1 com tabela nutricional/);
  assert.match(t, /- frango · 800 g/);
  assert.match(resumoNota({ itens: [], repetida: true }), /já tinha lido/);
});

import { parsearTextoNfce } from '../despensa.js';
test('parsearTextoNfce lê o texto da página da SEFAZ (modelo SC/SP): itens, loja e data', () => {
  const texto = [
    'SUPERMERCADO BISTEK LTDA',
    'CNPJ: 12.345.678/0001-99 Rua Lauro Linhares, 100',
    'Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica',
    'FILE MIGNON SUINO KG (Código: 2000123 )',
    'Qtde.:0,84 UN: KG Vl. Unit.: 39,90 Vl. Total 33,52',
    'IOG VIGOR GREGO 100G (Código: 7891234567890 )',
    'Qtde.:4 UN: UN Vl. Unit.: 3,49 Vl. Total 13,96',
    'ARROZ TIO JOAO 1KG (Código: 7896006711155)',
    'Qtde.:1 UN: UN Vl. Unit.: 6,99 Vl. Total 6,99',
    'Qtd. total de itens: 3',
    'Valor total R$ 54,47',
    'Emissão: 01/10/2026 09:41:12',
  ].join('\n');
  const r = parsearTextoNfce(texto);
  assert.equal(r.loja, 'SUPERMERCADO BISTEK LTDA');
  assert.equal(r.data, '2026-10-01');
  assert.equal(r.itens.length, 3);
  assert.deepEqual(r.itens[0], { descricao: 'FILE MIGNON SUINO KG', codigo: '2000123', qtd: 0.84, unidade: 'KG', valorUnit: 39.9, valorTotal: 33.52 });
  assert.equal(r.itens[1].codigo, '7891234567890');
  assert.equal(r.itens[1].qtd, 4);
  assert.equal(r.itens[2].valorTotal, 6.99);
  assert.equal(parsearTextoNfce('SecurityVerify Verificando seu navegador').itens.length, 0);
});

import { nomeBate } from '../despensa.js';
import { ancorasDe } from '../taco.js';
test('nomeBate rejeita o lixo do OFF por nome; TACO cobre hortifrúti/carne por 100 g', () => {
  assert.equal(nomeBate('refrigerante laranjinha pureza', 'Aceite girasol'), false);
  assert.equal(nomeBate('iogurte grego', 'Iogurte Grego Natural Vigor'), true);
  assert.equal(nomeBate('pão de forma integral', 'Pão de forma integral Wickbold'), true);
  assert.equal(nomeBate('whey growth', 'Growth Whey Protein Concentrado'), true);
  const b = ancorasDe('bergamota')[0] || ancorasDe('tangerina')[0];
  assert.ok(b && !b.gramas && b.kcal > 20 && b.kcal < 70, `tangerina na TACO: ${JSON.stringify(b)}`);
  const f = ancorasDe('frango')[0];
  assert.ok(f && f.p > 15, `frango na TACO: ${JSON.stringify(f)}`);
});

import { pareceNaoAlimento } from '../despensa.js';
test('pareceNaoAlimento: higiene, limpeza, pet e remédio ficam de fora; comida, bebida e suplemento entram', () => {
  assert.equal(pareceNaoAlimento({ item: 'desodorante aerosol rexona active dry men', categoria: 'higiene', alimento: false }), true);
  assert.equal(pareceNaoAlimento({ item: 'desodorante rexona', categoria: 'outro', alimento: true }), true); // a lista de termos corrige a IA
  assert.equal(pareceNaoAlimento({ item: 'detergente ypê', categoria: 'limpeza', alimento: false }), true);
  assert.equal(pareceNaoAlimento({ item: 'ração para gatos', categoria: 'pet', alimento: false }), true);
  assert.equal(pareceNaoAlimento({ item: 'papel higiênico', categoria: 'outro', alimento: true }), true);
  assert.equal(pareceNaoAlimento({ item: 'refrigerante laranjinha pureza', categoria: 'bebida', alimento: true }), false);
  assert.equal(pareceNaoAlimento({ item: 'bergamota', categoria: 'fruta', alimento: true }), false);
  assert.equal(pareceNaoAlimento({ item: 'whey growth', categoria: 'suplemento', alimento: true }), false);
  assert.equal(pareceNaoAlimento({ item: 'sabão de coco em barra', categoria: 'limpeza', alimento: false }), true);
  assert.equal(pareceNaoAlimento({ item: 'coco ralado', categoria: 'mercearia', alimento: true }), false);
});
