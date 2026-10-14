// Escrita da API v1 (fase 2): validações puras, ajuste por gramas, bloco PELO APP, a análise pelo app (gerar injetado) e as
// rotas num Express de verdade com banco e IA de mentira: registrar/ajustar/apagar refeição, humor, eventos, pesagem, perfil.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const E = await import('../api-escrita.js');
const { criarApi } = await import('../api.js');
const { criarAuth } = await import('../api-auth.js');
const { estimarRefeicaoApp } = await import('../gemini.js');

const HOJE = '2030-03-29';

// ============================================================
// Puras
// ============================================================
test('validarRefeicaoNova: texto ou foto; dia e hora padrão; limites', () => {
  const ctx = { hoje: HOJE, horaAgora: '12:40' };
  const v = E.validarRefeicaoNova({ texto: '  arroz,   feijão ' }, ctx);
  assert.deepEqual([v.texto, v.fotos, v.miniatura, v.slot, v.horaLocal, v.dia], ['arroz, feijão', [], null, null, '12:40', HOJE]);
  // dia anterior sem hora: a hora padrão do slot (ou 12:00 sem slot)
  assert.equal(E.validarRefeicaoNova({ texto: 'x', dia: '2030-03-28', slot: 'jantar' }, ctx).horaLocal, '20:00');
  assert.equal(E.validarRefeicaoNova({ texto: 'x', dia: '2030-03-28' }, ctx).horaLocal, '12:00');
  const foto = { mime: 'image/jpeg', base64: Buffer.alloc(200, 1).toString('base64') };
  const f = E.validarRefeicaoNova({ fotos: [foto], miniatura: 'data:image/jpeg;base64,QUJD', hora: '08:05', slot: 'cafe' }, ctx);
  assert.equal(f.fotos[0].data.length, 200);
  assert.deepEqual([f.miniatura, f.horaLocal, f.slot, f.texto], ['QUJD', '08:05', 'cafe', null]);
  const erro = (corpo, codigo = 'pedido_invalido') => assert.throws(() => E.validarRefeicaoNova(corpo, ctx), (e) => e.status === 400 && e.codigo === codigo);
  erro({});
  erro({ texto: 'x', slot: 'brunch' });
  erro({ texto: 'x', hora: '25:00' });
  erro({ texto: 'x', dia: '2030-03-30' }, 'dia_invalido'); // futuro
  erro({ texto: 'x', dia: '2030-02-01' }, 'dia_invalido'); // mais de 31 dias
  erro({ fotos: [foto, foto, foto] });
  erro({ fotos: [{ mime: 'image/gif', base64: foto.base64 }] });
  erro({ fotos: [{ mime: 'image/jpeg', base64: Buffer.alloc(E.MAX_FOTO_BYTES + 1).toString('base64') }] });
  erro({ texto: 'x', miniatura: 'A'.repeat(E.MAX_MINIATURA_CHARS + 1) });
});

test('normalizarItens: os itens passam a somar exatamente a estimativa; sem kcal ficam como vieram', () => {
  const itens = E.normalizarItens(
    [{ nome: 'arroz', gramas: 100, kcal: 100, proteina_g: 2, carboidratos_g: 25, gorduras_g: 0 }, { nome: 'frango', gramas: 100, kcal: 100, proteina_g: 30, carboidratos_g: 0, gorduras_g: 4 }, { nome: 'sal', gramas: null, kcal: null }],
    { kcal: 400, p: 48, c: 50, g: 8 }
  );
  // kcal 200 -> 400 (×2), proteína 32 -> 48 (×1,5), carbo 25 -> 50 (×2), gordura 4 -> 8 (×2)
  assert.deepEqual(itens.map((i) => [i.nome, i.gramas, i.kcal, i.p, i.c, i.g]), [['arroz', 100, 200, 3, 50, 0], ['frango', 100, 200, 45, 0, 8], ['sal', null, null, null, null, null]]);
  assert.equal(itens[0].kcal + itens[1].kcal, 400);
});

test('aplicarGramas: escala cada item pela proporção e soma; casa pelo nome sem acento; null sem itens com gramas e kcal', () => {
  const reg = { itens: [{ nome: 'Arroz', gramas: 100, kcal: 130, p: 2.5, c: 28, g: 0.2 }, { nome: 'Frango grelhado', gramas: 120, kcal: 200, p: 36, c: 0, g: 5 }, { nome: 'sal', gramas: null, kcal: null, p: null, c: null, g: null }] };
  const r = E.aplicarGramas(reg, [{ nome: 'arroz', gramas: 200 }, { nome: 'FRANGO GRELHADO', gramas: 60 }]);
  assert.deepEqual(r.itens.map((i) => [i.nome, i.gramas, i.kcal]), [['Arroz', 200, 260], ['Frango grelhado', 60, 100], ['sal', null, null]]);
  assert.deepEqual(r.estimativa, { kcal: 360, p: 23, c: 56, g: 3 });
  // gramas 0 zera o item (tirou do prato); o item que não veio no pedido fica igual; a densidade guardada deixa voltar
  const z = E.aplicarGramas(reg, [{ nome: 'arroz', gramas: 0 }]);
  assert.deepEqual([z.itens[0].kcal, z.itens[0].gramas, z.itens[0].kcal100, z.itens[1].kcal, z.estimativa.kcal], [0, 0, 130, 200, 200]);
  const volta = E.aplicarGramas({ itens: z.itens }, [{ nome: 'arroz', gramas: 100 }]);
  assert.deepEqual([volta.itens[0].kcal, volta.itens[0].p, volta.estimativa.kcal], [130, 2.5, 330]);
  // nome repetido casa pela posição
  const dup = E.aplicarGramas({ itens: [{ nome: 'ovo', gramas: 50, kcal: 75 }, { nome: 'ovo', gramas: 50, kcal: 75 }] }, [{ nome: 'ovo', gramas: 50 }, { nome: 'ovo', gramas: 100 }]);
  assert.deepEqual(dup.itens.map((i) => i.kcal), [75, 150]);
  assert.equal(E.aplicarGramas({ itens: [{ nome: 'x', gramas: null, kcal: null }] }, [{ nome: 'x', gramas: 10 }]), null);
  assert.equal(E.aplicarGramas({ descricao: 'sem itens' }, []), null);
});

test('normalizarItens: o resto do arredondamento vai pro maior item e a soma fecha; densidade por 100 g guardada', () => {
  const itens = E.normalizarItens([{ nome: 'a', gramas: 30, kcal: 100 }, { nome: 'b', gramas: 30, kcal: 100 }, { nome: 'c', gramas: 30, kcal: 100 }], { kcal: 611, p: 0, c: 0, g: 0 });
  assert.equal(itens.reduce((s, i) => s + i.kcal, 0), 611);
  assert.ok(itens.every((i) => i.kcal100 > 0));
  // itens já normalizados com o mesmo total: nada muda (idempotente)
  const de_novo = E.normalizarItens(itens, { kcal: 611 });
  assert.deepEqual(de_novo.map((i) => i.kcal), itens.map((i) => i.kcal));
});

