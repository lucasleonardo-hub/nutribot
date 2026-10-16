// auditoria.js - "Desconfiômetro" em código (15/10, pedido do dono: a bot não pode aceitar dado absurdo passivamente).
// Funções puras, sem IA: a refeição com número fisicamente impossível ou muito improvável NÃO é gravada na hora; a bot
// pergunta, e a confirmação ("isso, 40 g") grava. Treino: salto de carga irreal no Hevy (30 kg -> 80 kg) não vira base de
// sugestão e a Nutri pergunta. Regras conservadoras de propósito: pergunta demais também piora a bot (e uma refeição
// pendente sem resposta se perde), então só entra o que é quase certamente erro de digitação ou de unidade.

/** Quanto cada suplemento em pó cabe numa tomada (acima disso, provável zero a mais: "400 g de whey"). */
export const DOSE_MAXIMA_G = [
  { re: /\bwhey\b|prote[ií]na em p[oó]|isolad[ao] de prote[ií]na|\bcase[ií]na\b|\bpea protein\b/i, max: 100, nome: 'whey' },
  { re: /\balbumina\b/i, max: 100, nome: 'albumina' },
  { re: /\bcreatina\b/i, max: 30, nome: 'creatina' },
  { re: /\bhipercal[oó]rico\b|\bmass(a)? gainer\b/i, max: 300, nome: 'hipercalórico' },
];
/** Teto de uma refeição: acima disso, quase sempre é erro de quantidade (ou o dia inteiro mandado como uma refeição). */
export const TETO_REFEICAO = { kcal: 3000, proteina: 200 };
/** Um alimento sozinho acima disso (em gramas) numa refeição. */
export const TETO_ITEM_G = 1500;

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Puro. Quantidades em gramas ditas no texto, com o trecho logo depois do número ("400 g de whey" -> { g: 400, depois }). */
export function quantidadesEmGramas(texto) {
  const out = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(kg|quilos?|g|gr|gramas?)\b([^,;.\n]{0,40})/gi;
  for (const m of String(texto || '').matchAll(re)) {
    const v = num(m[1]);
    if (v == null) continue;
    const g = /^k|^q/i.test(m[2]) ? v * 1000 : v;
    out.push({ g, trecho: m[0].trim(), depois: m[3] || '' });
  }
  return out;
}

/**
 * Puro. Confere a linha REFEICAO ({ kcal, proteina, carbo, gordura, itens }) contra o texto da pessoa. Devolve
 * { suspeito, motivos: [texto curto], pergunta } — pergunta pronta pra mandar no grupo (natural, uma só).
 */
export function auditarRefeicao(refeicao, texto = '') {
  const motivos = [];
  const perguntas = [];
  const r = refeicao || {};
  const kcal = num(r.kcal);
  const p = num(r.proteina) ?? 0;
  const c = num(r.carbo) ?? 0;
  const g = num(r.gordura) ?? 0;
  const fala = `${texto || ''} ${typeof r.itens === 'string' ? r.itens : ''}`;

  // 1) suplemento em pó numa quantidade que não cabe numa tomada ("400 g de whey" em vez de 40 g)
  for (const q of quantidadesEmGramas(texto)) {
    const sup = DOSE_MAXIMA_G.find((d) => d.re.test(q.depois) || d.re.test(q.trecho));
    if (sup && q.g > sup.max) {
      motivos.push(`${Math.round(q.g)} g de ${sup.nome} numa tomada`);
      perguntas.push(`foram ${Math.round(q.g)} g de ${sup.nome} mesmo, ou ${Math.round(q.g / 10)} g?`);
    } else if (!sup && q.g > TETO_ITEM_G) {
      motivos.push(`${q.trecho} numa refeição`);
      perguntas.push(`foi isso mesmo (${q.trecho})? Parece muita coisa pra uma refeição só.`);
    }
  }
  // 2) refeição acima do teto (kcal ou proteína)
  if (kcal != null && kcal > TETO_REFEICAO.kcal && !perguntas.length) {
    motivos.push(`${Math.round(kcal)} kcal numa refeição`);
    perguntas.push(`deu ${Math.round(kcal)} kcal numa refeição só. Foi tudo isso mesmo, ou tem alguma quantidade a mais aí?`);
  } else if (p > TETO_REFEICAO.proteina && !perguntas.length) {
    motivos.push(`${Math.round(p)} g de proteína numa refeição`);
    perguntas.push(`deu ${Math.round(p)} g de proteína numa refeição só. Confere as quantidades?`);
  }
  // 3) calorias que não fecham com os macros (4/4/9). Álcool (7 kcal/g) fica fora dos macros: bebida não entra nesta regra
  const calc = 4 * p + 4 * c + 9 * g;
  const temAlcool = /cerveja|chopp|vinho|drink|caipirinha|vodka|whisk|cacha[cç]a|gin\b|tequila|licor|[aá]lcool|destilado|espumante/i.test(fala);
  if (kcal != null && calc > 0 && !temAlcool && Math.abs(kcal - calc) > Math.max(250, 0.4 * kcal)) {
    // não pergunta pra pessoa (a conta é da bot, não dela): só marca no log, pra acompanhar quanto o modelo erra a soma
    motivos.push(`kcal (${Math.round(kcal)}) não fecha com os macros (${Math.round(calc)})`);
  }
  const pergunta = perguntas[0] || null;
  return { suspeito: Boolean(pergunta), motivos, pergunta, kcalDosMacros: calc > 0 ? Math.round(calc) : null };
}

