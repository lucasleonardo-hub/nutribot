import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirHoje, compilarMes, registradasHojeParaPrompt, lerRotuloRefeicao, visaoPeriodo, metaBalanco, gastoAdaptativo, sequenciaDe, placarSemana } from '../resumo.js';
import { ancorasDe, blocoAncoras } from '../taco.js';
import { configGrafico } from '../graficos.js';
import { textoParaFala } from '../voz.js';
import { separarAtualizacao, montarSystem } from '../gemini.js';
import { pedidoDeAudio, semLinhaAtualizar } from '../util.js';
import { duracaoDe } from '../comandos.js';
import { montarCorrecao, DESCULPAS } from '../revisao.js';
import { agruparFotos } from '../mensagens.js';
import { interpretarAbas, resumoSaude, ehPlanilhaSaude, indicadoresRelogio } from '../saude.js';
import { falasDe } from '../gemini.js';

const perfis = [
  { nome: 'Lucas Leonardo', jids: ['a@s'], peso: 73, objetivo: 'hipertrofia' },
  { nome: 'Ale', jids: ['b@s'], peso: 74, objetivo: 'emagrecer', apelido: 'Alezinha' },
];

test('resumirHoje soma o dia por pessoa e mostra quem não registrou', () => {
  const refeicoes = [
    { jid: 'a@s', nome: 'Lucas Leonardo', dia: '2026-09-22', hora: '08:20', minutos: 500, slot: 'cafe', estimativa: { kcal: 400, p: 25, c: 40, g: 12 }, descricao: 'ovos' },
    { jid: 'a@s', nome: 'Lucas Leonardo', dia: '2026-09-22', hora: '12:00', minutos: 720, slot: 'almoco', estimativa: { kcal: 700, p: 45, c: 80, g: 20 } },
    { jid: 'a@s', nome: 'Lucas Leonardo', dia: '2026-09-21', hora: '12:00', minutos: 720, slot: 'almoco', estimativa: { kcal: 999, p: 1, c: 1, g: 1 } }, // ontem: fora
  ];
  const t = resumirHoje(refeicoes, perfis, '2026-09-22');
  assert.match(t, /\*Lucas\* \(2 refeições\)/);
  assert.match(t, /~1100 kcal · Proteína 70 g/);
  assert.match(t, /meta de proteína 117 a 161 g/);
  assert.match(t, /\*Alezinha\*: nada registrado hoje ainda/);
});

test('compilarMes: peso, médias por semana e dias sem registro', () => {
  const dias = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  const refeicoes = [
    { jid: 'a@s', dia: '2026-09-01', slot: 'almoco', estimativa: { kcal: 2000, p: 100, c: 200, g: 60 } },
    { jid: 'a@s', dia: '2026-09-02', slot: 'almoco', estimativa: { kcal: 1000, p: 50, c: 100, g: 30 } },
    { jid: 'a@s', dia: '2026-09-09', slot: 'jantar', estimativa: { kcal: 1500, p: 80, c: 150, g: 40 } },
  ];
  const pesagens = [
    { jid: 'a@s', dia: '2026-09-01', peso: 73 },
    { jid: 'a@s', dia: '2026-09-14', peso: 74.2 },
  ];
  const t = compilarMes(refeicoes, pesagens, perfis, dias);
  assert.match(t, /peso: 73 kg \(09-01\) -> 74\.2 kg \(09-14\) = 1\.2 kg no período/);
  assert.match(t, /semana 1: média\/dia ~1500 kcal · Proteína 75 g/);
  assert.match(t, /semana 2: média\/dia ~1500 kcal/);
  assert.match(t, /3 refeição\(ões\) registrada\(s\); 11 dia\(s\) sem nenhum registro/);
  assert.match(t, /Ale \(objetivo: emagrecer\)\n  - peso: nenhuma pesagem registrada/);
});

test('duracaoDe entende 2h, 30m, 1h30 e minutos soltos', () => {
  assert.equal(duracaoDe('2h'), 2 * 3600_000);
  assert.equal(duracaoDe('30m'), 30 * 60_000);
  assert.equal(duracaoDe('1h30'), 90 * 60_000);
  assert.equal(duracaoDe('90'), 90 * 60_000);
  assert.equal(duracaoDe('abc'), null);
  assert.equal(duracaoDe(''), null);
});

