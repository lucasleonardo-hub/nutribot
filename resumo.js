// resumo.js - Refeições do dia compiladas em código, a partir das análises que a própria Nutri escreveu no grupo.
// A IA só redige o resumo; quem lista as refeições e soma calorias e macros é o sistema. Assim nenhuma refeição
// some do resumo (o que acontecia quando o modelo reserva cortava o meio do prompt) e os números batem com o dia.

const NOME_SLOT = { cafe: '☕ Café da manhã', lanche_manha: '🥤 Lanche da manhã', almoco: '🍽️ Almoço', lanche: '🥪 Lanche', jantar: '🌙 Jantar', ceia: '🌃 Ceia' };
const JANELA_COMPLEMENTO_MIN = 20; // "a vitamina tem whey" 1 min depois da foto = mesma refeição, não outra

import { minutosDe } from './util.js';

const num = (t) => Number(String(t).replace(/\./g, '').replace(',', '.')) || 0;

/**
 * Lê a estimativa da análise em qualquer formato razoável: "~620 kcal · Proteína 32 g · Carboidratos 82 g · Gorduras 16 g",
 * o antigo "P: 32g | C: 82g | G: 16g", "Proteínas: 25g", ordem trocada, "kcal" antes ou depois do número, etc.
 * Procura na linha da Estimativa; se não houver, no texto todo (modelos reserva às vezes não escrevem "Estimativa").
 */
export function lerEstimativa(texto) {
  const t = String(texto || '');
  const linhaEst = t.match(/Estimativa[^:\n]*:([^\n]*(?:\n(?![\s*]*[⚖️💡🍽️🕐])[^\n]*){0,2})/i)?.[1];
  const ler = (trecho) => {
    if (!trecho) return null;
    const kcal = trecho.match(/~?\s*(\d[\d.,]*)\s*(?:kcal|calorias?)/i)?.[1] ?? trecho.match(/(?:kcal|calorias?)[:\s~]*(\d[\d.,]*)/i)?.[1];
    const p = trecho.match(/(?:prote[ií]nas?|\bP)\s*[:=]?\s*~?\s*(\d[\d.,]*)\s*g?/i)?.[1];
    const c = trecho.match(/(?:carbo\w*|\bC)\s*[:=]?\s*~?\s*(\d[\d.,]*)\s*g?/i)?.[1];
    const g = trecho.match(/(?:gorduras?|lip[ií]d\w*|\bG)\s*[:=]?\s*~?\s*(\d[\d.,]*)\s*g?/i)?.[1];
    if (!kcal || !p || !c || !g) return null;
    const r = { kcal: num(kcal), p: num(p), c: num(c), g: num(g) };
    return r.kcal > 0 ? r : null;
  };
  return ler(linhaEst) || ler(t.match(/[^\n]*(?:kcal|calorias)[^\n]*(?:\n[^\n]*){0,3}/i)?.[0]);
}

