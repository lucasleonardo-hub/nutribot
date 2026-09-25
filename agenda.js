// agenda.js - Google Agenda da pessoa dona da credencial (AGENDA_DONO), lida com a mesma conta Google do Drive.
// Serve pra ela conhecer a rotina REAL: aula, trabalho, reunião, treino e compromisso social, com as janelas livres.
//
// PRIVACIDADE: a agenda é de UMA pessoa. O bloco só entra no prompt quando essa pessoa é a PESSOA ATUAL da conversa,
// e o system prompt proíbe comentar a agenda de alguém com outra pessoa do grupo.
//
// Se a credencial não tiver o escopo de Agenda (calendar.readonly), tudo aqui é desligado sozinho, sem quebrar nada.

import { google } from 'googleapis';

import { autenticacaoGoogle } from './drive.js';
import { agora, fusoDe } from './util.js';

const CACHE_MS = Number(process.env.AGENDA_CACHE_MIN) * 60_000 || 15 * 60_000;
const TIMEOUT_MS = 15_000;
let cache = { em: 0, eventos: null };
let desligada = false; // vira true quando falta escopo (não adianta bater de novo a cada mensagem)

export const donoDaAgenda = () => (process.env.AGENDA_DONO || '').trim().toLowerCase();
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const ehDonoDaAgenda = (perfil) => {
  const dono = donoDaAgenda();
  return Boolean(dono && semAcento(String(perfil?.nome || '').split(' ')[0]) === semAcento(dono));
};

// ============================================================
// Classificação (pura, testável)
// ============================================================
const RE = {
  treino: /treino|academia|muscula|v[ôo]lei|futebol|corrida|crossfit|nata[çc][ãa]o|pilates|jiu|luta|bike|ciclismo|caminhada/i,
  refeicao: /almo[çc]o|jantar|caf[ée] da manh|lanche|churrasco|rod[íi]zio|happy hour|anivers|jantinha|pizza|boteco|bar\b/i,
  reuniao: /reuni|meeting|call\b|daily|1:1|alinhamento|kickoff|kick-off|apresenta[çc][ãa]o|entrevista|retro|planning|briefing/i,
  trabalho: /trabalho|expediente|escrit[óo]rio|obra|visita t[ée]cnica|vistoria|plant[ãa]o|servi[çc]o/i,
  aula: /aula|curso|faculdade|universidade|prova|semin[áa]rio|laborat[óo]rio|monitoria|tcc|est[áa]gio/i,
  saude: /consulta|m[ée]dic|dentista|exame|fisio|terapia|psic[óo]log|vacina|laborat[óo]rio de an[áa]lise/i,
  viagem: /viagem|voo|embarque|aeroporto|check-?in|hotel|rodovi[áa]ria/i,
};

/**
 * Que tipo de compromisso é. Ordem importa: o que é mais específico ganha.
 * Reunião é reconhecida também por ter convidados (evento com gente marcada quase sempre é reunião).
 */
export function classificar(evento) {
  const t = `${evento.titulo || ''} ${evento.descricao || ''}`;
  if (RE.treino.test(t)) return 'treino';
  if (RE.saude.test(t)) return 'saúde';
  if (RE.viagem.test(t)) return 'viagem';
  if (RE.refeicao.test(t)) return 'refeição';
  if (RE.aula.test(t)) return 'aula';
  if (RE.trabalho.test(t)) return 'trabalho';
  if (RE.reuniao.test(t) || (evento.convidados || 0) > 0) return 'reunião';
  // aula costuma ser evento semanal fixo, em dia útil, com o nome da matéria e sem convidados
  if (evento.recorrente && !evento.diaTodo && (evento.duracaoMin || 0) >= 45 && (evento.duracaoMin || 0) <= 300) return 'aula';
  return 'compromisso';
}

const hhmm = (iso, fuso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso, hour12: false }).format(d);
};
const diaLocal = (iso, fuso) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: fuso }).format(d);
};
const minutosDoDia = (iso, fuso) => {
  const [h, m] = hhmm(iso, fuso).split(':').map(Number);
  return h * 60 + m;
};

