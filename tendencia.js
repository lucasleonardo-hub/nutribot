// tendencia.js - Linha de tendência completa: o passado (todas as semanas com pesagem, até 12) e o futuro (semana a semana
// até a etapa), cruzando balança e bioimpedância, comida registrada, gasto do relógio, treinos de força e sono.
// projecaoAteMeta é pura (dá pra testar); tendenciaCompleta junta os dados do Mongo e a faixa da meta.
import { pesagensDesde, refeicoesDesde, colecao } from './mongo.js';
import { metaBalancoPara, tendenciaGordura } from './resumo.js';
import { faixaSaudavel } from './previsao.js';
import { diasAnteriores } from './util.js';

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
/** Inclinação por regressão linear (unidade de y por unidade de x); null com menos de 3 pontos ou x todo igual. */
const inclinacao = (xs, ys) => {
  if (xs.length < 3) return null;
  const mx = media(xs);
  const my = media(ys);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!den) return null;
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
};

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
  for (const r of refeicoes) {
    const kcal = Number(r?.estimativa?.kcal ?? r?.kcal) || 0; // o registro guarda a estimativa em estimativa.kcal
    if (!r?.dia || r.dia >= dia || !(kcal > 0)) continue; // hoje ainda está incompleto
    const idx = idxDe(r.dia);
    if (!cabe(idx)) continue;
    const s = semana(idx);
    s.kcalDias.set(r.dia, (s.kcalDias.get(r.dia) || 0) + kcal);
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
      const diasComida = [...s.kcalDias.entries()].filter(([, k]) => k >= 500); // menos que isso é dia mal registrado: não entra no balanço
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
  const pts = pesagens.filter((p) => p?.peso > 0 && p.dia && p.dia <= dia).sort((a, b) => a.dia.localeCompare(b.dia));
  if (pts.length < 4 || !dia) return null;
  const semanas = semanasPassadas({ pesagens: pts, refeicoes, gastos, sonos, treinos, dia });
  if (!semanas.length) return null;
  const objetivo = String(perfil.objetivo || '');
  const querGanhar = /hipertrof|ganh|massa|bulk|for[çc]a/i.test(objetivo);
  const querPerder = !querGanhar && /emagre|perd|reduz|defin|secar|gordura/i.test(objetivo);
  const direcao = querGanhar ? 1 : querPerder ? -1 : 0;

  // ritmo real: regressão nas pesagens das últimas 4 semanas (ou nas últimas 6 pesagens, se forem poucas)
  const rec = pts.filter((p) => distDias(p.dia, dia) <= 27);
  const base = rec.length >= 4 ? rec : pts.slice(-6);
  const x0 = base[0].dia;
  const porDia = inclinacao(base.map((p) => distDias(x0, p.dia)), base.map((p) => Number(p.peso)));
  const ritmoReal = porDia != null ? porDia * 7 : null;
  const comG = base.filter((p) => p.gordura != null && Number(p.gordura) > 0);
  const magraSem = comG.length >= 4 ? inclinacao(comG.map((p) => distDias(x0, p.dia)), comG.map((p) => Number(p.peso) * (1 - Number(p.gordura) / 100))) * 7 : null;
  const gorduraSem = comG.length >= 4 ? inclinacao(comG.map((p) => distDias(x0, p.dia)), comG.map((p) => Number(p.peso) * (Number(p.gordura) / 100))) * 7 : null;
  const gorduraPpSem = comG.length >= 4 ? inclinacao(comG.map((p) => distDias(x0, p.dia)), comG.map((p) => Number(p.gordura))) * 7 : null;
  const daSemana = pts.filter((p) => distDias(p.dia, dia) <= 6).map((p) => Number(p.peso));
  const pesoAtual = Math.round((media(daSemana) ?? Number(pts[pts.length - 1].peso)) * 100) / 100;

  // ritmo pelo balanço energético: comida registrada − gasto do relógio, nas últimas 3 semanas com 3+ dias completos
  const comBalanco = semanas.filter((s) => s.balanco != null && s.diasBalanco >= 3).slice(-3);
  const balancoDia = comBalanco.length ? media(comBalanco.map((s) => s.balanco)) : null;
  const ritmoBalanco = balancoDia != null ? (balancoDia * 7) / KCAL_POR_KG : null;
  // esperado daqui pra frente: média dos dois quando há os dois (balança oscila com água; comida registrada tende a subestimar)
  const ritmoEsperado = ritmoReal != null && ritmoBalanco != null ? (ritmoReal + ritmoBalanco) / 2 : ritmoReal ?? ritmoBalanco;

  const alvoSem = faixa?.ritmoKgSemana ?? null;
  const metaPeso = Number(perfil.metaPeso) > 0 ? Number(perfil.metaPeso) : null;
  const prazo = perfil.metaPrazo && /^\d{4}-\d{2}-\d{2}$/.test(perfil.metaPrazo) ? perfil.metaPrazo : null;
  const semanasAtePrazo = prazo ? Math.max(0, Math.ceil(distDias(dia, prazo) / 7)) : null;
  const falta = metaPeso ? Math.round((metaPeso - pesoAtual) * 100) / 100 : null;
  const necessario = falta != null && semanasAtePrazo > 0 ? falta / semanasAtePrazo : null;
  const saud = faixaSaudavel({ peso: pesoAtual, ganho: querGanhar });
  const limiteSaudavel = saud ? (querGanhar ? saud.max : saud.min) : null; // kg/semana, com o sinal da direção
  const necessarioSaudavel = necessario != null && limiteSaudavel != null && Math.abs(necessario) > Math.abs(limiteSaudavel) ? limiteSaudavel : necessario;

  // chegada à meta no ritmo esperado (só se está andando na direção certa)
  let chegada = null;
  if (metaPeso && falta != null && ritmoEsperado != null && Math.abs(ritmoEsperado) >= 0.03 && Math.sign(falta) === Math.sign(ritmoEsperado) && Math.abs(falta) > 0.1) {
    const sem = Math.ceil(Math.abs(falta) / Math.abs(ritmoEsperado));
    if (sem <= 104) chegada = { semanas: sem, data: somarDias(dia, sem * 7) };
  }
  let chegadaSaudavel = null;
  if (metaPeso && falta != null && limiteSaudavel != null && Math.sign(falta) === Math.sign(limiteSaudavel) && Math.abs(falta) > 0.1) {
    const sem = Math.ceil(Math.abs(falta) / Math.abs(limiteSaudavel));
    chegadaSaudavel = { semanas: sem, data: somarDias(dia, sem * 7) };
  }

  // futuro semana a semana: até o prazo da etapa (ou até chegar), no mínimo 4 e no máximo 20 semanas
  const horizonte = Math.min(MAX_SEMANAS_FUTURAS, Math.max(semanasAtePrazo || 0, chegada?.semanas || 0, 4));
  const futuro = [];
  for (let i = 1; i <= horizonte; i++) {
    const fim = somarDias(dia, i * 7);
    const linhaAlvo = necessario != null ? pesoAtual + necessario * i : alvoSem != null ? pesoAtual + alvoSem * i : null;
    futuro.push({ fim, projetado: ritmoEsperado != null ? pesoAtual + ritmoEsperado * i : null, linhaAlvo, marcaPrazo: Boolean(prazo && fim >= prazo && somarDias(fim, -7) < prazo) });
  }
  // kcal/dia a mais (ou a menos) pra andar na linha do prazo, dentro do saudável
  const ajusteKcal = necessarioSaudavel != null && ritmoEsperado != null ? ((necessarioSaudavel - ritmoEsperado) * KCAL_POR_KG) / 7 : null;

  // sinais de contexto (últimas 2 semanas com dado)
  const ult2 = semanas.slice(-2);
  const sonoMedio = media(ult2.map((s) => s.sono).filter((x) => x != null));
  const treinosSem = media(ult2.map((s) => s.treinos));
  const avisos = [];
  if (sonoMedio != null && sonoMedio < 390) avisos.push(`sono médio de ${hm(sonoMedio)} nas últimas semanas (menos de 6h30 trava recuperação e apetite)`);
  if (treinosSem != null && treinosSem < 2.5 && treinos.length) avisos.push(`${treinosSem.toFixed(1).replace('.', ',')} treinos de força por semana (menos de 3 segura o ganho de massa)`);
  if (ritmoReal != null && ritmoBalanco != null && Math.abs(ritmoReal - ritmoBalanco) >= 0.2) avisos.push(`balança (${kgSinal(ritmoReal)}/sem) e comida (${kgSinal(ritmoBalanco)}/sem) discordam: ou tem refeição sem registro, ou é água (creatina, sal, sono)`);

  // veredito
  let veredito = 'sem direção clara';
  let status = 'neutro';
  const prazoInviavel = necessario != null && limiteSaudavel != null && Math.abs(necessario) > Math.abs(limiteSaudavel) * 1.05;
  if (ritmoEsperado == null) veredito = 'ainda sem ritmo (preciso de mais pesagens)';
  else if (direcao === 0) veredito = `peso ${Math.abs(ritmoEsperado) < 0.1 ? 'estável' : `${kgSinal(ritmoEsperado)}/semana`}`;
  else {
    const andando = ritmoEsperado * direcao; // positivo = na direção certa
    const limite = Math.abs(limiteSaudavel || 0);
    const gorduraSubindo = direcao > 0 && gorduraPpSem != null && gorduraPpSem > 0.2;
    const magraCaindo = direcao < 0 && magraSem != null && magraSem < -0.15;
    if (andando < 0.05) {
      veredito = direcao > 0 ? 'estagnado: o peso não sobe' : 'estagnado: o peso não cai';
      status = 'abaixo';
    } else if (limite && andando > limite * 1.15) {
      veredito = `${direcao > 0 ? 'subindo' : 'caindo'} mais rápido que o saudável (${kgSinal(ritmoEsperado)}/semana, máximo ${kgSinal(limiteSaudavel)})${gorduraSubindo ? ', e a gordura está subindo junto' : magraCaindo ? ', e está perdendo massa magra' : ''}`;
      status = gorduraSubindo || magraCaindo ? 'acima_gordura' : 'acima';
    } else if (necessario != null) {
      // o que decide é a DATA: chegar até 1 semana depois do prazo é ritmo; até 4 semanas é 'um pouco abaixo'; mais é abaixo
      const atrasoSem = chegada && prazo ? distDias(prazo, chegada.data) / 7 : null;
      const compara = `${kgSinal(ritmoEsperado)}/semana contra ${kgSinal(necessarioSaudavel)} necessários`;
      if (atrasoSem != null && atrasoSem <= 1) {
        veredito = `no ritmo da etapa (${compara}); nesse passo chega aos ${kg1(metaPeso)} em ${dmy(chegada.data)}${prazoInviavel ? `. Aviso: o prazo pedia ${kgSinal(necessario)}/semana, acima do saudável; a data realista é ${chegadaSaudavel ? dmy(chegadaSaudavel.data) : '?'}` : ''}`;
        status = 'ok';
      } else {
        const grau = atrasoSem != null && atrasoSem <= 4 ? 'um pouco abaixo' : 'abaixo';
        veredito = `${grau} do ritmo da etapa (${compara})${chegada ? `: nesse passo os ${kg1(metaPeso)} ficam pra ${dmy(chegada.data)}, ${Math.max(1, Math.round(atrasoSem))} semana(s) depois de ${dmy(prazo)}` : ': nesse passo não chega'}${ajusteKcal != null && ajusteKcal > 0 ? `; pra entrar na linha: ${kcalSinal(ajusteKcal)}/dia a mais` : ''}`;
        status = 'abaixo';
      }
    } else if (alvoSem != null) {
      const dentro = andando >= Math.abs(alvoSem) - 0.12;
      veredito = dentro ? `no caminho (${kgSinal(ritmoEsperado)}/semana, alvo ${kgSinal(alvoSem)})` : `abaixo do ritmo alvo (${kgSinal(ritmoEsperado)} contra ${kgSinal(alvoSem)}/semana)`;
      status = dentro ? 'ok' : 'abaixo';
    } else {
      veredito = `${direcao > 0 ? 'subindo' : 'caindo'} ${kgSinal(ritmoEsperado)}/semana`;
      status = 'ok';
    }
  }
  if (gorduraPpSem != null && direcao > 0 && gorduraPpSem > 0.2 && status === 'ok') veredito += `; atenção: gordura subindo ${gorduraPpSem.toFixed(1).replace('.', ',')} pp/semana`;

  // ---------- textos ----------
  const rotuloMeta = metaPeso ? `${kg1(metaPeso)}${prazo ? ` até ${dmy(prazo)}` : ''}${perfil.metaModo === 'etapa' ? ' (etapa)' : ''}` : null;
  const linhaSemana = (s) =>
    `${dmy(s.fim)}: ${kg1(s.peso)}${s.gordura != null ? ` · ${s.gordura.toFixed(1).replace('.', ',')}% gordura · ${kg1(s.magra)} magra` : ''}` +
    `${s.kcal != null ? ` · comeu ${Math.round(s.kcal).toLocaleString('pt-BR')}/dia` : ''}${s.gasto != null ? ` · gastou ${Math.round(s.gasto).toLocaleString('pt-BR')}` : ''}${s.balanco != null ? ` · balanço ${kcalSinal(s.balanco)}/dia` : ''}` +
    `${s.treinos ? ` · ${s.treinos} treino(s)` : ''}${s.sono != null ? ` · sono ${hm(s.sono)}` : ''} (${s.n} pesagem(ns))`;
  const linhaFuturo = (f) => `${dmy(f.fim)}: ${f.projetado != null ? kg1(f.projetado) : '?'}${f.linhaAlvo != null ? ` · linha da etapa ${kg1(f.linhaAlvo)}` : ''}${f.marcaPrazo ? ' ⬅ prazo' : ''}`;
  const ritmos =
    `Ritmo real (balança, 4 semanas): ${ritmoReal != null ? `${kgSinal(ritmoReal)}/semana` : '?'}` +
    `${ritmoBalanco != null ? `; pela comida (balanço médio ${kcalSinal(balancoDia)}/dia em ${comBalanco.reduce((a, s) => a + s.diasBalanco, 0)} dias com relógio e registro): ${kgSinal(ritmoBalanco)}/semana` : ''}` +
    `${ritmoEsperado != null ? `; esperado daqui pra frente: ${kgSinal(ritmoEsperado)}/semana` : ''}` +
    `${alvoSem != null ? `; alvo da faixa: ${kgSinal(alvoSem)}/semana` : ''}` +
    `${necessario != null ? `; necessário pra ${rotuloMeta}: ${kgSinal(necessario)}/semana${prazoInviavel ? ` (acima do saudável, máximo ${kgSinal(limiteSaudavel)})` : ''}` : ''}` +
    `${magraSem != null ? `; massa magra ${kgSinal(magraSem)}/semana, gordura ${kgSinal(gorduraSem)}/semana` : ''}.`;
  const texto =
    `LINHA DE TENDÊNCIA ATÉ A ETAPA${rotuloMeta ? ` (${rotuloMeta})` : ''}; peso atual ${kg1(pesoAtual)}${falta != null ? `, faltam ${kgSinal(falta)}` : ''}:\n` +
    `PASSADO (médias por semana, mais antiga -> mais nova; comida = kcal registradas, gasto = relógio):\n${semanas.map((s) => `- ${linhaSemana(s)}`).join('\n')}\n` +
    `${ritmos}\n` +
    `FUTURO (semana a semana no ritmo esperado · linha que chega na etapa no prazo):\n${futuro.map((f) => `- ${linhaFuturo(f)}`).join('\n')}\n` +
    `${chegada ? `Chegada aos ${kg1(metaPeso)} no ritmo esperado: ${dmy(chegada.data)} (${chegada.semanas} semanas).` : ''}${chegadaSaudavel && prazoInviavel ? ` No ritmo máximo saudável: ${dmy(chegadaSaudavel.data)}.` : ''}\n` +
    `${avisos.length ? `AVISOS: ${avisos.join('; ')}.\n` : ''}` +
    `VEREDITO: ${veredito}. (Bioimpedância oscila de um dia pro outro; o que vale é a tendência de semanas. Balanço energético usa 7.700 kcal por kg, uma aproximação.)`;
  const textoCurto =
    `RITMO ATÉ A ETAPA${rotuloMeta ? ` (${rotuloMeta})` : ''}: peso ${kg1(pesoAtual)}${falta != null ? `, faltam ${kgSinal(falta)}` : ''}. ${ritmos} ` +
    `${chegada ? `Chegada no ritmo atual: ${dmy(chegada.data)}. ` : ''}VEREDITO: ${veredito}.${avisos.length ? ` Avisos: ${avisos.join('; ')}.` : ''}`;
  const icone = status === 'ok' ? '✅' : status === 'abaixo' ? '⚠️' : status === 'acima_gordura' ? '🛑' : status === 'acima' ? '⚠️' : '•';
  const zap =
    `📈 *Linha de tendência${rotuloMeta ? ` até ${rotuloMeta}` : ''}*\nPeso atual: *${kg1(pesoAtual)}*${falta != null ? ` · faltam ${kgSinal(falta)}` : ''}\n\n` +
    `*Passado (média por semana)*\n${semanas.map((s) => `- ${dmy(s.fim)}: *${kg1(s.peso)}*${s.gordura != null ? ` · ${s.gordura.toFixed(1).replace('.', ',')}% · ${kg1(s.magra)} magra` : ''}${s.balanco != null ? ` · ${kcalSinal(s.balanco)}/dia` : ''}${s.treinos ? ` · ${s.treinos} treino(s)` : ''}${s.sono != null ? ` · sono ${hm(s.sono)}` : ''}`).join('\n')}\n\n` +
    `*Ritmo*\n- Balança (4 sem.): ${ritmoReal != null ? `${kgSinal(ritmoReal)}/semana` : '?'}${ritmoBalanco != null ? `\n- Pela comida (${kcalSinal(balancoDia)}/dia): ${kgSinal(ritmoBalanco)}/semana` : ''}${ritmoEsperado != null ? `\n- Esperado: *${kgSinal(ritmoEsperado)}/semana*` : ''}${necessario != null ? `\n- Necessário pra etapa: ${kgSinal(necessario)}/semana${prazoInviavel ? ` (acima do saudável, máx. ${kgSinal(limiteSaudavel)})` : ''}` : alvoSem != null ? `\n- Alvo: ${kgSinal(alvoSem)}/semana` : ''}${magraSem != null ? `\n- Massa magra ${kgSinal(magraSem)} · gordura ${kgSinal(gorduraSem)} por semana` : ''}\n\n` +
    `*Projeção* (ritmo atual · linha da etapa)\n${futuro.map((f) => `- ${dmy(f.fim)}: ${f.projetado != null ? kg1(f.projetado) : '?'}${f.linhaAlvo != null ? ` · ${kg1(f.linhaAlvo)}` : ''}${f.marcaPrazo ? ' ⬅ prazo' : ''}`).join('\n')}\n` +
    `${chegada ? `\nChegada aos ${kg1(metaPeso)} nesse ritmo: *${dmy(chegada.data)}*` : ''}${chegadaSaudavel && prazoInviavel ? `\nNo ritmo máximo saudável: ${dmy(chegadaSaudavel.data)}` : ''}\n\n` +
    `*Veredito*\n${icone} ${veredito[0].toUpperCase()}${veredito.slice(1)}${avisos.length ? `\n\n*Avisos*\n${avisos.map((a) => `- ${a[0].toUpperCase()}${a.slice(1)}`).join('\n')}` : ''}`;
  const resumoZap =
    `• ${veredito[0].toUpperCase()}${veredito.slice(1)}` +
    `${ritmoBalanco != null ? `\n• Pela comida: ${kgSinal(ritmoBalanco)}/semana (balanço ${kcalSinal(balancoDia)}/dia)` : ''}` +
    `${magraSem != null ? `\n• Massa magra ${kgSinal(magraSem)} · gordura ${kgSinal(gorduraSem)} por semana` : ''}`;
  return { semanas, pesoAtual, falta, ritmo: { real: ritmoReal, balanco: ritmoBalanco, esperado: ritmoEsperado, alvo: alvoSem, necessario, necessarioSaudavel, limiteSaudavel }, balancoDia, chegada, chegadaSaudavel, prazoInviavel, futuro, veredito, status, ajusteKcal, magraSem, gorduraSem, gorduraPpSem, avisos, texto, textoCurto, zap, resumoZap };
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
  const pesoAtual = [...pesagens].sort((a, b) => a.dia.localeCompare(b.dia)).pop()?.peso || perfil.peso;
  const faixa = metaBalancoPara({ objetivo: perfil.objetivo, peso: pesoAtual, metaPeso: perfil.metaPeso, metaPrazo: perfil.metaPrazo, dia, ritmo: perfil.ritmo, metaModo: perfil.metaModo, gorduraTend: tendenciaGordura(pesagens.filter((p) => p.dia >= diasAnteriores(dia, 28)[0])) });
  return projecaoAteMeta({ perfil, dia, pesagens, refeicoes, gastos: perfil.relogio?.gastos || {}, sonos: saude?.sonos || [], treinos, faixa });
}
