// lugares.js - Lugares significativos da pessoa a partir da localização aproximada que o app Relógio manda a cada 15 min
// (e da exportação da Linha do Tempo do Google, como semente). Pontos brutos vivem 7 dias; o que fica é a lista de lugares
// (casa, trabalho, faculdade, academia, restaurante, mercado...) com o padrão semanal de cada um. Tipo e bairro vêm do
// OpenStreetMap (Overpass + Nominatim), sem chave. Tudo é da pessoa: só entra na conversa COM ela e nunca com endereço.

import { colecao, salvarPerfil } from './mongo.js';
import { fusoDe } from './util.js';

export const RAIO_LUGAR_M = 150; // mesmo lugar
export const PARADA_MIN = 20; // parada que conta como visita
const CREDITO_MIN = 10; // amostra a cada 15 min: a estadia real é maior que o intervalo entre o primeiro e o último ponto
const CORTE_GAP_MIN = 180; // mais de 3 h sem ponto (celular desligado) fecha a estadia
const ACC_MAX_M = 500; // ponto pior que isso não serve
const ATUAL_MIN = 45; // último ponto vale como "agora" por este tempo
const BRUTOS_DIAS = 7;
const VISITAS_DIAS = 90;
const MAX_LUGARES = 25;
const CLASSIFICAR_POR_VEZ = 3; // consultas ao OSM por rodada (educação com o serviço gratuito)
const MERCADOS_DIAS = 14;
const UA = `NutriBot-Lugares/1.0 (${process.env.CONTATO_EMAIL || 'contato nao informado'})`;

const NOME_DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// ---------- geometria e tempo ----------
export function distanciaM(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/** Data local (dia AAAA-MM-DD, hora decimal, dia da semana) de um instante no fuso da pessoa. */
export function localDe(ts, fuso = 'America/Sao_Paulo') {
  const d = ts instanceof Date ? ts : new Date(ts);
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.weekday);
  return { dia: `${partes.year}-${partes.month}-${partes.day}`, hora: Number(partes.hour) + Number(partes.minute) / 60, dow, hhmm: `${partes.hour}:${partes.minute}` };
}
const idDe = (p) => `l${p.lat.toFixed(4)}_${p.lon.toFixed(4)}`.replace(/[.-]/g, (c) => (c === '.' ? 'p' : 'm'));
const maisPerto = (p, lugares, raio = RAIO_LUGAR_M) => {
  let melhor = null;
  for (const l of lugares) {
    const d = distanciaM(p, l);
    if (d <= raio && (!melhor || d < melhor.d)) melhor = { l, d };
  }
  return melhor?.l || null;
};

// ---------- agrupamento (puro, testável) ----------
/**
 * pontos = [{ ts, lat, lon }] em ordem de tempo; lugares = os já conhecidos [{ id, lat, lon, ... }].
 * Devolve { lugares (conhecidos + novos com visita), visitas: [{ lugarId, inicio, fim, min, dia, dow, hIni, hFim }] }.
 */
