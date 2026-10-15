// Fase 6: as rotas GET /perfis/:id/sono, /energia e /atividade (api.js) num Express de verdade em 127.0.0.1, com a busca
// e a autenticação injetadas (sem Mongo): ?dia= padrão hoje, até 90 dias atrás, 400 no futuro ou fora do formato, 404 de
// perfil, e o JSON dos montadores. Dados fictícios.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { criarApi } = await import('../api.js');
const M = await import('../api-montadores.js');
const { somarDias } = await import('../progresso.js');

const AGORA = new Date('2030-03-29T15:00:00Z'); // 12:00 em São Paulo
const DIA = '2030-03-29';
const ID = 'cccccccccccccccccccccccc';
const perfis = [{ _id: ID, nome: 'Pessoa C', jids: ['c@s.whatsapp.net'], fuso: 'America/Sao_Paulo', objetivo: 'emagrecer', peso: 70, altura: 165, genero: 'feminino' }]; // sem idade: o cadastro não grava esse campo

function saudeC() {
  const sonos = [];
  const atividades = [];
  for (let i = 9; i >= 0; i--) {
    const d = somarDias(DIA, -i);
    sonos.push({ dia: d, inicio: `${somarDias(d, -1)} 23:15`, fim: `${d} 06:45`, leve: 250, profundo: 80, rem: 90, acordado: 30, sessoes: 1, principal: 420, total: 420, fcMedia: 58, hrv: 35 });
    atividades.push({ dia: d, passos: 7500, calorias: 2200, fcRepouso: 58, minAtivos: 40, treinos: [] });
  }
  return { sonos, atividades, pesos: [], ultimoEnvio: new Date('2030-03-29T14:30:00Z') };
}

const chamadas = [];
const dados = {
  listarPerfis: async () => perfis,
  saudeDe: async (perfil) => (chamadas.push(perfil.nome), saudeC()),
};
const auth = {
  semTokenBloqueado: () => false,
  registrarSemToken: () => {},
  autenticar: async (t) => (t === 'token-de-teste' ? { _id: 'aparelho' } : null),
};

let base;
let servidor;
before(async () => {
  const app = express();
  app.use('/api/v1', criarApi({ auth, dados, agora: () => AGORA, temHevyDe: () => false, ehDonoDaAgendaDe: () => false }));
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor?.close());

const pedir = async (caminho, tk = 'token-de-teste') => {
  const r = await fetch(`${base}/api/v1${caminho}`, { headers: tk ? { authorization: `Bearer ${tk}` } : {} });
  return { status: r.status, corpo: await r.json() };
};

test('GET /sono: padrão hoje; o JSON é o do montarSono; ?dia= antigo e o limite de 90 dias', async () => {
  let r = await pedir(`/perfis/${ID}/sono`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, JSON.parse(JSON.stringify(M.montarSono({ saude: saudeC(), dia: DIA }))));
  assert.equal(r.corpo.dia, DIA);
  assert.ok(r.corpo.nota >= 0 && r.corpo.nota <= 100);
  assert.deepEqual([r.corpo.inicio, r.corpo.fim, r.corpo.dormidoMin], ['23:15', '06:45', 420]);
  r = await pedir(`/perfis/${ID}/sono?dia=${somarDias(DIA, -3)}`);
  assert.deepEqual([r.status, r.corpo.dia], [200, somarDias(DIA, -3)]);
  r = await pedir(`/perfis/${ID}/sono?dia=${somarDias(DIA, -90)}`);
  assert.equal(r.status, 200);
  r = await pedir(`/perfis/${ID}/sono?dia=${somarDias(DIA, -91)}`);
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'dia_invalido']);
  r = await pedir(`/perfis/${ID}/sono?dia=${somarDias(DIA, 1)}`);
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'dia_invalido']);
  r = await pedir(`/perfis/${ID}/sono?dia=abc`);
  assert.deepEqual([r.status, r.corpo.erro.codigo], [400, 'dia_invalido']);
});

test('GET /energia: nota, rótulo, partes, fatores e semana do montarEnergia', async () => {
  const r = await pedir(`/perfis/${ID}/energia`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, JSON.parse(JSON.stringify(M.montarEnergia({ perfil: perfis[0], saude: saudeC(), dia: DIA }))));
  assert.equal(r.corpo.fatores.length, 8);
  assert.equal(r.corpo.semana.length, 7);
  assert.ok(Number.isInteger(r.corpo.nota));
});