/** Descrição curta da refeição: o bloco "O que eu vi" da análise; sem ele, o texto da própria pessoa. */
export function descricaoDaAnalise(textoBot, fallback) {
  const m = String(textoBot || '').match(/O que eu vi:\*?\s*([\s\S]*?)(?:\n\s*\n|🔥|\*?Estimativa)/i);
  const d = (m ? m[1] : '')
    .replace(/^\s*[-•*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (d || String(fallback || '').replace(/^📷\s*\[foto(?: de comida)?\]\s*/, '') || '').slice(0, 160);
}

export const formatarEstimativa = (e) =>
  `~${Math.round(e.kcal)} kcal · Proteína ${Math.round(e.p)} g · Carboidratos ${Math.round(e.c)} g · Gorduras ${Math.round(e.g)} g`;

/**
 * Para cada pessoa: lista de refeições do dia (horário, slot, descrição, estimativa) e totais somados.
 * Fonte: memória do dia (mensagem da pessoa marcada com `refeicao` + a análise da Nutri logo depois).
 * Complemento da mesma refeição em até 20 min substitui a estimativa anterior em vez de contar duas vezes.
 * @returns {{ texto: string, totais: Record<string, {refeicoes:number,kcal:number,p:number,c:number,g:number}>, porPessoa: Map }}
 */
export function compilarRefeicoes(historico, perfis) {
  const porPessoa = new Map(perfis.map((p) => [p.nome, []]));
  for (let i = 0; i < historico.length; i++) {
    const m = historico[i];
    if (m.tipo === 'bot' || !m.refeicao) continue;
    if (!porPessoa.has(m.nome)) porPessoa.set(m.nome, []);
    const bot = historico[i + 1]?.tipo === 'bot' ? historico[i + 1] : null;
    const est = lerEstimativa(bot?.texto);
    const item = { hora: m.hora, slot: m.refeicao, descricao: descricaoDaAnalise(bot?.texto, m.texto), est };
    const lista = porPessoa.get(m.nome);
    const ant = lista[lista.length - 1];
    if (ant && ant.slot === item.slot && minutosDe(item.hora) - minutosDe(ant.hora) <= JANELA_COMPLEMENTO_MIN) {
      // mesma refeição complementada: mantém o horário original e fica com a estimativa mais nova (se houver)
      if (item.est) ant.est = item.est;
      const extra = String(m.texto || '').replace(/^📷\s*\[foto(?: de comida)?\]\s*/, '').trim();
      if (extra && !ant.descricao.includes(extra)) ant.descricao = `${ant.descricao} (+ ${extra})`.slice(0, 220);
      continue;
    }
    lista.push(item);
  }

  const blocos = [];
  const totais = {};
  for (const p of perfis) {
    const lista = porPessoa.get(p.nome) || [];
    const tot = lista.reduce(
      (a, r) => (r.est ? { kcal: a.kcal + r.est.kcal, p: a.p + r.est.p, c: a.c + r.est.c, g: a.g + r.est.g } : a),
      { kcal: 0, p: 0, c: 0, g: 0 }
    );
    totais[p.nome] = { refeicoes: lista.length, ...tot };
    const metaP = p.peso ? ` (meta de proteína de ${p.nome.split(' ')[0]}: ~${Math.round(p.peso * 1.6)} a ${Math.round(p.peso * 2.2)} g)` : '';
    blocos.push(
      `${p.nome}: ${lista.length} refeição(ões) registrada(s)\n` +
        (lista
          .map((r) => `  - ${NOME_SLOT[r.slot] || r.slot} (${r.hora}): ${r.descricao || '(sem descrição)'}${r.est ? ` -> ${formatarEstimativa(r.est)}` : ' -> (sem estimativa)'}`)
          .join('\n') || '  (nenhuma refeição registrada hoje)') +
        (lista.length ? `\n  TOTAL DO DIA: ${formatarEstimativa(tot)}${metaP}` : '')
    );
  }
  return { texto: blocos.join('\n\n'), totais, porPessoa };
}

// ============================================================
// Semana: totais por dia a partir dos registros de refeição (com estimativa gravada na hora da resposta)
// ============================================================
const DIA_SEMANA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const soma = (a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, g: a.g + e.g });

/**
 * Para cada pessoa: uma linha por dia (quantas refeições, quais, total estimado) e a média dos dias com estimativa.
 * @param {Array} refeicoes registros da collection refeicoes (com `estimativa` {kcal,p,c,g} quando houver)
 * @param {Array} perfis
 * @param {string[]} dias  YYYY-MM-DD em ordem
 */
export function compilarSemana(refeicoes, perfis, dias) {
  const blocos = [];
  for (const p of perfis) {
    const minhas = refeicoes.filter((r) => (p.jids || []).includes(r.jid) || r.nome === p.nome);
    const linhas = [];
    let diasComEstimativa = 0;
    let acumulado = { kcal: 0, p: 0, c: 0, g: 0 };
    let totalRefeicoes = 0;
    for (const d of dias) {
      const doDia = minhas.filter((r) => r.dia === d);
      const rotulo = `${d} (${DIA_SEMANA_CURTO[new Date(`${d}T12:00:00Z`).getUTCDay()]})`;
      if (!doDia.length) {
        linhas.push(`  - ${rotulo}: nenhuma refeição registrada`);
        continue;
      }
      totalRefeicoes += doDia.length;
      const slots = doDia.map((r) => (NOME_SLOT[r.slot] || r.slot).replace(/^\S+\s/, '')).join(', ');
      const comEst = doDia.filter((r) => r.estimativa?.kcal);
      const plural = doDia.length === 1 ? 'refeição' : 'refeições';
      if (!comEst.length) {
        linhas.push(`  - ${rotulo}: ${doDia.length} ${plural} (${slots}) -> (sem estimativa registrada)`);
        continue;
      }
      const tot = comEst.reduce((a, r) => soma(a, r.estimativa), { kcal: 0, p: 0, c: 0, g: 0 });
      diasComEstimativa++;
      acumulado = soma(acumulado, tot);
      linhas.push(`  - ${rotulo}: ${doDia.length} ${plural} (${slots}) -> ${formatarEstimativa(tot)}`);
    }
    const media = diasComEstimativa
      ? formatarEstimativa({ kcal: acumulado.kcal / diasComEstimativa, p: acumulado.p / diasComEstimativa, c: acumulado.c / diasComEstimativa, g: acumulado.g / diasComEstimativa })
      : null;
    const metaP = p.peso ? ` (meta de proteína: ~${Math.round(p.peso * 1.6)} a ${Math.round(p.peso * 2.2)} g/dia)` : '';
    blocos.push(
      `${p.nome}: ${totalRefeicoes} refeição(ões) na semana\n${linhas.join('\n')}\n  ` +
        (media ? `MÉDIA nos ${diasComEstimativa} dia(s) com estimativa: ${media}${metaP}` : `MÉDIA: sem estimativas registradas${metaP}`)
    );
  }
  return blocos.join('\n\n');
}

// ============================================================
// !hoje: totais do dia por pessoa a partir dos registros (sem IA)
// ============================================================
export function resumirHoje(refeicoes, perfis, dia) {
  const blocos = [];
  for (const p of perfis) {
    const minhas = refeicoes.filter((r) => r.dia === dia && ((p.jids || []).includes(r.jid) || r.nome === p.nome)).sort((a, b) => a.minutos - b.minutos);
    const primeiro = p.apelido || p.nome.split(' ')[0];
    if (!minhas.length) {
      blocos.push(`*${primeiro}*: nada registrado hoje ainda 👀`);
      continue;
    }
    const linhas = minhas.map((r) => `${NOME_SLOT[r.slot] || r.slot} ${r.horaLocal || r.hora}: ${r.estimativa?.kcal ? `~${Math.round(r.estimativa.kcal)} kcal` : '(sem estimativa)'}${r.descricao ? ` · ${r.descricao.slice(0, 60)}` : ''}`);
    const comEst = minhas.filter((r) => r.estimativa?.kcal);
    const tot = comEst.reduce((a, r) => soma(a, r.estimativa), { kcal: 0, p: 0, c: 0, g: 0 });
    const meta = p.peso ? ` · meta de proteína ${Math.round(p.peso * 1.6)} a ${Math.round(p.peso * 2.2)} g` : '';
    blocos.push(`*${primeiro}* (${minhas.length} ${minhas.length === 1 ? 'refeição' : 'refeições'})\n${linhas.join('\n')}\n📊 ${comEst.length ? formatarEstimativa(tot) : 'sem estimativas'}${meta}`);
  }
  return blocos.join('\n\n');
}

// ============================================================
// Mês: peso, média por semana e dias sem registro, por pessoa (sem IA)
// ============================================================
export function compilarMes(refeicoes, pesagens, perfis, dias) {
  const blocos = [];
  const semanaDe = (d) => Math.floor(dias.indexOf(d) / 7) + 1;
  for (const p of perfis) {
    const minhas = refeicoes.filter((r) => dias.includes(r.dia) && ((p.jids || []).includes(r.jid) || r.nome === p.nome));
    const pesos = pesagens.filter((x) => (p.jids || []).includes(x.jid) || x.nome === p.nome).sort((a, b) => a.dia.localeCompare(b.dia));
    const diasComRegistro = new Set(minhas.map((r) => r.dia));
    const semDados = dias.filter((d) => !diasComRegistro.has(d)).length;
    const porSemana = {};
    for (const r of minhas) {
      if (!r.estimativa?.kcal) continue;
      const k = semanaDe(r.dia);
      porSemana[k] ||= { dias: new Set(), tot: { kcal: 0, p: 0, c: 0, g: 0 } };
      porSemana[k].dias.add(r.dia);
      porSemana[k].tot = soma(porSemana[k].tot, r.estimativa);
    }
    const linhasSemana = Object.entries(porSemana).map(([k, v]) => {
      const n = v.dias.size;
      return `  - semana ${k}: média/dia ${formatarEstimativa({ kcal: v.tot.kcal / n, p: v.tot.p / n, c: v.tot.c / n, g: v.tot.g / n })} (${n} dia(s) com registro)`;
    });
    const linhaPeso = pesos.length
      ? `  - peso: ${pesos.map((x) => `${x.peso} kg (${x.dia.slice(5)})`).join(' -> ')}${pesos.length > 1 ? ` = ${(pesos[pesos.length - 1].peso - pesos[0].peso).toFixed(1)} kg no período` : ''}`
      : '  - peso: nenhuma pesagem registrada';
    blocos.push(
      `${p.nome} (objetivo: ${p.objetivo || '?'})\n${linhaPeso}\n${linhasSemana.join('\n') || '  - sem estimativas registradas'}\n  - ${minhas.length} refeição(ões) registrada(s); ${semDados} dia(s) sem nenhum registro`
    );
  }
  return blocos.join('\n\n');
}

// ============================================================
// Tipo de refeição dito pela IA na análise ("🕐 *Refeição:* café da manhã") -> id do slot
// ============================================================
const TIPO_POR_PALAVRA = [
  [/lanche da manh|cola[cç][aã]o|meio da manh|(?:pr[eé]|p[oó]s).?treino[^\n]{0,20}manh|manh[^\n]{0,20}(?:pr[eé]|p[oó]s).?treino/i, 'lanche_manha'],
  [/caf[eé]|desjejum|breakfast|brunch/i, 'cafe'],
  [/almo[cç]o|lunch/i, 'almoco'],
  [/lanche|snack|merenda|pr[eé].?treino|p[oó]s.?treino/i, 'lanche'],
  [/jantar|janta|dinner/i, 'jantar'],
  [/ceia|madrugada/i, 'ceia'],
];
export function lerTipoRefeicao(texto) {
  const m = String(texto || '').match(/Refei[cç][aã]o:\*?\s*([^\n]{2,40})/i);
  if (!m) return null;
  const achado = TIPO_POR_PALAVRA.find(([re]) => re.test(m[1]));
  return achado ? achado[1] : null;
}

// ============================================================
// Pro prompt: o que o sistema já registrou hoje, por pessoa, em uma linha cada (ela não pode pedir de novo)
// ============================================================
export function registradasHojeParaPrompt(refeicoes, perfis, dia) {
  return perfis
    .map((p) => {
      const minhas = refeicoes.filter((r) => r.dia === dia && ((p.jids || []).includes(r.jid) || r.nome === p.nome)).sort((a, b) => a.minutos - b.minutos);
      if (!minhas.length) return `- ${p.nome}: nada registrado ainda hoje`;
      const itens = minhas.map((r) => `${(NOME_SLOT[r.slot] || r.slot).replace(/^\S+\s/, '')} ${r.horaLocal || r.hora}${r.estimativa?.kcal ? ` (~${Math.round(r.estimativa.kcal)} kcal)` : ''}`);
      return `- ${p.nome}: ${itens.join('; ')}`;
    })
    .join('\n');
}

// ============================================================
// Rótulo de refeição: mensagem que só diz QUAL refeição foi ("Lanche da tarde", "era o almoço", "café")
// logo depois de uma foto/relato já analisado. Não é refeição nova: só ajusta o tipo do registro anterior.
// ============================================================
const RE_ROTULO = /^(?:(?:isso|esse|essa|aquilo|foi|era|é|eh|o|a|meu|minha|esse foi|essa foi|foi o|foi a|foi meu|foi minha)\s+)*(caf[eé](?:\s+da\s+manh[ãa])?|lanche(?:\s+da\s+(?:manh[ãa]|tarde))?|lanchinho|almo[cç]o|janta(?:r)?|ceia|pr[ée][\s-]?treino|p[óo]s[\s-]?treino)\s*(?:de hoje|de agora|agora)?\s*[.!😋🙂👍]*\s*$/i;
export function lerRotuloRefeicao(texto, horaLocal = '12:00') {
  const t = String(texto || '').trim();
  if (!t || t.length > 40) return null;
  const m = t.match(RE_ROTULO);
  if (!m) return null;
  const r = m[1].toLowerCase();
  if (/^caf/.test(r)) return 'cafe';
  if (/manh/.test(r) || /^pr[ée]/.test(r)) return 'lanche_manha';
  if (/^p[óo]s/.test(r)) return minutosDe(horaLocal) < 12 * 60 ? 'lanche_manha' : 'lanche';
  if (/^lanch/.test(r)) return 'lanche';
  if (/^almo/.test(r)) return 'almoco';
  if (/^jant/.test(r)) return 'jantar';
  if (/^ceia/.test(r)) return 'ceia';
  return null;
}
export const nomeDoSlot = (slot) => (NOME_SLOT[slot] || slot).replace(/^\S+\s/, '');

// ============================================================
// Visão de período (7 e 30 dias) + balanço energético, em código. Entra no prompt, no !hoje e na reflexão noturna.
// ============================================================
/** Faixa de balanço diário (kcal comidas - gastas) que o objetivo pede. */
export function metaBalanco(objetivo) {
  const o = String(objetivo || '').toLowerCase();
  if (/hipertrof|ganh|massa|bulk|engord|for[çc]a/.test(o)) return { min: 250, max: 500, rotulo: 'superávit de 250 a 500 kcal/dia' };
  if (/emagre|perd|reduz|defin|secar|cutting|gordura/.test(o)) return { min: -600, max: -300, rotulo: 'déficit de 300 a 600 kcal/dia' };
  return { min: -150, max: 150, rotulo: 'equilíbrio (entre -150 e +150 kcal/dia)' };
}
const _kcal = (n) => `${Math.round(n).toLocaleString('pt-BR')} kcal`;
const _sinal = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('pt-BR')}`;
const _dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const _kg = (n) => `${String(n).replace('.', ',')} kg`;
const _diasAte = (dia, n) => {
  const base = new Date(`${dia}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
};

