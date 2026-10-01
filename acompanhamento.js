// acompanhamento.js - Visão de período de uma pessoa, calculada em código (sem IA): últimos 7 e 30 dias de calorias e
// proteína, evolução do peso e, pra quem tem relógio, o balanço energético (comido x gasto) contra a meta do objetivo.
// Entra no prompt da PESSOA ATUAL, no !hoje, no resumo do dia e na reflexão noturna da Nutri.

import { refeicoesDesde, pesagensDesde } from './mongo.js';
import { visaoPeriodo,  metaBalancoPara, tendenciaGordura } from './resumo.js';
import { linhaDeTendencia } from './previsao.js';
import { diasAnteriores } from './util.js';

const DIAS = 30;

/** Texto pronto (ou '' se a pessoa não tem registro nenhum no período). Nunca lança. */
import { visaoZap } from './resumo.js';

/** formato 'prompt' (padrão, com as dicas pra IA) ou 'zap' (tópicos pro !hoje). */
export async function visaoDe(perfil, dia, { formato = 'prompt' } = {}) {
  if (!perfil?.jids?.length) return '';
  const desde = diasAnteriores(dia, DIAS)[0];
  const [refeicoes, pesagens] = await Promise.all([
    refeicoesDesde(perfil.jids, desde).catch(() => []),
    pesagensDesde(perfil.jids, desde).catch(() => []),
  ]);
  try {
    const params = { refeicoes, pesagens, perfil, dia, gastos: perfil.relogio?.gastos };
    const base = formato === 'zap' ? visaoZap(params) : visaoPeriodo(params);
    // linha de tendência pessoal (bioimpedância) com veredito contra o ritmo alvo: entra em TODA conversa, não só no domingo,
    // pra "como está meu ritmo?" ter resposta na hora e a dica do prato saber se é hora de segurar ou empurrar
    try {
      const pesoAtual = [...pesagens].sort((a, b) => a.dia.localeCompare(b.dia)).pop()?.peso || perfil.peso;
      const faixa = metaBalancoPara({ objetivo: perfil.objetivo, peso: pesoAtual, metaPeso: perfil.metaPeso, metaPrazo: perfil.metaPrazo, dia, ritmo: perfil.ritmo, metaModo: perfil.metaModo, gorduraTend: tendenciaGordura(pesagens) });
      const tend = linhaDeTendencia({ pesagens, perfil, dia, alvoKgSemana: faixa?.ritmoKgSemana ?? null, semanas: 4 });
      if (tend) {
        if (formato === 'zap') return `${base}

*Ritmo real x alvo*
• ${tend.veredito[0].toUpperCase()}${tend.veredito.slice(1)}${tend.magraSem != null ? `
• Massa magra ${tend.magraSem >= 0 ? '+' : '−'}${Math.abs(tend.magraSem).toFixed(2).replace('.', ',')} kg/semana · gordura ${tend.gorduraSem >= 0 ? '+' : '−'}${Math.abs(tend.gorduraSem).toFixed(2).replace('.', ',')} kg/semana` : ''}`;
        return `${base}
${tend.texto}`;
      }
    } catch (e) {
      console.warn('[acompanhamento] tendência:', e.message);
    }
    return base;
  } catch (e) {
    console.error('[acompanhamento]', e.message);
    return '';
  }
}
