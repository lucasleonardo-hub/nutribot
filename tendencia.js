// tendencia.js - Linha de tendência completa: o passado (todas as semanas com pesagem, até 12) e o futuro (semana a semana
// até a etapa), cruzando balança e bioimpedância, comida registrada, gasto do relógio, treinos de força e sono.
// projecaoAteMeta é pura (dá pra testar); tendenciaCompleta junta os dados do Mongo e a faixa da meta.
import { pesagensDesde, refeicoesDesde, colecao } from './mongo.js';
import { faixaDaMeta, pesoDeReferencia } from './resumo.js';
import { faixaSaudavel, registroXBalanca } from './previsao.js';
import { diasAnteriores } from './util.js';
import { corrigirBalanco } from './calibracao.js';
import { validarPesagens, regressao as regressaoComIC, vereditoRitmo, registroDiscordaDaBalanca } from './progresso.js';

const KCAL_POR_KG = 7700; // régua clássica (tecido misto); ganho magro custa menos por kg, mas serve de ordem de grandeza
const MAX_SEMANAS_PASSADAS = 12;
const MAX_SEMANAS_FUTURAS = 20;

const dmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const somarDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** b − a em dias (negativo se b vem antes). */
const distDias = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const kg1 = (n) => `${Number(n).toFixed(1).replace('.', ',')} kg`;
const kgSinal = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2).replace('.', ',')} kg`;
const kcalSinal = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.round(Math.abs(n)).toLocaleString('pt-BR')} kcal`;
const hm = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
/** Regressão linear: { slope (y por unidade de x), se (erro-padrão da inclinação), n }; null com menos de 3 pontos ou x todo igual. */
const regressao = (xs, ys) => {
  if (xs.length < 3) return null;
  const mx = media(xs);
  const my = media(ys);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!den) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
  const b = my - slope * mx;
  const s2 = xs.reduce((a, x, i) => a + (ys[i] - (b + slope * x)) ** 2, 0) / (xs.length - 2);
  return { slope, se: Math.sqrt(Math.max(0, s2) / den), n: xs.length };
};
const inclinacao = (xs, ys) => regressao(xs, ys)?.slope ?? null;

/**
 * Puro. Semanas de 7 dias contadas de trás pra frente a partir de `dia` (0 = semana atual), só as que têm pesagem, da mais
 * antiga pra mais nova. Por semana: peso/gordura/magra médios, comida média (dias com 500+ kcal registradas), gasto médio do
 * relógio, balanço médio nos dias que têm os dois lados, treinos de força e sono médio.
 */
export function semanasPassadas({ pesagens = [], refeicoes = [], gastos = {}, sonos = [], treinos = [], dia, maxSemanas = MAX_SEMANAS_PASSADAS } = {}) {
  const porSemana = new Map();
  const idxDe = (d) => Math.floor(distDias(d, dia) / 7);
  const semana = (idx) => {
    if (!porSemana.has(idx)) porSemana.set(idx, { idx, inicio: somarDias(dia, -idx * 7 - 6), fim: somarDias(dia, -idx * 7), peso: [], gordura: [], magra: [], kcalDias: new Map(), gastoDias: new Map(), sono: [], treinos: 0 });
    return porSemana.get(idx);
  };
  const cabe = (idx) => idx >= 0 && idx < maxSemanas;
  for (const p of pesagens) {
    if (!(p?.peso > 0) || !p.dia || p.dia > dia) continue;
    const idx = idxDe(p.dia);
    if (!cabe(idx)) continue;
    const s = semana(idx);
    s.peso.push(Number(p.peso));
    if (p.gordura != null && Number(p.gordura) > 0) {
      s.gordura.push(Number(p.gordura));
      s.magra.push(Number(p.peso) * (1 - Number(p.gordura) / 100));
    }
  }
  // comida por dia (soma e nº de registros), só dias fechados. Dia mal registrado não entra no balanço: um registro só, ou
  // menos de 65% da mediana diária da pessoa no período (um almoço esquecido puxaria o balanço pra baixo e o ritmo junto)
  const porDiaComida = new Map();
  for (const r of refeicoes) {
    const kcal = Number(r?.estimativa?.kcal ?? r?.kcal) || 0; // o registro guarda a estimativa em estimativa.kcal
    if (!r?.dia || r.dia >= dia || !(kcal > 0)) continue; // hoje ainda está incompleto
    const d = porDiaComida.get(r.dia) || { kcal: 0, n: 0 };
    d.kcal += kcal;
    d.n += 1;
    porDiaComida.set(r.dia, d);
  }
  const diasBons = [...porDiaComida.values()].filter((d) => d.n >= 2).map((d) => d.kcal).sort((a, b) => a - b);
  const medianaDia = diasBons.length ? diasBons[Math.floor(diasBons.length / 2)] : null;
  const diaCompleto = (d) => d.n >= 2 && d.kcal >= 500 && (medianaDia == null || d.kcal >= medianaDia * 0.65);
  for (const [d, v] of porDiaComida) {
    const idx = idxDe(d);
    if (!cabe(idx) || !diaCompleto(v)) continue;
    semana(idx).kcalDias.set(d, v.kcal);
  }
  for (const [d, k] of Object.entries(gastos || {})) {
    if (!(Number(k) > 800) || d >= dia) continue;
    const idx = idxDe(d);
    if (!cabe(idx)) continue;
    semana(idx).gastoDias.set(d, Number(k));
  }
  for (const s of sonos || []) {
    if (!s?.dia || !(s.total > 0) || s.dia > dia) continue;
    const idx = idxDe(s.dia);
    if (!cabe(idx)) continue;
    semana(idx).sono.push(Number(s.total));
  }
  for (const t of treinos || []) {
    const d = String(t?.inicio || t?.dia || '').slice(0, 10);
    if (!d || d > dia) continue;
    const idx = idxDe(d);
    if (!cabe(idx)) continue;
    semana(idx).treinos += 1;
  }
  return [...porSemana.values()]
    .filter((s) => s.peso.length)
    .sort((a, b) => b.idx - a.idx)
    .map((s) => {
      const diasComida = [...s.kcalDias.entries()]; // já só dias completos
      const pares = diasComida.map(([d, k]) => [k, s.gastoDias.get(d)]).filter(([, g]) => g);
      return {
        idx: s.idx,
        inicio: s.inicio,
        fim: s.fim,
        peso: media(s.peso),
        n: s.peso.length,
        gordura: s.gordura.length ? media(s.gordura) : null,
        magra: s.magra.length ? media(s.magra) : null,
        kcal: diasComida.length ? media(diasComida.map(([, k]) => k)) : null,
        diasComida: diasComida.length,
        gasto: s.gastoDias.size ? media([...s.gastoDias.values()]) : null,
        balanco: pares.length ? media(pares.map(([k, g]) => k - g)) : null,
        diasBalanco: pares.length,
        sono: s.sono.length ? media(s.sono) : null,
        treinos: s.treinos,
      };
    });
}

