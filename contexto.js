// contexto.js - O "dia da pessoa" juntado em código, pra IA cruzar sem depender de lembrar: por onde andou (lugares),
// o que comprou (notas da despensa), atividade fixa feita ou não, treino do relógio. Entra nas notas noturnas, no diário
// e nos momentos, além da conversa (via lugares/despensa). Sem endereço de casa, sem CPF, sem total da nota.

import { colecao } from './mongo.js';
import { visitasDeHoje, localDe } from './lugares.js';
import { fusoDe } from './util.js';
import { diasDeComida } from './progresso.js';

// gasto estimado por MET quando o relógio não traz kcal da sessão (o Hevy grava a sessão sem calorias): MET × kg × h
const MET_POR_NOME = [
  [/body ?pump|cross|hiit|funcional|circuito/i, 6.5],
  [/corrida|running|run\b/i, 9],
  [/bike|ciclismo|spinning|pedal/i, 7],
  [/nata[çc][ãa]o|swim/i, 7],
  [/caminhada|walk/i, 3.5],
  [/v[ôo]lei|volei/i, 5.5],
  [/futebol|futsal/i, 7.5],
  [/superior|inferior|perna|peito|costas|ombro|bra[çc]o|for[çc]a|muscula|strength|push|pull|legs|upper|lower|abd[ôo]men|treino/i, 5],
];
export const kcalEstimadoSessao = (nome, minutos, pesoKg) => {
  const met = (MET_POR_NOME.find(([re]) => re.test(String(nome || ''))) || [null, 5])[1];
  return Math.round((met * (Number(pesoKg) || 70) * (Number(minutos) || 0)) / 60);
};

/** Texto curto com o dia da pessoa fora da comida: lugares, compras, atividade. '' se não houver nada. */
export async function contextoDoDia(perfil, dia) {
  const linhas = [];
  try {
    const visitas = await visitasDeHoje(perfil, dia);
    if (visitas.length) linhas.push(`Lugares de hoje: ${visitas.map((v) => `${v.rotulo} ${v.inicio}–${v.fim}`).join(' · ')}`);
  } catch {}
  try {
    const notas = await colecao('notas').find({ jid: perfil.jids?.[0], dia }).toArray();
    if (notas.length) linhas.push(`Compras de hoje (nota lida): ${notas.map((n) => `${n.loja || 'mercado'}: ${n.itens.slice(0, 8).map((i) => i.item).join(', ')}${n.itens.length > 8 ? ` (+${n.itens.length - 8})` : ''}`).join(' · ')}`);
  } catch {}
  const feitas = perfil.atividadesFeitas?.[dia] || [];
  for (const f of feitas) linhas.push(`${f.nome}: ${f.feita ? `feito (+${f.kcal} kcal no gasto, ${f.como === 'localizacao' ? 'confirmado pela localização' : f.como === 'relato' ? 'ela(e) contou' : f.como === 'resposta' ? 'ela(e) confirmou' : 'sem resposta'})` : `não houve (${f.como === 'sem_resposta' ? 'sem resposta' : f.como === 'localizacao' ? 'pela localização' : 'ela(e) disse'})`}`);
  const pend = (perfil.atividadesPendentes || []).filter((p) => p.dia === dia);
  for (const p of pend) {
    const a = (perfil.atividades || []).find((x) => x.id === p.id);
    if (a) linhas.push(`${a.nome}: perguntei se houve, sem resposta ainda`);
  }
  if (!linhas.length) return '';
  return `DIA DE ${perfil.nome.split(' ')[0]} FORA DA COMIDA (${fusoDe(perfil)}):\n${linhas.map((l) => `- ${l}`).join('\n')}`;
}

// ---------- treino x refeições: o que foi pré e o que foi pós-treino, calculado em código ----------
const JANELA_MIN = 90; // refeição até 90 min depois do treino é o pós-treino (mesmo que seja o café da manhã); antes, o pré
const NOME_SLOT_CURTO = { cafe: 'café da manhã', lanche_manha: 'lanche da manhã', almoco: 'almoço', lanche: 'lanche', jantar: 'jantar', ceia: 'ceia' };
const minDe = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmmDe = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
/**
 * Puro. refeicoes = [{ slot, horaLocal|hora, descricao }]; sessoes = [{ nome, inicio, fim }] (minutos do dia, hora local).
 * Devolve { linhas: [...], porRefeicao: Map(hora -> 'pré-treino de X' | 'pós-treino de X') }.
 */