export function agruparVisitas({ pontos, lugares = [], fuso = 'America/Sao_Paulo' }) {
  const lista = lugares.map((l) => ({ ...l }));
  const novos = new Map(); // id -> { id, lat, lon, n, somaLat, somaLon }
  const visitas = [];
  let atual = null;
  const fechar = () => {
    if (!atual) return;
    const min = (atual.fim.getTime() - atual.inicio.getTime()) / 60000 + CREDITO_MIN;
    if (min >= PARADA_MIN) {
      const li = localDe(atual.inicio, fuso);
      const lf = localDe(atual.fim, fuso);
      visitas.push({ lugarId: atual.lugarId, inicio: atual.inicio, fim: atual.fim, min: Math.round(min), dia: li.dia, dow: li.dow, hIni: Math.round(li.hora * 10) / 10, hFim: Math.round(lf.hora * 10) / 10 });
      const n = novos.get(atual.lugarId);
      if (n) n.comVisita = true;
    }
    atual = null;
  };
  const ordenados = [...pontos].map((p) => ({ ...p, ts: p.ts instanceof Date ? p.ts : new Date(p.ts) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && !Number.isNaN(p.ts.getTime())).sort((a, b) => a.ts - b.ts);
  for (const p of ordenados) {
    let lugar = maisPerto(p, lista) || maisPerto(p, [...novos.values()]);
    if (!lugar) {
      lugar = { id: idDe(p), lat: p.lat, lon: p.lon, n: 0, somaLat: 0, somaLon: 0, novo: true };
      novos.set(lugar.id, lugar);
    }
    if (lugar.novo) {
      // centro do lugar novo = média dos pontos (o primeiro ponto pode estar na borda)
      lugar.n += 1;
      lugar.somaLat += p.lat;
      lugar.somaLon += p.lon;
      lugar.lat = lugar.somaLat / lugar.n;
      lugar.lon = lugar.somaLon / lugar.n;
    }
    if (atual && atual.lugarId === lugar.id && (p.ts - atual.fim) / 60000 <= CORTE_GAP_MIN) {
      atual.fim = p.ts;
    } else {
      fechar();
      atual = { lugarId: lugar.id, inicio: p.ts, fim: p.ts };
    }
  }
  fechar();
  for (const n of novos.values()) if (n.comVisita) lista.push({ id: n.id, lat: Math.round(n.lat * 1e5) / 1e5, lon: Math.round(n.lon * 1e5) / 1e5 });
  return { lugares: lista, visitas };
}

/** Estatísticas por lugar a partir das visitas: contagem, minutos, padrão semanal, noites (pra achar a casa). */
export function estatisticasDosLugares(lugares, visitas) {
  const por = new Map(lugares.map((l) => [l.id, { ...l, visitas: 0, minutos: 0, noites: 0, dias: new Set(), dows: Array(7).fill(0), hIni: [], hFim: [], primeiraVez: null, ultimaVez: null, diasUteisDia: 0 }]));
  for (const v of visitas) {
    const s = por.get(v.lugarId);
    if (!s) continue;
    s.visitas += 1;
    s.minutos += v.min || 0;
    s.dias.add(v.dia);
    s.dows[v.dow] += 1;
    s.hIni.push(v.hIni);
    s.hFim.push(v.hFim);
    // dormiu aí: começou de noite e/ou acabou de manhã, com pelo menos 4 h
    if ((v.min || 0) >= 240 && (v.hIni >= 21 || v.hIni <= 3 || (v.hFim >= 4 && v.hFim <= 10))) s.noites += 1;
    if (v.dow >= 1 && v.dow <= 5 && v.hIni >= 7 && v.hIni <= 15 && (v.min || 0) >= 150) s.diasUteisDia += 1;
    if (!s.primeiraVez || v.dia < s.primeiraVez) s.primeiraVez = v.dia;
    if (!s.ultimaVez || v.dia > s.ultimaVez) s.ultimaVez = v.dia;
  }
  const med = (xs) => {
    if (!xs.length) return null;
    const o = [...xs].sort((a, b) => a - b);
    return o[Math.floor(o.length / 2)];
  };
  const hStr = (h) => (h == null ? '' : `${Math.floor(h)}h${Math.round((h % 1) * 60) ? String(Math.round((h % 1) * 60)).padStart(2, '0') : ''}`);
  const saida = [];
  for (const s of por.values()) {
    // dias em que o lugar aparece de verdade (pelo menos 12% das visitas): "seg, qua, sex", "dias úteis", "fim de semana" ou "todo dia"
    const diasIdx = s.dows.map((n, i) => ({ n, i })).filter((x) => x.n >= Math.max(1, s.visitas * 0.12)).map((x) => x.i);
    const uteis = [1, 2, 3, 4, 5];
    let diasTxt;
    if (diasIdx.length >= 6) diasTxt = 'todo dia';
    else if (diasIdx.length === 5 && uteis.every((d) => diasIdx.includes(d))) diasTxt = 'dias úteis';
    else if (diasIdx.length === 2 && diasIdx.includes(0) && diasIdx.includes(6)) diasTxt = 'fim de semana';
    else diasTxt = diasIdx.map((i) => NOME_DOW[i]).join(', ');
    const padrao = s.visitas ? `${diasTxt}${s.hIni.length ? ` · ${hStr(med(s.hIni))} às ${hStr(med(s.hFim))}` : ''}` : '';
    saida.push({ ...s, dias: s.dias.size, dows: undefined, hIni: undefined, hFim: undefined, somaLat: undefined, somaLon: undefined, n: undefined, novo: undefined, padrao, horaTipica: med(s.hIni), horaFim: med(s.hFim), diasIdx });
  }
  // casa = onde mais dorme; sem noites (primeiros dias), onde mais fica
  // casa marcada à mão manda: nenhum outro lugar vira casa
  const casaManual = saida.some((l) => l.manual && l.papel === 'casa');
  const candidataCasa = casaManual ? null : saida.filter((l) => !l.manual).sort((a, b) => b.noites - a.noites || b.minutos - a.minutos)[0];
  for (const l of saida) {
    if (l.manual) continue;
    if (candidataCasa && l.id === candidataCasa.id && (l.noites >= 2 || (!saida.some((x) => x.noites >= 2) && l.minutos >= 600))) l.papel = 'casa';
    else if (l.papel === 'casa') l.papel = null;
  }
  // trabalho é UM lugar: o que mais tem dias úteis em horário comercial (empate: o que o Google já chamava de trabalho), e nunca
  // um lugar que o mapa diz ser academia, faculdade, restaurante, mercado etc.
  const podeSerTrabalho = (l) => !l.manual && l.papel !== 'casa' && (!l.tipo || ['trabalho', 'outro', 'residência', 'loja', 'café'].includes(l.tipo));
  const trabalhoManual = saida.some((l) => l.manual && l.papel === 'trabalho');
  const candidatoTrab = trabalhoManual ? null : saida.filter((l) => podeSerTrabalho(l) && l.diasUteisDia >= 3).sort((a, b) => b.diasUteisDia - a.diasUteisDia || (b.papel === 'trabalho') - (a.papel === 'trabalho') || b.minutos - a.minutos)[0];
  for (const l of saida) {
    if (l.manual || l.papel === 'casa') continue;
    if (l.papel === 'trabalho' && (!candidatoTrab || l.id !== candidatoTrab.id)) l.papel = null;
    if (candidatoTrab && l.id === candidatoTrab.id) l.papel = 'trabalho';
  }
  return saida.map((l) => JSON.parse(JSON.stringify(l)));
}

// ---------- OpenStreetMap: tipo do lugar e bairro ----------
const TIPO_POR_TAG = [
  [/^leisure=(fitness_centre|sports_centre|swimming_pool|fitness_station)$/, 'academia'],
  [/^club=sport$/, 'academia'],
  [/^amenity=(university|college)$/, 'faculdade'],
  [/^amenity=(school|kindergarten|language_school|music_school|driving_school)$/, 'escola'],
  [/^amenity=library$/, 'faculdade'],
  [/^amenity=(restaurant|fast_food|food_court)$/, 'restaurante'],
  [/^amenity=(cafe|ice_cream)$/, 'café'],
  [/^amenity=(bar|pub|nightclub|biergarten)$/, 'bar'],
  [/^shop=(supermarket|convenience|greengrocer|butcher|deli|grocery|frozen_food|wholesale|health_food)$/, 'mercado'],
  [/^amenity=marketplace$/, 'mercado'],
  [/^shop=(bakery|pastry|confectionery)$/, 'padaria'],
  [/^amenity=(hospital|clinic|doctors|dentist|pharmacy|veterinary)$/, 'saúde'],
  [/^shop=(chemist|nutrition_supplements)$/, 'saúde'],
  [/^leisure=(park|garden|pitch|stadium|track|playground|nature_reserve)$/, 'parque'],
  [/^natural=beach$/, 'praia'],
  [/^amenity=place_of_worship$/, 'igreja'],
  [/^tourism=(hotel|hostel|guest_house|apartment)$/, 'hotel'],
  [/^(amenity=bus_station|railway=station|public_transport=station|aeroway=(terminal|aerodrome))$/, 'transporte'],
  [/^shop=mall$/, 'shopping'],
  [/^shop=/, 'loja'],
  [/^office=/, 'trabalho'],
  [/^building=(office|commercial|industrial|warehouse|retail)$/, 'trabalho'],
  [/^landuse=(industrial|commercial|retail)$/, 'trabalho'],
  [/^building=(residential|apartments|house|detached|terrace|dormitory)$/, 'residência'],
  [/^landuse=residential$/, 'residência'],
];
export function tipoDeTags(tags = {}) {
  for (const [k, v] of Object.entries(tags)) {
    const par = `${k}=${v}`;
    for (const [re, tipo] of TIPO_POR_TAG) if (re.test(par)) return tipo;
  }
  return null;
}
/** Escolhe, entre os elementos do Overpass, o que melhor descreve o ponto: POI com nome perto ganha de área genérica. */
export function escolherElemento(elementos, centro) {
  const cands = [];
  for (const e of elementos || []) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const tipo = tipoDeTags(e.tags);
    if (!tipo || lat == null) continue;
    const d = distanciaM(centro, { lat, lon });
    const nome = e.tags?.name || e.tags?.brand || null;
    const generico = ['residência', 'trabalho'].includes(tipo) && !nome;
    // pontuação: POI nomeado e perto primeiro; área genérica só se não houver nada melhor
    const score = (nome ? 0 : 60) + (generico ? 120 : 0) + d;
    cands.push({ tipo, nome, d: Math.round(d), score, generico });
  }
  cands.sort((a, b) => a.score - b.score);
  return cands[0] || null;
}
// o servidor público principal vive sobrecarregado (504): tenta os espelhos em sequência
const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const FILTROS_GRANDES = ['[amenity~"^(university|college|hospital)$"]', '[shop=mall]', '[leisure~"^(stadium|sports_centre)$"]', '[aeroway=aerodrome]'];
/** filtros = ['[amenity]', ...] no raio dado; extras = [{ raio, filtros }] pra somar outra busca na mesma consulta. */
async function overpass(lat, lon, raio, filtros, extras = []) {
  const bloco = (r, fs) => fs.map((f) => `nwr(around:${r},${lat},${lon})${f};`).join('');
  const q = `[out:json][timeout:10];(${bloco(raio, filtros)}${extras.map((x) => bloco(x.raio, x.filtros)).join('')});out center tags 40;`;
  let ultimo = null;
  for (const url of OVERPASS_URLS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`overpass ${r.status} (${new URL(url).host})`);
      return (await r.json()).elements || [];
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo || new Error('overpass indisponível');
}
// lugar "grande" (campus, shopping, hospital, estádio): estar perto do centro dele já é estar nele; ganha do POI miúdo ao lado.
// O alcance depende do tamanho típico: um campus universitário tem centenas de metros, um shopping uns 300 m.
const GRANDES = [
  [/^amenity=(university|college)$/, 700],
  [/^amenity=hospital$/, 400],
  [/^shop=mall$/, 300],
  [/^leisure=(stadium|sports_centre)$/, 300],
  [/^aeroway=aerodrome$/, 1000],
];
export function escolherGrande(elementos, centro) {
  let melhor = null;
  for (const e of elementos || []) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null) continue;
    for (const [k, v] of Object.entries(e.tags || {})) {
      const regra = GRANDES.find(([re]) => re.test(`${k}=${v}`));
      if (!regra) continue;
      const d = distanciaM(centro, { lat, lon });
      // pontua pela fração do alcance: a 200 m de um campus (700) é "mais dentro" do que a 200 m de um shopping (300)
      const score = d / regra[1];
      if (d <= regra[1] && (!melhor || score < melhor.score)) melhor = { tipo: tipoDeTags({ [k]: v }), nome: e.tags.name || e.tags.brand || null, d: Math.round(d), score };
    }
  }
  return melhor;
}
/** Photon (komoot): os POIs mais próximos, no mesmo formato de elementos do Overpass (lat/lon + tags), pra reaproveitar a escolha. */
async function photon(lat, lon) {
  // raio de 1 km e 40 resultados: o centro de um campus ou shopping fica longe de quem está na borda dele
  const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=40&radius=1&lang=default`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`photon ${r.status}`);
  const j = await r.json();
  return (j.features || [])
    .filter((f) => f.geometry?.coordinates && f.properties?.osm_key)
    .map((f) => ({ type: f.properties.osm_type, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], tags: { [f.properties.osm_key]: f.properties.osm_value, ...(f.properties.name ? { name: f.properties.name } : {}) } }));
}
async function nominatim(lat, lon) {
  // zoom 18 = o objeto mais próximo (prédio da universidade, loja, restaurante) além do endereço: serve de tipo quando o Overpass falha
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&extratags=1`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt,fr,en' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`nominatim ${r.status}`);
  const j = await r.json();
  const a = j.address || {};
  const tipo = tipoDeTags({ [j.category || '']: j.type || '', ...(j.extratags || {}) });
  return {
    bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || null,
    cidade: a.city || a.town || a.municipality || a.county || null,
    tipo,
    nome: tipo && !['residência', 'trabalho', 'outro'].includes(tipo) ? j.name || null : null,
  };
}
/** Tipo, nome (só de POI: academia, restaurante, mercado; nunca de casa), bairro e cidade de um ponto; cache de 30 dias. */
export async function classificarOSM({ lat, lon }) {
  const chave = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cache = colecao('osm_cache');
  const c = await cache.findOne({ _id: chave }).catch(() => null);
  const idade = c ? Date.now() - new Date(c.em).getTime() : Infinity;
  // resposta completa vale 30 dias; se o Overpass falhou, o bairro fica guardado e o tipo é tentado de novo em 1 h
  if (c && idade < (c.completo ? 30 * 86400_000 : 3600_000)) return c.dado;
  const dado = { tipo: null, nome: null, bairro: c?.dado?.bairro || null, cidade: c?.dado?.cidade || null };
  let completo = true;
  // 1) Nominatim (rápido e estável): bairro, cidade e o objeto mais próximo como tipo provisório
  let nom = null;
  try {
    nom = await nominatim(lat, lon);
    dado.bairro = nom.bairro || dado.bairro;
    dado.cidade = nom.cidade || dado.cidade;
  } catch (e) {
    completo = false;
    console.warn('[lugares] nominatim:', e.message);
  }
  // 2) Photon (komoot; rápido, sem chave) e, só se ele não souber, Overpass: POI nomeado a 120 m, ou campus/shopping/hospital a 300 m
  const centro = { lat, lon };
  let e = null;
  try {
    const el = await photon(lat, lon);
    e = escolherGrande(el, centro) || escolherElemento(el, centro);
  } catch (err) {
    console.warn('[lugares] photon:', err.message);
  }
  if (!e) {
    try {
      const el = await overpass(lat, lon, 120, ['[amenity]', '[leisure]', '[shop]', '[office]', '[club]', '[tourism]', '[natural=beach]', '[building]'], [{ raio: 300, filtros: FILTROS_GRANDES }]);
      e = escolherGrande(el, centro) || escolherElemento(el, centro);
    } catch (err) {
      console.warn('[lugares] overpass:', err.message);
      // sem Overpass, o tipo do Nominatim resolve; se nem ele soube, fica pendente e tenta de novo em 1 h
      if (!nom?.tipo) completo = false;
    }
  }
  if (e) {
    dado.tipo = e.tipo;
    dado.nome = e.generico || ['residência'].includes(e.tipo) ? null : e.nome;
  }
  if (!dado.tipo && nom?.tipo) {
    dado.tipo = nom.tipo;
    dado.nome = nom.nome;
  }
  if (!dado.tipo && completo) dado.tipo = 'outro';
  await cache.replaceOne({ _id: chave }, { _id: chave, dado, em: new Date(), completo }, { upsert: true }).catch(() => {});
  return dado;
}

