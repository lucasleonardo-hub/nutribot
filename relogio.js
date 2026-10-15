// relogio.js - Dados do relógio chegando DIRETO do celular (app "Relógio" em android/, que lê o Health Connect e faz POST
// em /relogio a cada 15 min). Substitui a planilha do "Health Data Export", que só atualizava uma vez por dia.
// O que chega é normalizado pro mesmo formato da planilha ({ pesos, sonos, atividades }) e passa pelo mesmo caminho
// (saude.js: resumo no dossiê, pesagens, peso e indicadores no perfil, Nutri-Saude.md). Fica tudo guardado por dia na
// coleção saude_relogio, então o app pode mandar só os últimos dias que o histórico se mantém.

import { colecao, listarPerfis, salvarPerfil } from './mongo.js';
import { aplicarDadosSaude } from './saude.js';
import { fusoDe, fusoValido, decidirFuso, marcaDeTempo } from './util.js';
import { fusoDasCoordenadas } from './clima.js';
import { preferirPesagem } from './progresso.js';
import { receberLocais, descreverSituacao } from './lugares.js';
import { perguntarCompra } from './despensa.js';

const DIAS_GUARDADOS = 90;
const FRESCO_H = 36; // dados do app valem como "atuais" (e dispensam a planilha) por este tempo

/** RELOGIO_TOKENS="lucas=abc,heitor=def" -> { lucas: 'abc', heitor: 'def' } (primeiro nome em minúsculas, sem acento) */
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function tokensRelogio(env = process.env.RELOGIO_TOKENS) {
  const mapa = {};
  for (const par of String(env || '').split(',')) {
    const [nome, ...resto] = par.split('=');
    const token = resto.join('=').trim();
    if (nome && token) mapa[semAcento(nome)] = token;
  }
  return mapa;
}

// ============================================================
// Normalização (pura): JSON do app -> { pesos, sonos, atividades } do saude.js
// ============================================================
const localDe = (iso, fuso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // "2026-09-26 07:12:00" no fuso da pessoa
  const s = d.toLocaleString('sv-SE', { timeZone: fuso, hour12: false });
  return { dia: s.slice(0, 10), hora: s.slice(11, 16) };
};
const n = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const ehSamsung = (fonte) => /shealth|samsung/i.test(String(fonte || ''));
/** Número dentro de [min, max], arredondado; senão null (valor fora da faixa é leitura errada do sensor). */
const naFaixa = (v, min, max) => {
  const x = n(v);
  return x != null && x >= min && x <= max ? Math.round(x) : null;
};

// ---------- campos novos da fase 6 (opcionais: o Relógio 1.6 das outras pessoas não manda) ----------
const TIPOS_ETAPA = new Set(['acordado', 'rem', 'leve', 'profundo']);
export const MAX_ETAPAS = 200;
/**
 * Puro. Estágios do sono que vieram do Health Connect ([{ i: ISO, f: ISO, t }]) viram [{ ini: 'HH:MM', fim: 'HH:MM', t }]
 * no fuso da pessoa, em ordem, com os vizinhos do mesmo tipo juntados (até 1 min de folga) e no máximo 200. Tipo
 * desconhecido, instante inválido ou fim antes do início saem. Lista ausente = [].
 */
export function etapasDoSono(lista, fuso = 'America/Sao_Paulo') {
  const validas = [];
  for (const e of Array.isArray(lista) ? lista : []) {
    const t = String(e?.t || '').toLowerCase();
    const i = Date.parse(e?.i);
    const f = Date.parse(e?.f);
    if (!TIPOS_ETAPA.has(t) || !Number.isFinite(i) || !Number.isFinite(f) || f <= i) continue;
    validas.push({ i, f, t });
  }
  validas.sort((a, b) => a.i - b.i);
  const juntas = [];
  for (const e of validas) {
    const u = juntas[juntas.length - 1];
    if (u && u.t === e.t && e.i <= u.f + 60_000) u.f = Math.max(u.f, e.f);
    else juntas.push({ ...e });
  }
  return juntas.slice(0, MAX_ETAPAS).map((e) => ({ ini: localDe(e.i, fuso).hora, fim: localDe(e.f, fuso).hora, t: e.t }));
}
/** Teto por hora: acima disso é leitura duplicada ou corrompida do Health Connect. */
export const MAX_POR_HORA = { passos: 20000, kcal: 3000 };
/** Puro. Vetor de 24 números entre 0 e `max` (um por hora do dia), arredondados; qualquer outra coisa = null. */
export function vetor24(v, max = Infinity) {
  if (!Array.isArray(v) || v.length !== 24) return null;
  if (!v.every((x) => x !== null && x !== '' && typeof x !== 'boolean' && Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= max)) return null;
  return v.map((x) => Math.round(Number(x)));
}

