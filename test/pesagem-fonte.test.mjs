// Pesagem por fonte (fase 0, P1): uma pesagem por {jid, dia, fonte} no banco e o valor do dia consolidado em código.
// Até 13/10 o envio do relógio (a cada 15 min, 60 dias) regravava {jid, dia} e apagava o peso dito no chat e o do exame.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { fonteDaPesagem, filtroPesagem, consolidarDia, pesagensPorDia, validarPesagens, FONTES_PESAGEM } = await import('../progresso.js');
const { configGrafico } = await import('../graficos.js');

const D = '2030-03-10';
const quase = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---------- banco de mentira: replaceOne com upsert, do jeito que o Mongo casa o filtro ----------
// (igualdade simples; { $in: [...] } com null casa campo ausente, como no Mongo)
const casa = (doc, filtro) =>
  Object.entries(filtro).every(([k, v]) => (v && typeof v === 'object' && Array.isArray(v.$in) ? v.$in.includes(doc[k] ?? null) : doc[k] === v));
function replaceOne(banco, filtro, doc) {
  const i = banco.findIndex((d) => casa(d, filtro));
  if (i >= 0) banco[i] = doc;
  else banco.push(doc);
}
/** O que mongo.registrarPesagem faz, sobre o banco de mentira. */
function gravar(banco, { jid, dia, peso, gordura, fonte, hora }) {
  const f = fonteDaPesagem(fonte);
  const doc = { jid, dia, peso, fonte: f };
  if (gordura != null) doc.gordura = gordura;
  if (hora) doc.hora = hora;
  replaceOne(banco, filtroPesagem({ jid, dia, fonte: f }), doc);
}

test('fonte da pesagem: sem fonte (doc antigo, chat) é digitada; as conhecidas ficam; app reservado', () => {
  assert.deepEqual(FONTES_PESAGEM, ['relogio', 'documento', 'digitada', 'app']);
  assert.equal(fonteDaPesagem(undefined), 'digitada');
  assert.equal(fonteDaPesagem(null), 'digitada');
  assert.equal(fonteDaPesagem(''), 'digitada');
  assert.equal(fonteDaPesagem('conversa'), 'digitada');
  assert.equal(fonteDaPesagem('relogio'), 'relogio');
  assert.equal(fonteDaPesagem('documento'), 'documento');
  assert.equal(fonteDaPesagem('app'), 'app');
  // filtro: a digitada casa também o doc antigo sem fonte; as outras, só a própria fonte
  assert.deepEqual(filtroPesagem({ jid: 'j', dia: D, fonte: 'digitada' }), { jid: 'j', dia: D, fonte: { $in: [null, 'digitada'] } });
  assert.deepEqual(filtroPesagem({ jid: 'j', dia: D, fonte: 'relogio' }), { jid: 'j', dia: D, fonte: 'relogio' });
  assert.deepEqual(filtroPesagem({ jid: 'j', dia: D }), { jid: 'j', dia: D, fonte: { $in: [null, 'digitada'] } });
});

