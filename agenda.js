// agenda.js - Google Agenda da pessoa dona da credencial (AGENDA_DONO), lida com a mesma conta Google do Drive.
// Serve pra ela conhecer a rotina REAL: aula, trabalho, reunião, treino e compromisso social, com as janelas livres.
//
// PRIVACIDADE: a agenda é de UMA pessoa. O bloco só entra no prompt quando essa pessoa é a PESSOA ATUAL da conversa,
// e o system prompt proíbe comentar a agenda de alguém com outra pessoa do grupo.
//
// Se a credencial não tiver o escopo de Agenda (calendar.readonly), tudo aqui é desligado sozinho, sem quebrar nada.

import { google } from 'googleapis';
import ical from 'node-ical';

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
  aula: /aula|curso|faculdade|universidade|prova|semin[áa]rio|laborat[óo]rio|monitoria|tcc|est[áa]gio|estudar|estudo|revis[ãa]o d[ao]|gabaritar/i,
  // "Trabalho - Topografia" / "Trabalho de Estatística" é trabalho da FACULDADE; "Trabalho" sozinho é expediente
  trabalhoDeFaculdade: /^\s*trabalho\s*(?:[-–—:]|de\s|da\s|do\s)/i,
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
  if (RE.trabalhoDeFaculdade.test(evento.titulo || '')) return 'aula'; // "Trabalho - Topografia" é estudo, não expediente
  if (RE.aula.test(t)) return 'aula';
  // "reunião de obra" é reunião, não trabalho: a palavra da reunião vem antes da palavra do trabalho
  if (RE.reuniao.test(t)) return 'reunião';
  if (RE.trabalho.test(t)) return 'trabalho';
  if ((evento.convidados || 0) > 0) return 'reunião'; // sem palavra-chave, ter gente marcada denuncia reunião
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
/**
 * Caminho preferido: "endereço secreto no formato iCal" da agenda (Configurações da agenda > Integrar agenda).
 * É uma URL só de leitura, não precisa de OAuth, de app publicado nem de domínio próprio. Trate como segredo.
 * Eventos semanais (aula) vêm como regra de repetição e são expandidos aqui pra janela pedida.
 */
export const urlsIcs = () =>
  (process.env.AGENDA_ICS_URL || '')
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u));

/** Nome da agenda (X-WR-CALNAME) vira pista de tipo: evento da agenda "Faculdade" é aula, da "Trabalho" é trabalho. */
export function tipoDaAgenda(nome) {
  const n = semAcento(nome);
  if (/faculdade|universidade|ufsc|udesc|aula|academic|escola|curso|semestre/.test(n)) return 'aula';
  if (/trabalho|work|empresa|predialize|escritorio|job|obra/.test(n)) return 'trabalho';
  if (/treino|academia|gym|esporte|volei/.test(n)) return 'treino';
  return null;
}

