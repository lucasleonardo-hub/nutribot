// acompanhamento.js - Visão de período de uma pessoa, calculada em código (sem IA): últimos 7 e 30 dias de calorias e
// proteína, evolução do peso e, pra quem tem relógio, o balanço energético (comido x gasto) contra a meta do objetivo.
// Entra no prompt da PESSOA ATUAL, no !hoje, no resumo do dia e na reflexão noturna da Nutri.

import { refeicoesDesde, pesagensDesde } from './mongo.js';
import { visaoPeriodo } from './resumo.js';
import { diasAnteriores } from './util.js';

const DIAS = 30;

/** Texto pronto (ou '' se a pessoa não tem registro nenhum no período). Nunca lança. */
export async function visaoDe(perfil, dia) {
  if (!perfil?.jids?.length) return '';
  const desde = diasAnteriores(dia, DIAS)[0];
  const [refeicoes, pesagens] = await Promise.all([
    refeicoesDesde(perfil.jids, desde).catch(() => []),
    pesagensDesde(perfil.jids, desde).catch(() => []),
  ]);
  try {
    return visaoPeriodo({ refeicoes, pesagens, perfil, dia, gastos: perfil.relogio?.gastos });
  } catch (e) {
    console.error('[acompanhamento]', e.message);
    return '';
  }
}
