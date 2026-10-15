// Fase 6: o envio do coletor (POST /relogio) com os campos novos (estágios do sono, FC e VFC no sono, passos e calorias por
// hora, minutos ativos) e o envio ANTIGO, sem eles (o Relógio 1.6 das outras pessoas não atualiza), passando pelo mesmo
// normalizarEnvio e fundir. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEnvio, fundir, etapasDoSono, vetor24, MAX_ETAPAS, oxigenioDoSono, temperaturaDoSono } from '../relogio.js';

const FUSO = 'America/Sao_Paulo';
const vinteQuatro = (f) => Array.from({ length: 24 }, (_, h) => f(h));

/** O envio do Relógio 1.6: sem nenhum campo novo. */
function envioAntigo() {
  return {
    sonos: [
      { inicio: '2030-03-29T02:00:00Z', fim: '2030-03-29T10:00:00Z', leve: 260, profundo: 90, rem: 100, acordado: 30 }, // 23:00 → 07:00
      { inicio: '2030-03-29T17:00:00Z', fim: '2030-03-29T17:30:00Z', leve: 30, profundo: 0, rem: 0, acordado: 0 }, // cochilo
    ],
    dias: [{ dia: '2030-03-29', passos: 8000, calorias: 2500, fcRepouso: 57, hrv: 41 }],
    treinos: [{ inicio: '2030-03-29T10:30:00Z', fim: '2030-03-29T11:00:00Z', tipo: 'Corrida', kcal: 280, fcMedia: 141 }],
  };
}
/** O mesmo envio com os campos da fase 6. */
function envioNovo() {
  const e = envioAntigo();
  e.sonos[0] = {
    ...e.sonos[0],
    etapas: [
      { i: '2030-03-29T02:00:00Z', f: '2030-03-29T02:10:00Z', t: 'acordado' },
      { i: '2030-03-29T02:10:00Z', f: '2030-03-29T03:00:00Z', t: 'leve' },
      { i: '2030-03-29T03:00:00Z', f: '2030-03-29T03:30:00Z', t: 'leve' }, // vizinho do mesmo tipo: junta
      { i: '2030-03-29T03:30:00Z', f: '2030-03-29T05:00:00Z', t: 'profundo' },
      { i: '2030-03-29T05:00:00Z', f: '2030-03-29T06:40:00Z', t: 'rem' },
      { i: '2030-03-29T06:40:00Z', f: '2030-03-29T10:00:00Z', t: 'leve' },
      { i: '2030-03-29T07:00:00Z', f: '2030-03-29T06:00:00Z', t: 'leve' }, // fim antes do início: sai
      { i: '2030-03-29T07:00:00Z', f: '2030-03-29T07:10:00Z', t: 'sonhando' }, // tipo desconhecido: sai
    ],
    fcMedia: 54.4,
    fcMin: 47,
    hrv: 44.6,
  };
  e.sonos[1] = { ...e.sonos[1], fcMedia: 70, etapas: [{ i: '2030-03-29T17:00:00Z', f: '2030-03-29T17:30:00Z', t: 'leve' }] }; // cochilo: não manda
  e.dias[0] = { ...e.dias[0], porHora: { passos: vinteQuatro((h) => (h === 18 ? 2500 : 200)), kcal: vinteQuatro(() => 104.2) }, minAtivos: 47 };
  e.dias.push({ dia: '2030-03-10', passos: 6000, calorias: 2300 }); // dia antigo: o coletor manda sem porHora
  return e;
}

test('fase 6 envio antigo: a saída é exatamente a de antes (nenhum campo novo aparece)', () => {
  const d = normalizarEnvio(envioAntigo(), FUSO);
  assert.deepEqual(d.sonos, [{ dia: '2030-03-29', inicio: '2030-03-28 23:00', fim: '2030-03-29 07:00', principal: 450, leve: 290, profundo: 90, rem: 100, acordado: 30, sessoes: 2, total: 480 }]);
  assert.deepEqual(d.atividades, [{ dia: '2030-03-29', passos: 8000, calorias: 2500, fcRepouso: 57, hrv: 41, treinos: [{ nome: 'Corrida', min: 30, hora: '07:30', fonte: '', kcal: 280, fcMedia: 141 }] }]);
});

