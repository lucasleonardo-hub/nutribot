// treino.js - Treino de força pela API do Hevy (api.hevyapp.com/v1, chave por pessoa em HEVY_CHAVES).
// O código calcula o que importa pra nutrição e pro objetivo: séries por grupo muscular na semana, volume (kg x reps),
// progressão de carga por exercício (1RM estimado, Epley) e esforço (RPE). A IA só lê o resumo pronto e interpreta.
//
// Por que isso importa pra ela: ganhar peso SEM progressão de carga é ganhar gordura; perder peso COM carga mantida é
// perder gordura preservando músculo. É o dado que faltava pra dizer se o superávit/déficit está virando o que deveria.

import { colecao } from './mongo.js';

const BASE = 'https://api.hevyapp.com/v1';
const TIMEOUT_MS = 25_000;
const DIAS = 28; // janela analisada (4 semanas: a atual e 3 de comparação)
const PAGINAS_MAX = 6; // 10 treinos por página

/** { "ana": "chave", "joao": "chave" } a partir de HEVY_CHAVES="ana=abc,joao=def" */
function chaves() {
  const bruto = process.env.HEVY_CHAVES || '';
  const mapa = {};
  for (const par of bruto.split(',')) {
    const [nome, chave] = par.split('=').map((x) => (x || '').trim());
    if (nome && chave) mapa[semAcento(nome)] = chave;
  }
  return mapa;
}
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const chaveDe = (perfil) => chaves()[semAcento(String(perfil?.nome || '').split(' ')[0])] || null;
export const temHevy = (perfil) => Boolean(chaveDe(perfil));