export function treinoXRefeicoes({ refeicoes = [], sessoes = [], perfil = null } = {}) {
  const porRefeicao = new Map();
  const linhas = [];
  const refs = refeicoes.map((r) => ({ ...r, min: minDe(r.horaLocal || r.hora) })).filter((r) => r.min != null).sort((a, b) => a.min - b.min);
  const peso = Number(perfil?.peso) || 0;
  const objetivo = String(perfil?.objetivo || '').toLowerCase();
  const quer = /hipertrof|ganh|massa|bulk|engord|for[çc]a/.test(objetivo) ? 'ganho' : /emagre|perd|secar|defin|cutting|d[ée]ficit/.test(objetivo) ? 'perda' : 'manter';
  for (const s of [...sessoes].filter((x) => x.inicio != null && x.fim != null).sort((a, b) => a.inicio - b.inicio)) {
    const pre = refs.filter((r) => r.min <= s.inicio && s.inicio - r.min <= JANELA_MIN).pop() || null;
    const pos = refs.find((r) => r.min >= s.fim && r.min - s.fim <= JANELA_MIN) || null;
    const nomeRef = (r) => `${NOME_SLOT_CURTO[r.slot] || r.slot} ${r.horaLocal || r.hora}${r.descricao ? ` (${String(r.descricao).slice(0, 60)})` : ''}${r.estimativa?.kcal ? ` ${Math.round(r.estimativa.kcal)} kcal/${Math.round(r.estimativa.p || 0)} g P` : ''}`;
    if (pre) porRefeicao.set(pre.horaLocal || pre.hora, `pré-treino de ${s.nome}`);
    if (pos) porRefeicao.set(pos.horaLocal || pos.hora, `pós-treino de ${s.nome} (${pos.min - s.fim} min depois)`);
    // cobertura: proteína no pós (alvo 0,3 g/kg) e energia em volta do treino contra o gasto medido pelo relógio, lida pelo objetivo
    let cobertura = '';
    if (pos || pre) {
      const partes = [];
      if (pos?.estimativa && peso) {
        const alvoP = Math.round(peso * 0.3);
        const p = Math.round(pos.estimativa.p || 0);
        partes.push(`proteína no pós ${p} g (alvo ≥ ${alvoP} g) ${p >= alvoP ? '✓' : '✗'}`);
      }
      const kcalVolta = (pre?.estimativa?.kcal || 0) + (pos?.estimativa?.kcal || 0);
      // sem kcal do relógio (o Hevy grava a sessão sem calorias), estima por MET pela duração e pelo peso
      const gasto = s.kcal || (peso ? kcalEstimadoSessao(s.nome, s.fim - s.inicio, peso) : 0);
      if (gasto && kcalVolta) {
        const saldo = Math.round(kcalVolta - gasto);
        const ok = quer === 'ganho' ? saldo >= 150 : quer === 'perda' ? saldo <= 250 : Math.abs(saldo) <= 300;
        partes.push(`energia em volta do treino ${Math.round(kcalVolta)} kcal vs ~${Math.round(gasto)} kcal gastas${s.kcal ? '' : ' (estimativa por MET)'} → ${saldo >= 0 ? '+' : ''}${saldo} kcal, ${ok ? 'coerente' : 'fora do que'} ${quer === 'ganho' ? 'o ganho de massa pede' : quer === 'perda' ? 'a perda de peso pede' : 'a manutenção pede'} ${ok ? '✓' : '✗'}`);
      } else if (kcalVolta) partes.push(`energia em volta do treino ${Math.round(kcalVolta)} kcal (sem gasto medido)`);
      cobertura = partes.length ? ` | cobertura: ${partes.join('; ')}` : '';
    }
    const gastoTxt = s.kcal ? ` · ~${Math.round(s.kcal)} kcal${s.fcMedia ? `, FC média ${s.fcMedia}` : ''} (relógio)` : peso ? ` · ~${kcalEstimadoSessao(s.nome, s.fim - s.inicio, peso)} kcal (estimativa por MET${s.fcMedia ? `; FC média ${s.fcMedia} no relógio` : ''})` : '';
    const extra = `${gastoTxt}${s.hevy ? ` · Hevy: ${s.hevy.detalhe}` : ''}`;
    linhas.push(
      `- ${s.nome} ${hhmmDe(s.inicio)}–${hhmmDe(s.fim)}${extra}: pré = ${pre ? nomeRef(pre) : 'nada registrado até 90 min antes'}; pós = ${pos ? `${nomeRef(pos)}, ${pos.min - s.fim} min depois` : s.jaAcabou === false ? 'ainda não acabou' : 'nada registrado até 90 min depois'}${cobertura}`
    );
  }
  return { linhas, porRefeicao };
}
// ---------- Hevy: a sessão de hoje em detalhe (exercícios, cargas, progressão) ----------
const serieValida = (s) => s && s.type !== 'warmup' && ((s.reps || 0) > 0 || (s.duration_seconds || 0) > 0);
const fmtKg = (kg) => String(Math.round(kg * 10) / 10).replace('.', ',');
/**
 * Puro. Resume uma sessão do Hevy e compara com as sessões anteriores (mesmo exercício): melhor série, volume, RPE,
 * progressão por exercício. sessao = { titulo, inicio, fim, exercicios: [{ title, sets }] }; anteriores = sessões antigas.
 */
