import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirHoje, compilarMes, registradasHojeParaPrompt, lerRotuloRefeicao, visaoPeriodo, metaBalanco, gastoAdaptativo, sequenciaDe, placarSemana } from '../resumo.js';
import { ancorasDe, blocoAncoras } from '../taco.js';
import { configGrafico } from '../graficos.js';
import { preverSemana, conferirPrevisao, pesagemPerto, somarDias, avaliarRitmo, projetarMeta } from '../previsao.js';
import { textoParaFala } from '../voz.js';
import { separarAtualizacao, montarSystem } from '../gemini.js';
import { pedidoDeAudio, semLinhaAtualizar, pareceConsumo } from '../util.js';
import { duracaoDe } from '../comandos.js';
import { montarCorrecao, DESCULPAS } from '../revisao.js';
import { agruparFotos } from '../mensagens.js';
import { classificar, blocoAgenda, ocupadoAgora, limparAnonimos, normalizarEventoApi } from '../agenda.js';
import { estacaoDoAno, hemisferio, descricaoTempo, sensacao, linhaClima } from '../clima.js';
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
  assert.match(t, /- Lucas Leonardo: Lanche da manhã 06:20 \(~270 kcal, 0 g de proteína\); Café da manhã 08:34 \(~470 kcal, 0 g de proteína\)/);
  // o total vem rotulado, pra ela não chamar o total do dia de "o seu almoço"
  assert.match(t, /somando TODAS essas 2 refeições, o total do dia até agora é ~740 kcal e 0 g de proteína \(isto é o DIA, não uma refeição\)/);
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
  assert.match(v, /hoje até agora comeu 620 kcal no DIA INTEIRO \(soma de 1 refeição\(ões\), não o valor de uma delas\) \(o gasto de hoje só chega quando o relógio sincronizar\)/);
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

test('pareceConsumo: separa "tomei esse iogurte" de "vale a pena esse iogurte?"', () => {
  assert.equal(pareceConsumo('mandei a foto do prato e tomei também 200ml desse iogurte, segue o rótulo'), true);
  assert.equal(pareceConsumo('comi isso agora'), true);
  assert.equal(pareceConsumo('esse iogurte é bom? vale a pena comprar'), false);
  assert.equal(pareceConsumo('olha o rótulo desse whey novo'), false);
});

test('preverSemana: superávit do relógio vira ganho previsto, com divisão magra/gordura', () => {
  const perfil = { nome: 'Lucas', peso: 76, objetivo: 'hipertrofia', relogio: { treinos7d: 4 } };
  const refeicoes = [];
  const gastos = {};
  // 6 dias completos: 3.000 kcal comidas x 2.450 gastas = +550/dia; proteína 160 g (2,1 g/kg)
  for (let i = 19; i <= 24; i++) {
    const d = `2026-09-${i}`;
    for (let k = 0; k < 3; k++) refeicoes.push({ dia: d, estimativa: { kcal: 1000, p: 160 / 3 } });
    gastos[d] = 2450;
  }
  const pesagens = [{ dia: '2026-09-18', peso: 75.6 }, { dia: '2026-09-25', peso: 76.0 }];
  const p = preverSemana({ perfil, refeicoes, pesagens, gastos, dia: '2026-09-25' });
  assert.equal(p.alvoDia, '2026-10-02');
  assert.equal(p.base, 'balanço energético');
  assert.equal(p.confianca, 'alta');
  assert.ok(Math.abs(p.deltaKg - 0.5) < 0.01, `delta ${p.deltaKg}`); // 550*7/7700 = 0,5 kg
  assert.ok(Math.abs(p.pesoPrevisto - 76.5) < 0.01);
  assert.ok(Math.abs(p.magraKg - 0.225) < 0.01); // proteína boa + treino = 45% magra
  assert.match(p.texto, /PREVISÃO PRA 02\/10 .*base: balanço energético, confiança alta.*\+0,50 kg/);
  assert.match(p.texto, /225 g tendem a ser massa magra/);
});

test('preverSemana: sem relógio usa a tendência da balança; sem nada, não chuta', () => {
  const perfil = { nome: 'Ale', peso: 74, objetivo: 'emagrecer' };
  const pesagens = [
    { dia: '2026-09-07', peso: 75.0 },
    { dia: '2026-09-12', peso: 74.7 },
    { dia: '2026-09-18', peso: 74.4 },
    { dia: '2026-09-25', peso: 74.0 },
  ];
  const p = preverSemana({ perfil, refeicoes: [], pesagens, dia: '2026-09-25' });
  assert.equal(p.base, 'tendência da balança');
  assert.ok(p.deltaKg < -0.2 && p.deltaKg > -0.6, `delta ${p.deltaKg}`);
  assert.match(p.texto, /tendem a ser gordura/);

  const vazio = preverSemana({ perfil, refeicoes: [], pesagens: [], dia: '2026-09-25' });
  assert.equal(vazio.semDados, true);
  assert.match(vazio.texto, /ainda não dá pra prever. Falta/);
});

