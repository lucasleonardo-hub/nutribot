// taco.js - Âncoras nutricionais determinísticas a partir da Tabela TACO (dados/taco.json, gerado por scripts/gerar-taco.mjs).
// Quando a pessoa declara porção ("200 g de arroz", "2 ovos", "3 fatias de pão integral", "1 scoop de whey"), o código calcula
// calorias e macros oficiais desses itens e entrega pra IA como âncora: ela estima só o que não foi declarado.
// Sem porção declarada, entrega o valor por 100 g do alimento reconhecido, pra estimativa da foto partir do número certo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARQUIVO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dados', 'taco.json');
let base = null;
function carregar() {
  if (base) return base;
  try {
    const bruto = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    const porId = new Map();
    for (const a of [...bruto.alimentos, ...(bruto.extras || [])]) porId.set(a.id, a);
    // apelidos do mais longo pro mais curto, pra "pão de forma integral" ganhar de "pão"
    const apelidos = Object.entries(bruto.apelidos).map(([apelido, id]) => ({ apelido, id, re: new RegExp(`(?<![a-zà-ú])${escapar(apelido).replace(/\\ /g, '\\s+')}(?:s|es)?(?![a-zà-ú])`, 'i') })).sort((a, b) => b.apelido.length - a.apelido.length);
    base = { porId, apelidos };
  } catch (e) {
    console.warn('[taco] tabela indisponível:', e.message);
    base = { porId: new Map(), apelidos: [] };
  }
  return base;
}
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Medidas caseiras usuais em gramas (POF/IBGE e rótulos), por tipo de alimento. Chave = trecho do nome na TACO ou id extra.
const MEDIDAS = [
  { re: /^Ovo, de galinha, inteiro/, unidade: 50 },
  { re: /^Ovo, de galinha, clara/, unidade: 33 },
  { re: /^Pão, trigo, francês/, unidade: 50 },
  { re: /^Pão, trigo, forma/, fatia: 25, unidade: 25 },
  { re: /^Pão, de queijo/, unidade: 20 },
  { re: /^Torrada/, unidade: 8, fatia: 8 },
  { re: /^Queijo, (muçarela|mussarela|prato|minas)/, fatia: 15 },
  { re: /^Presunto|^Mortadela/, fatia: 15 },
  { re: /^Banana/, unidade: 70 },
  { re: /^Maçã|^Pêra|^Pera|^Laranja|^Goiaba/, unidade: 130 },
  { re: /^Tangerina/, unidade: 100 },
  { re: /^Mamão/, fatia: 170 },
  { re: /^Melancia|^Melão|^Abacaxi/, fatia: 150 },
  { re: /^Tomate/, unidade: 100, fatia: 15 },
  { re: /^Cenoura/, unidade: 80 },
  { re: /^Batata, inglesa/, unidade: 90 },
  { re: /^Batata, doce/, unidade: 150 },
  { re: /^Arroz/, colher: 25, xicara: 160, concha: 90 },
  { re: /^Feijão|^Feijoada|^Lentilha|^Grão/, concha: 140, colher: 20 },
  { re: /^Macarrão|^Lasanha|^Nhoque/, pegador: 110, colher: 30 },
  { re: /^Frango, sobrecoxa/, unidade: 100 },
  { re: /^Frango, coxa/, unidade: 65 },
  { re: /^Frango, peito/, file: 120, unidade: 120 },
  { re: /^Hambúrguer/, unidade: 90 },
  { re: /^Lingüiça|^Linguiça/, unidade: 60, gomo: 60 },
  { re: /^Salsicha/, unidade: 50 },
  { re: /^Coxinha/, unidade: 70 },
  { re: /^Pastel/, unidade: 80 },
  { re: /^Quibe/, unidade: 80 },
  { re: /^Pizza/, fatia: 120, pedaco: 120 },
  { re: /^Paçoca/, unidade: 20 },
  { re: /^Biscoito, doce/, unidade: 13 },
  { re: /^Biscoito, salgado/, unidade: 7 },
  { re: /^Bolo/, fatia: 60 },
  { re: /^Chocolate/, quadradinho: 6, barra: 25 },
  { re: /^Aveia/, colher: 15 },
  { re: /^Azeite|^Óleo/, colher: 8, fio: 4 },
  { re: /^Margarina|^Manteiga|^Requeijão|^Maionese/, colher: 12, ponta: 5 },
  { re: /^Mel|^Açúcar|^Doce/, colher: 20 },
  { re: /^Amendoim|^Castanha/, punhado: 30, unidade: 3 },
  { re: /^Leite, de vaca, (integral|desnatado)$/, copo: 200, xicara: 200, ml: 1 },
  { re: /^Iogurte/, pote: 170, copo: 200, ml: 1 },
  { re: /^Refrigerante|^Cerveja|^Café|^Laranja, p[êe]ra, suco/, copo: 250, lata: 350, garrafa: 600, xicara: 50, ml: 1 },
  { re: /^Alface|^Rúcula|^Agrião/, folha: 10, prato: 40 },
  { re: /^Couve|^Brócolis|^Repolho|^Espinafre/, colher: 25, prato: 80 },
  { re: /^Milho|^Ervilha/, colher: 25 },
  { re: /^Farinha, de mandioca|^Cuscuz|^Polenta/, colher: 20 },
];
const UNIDADES_MASSA = { g: 1, gr: 1, grama: 1, gramas: 1, kg: 1000, ml: 1, l: 1000, litro: 1000 };
const SINONIMOS = {
  unidade: /^(unid(?:ade)?s?|un|pe[çc]as?)$/,
  fatia: /^fatias?$/,
  colher: /^(colher(?:es)?(?:\s+de\s+sopa)?|cs)$/,
  concha: /^conchas?$/,
  xicara: /^x[íi]caras?$/,
  copo: /^copos?$/,
  scoop: /^(scoops?|doses?|dosadore?s?|medidas?)$/,
  dose: /^doses?$/,
  pote: /^potes?$/,
  lata: /^latas?$/,
  garrafa: /^garrafas?$/,
  pegador: /^pegador(?:es)?$/,
  punhado: /^punhados?$/,
  folha: /^folhas?$/,
  gomo: /^gomos?$/,
  pedaco: /^peda[çc]os?$/,
  barra: /^barras?$/,
  quadradinho: /^quadradinhos?$/,
  file: /^fil[ée]s?$/,
  fio: /^fios?$/,
  ponta: /^pontas?(?:\s+de\s+faca)?$/,
  prato: /^pratos?$/,
};

