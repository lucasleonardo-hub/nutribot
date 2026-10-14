// Pareamento e token de aparelho do app (api-auth.js), com o Mongo injetado (coleções de mentira em memória): código de 6
// dígitos de uso único e 10 min, só o hash no banco, token de 32 bytes guardado só como sha256, revogação pelo "!app sair",
// limite de 5 tentativas por hora por IP e o freio global contra chute distribuído.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAuth, sha256, gerarCodigo, mesmoHash, comandoApp, ipDe, saltosDoProxy, criarDiagnosticoXff, CODIGO_VALIDADE_MIN, MAX_TENTATIVAS_HORA, MAX_FALHAS_GLOBAIS_HORA, MAX_SEM_TOKEN, JANELA_SEM_TOKEN_MIN } from '../api-auth.js';

/** Coleção de mentira com o pedaço da API do driver que o api-auth usa. */
function colecaoFalsa() {
  const docs = [];
  let seq = 0;
  const casa = (d, f) =>
    Object.entries(f).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('$gt' in v) return d[k] != null && d[k] > v.$gt;
        if ('$in' in v) return v.$in.includes(d[k] ?? null);
      }
      return (d[k] ?? null) === (v ?? null) || (d[k] instanceof Date && v instanceof Date && d[k].getTime() === v.getTime());
    });
  return {
    docs,
    async insertOne(d) {
      const doc = { _id: `id${++seq}`, ...d };
      docs.push(doc);
      return { insertedId: doc._id };
    },
    find(f = {}) {
      return { toArray: async () => docs.filter((d) => casa(d, f)) };
    },
    async findOne(f = {}) {
      return docs.find((d) => casa(d, f)) || null;
    },
    async findOneAndUpdate(f, u) {
      const d = docs.find((x) => casa(x, f));
      if (!d) return null;
      Object.assign(d, u.$set || {});
      return d;
    },
    async updateOne(f, u) {
      const d = docs.find((x) => casa(x, f));
      if (d) Object.assign(d, u.$set || {});
      return { modifiedCount: d ? 1 : 0 };
    },
    async updateMany(f, u) {
      const alvo = docs.filter((x) => casa(x, f));
      for (const d of alvo) Object.assign(d, u.$set || {});
      return { modifiedCount: alvo.length };
    },
    async deleteMany(f) {
      const fora = docs.filter((x) => casa(x, f));
      for (const d of fora) docs.splice(docs.indexOf(d), 1);
      return { deletedCount: fora.length };
    },
  };
}
function banco() {
  const cols = { codigos_app: colecaoFalsa(), dispositivos: colecaoFalsa() };
  return { cols, colecao: (n) => cols[n] };
}
/** relógio controlável */
function relogio(inicio = '2030-03-29T12:00:00Z') {
  let t = Date.parse(inicio);
  return { agora: () => new Date(t), andar: (min) => (t += min * 60_000) };
}