test('conferirPrevisao: compara com a balança e classifica acerto', () => {
  const previsao = { feitaEm: '2026-09-18', diaInicial: '2026-09-18', alvoDia: '2026-09-25', pesoInicial: 75.6, deltaKg: 0.5, pesoPrevisto: 76.1, magraKg: 0.225 };
  const perto = conferirPrevisao({ previsao, pesagens: [{ dia: '2026-09-18', peso: 75.6 }, { dia: '2026-09-25', peso: 76.0 }], dia: '2026-09-25' });
  assert.equal(perto.acerto, 'cheio'); // errou por 100 g
  assert.match(perto.texto, /eu disse \+0,50 kg .*deu \+0,40 kg/);
  assert.match(perto.texto, /ACERTEI, na direção certa/);

  const longe = conferirPrevisao({ previsao, pesagens: [{ dia: '2026-09-18', peso: 75.6 }, { dia: '2026-09-25', peso: 74.9 }], dia: '2026-09-25' });
  assert.equal(longe.acerto, 'errou');
  assert.match(longe.texto, /ERREI, na direção errada/);

  const semBalanca = conferirPrevisao({ previsao, pesagens: [{ dia: '2026-09-18', peso: 75.6 }], dia: '2026-09-25' });
  assert.equal(semBalanca.semPesagem, true);

  // com bioimpedância nas duas pontas, confere massa magra também
  const comGordura = conferirPrevisao({
    previsao,
    pesagens: [{ dia: '2026-09-18', peso: 75.6, gordura: 18.0 }, { dia: '2026-09-25', peso: 76.0, gordura: 18.1 }],
    dia: '2026-09-25',
  });
  assert.match(comGordura.texto, /Pela bioimpedância do relógio: massa magra \+0,25 kg e gordura \+0,15 kg/);
  assert.match(comGordura.texto, /Eu tinha estimado \+0,23 kg de magra/);
});

test('pesagemPerto e somarDias', () => {
  const ps = [{ dia: '2026-09-20', peso: 75 }, { dia: '2026-09-24', peso: 76 }];
  assert.equal(pesagemPerto(ps, '2026-09-25')?.peso, 76);
  assert.equal(pesagemPerto(ps, '2026-09-30'), null);
  assert.equal(somarDias('2026-09-25', 7), '2026-10-02');
});

test('avaliarRitmo: compara com a faixa da base (0,25-0,5%/semana pra ganho)', () => {
  const rapido = avaliarRitmo({ peso: 76, deltaKg: 0.72, objetivo: 'Hipertrofia' });
  assert.match(rapido, /RÁPIDO DEMAIS/);
  assert.match(rapido, /o recomendado é 190 g a 380 g\/semana/);
  assert.match(rapido, /Excesso de ~340 g\/semana, que equivale a 370 kcal\/dia a menos/); // (0,72-0,38)*7700/7 = 374
  const bom = avaliarRitmo({ peso: 76, deltaKg: 0.3, objetivo: 'Hipertrofia' });
  assert.match(bom, /DENTRO da faixa/);
  const lento = avaliarRitmo({ peso: 76, deltaKg: 0.05, objetivo: 'hipertrofia' });
  assert.match(lento, /LENTO/);
  const perda = avaliarRitmo({ peso: 80, deltaKg: -1.2, objetivo: 'emagrecer e definir' });
  assert.match(perda, /RÁPIDO DEMAIS pra perder gordura/);
  assert.equal(avaliarRitmo({ peso: 76, deltaKg: 0.3, objetivo: 'manter a saúde' }), '');
});