export function resumirSessaoHevy(sessao, anteriores = []) {
  const exs = [];
  const rpes = [];
  let volume = 0;
  let series = 0;
  for (const e of sessao?.exercicios || []) {
    const validas = (e.sets || []).filter(serieValida);
    if (!validas.length) continue;
    const vol = validas.reduce((a, s) => a + (s.weight_kg || 0) * (s.reps || 0), 0);
    volume += vol;
    series += validas.length;
    for (const s of validas) if (s.rpe) rpes.push(s.rpe);
    const melhor = validas.reduce((m, s) => ((s.weight_kg || 0) > (m?.weight_kg || 0) || (!m ? true : (s.weight_kg || 0) === (m.weight_kg || 0) && (s.reps || 0) > (m.reps || 0)) ? s : m), null);
    // última sessão anterior com o mesmo exercício
    let prog = null;
    for (const a of [...anteriores].sort((x, y) => String(y.inicio).localeCompare(String(x.inicio)))) {
      const ea = (a.exercicios || []).find((x) => x.title === e.title);
      if (!ea) continue;
      const va = (ea.sets || []).filter(serieValida);
      if (!va.length) continue;
      const melhorA = Math.max(...va.map((s) => s.weight_kg || 0));
      const volA = va.reduce((acc, s) => acc + (s.weight_kg || 0) * (s.reps || 0), 0);
      const dKg = (melhor?.weight_kg || 0) - melhorA;
      prog = { quando: String(a.inicio).slice(0, 10), dKg, dVol: vol - volA, texto: dKg > 0 ? `+${fmtKg(dKg)} kg` : dKg < 0 ? `−${fmtKg(-dKg)} kg` : vol > volA * 1.05 ? 'mesma carga, mais volume' : vol < volA * 0.95 ? 'mesma carga, menos volume' : 'igual' };
      break;
    }
    exs.push({ title: e.title, series: validas.length, volume: vol, melhor: melhor ? `${fmtKg(melhor.weight_kg || 0)} kg×${melhor.reps || 0}` : '-', prog });
  }
  exs.sort((a, b) => b.volume - a.volume);
  const rpe = rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null;
  const subiu = exs.filter((e) => e.prog && e.prog.dKg > 0).length;
  const caiu = exs.filter((e) => e.prog && e.prog.dKg < 0).length;
  const detalhe =
    `${exs.length} exercícios, ${series} séries, volume ${Math.round(volume).toLocaleString('pt-BR')} kg${rpe ? `, RPE médio ${String(rpe).replace('.', ',')}` : ''}` +
    (exs.length ? `; ${exs.slice(0, 4).map((e) => `${e.title} ${e.melhor}${e.prog ? ` (${e.prog.texto} vs ${e.prog.quando.slice(8, 10)}/${e.prog.quando.slice(5, 7)})` : ''}`).join(', ')}` : '') +
    (subiu || caiu ? `; carga subiu em ${subiu}, caiu em ${caiu}` : '');
  return { detalhe, volume, series, rpe, exercicios: exs, subiu, caiu };
}
/** Sessões do Hevy de hoje (dia local), já resumidas e comparadas com as 6 semanas anteriores. */
export async function sessoesHevyDoDia(perfil, dia) {
  const jids = perfil.jids || [];
  if (!jids.length) return [];
  const fuso = fusoDe(perfil);
  const desde = new Date(new Date(`${dia}T00:00:00Z`).getTime() - 50 * 86400_000).toISOString();
  const todas = await colecao('treinos').find({ jid: { $in: jids }, inicio: { $gte: desde } }).sort({ inicio: 1 }).toArray().catch(() => []);
  const deHoje = todas.filter((t) => localDe(t.inicio, fuso).dia === dia);
  return deHoje.map((t) => {
    const anteriores = todas.filter((a) => a._id !== t._id && String(a.inicio) < String(t.inicio));
    const r = resumirSessaoHevy(t, anteriores);
    const li = localDe(t.inicio, fuso);
    const lf = localDe(t.fim || t.inicio, fuso);
    return { nome: `${t.titulo || 'treino'} (Hevy)`, inicio: Math.round(li.hora * 60), fim: Math.round(lf.hora * 60) > Math.round(li.hora * 60) ? Math.round(lf.hora * 60) : Math.round(li.hora * 60) + 60, fonte: 'hevy', hevy: r };
  });
}