test('código: 6 dígitos com zeros à esquerda; hash sha256 hex', () => {
  assert.equal(gerarCodigo(() => 42), '000042');
  assert.match(gerarCodigo(), /^\d{6}$/);
  assert.equal(sha256('123456'), '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
  assert.equal(mesmoHash(sha256('a'), sha256('a')), true);
  assert.equal(mesmoHash(sha256('a'), sha256('b')), false);
  assert.equal(mesmoHash(sha256('a'), 'curto'), false);
  assert.equal(mesmoHash(null, sha256('a')), false);
});

test('pareamento: código vira token; no banco só os hashes; código não serve duas vezes', async () => {
  const b = banco();
  const r = relogio();
  const auth = criarAuth({ colecao: b.colecao, agora: r.agora });
  const { codigo, expiraEm } = await auth.novoCodigo();
  assert.match(codigo, /^\d{6}$/);
  assert.equal(expiraEm.getTime() - r.agora().getTime(), CODIGO_VALIDADE_MIN * 60_000);
  assert.equal(b.cols.codigos_app.docs.length, 1);
  assert.equal(b.cols.codigos_app.docs[0].hash, sha256(codigo));
  assert.equal(JSON.stringify(b.cols.codigos_app.docs).includes(codigo), false, 'o código em claro não vai pro banco');

  const { token } = await auth.parear({ codigo, aparelho: 'Celular Ômega de teste', ip: '1.1.1.1' });
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const disp = b.cols.dispositivos.docs[0];
  assert.equal(disp.hash, sha256(token));
  assert.equal(disp.aparelho, 'Celular Ômega de teste');
  assert.equal(disp.revogadoEm, null);
  assert.ok(disp.criadoEm instanceof Date && disp.ultimoUso instanceof Date);
  assert.equal(JSON.stringify(b.cols.dispositivos.docs).includes(token), false, 'o token em claro não vai pro banco');

  await assert.rejects(auth.parear({ codigo, aparelho: 'outro', ip: '1.1.1.1' }), (e) => e.status === 401 && e.codigo === 'codigo_invalido');
});

test('código expira em 10 minutos', async () => {
  const b = banco();
  const r = relogio();
  const auth = criarAuth({ colecao: b.colecao, agora: r.agora });
  const { codigo } = await auth.novoCodigo();
  r.andar(CODIGO_VALIDADE_MIN + 1);
  await assert.rejects(auth.parear({ codigo, aparelho: 'x', ip: '2.2.2.2' }), (e) => e.status === 401 && e.codigo === 'codigo_invalido');
  assert.equal(b.cols.dispositivos.docs.length, 0);
});

test('código novo invalida o anterior ainda não usado', async () => {
  const b = banco();
  const auth = criarAuth({ colecao: b.colecao, agora: relogio().agora });
  const a = await auth.novoCodigo();
  const n = await auth.novoCodigo();
  await assert.rejects(auth.parear({ codigo: a.codigo, ip: '3.3.3.3' }), (e) => e.status === 401);
  const ok = await auth.parear({ codigo: n.codigo, ip: '3.3.3.3' });
  assert.ok(ok.token);
});

test('autenticar: token certo acha o aparelho e atualiza ultimoUso; errado, vazio ou revogado = null', async () => {
  const b = banco();
  const r = relogio();
  const auth = criarAuth({ colecao: b.colecao, agora: r.agora });
  const { codigo } = await auth.novoCodigo();
  const { token } = await auth.parear({ codigo, aparelho: 'cel', ip: '4.4.4.4' });
  const antes = b.cols.dispositivos.docs[0].ultimoUso.getTime();
  r.andar(5);
  const d = await auth.autenticar(token);
  assert.equal(d.aparelho, 'cel');
  await new Promise((ok) => setImmediate(ok)); // a atualização do ultimoUso não segura a resposta
  assert.ok(b.cols.dispositivos.docs[0].ultimoUso.getTime() > antes);
  assert.equal(await auth.autenticar(`${token}x`), null);
  assert.equal(await auth.autenticar(''), null);
  assert.equal(await auth.autenticar(undefined), null);

  const n = await auth.revogarTodos();
  assert.equal(n, 1);
  assert.ok(b.cols.dispositivos.docs[0].revogadoEm instanceof Date);
  assert.equal(await auth.autenticar(token), null);
});

test('5 tentativas erradas por hora por IP: a 6ª é 429 mesmo com o código certo; outro IP segue; passa depois de 1 h', async () => {
  const b = banco();
  const r = relogio();
  const auth = criarAuth({ colecao: b.colecao, agora: r.agora });
  const { codigo } = await auth.novoCodigo();
  const errado = codigo === '000000' ? '000001' : '000000';
  for (let i = 0; i < MAX_TENTATIVAS_HORA; i++) {
    await assert.rejects(auth.parear({ codigo: errado, ip: '9.9.9.9' }), (e) => e.status === 401);
  }
  await assert.rejects(auth.parear({ codigo, ip: '9.9.9.9' }), (e) => e.status === 429 && e.codigo === 'muitas_tentativas');
  // formato inválido também conta (e não consulta o banco)
  await assert.rejects(auth.parear({ codigo: 'abc', ip: '8.8.8.8' }), (e) => e.status === 401);
  r.andar(61);
  const ok = await auth.parear({ codigo: (await auth.novoCodigo()).codigo, ip: '9.9.9.9' });
  assert.ok(ok.token);
});

test('freio global: 20 erros na hora (de IPs diferentes) apagam o código aberto', async () => {
  const b = banco();
  const auth = criarAuth({ colecao: b.colecao, agora: relogio().agora });
  const { codigo } = await auth.novoCodigo();
  const errado = codigo === '000000' ? '000001' : '000000';
  for (let i = 0; i < 20; i++) await assert.rejects(auth.parear({ codigo: errado, ip: `10.0.0.${i}` }), (e) => e.status === 401);
  await assert.rejects(auth.parear({ codigo, ip: '10.0.1.1' }), (e) => e.status === 401 && e.codigo === 'codigo_invalido');
  // o pareamento fica travado até o dono mandar !app de novo (código novo destrava)
  const novo = await auth.novoCodigo();
  const ok = await auth.parear({ codigo: novo.codigo, ip: '10.0.1.2' });
  assert.ok(ok.token);
});

/** Banco com latência no findOneAndUpdate (como o Mongo) e contagem das consultas que chegam nele. */
function bancoLento(ms = 20) {
  const b = banco();
  const original = b.cols.codigos_app.findOneAndUpdate;
  b.consultas = 0;
  b.cols.codigos_app.findOneAndUpdate = async (f, u) => {
    b.consultas++;
    await new Promise((ok) => setTimeout(ok, ms));
    return original(f, u);
  };
  return b;
}

test('B1 rajada de um IP: 500 palpites em paralelo, no máximo 5 chegam ao banco e o código certo na posição 300 não vira token', async () => {
  const b = bancoLento();
  const auth = criarAuth({ colecao: b.colecao, agora: relogio().agora });
  const { codigo } = await auth.novoCodigo();
  const errado = codigo === '000000' ? '000001' : '000000';
  const r = await Promise.allSettled(Array.from({ length: 500 }, (_, i) => auth.parear({ codigo: i === 300 ? codigo : errado, aparelho: 'x', ip: '9.9.9.9' })));
  const st = r.map((x) => (x.status === 'fulfilled' ? 200 : x.reason.status));
  assert.ok(b.consultas <= MAX_TENTATIVAS_HORA, `${b.consultas} consultas`);
  assert.equal(st.filter((s) => s === 200).length, 0);
  assert.equal(st[300], 429);
  assert.equal(b.cols.dispositivos.docs.length, 0);
});

test('B1 rajada com o código certo entre os 5 primeiros: um token só, e o acerto devolve a cota', async () => {
  const b = bancoLento();
  const auth = criarAuth({ colecao: b.colecao, agora: relogio().agora });
  const { codigo } = await auth.novoCodigo();
  const errado = codigo === '000000' ? '000001' : '000000';
  const r = await Promise.allSettled(Array.from({ length: 500 }, (_, i) => auth.parear({ codigo: i === 2 ? codigo : errado, aparelho: 'x', ip: '9.9.9.9' })));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.ok(b.consultas <= MAX_TENTATIVAS_HORA);
  // 4 erros contados (o acerto saiu da conta): mais 1 erro ainda chega ao banco, o seguinte não
  const antes = b.consultas;
  await assert.rejects(auth.parear({ codigo: errado, ip: '9.9.9.9' }), (e) => e.status === 401);
  await assert.rejects(auth.parear({ codigo: errado, ip: '9.9.9.9' }), (e) => e.status === 429);
  assert.equal(b.consultas, antes + 1);
});

test('B1 rajada de muitos IPs: o freio global segura em 20 consultas e o código certo depois disso não vira token', async () => {
  const b = bancoLento();
  const auth = criarAuth({ colecao: b.colecao, agora: relogio().agora });
  const { codigo } = await auth.novoCodigo();
  const errado = codigo === '000000' ? '000001' : '000000';
  const avisoOriginal = console.warn;
  console.warn = () => {};
  try {
    const r = await Promise.allSettled(Array.from({ length: 500 }, (_, i) => auth.parear({ codigo: i === 300 ? codigo : errado, aparelho: 'x', ip: `10.1.${Math.floor(i / 250)}.${i % 250}` })));
    assert.ok(b.consultas <= MAX_FALHAS_GLOBAIS_HORA, `${b.consultas} consultas`);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 0);
    assert.equal(b.cols.codigos_app.docs.filter((d) => d.usadoEm == null).length, 0, 'o código aberto foi apagado');
  } finally {
    console.warn = avisoOriginal;
  }
});

