import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { projecaoAteMeta, semanasPassadas, somarDias } = await import('../tendencia.js');

// 8 semanas de pesagens subindo 0,25 kg/semana (74,0 -> 75,75), com gordura estável; comida 3.100/dia e gasto 2.830/dia
// (balanço +270 kcal/dia ~ +0,245 kg/semana); 4 treinos por semana; sono 6h50
function cenario({ dia = '2026-10-03', semanas = 8, passo = 0.25, inicio = 74.0, kcal = 3100, gasto = 2830, sonoMin = 410 } = {}) {
  const pesagens = [];
  const refeicoes = [];
  const gastos = {};
  const sonos = [];
  const treinos = [];
  for (let d = semanas * 7 - 1; d >= 0; d--) {
    const data = somarDias(dia, -d);
    const peso = inicio + (passo * (semanas * 7 - 1 - d)) / 7;
    if (d % 2 === 0) pesagens.push({ dia: data, peso: Math.round(peso * 100) / 100, gordura: 18.5 });
    if (d > 0) {
      refeicoes.push({ dia: data, kcal: kcal * 0.6 }, { dia: data, kcal: kcal * 0.4 });
      gastos[data] = gasto;
      sonos.push({ dia: data, total: sonoMin });
      if (d % 7 !== 0 && d % 7 !== 6 && d % 7 !== 3) treinos.push({ inicio: `${data}T10:00:00.000Z` });
    }
  }
  return { pesagens, refeicoes, gastos, sonos, treinos };
}
const perfil = { nome: 'Lucas', objetivo: 'Hipertrofia com definição: ganhar massa', metaPeso: 80, metaPrazo: '2027-01-15', metaModo: 'etapa' };
const faixa = { ritmoKgSemana: 0.3, min: 200, max: 400 };

test('semanasPassadas: agrupa por semana com peso, comida, gasto, balanço, treinos e sono', () => {
  const c = cenario();
  const s = semanasPassadas({ ...c, dia: '2026-10-03' });
  assert.equal(s.length, 8);
  const ult = s[s.length - 1];
  assert.equal(ult.idx, 0);
  assert.equal(ult.fim, '2026-10-03');
  assert.ok(ult.peso > 75.4 && ult.peso < 75.9, `peso ${ult.peso}`);
  assert.ok(Math.abs(ult.kcal - 3100) < 1);
  assert.ok(Math.abs(ult.gasto - 2830) < 1);
  assert.ok(Math.abs(ult.balanco - 270) < 1);
  assert.equal(ult.treinos, 4);
  assert.equal(Math.round(ult.sono), 410);
  // sem pesagem na semana = semana fora da lista
  const semPeso = semanasPassadas({ ...c, pesagens: c.pesagens.filter((p) => p.dia < '2026-09-27'), dia: '2026-10-03' });
  assert.equal(semPeso[semPeso.length - 1].idx, 1);
});

test('projecaoAteMeta: ritmo real e pela comida, projeção semana a semana até o prazo, chegada e veredito', () => {
  const c = cenario();
  const p = projecaoAteMeta({ perfil, dia: '2026-10-03', ...c, faixa });
  assert.ok(p);
  assert.ok(Math.abs(p.ritmo.real - 0.25) < 0.03, `real ${p.ritmo.real}`);
  assert.ok(Math.abs(p.ritmo.balanco - 0.245) < 0.01, `balanco ${p.ritmo.balanco}`);
  assert.ok(Math.abs(p.ritmo.esperado - 0.25) < 0.03);
  assert.equal(p.ritmo.alvo, 0.3);
  // faltam ~4 kg em 15 semanas -> ~0,27 kg/semana. O peso atual é o de tendência hoje (75,96 kg nesta série exata), o mesmo
  // da META DE PESO; com a média de 7 dias (75,86) o "faltam" daqui e o da meta saíam diferentes no mesmo prompt
  assert.ok(p.falta > 3.9 && p.falta < 4.6, `falta ${p.falta}`);
  assert.equal(p.pesoAtual, 75.96);
  assert.ok(Math.abs(p.ritmo.necessario - p.falta / 15) < 0.01);
  // até o prazo (15/01 está 15 semanas depois de 03/10) e, como nesse ritmo chega depois, segue até a chegada
  assert.ok(p.futuro.length >= 15 && p.futuro.length === Math.max(15, p.chegada.semanas), `futuro ${p.futuro.length}`);
  assert.equal(p.futuro[0].fim, '2026-10-10');
  assert.equal(p.futuro.findIndex((f) => f.marcaPrazo), 14, 'marca do prazo na 15ª semana');
  assert.ok(p.futuro[14].linhaAlvo > 79.9 && p.futuro[14].linhaAlvo < 80.1, `linha alvo no prazo ${p.futuro[14].linhaAlvo}`);
  assert.ok(p.chegada && p.chegada.semanas >= 16 && p.chegada.semanas <= 19, `chegada ${JSON.stringify(p.chegada)}`);
  // 0,25 contra 0,29 necessários: abaixo, com ajuste de kcal positivo e pequeno
  assert.equal(p.status, 'abaixo');
  assert.match(p.veredito, /abaixo do ritmo da etapa/);
  assert.ok(p.ajusteKcal > 20 && p.ajusteKcal < 120, `ajuste ${p.ajusteKcal}`);
  assert.match(p.texto, /LINHA DE TENDÊNCIA ATÉ A ETAPA \(80,0 kg até 15\/01 \(etapa\)\)/);
  assert.match(p.texto, /FUTURO/);
  assert.match(p.zap, /Projeção/);
  assert.match(p.zap, /⬅ prazo/);
  assert.match(p.resumoZap, /Pela comida/);
  assert.equal(p.avisos.length, 0);
});