/** Sessões de treino de hoje: Hevy (detalhe), relógio (Health Connect, kcal), academia pela localização e atividade fixa confirmada. */
export async function sessoesDeHoje(perfil, dia, { rel = null, visitas = null } = {}) {
  const sessoes = [];
  for (const h of await sessoesHevyDoDia(perfil, dia).catch(() => [])) sessoes.push(h);
  for (const t of rel?.treinosHoje || []) {
    const ini = minDe(t.hora);
    if (ini == null) continue;
    if ((t.min || 0) < 20 && /caminhada|walk/i.test(t.nome || '')) continue;
    // a mesma sessão no Hevy: junta (nome e cargas do Hevy, kcal e batimentos do relógio)
    const mesma = sessoes.find((s) => s.fonte === 'hevy' && Math.abs(s.inicio - ini) <= 45);
    if (mesma) {
      mesma.kcal = t.kcal || mesma.kcal || null;
      mesma.fcMedia = t.fcMedia || null;
      mesma.fim = Math.max(mesma.fim, ini + (t.min || 60));
      continue;
    }
    sessoes.push({ nome: `${t.nome || 'treino'} (relógio)`, inicio: ini, fim: ini + (t.min || 60), fonte: 'relogio', kcal: t.kcal || null, fcMedia: t.fcMedia || null });
  }
  const vs = visitas || (await visitasDeHoje(perfil, dia).catch(() => []));
  for (const v of vs) {
    if (String(v.lugar?.tipo || '') !== 'academia') continue;
    const ini = Math.round(v.hIni * 60);
    const fim = Math.round(v.hFim * 60);
    // já coberto por uma sessão do relógio no mesmo horário? não duplica
    if (sessoes.some((s) => Math.abs(s.inicio - ini) <= 45)) continue;
    sessoes.push({ nome: `academia ${v.lugar.nome || ''}`.trim(), inicio: ini, fim, fonte: 'lugar' });
  }
  for (const f of perfil.atividadesFeitas?.[dia] || []) {
    if (!f.feita) continue;
    const a = (perfil.atividades || []).find((x) => x.id === f.id);
    if (!a) continue;
    const ini = minDe(a.inicio);
    const fim = minDe(a.fim);
    if (ini != null && fim != null) sessoes.push({ nome: a.nome, inicio: ini, fim, fonte: 'atividade' });
  }
  return sessoes.sort((a, b) => a.inicio - b.inicio);
}
/** Bloco pro prompt (conversa e pensamentos): '' sem treino hoje. */
export async function blocoTreinoRefeicoes(perfil, dia, { rel = null } = {}) {
  const [sessoes, refs] = await Promise.all([sessoesDeHoje(perfil, dia, { rel }), colecao('refeicoes').find({ jid: { $in: perfil.jids || [] }, dia }).toArray().catch(() => [])]);
  if (!sessoes.length) return '';
  const { linhas } = treinoXRefeicoes({ refeicoes: refs, sessoes, perfil });
  return `TREINO x REFEIÇÕES HOJE (calculado pelo sistema: refeição até 90 min depois do treino É o pós-treino, mesmo sendo o café da manhã; até 90 min antes é o pré; "Hevy" traz exercícios, melhor série e progressão de carga contra a última vez; "cobertura" diz se o pós teve proteína suficiente e se a energia em volta do treino combina com o objetivo):\n${linhas.join('\n')}`;
}

// ---------- progressão de força (platô por exercício) + recuperação + suplementos, cruzados em código ----------
/**
 * Puro. Por exercício com 3+ sessões no período: melhor carga por sessão, semanas desde a última subida, situação.
 * sessoes = [{ inicio, exercicios: [{ title, sets }] }] (ordem qualquer). Devolve { exercicios: [...], parados, subindo, caindo }.
 */