test('fase 6 envio novo: estágios no fuso (juntados e filtrados), FC/VFC do sono principal, por hora e minutos ativos', () => {
  const d = normalizarEnvio(envioNovo(), FUSO);
  const s = d.sonos[0];
  assert.deepEqual(s.etapas, [
    { ini: '23:00', fim: '23:10', t: 'acordado' },
    { ini: '23:10', fim: '00:30', t: 'leve' },
    { ini: '00:30', fim: '02:00', t: 'profundo' },
    { ini: '02:00', fim: '03:40', t: 'rem' },
    { ini: '03:40', fim: '07:00', t: 'leve' },
  ]);
  assert.deepEqual([s.fcMedia, s.fcMin, s.hrv], [54, 47, 45]);
  assert.equal(s.total, 480); // as somas de sempre não mudam
  const hoje = d.atividades.find((a) => a.dia === '2030-03-29');
  assert.equal(hoje.porHora.passos[18], 2500);
  assert.equal(hoje.porHora.kcal[0], 104);
  assert.equal(hoje.minAtivos, 47);
  const antigo = d.atividades.find((a) => a.dia === '2030-03-10');
  assert.equal('porHora' in antigo, false);
  assert.equal('minAtivos' in antigo, false);
});

test('fase 6 validações: bpm 30–150, VFC 1–300 ms, minutos 0–1440, vetores de 24 números ≥ 0, no máximo 200 estágios', () => {
  const e = envioAntigo();
  e.sonos[0] = { ...e.sonos[0], fcMedia: 20, fcMin: 'x', hrv: 900 };
  e.dias[0] = { ...e.dias[0], porHora: { passos: [1, 2, 3], kcal: vinteQuatro((h) => (h === 5 ? -1 : 50)) }, minAtivos: 2000 };
  const d = normalizarEnvio(e, FUSO);
  for (const k of ['fcMedia', 'fcMin', 'hrv', 'etapas']) assert.equal(k in d.sonos[0], false, k);
  assert.equal('porHora' in d.atividades[0], false);
  assert.equal('minAtivos' in d.atividades[0], false);
  // um vetor válido e outro não: só o válido fica
  e.dias[0].porHora = { passos: vinteQuatro(() => 10), kcal: null };
  assert.deepEqual(normalizarEnvio(e, FUSO).atividades[0].porHora, { passos: vinteQuatro(() => 10), kcal: null });
  assert.equal(vetor24(vinteQuatro(() => null)), null);
  assert.equal(vetor24(vinteQuatro(() => '7')).every((x) => x === 7), true);
  assert.equal(vetor24('abc'), null);
  // 300 estágios alternados viram 200
  const muitos = Array.from({ length: 300 }, (_, i) => ({ i: new Date(Date.UTC(2030, 2, 29, 2) + i * 60_000 * 2).toISOString(), f: new Date(Date.UTC(2030, 2, 29, 2) + i * 60_000 * 2 + 60_000).toISOString(), t: i % 2 ? 'leve' : 'rem' }));
  assert.equal(etapasDoSono(muitos, FUSO).length, MAX_ETAPAS);
  assert.deepEqual(etapasDoSono(undefined, FUSO), []);
});

test('fase 6 sono principal: os campos novos vêm da sessão mais longa, mesmo se ela chega depois do cochilo', () => {
  const e = envioNovo();
  e.sonos.reverse(); // cochilo primeiro
  const s = normalizarEnvio(e, FUSO).sonos[0];
  assert.equal(s.inicio, '2030-03-28 23:00');
  assert.equal(s.fcMedia, 54);
  assert.equal(s.etapas.length, 5);
});