test('registradasHojeParaPrompt: uma linha por pessoa', () => {
  const refeicoes = [
    { jid: 'a@s', dia: '2026-09-23', horaLocal: '06:20', minutos: 380, slot: 'lanche_manha', estimativa: { kcal: 270 } },
    { jid: 'a@s', dia: '2026-09-23', horaLocal: '08:34', minutos: 514, slot: 'cafe', estimativa: { kcal: 470 } },
  ];
  const t = registradasHojeParaPrompt(refeicoes, perfis, '2026-09-23');
  assert.match(t, /- Lucas Leonardo: Lanche da manhã 06:20 \(~270 kcal\); Café da manhã 08:34 \(~470 kcal\)/);
  assert.match(t, /- Ale: nada registrado ainda hoje/);
});

test('montarCorrecao: desculpa no personagem + resposta revisada', () => {
  const t = montarCorrecao('  🕐 Refeição: Almoço\n🔥 Estimativa: ~600 kcal  ', DESCULPAS[0]);
  assert.equal(t, `${DESCULPAS[0]}\n\n🕐 Refeição: Almoço\n🔥 Estimativa: ~600 kcal`);
  assert.ok(DESCULPAS.every((d) => d.length > 20));
});

test('saude: interpreta as 3 abas do Health Data Export e resume', () => {
  const abas = {
    Activity: [
      ['Date', 'Source(s)', 'Timezone', 'Steps', 'Distance (m)', 'Elevation (m)', 'Floors climbed', 'Total Calories (kcal)', 'Active Calories (kcal)', 'Power min (W)', 'Power max (W)', 'Power avg (W)', 'Speed min (m/s)', 'Speed max (m/s)', 'Speed avg (m/s)', 'VO2 max min (ml/min/kg)', 'VO2 max max (ml/min/kg)', 'VO2 max avg (ml/min/kg)', 'Wheelchair pushes', 'Start Date/Time', 'Exercise Name', 'Duration (min)', 'Exercise Calories (kcal)', 'Exercise Distance (m)'],
      ['2026-09-16', 'com.fitbit.FitbitMobile', 'America/Sao_Paulo', '7828', '8656,686', '', '', '3444'],
      ['2026-09-16', 'com.hevy', 'America/Sao_Paulo', '', '', '', '', '3444', '', '', '', '', '', '', '', '', '', '', '', '2026-09-16 07:21:28', 'Body Pump', '210'],
      ['2026-09-16', 'com.sec.android.app.shealth', 'America/Sao_Paulo', '9001', '1407,286987', '', '', '3444', '', '', '', '', '0', '1,669', '1,426', '', '', '', '', '2026-09-16 06:53:48', '79 - Walking', '16', '', '1407,286987'],
      ['2026-09-17', 'com.sec.android.app.shealth', 'America/Sao_Paulo', '9822', '', '', '', '2721'],
    ],
    'Body Measurements': [
      ['Date/Time', 'Source(s)', 'Timezone', 'Weight (kg)', 'Body Fat (%)', 'Bone mass (kg)', 'Height (m)', 'Lean body mass (kg)'],
      ['2026-09-16 07:10:52', 'com.sec.android.app.shealth', 'America/Sao_Paulo', '75.70', '19.37', '', '2026-09-16 07:10:52=1.810'],
      ['2026-09-17 07:07:21', 'com.sec.android.app.shealth', 'America/Sao_Paulo', '75.20', '19.33', '', '2026-09-17 07:07:21=1.810'],
    ],
    Sleep: [
      ['Date', 'Source(s)', 'Timezone', 'Start Time', 'End Time', 'Light Sleep (min)', 'Deep Sleep (min)', 'REM Sleep (min)', 'Awake (min)'],
      ['2026-09-17', 'com.sec.android.app.shealth', 'America/Sao_Paulo', '2026-09-17 00:13:00', '2026-09-17 05:50:00', '159', '87', '51', '19'],
      ['2026-09-17', 'com.sec.android.app.shealth', 'America/Sao_Paulo', '2026-09-17 14:00:00', '2026-09-17 14:30:00', '30', '0', '0', '0'],
    ],
  };
  const d = interpretarAbas(abas);
  assert.equal(d.pesos.length, 2);
  assert.deepEqual({ peso: d.pesos[1].peso, gordura: d.pesos[1].gordura, altura: d.pesos[1].altura }, { peso: 75.2, gordura: 19.33, altura: 1.81 });
  assert.equal(d.sonos[0].total, 159 + 87 + 51 + 30);
  assert.equal(d.sonos[0].sessoes, 2);
  assert.equal(d.atividades[0].passos, 9001); // maior entre as fontes
  assert.deepEqual(d.atividades[0].treinos.map((t) => t.nome), ['Body Pump', 'Walking']);
  const r = resumoSaude(d, { hoje: '2026-09-17', nomePlanilha: 'Saude-Galaxy-Watch' });
  assert.match(r, /- 17\/09: 75,2 kg · gordura 19,3% \(massa gorda ~14,5 kg, magra ~60,7 kg\)/);
  assert.match(r, /altura 1,81 m · IMC 23,0/);
  assert.match(r, /- 17\/09: 5h27 dormindo \(leve 3h09, profundo 1h27, REM 0h51, acordado 19 min\) · deitou 00:13, levantou 05:50/);
  assert.match(r, /- 16\/09: 9\.001 passos · gasto total 3\.444 kcal · treino: Body Pump \(210 min\), Walking \(16 min\)/);
  assert.ok(r.length < 1600, `resumo grande demais: ${r.length}`);
  assert.match(r, /deita em média 00:13/);
  assert.equal(ehPlanilhaSaude({ name: 'Saude-Galaxy-Watch', mimeType: 'application/vnd.google-apps.spreadsheet' }), true);
  assert.equal(ehPlanilhaSaude({ name: 'Orçamento', mimeType: 'application/vnd.google-apps.spreadsheet' }), false);
  const ind = indicadoresRelogio(d, { hoje: '2026-09-17' });
  assert.equal(ind.peso, 75.2);
  assert.deepEqual(ind.ultimaNoite, { dia: '2026-09-17', min: 327, deitou: '00:13', levantou: '05:50' });
  assert.equal(ind.passosMedia, 9412);
  assert.equal(ind.treinos7d, 1); // Body Pump; caminhada não conta
  assert.match(ind.linha, /^peso 75,2 kg com 19,3% de gordura em 17\/09; última noite \(17\/09\) 5h27 dormindo, deitou 00:13 e levantou 05:50; ~9\.412 passos\/dia e 1 treino/);
});