test('I2 token: formato inválido não vai ao banco; hashes ativos em cache por 60 s; parear e revogar invalidam o cache', async () => {
  const b = banco();
  const r = relogio();
  const auth = criarAuth({ colecao: b.colecao, agora: r.agora });
  let finds = 0;
  const findOriginal = b.cols.dispositivos.find;
  b.cols.dispositivos.find = (f) => (finds++, findOriginal(f));
  for (const lixo of ['x', 'a'.repeat(42), `${'a'.repeat(42)}!`, 'a'.repeat(44), 123]) assert.equal(await auth.autenticar(lixo), null);
  assert.equal(finds, 0);
  const { token } = await auth.parear({ codigo: (await auth.novoCodigo()).codigo, ip: '1.2.3.4' });
  for (let i = 0; i < 50; i++) assert.ok(await auth.autenticar(token));
  assert.equal(finds, 1, 'uma consulta para 50 pedidos');
  assert.equal(await auth.autenticar('b'.repeat(43)), null); // formato certo, token errado: usa o cache
  assert.equal(finds, 1);
  r.andar(1.1);
  await auth.autenticar(token);
  assert.equal(finds, 2, 'renova depois de 60 s');
  // pareamento novo entra na hora (cache invalidado)
  const outro = await auth.parear({ codigo: (await auth.novoCodigo()).codigo, ip: '1.2.3.4' });
  assert.ok(await auth.autenticar(outro.token));
  // revogação vale na hora
  await auth.revogarTodos();
  assert.equal(await auth.autenticar(token), null);
  assert.equal(await auth.autenticar(outro.token), null);
});

