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

/** O mesmo pra várias pessoas, separado por pessoa (diário, momentos). */
export async function contextoDoDiaDeTodos(perfis, dia) {
  const blocos = [];
  for (const p of perfis || []) {
    const t = await contextoDoDia(p, dia).catch(() => '');
    if (t) blocos.push(t);
  }
  return blocos.join('\n\n');
}