test('lerRotuloRefeicao: só o nome da refeição vira rótulo; frase de comida não', () => {
  assert.equal(lerRotuloRefeicao('Lanche da tarde'), 'lanche');
  assert.equal(lerRotuloRefeicao('era o almoço!'), 'almoco');
  assert.equal(lerRotuloRefeicao('isso foi meu café da manhã'), 'cafe');
  assert.equal(lerRotuloRefeicao('janta'), 'jantar');
  assert.equal(lerRotuloRefeicao('pré treino'), 'lanche_manha');
  assert.equal(lerRotuloRefeicao('pós-treino', '07:10'), 'lanche_manha');
  assert.equal(lerRotuloRefeicao('pós-treino', '19:10'), 'lanche');
  assert.equal(lerRotuloRefeicao('almocei arroz e feijão'), null);
  assert.equal(lerRotuloRefeicao('o lanche foi um iogurte'), null);
  assert.equal(lerRotuloRefeicao('qual o melhor lanche?'), null);
});

test('visaoPeriodo: 7/30 dias, peso e balanço energético contra o objetivo', () => {
  const perfil = { nome: 'Lucas', peso: 77, objetivo: 'hipertrofia' };
  const refeicoes = [
    { dia: '2026-09-22', estimativa: { kcal: 1800, p: 100 } },
    { dia: '2026-09-22', estimativa: { kcal: 400, p: 30 } },
    { dia: '2026-09-23', estimativa: { kcal: 1650, p: 90 } },
    { dia: '2026-09-24', estimativa: { kcal: 620, p: 18 } },
    { dia: '2026-09-01', estimativa: { kcal: 2500, p: 150 } },
  ];
  const pesagens = [{ dia: '2026-09-17', peso: 75.2 }, { dia: '2026-09-23', peso: 77 }];
  const gastos = { '2026-09-22': 2618, '2026-09-23': 2030 };
  const v = visaoPeriodo({ refeicoes, pesagens, perfil, dia: '2026-09-24', gastos });
  assert.match(v, /ÚLTIMOS 7 DIAS: 3 de 7 dias com registro · média nos dias registrados 1\.490 kcal e proteína 79 g\/dia \(meta 123 a 169 g\) · peso 77 kg \(23\/09\)/);
  assert.match(v, /ÚLTIMOS 30 DIAS: 4 de 30 dias com registro .* · peso 75,2 kg \(17\/09\) -> 77 kg \(23\/09\)/);
  assert.match(v, /hoje até agora comeu 620 kcal \(o gasto de hoje só chega quando o relógio sincronizar\)/);
  assert.match(v, /último dia completo \(23\/09\): comeu 1\.650 kcal, gastou 2\.030 kcal -> −380 kcal/);
  assert.match(v, /média dos últimos 2 dias com os dois dados: −399 kcal\/dia; objetivo "hipertrofia" pede superávit de 250 a 500 kcal\/dia -> ABAIXO do alvo/);
  assert.equal(visaoPeriodo({ refeicoes: [], pesagens: [], perfil, dia: '2026-09-24' }), '');
  assert.deepEqual(metaBalanco('emagrecer e reduzir medidas').rotulo, 'déficit de 300 a 600 kcal/dia');
});

