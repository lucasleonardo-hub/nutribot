// util.js - Funções puras usadas pelo bot (data/hora, refeições e formatação). Sem rede, sem estado: testáveis.

export const TZ = process.env.TZ || 'America/Sao_Paulo';
const MANTER_COLCHETES = process.env.MANTER_COLCHETES_NO_ZAP === 'true';

// ============================================================
// Data / hora
// ============================================================
export function fusoValido(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('sv-SE', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const fusoDe = (perfil) => (fusoValido(perfil?.fuso) ? perfil.fuso : TZ);

/** Data e hora "agora" no fuso pedido (padrão: o do grupo). */
export function agora(tz = TZ, quando = new Date()) {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(quando);
  const g = (t) => partes.find((p) => p.type === t)?.value;
  const hora = g('hour') === '24' ? '00' : g('hour'); // alguns runtimes devolvem 24 à meia-noite
  return {
    dia: `${g('year')}-${g('month')}-${g('day')}`,
    hora: `${hora}:${g('minute')}`,
    horaArquivo: `${hora}-${g('minute')}-${g('second')}`,
    domingo: g('weekday')?.toLowerCase().startsWith('sun') || g('weekday')?.toLowerCase().startsWith('dom'),
  };
}

/** "domingo, 20/09/2026" a partir de "2026-09-20". O dia da semana vem do código: modelo de linguagem erra isso com frequência. */
export function dataExtenso(dia) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dia}T12:00:00Z`));
  } catch {
    return dia;
  }
}

export function semanaISO(diaStr) {
  const d = new Date(`${diaStr}T12:00:00Z`);
  const diaSemana = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana);
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d - inicioAno) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

export function diaSeguinte(diaStr) {
  const d = new Date(`${diaStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Os n dias até diaStr, inclusive, em ordem (ex.: diasAnteriores('2026-09-20', 3) -> 18, 19, 20). */
export function diasAnteriores(diaStr, n) {
  const base = new Date(`${diaStr}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

export const ehDomingo = (diaStr) => new Date(`${diaStr}T12:00:00Z`).getUTCDay() === 0;

/** "7,3h" / "12min" / "45s" */
export function formatarDuracao(ms) {
  if (ms >= 3600_000) return `${(ms / 3600_000).toFixed(1)}h`;
  if (ms >= 60_000) return `${Math.ceil(ms / 60_000)}min`;
  return `${Math.round(ms / 1000)}s`;
}

/** 17300 -> "17.3k" */
export const formatarTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ============================================================
// Refeições e horários
// ============================================================
export const SLOTS = [
  { id: 'cafe', nome: 'café da manhã', ini: 5 * 60, fim: 10 * 60 + 30, padrao: 8 * 60 + 30, cobrar: true },
  // pré/pós-treino ou lanche leve de manhã: só a IA (ou !refeicao) classifica assim; o relógio cai no café da manhã
  { id: 'lanche_manha', nome: 'lanche da manhã', ini: -1, fim: -1, padrao: 7 * 60, cobrar: false },
  { id: 'almoco', nome: 'almoço', ini: 10 * 60 + 30, fim: 14 * 60 + 30, padrao: 12 * 60 + 30, cobrar: true },
  { id: 'lanche', nome: 'lanche da tarde', ini: 14 * 60 + 30, fim: 18 * 60, padrao: 16 * 60, cobrar: false },
  { id: 'jantar', nome: 'jantar', ini: 18 * 60, fim: 22 * 60 + 30, padrao: 20 * 60, cobrar: true },
  { id: 'ceia', nome: 'ceia', ini: 22 * 60 + 30, fim: 29 * 60, padrao: 23 * 60, cobrar: false }, // até 5h
];

export const minutosDe = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const hhmmDe = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function slotDaHora(hhmm) {
  let min = minutosDe(hhmm);
  if (min < 5 * 60) min += 24 * 60; // madrugada conta como ceia do dia anterior
  return SLOTS.find((s) => min >= s.ini && min < s.fim) || SLOTS[SLOTS.length - 1];
}

export const mediana = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

/** Horário habitual de cada refeição pra uma pessoa, a partir do que ela já mandou (mediana; precisa de 3+ registros). */
export function horariosHabituais(refeicoes) {
  const out = {};
  for (const s of SLOTS) {
    const mins = refeicoes.filter((r) => r.slot === s.id).map((r) => r.minutos);
    out[s.id] = { minutos: mins.length >= 3 ? mediana(mins) : s.padrao, aprendido: mins.length >= 3, amostras: mins.length };
  }
  return out;
}

export function descreverHorarios(hab) {
  return SLOTS.filter((s) => s.cobrar || hab[s.id].aprendido)
    .map((s) => `${s.nome} ~${hhmmDe(hab[s.id].minutos)}${hab[s.id].aprendido ? '' : ' (chute, ainda aprendendo)'}`)
    .join(', ');
}

// ============================================================
// Formatação pro WhatsApp
// ============================================================
// Converte o markdown que o modelo insiste em mandar pro formato do WhatsApp
// (negrito é UM asterisco de cada lado; **dois** aparecem literalmente no zap).
export function paraWhatsApp(texto, { manterColchetes = MANTER_COLCHETES } = {}) {
  let t = String(texto || '');
  if (!manterColchetes) t = t.replace(/\[\[([^\]]+)\]\]/g, '*$1*');
  return t
    .replace(/^#{1,6}\s*/gm, '') // cabeçalhos markdown
    .replace(/\*\*\*(.+?)\*\*\*/g, '*$1*') // ***x*** -> *x*
    .replace(/\*\*(.+?)\*\*/g, '*$1*') // **x** -> *x*
    .replace(/__(.+?)__/g, '_$1_') // __x__ -> _x_
    .replace(/^\s*[-*•]\s+/gm, '• ') // bullets -> •
    .replace(/\*{2,}/g, '*') // sobras de asterisco
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Tira a linha "ATUALIZAR: {...}" do fim de um texto (nunca pode ir pro grupo nem pro Drive). */
export const semLinhaAtualizar = (texto) =>
  String(texto || '')
    .replace(/\n?\s*HABITO:\s*\{[^\n]*\}\s*/gi, '\n')
    .replace(/\n?\s*ATUALIZAR:\s*\{[\s\S]*\}\s*$/i, '')
    .trim();

// ============================================================
// Menção ao nome da bot
// ============================================================
export const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "Dona Benta" é mencionada por "dona benta", "Benta" ou "benta," (palavra inteira, sem diferenciar acento/caixa); "Ana" também. */
export function mencionaNome(texto, nome) {
  const t = semAcento(texto);
  const partes = semAcento(nome).split(/\s+/).filter((p) => p.length >= 3);
  const escapar = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return partes.some((p) => new RegExp(`(?<![\\p{L}\\p{N}])${escapar(p)}(?![\\p{L}\\p{N}])`, 'u').test(t));
}

// ============================================================
// Limite de tempo pra qualquer promessa (chamada externa que pode pendurar)
// ============================================================
export function comTempo(promessa, ms, rotulo = 'operação') {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error(`${rotulo} passou de ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

// ============================================================
// A mensagem relata comida consumida, pede sugestão/plano, ou corrige uma análise?
// ============================================================
const RE_PEDIDO = /\?|sugest|indica|o que (eu )?(como|posso|devo)|tem algo|alguma (ideia|dica|op[cç][aã]o)|me (d[aá]|passa) (uma|umas)|irei|vou (tentar|comer|almo[cç]ar|jantar|lanchar|comprar)|pretendo|talvez|depois|mais tarde|[àa]s \d{1,2}h/i;
const RE_CONSUMO = /\b(comi|tomei|almocei|jantei|lanchei|bebi|acabei de|comendo|tô comendo|to comendo|foi (meu|minha|o|a)|esse foi|essa foi|aqui (o|a|meu|minha))\b/i;
const RE_CORRECAO = /n[ãa]o (é|era|foi|tinha|tem)|na verdade|era[m]?\s+\d|tinha (tamb[ée]m|mais|s[óo])|esqueci|faltou|tamb[ée]m tinha|corrig|na real/i;

/** Pedido de sugestão ou plano futuro ("vou tentar comer algo às 18h", "tem algo pra comprar?") e não relato do que comeu. */
export const parecePedidoOuPlano = (t) => RE_PEDIDO.test(String(t || '')) && !RE_CONSUMO.test(String(t || ''));
/** Correção de uma análise recente ("não é picanha, é fígado", "eram 2 pães"). */
export const pareceCorrecao = (t) => RE_CORRECAO.test(String(t || '')) && !parecePedidoOuPlano(t);
