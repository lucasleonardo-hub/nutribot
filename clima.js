// clima.js - Estação do ano e tempo agora na cidade de cada pessoa (Open-Meteo: gratuito, sem chave, sem cadastro).
// Entra no contexto da resposta pra ela falar do tempo como quem olha pela janela ("com esse frio a sopa cai bem"),
// e nunca mais inventar "que dia lindo" sem saber. Heitor em Paris e Lucas em Florianópolis ganham estações opostas.

import { colecao } from './mongo.js';

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const PREV = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 6_000;
const CACHE_CLIMA_MS = Number(process.env.CLIMA_CACHE_MIN) * 60_000 || 30 * 60_000;
const cacheClima = new Map(); // chave da cidade -> { em, dados }
const cacheCoords = new Map(); // cidade normalizada -> { lat, lon, nome, fuso }

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// ============================================================
// Estação do ano (puro)
// ============================================================
/** Hemisfério pela latitude; sem latitude, pelo fuso (padrão: sul, que é onde o grupo mora). */
export function hemisferio({ latitude, fuso } = {}) {
  if (typeof latitude === 'number') return latitude < 0 ? 'sul' : 'norte';
  if (/^(America\/(Sao_Paulo|Argentina|Santiago|Montevideo|Lima|La_Paz|Asuncion|Bogota|Fortaleza|Recife|Bahia|Manaus|Cuiaba|Campo_Grande|Belem|Porto_Velho|Boa_Vista|Rio_Branco|Maceio|Noronha)|Australia\/|Pacific\/Auckland|Africa\/(Johannesburg|Maputo|Windhoek|Lusaka|Harare))/.test(fuso || '')) return 'sul';
  if (fuso) return 'norte';
  return 'sul';
}

/** Estação em `dia` (YYYY-MM-DD) para o hemisfério. Datas aproximadas de equinócio/solstício. */
export function estacaoDoAno(dia, hemi = 'sul') {
  const md = Number(String(dia).slice(5, 7)) * 100 + Number(String(dia).slice(8, 10)); // MMDD
  // hemisfério norte: primavera 20/03, verão 21/06, outono 22/09, inverno 21/12
  let norte;
  if (md >= 320 && md < 621) norte = 'primavera';
  else if (md >= 621 && md < 922) norte = 'verão';
  else if (md >= 922 && md < 1221) norte = 'outono';
  else norte = 'inverno';
  if (hemi === 'norte') return norte;
  return { primavera: 'outono', 'verão': 'inverno', outono: 'primavera', inverno: 'verão' }[norte];
}

// ============================================================
// Descrição do tempo (código WMO -> português)
// ============================================================
export function descricaoTempo(code, ehDia = true) {
  const c = Number(code);
  if (c === 0) return ehDia ? 'céu limpo' : 'céu limpo, noite estrelada';
  if (c === 1) return 'quase sem nuvens';
  if (c === 2) return 'parcialmente nublado';
  if (c === 3) return 'nublado';
  if (c === 45 || c === 48) return 'neblina';
  if (c >= 51 && c <= 57) return 'garoa';
  if (c === 61 || c === 66) return 'chuva fraca';
  if (c === 63 || c === 67) return 'chuva';
  if (c === 65) return 'chuva forte';
  if (c >= 71 && c <= 77) return 'neve';
  if (c === 80 || c === 81) return 'pancadas de chuva';
  if (c === 82) return 'pancadas fortes de chuva';
  if (c === 85 || c === 86) return 'pancadas de neve';
  if (c === 95) return 'trovoada';
  if (c === 96 || c === 99) return 'trovoada com granizo';
  return 'tempo indefinido';
}

/** Adjetivo curto de temperatura (sensação térmica), pra ela ter o tom certo. */
export function sensacao(temp) {
  if (temp == null) return '';
  if (temp <= 10) return 'muito frio';
  if (temp <= 16) return 'frio';
  if (temp <= 22) return 'ameno';
  if (temp <= 28) return 'quente';
  return 'calorão';
}