test('fase 6 fundir: o envio sem os campos novos não apaga o que já estava guardado (sono só na mesma noite)', () => {
  const guardado = normalizarEnvio(envioNovo(), FUSO);
  // depois chega o envio antigo do mesmo dia (ou um dia que saiu da janela de 14 dias do porHora)
  const f = fundir(guardado, normalizarEnvio(envioAntigo(), FUSO), '2030-03-29');
  const s = f.sonos.find((x) => x.dia === '2030-03-29');
  assert.equal(s.etapas.length, 5);
  assert.equal(s.fcMedia, 54);
  const a = f.atividades.find((x) => x.dia === '2030-03-29');
  assert.equal(a.porHora.passos[18], 2500);
  assert.equal(a.minAtivos, 47);
  assert.equal(a.passos, 8000);
  // noite diferente (outro início): não herda estágios de outra sessão
  const outra = envioAntigo();
  outra.sonos = [{ inicio: '2030-03-29T03:00:00Z', fim: '2030-03-29T10:00:00Z', leve: 300, profundo: 60, rem: 60, acordado: 0 }];
  const g = fundir(guardado, normalizarEnvio(outra, FUSO), '2030-03-29');
  assert.equal('etapas' in g.sonos.find((x) => x.dia === '2030-03-29'), false);
  // o novo com os campos vence o guardado
  const novo = envioNovo();
  novo.dias[0].minAtivos = 60;
  assert.equal(fundir(guardado, normalizarEnvio(novo, FUSO), '2030-03-29').atividades.find((x) => x.dia === '2030-03-29').minAtivos, 60);
  // histórico guardado sem nada novo + envio antigo: igual ao de antes
  const velho = fundir({ sonos: [], atividades: [], pesos: [] }, normalizarEnvio(envioAntigo(), FUSO), '2030-03-29');
  assert.deepEqual(velho, normalizarEnvio(envioAntigo(), FUSO));
});

test('fase 6 fundir: o lote que só traz o cochilo (a noite saiu da janela de 72 h) não apaga a noite guardada', () => {
  const guardado = normalizarEnvio(envioNovo(), FUSO);
  const truncado = { sonos: [envioNovo().sonos[1]], dias: [], treinos: [] }; // só o cochilo das 14:00
  const s = fundir(guardado, normalizarEnvio(truncado, FUSO), '2030-03-30').sonos.find((x) => x.dia === '2030-03-29');
  assert.equal(s.inicio, '2030-03-28 23:00');
  assert.equal(s.etapas.length, 5);
  assert.equal(s.fcMedia, 54);
  assert.equal(s.total, 480);
  // sem noite guardada, o cochilo entra normalmente
  const so = fundir({ sonos: [], atividades: [], pesos: [] }, normalizarEnvio(truncado, FUSO), '2030-03-30').sonos[0];
  assert.equal(so.inicio, '2030-03-29 14:00');
  // a noite que chega depois de um cochilo guardado vence (é maior)
  const depois = fundir(normalizarEnvio(truncado, FUSO), guardado, '2030-03-30').sonos.find((x) => x.dia === '2030-03-29');
  assert.equal(depois.inicio, '2030-03-28 23:00');
});

test('fase 6 por hora: valor absurdo (leitura duplicada) descarta o vetor', () => {
  assert.equal(vetor24(vinteQuatro(() => 1e12), 20000), null);
  assert.equal(vetor24(vinteQuatro(() => 20000), 20000)[0], 20000);
  const e = envioAntigo();
  e.dias[0] = { ...e.dias[0], porHora: { passos: vinteQuatro((h) => (h === 3 ? 1e12 : 100)), kcal: vinteQuatro(() => 1e9) } };
  assert.equal('porHora' in normalizarEnvio(e, FUSO).atividades[0], false);
});