test('banco: o envio do relógio não apaga a digitada nem a do exame; a digitada nova troca o doc antigo sem fonte', () => {
  const banco = [{ jid: 'j', dia: D, peso: 76 }]; // doc antigo, sem fonte (o peso que a Ale disse no chat em setembro)
  gravar(banco, { jid: 'j', dia: D, peso: 75.4, fonte: 'relogio', hora: '07:10', gordura: 18 });
  assert.equal(banco.length, 2, 'o relógio criou o dele, sem tocar no antigo');
  gravar(banco, { jid: 'j', dia: D, peso: 75.8 }); // chat de novo, sem fonte: troca o antigo
  assert.equal(banco.length, 2);
  assert.deepEqual(banco.find((d) => d.fonte === 'digitada'), { jid: 'j', dia: D, peso: 75.8, fonte: 'digitada' });
  assert.equal(banco.some((d) => d.fonte == null), false, 'grava sempre com fonte explícita');
  gravar(banco, { jid: 'j', dia: D, peso: 75.2, fonte: 'documento', gordura: 19.5 });
  // o app manda de novo (a cada 15 min, 60 dias): só a do relógio é regravada
  for (let i = 0; i < 4; i++) gravar(banco, { jid: 'j', dia: D, peso: 75.5, fonte: 'relogio', hora: '07:10', gordura: 18.1 });
  assert.equal(banco.length, 3);
  assert.equal(banco.find((d) => d.fonte === 'digitada').peso, 75.8);
  assert.equal(banco.find((d) => d.fonte === 'documento').peso, 75.2);
  assert.equal(banco.find((d) => d.fonte === 'relogio').peso, 75.5);
  // outra pessoa e outro dia não se misturam
  gravar(banco, { jid: 'k', dia: D, peso: 60, fonte: 'relogio' });
  gravar(banco, { jid: 'j', dia: '2030-03-11', peso: 75.6, fonte: 'relogio' });
  assert.equal(banco.length, 5);
});

test('valor do dia: chat e relógio concordando (até 0,5 kg) viram a média; a gordura segue as que têm gordura', () => {
  const c = consolidarDia([
    { dia: D, peso: 75.4, fonte: 'relogio', hora: '07:10', gordura: 18 },
    { dia: D, peso: 75.8, fonte: 'digitada' },
  ]);
  assert.ok(quase(c.peso, 75.6), c.peso);
  assert.equal(c.n, 2);
  assert.equal(c.gordura, 18);
  assert.equal(c.fonte, 'relogio');
  assert.deepEqual(c.fontes, ['relogio', 'digitada']);
  assert.equal(c.hora, '07:10');
  assert.deepEqual(c.descartadas, []);
  assert.deepEqual(c.avisos, []);
});

test('valor do dia: chat e relógio discordando (> 0,5 kg), vence o relógio e a digitada fica marcada', () => {
  const c = consolidarDia([
    { dia: D, peso: 76.6, fonte: 'digitada' },
    { dia: D, peso: 75.4, fonte: 'relogio', hora: '07:10', gordura: 18 },
  ]);
  assert.equal(c.peso, 75.4);
  assert.equal(c.n, 1);
  assert.equal(c.fonte, 'relogio');
  assert.equal(c.gordura, 18);
  assert.equal(c.descartadas.length, 1);
  assert.equal(c.descartadas[0].fonte, 'digitada');
  assert.equal(c.descartadas[0].peso, 76.6);
  assert.match(c.descartadas[0].motivo, /discorda da balança/);
  assert.ok(c.avisos.some((a) => /pesagem digitada \(76,6 kg\) ficou de fora: vale a do relógio \(75,4 kg\)/.test(a)), c.avisos.join(' | '));
  // doc antigo sem fonte é tratado como digitada
  const legado = consolidarDia([{ dia: D, peso: 76.6 }, { dia: D, peso: 75.4, fonte: 'relogio', hora: '07:10' }]);
  assert.equal(legado.peso, 75.4);
  assert.equal(legado.descartadas[0].fonte, 'digitada');
});

test('valor do dia: documento (bioimpedância) e relógio; e documento contra digitada', () => {
  const junto = consolidarDia([
    { dia: D, peso: 75.0, fonte: 'documento', gordura: 20 },
    { dia: D, peso: 75.3, fonte: 'relogio', hora: '07:00', gordura: 18 },
  ]);
  assert.ok(quase(junto.peso, 75.15), junto.peso);
  assert.equal(junto.gordura, 19); // média das duas que têm gordura e concordam
  assert.equal(junto.fonte, 'relogio');
  const longe = consolidarDia([
    { dia: D, peso: 76.5, fonte: 'documento', gordura: 20 },
    { dia: D, peso: 75.3, fonte: 'relogio', hora: '07:00', gordura: 18 },
  ]);
  assert.equal(longe.peso, 75.3);
  assert.equal(longe.gordura, 18); // a gordura segue a vencedora
  assert.equal(longe.descartadas[0].fonte, 'documento');
  assert.match(longe.descartadas[0].motivo, /discorda da balança/);
  const semRelogio = consolidarDia([
    { dia: D, peso: 77.4, fonte: 'digitada' },
    { dia: D, peso: 76.5, fonte: 'documento', gordura: 20 },
  ]);
  assert.equal(semRelogio.peso, 76.5);
  assert.equal(semRelogio.fonte, 'documento');
  assert.equal(semRelogio.descartadas[0].fonte, 'digitada');
  assert.match(semRelogio.descartadas[0].motivo, /discorda da pesagem do documento/);
});

