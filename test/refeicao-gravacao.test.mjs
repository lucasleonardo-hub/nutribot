// Gravação de refeição (fase 0, P3): o !refeicao sempre cria uma refeição nova; só a correção retroativa (linha REFEICAO com
// a hora de um registro que já existe, commit b7901c3) substitui o registro na mesma hora (±10 min).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirGravacaoRefeicao } from '../util.js';

const almoco = { _id: 'a1', minutos: 12 * 60 + 30, horaLocal: '12:30', slot: 'almoco', resumo: '[foto]', descricao: 'arroz, feijão, frango grelhado e salada', estimativa: { kcal: 720, p: 45, c: 80, g: 18 } };
const cafe = { _id: 'c1', minutos: 8 * 60 + 28, horaLocal: '08:28', slot: 'cafe', resumo: '[foto]', descricao: 'pão, ovos e chocolate', estimativa: { kcal: 610, p: 30, c: 60, g: 25 } };

/** Banco de mentira: aplica a decisão como mongo.registrarRefeicao faz (insere, substitui ou funde). */
function gravar(doDia, nova, opcoes) {
  const d = decidirGravacaoRefeicao(nova, doDia, opcoes);
  if (d.acao === 'inserir') doDia.push({ _id: `n${doDia.length + 1}`, ...nova });
  else if (d.acao === 'substituir') Object.assign(d.alvo, { estimativa: nova.estimativa, descricao: nova.descricao, resumo: `${d.alvo.resumo} (corrigido)` });
  else if (d.correcao) Object.assign(d.alvo, { estimativa: nova.estimativa, descricao: nova.descricao });
  else d.alvo.estimativa = { kcal: d.alvo.estimativa.kcal + nova.estimativa.kcal };
  return d;
}

test('!refeicao 5 min depois da foto do almoço é outra refeição: duas no banco, o almoço intacto', () => {
  const doDia = [{ ...almoco }];
  const barra = { minutos: 12 * 60 + 35, horaLocal: '12:35', slot: 'lanche', manual: true, resumo: 'barra de cereal', descricao: 'barra de cereal', estimativa: { kcal: 120, p: 3, c: 20, g: 4 } };
  const d = gravar(doDia, barra, { sempreNova: true });
  assert.equal(d.acao, 'inserir');
  assert.equal(doDia.length, 2);
  assert.equal(doDia[0].estimativa.kcal, 720);
  assert.equal(doDia[0].descricao, almoco.descricao);
  // mesmo tipo e mesma hora: o !refeicao ainda é registro novo (a pessoa disse que ficou SEM registro)
  const sobremesa = { minutos: 12 * 60 + 40, horaLocal: '12:40', slot: 'almoco', manual: true, resumo: 'pudim', descricao: 'pudim', estimativa: { kcal: 250 } };
  assert.equal(gravar(doDia, sobremesa, { sempreNova: true }).acao, 'inserir');
  assert.equal(doDia.length, 3);
  // e sem a opção, um registro manual de outro tipo também não toca no almoço (a regra dos ±10 min é só da retroativa)
  assert.equal(decidirGravacaoRefeicao({ ...barra }, [{ ...almoco }]).acao, 'inserir');
});

test('correção retroativa (REFEICAO com a hora de um registro de horas atrás) continua substituindo o registro dessa hora', () => {
  // Lucas, 06/10 15:27: "não teve chocolate, é pasta de amendoim com avelã" sobre o café das 08:28 veio com hora 08:28
  const doDia = [{ ...cafe }, { ...almoco }];
  const retro = { minutos: 8 * 60 + 28, horaLocal: '08:28', slot: 'cafe', manual: true, resumo: 'não teve chocolate', descricao: 'pão, ovos e pasta de amendoim com avelã', estimativa: { kcal: 640, p: 32, c: 58, g: 30 } };
  const d = gravar(doDia, retro, { retroativa: true });
  assert.equal(d.acao, 'substituir');
  assert.equal(d.alvo._id, 'c1');
  assert.equal(doDia.length, 2);
  assert.equal(doDia[0].estimativa.kcal, 640);
  assert.match(doDia[0].resumo, /\(corrigido\)$/);
  // até 10 min de diferença ainda é a mesma; o mais cedo da janela
  assert.equal(decidirGravacaoRefeicao({ ...retro, minutos: 8 * 60 + 36 }, [{ ...cafe }], { retroativa: true }).acao, 'substituir');
  // café esquecido das 07:00 informado à tarde, sem registro perto: refeição nova
  assert.equal(decidirGravacaoRefeicao({ ...retro, minutos: 7 * 60 }, [{ ...cafe, minutos: 8 * 60 + 28 }, { ...almoco }], { retroativa: true }).acao, 'inserir');
});

test('fusão de sempre continua: complemento soma, descrição repetida substitui, tipo dito de propósito separa', () => {
  const doDia = [{ ...almoco }];
  const suco = { minutos: 12 * 60 + 41, slot: 'almoco', resumo: 'e um suco', descricao: 'suco de laranja', estimativa: { kcal: 110 } };
  const f = decidirGravacaoRefeicao(suco, doDia);
  assert.equal(f.acao, 'fundir');
  assert.equal(f.correcao, false);
  const repete = { minutos: 12 * 60 + 31, slot: 'almoco', resumo: 'Arroz, feijão, frango grelhado', descricao: 'arroz, feijão e frango grelhado', estimativa: { kcal: 700 } };
  const r = decidirGravacaoRefeicao(repete, doDia);
  assert.equal(r.acao, 'fundir');
  assert.equal(r.correcao, true);
  assert.equal(r.repeteDescricao, true);
  // "lanche" nomeado 1 min depois do almoço: outra refeição
  assert.equal(decidirGravacaoRefeicao({ ...suco, slot: 'lanche' }, doDia, { slotExplicito: true }).acao, 'inserir');
  // mais de 30 min depois: outra refeição
  assert.equal(decidirGravacaoRefeicao({ ...suco, minutos: 13 * 60 + 5 }, doDia).acao, 'inserir');
  // dia vazio: insere
  assert.equal(decidirGravacaoRefeicao(suco, []).acao, 'inserir');
});