export function progressaoForca(sessoes = [], { dia, semanas = 8 } = {}) {
  const desde = new Date(new Date(`${dia}T12:00:00Z`).getTime() - semanas * 7 * 86400_000).toISOString();
  const ordenadas = [...sessoes].filter((s) => String(s.inicio) >= desde).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  const porEx = new Map();
  for (const s of ordenadas) {
    for (const e of s.exercicios || []) {
      const validas = (e.sets || []).filter(serieValida);
      if (!validas.length) continue;
      const melhor = Math.max(...validas.map((x) => x.weight_kg || 0));
      const repsNaMelhor = Math.max(...validas.filter((x) => (x.weight_kg || 0) === melhor).map((x) => x.reps || 0));
      const lista = porEx.get(e.title) || [];
      lista.push({ dia: String(s.inicio).slice(0, 10), melhor, reps: repsNaMelhor, volume: validas.reduce((a, x) => a + (x.weight_kg || 0) * (x.reps || 0), 0) });
      porEx.set(e.title, lista);
    }
  }
  const exercicios = [];
  for (const [title, lista] of porEx) {
    if (lista.length < 3) continue;
    // exercício sem carga (prancha, abdominal, panturrilha em pé com o peso do corpo) não entra na leitura de progressão de carga
    if (!lista.some((x) => x.melhor > 0)) continue;
    const ultimo = lista[lista.length - 1];
    // última sessão em que a carga (ou as reps na mesma carga) subiram em relação à anterior
    let ultimaSubida = null;
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1];
      const b = lista[i];
      if (b.melhor > a.melhor || (b.melhor === a.melhor && b.reps > a.reps)) ultimaSubida = b.dia;
    }
    const semanasParado = ultimaSubida ? Math.floor((new Date(`${ultimo.dia}T12:00:00Z`) - new Date(`${ultimaSubida}T12:00:00Z`)) / (7 * 86400_000)) : Math.floor((new Date(`${ultimo.dia}T12:00:00Z`) - new Date(`${lista[0].dia}T12:00:00Z`)) / (7 * 86400_000));
    const primeiro = lista[0];
    const caiu = ultimo.melhor < primeiro.melhor - 0.01 && ultimo.melhor < lista[lista.length - 2].melhor;
    const situacao = caiu ? 'caindo' : semanasParado >= 2 ? 'parado' : 'subindo';
    exercicios.push({ title, sessoes: lista.length, melhor: ultimo.melhor, reps: ultimo.reps, desde: primeiro.melhor, ultimaSubida, semanasParado, situacao });
  }
  exercicios.sort((a, b) => b.semanasParado - a.semanasParado);
  return { exercicios, parados: exercicios.filter((e) => e.situacao === 'parado'), subindo: exercicios.filter((e) => e.situacao === 'subindo'), caindo: exercicios.filter((e) => e.situacao === 'caindo') };
}
/** Puro. Suplementos pelos registros de refeição (descrições): dias com creatina, whey por dia, hipercalórico. */
export function suplementosPelosRegistros(refeicoes = [], { dias = 14 } = {}) {
  const porDia = new Map();
  for (const r of refeicoes) {
    const d = porDia.get(r.dia) || { creatina: false, whey: 0, hiper: 0 };
    const t = `${r.descricao || ''} ${r.resumo || ''}`.toLowerCase();
    if (/creatina/.test(t)) d.creatina = true;
    const w = t.match(/(\d{1,3})\s*g\s*(?:de\s*)?(?:whey|prote[íi]na isolada|iso\b)/g);
    if (w) for (const m of w) d.whey += Number((m.match(/\d+/) || [0])[0]);
    else if (/whey|scoop|dose de prote/.test(t)) d.whey += 30;
    if (/hipercal[óo]rico|mass ?gainer|pro ?force|growth mass/.test(t)) d.hiper += 1;
    porDia.set(r.dia, d);
  }
  const lista = [...porDia.values()];
  const n = Math.max(1, Math.min(dias, lista.length));
  return { diasComRegistro: lista.length, diasCreatina: lista.filter((d) => d.creatina).length, wheyMedio: Math.round(lista.reduce((a, d) => a + d.whey, 0) / n), diasWhey: lista.filter((d) => d.whey > 0).length, hipercalorico: lista.reduce((a, d) => a + d.hiper, 0) };
}
/**
 * Bloco FORÇA x RECUPERAÇÃO: progressão por exercício (Hevy, 8 semanas), sono médio 7 dias, proteína e calorias da semana,
 * suplementos pelos registros, e uma LEITURA em código (recuperação / comida / estímulo). '' sem Hevy.
 */
