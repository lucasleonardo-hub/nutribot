// contexto.js - O "dia da pessoa" juntado em código, pra IA cruzar sem depender de lembrar: por onde andou (lugares),
// o que comprou (notas da despensa), atividade fixa feita ou não, treino do relógio. Entra nas notas noturnas, no diário
// e nos momentos, além da conversa (via lugares/despensa). Sem endereço de casa, sem CPF, sem total da nota.

import { colecao } from './mongo.js';
import { visitasDeHoje } from './lugares.js';
import { fusoDe } from './util.js';

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
      if (s.kcal && kcalVolta) {
        const saldo = Math.round(kcalVolta - s.kcal);
        const ok = quer === 'ganho' ? saldo >= 150 : quer === 'perda' ? saldo <= 250 : Math.abs(saldo) <= 300;
        partes.push(`energia em volta do treino ${Math.round(kcalVolta)} kcal vs ~${Math.round(s.kcal)} kcal gastas → ${saldo >= 0 ? '+' : ''}${saldo} kcal, ${ok ? 'coerente' : 'fora do que'} ${quer === 'ganho' ? 'o ganho de massa pede' : quer === 'perda' ? 'a perda de peso pede' : 'a manutenção pede'} ${ok ? '✓' : '✗'}`);
      } else if (kcalVolta) partes.push(`energia em volta do treino ${Math.round(kcalVolta)} kcal (sem gasto medido do relógio)`);
      cobertura = partes.length ? ` | cobertura: ${partes.join('; ')}` : '';
    }
    const extra = `${s.kcal ? ` · ~${Math.round(s.kcal)} kcal${s.fcMedia ? `, FC média ${s.fcMedia}` : ''} (relógio)` : ''}${s.hevy ? ` · Hevy: ${s.hevy.detalhe}` : ''}`;
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

/** O mesmo pra várias pessoas, separado por pessoa (diário, momentos). */
export async function contextoDoDiaDeTodos(perfis, dia) {
  const blocos = [];
  for (const p of perfis || []) {
    const t = await contextoDoDia(p, dia).catch(() => '');
    if (t) blocos.push(t);
  }
  return blocos.join('\n\n');
}