async function umIcs(url, inicio, fim) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`ICS HTTP ${res.status}`);
  const texto = await res.text();
  const agendaNome = (texto.match(/X-WR-CALNAME:(.+)/) || [])[1]?.trim() || '';
  const dica = tipoDaAgenda(agendaNome);
  const dados = ical.parseICS(texto);
  const lista = [];
  const noIntervalo = (d) => d >= inicio && d <= fim;
  for (const e of Object.values(dados)) {
    if (e?.type !== 'VEVENT' || e.status === 'CANCELLED') continue;
    const duracaoMs = e.end && e.start ? new Date(e.end) - new Date(e.start) : 3600_000;
    const excluidos = new Set(Object.keys(e.exdate || {}));
    const bruto = (ini, fimEv, override) => ({
      titulo: String(override?.summary || e.summary || '(sem título)').trim(),
      descricao: String(override?.description || e.description || '').slice(0, 200),
      inicio: new Date(ini).toISOString(),
      fim: new Date(fimEv).toISOString(),
      diaTodo: e.datetype === 'date',
      duracaoMin: Math.max(1, Math.round((new Date(fimEv) - new Date(ini)) / 60000)),
      convidados: e.attendee ? (Array.isArray(e.attendee) ? e.attendee.length : 1) : 0,
      recorrente: Boolean(e.rrule),
      local: String(override?.location || e.location || ''),
      agenda: agendaNome,
    });
    if (e.rrule) {
      for (const ocorrencia of e.rrule.between(inicio, fim, true) || []) {
        const chave = new Date(ocorrencia).toISOString().slice(0, 10);
        if (excluidos.has(chave)) continue;
        const override = e.recurrences?.[chave];
        const ini = override?.start || ocorrencia;
        const fimEv = override?.end || new Date(new Date(ini).getTime() + duracaoMs);
        lista.push(bruto(ini, fimEv, override));
      }
    } else if (e.start && noIntervalo(new Date(e.start))) {
      lista.push(bruto(e.start, e.end || new Date(new Date(e.start).getTime() + duracaoMs)));
    }
  }
  // o nome da agenda só entra quando o título não disse nada (classificar devolve "compromisso")
  return lista.map((ev) => {
    const tipo = classificar(ev);
    return { ...ev, tipo: tipo === 'compromisso' && dica ? dica : tipo };
  });
}

/**
 * A agenda pública devolve os eventos sem nome ("Busy"). Se o MESMO horário já tem um evento com nome de verdade
 * (vindo da agenda secreta), o anônimo é ruído e sai. Sozinho ele fica: saber que está ocupado já evita cobrança.
 */
export function limparAnonimos(lista) {
  const anonimo = (e) => /^(busy|ocupado|sem t[íi]tulo|\(sem t[íi]tulo\)|reservado|private|particular)$/i.test(String(e.titulo || '').trim());
  const seSobrepoe = (a, b) => a.inicio < b.fim && b.inicio < a.fim;
  const comNome = lista.filter((e) => !anonimo(e));
  return lista.filter((e) => !anonimo(e) || !comNome.some((n) => seSobrepoe(e, n)));
}

/** Junta todas as agendas configuradas (a principal e as compartilhadas), sem repetir o mesmo evento. */
async function eventosDoIcs(inicio, fim) {
  const urls = urlsIcs();
  if (!urls.length) return null;
  const resultados = await Promise.allSettled(urls.map((u) => umIcs(u, inicio, fim)));
  const lista = [];
  const vistos = new Set();
  for (const [i, r] of resultados.entries()) {
    if (r.status !== 'fulfilled') {
      console.warn(`[agenda] agenda ${i + 1} de ${urls.length} falhou: ${String(r.reason?.message).slice(0, 100)}`);
      continue;
    }
    for (const ev of r.value) {
      // mesmo evento em duas agendas (compartilhada + principal) conta uma vez só
      const chave = `${ev.inicio}|${semAcento(ev.titulo)}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      lista.push(ev);
    }
  }
  if (!resultados.some((r) => r.status === 'fulfilled')) throw new Error('nenhuma agenda respondeu');

  return limparAnonimos(lista).sort((a, b) => a.inicio.localeCompare(b.inicio));
}

export async function eventos({ dias = 3, fuso } = {}) {
  if (desligada) return null;
  if (cache.eventos && Date.now() - cache.em < CACHE_MS) return cache.eventos;
  // 1) endereços iCal secretos (não precisa de OAuth); aceita várias agendas separadas por vírgula
  if (urlsIcs().length) {
    try {
      const inicio = new Date();
      inicio.setHours(0, 0, 0, 0);
      const lista = await eventosDoIcs(inicio, new Date(inicio.getTime() + dias * 86400000));
      cache = { em: Date.now(), eventos: lista };
      return lista;
    } catch (e) {
      console.warn('[agenda] falha no endereço iCal:', String(e.message).slice(0, 140));
      return null;
    }
  }
  // 2) API do Google (precisa do escopo calendar.readonly na credencial)
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