/**
 * Puro. Passado + ritmo + projeção até a etapa + veredito. `faixa` = metaBalancoPara(...) (ritmoKgSemana, min/max kcal).
 * Devolve null com menos de 4 pesagens. Campos: semanas, pesoAtual, ritmo { real, balanco, esperado, alvo, necessario,
 * limiteSaudavel }, balancoDia, chegada { semanas, data } | null, futuro [{ fim, projetado, linhaAlvo, marcaPrazo }],
 * veredito, status ('ok'|'abaixo'|'acima'|'acima_gordura'|'neutro'), ajusteKcal, magraSem, gorduraSem, texto, textoCurto, zap, resumoZap.
 */
export function projecaoAteMeta({ perfil = {}, dia, pesagens = [], refeicoes = [], gastos = {}, sonos = [], treinos = [], faixa = null } = {}) {
  if (!dia) return null;
  // datas e pesos válidos, uma pesagem por dia, em ordem (a mesma limpeza do !progresso)
  const pts = validarPesagens(pesagens, { dia }).pontos;
  if (pts.length < 4) return null;
  const semanas = semanasPassadas({ pesagens: pts, refeicoes, gastos, sonos, treinos, dia });
  if (!semanas.length) return null;
  const objetivo = String(perfil.objetivo || '');
  const querGanhar = /hipertrof|ganh|massa|bulk|engord|for[çc]a/i.test(objetivo);
  const querPerder = !querGanhar && /emagre|perd|reduz|defin|secar|gordura/i.test(objetivo);
  const direcao = querGanhar ? 1 : querPerder ? -1 : 0;

  // ritmo real: regressão nas pesagens das últimas 4 semanas (ou nas últimas 6 pesagens, se forem poucas), com o erro-padrão
  // corrigido pela autocorrelação das pesagens (a mesma conta do !progresso)
  const rec = pts.filter((p) => distDias(p.dia, dia) <= 27);
  const base = rec.length >= 4 ? rec : pts.slice(-6);
  const x0 = base[0].dia;
  const rp = regressaoComIC(base.map((p) => distDias(x0, p.dia)), base.map((p) => Number(p.peso)));
  const ritmoReal = rp ? rp.b * 7 : null;
  const seSem = rp ? rp.se * 7 : null; // erro-padrão do ritmo (kg/semana)
  const comG = base.filter((p) => p.gordura != null && Number(p.gordura) > 0);
  const magraSem = comG.length >= 4 ? inclinacao(comG.map((p) => distDias(x0, p.dia)), comG.map((p) => Number(p.peso) * (1 - Number(p.gordura) / 100))) * 7 : null;
  const gorduraSem = comG.length >= 4 ? inclinacao(comG.map((p) => distDias(x0, p.dia)), comG.map((p) => Number(p.peso) * (Number(p.gordura) / 100))) * 7 : null;
  const gorduraPpSem = comG.length >= 4 ? inclinacao(comG.map((p) => distDias(x0, p.dia)), comG.map((p) => Number(p.gordura))) * 7 : null;
  // peso atual = o MESMO peso de referência da META DE PESO (resumo.pesoDeReferencia: o de tendência, ou a média de 7 dias
  // com poucas pesagens): com a média de 7 dias aqui e o de tendência na meta, o prompt trazia dois "faltam" diferentes
  const ref = pesoDeReferencia(pts, dia, perfil);
  const pesoAtual = Math.round(Number(ref.peso) * 100) / 100;

  // ritmo pelo balanço energético: comida registrada − gasto do relógio, nas últimas 3 semanas com 3+ dias completos
  const comBalanco = semanas.filter((s) => s.balanco != null && s.diasBalanco >= 3).slice(-3);
  const balancoDia = comBalanco.length ? media(comBalanco.map((s) => s.balanco)) : null;
  // calibração aprendida no domingo: desconta o viés do registro antes de converter em ritmo (só com confiança >= 0,5)
  const corr = corrigirBalanco(balancoDia, perfil.calibracao);
  const balancoUsado = corr.valor;
  const ritmoBalanco = balancoUsado != null ? (balancoUsado * 7) / KCAL_POR_KG : null;
  // esperado daqui pra frente: média PONDERADA pelo inverso da variância. A balança é a verdade sobre o peso (σ = erro-padrão
  // da regressão, mínimo 0,08 kg/semana); o balanço energético carrega ±250 kcal/dia de erro de foto e de relógio
  // (σ ≈ 0,25 kg/semana): confere, não manda. (Média simples transformava +0,29 e +0,74 em +0,52 e num falso "acima do saudável".)
  // Quando registro e balança não batem, uma das duas está errada, e não se mistura: o esperado segue a balança. (09/10: +0,16
  // da balança e +0,82 da comida, que registrava ~900 kcal/dia a mais do que a balança mostrava, viravam um "+0,29" que não
  // era medida nem previsão confiável, e o veredito saía "um pouco abaixo, coma +47 kcal".) O critério é o MESMO do alerta do
  // !progresso (registroDiscordaDaBalanca: fora do IC 95% da balança e mais de ~250 kcal/dia), e na MESMA janela dele (o
  // trecho alinhado de comida e pesagens dos 28 dias) quando ela existe; com 2 desvios da variância combinada, a mesma mensagem
  // dizia "não batem" no alerta e ainda misturava as duas na data de chegada. Sem calibração de 28 dias, a janela daqui.
  const SIGMA_BALANCO = 0.25;
  const sigmaReal = ritmoReal != null ? Math.max(seSem ?? 0.12, 0.08) : null;
  const rxb = registroXBalanca({ refeicoes, pesagens, gastos, dia });
  const discordante = ritmoReal != null && ritmoBalanco != null && (rxb ? rxb.discorda : registroDiscordaDaBalanca({ kgSemanaBalanca: ritmoReal, icBalanca: rp.ic.map((x) => x * 7), kgSemanaRegistro: ritmoBalanco }));
  let ritmoEsperado = null;
  let sigmaEsperado = null;
  if (ritmoReal != null && ritmoBalanco != null && !discordante) {
    const wr = 1 / sigmaReal ** 2;
    const wb = 1 / SIGMA_BALANCO ** 2;
    ritmoEsperado = (ritmoReal * wr + ritmoBalanco * wb) / (wr + wb);
    sigmaEsperado = Math.sqrt(1 / (wr + wb));
  } else if (ritmoReal != null) {
    ritmoEsperado = ritmoReal;
    sigmaEsperado = sigmaReal;
  } else if (ritmoBalanco != null) {
    ritmoEsperado = ritmoBalanco;
    sigmaEsperado = SIGMA_BALANCO;
  }
  // incerteza do ritmo: a do esperado, inflada por um quarto da discordância balança x comida (mín. 0,06, máx. 0,5 kg/semana)
  const discordancia = ritmoReal != null && ritmoBalanco != null ? Math.abs(ritmoReal - ritmoBalanco) / 4 : 0;
  const incerteza = ritmoEsperado != null ? Math.min(0.5, Math.max(0.06, Math.sqrt(sigmaEsperado ** 2 + discordancia ** 2))) : null;

  const alvoSem = faixa?.ritmoKgSemana ?? null;
  const metaPeso = Number(perfil.metaPeso) > 0 ? Number(perfil.metaPeso) : null;
  const prazo = perfil.metaPrazo && /^\d{4}-\d{2}-\d{2}$/.test(perfil.metaPrazo) ? perfil.metaPrazo : null;
  const semanasAtePrazo = prazo ? Math.max(0, Math.ceil(distDias(dia, prazo) / 7)) : null;
  const falta = metaPeso ? Math.round((metaPeso - pesoAtual) * 100) / 100 : null;
  const necessario = falta != null && semanasAtePrazo > 0 ? falta / semanasAtePrazo : null;
  const saud = faixaSaudavel({ peso: pesoAtual, ganho: querGanhar });
  const limiteSaudavel = saud ? (querGanhar ? saud.max : saud.min) : null; // kg/semana, com o sinal da direção
  const necessarioSaudavel = necessario != null && limiteSaudavel != null && Math.abs(necessario) > Math.abs(limiteSaudavel) ? limiteSaudavel : necessario;
  // veredito: o MESMO do !progresso (vereditoRitmo): ritmo MEDIDO pela balança nas últimas 4 semanas contra o alvo de onde
  // sai a meta de calorias (faixa.ritmoKgSemana; sem faixa, o necessário pro prazo dentro do saudável), com a confiança.
  // O esperado (balança + comida, quando batem) serve à projeção, não ao veredito: o que já aconteceu é o que a balança mediu.
  const vr = vereditoRitmo({ pontos: pts, dia, faixa, objetivo: perfil.objetivo, pesoPerfil: perfil.peso, alvoPadrao: necessarioSaudavel });

  // chegada à meta no ritmo esperado: só se está andando na direção certa e com pesagens bastantes pro veredito (a mesma
  // regra: com "ainda não dá pra julgar o ritmo", uma data de chegada era um número sem base; revisão de 09/10)
  let chegada = null;
  if (vr.tend.suficiente && metaPeso && falta != null && ritmoEsperado != null && Math.abs(ritmoEsperado) >= 0.03 && Math.sign(falta) === Math.sign(ritmoEsperado) && Math.abs(falta) > 0.1) {
    const sem = Math.ceil(Math.abs(falta) / Math.abs(ritmoEsperado));
    if (sem <= 104) chegada = { semanas: sem, data: somarDias(dia, sem * 7) };
  }
  let chegadaSaudavel = null;
  if (metaPeso && falta != null && limiteSaudavel != null && Math.sign(falta) === Math.sign(limiteSaudavel) && Math.abs(falta) > 0.1) {
    const sem = Math.ceil(Math.abs(falta) / Math.abs(limiteSaudavel));
    chegadaSaudavel = { semanas: sem, data: somarDias(dia, sem * 7) };
  }

  // janela provável da chegada: ritmo esperado ± incerteza (no ritmo lento pode nem chegar)
  let janelaChegada = null;
  if (chegada && incerteza != null) {
    const rapido = Math.abs(ritmoEsperado) + incerteza;
    const lento = Math.abs(ritmoEsperado) - incerteza;
    const semCedo = Math.ceil(Math.abs(falta) / rapido);
    const semTarde = lento > 0.03 ? Math.ceil(Math.abs(falta) / lento) : null;
    janelaChegada = { cedo: somarDias(dia, semCedo * 7), tarde: semTarde && semTarde <= 104 ? somarDias(dia, semTarde * 7) : null };
  }
  // composição da mudança: primeira x última semana com bioimpedância (quanto foi massa magra, quanto foi gordura)
  const comComp = semanas.filter((s) => s.gordura != null && s.magra != null);
  let composicao = null;
  if (comComp.length >= 2) {
    const a = comComp[0];
    const b = comComp[comComp.length - 1];
    const dPeso = b.peso - a.peso;
    const dMagra = b.magra - a.magra;
    composicao = { desde: a.fim, ate: b.fim, dPeso, dMagra, dGord: dPeso - dMagra, gorduraDe: a.gordura, gorduraPara: b.gordura, parteMagra: Math.abs(dPeso) >= 0.3 ? dMagra / dPeso : null };
  }
  const gorduraNaMeta = composicao && metaPeso && chegada && gorduraPpSem != null ? Math.min(45, Math.max(4, composicao.gorduraPara + gorduraPpSem * chegada.semanas)) : null;
  const descreverParte = (c) => {
    if (c.parteMagra == null) return 'mudança pequena demais pra dividir';
    if (c.dPeso > 0) {
      if (c.dMagra >= c.dPeso) return 'todo o ganho foi massa magra, e a gordura ainda caiu';
      if (c.dMagra <= 0) return 'o ganho foi todo gordura, e a massa magra caiu';
      const pm = Math.round(c.parteMagra * 100);
      return `${pm}% do ganho foi massa magra e ${100 - pm}% gordura`;
    }
    if (c.dMagra >= 0) return 'tudo o que saiu foi gordura, e a massa magra até subiu';
    if (c.dGord >= 0) return 'o que saiu foi massa magra, e a gordura não caiu';
    const pg = Math.round((c.dGord / c.dPeso) * 100);
    return `${pg}% do que saiu foi gordura e ${100 - pg}% massa magra`;
  };
  const pct = (n) => `${n.toFixed(1).replace('.', ',')}%`;
  const txtComposicao = composicao
    ? `COMPOSIÇÃO DA MUDANÇA (${dmy(composicao.desde)} -> ${dmy(composicao.ate)}, bioimpedância, médias semanais): peso ${kgSinal(composicao.dPeso)}, massa magra ${kgSinal(composicao.dMagra)}, gordura ${kgSinal(composicao.dGord)} (${pct(composicao.gorduraDe)} -> ${pct(composicao.gorduraPara)}); ${descreverParte(composicao)}${gorduraNaMeta != null ? `. Se a tendência seguir, em ${kg1(metaPeso)} você teria cerca de ${pct(gorduraNaMeta)} de gordura (${kg1(metaPeso * (1 - gorduraNaMeta / 100))} de massa magra)` : ''}.`
    : '';
  // futuro semana a semana: até o prazo da etapa (ou até chegar), no mínimo 4 e no máximo 20 semanas
  const horizonte = Math.min(MAX_SEMANAS_FUTURAS, Math.max(semanasAtePrazo || 0, chegada?.semanas || 0, 4));
  const futuro = [];
  for (let i = 1; i <= horizonte; i++) {
    const fim = somarDias(dia, i * 7);
    const linhaAlvo = necessario != null ? pesoAtual + necessario * i : alvoSem != null ? pesoAtual + alvoSem * i : null;
    futuro.push({ fim, projetado: ritmoEsperado != null ? pesoAtual + ritmoEsperado * i : null, banda: incerteza != null ? incerteza * i : null, linhaAlvo, marcaPrazo: Boolean(prazo && fim >= prazo && somarDias(fim, -7) < prazo) });
  }
  const ritmoMedido = vr.tend.suficiente ? vr.tend.kgSemana : null;
  // kcal/dia a mais (ou a menos) pra sair do ritmo medido e chegar no alvo (7.700 kcal/kg; referência, a meta calibrada pela
  // balança fica no !progresso)
  const alvoRef = vr.alvo ?? necessarioSaudavel;
  const ajusteKcal = alvoRef != null && (ritmoMedido ?? ritmoEsperado) != null ? ((alvoRef - (ritmoMedido ?? ritmoEsperado)) * KCAL_POR_KG) / 7 : null;

  // sinais de contexto (últimas 2 semanas com dado)
  const ult2 = semanas.slice(-2);
  const sonoMedio = media(ult2.map((s) => s.sono).filter((x) => x != null));
  const treinosSem = media(ult2.map((s) => s.treinos));
  const avisos = [];
  if (sonoMedio != null && sonoMedio < 390) avisos.push(`sono médio de ${hm(sonoMedio)} nas últimas semanas (menos de 6h30 trava recuperação e apetite)`);
  if (treinosSem != null && treinosSem < 2.5 && treinos.length) avisos.push(`${treinosSem.toFixed(1).replace('.', ',')} treinos de força por semana (menos de 3 segura o ganho de massa)`);
  // a explicação depende do SENTIDO: balança abaixo do que a comida prevê não se explica por refeição esquecida (essa puxaria
  // a balança pra cima do previsto); até 09/10 o aviso dizia "refeição sem registro ou água" nos dois casos
  if (ritmoReal != null && ritmoBalanco != null && Math.abs(ritmoReal - ritmoBalanco) >= 0.2) {
    const segue = discordante ? '; o esperado segue a balança' : '';
    avisos.push(
      ritmoReal < ritmoBalanco
        ? `balança (${kgSinal(ritmoReal)}/sem) e comida (${kgSinal(ritmoBalanco)}/sem) discordam: a balança fica ABAIXO do que o registro prevê, então o relógio subestima o gasto e/ou as estimativas das fotos saem altas (refeição esquecida puxaria pro outro lado); água e sal mexem em dias, não em semanas${segue}`
        : `balança (${kgSinal(ritmoReal)}/sem) e comida (${kgSinal(ritmoBalanco)}/sem) discordam: a balança fica ACIMA do que o registro prevê, então tem refeição ou bebida sem registro, porção maior que a estimada, ou o relógio superestima o gasto${segue}`,
    );
  }

  // veredito (texto no jeito da linha de tendência; status no vocabulário dela: ok/abaixo/acima/acima_gordura/neutro)
  let veredito = 'sem direção clara';
  let status = 'neutro';
  const prazoInviavel = necessario != null && limiteSaudavel != null && Math.abs(necessario) > Math.abs(limiteSaudavel) * 1.05;
  const v = vr.veredito;
  // a incerteza aparece em todo veredito, inclusive no "no ritmo" (que antes saía sem ela justamente quando era incerto)
  const confTxt = v.confianca === 'media' ? `; provável (${Math.round(v.prob * 100)}%), não certo` : v.confianca === 'baixa' ? `; ainda incerto (${Math.round(v.prob * 100)}%)` : '';
  const jaChegou = metaPeso && falta != null && direcao && falta * direcao <= 0.1; // etapa alcançada (ou passada) no sentido do objetivo
  const chegadaTxt = metaPeso && direcao ? (jaChegou ? `; a etapa de ${kg1(metaPeso)} já foi alcançada` : chegada ? `; no ritmo esperado chega aos ${kg1(metaPeso)} em ${dmy(chegada.data)}${prazo ? ` (prazo ${dmy(prazo)})` : ''}` : '; nesse passo não chega') : '';
  const avisoPrazo = prazoInviavel ? `. Aviso: o prazo pedia ${kgSinal(necessario)}/semana, acima do saudável; a data realista é ${chegadaSaudavel ? dmy(chegadaSaudavel.data) : '?'}` : '';
  if (v.status === 'inconclusivo') veredito = ritmoEsperado == null ? 'ainda sem ritmo (preciso de mais pesagens)' : `ainda sem ritmo confiável (${vr.tend.motivo})`;
  else if (v.status === 'neutro' || !vr.direcao) veredito = `peso ${Math.abs(vr.tend.kgSemana) < 0.1 ? 'estável' : `${kgSinal(vr.tend.kgSemana)}/semana`}`;
  else {
    const dir = vr.direcao;
    const andando = vr.tend.kgSemana * dir; // positivo = na direção certa
    const gorduraSubindo = dir > 0 && gorduraPpSem != null && gorduraPpSem > 0.2;
    const magraCaindo = dir < 0 && magraSem != null && magraSem < -0.15;
    const contra = `${kgSinal(vr.tend.kgSemana)}/semana pela balança contra ${kgSinal(vr.alvo)} do alvo`;
    if (v.status === 'abaixo') {
      status = 'abaixo';
      // peso indo pro lado contrário é dito como tal (antes virava "estagnado: o peso não sobe" e a queda sumia do veredito)
      if (andando <= -0.05) veredito = `${dir > 0 ? 'peso caindo, contra o objetivo' : 'peso subindo, contra o objetivo'} (${contra}${confTxt})`;
      else if (andando < 0.05) veredito = `${dir > 0 ? 'estagnado: o peso não sobe' : 'estagnado: o peso não cai'} (${contra}${confTxt})`;
      else {
        const grau = dir * vr.alvo - andando <= Math.abs(vr.alvo) * 0.25 ? 'um pouco abaixo' : 'abaixo';
        veredito = `${grau} do ${metaPeso ? 'ritmo da etapa' : 'ritmo alvo'} (${contra}${confTxt})`;
      }
    } else if (v.status === 'acima') {
      veredito = `${dir > 0 ? 'subindo' : 'caindo'} mais rápido que o saudável (${kgSinal(vr.tend.kgSemana)}/semana, máximo ${kgSinal(vr.limite)}${confTxt})${gorduraSubindo ? ', e a gordura está subindo junto' : magraCaindo ? ', e está perdendo massa magra' : ''}`;
      status = gorduraSubindo || magraCaindo ? 'acima_gordura' : 'acima';
    } else {
      veredito = `${metaPeso ? 'no ritmo da etapa' : 'no caminho'} (${contra}${confTxt}${v.pRapido >= 0.2 ? `; pode estar passando do teto saudável (${Math.round(v.pRapido * 100)}%)` : ''})`;
      status = 'ok';
    }
    veredito += `${chegadaTxt}${avisoPrazo}`;
  }
  if (gorduraPpSem != null && direcao > 0 && gorduraPpSem > 0.2 && status === 'ok') veredito += `; atenção: gordura subindo ${gorduraPpSem.toFixed(1).replace('.', ',')} pp/semana`;

  // ---------- textos ----------
  const rotuloMeta = metaPeso ? `${kg1(metaPeso)}${prazo ? ` até ${dmy(prazo)}` : ''}${perfil.metaModo === 'etapa' ? ' (etapa)' : ''}` : null;
  const linhaSemana = (s) =>
    `${dmy(s.fim)}: ${kg1(s.peso)}${s.gordura != null ? ` · ${s.gordura.toFixed(1).replace('.', ',')}% gordura · ${kg1(s.magra)} magra` : ''}` +
    `${s.kcal != null ? ` · comeu ${Math.round(s.kcal).toLocaleString('pt-BR')}/dia` : ''}${s.gasto != null ? ` · gastou ${Math.round(s.gasto).toLocaleString('pt-BR')}` : ''}${s.balanco != null ? ` · balanço ${kcalSinal(s.balanco)}/dia` : ''}` +
    `${s.treinos ? ` · ${s.treinos} treino(s)` : ''}${s.sono != null ? ` · sono ${hm(s.sono)}` : ''} (${s.n} pesagem(ns))`;
  const maisMenos = (f) => (f.banda != null ? ` (±${f.banda.toFixed(1).replace('.', ',')})` : '');
  const linhaFuturo = (f) => `${dmy(f.fim)}: ${f.projetado != null ? kg1(f.projetado) : '?'}${maisMenos(f)}${f.linhaAlvo != null ? ` · linha da etapa ${kg1(f.linhaAlvo)}` : ''}${f.marcaPrazo ? ' ⬅ prazo' : ''}`;
  const txtJanela = chegada ? `Chegada aos ${kg1(metaPeso)} no ritmo esperado: ${dmy(chegada.data)} (${chegada.semanas} semanas${janelaChegada ? `; provável entre ${dmy(janelaChegada.cedo)} e ${janelaChegada.tarde ? dmy(janelaChegada.tarde) : 'sem data, se o ritmo cair pro limite baixo'}` : ''}).` : '';
  // o rótulo diz de onde veio o ritmo: 4 semanas, ou as últimas pesagens (quando o mês teve menos de 4)
  const rotuloRitmo = rec.length >= 4 ? 'balança, 4 semanas' : `balança, últimas ${base.length} pesagens desde ${dmy(base[0].dia)}`;
  const ritmos =
    `Ritmo real (${rotuloRitmo}): ${ritmoReal != null ? `${kgSinal(ritmoReal)}/semana` : '?'}` +
    `${ritmoBalanco != null ? `; pela comida (balanço médio ${kcalSinal(balancoDia)}/dia em ${comBalanco.reduce((a, s) => a + s.diasBalanco, 0)} dias com relógio e registro${corr.aplicado ? `, corrigido pelo seu histórico pra ${kcalSinal(balancoUsado)}` : ''}): ${kgSinal(ritmoBalanco)}/semana` : ''}` +
    `${ritmoEsperado != null ? `; esperado daqui pra frente${discordante ? ' (segue a balança: a comida discorda além do ruído)' : ''}: ${kgSinal(ritmoEsperado)}/semana${incerteza != null ? ` (incerteza ±${incerteza.toFixed(2).replace('.', ',')})` : ''}` : ''}` +
    `${alvoSem != null ? `; alvo (o mesmo da meta de calorias): ${kgSinal(alvoSem)}/semana` : ''}` +
    `${necessario != null ? `; necessário pra ${rotuloMeta}: ${kgSinal(necessario)}/semana${prazoInviavel ? ` (acima do saudável, máximo ${kgSinal(limiteSaudavel)})` : ''}` : ''}` +
    `${magraSem != null ? `; massa magra ${kgSinal(magraSem)}/semana, gordura ${kgSinal(gorduraSem)}/semana` : ''}.`;
  const texto =
    `LINHA DE TENDÊNCIA ATÉ A ETAPA${rotuloMeta ? ` (${rotuloMeta})` : ''}; peso atual ${kg1(pesoAtual)} (${ref.rotulo})${falta != null ? `, faltam ${kgSinal(falta)}` : ''}:\n` +
    `PASSADO (médias por semana, mais antiga -> mais nova; comida = kcal registradas, gasto = relógio):\n${semanas.map((s) => `- ${linhaSemana(s)}`).join('\n')}\n` +
    `${ritmos}\n` +
    `${txtComposicao ? `${txtComposicao}\n` : ''}` +
    `FUTURO (semana a semana no ritmo esperado, com a banda de incerteza · linha que chega na etapa no prazo):\n${futuro.map((f) => `- ${linhaFuturo(f)}`).join('\n')}\n` +
    `${txtJanela}${chegadaSaudavel && prazoInviavel ? ` No ritmo máximo saudável: ${dmy(chegadaSaudavel.data)}.` : ''}\n` +
    `${avisos.length ? `AVISOS: ${avisos.join('; ')}.\n` : ''}` +
    `VEREDITO: ${veredito}. (Bioimpedância oscila de um dia pro outro; o que vale é a tendência de semanas. Balanço energético usa 7.700 kcal por kg, uma aproximação; a banda de incerteza cresce com o horizonte. Como calcular e as fontes: documento "Como os números são calculados".)`;
  const textoCurto =
    `RITMO ATÉ A ETAPA${rotuloMeta ? ` (${rotuloMeta})` : ''}: peso atual ${kg1(pesoAtual)} (${ref.rotulo})${falta != null ? `, faltam ${kgSinal(falta)}` : ''}. ${ritmos} ` +
    `${chegada ? `Chegada no ritmo atual: ${dmy(chegada.data)}${janelaChegada ? ` (provável entre ${dmy(janelaChegada.cedo)} e ${janelaChegada.tarde ? dmy(janelaChegada.tarde) : 'sem data'})` : ''}. ` : ''}${composicao ? `Composição desde ${dmy(composicao.desde)}: peso ${kgSinal(composicao.dPeso)}, massa magra ${kgSinal(composicao.dMagra)}, gordura ${kgSinal(composicao.dGord)} (${descreverParte(composicao)}). ` : ''}VEREDITO: ${veredito}.${avisos.length ? ` Avisos: ${avisos.join('; ')}.` : ''}`;
  const icone = status === 'ok' ? '✅' : status === 'abaixo' ? '⚠️' : status === 'acima_gordura' ? '🛑' : status === 'acima' ? '⚠️' : '•';
  const zap =
    `📈 *Linha de tendência${rotuloMeta ? ` até ${rotuloMeta}` : ''}*\n${ref.rotulo[0].toUpperCase()}${ref.rotulo.slice(1)}: *${kg1(pesoAtual)}*${falta != null ? ` · faltam ${kgSinal(falta)}` : ''}\n\n` +
    `*Passado (média por semana)*\n${semanas.map((s) => `- ${dmy(s.fim)}: *${kg1(s.peso)}*${s.gordura != null ? ` · ${s.gordura.toFixed(1).replace('.', ',')}% · ${kg1(s.magra)} magra` : ''}${s.balanco != null ? ` · ${kcalSinal(s.balanco)}/dia` : ''}${s.treinos ? ` · ${s.treinos} treino(s)` : ''}${s.sono != null ? ` · sono ${hm(s.sono)}` : ''}`).join('\n')}\n\n` +
    `*Ritmo*\n- Balança (${rec.length >= 4 ? '4 sem.' : `últimas ${base.length} pesagens`}): ${ritmoReal != null ? `*${kgSinal(ritmoReal)}/semana*` : '?'}${ritmoBalanco != null ? `\n- Pela comida (${kcalSinal(balancoDia)}/dia${corr.aplicado ? `, corrigido pra ${kcalSinal(balancoUsado)}` : ''}): ${kgSinal(ritmoBalanco)}/semana` : ''}${ritmoEsperado != null ? `\n- Esperado pra projeção: ${kgSinal(ritmoEsperado)}/semana (±${incerteza.toFixed(2).replace('.', ',')})${discordante ? ' (segue a balança: a comida discorda)' : ''}` : ''}${alvoSem != null ? `\n- Alvo (o da meta de calorias): ${kgSinal(alvoSem)}/semana` : ''}${necessario != null ? `\n- Necessário pro prazo: ${kgSinal(necessario)}/semana${prazoInviavel ? ` (acima do saudável, máx. ${kgSinal(limiteSaudavel)})` : ''}` : ''}${magraSem != null ? `\n- Massa magra ${kgSinal(magraSem)} · gordura ${kgSinal(gorduraSem)} por semana` : ''}\n\n` +
    `${composicao ? `*Composição da mudança* (${dmy(composicao.desde)} → ${dmy(composicao.ate)})\n- Peso ${kgSinal(composicao.dPeso)}: massa magra ${kgSinal(composicao.dMagra)}, gordura ${kgSinal(composicao.dGord)}\n- Gordura de ${pct(composicao.gorduraDe)} para ${pct(composicao.gorduraPara)}: ${descreverParte(composicao)}${gorduraNaMeta != null ? `\n- Se seguir assim, em ${kg1(metaPeso)}: ~${pct(gorduraNaMeta)} de gordura, ${kg1(metaPeso * (1 - gorduraNaMeta / 100))} de massa magra` : ''}\n\n` : ''}` +
    `*Projeção* (ritmo atual ± incerteza · linha da etapa)\n${futuro.map((f) => `- ${dmy(f.fim)}: ${f.projetado != null ? kg1(f.projetado) : '?'}${maisMenos(f)}${f.linhaAlvo != null ? ` · ${kg1(f.linhaAlvo)}` : ''}${f.marcaPrazo ? ' ⬅ prazo' : ''}`).join('\n')}\n` +
    `${chegada ? `\nChegada aos ${kg1(metaPeso)} nesse ritmo: *${dmy(chegada.data)}*${janelaChegada ? ` (provável entre ${dmy(janelaChegada.cedo)} e ${janelaChegada.tarde ? dmy(janelaChegada.tarde) : 'sem data'})` : ''}` : ''}${chegadaSaudavel && prazoInviavel ? `\nNo ritmo máximo saudável: ${dmy(chegadaSaudavel.data)}` : ''}\n\n` +
    `*Veredito*\n${icone} ${veredito[0].toUpperCase()}${veredito.slice(1)}${avisos.length ? `\n\n*Avisos*\n${avisos.map((a) => `- ${a[0].toUpperCase()}${a.slice(1)}`).join('\n')}` : ''}`;
  const resumoZap =
    `• ${veredito[0].toUpperCase()}${veredito.slice(1)}` +
    `${ritmoBalanco != null ? `\n• Pela comida: ${kgSinal(ritmoBalanco)}/semana (balanço ${kcalSinal(balancoDia)}/dia)` : ''}` +
    `${magraSem != null ? `\n• Massa magra ${kgSinal(magraSem)} · gordura ${kgSinal(gorduraSem)} por semana` : ''}` +
    `${composicao ? `\n• Desde ${dmy(composicao.desde)}: ${descreverParte(composicao)}` : ''}`;
  return { semanas, pesoAtual, falta, ritmo: { real: ritmoReal, medido: ritmoMedido, balanco: ritmoBalanco, esperado: ritmoEsperado, alvo: alvoSem, necessario, necessarioSaudavel, limiteSaudavel }, discordante, julgamento: v, seSem, incerteza, balancoDia, balancoCorrigido: corr.aplicado ? balancoUsado : null, chegada, janelaChegada, chegadaSaudavel, prazoInviavel, futuro, composicao, gorduraNaMeta, veredito, status, ajusteKcal, magraSem, gorduraSem, gorduraPpSem, avisos, texto, textoCurto, zap, resumoZap };
}

/** Junta os dados da pessoa (120 dias de pesagens, 35 de comida, relógio, Hevy) e devolve projecaoAteMeta; null sem base. */
export async function tendenciaCompleta(perfil, dia) {
  if (!perfil?.jids?.length || !dia) return null;
  const [pesagens, refeicoes, saude, treinos] = await Promise.all([
    pesagensDesde(perfil.jids, diasAnteriores(dia, 120)[0]).catch(() => []),
    refeicoesDesde(perfil.jids, diasAnteriores(dia, 35)[0]).catch(() => []),
    colecao('saude_relogio').findOne({ _id: perfil.jids[0] }).catch(() => null),
    colecao('treinos').find({ jid: { $in: perfil.jids }, inicio: { $gte: new Date(Date.now() - 100 * 86400_000).toISOString() } }).project({ inicio: 1 }).toArray().catch(() => []),
  ]);
  if (pesagens.length < 4) return null;
  const faixa = faixaDaMeta(perfil, dia, pesagens); // a mesma faixa do !progresso, do !hoje e da meta de calorias
  return projecaoAteMeta({ perfil, dia, pesagens, refeicoes, gastos: perfil.relogio?.gastos || {}, sonos: saude?.sonos || [], treinos, faixa });
}
