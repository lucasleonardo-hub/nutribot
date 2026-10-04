// calibracao.js - Aprender com o próprio resultado: previsão -> resultado real -> erro -> ajuste progressivo -> nova previsão.
// Duas calibrações por pessoa, guardadas em perfil.calibracao:
//  - energia: viés do balanço registrado (comida − relógio) contra o que a balança mostrou, em kcal/dia. Positivo = comida
//    registrada e/ou relógio superestimam o superávit. Média móvel exponencial por semana (α 0,3), confiança cresce com as
//    semanas (4 semanas = 1), nunca reage a um dia só. A estimativa original fica nos registros; a corrigida é derivada.
//  - correcoes: o que as correções da própria pessoa ("eram 3 fatias", rótulo) dizem sobre as estimativas de foto: em que
//    direção erram, quanto e em que tipo de comida. Entra no prompt da análise de foto como "conte X com mais cuidado".
// Tudo puro exceto as funções com Mongo (registrarCorrecaoEstimativa, correcoesEstimativaDe, blocoCalibracao, calibrarNoDomingo).
import { colecao, salvarPerfil } from './mongo.js';

const KCAL_POR_KG = 7700;
const ALFA = 0.3; // passo da média móvel por semana: conservador
const MIN_DIAS_SEMANA = 4; // semana só conta com 4+ dias com comida completa e relógio
const VIES_MAX = 600; // kcal/dia; acima disso é dado quebrado, não viés
const SEMANAS_PARA_CONFIAR = 4;

