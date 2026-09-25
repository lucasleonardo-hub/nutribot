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
  const treinos = perfil.relogio?.treinos7d ?? null;
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
  const porQue = `${detalhes}; proteína ${proteinaPorKg ? `${proteinaPorKg.toFixed(1).replace('.', ',')} g/kg` : 'sem dado'}, ${treinos != null ? `${treinos} treino(s) na semana` : 'treinos sem dado'}`;

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
