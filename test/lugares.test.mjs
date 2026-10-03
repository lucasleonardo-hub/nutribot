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

test('estatisticasDosLugares: casa e trabalho marcados à mão mandam; o cálculo não cria outra casa nem outro trabalho', () => {
  const lugares = [
    { id: 'casaManual', ...CASA, manual: true, papel: 'casa', tipo: 'residência' },
    { id: 'dorme', lat: CASA.lat + 0.01, lon: CASA.lon }, // dorme mais aqui, mas a casa manual vale
    { id: 'celta', ...TRAB, manual: true, papel: 'trabalho', tipo: 'trabalho', nome: 'CELTA' },
    { id: 'campus', ...ACAD, manual: true, tipo: 'faculdade', nome: 'UFSC' },
    { id: 'outro', lat: TRAB.lat + 0.01, lon: TRAB.lon },
  ];
  const visitas = [];
  for (let d = 1; d <= 20; d++) {
    const dia = `2026-09-${String(d).padStart(2, '0')}`;
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
    visitas.push({ lugarId: 'dorme', inicio: new Date(`${dia}T01:00:00Z`), fim: new Date(`${dia}T10:00:00Z`), min: 540, dia, dow, hIni: 22, hFim: 7 });
    if (dow >= 1 && dow <= 5) {
      visitas.push({ lugarId: 'outro', inicio: new Date(`${dia}T12:00:00Z`), fim: new Date(`${dia}T21:00:00Z`), min: 540, dia, dow, hIni: 9, hFim: 18 });
      visitas.push({ lugarId: 'campus', inicio: new Date(`${dia}T13:00:00Z`), fim: new Date(`${dia}T18:00:00Z`), min: 300, dia, dow, hIni: 10, hFim: 15 });
    }
  }
  const por = Object.fromEntries(estatisticasDosLugares(lugares, visitas).map((l) => [l.id, l]));
  assert.equal(por.casaManual.papel, 'casa');
  assert.equal(por.dorme.papel ?? null, null);
  assert.equal(por.celta.papel, 'trabalho');
  assert.equal(por.outro.papel ?? null, null);
  assert.equal(por.campus.tipo, 'faculdade');
  assert.equal(por.campus.papel ?? null, null);
});