export async function blocoForcaRecuperacao(perfil, dia, opts = {}) {
  const a = await analiseForca(perfil, dia, opts);
  return a.texto;
}
/** Igual ao bloco, mas devolve também a estrutura: { texto, prog, podePuxar, sugestoes }. */
export async function analiseForca(perfil, dia, { magraSem = null, faixa = null } = {}) {
  const jids = perfil.jids || [];
  if (!jids.length) return { texto: '', prog: null, podePuxar: false, sugestoes: [] };
  const desde8 = new Date(new Date(`${dia}T12:00:00Z`).getTime() - 56 * 86400_000).toISOString();
  const diaMenos = (n) => new Date(new Date(`${dia}T12:00:00Z`).getTime() - n * 86400_000).toISOString().slice(0, 10);
  const [sessoes, rel, refs28] = await Promise.all([
    colecao('treinos').find({ jid: { $in: jids }, inicio: { $gte: desde8 } }).toArray().catch(() => []),
    colecao('saude_relogio').findOne({ _id: jids[0] }, { projection: { sonos: { $slice: -7 }, fcRepouso: 1, fcMedia: 1, recuperacao: 1 } }).catch(() => null),
    colecao('refeicoes').find({ jid: { $in: jids }, dia: { $gte: diaMenos(28), $lte: dia } }).toArray().catch(() => []),
  ]);
  const refs14 = refs28.filter((r) => r.dia >= diaMenos(13));
  if (!sessoes.length) return { texto: '', prog: null, podePuxar: false, sugestoes: [] };
  const prog = progressaoForca(sessoes, { dia });
  // sugestões de carga abertas (feitas no domingo) conferidas contra o Hevy desde então
  const sugestoes = await atualizarSugestoesCarga(perfil).catch(() => perfil.sugestoesCarga || []);
  const txtSug = textoSugestoesCarga(sugestoes, { hoje: dia });
  const sonos = (rel?.sonos || []).filter((s) => s.total);
  const sonoMedioMin = sonos.length ? Math.round(sonos.reduce((a, s) => a + s.total, 0) / sonos.length) : null;
  // 7 dias FECHADOS e completos (critério único do progresso.js, com a mediana dos 28 dias como no !progresso e na meta
  // adaptativa): o dia de hoje pela metade puxava a média pra baixo e a leitura saía "calorias abaixo da faixa: comida
  // primeiro" no meio da tarde
  const diasRef = diasDeComida(refs28, { dia, de: diaMenos(28) }).completos.filter((c) => c.dia >= diaMenos(7));
  const kcalMedia = diasRef.length ? Math.round(diasRef.reduce((a, d) => a + d.kcal, 0) / diasRef.length) : null;
  const pMedia = diasRef.length ? Math.round(diasRef.reduce((a, d) => a + d.p, 0) / diasRef.length) : null;
  const peso = Number(perfil.peso) || 0;
  const pAlvo = peso ? Math.round(peso * 1.6) : null;
  const sup = suplementosPelosRegistros(refs14);
  const hs = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  // leitura em código, na ordem do conhecimento: sono -> comida -> composição -> estímulo
  const leitura = [];
  const sonoCurto = sonoMedioMin != null && sonoMedioMin < 390;
  // calorias "abaixo" só fora da incerteza da meta (a mesma folga do !progresso; 100 kcal sem calibração): 3.850 contra um
  // piso de 3.910 com ±600 de incerteza saía "comida primeiro" aqui e "dentro" no PROGRESSO (revisão de 09/10)
  const folgaKcal = faixa ? Math.max(100, Number(faixa.folga) || 0) : 0;
  const kcalBaixa = Boolean(faixa && kcalMedia != null && kcalMedia < faixa.min - folgaKcal);
  const comidaBaixa = kcalBaixa || (pAlvo && pMedia != null && pMedia < pAlvo);
  const recupRuim = rel?.recuperacao && /segur|alta|acima/i.test(String(rel.recuperacao));
  if (prog.caindo.length >= 3 && (sonoCurto || recupRuim)) leitura.push(`carga caindo em ${prog.caindo.length} exercícios com ${sonoCurto ? `sono médio ${hs(sonoMedioMin)}` : 'batimento de repouso acima da média'}: sinal de deload/descanso, não de puxar`);
  if (prog.parados.length) {
    const nomes = prog.parados.slice(0, 3).map((e) => `${e.title} (${fmtKg(e.melhor)} kg há ${e.semanasParado} sem.)`).join(', ');
    if (sonoCurto) leitura.push(`carga parada em ${prog.parados.length} exercício(s) [${nomes}] e sono médio ${hs(sonoMedioMin)} na semana: recuperação primeiro, carga depois`);
    else if (comidaBaixa) leitura.push(`carga parada em ${prog.parados.length} exercício(s) [${nomes}] e ${kcalBaixa ? `calorias abaixo da faixa (${kcalMedia} vs ${faixa.min}${folgaKcal > 100 ? `, incerteza da meta ±${Math.round(folgaKcal)}` : ''})` : `proteína abaixo da meta (${pMedia} g vs ${pAlvo} g)`}: comida primeiro`);
    else if (magraSem != null && magraSem < 0.05) leitura.push(`carga parada em ${prog.parados.length} exercício(s) [${nomes}] com massa magra parada: superávit virando gordura? ajustar composição do prato antes de carga`);
    else leitura.push(`carga parada em ${prog.parados.length} exercício(s) [${nomes}] com sono${sonoMedioMin != null ? ` ${hs(sonoMedioMin)}` : ''}, comida e massa magra em dia: pode PUXAR (+1,25 a 2,5 kg, ou +1 a 2 repetições, uma mudança por vez)`);
  }
  if (!prog.parados.length && !prog.caindo.length && prog.subindo.length) leitura.push(`carga subindo em ${prog.subindo.length} exercício(s): estímulo e recuperação em dia; manter`);
  const podePuxar = leitura.some((l) => /pode PUXAR/.test(l));
  const texto =
    `FORÇA x RECUPERAÇÃO (8 semanas de Hevy; calculado pelo sistema):\n` +
    `- Progressão: ${prog.subindo.length} subindo, ${prog.parados.length} parado(s) há 2+ semanas, ${prog.caindo.length} caindo` +
    (prog.parados.length ? `. Parados: ${prog.parados.slice(0, 5).map((e) => `${e.title} ${fmtKg(e.melhor)} kg×${e.reps} desde ${e.ultimaSubida ? e.ultimaSubida.slice(8, 10) + '/' + e.ultimaSubida.slice(5, 7) : 'o início'}`).join('; ')}` : '') +
    (prog.subindo.length ? `. Subindo: ${prog.subindo.slice(0, 4).map((e) => (e.melhor > e.desde ? `${e.title} ${fmtKg(e.desde)}→${fmtKg(e.melhor)} kg` : `${e.title} ${fmtKg(e.melhor)} kg com mais repetições (${e.reps})`)).join('; ')}` : '') + '\n' +
    `- Recuperação (7 dias): sono médio ${sonoMedioMin != null ? hs(sonoMedioMin) : '?'}${rel?.fcRepouso ? `, repouso ${rel.fcRepouso} bpm${rel.fcMedia ? ` (média ${Math.round(rel.fcMedia)})` : ''}` : ''}${rel?.recuperacao ? `, sinal: ${rel.recuperacao}` : ''}\n` +
    `- Comida (7 dias): ${kcalMedia != null ? `${kcalMedia} kcal/dia` : 'sem dias completos'}${faixa ? ` (faixa ${faixa.min}–${faixa.max})` : ''}${pMedia != null ? `, proteína ${pMedia} g/dia${pAlvo ? ` (mínimo ${pAlvo} g)` : ''}` : ''}${magraSem != null ? `, massa magra ${magraSem >= 0 ? '+' : '−'}${Math.abs(magraSem).toFixed(2).replace('.', ',')} kg/semana` : ''}\n` +
    `- Suplementos pelos registros (14 dias): creatina em ${sup.diasCreatina} de ${sup.diasComRegistro} dias${sup.diasCreatina >= 10 ? ' (constante: saturado, efeito pleno)' : sup.diasCreatina ? ' (irregular: estoque não satura)' : ''}; whey ~${sup.wheyMedio} g/dia em ${sup.diasWhey} dias; hipercalórico ${sup.hipercalorico}x\n` +
    (leitura.length ? `- LEITURA: ${leitura.join(' | ')}` : '- LEITURA: sem sinal claro') +
    (txtSug ? `\n${txtSug}` : '');
  return { texto, prog, podePuxar, sugestoes, sonoMedioMin, kcalMedia, pMedia };
}

