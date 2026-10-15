// Fase 7, frente A: as rotas das lacunas (api-lacunas.js) num Express de verdade em 127.0.0.1 com dublês (sem Mongo, sem
// Drive, sem IA), os montadores puros (api-lacunas-montadores.js) e os achados de passagem (despensa: validadeDias, "usei"
// a granel, unidade; lugares por id; atividade por objeto; duplicatas da despensa antes do índice único; silêncio que
// sobrevive ao restart; PUT /perfis ampliado; /perguntar gravando e lendo o histórico do servidor).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { criarApi } = await import('../api.js');
const { criarAuth } = await import('../api-auth.js');
const M = await import('../api-lacunas-montadores.js');
const D = await import('../despensa.js');
const { aplicarMarcacao } = await import('../lugares.js');
const { atividadeDeObjeto } = await import('../atividades.js');
const { planoDuplicatasDespensa, garantirIndiceDespensa } = await import('../mongo.js');
const { estado, definirPersistenciaSilencio } = await import('../estado.js');
const E = await import('../api-escrita.js');

// ---------- auth de mentira (o pedaço do driver que o api-auth usa) ----------
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
    updateMany: async () => ({ modifiedCount: 0 }),
    deleteMany: async () => ({}),
  };
}
const cols = { codigos_app: colecaoFalsa(), dispositivos: colecaoFalsa() };
const AGORA = new Date('2030-03-29T15:00:00Z'); // 12:00 em São Paulo
const DIA = '2030-03-29';
const auth = criarAuth({ colecao: (n) => cols[n], agora: () => AGORA });

// ---------- perfis e dublês ----------
const IDA = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // dono do grupo
const IDB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const perfis = [
  {
    _id: IDA,
    nome: 'Pessoa A',
    jids: ['a@s.whatsapp.net'],
    fuso: 'America/Sao_Paulo',
    peso: 70,
    lugaresAtivo: true,
    lugares: [
      { id: 'l1', lat: -10.1, lon: -20.2, tipo: 'academia', nome: 'Quadra Secreta', bairro: 'Bairro Secreto', visitas: 9, padrao: 'seg, qua · 20h às 22h' },
      { id: 'l2', lat: -10.3, lon: -20.4, tipo: 'residência', papel: 'casa', bairro: 'Bairro Secreto', visitas: 30 },
    ],
  },
  {
    _id: IDB,
    nome: 'Pessoa B',
    jids: ['b@s.whatsapp.net'],
    fuso: 'America/Sao_Paulo',
    peso: 80,
    atividades: [{ id: 'av1', nome: 'Vôlei', dias: [5], inicio: '20:00', fim: '22:00', met: 6, lugar: { lat: -10.1, lon: -20.2, nome: 'Quadra Secreta' } }],
    atividadesFeitas: {},
    atividadesPendentes: [{ id: 'av1', dia: DIA }],
  },
];
const chamadas = [];
const anota = (nome, ...args) => chamadas.push([nome, ...args]);
const ultima = (nome) => [...chamadas].reverse().find((c) => c[0] === nome);
let despensa = [];
let historico = [];
let whatsappPronto = true;
let resolverPlano = null;
const lacunas = {
  listarDespensa: async (_p, { incluirAcabou }) => despensa.filter((d) => incluirAcabou || d.estado !== 'acabou'),
  ajustarItem: async (p, args) => {
    anota('ajustarItem', p.nome, args);
    if (args.k === 'nao-existe') return null;
    return { k: args.k || D.chaveItem(args.item), item: args.item || 'leite', categoria: args.categoria || 'outro', quantidade: args.qtd || 1, unidade: args.unidade || 'un', estado: args.acao === 'acabou' ? 'acabou' : 'tem', validadeEm: '2030-04-05', perecivel: false };
  },
  removerItem: async (_p, k) => (k === 'arroz' ? 1 : 0),
  limparDespensa: async () => 7,
  notasDesde: async (_p, desde) => (anota('notasDesde', desde), [{ _id: 'n1', loja: 'Mercado Teste', dia: '2030-03-27', origem: 'app', itens: [{ item: 'arroz', quantidade: 1, unidade: 'kg', preco: 6.5 }, { item: 'leite', quantidade: 2, unidade: 'l', preco: 9 }] }]),
  receberNota: async (x) => (anota('receberNota', x.perfil.nome, x.texto.length, x.chave), { ok: true, itens: 2 }),
  criarAtividade: async (p, v) => (anota('criarAtividade', p.nome, v), v.nome === 'Sem lugar' ? { erro: 'Lugar não encontrado.' } : atividadeDeObjeto(p, v, { id: 'anovo', dia: DIA })),
  removerAtividade: async (_p, aid) => (aid === 'av1' ? { id: 'av1' } : null),
  responderAtividade: async (_p, r) => (anota('responderAtividade', r), r.id === 'av1' ? { feita: r.feita, kcal: 960, somadas: 800 } : null),
  situacaoAtual: async (p) => ({ estado: 'lugar', lugar: p.lugares[0], desde: '19:40', minutos: 20 }),
  marcarLugar: async (p, lid, m) => (anota('marcarLugar', lid, m), aplicarMarcacao(p.lugares, lid, m)?.lugar || null),
  esquecerLugares: async () => anota('esquecerLugares'),
  ehDonoDaAgenda: async (p) => p.nome === 'Pessoa A',
  agendaDe: async () => ({ lista: [{ titulo: 'Aula de cálculo', tipo: 'aula', inicio: '2030-03-29T17:00:00.000Z', fim: '2030-03-29T19:00:00.000Z', local: 'Prédio Secreto', descricao: 'sala 3' }] }),
  config: () => ({ config: { vozLigada: false }, silencioAteMs: Date.parse('2030-03-29T17:00:00Z'), nomeBot: 'Lia' }),
  salvarVoz: async (v) => anota('salvarVoz', v),
  definirSilencio: async (ms) => anota('definirSilencio', ms),
  licoes: async () => ({ regras: ['Não somar o pão *duas* vezes.'], documento: 'Erro: somei pão duas vezes.', dia: '2030-03-28' }),
  persona: async () => ({ doc: { texto: 'A Pessoa A treina na Quadra Secreta. Gosta de café.', dia: '2030-03-28' }, historico: [{ texto: 'Versão antiga.', dia: '2030-03-20', substituidoEm: new Date('2030-03-21T00:00:00Z') }] }),
  conhecimento: async () => [{ id: 'emag', titulo: 'Emagrecimento', foco: 'emagrecimento', versao: 2, atualizado: '2030-01-01' }, { id: 'base', titulo: 'Base', foco: 'base', versao: 1, atualizado: '2030-01-01' }],
  docConhecimento: async (id) => (id === 'base' ? { id: 'base', titulo: 'Base', foco: 'base', versao: 1, corpo: '## Proteína\nComa *bem*.' } : null),
  estudar: async (x) => anota('estudar', x),
  proatividade: async () => ({ total: 2, respondidas: 1, ignoradas: 1, ultimas: [{ dia: DIA, hora: '10:00', nome: 'Pessoa B Sobrenome', assunto: 'sono', respondida: true }] }),
  momentos: async () => [{ dia: DIA, pessoa: 'Pessoa B', tipo: 'conquista', texto: 'Bateu a meta de proteína.' }],
  documentos: async () => ({ arquivos: [{ nome: 'exame.pdf', tipo: 'pdf', lido: true, daNutri: false }, { nome: 'Nutri-Notas.md', tipo: 'text/markdown', daNutri: true, lido: true }], analisados: [{ nome: 'exame.pdf', tipo: 'exame', data: '2030-03-01', resumo: 'Glicemia normal.' }], pastaId: 'pasta123' }),
  status: async () => ({ uptimeSeg: 3600, conexao: 'conectado', dia: DIA, mensagensHoje: 12, uso: { chamadas: 5, entrada: 1000, saida: 200, cache: 100 }, modelos: [{ modelo: 'gemini-x', papel: 'principal', livre: true }], reservas: ['outra'] }),
  resumoDoDia: async (dia) => (dia === '2030-03-28' ? '---\ntipo: resumo\n---\n# Dia 28\n\nDia bom. Ver [[Resumos/2030-03-27|ontem]].' : null),
  falas: async (de, ate) => (anota('falas', de, ate), [{ dia: '2030-03-28', tipo: 'sexta', texto: 'Fechamos a semana bem!' }]),
  previsoes: async () => [{ feitaEm: '2030-03-24', alvoDia: '2030-03-31', pesoInicial: 70, pesoPrevisto: 69.6, deltaKg: -0.4, confianca: 'media', conferida: true, resultado: { realKg: 69.8, erroKg: 0.2, acerto: 'perto' } }],
  habitosDe: async () => ({ agua_ml: 1500, alcool_doses: 1 }),
  registrarHabito: async (_p, v) => anota('registrarHabito', v),
  perguntasDe: async (_p, { antes, n }) => {
    const l = historico.filter((h) => !antes || h.em < antes).sort((a, b) => a.em - b.em);
    return l.slice(-n);
  },
  apagarPergunta: async (_p, id) => (id === 'q1' ? 1 : 0),
  apagarPerguntas: async () => 3,
  whatsappPronto: () => whatsappPronto,
  gerarPlano: (x) => (anota('gerarPlano', x.perfil.nome, x.pedido), new Promise((ok) => (resolverPlano = ok))),
};
// /perguntar: o histórico do servidor e a gravação
const perguntasServidor = [];
const gravadas = [];
const perguntas = {
  perguntasDe: async (jids, { desde, n }) => (anota('perguntasDe', jids, desde, n), perguntasServidor),
  guardarPergunta: (x) => (gravadas.push(x), { _id: `q${gravadas.length}`, ...x }),
};
const iaPedidos = [];
const ia = { responderApp: async (x) => (iaPedidos.push(x), 'Pode *sim*. Você está na Quadra Secreta. 😀') };
const dados = {
  listarPerfis: async () => perfis,
  registrosSugestao: async () => ({ refeicoes: [], pesagens: [] }),
  contextoSugestao: async () => ({ humor: null, eventos: [], despensa: '', agenda: '', lugares: '', persona: '', bloco: 'CONTEXTO DO APP DE TESTE' }),
  de31: async () => ({ refeicoes: [], pesagens: [] }),
  planoDe: async () => null,
  doDia: async () => ({ refeicoes: [], pesagens: [], saude: null, treinos: [] }),
};

