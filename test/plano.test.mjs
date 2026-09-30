import { test } from 'node:test';
import assert from 'node:assert/strict';
import { padraoAlimentar, repertorioDoGrupo, itensDaDescricao } from '../resumo.js';

const reg = (dia, slot, hora, descricao, kcal, jid = 'a@s') => ({ jid, nome: 'Lucas', dia, slot, hora, descricao, estimativa: kcal ? { kcal, p: 10, c: 10, g: 10 } : null });

test('itensDaDescricao limpa porções, medidas e palavras vazias', () => {
  assert.deepEqual(itensDaDescricao('150 g de arroz branco cozido, 2 ovos mexidos e 1 xícara de café puro'), ['arroz branco cozido', 'ovos mexidos', 'café puro']);
  assert.deepEqual(itensDaDescricao('[foto]'), []);
  assert.deepEqual(itensDaDescricao('boa camada de hommus (generosa) + 100 gramas de cubos de filé'), ['hommus', 'cubos filé']);
});

test('padraoAlimentar lista só as refeições da rotina e marca as ausentes', () => {
  const regs = [];
  for (let d = 1; d <= 10; d++) {
    const dia = `2026-09-${String(d).padStart(2, '0')}`;
    regs.push(reg(dia, 'almoco', '12:40', 'arroz, feijão e frango grelhado', 800));
    if (d % 2 === 0) regs.push(reg(dia, 'jantar', '20:10', 'ovos mexidos com pão', 500));
  }
  regs.push(reg('2026-09-03', 'ceia', '23:30', 'iogurte', 120)); // uma ceia solta em 10 dias não vira rotina
  const p = padraoAlimentar(regs, { periodoDias: 28 });
  assert.equal(p.diasComRegistro, 10);
  assert.deepEqual(Object.keys(p.slots), ['almoco', 'jantar']);
  assert.equal(p.slots.almoco.dias, 10);
  assert.equal(p.slots.almoco.hora, '12:40');
  assert.equal(p.slots.almoco.kcal, 800);
  assert.match(p.slots.almoco.itens.join(', '), /arroz \(10x\)/);
  assert.deepEqual(p.ausentes, ['café da manhã', 'lanche da manhã', 'lanche', 'ceia']);
  assert.match(p.texto, /PADRÃO REAL \(últimos 28 dias\): 10 dia\(s\) com registro/);
  assert.match(p.texto, /- Almoço: em 10 de 10 dias \(quase todo dia\), por volta das 12:40, em média 800 kcal\. Costuma: arroz \(10x\)/);
  assert.match(p.texto, /- Jantar: em 5 de 10 dias \(na maioria dos dias\)/);
  assert.match(p.texto, /NÃO registra: café da manhã, lanche da manhã, lanche, ceia/);
  assert.doesNotMatch(p.texto, /Ceia:/);
});

test('padraoAlimentar sem histórico pede pra perguntar', () => {
  const p = padraoAlimentar([], { periodoDias: 28 });
  assert.equal(p.diasComRegistro, 0);
  assert.deepEqual(p.slots, {});
  assert.match(p.texto, /Sem histórico suficiente/);
});

test('repertorioDoGrupo devolve itens repetidos das outras pessoas, sem a própria', () => {
  const regs = [
    reg('2026-09-01', 'almoco', '12:00', 'arroz e feijão', 600, 'eu@s'),
    reg('2026-09-01', 'almoco', '12:00', 'hommus com pão integral', 400, 'h@s'),
    reg('2026-09-02', 'jantar', '20:00', 'hommus e salada verde', 350, 'h@s'),
    reg('2026-09-02', 'cafe', '09:00', 'chia com tangerina', 200, 'a@s'),
    reg('2026-09-03', 'cafe', '09:00', 'chia e ovos cozidos', 250, 'a@s'),
  ];
  const r = repertorioDoGrupo(regs, { excluirJids: ['eu@s'] });
  assert.deepEqual(r, ['hommus', 'chia']);
});

import { semanaDoPlano, previsaoSemana } from '../resumo.js';
import { pareceAceitePlano } from '../consciencia.js';

test('semanaDoPlano: de sexta a domingo é a semana que vem; nos outros dias começa amanhã', () => {
  const sex = semanaDoPlano('2026-10-02'); // sexta
  assert.equal(sex.inicio, '2026-10-05');
  assert.equal(sex.fim, '2026-10-11');
  assert.equal(sex.proximaSemana, true);
  assert.equal(sex.dias[0].rotulo, 'Segunda 05/10');
  assert.equal(semanaDoPlano('2026-10-04').inicio, '2026-10-05'); // domingo
  const ter = semanaDoPlano('2026-09-29'); // terça
  assert.equal(ter.inicio, '2026-09-30');
  assert.equal(ter.proximaSemana, false);
  assert.equal(ter.dias[6].rotulo, 'Terça 06/10');
});

test('previsaoSemana dá uma faixa por dia da semana a partir do relógio', () => {
  const gastos = {};
  for (let i = 1; i <= 28; i++) {
    const d = new Date(Date.UTC(2026, 8, i, 12));
    const dow = d.getUTCDay();
    gastos[d.toISOString().slice(0, 10)] = dow === 2 || dow === 4 ? 3000 : 2400; // terça e quinta com treino
  }
  const p = previsaoSemana({ gastos, dia: '2026-10-02', objetivo: 'emagrecer', metaAdaptativa: null });
  assert.equal(p.dias.length, 7);
  const ter = p.dias.find((d) => d.nome === 'terça');
  const seg = p.dias.find((d) => d.nome === 'segunda');
  assert.equal(ter.prev.previsto, 3000);
  assert.equal(seg.prev.previsto, 2400);
  assert.ok(ter.prev.alvo.max < 3000 && seg.prev.alvo.max < 2400, 'emagrecer = comer abaixo do gasto');
  assert.match(p.texto, /META POR DIA/);
  assert.match(p.texto, /- Terça 06\/10: gasto previsto 3\.000 kcal/);
  assert.equal(previsaoSemana({ gastos: null, dia: '2026-10-02', objetivo: 'emagrecer' }), null);
});

test('pareceAceitePlano aceita resposta curta ou que fala do plano e extrai o pedido', () => {
  assert.deepEqual(pareceAceitePlano('quero'), { aceite: true, pedido: '' });
  assert.deepEqual(pareceAceitePlano('Bora!'), { aceite: true, pedido: '' });
  assert.deepEqual(pareceAceitePlano('manda aí'), { aceite: true, pedido: '' });
  assert.deepEqual(pareceAceitePlano('quero, orçamento curto e só mercado de bairro'), { aceite: true, pedido: 'orçamento curto e só mercado de bairro' });
  assert.deepEqual(pareceAceitePlano('pode montar o meu plano sem peixe'), { aceite: true, pedido: 'sem peixe' });
  assert.deepEqual(pareceAceitePlano('eu quero o plano, mas sem lactose'), { aceite: true, pedido: 'sem lactose' });
  assert.equal(pareceAceitePlano('eu almocei arroz, feijão e frango').aceite, false);
  assert.equal(pareceAceitePlano('pode me dizer quantas calorias tem isso?').aceite, false);
  assert.equal(pareceAceitePlano('não quero, obrigado').aceite, false);
  assert.equal(pareceAceitePlano('quero saber se essa marmita tá boa pro meu objetivo, comi ela inteira agora').aceite, false);
  assert.equal(pareceAceitePlano('!plano').aceite, false);
});
