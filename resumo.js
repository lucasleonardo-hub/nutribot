// resumo.js - Refeições do dia compiladas em código, a partir das análises que a própria Nutri escreveu no grupo.
// A IA só redige o resumo; quem lista as refeições e soma calorias e macros é o sistema. Assim nenhuma refeição
// some do resumo (o que acontecia quando o modelo reserva cortava o meio do prompt) e os números batem com o dia.

const NOME_SLOT = { cafe: '☕ Café da manhã', almoco: '🍽️ Almoço', lanche: '🥪 Lanche', jantar: '🌙 Jantar', ceia: '🌃 Ceia' };
const JANELA_COMPLEMENTO_MIN = 20; // "a vitamina tem whey" 1 min depois da foto = mesma refeição, não outra

import { minutosDe } from './util.js';

const num = (t) => Number(String(t).replace(/\./g, '').replace(',', '.')) || 0;

/** Lê "~620 kcal · Proteína 32 g · Carboidratos 82 g · Gorduras 16 g" (ou o formato antigo "P: 32g | C: 82g | G: 16g"). */
export function lerEstimativa(texto) {
  const m = String(texto || '').match(
    /Estimativa[^:\n]*:\*?\s*~?\s*([\d.,]+)\s*kcal[\s\S]{0,40}?(?:P:|Prote[ií]nas?:?)\s*~?([\d.,]+)\s*g[\s\S]{0,40}?(?:C:|Carbo\w*:?)\s*~?([\d.,]+)\s*g[\s\S]{0,40}?(?:G:|Gorduras?:?)\s*~?([\d.,]+)\s*g/i
  );
  return m ? { kcal: num(m[1]), p: num(m[2]), c: num(m[3]), g: num(m[4]) } : null;
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
