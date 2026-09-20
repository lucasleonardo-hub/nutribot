import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilarRefeicoes, lerEstimativa, descricaoDaAnalise, compilarSemana } from '../resumo.js';

const L = 'Lucas';

test('lerEstimativa entende o formato novo e o antigo', () => {
  assert.deepEqual(lerEstimativa('🔥 *Estimativa:* ~1.250 kcal · Proteína 60 g · Carboidratos 130 g · Gorduras 45 g'), { kcal: 1250, p: 60, c: 130, g: 45 });
  assert.deepEqual(lerEstimativa('🔥 *Estimativa:* ~780 kcal | P: 36g | C: 72g | G: 38g'), { kcal: 780, p: 36, c: 72, g: 38 });
  assert.deepEqual(lerEstimativa('🔥 *Estimativa corrigida:* ~750 kcal · Proteína 40 g · Carboidratos 90 g · Gorduras 25 g'), { kcal: 750, p: 40, c: 90, g: 25 });
  assert.equal(lerEstimativa('sem números aqui'), null);
});

test('descricaoDaAnalise tira o bloco "O que eu vi"', () => {
  const d = descricaoDaAnalise('Oi!\n\n🍽️ *O que eu vi:*\n- 2 ovos.\n- 1 banana.\n\n🔥 *Estimativa:* ~300 kcal', 'fallback');
  assert.equal(d, '2 ovos. 1 banana.');
  assert.equal(descricaoDaAnalise('', '📷 [foto de comida] cachorro quente'), 'cachorro quente');
});

test('compilarRefeicoes lista tudo, soma em código e junta complemento da mesma refeição', () => {
  const historico = [
    { hora: '09:41', nome: L, texto: '📷 [foto de comida]', tipo: 'foto', refeicao: 'cafe' },
    { hora: '09:41', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- pão e ovos.\n\n🔥 *Estimativa:* ~780 kcal | P: 36g | C: 72g | G: 38g' },
    { hora: '10:37', nome: L, texto: 'papo', tipo: 'texto' },
    { hora: '12:49', nome: L, texto: '📷 [foto de comida]', tipo: 'foto', refeicao: 'almoco' },
    { hora: '12:49', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- macarrão.\n\n🔥 *Estimativa:* ~620 kcal · Proteína 32 g · Carboidratos 82 g · Gorduras 16 g' },
    { hora: '17:27', nome: L, texto: '📷 [foto de comida] pão de batata doce', tipo: 'foto', refeicao: 'lanche' },
    { hora: '17:27', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- pão e vitamina.\n\n🔥 *Estimativa:* ~680 kcal · Proteína 30 g · Carboidratos 80 g · Gorduras 25 g' },
    { hora: '17:28', nome: L, texto: 'a vitamina tem whey', tipo: 'texto', refeicao: 'lanche' },
    { hora: '17:28', nome: 'Nutri', tipo: 'bot', texto: 'Boa! 🔥 *Estimativa corrigida:* ~750 kcal · Proteína 40 g · Carboidratos 90 g · Gorduras 25 g' },
    { hora: '20:53', nome: L, texto: '📷 [foto de comida] 2 cachorros-quentes', tipo: 'foto', refeicao: 'jantar' },
    { hora: '20:53', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- 2 dogs.\n\n🔥 *Estimativa:* ~800 kcal | P: 25g | C: 70g | G: 40g' },
  ];
  const r = compilarRefeicoes(historico, [{ nome: L, peso: 73 }, { nome: 'Heitor', peso: 90 }]);
  assert.deepEqual(r.totais[L], { refeicoes: 4, kcal: 2950, p: 133, c: 314, g: 119 });
  assert.deepEqual(r.totais.Heitor, { refeicoes: 0, kcal: 0, p: 0, c: 0, g: 0 });
  assert.match(r.texto, /Lanche \(17:27\).*\(\+ a vitamina tem whey\)/);
  assert.match(r.texto, /Heitor: 0 refeição/);
});

test('compilarSemana monta a tabela por dia e a média', () => {
  const refeicoes = [
    { jid: 'a@s', nome: L, dia: '2026-09-19', slot: 'cafe', estimativa: { kcal: 500, p: 30, c: 50, g: 20 } },
    { jid: 'a@s', nome: L, dia: '2026-09-19', slot: 'almoco', estimativa: { kcal: 700, p: 40, c: 80, g: 20 } },
    { jid: 'a@s', nome: L, dia: '2026-09-20', slot: 'almoco', estimativa: null },
  ];
  const t = compilarSemana(refeicoes, [{ nome: L, jids: ['a@s'], peso: 73 }], ['2026-09-19', '2026-09-20']);
  assert.match(t, /2026-09-19 \(sáb\): 2 refeições .* ~1200 kcal · Proteína 70 g/);
  assert.match(t, /2026-09-20 \(dom\): 1 refeição/);
  assert.match(t, /MÉDIA nos 1 dia\(s\) com estimativa: ~1200 kcal/);
});