// ---------- banco ----------
const jidDe = (perfil) => perfil?.jids?.[0] || null;
/** Guarda os pontos vindos do app (lat/lon/acc/ts), ignora ruim e repetido, e recalcula os lugares. */
export async function receberLocais(perfil, locais, fuso = fusoDe(perfil)) {
  const jid = jidDe(perfil);
  if (!jid || !Array.isArray(locais) || !locais.length) return { recebidos: 0 };
  const docs = [];
  for (const l of locais.slice(-200)) {
    const lat = Number(l.lat);
    const lon = Number(l.lon);
    const acc = l.acc == null ? null : Number(l.acc);
    const ts = new Date(l.ts || l.hora || Date.now());
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || Number.isNaN(ts.getTime())) continue;
    if (acc != null && acc > ACC_MAX_M) continue;
    docs.push({ jid, ts, dia: localDe(ts, fuso).dia, lat, lon, acc, em: new Date() });
  }
  if (!docs.length) return { recebidos: 0 };
  const col = colecao('locais_brutos');
  let inseridos = 0;
  try {
    const r = await col.insertMany(docs, { ordered: false });
    inseridos = r.insertedCount;
  } catch (e) {
    inseridos = e.result?.insertedCount ?? e.insertedCount ?? 0; // duplicados (mesmo ts) caem no índice único
  }
  if (!perfil.lugaresAtivo) await salvarPerfil({ jids: perfil.jids, lugaresAtivo: true }).catch(() => {});
  // agrupamento é rápido e responde ao app; a consulta ao OpenStreetMap (lenta, às vezes fora do ar) roda depois, sem segurar a resposta
  const situacao = await atualizarLugares({ ...perfil, lugaresAtivo: true }, { classificar: false }).catch((e) => (console.error('[lugares] atualizar:', e.message), null));
  classificarPendentes(perfil).catch((e) => console.warn('[lugares] classificar:', e.message));
  return { recebidos: inseridos, situacao };
}