// ---------- fase 7: as 4 permissões opcionais (distância, calorias ativas, oxigênio no sono, temperatura da pele) ----------
/** O envio do coletor 2.7 com as quatro permissões dadas. */
function envioF7() {
  const e = envioNovo();
  e.sonos[0] = { ...e.sonos[0], spo2: { media: 95.44, min: 88, minutosAbaixo90: 3.4 }, temperatura: { media: 34.123, delta: 0.456 } };
  e.sonos[1] = { ...e.sonos[1], spo2: { media: 90, min: 85, minutosAbaixo90: 10 } }; // cochilo: não manda
  e.dias[0] = { ...e.dias[0], distanciaM: 4812.6, kcalAtivas: 612.4, porHora: { ...e.dias[0].porHora, kcalAtivas: vinteQuatro((h) => (h === 18 ? 300 : 10)) } };
  return e;
}

test('fase 7 envio novo: oxigênio e temperatura do sono principal; distância, kcal ativas e ativas por hora no dia', () => {
  const d = normalizarEnvio(envioF7(), FUSO);
  const s = d.sonos[0];
  assert.deepEqual(s.spo2, { media: 95.4, min: 88, minutosAbaixo90: 3 });
  assert.deepEqual(s.temperatura, { media: 34.12, delta: 0.46 });
  assert.equal(s.total, 480); // as somas de sempre não mudam
  const hoje = d.atividades.find((a) => a.dia === '2030-03-29');
  assert.equal(hoje.distanciaM, 4813);
  assert.equal(hoje.kcalAtivas, 612);
  assert.equal(hoje.porHora.kcalAtivas[18], 300);
  assert.equal(hoje.porHora.passos[18], 2500); // os vetores da fase 6 continuam
  const antigo = d.atividades.find((a) => a.dia === '2030-03-10');
  for (const k of ['distanciaM', 'kcalAtivas', 'porHora']) assert.equal(k in antigo, false, k);
});

test('fase 7 envio antigo (Relógio 1.6) e envio da fase 6: nenhum campo da fase 7 aparece', () => {
  for (const e of [envioAntigo(), envioNovo()]) {
    const d = normalizarEnvio(e, FUSO);
    for (const k of ['spo2', 'temperatura']) assert.equal(k in d.sonos[0], false, k);
    for (const a of d.atividades) for (const k of ['distanciaM', 'kcalAtivas']) assert.equal(k in a, false, k);
    for (const a of d.atividades) if (a.porHora) assert.equal('kcalAtivas' in a.porHora, false);
  }
  // só a permissão de oxigênio: os outros três não aparecem e o resto do envio sai igual
  const so = envioNovo();
  so.sonos[0] = { ...so.sonos[0], spo2: { media: 96, min: 92, minutosAbaixo90: 0 } };
  const d = normalizarEnvio(so, FUSO);
  assert.deepEqual(d.sonos[0].spo2, { media: 96, min: 92, minutosAbaixo90: 0 });
  assert.equal('temperatura' in d.sonos[0], false);
  assert.deepEqual(d.atividades, normalizarEnvio(envioNovo(), FUSO).atividades);
});

