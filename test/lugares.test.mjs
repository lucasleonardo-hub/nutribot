import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanciaM, localDe, agruparVisitas, estatisticasDosLugares, tipoDeTags, escolherElemento, lerTimeline, descreverSituacao, RAIO_LUGAR_M } from '../lugares.js';

const CASA = { lat: -27.5969, lon: -48.5495 }; // Florianópolis
const ACAD = { lat: -27.6010, lon: -48.5200 }; // ~3 km
const TRAB = { lat: -27.5800, lon: -48.5600 };
const F = 'America/Sao_Paulo';
// pontos a cada 15 min a partir de um instante (UTC), com ruído de poucos metros
const serie = (base, lugar, n, jitter = 0.0002) =>
  Array.from({ length: n }, (_, i) => ({ ts: new Date(new Date(base).getTime() + i * 15 * 60000), lat: lugar.lat + ((i % 3) - 1) * jitter, lon: lugar.lon + ((i % 2) - 0.5) * jitter }));

test('distanciaM e localDe', () => {
  assert.ok(Math.abs(distanciaM(CASA, CASA)) < 0.01);
  const d = distanciaM(CASA, ACAD);
  assert.ok(d > 2500 && d < 3500, `distância ${d}`);
  const l = localDe('2026-09-30T02:30:00Z', F); // 23:30 do dia anterior em SP
  assert.equal(l.dia, '2026-09-29');
  assert.equal(l.hhmm, '23:30');
  assert.equal(l.dow, 2); // terça
});

test('agruparVisitas: paradas viram visitas, passagem rápida não, lugar novo nasce do centro dos pontos', () => {
  const pontos = [
    ...serie('2026-09-28T10:00:00Z', CASA, 8), // 07:00–08:45 em casa
    { ts: new Date('2026-09-28T12:00:00Z'), lat: -27.59, lon: -48.54 }, // passagem (1 ponto)
    ...serie('2026-09-28T12:15:00Z', TRAB, 20), // 09:15–14:00 trabalho
    ...serie('2026-09-28T21:00:00Z', ACAD, 5), // 18:00–19:00 academia
    ...serie('2026-09-29T00:00:00Z', CASA, 30), // 21:00–04:15 casa (noite)
  ];
  const { lugares, visitas } = agruparVisitas({ pontos, fuso: F });
  assert.equal(lugares.length, 3, `lugares: ${JSON.stringify(lugares)}`);
  assert.equal(visitas.length, 4);
  const casaId = lugares.find((l) => distanciaM(l, CASA) < 50).id;
  const vCasa = visitas.filter((v) => v.lugarId === casaId);
  assert.equal(vCasa.length, 2);
  assert.equal(vCasa[0].dia, '2026-09-28');
  assert.equal(vCasa[0].hIni, 7);
  assert.ok(vCasa[0].min >= 105 && vCasa[0].min <= 120, `min ${vCasa[0].min}`);
  const vAcad = visitas.find((v) => distanciaM(lugares.find((l) => l.id === v.lugarId), ACAD) < 50);
  assert.equal(vAcad.hIni, 18);
  assert.equal(vAcad.dow, 1);
  // lugar já conhecido é reaproveitado (mesmo id), e o ponto dentro do raio gruda nele
  const deNovo = agruparVisitas({ pontos: serie('2026-09-30T10:00:00Z', { lat: CASA.lat + 0.0005, lon: CASA.lon }, 4), lugares, fuso: F });
  assert.equal(deNovo.lugares.length, 3);
  assert.equal(deNovo.visitas[0].lugarId, casaId);
  assert.ok(distanciaM({ lat: CASA.lat + 0.0005, lon: CASA.lon }, CASA) < RAIO_LUGAR_M);
});

test('agruparVisitas: buraco de mais de 3 h separa duas visitas no mesmo lugar', () => {
  const pontos = [...serie('2026-09-28T12:00:00Z', TRAB, 4), ...serie('2026-09-28T18:00:00Z', TRAB, 4)];
  const { visitas } = agruparVisitas({ pontos, fuso: F });
  assert.equal(visitas.length, 2);
});