let classificando = false;
/** Dá tipo/bairro (OSM) a até 3 lugares ainda sem tipo; uma rodada por vez, fora do caminho da resposta HTTP. */
export async function classificarPendentes(perfil) {
  if (classificando) return;
  classificando = true;
  try {
    const atual = (await colecao('perfis').findOne({ jids: { $in: perfil.jids || [] } }, { projection: { lugares: 1 } }))?.lugares || [];
    const pendentes = atual.filter((l) => !l.tipo && !l.manual).slice(0, CLASSIFICAR_POR_VEZ);
    if (!pendentes.length) return;
    const patch = new Map();
    for (const l of pendentes) {
      const c = await classificarOSM({ lat: l.lat, lon: l.lon }).catch(() => null);
      if (c) patch.set(l.id, c);
    }
    if (!patch.size) return;
    // relê antes de gravar: outro envio pode ter mexido na lista enquanto o OSM respondia
    const fresco = (await colecao('perfis').findOne({ jids: { $in: perfil.jids || [] } }, { projection: { lugares: 1 } }))?.lugares || [];
    const lugares = fresco.map((l) => {
      const c = patch.get(l.id);
      if (!c || l.manual) return l;
      return { ...l, tipo: c.tipo || l.tipo || null, nome: l.papel === 'casa' ? null : c.nome || l.nome || null, bairro: c.bairro || l.bairro || null, cidade: c.cidade || l.cidade || null };
    });
    await salvarPerfil({ jids: perfil.jids, lugares });
    console.log(`[lugares] ${perfil.nome}: ${patch.size} lugar(es) classificado(s) pelo OSM`);
  } finally {
    classificando = false;
  }
}