/** Puro. Resposta curta de confirmação ("isso", "sim, foi isso", "isso mesmo", "confirmo"): sem número, sem negação. */
export function confirmaSemNumero(texto) {
  const t = String(texto || '').trim().toLowerCase();
  if (!t || t.length > 60 || /\d/.test(t)) return false;
  if (/\b(n[aã]o|nada|errei|errado|engano)\b/.test(t)) return false;
  return /^(isso|sim|s|isso mesmo|foi isso|foi isso mesmo|exato|exatamente|confirmo|confirmado|certo|correto|pode anotar|anota|t[aá] certo|isso a[ií]|foi sim|foi mesmo|uhum|aham|yes)\b/.test(t);
}

/** Puro. "Não, errei" sem número novo: descarta o pendente (a pessoa manda de novo do jeito certo). */
export function negaSemNumero(texto) {
  const t = String(texto || '').trim().toLowerCase();
  return Boolean(t) && t.length <= 60 && !/\d/.test(t) && /^(n[aã]o|errei|foi engano|cancela|esquece|apaga)\b/.test(t);
}

// ---------- treino ----------
/** Salto que pede conferência: mais de 25 % acima da referência E pelo menos 10 kg a mais. */
export const SALTO_CARGA = { frac: 0.25, minKg: 10 };

/**
 * Puro. Última carga de um exercício contra as anteriores (kg das séries mais pesadas de cada sessão, da mais antiga pra mais
 * recente). Referência = mediana das até 4 anteriores. Devolve null (normal) ou { ultima, referencia, salto } quando a última
 * passa de 25 % e de 10 kg acima da referência: provável erro de digitação, peso total x por lado ou aparelho diferente.
 */
export function saltoDeCarga(cargas = []) {
  const v = cargas.map(num).filter((x) => x != null && x > 0);
  if (v.length < 3) return null;
  const ultima = v[v.length - 1];
  const antes = v.slice(-5, -1).sort((a, b) => a - b);
  const meio = Math.floor(antes.length / 2);
  const referencia = antes.length % 2 ? antes[meio] : (antes[meio - 1] + antes[meio]) / 2;
  const salto = ultima - referencia;
  if (salto > SALTO_CARGA.minKg && ultima > referencia * (1 + SALTO_CARGA.frac)) return { ultima, referencia: Math.round(referencia * 10) / 10, salto: Math.round(salto * 10) / 10 };
  return null;
}

/** Puro. 1RM estimado: Epley (o do treino.js) e Brzycki (melhor até ~10 repetições); a média dos dois quando ambos valem. */
export function umRM(kg, reps) {
  const w = num(kg);
  const r = num(reps);
  if (!(w > 0) || !(r >= 1)) return null;
  if (r === 1) return w;
  const epley = w * (1 + r / 30);
  const brzycki = r < 37 ? (w * 36) / (37 - r) : null;
  return Math.round(((brzycki && r <= 10 ? (epley + brzycki) / 2 : epley) * 10)) / 10;
}
