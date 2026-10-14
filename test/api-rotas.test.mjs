// Rotas da API v1 (api.js) num Express de verdade em 127.0.0.1, com o banco e a busca injetados (sem Mongo): pareamento,
// 401 sem token ou com token revogado, 429, 404, 400 de dia/intervalo/JSON, erros no formato do contrato e as rotas de
// leitura respondendo o JSON dos montadores. As rotas antigas não passam por aqui (o roteador só existe em /api/v1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { criarApi } = await import('../api.js');
const { criarAuth } = await import('../api-auth.js');
const { somarDias } = await import('../progresso.js');

// ---------- banco de mentira (o pedaço do driver que o api-auth usa) ----------
function colecaoFalsa() {
  const docs = [];
  let seq = 0;
  const casa = (d, f) =>
    Object.entries(f).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date) && '$gt' in v) return d[k] != null && d[k] > v.$gt;
      return (d[k] ?? null) === (v ?? null);
    });
  return {
    docs,
    insertOne: async (d) => (docs.push({ _id: `id${++seq}`, ...d }), {}),
    find: (f = {}) => ({ toArray: async () => docs.filter((d) => casa(d, f)) }),
    findOneAndUpdate: async (f, u) => {
      const d = docs.find((x) => casa(x, f));
      if (d) Object.assign(d, u.$set);
      return d || null;
    },
    updateOne: async (f, u) => {
      const d = docs.find((x) => casa(x, f));
      if (d) Object.assign(d, u.$set);
      return {};
    },
    updateMany: async (f, u) => {
      const l = docs.filter((x) => casa(x, f));
      for (const d of l) Object.assign(d, u.$set);
      return { modifiedCount: l.length };
    },
    deleteMany: async (f) => {
      for (const d of docs.filter((x) => casa(x, f))) docs.splice(docs.indexOf(d), 1);
      return {};
    },
  };
}
const cols = { codigos_app: colecaoFalsa(), dispositivos: colecaoFalsa() };
const AGORA = new Date('2030-03-29T15:00:00Z'); // 12:00 em São Paulo
const auth = criarAuth({ colecao: (n) => cols[n], agora: () => AGORA });

// ---------- busca de mentira ----------
const DIA = '2030-03-29';
const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const perfis = [
  { _id: ID, nome: 'Pessoa A', jids: ['a@s.whatsapp.net'], fuso: 'America/Sao_Paulo', objetivo: 'manter', peso: 70, lugares: [{ bairro: 'Bairro Secreto' }] },
  { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', nome: 'Pessoa B', jids: ['b@s.whatsapp.net'], fuso: 'Europe/Sofia', objetivo: 'emagrecer', peso: 80 },
];
const refeicao = (dia, slot, minutos, kcal) => ({ _id: `${dia}-${slot}`, jid: 'a@s.whatsapp.net', dia, slot, minutos, horaLocal: `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`, resumo: 'x', descricao: `${slot} gostoso`, estimativa: { kcal, p: 30, c: 50, g: 20 } });
const chamadas = [];
const dados = {
  listarPerfis: async () => perfis,
  doDia: async (perfil, dia, opts) => (chamadas.push(['doDia', perfil.nome, dia, opts]), { refeicoes: [refeicao(dia, 'cafe', 480, 500)], pesagens: [], saude: null, treinos: [] }),
  refeicoesEntre: async (perfil, de, ate, hoje) => (chamadas.push(['refeicoesEntre', de, ate, hoje]), [refeicao(somarDias(DIA, -1), 'almoco', 750, 900)]),
  de31: async () => ({ refeicoes: [], pesagens: [] }),
  catalogoHevy: async () => ({}),
  daNutri: async () => ({ hipotesesFechadas: [], reflexoes: [], pensamentos: [{ dia: DIA, hora: '11:30', texto: 'Foi ao Bairro Secreto. Comeu bem.' }], diario: [] }),
  integracoes: async () => ({ porPerfil: new Map(), whatsapp: { estado: 'conectado' }, driveConfigurado: true }),
};

let base;
let servidor;
let token;
before(async () => {
  const app = express();
  app.get('/ping', (_req, res) => res.send('pong')); // rota "antiga" de controle: o roteador não mexe nela
  app.use('/api/v1', criarApi({ auth, dados, agora: () => AGORA, adminJid: 'a@s.whatsapp.net', temHevyDe: () => false, ehDonoDaAgendaDe: () => false }));
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor?.close());

const pedir = (caminho, { metodo = 'GET', corpo, tk = token, cabecalhos = {} } = {}) =>
  fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...(corpo != null ? { 'content-type': 'application/json' } : {}), ...cabecalhos },
    body: corpo == null ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
const json = async (r) => ({ status: r.status, corpo: await r.json() });

test('sem token: 401 sem_token; token errado: 401 token_invalido; formato de erro do contrato', async () => {
  let r = await json(await pedir('/api/v1/perfis', { tk: null }));
  assert.equal(r.status, 401);
  assert.deepEqual(Object.keys(r.corpo), ['erro']);
  assert.equal(r.corpo.erro.codigo, 'sem_token');
  assert.equal(typeof r.corpo.erro.mensagem, 'string');
  r = await json(await pedir('/api/v1/perfis', { tk: 'inventado' }));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [401, 'token_invalido']);
  // rota fora da API continua igual
  assert.equal(await (await fetch(`${base}/ping`)).text(), 'pong');
});