async function visitasRecentes(jid, dias = VISITAS_DIAS) {
  const desde = new Date(Date.now() - dias * 86400_000);
  return colecao('visitas').find({ jid, inicio: { $gte: desde } }).sort({ inicio: 1 }).toArray();
}
async function gravarVisitas(jid, visitas) {
  if (!visitas.length) return;
  const col = colecao('visitas');
  await col.bulkWrite(
    visitas.map((v) => ({ replaceOne: { filter: { jid, inicio: v.inicio }, replacement: { jid, ...v }, upsert: true } })),
    { ordered: false }
  );
}

/**
 * Recalcula visitas (pontos brutos dos últimos 7 dias) e a lista de lugares do perfil (visitas dos últimos 90 dias),
 * classifica até 3 lugares novos pelo OSM e salva em perfil.lugares. Devolve a situação atual.
 */
export async function atualizarLugares(perfil, { classificar = true } = {}) {
  const jid = jidDe(perfil);
  if (!jid) return null;
  const fuso = fusoDe(perfil);
  const desde = new Date(Date.now() - BRUTOS_DIAS * 86400_000);
  const pontos = await colecao('locais_brutos').find({ jid, ts: { $gte: desde } }).sort({ ts: 1 }).toArray();
  const conhecidos = perfil.lugares || [];
  const { lugares, visitas } = agruparVisitas({ pontos, lugares: conhecidos, fuso });
  await gravarVisitas(jid, visitas);
  const todas = await visitasRecentes(jid);
  // lugar que aparece nas visitas antigas (semente da Linha do Tempo) mas saiu da lista: recria pelo id? não dá (sem coordenadas); ignora
  let stats = estatisticasDosLugares(lugares, todas);
  // fica quem tem 2+ visitas ou 1 h+ (ou foi marcado à mão); some quem não aparece há 60 dias com menos de 3 visitas
  const corte = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
  stats = stats.filter((l) => l.manual || l.visitas >= 2 || l.minutos >= 60).filter((l) => l.manual || !l.ultimaVez || l.ultimaVez >= corte || l.visitas >= 3);
  stats.sort((a, b) => (b.papel === 'casa') - (a.papel === 'casa') || b.minutos - a.minutos);
  stats = stats.slice(0, MAX_LUGARES);
  if (classificar) {
    let feitos = 0;
    for (const l of stats) {
      if (l.tipo || l.manual || feitos >= CLASSIFICAR_POR_VEZ) continue;
      const c = await classificarOSM({ lat: l.lat, lon: l.lon }).catch(() => null);
      feitos += 1;
      if (!c) continue;
      l.tipo = c.tipo;
      l.nome = c.nome;
      l.bairro = c.bairro;
      l.cidade = c.cidade;
    }
  }
  for (const l of stats) if (l.papel === 'casa') l.nome = null; // casa nunca leva nome de estabelecimento
  await salvarPerfil({ jids: perfil.jids, lugares: stats, lugaresAtualizadoEm: new Date().toISOString() }).catch((e) => console.error('[lugares] salvar:', e.message));
  return situacaoAtual({ ...perfil, lugares: stats }, pontos);
}

/** Onde a pessoa está agora, pelo último ponto: em casa / num lugar conhecido / fora / sem sinal recente. */
export async function situacaoAtual(perfil, pontosCarregados = null) {
  const jid = jidDe(perfil);
  if (!jid || !perfil.lugaresAtivo) return null;
  const pontos = pontosCarregados || (await colecao('locais_brutos').find({ jid, ts: { $gte: new Date(Date.now() - 12 * 3600_000) } }).sort({ ts: 1 }).toArray());
  if (!pontos.length) return { estado: 'sem_sinal', ultimo: null };
  const ultimo = pontos[pontos.length - 1];
  const idadeMin = (Date.now() - new Date(ultimo.ts).getTime()) / 60000;
  const fuso = fusoDe(perfil);
  if (idadeMin > ATUAL_MIN) return { estado: 'sem_sinal', ultimo: localDe(ultimo.ts, fuso).hhmm, idadeMin: Math.round(idadeMin) };
  const lugar = maisPerto(ultimo, perfil.lugares || []);
  // desde quando: volta nos pontos enquanto continuam no mesmo lugar (ou continuam fora de qualquer lugar)
  let i = pontos.length - 1;
  while (i > 0) {
    const ant = pontos[i - 1];
    const mesmo = lugar ? distanciaM(ant, lugar) <= RAIO_LUGAR_M : !maisPerto(ant, perfil.lugares || []) && distanciaM(ant, ultimo) <= RAIO_LUGAR_M;
    if (!mesmo || (new Date(pontos[i].ts) - new Date(ant.ts)) / 60000 > CORTE_GAP_MIN) break;
    i -= 1;
  }
  const desde = localDe(pontos[i].ts, fuso).hhmm;
  const minutos = Math.round((new Date(ultimo.ts) - new Date(pontos[i].ts)) / 60000);
  if (lugar) return { estado: lugar.papel === 'casa' ? 'casa' : 'lugar', lugar, desde, minutos };
  return { estado: 'fora', desde, minutos, movendo: i === pontos.length - 1 };
}