function medidaDe(alimento, unidadeTexto) {
  const u = String(unidadeTexto || '').toLowerCase().trim();
  if (!u) return null;
  if (UNIDADES_MASSA[u] != null) return UNIDADES_MASSA[u];
  const tipo = Object.entries(SINONIMOS).find(([, re]) => re.test(u))?.[0];
  if (!tipo) return null;
  const especifica = alimento.porcao?.[tipo] ?? MEDIDAS.find((m) => m.re.test(alimento.nome))?.[tipo];
  if (especifica) return especifica;
  // padrões genéricos quando o alimento não tem medida própria
  return { colher: 20, concha: 120, xicara: 150, copo: 200, scoop: 30, dose: 30, unidade: null, fatia: 25, pote: 170 }[tipo] ?? null;
}

const numero = (t) => Number(String(t).replace(',', '.').replace(/^meia$|^meio$/i, '0.5')) || (/^(um|uma)$/i.test(t) ? 1 : /^(dois|duas)$/i.test(t) ? 2 : /^tr[êe]s$/i.test(t) ? 3 : /^quatro$/i.test(t) ? 4 : /^cinco$/i.test(t) ? 5 : 0);
const RE_QTD = '(\\d+(?:[.,]\\d+)?|meia|meio|uma?|duas|dois|tr[êe]s|quatro|cinco)';
const RE_UNID = '(g|gr|gramas?|kg|ml|l|litros?|unid(?:ade)?s?|un|pe[çc]as?|fatias?|colher(?:es)?(?:\\s+de\\s+sopa)?|cs|conchas?|x[íi]caras?|copos?|scoops?|doses?|dosadore?s?|medidas?|potes?|latas?|garrafas?|pegador(?:es)?|punhados?|folhas?|gomos?|peda[çc]os?|barras?|quadradinhos?|fil[ée]s?|fios?|pontas?|pratos?)';