test('projetarMeta: prazo, ritmo necessário e projeção sem meta', () => {
  const perfil = { metaPeso: 80, metaPrazo: '2027-03-31', objetivo: 'Hipertrofia' };
  const noRitmo = projetarMeta({ perfil, deltaKgSemana: 0.3, pesoAtual: 76, dia: '2026-09-27' });
  assert.match(noRitmo, /META: 80,0 kg até 2027-03-31; faltam 4,0 kg \(está em 76,0 kg\)/);
  assert.match(noRitmo, /chega em ~13 semana\(s\)/);
  assert.match(noRitmo, /está ADIANTADA/);

  const parado = projetarMeta({ perfil, deltaKgSemana: 0, pesoAtual: 76, dia: '2026-09-27' });
  assert.match(parado, /NÃO chega/);

  const errado = projetarMeta({ perfil, deltaKgSemana: -0.2, pesoAtual: 76, dia: '2026-09-27' });
  assert.match(errado, /indo pro lado contrário/);

  const semMeta = projetarMeta({ perfil: {}, deltaKgSemana: -0.4, pesoAtual: 74, dia: '2026-09-27' });
  assert.match(semMeta, /PROJEÇÃO \(sem meta combinada\)/);
  assert.match(semMeta, /em 1 mês ~72,3 kg, em 3 meses ~68,8 kg e em 6 meses ~63,6 kg/);
});

test('agenda: classifica aula, trabalho, reunião e treino do jeito que a pessoa escreve', () => {
  const ev = (titulo, extra = {}) => classificar({ titulo, ...extra });
  assert.equal(ev('Cálculo III', { recorrente: true, duracaoMin: 100 }), 'aula');
  assert.equal(ev('Trabalho'), 'trabalho');
  assert.equal(ev('Reunião de obra - Predialize'), 'reunião');
  assert.equal(ev('Alinhamento com cliente', { convidados: 3 }), 'reunião');
  assert.equal(ev('Daily', { convidados: 5 }), 'reunião');
  assert.equal(ev('Vôlei'), 'treino');
  assert.equal(ev('Academia 7h'), 'treino');
  assert.equal(ev('Consulta dermatologista'), 'saúde');
  assert.equal(ev('Churrasco na casa do Heitor'), 'refeição');
  assert.equal(ev('Voo para Floripa'), 'viagem');
  assert.equal(ev('Aniversário da vó'), 'refeição');
  assert.equal(ev('Buscar encomenda'), 'compromisso');
  // "Trabalho - <matéria>" é trabalho da faculdade; "Trabalho" sozinho é expediente
  assert.equal(ev('Trabalho - Tópicos Especiais de Topografia'), 'aula');
  assert.equal(ev('Trabalho de Estatística'), 'aula');
  assert.equal(ev('Estudar Materiais'), 'aula');
  assert.equal(ev('Bora gabaritar a prova de amanhã'), 'aula');
  assert.equal(ev('Trabalho'), 'trabalho');
});

test('agenda: bloco do prompt e janelas livres', () => {
  const perfil = { nome: 'Lucas', fuso: 'America/Sao_Paulo' };
  const iso = (dia, h, m) => new Date(Date.UTC(2026, 8, dia, h + 3, m)).toISOString(); // 3h = BRT -> UTC
  const lista = [
    { titulo: 'Cálculo III', inicio: iso(25, 10, 0), fim: iso(25, 11, 40), diaTodo: false, tipo: 'aula' },
    { titulo: 'Reunião de obra', inicio: iso(25, 14, 0), fim: iso(25, 15, 30), diaTodo: false, tipo: 'reunião' },
  ];
  const bloco = blocoAgenda(lista, { perfil, dias: 2 });
  assert.match(bloco, /10:00-11:40 Cálculo III \(aula\)/);
  assert.match(bloco, /janelas livres: 07:00-10:00, 11:40-14:00, 15:30-23:00/);
  // "hoje" injetado (25/09) pra o teste não depender do relógio: às 10:30 ela sabe que a pessoa está em aula até 11:40
  const dentro = ocupadoAgora(lista, { perfil, minutos: 10 * 60 + 30, hoje: '2026-09-25' });
  assert.equal(dentro?.tipo, 'aula');
  assert.equal(dentro?.terminaEm, '11:40');
  assert.equal(ocupadoAgora(lista, { perfil, minutos: 12 * 60, hoje: '2026-09-25' }), null);
  assert.equal(ocupadoAgora(lista, { perfil, minutos: 10 * 60 + 30, hoje: '2026-09-26' }), null); // outro dia: nada
});