// ---------- textos ----------
const rotuloLugar = (l, { comNome = true } = {}) => {
  if (l.papel === 'casa') return `casa${l.bairro ? ` (${l.bairro})` : ''}`;
  const tipo = l.papel === 'trabalho' && (!l.tipo || ['trabalho', 'outro', 'residência'].includes(l.tipo)) ? 'trabalho' : l.tipo || 'lugar';
  const nome = comNome && l.nome && l.nome.toLowerCase() !== tipo ? ` ${l.nome}` : '';
  return `${tipo}${nome}${l.bairro ? ` (${l.bairro})` : ''}`;
};
export const descreverSituacao = (s) => {
  if (!s || s.estado === 'sem_sinal') return s?.ultimo ? `sem sinal do celular desde ${s.ultimo}` : 'sem sinal do celular hoje';
  if (s.estado === 'casa') return `em casa desde ${s.desde}`;
  if (s.estado === 'lugar') return `em ${rotuloLugar(s.lugar)} desde ${s.desde}`;
  return s.movendo ? 'na rua, em deslocamento' : `fora de casa, num lugar que ainda não conheço, desde ${s.desde}`;
};
const ultimos7 = (visitas, lugares) => {
  const desde = new Date(Date.now() - 7 * 86400_000);
  const por = new Map();
  for (const v of visitas) {
    if (new Date(v.inicio) < desde) continue;
    const l = lugares.find((x) => x.id === v.lugarId);
    if (!l || l.papel === 'casa') continue;
    const k = l.papel === 'trabalho' ? 'trabalho' : l.tipo || 'outro';
    const e = por.get(k) || { n: 0, dias: new Set(), refeicao: 0 };
    e.n += 1;
    e.dias.add(v.dia);
    if (['restaurante', 'café', 'bar', 'padaria'].includes(k) && ((v.hIni >= 11 && v.hIni <= 14.5) || (v.hIni >= 18.5 && v.hIni <= 22))) e.refeicao += 1;
    por.set(k, e);
  }
  return [...por.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => `${k} ${e.dias.size}x${e.refeicao ? ` (${e.refeicao} em horário de refeição)` : ''}`);
};

/** Bloco pro prompt da IA (só da pessoa atual). null se ela não ligou a localização. */
export async function contextoLugares(perfil) {
  if (!perfil?.lugaresAtivo) return null;
  const jid = jidDe(perfil);
  const [situacao, visitas] = await Promise.all([situacaoAtual(perfil).catch(() => null), visitasRecentes(jid, 28).catch(() => [])]);
  const lugares = perfil.lugares || [];
  const linhas = lugares
    .filter((l) => l.visitas >= 2 || l.papel || l.manual)
    .slice(0, 10)
    .map((l) => `- ${rotuloLugar(l)}: ${l.padrao || 'sem padrão ainda'} · ${l.visitas} visita(s) em ${l.dias} dia(s)${l.ultimaVez ? `, última ${l.ultimaVez}` : ''}`);
  const semana = ultimos7(visitas, lugares);
  const bloco =
    `LUGARES DE ${perfil.nome.split(' ')[0]} (localização aproximada do celular DELA(E); só existe pra falar COM ELA(E)):\n` +
    `- Agora: ${descreverSituacao(situacao)}\n` +
    (linhas.length ? `Lugares que frequenta:\n${linhas.join('\n')}\n` : 'Ainda não há lugares com padrão (poucos dias de dados).\n') +
    (semana.length ? `Últimos 7 dias fora de casa: ${semana.join(' · ')}` : '');
  return { bloco, situacao, semana };
}

/** Linha pro resumo de domingo (só tipos, nada de nome nem endereço): "academia 3x, faculdade 2x, almoço fora 1x". */
export async function linhaSemanaLugares(perfil) {
  if (!perfil?.lugaresAtivo) return null;
  const visitas = await visitasRecentes(jidDe(perfil), 7).catch(() => []);
  const semana = ultimos7(visitas, perfil.lugares || []);
  return semana.length ? `LUGARES DA SEMANA (pela localização do celular; cite só o tipo, nunca nome ou endereço): ${semana.join(' · ')}` : null;
}

/** Texto do !lugares (pra própria pessoa). */
export async function lugaresZap(perfil) {
  if (!perfil?.lugaresAtivo) return 'Você ainda não ligou a localização no app Relógio (botão 4). Quando ligar, em uns dias eu aprendo teus lugares: casa, trabalho, academia, onde almoça fora.';
  const ctx = await contextoLugares(perfil);
  const lugares = (perfil.lugares || []).filter((l) => l.visitas >= 2 || l.papel || l.manual).slice(0, 12);
  const linhas = lugares.map((l) => `- *${rotuloLugar(l)}*\n${l.padrao || 'sem padrão ainda'}\n${l.visitas} visita(s) em ${l.dias} dia(s)${l.ultimaVez ? ` · última ${l.ultimaVez.slice(8, 10)}/${l.ultimaVez.slice(5, 7)}` : ''}`);
  return (
    `📍 *Teus lugares*\n\n` +
    `*Agora*\n${descreverSituacao(ctx?.situacao)}\n\n` +
    (linhas.length ? `*Lugares que aprendi*\n${linhas.join('\n\n')}\n\n` : 'Ainda não tenho lugares com padrão. Em alguns dias de uso aparece.\n\n') +
    (ctx?.semana?.length ? `*Últimos 7 dias fora de casa*\n${ctx.semana.map((s) => `- ${s}`).join('\n')}\n\n` : '') +
    `_Só eu vejo isso, e só falo disso com você. "!lugares aqui é academia X" corrige o lugar onde você está; "!lugares casa" marca onde você está como casa; "!lugares esquecer" apaga tudo._`
  );
}