let base;
let servidor;
let token;
before(async () => {
  const app = express();
  app.use('/api/v1', criarApi({ auth, dados, ia, lacunas, perguntas, agora: () => AGORA, adminJid: 'a@s.whatsapp.net', temHevyDe: () => false, ehDonoDaAgendaDe: () => false }));
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}/api/v1`;
  const parear = async (dono) => {
    const { codigo } = await auth.novoCodigo(dono === undefined ? undefined : { dono });
    return (await (await fetch(`${base}/parear`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo, aparelho: 'teste' }) })).json()).token;
  };
  token = await parear('a@s.whatsapp.net');
  tokenOutro = await parear('b@s.whatsapp.net'); // aparelho pareado por outra pessoa (hoje o !app é só do admin)
  tokenAntigo = await parear(); // pareado antes do campo `dono` existir: vale como do admin
});
let tokenOutro;
let tokenAntigo;
const outro = () => ({ authorization: `Bearer ${tokenOutro}` });
after(() => servidor?.close());

const pedir = async (metodo, caminho, corpo, cabecalhos = {}) => {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { authorization: `Bearer ${token}`, ...(corpo != null ? { 'content-type': 'application/json' } : {}), ...cabecalhos }, body: corpo == null ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
  return { status: r.status, corpo: await r.json() };
};

// ============================================================
// Rotas
// ============================================================
test('despensa: lista por categoria com selos, adiciona, ações pela chave, tira e zera com confirmação', async () => {
  despensa = [
    { k: 'iogurte', item: 'iogurte', categoria: 'laticínio', quantidade: 2, unidade: 'un', estado: 'tem', validadeEm: '2030-03-27', perecivel: true, compras: 3 },
    { k: 'frango', item: 'frango', categoria: 'frango', quantidade: 1, unidade: 'kg', estado: 'acabando', validadeEm: '2030-03-31', perecivel: true, compras: 1 },
    { k: 'arroz', item: 'arroz', categoria: 'mercearia', quantidade: 5, unidade: 'kg', granel: true, estado: 'tem', validadeEm: '2030-09-01', perecivel: false, compras: 2 },
    { k: 'feijao', item: 'feijão', categoria: 'mercearia', estado: 'acabou', quantidade: 0, validadeEm: '2030-09-01' },
  ];
  let r = await pedir('GET', `/perfis/${IDA}/despensa`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.categorias.map((c) => [c.nome, c.itens.map((i) => i.item)]), [['Frango', ['frango']], ['Laticínios', ['iogurte']], ['Mercearia', ['arroz']]]);
  const iog = r.corpo.itens.find((i) => i.k === 'iogurte');
  assert.deepEqual([iog.selo, iog.seloTexto, iog.perguntar, iog.venceEmDias], ['passou', 'passou do prazo: ainda tem?', true, -2]);
  assert.deepEqual([r.corpo.total, r.corpo.vencendo, r.corpo.passou, r.corpo.acabando], [3, 1, 1, 1]);
  assert.equal(r.corpo.itens.find((i) => i.k === 'arroz').quantidadeTexto, '5 kg');
  r = await pedir('GET', `/perfis/${IDA}/despensa?acabou=1`);
  assert.equal(r.corpo.itens.length, 4);
  assert.equal((await pedir('GET', `/perfis/${IDA}/despensa?acabou=talvez`)).status, 400);

  r = await pedir('POST', `/perfis/${IDA}/despensa`, { item: 'Leite', qtd: 2, unidade: 'litros', categoria: 'laticínio' });
  assert.equal(r.status, 201);
  assert.deepEqual(ultima('ajustarItem')[2], { item: 'leite', acao: 'comprei', qtd: 2, unidade: 'l', categoria: 'laticínio' });
  assert.deepEqual([r.corpo.item.k, r.corpo.item.quantidadeTexto], ['leite', '2 l']);
  assert.equal((await pedir('POST', `/perfis/${IDA}/despensa`, { item: 'detergente', categoria: 'limpeza' })).status, 400);
  assert.equal((await pedir('POST', `/perfis/${IDA}/despensa`, { item: 'x' })).status, 400);
  assert.equal((await pedir('POST', `/perfis/${IDA}/despensa`, { item: 'arroz', qtd: -1 })).status, 400);

  r = await pedir('PUT', `/perfis/${IDA}/despensa/arroz`, { acao: 'usei', qtd: 200, unidade: 'g' });
  assert.equal(r.status, 200);
  assert.deepEqual(ultima('ajustarItem')[2], { k: 'arroz', acao: 'usei', qtd: 200, unidade: 'g' });
  r = await pedir('PUT', `/perfis/${IDA}/despensa/nao-existe`, { acao: 'tem' });
  assert.deepEqual([r.status, r.corpo.erro.codigo], [404, 'item_nao_encontrado']);
  assert.equal((await pedir('PUT', `/perfis/${IDA}/despensa/arroz`, { acao: 'jogar fora' })).status, 400);
  assert.deepEqual((await pedir('DELETE', `/perfis/${IDA}/despensa/arroz`)).corpo, { apagado: true });
  assert.equal((await pedir('DELETE', `/perfis/${IDA}/despensa/sumiu`)).status, 404);
  assert.deepEqual([(await pedir('DELETE', `/perfis/${IDA}/despensa`)).status, (await pedir('DELETE', `/perfis/${IDA}/despensa?confirmar=sim`)).corpo], [400, { apagados: 7 }]);
});

test('compras: cupons com resumo (sem localização) e cupom novo de mais de 32 kb lido em segundo plano', async () => {
  let r = await pedir('GET', `/perfis/${IDA}/compras?dias=14`);
  assert.equal(r.status, 200);
  assert.deepEqual(ultima('notasDesde'), ['notasDesde', '2030-03-16']);
  assert.deepEqual([r.corpo.notas[0].loja, r.corpo.notas[0].total, r.corpo.resumo.cupons, r.corpo.resumo.gasto], ['Mercado Teste', 15.5, 1, 15.5]);
  assert.match(r.corpo.resumo.texto, /1 cupom lido em 14 dias, cerca de R\$ 16 em itens\./);
  assert.doesNotMatch(r.corpo.resumo.texto, /localiza|Idas/);
  const texto = 'ARROZ (Código: 1) Qtde.: 1 UN: KG Vl. Unit.: 6,50 Vl. Total 6,50\n'.repeat(700); // ~45 kb
  r = await pedir('POST', `/perfis/${IDA}/compras`, { texto, chave: '4'.repeat(44) });
  assert.deepEqual([r.status, r.corpo.recebido], [202, true]);
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(ultima('receberNota'), ['receberNota', 'Pessoa A', texto.length, '4'.repeat(44)]);
  assert.equal((await pedir('POST', `/perfis/${IDA}/compras`, { texto: 'curto' })).status, 400);
});

test('atividades: lista sem coordenada e com o nome do lugar filtrado, cria, apaga por id e responde o "teve vôlei?"', async () => {
  let r = await pedir('GET', `/perfis/${IDB}/atividades`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.fixas[0], { id: 'av1', nome: 'Vôlei', dias: [5], diasTexto: 'sex', inicio: '20:00', fim: '22:00', met: 6, lugar: { nome: 'lugar marcado' }, kcal: 960 });
  assert.deepEqual(r.corpo.hoje, [{ id: 'av1', nome: 'Vôlei', inicio: '20:00', fim: '22:00', feita: null, kcal: null, como: null, emDuvida: true }]); // 29/03/2030 é sexta
  assert.deepEqual(r.corpo.pendentes, [{ id: 'av1', nome: 'Vôlei', dia: DIA }]);
  assert.equal(JSON.stringify(r.corpo).includes('-10.1'), false);
  assert.equal(JSON.stringify(r.corpo).includes('Secreta'), false);

  r = await pedir('POST', `/perfis/${IDA}/atividades`, { nome: 'Futebol', dias: ['ter', 'qui'], inicio: '19:00', fim: '20:30', met: 7, lugarId: 'l1' });
  assert.equal(r.status, 201);
  assert.deepEqual(ultima('criarAtividade')[2], { nome: 'Futebol', dias: [2, 4], inicio: '19:00', fim: '20:30', met: 7, lugarId: 'l1', aqui: false });
  assert.deepEqual([r.corpo.atividade.id, r.corpo.atividade.kcal, r.corpo.atividade.lugar], ['anovo', 735, { nome: 'lugar marcado' }]);
  assert.equal((await pedir('POST', `/perfis/${IDA}/atividades`, { nome: 'Sem lugar', dias: [1], inicio: '10:00', fim: '11:00' })).corpo.erro.mensagem, 'Lugar não encontrado.');
  assert.equal((await pedir('POST', `/perfis/${IDA}/atividades`, { nome: 'X', dias: [1], inicio: '11:00', fim: '10:00' })).status, 400);
  assert.equal((await pedir('POST', `/perfis/${IDA}/atividades`, { nome: 'X', dias: [], inicio: '10:00', fim: '11:00' })).status, 400);
  assert.deepEqual((await pedir('DELETE', `/perfis/${IDB}/atividades/av1`)).corpo, { apagada: true });
  assert.equal((await pedir('DELETE', `/perfis/${IDB}/atividades/zzz`)).status, 404);

  r = await pedir('POST', `/perfis/${IDB}/atividades/av1/resposta`, { feita: true });
  assert.deepEqual(r.corpo, { dia: DIA, feita: true, kcal: 960, somadas: 800 });
  assert.deepEqual(ultima('responderAtividade')[1], { id: 'av1', dia: DIA, feita: true });
  assert.equal((await pedir('POST', `/perfis/${IDB}/atividades/av1/resposta`, { feita: 'sim' })).status, 400);
  assert.equal((await pedir('POST', `/perfis/${IDB}/atividades/av1/resposta`, { feita: false, dia: '2030-03-10' })).status, 400);
  assert.equal((await pedir('POST', `/perfis/${IDB}/atividades/zzz/resposta`, { feita: false })).status, 404);
});

test('lugares: só o perfil do dono (403 nos outros), sem coordenada; marcar por id e esquecer com confirmação', async () => {
  let r = await pedir('GET', `/perfis/${IDB}/lugares`);
  assert.deepEqual([r.status, r.corpo.erro.codigo], [403, 'so_dono']);
  assert.equal((await pedir('GET', `/perfis/${IDA}/lugares`, null, outro())).status, 403, 'o perfil do dono, mas pelo aparelho de outra pessoa');
  r = await pedir('GET', `/perfis/${IDA}/lugares`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.agora, { estado: 'lugar', tipo: 'academia', nome: 'Quadra Secreta', lugarId: 'l1', desde: '19:40' });
  assert.deepEqual(r.corpo.lugares.map((l) => [l.id, l.papel]), [['l2', 'casa'], ['l1', null]]);
  assert.equal(/"lat"|"lon"|-10\.1/.test(JSON.stringify(r.corpo)), false);
  r = await pedir('PUT', `/perfis/${IDA}/lugares/l1`, { tipo: 'trabalho', nome: 'Escritório' });
  assert.deepEqual([r.status, r.corpo.lugar.tipo, r.corpo.lugar.papel, r.corpo.lugar.nome], [200, 'trabalho', 'trabalho', 'Escritório']);
  assert.equal((await pedir('PUT', `/perfis/${IDA}/lugares/zz`, { nome: 'x' })).status, 404);
  assert.equal((await pedir('PUT', `/perfis/${IDA}/lugares/l1`, { papel: 'quintal' })).status, 400);
  assert.equal((await pedir('PUT', `/perfis/${IDB}/lugares/l1`, { nome: 'x' })).status, 403);
  assert.equal((await pedir('DELETE', `/perfis/${IDA}/lugares`)).status, 400);
  assert.deepEqual((await pedir('DELETE', `/perfis/${IDA}/lugares?confirmar=sim`)).corpo, { apagado: true });
});

test('agenda do Google: só do dono da credencial; sem local nem descrição; janelas livres', async () => {
  let r = await pedir('GET', `/perfis/${IDB}/agenda-google`);
  assert.deepEqual(r.corpo, { ativa: false, eventos: [], janelas: [] });
  r = await pedir('GET', `/perfis/${IDA}/agenda-google`, null, outro());
  assert.deepEqual(r.corpo, { ativa: false, eventos: [], janelas: [] }, 'a agenda do dono, mas pelo aparelho de outra pessoa');
  r = await pedir('GET', `/perfis/${IDA}/agenda-google?dias=2`);
  assert.deepEqual(r.corpo.eventos, [{ dia: DIA, inicio: '14:00', fim: '16:00', diaTodo: false, titulo: 'Aula de cálculo', tipo: 'aula' }]);
  assert.deepEqual(r.corpo.janelas, [{ dia: DIA, inicio: '07:00', fim: '14:00' }, { dia: DIA, inicio: '16:00', fim: '23:00' }, { dia: '2030-03-30', inicio: '07:00', fim: '23:00' }]);
  assert.equal(JSON.stringify(r.corpo).includes('Secreto'), false);
  assert.equal((await pedir('GET', `/perfis/${IDA}/agenda-google?dias=30`)).status, 400);
});

test('configurações: leitura pra todos; voz e silêncio só do aparelho do dono (do pareamento, nunca de cabeçalho); nome só no grupo', async () => {
  let r = await pedir('GET', '/config', null, outro());
  assert.deepEqual(r.corpo, { vozLigada: false, silencioAte: '2030-03-29T17:00:00.000Z', silencioAtivo: true, nomeBot: 'Lia', podeEditar: false });
  assert.equal((await pedir('GET', '/config')).corpo.podeEditar, true);
  assert.equal((await pedir('GET', '/config', null, { authorization: `Bearer ${tokenAntigo}` })).corpo.podeEditar, true);
  assert.equal((await pedir('GET', `/perfis/${IDB}/config`)).corpo.podeEditar, false);
  assert.equal((await pedir('GET', `/perfis/${IDA}/config`, null, outro())).corpo.podeEditar, false);
  r = await pedir('PUT', '/config', { vozLigada: true }, outro());
  assert.deepEqual([r.status, r.corpo.erro.codigo], [403, 'so_dono']);
  // o cabeçalho X-Perfil (ou ?perfil=, ou perfilId no corpo) não diz quem é o aparelho
  assert.equal((await pedir('PUT', '/config', { vozLigada: true }, { ...outro(), 'x-perfil': IDA })).status, 403);
  assert.equal((await pedir('PUT', `/config?perfil=${IDA}`, { vozLigada: true, perfilId: IDA }, outro())).status, 403);
  assert.equal((await pedir('PUT', `/perfis/${IDA}/config`, { vozLigada: true }, outro())).status, 403);
  assert.equal((await pedir('PUT', `/perfis/${IDB}/config`, { vozLigada: true })).status, 403);
  chamadas.length = 0;
  r = await pedir('PUT', '/config', { vozLigada: true, silencioMin: 90 });
  assert.equal(r.status, 200);
  assert.deepEqual([ultima('salvarVoz'), ultima('definirSilencio')], [['salvarVoz', true], ['definirSilencio', AGORA.getTime() + 90 * 60_000]]);
  r = await pedir('PUT', `/perfis/${IDA}/config`, { silencioAte: null });
  assert.deepEqual([r.status, ultima('definirSilencio')], [200, ['definirSilencio', 0]]);
  r = await pedir('PUT', `/perfis/${IDA}/config`, { nomeBot: 'Outra' });
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'so_no_grupo']);
  assert.equal((await pedir('PUT', `/perfis/${IDA}/config`, { silencioMin: 99999 })).status, 400);
});

test('Nutri: lições, persona sem localização, base de conhecimento, proatividade, momentos e estudar (só o dono, 1 por dia)', async () => {
  let r = await pedir('GET', '/nutri/licoes');
  assert.deepEqual(r.corpo, { regras: ['Não somar o pão duas vezes.'], documento: 'Erro: somei pão duas vezes.', dia: '2030-03-28', atualizadoEm: null });
  r = await pedir('GET', '/nutri/persona');
  assert.equal(r.corpo.texto, 'Gosta de café.');
  assert.deepEqual(r.corpo.versoes, [{ dia: '2030-03-20', em: '2030-03-21T00:00:00.000Z', trecho: 'Versão antiga.' }]);
  r = await pedir('GET', '/nutri/conhecimento');
  assert.deepEqual(r.corpo.docs.map((d) => d.id), ['base', 'emag']);
  r = await pedir('GET', '/nutri/conhecimento/base');
  assert.equal(r.corpo.texto, '## Proteína\nComa bem.');
  assert.equal((await pedir('GET', '/nutri/conhecimento/nada')).status, 404);
  r = await pedir('GET', '/nutri/proatividade');
  assert.deepEqual(r.corpo.ultimas, [{ dia: DIA, hora: '10:00', pessoa: 'Pessoa', assunto: 'sono', respondida: true }]);
  r = await pedir('GET', '/nutri/momentos?dias=7');
  assert.deepEqual(r.corpo.momentos, [{ dia: DIA, pessoa: 'Pessoa', tipo: 'conquista', texto: 'Bateu a meta de proteína.' }]);
  assert.equal((await pedir('POST', '/nutri/conhecimento/estudar', {}, { ...outro(), 'x-perfil': IDA })).status, 403);
  assert.equal((await pedir('POST', `/perfis/${IDA}/nutri/conhecimento/estudar`, {}, outro())).status, 403);
  assert.equal((await pedir('POST', `/perfis/${IDA}/nutri/conhecimento/estudar`, {})).status, 202);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.ok(ultima('estudar'));
  assert.deepEqual((await pedir('POST', '/nutri/conhecimento/estudar', {})).corpo.erro.codigo, 'limite_diario');
});

test('documentos, status (só o dono, sem número nem grupo), resumo do dia com as falas, falas e previsões', async () => {
  let r = await pedir('GET', `/perfis/${IDB}/documentos`);
  assert.deepEqual(r.corpo.arquivos[0], { nome: 'exame.pdf', tipo: 'pdf', daNutri: false, lido: true, modificadoEm: null, tipoDocumento: 'exame', data: '2030-03-01', resumo: 'Glicemia normal.' });
  assert.deepEqual([r.corpo.arquivos[1].nome, r.corpo.pastaUrl, r.corpo.driveRespondeu], ['Nutri-Notas.md', 'https://drive.google.com/drive/folders/pasta123', true]);
  assert.equal((await pedir('GET', '/sistema/status', null, { ...outro(), 'x-perfil': IDA })).status, 403);
  assert.equal((await pedir('GET', `/perfis/${IDA}/sistema/status`, null, outro())).status, 403);
  assert.equal((await pedir('GET', `/perfis/${IDB}/sistema/status`)).status, 403);
  r = await pedir('GET', '/sistema/status');
  assert.deepEqual([r.status, r.corpo.uptimeMin, r.corpo.gemini.chamadas, r.corpo.whatsapp.estado, r.corpo.reservas], [200, 60, 5, 'conectado', ['outra']]);
  assert.equal(/numero|grupo/.test(JSON.stringify(r.corpo)), false);
  r = await pedir('GET', `/perfis/${IDA}/resumos/dia`); // padrão: ontem
  assert.deepEqual(r.corpo, { dia: '2030-03-28', texto: '# Dia 28\n\nDia bom. Ver ontem.', falas: [{ dia: '2030-03-28', tipo: 'sexta', texto: 'Fechamos a semana bem!' }] });
  r = await pedir('GET', `/perfis/${IDA}/resumos/dia?dia=2030-03-20`);
  assert.equal(r.corpo.texto, null);
  assert.equal((await pedir('GET', `/perfis/${IDA}/resumos/dia?dia=2030-04-01`)).status, 400);
  r = await pedir('GET', `/perfis/${IDA}/falas?dias=7`);
  assert.deepEqual([r.corpo.falas.length, ultima('falas').slice(1)], [1, ['2030-03-23', DIA]]);
  r = await pedir('GET', `/perfis/${IDA}/previsoes`);
  assert.deepEqual(r.corpo.previsoes[0], { semana: '2030-03-24', alvoDia: '2030-03-31', pesoInicial: 70, previsto: 69.6, deltaKg: -0.4, confianca: 'media', conferida: true, real: 69.8, erroKg: 0.2, acerto: 'perto' });
});

test('água e álcool: lê o dia e soma pelo app', async () => {
  let r = await pedir('GET', `/perfis/${IDA}/habitos`);
  assert.deepEqual(r.corpo, { dia: DIA, aguaMl: 1500, alcoolDoses: 1 });
  r = await pedir('POST', `/perfis/${IDA}/habitos`, { aguaMl: 300 });
  assert.equal(r.status, 201);
  assert.deepEqual(ultima('registrarHabito')[1], { dia: DIA, aguaMl: 300, alcoolDoses: 0 });
  assert.equal((await pedir('POST', `/perfis/${IDA}/habitos`, {})).status, 400);
  assert.equal((await pedir('GET', `/perfis/${IDA}/habitos?dia=2030-03-30`)).status, 400);
});

test('perguntas: histórico do servidor paginado (mais recente primeiro), apagar uma e apagar tudo com confirmação', async () => {
  const t0 = Date.parse('2030-03-29T12:00:00Z');
  historico = Array.from({ length: 5 }, (_, i) => ({ _id: `q${i}`, dia: DIA, hora: `09:0${i}`, em: new Date(t0 + i * 60_000), pergunta: `p${i}`, resposta: `r${i}`, tema: 'outro' }));
  let r = await pedir('GET', `/perfis/${IDA}/perguntas?n=2`);
  assert.deepEqual([r.corpo.perguntas.map((p) => p.id), r.corpo.mais], [['q4', 'q3'], true]);
  r = await pedir('GET', `/perfis/${IDA}/perguntas?n=5&antes=${encodeURIComponent(new Date(t0 + 3 * 60_000).toISOString())}`);
  assert.deepEqual([r.corpo.perguntas.map((p) => p.id), r.corpo.mais], [['q2', 'q1', 'q0'], false]);
  assert.equal((await pedir('GET', `/perfis/${IDA}/perguntas?n=500`)).status, 400);
  assert.deepEqual((await pedir('DELETE', `/perfis/${IDA}/perguntas/q1`)).corpo, { apagado: true });
  assert.equal((await pedir('DELETE', `/perfis/${IDA}/perguntas/q9`)).status, 404);
  assert.equal((await pedir('DELETE', `/perfis/${IDA}/perguntas`)).status, 400);
  assert.deepEqual((await pedir('DELETE', `/perfis/${IDA}/perguntas?confirmar=sim`)).corpo, { apagadas: 3 });
});

test('/perguntar: "anteriores" vem do servidor (24 h) e a troca é gravada já filtrada', async () => {
  perguntasServidor.length = 0;
  perguntasServidor.push({ pergunta: 'do servidor', resposta: 'ok' });
  const r = await pedir('POST', `/perfis/${IDA}/perguntar`, { texto: 'Posso comer agora?', anteriores: [{ pergunta: 'do app', resposta: 'x' }, { pergunta: 'outra do app', resposta: 'y' }] });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(iaPedidos.at(-1).anteriores, [{ pergunta: 'do servidor', resposta: 'ok' }]);
  const pd = ultima('perguntasDe');
  assert.deepEqual([pd[1], pd[2].toISOString(), pd[3]], [['a@s.whatsapp.net'], '2030-03-28T15:00:00.000Z', 5]);
  assert.equal(r.corpo.resposta, 'Pode sim.'); // sem asterisco, emoji nem o lugar
  assert.deepEqual([gravadas.length, gravadas[0].perfil.nome, gravadas[0].dia, gravadas[0].hora, gravadas[0].pergunta, gravadas[0].resposta], [1, 'Pessoa A', DIA, '12:00', 'Posso comer agora?', 'Pode sim.']);
  // integração: o contexto único do app (contexto-app.js) chega na IA, e o app recebe o id da troca pra poder apagar
  assert.equal(iaPedidos.at(-1).contextoApp, 'CONTEXTO DO APP DE TESTE');
  assert.deepEqual([r.corpo.id, r.corpo.dia], ['q1', DIA]);
});

test('integração: /resumos traz as falas (notas de voz do grupo) dos últimos 31 dias', async () => {
  const r = await pedir('GET', `/perfis/${IDA}/resumos`);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.falas, [{ dia: '2030-03-28', tipo: 'sexta', texto: 'Fechamos a semana bem!' }]);
  assert.equal(ultima('falas')[2], DIA);
});

test('plano pelo app (D13): sai no grupo pela mesma geração do !plano; um por pessoa por dia; 409 em andamento; 503 sem WhatsApp', async () => {
  whatsappPronto = false;
  let r = await pedir('POST', `/perfis/${IDB}/plano`, {});
  assert.deepEqual([r.status, r.corpo.erro.codigo], [503, 'whatsapp_desconectado']);
  whatsappPronto = true;
  r = await pedir('POST', `/perfis/${IDB}/plano`, { pedido: 'orçamento curto' });
  assert.deepEqual([r.status, r.corpo.emAndamento], [202, true]);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.deepEqual(ultima('gerarPlano'), ['gerarPlano', 'Pessoa B', 'orçamento curto']);
  r = await pedir('POST', `/perfis/${IDB}/plano`, {});
  assert.deepEqual([r.status, r.corpo.erro.codigo], [409, 'plano_em_andamento']);
  resolverPlano(true);
  await new Promise((ok) => setTimeout(ok, 10));
  r = await pedir('POST', `/perfis/${IDB}/plano`, {});
  assert.deepEqual([r.status, r.corpo.erro.codigo], [429, 'limite_diario']);
  // falhou: libera pra tentar de novo no mesmo dia
  r = await pedir('POST', `/perfis/${IDA}/plano`, {});
  assert.equal(r.status, 202);
  await new Promise((ok) => setTimeout(ok, 10));
  resolverPlano(false);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal((await pedir('POST', `/perfis/${IDA}/plano`, {})).status, 202);
  resolverPlano(true);
  assert.equal((await pedir('POST', `/perfis/${IDA}/plano`, { pedido: 42 })).status, 400);
});

// ============================================================
// Puros e achados de passagem
// ============================================================
test('categorias da despensa no app batem com as validades do despensa.js (só comida)', () => {
  for (const c of M.CATEGORIAS_DESPENSA) assert.ok(c in D.VALIDADE_PADRAO, c);
  assert.ok(!M.CATEGORIAS_DESPENSA.includes('limpeza') && !M.CATEGORIAS_DESPENSA.includes('higiene'));
  for (const c of D.CATEGORIAS_PERECIVEIS) assert.ok(M.CATEGORIAS_DESPENSA.includes(c), c);
});

test('montarItemDespensa: selos de validade só pra perecível ativo', () => {
  const item = (validadeEm, extra = {}) => M.montarItemDespensa({ k: 'x', item: 'x', categoria: 'fruta', validadeEm, perecivel: true, estado: 'tem', quantidade: 1, unidade: 'un', ...extra }, DIA);
  assert.deepEqual([item('2030-03-29').seloTexto, item('2030-03-30').seloTexto, item('2030-03-31').seloTexto, item('2030-04-01').selo], ['vence hoje', 'vence amanhã', 'vence em 2 dias', null]);
  assert.deepEqual([item('2030-03-28').selo, item('2030-03-28').perguntar, item('2030-03-29').perguntar], ['passou', true, true]);
  assert.equal(item('2030-03-20', { estado: 'acabou' }).selo, null);
  assert.equal(item('2030-03-20', { perecivel: false }).selo, null);
  assert.equal(item('2030-04-10', { granel: true, estado: 'acabando' }).quantidadeTexto, 'acabando');
});

test('despensa.converterQtd e calcularAjuste: unidade, "usei" a granel, validadeDias, tirar', () => {
  assert.deepEqual([D.converterQtd(200, 'g', 'kg'), D.converterQtd(1.5, 'l', 'ml'), D.converterQtd(1, 'dúzia', 'un'), D.converterQtd(2, 'kg', 'un'), D.converterQtd(3, 'un', 'un')], [0.2, 1500, 12, null, 3]);
  const agoraD = new Date(0);
  const arroz = { item: 'arroz', granel: true, quantidade: 5, unidade: 'kg', qtdCompra: 5, estado: 'tem', validadeDias: 180, categoria: 'mercearia' };
  assert.deepEqual(D.calcularAjuste(arroz, { acao: 'usei', qtd: 500, unidade: 'g' }, DIA, agoraD), { atualizadoEm: agoraD, usadoEm: DIA, quantidade: 4.5, estado: 'tem' });
  assert.equal(D.calcularAjuste(arroz, { acao: 'usei', qtd: 300 }, DIA, agoraD).quantidade, 4.7); // sem unidade, 300 num item em kg = g
  assert.equal(D.calcularAjuste(arroz, { acao: 'usei', qtd: 4.2, unidade: 'kg' }, DIA, agoraD).estado, 'acabando');
  assert.deepEqual(D.calcularAjuste(arroz, { acao: 'usei', qtd: 6, unidade: 'kg' }, DIA, agoraD), { atualizadoEm: agoraD, usadoEm: DIA, estado: 'acabou', quantidade: 0, acabouEm: DIA });
  assert.deepEqual(D.calcularAjuste(arroz, { acao: 'usei' }, DIA, agoraD), { atualizadoEm: agoraD, usadoEm: DIA }); // sem quantidade: só marca o uso
  const leite = { item: 'leite', quantidade: 1, unidade: 'l', estado: 'tem', validadeDias: 10, categoria: 'laticínio', compras: 1 };
  const c = D.calcularAjuste(leite, { acao: 'comprei', qtd: 500, unidade: 'ml' }, DIA, agoraD);
  assert.deepEqual([c.quantidade, c.validadeEm, c.compras, c.estado], [1.5, '2030-04-08', 2, 'tem']); // validadeDias gravado (10), não o padrão
  const pct = D.calcularAjuste(leite, { acao: 'comprei', qtd: 2, unidade: 'pct' }, DIA, agoraD);
  assert.deepEqual([pct.unidade, pct.quantidade], ['pct', 2]);
  assert.deepEqual(D.calcularAjuste(leite, { acao: 'tirar' }, DIA, agoraD), { atualizadoEm: agoraD, estado: 'acabou', quantidade: 0, acabouEm: DIA });
  assert.equal(D.calcularAjuste(leite, { acao: 'tem' }, DIA, agoraD).validadeEm, '2030-04-03');
  assert.equal(D.calcularAjuste({ ...leite, quantidade: 3, unidade: 'un' }, { acao: 'usei', qtd: 2 }, DIA, agoraD).estado, 'acabando');
  assert.equal(D.calcularAjuste(leite, { acao: 'inventada' }, DIA, agoraD), null);
});

test('despensa: o "usei" a granel da linha DESPENSA da IA (estrito) só desconta com unidade conversível', () => {
  const agoraD = new Date(0);
  const arroz = { item: 'arroz', granel: true, quantidade: 1, unidade: 'kg', qtdCompra: 1, estado: 'tem', validadeDias: 180, categoria: 'mercearia' };
  // "fiz arroz pro almoço" -> { qtd: 1 }: antes zerava o arroz; agora só marca o uso
  assert.deepEqual(D.calcularAjuste(arroz, { acao: 'usei', qtd: 1, estrito: true }, DIA, agoraD), { atualizadoEm: agoraD, usadoEm: DIA });
  assert.deepEqual(D.calcularAjuste(arroz, { acao: 'usei', qtd: 2, unidade: 'xícara', estrito: true }, DIA, agoraD), { atualizadoEm: agoraD, usadoEm: DIA });
  assert.deepEqual(D.calcularAjuste(arroz, { acao: 'usei', qtd: 2, unidade: 'xícara' }, DIA, agoraD), { atualizadoEm: agoraD, usadoEm: DIA }, 'unidade desconhecida nunca desconta granel');
  assert.deepEqual(D.calcularAjuste(arroz, { acao: 'usei', qtd: 300, estrito: true }, DIA, agoraD), { atualizadoEm: agoraD, usadoEm: DIA }, 'sem unidade, a IA não desconta');
  assert.equal(D.calcularAjuste(arroz, { acao: 'usei', qtd: 200, unidade: 'g', estrito: true }, DIA, agoraD).quantidade, 0.8);
  // pelo app (não estrito) a quantidade sem unidade é a do item: 0,5 kg
  assert.equal(D.calcularAjuste(arroz, { acao: 'usei', qtd: 0.5 }, DIA, agoraD).quantidade, 0.5);
  // item contável continua descontando pela IA
  assert.equal(D.calcularAjuste({ item: 'iogurte', quantidade: 4, unidade: 'un', estado: 'tem' }, { acao: 'usei', qtd: 1, estrito: true }, DIA, agoraD).quantidade, 3);
});

test('lugares.aplicarMarcacao: casa e trabalho são um lugar só; id inexistente = null; não muda o original', () => {
  const lugares = [{ id: 'a', tipo: 'residência', papel: 'casa' }, { id: 'b', tipo: 'academia' }, { id: 'c', tipo: 'outro', papel: 'trabalho' }];
  const r = aplicarMarcacao(lugares, 'b', { papel: 'casa' });
  assert.deepEqual(r.lugares.map((l) => [l.id, l.papel || null, l.tipo]), [['a', null, 'residência'], ['b', 'casa', 'residência'], ['c', 'trabalho', 'outro']]);
  assert.equal(lugares[0].papel, 'casa');
  const t = aplicarMarcacao(lugares, 'b', { tipo: 'trabalho', nome: 'Firma' });
  assert.deepEqual(t.lugares.map((l) => l.papel || null), ['casa', 'trabalho', null]);
  assert.equal(aplicarMarcacao(lugares, 'zz', { nome: 'x' }), null);
});

test('atividades.atividadeDeObjeto: lugar pelo id, "aqui" pelo último ponto, erros curtos', () => {
  const v = { nome: 'Vôlei', dias: [1, 3], inicio: '20:00', fim: '22:00', met: 6, lugarId: 'l1', aqui: false };
  const r = atividadeDeObjeto(perfis[0], v, { id: 'x', dia: DIA });
  assert.deepEqual(r.atividade, { id: 'x', nome: 'Vôlei', dias: [1, 3], inicio: '20:00', fim: '22:00', met: 6, lugar: { lat: -10.1, lon: -20.2, nome: 'Quadra Secreta', raioM: 300 }, criadoEm: DIA, origem: 'app' });
  assert.equal(atividadeDeObjeto(perfis[0], { ...v, lugarId: 'nada' }).erro, 'Lugar não encontrado.');
  assert.match(atividadeDeObjeto(perfis[0], { ...v, lugarId: null, aqui: true }).erro, /localização/);
  assert.equal(atividadeDeObjeto(perfis[0], { ...v, lugarId: null, aqui: true }, { ultimoPonto: { lat: 1, lon: 2 } }).atividade.lugar.lat, 1);
  assert.equal(atividadeDeObjeto(perfis[0], { ...v, lugarId: null }).atividade.lugar, null);
});

test('despensa: duplicatas de {jid, k} separadas sem apagar nada antes do índice único', async () => {
  assert.deepEqual(planoDuplicatasDespensa([{ _id: { jid: 'j', k: 'leite' }, docs: [{ _id: 'x1', atualizadoEm: new Date(1) }, { _id: 'x2', atualizadoEm: new Date(5) }, { _id: 'x3', atualizadoEm: new Date(3) }] }]), [
    { _id: 'x3', k: 'leite#dup-x3' },
    { _id: 'x1', k: 'leite#dup-x1' },
  ]);
  const docs = [
    { _id: 'd1', jid: 'j', k: 'ovo', atualizadoEm: new Date(1) },
    { _id: 'd2', jid: 'j', k: 'ovo', atualizadoEm: new Date(2) },
    { _id: 'd3', jid: 'j', k: 'pao', atualizadoEm: new Date(1) },
  ];
  const indices = [];
  const col = {
    aggregate: () => ({
      toArray: async () => {
        const g = new Map();
        for (const d of docs) g.set(`${d.jid}|${d.k}`, [...(g.get(`${d.jid}|${d.k}`) || []), d]);
        return [...g.values()].filter((l) => l.length > 1).map((l) => ({ _id: { jid: l[0].jid, k: l[0].k }, n: l.length, docs: l.map((d) => ({ _id: d._id, atualizadoEm: d.atualizadoEm })) }));
      },
    }),
    updateOne: async (f, u) => Object.assign(docs.find((d) => d._id === f._id), u.$set),
    createIndex: async (k, o) => indices.push([k, o]),
  };
  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));
  try {
    assert.equal(await garantirIndiceDespensa(col), 1);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(docs.map((d) => d.k), ['ovo#dup-d1', 'ovo', 'pao']);
  assert.equal(docs.length, 3);
  assert.deepEqual(indices, [[{ jid: 1, k: 1 }, { name: 'despensa_item', unique: true }]]);
});

test('silêncio sobrevive ao restart: grava em config e, sem escrita no processo, vale o que o boot leu do Mongo', async () => {
  const gravados = [];
  definirPersistenciaSilencio(async (ms) => gravados.push(ms));
  const ate = Date.parse('2030-03-29T18:00:00Z');
  estado.silencioAte = ate;
  assert.equal(estado.silencioAte, ate);
  assert.equal(estado.config.silencioAte, '2030-03-29T18:00:00.000Z');
  await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual(gravados, [ate]);
  estado.silencioAte = 0;
  assert.equal(estado.silencioAte, 0);
  assert.equal(estado.config.silencioAte, null);
  await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual(gravados, [ate, 0]);
});

test('PUT /perfis ampliado: validarPerfil e aplicarExtrasPerfil (apelido, idade, pedido do plano; cidade, dieta e restrições pelo ATUALIZAR)', () => {
  assert.deepEqual(E.validarPerfil({ cidade: 'Cidade Teste', dieta: 'Vegetariana', restricoes: 'lactose', genero: 'feminino', idade: 30, apelido: 'Fulana', planoPedido: 'orçamento curto' }), { cidade: 'Cidade Teste', dieta: 'Vegetariana', restricoes: 'lactose', genero: 'feminino', apelido: 'Fulana', idade: 30, plano_pedido: 'orçamento curto' });
  assert.deepEqual(E.validarPerfil({ apelido: null }), { sem_apelido: true });
  assert.deepEqual(E.validarPerfil({ semApelido: true }), { sem_apelido: true });
  assert.throws(() => E.validarPerfil({ idade: 5 }), /idade/);
  assert.throws(() => E.validarPerfil({ apelido: 'x'.repeat(31) }), /apelido/);
  assert.throws(() => E.validarPerfil({ dieta: '   ' }), /dieta vazio/);
  assert.throws(() => E.validarPerfil({ genero: 'robô' }), /genero/);
  assert.throws(() => E.validarPerfil({ fuso: 'Lua/Base' }), /fuso/);
  const p = { jids: ['a'], apelido: 'Velho', idade: 30, planoPedido: '', atualizacoes: {} };
  assert.deepEqual(E.aplicarExtrasPerfil(p, { apelido: 'Novo', idade: 31, plano_pedido: 'x' }, DIA, null), { jids: ['a'], atualizacoes: { idade: DIA }, apelido: 'Novo', semApelido: false, idade: 31, planoPedido: 'x' });
  assert.deepEqual(E.aplicarExtrasPerfil(p, { sem_apelido: true }, DIA, null), { jids: ['a'], atualizacoes: {}, apelido: '', semApelido: true });
  assert.equal(E.aplicarExtrasPerfil(p, { apelido: 'Velho', idade: 30 }, DIA, null), null);
  // o patch do ATUALIZAR (cidade, dieta) segue junto
  assert.deepEqual(E.aplicarExtrasPerfil(p, { cidade: 'X' }, DIA, { jids: ['a'], cidade: 'X', atualizacoes: { cidade: DIA } }), { jids: ['a'], cidade: 'X', atualizacoes: { cidade: DIA } });
});

test('validarConfig e montarConfig: silêncio por minutos ou ISO, limite de 7 dias, voltar a falar', () => {
  const agoraMs = AGORA.getTime();
  assert.deepEqual(M.validarConfig({ silencioMin: 0 }, { agoraMs }), { silencioAteMs: 0 });
  assert.deepEqual(M.validarConfig({ silencioAte: '2030-03-29T16:00:00Z' }, { agoraMs }), { silencioAteMs: Date.parse('2030-03-29T16:00:00Z') });
  assert.deepEqual(M.validarConfig({ silencioAte: '2030-03-01T00:00:00Z' }, { agoraMs }), { silencioAteMs: 0 }); // no passado = falar
  assert.throws(() => M.validarConfig({ silencioAte: '2030-05-01T00:00:00Z' }, { agoraMs }), /7 dias/);
  assert.throws(() => M.validarConfig({ vozLigada: 'sim' }, { agoraMs }), /vozLigada/);
  assert.throws(() => M.validarConfig({}, { agoraMs }), /nada/);
  assert.deepEqual(M.montarConfig({ config: {}, silencioAteMs: agoraMs - 1, agoraMs }), { vozLigada: true, silencioAte: null, silencioAtivo: false, nomeBot: 'Nutri', podeEditar: false });
});