test('falasDe: falas da pessoa + só as respostas da bot dirigidas a ela', () => {
  const h = [
    { nome: 'Lucas', tipo: 'foto', texto: 'meu almoço' },
    { nome: 'Dona Benta', tipo: 'bot', texto: 'análise do Lucas: frango e hipercalórico' },
    { nome: 'Heitor', tipo: 'texto', texto: 'falafel' },
    { nome: 'Dona Benta', tipo: 'bot', texto: 'análise do Heitor: falafel' },
    { nome: 'Ale', tipo: 'texto', texto: 'iogurte' },
    { nome: 'Dona Benta', tipo: 'bot', texto: 'análise da Ale' },
    { nome: 'Heitor', tipo: 'texto', texto: 'valeu' },
  ];
  assert.deepEqual(falasDe(h, 'Heitor').map((m) => m.texto), ['falafel', 'análise do Heitor: falafel', 'valeu']);
  assert.deepEqual(falasDe(h, 'Ale').map((m) => m.texto), ['iogurte', 'análise da Ale']);
});

test('taco: reconhece porções declaradas e devolve valores oficiais', () => {
  const a = ancorasDe('almocei 200g de arroz, 150 g de feijão preto, 2 ovos cozidos e uma sobrecoxa de 100g, com salada');
  const nomes = a.map((x) => `${x.nome}|${x.gramas}`);
  assert.ok(nomes.includes('Arroz, tipo 1, cozido|200'), nomes.join(' ; '));
  assert.ok(nomes.includes('Feijão, preto, cozido|150'), nomes.join(' ; '));
  assert.ok(nomes.includes('Ovo, de galinha, inteiro, cozido/10minutos|100'), nomes.join(' ; '));
  assert.ok(nomes.includes('Frango, sobrecoxa, com pele, assada|100'), nomes.join(' ; '));
  const arroz = a.find((x) => x.nome.startsWith('Arroz'));
  assert.equal(arroz.kcal, 257);
  const b = ancorasDe('3 fatias de pão integral com hommus e 1 scoop de whey');
  assert.ok(b.some((x) => x.nome.startsWith('Pão, trigo, forma, integral') && x.gramas === 75));
  assert.ok(b.some((x) => /Whey protein concentrado/.test(x.nome) && x.gramas === 30 && x.p === 23.4));
  assert.equal(ancorasDe('bom dia, como você está?').length, 0);
  assert.match(blocoAncoras('200 g de arroz'), /Arroz, tipo 1, cozido, 200 g: 257 kcal · P 5 g · C 56,2 g/);
  assert.match(blocoAncoras('um prato de arroz'), /por 100 g, porção NÃO informada/);
});