test('parear: código certo devolve token de 32 bytes e os perfis (sem jids); JSON inválido = 400', async () => {
  let r = await json(await pedir('/api/v1/parear', { metodo: 'POST', corpo: '{"codigo": ', tk: null }));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'json_invalido']);
  const { codigo } = await auth.novoCodigo();
  r = await json(await pedir('/api/v1/parear', { metodo: 'POST', corpo: { codigo, aparelho: 'Celular de teste' }, tk: null }));
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.corpo), ['token', 'perfis']);
  assert.equal(Buffer.from(r.corpo.token, 'base64url').length, 32);
  assert.equal(r.corpo.perfis.length, 2);
  assert.equal(r.corpo.perfis[0].ehDono, true);
  assert.equal(JSON.stringify(r.corpo).includes('whatsapp.net'), false);
  token = r.corpo.token;
  // o mesmo código não serve de novo
  r = await json(await pedir('/api/v1/parear', { metodo: 'POST', corpo: { codigo, aparelho: 'outro' }, tk: null }));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [401, 'codigo_invalido']);
});

test('GET /perfis com token', async () => {
  const r = await json(await pedir('/api/v1/perfis'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.perfis.map((p) => [p.id, p.primeiroNome, p.fuso]), [[ID, 'Pessoa', 'America/Sao_Paulo'], ['bbbbbbbbbbbbbbbbbbbbbbbb', 'Pessoa', 'Europe/Sofia']]);
});

test('hoje: dia padrão é o da pessoa (fuso dela); dia inválido ou futuro = 400; perfil inexistente = 404', async () => {
  let r = await json(await pedir(`/api/v1/perfis/${ID}/hoje`));
  assert.equal(r.status, 200);
  assert.equal(r.corpo.dia, DIA);
  assert.equal(r.corpo.agora, '12:00');
  assert.equal(r.corpo.kcal.consumido, 500);
  assert.equal(r.corpo.refeicoes[0].hora, '08:00');
  // Sofia (UTC+2 antes do horário de verão europeu de 31/03) está 5 h à frente: a hora é a de lá
  r = await json(await pedir('/api/v1/perfis/bbbbbbbbbbbbbbbbbbbbbbbb/hoje'));
  assert.equal(r.corpo.agora, '17:00');
  assert.equal(r.corpo.fuso, 'Europe/Sofia');
  r = await json(await pedir(`/api/v1/perfis/${ID}/hoje?dia=2030-02-31`));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'dia_invalido']);
  r = await json(await pedir(`/api/v1/perfis/${ID}/hoje?dia=2030-03-30`));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'dia_invalido']);
  r = await json(await pedir(`/api/v1/perfis/${ID}/hoje?dia=2030-03-20`));
  assert.equal(r.corpo.dia, '2030-03-20');
  r = await json(await pedir('/api/v1/perfis/cccccccccccccccccccccccc/hoje'));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [404, 'perfil_nao_encontrado']);
});