/** "!lugares aqui é academia Smart Fit" / "!lugares casa": marca o lugar onde a pessoa está agora. */
export async function marcarLugarAtual(perfil, { tipo, nome, casa = false }) {
  const jid = jidDe(perfil);
  const ultimo = await colecao('locais_brutos').find({ jid }).sort({ ts: -1 }).limit(1).next();
  if (!ultimo) return 'Não tenho nenhum ponto teu ainda. Abre o app Relógio, toca em Sincronizar agora e tenta de novo.';
  const lugares = [...(perfil.lugares || [])];
  let l = maisPerto(ultimo, lugares);
  if (!l) {
    l = { id: idDe(ultimo), lat: ultimo.lat, lon: ultimo.lon, visitas: 0, minutos: 0, dias: 0, padrao: '' };
    lugares.push(l);
  }
  l.manual = true;
  if (casa) {
    for (const x of lugares) if (x.papel === 'casa') x.papel = null;
    l.papel = 'casa';
    l.tipo = 'residência';
    l.nome = null;
  } else {
    l.tipo = (tipo || 'outro').toLowerCase();
    l.nome = nome || null;
    if (l.papel === 'casa') l.papel = null;
    if (l.tipo === 'trabalho') l.papel = 'trabalho';
  }
  if (!l.bairro) {
    const c = await classificarOSM({ lat: l.lat, lon: l.lon }).catch(() => null);
    if (c) {
      l.bairro = c.bairro;
      l.cidade = c.cidade;
    }
  }
  await salvarPerfil({ jids: perfil.jids, lugares, lugaresAtivo: true });
  return casa ? `Anotado: aqui é a tua casa${l.bairro ? ` (${l.bairro})` : ''}. 🏠` : `Anotado: aqui é ${rotuloLugar(l)}. 📍`;
}

/** "!lugares esquecer": apaga pontos, visitas e lugares da pessoa. */
export async function esquecerLugares(perfil) {
  const jid = jidDe(perfil);
  await Promise.all([colecao('locais_brutos').deleteMany({ jid }), colecao('visitas').deleteMany({ jid })]);
  await salvarPerfil({ jids: perfil.jids, lugares: [], lugaresAtivo: false, mercados: null });
  return 'Esqueci todos os teus lugares, pontos e visitas. Se o app continuar mandando localização, começo do zero.';
}

// ---------- mercados perto (pro plano) ----------
/** Mercados, feiras e padarias a até 800 m de casa, trabalho e faculdade; cache de 14 dias no perfil. */
export async function mercadosProximos(perfil) {
  if (!perfil?.lugaresAtivo) return null;
  const em = perfil.mercados?.em ? new Date(perfil.mercados.em) : null;
  if (em && Date.now() - em.getTime() < MERCADOS_DIAS * 86400_000) return perfil.mercados.texto || null;
  const ancoras = (perfil.lugares || []).filter((l) => l.papel === 'casa' || l.papel === 'trabalho' || ['faculdade', 'trabalho', 'academia'].includes(l.tipo)).slice(0, 3);
  if (!ancoras.length) return null;
  const linhas = [];
  for (const a of ancoras) {
    try {
      const el = await overpass(a.lat, a.lon, 800, ['[shop~"^(supermarket|greengrocer|butcher|bakery|convenience|grocery|deli)$"]', '[amenity=marketplace]']);
      const nomes = [...new Set(el.map((e) => e.tags?.name || e.tags?.brand).filter(Boolean))].slice(0, 6);
      if (nomes.length) linhas.push(`- perto de ${rotuloLugar(a, { comNome: false })}: ${nomes.join(', ')}`);
    } catch (e) {
      console.warn('[lugares] mercados:', e.message);
    }
  }
  const texto = linhas.length ? `MERCADOS E FEIRAS PERTO (OpenStreetMap, até 800 m dos lugares dela(e); a lista de compras pode citar):\n${linhas.join('\n')}` : null;
  await salvarPerfil({ jids: perfil.jids, mercados: { em: new Date().toISOString(), texto } }).catch(() => {});
  return texto;
}

// ---------- roteiro do dia: cruza padrão de lugares, agenda e treino, com as janelas apertadas ----------
const hDec = (h) => (h == null ? null : Math.floor(h) + ((h % 1) * 60) / 60);
const hTxt = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
/**
 * Puro. lugares = perfil.lugares; agenda = eventos de hoje [{ titulo, tipo, inicio, fim (ISO) }]; treinos = sessões de hoje
 * [{ nome, hora: 'HH:MM', min }]; dow = dia da semana de hoje; fuso = da pessoa; horaAgora = decimal.
 * Devolve texto tipo: "ROTEIRO PROVÁVEL DE HOJE (segunda): academia Garra 07:06–08:00 (padrão) → faculdade UFSC 10:00–12:36 (padrão) → aula X 14:00–16:00 (agenda). Janela apertada: 08:00→10:00 (2h)".
 */