test('fase 7 validações: faixas plausíveis do oxigênio, da temperatura, da distância e das kcal ativas', () => {
  // oxigênio: média obrigatória 70–100; mínimo 50–100 e não acima da média; minutos 0–1440
  assert.equal(oxigenioDoSono({ media: 60, min: 55, minutosAbaixo90: 5 }), null);
  assert.equal(oxigenioDoSono({ media: 101 }), null);
  assert.equal(oxigenioDoSono({ media: true }), null);
  assert.equal(oxigenioDoSono([95]), null);
  assert.equal(oxigenioDoSono(null), null);
  assert.deepEqual(oxigenioDoSono({ media: 94, min: 97, minutosAbaixo90: 2000 }), { media: 94, min: null, minutosAbaixo90: null });
  assert.deepEqual(oxigenioDoSono({ media: '93.5', min: 49 }), { media: 93.5, min: null, minutosAbaixo90: null }); // número em texto vale
  // temperatura: delta obrigatório (−5 a +5); média 25–42 °C ou null
  assert.equal(temperaturaDoSono({ media: 34 }), null);
  assert.equal(temperaturaDoSono({ delta: 7 }), null);
  assert.equal(temperaturaDoSono({ delta: false }), null);
  assert.deepEqual(temperaturaDoSono({ delta: -0.3 }), { media: null, delta: -0.3 });
  assert.deepEqual(temperaturaDoSono({ media: 50, delta: 0.2 }), { media: null, delta: 0.2 });
  // no envio: fora da faixa, o campo não entra e o resto fica
  const e = envioNovo();
  e.sonos[0] = { ...e.sonos[0], spo2: { media: 40 }, temperatura: { delta: 'x' } };
  e.dias[0] = { ...e.dias[0], distanciaM: 400000, kcalAtivas: 9000, porHora: { ...e.dias[0].porHora, kcalAtivas: vinteQuatro(() => 5000) } };
  const d = normalizarEnvio(e, FUSO);
  for (const k of ['spo2', 'temperatura']) assert.equal(k in d.sonos[0], false, k);
  const a = d.atividades.find((x) => x.dia === '2030-03-29');
  for (const k of ['distanciaM', 'kcalAtivas']) assert.equal(k in a, false, k);
  assert.equal('kcalAtivas' in a.porHora, false);
  assert.equal(a.porHora.passos[18], 2500);
  assert.equal(a.fcRepouso, 57);
  assert.equal(d.sonos[0].fcMedia, 54);
  // kcal ativas acima do gasto total do mesmo dia (que já as inclui): leitura duplicada, sai
  const f = envioAntigo();
  f.dias[0] = { ...f.dias[0], kcalAtivas: 2600, distanciaM: 0 };
  const b = normalizarEnvio(f, FUSO).atividades[0];
  assert.equal('kcalAtivas' in b, false);
  assert.equal(b.distanciaM, 0); // zero é um dia parado de verdade
});

test('fase 7 fundir: o envio sem os campos novos (permissão tirada, outro aparelho) não apaga o que estava guardado', () => {
  const guardado = normalizarEnvio(envioF7(), FUSO);
  const f = fundir(guardado, normalizarEnvio(envioNovo(), FUSO), '2030-03-29');
  const s = f.sonos.find((x) => x.dia === '2030-03-29');
  assert.deepEqual(s.spo2, { media: 95.4, min: 88, minutosAbaixo90: 3 });
  assert.deepEqual(s.temperatura, { media: 34.12, delta: 0.46 });
  const a = f.atividades.find((x) => x.dia === '2030-03-29');
  assert.deepEqual([a.distanciaM, a.kcalAtivas], [4813, 612]);
  // noite diferente (outro início): não herda oxigênio nem temperatura de outra sessão
  const outra = envioAntigo();
  outra.sonos = [{ inicio: '2030-03-29T03:00:00Z', fim: '2030-03-29T10:00:00Z', leve: 300, profundo: 60, rem: 60, acordado: 0 }];
  const g = fundir(guardado, normalizarEnvio(outra, FUSO), '2030-03-29').sonos.find((x) => x.dia === '2030-03-29');
  for (const k of ['spo2', 'temperatura']) assert.equal(k in g, false, k);
  // o novo com os campos vence o guardado
  const novo = envioF7();
  novo.dias[0].kcalAtivas = 700;
  novo.sonos[0].spo2 = { media: 97, min: 93, minutosAbaixo90: 0 };
  const h = fundir(guardado, normalizarEnvio(novo, FUSO), '2030-03-29');
  assert.equal(h.atividades.find((x) => x.dia === '2030-03-29').kcalAtivas, 700);
  assert.equal(h.sonos.find((x) => x.dia === '2030-03-29').spo2.media, 97);
});