// ============================================================
// Coordenadas da cidade (cache no perfil e no Mongo; a API só é consultada uma vez por cidade)
// ============================================================
export async function coordenadasDe(cidade) {
  const chave = semAcento(cidade);
  if (!chave) return null;
  if (cacheCoords.has(chave)) return cacheCoords.get(chave);
  try {
    const guardado = await colecao('cidades').findOne({ _id: chave }).catch(() => null);
    if (guardado?.lat != null) {
      cacheCoords.set(chave, guardado);
      return guardado;
    }
    const url = `${GEO}?name=${encodeURIComponent(String(cidade).split(',')[0].trim())}&count=1&language=pt&format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const d = await r.json();
    const hit = d?.results?.[0];
    if (!hit) return null;
    const coords = { _id: chave, lat: hit.latitude, lon: hit.longitude, nome: hit.name, regiao: hit.admin1 || '', pais: hit.country || '', fuso: hit.timezone || null, salvoEm: new Date() };
    cacheCoords.set(chave, coords);
    await colecao('cidades').replaceOne({ _id: chave }, coords, { upsert: true }).catch(() => {});
    return coords;
  } catch (e) {
    console.warn('[clima] geocodificação falhou:', String(e.message).slice(0, 100));
    return null;
  }
}

// ============================================================
// Tempo agora + previsão do dia (cache de 30 min por cidade)
// ============================================================
export async function climaDe({ cidade, fuso }) {
  const coords = await coordenadasDe(cidade);
  if (!coords) return null;
  const chave = coords._id;
  const c = cacheClima.get(chave);
  if (c && Date.now() - c.em < CACHE_CLIMA_MS) return c.dados;
  try {
    const url =
      `${PREV}?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&current=temperature_2m,apparent_temperature,precipitation,weather_code,is_day,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&timezone=${encodeURIComponent(fuso || coords.fuso || 'auto')}&forecast_days=2`;
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const d = await r.json();
    if (!d?.current) throw new Error('resposta sem "current"');
    const dados = {
      cidade: coords.nome,
      lat: coords.lat,
      temp: d.current.temperature_2m,
      sensacaoTermica: d.current.apparent_temperature,
      chuvaAgoraMm: d.current.precipitation,
      codigo: d.current.weather_code,
      ehDia: Boolean(d.current.is_day),
      vento: d.current.wind_speed_10m,
      hoje: { max: d.daily?.temperature_2m_max?.[0], min: d.daily?.temperature_2m_min?.[0], chuvaPct: d.daily?.precipitation_probability_max?.[0], codigo: d.daily?.weather_code?.[0] },
      amanha: { max: d.daily?.temperature_2m_max?.[1], min: d.daily?.temperature_2m_min?.[1], chuvaPct: d.daily?.precipitation_probability_max?.[1], codigo: d.daily?.weather_code?.[1] },
    };
    cacheClima.set(chave, { em: Date.now(), dados });
    return dados;
  } catch (e) {
    console.warn('[clima] previsão falhou:', String(e.message).slice(0, 100));
    return c?.dados || null; // se tiver cache velho, melhor que nada
  }
}

// ============================================================
// Linha pro prompt (puro a partir dos dados)
// ============================================================
const g = (n) => (n == null ? '?' : `${Math.round(n)}°C`);

export function linhaClima(dados, { dia, hemi } = {}) {
  if (!dados) return '';
  const est = dia ? `${estacaoDoAno(dia, hemi || hemisferio({ latitude: dados.lat }))} no hemisfério ${hemi || hemisferio({ latitude: dados.lat })}` : '';
  const agoraTxt = `${g(dados.temp)} agora (sensação ${g(dados.sensacaoTermica)}, ${sensacao(dados.sensacaoTermica)}), ${descricaoTempo(dados.codigo, dados.ehDia)}${dados.chuvaAgoraMm > 0 ? ', chovendo' : ''}`;
  const hojeTxt = `hoje mín ${g(dados.hoje.min)} / máx ${g(dados.hoje.max)}${dados.hoje.chuvaPct != null ? `, chance de chuva ${dados.hoje.chuvaPct}%` : ''}`;
  const amanhaTxt = dados.amanha?.max != null ? `; amanhã ${g(dados.amanha.min)} a ${g(dados.amanha.max)}, ${descricaoTempo(dados.amanha.codigo)}${dados.amanha.chuvaPct != null ? `, chuva ${dados.amanha.chuvaPct}%` : ''}` : '';
  return `${est ? `${est}; ` : ''}tempo em ${dados.cidade}: ${agoraTxt}; ${hojeTxt}${amanhaTxt}`;
}

/** Atalho: linha pronta pra pessoa (cidade + fuso do perfil). '' se não houver cidade ou a API falhar. Nunca lança. */
export async function climaParaPrompt(perfil, dia) {
  if (!perfil?.cidade) return '';
  try {
    const dados = await climaDe({ cidade: perfil.cidade, fuso: perfil.fuso });
    return linhaClima(dados, { dia, hemi: hemisferio({ latitude: dados?.lat, fuso: perfil.fuso }) });
  } catch {
    return '';
  }
}