test('gastoAdaptativo: calibrado com 10 dias completos e peso em queda', () => {
  const perfil = { objetivo: 'emagrecer', peso: 80 };
  const refeicoes = [];
  const pesagens = [];
  // 14 dias fechados antes de 2026-09-24 (10 a 23/09): 2.000 kcal/dia em 3 refeições; peso caindo 0,5 kg/semana
  for (let i = 0; i < 14; i++) {
    const d = `2026-09-${String(10 + i).padStart(2, '0')}`;
    for (let k = 0; k < 3; k++) refeicoes.push({ dia: d, estimativa: { kcal: 2000 / 3, p: 40 } });
    pesagens.push({ dia: d, peso: 80 - (0.5 / 7) * i });
  }
  const g = gastoAdaptativo({ refeicoes, pesagens, perfil, dia: '2026-09-24' });
  assert.equal(g.status, 'calibrado');
  assert.ok(Math.abs(g.gasto - 2550) <= 5, `gasto ${g.gasto}`); // 2000 + 0,5/7*7700 ≈ 2550
  assert.deepEqual(g.alvo, { min: 1950, max: 2250 });
  const c = gastoAdaptativo({ refeicoes: refeicoes.slice(0, 9), pesagens, perfil, dia: '2026-09-24', gastos: { '2026-09-20': 2400, '2026-09-21': 2600 } });
  assert.equal(c.status, 'relogio');
  assert.match(c.texto, /gasto ~2\.500 kcal\/dia/);
});

