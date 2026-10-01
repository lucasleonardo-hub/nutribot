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
export function treinoXRefeicoes({ refeicoes = [], sessoes = [] } = {}) {
  const porRefeicao = new Map();
  const linhas = [];
  const refs = refeicoes.map((r) => ({ ...r, min: minDe(r.horaLocal || r.hora) })).filter((r) => r.min != null).sort((a, b) => a.min - b.min);
  for (const s of [...sessoes].filter((x) => x.inicio != null && x.fim != null).sort((a, b) => a.inicio - b.inicio)) {
    const pre = refs.filter((r) => r.min <= s.inicio && s.inicio - r.min <= JANELA_MIN).pop() || null;
    const pos = refs.find((r) => r.min >= s.fim && r.min - s.fim <= JANELA_MIN) || null;
    const nomeRef = (r) => `${NOME_SLOT_CURTO[r.slot] || r.slot} ${r.horaLocal || r.hora}${r.descricao ? ` (${String(r.descricao).slice(0, 60)})` : ''}`;
    if (pre) porRefeicao.set(pre.horaLocal || pre.hora, `pré-treino de ${s.nome}`);
    if (pos) porRefeicao.set(pos.horaLocal || pos.hora, `pós-treino de ${s.nome} (${pos.min - s.fim} min depois)`);
    linhas.push(
      `- ${s.nome} ${hhmmDe(s.inicio)}–${hhmmDe(s.fim)}: pré = ${pre ? nomeRef(pre) : 'nada registrado até 90 min antes'}; pós = ${pos ? `${nomeRef(pos)}, ${pos.min - s.fim} min depois` : s.jaAcabou === false ? 'ainda não acabou' : 'nada registrado até 90 min depois'}`
    );
  }
  return { linhas, porRefeicao };
}
/** Sessões de treino de hoje: relógio (Health Connect), academia pela localização e atividade fixa confirmada. */
export async function sessoesDeHoje(perfil, dia, { rel = null, visitas = null } = {}) {
  const sessoes = [];
  for (const t of rel?.treinosHoje || []) {
    const ini = minDe(t.hora);
    if (ini == null) continue;
    if ((t.min || 0) < 20 && /caminhada|walk/i.test(t.nome || '')) continue;
    sessoes.push({ nome: `${t.nome || 'treino'} (relógio)`, inicio: ini, fim: ini + (t.min || 60), fonte: 'relogio' });
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
  const { linhas } = treinoXRefeicoes({ refeicoes: refs, sessoes });
  return `TREINO x REFEIÇÕES HOJE (calculado pelo sistema: refeição até 90 min depois do treino É o pós-treino, mesmo sendo o café da manhã; até 90 min antes é o pré):\n${linhas.join('\n')}`;
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
