// relogio.js - Dados do relógio chegando DIRETO do celular (app "Relógio" em android/, que lê o Health Connect e faz POST
// em /relogio a cada 15 min). Substitui a planilha do "Health Data Export", que só atualizava uma vez por dia.
// O que chega é normalizado pro mesmo formato da planilha ({ pesos, sonos, atividades }) e passa pelo mesmo caminho
// (saude.js: resumo no dossiê, pesagens, peso e indicadores no perfil, Nutri-Saude.md). Fica tudo guardado por dia na
// coleção saude_relogio, então o app pode mandar só os últimos dias que o histórico se mantém.

import { colecao, listarPerfis } from './mongo.js';
import { aplicarDadosSaude } from './saude.js';
import { fusoDe } from './util.js';
import { receberLocais, descreverSituacao } from './lugares.js';

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

/**
 * Converte o envio do app. Datas vêm em ISO (instante); dia e hora saem no fuso da pessoa.
 * pesos: última medição do dia (prefere Samsung Health). sonos: por noite (dia em que acordou), sessões do mesmo dia
 * somam e a mais longa define deitou/levantou. atividades: por dia, passos, calorias totais e treinos (nome, min, hora).
 */
export function normalizarEnvio(corpo, fuso = 'America/Sao_Paulo') {
  const pesos = new Map();
  for (const p of corpo?.pesos || []) {
    const l = localDe(p.t, fuso);
    const kg = n(p.kg);
    if (!l || !kg || kg < 25 || kg > 400) continue;
    const atual = pesos.get(l.dia);
    if (atual && ehSamsung(atual.fonte) && !ehSamsung(p.fonte)) continue;
    if (atual && atual.hora > l.hora && ehSamsung(atual.fonte) === ehSamsung(p.fonte)) continue; // fica a última do dia
    pesos.set(l.dia, { dia: l.dia, hora: l.hora, peso: kg, gordura: n(p.gordura), altura: n(p.altura), magra: n(p.magra), fonte: p.fonte || '' });
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

/** Junta o que já estava guardado com o que chegou agora (por dia; o novo vence), cortando o que passou de 90 dias. */
export function fundir(guardado, novo, hoje) {
  const limite = new Date(new Date(`${hoje}T12:00:00Z`).getTime() - DIAS_GUARDADOS * 86400000).toISOString().slice(0, 10);
  const juntar = (a = [], b = []) => {
    const m = new Map(a.map((x) => [x.dia, x]));
    for (const x of b) m.set(x.dia, x);
    return [...m.values()].filter((x) => x.dia >= limite).sort((x, y) => x.dia.localeCompare(y.dia));
  };
  return { pesos: juntar(guardado?.pesos, novo.pesos), sonos: juntar(guardado?.sonos, novo.sonos), atividades: juntar(guardado?.atividades, novo.atividades) };
}

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
export async function receberEnvio({ token, corpo, hoje, pastaDe }) {
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