test('GET /atividade: hoje com a hora do último envio na basal; metas padrão; Mifflin sem idade no perfil = estimada', async () => {
  const r = await pedir(`/perfis/${ID}/atividade`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, JSON.parse(JSON.stringify(M.montarAtividade({ perfil: perfis[0], saude: saudeC(), dia: DIA, hoje: DIA, horaAgora: '12:00' }))));
  // perfil real não tem idade: 30 anos. Basal 700 + 1031,25 − 150 − 161 = 1420; último envio 11:30 locais:
  // 2200 − 1420 × 690/1440 = 1520
  assert.deepEqual([r.corpo.passos, r.corpo.minAtivos, r.corpo.kcalAtivas, r.corpo.kcalAtivasEstimada, r.corpo.metaPassos], [7500, 40, 1520, true, 8000]);
  const ontem = await pedir(`/perfis/${ID}/atividade?dia=${somarDias(DIA, -1)}`);
  assert.equal(ontem.corpo.kcalAtivas, 2200 - 1420); // dia fechado: basal inteira
  // com idade, altura e gênero conhecidos a basal deixa de ser estimada (caminho que o cadastro ainda não usa)
  assert.deepEqual(M.kcalBasal({ peso: 70, altura: 165, idade: 40, genero: 'feminino' }), { kcal: 1370, estimada: false });
});

test('fatores FC/VFC: hoje e o histórico de 14 dias vêm da mesma medida (média do sono não se compara com a FC de repouso)', () => {
  const sonos = [];
  const atividades = [];
  for (let i = 14; i >= 0; i--) {
    const d = somarDias(DIA, -i);
    sonos.push({ dia: d, inicio: `${somarDias(d, -1)} 23:00`, fim: `${d} 07:00`, leve: 300, profundo: 90, rem: 90, acordado: 0, sessoes: 1, principal: 480, total: 480, ...(i === 0 ? { fcMedia: 58, hrv: 30 } : {}) });
    atividades.push({ dia: d, passos: 8000, fcRepouso: i === 0 ? 51 : 50, hrv: 40, treinos: [] });
  }
  // logo depois do deploy: só hoje tem a média do sono; a comparação fica na FC de repouso (51 contra 50 = bom)
  let f = M.fatoresSono({ sonos, atividades, dia: DIA });
  assert.deepEqual(['fc_sono', 'vfc_sono'].map((id) => { const x = f.find((y) => y.id === id); return [x.valor, x.nivel]; }), [['51 bpm', 'bom'], ['40 ms', 'excelente']]);
  // com 3+ noites de média do sono, ela passa a valer, contra as médias do sono
  for (const s of sonos.slice(-4, -1)) Object.assign(s, { fcMedia: 60, hrv: 30 });
  f = M.fatoresEnergia({ sonos, atividades, dia: DIA });
  assert.deepEqual(['fc_sono', 'vfc_sono'].map((id) => { const x = f.find((y) => y.id === id); return [x.valor, x.nivel]; }), [['58 bpm', 'excelente'], ['30 ms', 'excelente']]);
});

test('treinos em caixas: o dia da sessão é o do fuso da pessoa (treino às 22:00 não vira o dia UTC seguinte)', () => {
  const sessao = (inicio, kg) => ({ titulo: 'Peito', inicio, fim: new Date(Date.parse(inicio) + 3600_000).toISOString(), exercicios: [{ title: 'Supino', exercise_template_id: 'x', sets: [{ type: 'normal', weight_kg: kg, reps: 8 }] }] });
  // sábados 16/03 e 23/03 às 22:00 em São Paulo = 01:00Z de domingo
  const caixas = M.treinosPorTitulo({ sessoes: [sessao('2030-03-17T01:00:00.000Z', 50), sessao('2030-03-24T01:00:00.000Z', 52.5)], dia: '2030-03-23', fuso: 'America/Sao_Paulo' });
  assert.equal(caixas.length, 1);
  assert.equal(caixas[0].ultimaData, '2030-03-23');
  assert.deepEqual(caixas[0].dias, ['Sáb']);
  assert.deepEqual(caixas[0].exercicios[0].historico.map((h) => h.dia), ['2030-03-16', '2030-03-23']);
  assert.equal(caixas[0].exercicios[0].ultimoKg, 52.5);
});

test('fase 6: sem token = 401; perfil inexistente = 404; a busca é pelo perfil do :id', async () => {
  let r = await pedir(`/perfis/${ID}/sono`, null);
  assert.deepEqual([r.status, r.corpo.erro.codigo], [401, 'sem_token']);
  r = await pedir('/perfis/dddddddddddddddddddddddd/energia');
  assert.deepEqual([r.status, r.corpo.erro.codigo], [404, 'perfil_nao_encontrado']);
  assert.ok(chamadas.every((n) => n === 'Pessoa C'));
  assert.ok(chamadas.length >= 3);
});