test('valor do dia: com pesagem da manhã, as de fora da manhã (04h-11h) não entram na média', () => {
  const c = consolidarDia([
    { dia: D, peso: 75.4, fonte: 'relogio', hora: '07:10' },
    { dia: D, peso: 75.7, fonte: 'app', hora: '21:30' }, // concorda, mas é da noite
  ]);
  assert.equal(c.peso, 75.4);
  assert.equal(c.n, 1);
  assert.equal(c.descartadas.length, 1);
  assert.match(c.descartadas[0].motivo, /fora da manhã/);
  // sem nenhuma da manhã, a da noite vale (é o que tem)
  const soNoite = consolidarDia([{ dia: D, peso: 76.2, fonte: 'app', hora: '21:30' }]);
  assert.equal(soNoite.peso, 76.2);
  assert.equal(soNoite.hora, '21:30');
  // digitada sem hora não é "fora da manhã": entra na média se concordar
  const semHora = consolidarDia([{ dia: D, peso: 75.4, fonte: 'relogio', hora: '07:10' }, { dia: D, peso: 75.6, fonte: 'digitada' }]);
  assert.equal(semHora.n, 2);
});

test('valor do dia: pesagem fora do possível (25-300 kg) não é referência nem descarta a digitada válida (revisão F2, M3)', () => {
  // relógio com leitura impossível (balança com erro): a digitada vale, e o relógio fica de fora com o motivo
  const c = consolidarDia([
    { dia: D, peso: 12.3, fonte: 'relogio', hora: '07:10' },
    { dia: D, peso: 76.6, fonte: 'digitada' },
  ]);
  assert.equal(c.peso, 76.6);
  assert.equal(c.fonte, 'digitada');
  assert.equal(c.n, 1);
  assert.equal(c.descartadas.length, 1);
  assert.equal(c.descartadas[0].fonte, 'relogio');
  assert.match(c.descartadas[0].motivo, /fora do possível/);
  // a impossível da manhã também não tira a da noite (a válida é o que tem)
  const noite = consolidarDia([
    { dia: D, peso: 999, fonte: 'relogio', hora: '07:00' },
    { dia: D, peso: 76.2, fonte: 'app', hora: '21:30' },
  ]);
  assert.equal(noite.peso, 76.2);
  // o dia inteiro impossível segue como antes (o validarPesagens descarta o dia)
  const tudo = consolidarDia([{ dia: D, peso: 12.3, fonte: 'relogio', hora: '07:10' }]);
  assert.equal(tudo.peso, 12.3);
  // e a série validada fica com a digitada nesse dia, em vez de perder o dia
  const v = validarPesagens([
    { dia: D, peso: 12.3, fonte: 'relogio', hora: '07:10' },
    { dia: D, peso: 76.6, fonte: 'digitada' },
  ], { dia: D });
  assert.deepEqual(v.pontos.map((p) => p.peso), [76.6]);
  // e o doc do dia que o Mongo devolve (pesagensPorDia, consolidado ANTES da validação) também é o da digitada
  assert.equal(pesagensPorDia([{ jid: 'l', dia: D, peso: 12.3, fonte: 'relogio', hora: '07:10' }, { jid: 'l', dia: D, peso: 76.6, fonte: 'digitada' }])[0].peso, 76.6);
});