test('estatisticasDosLugares: casa é onde dorme, trabalho é onde passa os dias úteis, padrão em dias e horas', () => {
  const lugares = [{ id: 'casa', ...CASA }, { id: 'trab', ...TRAB }, { id: 'acad', ...ACAD }];
  const visitas = [];
  for (let d = 21; d <= 25; d++) {
    // seg a sex de setembro/2026 (21 = segunda)
    const dia = `2026-09-${d}`;
    const dow = d - 20;
    visitas.push({ lugarId: 'casa', inicio: new Date(`${dia}T01:00:00Z`), fim: new Date(`${dia}T10:00:00Z`), min: 540, dia, dow, hIni: 22, hFim: 7 });
    visitas.push({ lugarId: 'trab', inicio: new Date(`${dia}T12:00:00Z`), fim: new Date(`${dia}T21:00:00Z`), min: 540, dia, dow, hIni: 9, hFim: 18 });
    if (dow === 1 || dow === 3 || dow === 5) visitas.push({ lugarId: 'acad', inicio: new Date(`${dia}T21:30:00Z`), fim: new Date(`${dia}T23:00:00Z`), min: 90, dia, dow, hIni: 18.5, hFim: 20 });
  }
  const st = estatisticasDosLugares(lugares, visitas);
  const casa = st.find((l) => l.id === 'casa');
  const trab = st.find((l) => l.id === 'trab');
  const acad = st.find((l) => l.id === 'acad');
  assert.equal(casa.papel, 'casa');
  assert.equal(casa.noites, 5);
  assert.equal(trab.papel, 'trabalho');
  assert.equal(trab.visitas, 5);
  assert.equal(acad.visitas, 3);
  assert.equal(acad.dias, 3);
  assert.match(acad.padrao, /^seg, qua, sex · 18h30 às 20h$/);
  assert.equal(acad.papel ?? null, null);
  assert.equal(acad.ultimaVez, '2026-09-25');
});

test('tipoDeTags e escolherElemento: POI com nome perto ganha de prédio genérico', () => {
  assert.equal(tipoDeTags({ leisure: 'fitness_centre', name: 'Smart Fit' }), 'academia');
  assert.equal(tipoDeTags({ amenity: 'university' }), 'faculdade');
  assert.equal(tipoDeTags({ shop: 'supermarket' }), 'mercado');
  assert.equal(tipoDeTags({ building: 'apartments' }), 'residência');
  assert.equal(tipoDeTags({ highway: 'residential' }), null);
  const el = [
    { type: 'way', center: { lat: CASA.lat, lon: CASA.lon }, tags: { building: 'commercial' } },
    { type: 'node', lat: CASA.lat + 0.0003, lon: CASA.lon, tags: { leisure: 'fitness_centre', name: 'Academia X' } },
    { type: 'node', lat: CASA.lat + 0.0001, lon: CASA.lon, tags: { amenity: 'bench' } },
  ];
  const e = escolherElemento(el, CASA);
  assert.equal(e.tipo, 'academia');
  assert.equal(e.nome, 'Academia X');
  const so = escolherElemento([el[0]], CASA);
  assert.equal(so.tipo, 'trabalho');
  assert.equal(so.generico, true);
});

test('lerTimeline lê o formato do aparelho e o do Takeout antigo', () => {
  const novo = {
    semanticSegments: [
      { startTime: '2026-09-20T22:00:00.000-03:00', endTime: '2026-09-21T07:00:00.000-03:00', visit: { topCandidate: { semanticType: 'HOME', placeLocation: { latLng: '-27.5969°, -48.5495°' } } } },
      { startTime: '2026-09-21T08:00:00.000-03:00', endTime: '2026-09-21T08:20:00.000-03:00', timelinePath: [] },
      { startTime: '2026-09-21T09:00:00.000-03:00', endTime: '2026-09-21T18:00:00.000-03:00', visit: { topCandidate: { semanticType: 'WORK', placeLocation: { latLng: '-27.58°, -48.56°' } } } },
    ],
  };
  const v = lerTimeline(novo);
  assert.equal(v.length, 2);
  assert.equal(v[0].semantico, 'HOME');
  assert.ok(Math.abs(v[0].lat + 27.5969) < 1e-6);
  const antigo = { timelineObjects: [{ placeVisit: { location: { latitudeE7: -276010000, longitudeE7: -485200000, name: 'Academia Y', semanticType: 'TYPE_SEARCHED_ADDRESS' }, duration: { startTimestamp: '2026-09-21T21:00:00Z', endTimestamp: '2026-09-21T22:30:00Z' } } }] };
  const a = lerTimeline(antigo);
  assert.equal(a.length, 1);
  assert.equal(a[0].nome, 'Academia Y');
  assert.ok(Math.abs(a[0].lat + 27.601) < 1e-6);
  assert.deepEqual(lerTimeline({}), []);
});