async function pegar(caminho, chave) {
  const res = await fetch(`${BASE}${caminho}`, { headers: { 'api-key': chave, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Hevy HTTP ${res.status}`);
  return res.json();
}

// ============================================================
// Catálogo de exercícios (id -> grupo muscular). Cai no Mongo e é relido de vez em quando.
// ============================================================
const GRUPOS_PT = {
  abdominals: 'abdômen', abductors: 'abdutores', adductors: 'adutores', biceps: 'bíceps', calves: 'panturrilha',
  cardio: 'cardio', chest: 'peito', forearms: 'antebraço', full_body: 'corpo todo', glutes: 'glúteos',
  hamstrings: 'posterior de coxa', lats: 'dorsal', lower_back: 'lombar', neck: 'pescoço', quadriceps: 'quadríceps',
  shoulders: 'ombros', traps: 'trapézio', triceps: 'tríceps', upper_back: 'costas', other: 'outros',
};
export const grupoEmPortugues = (g) => GRUPOS_PT[g] || String(g || 'outros').replace(/_/g, ' ');

async function catalogo(chave) {
  const col = colecao('hevy_exercicios');
  const guardado = await col.findOne({ _id: 'catalogo' });
  if (guardado && Date.now() - new Date(guardado.salvoEm).getTime() < 7 * 86400_000) return guardado.mapa;
  const mapa = {};
  for (let pagina = 1; pagina <= 6; pagina++) {
    const d = await pegar(`/exercise_templates?page=${pagina}&pageSize=100`, chave).catch(() => null);
    if (!d?.exercise_templates?.length) break;
    for (const e of d.exercise_templates) mapa[e.id] = { titulo: e.title, primario: e.primary_muscle_group, secundarios: e.secondary_muscle_groups || [], equipamento: e.equipment, tipo: e.type };
    if (pagina >= (d.page_count || 1)) break;
  }
  if (Object.keys(mapa).length) await col.replaceOne({ _id: 'catalogo' }, { _id: 'catalogo', mapa, salvoEm: new Date() }, { upsert: true });
  return mapa;
}

// ============================================================
// Sincronização dos treinos (guarda no Mongo; a API só é consultada pelas páginas recentes)
// ============================================================
export async function sincronizarTreinos(perfil) {
  const chave = chaveDe(perfil);
  if (!chave) return 0;
  const col = colecao('treinos');
  const limite = new Date(Date.now() - DIAS * 86400_000).toISOString();
  let novos = 0;
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const d = await pegar(`/workouts?page=${pagina}&pageSize=10`, chave);
    const lista = d?.workouts || [];
    if (!lista.length) break;
    for (const w of lista) {
      await col.replaceOne({ _id: w.id }, { _id: w.id, jid: perfil.jids?.[0], nome: perfil.nome, titulo: w.title, inicio: w.start_time, fim: w.end_time, exercicios: w.exercises, salvoEm: new Date() }, { upsert: true });
      novos++;
    }
    if (lista[lista.length - 1]?.start_time < limite) break;
  }
  console.log(`[treino] ${perfil.nome}: ${novos} treino(s) sincronizado(s) do Hevy`);
  return novos;
}

// ============================================================
// Análise (pura, testável): séries por grupo, volume, progressão de carga
// ============================================================
const epley = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + reps / 30) : 0);
const diaDe = (iso) => String(iso || '').slice(0, 10);
const semanaIndice = (iso, hoje) => Math.floor((new Date(`${hoje}T12:00:00Z`) - new Date(`${diaDe(iso)}T12:00:00Z`)) / (86400000 * 7));

/**
 * @param {Array} treinos  documentos da coleção treinos
 * @param {object} catalogoMapa  id -> { primario, secundarios, titulo }
 * @param {string} hoje  YYYY-MM-DD
 * @returns {object} { sessoes, seriesPorGrupo, volumeTotal, progressao, rpeMedio, ... }
 */
export function analisarTreinos(treinos = [], catalogoMapa = {}, hoje) {
  const semanas = [[], [], [], []]; // 0 = últimos 7 dias, 1 = 7 anteriores...
  for (const t of treinos) {
    const i = semanaIndice(t.inicio, hoje);
    if (i >= 0 && i < 4) semanas[i].push(t);
  }
  const serieValida = (s) => s.type !== 'warmup' && ((s.reps || 0) > 0 || (s.duration_seconds || 0) > 0);

  const daSemana = (lista) => {
    const seriesPorGrupo = new Map();
    const volumePorGrupo = new Map();
    const porExercicio = new Map();
    let volume = 0;
    let series = 0;
    const rpes = [];
    for (const t of lista) {
      for (const e of t.exercicios || []) {
        const meta = catalogoMapa[e.exercise_template_id] || {};
        const validas = (e.sets || []).filter(serieValida);
        if (!validas.length) continue;
        const volEx = validas.reduce((a, s) => a + (s.weight_kg || 0) * (s.reps || 0), 0);
        volume += volEx;
        series += validas.length;
        for (const s of validas) if (s.rpe) rpes.push(s.rpe);
        const primario = meta.primario || 'other';
        seriesPorGrupo.set(primario, (seriesPorGrupo.get(primario) || 0) + validas.length);
        volumePorGrupo.set(primario, (volumePorGrupo.get(primario) || 0) + volEx);
        for (const sec of meta.secundarios || []) seriesPorGrupo.set(sec, (seriesPorGrupo.get(sec) || 0) + validas.length * 0.5);
        const melhor = Math.max(...validas.map((s) => epley(s.weight_kg || 0, s.reps || 0)));
        const atual = porExercicio.get(e.title);
        if (!atual || melhor > atual.rm) porExercicio.set(e.title, { rm: melhor, grupo: primario, series: validas.length });
      }
    }
    return { sessoes: lista.length, series, volume, seriesPorGrupo, volumePorGrupo, porExercicio, rpeMedio: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null };
  };

  const agora = daSemana(semanas[0]);
  const anteriores = [daSemana(semanas[1]), daSemana(semanas[2]), daSemana(semanas[3])];
  const comTreino = anteriores.filter((s) => s.sessoes > 0);
  const volumeAnterior = comTreino.length ? comTreino.reduce((a, s) => a + s.volume, 0) / comTreino.length : null;

  // progressão por exercício: melhor 1RM estimado desta semana x melhor das semanas anteriores
  const progressao = [];
  for (const [nome, dados] of agora.porExercicio) {
    const antes = anteriores.map((s) => s.porExercicio.get(nome)?.rm).filter((x) => x > 0);
    if (!antes.length || !dados.rm) continue;
    const melhorAntes = Math.max(...antes);
    if (!melhorAntes) continue;
    progressao.push({ nome, grupo: dados.grupo, rm: dados.rm, antes: melhorAntes, variacao: (dados.rm - melhorAntes) / melhorAntes });
  }
  progressao.sort((a, b) => b.variacao - a.variacao);

  return {
    sessoes: agora.sessoes,
    series: agora.series,
    volume: agora.volume,
    volumeAnterior,
    variacaoVolume: volumeAnterior ? (agora.volume - volumeAnterior) / volumeAnterior : null,
    seriesPorGrupo: agora.seriesPorGrupo,
    rpeMedio: agora.rpeMedio,
    progressao,
    semanasComTreino: comTreino.length,
  };
}

// ============================================================
// Textos: linha curta pro perfil e bloco completo pro domingo
// ============================================================
const n0 = (x) => Math.round(x).toLocaleString('pt-BR');
const pct = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(0)}%`;

/** Linha curta (entra em toda resposta, junto do relógio). */
export function linhaTreino(a) {
  if (!a || !a.sessoes) return '';
  const grupos = [...a.seriesPorGrupo.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([g, s]) => `${grupoEmPortugues(g)} ${Math.round(s)}`);
  const sobe = a.progressao.filter((p) => p.variacao > 0.02).length;
  const desce = a.progressao.filter((p) => p.variacao < -0.02).length;
  return (
    `${a.sessoes} treino(s) de força nos últimos 7 dias, ${a.series} séries, volume ${n0(a.volume)} kg` +
    (a.variacaoVolume != null ? ` (${pct(a.variacaoVolume)} vs média das semanas anteriores)` : '') +
    `; séries por grupo: ${grupos.join(', ')}` +
    (a.rpeMedio ? `; esforço médio RPE ${a.rpeMedio.toFixed(1).replace('.', ',')}` : '') +
    (a.progressao.length ? `; carga subiu em ${sobe} e caiu em ${desce} de ${a.progressao.length} exercícios repetidos` : '')
  );
}

/** Bloco detalhado pro resumo de domingo (com o que a IA precisa pra julgar volume e progressão). */
export function blocoTreino(a, { nome } = {}) {
  if (!a || !a.sessoes) return `${nome ? `${nome}: ` : ''}nenhum treino de força registrado no Hevy nos últimos 7 dias.`;
  const grupos = [...a.seriesPorGrupo.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([g, s]) => `${grupoEmPortugues(g)} ${Math.round(s)} série(s)`)
    .join(', ');
  const sobe = a.progressao.filter((p) => p.variacao > 0.02).slice(0, 3);
  const desce = a.progressao.filter((p) => p.variacao < -0.02).slice(-3).reverse();
  const linha = (p) => `${p.nome} ${pct(p.variacao)} (1RM estimado ${p.rm.toFixed(0)} kg vs ${p.antes.toFixed(0)} kg)`;
  return [
    `${nome ? `${nome} — ` : ''}TREINO DE FORÇA (Hevy, últimos 7 dias): ${a.sessoes} sessão(ões), ${a.series} séries válidas, volume total ${n0(a.volume)} kg` +
      (a.variacaoVolume != null ? ` (${pct(a.variacaoVolume)} contra a média das ${a.semanasComTreino} semana(s) anteriores)` : '') +
      (a.rpeMedio ? `, RPE médio ${a.rpeMedio.toFixed(1).replace('.', ',')}` : ''),
    `  Séries por grupo muscular na semana: ${grupos}.`,
    sobe.length ? `  Carga subindo: ${sobe.map(linha).join('; ')}.` : '  Nenhum exercício com carga subindo esta semana.',
    desce.length ? `  Carga caindo: ${desce.map(linha).join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Sincroniza (se tiver chave), analisa e devolve { analise, linha, bloco }. Nunca lança.
 */
export async function treinoDe(perfil, dia, { sincronizar = true } = {}) {
  if (!temHevy(perfil)) return null;
  try {
    if (sincronizar) await sincronizarTreinos(perfil).catch((e) => console.warn('[treino] sincronização falhou:', e.message));
    const mapa = await catalogo(chaveDe(perfil)).catch(() => ({}));
    const desde = new Date(Date.now() - DIAS * 86400_000).toISOString();
    const treinos = await colecao('treinos').find({ jid: { $in: perfil.jids || [] }, inicio: { $gte: desde } }).toArray();
    const analise = analisarTreinos(treinos, mapa, dia);
    return { analise, linha: linhaTreino(analise), bloco: blocoTreino(analise, { nome: perfil.nome.split(' ')[0] }) };
  } catch (e) {
    console.error('[treino] falha:', e.message);
    return null;
  }
}
