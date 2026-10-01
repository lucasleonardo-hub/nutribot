// previsao.js - "Nesse ritmo, no próximo domingo você está com X kg." Previsão semanal calculada em código (sem IA) e,
// sete dias depois, a conferência do que ela previu contra o que a balança mostrou.
//
// Dois métodos, nessa ordem:
//   1) BALANÇO ENERGÉTICO (melhor): média diária de (calorias comidas − gastas pelo relógio) nos dias COMPLETOS da semana.
//      7.700 kcal ≈ 1 kg de tecido corporal, então delta_kg = média_diária × 7 ÷ 7700.
//   2) TENDÊNCIA DA BALANÇA (quem não tem relógio): regressão linear das pesagens dos últimos 21 dias.
// Sem dados suficientes, não inventa: diz o que falta.
//
// A divisão entre massa magra e gordura é ESTIMATIVA GROSSEIRA, guiada por proteína e treino da semana. Serve pra dar
// direção ("ganho limpo" x "ganho sujo"), não pra valer como bioimpedância.

import { diaCompleto } from './resumo.js';

const KCAL_POR_KG = 7700;
const DIAS_TENDENCIA = 21;

const diasAte = (dia, n) => {
  const base = new Date(`${dia}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
};
export const somarDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const distanciaDias = (a, b) => Math.round(Math.abs(new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400000);
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const kg1 = (n) => `${n.toFixed(1).replace('.', ',')} kg`;
const kg2 = (n) => `${n.toFixed(2).replace('.', ',')} kg`;
const gramas = (n) => `${Math.round(Math.abs(n) * 1000)} g`;
const sinalKg = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2).replace('.', ',')} kg`;
const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Pesagem mais próxima do dia pedido, dentro de `tolerancia` dias. */
export function pesagemPerto(pesagens, dia, tolerancia = 3) {
  const candidatas = (pesagens || []).filter((p) => p.peso && distanciaDias(p.dia, dia) <= tolerancia);
  if (!candidatas.length) return null;
  return candidatas.sort((a, b) => distanciaDias(a.dia, dia) - distanciaDias(b.dia, dia))[0];
}

/** Inclinação (kg/dia) das pesagens por regressão linear. null se tiver poucos pontos ou período curto. */
function tendenciaKgDia(pesagens, minPontos = 4, minDias = 10) {
  const ps = (pesagens || []).filter((p) => p.peso).sort((a, b) => a.dia.localeCompare(b.dia));
  if (ps.length < minPontos) return null;
  const span = distanciaDias(ps[0].dia, ps[ps.length - 1].dia);
  if (span < minDias) return null;
  const x0 = new Date(`${ps[0].dia}T12:00:00Z`).getTime();
  const xs = ps.map((p) => (new Date(`${p.dia}T12:00:00Z`).getTime() - x0) / 86400000);
  const ys = ps.map((p) => p.peso);
  const mx = media(xs);
  const my = media(ys);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : null;
}

/** Parte do ganho (ou da perda) que tende a ser massa magra, pela proteína e pelo treino da semana. */
function fracaoMagra({ ganho, proteinaPorKg, treinos }) {
  const proteinaOk = proteinaPorKg != null && proteinaPorKg >= 1.6;
  const treinou = (treinos || 0) >= 2;
  if (ganho) return proteinaOk && treinou ? 0.45 : proteinaOk || treinou ? 0.3 : 0.2;
  return proteinaOk && treinou ? 0.15 : proteinaOk || treinou ? 0.25 : 0.35; // fração da PERDA que é magra (menor é melhor)
}

/**
 * Previsão para daqui a 7 dias.
 * @param {object} p { perfil, refeicoes (30 dias), pesagens (30 dias), gastos ({dia: kcal}), dia }
 * @returns {object|null} { alvoDia, pesoInicial, deltaKg, pesoPrevisto, base, confianca, magraKg, gorduraKg, texto, detalhes }
 */
export function preverSemana({ perfil = {}, refeicoes = [], pesagens = [], gastos, dia, horizonte = 7 }) {
  const semana = diasAte(dia, 7);
  const porDia = new Map();
  for (const r of refeicoes) {
    if (!semana.includes(r.dia)) continue;
    if (!porDia.has(r.dia)) porDia.set(r.dia, []);
    porDia.get(r.dia).push(r);
  }
  const completos = [...porDia.entries()].filter(([, regs]) => diaCompleto(regs));
  const kcalDe = (regs) => regs.reduce((a, r) => a + (r.estimativa?.kcal || 0), 0);
  const protDe = (regs) => regs.reduce((a, r) => a + (r.estimativa?.p || 0), 0);
  const proteinaPorKg = completos.length && perfil.peso ? media(completos.map(([, regs]) => protDe(regs))) / perfil.peso : null;
  // treinos da semana: Hevy (força, com carga) + o que o relógio registrou de outros esportes, sem duplicar
  const treinos = perfil._treino?.analise?.sessoes != null ? perfil._treino.analise.sessoes + (perfil.relogio?.treinos7d || 0) : (perfil.relogio?.treinos7d ?? null);
  const alvoDia = somarDias(dia, horizonte);
  const ultima = pesagemPerto(pesagens, dia, 3);

  // ---- método 1: balanço energético (precisa do relógio e de dias completos)
  const comOsDois = completos.filter(([d]) => gastos?.[d]);
  let deltaKg = null;
  let base = null;
  let detalhes = '';
  if (comOsDois.length >= 3) {
    const balancos = comOsDois.map(([d, regs]) => kcalDe(regs) - gastos[d]);
    const mediaBalanco = media(balancos);
    deltaKg = (mediaBalanco * 7) / KCAL_POR_KG;
    base = 'balanço energético';
    detalhes =
      `média de ${Math.round(mediaBalanco) > 0 ? '+' : ''}${Math.round(mediaBalanco)} kcal/dia em ${comOsDois.length} dia(s) completo(s) ` +
      `(comido menos gasto do relógio); 7.700 kcal ≈ 1 kg`;
  } else {
    // ---- método 2: tendência da balança
    const inclinacao = tendenciaKgDia(pesagens.filter((p) => diasAte(dia, DIAS_TENDENCIA).includes(p.dia)));
    if (inclinacao != null) {
      deltaKg = inclinacao * 7;
      base = 'tendência da balança';
      detalhes = `tendência das pesagens dos últimos ${DIAS_TENDENCIA} dias (${sinalKg(inclinacao * 7)}/semana)`;
    }
  }

  if (deltaKg == null || !ultima) {
    const falta = [];
    if (!ultima) falta.push('uma pesagem recente (manda o peso no domingo, ou deixa o relógio sincronizar)');
    if (deltaKg == null) falta.push(comOsDois.length ? 'mais dias completos de registro (pelo menos 3 com todas as refeições)' : 'registro completo das refeições e o gasto do dia (relógio) ou pesagens semanais');
    return { alvoDia, semDados: true, texto: `PREVISÃO PRA ${dm(alvoDia)}: ainda não dá pra prever. Falta ${falta.join(' e ')}.` };
  }

  const pesoPrevisto = ultima.peso + deltaKg;
  const ganho = deltaKg > 0;
  const fm = fracaoMagra({ ganho, proteinaPorKg, treinos });
  const magraKg = deltaKg * fm;
  const gorduraKg = deltaKg - magraKg;
  const confianca = base === 'balanço energético' ? (comOsDois.length >= 5 ? 'alta' : 'média') : pesagens.length >= 6 ? 'média' : 'baixa';

  const composicao =
    Math.abs(deltaKg) < 0.05
      ? 'praticamente estável'
      : ganho
        ? `desse ganho, ~${gramas(magraKg)} tendem a ser massa magra e ~${gramas(gorduraKg)} gordura`
        : `dessa perda, ~${gramas(gorduraKg)} tendem a ser gordura e ~${gramas(magraKg)} massa magra`;
  const progresso = perfil._treino?.analise?.progressao || [];
  const sobe = progresso.filter((x) => x.variacao > 0.02).length;
  const carga = progresso.length ? `, carga subindo em ${sobe} de ${progresso.length} exercícios` : '';
  const porQue = `${detalhes}; proteína ${proteinaPorKg ? `${proteinaPorKg.toFixed(1).replace('.', ',')} g/kg` : 'sem dado'}, ${treinos != null ? `${treinos} treino(s) na semana` : 'treinos sem dado'}${carga}`;

  const texto =
    `PREVISÃO PRA ${dm(alvoDia)} (calculada pelo sistema, base: ${base}, confiança ${confianca}): mantido o ritmo desta semana, ` +
    `${sinalKg(deltaKg)} — de ${kg1(ultima.peso)} (${dm(ultima.dia)}) para ~${kg1(pesoPrevisto)}. ${composicao.charAt(0).toUpperCase()}${composicao.slice(1)}. ` +
    `Por quê: ${porQue}. A divisão entre magra e gordura é aproximação, não medida.`;

  return { alvoDia, pesoInicial: ultima.peso, diaInicial: ultima.dia, deltaKg, pesoPrevisto, magraKg, gorduraKg, base, confianca, detalhes: porQue, texto };
}

/**
 * Conferência da previsão feita há 7 dias, contra o que a balança mostrou.
 * @returns {object|null} { previstoKg, realKg, erroKg, acerto, texto }
 */
export function conferirPrevisao({ previsao, pesagens = [], dia }) {
  if (!previsao || previsao.semDados) return null;
  const inicial = pesagemPerto(pesagens, previsao.diaInicial || previsao.feitaEm, 3);
  const final = pesagemPerto(pesagens, dia, 3);
  if (!final) {
    return {
      semPesagem: true,
      texto: `CONFERÊNCIA DA PREVISÃO DE ${dm(previsao.feitaEm)}: eu tinha previsto ~${kg1(previsao.pesoPrevisto)} (${sinalKg(previsao.deltaKg)}) pra hoje, mas não veio pesagem nesta semana, então não dá pra saber se acertei.`,
    };
  }
  const pesoBase = inicial?.peso ?? previsao.pesoInicial;
  const realKg = final.peso - pesoBase;
  const erroKg = realKg - previsao.deltaKg;
  const acerto = Math.abs(erroKg) <= 0.3 ? 'cheio' : Math.abs(erroKg) <= 0.7 ? 'perto' : 'errou';
  const veredito = acerto === 'cheio' ? 'ACERTEI' : acerto === 'perto' ? 'CHEGUEI PERTO' : 'ERREI';
  const direcao = Math.sign(realKg) === Math.sign(previsao.deltaKg) || Math.abs(realKg) < 0.1 ? 'na direção certa' : 'na direção errada';

  // composição real, quando a bioimpedância do relógio gravou gordura nas duas pontas
  let composicaoReal = '';
  if (inicial?.gordura && final.gordura) {
    const magraIni = pesoBase * (1 - inicial.gordura / 100);
    const magraFim = final.peso * (1 - final.gordura / 100);
    composicaoReal = ` Pela bioimpedância do relógio: massa magra ${sinalKg(magraFim - magraIni)} e gordura ${sinalKg(final.peso - magraFim - (pesoBase - magraIni))} (bioimpedância oscila, olhe como tendência). Eu tinha estimado ${sinalKg(previsao.magraKg)} de magra.`;
  }

  const texto =
    `CONFERÊNCIA DA PREVISÃO DE ${dm(previsao.feitaEm)}: eu disse ${sinalKg(previsao.deltaKg)} (chegar a ~${kg1(previsao.pesoPrevisto)}); ` +
    `deu ${sinalKg(realKg)} (${kg1(pesoBase)} em ${dm(inicial?.dia || previsao.diaInicial)} -> ${kg1(final.peso)} em ${dm(final.dia)}). ` +
    `Diferença de ${kg2(Math.abs(erroKg))} pra ${erroKg > 0 ? 'mais' : 'menos'} do que eu previ: ${veredito}, ${direcao}.${composicaoReal}`;

  return { previstoKg: previsao.deltaKg, realKg, erroKg, acerto, pesoFinal: final.peso, texto };
}

// ============================================================
// Ritmo saudável e projeção de meta (números da própria base de conhecimento dela)
//   ganho: 0,25 a 0,5% do peso/semana (Iraki 2019) - mais que isso vira gordura
//   perda: 0,5 a 1% do peso/semana (Helms 2014) - mais que isso derruba músculo e treino
// ============================================================
/**
 * Linha de tendência PESSOAL, pela bioimpedância: média semanal de peso, gordura % e massa magra nas últimas semanas,
 * inclinação (kg/semana) de peso, massa magra e gordura, comparadas com o ritmo alvo (metaBalancoPara) e a faixa saudável.
 * Devolve { semanas: [...], pesoSem, magraSem, gorduraSem, gorduraPpSem, veredito, texto, zap } ou null sem dados.
 */
export function linhaDeTendencia({ pesagens = [], perfil = {}, dia, alvoKgSemana = null, semanas = 6 } = {}) {
  const pts = pesagens.filter((p) => p.peso && p.dia && p.dia <= dia).sort((a, b) => a.dia.localeCompare(b.dia));
  if (pts.length < 4) return null;
  const inicio = somarDias(dia, -(semanas * 7 - 1));
  const recentes = pts.filter((p) => p.dia >= inicio);
  if (recentes.length < 4 || distanciaDias(recentes[0].dia, recentes[recentes.length - 1].dia) < 10) return null;
  // agrupa por semana (7 dias contados de trás pra frente a partir de hoje)
  const porSemana = new Map();
  for (const p of recentes) {
    const idx = Math.floor(distanciaDias(p.dia, dia) / 7); // 0 = semana atual
    const s = porSemana.get(idx) || { peso: [], gordura: [], magra: [] };
    s.peso.push(p.peso);
    if (p.gordura != null) {
      s.gordura.push(Number(p.gordura));
      s.magra.push(p.peso * (1 - Number(p.gordura) / 100));
    }
    porSemana.set(idx, s);
  }
  const linhas = [...porSemana.entries()].sort((a, b) => b[0] - a[0]).map(([idx, s]) => ({ idx, fim: somarDias(dia, -idx * 7), peso: media(s.peso), gordura: s.gordura.length ? media(s.gordura) : null, magra: s.magra.length ? media(s.magra) : null, n: s.peso.length }));
  // inclinações por regressão nos pontos diários (kg/semana; gordura em pontos percentuais/semana)
  const reg = (xs, ys) => {
    if (xs.length < 3) return null;
    const mx = media(xs);
    const my = media(ys);
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
    return (xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den) * 7;
  };
  const x0 = new Date(`${recentes[0].dia}T12:00:00Z`).getTime();
  const xs = recentes.map((p) => (new Date(`${p.dia}T12:00:00Z`).getTime() - x0) / 86400000);
  const pesoSem = reg(xs, recentes.map((p) => p.peso));
  const comG = recentes.filter((p) => p.gordura != null);
  const xg = comG.map((p) => (new Date(`${p.dia}T12:00:00Z`).getTime() - x0) / 86400000);
  const magraSem = comG.length >= 4 ? reg(xg, comG.map((p) => p.peso * (1 - Number(p.gordura) / 100))) : null;
  const gorduraSem = comG.length >= 4 ? reg(xg, comG.map((p) => p.peso * (Number(p.gordura) / 100))) : null;
  const gorduraPpSem = comG.length >= 4 ? reg(xg, comG.map((p) => Number(p.gordura))) : null;
  const pesoAtual = recentes[recentes.length - 1].peso;
  const querGanhar = /hipertrof|ganh|massa|bulk|for[çc]a/i.test(String(perfil.objetivo || ''));
  const querPerder = /emagre|perd|reduz|defin|secar|gordura/i.test(String(perfil.objetivo || '')) && !querGanhar;
  const faixa = faixaSaudavel({ peso: pesoAtual, ganho: querGanhar });
  // veredito contra o alvo (quando há) e a faixa saudável
  let veredito = 'sem direção clara';
  let status = 'neutro';
  if (pesoSem != null) {
    if (querGanhar) {
      if (pesoSem < 0.05) { veredito = 'estagnado: peso não sobe'; status = 'abaixo'; }
      else if (faixa && pesoSem > faixa.max * 1.15) { veredito = `subindo mais rápido que o saudável (${sinalKg(pesoSem)}/semana)${gorduraSem != null && gorduraSem > 0.1 ? ', e a gordura está subindo junto' : gorduraSem != null && gorduraSem <= 0.05 ? ', mas a gordura não subiu: ganho limpo até agora' : ''}`; status = gorduraSem != null && gorduraSem > 0.1 ? 'acima_gordura' : 'acima'; }
      else if (alvoKgSemana != null && pesoSem < alvoKgSemana - 0.12) { veredito = `abaixo do ritmo alvo (${sinalKg(pesoSem)} contra ${sinalKg(alvoKgSemana)}/semana)`; status = 'abaixo'; }
      else { veredito = `no caminho (${sinalKg(pesoSem)}/semana${alvoKgSemana != null ? `, alvo ${sinalKg(alvoKgSemana)}` : ''}${magraSem != null ? `; massa magra ${sinalKg(magraSem)}/semana` : ''})`; status = 'ok'; }
    } else if (querPerder) {
      if (pesoSem > -0.05) { veredito = 'estagnado: peso não cai'; status = 'abaixo'; }
      else if (faixa && pesoSem < faixa.min * 1.15) { veredito = `caindo mais rápido que o saudável (${sinalKg(pesoSem)}/semana)${magraSem != null && magraSem < -0.15 ? ', e está perdendo massa magra' : ''}`; status = 'acima'; }
      else if (alvoKgSemana != null && pesoSem > alvoKgSemana + 0.12) { veredito = `mais devagar que o alvo (${sinalKg(pesoSem)} contra ${sinalKg(alvoKgSemana)}/semana)`; status = 'abaixo'; }
      else { veredito = `no caminho (${sinalKg(pesoSem)}/semana${magraSem != null ? `; massa magra ${sinalKg(magraSem)}/semana` : ''})`; status = 'ok'; }
    } else veredito = `peso ${Math.abs(pesoSem) < 0.1 ? 'estável' : `${sinalKg(pesoSem)}/semana`}`;
  }
  const fmtSem = (l) => `${dm(l.fim)}: ${kg1(l.peso)}${l.gordura != null ? ` · ${l.gordura.toFixed(1).replace('.', ',')}% gordura · ${kg1(l.magra)} magra` : ''} (${l.n} pesagem(ns))`;
  const texto =
    `LINHA DE TENDÊNCIA PESSOAL (bioimpedância do relógio, médias por semana, mais antiga -> mais nova):\n${linhas.map((l) => `- ${fmtSem(l)}`).join('\n')}\n` +
    `Inclinação: peso ${pesoSem != null ? `${sinalKg(pesoSem)}/semana` : '?'}${magraSem != null ? `, massa magra ${sinalKg(magraSem)}/semana, gordura ${sinalKg(gorduraSem)}/semana (${gorduraPpSem > 0 ? '+' : ''}${gorduraPpSem.toFixed(2).replace('.', ',')} pontos/semana)` : ''}.` +
    (alvoKgSemana != null ? ` Ritmo alvo: ${sinalKg(alvoKgSemana)}/semana.` : '') +
    ` VEREDITO: ${veredito}. (Bioimpedância oscila de um dia pro outro; a tendência de semanas é o que vale.)`;
  const zap =
    `📈 *Tendência das últimas ${linhas.length} semanas*\n` +
    linhas.map((l) => `- ${dm(l.fim)}: *${kg1(l.peso)}*${l.gordura != null ? ` · ${l.gordura.toFixed(1).replace('.', ',')}% gordura · ${kg1(l.magra)} de massa magra` : ''}`).join('\n') +
    `\n\n*Ritmo*\n- Peso: ${pesoSem != null ? `${sinalKg(pesoSem)}/semana` : '?'}` +
    (magraSem != null ? `\n- Massa magra: ${sinalKg(magraSem)}/semana\n- Gordura: ${sinalKg(gorduraSem)}/semana` : '') +
    (alvoKgSemana != null ? `\n- Alvo: ${sinalKg(alvoKgSemana)}/semana` : '') +
    `\n\n*Veredito*\n${status === 'ok' ? '✅' : status === 'abaixo' ? '⚠️' : status === 'acima_gordura' ? '🛑' : status === 'acima' ? '⚠️' : '•'} ${veredito[0].toUpperCase()}${veredito.slice(1)}`;
  return { semanas: linhas, pesoSem, magraSem, gorduraSem, gorduraPpSem, alvoKgSemana, veredito, status, texto, zap };
}

export function faixaSaudavel({ peso, ganho }) {
  if (!peso) return null;
  return ganho ? { min: peso * 0.0025, max: peso * 0.005 } : { min: -peso * 0.01, max: -peso * 0.005 };
}

/** O ritmo previsto está dentro da faixa? Devolve texto pronto pro prompt (ou '' sem dados). */
export function avaliarRitmo({ peso, deltaKg, objetivo }) {
  if (!peso || deltaKg == null) return '';
  const querGanhar = /hipertrof|ganh|massa|bulk|for[çc]a/i.test(String(objetivo || ''));
  const querPerder = /emagre|perd|reduz|defin|secar|gordura/i.test(String(objetivo || ''));
  if (!querGanhar && !querPerder) return '';
  const faixa = faixaSaudavel({ peso, ganho: querGanhar });
  const dentro = querGanhar ? deltaKg >= faixa.min && deltaKg <= faixa.max : deltaKg <= faixa.max && deltaKg >= faixa.min;
  const alvo = querGanhar
    ? `${gramas(faixa.min)} a ${gramas(faixa.max)}/semana (0,25 a 0,5% do peso)`
    : `${gramas(faixa.max)} a ${gramas(faixa.min)}/semana (0,5 a 1% do peso)`;
  if (dentro) return `RITMO: ${sinalKg(deltaKg)}/semana está DENTRO da faixa recomendada pra ${querGanhar ? 'ganhar massa' : 'perder gordura'} (${alvo}).`;
  const rapido = querGanhar ? deltaKg > faixa.max : deltaKg < faixa.min;
  const devagar = querGanhar ? deltaKg < faixa.min : deltaKg > faixa.max;
  const excesso = querGanhar ? deltaKg - faixa.max : faixa.min - deltaKg;
  const ajusteDia = Math.round((Math.abs(excesso) * KCAL_POR_KG) / 7 / 10) * 10;
  if (rapido) {
    return (
      `RITMO: ${sinalKg(deltaKg)}/semana está RÁPIDO DEMAIS pra ${querGanhar ? 'ganhar massa' : 'perder gordura'} ` +
      `(o recomendado é ${alvo}). Excesso de ~${gramas(excesso)}/semana, que equivale a ${ajusteDia} kcal/dia ` +
      `${querGanhar ? 'a menos' : 'a mais'} pra cair na faixa. Nesse passo, ${querGanhar ? 'boa parte do ganho vira gordura' : 'começa a ir músculo junto'}.`
    );
  }
  if (devagar) {
    return (
      `RITMO: ${sinalKg(deltaKg)}/semana está LENTO pra ${querGanhar ? 'ganhar massa' : 'perder gordura'} (o recomendado é ${alvo}); ` +
      `faltam ~${gramas(Math.abs(excesso))}/semana, ou seja ${ajusteDia} kcal/dia ${querGanhar ? 'a mais' : 'a menos'}.`
    );
  }
  return '';
}

/**
 * Projeção até a meta (perfil.metaPeso / perfil.metaPrazo) no ritmo atual. Sem meta, projeta a tendência em 1, 3 e 6 meses.
 * @returns {string} texto pro prompt ('' se não der pra projetar)
 */
export function projetarMeta({ perfil = {}, deltaKgSemana, pesoAtual, dia }) {
  if (deltaKgSemana == null || !pesoAtual) return '';
  const emMeses = (m) => somarDias(dia, Math.round(m * 30.4));
  const proj = (m) => pesoAtual + (deltaKgSemana * 30.4 * m) / 7;

  if (!perfil.metaPeso) {
    if (Math.abs(deltaKgSemana) < 0.05) return `PROJEÇÃO: no ritmo atual o peso fica praticamente onde está (${kg1(pesoAtual)}) nos próximos meses. Sem meta de peso combinada.`;
    return (
      `PROJEÇÃO (sem meta combinada): mantido esse ritmo de ${sinalKg(deltaKgSemana)}/semana, ` +
      `em 1 mês ~${kg1(proj(1))}, em 3 meses ~${kg1(proj(3))} e em 6 meses ~${kg1(proj(6))}. ` +
      `Ritmo não se mantém igual por meses (o corpo se ajusta), então trate como direção, não promessa. Se ela quiser uma meta com prazo, pergunte.`
    );
  }

  const falta = perfil.metaPeso - pesoAtual;
  const prazo = perfil.metaPrazo || null;
  if (Math.abs(falta) <= 0.3) return `META: ${kg1(perfil.metaPeso)}${prazo ? ` até ${prazo}` : ''} — praticamente alcançada (está em ${kg1(pesoAtual)}). Hora de decidir o próximo passo (manter, ou virar a chave pra definição).`;

  const partes = [`META: ${kg1(perfil.metaPeso)}${prazo ? ` até ${prazo}` : ''}; faltam ${kg1(Math.abs(falta))} (está em ${kg1(pesoAtual)}).`];
  const mesmaDirecao = Math.sign(falta) === Math.sign(deltaKgSemana);
  if (!mesmaDirecao || Math.abs(deltaKgSemana) < 0.02) {
    partes.push(`No ritmo desta semana (${sinalKg(deltaKgSemana)}/semana) ela NÃO chega: está ${Math.abs(deltaKgSemana) < 0.02 ? 'parada' : 'indo pro lado contrário'}.`);
  } else {
    const semanas = falta / deltaKgSemana;
    const dataNoRitmo = somarDias(dia, Math.round(semanas * 7));
    partes.push(`No ritmo desta semana (${sinalKg(deltaKgSemana)}/semana), chega em ~${Math.round(semanas)} semana(s), por volta de ${dataNoRitmo}.`);
    if (prazo) {
      const semanasAtePrazo = (new Date(`${prazo}T12:00:00Z`) - new Date(`${dia}T12:00:00Z`)) / (86400000 * 7);
      if (semanasAtePrazo > 0) {
        const necessario = falta / semanasAtePrazo;
        const status = dataNoRitmo < prazo ? 'ADIANTADA' : Math.abs(semanas - semanasAtePrazo) <= 2 ? 'NO CRONOGRAMA' : 'ATRASADA';
        partes.push(`Pro prazo (${Math.round(semanasAtePrazo)} semanas), o ritmo necessário é ${sinalKg(necessario)}/semana: está ${status}.`);
        const faixa = faixaSaudavel({ peso: pesoAtual, ganho: falta > 0 });
        if (faixa) {
          const saudavel = falta > 0 ? necessario <= faixa.max : necessario >= faixa.min;
          partes.push(
            saudavel
              ? `Esse ritmo necessário cabe na faixa recomendada, dá pra chegar sem estragar a composição.`
              : `ATENÇÃO: esse ritmo necessário passa da faixa recomendada (${falta > 0 ? `máx. ${gramas(faixa.max)}/semana` : `máx. ${gramas(faixa.min)}/semana de perda`}), então ou estica o prazo, ou aceita que parte vai ser ${falta > 0 ? 'gordura' : 'músculo'}. Diga isso com franqueza.`
          );
        }
      }
    }
  }
  return partes.join(' ');
}
