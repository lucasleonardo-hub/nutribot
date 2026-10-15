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

// ---------- fase 7: oxigênio, temperatura da pele, distância e kcal ativas oficiais (permissões opcionais) ----------
/** A mesma saúde de saudeC, com o que o coletor 2.7 manda quando a pessoa libera as quatro permissões novas. */
function saudeF7() {
  const s = saudeC();
  const noite = s.sonos.find((x) => x.dia === DIA);
  noite.spo2 = { media: 94.6, min: 88, minutosAbaixo90: 4 };
  noite.temperatura = { media: 34.1, delta: -0.62 };
  const hoje = s.atividades.find((x) => x.dia === DIA);
  Object.assign(hoje, { distanciaM: 4812, kcalAtivas: 430, porHora: { passos: Array.from({ length: 24 }, (_, h) => 300 + h * 10), kcal: Array.from({ length: 24 }, (_, h) => 90 + h), kcalAtivas: Array.from({ length: 24 }, (_, h) => (h === 18 ? 200 : 10)) } });
  return s;
}

test('fase 7 montarSono: oxigênio e temperatura só quando vieram, cada um com o seu fator no fim', () => {
  const s = M.montarSono({ saude: saudeF7(), dia: DIA });
  assert.deepEqual(s.spo2, { media: 94.6, min: 88, minutosAbaixo90: 4 });
  assert.deepEqual(s.temperatura, { media: 34.1, delta: -0.62 });
  assert.equal(s.fatores.length, 9);
  assert.deepEqual(s.fatores.slice(-2).map((f) => [f.id, f.nome, f.valor, f.nivel]), [
    ['spo2', 'Oxigênio no sangue', '94,6 %', 'bom'],
    ['temperatura', 'Temperatura da pele', '−0,6 °C', 'bom'],
  ]);
  assert.ok(s.fatores.every((f) => f.explicacao.length > 10 && f.explicacao.length < 70 && !/[*_~]/.test(f.explicacao)));
  // a nota não muda com os dados novos (eles são informação, não parte da conta)
  assert.equal(s.nota, M.montarSono({ saude: saudeC(), dia: DIA }).nota);
  // envio antigo ou noite sem os dados: as chaves não existem e os 7 fatores ficam como antes
  const antigo = M.montarSono({ saude: saudeC(), dia: DIA });
  for (const k of ['spo2', 'temperatura']) assert.equal(k in antigo, false, k);
  assert.equal(antigo.fatores.length, 7);
  const ontem = M.montarSono({ saude: saudeF7(), dia: somarDias(DIA, -1) });
  assert.equal('spo2' in ontem, false);
});

test('fase 7 fatores de oxigênio e temperatura: os cortes de nível', () => {
  const ox = (media, minutosAbaixo90) => M.fatorOxigenio({ media, min: null, minutosAbaixo90 })?.nivel;
  assert.deepEqual([ox(97, 0), ox(95, 1), ox(95, 3), ox(94, 5), ox(93, 10), ox(92, 20), ox(90, 0)], ['excelente', 'excelente', 'bom', 'bom', 'razoavel', 'atencao', 'atencao']);
  assert.equal(M.fatorOxigenio({ media: 96, min: 94, minutosAbaixo90: null }).nivel, 'excelente'); // sem os minutos: conta zero
  assert.equal(M.fatorOxigenio(null), null);
  const tp = (delta) => M.fatorTemperatura({ media: null, delta });
  assert.deepEqual([0.2, -0.5, 0.9, -1.4, 2].map((d) => tp(d).nivel), ['excelente', 'excelente', 'bom', 'razoavel', 'atencao']);
  assert.deepEqual([tp(0.6).valor, tp(-0.04).valor, tp(0).valor], ['+0,6 °C', '+0 °C', '+0 °C']);
  assert.equal(M.fatorTemperatura(null), null);
  assert.equal(M.temperaturaDaNoite({ media: 34 }), null); // sem delta não há diferença do normal
  assert.deepEqual(M.spo2DaNoite({ media: 95, min: '', minutosAbaixo90: null }), { media: 95, min: null, minutosAbaixo90: null });
});

test('fase 7 montarAtividade: kcal ativas oficiais vencem a estimativa; distância e ativas por hora só quando vieram', () => {
  const a = M.montarAtividade({ perfil: perfis[0], saude: saudeF7(), dia: DIA, hoje: DIA, horaAgora: '12:00' });
  assert.deepEqual([a.kcalAtivas, a.kcalAtivasEstimada, a.distanciaKm, a.kcalTotal], [430, false, 4.81, 2200]);
  assert.equal(a.porHora.kcalAtivas[18], 200);
  assert.equal(a.porHora.passos.length, 24);
  assert.equal(a.semana[6].kcalPct, 0.86); // a semana usa as oficiais também (430 / 500)
  // o anel do Hoje é o mesmo número
  assert.equal(M.anelAtividade({ perfil: perfis[0], saude: saudeF7(), dia: DIA, hoje: DIA, horaAgora: '12:00' }).kcalAtivas, 430);
  // dia sem os dados novos (ontem): a estimativa de antes, sem as chaves novas
  const ontem = M.montarAtividade({ perfil: perfis[0], saude: saudeF7(), dia: somarDias(DIA, -1), hoje: DIA, horaAgora: '12:00' });
  assert.deepEqual([ontem.kcalAtivas, ontem.kcalAtivasEstimada, 'distanciaKm' in ontem], [2200 - 1420, true, false]);
  // kcal ativas oficiais zero (dia parado) também valem
  const parado = saudeF7();
  parado.atividades.find((x) => x.dia === DIA).kcalAtivas = 0;
  assert.deepEqual(['kcalAtivas', 'kcalAtivasEstimada'].map((k) => M.montarAtividade({ perfil: perfis[0], saude: parado, dia: DIA, hoje: DIA })[k]), [0, false]);
});

test('fase 7 rotas: GET /sono e /atividade devolvem os campos novos do envio guardado', async () => {
  const antes = dados.saudeDe;
  dados.saudeDe = async (perfil) => (chamadas.push(perfil.nome), saudeF7());
  try {
    let r = await pedir(`/perfis/${ID}/sono`);
    assert.equal(r.status, 200);
    assert.deepEqual([r.corpo.spo2.minutosAbaixo90, r.corpo.temperatura.delta, r.corpo.fatores.length], [4, -0.62, 9]);
    r = await pedir(`/perfis/${ID}/atividade`);
    assert.deepEqual([r.corpo.distanciaKm, r.corpo.kcalAtivas, r.corpo.kcalAtivasEstimada, r.corpo.porHora.kcalAtivas.length], [4.81, 430, false, 24]);
  } finally {
    dados.saudeDe = antes;
  }
});

test('fase 6: sem token = 401; perfil inexistente = 404; a busca é pelo perfil do :id', async () => {
  let r = await pedir(`/perfis/${ID}/sono`, null);
  assert.deepEqual([r.status, r.corpo.erro.codigo], [401, 'sem_token']);
  r = await pedir('/perfis/dddddddddddddddddddddddd/energia');
  assert.deepEqual([r.status, r.corpo.erro.codigo], [404, 'perfil_nao_encontrado']);
  assert.ok(chamadas.every((n) => n === 'Pessoa C'));
  assert.ok(chamadas.length >= 3);
});