export function roteiroDoDia({ lugares = [], agenda = [], treinos = [], dow, fuso = 'America/Sao_Paulo', horaAgora = null, nomeDia }) {
  const itens = [];
  for (const l of lugares) {
    if (l.papel === 'casa' || !l.diasIdx?.includes(dow) || l.horaTipica == null) continue;
    const ini = hDec(l.horaTipica);
    let fim = hDec(l.horaFim ?? l.horaTipica);
    if (fim < ini) fim = ini + 1;
    itens.push({ ini, fim, rotulo: `${rotuloLugar(l)} (padrão)`, tipo: l.papel || l.tipo });
  }
  for (const e of agenda) {
    const li = localDe(e.inicio, fuso);
    const lf = localDe(e.fim || e.inicio, fuso);
    if (e.diaTodo) continue;
    itens.push({ ini: li.hora, fim: lf.hora < li.hora ? 24 : lf.hora, rotulo: `${e.tipo ? `${e.tipo}: ` : ''}${e.titulo} (agenda)`, tipo: e.tipo || 'agenda' });
  }
  for (const t of treinos) {
    const m = /^(\d{1,2}):(\d{2})/.exec(t.hora || '');
    if (!m) continue;
    const ini = Number(m[1]) + Number(m[2]) / 60;
    itens.push({ ini, fim: ini + (t.min || 60) / 60, rotulo: `treino ${t.nome || ''}${t.min ? ` ${t.min} min` : ''} (relógio, feito)`, tipo: 'treino' });
  }
  if (!itens.length) return '';
  itens.sort((a, b) => a.ini - b.ini);
  // mesmo lugar do padrão + treino do relógio no mesmo horário: não duplica
  const unicos = [];
  for (const it of itens) {
    const igual = unicos.find((u) => Math.abs(u.ini - it.ini) < 0.75 && (u.tipo === it.tipo || (u.tipo === 'academia' && it.tipo === 'treino') || (u.tipo === 'treino' && it.tipo === 'academia')));
    if (igual) {
      if (it.tipo === 'treino') igual.rotulo = `${igual.rotulo.replace(' (padrão)', '')} · ${it.rotulo}`;
      continue;
    }
    unicos.push(it);
  }
  const apertadas = [];
  for (let i = 1; i < unicos.length; i++) {
    const gap = unicos[i].ini - unicos[i - 1].fim;
    if (gap >= 0 && gap <= 1.5) apertadas.push(`${hTxt(unicos[i - 1].fim)}→${hTxt(unicos[i].ini)} (${Math.round(gap * 60)} min entre ${unicos[i - 1].rotulo.split(' (')[0]} e ${unicos[i].rotulo.split(' (')[0]})`);
  }
  const marca = (it) => (horaAgora != null && it.fim < horaAgora ? ' ✓' : horaAgora != null && it.ini <= horaAgora && horaAgora <= it.fim ? ' ◀ agora' : '');
  return (
    `ROTEIRO PROVÁVEL DE HOJE (${nomeDia || NOME_DOW[dow]}; "padrão" = pelos lugares que ela costuma frequentar nesse dia, "agenda" = Google Agenda, "relógio" = já aconteceu): ` +
    unicos.map((it) => `${hTxt(it.ini)}–${hTxt(it.fim)} ${it.rotulo}${marca(it)}`).join(' → ') +
    (apertadas.length ? `\nJANELAS APERTADAS (pouco tempo pra comer entre um e outro; sugira algo pronto ou levado de casa): ${apertadas.join('; ')}` : '')
  );
}

// ---------- semente: exportação da Linha do Tempo do Google ----------
const lerLatLng = (s) => {
  const m = /(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?/.exec(String(s || ''));
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
};
/** Lê os dois formatos (Timeline.json do aparelho e Takeout antigo) e devolve visitas [{ lat, lon, inicio, fim, semantico, nome }]. */
export function lerTimeline(json) {
  const saida = [];
  const push = (pos, inicio, fim, semantico, nome) => {
    const i = new Date(inicio);
    const f = new Date(fim);
    if (!pos || Number.isNaN(i.getTime()) || Number.isNaN(f.getTime()) || f <= i) return;
    saida.push({ ...pos, inicio: i, fim: f, semantico: semantico || null, nome: nome || null });
  };
  for (const s of json?.semanticSegments || []) {
    const v = s.visit?.topCandidate;
    if (v?.placeLocation?.latLng) push(lerLatLng(v.placeLocation.latLng), s.startTime, s.endTime, v.semanticType, null);
  }
  for (const o of json?.timelineObjects || []) {
    const pv = o.placeVisit;
    if (pv?.location?.latitudeE7 != null) push({ lat: pv.location.latitudeE7 / 1e7, lon: pv.location.longitudeE7 / 1e7 }, pv.duration?.startTimestamp, pv.duration?.endTimestamp, pv.location.semanticType, pv.location.name);
  }
  return saida.sort((a, b) => a.inicio - b.inicio);
}
/** Importa a exportação (texto JSON) como visitas dos últimos 180 dias e recalcula os lugares. */
export async function importarTimeline(perfil, texto) {
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error('arquivo da Linha do Tempo não é um JSON válido');
  }
  const desde = new Date(Date.now() - 180 * 86400_000);
  // parada de menos de 15 min é ponto de ônibus, sinal fechado, esquina: não vira lugar (o Google registra, a gente não)
  const visitas = lerTimeline(json).filter((v) => v.fim >= desde && (v.fim - v.inicio) / 60000 >= 15);
  if (!visitas.length) return { visitas: 0, lugares: 0 };
  const fuso = fusoDe(perfil);
  const lugares = (perfil.lugares || []).map((l) => ({ ...l }));
  const docs = [];
  for (const v of visitas) {
    let l = maisPerto(v, lugares);
    if (!l) {
      l = { id: idDe(v), lat: v.lat, lon: v.lon };
      lugares.push(l);
    }
    if (/^(HOME|INFERRED_HOME)$/.test(v.semantico || '') && !l.manual) l.papel = 'casa';
    if (/^(WORK|INFERRED_WORK)$/.test(v.semantico || '') && !l.manual && l.papel !== 'casa') l.papel = 'trabalho';
    if (v.nome && !l.nome && l.papel !== 'casa') l.nome = String(v.nome).slice(0, 60);
    const li = localDe(v.inicio, fuso);
    const lf = localDe(v.fim, fuso);
    docs.push({ lugarId: l.id, inicio: v.inicio, fim: v.fim, min: Math.round((v.fim - v.inicio) / 60000), dia: li.dia, dow: li.dow, hIni: Math.round(li.hora * 10) / 10, hFim: Math.round(lf.hora * 10) / 10, origem: 'timeline' });
  }
  await gravarVisitas(jidDe(perfil), docs);
  await salvarPerfil({ jids: perfil.jids, lugares, lugaresAtivo: true });
  await atualizarLugares({ ...perfil, lugares, lugaresAtivo: true });
  return { visitas: docs.length, lugares: lugares.length };
}