const kcalS = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.round(Math.abs(n)).toLocaleString('pt-BR')} kcal`;

/** Puro. viés da semana = balanço registrado − balanço implícito pela balança (kcal/dia); null sem base. */
export function viesDaSemana(semana, ritmoBalancaKgSemana) {
  if (!semana || semana.balanco == null || !(semana.diasBalanco >= MIN_DIAS_SEMANA) || ritmoBalancaKgSemana == null) return null;
  const implicito = (ritmoBalancaKgSemana * KCAL_POR_KG) / 7;
  return Math.max(-VIES_MAX * 2, Math.min(VIES_MAX * 2, semana.balanco - implicito));
}

/**
 * Puro. Atualiza a calibração de energia com a última semana FECHADA (idx 1 de semanasPassadas) e o ritmo pela balança.
 * Uma semana só entra uma vez (ultimaSemana). Devolve a calibração de energia nova (ou a atual, se nada a fazer).
 */
export function atualizarCalibracaoEnergia(calibracaoAtual, { semanas = [], ritmoReal = null, dia } = {}) {
  const atual = calibracaoAtual?.energia || null;
  const fechadas = semanas.filter((s) => s.idx >= 1 && s.balanco != null && s.diasBalanco >= MIN_DIAS_SEMANA);
  const ultima = fechadas[fechadas.length - 1];
  if (!ultima || ritmoReal == null) return atual;
  if (atual?.ultimaSemana === ultima.fim) return atual;
  const vies = viesDaSemana(ultima, ritmoReal);
  if (vies == null) return atual;
  const n = (atual?.semanas || 0) + 1;
  const anterior = atual?.viesKcalDia ?? vies; // primeira semana parte do próprio valor, mas com confiança baixa
  const novo = anterior + ALFA * (vies - anterior);
  const viesKcalDia = Math.round(Math.max(-VIES_MAX, Math.min(VIES_MAX, novo)));
  const confianca = Math.round(Math.min(1, n / SEMANAS_PARA_CONFIAR) * 100) / 100;
  const historico = [...(atual?.historico || []), { semana: ultima.fim, vies: Math.round(vies), balanco: Math.round(ultima.balanco), ritmo: Math.round(ritmoReal * 100) / 100 }].slice(-12);
  return { viesKcalDia, confianca, semanas: n, ultimaSemana: ultima.fim, atualizadoEm: dia || null, historico };
}

/** Puro. Balanço registrado corrigido pelo viés aprendido: só com confiança >= 0,5, e proporcional à confiança. */
export function corrigirBalanco(balancoRegistrado, calibracao) {
  const e = calibracao?.energia;
  if (balancoRegistrado == null || !e || !(e.confianca >= 0.5) || !Number.isFinite(e.viesKcalDia)) return { valor: balancoRegistrado, aplicado: false, ajuste: 0 };
  const ajuste = -e.viesKcalDia * Math.min(1, e.confianca);
  return { valor: balancoRegistrado + ajuste, aplicado: true, ajuste };
}

const nivelConfianca = (c) => (c >= 0.75 ? 'alta' : c >= 0.5 ? 'média' : 'baixa');

/** Puro. Linha pro prompt sobre o viés de energia ('' sem calibração útil). */
export function descreverCalibracaoEnergia(calibracao) {
  const e = calibracao?.energia;
  if (!e || !(e.semanas >= 1)) return '';
  const direcao = e.viesKcalDia > 60 ? 'ACIMA' : e.viesKcalDia < -60 ? 'ABAIXO' : 'perto';
  if (direcao === 'perto') return `CALIBRAÇÃO DO BALANÇO (${e.semanas} semana(s), confiança ${nivelConfianca(e.confianca)}): comida registrada e relógio batem com a balança (viés ${kcalS(e.viesKcalDia)}/dia). Pode confiar nos totais do dia.`;
  return (
    `CALIBRAÇÃO DO BALANÇO (${e.semanas} semana(s), confiança ${nivelConfianca(e.confianca)}): o balanço registrado (comida − relógio) tende a ficar ${kcalS(e.viesKcalDia)}/dia ${direcao} do que a balança mostra. ` +
    (direcao === 'ACIMA' ? 'Ou a comida registrada sai alta na estimativa, ou o relógio subestima o gasto: ao ler totais e ritmo, desconte isso em vez de cobrar superávit que não aparece no peso.' : 'Ou tem refeição sem registro, ou o relógio superestima o gasto: ao ler totais, considere que a pessoa come mais do que registra.') +
    (e.confianca < 0.5 ? ' (Ainda com poucas semanas: use como suspeita, não como fato.)' : '')
  );
}

// ---------- correções da própria pessoa ----------
const CATEGORIAS = [
  ['pão', /p[ãa]o|torrada|bisnaga|baguete|p[ãa]es/i],
  ['arroz/massa', /arroz|macarr|massa|lasanha|nhoque|batata|mandioca|aipim/i],
  ['carne/proteína', /carne|bife|frango|peixe|ovo|lingui|hamb|salsicha|atum|whey|prote/i],
  ['doce', /doce|bolo|brownie|cookie|chocolate|sobremesa|a[çc][úu]car|sorvete|brigadeiro/i],
  ['bebida', /suco|refri|leite|caf[ée]|cerveja|vinho|shake|hipercal|vitamina/i],
  ['gordura/molho', /azeite|[óo]leo|manteiga|maionese|molho|queijo|requeij|creme/i],
];
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Puro. Estatística das correções: direção e tamanho do erro da estimativa inicial, e por tipo de comida. null sem correções válidas. */
export function estatisticasCorrecoes(correcoes = []) {
  const validas = correcoes.filter((c) => Number(c?.antes?.kcal) > 0 && Number(c?.depois?.kcal) > 0);
  if (!validas.length) return null;
  const razoes = validas.map((c) => Number(c.depois.kcal) / Number(c.antes.kcal));
  const paraCima = validas.filter((c) => Number(c.depois.kcal) > Number(c.antes.kcal) * 1.05).length;
  const paraBaixo = validas.filter((c) => Number(c.depois.kcal) < Number(c.antes.kcal) * 0.95).length;
  const porCategoria = new Map();
  for (const c of validas) {
    const alvo = `${c.descricao || ''} ${c.texto || ''}`;
    for (const [nome, re] of CATEGORIAS) {
      if (!re.test(alvo)) continue;
      const x = porCategoria.get(nome) || { n: 0, razoes: [] };
      x.n += 1;
      x.razoes.push(Number(c.depois.kcal) / Number(c.antes.kcal));
      porCategoria.set(nome, x);
    }
  }
  const categorias = [...porCategoria.entries()].filter(([, x]) => x.n >= 2).map(([nome, x]) => ({ nome, n: x.n, mediana: mediana(x.razoes) }));
  return { n: validas.length, mediana: mediana(razoes), paraCima, paraBaixo, categorias, confianca: Math.round(Math.min(1, validas.length / 8) * 100) / 100 };
}

const pctDe = (razao) => `${Math.round(Math.abs(razao - 1) * 100)}%`;

/** Puro. Bloco pro prompt da análise de foto ('' com menos de 3 correções). */
export function descreverCorrecoes(nome, stats) {
  if (!stats || stats.n < 3) return '';
  const primeiro = String(nome || '').split(' ')[0];
  const dir = stats.mediana >= 1.08 ? `ficou em mediana ${pctDe(stats.mediana)} ABAIXO do real (${primeiro} corrige pra cima)` : stats.mediana <= 0.92 ? `ficou em mediana ${pctDe(stats.mediana)} ACIMA do real (${primeiro} corrige pra baixo)` : 'ficou perto do real (as correções foram pequenas ou nos dois sentidos)';
  const cats = stats.categorias
    .filter((c) => Math.abs(c.mediana - 1) >= 0.08)
    .map((c) => `${c.nome} ${c.mediana > 1 ? 'subestimado' : 'superestimado'} em ~${pctDe(c.mediana)} (${c.n}x)`)
    .join('; ');
  return (
    `CALIBRAÇÃO DAS SUAS ESTIMATIVAS PARA ${primeiro.toUpperCase()} (pelas ${stats.n} correções que ${primeiro} mesmo(a) fez; confiança ${nivelConfianca(stats.confianca)}): a estimativa inicial ${dir}; ${stats.paraCima} correção(ões) pra cima, ${stats.paraBaixo} pra baixo.` +
    (cats ? ` Por tipo: ${cats}.` : '') +
    ' Use pra olhar com mais cuidado (contar unidades, fatias, colheres, gordura escondida) nesses itens, sem aplicar fator cego: a leitura da foto continua mandando.'
  );
}

// ---------- Mongo ----------
/** Guarda uma correção de estimativa (antes x depois). Nunca lança. */
export async function registrarCorrecaoEstimativa({ jid, nome, dia, slot, antes, depois, origem = 'correcao', descricao = '', texto = '' }) {
  try {
    if (!jid || !(Number(antes?.kcal) > 0) || !(Number(depois?.kcal) > 0)) return false;
    await colecao('correcoes_estimativa').insertOne({ jid, nome, dia, slot: slot || null, antes: { kcal: Number(antes.kcal), p: antes.p ?? null }, depois: { kcal: Number(depois.kcal), p: depois.p ?? null }, origem, descricao: String(descricao || '').slice(0, 160), texto: String(texto || '').slice(0, 200), criadoEm: new Date() });
    return true;
  } catch (e) {
    console.warn('[calibracao] correção não gravada:', e.message);
    return false;
  }
}

export async function correcoesEstimativaDe(jids, limite = 40) {
  if (!jids?.length) return [];
  return colecao('correcoes_estimativa').find({ jid: { $in: jids } }).sort({ criadoEm: -1 }).limit(limite).toArray().catch(() => []);
}

/** Bloco completo pro prompt (energia + correções). '' sem nada útil. */
export async function blocoCalibracao(perfil) {
  if (!perfil) return '';
  const partes = [];
  const energia = descreverCalibracaoEnergia(perfil.calibracao);
  if (energia) partes.push(energia);
  const stats = estatisticasCorrecoes(await correcoesEstimativaDe(perfil.jids));
  const corr = descreverCorrecoes(perfil.nome, stats);
  if (corr) partes.push(corr);
  return partes.join('\n');
}

/** Domingo: atualiza perfil.calibracao.energia com as semanas da tendência. Devolve a calibração nova (ou null). */
export async function calibrarNoDomingo(perfil, dia, { semanas = [], ritmoReal = null } = {}) {
  const energia = atualizarCalibracaoEnergia(perfil?.calibracao, { semanas, ritmoReal, dia });
  if (!energia || energia === perfil?.calibracao?.energia) return perfil?.calibracao || null;
  const calibracao = { ...(perfil.calibracao || {}), energia };
  await salvarPerfil({ jids: perfil.jids, calibracao }).catch((e) => console.warn('[calibracao] não salvou:', e.message));
  console.log(`[calibracao] ${perfil.nome.split(' ')[0]}: viés do balanço ${energia.viesKcalDia > 0 ? '+' : ''}${energia.viesKcalDia} kcal/dia (${energia.semanas} semana(s), confiança ${energia.confianca})`);
  return calibracao;
}

// Só correção que ensina algo sobre a ESTIMATIVA entra na calibração: quantidade ("eram 3 fatias"), identidade do alimento
// ("não é picanha, é fígado") ou rótulo/tabela. Acréscimo de item ("tem também um suco", "esqueci do pão") não é erro de
// estimativa, é refeição incompleta; contado como correção, inflaria o "subestima" sem motivo.
const RE_ACRESCIMO = /tamb[ée]m|esqueci|faltou|al[ée]m d|\be (um|uma|mais|dois|duas|tr[êe]s)\b|junto (com|tinha)|acompanh/i;
const RE_QUANTIDADE = /\b(era[m]?|foram|foi|s[ãa]o|tinha)\s+(uns |umas |s[óo] |apenas )?\d|\b\d+([.,]\d+)?\s?(g|ml|kg|l|fatias?|unidades?|colheres?|copos?|x[íi]caras?|por[çc][õo]es?|peda[çc]os?|conchas?|bolas?|scoops?)\b|n[ãa]o (é|era|foi|eram|foram)(\s|$)/i; // sem \b depois do "é": acento não é "palavra" pro regex sem flag u
const RE_ESTIMATIVA = /na verdade|na real|r[óo]tulo|tabela|valores? (certos?|exatos?|reais?)|(bem |um pouco |muito )?(menos|mais) (do )?que (isso|isto|aí)|metade|o dobro|pequen|grande|maior|menor|exager|chut|errou|t[áa] (alto|baixo|errado)|muito (alto|baixo|pouco)/i;
/** A mensagem corrige a estimativa (quantidade, alimento, rótulo) e não só acrescenta item? Pura. */
export function ehCorrecaoDeEstimativa(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  if (RE_QUANTIDADE.test(t)) return true; // "esqueci de falar: eram 3 fatias" conta, há quantidade
  return RE_ESTIMATIVA.test(t) && !RE_ACRESCIMO.test(t);
}