test('projecaoAteMeta: no ritmo quando sobe o necessário; prazo inviável avisa e dá a data saudável; sem meta usa o alvo', () => {
  const c = cenario({ passo: 0.32, kcal: 3200, gasto: 2850 }); // +350 kcal/dia ~ +0,32 kg/semana
  const ok = projecaoAteMeta({ perfil, dia: '2026-10-03', ...c, faixa });
  assert.equal(ok.status, 'ok', ok.veredito);
  assert.match(ok.veredito, /no ritmo da etapa/);
  // prazo impossível de forma saudável: 80 kg em 3 semanas
  const curto = projecaoAteMeta({ perfil: { ...perfil, metaPrazo: '2026-10-24' }, dia: '2026-10-03', ...c, faixa });
  assert.equal(curto.prazoInviavel, true);
  assert.match(curto.texto, /acima do saudável/);
  assert.ok(curto.chegadaSaudavel);
  // sem meta de peso: compara com o alvo da faixa
  const semMeta = projecaoAteMeta({ perfil: { ...perfil, metaPeso: null, metaPrazo: null }, dia: '2026-10-03', ...c, faixa });
  assert.match(semMeta.veredito, /no caminho/);
  assert.equal(semMeta.futuro.length, 4);
  // poucas pesagens: null
  assert.equal(projecaoAteMeta({ perfil, dia: '2026-10-03', pesagens: c.pesagens.slice(-3) }), null);
});

test('projecaoAteMeta: avisos de sono curto e de balança x comida discordando', () => {
  const c = cenario({ sonoMin: 350, kcal: 3800, gasto: 2800 }); // +1000 kcal/dia ~ +0,9 kg/sem pela comida, balança +0,25
  const p = projecaoAteMeta({ perfil, dia: '2026-10-03', ...c, faixa });
  assert.ok(p.avisos.some((a) => /sono médio de 5h50/.test(a)), JSON.stringify(p.avisos));
  assert.ok(p.avisos.some((a) => /discordam/.test(a)), JSON.stringify(p.avisos));
});

test('projecaoAteMeta: incerteza, janela de chegada, banda por semana e composição do ganho', () => {
  const c = cenario();
  const p = projecaoAteMeta({ perfil, dia: '2026-10-03', ...c, faixa });
  assert.ok(p.incerteza >= 0.06 && p.incerteza <= 0.2, `incerteza ${p.incerteza}`);
  assert.ok(p.janelaChegada && p.janelaChegada.cedo < p.chegada.data, JSON.stringify(p.janelaChegada));
  assert.ok(p.janelaChegada.tarde == null || p.janelaChegada.tarde > p.chegada.data);
  assert.ok(Math.abs(p.futuro[3].banda - p.incerteza * 4) < 1e-9);
  assert.match(p.zap, /\(±0,\d\)/);
  assert.match(p.zap, /provável entre/);
  // gordura constante em 18,5%: ~81,5% do ganho é massa magra
  assert.ok(p.composicao && Math.abs(p.composicao.parteMagra - 0.815) < 0.03, JSON.stringify(p.composicao));
  assert.match(p.texto, /COMPOSIÇÃO DA MUDANÇA/);
  assert.match(p.texto, /8[0-3]% do ganho foi massa magra/);
  assert.match(p.zap, /Composição da mudança/);
  assert.match(p.resumoZap, /do ganho foi massa magra/);
  assert.match(p.textoCurto, /incerteza ±0,\d\d/);
});

test('semanasPassadas: dia com um registro só, ou muito abaixo da mediana, fica fora do balanço', () => {
  const c = cenario();
  const d1 = somarDias('2026-10-03', -3);
  const d2 = somarDias('2026-10-03', -4);
  const refeicoes = c.refeicoes.filter((r) => r.dia !== d1 && r.dia !== d2).concat([{ dia: d1, kcal: 1400 }, { dia: d2, kcal: 700 }, { dia: d2, kcal: 500 }]);
  const s = semanasPassadas({ ...c, refeicoes, dia: '2026-10-03' });
  const ult = s[s.length - 1];
  assert.equal(ult.diasComida, 4); // 6 dias fechados na semana; um só registro (d1) e 1.200 de 3.100 (d2) saem
  assert.ok(Math.abs(ult.kcal - 3100) < 1);
  assert.equal(ult.diasBalanco, 4);
});