test('sequenciaDe e placarSemana', () => {
  const refs = [];
  for (const d of ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']) for (let k = 0; k < 3; k++) refs.push({ jid: 'a@s', dia: d, estimativa: { kcal: 600, p: 45 } });
  refs.push({ jid: 'a@s', dia: '2026-09-24', estimativa: { kcal: 500, p: 20 } }); // hoje incompleto
  assert.equal(sequenciaDe(refs, '2026-09-24'), 4);
  refs.push({ jid: 'b@s', dia: '2026-09-23', estimativa: { kcal: 400, p: 30 } });
  const placar = placarSemana(refs, perfis, ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
  assert.match(placar, /🥇 Lucas: 4 de 7 dias registrados por completo · proteína batida em 4 dia\(s\) · sequência atual 4 dia\(s\)/);
  assert.match(placar, /🥈 Alezinha: 0 de 7/);
});

test('configGrafico: barras de kcal, linha de peso, faixa da meta e gasto do relógio', () => {
  const cfg = configGrafico({
    nome: 'Lucas Leonardo',
    refeicoes: [{ dia: '2026-09-23', estimativa: { kcal: 1500, p: 100 } }, { dia: '2026-09-23', estimativa: { kcal: 800, p: 40 } }, { dia: '2026-09-22', estimativa: { kcal: 2000, p: 120 } }],
    pesagens: [{ dia: '2026-09-22', peso: 75.7 }, { dia: '2026-09-24', peso: 75.5 }],
    gastos: { '2026-09-23': 2400 },
    alvo: { min: 2700, max: 2950 },
    dia: '2026-09-24',
    dias: 7,
  });
  assert.equal(cfg.data.labels.length, 7);
  assert.equal(cfg.data.datasets.length, 5); // kcal, gasto, meta mín, meta máx, peso
  assert.deepEqual(cfg.data.datasets[0].data.slice(-3), [2000, 2300, null]);
  assert.equal(cfg.data.datasets[4].data[6], 75.5);
  assert.match(cfg.options.title.text, /Lucas · últimos 7 dias · 2 dias com registro · proteína média 130 g\/dia/);
  const semPeso = configGrafico({ nome: 'Ale', refeicoes: [{ dia: '2026-09-24', estimativa: { kcal: 300 } }], dia: '2026-09-24', dias: 7 });
  assert.equal(semPeso.data.datasets.length, 1);
});

test('textoParaFala: tira markdown, emojis e fala números', () => {
  const f = textoParaFala('*Almoço* top! 🏐\n🔥 *Estimativa:* ~950 kcal · [[Proteína]] 60 g\n💡 Dica: dormiu 5h03?');
  assert.equal(f, 'Almoço top!\nEstimativa: ~950 calorias · Proteína 60 gramas\nDica: dormiu 5 horas e 03?');
});

test('separarAtualizacao: linha HABITO oculta é extraída e some do texto', () => {
  const r = separarAtualizacao('Boa, hidratação em dia! 💧\nHABITO: {"agua_ml": 500}\nATUALIZAR: {"peso_kg": 75.5}');
  assert.equal(r.texto, 'Boa, hidratação em dia! 💧');
  assert.deepEqual(r.habito, { agua_ml: 500 });
  assert.deepEqual(r.atualizacao, { peso_kg: 75.5 });
  const s = separarAtualizacao('Tudo certo.\nHABITO: {"alcool_doses": 2}');
  assert.equal(s.texto, 'Tudo certo.');
  assert.deepEqual(s.habito, { alcool_doses: 2 });
});

test('voz: pedido explícito de áudio e linha AUDIO oculta', () => {
  assert.equal(pedidoDeAudio('me dá o resumo de hoje em áudio'), true);
  assert.equal(pedidoDeAudio('manda um audio explicando'), true);
  assert.equal(pedidoDeAudio('responde falando pra mim'), true);
  assert.equal(pedidoDeAudio('comi arroz e feijão'), false);
  assert.equal(pedidoDeAudio('ouvi um áudio do heitor'), false);
  const r = separarAtualizacao('Hoje você mandou bem demais.\nAUDIO: sim');
  assert.equal(r.texto, 'Hoje você mandou bem demais.');
  assert.equal(r.audio, true);
  assert.equal(separarAtualizacao('Só texto mesmo.').audio, false);
  assert.equal(semLinhaAtualizar('Bora.\nAUDIO: sim\nHABITO: {"agua_ml": 300}'), 'Bora.');
});

test('montarSystem: texto gravado (documento) proíbe a palavra de silêncio do papo', () => {
  const conversa = montarSystem('');
  const documento = montarSystem('', { documento: true });
  assert.match(conversa, /responda EXATAMENTE a palavra SILENCIO/);
  assert.ok(!/NUNCA responda SILENCIO aqui/.test(conversa));
  assert.match(documento, /NUNCA responda SILENCIO aqui/);
  assert.match(documento, /NÃO É CONVERSA DE GRUPO/);
});

test('agruparFotos: fotos seguidas da mesma pessoa viram uma análise só', () => {
  const foto = (id, quem, ts, legenda) => ({ key: { id, remoteJid: 'g@g.us', participant: quem }, messageTimestamp: ts, message: { imageMessage: { caption: legenda || '' } } });
  const txt = (id, quem, ts, t) => ({ key: { id, remoteJid: 'g@g.us', participant: quem }, messageTimestamp: ts, message: { conversation: t } });
  const A = '5548@s.whatsapp.net';
  const B = '5549@s.whatsapp.net';

  // 3 fotos seguidas do Lucas = 1 grupo com 2 extras
  let g = agruparFotos([foto('1', A, 100), foto('2', A, 105), foto('3', A, 110)]);
  assert.equal(g.length, 1);
  assert.equal(g[0].extras.length, 2);

  // foto do Lucas + foto do Heitor = dois grupos separados
  g = agruparFotos([foto('1', A, 100), foto('2', B, 105)]);
  assert.deepEqual(g.map((x) => x.extras.length), [0, 0]);

  // texto ENTRE as fotos entra junto; texto DEPOIS da última fica de fora
  g = agruparFotos([foto('1', A, 100), txt('2', A, 102, 'é meu almoço'), foto('3', A, 105), txt('4', A, 108, 'e aí?')]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].extras.map((m) => m.key.id), ['2', '3']);
  assert.equal(g[1].msg.key.id, '4');

  // foto sozinha continua como antes
  g = agruparFotos([foto('1', A, 100), txt('2', A, 102, 'oi')]);
  assert.deepEqual(g.map((x) => [x.msg.key.id, x.extras.length]), [['1', 0], ['2', 0]]);

  // comando fecha o bloco
  g = agruparFotos([foto('1', A, 100), txt('2', A, 101, '!hoje'), foto('3', A, 102)]);
  assert.equal(g.length, 3);

  // fotos distantes (mais de 5 min) não são a mesma refeição
  g = agruparFotos([foto('1', A, 100), foto('2', A, 100 + 400)]);
  assert.deepEqual(g.map((x) => x.extras.length), [0, 0]);

  // teto de 6 fotos por análise
  g = agruparFotos(Array.from({ length: 9 }, (_, i) => foto(String(i), A, 100 + i)));
  assert.equal(g[0].extras.length, 5); // 6 fotos na primeira análise
  assert.equal(g.length, 2); // as 3 que sobraram viram uma segunda análise
  assert.equal(g[1].extras.length, 2);
});
