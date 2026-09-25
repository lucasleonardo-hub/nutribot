// perfis.js - Perfis enriquecidos com horários habituais e atualização de dados vindos da conversa.

import { refeicoesDesde } from './mongo.js';
import { treinoDe } from './treino.js';
import { agendaDe } from './agenda.js';
import { diasAnteriores, horariosHabituais, descreverHorarios, fusoValido } from './util.js';

export const DIAS_ROTINA = 21; // janela pra aprender horários

/** Acrescenta a cada perfil os horários habituais aprendidos (_hab), a descrição deles e as refeições recentes (_refs). */
const ultimaSync = new Map(); // nome -> ms (não bate na API do Hevy a cada mensagem)
const INTERVALO_SYNC_MS = Number(process.env.HEVY_SYNC_MIN) * 60_000 || 60 * 60_000;
function precisaSincronizar(p) {
  const agoraMs = Date.now();
  if (agoraMs - (ultimaSync.get(p.nome) || 0) < INTERVALO_SYNC_MS) return false;
  ultimaSync.set(p.nome, agoraMs);
  return true;
}

export async function enriquecerPerfis(perfis, dia) {
  const desde = diasAnteriores(dia, DIAS_ROTINA)[0];
  return Promise.all(
    perfis.map(async (p) => {
      const refs = await refeicoesDesde(p.jids, desde).catch(() => []);
      const hab = horariosHabituais(refs);
      // treino de força (Hevy): sincroniza no máximo de hora em hora por pessoa, o resto vem do Mongo
      const t = await treinoDe(p, dia, { sincronizar: precisaSincronizar(p) }).catch(() => null);
      // agenda do Google: só de quem é dono da credencial (AGENDA_DONO); nunca vira assunto com outra pessoa
      const ag = await agendaDe(p).catch(() => null);
      return { ...p, horarios: descreverHorarios(hab), _hab: hab, _refs: refs, treino: t?.linha || null, _treino: t, _agenda: ag };
    })
  );
}

/**
 * Traduz a linha ATUALIZAR da IA em campos do perfil, com a data de cada mudança em perfil.atualizacoes.
 * Devolve o patch pra salvarPerfil, ou null se nada mudou. Puro: não toca no banco.
 */
export function aplicarAtualizacao(perfil, a, dia) {
  const novo = { jids: perfil.jids, atualizacoes: { ...(perfil.atualizacoes || {}) } };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(',', '.')) || null);
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  const set = (campo, valor) => {
    if (valor == null || valor === perfil[campo]) return;
    novo[campo] = valor;
    novo.atualizacoes[campo] = dia;
  };
  const peso = num(a.peso_kg ?? a.peso);
  if (peso && peso > 25 && peso < 400) set('peso', peso);
  const altura = num(a.altura_cm ?? a.altura);
  if (altura && altura > 100 && altura < 250) set('altura', altura);
  set('objetivo', str(a.objetivo));
  set('cidade', str(a.cidade));
  if (fusoValido(a.fuso)) set('fuso', a.fuso);
  set('dieta', str(a.dieta)?.toLowerCase());
  set('restricoes', str(a.restricoes));
  // meta com prazo ("quero chegar a 80 kg até março"): vira projeção no resumo de domingo
  const meta = num(a.meta_peso_kg ?? a.meta_peso);
  if (meta && meta > 25 && meta < 400) set('metaPeso', meta);
  const prazo = str(a.meta_prazo);
  if (prazo && /^\d{4}-\d{2}(-\d{2})?$/.test(prazo)) set('metaPrazo', prazo.length === 7 ? `${prazo}-28` : prazo);
  return Object.keys(novo).length > 2 ? novo : null;
}