test('I2 limite de pedidos sem token válido por IP', async () => {
  const r = relogio();
  const auth = criarAuth({ colecao: banco().colecao, agora: r.agora });
  for (let i = 0; i < MAX_SEM_TOKEN; i++) {
    assert.equal(auth.semTokenBloqueado('7.7.7.7'), false);
    auth.registrarSemToken('7.7.7.7');
  }
  assert.equal(auth.semTokenBloqueado('7.7.7.7'), true);
  assert.equal(auth.semTokenBloqueado('7.7.7.8'), false);
  r.andar(JANELA_SEM_TOKEN_MIN + 1);
  assert.equal(auth.semTokenBloqueado('7.7.7.7'), false);
});

test('M6 aparelho parado há mais de 90 dias deixa de valer', async () => {
  const r = relogio();
  const auth = criarAuth({ colecao: banco().colecao, agora: r.agora });
  const { token } = await auth.parear({ codigo: (await auth.novoCodigo()).codigo, ip: '1.1.1.1' });
  r.andar(89 * 1440);
  assert.ok(await auth.autenticar(token));
  await new Promise((ok) => setImmediate(ok));
  r.andar(91 * 1440);
  assert.equal(await auth.autenticar(token), null);
});

test('!app gera código; !app sair revoga; outra coisa explica o uso', async () => {
  const b = banco();
  const auth = criarAuth({ colecao: b.colecao, agora: relogio().agora });
  const t1 = await comandoApp('!app', auth);
  const [, tres, outros] = t1.match(/\*(\d{3}) (\d{3})\*/);
  assert.match(t1, /10 minutos/);
  // o que o WhatsApp mostra (protegerNumeros não pega "123 456") e o que alguém cola com separador invisível: os dois valem
  const { protegerNumeros } = await import('../util.js');
  assert.equal(protegerNumeros(t1), t1);
  await auth.parear({ codigo: `${tres}${String.fromCodePoint(0x2060)} ${outros}${String.fromCodePoint(0xfeff)}`, ip: '5.5.5.5' });
  const t2 = await comandoApp('!APP sair', auth);
  assert.match(t2, /1 aparelho/);
  assert.equal(b.cols.dispositivos.docs[0].revogadoEm instanceof Date, true);
  assert.match(await comandoApp('!app banana', auth), /!app sair/);
});

test('ipDe: o último endereço do X-Forwarded-For (o que o proxy viu), senão o do socket', () => {
  assert.equal(ipDe({ headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, socket: { remoteAddress: '::1' } }), '7.7.7.7');
  assert.equal(ipDe({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
  assert.equal(ipDe({}), '?');
});

test('I1 ipDe com saltos de proxy (API_PROXY_SALTOS): 2 saltos = o penúltimo; mais saltos que endereços = o primeiro', () => {
  const req = { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }, socket: { remoteAddress: '::1' } };
  assert.equal(ipDe(req, 1), '3.3.3.3');
  assert.equal(ipDe(req, 2), '2.2.2.2');
  assert.equal(ipDe(req, 9), '1.1.1.1');
  assert.equal(saltosDoProxy(undefined), 1);
  assert.equal(saltosDoProxy('2'), 2);
  assert.equal(saltosDoProxy('0'), 1);
  assert.equal(saltosDoProxy('abc'), 1);
  assert.equal(saltosDoProxy('99'), 5);
});

test('I1 diagnóstico do X-Forwarded-For: uma vez só, com a quantidade de endereços e nunca os IPs', () => {
  const linhas = [];
  const diag = criarDiagnosticoXff((t) => linhas.push(t));
  diag({ headers: { 'x-forwarded-for': '203.0.113.7, 198.51.100.2' } });
  diag({ headers: { 'x-forwarded-for': '203.0.113.8' } });
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /2 endereço/);
  assert.doesNotMatch(linhas[0], /203\.0|198\.51/);
});
