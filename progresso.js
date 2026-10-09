// progresso.js - Progresso de peso calculado em código, com critério único e contas que dá pra conferir (sem IA).
//
// Por que existe: até 09/10/2026 cada parte do bot media o progresso de um jeito. A mesma resposta do !hoje dizia "balanço
// +1.113 kcal/dia: ACIMA do alvo" (comida registrada − gasto do relógio, cru) e "um pouco abaixo do ritmo da etapa
// (+0,29 kg/semana contra +0,33): coma +47 kcal" (ritmo da balança MISTURADO com o ritmo que a comida registrada prevê,
// contra o alvo do prazo, enquanto a meta de calorias usava o alvo do ritmo máximo, +0,38). A balança, sozinha, mostrava
// +0,16 kg/semana. Aqui fica a verdade única, em funções puras:
//  1. valida as pesagens (data, faixa possível, libra no meio de quilo, várias no mesmo dia, fora de ordem, saltos);
//  2. mede a tendência do peso no período (regressão linear com intervalo de 95% corrigido pela autocorrelação das pesagens
//     e Theil-Sen como checagem robusta) e só crava a direção quando a incerteza deixa;
//  3. compara com o ritmo alvo, o MESMO de onde sai a meta de calorias (metaBalancoPara), e diz quanto falta por semana e
//     por dia, com a confiança dessa conclusão;
//  4. cruza comida registrada e gasto do relógio no MESMO período das pesagens: o balanço que o registro diz x o balanço que
//     a balança mostra -> viés (kcal/dia) e gasto real implícito -> meta em calorias REGISTRADAS que a balança sustenta;
//  5. aponta as contradições (registro diz superávit e a balança não sobe; subida curta x tendência longa; poucos dados;
//     meta alterada no meio do período) com explicações compatíveis com o SENTIDO do erro;
//  6. escreve o resultado pro prompt (a IA interpreta, não recalcula), pro WhatsApp (!progresso e !hoje) e confere se o texto
//     gerado pela IA contradiz as contas (conferirTextoProgresso).
// Quem busca os dados no Mongo é acompanhamento.js (progressoDe).

import { mediana, pareceConsumo, pareceCorrecao } from './util.js';

export const KCAL_POR_KG = 7700; // régua clássica (tecido misto): ordem de grandeza, não precisão
export const JANELA_DIAS = 28; // período da tendência: 4 semanas terminando hoje
const MIN_PESAGENS = 6; // pra julgar ritmo: 6 pesagens...
const MIN_SPAN_DIAS = 14; // ...cobrindo pelo menos 2 semanas
const MIN_DIAS_COMIDA = 10; // dias completos de comida pra calibrar o gasto pela balança (mesmo piso da meta adaptativa)
const PESO_MIN = 25;
const PESO_MAX = 300;
const LIBRA = 2.20462;
const SALTO_KG_DIA = 2; // mais que isso entre pesagens de dias seguidos é suspeito (digitação, roupa, outra balança)
const ESTAVEL_KG_SEM = 0.1; // intervalo de 95% inteiro dentro de ±0,1 kg/semana = peso estável
const VIES_RUIDO = 250; // kcal/dia de erro normal de foto + relógio: abaixo disso registro e balança "batem"

// ---------- números e datas ----------
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** AAAA-MM-DD de verdade (rejeita 2026-13-01 e 2026-02-30, que o Date "conserta" pra outro dia). */
export const diaValido = (d) => {
  if (!DIA_RE.test(String(d || ''))) return false;
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
};
/** b − a em dias (negativo se b vem antes). */
export const distDias = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
export const somarDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// t de Student bicaudal 95% por graus de liberdade; acima de 30, aproximação (erro < 0,005)
const T95 = [null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const t95 = (gl) => (gl >= 1 && gl <= 30 ? T95[Math.floor(gl)] : gl > 30 ? 1.96 + 2.4 / gl : null);
function erf(x) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
/** Probabilidade normal acumulada. */
export const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
/**
 * Probabilidade acumulada da t de Student com `gl` graus de liberdade (aproximação de Hill, erro < 0,002 com gl ≥ 3). O
 * veredito usa a mesma t do intervalo impresso: com a normal, 6 pesagens davam confiança "alta" com o alvo DENTRO do IC.
 */
export const pT = (t, gl) => (Number.isFinite(gl) && gl >= 1 ? phi(Math.sign(t) * ((8 * gl + 1) / (8 * gl + 3)) * Math.sqrt(gl * Math.log(1 + (t * t) / gl))) : phi(t));

const virgula = (n, casas) => Number(n).toFixed(casas).replace('.', ',');
const dm = (d) => `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}`;
const kg1 = (n) => `${virgula(n, 1)} kg`;
const sinal = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
const kgS = (n, casas = 2) => `${sinal(Math.round(n * 10 ** casas))}${virgula(Math.abs(n), casas)} kg`;
const gDia = (kgSem) => `${sinal(Math.round((kgSem * 1000) / 7))}${Math.round(Math.abs(kgSem * 1000) / 7)} g/dia`;
const kcal = (n) => `${Math.round(n).toLocaleString('pt-BR')} kcal`;
const kcalS = (n) => `${sinal(Math.round(n))}${Math.round(Math.abs(n)).toLocaleString('pt-BR')} kcal`;
const r10 = (n) => Math.round(n / 10) * 10;
const pct = (p) => `${Math.round(p * 100)}%`;
const ic = ([a, b], f = (x) => kgS(x)) => `${f(a)} a ${f(b)}`;

// ---------- estatística ----------
/**
 * Puro. Regressão linear y = a + b·x com erro-padrão da inclinação e intervalo de 95%. Pesagens vizinhas não são
 * independentes (água retida dura dias), então o erro-padrão é inflado por sqrt((1+ρ)/(1−ρ)) e o t usa graus de liberdade
 * efetivos n·(1−ρ)/(1+ρ) − 2 (piso 8, teto n − 2). ρ = autocorrelação dos resíduos em sequência, com o viés de amostra
 * curta corrigido (+(2 + 6ρ)/n), entre 0 e 0,85. Medido por simulação (ruído AR(1), σ 0,5 kg, 28 pesagens diárias, 1.500
 * séries por caso): o "IC 95%" cobria 87% com ρ real 0,5 e 81% com 0,7; corrigido, 93% e 89% (com ruído independente, 97%;
 * com ρ 0,3, 94%). null com < 3 pontos.
 */
export function regressao(xs, ys) {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const mx = media(xs);
  const my = media(ys);
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!(sxx > 0)) return null;
  const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  const a = my - b * mx;
  const res = ys.map((y, i) => y - (a + b * xs[i]));
  const s2 = res.reduce((s, r) => s + r * r, 0) / (n - 2);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += res[i] ** 2;
    if (i) num += res[i] * res[i - 1];
  }
  const r1 = den > 0 ? num / den : 0;
  const rho = Math.min(0.85, Math.max(0, r1 + (2 + 6 * Math.max(0, r1)) / n));
  const se = Math.sqrt(s2 / sxx) * Math.sqrt((1 + rho) / (1 - rho));
  const gl = Math.max(1, Math.min(n - 2, Math.max(8, (n * (1 - rho)) / (1 + rho) - 2)));
  const t = t95(gl);
  return { n, a, b, se, gl, ic: [b - t * se, b + t * se], dp: Math.sqrt(s2), rho };
}

/** Puro. Theil-Sen: mediana das inclinações de todos os pares (resiste a pesagens extremas). null com < 2 pontos distintos. */
export function theilSen(xs, ys) {
  const s = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) s.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  if (!s.length) return null;
  s.sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// ---------- 1. pesagens ----------
/**
 * Puro. Limpa as pesagens antes de qualquer conta: descarta data inválida ou futura, peso fora de 25–300 kg e valor que
 * parece libra no meio de quilos (~2,2x a mediana); junta as várias do mesmo dia numa só (média, com aviso se diferem mais de
 * 1 kg) e ordena por data. Salto grande entre pesagens próximas é avisado, não descartado (a tendência robusta decide).
 * @returns {{ pontos: {dia, peso, gordura, n}[], descartadas: {dia, peso, motivo}[], avisos: string[] }}
 */
export function validarPesagens(pesagens = [], { dia = null } = {}) {
  const descartadas = [];
  const brutos = [];
  for (const p of pesagens || []) {
    const d = String(p?.dia || '');
    const peso = Number(p?.peso);
    if (!diaValido(d)) descartadas.push({ dia: d || '?', peso: p?.peso ?? null, motivo: 'data inválida' });
    else if (dia && d > dia) descartadas.push({ dia: d, peso: p?.peso ?? null, motivo: 'data no futuro' });
    else if (!Number.isFinite(peso) || peso < PESO_MIN || peso > PESO_MAX) descartadas.push({ dia: d, peso: p?.peso ?? null, motivo: 'peso fora do possível' });
    else {
      const g = Number(p?.gordura);
      brutos.push({ dia: d, peso, gordura: p?.gordura != null && Number.isFinite(g) && g > 2 && g < 70 ? g : null, fonte: p?.fonte || null });
    }
  }
  const med = brutos.length >= 3 ? mediana(brutos.map((b) => b.peso)) : null;
  const validos = [];
  for (const b of brutos) {
    if (med && Math.abs(b.peso / med - LIBRA) < 0.25) descartadas.push({ dia: b.dia, peso: b.peso, motivo: `parece libra (${virgula(b.peso / LIBRA, 1)} kg?)` });
    else validos.push(b);
  }
  // fora da curva: 3 kg (ou 4%) longe da mediana dos dias vizinhos (±7 dias, 3+ pesagens) não é oscilação de água, é
  // outra pessoa na balança ou erro de digitação; sai da conta com o motivo dito
  const limpos = validos.filter((b) => {
    const viz = validos.filter((o) => o !== b && o.dia !== b.dia && Math.abs(distDias(o.dia, b.dia)) <= 7).map((o) => o.peso);
    if (viz.length < 3) return true;
    const m = mediana(viz);
    if (Math.abs(b.peso - m) <= Math.max(3, m * 0.04)) return true;
    descartadas.push({ dia: b.dia, peso: b.peso, motivo: `fora da curva: ~${virgula(m, 1)} kg nos dias vizinhos (outra pessoa na balança? erro de digitação?)` });
    return false;
  });
  const porDia = new Map();
  for (const b of limpos) {
    if (!porDia.has(b.dia)) porDia.set(b.dia, []);
    porDia.get(b.dia).push(b);
  }
  const avisos = [];
  const pontos = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, todas]) => {
      // no dia em que o relógio pesou, a pesagem digitada (de roupa, outra balança, outro horário) não entra: a tendência
      // precisa do mesmo instrumento; antes as duas viravam pontos do mesmo dia (às vezes com jids diferentes)
      const doRelogio = todas.filter((x) => x.fonte === 'relogio');
      const lista = doRelogio.length && doRelogio.length < todas.length ? doRelogio : todas;
      if (lista !== todas) avisos.push(`em ${dm(d)} a pesagem digitada (${todas.filter((x) => x.fonte !== 'relogio').map((x) => virgula(x.peso, 1)).join(', ')} kg) ficou de fora: vale a do relógio (${lista.map((x) => virgula(x.peso, 1)).join(', ')} kg)`);
      const pesos = lista.map((x) => x.peso);
      const gs = lista.map((x) => x.gordura).filter((x) => x != null);
      if (lista.length > 1 && Math.max(...pesos) - Math.min(...pesos) > 1) avisos.push(`${lista.length} pesagens em ${dm(d)} diferindo ${virgula(Math.max(...pesos) - Math.min(...pesos), 1)} kg (horários ou balanças diferentes?): usei a média`);
      return { dia: d, peso: media(pesos), gordura: gs.length ? media(gs) : null, n: lista.length };
    });
  for (let i = 1; i < pontos.length; i++) {
    const dd = distDias(pontos[i - 1].dia, pontos[i].dia);
    const dp = pontos[i].peso - pontos[i - 1].peso;
    if (dd <= 3 && Math.abs(dp) > SALTO_KG_DIA * dd) avisos.push(`salto de ${kgS(dp, 1)} entre ${dm(pontos[i - 1].dia)} e ${dm(pontos[i].dia)} (erro de pesagem ou de digitação?)`);
  }
  return { pontos, descartadas, avisos };
}