/**
 * Converte o envio do app. Datas vêm em ISO (instante); dia e hora saem no fuso da pessoa.
 * pesos: uma por dia, a primeira da manhã (prefere Samsung Health). sonos: por noite (dia em que acordou), sessões do mesmo dia
 * somam e a mais longa define deitou/levantou. atividades: por dia, passos, calorias totais e treinos (nome, min, hora).
 * Fase 6 (opcionais; sem eles a saída é a de antes): no sono principal `etapas` ([{ ini, fim, t }]), `fcMedia`, `fcMin`
 * (30–150 bpm) e `hrv` (1–300 ms); no dia `porHora` ({ passos, kcal }: 24 números ≥ 0 cada, ou null) e `minAtivos` (0–1440).
 */
export function normalizarEnvio(corpo, fuso = 'America/Sao_Paulo') {
  const pesos = new Map();
  for (const p of corpo?.pesos || []) {
    const l = localDe(p.t, fuso);
    const kg = n(p.kg);
    if (!l || !kg || kg < 25 || kg > 400) continue;
    // Samsung Health vence; depois a primeira da manhã (progresso.preferirPesagem). Até 09/10 ficava a ÚLTIMA do dia, e
    // pesagem das 22h entrava na tendência como se fosse da manhã
    const nova = { dia: l.dia, hora: l.hora, peso: kg, gordura: n(p.gordura), altura: n(p.altura), magra: n(p.magra), fonte: p.fonte || '' };
    pesos.set(l.dia, preferirPesagem(pesos.get(l.dia), nova, ehSamsung));
  }

  const sonos = new Map();
  for (const s of corpo?.sonos || []) {
    const ini = localDe(s.inicio, fuso);
    const fim = localDe(s.fim, fuso);
    if (!ini || !fim) continue;
    const leve = n(s.leve) || 0;
    const profundo = n(s.profundo) || 0;
    const rem = n(s.rem) || 0;
    let duracao = leve + profundo + rem;
    if (!duracao) duracao = Math.max(0, Math.round((new Date(s.fim) - new Date(s.inicio)) / 60000) - (n(s.acordado) || 0)); // sem fases: tempo deitado menos acordado
    const semFases = !(leve + profundo + rem);
    const dia = fim.dia;
    const x = sonos.get(dia) || { dia, inicio: null, fim: null, principal: 0, leve: 0, profundo: 0, rem: 0, acordado: 0, sessoes: 0, total: 0 };
    if (duracao >= x.principal) {
      x.principal = duracao;
      x.inicio = `${ini.dia} ${ini.hora}`;
      x.fim = `${fim.dia} ${fim.hora}`;
      // fase 6: estágios, batimento e VFC são do sono principal (o mais longo), como inicio/fim; envio antigo não traz
      for (const k of ['etapas', 'fcMedia', 'fcMin', 'hrv']) delete x[k];
      const etapas = etapasDoSono(s.etapas, fuso);
      if (etapas.length) x.etapas = etapas;
      const fcMedia = naFaixa(s.fcMedia, 30, 150);
      const fcMin = naFaixa(s.fcMin, 30, 150);
      const hrv = naFaixa(s.hrv, 1, 300);
      if (fcMedia != null) x.fcMedia = fcMedia;
      if (fcMin != null) x.fcMin = fcMin;
      if (hrv != null) x.hrv = hrv;
    }
    x.leve += semFases ? duracao : leve; // sem fases, tudo conta como "leve" pra manter o total
    x.profundo += profundo;
    x.rem += rem;
    x.acordado += n(s.acordado) || 0;
    x.sessoes += 1;
    x.total = x.leve + x.profundo + x.rem;
    sonos.set(dia, x);
  }

  const atividades = new Map();
  const diaDe = (dia) => {
    const d = String(dia || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    if (!atividades.has(d)) atividades.set(d, { dia: d, passos: null, calorias: null, treinos: [] });
    return atividades.get(d);
  };
  for (const d of corpo?.dias || []) {
    const a = diaDe(d.dia);
    if (!a) continue;
    const passos = n(d.passos);
    if (passos && (!a.passos || passos > a.passos)) a.passos = Math.round(passos);
    const cal = n(d.calorias);
    if (cal && cal > 300) a.calorias = Math.round(cal); // aggregate do dia (gasto total); valores minúsculos são dia incompleto
    if (n(d.fcRepouso) && n(d.fcRepouso) >= 30 && n(d.fcRepouso) <= 120) a.fcRepouso = Math.round(n(d.fcRepouso));
    if (n(d.hrv) && n(d.hrv) > 0) a.hrv = Math.round(n(d.hrv));
    // fase 6: passos e calorias por hora (só os últimos 14 dias vêm com isso) e minutos ativos
    const porHora = { passos: vetor24(d.porHora?.passos, MAX_POR_HORA.passos), kcal: vetor24(d.porHora?.kcal, MAX_POR_HORA.kcal) };
    if (porHora.passos || porHora.kcal) a.porHora = porHora;
    const minAtivos = naFaixa(d.minAtivos, 0, 1440);
    if (minAtivos != null) a.minAtivos = minAtivos;
  }
  for (const t of corpo?.treinos || []) {
    const ini = localDe(t.inicio, fuso);
    if (!ini) continue;
    const a = diaDe(ini.dia);
    if (!a) continue;
    const min = t.fim ? Math.round((new Date(t.fim) - new Date(t.inicio)) / 60000) : n(t.min);
    const nome = String(t.tipo || t.nome || 'Exercício').trim();
    if (a.treinos.some((x) => x.hora === ini.hora && x.nome === nome)) continue;
    a.treinos.push({ nome, min: min && min > 0 ? min : null, hora: ini.hora, fonte: t.fonte || '', kcal: n(t.kcal), fcMedia: n(t.fcMedia) ? Math.round(n(t.fcMedia)) : null });
  }

  const ordenar = (m) => [...m.values()].sort((x, y) => x.dia.localeCompare(y.dia));
  return { pesos: ordenar(pesos), sonos: ordenar(sonos), atividades: ordenar(atividades) };
}

/**
 * Junta o que já estava guardado com o que chegou agora (por dia; o novo vence), cortando o que passou de 90 dias. Pesos:
 * o app manda as últimas 72 h contadas de AGORA, então o dia mais antigo do envio chega só com as pesagens feitas depois
 * da hora atual (a da noite), e "o novo vence" trocava a da manhã guardada por ela no 3º dia (revisão de 09/10). Entre
 * medições diferentes do mesmo dia vale a regra da série (preferirPesagem); a MESMA medição (mesma hora) chegando de novo
 * é substituída pela nova, que pode trazer a gordura ou a massa magra que faltavam.
 */
export function fundir(guardado, novo, hoje) {
  const limite = new Date(new Date(`${hoje}T12:00:00Z`).getTime() - DIAS_GUARDADOS * 86400000).toISOString().slice(0, 10);
  const juntar = (a = [], b = [], escolher = (_, x) => x) => {
    const m = new Map(a.map((x) => [x.dia, x]));
    for (const x of b) m.set(x.dia, escolher(m.get(x.dia), x));
    return [...m.values()].filter((x) => x.dia >= limite).sort((x, y) => x.dia.localeCompare(y.dia));
  };
  const pesagem = (g, x) => (!g || g.hora === x.hora ? x : preferirPesagem(g, x, ehSamsung));
  // fase 6: o coletor manda `porHora` só nos últimos 14 dias, e o Relógio 1.6 não manda nada disso. O novo vence, mas o
  // campo novo que faltar no envio fica o que já estava guardado (o sono só quando é a mesma noite: mesmo início)
  const herdar = (campos, mesmo) => (g, x) => {
    if (!g || !mesmo(g, x)) return x;
    const y = { ...x };
    for (const k of campos) if (y[k] == null && g[k] != null) y[k] = g[k];
    return y;
  };
  // o envio é uma janela móvel (agora − 72 h): chega a hora em que a noite do dia já saiu dela e o cochilo da tarde ainda
  // não. Esse lote traz o dia só com o cochilo, que começa depois do fim da noite guardada: aí o guardado (maior) fica.
  // Sessão nova que se sobrepõe à guardada (a noite editada no Samsung Health) continua vencendo
  const herdarSono = herdar(CAMPOS_SONO_F6, (g, x) => g.inicio === x.inicio);
  const lotePerdeuANoite = (g, x) => g.inicio !== x.inicio && g.fim && x.inicio && x.inicio >= g.fim && (n(g.principal) ?? n(g.total) ?? 0) > (n(x.principal) ?? n(x.total) ?? 0);
  const sono = (g, x) => (g && lotePerdeuANoite(g, x) ? g : herdarSono(g, x));
  const atividade = herdar(CAMPOS_ATIVIDADE_F6, () => true);
  return { pesos: juntar(guardado?.pesos, novo.pesos, pesagem), sonos: juntar(guardado?.sonos, novo.sonos, sono), atividades: juntar(guardado?.atividades, novo.atividades, atividade) };
}
const CAMPOS_SONO_F6 = ['etapas', 'fcMedia', 'fcMin', 'hrv'];
const CAMPOS_ATIVIDADE_F6 = ['porHora', 'minAtivos'];

// ============================================================
// Recebimento (POST /relogio)
// ============================================================
function erroHttp(status, msg) {
  return Object.assign(new Error(msg), { status });
}

/**
 * Valida o token, acha a pessoa pelo primeiro nome, funde com o histórico, roda o caminho comum do saude.js.
 * `pastaDe(perfil)` é injetado por quem chama (pessoas.js), pra este módulo não depender do Drive.
 */
export async function receberEnvio({ token, corpo, hoje, pastaDe, lembrar }) {
  const tokens = tokensRelogio();
  if (!Object.keys(tokens).length) throw erroHttp(503, 'RELOGIO_TOKENS não configurado no servidor');
  const pessoa = semAcento(corpo?.pessoa);
  if (!pessoa || !token || tokens[pessoa] !== String(token)) throw erroHttp(401, 'token ou pessoa inválidos');
  const perfil = (await listarPerfis()).find((p) => semAcento(p.nome).split(/\s+/)[0] === pessoa);
  if (!perfil) throw erroHttp(404, `ninguém cadastrado com o primeiro nome "${pessoa}"`);

  const fuso = corpo.fuso || fusoDe(perfil);
  const novo = normalizarEnvio(corpo, fuso);
  const col = colecao('saude_relogio');
  const jid = perfil.jids?.[0];
  const guardado = await col.findOne({ _id: jid });
  const dados = fundir(guardado, novo, hoje);
  let pastaId = null;
  if (pastaDe) pastaId = await pastaDe(perfil).catch(() => null);
  const texto = await aplicarDadosSaude(perfil, dados, { hoje, fonteNome: 'app Relógio (Health Connect, direto do celular)', pastaId });
  await col.replaceOne(
    { _id: jid },
    { _id: jid, nome: perfil.nome, ...dados, texto, ultimoEnvio: new Date(), app: String(corpo.app || ''), recebidos: { pesos: novo.pesos.length, sonos: novo.sonos.length, dias: novo.atividades.length } },
    { upsert: true }
  );
  console.log(`[relogio] ${perfil.nome}: ${novo.pesos.length} pesos, ${novo.sonos.length} noites, ${novo.atividades.length} dias (histórico: ${dados.atividades.length} dias)`);
  // localização aproximada (opcional, botão 4 do app): vira lugares significativos; o ponto bruto some em 7 dias
  let local = null;
  if (Array.isArray(corpo.locais) && corpo.locais.length) {
    local = await receberLocais(perfil, corpo.locais, fuso).catch((e) => (console.error('[lugares]', e.message), null));
    if (local?.recebidos) console.log(`[lugares] ${perfil.nome}: ${local.recebidos} ponto(s); ${descreverSituacao(local.situacao)}`);
    // saiu do mercado/padaria depois de 10 min+ lá: pergunta se comprou algo pra despensa (fora do caminho da resposta ao app)
    if (local?.evento?.evento === 'saiu_de_compra') perguntarCompra(perfil, local.evento.lugar, { lembrar }).catch((e) => console.warn('[despensa] pergunta:', e.message));
  }
  // o fuso da pessoa acompanha a viagem: primeiro o do próprio celular (o Android troca sozinho pela rede e o app já manda
  // `fuso` em todo envio), e só sem ele o das coordenadas; fora do caminho da resposta ao app; falhou, fica o fuso de antes
  if (corpo.fuso || (Array.isArray(corpo.locais) && corpo.locais.length)) {
    atualizarFusoPelaLocalizacao(perfil, corpo.locais || [], { fusoCelular: corpo.fuso }).catch((e) => console.warn('[fuso] pela localização:', e.message));
  }
  const hojeAt = dados.atividades.find((a) => a.dia === hoje);
  const ultimoPeso = dados.pesos[dados.pesos.length - 1];
  const ultimaNoite = dados.sonos[dados.sonos.length - 1];
  return {
    ok: true,
    pessoa: perfil.nome.split(' ')[0],
    recebidos: { pesos: novo.pesos.length, sonos: novo.sonos.length, dias: novo.atividades.length, treinos: novo.atividades.reduce((a, d) => a + d.treinos.length, 0) },
    resumo: [
      hojeAt?.passos ? `${hojeAt.passos} passos hoje` : null,
      ultimaNoite ? `sono ${ultimaNoite.dia}: ${Math.floor(ultimaNoite.total / 60)}h${String(Math.round(ultimaNoite.total % 60)).padStart(2, '0')}` : null,
      ultimoPeso ? `peso ${ultimoPeso.dia}: ${String(ultimoPeso.peso).replace('.', ',')} kg` : null,
      local?.situacao ? descreverSituacao(local.situacao) : null,
    ].filter(Boolean).join(' · '),
  };
}

/**
 * O fuso da pessoa pela localização do celular (13/10; decisão do dono: "o app e a bot sabem pela minha localização" quando
 * ele for visitar o Heitor). A leitura é o fuso que o próprio celular informa (`fuso` do envio, o Android troca sozinho pela
 * rede; desde 14/10, porque o Open-Meteo devolveu 429 pro IP do Render) e, sem ele, o do ponto mais recente (precisão até
 * 500 m) no Open-Meteo (clima.fusoDasCoordenadas, grátis, com cache e pausa após falha); util.decidirFuso só troca quando o fuso novo se mantém (2 leituras com 30+
 * min entre elas) e ignora fuso equivalente (Bahia = São Paulo). Na troca grava `fuso`, o histórico curto `fusos: [{ fuso,
 * desde }]` (10 últimos) e a data em `atualizacoes.fuso`; enquanto não troca, só a pendência (`fusoPendente`), e só quando ela
 * muda. Sem rede ou sem leitura: nada muda. Quem não usa o app (Heitor) fica com o fuso do cadastro.
 * @returns {Promise<{ trocou: boolean, de?: string, para?: string, pendente?: object|null } | null>}
 */
export async function atualizarFusoPelaLocalizacao(perfil, locais, { buscar, salvar = salvarPerfil, fusoCelular, agora = Date.now() } = {}) {
  if (!perfil?.jids?.length) return null;
  // fuso que o próprio celular informa (ZoneId do Android): vale como leitura direta, sem consulta externa; "GMT"/"UTC"
  // costumam ser celular sem fuso configurado, então não contam
  const doCelular = fusoValido(fusoCelular) && !/^(GMT|UTC|Etc\/)/.test(fusoCelular) ? fusoCelular : null;
  const pontos = (locais || [])
    .map((l) => ({ lat: Number(l?.lat), lon: Number(l?.lon), acc: l?.acc == null ? null : Number(l.acc), ts: Date.parse(l?.ts || l?.hora || '') }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.acc == null || p.acc <= 500))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const ultimo = pontos[pontos.length - 1];
  if (!doCelular && !ultimo) return null;
  const leitura = doCelular || (await fusoDasCoordenadas(ultimo.lat, ultimo.lon, buscar ? { buscar } : {}));
  if (!leitura) return null;
  const em = doCelular || !Number.isFinite(ultimo.ts) ? new Date(agora).toISOString() : new Date(ultimo.ts).toISOString();
  const atual = fusoDe(perfil);
  const d = decidirFuso({ atual, pendente: perfil.fusoPendente || null, leitura, em });
  if (d.trocar) {
    const historico = perfil.fusos?.length ? perfil.fusos : [{ fuso: atual, desde: perfil.atualizacoes?.fuso || null }];
    const fusos = [...historico, { fuso: d.fuso, desde: em }].slice(-10);
    // só `atualizacoes.fuso` (caminho com ponto no $set): o `perfil` foi lido no começo do POST, e o saude.js pode ter acabado
    // de gravar `atualizacoes.peso`; regravar o objeto inteiro desfazia isso. Com `atualizacoes` nulo o caminho com ponto
    // falha no Mongo, e aí grava o objeto (não há o que perder).
    const diaFuso = marcaDeTempo({ fuso: d.fuso }).dia;
    const semObjeto = perfil.atualizacoes !== undefined && (perfil.atualizacoes === null || typeof perfil.atualizacoes !== 'object');
    const dataFuso = semObjeto ? { atualizacoes: { fuso: diaFuso } } : { 'atualizacoes.fuso': diaFuso };
    await salvar({ jids: perfil.jids, fuso: d.fuso, fusos, fusoPendente: null, ...dataFuso });
    console.log(`[fuso] ${perfil.nome}: ${atual} -> ${d.fuso} pela localização (desde ${em}); dia e hora dos registros seguem o fuso novo`);
    return { trocou: true, de: atual, para: d.fuso };
  }
  if (JSON.stringify(perfil.fusoPendente || null) !== JSON.stringify(d.pendente)) {
    await salvar({ jids: perfil.jids, fusoPendente: d.pendente });
    if (d.pendente) console.log(`[fuso] ${perfil.nome}: localização em ${d.pendente.fuso} (${d.pendente.n}ª leitura; fuso atual ${atual})`);
  }
  return { trocou: false, pendente: d.pendente };
}

/** Texto do resumo vindo do app, se for recente (senão null e a planilha, se existir, continua valendo). */
export async function textoRelogio(perfil) {
  const jid = perfil?.jids?.[0];
  if (!jid) return null;
  const d = await colecao('saude_relogio').findOne({ _id: jid }, { projection: { texto: 1, ultimoEnvio: 1 } }).catch(() => null);
  if (!d?.texto || !d.ultimoEnvio) return null;
  return Date.now() - new Date(d.ultimoEnvio).getTime() <= FRESCO_H * 3600_000 ? d.texto : null;
}

/** Pra !relogio: último envio e números de hoje. */
export async function situacaoRelogio(perfil, hoje) {
  const jid = perfil?.jids?.[0];
  const d = jid ? await colecao('saude_relogio').findOne({ _id: jid }).catch(() => null) : null;
  if (!d) return null;
  const hojeAt = (d.atividades || []).find((a) => a.dia === hoje);
  return {
    ultimoEnvio: d.ultimoEnvio,
    app: d.app,
    passosHoje: hojeAt?.passos || null,
    caloriasHoje: hojeAt?.calorias || null,
    treinosHoje: hojeAt?.treinos || [],
    ultimaNoite: (d.sonos || [])[d.sonos.length - 1] || null,
    ultimoPeso: (d.pesos || [])[d.pesos.length - 1] || null,
    dias: (d.atividades || []).length,
  };
}
