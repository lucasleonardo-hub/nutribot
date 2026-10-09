// acompanhamento.js - Visão de período de uma pessoa, calculada em código (sem IA): últimos 7 e 30 dias de calorias e
// proteína, evolução do peso e, pra quem tem relógio, o balanço energético (comido x gasto) contra a meta do objetivo.
// Entra no prompt da PESSOA ATUAL, no !hoje, no resumo do dia e na reflexão noturna da Nutri.
// O PROGRESSO DE PESO (progresso.js: tendência com incerteza, alvo, veredito, comida x balança, alertas) vem junto e é a
// fonte única do veredito do ritmo: o !progresso, o !hoje, o !tendencia e o prompt dizem a mesma coisa.

import { refeicoesDesde, pesagensDesde } from './mongo.js';
import { visaoPeriodo, visaoZap, faixaDaMeta } from './resumo.js';
import { linhaDeTendencia } from './previsao.js';
import { projecaoAteMeta } from './tendencia.js';
import { blocoCalibracao } from './calibracao.js';
import { analisarProgresso } from './progresso.js';
import { diasAnteriores } from './util.js';

// 30 dias FECHADOS (dia−30 a dia−1, a janela do "Últimos 30 dias") + hoje. Com 30, a busca começava em dia−29 e quem
// registra todo dia via "29 de 30 dias" (revisão de 09/10)
const DIAS = 31;

async function dadosDe(perfil, dia) {
  const desde = diasAnteriores(dia, DIAS)[0];
  const [refeicoes, pesagens] = await Promise.all([refeicoesDesde(perfil.jids, desde).catch(() => []), pesagensDesde(perfil.jids, desde).catch(() => [])]);
  return { refeicoes, pesagens };
}

/** Análise de progresso (progresso.js) com os dados do Mongo (30 dias), o gasto do relógio e a faixa da meta. null sem perfil. Nunca lança. */
export async function progressoDe(perfil, dia, dados = null) {
  if (!perfil?.jids?.length) return null;
  try {
    const { refeicoes, pesagens } = dados || (await dadosDe(perfil, dia));
    return analisarProgresso({ perfil, dia, pesagens, refeicoes, gastos: perfil.relogio?.gastos || {}, faixa: faixaDaMeta(perfil, dia, pesagens) });
  } catch (e) {
    console.warn('[progresso]', e.message);
    return null;
  }
}

/**
 * formato 'prompt' (padrão, com as dicas pra IA) ou 'zap' (tópicos pro !hoje). Texto pronto, ou '' se a pessoa não tem
 * registro nenhum no período. Nunca lança. Efeito: deixa a análise em perfil._progresso (a conferência da resposta da IA,
 * em mensagens.js, usa pra barrar texto que contradiz as contas).
 */
export async function visaoDe(perfil, dia, { formato = 'prompt' } = {}) {
  if (!perfil?.jids?.length) return '';
  const { refeicoes, pesagens } = await dadosDe(perfil, dia);
  try {
    const params = { refeicoes, pesagens, perfil, dia, gastos: perfil.relogio?.gastos };
    const base = formato === 'zap' ? visaoZap(params) : visaoPeriodo(params);
    if (!base) return ''; // sem refeição e sem pesagem no período: nada a dizer
    try {
      const faixa = faixaDaMeta(perfil, dia, pesagens);
      const analise = await progressoDe(perfil, dia, { refeicoes, pesagens });
      if (analise) perfil._progresso = analise;
      // projeção até a etapa (30 dias): ritmo pela balança e pela comida, chegada; o veredito é o mesmo da análise
      const proj = projecaoAteMeta({ perfil, dia, pesagens, refeicoes, gastos: perfil.relogio?.gastos || {}, faixa });
      const tend = proj || linhaDeTendencia({ pesagens, perfil, dia, alvoKgSemana: faixa?.ritmoKgSemana ?? null, semanas: 4 });
      if (formato === 'zap') {
        const chegada = proj?.chegada && perfil.metaPeso ? `\n• No ritmo esperado, ${String(perfil.metaPeso).replace('.', ',')} kg por volta de ${proj.chegada.data.slice(8, 10)}/${proj.chegada.data.slice(5, 7)} (!tendencia mostra a projeção)` : '';
        const blocoProgresso = analise?.tendencia?.n ? `${analise.resumoZap}${chegada}` : tend ? `*Ritmo*\n• ${tend.veredito[0].toUpperCase()}${tend.veredito.slice(1)}` : '';
        return blocoProgresso ? `${base}\n\n${blocoProgresso}` : base;
      }
      // a calibração de ENERGIA (viés semanal, média móvel) sai do prompt: o PROGRESSO traz o viés medido agora, com intervalo,
      // e dois números pro mesmo viés confundiam a IA; fica a calibração das estimativas de foto (correções da pessoa)
      const calib = await blocoCalibracao(perfil, { energia: false }).catch(() => '');
      return [base, analise?.tendencia?.n ? analise.texto : '', proj ? proj.textoCurto : tend?.texto || '', calib].filter(Boolean).join('\n');
    } catch (e) {
      console.warn('[acompanhamento] tendência:', e.message);
    }
    return base;
  } catch (e) {
    console.error('[acompanhamento]', e.message);
    return '';
  }
}
