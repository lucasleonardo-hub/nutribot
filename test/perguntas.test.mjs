// perguntas.js (fase 7, mapa seção 3): tema por regex, documento gravado, filtro, histórico em ordem, apagar só o que é da
// pessoa e o bloco de confidência que entra nos prompts que já existem (conversa, pensamento, reflexão). Sem Mongo: a
// coleção é um dublê em memória.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const P = await import('../perguntas.js');

const PERFIL = { _id: 'p1', nome: 'Pessoa A Teste', jids: ['a@s.whatsapp.net'], fuso: 'America/Sao_Paulo' };
const OUTRO = { _id: 'p2', nome: 'Pessoa B', jids: ['b@s.whatsapp.net'], fuso: 'Europe/Sofia' };

function colecaoFalsa() {
  const docs = [];
  let seq = 0;
  const casaCampo = (v, cond) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$in' in cond && !cond.$in.includes(v)) return false;
      if ('$gte' in cond && !(v >= cond.$gte)) return false;
      if ('$lt' in cond && !(v < cond.$lt)) return false;
      return true;
    }
    return String(v) === String(cond);
  };
  const casa = (d, f) => Object.entries(f).every(([k, cond]) => casaCampo(d[k], cond));
  return {
    docs,
    insertOne: async (d) => {
      const _id = `id${++seq}`;
      docs.push({ _id, ...d });
      return { insertedId: _id };
    },
    find: (f) => {
      let l = docs.filter((d) => casa(d, f));
      const cursor = {
        sort: (s) => ((l = [...l].sort((a, b) => (a.em - b.em) * (s.em || 1))), cursor),
        limit: (n) => ((l = l.slice(0, n)), cursor),
        toArray: async () => l,
      };
      return cursor;
    },
    deleteOne: async (f) => {
      const i = docs.findIndex((d) => casa(d, f));
      if (i < 0) return { deletedCount: 0 };
      docs.splice(i, 1);
      return { deletedCount: 1 };
    },
    deleteMany: async (f) => {
      const l = docs.filter((d) => casa(d, f));
      for (const d of l) docs.splice(docs.indexOf(d), 1);
      return { deletedCount: l.length };
    },
  };
}

test('temaDe: treino, sono, peso, humor, comida e outro (sem IA)', () => {
  assert.equal(P.temaDe('Posso subir a carga do supino?'), 'treino');
  assert.equal(P.temaDe('dormi mal, o que faço?'), 'sono');
  assert.equal(P.temaDe('por que a balança não mexe?'), 'peso');
  assert.equal(P.temaDe('ando muito ansiosa'), 'humor');
  assert.equal(P.temaDe('posso comer pão à noite?'), 'comida');
  assert.equal(P.temaDe('qual a capital da França?'), 'outro');
  assert.equal(P.temaDe(''), 'outro');
});

test('documentoPergunta: dia e hora no fuso da pessoa, limites, privado e sem pergunta = null', () => {
  const quando = new Date('2030-03-29T23:30:00Z'); // 20:30 em São Paulo; 01:30 do dia 30 em Sofia
  const d = P.documentoPergunta({ perfil: PERFIL, pergunta: '  posso   comer pão?  ', resposta: 'x'.repeat(2000), quando });
  assert.deepEqual([d.jid, d.perfilId, d.dia, d.hora, d.pergunta, d.resposta.length, d.tema, d.privado, d.vistaPelaNutriEm], ['a@s.whatsapp.net', 'p1', '2030-03-29', '20:30', 'posso comer pão?', P.MAX_RESPOSTA, 'comida', true, null]);
  const s = P.documentoPergunta({ perfil: OUTRO, pergunta: 'oi', resposta: 'oi', quando });
  assert.deepEqual([s.dia, s.hora], ['2030-03-30', '01:30']);
  assert.equal(P.documentoPergunta({ perfil: PERFIL, pergunta: '   ', resposta: 'x' }), null);
  assert.equal(P.documentoPergunta({ perfil: PERFIL, pergunta: 'a'.repeat(900), resposta: '' }).pergunta.length, P.MAX_PERGUNTA);
});

test('filtroPerguntas: jids, desde por instante ou por dia, antes', () => {
  const t = new Date('2030-03-29T10:00:00Z');
  assert.deepEqual(P.filtroPerguntas('a', {}), { jid: { $in: ['a'] } });
  assert.deepEqual(P.filtroPerguntas(['a', 'b'], { desde: t }), { jid: { $in: ['a', 'b'] }, em: { $gte: t } });
  assert.deepEqual(P.filtroPerguntas('a', { desde: '2030-03-20' }), { jid: { $in: ['a'] }, dia: { $gte: '2030-03-20' } });
  assert.deepEqual(P.filtroPerguntas('a', { desde: t.getTime(), antes: '2030-03-30T00:00:00Z' }), { jid: { $in: ['a'] }, em: { $gte: t, $lt: new Date('2030-03-30T00:00:00Z') } });
  assert.deepEqual(P.filtroPerguntas('a', { desde: 'lixo' }), { jid: { $in: ['a'] } });
});