import { roteiroDoDia } from '../lugares.js';
test('roteiroDoDia cruza padrão de lugares, agenda e treino e aponta janela apertada', () => {
  const lugares = [
    { id: 'casa', papel: 'casa', diasIdx: [0, 1, 2, 3, 4, 5, 6], horaTipica: 22, horaFim: 7 },
    { id: 'acad', tipo: 'academia', nome: 'Garra', bairro: 'Córrego Grande', diasIdx: [1, 2, 3, 4, 5], horaTipica: 7.1, horaFim: 8 },
    { id: 'ufsc', tipo: 'faculdade', nome: 'UFSC', diasIdx: [1, 3], horaTipica: 10, horaFim: 12.6 },
    { id: 'sab', tipo: 'praia', diasIdx: [6], horaTipica: 10, horaFim: 12 },
  ];
  const agenda = [{ titulo: 'Aula de Madeira', tipo: 'aula', inicio: '2026-09-28T17:00:00Z', fim: '2026-09-28T19:00:00Z' }]; // 14:00–16:00 SP
  const treinos = [{ nome: 'Musculação', hora: '07:12', min: 52 }];
  const r = roteiroDoDia({ lugares, agenda, treinos, dow: 1, fuso: 'America/Sao_Paulo', horaAgora: 11, nomeDia: 'segunda' });
  assert.match(r, /^ROTEIRO PROVÁVEL DE HOJE \(segunda/);
  assert.match(r, /07:06–08:00 academia Garra \(Córrego Grande\) · treino Musculação 52 min \(relógio, feito\) \(feito, confirmado pelo relógio\)/);
  assert.match(r, /10:00–12:36 faculdade UFSC \(padrão\) ◀ agora/);
  assert.match(r, /14:00–16:00 aula: Aula de Madeira \(agenda\)/);
  assert.doesNotMatch(r, /\d{2}:\d{2} (casa|praia)/);
  assert.match(r, /JANELAS APERTADAS[^\n]*12:36→14:00 \(84 min entre faculdade UFSC e aula: Aula de Madeira\)/);
  assert.equal(roteiroDoDia({ lugares, agenda: [], treinos: [], dow: 0 }), '');
});

import { rotuloLugar } from '../lugares.js';
test('rotuloLugar: tipo "trabalho" do mapa não vira o trabalho da pessoa; residência alheia e casa de alguém têm rótulo claro', () => {
  assert.equal(rotuloLugar({ papel: 'casa', tipo: 'residência', bairro: 'Costeira' }), 'casa (Costeira)');
  assert.equal(rotuloLugar({ papel: 'trabalho', tipo: 'trabalho', nome: 'CELTA', bairro: 'Itacorubi' }), 'trabalho CELTA (Itacorubi)');
  assert.equal(rotuloLugar({ tipo: 'trabalho', nome: 'Arena Beach', bairro: 'Itacorubi' }), 'prédio comercial Arena Beach (Itacorubi)');
  assert.equal(rotuloLugar({ tipo: 'residência', bairro: 'Centro' }), 'casa de alguém (Centro)');
  assert.equal(rotuloLugar({ tipo: 'casa', nome: 'da mãe do Heitor', bairro: 'Coloninha' }), 'casa da mãe do Heitor (Coloninha)');
  assert.equal(rotuloLugar({ tipo: 'quadra de vôlei de areia', nome: 'Arena Beach', bairro: 'Itacorubi' }), 'quadra de vôlei de areia Arena Beach (Itacorubi)');
  assert.equal(rotuloLugar({ tipo: 'academia', nome: 'Garra', bairro: 'Córrego Grande' }, { comNome: false }), 'academia (Córrego Grande)');
});

import { plausibilidade, escolherTipoPlausivel, listarCandidatos } from '../lugares.js';
test('plausibilidade e escolherTipoPlausivel: restaurante às 8h de ter/qui por 1h40 ao lado do campus vira faculdade', () => {
  const uso = { horaTipica: 8.2, horaFim: 9.8, diasIdx: [2, 4], visitas: 13, minutos: 13 * 96, padrao: 'ter, qui · 8h12 às 9h48' };
  assert.ok(plausibilidade('restaurante', uso) < 0.3);
  assert.ok(plausibilidade('faculdade', uso) >= 0.9);
  const lugar = { ...uso, tipo: 'restaurante', nome: 'Seu Caetano', candidatos: [{ tipo: 'restaurante', nome: 'Seu Caetano', d: 25 }, { tipo: 'faculdade', nome: 'UFSC', d: 420, grande: true }] };
  const m = escolherTipoPlausivel(lugar);
  assert.equal(m.tipo, 'faculdade');
  assert.equal(m.nome, 'UFSC');
  // almoço de verdade no mesmo restaurante: fica restaurante
  const almoco = { ...lugar, horaTipica: 12.3, horaFim: 13.2, diasIdx: [1, 2, 3, 4, 5], visitas: 10, minutos: 10 * 55 };
  assert.equal(escolherTipoPlausivel(almoco), null);
  // um candidato só: nada a reescolher
  assert.equal(escolherTipoPlausivel({ ...uso, tipo: 'restaurante', nome: 'X', candidatos: [{ tipo: 'restaurante', nome: 'X', d: 10 }] }), null);
  // academia 1h de manhã continua academia mesmo com mercado do lado
  const acad = { horaTipica: 7.1, horaFim: 8, diasIdx: [1, 2, 3, 4, 5], visitas: 60, minutos: 60 * 55, tipo: 'academia', nome: 'Garra', candidatos: [{ tipo: 'academia', nome: 'Garra', d: 30 }, { tipo: 'mercado', nome: 'Mercadinho', d: 40 }] };
  assert.equal(escolherTipoPlausivel(acad), null);
  const el = [
    { lat: -27.6, lon: -48.52, tags: { amenity: 'restaurant', name: 'Seu Caetano' } },
    { lat: -27.6035, lon: -48.52, tags: { landuse: 'university', name: 'UFSC' } }, // ~390 m, grande
    { lat: -27.6, lon: -48.5215, tags: { building: 'yes' } }, // sem tipo
    { lat: -27.6008, lon: -48.52, tags: { shop: 'bakery', name: 'Pão Quente' } }, // ~90 m
  ];
  const c = listarCandidatos(el, { lat: -27.6, lon: -48.52 });
  assert.deepEqual(c.map((x) => x.tipo), ['restaurante', 'padaria', 'faculdade']);
  assert.equal(c[2].grande, true);
});

test('agruparVisitas: ponto em movimento (vel > 2 m/s) não vira lugar nem estende a estadia', () => {
  const pontos = [
    ...serie('2026-09-28T12:00:00Z', TRAB, 4), // 09:00–09:45 parado
    { ts: new Date('2026-09-28T13:00:00Z'), lat: TRAB.lat + 0.0005, lon: TRAB.lon, vel: 8.3 }, // passando de carro ao lado
    { ts: new Date('2026-09-28T13:15:00Z'), lat: TRAB.lat + 0.01, lon: TRAB.lon, vel: 12 }, // na estrada
    ...serie('2026-09-28T14:00:00Z', TRAB, 3), // 11:00–11:30 de volta, parado
  ];
  const { lugares, visitas } = agruparVisitas({ pontos, fuso: F });
  assert.equal(lugares.length, 1, 'o ponto na estrada não cria lugar');
  assert.equal(visitas.length, 2, 'a passagem de carro separa as duas estadias');
  assert.equal(visitas[0].hIni, 9);
  assert.equal(visitas[1].hIni, 11);
});

import { ruaPermitida, abreviarRua } from '../lugares.js';
test('ruaPermitida e abreviarRua: rua só em lugar público; casa, casa de alguém e hotel nunca', () => {
  assert.equal(ruaPermitida({ tipo: 'academia', rua: 'Rua X' }), true);
  assert.equal(ruaPermitida({ tipo: 'faculdade' }), true);
  assert.equal(ruaPermitida({ papel: 'trabalho', tipo: 'trabalho' }), true);
  assert.equal(ruaPermitida({ papel: 'casa', tipo: 'residência' }), false);
  assert.equal(ruaPermitida({ tipo: 'residência' }), false);
  assert.equal(ruaPermitida({ tipo: 'casa', nome: 'da mãe do Heitor' }), false);
  assert.equal(ruaPermitida({ tipo: 'hotel' }), false);
  assert.equal(ruaPermitida(null), false);
  assert.equal(abreviarRua('Rua Lauro Linhares'), 'R. Lauro Linhares');
  assert.equal(abreviarRua('Avenida Beira-Mar Norte'), 'Av. Beira-Mar Norte');
  assert.equal(abreviarRua('Servidão Ana Bernardo'), 'Serv. Ana Bernardo');
});

import { transicaoDeSaida, lugarDeCompra } from '../lugares.js';
test('transicaoDeSaida: saiu do mercado depois de 10 min+ dispara; passagem rápida, mesmo lugar ou sem sinal não', () => {
  const mercado = { id: 'm1', tipo: 'mercado', nome: 'Bistek' };
  const dentro = { estado: 'lugar', lugar: mercado, desde: '17:02', minutos: 28 };
  assert.deepEqual(transicaoDeSaida(dentro, { estado: 'casa', desde: '17:45', minutos: 3 }), { evento: 'saiu_de_compra', lugar: mercado });
  assert.deepEqual(transicaoDeSaida(dentro, { estado: 'fora', movendo: true }), { evento: 'saiu_de_compra', lugar: mercado });
  assert.equal(transicaoDeSaida(dentro, { estado: 'lugar', lugar: mercado, minutos: 40 }), null);
  assert.equal(transicaoDeSaida(dentro, { estado: 'sem_sinal' }), null);
  assert.equal(transicaoDeSaida({ ...dentro, minutos: 4 }, { estado: 'casa' }), null);
  assert.equal(transicaoDeSaida({ estado: 'lugar', lugar: { id: 'a', tipo: 'academia' }, minutos: 60 }, { estado: 'casa' }), null);
  assert.equal(transicaoDeSaida(null, { estado: 'casa' }), null);
  assert.equal(lugarDeCompra({ tipo: 'padaria' }), true);
  assert.equal(lugarDeCompra({ tipo: 'faculdade' }), false);
});

import { treinoXRefeicoes } from '../contexto.js';
test('treinoXRefeicoes: café 29 min depois da academia é o pós-treino; whey 23 min antes é o pré; vôlei à noite sem pós', () => {
  const refeicoes = [
    { slot: 'lanche_manha', horaLocal: '06:43', descricao: '30g whey, creatina, leite' },
    { slot: 'cafe', horaLocal: '08:29', descricao: 'pão, queijo, Pro Force' },
    { slot: 'almoco', horaLocal: '14:03', descricao: 'arroz, feijão, linguiça' },
  ];
  const sessoes = [
    { nome: 'Body Pump (relógio)', inicio: 7 * 60 + 6, fim: 8 * 60 },
    { nome: 'Vôlei de areia', inicio: 17 * 60 + 30, fim: 20 * 60 },
  ];
  const r = treinoXRefeicoes({ refeicoes, sessoes });
  assert.equal(r.porRefeicao.get('06:43'), 'pré-treino de Body Pump (relógio)');
  assert.equal(r.porRefeicao.get('08:29'), 'pós-treino de Body Pump (relógio) (29 min depois)');
  assert.equal(r.porRefeicao.has('14:03'), false);
  assert.match(r.linhas[0], /^- Body Pump \(relógio\) 07:06–08:00: pré = lanche da manhã 06:43 \(30g whey, creatina, leite\); pós = café da manhã 08:29 \(pão, queijo, Pro Force\), 29 min depois$/);
  assert.match(r.linhas[1], /Vôlei de areia 17:30–20:00: pré = nada registrado até 90 min antes; pós = nada registrado até 90 min depois/);
  assert.deepEqual(treinoXRefeicoes({ refeicoes, sessoes: [] }).linhas, []);
});

import { resumirSessaoHevy } from '../contexto.js';
test('resumirSessaoHevy: melhor série, volume, RPE e progressão contra a sessão anterior; cobertura pré/pós no bloco', () => {
  const hoje = { titulo: 'Superior B', inicio: '2026-10-01T10:13:00Z', exercicios: [
    { title: 'Supino reto', sets: [{ type: 'warmup', weight_kg: 40, reps: 10 }, { type: 'normal', weight_kg: 70, reps: 8, rpe: 8 }, { type: 'normal', weight_kg: 70, reps: 7, rpe: 9 }] },
    { title: 'Remada curvada', sets: [{ type: 'normal', weight_kg: 60, reps: 10, rpe: 7 }, { type: 'normal', weight_kg: 60, reps: 10 }] },
  ] };
  const antes = { titulo: 'Superior B', inicio: '2026-09-24T10:10:00Z', exercicios: [
    { title: 'Supino reto', sets: [{ type: 'normal', weight_kg: 67.5, reps: 8 }, { type: 'normal', weight_kg: 67.5, reps: 8 }] },
    { title: 'Remada curvada', sets: [{ type: 'normal', weight_kg: 60, reps: 10 }, { type: 'normal', weight_kg: 60, reps: 10 }] },
  ] };
  const r = resumirSessaoHevy(hoje, [antes]);
  assert.equal(r.series, 4);
  assert.equal(r.volume, 70 * 8 + 70 * 7 + 60 * 20);
  assert.equal(r.rpe, 8);
  assert.equal(r.subiu, 1);
  assert.equal(r.caiu, 0);
  assert.match(r.detalhe, /2 exercícios, 4 séries, volume 2\.250 kg, RPE médio 8/);
  assert.match(r.detalhe, /Supino reto 70 kg×8 \(\+2,5 kg vs 24\/09\)/);
  assert.match(r.detalhe, /Remada curvada 60 kg×10 \(igual vs 24\/09\)/);
  // cobertura: pós com 35 g de proteína pra 77 kg (alvo 23 g) e energia +673 pra hipertrofia
  const refeicoes = [
    { slot: 'lanche_manha', horaLocal: '06:43', descricao: 'whey', estimativa: { kcal: 303, p: 30 } },
    { slot: 'cafe', horaLocal: '08:29', descricao: 'pão e Pro Force', estimativa: { kcal: 680, p: 35 } },
  ];
  const linhas = treinoXRefeicoes({ refeicoes, sessoes: [{ nome: 'Superior B (Hevy)', inicio: 7 * 60 + 13, fim: 7 * 60 + 59, kcal: 310, hevy: r }], perfil: { peso: 77, objetivo: 'Hipertrofia' } }).linhas;
  assert.match(linhas[0], /~310 kcal \(relógio\) · Hevy: 2 exercícios/);
  assert.match(linhas[0], /proteína no pós 35 g \(alvo ≥ 23 g\) ✓/);
  assert.match(linhas[0], /energia em volta do treino 983 kcal vs ~310 kcal gastas → \+673 kcal, coerente o ganho de massa pede ✓/);
  const perda = treinoXRefeicoes({ refeicoes, sessoes: [{ nome: 'X', inicio: 7 * 60 + 13, fim: 7 * 60 + 59, kcal: 310 }], perfil: { peso: 70, objetivo: 'perda de peso' } }).linhas[0];
  assert.match(perda, /fora do que a perda de peso pede ✗/);
});

import { kcalEstimadoSessao } from '../contexto.js';
test('sem kcal do relógio, o gasto do treino é estimado por MET e a cobertura é calculada mesmo assim', () => {
  assert.equal(kcalEstimadoSessao('Quinta — Superior B + abdômen', 46, 77), Math.round((5 * 77 * 46) / 60));
  assert.equal(kcalEstimadoSessao('Body Pump', 51, 77), Math.round((6.5 * 77 * 51) / 60));
  const refeicoes = [{ slot: 'cafe', horaLocal: '08:29', descricao: 'pão', estimativa: { kcal: 680, p: 35 } }];
  const l = treinoXRefeicoes({ refeicoes, sessoes: [{ nome: 'Superior B (Hevy)', inicio: 7 * 60 + 13, fim: 7 * 60 + 59, fcMedia: 124 }], perfil: { peso: 77, objetivo: 'Hipertrofia' } }).linhas[0];
  assert.match(l, /~295 kcal \(estimativa por MET; FC média 124 no relógio\)/);
  assert.match(l, /vs ~295 kcal gastas \(estimativa por MET\) → \+385 kcal, coerente o ganho de massa pede ✓/);
});

import { progressaoForca, suplementosPelosRegistros } from '../contexto.js';
test('progressaoForca: parado há 2+ semanas, subindo e caindo por exercício; suplementos pelos registros', () => {
  const sess = (dia, supino, remada, reps = 8) => ({ inicio: `${dia}T10:00:00Z`, exercicios: [
    { title: 'Supino reto', sets: [{ type: 'normal', weight_kg: supino, reps }] },
    { title: 'Remada', sets: [{ type: 'normal', weight_kg: remada, reps: 10 }] },
  ] });
  const sessoes = [sess('2026-08-20', 65, 50), sess('2026-08-27', 67.5, 52), sess('2026-09-03', 70, 54), sess('2026-09-10', 70, 56), sess('2026-09-17', 70, 58), sess('2026-09-24', 70, 60), sess('2026-10-01', 70, 62)];
  const p = progressaoForca(sessoes, { dia: '2026-10-01' });
  const supino = p.exercicios.find((e) => e.title === 'Supino reto');
  const remada = p.exercicios.find((e) => e.title === 'Remada');
  assert.equal(supino.situacao, 'parado');
  assert.equal(supino.semanasParado, 4);
  assert.equal(supino.ultimaSubida, '2026-09-03');
  assert.equal(remada.situacao, 'subindo');
  assert.equal(p.parados.length, 1);
  assert.equal(p.subindo.length, 1);
  // caindo: última menor que a primeira e que a anterior
  const queda = [sess('2026-09-10', 70, 60), sess('2026-09-17', 67.5, 60), sess('2026-09-24', 65, 60)];
  assert.equal(progressaoForca(queda, { dia: '2026-10-01' }).exercicios.find((e) => e.title === 'Supino reto').situacao, 'caindo');
  const sup = suplementosPelosRegistros([
    { dia: '2026-09-28', descricao: '30g whey, 5g creatina, 300ml leite' },
    { dia: '2026-09-29', descricao: '30g whey, 5g creatina' },
    { dia: '2026-09-29', descricao: '1 Pro Force 250ml, pão' },
    { dia: '2026-09-30', descricao: 'arroz e frango' },
  ]);
  assert.equal(sup.diasComRegistro, 3);
  assert.equal(sup.diasCreatina, 2);
  assert.equal(sup.diasWhey, 2);
  assert.equal(sup.hipercalorico, 1);
  assert.equal(sup.wheyMedio, 20);
});

test('progressaoForca ignora exercício sem carga (peso do corpo) e mostra reps quando a carga não mudou', () => {
  const s = (dia, kg, reps) => ({ inicio: `${dia}T10:00:00Z`, exercicios: [
    { title: 'Prancha', sets: [{ type: 'normal', weight_kg: 0, duration_seconds: 60 }] },
    { title: 'Panturrilha sentado', sets: [{ type: 'normal', weight_kg: kg, reps }] },
  ] });
  const p = progressaoForca([s('2026-09-10', 40, 12), s('2026-09-17', 40, 14), s('2026-09-24', 40, 16), s('2026-10-01', 40, 18)], { dia: '2026-10-01' });
  assert.equal(p.exercicios.some((e) => e.title === 'Prancha'), false);
  const pant = p.exercicios.find((e) => e.title === 'Panturrilha sentado');
  assert.equal(pant.situacao, 'subindo');
  assert.equal(pant.reps, 18);
});

import { gerarSugestoesCarga, conferirSugestoes, textoSugestoesCarga, incrementoDeCarga } from '../contexto.js';
test('sugestões de carga: incremento por tipo, geração a partir dos parados e conferência contra o Hevy', () => {
  assert.equal(incrementoDeCarga('Supino Inclinado (Halter)', 24), 2);
  assert.equal(incrementoDeCarga('Leg Press 45º (Máquina)', 190), 5);
  assert.equal(incrementoDeCarga('Agachamento (Barra)', 30), 2.5);
  assert.equal(incrementoDeCarga('Elevação Lateral (Halter)', 12), 1);
  const parados = [
    { title: 'Supino Inclinado (Halter)', melhor: 24, reps: 12, semanasParado: 3 },
    { title: 'Agachamento (Barra)', melhor: 30, reps: 10, semanasParado: 3 },
    { title: 'Prancha', melhor: 0, reps: 0, semanasParado: 6 },
    { title: 'Leg Press 45º (Máquina)', melhor: 190, reps: 12, semanasParado: 2 },
    { title: 'Tríceps na Polia', melhor: 28, reps: 15, semanasParado: 3 },
  ];
  const sug = gerarSugestoesCarga(parados, { dia: '2026-10-04', max: 3 });
  assert.equal(sug.length, 3);
  assert.equal(sug.some((s) => s.exercicio === 'Prancha'), false);
  const inc = sug.find((s) => s.exercicio === 'Supino Inclinado (Halter)');
  assert.equal(inc.paraKg, 26);
  assert.equal(inc.paraReps, 14);
  assert.equal(inc.status, 'aberta');
  // conferência: subiu o inclinado pra 26 no dia 06/10; agachamento feito 2x sem subir; tríceps não feito
  const sessoes = [
    { inicio: '2026-10-06T10:00:00Z', exercicios: [{ title: 'Supino Inclinado (Halter)', sets: [{ type: 'normal', weight_kg: 26, reps: 9 }] }, { title: 'Agachamento (Barra)', sets: [{ type: 'normal', weight_kg: 30, reps: 10 }] }] },
    { inicio: '2026-10-08T10:00:00Z', exercicios: [{ title: 'Agachamento (Barra)', sets: [{ type: 'normal', weight_kg: 30, reps: 11 }] }] },
    { inicio: '2026-10-03T10:00:00Z', exercicios: [{ title: 'Tríceps na Polia', sets: [{ type: 'normal', weight_kg: 40, reps: 10 }] }] }, // antes da sugestão: não conta
  ];
  const c = conferirSugestoes(sug, sessoes);
  const porEx = Object.fromEntries(c.map((s) => [s.exercicio, s]));
  assert.equal(porEx['Supino Inclinado (Halter)'].status, 'batida');
  assert.equal(porEx['Supino Inclinado (Halter)'].batidaEm, '2026-10-06');
  assert.equal(porEx['Agachamento (Barra)'].status, 'tentando');
  assert.equal(porEx['Agachamento (Barra)'].tentativas, 2);
  assert.equal(porEx['Tríceps na Polia'].status, 'aberta');
  const t = textoSugestoesCarga(c, { hoje: '2026-10-09' });
  assert.match(t, /Supino Inclinado \(Halter\): de 24 kg×12 para 26 kg \(ou 14 repetições com 24 kg\) → BATEU em 06\/10 \(26 kg\) ✓/);
  assert.match(t, /Agachamento \(Barra\).*fez o exercício 2x e ainda não subiu/);
  assert.match(t, /Tríceps na Polia.*ainda não fez o exercício/);
  // reps na carga de partida também batem
  const c2 = conferirSugestoes(sug, [{ inicio: '2026-10-07T10:00:00Z', exercicios: [{ title: 'Tríceps na Polia', sets: [{ type: 'normal', weight_kg: 28, reps: 17 }] }] }]);
  assert.equal(c2.find((s) => s.exercicio === 'Tríceps na Polia').status, 'batida');
  assert.equal(textoSugestoesCarga([]), '');
});

import { semanaTipica } from '../lugares.js';
import { semanaDoPlano } from '../resumo.js';

test('semanaTipica: paradas por dia da semana, refeição em casa/fora/em cima de treino, ruído fora', () => {
  const perfil = {
    nome: 'Lucas Leonardo',
    lugares: [
      { papel: 'casa', diasIdx: [1, 2, 3, 4, 5], horaTipica: 17.7, horaFim: 6.5, dias: 20 },
      { tipo: 'academia', nome: 'Garra', diasIdx: [1, 2, 3, 4, 5], horaTipica: 7.1, horaFim: 8, dias: 15 },
      { tipo: 'faculdade', nome: 'UFSC (ECV)', diasIdx: [1, 2, 3, 4], horaTipica: 10, horaFim: 12.6, dias: 12, manual: true },
      { papel: 'trabalho', tipo: 'trabalho', nome: 'CELTA', diasIdx: [1], horaTipica: 12.1, horaFim: 17.2, dias: 4, manual: true },
      { tipo: 'faculdade', nome: 'UFSC (Trindade)', diasIdx: [1, 3], horaTipica: 15.1, horaFim: 18.2, dias: 6, manual: true },
      { tipo: 'loja', nome: 'Salão', diasIdx: [1], horaTipica: 16.7, horaFim: 17.3, dias: 5 }, // ruído
      { tipo: 'faculdade', nome: 'Senac', diasIdx: [2], horaTipica: 18.8, horaFim: 19.1, dias: 3 }, // passagem de 18 min
      { tipo: 'parque', nome: 'Praça Berman', diasIdx: [4], horaTipica: 17.3, horaFim: 20.1, dias: 6, manual: true }, // coincide com o vôlei
      { tipo: 'casa', nome: 'da mãe do Heitor', manual: true, diasIdx: [0, 6], horaTipica: 12.4, horaFim: 15.1, dias: 5 }, // tipo casa com nome = casa de outra pessoa
    ],
    atividades: [
      { nome: 'Vôlei de quadra', dias: [1, 3], inicio: '20:00', fim: '22:00' },
      { nome: 'Vôlei de areia', dias: [4], inicio: '17:30', fim: '20:00' },
    ],
  };
  const hab = { cafe: { minutos: 8 * 60 + 29 }, almoco: { minutos: 14 * 60 + 3 }, lanche: { minutos: 17 * 60 + 55 }, jantar: { minutos: 20 * 60 + 22 } };
  const semana = semanaDoPlano('2026-10-02'); // sexta -> plano de seg 05/10 a dom 11/10
  const txt = semanaTipica({ perfil, semana, hab, slots: ['cafe', 'almoco', 'lanche', 'jantar'] });
  const seg = txt.split('\n').filter((l) => /Segunda 05\/10|^  refeições/.test(l));
  assert.match(txt, /^SEMANA TÍPICA DE LUCAS/);
  const linhaSeg = txt.slice(txt.indexOf('- Segunda 05/10'), txt.indexOf('- Terça 06/10'));
  assert.match(linhaSeg, /academia 07:06–08:00 · faculdade 10:00–12:36 · trabalho 12:06–17:12 · faculdade 15:06–18:12 · Vôlei de quadra 20:00–22:00/);
  assert.doesNotMatch(linhaSeg, /loja|Salão|CELTA|Garra/); // ruído fora; nome de lugar privado não sai
  assert.match(linhaSeg, /café da manhã 08:29: em casa \(provável\)/);
  assert.match(linhaSeg, /almoço 14:03: fora de casa, em trabalho/);
  assert.match(linhaSeg, /lanche da tarde 17:55: fora de casa, em faculdade/);
  assert.match(linhaSeg, /jantar 20:22: em cima de Vôlei de quadra \(20:00–22:00\): desloque/);
  const linhaTer = txt.slice(txt.indexOf('- Terça 06/10'), txt.indexOf('- Quarta 07/10'));
  assert.doesNotMatch(linhaTer, /Senac|faculdade 18:48/); // passagem de 18 min não é parada
  const linhaQui = txt.slice(txt.indexOf('- Quinta 08/10'), txt.indexOf('- Sexta 09/10'));
  assert.match(linhaQui, /Vôlei de areia 17:30–20:00/);
  assert.doesNotMatch(linhaQui, /parque/); // a praça do vôlei não entra duas vezes
  assert.match(linhaQui, /lanche da tarde 17:55: em cima de Vôlei de areia/);
  const linhaDom = txt.slice(txt.indexOf('- Domingo 11/10'));
  assert.match(linhaDom, /casa de família \(fora da sua casa\) 12:24–15:06/);
  assert.match(linhaDom, /almoço 14:03: fora de casa, em casa de família/);
  assert.equal(seg.length >= 1, true);
  // sem semana ou sem perfil: vazio
  assert.equal(semanaTipica({ perfil: null, semana }), '');
});

test('roteiroDoDia: cruza com o celular (em casa), tira lugar fraco e velho, e não diz que foi onde não foi', () => {
  const lugares = [
    { id: 'quadra', tipo: 'quadra de vôlei de areia', nome: 'Arena', diasIdx: [0, 6], horaTipica: 9.9, horaFim: 12.6, dias: 3, manual: true, ultimaVez: '2026-08-15' }, // sem ida há 7 semanas
    { id: 'mae', tipo: 'casa', nome: 'da mãe', diasIdx: [0, 5, 6], horaTipica: 12.4, horaFim: 15.1, dias: 8, manual: true, ultimaVez: '2026-09-19' },
    { id: 'senac', tipo: 'faculdade', nome: 'Senac', diasIdx: [2, 5, 6], horaTipica: 18.8, horaFim: 19.1, dias: 4, porDow: [0, 0, 1, 0, 0, 1, 2], ultimaVez: '2026-09-26' }, // 18 min de passagem
    { id: 'salao', tipo: 'loja', nome: 'Salão', diasIdx: [0, 2, 5, 6], horaTipica: 16.7, horaFim: 17.3, dias: 6, porDow: [1, 0, 1, 0, 0, 2, 2], ultimaVez: '2026-09-26' },
    { id: 'pilates', tipo: 'academia', nome: 'Omnia', diasIdx: [6], horaTipica: 17.3, horaFim: 18.3, dias: 2, porDow: [0, 0, 0, 0, 0, 0, 2], ultimaVez: '2026-09-26' }, // 2 dias só
    { id: 'igreja', tipo: 'igreja', diasIdx: [5, 6], horaTipica: 21.9, horaFim: 24, dias: 5, porDow: [0, 0, 0, 0, 0, 2, 3], ultimaVez: '2026-09-27' },
  ];
  const base = { lugares, agenda: [], treinos: [], dow: 6, fuso: 'America/Sao_Paulo', nomeDia: 'sábado', dia: '2026-10-03' };
  const emCasa = roteiroDoDia({ ...base, horaAgora: 17.5, situacao: { estado: 'casa', desde: '11:29' }, visitasHoje: [] });
  assert.match(emCasa, /^AGORA \(celular, isto é FATO\): em casa/);
  assert.match(emCasa, /NÃO ACONTECEU HOJE[^\n]*casa da mãe/);
  assert.match(emCasa, /NÃO ACONTECEU HOJE[^\n]*loja Salão/);
  assert.doesNotMatch(emCasa, /Arena|Senac|Omnia|✓/);
  assert.match(emCasa, /21:54–24:00 igreja[^→\n]*\(só se sair de casa\)/);
  assert.match(emCasa, /probabilidade pelo dia da semana, NÃO é fato/);
  // esteve no salão de verdade: vira "feito, confirmado pelo celular"
  const foi = roteiroDoDia({ ...base, horaAgora: 17.5, situacao: { estado: 'casa', desde: '17:40' }, visitasHoje: [{ lugar: { id: 'salao' } }] });
  assert.match(foi, /loja Salão[^→\n]*\(feito, confirmado pelo celular\)/);
  assert.doesNotMatch(foi, /NÃO ACONTECEU HOJE[^\n]*Salão/);
  // sem sinal do celular: nada é dado como "não foi"
  const semSinal = roteiroDoDia({ ...base, horaAgora: 17.5, situacao: { estado: 'sem_sinal' }, visitasHoje: [] });
  assert.doesNotMatch(semSinal, /NÃO ACONTECEU/);
  assert.match(semSinal, /casa da mãe[^→\n]*\(já passou\)/);
});
