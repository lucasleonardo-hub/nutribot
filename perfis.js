// perfis.js - Perfis enriquecidos com horários habituais e atualização de dados vindos da conversa.

import { refeicoesDesde, eventosDe } from './mongo.js';
import { treinoDe } from './treino.js';
import { agendaDe } from './agenda.js';
import { contextoLugares, roteiroDoDia, localDe, visitasDeHoje } from './lugares.js';
import { situacaoRelogio } from './relogio.js';
import { blocoAtividades, atividadesComoAgenda } from './atividades.js';
import { blocoTreinoRefeicoes } from './contexto.js';
import { fusoDe } from './util.js';
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

/**
 * Puro. Eventos marcados no app (fase 7) no formato da agenda que o roteiroDoDia lê: só os do dia com hora; duração de
 * 90 min (refeição, festa) ou 60 min (o resto); o tipo diz que veio do app. `fuso` = o da pessoa.
 */
const NOME_EVENTO = { comer_fora: 'refeição fora', festa: 'festa', viagem: 'viagem', treino: 'treino', consulta: 'consulta', outro: 'compromisso' };
export function eventosComoAgenda(eventos = [], { dia, fuso = 'America/Sao_Paulo' } = {}) {
  const instante = (hhmm) => {
    // "2026-10-15" + "20:00" no fuso da pessoa -> Date, pelo deslocamento medido com o próprio localDe
    const alvo = new Date(`${dia}T${hhmm}:00Z`);
    const l = localDe(alvo, fuso);
    const [h, m] = hhmm.split(':').map(Number);
    const desvio = (Number(l.dia.slice(8, 10)) - Number(dia.slice(8, 10))) * 1440 + (l.hora * 60 - (h * 60 + m));
    return new Date(alvo.getTime() - Math.round(desvio) * 60000);
  };
  return (eventos || [])
    .filter((e) => e?.dia === dia && /^\d{2}:\d{2}$/.test(String(e.hora || '')))
    .map((e) => {
      const ini = instante(e.hora);
      const dur = e.tipo === 'comer_fora' || e.tipo === 'festa' ? 90 : 60;
      return { titulo: `${e.titulo || 'evento'} (marcado no app)`, tipo: `app ${NOME_EVENTO[e.tipo] || 'compromisso'}`, inicio: ini.toISOString(), fim: new Date(ini.getTime() + dur * 60000).toISOString() };
    });
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
      // lugares (localização do app Relógio): só de quem ligou no celular; só entra na conversa com a própria pessoa
      const lg = p.lugaresAtivo ? await contextoLugares(p).catch(() => null) : null;
      // roteiro provável de hoje: padrão de lugares no dia da semana + agenda de hoje + treino já feito (relógio), com janelas apertadas
      let roteiro = '';
      // fase 7: eventos que a pessoa marcou no app pra hoje (comer fora, festa, viagem...): entram no roteiro e a cobrança
      // pula a refeição que eles tiram de casa (cobranca.js)
      let eventosApp = [];
      try {
        const fuso = fusoDe(p);
        const agoraLocal = localDe(new Date(), fuso);
        const agendaHoje = (ag?.lista || []).filter((e) => localDe(e.inicio, fuso).dia === agoraLocal.dia);
        const rel = p.relogio ? await situacaoRelogio(p, agoraLocal.dia).catch(() => null) : null;
        const fixas = atividadesComoAgenda(p, { dia: agoraLocal.dia, dow: agoraLocal.dow, fuso });
        const visitasHoje = p.lugaresAtivo ? await visitasDeHoje(p, agoraLocal.dia).catch(() => []) : [];
        eventosApp = p.jids?.length ? await eventosDe(p.jids, agoraLocal.dia, agoraLocal.dia).catch(() => []) : [];
        const doApp = eventosComoAgenda(eventosApp, { dia: agoraLocal.dia, fuso });
        roteiro = roteiroDoDia({ lugares: p.lugares || [], agenda: [...agendaHoje, ...fixas, ...doApp], treinos: rel?.treinosHoje || [], dow: agoraLocal.dow, fuso, horaAgora: agoraLocal.hora, dia: agoraLocal.dia, situacao: lg?.situacao || null, visitasHoje });
      } catch (e) {
        console.warn('[perfis] roteiro:', e.message);
      }
      let atividadesBloco = '';
      let treinoHoje = '';
      try {
        const al = localDe(new Date(), fusoDe(p));
        atividadesBloco = blocoAtividades(p, { dia: al.dia, dow: al.dow });
        // pré e pós-treino de hoje calculados em código (café das 8h29 depois da Garra das 7h06 É o pós-treino)
        treinoHoje = await blocoTreinoRefeicoes(p, al.dia, { rel: p.relogio ? await situacaoRelogio(p, al.dia).catch(() => null) : null }).catch(() => '');
      } catch {}
      return { ...p, horarios: descreverHorarios(hab), _hab: hab, _refs: refs, treino: t?.linha || null, _treino: t, _agenda: ag, _lugares: lg, _roteiro: roteiro, _atividades: atividadesBloco, _treinoHoje: treinoHoje, _eventosApp: eventosApp };
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
  const gen = str(a.genero)?.toLowerCase();
  if (gen && /^(masculino|feminino|outro)$/.test(gen)) set('genero', gen);
  // meta com prazo ("quero chegar a 80 kg até março"): vira projeção no resumo de domingo
  const meta = num(a.meta_peso_kg ?? a.meta_peso);
  if (meta && meta > 25 && meta < 400) set('metaPeso', meta);
  const prazo = str(a.meta_prazo);
  if (prazo && /^\d{4}-\d{2}(-\d{2})?$/.test(prazo)) set('metaPrazo', prazo.length === 7 ? `${prazo}-28` : prazo);
  // "o mais rápido possível" / "devagar" = ritmo preferido dentro do saudável; "sem teto" = a meta é etapa, não limite
  const ritmo = str(a.ritmo)?.toLowerCase();
  if (ritmo && /^(maximo|máximo|medio|médio|minimo|mínimo)$/.test(ritmo)) set('ritmo', ritmo.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const biotipo = str(a.biotipo)?.toLowerCase();
  if (biotipo && /^(ectomorfo|mesomorfo|endomorfo)$/.test(biotipo)) set('biotipo', biotipo);
  const modo = str(a.meta_modo)?.toLowerCase();
  if (modo && /^(etapa|final)$/.test(modo)) set('metaModo', modo);
  if (a.sem_meta_peso === true) {
    novo.metaPeso = null;
    novo.metaPrazo = null;
    novo.atualizacoes.metaPeso = dia;
  }
  // só o prazo sai (app: "sem prazo"); a meta de peso fica
  if (a.sem_meta_prazo === true && a.sem_meta_peso !== true && perfil.metaPrazo != null) {
    novo.metaPrazo = null;
    novo.atualizacoes.metaPrazo = dia;
  }
  // produto de uso fixo com rótulo lido ("vai ser sempre esse hipercalórico, deixa salvo"): porção e números pra copiar depois
  if (a.produto && typeof a.produto === 'object') {
    const nome = str(a.produto.nome)?.toLowerCase();
    const kcal = num(a.produto.kcal);
    if (nome && kcal && kcal > 0 && kcal < 5000) {
      const item = {
        nome,
        porcao: str(a.produto.porcao) || '1 porção',
        kcal: Math.round(kcal),
        proteina: Math.round(num(a.produto.proteina) || 0),
        carbo: Math.round(num(a.produto.carbo) || 0),
        gordura: Math.round(num(a.produto.gordura) || 0),
        em: dia,
      };
      set('produtos', [...(perfil.produtos || []).filter((p) => p.nome !== nome), item].slice(-10));
    }
  }
  return Object.keys(novo).length > 2 ? novo : null;
}