test('validarAjuste, validarHumor, validarEvento, validarPesagem, validarPerfil', () => {
  assert.deepEqual(E.validarAjuste({ kcal: '650,0', descricao: ' sopa ', slot: 'jantar', hora: '19:30', itens: [{ nome: 'sopa', gramas: 300 }] }), { kcal: 650, descricao: 'sopa', slot: 'jantar', horaLocal: '19:30', itens: [{ nome: 'sopa', gramas: 300 }] });
  assert.throws(() => E.validarAjuste({}), /nada para ajustar/);
  assert.throws(() => E.validarAjuste({ kcal: 9000 }), /kcal fora da faixa/);
  assert.throws(() => E.validarAjuste({ itens: [{ nome: 'x', gramas: -1 }] }), /gramas/);

  assert.deepEqual(E.validarHumor({ humor: 4, energia: '3', texto: 'ok' }, { hoje: HOJE }), { dia: HOJE, humor: 4, energia: 3, sono: null, texto: 'ok' });
  assert.throws(() => E.validarHumor({ humor: 6 }, { hoje: HOJE }), /humor de 1 a 5/);
  assert.throws(() => E.validarHumor({ humor: 3, sono: 2.5 }, { hoje: HOJE }), /sono de 1 a 5/);
  assert.throws(() => E.validarHumor({}, { hoje: HOJE }), /humor de 1 a 5/);

  assert.deepEqual(E.validarEvento({ dia: '2030-04-10', titulo: 'Churrasco', tipo: 'festa', hora: '13:00' }, { hoje: HOJE }), { dia: '2030-04-10', hora: '13:00', titulo: 'Churrasco', tipo: 'festa', nota: null });
  assert.equal(E.validarEvento({ dia: HOJE, titulo: 'x' }, { hoje: HOJE }).tipo, 'outro');
  assert.throws(() => E.validarEvento({ dia: '2030-06-01', titulo: 'x' }, { hoje: HOJE }), (e) => e.codigo === 'dia_invalido'); // > 60 dias
  assert.throws(() => E.validarEvento({ titulo: 'x' }, { hoje: HOJE }), (e) => e.codigo === 'dia_invalido');
  assert.throws(() => E.validarEvento({ dia: HOJE, titulo: 'x', tipo: 'balada' }, { hoje: HOJE }), /tipo/);

  assert.deepEqual(E.validarPesagem({ peso: '82,35', gordura: 18.44 }, { hoje: HOJE }), { dia: HOJE, peso: 82.35, gordura: 18.4, hora: null });
  assert.throws(() => E.validarPesagem({ peso: 20 }, { hoje: HOJE }), /peso entre/);
  assert.throws(() => E.validarPesagem({ peso: 80, gordura: 80 }, { hoje: HOJE }), /gordura/);

  assert.deepEqual(E.validarPerfil({ objetivo: 'ganhar massa', metaPeso: 85, metaPrazo: '2030-12-01', altura: 180, ritmo: 'medio' }), { objetivo: 'ganhar massa', meta_peso_kg: 85, meta_prazo: '2030-12-01', altura_cm: 180, ritmo: 'medio' });
  assert.deepEqual(E.validarPerfil({ metaPeso: null }), { sem_meta_peso: true });
  assert.deepEqual(E.validarPerfil({ metaPrazo: null }), { sem_meta_prazo: true });
  assert.throws(() => E.validarPerfil({}), /nada para alterar/);
  assert.throws(() => E.validarPerfil({ metaPrazo: '2030-13-01' }), /prazo/);
});

test('horaDoGrupo: hora local da pessoa em outro fuso vira a hora do grupo (São Paulo)', () => {
  assert.equal(E.horaDoGrupo({ fuso: 'Europe/Sofia' }, '2030-03-29', '00:30'), '19:30'); // Sofia +2 (o horário de verão só começa em 31/03), SP −3: 22:30 UTC
  assert.equal(E.horaDoGrupo({ fuso: 'Europe/Sofia' }, '2030-04-02', '00:30'), '18:30'); // Sofia +3 no horário de verão
  assert.equal(E.horaDoGrupo({ fuso: 'America/Sao_Paulo' }, '2030-03-29', '12:00'), '12:00');
  assert.equal(E.horaDoGrupo({}, '2030-03-29', '12:00'), '12:00');
});

test('blocoApp: humor de hoje e eventos até 3 dias, em linhas; vazio sem nada', () => {
  assert.equal(E.blocoApp({ hoje: HOJE }), '');
  const b = E.blocoApp({ hoje: HOJE, humor: { humor: 2, energia: 3, texto: 'noite ruim' }, eventos: [{ dia: '2030-03-28', titulo: 'passado', tipo: 'outro' }, { dia: HOJE, hora: '20:00', titulo: 'Jantar na sogra', tipo: 'comer_fora' }, { dia: '2030-03-30', titulo: 'Viagem a trabalho', tipo: 'viagem', nota: 'volta sexta' }] });
  assert.equal(b, '- Hoje, pelo app: humor ruim/5, energia 3/5 — ela(e) contou, EM CONFIDÊNCIA (leve em conta; não cite nem parafraseie no grupo): "noite ruim"\n- hoje 20:00: Jantar na sogra (comer fora)\n- amanhã: Viagem a trabalho (viagem) — volta sexta');
});

test('criarLimiteAnalises: janela de 1 h', () => {
  let t = 0;
  const pode = E.criarLimiteAnalises({ max: 2, agora: () => t });
  assert.deepEqual([pode(), pode(), pode()], [true, true, false]);
  t = 3600_001;
  assert.equal(pode(), true);
});