test('guardarPergunta + perguntasDe: grava, devolve em ordem cronológica, filtra por pessoa e por instante; apagar só o da pessoa', async () => {
  const col = colecaoFalsa();
  const base = Date.parse('2030-03-29T12:00:00Z');
  for (let i = 0; i < 7; i++) await P.guardarPergunta({ perfil: PERFIL, dia: '2030-03-29', pergunta: `pergunta ${i}`, resposta: `resposta ${i}.`, quando: new Date(base + i * 60_000) }, { col });
  await P.guardarPergunta({ perfil: OUTRO, dia: '2030-03-29', pergunta: 'da outra pessoa', resposta: 'r', quando: new Date(base) }, { col });
  assert.equal(col.docs.length, 8);
  const ult = await P.perguntasDe(PERFIL.jids, { n: 5 }, { col });
  assert.deepEqual(ult.map((x) => x.pergunta), ['pergunta 2', 'pergunta 3', 'pergunta 4', 'pergunta 5', 'pergunta 6']);
  const desde = await P.perguntasDe('a@s.whatsapp.net', { desde: new Date(base + 5 * 60_000) }, { col });
  assert.deepEqual(desde.map((x) => x.pergunta), ['pergunta 5', 'pergunta 6']);
  const antes = await P.perguntasDe(PERFIL.jids, { antes: new Date(base + 2 * 60_000), n: 10 }, { col });
  assert.deepEqual(antes.map((x) => x.pergunta), ['pergunta 0', 'pergunta 1']);
  // apagar: a pergunta da outra pessoa não sai pelo jid desta
  const daOutra = col.docs.find((d) => d.jid === 'b@s.whatsapp.net');
  assert.equal(await P.apagarPergunta(PERFIL.jids, daOutra._id, { col }), 0);
  assert.equal(await P.apagarPergunta(PERFIL.jids, ult[0]._id, { col }), 1);
  assert.equal(await P.apagarPerguntasDe(PERFIL.jids, { col }), 6);
  assert.deepEqual(col.docs.map((d) => d.jid), ['b@s.whatsapp.net']);
});

test('guardarPergunta nunca lança: banco fora ou perfil sem jid = null', async () => {
  const quebrada = { insertOne: async () => Promise.reject(new Error('banco fora')) };
  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));
  try {
    assert.equal(await P.guardarPergunta({ perfil: PERFIL, pergunta: 'oi', resposta: 'oi' }, { col: quebrada }), null);
    assert.equal(await P.guardarPergunta({ perfil: { nome: 'x', jids: [] }, pergunta: 'oi', resposta: 'oi' }, { col: colecaoFalsa() }), null);
    assert.equal(await P.guardarPergunta({ perfil: PERFIL, pergunta: 'sem Mongo', resposta: 'x' }), null); // sem conectarMongo: silencioso
  } finally {
    console.warn = warn;
  }
  assert.equal(avisos.length, 1);
});

test('montarPergunta: formato da API', () => {
  const em = new Date('2030-03-29T15:02:00Z');
  assert.deepEqual(P.montarPergunta({ _id: 'x1', dia: '2030-03-29', hora: '12:02', em, pergunta: 'p', resposta: 'r', tema: 'sono', jid: 'segredo' }), { id: 'x1', dia: '2030-03-29', hora: '12:02', em: em.toISOString(), pergunta: 'p', resposta: 'r', tema: 'sono' });
  assert.equal(P.montarPergunta({ _id: 'x', tema: 'inventado' }).tema, 'outro');
});

test('blocoPerguntasApp: conversa (3 últimas, confidência), pensamento (todas do dia), reflexão (temas e até 10); vazio = ""', () => {
  const lista = Array.from({ length: 12 }, (_, i) => ({ dia: '2030-03-29', hora: `1${i % 10}:0${i % 10}`, em: new Date(Date.parse('2030-03-29T12:00:00Z') + i * 60_000), pergunta: i % 2 ? `posso comer pão ${i}?` : `dormi mal ${i}, e agora?`, resposta: `Pode sim, dentro de 300 kcal. Depois conversamos mais sobre isso ${i}.`, tema: i % 2 ? 'comida' : 'sono' }));
  assert.equal(P.blocoPerguntasApp([], { modo: 'conversa' }), '');
  assert.equal(P.blocoPerguntasApp(null), '');
  const conv = P.blocoPerguntasApp(lista, { modo: 'conversa', nome: 'Pessoa A Teste' });
  assert.match(conv, /^PERGUNTAS DE PESSOA AO APP \(EM CONFIDÊNCIA: leve em conta e retome só se ela\(e\) puxar o assunto; não cite nem parafraseie no grupo\):/);
  assert.equal(conv.split('\n').length, 4); // cabeçalho + 3
  assert.match(conv, /"posso comer pão 11\?" \(respondi: Pode sim, dentro de 300 kcal\.\)/);
  assert.doesNotMatch(conv, /pão 7\?/);
  const pens = P.blocoPerguntasApp(lista.slice(0, 2), { modo: 'pensamento' });
  assert.match(pens, /^PERGUNTAS AO APP HOJE \(privado/);
  assert.match(pens, /Às 10:00 perguntou no app "dormi mal 0, e agora\?"; respondi: Pode sim/);
  const refl = P.blocoPerguntasApp(lista, { modo: 'reflexao' });
  assert.match(refl, /12 pergunta\(s\); temas: (sono 6, comida 6|comida 6, sono 6)\./);
  assert.equal(refl.split('\n').length, 11); // cabeçalho + 10
  // ordem cronológica mesmo vindo embaralhada; sem asterisco nem emoji
  const emb = P.blocoPerguntasApp([lista[3], lista[1], lista[2]], { modo: 'conversa' });
  assert.ok(emb.indexOf('pão 1?') < emb.indexOf('pão 3?'));
  assert.doesNotMatch(conv + pens + refl, /\*|[\u{1F300}-\u{1FAFF}]/u);
});