/**
 * Puro. Entre duas medições do MESMO dia, qual vale pra série: a da fonte preferida (Samsung Health) vence outra; depois,
 * a da manhã (04h às 11h) vence a de outro horário; empatando, a mais cedo. A tendência precisa de pesagens comparáveis
 * (de manhã, antes de comer): depois de comer e beber o peso sobe 0,5 a 1,5 kg, e "a última do dia" (o que o app e a
 * planilha guardavam até 09/10) misturava pesagem das 22h com as das 7h, rotuladas como "medição da manhã".
 */
export function preferirPesagem(atual, nova, ehPreferida = () => false) {
  if (!atual) return nova;
  if (!nova) return atual;
  const pa = Boolean(ehPreferida(atual.fonte));
  const pn = Boolean(ehPreferida(nova.fonte));
  if (pa !== pn) return pa ? atual : nova;
  const manha = (h) => typeof h === 'string' && h >= '04:00' && h < '11:00';
  const ma = manha(atual.hora);
  const mn = manha(nova.hora);
  if (ma !== mn) return ma ? atual : nova;
  if (!atual.hora || !nova.hora) return atual.hora ? atual : nova;
  return nova.hora < atual.hora ? nova : atual;
}

// ---------- 2. tendência ----------
/** Texto da direção de uma tendência (tendenciaPeso). */
export function descreverDirecao(t) {
  if (!t?.suficiente) return `sem base pra tendência (${t?.motivo || 'sem pesagens'})`;
  const v = `${kgS(t.kgSemana)}/semana`;
  if (t.direcao === 'subindo') return `subindo (${v})`;
  if (t.direcao === 'caindo') return `caindo (${v})`;
  if (t.direcao === 'estavel') return `estável (${v})`;
  if (t.kgSemana >= 0.05) return `sem direção firme: provavelmente subindo devagar (${v}), mas a incerteza inclui zero`;
  if (t.kgSemana <= -0.05) return `sem direção firme: provavelmente caindo devagar (${v}), mas a incerteza inclui zero`;
  return `praticamente parado (${v}), com incerteza larga`;
}

/**
 * Puro. Tendência do peso entre `inicio` e `fim` (padrão: os 28 dias terminando em `dia`): regressão linear (kg/semana,
 * erro-padrão e intervalo de 95%), Theil-Sen, desvio dos resíduos, peso de tendência no início e no fim, médias da primeira
 * e da última semana, e a direção: 'subindo'/'caindo' só se o intervalo inteiro estiver de um lado do zero, 'estavel' só se
 * o intervalo for estreito e perto do zero, 'indefinida' no resto e 'insuficiente' sem pesagens bastantes.
 */
export function tendenciaPeso(pontos = [], { dia = null, inicio = null, fim = null, janelaDias = JANELA_DIAS, minPesagens = MIN_PESAGENS, minSpan = MIN_SPAN_DIAS } = {}) {
  const ate = fim || dia || pontos[pontos.length - 1]?.dia;
  const de = inicio || (ate ? somarDias(ate, -(janelaDias - 1)) : null);
  const sel = ate ? pontos.filter((p) => p.dia >= de && p.dia <= ate) : [];
  // primeira/última e variação existem com 1+ pesagem (os textos usam mesmo quando não há tendência: 1 ou 2 pesagens)
  const base = {
    janela: { de, ate },
    n: sel.length,
    inicio: sel[0]?.dia ?? null,
    fim: sel[sel.length - 1]?.dia ?? null,
    suficiente: false,
    direcao: 'insuficiente',
    primeiro: sel[0] || null,
    ultimo: sel[sel.length - 1] || null,
    variacao: sel.length >= 2 ? sel[sel.length - 1].peso - sel[0].peso : null,
    mediaInicio: null,
    mediaFim: null,
  };
  const precisa = `precisa de ${minPesagens}+ pesagens cobrindo ${minSpan}+ dias${minPesagens > 4 ? ' (ou 4+ cobrindo 21+ dias, pra quem pesa uma vez por semana)' : ''}`;
  if (sel.length < 3) return { ...base, motivo: `${sel.length} pesagem(ns) entre ${de ? dm(de) : '?'} e ${ate ? dm(ate) : '?'}; ${precisa}` };
  const x0 = sel[0].dia;
  const xs = sel.map((p) => distDias(x0, p.dia));
  const ys = sel.map((p) => p.peso);
  const reg = regressao(xs, ys);
  if (!reg) return { ...base, motivo: 'pesagens todas no mesmo dia' };
  const span = xs[xs.length - 1];
  // pesagem semanal (o protocolo do bot pra quem não tem relógio: domingo) também vale: 4 pesagens cobrindo 3+ semanas;
  // o intervalo de confiança largo e a t com poucos graus de liberdade já seguram a confiança do veredito
  const suficiente = span >= minSpan && (sel.length >= minPesagens || (sel.length >= 4 && span >= 21));
  const kgSemana = reg.b * 7;
  const seKgSemana = reg.se * 7;
  const ic95 = reg.ic.map((v) => v * 7);
  const ts = theilSen(xs, ys);
  const theilSenKgSemana = ts == null ? null : ts * 7;
  // estável = o intervalo INTEIRO cabe em ±0,1 kg/semana (teste de equivalência): −0,03 kg/semana com intervalo estreito é
  // "significativo" mas é peso parado; só fora disso a direção vale, e só se o intervalo não cruzar o zero
  const direcao = !suficiente ? 'insuficiente' : ic95[0] >= -ESTAVEL_KG_SEM && ic95[1] <= ESTAVEL_KG_SEM ? 'estavel' : ic95[0] > 0 ? 'subindo' : ic95[1] < 0 ? 'caindo' : 'indefinida';
  const ultimo = sel[sel.length - 1];
  const primeiraSemana = sel.filter((p) => distDias(x0, p.dia) <= 6).map((p) => p.peso);
  const ultimaSemana = sel.filter((p) => distDias(p.dia, ultimo.dia) <= 6).map((p) => p.peso);
  return {
    ...base,
    suficiente,
    motivo: suficiente ? null : `${sel.length} pesagem(ns) em ${span + 1} dia(s); ${precisa}`,
    span,
    kgSemana,
    seKgSemana,
    ic95,
    theilSenKgSemana,
    robustoConcorda: theilSenKgSemana == null || Math.abs(theilSenKgSemana - kgSemana) <= Math.max(0.1, seKgSemana),
    dpResiduo: reg.dp,
    rho: reg.rho,
    gl: reg.gl,
    primeiro: sel[0],
    ultimo,
    variacao: ultimo.peso - sel[0].peso,
    mediaInicio: media(primeiraSemana),
    mediaFim: media(ultimaSemana),
    pesoTendenciaInicio: reg.a,
    pesoTendenciaFim: reg.a + reg.b * distDias(x0, ate),
    direcao,
  };
}

/**
 * Puro. Subida ou queda curta (últimos 7 dias) que a tendência longa não explica: diferença entre a primeira e a última
 * pesagem da semana contra o que o ritmo previa no mesmo intervalo, fora do ruído. O ritmo e o ruído vêm das pesagens de
 * ANTES da semana (senão a própria subida entra na régua), e o limiar é ~2 desvios da diferença entre duas pesagens
 * (1,96·√2·dp, mínimo 0,6 kg). Com 1,5 dp e a régua da janela inteira, o alerta saía em ~30% dos dias sem evento nenhum;
 * agora em ~6% (ruído independente) a ~12% (autocorrelação 0,5), e um salto de 1,5 kg em 3 dias com σ 0,3 é pego em ~95%
 * (simulação, 600 e 300 séries). null se não houver nada fora do normal.
 */
export function oscilacaoCurta(pontos = [], tend = null, { dia } = {}) {
  if (!tend?.suficiente || !dia) return null;
  const ult = pontos.filter((p) => p.dia <= dia && distDias(p.dia, dia) <= 6);
  if (ult.length < 3) return null;
  const dias = distDias(ult[0].dia, ult[ult.length - 1].dia);
  if (dias < 3) return null;
  const variacao = ult[ult.length - 1].peso - ult[0].peso;
  const antes = tendenciaPeso(pontos, { inicio: tend.janela.de, fim: somarDias(dia, -7), minPesagens: 5, minSpan: 10 });
  const ref = antes.suficiente ? antes : tend;
  const esperada = (ref.kgSemana * dias) / 7;
  if (Math.abs(variacao - esperada) < Math.max(0.6, 1.96 * Math.SQRT2 * (ref.dpResiduo || 0))) return null;
  return { de: ult[0], ate: ult[ult.length - 1], dias, variacao, esperada, sentido: variacao > 0 ? 'subiu' : 'caiu' };
}

// ---------- 3. comida e energia ----------
/**
 * Puro. Comida por dia FECHADO (antes de `dia`) dentro de [de, ate]: soma das estimativas, nº de registros e se o dia está
 * completo. Critério único de dia completo (o mesmo da linha de tendência): 2+ registros com estimativa, 500+ kcal e pelo
 * menos 65% da mediana diária da pessoa no período (ou de `medianaRef`, quando quem chama mostra uma janela curta mas julga
 * pela mediana dos 28 dias). Um almoço esquecido não pode passar por "comeu pouco".
 */