// ============================================================
// Análise pelo app (gerar injetado)
// ============================================================
test('estimarRefeicaoApp: monta o pedido (texto e fotos), lê o JSON e devolve itens; não-refeição vira estimativa null', async () => {
  const pedidos = [];
  const gerarFalso = (resposta) => async (p) => (pedidos.push(p), JSON.stringify(resposta));
  const ok = await estimarRefeicaoApp({
    descricao: '2 ovos e pão',
    fotos: [{ mimeType: 'image/jpeg', data: Buffer.from('foto') }],
    perfil: { nome: 'Pessoa', peso: 80, objetivo: 'ganhar' },
    horaLocal: '08:00',
    _gerar: gerarFalso({ eh_refeicao: true, tipo: 'cafe', descricao: 'ovos, pão', incerteza: 'baixa', itens: [{ nome: 'ovo', gramas: 100, kcal: 150, proteina_g: 12, carboidratos_g: 1, gorduras_g: 10 }, { nome: 'pão', gramas: 50, kcal: 135, proteina_g: 4, carboidratos_g: 28, gorduras_g: 1 }], kcal: 285, proteina_g: 16, carboidratos_g: 29, gorduras_g: 11 }),
  });
  assert.deepEqual(ok.estimativa, { kcal: 285, p: 16, c: 29, g: 11 });
  assert.deepEqual([ok.tipo, ok.incerteza, ok.descricao, ok.motivo], ['cafe', 'baixa', 'ovos, pão', null]);
  assert.deepEqual(ok.itens.map((i) => [i.nome, i.gramas, i.kcal, i.p]), [['ovo', 100, 150, 12], ['pão', 50, 135, 4]]);
  const parts = pedidos[0].contents[0].parts;
  assert.equal(parts.length, 2);
  assert.match(parts[0].text, /2 ovos e pão/);
  assert.match(parts[0].text, /FOTO anexada/);
  assert.equal(parts[1].inlineData.data, Buffer.from('foto').toString('base64'));
  assert.equal(pedidos[0].config.leve, false); // com foto: modelo principal
  assert.equal(pedidos[0].config.responseMimeType, 'application/json');

  const nao = await estimarRefeicaoApp({ descricao: 'receita de bolo', perfil: {}, _gerar: gerarFalso({ eh_refeicao: false, motivo: 'isso é uma receita', descricao: '', incerteza: 'alta', itens: [], kcal: 0, proteina_g: 0, carboidratos_g: 0, gorduras_g: 0 }) });
  assert.equal(nao.estimativa, null);
  assert.equal(nao.motivo, 'isso é uma receita');
  assert.equal(pedidos[1].config.leve, true); // só texto: modelo leve

  // totais zerados com itens: soma dos itens
  const soma = await estimarRefeicaoApp({ descricao: 'x', perfil: {}, _gerar: gerarFalso({ eh_refeicao: true, descricao: 'x', incerteza: 'media', itens: [{ nome: 'a', gramas: 10, kcal: 40, proteina_g: 1, carboidratos_g: 2, gorduras_g: 3 }], kcal: 0, proteina_g: 0, carboidratos_g: 0, gorduras_g: 0 }) });
  assert.deepEqual(soma.estimativa, { kcal: 40, p: 1, c: 2, g: 3 });
  await assert.rejects(estimarRefeicaoApp({ descricao: 'x', perfil: {}, _gerar: async () => 'não é json' }), /sem JSON/);
});