// ---------- sugestões de carga da semana: propostas no domingo, conferidas no Hevy durante a semana ----------
/** Puro. Incremento sensato pelo tipo de exercício e carga atual. */
export function incrementoDeCarga(title, kg) {
  const t = String(title || '').toLowerCase();
  if (/leg press|hack|smith/.test(t) && kg >= 100) return 5;
  if (/halter|dumbbell|kettlebell/.test(t)) return kg >= 20 ? 2 : 1;
  if (kg < 20) return 1;
  if (kg < 60) return 2.5;
  return 2.5;
}
/**
 * Puro. A partir dos exercícios parados (com carga), até `max` sugestões: subir carga OU repetições.
 * Devolve [{ id, exercicio, deKg, deReps, paraKg, paraReps, feitaEm, status: 'aberta' }].
 */
export function gerarSugestoesCarga(parados = [], { dia, max = 3 } = {}) {
  return parados
    .filter((e) => e.melhor > 0)
    .sort((a, b) => b.semanasParado - a.semanasParado || b.melhor - a.melhor)
    .slice(0, max)
    .map((e, i) => {
      const inc = incrementoDeCarga(e.title, e.melhor);
      return { id: `s${String(dia).replace(/-/g, '')}${i + 1}`, exercicio: e.title, deKg: e.melhor, deReps: e.reps, paraKg: Math.round((e.melhor + inc) * 100) / 100, paraReps: Math.max(1, (e.reps || 8) + 2), feitaEm: dia, status: 'aberta', tentativas: 0 };
    });
}
/**
 * Puro. Confere sugestões abertas contra as sessões do Hevy feitas depois de feitaEm: bateu (carga >= paraKg, ou reps >= paraReps
 * na carga de partida), tentou sem subir (fez o exercício e não bateu), ou ainda não fez. Devolve a lista atualizada.
 */