test('descreverSituacao nunca expõe coordenada nem endereço', () => {
  assert.equal(descreverSituacao({ estado: 'casa', desde: '19:40' }), 'em casa desde 19:40');
  assert.equal(descreverSituacao({ estado: 'lugar', desde: '18:05', lugar: { tipo: 'academia', nome: 'Smart Fit', bairro: 'Trindade', lat: -27, lon: -48 } }), 'em academia Smart Fit (Trindade) desde 18:05');
  assert.equal(descreverSituacao({ estado: 'fora', desde: '12:10', movendo: true }), 'na rua, em deslocamento');
  assert.equal(descreverSituacao({ estado: 'sem_sinal', ultimo: '08:00' }), 'sem sinal do celular desde 08:00');
  assert.equal(descreverSituacao(null), 'sem sinal do celular hoje');
});

import { escolherGrande } from '../lugares.js';
test('escolherGrande: campus/shopping a até 300 m ganha do POI miúdo', () => {
  const el = [
    { type: 'way', center: { lat: CASA.lat + 0.002, lon: CASA.lon }, tags: { amenity: 'university', name: 'UFSC' } }, // ~220 m
    { type: 'node', lat: CASA.lat + 0.0002, lon: CASA.lon, tags: { amenity: 'cafe', name: 'Café do Campus' } },
  ];
  const g = escolherGrande(el, CASA);
  assert.equal(g.tipo, 'faculdade');
  assert.equal(g.nome, 'UFSC');
  assert.equal(escolherGrande([el[1]], CASA), null);
  assert.equal(escolherGrande([{ type: 'way', center: { lat: CASA.lat + 0.004, lon: CASA.lon }, tags: { shop: 'mall' } }], CASA), null); // 440 m: longe
});

test('estatisticasDosLugares: "todo dia" pra casa, um único trabalho, e o padrão em dias úteis', () => {
  const lugares = [{ id: 'casa', ...CASA }, { id: 'trab', ...TRAB }, { id: 'outro', lat: TRAB.lat + 0.01, lon: TRAB.lon }, { id: 'cafe', ...ACAD, tipo: 'café' }];
  const visitas = [];
  for (let d = 1; d <= 28; d++) {
    const dia = `2026-09-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
    visitas.push({ lugarId: 'casa', inicio: new Date(`${dia}T01:00:00Z`), fim: new Date(`${dia}T10:00:00Z`), min: 540, dia, dow, hIni: 22, hFim: 7 });
    if (dow >= 1 && dow <= 5) {
      visitas.push({ lugarId: 'trab', inicio: new Date(`${dia}T12:00:00Z`), fim: new Date(`${dia}T21:00:00Z`), min: 540, dia, dow, hIni: 9, hFim: 18 });
      if (dow === 2 || dow === 4) visitas.push({ lugarId: 'outro', inicio: new Date(`${dia}T13:00:00Z`), fim: new Date(`${dia}T16:00:00Z`), min: 180, dia, dow, hIni: 10, hFim: 13 });
      if (dow === 1 || dow === 3) visitas.push({ lugarId: 'cafe', inicio: new Date(`${dia}T15:00:00Z`), fim: new Date(`${dia}T21:00:00Z`), min: 360, dia, dow, hIni: 12, hFim: 18 });
    }
  }
  const st = estatisticasDosLugares(lugares, visitas);
  const por = Object.fromEntries(st.map((l) => [l.id, l]));
  assert.equal(por.casa.papel, 'casa');
  assert.match(por.casa.padrao, /^todo dia · 22h às 7h$/);
  assert.equal(por.trab.papel, 'trabalho');
  assert.match(por.trab.padrao, /^dias úteis · 9h às 18h$/);
  assert.equal(por.outro.papel ?? null, null, 'só um lugar é trabalho');
  assert.equal(por.cafe.papel ?? null, null, 'café com 2 dias úteis por semana não vira trabalho quando já existe um melhor');
  assert.match(por.outro.padrao, /^ter, qui · 10h às 13h$/);
});