export function diasDeComida(refeicoes = [], { dia = null, de = null, ate = null, medianaRef = null } = {}) {
  const porDia = new Map();
  for (const r of refeicoes || []) {
    const d = r?.dia;
    const k = Number(r?.estimativa?.kcal ?? r?.kcal);
    if (!diaValido(d) || (dia && d >= dia) || (de && d < de) || (ate && d > ate) || !(k > 0)) continue;
    const x = porDia.get(d) || { dia: d, kcal: 0, p: 0, n: 0 };
    x.kcal += k;
    x.p += Number(r?.estimativa?.p) || 0;
    x.n += 1;
    porDia.set(d, x);
  }
  const dias = [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  const med = medianaRef ?? mediana(dias.filter((x) => x.n >= 2).map((x) => x.kcal));
  for (const x of dias) x.completo = x.n >= 2 && x.kcal >= 500 && (med == null || x.kcal >= med * 0.65);
  return { dias, completos: dias.filter((x) => x.completo), incompletos: dias.filter((x) => !x.completo), mediana: med };
}

/**
 * Puro. O que a balança diz sobre o registro no período em que há os dois: tendência do peso nas pesagens entre o 1º dia
 * completo de comida e o dia seguinte ao último (a pesagem da manhã seguinte fecha o dia), balanço que essa tendência
 * implica (kcal/dia), gasto real implícito (ingestão média − balanço pela balança) e viés do registro (comida − relógio)
 * contra a balança, todos com intervalo de 95%. null com menos de 10 dias completos; { insuficiente } sem pesagens bastantes.
 */
// pesagens bastantes = a MESMA regra do veredito (6 cobrindo 14 dias, ou 4 cobrindo 21): com 4 em 7 dias a calibração
// dava "meta pela balança" e "comida acima" no mesmo !progresso que dizia "ainda não dá pra julgar o ritmo" (revisão de 09/10)
export function calibrarEnergia({ pontos = [], completos = [], gastos = {}, minPesagens = MIN_PESAGENS, minSpan = MIN_SPAN_DIAS } = {}) {
  if (completos.length < MIN_DIAS_COMIDA) return null;
  const de = completos[0].dia;
  const ate = somarDias(completos[completos.length - 1].dia, 1);
  const ingestao = media(completos.map((c) => c.kcal));
  const t = tendenciaPeso(pontos, { inicio: de, fim: ate, minPesagens, minSpan });
  if (!t.suficiente) return { de, ate, dias: completos.length, ingestao, insuficiente: true, motivo: t.motivo, tendencia: t };
  const porKgSem = KCAL_POR_KG / 7;
  const balancoBalanca = t.kgSemana * porKgSem;
  const icBalanca = t.ic95.map((v) => v * porKgSem);
  const comGasto = completos.filter((c) => Number(gastos?.[c.dia]) > 800);
  const temRelogio = comGasto.length >= Math.max(5, Math.ceil(completos.length * 0.6));
  const gastoRelogio = temRelogio ? media(comGasto.map((c) => Number(gastos[c.dia]))) : null;
  const balancoRegistrado = temRelogio ? media(comGasto.map((c) => c.kcal - Number(gastos[c.dia]))) : null;
  const vies = balancoRegistrado != null ? balancoRegistrado - balancoBalanca : null;
  return {
    de,
    ate,
    dias: completos.length,
    diasComRelogio: comGasto.length,
    ingestao,
    tendencia: t,
    balancoBalanca,
    icBalanca,
    gastoReal: ingestao - balancoBalanca,
    icGasto: [ingestao - icBalanca[1], ingestao - icBalanca[0]],
    gastoRelogio,
    balancoRegistrado,
    ritmoPeloRegistro: balancoRegistrado != null ? (balancoRegistrado * 7) / KCAL_POR_KG : null,
    vies,
    icVies: vies != null ? [balancoRegistrado - icBalanca[1], balancoRegistrado - icBalanca[0]] : null,
  };
}

// ---------- 4. alvo e veredito ----------
/** +1 ganhar, −1 perder, 0 manter/sem objetivo. A faixa da meta manda (sinal do ritmo); sem ela, o texto do objetivo. */
export function direcaoDoObjetivo(objetivo, faixa = null) {
  const r = Number(faixa?.ritmoKgSemana);
  if (Number.isFinite(r) && r !== 0) return Math.sign(r);
  if (faixa?.fase === 'manutencao') return 0;
  const o = String(objetivo || '');
  if (/hipertrof|ganh|massa|bulk|engord|for[çc]a/i.test(o)) return 1;
  if (/emagre|perd|reduz|defin|secar|cutting|gordura/i.test(o)) return -1;
  return 0;
}
/** Ritmo alvo (kg/semana, com sinal) da faixa da meta; sem ritmo explícito, o centro da faixa de kcal convertido. */
export function alvoKgSemana(faixa, direcao) {
  const r = Number(faixa?.ritmoKgSemana);
  if (Number.isFinite(r)) return r;
  if (!direcao || !faixa || !Number.isFinite(faixa.min) || !Number.isFinite(faixa.max)) return null;
  return (((faixa.min + faixa.max) / 2) * 7) / KCAL_POR_KG;
}

/**
 * Puro. Veredito do ritmo MEDIDO pela balança contra o alvo: 'abaixo' | 'no_alvo' | 'acima' | 'neutro' | 'inconclusivo',
 * com a probabilidade de o ritmo real estar do lado dito (normal aproximada com o erro-padrão da tendência) e a confiança
 * ('alta' ≥ 97,5%, 'media' ≥ 80%, 'baixa' abaixo disso). Tolerância: 10% do alvo (mín. 0,03 kg/semana).
 */
export function julgarRitmo({ tend, alvo = null, limite = null, direcao = 0 } = {}) {
  if (!tend?.suficiente) return { status: 'inconclusivo', confianca: null, prob: null, texto: `ainda não dá pra julgar o ritmo: ${tend?.motivo || 'sem pesagens'}` };
  const r = tend.kgSemana;
  const se = Math.max(tend.seKgSemana || 0, 0.02);
  if (!direcao || alvo == null || alvo === 0) return { status: 'neutro', confianca: null, prob: null, texto: `peso ${descreverDirecao(tend)}` };
  const a = direcao * alvo;
  const x = direcao * r;
  const tol = Math.max(0.03, Math.abs(alvo) * 0.1);
  const lim = limite != null ? Math.abs(limite) : null;
  // a MESMA t (mesmos graus de liberdade) do intervalo impresso: "alta" (≥ 97,5%) só quando o alvo fica fora do IC 95%
  const gl = tend.gl ?? (tend.n >= 3 ? tend.n - 2 : Infinity);
  const cdf = (z) => pT(z, gl);
  const confDe = (p) => (p >= 0.975 ? 'alta' : p >= 0.8 ? 'media' : 'baixa');
  const sufixo = (conf, p) => (conf === 'alta' ? '' : conf === 'media' ? `; conclusão provável (${pct(p)}), não certa` : `; ainda incerto (${pct(p)}): mais 1 a 2 semanas de pesagem decidem`);
  const contra = `a balança mostra ${kgS(r)}/semana (${gDia(r)}) contra ${kgS(alvo)}/semana (${gDia(alvo)}) do alvo`;
  if (x < a - tol) {
    const p = cdf((a - x) / se);
    const conf = confDe(p);
    // peso indo pro lado CONTRÁRIO não é "abaixo do ritmo" nem "estagnado": diz que está caindo (ou subindo), com o número
    const contrario = direcao > 0 ? 'o peso está caindo' : 'o peso está subindo';
    const como =
      x <= -0.05 ? (tend.direcao === (direcao > 0 ? 'caindo' : 'subindo') ? `${contrario}, contra o objetivo` : `sem ${direcao > 0 ? 'ganho' : 'perda'}: a balança aponta ${direcao > 0 ? 'queda' : 'alta'}`) : Math.abs(x) < 0.05 ? 'peso parado' : `${direcao > 0 ? 'ganhando' : 'perdendo'} abaixo do ritmo alvo`;
    return { status: 'abaixo', confianca: conf, prob: p, texto: `${como}: ${contra}${sufixo(conf, p)}` };
  }
  if (lim && x > lim * 1.15) {
    const p = cdf((x - lim) / se);
    const conf = confDe(p);
    return { status: 'acima', confianca: conf, prob: p, texto: `${direcao > 0 ? 'subindo' : 'caindo'} mais rápido que o saudável: ${kgS(r)}/semana, teto ${kgS(direcao * lim)}/semana${sufixo(conf, p)}` };
  }
  // "no alvo" afirma que NÃO está abaixo: a confiança é a de estar acima do alvo menos a tolerância (unilateral, como os
  // outros dois). A probabilidade de estar numa faixa estreita (alvo até o teto) quase nunca passava de "baixa", e o
  // !progresso, o !tendencia e a conferência tratavam esse caso cada um de um jeito. Se pode estar rápido demais, diz.
  const p = cdf((x - (a - tol)) / se);
  const pRapido = lim ? cdf((x - lim * 1.15) / se) : 0;
  const conf = confDe(p);
  return {
    status: 'no_alvo',
    confianca: conf,
    prob: p,
    pRapido,
    texto: `no ritmo alvo: ${contra}${sufixo(conf, p)}${pRapido >= 0.2 ? `; pode estar passando do teto saudável (${pct(pRapido)})` : ''}`,
  };
}

/**
 * Puro. O veredito do ritmo num lugar só (o !progresso, o !tendencia, o !hoje e o prompt usam este): tendência das pesagens
 * dos 28 dias até `dia`, direção do objetivo, ritmo alvo da faixa da meta (ou `alvoPadrao` quando não há faixa), teto
 * saudável (0,5% do peso/semana no ganho, 1% na perda, sobre o peso de tendência) e o julgamento.
 */
export function vereditoRitmo({ pontos = [], dia, faixa = null, objetivo = '', pesoPerfil = null, alvoPadrao = null, janelaDias = JANELA_DIAS } = {}) {
  const tend = tendenciaPeso(pontos, { dia, janelaDias });
  const direcao = direcaoDoObjetivo(objetivo, faixa);
  const alvo = direcao ? alvoKgSemana(faixa, direcao) ?? alvoPadrao : null;
  const pesoRef = tend.suficiente ? tend.pesoTendenciaFim : pontos[pontos.length - 1]?.peso ?? (Number(pesoPerfil) || null);
  const limite = pesoRef && direcao ? (direcao > 0 ? pesoRef * 0.005 : -pesoRef * 0.01) : null;
  return { tend, direcao, alvo, limite, veredito: julgarRitmo({ tend, alvo, limite, direcao }) };
}

/**
 * Puro. O critério ÚNICO de "registro e balança não batem" (o alerta do !progresso e a projeção do !tendencia usam este):
 * o ritmo que o registro (comida − relógio) implica fica fora do intervalo de 95% da balança E a diferença passa de ~250
 * kcal/dia (o erro normal de foto + relógio). O viés é sistemático, então não se soma a variância do registro como se
 * fosse ruído: quanto mais ruidosa a balança, mais largo o intervalo dela, e só ele decide.
 */
export function registroDiscordaDaBalanca({ kgSemanaBalanca = null, icBalanca = null, kgSemanaRegistro = null } = {}) {
  if (kgSemanaBalanca == null || kgSemanaRegistro == null || !icBalanca) return false;
  const difKcalDia = ((kgSemanaRegistro - kgSemanaBalanca) * KCAL_POR_KG) / 7;
  return Math.abs(difKcalDia) > VIES_RUIDO && (kgSemanaRegistro < icBalanca[0] || kgSemanaRegistro > icBalanca[1]);
}

/**
 * Puro. A frase de comida da conclusão, coerente com o veredito: o veredito (28 dias) e a meta calibrada (trecho com
 * registro) podem vir de janelas diferentes, e a conclusão nunca manda comer mais quem está acima do ritmo nem segurar quem
 * está abaixo. No sentido do objetivo: comida "falta" (abaixo da meta no ganho, acima no déficit), "ok" ou "sobra".
 */
function conselhoDeComida({ veredito, direcao, metaKcal, ingestaoRecente, situacaoIngestao, naFaixa, energia, tend }) {
  if (!metaKcal || !ingestaoRecente || !situacaoIngestao || !direcao) return '';
  const faixaTxt = `${kcal(metaKcal.min)} a ${kcal(metaKcal.max)}/dia registradas`;
  const semana = `a última semana teve ${kcal(ingestaoRecente.kcal)}/dia`;
  const lado = situacaoIngestao === 'dentro' ? 'ok' : (situacaoIngestao === 'abaixo') === direcao > 0 ? 'falta' : 'sobra';
  const incerta = !naFaixa && lado === 'ok' ? ` (fora da faixa, mas dentro da incerteza dela, ±${kcal(metaKcal.folga)}: mais 1 a 2 semanas de pesagem decidem)` : '';
  const janelas = energia && !energia.insuficiente && tend?.inicio && distDias(tend.inicio, energia.de) >= 5 ? ` As contas olham janelas diferentes (o peso desde ${dm(tend.inicio)}, a comida desde ${dm(energia.de)}).` : '';
  const mais = direcao > 0 ? 'subir' : 'descer';
  if (veredito.status === 'abaixo') {
    if (lado === 'falta') return ` Pra andar no alvo, a balança pede ${faixaTxt}; ${semana} (${kcalS(Math.abs((direcao > 0 ? metaKcal.min : metaKcal.max) - ingestaoRecente.kcal)).replace(/^[+−]/, '')} de diferença até a faixa).`;
    if (lado === 'ok') return ` A comida da última semana (${kcal(ingestaoRecente.kcal)}/dia registradas) já é compatível com o que a balança pede (${faixaTxt})${incerta}: manter e conferir a tendência em 1 a 2 semanas antes de ${mais} mais.`;
    return ` ${semana[0].toUpperCase()}${semana.slice(1)}, além da faixa que a balança pede (${faixaTxt}): se o peso não andar em 1 a 2 semanas, o registro ou o relógio estão descalibrados; não falta ${direcao > 0 ? 'comida' : 'déficit'}.${janelas}`;
  }
  if (veredito.status === 'acima') {
    if (lado === 'sobra') return ` Pra voltar ao ritmo saudável, a balança pede ${faixaTxt}; ${semana}.`;
    return ` Mesmo com a comida ${lado === 'ok' ? 'compatível com a faixa' : 'abaixo da faixa'} (${faixaTxt}; ${semana}), o peso andou rápido demais: não aumente; segure e confira em 1 a 2 semanas.${janelas}`;
  }
  // no alvo: manter; se a comida parece fora da faixa, é a outra janela ou a incerteza, não motivo pra mexer
  return lado === 'ok' ? ` Comida compatível com a faixa (${faixaTxt}): manter.` : ` Manter o que vem dando certo; a comida da última semana (${kcal(ingestaoRecente.kcal)}) ficou ${lado === 'falta' ? 'abaixo' : 'acima'} da faixa calculada (${faixaTxt}), mas o ritmo está no alvo.${janelas}`;
}

// ---------- 5. análise completa ----------
/**
 * Puro. Análise de progresso de uma pessoa em `dia`. `faixa` = metaBalancoPara(...) (ritmoKgSemana, min/max kcal/dia de
 * superávit ou déficit); `gastos` = { dia: kcal gastas pelo relógio }. Nunca lança. Campos principais: periodo, pesagens
 * (validação), tendencia, curto, alvo { kgSemana, limite, pesoEsperadoHoje, desvioKg }, veredito, comida, energia,
 * metaKcal, ingestaoRecente, alertas [{ tipo, texto }], limitacoes, conclusao, texto (prompt), zap (!progresso),
 * resumoZap (!hoje), vereditoCurto.
 */
export function analisarProgresso({ perfil = {}, dia, pesagens = [], refeicoes = [], gastos = {}, faixa = null, janelaDias = JANELA_DIAS } = {}) {
  const val = validarPesagens(pesagens, { dia });
  const { tend, direcao, alvo, limite, veredito } = vereditoRitmo({ pontos: val.pontos, dia, faixa, objetivo: perfil.objetivo, pesoPerfil: perfil.peso, janelaDias });
  const curto = oscilacaoCurta(val.pontos, tend, { dia });
  const pesoEsperadoHoje = tend.suficiente && alvo != null ? tend.pesoTendenciaInicio + (alvo * distDias(tend.inicio, dia)) / 7 : null;
  const desvioKg = pesoEsperadoHoje != null ? tend.pesoTendenciaFim - pesoEsperadoHoje : null;

  // comida: os 28 dias fechados antes de hoje (mesma janela da meta adaptativa) e os 7 mais recentes
  const comida = diasDeComida(refeicoes, { dia, de: somarDias(dia, -janelaDias) });
  const energia = calibrarEnergia({ pontos: val.pontos, completos: comida.completos, gastos });
  const recentes = comida.completos.filter((c) => distDias(c.dia, dia) <= 7);
  const ingestaoRecente = recentes.length ? { kcal: media(recentes.map((c) => c.kcal)), dias: recentes.length, de: recentes[0].dia, ate: recentes[recentes.length - 1].dia } : null;
  const temFaixa = faixa && Number.isFinite(faixa.min) && Number.isFinite(faixa.max);
  let metaKcal = null;
  // gasto arredondado antes de somar a faixa: a mesma conta da meta adaptativa (resumo.gastoAdaptativo), número idêntico
  if (temFaixa && energia && !energia.insuficiente) metaKcal = { min: r10(Math.round(energia.gastoReal) + faixa.min), max: r10(Math.round(energia.gastoReal) + faixa.max), base: 'balanca', gasto: energia.gastoReal, icGasto: energia.icGasto };
  else if (temFaixa) {
    const g = Object.entries(gastos || {}).filter(([d, k]) => d < dia && d >= somarDias(dia, -janelaDias) && Number(k) > 800).map(([, k]) => Number(k));
    if (g.length >= 7) metaKcal = { min: r10(media(g) + faixa.min), max: r10(media(g) + faixa.max), base: 'relogio', gasto: media(g) };
  }
  // a comida só é "abaixo" ou "acima" da meta fora da incerteza dela: a meta calibrada herda o IC do gasto real (centenas de
  // kcal com poucas semanas), e com margem fixa de 100 kcal ~metade das séries no alvo saíam "abaixo"/"acima" com as mesmas
  // pesagens pras quais o veredito dizia "ainda não dá pra julgar". Dentro da folga mas fora da faixa = "compatível".
  const MARGEM = 100;
  const folga = metaKcal?.icGasto ? Math.max(MARGEM, (metaKcal.icGasto[1] - metaKcal.icGasto[0]) / 2) : MARGEM;
  if (metaKcal) metaKcal.folga = folga;
  const situacaoIngestao = metaKcal && ingestaoRecente ? (ingestaoRecente.kcal < metaKcal.min - folga ? 'abaixo' : ingestaoRecente.kcal > metaKcal.max + folga ? 'acima' : 'dentro') : null;
  const naFaixa = situacaoIngestao === 'dentro' && ingestaoRecente.kcal >= metaKcal.min - MARGEM && ingestaoRecente.kcal <= metaKcal.max + MARGEM;

  // ---- alertas: o que não bate, com a explicação compatível com o sentido do erro
  const alertas = [];
  if (energia && !energia.insuficiente && registroDiscordaDaBalanca({ kgSemanaBalanca: energia.tendencia.kgSemana, icBalanca: energia.tendencia.ic95, kgSemanaRegistro: energia.ritmoPeloRegistro })) {
    const acimaPeloRelogio = temFaixa && direcao > 0 && energia.balancoRegistrado >= faixa.min && veredito.status === 'abaixo';
    const abaixoPeloRelogio = temFaixa && direcao < 0 && energia.balancoRegistrado <= faixa.max && veredito.status === 'abaixo';
    const icAbs = energia.vies > 0 ? energia.icVies : [-energia.icVies[1], -energia.icVies[0]];
    const fatos =
      `pela conta comida registrada − gasto do relógio (${dm(energia.de)} a ${dm(somarDias(energia.ate, -1))}, ${energia.diasComRelogio} dias) o saldo seria ${kcalS(energia.balancoRegistrado)}/dia, o que daria ${kgS(energia.ritmoPeloRegistro)}/semana; ` +
      `a balança no mesmo trecho mostrou ${kgS(energia.tendencia.kgSemana)}/semana (~${kcalS(energia.balancoBalanca)}/dia). Diferença de ~${kcal(Math.abs(energia.vies))}/dia (IC 95% ${ic(icAbs, kcal)})`;
    if (energia.vies > 0) {
      alertas.push({
        tipo: 'registro_acima_da_balanca',
        texto:
          `${acimaPeloRelogio ? 'REGISTRO DIZ SUPERÁVIT, BALANÇA NÃO ACOMPANHA: ' : abaixoPeloRelogio ? 'REGISTRO DIZ DÉFICIT, BALANÇA NÃO ACOMPANHA: ' : 'REGISTRO x BALANÇA: '}${fatos}. ` +
          `Explicações compatíveis: o relógio subestima o gasto (musculação, vôlei e a digestão de muita comida contam pouco) e/ou as calorias estimadas das fotos saem altas; com estes dados não dá pra separar as duas. Refeição esquecida NÃO explica (puxaria pro outro lado). ` +
          `Por isso o julgamento usa a balança e a meta de calorias foi recalibrada por ela${metaKcal?.base === 'balanca' ? ` (${kcal(metaKcal.min)} a ${kcal(metaKcal.max)}/dia, em calorias registradas)` : ''}.`,
      });
    } else {
      alertas.push({
        tipo: 'registro_abaixo_da_balanca',
        texto: `BALANÇA ACIMA DO REGISTRO: ${fatos}. Explicações compatíveis: refeição ou bebida sem registro, porções maiores do que as estimadas, ou o relógio superestimando o gasto. Por isso o julgamento usa a balança${metaKcal?.base === 'balanca' ? ` e a meta de calorias foi recalibrada por ela (${kcal(metaKcal.min)} a ${kcal(metaKcal.max)}/dia, em calorias registradas)` : ''}.`,
      });
    }
  }
  if (curto) {
    alertas.push({
      tipo: 'curto_vs_longo',
      texto: `OSCILAÇÃO CURTA: de ${dm(curto.de.dia)} a ${dm(curto.ate.dia)} o peso ${curto.sentido} ${kgS(Math.abs(curto.variacao), 1).replace(/^[+−]/, '')} (${kg1(curto.de.peso)} -> ${kg1(curto.ate.peso)}), quando a tendência de 4 semanas explicaria ${kgS(curto.esperada, 1)}. Ainda não é tendência: água, sal, carboidrato, creatina e horário da pesagem mexem 0,5 a 1,5 kg em poucos dias; vale se repetir por 1 a 2 semanas.`,
    });
  }
  if (!tend.suficiente) alertas.push({ tipo: 'dados_insuficientes', texto: `POUCAS PESAGENS: ${tend.motivo}. Sem isso, nada de veredito sobre o ritmo.` });
  else if (!tend.robustoConcorda) alertas.push({ tipo: 'tendencia_fragil', texto: `TENDÊNCIA FRÁGIL: a regressão (${kgS(tend.kgSemana)}/semana) e a mediana das inclinações (Theil-Sen, ${kgS(tend.theilSenKgSemana)}/semana) discordam; poucas pesagens extremas estão puxando o resultado.` });
  const mudancas = ['metaPeso', 'metaPrazo', 'objetivo', 'ritmo', 'metaModo'].map((k) => [k, perfil.atualizacoes?.[k]]).filter(([, d]) => diaValido(d) && tend.janela.de && d > tend.janela.de && d <= dia);
  if (mudancas.length && alvo != null && tend.suficiente) {
    const nomes = { metaPeso: 'peso-alvo', metaPrazo: 'prazo', objetivo: 'objetivo', ritmo: 'ritmo', metaModo: 'tipo de meta' };
    alertas.push({ tipo: 'meta_mudou', texto: `META ALTERADA NO PERÍODO: ${mudancas.map(([k, d]) => `${nomes[k]} em ${dm(d)}`).join(', ')}. O alvo comparado é o de hoje (${kgS(alvo)}/semana) pro período inteiro; os dias de antes valiam outra meta.` });
  }
  for (const a of val.avisos) alertas.push({ tipo: 'pesagem_suspeita', texto: `PESAGEM: ${a}.` });
  if (val.descartadas.length) alertas.push({ tipo: 'pesagem_descartada', texto: `PESAGENS DESCARTADAS: ${val.descartadas.map((d) => `${d.dia === '?' ? '?' : dm(d.dia)} ${d.peso ?? '?'} (${d.motivo})`).join('; ')}.` });

  const limitacoes = [
    tend.suficiente ? `a balança oscila ±${virgula(tend.dpResiduo, 1)} kg em torno da tendência de um dia pro outro, então semana isolada engana` : null,
    'calorias são estimativas das fotos e descrições e o gasto é estimativa do relógio; 7.700 kcal por kg é aproximação',
    comida.incompletos.length ? `${comida.incompletos.length} dia(s) com registro incompleto ficaram fora das médias de comida` : null,
    tend.suficiente && tend.span < 21 ? `período curto (${tend.span + 1} dias): a incerteza ainda é grande` : null,
  ].filter(Boolean);

  // ---- conclusão (uma frase direta, sustentada pelos números)
  let conclusao;
  if (!tend.suficiente) conclusao = `Ainda não dá pra dizer se o ritmo está certo: ${tend.motivo}.`;
  else if (veredito.status === 'neutro') conclusao = `O peso está ${descreverDirecao(tend)} no período.`;
  else conclusao = `${veredito.texto[0].toUpperCase()}${veredito.texto.slice(1)}.${conselhoDeComida({ veredito, direcao, metaKcal, ingestaoRecente, situacaoIngestao, naFaixa, energia, tend })}`;

  const analise = { dia, periodo: tend.janela, pesagens: val, tendencia: tend, curto, direcao, alvo: { kgSemana: alvo, limite, pesoEsperadoHoje, desvioKg, rotulo: faixa?.rotulo || null }, veredito, comida, energia, metaKcal, ingestaoRecente, situacaoIngestao, naFaixa, alertas, limitacoes, conclusao };
  analise.vereditoCurto = vereditoCurto(analise);
  analise.texto = textoPrompt(analise);
  analise.zap = textoZap(analise);
  analise.resumoZap = resumoZap(analise);
  return analise;
}

// ---------- 6. textos ----------
/** "dentro", "compatível (±X)", "abaixo" ou "acima" da meta, pra comida da última semana. */
function situacaoTxt(a) {
  if (a.situacaoIngestao !== 'dentro') return a.situacaoIngestao;
  return a.naFaixa ? 'dentro' : `compatível, dentro da incerteza de ±${kcal(a.metaKcal.folga)}`;
}
function linhaTendencia(t) {
  return `${kgS(t.kgSemana)}/semana (${gDia(t.kgSemana)}), IC 95% ${ic(t.ic95)}${t.theilSenKgSemana != null ? `; Theil-Sen ${kgS(t.theilSenKgSemana)}/semana` : ''}`;
}
/** Uma linha: o veredito com os números (pra corrigir texto da IA e pro !hoje). */
export function vereditoCurto(a) {
  if (!a?.tendencia?.suficiente) return `Ritmo: ainda sem base (${a?.tendencia?.motivo || 'sem pesagens'}).`;
  const t = a.tendencia;
  return `Peso de ${dm(t.inicio)} a ${dm(t.fim)} (${t.n} pesagens): ${kgS(t.kgSemana)}/semana, IC 95% ${ic(t.ic95)}${a.alvo.kgSemana != null ? `; alvo ${kgS(a.alvo.kgSemana)}/semana` : ''} -> ${a.veredito.texto}.`;
}

/** Bloco pro PROMPT da IA. */
export function textoPrompt(a) {
  const t = a.tendencia;
  const v = a.pesagens;
  const linhas = ['PROGRESSO DE PESO (calculado pelo sistema a partir das pesagens e dos registros; é a fonte da verdade sobre ritmo e meta: interprete, não recalcule e não conclua além disto):'];
  if (!t.n) {
    linhas.push(`- Sem pesagens nos últimos ${JANELA_DIAS} dias.`);
  } else {
    const extremos = t.n === 1 ? `uma só: ${kg1(t.ultimo.peso)} (${dm(t.ultimo.dia)})` : `primeira ${kg1(t.primeiro.peso)} (${dm(t.primeiro.dia)}), última ${kg1(t.ultimo.peso)} (${dm(t.ultimo.dia)}), variação ${kgS(t.variacao, 1)}`;
    linhas.push(`- Período: ${dm(t.janela.de)} a ${dm(t.janela.ate)}; ${t.n} pesagem(ns) válida(s)${v.descartadas.length ? ` (${v.descartadas.length} descartada(s))` : ''}; ${extremos}${t.mediaInicio != null && t.mediaFim != null ? `; média da 1ª semana ${kg1(t.mediaInicio)} -> da última ${kg1(t.mediaFim)}` : ''}.`);
    if (t.suficiente) {
      linhas.push(`- Tendência (regressão linear nas pesagens, intervalo de 95% já corrigido pela oscilação): ${linhaTendencia(t)}. Direção: ${descreverDirecao(t)}. Peso de tendência hoje ~${kg1(t.pesoTendenciaFim)}.`);
    } else linhas.push(`- Tendência: ${t.motivo}.`);
  }
  if (a.alvo.kgSemana != null) {
    linhas.push(`- Alvo: ${kgS(a.alvo.kgSemana)}/semana (${gDia(a.alvo.kgSemana)}), o mesmo ritmo de onde sai a meta de calorias${a.alvo.rotulo ? ` (${a.alvo.rotulo})` : ''}.${a.alvo.pesoEsperadoHoje != null ? ` Pela linha do alvo, hoje estaria em ~${kg1(a.alvo.pesoEsperadoHoje)}; pela tendência está em ~${kg1(t.pesoTendenciaFim)} (${kgS(a.alvo.desvioKg, 1)}).` : ''}`);
  }
  linhas.push(`- VEREDITO DO RITMO: ${a.veredito.texto}.`);
  const e = a.energia;
  if (e && !e.insuficiente) {
    linhas.push(
      `- Comida x balança (${dm(e.de)} a ${dm(somarDias(e.ate, -1))}, ${e.dias} dias completos): ingestão registrada ${kcal(e.ingestao)}/dia${e.gastoRelogio != null ? `; relógio ${kcal(e.gastoRelogio)}/dia -> saldo pelo registro ${kcalS(e.balancoRegistrado)}/dia` : ''}; balança no mesmo trecho ${kgS(e.tendencia.kgSemana)}/semana -> saldo real ~${kcalS(e.balancoBalanca)}/dia; gasto real implícito ~${kcal(e.gastoReal)}/dia (IC 95% ${ic(e.icGasto, kcal)}).`,
    );
  } else if (e?.insuficiente) linhas.push(`- Comida x balança: ${e.dias} dias completos, mas ${e.motivo} no mesmo trecho.`);
  else linhas.push(`- Comida x balança: menos de ${MIN_DIAS_COMIDA} dias completos de registro nos últimos ${JANELA_DIAS} dias.`);
  if (a.metaKcal) {
    linhas.push(
      `- Meta de calorias ${a.metaKcal.base === 'balanca' ? 'que a balança sustenta (em calorias REGISTRADAS, a mesma régua das fotos)' : 'provisória pelo relógio (ainda sem calibração pela balança)'}: ${kcal(a.metaKcal.min)} a ${kcal(a.metaKcal.max)}/dia.` +
        (a.ingestaoRecente ? ` Últimos ${a.ingestaoRecente.dias} dias completos (${dm(a.ingestaoRecente.de)} a ${dm(a.ingestaoRecente.ate)}): ${kcal(a.ingestaoRecente.kcal)}/dia -> ${situacaoTxt(a)}.` : '') +
        (a.metaKcal.folga > 100 ? ` A meta tem incerteza de ±${kcal(a.metaKcal.folga)} (vem da incerteza da balança): só fora disso a comida é "abaixo" ou "acima".` : ''),
    );
  }
  if (a.alertas.length) linhas.push(`- ALERTAS: ${a.alertas.map((x, i) => `(${i + 1}) ${x.texto}`).join(' ')}`);
  linhas.push(`- LIMITES: ${a.limitacoes.join('; ')}.`);
  linhas.push(`- CONCLUSÃO: ${a.conclusao}`);
  linhas.push(
    '- COMO RESPONDER SOBRE PROGRESSO: diga o período, quantas pesagens, o peso inicial e final, a tendência com a incerteza, o alvo e o veredito; havendo ALERTA, explique o que cada indicador mostra e por que discordam, sem escolher um número no chute; veredito incerto ou poucos dados = não crave. Nunca diga que a pessoa está comendo além do objetivo pelo relógio quando a balança não acompanha o registro.',
  );
  return linhas.join('\n');
}

/** Relatório completo pro WhatsApp (!progresso): dá pra conferir cada conta. */
export function textoZap(a) {
  const t = a.tendencia;
  const v = a.pesagens;
  const partes = [`📏 *Progresso do peso*${t.janela.de ? ` · ${dm(t.janela.de)} a ${dm(t.janela.ate)}` : ''}`];
  if (!t.n) return `${partes[0]}\n\nSem pesagens nos últimos ${JANELA_DIAS} dias. Sobe na balança (ou deixa o relógio sincronizar) que eu monto.`;
  partes.push(
    [
      '*Dados*',
      `• ${t.n} pesagem(ns) válida(s)${v.descartadas.length ? ` · ${v.descartadas.length} descartada(s)` : ''}`,
      t.n === 1 ? `• Uma só: ${kg1(t.ultimo.peso)} (${dm(t.ultimo.dia)})` : `• Primeira: ${kg1(t.primeiro.peso)} (${dm(t.primeiro.dia)}) · última: ${kg1(t.ultimo.peso)} (${dm(t.ultimo.dia)}) · ${kgS(t.variacao, 1)}`,
      t.mediaInicio != null && t.mediaFim != null ? `• Média da 1ª semana: ${kg1(t.mediaInicio)} → da última: ${kg1(t.mediaFim)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (t.suficiente) {
    partes.push(
      [
        '*Tendência* (regressão linear, IC 95%)',
        `• ${kgS(t.kgSemana)}/semana (${gDia(t.kgSemana)}) · IC ${ic(t.ic95)}`,
        t.theilSenKgSemana != null ? `• Checagem robusta (Theil-Sen): ${kgS(t.theilSenKgSemana)}/semana` : null,
        `• Direção: ${descreverDirecao(t)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else partes.push(`*Tendência*\n• ${t.motivo}`);
  if (a.alvo.kgSemana != null) {
    partes.push(
      [
        '*Alvo*',
        `• ${kgS(a.alvo.kgSemana)}/semana (${gDia(a.alvo.kgSemana)})${a.alvo.rotulo ? ` · ${a.alvo.rotulo}` : ''}`,
        a.alvo.pesoEsperadoHoje != null ? `• Pela linha do alvo, hoje: ~${kg1(a.alvo.pesoEsperadoHoje)} · pela tendência: ~${kg1(t.pesoTendenciaFim)} (${kgS(a.alvo.desvioKg, 1)})` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  const icone = { abaixo: '⚠️', acima: '⚠️', no_alvo: '✅', neutro: '•', inconclusivo: '❔' }[a.veredito.status] || '•';
  partes.push(`*Veredito*\n${icone} ${a.veredito.texto[0].toUpperCase()}${a.veredito.texto.slice(1)}`);
  const e = a.energia;
  if (e && !e.insuficiente) {
    partes.push(
      [
        `*Comida x balança* (${dm(e.de)} a ${dm(somarDias(e.ate, -1))}, ${e.dias} dias completos)`,
        `• Comida registrada: ${kcal(e.ingestao)}/dia${e.gastoRelogio != null ? ` · relógio: ${kcal(e.gastoRelogio)}/dia` : ''}`,
        e.balancoRegistrado != null ? `• Pelo registro: ${kcalS(e.balancoRegistrado)}/dia → daria ${kgS(e.ritmoPeloRegistro)}/semana` : null,
        `• Pela balança: ${kgS(e.tendencia.kgSemana)}/semana → ~${kcalS(e.balancoBalanca)}/dia`,
        `• Gasto real implícito: ~${kcal(e.gastoReal)}/dia (IC ${ic(e.icGasto, kcal)})`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (a.metaKcal) {
    partes.push(
      [
        `*Meta de calorias* ${a.metaKcal.base === 'balanca' ? '(em kcal registradas, calibrada pela balança)' : '(provisória, pelo relógio)'}`,
        `• ${kcal(a.metaKcal.min)} a ${kcal(a.metaKcal.max)}/dia`,
        a.ingestaoRecente ? `• Últimos ${a.ingestaoRecente.dias} dias completos: ${kcal(a.ingestaoRecente.kcal)}/dia → ${situacaoTxt(a)}` : null,
        a.metaKcal.folga > 100 ? `• Incerteza da meta: ±${kcal(a.metaKcal.folga)} (vem da incerteza da balança)` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (a.alertas.length) partes.push(`*Alertas*\n${a.alertas.map((x) => `• ${x.texto}`).join('\n')}`);
  partes.push(`*Limites*\n${a.limitacoes.map((l) => `• ${l[0].toUpperCase()}${l.slice(1)}`).join('\n')}`);
  partes.push(`*Conclusão*\n${a.conclusao}`);
  return partes.join('\n\n');
}

/** Poucas linhas pro !hoje. */
export function resumoZap(a) {
  const t = a.tendencia;
  const linhas = [`*Progresso do peso*${t.n ? ` (${dm(t.janela.de)} a ${dm(t.janela.ate)} · ${t.n} ${t.n === 1 ? 'pesagem' : 'pesagens'})` : ''}`];
  if (!t.suficiente) linhas.push(`• ${t.motivo}`);
  else {
    linhas.push(`• Tendência: ${kgS(t.kgSemana)}/semana (IC ${ic(t.ic95)}): ${descreverDirecao(t).replace(/ \([^)]*\)/, '')}`);
    if (a.alvo.kgSemana != null) linhas.push(`• Alvo: ${kgS(a.alvo.kgSemana)}/semana → ${a.veredito.status === 'abaixo' ? 'abaixo' : a.veredito.status === 'acima' ? 'acima do saudável' : a.veredito.status === 'no_alvo' ? 'no alvo ✅' : '?'}${a.veredito.confianca && a.veredito.confianca !== 'alta' && a.veredito.prob != null ? ` (${a.veredito.confianca === 'media' ? 'provável' : 'incerto'}, ${pct(a.veredito.prob)})` : ''}`);
  }
  if (a.metaKcal) linhas.push(`• Meta ${a.metaKcal.base === 'balanca' ? 'pela balança' : 'provisória (relógio)'}: ${kcal(a.metaKcal.min)} a ${kcal(a.metaKcal.max)}/dia${a.ingestaoRecente ? ` · últimos ${a.ingestaoRecente.dias} dias: ${kcal(a.ingestaoRecente.kcal)} (${situacaoTxt(a)})` : ''}`);
  const principais = a.alertas.filter((x) => ['registro_acima_da_balanca', 'registro_abaixo_da_balanca', 'curto_vs_longo'].includes(x.tipo));
  for (const x of principais) linhas.push(`• ⚠️ ${x.tipo === 'curto_vs_longo' ? 'Oscilação curta' : 'Registro x balança não batem'}: ${x.tipo === 'curto_vs_longo' ? `${x.texto.replace(/^OSCILAÇÃO CURTA: /, '').split('. ')[0]}` : `diferença de ~${kcal(Math.abs(a.energia.vies))}/dia; a meta acima já desconta`}`);
  linhas.push('• Contas completas: !progresso');
  return linhas.join('\n');
}

// ---------- 7. pergunta de progresso ----------
// "como está meu progresso?", "tô abaixo do ganho esperado", "qual meu ritmo", "tô ganhando peso?": até 09/10 a pergunta com
// "?" virava "pedido de opinião" (resposta em 1 ou 2 frases, sem período nem número) e, sem "?", papo aleatório (sem nenhum
// dado no prompt). Pergunta de progresso vai pelo caminho completo e com o modo de resposta próprio (gemini.js).
// A 1ª versão (revisão de 09/10) pegava conversa alheia ("o ritmo do trabalho", "a tendência é chover", "parabéns pelo
// progresso, Ale") e deixava passar "meu peso estagnou?" e "quanto eu engordei?". Agora o padrão forte (peso, meta de peso,
// ritmo da etapa, engordar/emagrecer) basta; a palavra genérica (progresso, ritmo, tendência, etapa, no caminho) só conta com
// o corpo na frase ou numa pergunta curta da própria pessoa ("meu progresso?", "tô no caminho certo?").

// \b do JS só conhece ASCII: "est[áa]\b" não casa em "está " e "\bé" casa no meio de "café". B é a fronteira com acento.
const B = '(?:(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}]))';
const rx = (src, flags = 'iu') => new RegExp(src.replaceAll('\\b', B), flags);

const RE_PROGRESSO_FORTE = rx(String.raw`\b(meta de peso|peso (alvo|esperado|ideal)|ritmo (da etapa|de ganho|do ganho|de perda|da perda|alvo)|ritmo\b[^.?!\n]{0,12}\b(abaixo|acima|atrasad[oa]|lento|devagar)|ganho (de peso|de massa|esperado|di[áa]rio|semanal|por semana|mensal)|perda de peso|(ganhando|ganhei|ganhou|ganhamos|perdendo|perdi|perdeu|engordando|engordei|engordou|emagrecendo|emagreci|emagreceu|subi|desci) (de )?(peso|massa|quilos?|kg|\d+([,.]\d+)? ?(kg|quilos?|gramas?))|quant[oa]s? (quilos?|kg|gramas?) (eu )?(j[áa] )?(ganhei|perdi|engordei|emagreci|subi|desci)|quanto (eu )?(j[áa] )?(ganhei|perdi|engordei|emagreci)|(t[ôo]|to|estou|eu) (mesmo |realmente )?(engordando|emagrecendo)|engordei|emagreci|como (est[áa]|t[áa]|anda|vai|ficou|segue) (o |a )?(meu|minha) (peso|ritmo|ganho|progresso|evolu[çc][ãa]o|tend[êe]ncia)|meu ganho|(abaixo|acima|atr[áa]s|longe|fora) d[oa] (ganho|ritmo)|no caminho (certo )?(pr[oa]|d[oa]|para a|para o|rumo [àa]) (meta|alvo|objetivo|etapa))\b|\b(t[ôo]|to|estou) (ganhando|perdendo)\s*(\?|$)`);
const RE_PESO_MEXENDO = rx(String.raw`\b(peso|balan[çc]a)\b[^.?!\n]{0,25}?\b(caindo|caiu|descendo|desceu|subindo|subiu|parad[oa]|parou|travad[oa]|travou|estagnad[oa]|estagnou|empacad[oa]|empacou|n[ãa]o (sobe|subiu|desce|desceu|mexe|mexeu|muda|mudou|sai do lugar))\b|\b(travad[oa]|parad[oa]|estagnad[oa]|empacad[oa]|pres[oa]|t[ôo]|to|estou|fiquei|continuo|sigo|cheguei) (n[oa]s?|em|aos?|com) \d{2,3}([,.]\d+)? ?(kg|quilos?)\b`);
// "quanto falta pros 80?", "vou chegar nos 75 kg?": número de peso de gente (40 a 150), não de dias, kcal ou gramas
const RE_CHEGAR_PESO = rx(String.raw`\b(chegar|bater|atingir|alcan[çc]ar|faltam?)\b[^.?!\n\d]{0,16}?(\d{2,3})([,.]\d+)? ?(kg|quilos?)?(?![\p{L}\p{N}%]| (dias?|min\p{L}*|horas?|anos?|reais|mil|km|metros?|semanas?|meses|pontos?|kcal|cal|g|gramas?|ml|litros?|por cento)\b)`);
const RE_NUTRIENTE = rx(String.raw`\b(prote[íi]na|carbo\p{L}*|calorias|kcal|gordura da dieta|fibras?|[áa]gua)\b`);
const falaDeChegarNoPeso = (t) => {
  const m = RE_CHEGAR_PESO.exec(t);
  return Boolean(m) && Number(m[2]) >= 40 && Number(m[2]) <= 150 && !RE_NUTRIENTE.test(t);
};
// palavra genérica: só com o corpo na frase ou em pergunta curta da própria pessoa
const RE_PROGRESSO_VAGO = rx(String.raw`\b(progresso|progredindo|progredi|evolu[çc][ãa]o|evoluindo|evolu[íi]|ritmo|tend[êe]ncia|etapa|resultados?|no caminho( certo)?|como (t[ôo]|to|estou|eu t[ôo]|eu estou) (indo|evoluindo))\b`);
const RE_CORPO = rx(String.raw`\b(peso|pesei|pesagens?|balan[çc]a|kg|quilos?|massa|engord\p{L}*|emagre\p{L}*|gordura|bioimped\p{L}*|shape|f[íi]sico)\b`);
const RE_CORPO_FORTE = rx(String.raw`\b(balan[çc]a|engord\p{L}*|emagre\p{L}*|meu peso|peso corporal|ganh\p{L}* (de )?(peso|massa)|perd\p{L}* (de )?peso|meta de peso|abaixo do ganho|acima do ganho|pesei|pesagens?|bioimped\p{L}*)\b`);
// carga de treino ("o peso no supino subiu", "progresso no agachamento", "subi 10 kg na flexora") não é peso do corpo
const RE_EXERCICIO = rx(String.raw`\b(supino|agachamento|levantamento|terra|carga|cargas|s[ée]ries?|repeti[çc][õo]es|reps|barra|halter(es)?|anilhas?|m[áa]quina|corrida|pace|flexora|extensora|leg( press)?|rosca|remada|puxada|desenvolvimento|stiff|panturrilha|recorde|for[çc]a)\b`);
const RE_TREINO = rx(String.raw`\b(treino|treinos|treinar|academia|exerc[íi]cios?|muscula[çc][ãa]o|cardio)\b`);
const RE_OUTRO_ASSUNTO = rx(String.raw`\b(trabalho|servi[çc]o|faculdade|escola|obra|estudos?|curso|prova|emprego|empresa|projeto|d[óo]lar|bolsa|a[çc][õo]es|chuva|chover|clima|beb[êe]|filh[oa]s?|cachorr[oa]|gat[oa]|jogo|time|campeonato|novela|livro|m[úu]sica|vendas?|clientes?|reuni[ãa]o|tr[âa]nsito|elei[çc][ãa]o|pol[íi]tica|leitura|ingl[êe]s)\b`);
// de quem é o progresso: o bloco PROGRESSO é sempre o de quem mandou ("a Ale tá perdendo peso rápido" não é pergunta do Lucas)
const RE_PRIMEIRA = rx(String.raw`\b(eu|me|meu|minha|meus|minhas|t[ôo]|to|estou|comigo|mim|ganhei|perdi|engordei|emagreci|pesei|subi|desci|cheguei|fiquei|continuo|sigo|evolu[íi]|progredi)\b`);
const RE_OUTRA_PESSOA = rx(String.raw`\b(ele|ela|eles|elas|dele|dela|deles|delas)\b|\b(voc[êe]|vc|tu) (t[áa]|est[áa]|anda|ficou|parece|engord\p{L}*|emagre\p{L}*|ganhou|perdeu)\b|\b(seu|sua|teu|tua) (peso|ritmo|progresso|ganho|evolu[çc][ãa]o|tend[êe]ncia|shape)\b`);
const RE_NOME_PROPRIO = /(?<![\p{L}])(?:[AaOo]|[DdNn][ao]|[Pp]r[ao]|[Cc]om [ao]) \p{Lu}\p{Ll}{2,}/u;
const perguntaCurta = (t) => t.includes('?') && t.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).length <= 7 && (RE_PRIMEIRA.test(t) || /^\s*e\s/iu.test(t));
/** A mensagem pergunta (ou comenta) o progresso de peso corporal, o ritmo ou a meta de peso de quem mandou? */
export const pareceProgresso = (texto) => {
  // menção e link não dizem nada do assunto
  const t = String(texto || '').replace(/@\S+/g, ' ').replace(/https?:\/\/\S+/g, ' ').trim();
  if (!t) return false;
  const forte = RE_PROGRESSO_FORTE.test(t) || falaDeChegarNoPeso(t);
  const mexendo = !forte && RE_PESO_MEXENDO.test(t);
  const vago = !forte && !mexendo && RE_PROGRESSO_VAGO.test(t) && (RE_CORPO.test(t) || perguntaCurta(t));
  if (!forte && !mexendo && !vago) return false;
  const corpoForte = RE_CORPO_FORTE.test(t);
  if (RE_EXERCICIO.test(t) && !corpoForte) return false;
  if (!forte && RE_TREINO.test(t) && !corpoForte) return false;
  if (vago && RE_OUTRO_ASSUNTO.test(t) && !RE_CORPO.test(t)) return false;
  if ((RE_OUTRA_PESSOA.test(t) || RE_NOME_PROPRIO.test(t)) && !RE_PRIMEIRA.test(t)) return false;
  return true;
};

/**
 * Puro. A decisão de roteamento, num lugar só pra produção (mensagens.js) e avaliação (avaliacao/rodar.mjs): a mensagem vai
 * pro modo de pergunta de progresso (responde com o bloco PROGRESSO DE PESO, sem registrar nada)? Nunca com foto ou áudio,
 * nem quando a mensagem também conta uma refeição, corrige um registro, contesta, fala do sistema ou continua a refeição em
 * andamento: aí o registro manda ("comi 2 ovos e pão, ritmo tá bom?" perdia o registro, revisão de 09/10).
 */
export function rotaPerguntaProgresso({ texto, temImagem = false, temAudio = false, metaConversa = false, contestacao = false, emAndamento = null } = {}) {
  return !temImagem && !temAudio && !metaConversa && !contestacao && !emAndamento && pareceProgresso(texto) && !pareceConsumo(texto) && !pareceCorrecao(texto);
}

// ---------- 8. conferência do texto da IA ----------
// Fica fora da checagem (revisão de 09/10: explicar o ALERTA do próprio bloco ou analisar um prato não é contradizer a
// tendência): pergunta; frase de hipótese ou finalidade ("se comer 4.000...", "pra andar no alvo, a balança pede..."); oração
// negada ou incerta ("isso não quer dizer que você come demais", "ainda não dá pra dizer se o peso está subindo"); janela curta
// (hoje, essa semana, "nos últimos 5 dias", "de 03/10 a 09/10", oscilação de água, o trecho da calibração); carga de treino; e,
// nas checagens de ritmo e de excesso, frase de prato ou refeição (⚖️ Veredito, 💡 Dica) e frase sobre proteína.
const RE_CURTO_PRAZO = rx(String.raw`\b(hoje|ontem|anteontem|amanh[ãa]|(n?essa|n?esta) manh[ãa]|de manh[ãa]|nessa refei[çc][ãa]o|nesse prato|neste prato|nessa foto|no almo[çc]o|no jantar|no caf[ée]|no lanche|ess[ae] semana|est[ae] semana|nest[ae] semana|ness[ae] semana|na semana|semana passada|[úu]ltima semana|[úu]ltimos dias|de um dia pro outro|dia a dia|pontual|oscila\p{L}*|flutua\p{L}*|[áa]gua|reten[çc][ãa]o|incha[çc]o|s[óo]dio|glicog[êe]nio|trecho|calibra[çc][ãa]o)\b`);
const NUM_EXTENSO = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, dez: 10, quinze: 15 };
const RE_N_DIAS = rx(String.raw`\b(\d+|um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|dez|quinze)\s+(dias?|semanas?)\b`, 'giu');
const RE_DATA_DM = /(?<![\p{N}\/])(\d{1,2})\/(\d{1,2})(?![\p{N}\/])/gu;
/** O trecho fala de uma janela de menos de 3 semanas (não da tendência de 4)? */
function janelaCurta(trecho) {
  if (RE_CURTO_PRAZO.test(trecho)) return true;
  for (const m of trecho.matchAll(RE_N_DIAS)) {
    const n = NUM_EXTENSO[m[1].toLowerCase()] ?? Number(m[1]);
    if ((/^semana/i.test(m[2]) ? n * 7 : n) < 21) return true;
  }
  const datas = [...trecho.matchAll(RE_DATA_DM)].map((m) => Date.UTC(2000, Number(m[2]) - 1, Number(m[1])));
  if (datas.length >= 2) {
    const dias = (datas[1] - datas[0]) / 86400000;
    if ((dias < 0 ? dias + 366 : dias) < 21) return true;
  }
  return false;
}
const RE_PRATO = rx(String.raw`⚖|💡|🍽|\b(prato|almo[çc]o|jantar|janta|caf[ée] da manh[ãa]|lanche|refei[çc][ãa]o|refei[çc][õo]es|por[çc][ãa]o|marmita|ceia|foto|concha|colher(es)?|card[áa]pio)\b`);
const RE_COMIDA = rx(String.raw`\b(calorias|kcal|prote[íi]na|carbo\p{L}*|comida|comeu|comendo|ingest[ãa]o|macros?|fibras?)\b`);
// a frase fala de peso/ritmo? (sem "kg" solto: "130 kg na flexora" é carga de treino); alvo/objetivo só quando não é de comida
const RE_CONTEXTO_PESO = rx(String.raw`\b(peso|balan[çc]a|tend[êe]ncia|ritmo|ganh\p{L}*|etapa|engord\p{L}*|emagre\p{L}*)\b|kg\/semana`);
const RE_CONTEXTO_ALVO = rx(String.raw`\b(alvo|objetivo|meta)\b`);
const RE_CONTEXTO_BALANCO = rx(String.raw`\b(objetivo|alvo|meta|super[áa]vit|balan[çc]o|saldo|m[ée]dia|semana)\b`);
const RE_PESO_DO_CORPO = rx(String.raw`\b(balan[çc]a|seu peso|teu peso|peso corporal|tend[êe]ncia|etapa)\b|kg\/semana`);
// separadores de oração (vírgula e dois-pontos fora de número: "1,2 kg" e "10:30" não separam)
const RE_SEPARADOR = rx(String.raw`(?<!\p{N}),|,(?!\p{N})|;|(?<!\p{N}):|:(?!\p{N})|[()—–]|\s-\s|\b(mas|por[ée]m|contudo|entretanto|s[óo] que|e sim|embora|enquanto)\b`, 'giu');
// oração negada, incerta, de finalidade, de obrigação ou no subjuntivo/condicional: não afirma
const RE_NAO_AFIRMA = rx(String.raw`\b(n[ãa]o|nunca|nem|jamais|talvez|ser[áa] que|cedo|dif[íi]cil|incert\p{L}*|d[úu]vida|precis\p{L}*|deveria|devia|teria|tem que|tenha|esteja|estivesse|fosse|ficaria|estaria|seria|pode|podem|poderia|consiga|(dizer|saber|cravar|afirmar|confirmar|garantir|concluir) se|(pra|para) que|(pra|para) (\p{L}+ ){0,2}\p{L}+(ar|er|ir|or|[ôo]r))\b`);
// frase inteira de hipótese ou finalidade: "Se comer 4.000, você fica no alvo", "Pra andar no alvo, a balança pede..."
const RE_HIPOTESE = rx(String.raw`^(e |mas |s[óo] |ent[ãa]o )?(se|caso|pra|para|mantendo|comendo|mirando|chegando|aumentando|reduzindo|assim que)\b`);
const RE_CAINDO = rx(String.raw`\b(peso|balan[çc]a)\b[^.!?\n]{0,40}?\b(caindo|caiu|descendo|desceu|diminuindo|diminuiu|baixando|baixou|recuando|recuou|em queda)\b|\b(perdendo|perdeu|perdi|perdemos)\s+(peso|quilos?|\d+([,.]\d+)?\s*(kg|quilos?|gramas?))\b|\b(emagrecendo|emagreceu|emagreci)\b|\btend[êe]ncia\b[^.!?\n]{0,30}?\b(de queda|de baixa|caindo|negativa|pra baixo|de perda)\b`, 'giu');
const RE_SUBINDO = rx(String.raw`\b(peso|balan[çc]a)\b[^.!?\n]{0,40}?\b(subindo|subiu|aumentando|aumentou|crescendo|cresceu|em alta)\b|\b(ganhando|ganhou|ganhei|ganhamos)\s+(peso|quilos?|\d+([,.]\d+)?\s*(kg|quilos?|gramas?))\b|\b(engordando|engordou|engordei)\b|\btend[êe]ncia\b[^.!?\n]{0,30}?\b(de alta|de subida|subindo|positiva|pra cima|de ganho)\b`, 'giu');
const RE_ESTAVEL = rx(String.raw`\b(peso|balan[çc]a)\b[^.!?\n]{0,30}?\b(est[áa]vel|parad[oa]|estagnad[oa]|estagnou|travad[oa]|travou|empacad[oa]|empacou|no mesmo lugar|n[ãa]o (sobe|subiu|mexe|mexeu|sai do lugar|saiu do lugar))\b`, 'giu');
// com pesagens insuficientes, a frase que se diz provisória ("por enquanto o peso subiu, mas ainda é cedo pra dizer...")
// descreve a variação crua, não crava tendência (avaliação com o modelo, cenário P03); com dados bastantes, não vale
const RE_PROVISORIO = rx(String.raw`\b(por enquanto|at[ée] agora|at[ée] aqui|at[ée] o momento|nesse come[çc]o|no come[çc]o|nesses (poucos )?dias|cedo (demais )?(pra|para)|ainda n[ãa]o d[áa]|ainda n[ãa]o [ée] tend[êe]ncia|pode ser [áa]gua|oscila\p{L}*)\b`);
// "o peso não sobe" AFIRMA que está parado: esse "não" faz parte da afirmação
const RE_ESTAVEL_PROPRIA = rx(String.raw`\bn[ãa]o (sobe|subiu|mexe|mexeu|sai do lugar|saiu do lugar)\b`, 'giu');
// afirmação de que ESTÁ no ritmo: verbo de estado ("tá no ritmo", "segue no alvo", "está no caminho certo") ou rótulo ("No ritmo
// perfeito da etapa", "Ritmo ótimo", "o ganho tá indo bem"). Sem "fica" (condicional: "assim você fica no ritmo") e sem
// "ritmo certo/ideal" solto ("o ritmo certo da etapa é +0,38" nomeia o alvo, não afirma nada)
const RE_NO_RITMO = rx(String.raw`\b(est[áa]|t[áa]|t[ôo]|to|estou|estamos|segue|seguindo|sigo|continua|continuando|continuo|anda|andando|vem|vindo|ficou|permanece|mant[ée]m|manteve)\s+(bem\s+|certinho\s+|direitinho\s+|exatamente\s+|praticamente\s+|totalmente\s+|j[áa]\s+|sim\s+)?(no ritmo|dentro do ritmo|no alvo|na linha|no caminho certo|no caminho d[oa] (alvo|ritmo|objetivo|meta|etapa))\b|\bno ritmo (certo|da etapa|alvo|ideal|perfeito)\b|\bno caminho certo\b(?!\s+(pra|para)\s+\p{L}+(ar|er|ir)\b)|\b(ganhando|subindo|perdendo|caindo|descendo|emagrecendo|engordando) no ritmo\b|\britmo (est[áa]|t[áa]|segue|continua|anda)\s+(bem|bom|[óo]timo|certo|certinho|perfeito|ideal|excelente|adequado)\b|\b(bom|[óo]timo|excelente|belo|perfeito) ritmo\b|\britmo (perfeito|[óo]timo|excelente)\b|\b(ganho|progresso|evolu[çc][ãa]o)\s+(est[áa]|t[áa]|segue|vai|anda)\s+(indo\s+)?(bem|muito bem|[óo]timo|[óo]tima|perfeito|perfeita|excelente)\b`, 'giu');
const RE_ABAIXO = rx(String.raw`\b(abaixo do (ritmo|alvo|esperado|ganho)|atr[áa]s do (ritmo|alvo|ganho|esperado)|ritmo (lento|devagar|baixo|fraco|abaixo)|ganhando (pouco|devagar|menos do que)|(ritmo|ganho) atrasad[oa]|atrasad[oa] (no|em rela[çc][ãa]o ao|com o) (ritmo|alvo|ganho|plano)|(est[áa]|t[áa]|t[ôo]|estou|segue|continua) atrasad[oa])\b`, 'giu');
const RE_RAPIDO = rx(String.raw`\b(r[áa]pido demais|muito r[áa]pido|mais r[áa]pido que o (saud[áa]vel|ideal|recomendado)|acima do (saud[áa]vel|teto|limite)|passando do (ponto|teto|limite)|acelerad[oa] demais)\b`, 'giu');
// "acima da média" não é excesso: só acima da meta/do alvo/do objetivo/do necessário
const RE_COMENDO_DEMAIS = rx(String.raw`\b(comendo|come|comeu)\b[^.!?\n]{0,30}?\b(al[ée]m d[oa] (objetivo|necess[áa]rio|alvo|meta|que precisa)|demais|acima d[oa] (meta|alvo|objetivo|necess[áa]rio|recomendado|faixa|ideal)|muito acima|em excesso|mais do que (precisa|o necess[áa]rio|deveria))\b|\bsuper[áa]vit\b[^.!?\n]{0,30}?\b(alto demais|grande demais|exagerado|excessivo|acima do alvo)\b|\b(balan[çc]o|saldo)\b[^.!?\n]{0,40}?\bacima do alvo\b`, 'giu');

/**
 * Puro. O regex (global) casa uma AFIRMAÇÃO na frase? Cada ocorrência é lida na sua oração: do separador anterior ao fim do
 * trecho casado ("Seu peso não está parado: subiu" afirma a subida; "isso não significa que você come demais" não afirma o
 * excesso). Janela curta conta na oração inteira e numa abertura curta da frase ("Hoje, ...", "Nos últimos 5 dias, ...").
 */
function afirma(re, f, { propria = null, prato = false } = {}) {
  const seps = [...f.matchAll(RE_SEPARADOR)].map((s) => ({ ini: s.index, fim: s.index + s[0].length }));
  const abertura = seps.length ? f.slice(0, seps[0].ini) : '';
  const aberturaCurta = abertura && abertura.trim().split(/\s+/).length <= 4 ? abertura : '';
  for (const m of f.matchAll(re)) {
    const fimTrecho = m.index + m[0].length;
    const comeco = seps.filter((s) => s.fim <= fimTrecho).reduce((acc, s) => Math.max(acc, s.fim), 0);
    const proximo = seps.find((s) => s.ini >= fimTrecho);
    const oracao = f.slice(comeco, fimTrecho);
    if (RE_NAO_AFIRMA.test(propria ? oracao.replace(propria, ' ') : oracao)) continue;
    const alcance = `${aberturaCurta} ${f.slice(comeco, proximo ? proximo.ini : f.length)}`;
    if (janelaCurta(alcance) || (prato && RE_PRATO.test(alcance))) continue;
    return true;
  }
  return false;
}

/**
 * Puro. Frases da resposta da IA que contradizem a análise: direção do peso oposta à tendência (ou cravada sem base),
 * "no ritmo" com veredito abaixo, "abaixo/atrasado" com veredito no alvo, "rápido demais" sem estar, e "comendo além do
 * objetivo" quando o alerta diz que a balança não acompanha o registro (e a comida não está acima da meta calibrada).
 * Conservadora (ver o comentário da seção). Devolve [{ tipo, trecho, frase, correto }].
 */
export function conferirTextoProgresso(texto, a) {
  if (!texto || !a?.tendencia) return [];
  const t = a.tendencia;
  const v = a.veredito || {};
  const frases = String(texto).split(/(?<=[.!?])\s+|\n+/).map((f) => f.trim()).filter(Boolean);
  const achados = [];
  const certo = a.vereditoCurto || vereditoCurto(a);
  const add = (tipo, f) => {
    if (!achados.some((x) => x.tipo === tipo && x.frase === f)) achados.push({ tipo, trecho: f.slice(0, 160), frase: f, correto: certo });
  };
  const contraQueda = () => t.direcao === 'subindo' || t.direcao === 'estavel' || (t.direcao === 'indefinida' && t.kgSemana >= 0.1);
  const contraSubida = () => t.direcao === 'caindo' || t.direcao === 'estavel' || (t.direcao === 'indefinida' && t.kgSemana <= -0.1);
  const registroAcima = a.alertas?.some((x) => x.tipo === 'registro_acima_da_balanca');
  for (const f of frases) {
    // pergunta ("Tá no ritmo da etapa? Ainda não: ...") e hipótese/finalidade não afirmam nada
    if (/\?[^\p{L}\p{N}]*$/u.test(f) || RE_HIPOTESE.test(f.replace(/^[^\p{L}\p{N}]+/u, ''))) continue;
    const semProteina = !/prote[íi]na/iu.test(f);
    const treino = (RE_EXERCICIO.test(f) || RE_TREINO.test(f)) && !RE_PESO_DO_CORPO.test(f);
    if (!treino) {
      const caindo = afirma(RE_CAINDO, f);
      const subindo = afirma(RE_SUBINDO, f);
      const estavel = afirma(RE_ESTAVEL, f, { propria: RE_ESTAVEL_PROPRIA });
      if (caindo !== subindo) {
        if (!t.suficiente) {
          if (!RE_PROVISORIO.test(f)) add('direcao_sem_base', f);
        } else if (caindo ? contraQueda() : contraSubida()) add('direcao_oposta', f);
      } else if (estavel && !caindo && t.suficiente && (t.direcao === 'subindo' || t.direcao === 'caindo')) add('direcao_oposta', f);
    }
    const ctxRitmo = RE_CONTEXTO_PESO.test(f) || (RE_CONTEXTO_ALVO.test(f) && !RE_COMIDA.test(f));
    if (ctxRitmo && semProteina && !treino) {
      const noRitmo = afirma(RE_NO_RITMO, f, { prato: true });
      const abaixo = afirma(RE_ABAIXO, f, { prato: true });
      const rapido = afirma(RE_RAPIDO, f, { prato: true });
      if (v.status === 'inconclusivo' && (noRitmo || abaixo || rapido)) add('ritmo_sem_base', f);
      else if (noRitmo && ((v.status === 'abaixo' && v.confianca !== 'baixa') || v.status === 'acima')) add('ritmo_oposto', f);
      else if (abaixo && (v.status === 'no_alvo' || v.status === 'acima')) add('ritmo_oposto', f);
      else if (rapido && (v.status === 'abaixo' || (v.status === 'no_alvo' && !(v.pRapido >= 0.2)))) add('ritmo_oposto', f);
    }
    if (semProteina && v.status === 'abaixo' && registroAcima && a.situacaoIngestao !== 'acima' && RE_CONTEXTO_BALANCO.test(f) && afirma(RE_COMENDO_DEMAIS, f, { prato: true })) add('excesso_sem_balanca', f);
  }
  return achados;
}

/** Puro. Tira do texto as frases apontadas pela conferência (exatas, como conferirTextoProgresso as separou) e arruma os espaços. */
export function tirarFrases(texto, frases = []) {
  let r = String(texto || '');
  for (const f of frases) {
    const i = f ? r.indexOf(f) : -1;
    if (i < 0) continue;
    let fim = i + f.length;
    while (r[fim] === ' ' || r[fim] === '\t') fim++; // leva junto o espaço até a frase seguinte da mesma linha
    r = r.slice(0, i) + r.slice(fim);
  }
  return r.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Instrução pra IA refazer a resposta quando conferirTextoProgresso achou contradição. '' sem achados. */
export function problemaDeProgresso(achados = []) {
  if (!achados.length) return '';
  const nomes = { direcao_oposta: 'direção do peso contrária à tendência medida', direcao_sem_base: 'direção do peso cravada sem pesagens suficientes', ritmo_oposto: 'veredito do ritmo contrário ao calculado', ritmo_sem_base: 'veredito do ritmo sem base nos dados', excesso_sem_balanca: '"comendo além do objetivo" quando a balança não acompanha o registro' };
  return `sua resposta contradiz o bloco PROGRESSO DE PESO: ${achados.map((x) => `${nomes[x.tipo] || x.tipo} ("${x.trecho}")`).join('; ')}. O que os números dizem: ${achados[0].correto} Reescreva só o que fala de peso, ritmo ou meta, usando o bloco PROGRESSO DE PESO (período, pesagens, tendência com incerteza, alvo, veredito e alertas); se houver alerta, explique o que cada indicador mostra em vez de escolher um. O resto da resposta (análise de prato, registro, conversa) fica como estava.`;
}
