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

test('grafico.png: o PNG do !grafico com a config do WhatsApp, guardado 1 h por pessoa; 503 quando o desenhista falha; dias 7..31', async () => {
  const configs = [];
  let falhar = false;
  const grafico = {
    configGrafico: (p) => (configs.push(p), { type: 'bar', nome: p.nome }),
    renderizar: async () => (falhar ? null : Buffer.from('\x89PNG-de-mentira')),
  };
  const app = express();
  app.use('/g', criarApi({ auth, dados, grafico, agora: () => AGORA, adminJid: 'a@s.whatsapp.net', temHevyDe: () => false, ehDonoDaAgendaDe: () => false }));
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    let r = await fetch(`${b}/g/perfis/${ID}/grafico.png`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString().includes('PNG-de-mentira'), true);
    assert.deepEqual([configs.length, configs[0].dias, configs[0].dia, typeof configs[0].nome], [1, 30, '2030-03-29', 'string']);
    // segundo pedido no mesmo dia: sai do cache (o desenhista não é chamado de novo)
    r = await fetch(`${b}/g/perfis/${ID}/grafico.png?dias=30`, { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual([r.status, configs.length], [200, 1]);
    // outra janela: desenha de novo
    r = await fetch(`${b}/g/perfis/${ID}/grafico.png?dias=14`, { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual([r.status, configs.length, configs[1].dias], [200, 2, 14]);
    r = await fetch(`${b}/g/perfis/${ID}/grafico.png?dias=90`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 400);
    falhar = true;
    r = await fetch(`${b}/g/perfis/${ID}/grafico.png?dias=7`, { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual([r.status, (await r.json()).erro.codigo], [503, 'grafico_indisponivel']);
    r = await fetch(`${b}/g/perfis/${ID}/grafico.png`);
    assert.equal(r.status, 401);
  } finally {
    srv.close();
  }
});

test('fase 4: /dias (≤ 92 dias, de obrigatório), /plano (Mongo ou nulo), /sugestao-refeicao (IA injetada, cache 1 h por slot, 503 quando falha)', async () => {
  const pedidosIa = [];
  let falharIa = false;
  const perguntas = [];
  const ia = {
    estimarRefeicaoApp: async () => null,
    responderApp: async (p) => {
      perguntas.push(p);
      if (p.pergunta.includes('cai')) throw new Error('ia caiu');
      return `*Oi!* 💪 Hoje você comeu ${p.hoje.includes('nada') ? 'nada' : 'algo'}. Mora na Rua X. _Força_!`;
    },
    sugerirRefeicao: async (p) => {
      pedidosIa.push(p);
      if (falharIa) throw new Error('ia caiu');
      return { opcoes: [{ nome: `Opção pro ${p.slot}`, porque: 'cabe', kcal: 600, proteina_g: 40, onde: 'casa', preparo: null }], levar: null, dica: 'Vai dar certo.' };
    },
  };
  const dadosF4 = {
    ...dados,
    diasEntre: async (perfil, de, ate) => ({ refeicoes: [refeicao(ate, 'almoco', 750, 900)], pesagens: [{ dia: ate, peso: 70.4 }], saude: { sonos: [{ dia: ate, total: 420, inicio: '23:30', fim: '06:30' }], atividades: [] }, base: { refeicoes: [], pesagens: [] } }),
    relatorios: async () => ({ semana: { nome: 'Semana-2030-W13.md', modifiedTime: '2030-03-30T03:00:00Z', texto: '# Semana 2030-W13\n\nSemana boa.\n' }, mes: null }),
    planoDe: async (perfil) => (perfil.nome === 'Pessoa A' ? { semana: '2030-03-31/2030-04-06', de: '2030-03-31', ate: '2030-04-06', texto: 'Seg: arroz.', criadoEm: new Date('2030-03-28T12:00:00Z') } : null),
    registrosSugestao: async () => ({ refeicoes: [refeicao(somarDias(DIA, -1), 'almoco', 750, 900), refeicao(DIA, 'cafe', 480, 400)], pesagens: [] }),
    contextoSugestao: async () => (contextos.push(1), { humor: { humor: 4 }, eventos: [], despensa: '', agenda: 'Reunião no bairro Secreto às 15h', lugares: 'Agora ela(e) está em casa.', persona: '' }),
  };
  const contextos = [];
  const app = express();
  app.use('/f', criarApi({ auth, dados: dadosF4, ia, agora: () => AGORA, adminJid: 'a@s.whatsapp.net', temHevyDe: () => false, ehDonoDaAgendaDe: () => false }));
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  const get = async (c) => { const r = await fetch(`${b}/f${c}`, { headers: { authorization: `Bearer ${token}` } }); return { status: r.status, corpo: await r.json() }; };
  try {
    let r = await get(`/perfis/${ID}/dias?de=${somarDias(DIA, -2)}&ate=${DIA}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.dias.map((d) => [d.dia, d.kcal, d.peso, d.sonoMin]), [[somarDias(DIA, -2), null, null, null], [somarDias(DIA, -1), null, null, null], [DIA, 900, 70.4, 420]]);
    assert.ok('meta' in r.corpo);
    r = await get(`/perfis/${ID}/dias?ate=${DIA}`);
    assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'pedido_invalido']);
    r = await get(`/perfis/${ID}/dias?de=${somarDias(DIA, -100)}&ate=${DIA}`);
    assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'intervalo_invalido']);

    r = await get(`/perfis/${ID}/resumos`);
    assert.equal(r.corpo.relatorio.semana.titulo, 'Semana 2030-W13');
    r = await get(`/perfis/${ID}/plano`);
    assert.deepEqual([r.status, r.corpo.plano.de, r.corpo.plano.texto], [200, '2030-03-31', 'Seg: arroz.']);
    r = await get(`/perfis/bbbbbbbbbbbbbbbbbbbbbbbb/plano`);
    assert.deepEqual([r.status, r.corpo.plano], [200, null]);

    // 12:00 em São Paulo, café já registrado hoje: a próxima é o almoço (rotina de 21 dias: almoço às 12:30)
    r = await get(`/perfis/${ID}/sugestao-refeicao`);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual([r.corpo.slot, r.corpo.nome, r.corpo.hora, r.corpo.opcoes.length, r.corpo.opcoes[0].nome, r.corpo.dica], ['almoco', 'Almoço', '12:30', 1, 'Opção pro almoco', 'Vai dar certo.']);
    assert.deepEqual([pedidosIa.length, pedidosIa[0].slot, pedidosIa[0].registradasHoje.includes('Café da manhã')], [1, 'almoco', true]);
    // a agenda vai pra IA filtrada de localização; os lugares só como tipo
    assert.equal(pedidosIa[0].agenda.includes('Secreto'), false);
    assert.equal(pedidosIa[0].lugares, 'Agora ela(e) está em casa.');
    r = await get(`/perfis/${ID}/sugestao-refeicao`);
    assert.deepEqual([r.status, pedidosIa.length, contextos.length], [200, 1, 1]); // cache: nem o contexto caro é buscado
    r = await get(`/perfis/${ID}/sugestao-refeicao?slot=jantar`);
    assert.deepEqual([r.status, r.corpo.slot, r.corpo.hora, pedidosIa.length], [200, 'jantar', '20:00', 2]); // sem rotina de jantar: hora padrão
    r = await get(`/perfis/${ID}/sugestao-refeicao?slot=jantar`);
    assert.deepEqual([r.status, pedidosIa.length, contextos.length], [200, 2, 2]);
    r = await get(`/perfis/${ID}/sugestao-refeicao?slot=brunch`);
    assert.equal(r.status, 400);
    // dois pedidos no mesmo instante no mesmo slot = uma chamada de IA
    const [d1, d2] = await Promise.all([get(`/perfis/${ID}/sugestao-refeicao?slot=lanche`), get(`/perfis/${ID}/sugestao-refeicao?slot=lanche`)]);
    assert.deepEqual([d1.status, d2.status, pedidosIa.length], [200, 200, 3]);
    falharIa = true;
    r = await get(`/perfis/${ID}/sugestao-refeicao?slot=ceia`);
    assert.deepEqual([r.status, r.corpo.erro.codigo], [503, 'ia_indisponivel']);
    falharIa = false;
    r = await get(`/perfis/${ID}/sugestao-refeicao?slot=ceia`); // a falha não ficou no cache
    assert.equal(r.status, 200);
    // teto por pessoa: 6 chamadas por hora (já foram 5: almoco, jantar, lanche, ceia×2)
    r = await get(`/perfis/${ID}/sugestao-refeicao?slot=lanche_manha`);
    assert.equal(r.status, 200);
    r = await get(`/perfis/${ID}/sugestao-refeicao?slot=cafe`);
    assert.deepEqual([r.status, r.corpo.erro.codigo], [429, 'muitas_analises']);

    // fase 5: pergunta rápida; resposta em texto puro (sem *, _, emoji) e sem localização; 400 vazia; 503 quando a IA falha
    const post = async (corpo) => { const x = await fetch(`${b}/f/perfis/${ID}/perguntar`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }); return { status: x.status, corpo: await x.json() }; };
    r = await post({ texto: '  O que   como agora?  ', anteriores: [{ pergunta: 'oi', resposta: 'oi!' }] });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.resposta, 'Oi! Hoje você comeu algo. Força!');
    assert.deepEqual([perguntas.length, perguntas[0].pergunta, perguntas[0].anteriores.length, perguntas[0].hoje.includes('Café da manhã'), typeof perguntas[0].treino], [1, 'O que como agora?', 1, true, 'string']);
    r = await post({ texto: '' });
    assert.equal(r.status, 400);
    r = await post({ texto: 'a ia cai?' });
    assert.deepEqual([r.status, r.corpo.erro.codigo], [503, 'ia_indisponivel']);
    const anonPost = await fetch(`${b}/f/perfis/${ID}/perguntar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"texto":"x"}' });
    assert.equal(anonPost.status, 401);
    const anon = await fetch(`${b}/f/perfis/${ID}/sugestao-refeicao`);
    assert.equal(anon.status, 401);
  } finally {
    srv.close();
  }
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