// ============================================================
// Rotas (Express de verdade; banco, busca e IA de mentira)
// ============================================================
function colecaoFalsa() {
  const docs = [];
  let seq = 0;
  const casa = (d, f) => Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && !(v instanceof Date) && '$gt' in v ? d[k] != null && d[k] > v.$gt : (d[k] ?? null) === (v ?? null)));
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

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const JID = 'a@s.whatsapp.net';
const perfis = [
  { _id: ID, nome: 'Pessoa A', jids: [JID], fuso: 'America/Sao_Paulo', objetivo: 'manter', peso: 70, lugares: [{ bairro: 'Bairro Secreto' }] },
  { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', nome: 'Pessoa B', jids: ['b@s.whatsapp.net'], fuso: 'Europe/Sofia', objetivo: 'emagrecer', peso: 80 },
];
// banco de mentira da escrita
const refeicoes = [{ _id: 'r1', jid: JID, nome: 'Pessoa A', dia: HOJE, slot: 'cafe', hora: '08:00', horaLocal: '08:00', minutos: 480, resumo: 'x', descricao: 'pão com ovo', estimativa: { kcal: 300, p: 15, c: 30, g: 12 }, itens: [{ nome: 'pão', gramas: 50, kcal: 135, p: 4, c: 28, g: 1 }, { nome: 'ovo', gramas: 100, kcal: 165, p: 11, c: 2, g: 11 }] }, { _id: 'rb', jid: 'b@s.whatsapp.net', nome: 'Pessoa B', dia: HOJE, slot: 'almoco', estimativa: { kcal: 500 } }];
const humores = [];
const eventos = [];
const pesagens = [];
const correcoes = [];
const correcoesEst = [];
const lembradas = [];
let perfilSalvo = null;
let seq = 0;
const miniaturas = new Map();
const escrita = {
  registrarRefeicao: async (r) => (refeicoes.push({ _id: `novo${++seq}`, ...r }), `novo${seq}`),
  refeicaoPorId: async (id) => {
    const r = refeicoes.find((x) => String(x._id) === String(id));
    return r ? (miniaturas.has(r._id) ? { ...r, miniatura: miniaturas.get(r._id) } : r) : null;
  },
  salvarMiniatura: async (id, b64) => miniaturas.set(id, b64),
  apagarMiniatura: async (id) => miniaturas.delete(id),
  atualizarRefeicao: async (id, set) => Object.assign(refeicoes.find((r) => r._id === id), set),
  apagarRefeicaoPorId: async (id) => refeicoes.splice(refeicoes.findIndex((r) => r._id === id), 1).length,
  registrarCorrecao: async (c) => correcoes.push(c),
  registrarCorrecaoEstimativa: async (c) => correcoesEst.push(c),
  salvarHumor: async (h) => {
    const i = humores.findIndex((x) => x.jid === h.jid && x.dia === h.dia);
    const doc = { ...h, atualizadoEm: AGORA };
    if (i >= 0) humores[i] = doc;
    else humores.push(doc);
    return doc;
  },
  inserirEvento: async (e) => {
    const doc = { _id: `ev${++seq}`, ...e };
    eventos.push(doc);
    return doc;
  },
  eventosDe: async (jids, de, ate) => eventos.filter((e) => jids.includes(e.jid) && e.dia >= de && e.dia <= ate),
  apagarEvento: async (id, jids) => {
    const i = eventos.findIndex((e) => e._id === id && jids.includes(e.jid));
    if (i < 0) return 0;
    eventos.splice(i, 1);
    return 1;
  },
  registrarPesagem: async (p) => pesagens.push(p),
  aplicarAtualizacao: (perfil, a, dia) => {
    const novo = { jids: perfil.jids, atualizacoes: {} };
    if (a.objetivo) (novo.objetivo = a.objetivo), (novo.atualizacoes.objetivo = dia);
    if (a.meta_peso_kg) novo.metaPeso = a.meta_peso_kg;
    if (a.sem_meta_peso) novo.metaPeso = null;
    return Object.keys(novo).length > 2 ? novo : null;
  },
  // como o Mongo: o patch entra no perfil, e o próximo pedido já lê o perfil novo
  salvarPerfil: async (p) => {
    perfilSalvo = p;
    const alvo = perfis.find((x) => x.jids.includes(p.jids[0]));
    if (alvo) Object.assign(alvo, p);
  },
  lembrar: async (m) => lembradas.push(m),
  // fase 3
  guardarHipoteseFechada: async (h) => hipotesesGuardadas.push(h),
  salvarNotas: async (perfil, texto, dia) => notasSalvas.push([perfil.nome, texto, dia]),
  // como o de verdade: a promessa só resolve quando o "Drive" (liberarDrive) terminar; a resposta ao app não espera isso
  guardarFoto: (x) =>
    new Promise((ok) => {
      liberarDrive = () => {
        fotosGuardadas.push(x);
        Object.assign(refeicoes.find((r) => r._id === x.registroId), { foto: { driveId: 'drv-1', nome: E.nomeDaFoto({ ...x.registro, mimeType: x.foto.mimeType, id: x.registroId }).nome } });
        ok({ driveId: 'drv-1' });
      };
    }),
  lixeiraDrive: async (id) => lixeira.push(id),
};
let liberarDrive = null;
const hipotesesGuardadas = [];
const notasSalvas = [];
const fotosGuardadas = [];
const lixeira = [];
const pesagensEntreLista = [];
const dados = {
  listarPerfis: async () => perfis,
  doDia: async (perfil, dia) => ({ refeicoes: refeicoes.filter((r) => perfil.jids.includes(r.jid) && r.dia === dia), pesagens: [], saude: null, treinos: [], humor: humores.find((h) => h.jid === perfil.jids[0] && h.dia === dia) || null, eventos: eventos.filter((e) => e.jid === perfil.jids[0] && e.dia === dia) }),
  refeicoesEntre: async (perfil, de, ate) => refeicoes.filter((r) => perfil.jids.includes(r.jid) && r.dia >= de && r.dia <= ate),
  eventosEntre: async (perfil, de, ate) => eventos.filter((e) => perfil.jids.includes(e.jid) && e.dia >= de && e.dia <= ate),
  de31: async () => ({ refeicoes: [], pesagens: [] }),
  pesagensEntre: async (perfil, de, ate) => pesagensEntreLista.filter((p) => p.dia >= de && p.dia <= ate),
  catalogoHevy: async () => ({}),
  daNutri: async () => ({ hipotesesFechadas: [], reflexoes: [], pensamentos: [], diario: [] }),
  integracoes: async () => ({ porPerfil: new Map(), whatsapp: { estado: 'conectado' }, driveConfigurado: true }),
};
let respostaIa = null;
const ia = { estimarRefeicaoApp: async (p) => (typeof respostaIa === 'function' ? respostaIa(p) : respostaIa) };

let base;
let servidor;
let token;
before(async () => {
  const app = express();
  app.use('/api/v1', criarApi({ auth, dados, escrita, ia, agora: () => AGORA, adminJid: JID, temHevyDe: () => false, ehDonoDaAgendaDe: () => false }));
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const { codigo } = await auth.novoCodigo();
  const r = await fetch(`${base}/api/v1/parear`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo, aparelho: 'teste' }) });
  token = (await r.json()).token;
});
after(() => servidor?.close());
const pedir = async (metodo, caminho, corpo) => {
  const r = await fetch(`${base}/api/v1${caminho}`, { method: metodo, headers: { authorization: `Bearer ${token}`, ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, json: await r.json() };
};

test('POST /refeicoes: analisa, grava como o !refeicao (sempre nova, origem app, itens normalizados), lembra na memória e devolve refeição + hoje', async () => {
  respostaIa = { estimativa: { kcal: 400, p: 30, c: 40, g: 10 }, descricao: 'arroz, frango', tipo: 'almoco', incerteza: 'media', itens: [{ nome: 'arroz', gramas: 150, kcal: 100, p: 2, c: 22, g: 0 }, { nome: 'frango', gramas: 120, kcal: 100, p: 20, c: 0, g: 3 }], motivo: null };
  const { status, json } = await pedir('POST', `/perfis/${ID}/refeicoes`, { texto: 'arroz com frango no Bairro Secreto', hora: '12:30', miniatura: 'QUJD' });
  assert.equal(status, 201);
  assert.deepEqual([json.refeicao.slot, json.refeicao.kcal, json.refeicao.origem, json.refeicao.hora, json.refeicao.incerteza, json.refeicao.miniatura], ['almoco', 400, 'app', '12:30', 'media', 'data:image/jpeg;base64,QUJD']);
  // itens escalados pra somar a estimativa (100 + 100 -> 400)
  assert.deepEqual(json.refeicao.itens.map((i) => [i.nome, i.gramas, i.kcal]), [['arroz', 150, 200], ['frango', 120, 200]]);
  const gravada = refeicoes.find((r) => r._id === json.refeicao.id);
  assert.deepEqual([gravada.sempreNova, gravada.manual, gravada.origem, gravada.jid, gravada.dia, gravada.minutos, gravada.hora], [true, true, 'app', JID, HOJE, 750, '12:30']);
  assert.equal(gravada.miniatura, undefined, 'a miniatura não vai no registro'); // fica na coleção própria
  assert.equal(miniaturas.get(gravada._id), 'QUJD');
  assert.equal(gravada.itens.reduce((s, i) => s + i.kcal, 0), 400);
  assert.match(gravada.resumo, /^\(app\) arroz com frango/);
  assert.equal(lembradas.at(-1).refeicao, 'almoco');
  assert.match(lembradas.at(-1).texto, /registro pelo app/);
  // o hoje volta recalculado com a refeição nova (300 do café + 400)
  assert.equal(json.hoje.kcal.consumido, 700);
  assert.equal(json.hoje.refeicoes.length, 2);
  // a localização não sai na descrição devolvida (a da IA aqui não a tem, mas o resumo gravado tem: não é exposto)
  assert.ok(!JSON.stringify(json).includes('Bairro Secreto'));
});

test('POST /refeicoes: 422 quando não é refeição (nada gravado), 503 quando a IA falha, 400 sem texto nem foto, 429 no limite', async () => {
  const antes = refeicoes.length;
  respostaIa = { estimativa: null, motivo: 'isso é uma receita, não um prato' };
  let r = await pedir('POST', `/perfis/${ID}/refeicoes`, { texto: 'receita de bolo' });
  assert.equal(r.status, 422);
  assert.deepEqual(r.json.erro, { codigo: 'nao_e_refeicao', mensagem: 'isso é uma receita, não um prato' });
  respostaIa = () => Promise.reject(new Error('gemini fora'));
  r = await pedir('POST', `/perfis/${ID}/refeicoes`, { texto: 'x' });
  assert.equal(r.status, 503);
  assert.equal(r.json.erro.codigo, 'ia_indisponivel');
  r = await pedir('POST', `/perfis/${ID}/refeicoes`, {});
  assert.equal(r.status, 400);
  assert.equal(refeicoes.length, antes);
  // foto maior que o limite pequeno do JSON passa pelo leitor de 6 MB desta rota (e é recusada pela validação, não pelo 413)
  r = await pedir('POST', `/perfis/${ID}/refeicoes`, { fotos: [{ mime: 'image/jpeg', base64: Buffer.alloc(100_000, 1).toString('base64') }], texto: 'x' });
  assert.notEqual(r.status, 400, 'não deve cair no corpo_grande');
  // ...e a mesma carga numa rota comum cai no limite de 32 kb
  r = await pedir('PUT', `/perfis/${ID}/humor`, { humor: 3, texto: 'x'.repeat(40_000) });
  assert.equal(r.status, 400);
  assert.equal(r.json.erro.codigo, 'corpo_grande');
});

test('PUT /refeicoes/:rid: ajuste por gramas recalcula e registra a correção; kcal explícita vence; 404 em refeição de outra pessoa', async () => {
  let r = await pedir('PUT', `/perfis/${ID}/refeicoes/r1`, { itens: [{ nome: 'pão', gramas: 100 }], slot: 'lanche_manha' });
  assert.equal(r.status, 200);
  assert.equal(r.json.refeicao.kcal, 435); // pão 135 -> 270, ovo 165
  assert.equal(r.json.refeicao.slot, 'lanche_manha');
  assert.deepEqual(r.json.refeicao.itens.map((i) => [i.nome, i.gramas, i.kcal]), [['pão', 100, 270], ['ovo', 100, 165]]);
  assert.equal(correcoesEst.at(-1).origem, 'app');
  assert.deepEqual([correcoesEst.at(-1).antes.kcal, correcoesEst.at(-1).depois.kcal], [300, 435]);
  assert.match(correcoes.at(-1).texto, /ajustou pelo app.*kcal 300 -> 435/);
  assert.equal(r.json.hoje.kcal.consumido, 435 + 400);

  // as mesmas gramas de novo: nada muda e NENHUMA correção é registrada (idempotente)
  const nEst = correcoesEst.length;
  const nCor = correcoes.length;
  r = await pedir('PUT', `/perfis/${ID}/refeicoes/r1`, { itens: [{ nome: 'pão', gramas: 100 }, { nome: 'ovo', gramas: 100 }] });
  assert.equal(r.json.refeicao.kcal, 435);
  assert.deepEqual([correcoesEst.length, correcoes.length], [nEst, nCor]);

  // o total mudou por fora (fusão de uma sobremesa pelo WhatsApp: 435 -> 635 sem mexer nos itens): o ajuste por gramas parte
  // dos itens reescalados pro total atual, não do total antigo
  refeicoes.find((x) => x._id === 'r1').estimativa = { kcal: 635, p: 20, c: 60, g: 20 };
  r = await pedir('PUT', `/perfis/${ID}/refeicoes/r1`, { itens: [{ nome: 'pão', gramas: 100 }, { nome: 'ovo', gramas: 100 }] });
  assert.equal(r.json.refeicao.kcal, 635);

  r = await pedir('PUT', `/perfis/${ID}/refeicoes/r1`, { itens: [{ nome: 'pão', gramas: 50 }], kcal: 999, hora: '07:45' });
  assert.equal(r.json.refeicao.kcal, 999);
  assert.equal(r.json.refeicao.hora, '07:45');
  assert.equal(refeicoes.find((x) => x._id === 'r1').minutos, 465);
  // kcal digitada reescalou os itens: a soma deles é 999, e o próximo ajuste por gramas parte daí
  assert.equal(refeicoes.find((x) => x._id === 'r1').itens.reduce((s, i) => s + i.kcal, 0), 999);
  // teto: gramas que estouram 8000 kcal
  r = await pedir('PUT', `/perfis/${ID}/refeicoes/r1`, { itens: [{ nome: 'pão', gramas: 5000 }, { nome: 'ovo', gramas: 5000 }] });
  assert.equal(r.status, 400);

  // hora num perfil de outro fuso: minutos locais e hora do grupo
  refeicoes.push({ _id: 'rb2', jid: 'b@s.whatsapp.net', nome: 'Pessoa B', dia: HOJE, slot: 'jantar', horaLocal: '20:00', minutos: 1200, hora: '14:00', estimativa: { kcal: 500 } });
  const bId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  r = await pedir('PUT', `/perfis/${bId}/refeicoes/rb2`, { hora: '21:30' });
  assert.equal(r.status, 200);
  const rb2 = refeicoes.find((x) => x._id === 'rb2');
  assert.deepEqual([rb2.minutos, rb2.horaLocal, rb2.hora], [1290, '21:30', '16:30']); // Sofia +2 em março → 19:30 UTC → 16:30 em SP

  // corpo que não é objeto e id fora do formato
  r = await pedir('PUT', `/perfis/${ID}/refeicoes/r1`, []);
  assert.equal(r.status, 400);
  r = await pedir('PUT', `/perfis/${ID}/refeicoes/abc`, { kcal: 1 });
  assert.equal(r.status, 404);

  r = await pedir('PUT', `/perfis/${ID}/refeicoes/rb`, { kcal: 1 });
  assert.equal(r.status, 404);
  assert.equal(r.json.erro.codigo, 'refeicao_nao_encontrada');
  assert.equal(refeicoes.find((x) => x._id === 'rb').estimativa.kcal, 500);
  r = await pedir('PUT', `/perfis/${ID}/refeicoes/r1`, {});
  assert.equal(r.status, 400);
});

test('DELETE /refeicoes/:rid: apaga só a própria, anota a correção e devolve o hoje', async () => {
  let r = await pedir('DELETE', `/perfis/${ID}/refeicoes/rb`);
  assert.equal(r.status, 404);
  r = await pedir('DELETE', `/perfis/${ID}/refeicoes/r1`);
  assert.equal(r.status, 200);
  assert.equal(r.json.apagada, true);
  assert.ok(!refeicoes.some((x) => x._id === 'r1'));
  assert.match(correcoes.at(-1).texto, /apagou pelo app/);
  assert.equal(r.json.hoje.kcal.consumido, 400);
});

test('PUT /humor: grava um por dia e aparece no hoje', async () => {
  let r = await pedir('PUT', `/perfis/${ID}/humor`, { humor: 4, energia: 2 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.humor, { humor: 4, energia: 2, sono: null, texto: null, atualizadoEm: AGORA.toISOString() });
  assert.deepEqual(r.json.hoje.humor.humor, 4);
  r = await pedir('PUT', `/perfis/${ID}/humor`, { humor: 5, sono: 3, texto: 'dormi bem' });
  assert.equal(humores.filter((h) => h.jid === JID).length, 1);
  assert.deepEqual([r.json.humor.humor, r.json.humor.sono, r.json.humor.texto], [5, 3, 'dormi bem']);
  r = await pedir('PUT', `/perfis/${ID}/humor`, { humor: 0 });
  assert.equal(r.status, 400);
});

test('eventos: cria (futuro até 60 dias), lista por intervalo, aparece no hoje e no /refeicoes, apaga só o próprio', async () => {
  let r = await pedir('POST', `/perfis/${ID}/eventos`, { dia: HOJE, hora: '20:00', titulo: 'Jantar fora', tipo: 'comer_fora' });
  assert.equal(r.status, 201);
  const id1 = r.json.evento.id;
  assert.deepEqual([r.json.evento.titulo, r.json.evento.tipo, r.json.evento.hora], ['Jantar fora', 'comer_fora', '20:00']);
  r = await pedir('POST', `/perfis/${ID}/eventos`, { dia: '2030-04-20', titulo: 'Viagem', tipo: 'viagem', nota: 'praia' });
  assert.equal(r.status, 201);
  r = await pedir('POST', `/perfis/${ID}/eventos`, { dia: '2030-07-01', titulo: 'longe' });
  assert.equal(r.status, 400);
  r = await pedir('GET', `/perfis/${ID}/eventos?de=${HOJE}&ate=2030-04-30`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.eventos.map((e) => e.titulo), ['Jantar fora', 'Viagem']);
  r = await pedir('GET', `/perfis/${ID}/eventos?de=2030-01-01&ate=2030-04-30`);
  assert.equal(r.status, 400); // mais de 62 dias / mais de 31 pra trás
  r = await pedir('GET', `/perfis/${ID}/hoje`);
  assert.deepEqual(r.json.eventos.map((e) => e.id), [id1]);
  r = await pedir('GET', `/perfis/${ID}/refeicoes?de=${HOJE}&ate=${HOJE}`);
  assert.deepEqual(r.json.dias[0].eventos.map((e) => e.id), [id1]);
  // outra pessoa não apaga
  const deB = await escrita.inserirEvento({ jid: 'b@s.whatsapp.net', dia: HOJE, titulo: 'de B', tipo: 'outro' });
  r = await pedir('DELETE', `/perfis/${ID}/eventos/${deB._id}`);
  assert.equal(r.status, 404);
  // nada de A aparece nas leituras de B
  await pedir('PUT', `/perfis/${ID}/humor`, { humor: 1, texto: 'segredo de A' });
  const bId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const hb = await pedir('GET', `/perfis/${bId}/hoje`);
  assert.equal(hb.json.humor, null);
  assert.deepEqual(hb.json.eventos.map((e) => e.titulo), ['de B']); // só o dele
  const eb = await pedir('GET', `/perfis/${bId}/eventos?de=${HOJE}&ate=2030-04-30`);
  assert.deepEqual(eb.json.eventos.filter((e) => e.titulo !== 'de B'), []);
  assert.ok(!JSON.stringify(hb.json).includes('segredo de A'));

  r = await pedir('DELETE', `/perfis/${ID}/eventos/${id1}`);
  assert.equal(r.status, 200);
  assert.ok(!eventos.some((e) => e._id === id1));
});

test('POST /pesagens: fonte app, uma por dia; PUT /perfis/:id: objetivo e meta pelo aplicarAtualizacao', async () => {
  let r = await pedir('POST', `/perfis/${ID}/pesagens`, { peso: '71,4', gordura: 18 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.pesagem, { dia: HOJE, peso: 71.4, gordura: 18, fonte: 'app', hora: null });
  assert.deepEqual([pesagens.at(-1).fonte, pesagens.at(-1).jid, pesagens.at(-1).peso], ['app', JID, 71.4]);
  r = await pedir('POST', `/perfis/${ID}/pesagens`, { peso: 10 });
  assert.equal(r.status, 400);

  r = await pedir('PUT', `/perfis/${ID}`, { objetivo: 'ganhar massa', metaPeso: 75 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.perfil.objetivo, r.json.perfil.metaPeso, r.json.perfil.ehDono], ['ganhar massa', 75, true]);
  assert.deepEqual([perfilSalvo.objetivo, perfilSalvo.metaPeso, perfilSalvo.jids], ['ganhar massa', 75, [JID]]);
  r = await pedir('PUT', `/perfis/${ID}`, {});
  assert.equal(r.status, 400);
  // sem mudança real: nada salvo, perfil devolvido como está
  perfilSalvo = null;
  r = await pedir('PUT', `/perfis/${ID}`, { altura: 180 });
  assert.equal(r.status, 200);
  assert.equal(perfilSalvo, null);
});

test('escrita sem token: 401 (e o corpo de 1 MB da foto nem é lido); rota inexistente: 404 no formato', async () => {
  const r = await fetch(`${base}/api/v1/perfis/${ID}/humor`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"humor":3}' });
  assert.equal(r.status, 401);
  const grande = await fetch(`${base}/api/v1/perfis/${ID}/refeicoes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fotos: [{ mime: 'image/jpeg', base64: 'A'.repeat(1_000_000) }] }) });
  assert.equal(grande.status, 401);
  assert.equal((await grande.json()).erro.codigo, 'sem_token');
  const x = await pedir('POST', `/perfis/${ID}/inexistente`, {});
  assert.equal(x.status, 404);
});

// ============================================================
// Fase 3: corrigir o que a Nutri sabe, pesagens por intervalo, foto no Drive
// ============================================================
test('aplicarCorrecaoFato (pura): edita e apaga texto livre, apaga produto/anotação pelo hash e gírias; nega o que se edita no Perfil', async () => {
  const { hashCurto } = await import('../api-montadores.js');
  const perfil = { nome: 'Pessoa A', jids: [JID], objetivo: 'manter', dieta: 'onívora', rotina: 'Acorda cedo.', girias: ['bah'], produtos: [{ nome: 'whey x', kcal: 120 }, { nome: 'aveia', kcal: 380 }], anotacoes: [{ dia: '2030-03-01', texto: 'Prefere arroz integral' }], atualizacoes: { objetivo: '2030-01-01' } };
  const e = E.aplicarCorrecaoFato(perfil, 'dieta', 'Vegetariana', HOJE);
  assert.deepEqual(e.patch, { jids: [JID], atualizacoes: { objetivo: '2030-01-01', dieta: HOJE }, dieta: 'vegetariana' });
  assert.match(e.correcao, /corrigiu pelo app dieta: "vegetariana"/);
  // mesmo texto: nada a gravar
  assert.deepEqual(E.aplicarCorrecaoFato(perfil, 'rotina', 'Acorda cedo.', HOJE), { patch: null, correcao: null });
  const a = E.aplicarCorrecaoFato(perfil, 'rotina', null, HOJE);
  assert.deepEqual([a.patch.rotina, a.patch.atualizacoes.rotina], [null, HOJE]);
  // rotina e notas são privadas: a linha da correção (que vai pro resumo do grupo) não leva o conteúdo
  const rot = E.aplicarCorrecaoFato(perfil, 'rotina', 'Acorda às 5h e treina em jejum.', HOJE);
  assert.equal(rot.correcao.includes('jejum'), false);
  assert.match(rot.correcao, /conteúdo privado/);
  assert.deepEqual(E.aplicarCorrecaoFato(perfil, 'girias', null, HOJE).patch.girias, []);
  const p = E.aplicarCorrecaoFato(perfil, `produto:${hashCurto('whey x')}`, null, HOJE);
  assert.deepEqual(p.patch.produtos, [{ nome: 'aveia', kcal: 380 }]);
  assert.match(p.correcao, /apagou pelo app o produto fixo "whey x"/);
  const an = E.aplicarCorrecaoFato(perfil, `anotacao:${hashCurto('Prefere arroz integral')}`, null, HOJE);
  assert.deepEqual(an.patch.anotacoes, []);
  assert.equal(an.correcao.includes('arroz'), false);
  const erro = (fid, txt, status, codigo) => assert.throws(() => E.aplicarCorrecaoFato(perfil, fid, txt, HOJE), (x) => x.status === status && x.codigo === codigo, `${fid} ${txt}`);
  erro('objetivo', 'ganhar', 400, 'fato_nao_editavel');
  erro('objetivo', null, 400, 'fato_nao_apagavel');
  erro('girias', 'tri', 400, 'fato_nao_editavel');
  erro('produto:deadbeef', null, 404, 'fato_nao_encontrado');
  erro(`produto:${hashCurto('aveia')}`, 'x', 400, 'fato_nao_editavel');
  erro('notas', null, 404, 'fato_nao_encontrado'); // não tem notas
  erro('restricoes', 'sem lactose', 404, 'fato_nao_encontrado'); // só corrige o que existe
  erro('jids', null, 400, 'fato_nao_apagavel'); // campo fora da lista nunca é tocado
  assert.throws(() => E.validarFato({ texto: '   ' }), /texto vazio/);
  assert.equal(E.validarFato({ texto: ' a  b ' }), 'a b');
  // as notas são uma lista: quebras de linha ficam; o limite é do campo e nunca trunca em silêncio
  assert.equal(E.validarFato({ texto: '- Gosta de café.\r\n\r\n\r\n- Odeia   beterraba. \n' }, 'notas'), '- Gosta de café.\n\n- Odeia beterraba.');
  assert.equal(E.validarFato({ texto: 'x'.repeat(3000) }, 'notas').length, 3000);
  assert.throws(() => E.validarFato({ texto: 'x'.repeat(121) }, 'dieta'), /mais de 120/);
  assert.throws(() => E.validarFato({ texto: 'x'.repeat(4001) }, 'notas'), /mais de 4000/);
  assert.throws(() => E.validarFato({ texto: 'x'.repeat(401) }), /mais de 400/);
});

test('aplicarDescarteHipotese (pura) e nomeDaFoto', () => {
  const h1 = { id: 'h1', texto: 'Come menos em dia de treino', status: 'aberta', criadaEm: '2030-03-10' };
  const perfil = { nome: 'Pessoa A', jids: [JID], hipoteses: [h1, { id: 'h2', texto: 'Outra', status: 'aberta' }] };
  const d = E.aplicarDescarteHipotese(perfil, 'h1', HOJE);
  assert.deepEqual(d.patch, { jids: [JID], hipoteses: [perfil.hipoteses[1]] });
  assert.deepEqual([d.fechada.status, d.fechada.fechadaEm, d.fechada.jid, d.fechada.evidencia], ['descartada', HOJE, JID, 'descartada pela pessoa no app']);
  assert.equal(d.correcao.includes('Come menos'), false); // conteúdo privado fora do resumo do grupo
  assert.match(d.correcao, /descartou pelo app uma hipótese/);
  assert.throws(() => E.aplicarDescarteHipotese(perfil, 'h9', HOJE), (x) => x.status === 404 && x.codigo === 'hipotese_nao_encontrada');
  // o fim do _id entra no nome: duas refeições na mesma hora e slot não dividem o arquivo
  assert.deepEqual(E.nomeDaFoto({ dia: '2030-03-29', horaLocal: '12:30', slot: 'almoco', mimeType: 'image/jpeg', id: '65f0c0ffeeabc123' }), { pasta: '2030-03', nome: '2030-03-29 12h30 Almoço abc123.jpg' });
  assert.equal(E.nomeDaFoto({ dia: '2030-03-29', horaLocal: '08:00', slot: 'cafe', mimeType: 'image/png' }).nome, '2030-03-29 08h00 Café da manhã.png');
});

test('guardarFotoNoDrive: pasta da pessoa/Fotos/AAAA-MM, arquivo nomeado, driveId anotado no registro; refeição apagada no meio = foto pra lixeira', async () => {
  const chamadas = [];
  const drive = {
    pastaDe: async (p) => `raiz-${p.nome}`,
    subpasta: async (pai, nome) => (chamadas.push(['subpasta', pai, nome]), `${pai}/${nome}`),
    salvarEmPasta: async (pasta, nome, dados, mime) => (chamadas.push(['salvar', pasta, nome, dados.length, mime]), 'id-drive'),
    lixeira: async (id) => chamadas.push(['lixeira', id]),
  };
  const sets = [];
  const foto = { mimeType: 'image/jpeg', data: Buffer.alloc(10) };
  const r = await E.guardarFotoNoDrive({ drive, atualizarRefeicao: async (id, set) => (sets.push([id, set]), 1), perfil: { nome: 'Pessoa A' }, registroId: 'novo1', registro: { dia: '2030-03-29', horaLocal: '12:30', slot: 'almoco' }, foto });
  assert.deepEqual(r, { driveId: 'id-drive', nome: '2030-03-29 12h30 Almoço novo1.jpg' });
  assert.deepEqual(chamadas, [['subpasta', 'raiz-Pessoa A', 'Fotos'], ['subpasta', 'raiz-Pessoa A/Fotos', '2030-03'], ['salvar', 'raiz-Pessoa A/Fotos/2030-03', '2030-03-29 12h30 Almoço novo1.jpg', 10, 'image/jpeg']]);
  assert.deepEqual(sets, [['novo1', { foto: { driveId: 'id-drive', nome: '2030-03-29 12h30 Almoço novo1.jpg' } }]]);
  // o DELETE chegou enquanto a foto subia: o updateOne não casa com nada e a foto vai pra lixeira em vez de ficar órfã
  chamadas.length = 0;
  const r2 = await E.guardarFotoNoDrive({ drive, atualizarRefeicao: async () => 0, perfil: { nome: 'Pessoa A' }, registroId: 'sumiu', registro: { dia: '2030-03-29', horaLocal: '12:30', slot: 'almoco' }, foto });
  assert.equal(r2, null);
  assert.deepEqual(chamadas.at(-1), ['lixeira', 'id-drive']);
  assert.equal(await E.guardarFotoNoDrive({ drive, atualizarRefeicao: async () => 1, perfil: {}, registroId: 'x', registro: {}, foto: null }), null);
});

test('rotas da fase 3: PUT/DELETE nutri/fatos e DELETE nutri/hipoteses gravam pelo salvarPerfil, anotam a correção e devolvem o /nutri; GET /pesagens por intervalo', async () => {
  const { hashCurto } = await import('../api-montadores.js');
  const pA = perfis[0];
  pA.dieta = 'onívora';
  pA.anotacoes = [{ dia: '2030-03-01', texto: 'Prefere arroz integral' }];
  pA.hipoteses = [{ id: 'h1', texto: 'Come menos em dia de treino', status: 'aberta', criadaEm: '2030-03-10' }];
  correcoes.length = 0;
  perfilSalvo = null;
  let r = await pedir('PUT', `/perfis/${ID}/nutri/fatos/dieta`, { texto: 'vegetariana' });
  assert.equal(r.status, 200);
  assert.deepEqual([perfilSalvo.dieta, perfilSalvo.atualizacoes.dieta, perfilSalvo.jids], ['vegetariana', HOJE, [JID]]);
  assert.equal(r.json.nutri.fatos.find((f) => f.id === 'dieta').texto, 'Dieta: vegetariana');
  assert.match(correcoes.at(-1).texto, /corrigiu pelo app dieta/);
  r = await pedir('PUT', `/perfis/${ID}/nutri/fatos/objetivo`, { texto: 'x' });
  assert.deepEqual([r.status, r.json.erro.codigo], [400, 'fato_nao_editavel']);
  r = await pedir('PUT', `/perfis/${ID}/nutri/fatos/dieta`, {});
  assert.equal(r.status, 400);

  r = await pedir('DELETE', `/perfis/${ID}/nutri/fatos/anotacao:${hashCurto('Prefere arroz integral')}`);
  assert.deepEqual([r.status, r.json.apagado, perfilSalvo.anotacoes], [200, true, []]);
  assert.equal(r.json.nutri.fatos.some((f) => f.campo === 'anotacao'), false);
  r = await pedir('DELETE', `/perfis/${ID}/nutri/fatos/anotacao:00000000`);
  assert.deepEqual([r.status, r.json.erro.codigo], [404, 'fato_nao_encontrado']);
  // notas: além do Mongo, passam por salvarNotas (cache de pessoas.js e Nutri-Notas.md), senão a reescrita noturna desfaz
  pA.notas = '- Gosta de café.';
  r = await pedir('PUT', `/perfis/${ID}/nutri/fatos/notas`, { texto: '- Gosta de café sem açúcar.' });
  assert.equal(r.status, 200);
  assert.deepEqual(notasSalvas.at(-1), ['Pessoa A', '- Gosta de café sem açúcar.', HOJE]);
  r = await pedir('DELETE', `/perfis/${ID}/nutri/fatos/notas`);
  assert.deepEqual([r.status, notasSalvas.at(-1), perfilSalvo.notas], [200, ['Pessoa A', '', HOJE], null]);
  // Drive fora do ar: 503 e NADA gravado no Mongo (gravar só no Mongo deixaria a noite desfazer a correção)
  pA.notas = '- Antiga.';
  perfilSalvo = null;
  const salvarNotasOk = escrita.salvarNotas;
  escrita.salvarNotas = async () => { throw new Error('drive caiu'); };
  r = await pedir('PUT', `/perfis/${ID}/nutri/fatos/notas`, { texto: '- Nova.' });
  assert.deepEqual([r.status, r.json.erro.codigo, perfilSalvo], [503, 'drive_indisponivel', null]);
  escrita.salvarNotas = salvarNotasOk;
  delete pA.notas;
  // texto de 400+ nas notas passa (limite 4000); dieta com 121 não
  pA.dieta = 'x';
  r = await pedir('PUT', `/perfis/${ID}/nutri/fatos/dieta`, { texto: 'y'.repeat(121) });
  assert.equal(r.status, 400);

  r = await pedir('DELETE', `/perfis/${ID}/nutri/hipoteses/h1`);
  assert.deepEqual([r.status, r.json.apagado, perfilSalvo.hipoteses], [200, true, []]);
  assert.deepEqual([hipotesesGuardadas.at(-1).id, hipotesesGuardadas.at(-1).status, hipotesesGuardadas.at(-1).jid], ['h1', 'descartada', JID]);
  assert.equal(r.json.nutri.hipoteses.some((h) => h.id === 'h1'), false);
  assert.match(correcoes.at(-1).texto, /descartou pelo app uma hipótese/);
  assert.equal(correcoes.at(-1).texto.includes('Come menos'), false); // o conteúdo não vai pro resumo do grupo
  r = await pedir('DELETE', `/perfis/${ID}/nutri/hipoteses/h1`);
  assert.equal(r.status, 404);
  // outra pessoa não alcança o perfil A pelo id de B? (o token vê os perfis liberados; o que vale é o :id do pedido)
  delete pA.dieta;
  delete pA.anotacoes;
  delete pA.hipoteses;

  pesagensEntreLista.push({ dia: '2030-03-01', peso: 70.4, fonte: 'relogio', hora: '07:00' }, { dia: '2030-02-01', peso: 71 });
  r = await pedir('GET', `/perfis/${ID}/pesagens?de=2030-01-01&ate=${HOJE}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.pesagens, [{ dia: '2030-02-01', peso: 71, gordura: null, fonte: 'digitada', hora: null }, { dia: '2030-03-01', peso: 70.4, gordura: null, fonte: 'relogio', hora: '07:00' }]);
  r = await pedir('GET', `/perfis/${ID}/pesagens?de=2029-01-01&ate=${HOJE}`);
  assert.deepEqual([r.status, r.json.erro.codigo], [400, 'intervalo_invalido']); // 452 dias > 366
  r = await pedir('GET', `/perfis/${ID}/pesagens?de=2020-01-01&ate=${HOJE}`);
  assert.deepEqual([r.status, r.json.erro.codigo], [400, 'dia_invalido']); // fora da janela de 2 anos
  r = await pedir('GET', `/perfis/${ID}/pesagens?de=2030-03-01&ate=2030-04-01`);
  assert.deepEqual([r.status, r.json.erro.codigo], [400, 'dia_invalido']); // futuro
  r = await pedir('GET', `/perfis/${ID}/pesagens?ate=${HOJE}`);
  assert.deepEqual([r.status, r.json.erro.codigo], [400, 'pedido_invalido']); // de obrigatório
});

test('POST /refeicoes com foto: a resposta não espera o Drive e o registro ganha foto.driveId depois', async () => {
  respostaIa = { estimativa: { kcal: 300, p: 10, c: 30, g: 10 }, descricao: 'pão', tipo: 'cafe', itens: [{ nome: 'pão', gramas: 50, kcal: 300 }] };
  fotosGuardadas.length = 0;
  const foto = { mime: 'image/jpeg', base64: Buffer.alloc(300, 7).toString('base64') };
  liberarDrive = null;
  const { status, json } = await pedir('POST', `/perfis/${ID}/refeicoes`, { fotos: [foto], hora: '08:00' });
  assert.equal(status, 201);
  assert.equal(json.refeicao.foto, null); // o link só aparece na próxima leitura
  // a resposta chegou com o "Drive" ainda pendente (liberarDrive só é chamado agora)
  assert.equal(fotosGuardadas.length, 0);
  assert.equal(typeof liberarDrive, 'function');
  liberarDrive();
  await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual([fotosGuardadas.length, fotosGuardadas[0].registroId, fotosGuardadas[0].foto.data.length, fotosGuardadas[0].registro.slot], [1, json.refeicao.id, 300, 'cafe']);
  const salvo = refeicoes.find((x) => x._id === json.refeicao.id);
  assert.deepEqual(salvo.foto, { driveId: 'drv-1', nome: `2030-03-29 08h00 Café da manhã ${json.refeicao.id.slice(-6)}.jpg` });
  // apagar manda a foto pra lixeira do Drive
  const d = await pedir('DELETE', `/perfis/${ID}/refeicoes/${json.refeicao.id}`);
  assert.equal(d.status, 200);
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(lixeira, ['drv-1']);
});