// ============================================================
// Leitura da API
// ============================================================
export async function eventos({ dias = 3, fuso } = {}) {
  if (desligada) return null;
  if (cache.eventos && Date.now() - cache.em < CACHE_MS) return cache.eventos;
  try {
    const cal = google.calendar({ version: 'v3', auth: autenticacaoGoogle() });
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio.getTime() + dias * 86400000);
    const r = await Promise.race([
      cal.events.list({ calendarId: 'primary', timeMin: inicio.toISOString(), timeMax: fim.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 60 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('agenda demorou demais')), TIMEOUT_MS)),
    ]);
    const lista = (r.data.items || [])
      .filter((e) => e.status !== 'cancelled' && (e.transparency !== 'transparent' || RE.treino.test(e.summary || '')))
      .map((e) => {
        const ini = e.start?.dateTime || e.start?.date;
        const f = e.end?.dateTime || e.end?.date;
        const diaTodo = !e.start?.dateTime;
        const duracaoMin = diaTodo ? 24 * 60 : Math.round((new Date(f) - new Date(ini)) / 60000);
        const base = { titulo: (e.summary || '(sem título)').trim(), descricao: (e.description || '').slice(0, 200), inicio: ini, fim: f, diaTodo, duracaoMin, convidados: e.attendees?.length || 0, recorrente: Boolean(e.recurringEventId), local: e.location || '' };
        return { ...base, tipo: classificar(base) };
      });
    cache = { em: Date.now(), eventos: lista };
    return lista;
  } catch (e) {
    const msg = String(e.message || '');
    if (/insufficient authentication scopes|invalid_scope|403/i.test(msg)) {
      desligada = true;
      console.warn('[agenda] credencial do Google sem escopo de Agenda: recurso desligado (rode npm run drive-auth de novo pra liberar)');
    } else {
      console.warn('[agenda] falha ao ler:', msg.slice(0, 140));
    }
    return null;
  }
}

// ============================================================
// Texto pro prompt
// ============================================================
const rotuloDia = (d, hoje, amanha) => (d === hoje ? 'HOJE' : d === amanha ? 'AMANHÃ' : d.slice(8, 10) + '/' + d.slice(5, 7));

/** Janelas livres entre os compromissos do dia, das 7h às 23h. */
function janelasLivres(doDia, fuso) {
  const ocupado = doDia
    .filter((e) => !e.diaTodo)
    .map((e) => [minutosDoDia(e.inicio, fuso), minutosDoDia(e.fim, fuso)])
    .sort((a, b) => a[0] - b[0]);
  const livres = [];
  let cursor = 7 * 60;
  for (const [ini, fim] of ocupado) {
    if (ini - cursor >= 45) livres.push([cursor, ini]);
    cursor = Math.max(cursor, fim);
  }
  if (23 * 60 - cursor >= 45) livres.push([cursor, 23 * 60]);
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return livres.map(([a, b]) => `${fmt(a)}-${fmt(b)}`);
}

/**
 * Bloco pronto pro prompt (ou '' se não houver agenda). `dias` = quantos dias mostrar.
 * Traz o título de verdade: é a agenda da própria pessoa e ela só fala disso com ela.
 */
export function blocoAgenda(lista, { perfil, dias = 2 } = {}) {
  if (!lista?.length) return '';
  const fuso = fusoDe(perfil);
  const hoje = agora(fuso).dia;
  const amanha = new Date(new Date(`${hoje}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const porDia = new Map();
  for (const e of lista) {
    const d = diaLocal(e.inicio, fuso);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(e);
  }
  const linhas = [];
  for (const [d, doDia] of [...porDia.entries()].sort().slice(0, dias)) {
    const itens = doDia
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
      .map((e) => (e.diaTodo ? `${e.titulo} (${e.tipo}, dia todo)` : `${hhmm(e.inicio, fuso)}-${hhmm(e.fim, fuso)} ${e.titulo} (${e.tipo})`));
    const livres = janelasLivres(doDia, fuso);
    linhas.push(`${rotuloDia(d, hoje, amanha)}: ${itens.join(' · ') || 'sem compromisso'}${livres.length ? ` | janelas livres: ${livres.join(', ')}` : ''}`);
  }
  return linhas.join('\n');
}

/** A pessoa está ocupada agora? Usado pra não cobrar refeição no meio de aula/reunião. */
export function ocupadoAgora(lista, { perfil, minutos } = {}) {
  if (!lista?.length) return null;
  const fuso = fusoDe(perfil);
  const hoje = agora(fuso).dia;
  const min = minutos ?? (() => { const [h, m] = agora(fuso).hora.split(':').map(Number); return h * 60 + m; })();
  for (const e of lista) {
    if (e.diaTodo || diaLocal(e.inicio, fuso) !== hoje) continue;
    const ini = minutosDoDia(e.inicio, fuso);
    const fim = minutosDoDia(e.fim, fuso);
    if (min >= ini && min < fim) return { titulo: e.titulo, tipo: e.tipo, terminaEm: `${String(Math.floor(fim / 60)).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}` };
  }
  return null;
}

/** Atalho: agenda da pessoa, só se ela for a dona da credencial. Nunca lança. */
export async function agendaDe(perfil, { dias = 3 } = {}) {
  if (!ehDonoDaAgenda(perfil)) return null;
  const lista = await eventos({ dias });
  if (!lista) return null;
  return { lista, bloco: blocoAgenda(lista, { perfil, dias: 2 }), ocupado: ocupadoAgora(lista, { perfil }) };
}