test('refeições: padrão 7 dias até hoje; no máximo 31 dias; de depois de ate = 400', async () => {
  let r = await json(await pedir(`/api/v1/perfis/${ID}/refeicoes`));
  assert.equal(r.status, 200);
  assert.equal(r.corpo.dias.length, 7);
  assert.equal(r.corpo.dias[6].dia, DIA);
  assert.equal(r.corpo.dias[5].refeicoes[0].kcal, 900);
  r = await json(await pedir(`/api/v1/perfis/${ID}/refeicoes?de=2030-02-27&ate=2030-03-29`));
  assert.equal(r.status, 200); // 31 dias
  assert.equal(r.corpo.dias.length, 31);
  r = await json(await pedir(`/api/v1/perfis/${ID}/refeicoes?de=2030-02-26&ate=2030-03-29`));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'intervalo_invalido']);
  r = await json(await pedir(`/api/v1/perfis/${ID}/refeicoes?de=2030-03-29&ate=2030-03-20`));
  assert.equal(r.status, 400);
  r = await json(await pedir(`/api/v1/perfis/${ID}/refeicoes?de=ontem`));
  assert.equal(r.status, 400);
});

test('progresso, corpo, nutri, resumos e integrações respondem; nutri sem lugar aprendido', async () => {
  for (const rota of ['progresso', 'corpo', 'nutri', 'resumos']) {
    const r = await pedir(`/api/v1/perfis/${ID}/${rota}`);
    assert.equal(r.status, 200, rota);
  }
  const n = await json(await pedir(`/api/v1/perfis/${ID}/nutri`));
  assert.deepEqual(n.corpo.avaliacoes.map((a) => a.texto), ['Comeu bem.']);
  const corpo = chamadas.filter((c) => c[0] === 'doDia' && c[3]?.treinosCompletos);
  assert.ok(corpo.length, 'o corpo pede os treinos completos (exercícios)');
  const i = await json(await pedir('/api/v1/integracoes'));
  assert.equal(i.status, 200);
  assert.equal(i.corpo.whatsapp.conectado, true);
  assert.equal(i.corpo.perfis.length, 2);
});

test('rota inexistente na API = 404 no formato do contrato; erro inesperado = 500 sem vazar detalhe; banco fora = 503', async () => {
  let r = await json(await pedir('/api/v1/nada'));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [404, 'rota_inexistente']);
  const quebrada = { ...dados, de31: async () => Promise.reject(new Error('segredo interno')) };
  const foraDoAr = { ...dados, de31: async () => Promise.reject(new Error('Chame conectarMongo() antes de usar colecao()')) };
  const app = express();
  app.use('/a', criarApi({ auth, dados: quebrada, agora: () => AGORA, temHevyDe: () => false }));
  app.use('/b', criarApi({ auth, dados: foraDoAr, agora: () => AGORA, temHevyDe: () => false }));
  const s = await new Promise((ok) => {
    const x = app.listen(0, '127.0.0.1', () => ok(x));
  });
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    const porta = s.address().port;
    const a = await fetch(`http://127.0.0.1:${porta}/a/perfis/${ID}/progresso`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(a.status, 500);
    const ca = await a.json();
    assert.equal(ca.erro.codigo, 'erro_interno');
    assert.equal(JSON.stringify(ca).includes('segredo'), false);
    const b = await fetch(`http://127.0.0.1:${porta}/b/perfis/${ID}/resumos`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(b.status, 503);
    assert.equal((await b.json()).erro.codigo, 'servidor_iniciando');
  } finally {
    console.error = erroOriginal;
    s.close();
  }
});