/**
 * Âncoras do texto: [{ nome, gramas|null, kcal, p, c, g, fibra, fonte }]
 * Reconhece "200 g de arroz", "arroz 200g", "2 ovos", "3 fatias de pão integral", "1 scoop de whey", "meia banana".
 */
export function ancorasDe(texto) {
  const { apelidos, porId } = carregar();
  const t = String(texto || '');
  if (!t.trim()) return [];
  const usados = [];
  const saida = [];
  for (const { apelido, id, re } of apelidos) {
    const m = re.exec(t);
    if (!m) continue;
    const ini = m.index;
    const fim = ini + m[0].length;
    if (usados.some(([a, b]) => ini < b && fim > a)) continue; // já coberto por apelido mais longo
    usados.push([ini, fim]);
    const alimento = porId.get(id);
    if (!alimento) continue;
    const antes = t.slice(Math.max(0, ini - 40), ini);
    const depois = t.slice(fim, fim + 30);
    // "200 g de arroz" / "2 ovos" / "3 fatias de pão" (antes)  ou  "arroz 200g" / "arroz, uns 150 g" (depois)
    const mAntes = new RegExp(`${RE_QTD}\\s*${RE_UNID}?\\s*(?:de\\s+|do\\s+|da\\s+)?(?:[a-zà-ú]+\\s+){0,2}$`, 'i').exec(antes);
    const mDepois = new RegExp(`^\\s*(?:de\\s+|com\\s+|,\\s*|\\(|uns\\s+|umas\\s+|cerca de\\s+|~)?${RE_QTD}\\s*${RE_UNID}\\b`, 'i').exec(depois);
    let gramas = null;
    let alimentoFinal = alimento;
    for (const mm of [mAntes, mDepois]) {
      if (!mm) continue;
      const q = numero(mm[1]);
      if (!q) continue;
      const unidade = mm[2] || (mm === mAntes ? 'unidade' : null);
      if (!unidade) continue;
      // "3 fatias de pão" sem qualificar é pão de forma, não francês
      if (/^fatias?$/i.test(unidade) && /^Pão, trigo, francês/.test(alimento.nome) && porId.has('x-pao-forma')) alimentoFinal = porId.get('x-pao-forma');
      const g = medidaDe(alimentoFinal, unidade);
      if (g) { gramas = Math.round(q * g); break; }
    }
    const f = gramas ? gramas / 100 : 1;
    saida.push({
      nome: alimentoFinal.nome.trim(),
      gramas,
      kcal: Math.round(alimentoFinal.kcal * f),
      p: Math.round(alimentoFinal.p * f * 10) / 10,
      c: Math.round(alimentoFinal.c * f * 10) / 10,
      g: Math.round(alimentoFinal.g * f * 10) / 10,
      fibra: Math.round((alimentoFinal.fibra || 0) * f * 10) / 10,
      fonte: String(alimentoFinal.id).startsWith('x-') ? 'rótulo típico' : 'TACO',
    });
    if (saida.length >= 10) break;
  }
  return saida;
}

const n = (v) => String(v).replace('.', ',');

/** Bloco pronto pro prompt (ou '' se nada reconhecido). */
export function blocoAncoras(texto) {
  const itens = ancorasDe(texto);
  if (!itens.length) return '';
  const declarados = itens.filter((i) => i.gramas);
  const linhas = itens.map((i) =>
    i.gramas
      ? `- ${i.nome}, ${i.gramas} g: ${i.kcal} kcal · P ${n(i.p)} g · C ${n(i.c)} g · G ${n(i.g)} g${i.fibra ? ` · fibra ${n(i.fibra)} g` : ''} (${i.fonte})`
      : `- ${i.nome} (por 100 g, porção NÃO informada): ${i.kcal} kcal · P ${n(i.p)} g · C ${n(i.c)} g · G ${n(i.g)} g (${i.fonte})`
  );
  let rodape = '';
  if (declarados.length) {
    const s = declarados.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, g: a.g + i.g }), { kcal: 0, p: 0, c: 0, g: 0 });
    rodape = `\nSoma só dos itens com porção declarada: ${Math.round(s.kcal)} kcal · P ${Math.round(s.p)} g · C ${Math.round(s.c)} g · G ${Math.round(s.g)} g.`;
  }
  return `${linhas.join('\n')}${rodape}`;
}