export function conferirSugestoes(sugestoes = [], sessoes = []) {
  return sugestoes.map((s) => {
    if (s.status !== 'aberta' && s.status !== 'tentando') return s;
    const depois = sessoes.filter((x) => String(x.inicio).slice(0, 10) > s.feitaEm).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    let tentativas = 0;
    for (const sess of depois) {
      const e = (sess.exercicios || []).find((x) => x.title === s.exercicio);
      if (!e) continue;
      const validas = (e.sets || []).filter(serieValida);
      if (!validas.length) continue;
      tentativas += 1;
      const melhorKg = Math.max(...validas.map((x) => x.weight_kg || 0));
      const repsNaBase = Math.max(0, ...validas.filter((x) => (x.weight_kg || 0) >= s.deKg).map((x) => x.reps || 0));
      if (melhorKg >= s.paraKg - 0.01 || repsNaBase >= s.paraReps) {
        return { ...s, status: 'batida', batidaEm: String(sess.inicio).slice(0, 10), como: melhorKg >= s.paraKg - 0.01 ? `${fmtKg(melhorKg)} kg` : `${repsNaBase} repetições com ${fmtKg(s.deKg)} kg`, tentativas };
      }
    }
    return { ...s, status: tentativas ? 'tentando' : 'aberta', tentativas };
  });
}
const textoSugestao = (s) => `${s.exercicio}: de ${fmtKg(s.deKg)} kg×${s.deReps} para ${fmtKg(s.paraKg)} kg (ou ${s.paraReps} repetições com ${fmtKg(s.deKg)} kg)`;
/** Texto das sugestões com o estado atual (pra conversa, pensamentos e domingo). '' sem sugestões. */
export function textoSugestoesCarga(sugestoes = [], { hoje } = {}) {
  const vivas = sugestoes.filter((s) => s.status !== 'encerrada');
  if (!vivas.length) return '';
  const linhas = vivas.map((s) => {
    const estado = s.status === 'batida' ? `BATEU em ${s.batidaEm.slice(8, 10)}/${s.batidaEm.slice(5, 7)} (${s.como}) ✓` : s.status === 'tentando' ? `fez o exercício ${s.tentativas}x e ainda não subiu` : 'ainda não fez o exercício desde a sugestão';
    return `- ${textoSugestao(s)} → ${estado}`;
  });
  return `SUGESTÕES DE CARGA DA SEMANA (feitas em ${vivas[0].feitaEm.slice(8, 10)}/${vivas[0].feitaEm.slice(5, 7)} e conferidas no Hevy a cada sincronização${hoje ? `; hoje ${hoje}` : ''}):\n${linhas.join('\n')}`;
}
/** Lê as sugestões do perfil, confere contra o Hevy desde a data e grava o estado novo. Devolve a lista atualizada. */
export async function atualizarSugestoesCarga(perfil, { salvar = true } = {}) {
  const abertas = (perfil.sugestoesCarga || []).filter((s) => s.status !== 'encerrada');
  if (!abertas.length) return perfil.sugestoesCarga || [];
  const desde = abertas.map((s) => s.feitaEm).sort()[0];
  const sessoes = await colecao('treinos').find({ jid: { $in: perfil.jids || [] }, inicio: { $gte: `${desde}T00:00:00Z` } }).toArray().catch(() => []);
  const novas = conferirSugestoes(perfil.sugestoesCarga || [], sessoes);
  const mudou = JSON.stringify(novas) !== JSON.stringify(perfil.sugestoesCarga || []);
  if (mudou && salvar) {
    const { salvarPerfil } = await import('./mongo.js');
    await salvarPerfil({ jids: perfil.jids, sugestoesCarga: novas }).catch(() => {});
  }
  return novas;
}

/** O mesmo pra várias pessoas, separado por pessoa (diário, momentos). */
export async function contextoDoDiaDeTodos(perfis, dia) {
  const blocos = [];
  for (const p of perfis || []) {
    const t = await contextoDoDia(p, dia).catch(() => '');
    if (t) blocos.push(t);
  }
  return blocos.join('\n\n');
}