test('série: uma pesagem por dia, em ordem, com o que ficou de fora; o progresso lê a série consolidada igual à crua', () => {
  const docs = [
    { jid: 'j', nome: 'Lucas', dia: '2030-03-03', peso: 75.6, fonte: 'digitada' },
    { jid: 'j', nome: 'Lucas', dia: '2030-03-01', peso: 75.0, fonte: 'relogio', hora: '07:00', gordura: 18 },
    { jid: 'j', nome: 'Lucas', dia: '2030-03-02', peso: 75.2, fonte: 'relogio', hora: '06:50' },
    { jid: 'j', nome: 'Lucas', dia: '2030-03-02', peso: 76.9 }, // legado, sem fonte: discorda do relógio
    { jid: 'j', nome: 'Lucas', dia: '2030-03-03', peso: 75.4, fonte: 'relogio', hora: '07:05' },
    { jid: 'j', nome: 'Lucas', dia: '2030-03-01', peso: 74.8, fonte: 'documento', gordura: 19 },
  ];
  const s = pesagensPorDia(docs);
  assert.deepEqual(s.map((p) => p.dia), ['2030-03-01', '2030-03-02', '2030-03-03']);
  assert.ok(quase(s[0].peso, 74.9));
  assert.equal(s[0].gordura, 18.5);
  assert.equal(s[0].jid, 'j');
  assert.equal(s[0].nome, 'Lucas');
  assert.equal(s[1].peso, 75.2);
  assert.equal(s[1].descartadasNoDia.length, 1);
  assert.ok(quase(s[2].peso, 75.5));
  assert.deepEqual(s[2].fontes, ['relogio', 'digitada']);
  // o progresso chega ao mesmo valor por dia lendo a série consolidada (o que o mongo.pesagensDesde devolve) ou a crua
  const crua = validarPesagens(docs, { dia: '2030-03-10' });
  const consolidada = validarPesagens(s, { dia: '2030-03-10' });
  assert.deepEqual(consolidada.pontos.map((p) => [p.dia, Math.round(p.peso * 100) / 100]), crua.pontos.map((p) => [p.dia, Math.round(p.peso * 100) / 100]));
  // e o aviso da digitada que discordou chega nos dois caminhos
  for (const v of [crua, consolidada]) assert.ok(v.avisos.some((a) => /02\/03 a pesagem digitada \(76,9 kg\) ficou de fora/.test(a)), v.avisos.join(' | '));
  assert.equal(consolidada.avisos.filter((a) => /76,9/.test(a)).length, 1, 'aviso uma vez só');
  // o relatório do mês busca o grupo inteiro de uma vez: duas pessoas no mesmo dia não viram uma média
  const grupo = pesagensPorDia([
    { jid: 'j', nome: 'Lucas', dia: '2030-03-01', peso: 75.0, fonte: 'relogio' },
    { jid: 'a', nome: 'Ale', dia: '2030-03-01', peso: 58.0, fonte: 'digitada' },
  ]);
  assert.equal(grupo.length, 2);
  assert.deepEqual(grupo.map((p) => p.peso).sort(), [58, 75]);
});

test('gráfico: plota a série validada (sem libra nem outra pessoa na balança, uma por dia)', () => {
  const cfg = configGrafico({
    nome: 'Lucas Leonardo',
    pesagens: [
      { dia: '2030-03-01', peso: 75 },
      { dia: '2030-03-02', peso: 75.2 },
      { dia: '2030-03-03', peso: 165.8 }, // 75,2 kg em libra
      { dia: '2030-03-04', peso: 75.3, fonte: 'relogio', hora: '07:00' },
      { dia: '2030-03-04', peso: 76.9, fonte: 'digitada' }, // discorda do relógio
    ],
    dia: '2030-03-04',
    dias: 4,
  });
  const peso = cfg.data.datasets.find((d) => d.label === 'Peso (kg)');
  assert.deepEqual(peso.data, [75, 75.2, null, 75.3]);
});