/**
 * @param {object} p
 * @param {Array}  p.refeicoes   registros da pessoa (últimos 30 dias)
 * @param {Array}  p.pesagens    pesagens da pessoa (últimos 30 dias)
 * @param {object} p.perfil
 * @param {string} p.dia         hoje (YYYY-MM-DD)
 * @param {object} [p.gastos]    { 'YYYY-MM-DD': kcal gastas segundo o relógio } (perfil.relogio.gastos)
 */
export function visaoPeriodo({ refeicoes = [], pesagens = [], perfil = {}, dia, gastos }) {
  if (!refeicoes.length && !pesagens.length) return '';
  const porDia = new Map();
  for (const r of refeicoes) {
    if (!r.estimativa?.kcal) continue;
    const t = porDia.get(r.dia) || { kcal: 0, p: 0, n: 0 };
    t.kcal += r.estimativa.kcal;
    t.p += r.estimativa.p || 0;
    t.n += 1;
    porDia.set(r.dia, t);
  }
  const metaP = perfil.peso ? ` (meta ${Math.round(perfil.peso * 1.6)} a ${Math.round(perfil.peso * 2.2)} g)` : '';
  const linhas = [];
  const periodo = (n) => {
    const dias = _diasAte(dia, n);
    const com = dias.filter((d) => porDia.has(d));
    if (!com.length) return `ÚLTIMOS ${n} DIAS: nenhuma refeição registrada.`;
    const kcal = com.reduce((a, d) => a + porDia.get(d).kcal, 0) / com.length;
    const prot = com.reduce((a, d) => a + porDia.get(d).p, 0) / com.length;
    const pes = pesagens.filter((x) => dias.includes(x.dia)).sort((a, b) => a.dia.localeCompare(b.dia));
    const peso = pes.length >= 2 ? ` · peso ${_kg(pes[0].peso)} (${_dm(pes[0].dia)}) -> ${_kg(pes[pes.length - 1].peso)} (${_dm(pes[pes.length - 1].dia)})` : pes.length === 1 ? ` · peso ${_kg(pes[0].peso)} (${_dm(pes[0].dia)})` : '';
    // média muito baixa quase sempre é refeição que não foi mandada, não jejum: a IA não pode ler como "comeu só isso"
    const alerta = kcal < 1000 ? ' (média baixa assim indica refeições NÃO registradas, não que a pessoa comeu só isso)' : '';
    return `ÚLTIMOS ${n} DIAS: ${com.length} de ${n} dias com registro · média nos dias registrados ${_kcal(kcal)} e proteína ${Math.round(prot)} g/dia${metaP}${alerta}${peso}`;
  };
  linhas.push(periodo(7), periodo(30));

  // Balanço energético (só com relógio): comparação nos dias em que existem os dois dados
  if (gastos && Object.keys(gastos).length) {
    const meta = metaBalanco(perfil.objetivo);
    const hoje = porDia.get(dia);
    const diasGasto = Object.keys(gastos).filter((d) => d <= dia).sort();
    const ultimoGasto = diasGasto[diasGasto.length - 1];
    const partes = [];
    if (hoje) partes.push(`hoje até agora comeu ${_kcal(hoje.kcal)}${gastos[dia] ? `; o relógio já estima ${_kcal(gastos[dia])} gastas (${_sinal(hoje.kcal - gastos[dia])} kcal, dia ainda incompleto)` : ' (o gasto de hoje só chega quando o relógio sincronizar)'}`);
    if (ultimoGasto && ultimoGasto !== dia && porDia.has(ultimoGasto)) {
      const c = porDia.get(ultimoGasto).kcal;
      partes.push(`último dia completo (${_dm(ultimoGasto)}): comeu ${_kcal(c)}, gastou ${_kcal(gastos[ultimoGasto])} -> ${_sinal(c - gastos[ultimoGasto])} kcal`);
    }
    const sete = _diasAte(dia, 8).slice(0, 7).filter((d) => porDia.has(d) && gastos[d]); // 7 dias fechados antes de hoje
    if (sete.length) {
      const m = sete.reduce((a, d) => a + (porDia.get(d).kcal - gastos[d]), 0) / sete.length;
      const dentro = m >= meta.min && m <= meta.max;
      const lado = m < meta.min ? 'ABAIXO do alvo (comendo de menos pro objetivo)' : m > meta.max ? 'ACIMA do alvo (comendo além do objetivo)' : 'dentro do alvo';
      partes.push(`média dos últimos ${sete.length} dias com os dois dados: ${_sinal(m)} kcal/dia; objetivo "${perfil.objetivo || '?'}" pede ${meta.rotulo} -> ${dentro ? 'no rumo' : lado}`);
    } else {
      partes.push(`objetivo "${perfil.objetivo || '?'}" pede ${meta.rotulo}`);
    }
    linhas.push(`BALANÇO ENERGÉTICO (relógio; vale se registrou todas as refeições): ${partes.join(' · ')}.`);
  }
  return linhas.join('\n');
}