test('429: 5 códigos errados do mesmo IP bloqueiam o pareamento por 1 hora', async () => {
  const xff = { 'x-forwarded-for': '203.0.113.9' };
  for (let i = 0; i < 5; i++) {
    const r = await pedir('/api/v1/parear', { metodo: 'POST', corpo: { codigo: '999999', aparelho: 'x' }, tk: null, cabecalhos: xff });
    assert.equal(r.status, 401);
  }
  const { codigo } = await auth.novoCodigo();
  const r = await json(await pedir('/api/v1/parear', { metodo: 'POST', corpo: { codigo, aparelho: 'x' }, tk: null, cabecalhos: xff }));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [429, 'muitas_tentativas']);
});

test('M1/M2: ?ate=abc e afins = 400 (não 500); charset não suportado = 400', async () => {
  for (const q of ['ate=abc', 'ate=2030-13-01', 'de=2030-03-01&ate=xyz', 'de=abc&ate=2030-03-29']) {
    const r = await json(await pedir(`/api/v1/perfis/${ID}/refeicoes?${q}`));
    assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'intervalo_invalido'], q);
  }
  for (const q of ['dia=abc', 'dia=2030-3-1']) {
    const r = await json(await pedir(`/api/v1/perfis/${ID}/progresso?${q}`));
    assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'dia_invalido'], q);
  }
  const r = await json(await pedir('/api/v1/parear', { metodo: 'POST', corpo: '{"codigo":"1"}', tk: null, cabecalhos: { 'content-type': 'application/json; charset=klingon', 'x-forwarded-for': '198.51.100.40' } }));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'pedido_invalido']);
});

test('I2: 30 pedidos sem token válido do mesmo IP em 10 min; o 31º é 429 (outro IP segue)', async () => {
  const xff = { 'x-forwarded-for': '198.51.100.77' };
  for (let i = 0; i < 30; i++) {
    const r = await pedir('/api/v1/perfis', { tk: i % 2 ? 'lixo' : null, cabecalhos: xff });
    assert.equal(r.status, 401);
  }
  let r = await json(await pedir('/api/v1/perfis', { tk: token, cabecalhos: xff }));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [429, 'muitas_tentativas']);
  r = await json(await pedir('/api/v1/perfis', { cabecalhos: { 'x-forwarded-for': '198.51.100.78' } }));
  assert.equal(r.status, 200);
});

test('M6: se a busca de perfis falhar no pareamento, o código não é consumido', async () => {
  const falha = { ...dados, listarPerfis: async () => Promise.reject(new Error('Chame conectarMongo() antes de usar colecao()')) };
  const app = express();
  app.use('/c', criarApi({ auth, dados: falha, agora: () => AGORA, temHevyDe: () => false }));
  const s = await new Promise((ok) => {
    const x = app.listen(0, '127.0.0.1', () => ok(x));
  });
  try {
    const { codigo } = await auth.novoCodigo();
    const corpo = JSON.stringify({ codigo, aparelho: 'x' });
    const a = await fetch(`http://127.0.0.1:${s.address().port}/c/parear`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.90' }, body: corpo });
    assert.equal(a.status, 503);
    // o mesmo código ainda vale na API que funciona
    const b = await json(await pedir('/api/v1/parear', { metodo: 'POST', corpo, tk: null, cabecalhos: { 'x-forwarded-for': '198.51.100.91' } }));
    assert.equal(b.status, 200);
    token = b.corpo.token;
  } finally {
    s.close();
  }
});

test('token revogado (!app sair) volta a dar 401', async () => {
  await auth.revogarTodos();
  const r = await json(await pedir('/api/v1/perfis'));
  assert.deepEqual([r.status, r.corpo.erro.codigo], [401, 'token_invalido']);
});