test('agenda: evento da API vira o formato comum, com a agenda de origem como pista de tipo', () => {
  const reuniao = normalizarEventoApi(
    { summary: 'Alinhamento semanal', start: { dateTime: '2026-09-28T14:00:00-03:00' }, end: { dateTime: '2026-09-28T15:00:00-03:00' }, attendees: [{}, {}], recurringEventId: 'x' },
    'Lucas'
  );
  assert.equal(reuniao.tipo, 'reunião');
  assert.equal(reuniao.inicio, '2026-09-28T17:00:00.000Z');
  assert.equal(reuniao.duracaoMin, 60);
  assert.equal(reuniao.agenda, 'Lucas');

  // sem palavra no título, o nome da agenda decide: agenda da faculdade -> aula; da empresa -> trabalho
  const semPista = { summary: 'Sala 204', start: { dateTime: '2026-09-28T08:00:00-03:00' }, end: { dateTime: '2026-09-28T10:00:00-03:00' } };
  assert.equal(normalizarEventoApi(semPista, 'Faculdade UFSC').tipo, 'aula');
  assert.equal(normalizarEventoApi(semPista, 'Predialize').tipo, 'trabalho');
  assert.equal(normalizarEventoApi(semPista, 'Lucas').tipo, 'compromisso');
  // "Busy" (agenda pública do trabalho) não é reunião nem compromisso genérico: a agenda de origem diz que é trabalho
  const busy = { summary: 'Busy', start: { dateTime: '2026-09-28T16:00:00-03:00' }, end: { dateTime: '2026-09-28T17:00:00-03:00' }, attendees: [{}] };
  assert.equal(normalizarEventoApi(busy, 'lucas.leonardo@predialize.com.br').tipo, 'trabalho');

  const diaTodo = normalizarEventoApi({ summary: 'Viagem SP', start: { date: '2026-10-02' }, end: { date: '2026-10-04' } }, 'Lucas');
  assert.equal(diaTodo.diaTodo, true);
  assert.equal(diaTodo.tipo, 'viagem');
  assert.equal(diaTodo.duracaoMin, 1440);
});

test('agenda: evento sem nome ("Busy") só some quando o horário já tem um evento com nome', () => {
  const iso = (dia, h, m) => new Date(Date.UTC(2026, 8, dia, h + 3, m)).toISOString();
  const nomeado = { titulo: 'Reunião de obra', inicio: iso(25, 14, 0), fim: iso(25, 15, 30) };
  const sobreposto = { titulo: 'Busy', inicio: iso(25, 14, 0), fim: iso(25, 15, 30) };
  const parcial = { titulo: 'Busy', inicio: iso(25, 15, 0), fim: iso(25, 16, 0) };
  const sozinho = { titulo: 'Busy', inicio: iso(25, 20, 0), fim: iso(25, 21, 0) };

  const limpa = limparAnonimos([nomeado, sobreposto, parcial, sozinho]);
  assert.deepEqual(
    limpa.map((e) => `${e.titulo} ${e.inicio.slice(11, 16)}`),
    ['Reunião de obra 17:00', 'Busy 23:00']
  );
  // sem nenhum evento nomeado, os anônimos ficam (saber que está ocupado já serve)
  assert.equal(limparAnonimos([sobreposto, sozinho]).length, 2);
});

test('clima: estação certa em cada hemisfério e descrição do tempo', () => {
  assert.equal(estacaoDoAno('2026-09-26', 'sul'), 'primavera');
  assert.equal(estacaoDoAno('2026-09-26', 'norte'), 'outono');
  assert.equal(estacaoDoAno('2026-01-15', 'sul'), 'verão');
  assert.equal(estacaoDoAno('2026-07-10', 'sul'), 'inverno');
  assert.equal(estacaoDoAno('2026-07-10', 'norte'), 'verão');
  assert.equal(hemisferio({ latitude: -27.6 }), 'sul');
  assert.equal(hemisferio({ latitude: 48.8 }), 'norte');
  assert.equal(hemisferio({ fuso: 'Europe/Paris' }), 'norte');
  assert.equal(hemisferio({ fuso: 'America/Sao_Paulo' }), 'sul');
  assert.equal(descricaoTempo(0, true), 'céu limpo');
  assert.equal(descricaoTempo(61), 'chuva fraca');
  assert.equal(descricaoTempo(95), 'trovoada');
  assert.equal(sensacao(12), 'frio');
  assert.equal(sensacao(30), 'calorão');
});

test('clima: linha do prompt fala do agora, do dia e de amanhã', () => {
  const dados = {
    cidade: 'Florianópolis', lat: -27.6, temp: 27.8, sensacaoTermica: 33.4, chuvaAgoraMm: 0, codigo: 0, ehDia: true,
    hoje: { max: 28.2, min: 16.5, chuvaPct: 0, codigo: 3 },
    amanha: { max: 23.6, min: 17.6, chuvaPct: 45, codigo: 51 },
  };
  const l = linhaClima(dados, { dia: '2026-09-26' });
  assert.match(l, /^primavera no hemisfério sul; tempo em Florianópolis: 28°C agora \(sensação 33°C, calorão\), céu limpo; hoje mín 17°C \/ máx 28°C, chance de chuva 0%; amanhã 18°C a 24°C, garoa, chuva 45%$/);
  assert.equal(linhaClima(null), '');
});
