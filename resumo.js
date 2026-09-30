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
  const linhaEst = t.match(/Estimativa[^:\n]*:([^\n]*(?:\n(?![\s*]*[⚖️💡🍽️🕐])[^\n]*){0,5})/i)?.[1];
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
  `${Math.round(e.kcal)} kcal · Proteína ${Math.round(e.p)} g · Carboidratos ${Math.round(e.c)} g · Gorduras ${Math.round(e.g)} g`;

/** Versão em linhas pro WhatsApp: título em quem chama, aqui um nutriente por linha ("Calorias: 930 kcal"). */
export const formatarEstimativaLinhas = (e, { metaP } = {}) =>
  [
    `Calorias: ${Math.round(e.kcal).toLocaleString('pt-BR')} kcal`,
    `Proteína: ${Math.round(e.p)} g${metaP ? ` (meta ${metaP.min} a ${metaP.max} g)` : ''}`,
    `Carboidratos: ${Math.round(e.c)} g`,
    `Gorduras: ${Math.round(e.g)} g`,
  ].join('\n');

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

/**
 * Mesma saída de compilarRefeicoes, mas a partir dos REGISTROS do banco (fonte da verdade: já corrigidos, fundidos e
 * apagados ao longo do dia). A versão pela transcrição lia o primeiro número da resposta e, em 28/09, pegou 247 kcal de um
 * item em vez dos 870 do almoço. Inclui gasto do relógio e balanço quando o perfil trouxer `relogio.gastos[dia]`.
 */
export function compilarRefeicoesDoBanco(refeicoes, perfis, dia) {
  const blocos = [];
  const totais = {};
  const porPessoa = new Map();
  for (const p of perfis) {
    const minhas = (refeicoes || [])
      .filter((r) => r.dia === dia && ((p.jids || []).includes(r.jid) || r.nome === p.nome))
      .sort((a, b) => (a.minutos || 0) - (b.minutos || 0));
    const lista = minhas.map((r) => ({ hora: r.horaLocal || r.hora, slot: r.slot, descricao: r.descricao || r.resumo || '', est: r.estimativa?.kcal ? r.estimativa : null }));
    porPessoa.set(p.nome, lista);
    const tot = lista.reduce((a, r) => (r.est ? soma(a, { kcal: r.est.kcal || 0, p: r.est.p || 0, c: r.est.c || 0, g: r.est.g || 0 }) : a), { kcal: 0, p: 0, c: 0, g: 0 });
    totais[p.nome] = { refeicoes: lista.length, ...tot };
    const metaP = p.peso ? ` (meta de proteína de ${p.nome.split(' ')[0]}: ~${Math.round(p.peso * 1.6)} a ${Math.round(p.peso * 2.2)} g)` : '';
    const gasto = p.relogio?.gastos?.[dia];
    const balanco = gasto && tot.kcal ? ` · gasto do relógio hoje: ${Math.round(gasto)} kcal -> balanço ${tot.kcal - gasto >= 0 ? '+' : ''}${Math.round(tot.kcal - gasto)} kcal` : '';
    blocos.push(
      `${p.nome} (objetivo: ${p.objetivo || '?'}): ${lista.length} refeição(ões) registrada(s)\n` +
        (lista
          .map((r) => `  - ${NOME_SLOT[r.slot] || r.slot} (${r.hora}): ${r.descricao || '(sem descrição)'}${r.est ? ` -> ${formatarEstimativa(r.est)}` : ' -> (sem estimativa)'}`)
          .join('\n') || '  (nenhuma refeição registrada hoje)') +
        (lista.length ? `\n  TOTAL DO DIA: ${formatarEstimativa(tot)}${metaP}${balanco}` : '')
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
  blocos.push(`PLACAR DA SEMANA (calculado pelo sistema):\n${placarSemana(refeicoes, perfis, dias)}`);
  return blocos.join('\n\n');
}

// ============================================================
// !hoje: totais do dia por pessoa a partir dos registros (sem IA)
// ============================================================
export function resumirHoje(refeicoes, perfis, dia, habitos = []) {
  const blocos = [];
  for (const p of perfis) {
    const h = habitos.find((x) => (p.jids || []).includes(x.jid));
    const agua = h?.agua_ml ? `\n💧 Água: ${(h.agua_ml / 1000).toFixed(1).replace('.', ',')} L` : '';
    const alcool = h?.alcool_doses ? `\n🍺 Álcool: ${h.alcool_doses} dose(s)` : '';
    const minhas = refeicoes.filter((r) => r.dia === dia && ((p.jids || []).includes(r.jid) || r.nome === p.nome)).sort((a, b) => a.minutos - b.minutos);
    const primeiro = p.apelido || p.nome.split(' ')[0];
    if (!minhas.length) {
      blocos.push(`*${primeiro}*: nada registrado hoje ainda 👀`);
      continue;
    }
    // título ("☕ *Café da manhã* · 08:20"), quebra de linha, e aí as informações
    const linhas = minhas.map((r) => `${(NOME_SLOT[r.slot] || r.slot).replace(/^(\S+)\s+(.+)$/, '$1 *$2*')} · ${r.horaLocal || r.hora}\n${r.estimativa?.kcal ? `${Math.round(r.estimativa.kcal)} kcal` : 'sem estimativa'}${r.descricao ? ` · ${r.descricao.slice(0, 70)}` : ''}`);
    const comEst = minhas.filter((r) => r.estimativa?.kcal);
    const tot = comEst.reduce((a, r) => soma(a, r.estimativa), { kcal: 0, p: 0, c: 0, g: 0 });
    const metaP = p.peso ? { min: Math.round(p.peso * 1.6), max: Math.round(p.peso * 2.2) } : null;
    blocos.push(`*${primeiro}* (${minhas.length} ${minhas.length === 1 ? 'refeição' : 'refeições'})\n\n${linhas.join('\n\n')}\n\n📊 *Total do dia*\n${comEst.length ? formatarEstimativaLinhas(tot, { metaP }) : 'sem estimativas'}${agua}${alcool}`);
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
/**
 * Acha o registro que a pessoa quis dizer: "ultimo"/"último" é o mais recente; "11:03" ou "11h03" é o que tem essa hora
 * local (exata; senão o mais próximo até 5 min). Devolve null se não houver. Puro: recebe só os registros DA pessoa.
 */
export function acharRegistro(registros, ref) {
  const lista = [...(registros || [])].sort((a, b) => (a.minutos || 0) - (b.minutos || 0));
  if (!lista.length) return null;
  const r = String(ref || '').trim().toLowerCase();
  if (!r || /^[úu]ltim[oa]$/.test(r)) return lista[lista.length - 1];
  const m = r.match(/^(\d{1,2})\s*[:h]\s*(\d{2})$/);
  if (!m) return null;
  const alvo = Number(m[1]) * 60 + Number(m[2]);
  const hh = `${String(m[1]).padStart(2, '0')}:${m[2]}`;
  return (
    lista.find((x) => x.horaLocal === hh || x.hora === hh) ||
    lista.map((x) => ({ x, d: Math.abs((x.minutos || 0) - alvo) })).filter((p) => p.d <= 5).sort((a, b) => a.d - b.d)[0]?.x ||
    null
  );
}

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
      const itens = minhas.map(
        (r) =>
          `${(NOME_SLOT[r.slot] || r.slot).replace(/^\S+\s/, '')} ${r.horaLocal || r.hora}` +
          (r.estimativa?.kcal ? ` (~${Math.round(r.estimativa.kcal)} kcal, ${Math.round(r.estimativa.p || 0)} g de proteína)` : '')
      );
      // o total vem rotulado pra não ser confundido com o valor de UMA refeição (já aconteceu: ela chamou o total do dia de "o almoço")
      const soma = minhas.reduce((a, r) => a + (r.estimativa?.kcal || 0), 0);
      const somaP = minhas.reduce((a, r) => a + (r.estimativa?.p || 0), 0);
      const total = soma
        ? ` >> somando TODAS essas ${minhas.length} refeições, o total do dia até agora é ~${Math.round(soma)} kcal e ${Math.round(somaP)} g de proteína (isto é o DIA, não uma refeição)`
        : '';
      return `- ${p.nome}: ${itens.join('; ')}${total}`;
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
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
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
/**
 * Números do acompanhamento (7/30 dias, sequência, meta, balanço), calculados UMA vez com critério único:
 * "dia com registro" = qualquer registro no dia; médias só nos dias com estimativa (e diz quantos foram).
 * Antes cada contador tinha um critério e o !hoje dizia "10 de 30 dias com registro" e "13 dias seguidos" ao mesmo tempo.
 * Dois renderizadores: visaoPeriodo (prompt da IA, com as dicas anti-confusão) e visaoZap (o !hoje, em tópicos).
 */
const NOME_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const _dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();

/**
 * Quanto a pessoa deve gastar AMANHÃ, pelo relógio: média das últimas semanas no mesmo dia da semana (sábado gasta menos
 * que terça), ou dos últimos 14 dias quando o dia da semana ainda tem pouca amostra. Quando a meta adaptativa está
 * calibrada, corrige o viés do relógio pela razão gasto real / gasto do relógio (limitada a 0,8-1,25).
 * Devolve null sem relógio ou com menos de 7 dias fechados. Puro.
 */
export function previsaoGastoAmanha({ gastos, dia, objetivo, metaAdaptativa }) {
  if (!gastos || !dia) return null;
  const entradas = Object.entries(gastos).filter(([d, k]) => d < dia && Number(k) > 800).sort(([a], [b]) => a.localeCompare(b)); // dias fechados; hoje ainda está incompleto
  if (entradas.length < 7) return null;
  const amanha = new Date(`${dia}T12:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  const diaAmanha = amanha.toISOString().slice(0, 10);
  const dow = _dow(diaAmanha);
  const mesmos = entradas.filter(([d]) => _dow(d) === dow).slice(-4).map(([, k]) => Number(k));
  const geral = entradas.slice(-14).map(([, k]) => Number(k));
  const usaDia = mesmos.length >= 2;
  const base = usaDia ? media(mesmos) : media(geral);
  const criterio = usaDia ? `média das últimas ${mesmos.length} ${NOME_DIA[dow]}s` : `média dos últimos ${geral.length} dias`;
  let fator = 1;
  if (metaAdaptativa?.status === 'calibrado' && metaAdaptativa.gasto) {
    const relogio28 = media(entradas.slice(-28).map(([, k]) => Number(k)));
    if (relogio28) fator = Math.min(1.25, Math.max(0.8, metaAdaptativa.gasto / relogio28));
  }
  const previsto = Math.round((base * fator) / 10) * 10;
  const alvo = metaBalanco(objetivo);
  const min = Math.round((previsto + alvo.min) / 10) * 10;
  const max = Math.round((previsto + alvo.max) / 10) * 10;
  const ajuste = Math.abs(fator - 1) >= 0.02 ? `, ajustada pelo gasto real da meta adaptativa (x${fator.toFixed(2).replace('.', ',')})` : '';
  // dia da semana bem acima/abaixo da média geral (quinta com treino x média de todos os dias): diz, pra não parecer contradição
  const mediaGeral = Math.round((media(geral) * fator) / 10) * 10;
  const desvio = usaDia && mediaGeral ? (previsto - mediaGeral) / mediaGeral : 0;
  const comparacao = Math.abs(desvio) >= 0.08 ? ` (${desvio > 0 ? 'acima' : 'abaixo'} da sua média geral de ${_kcal(mediaGeral)}: ${NOME_DIA[dow]} costuma ser dia de ${desvio > 0 ? 'mais' : 'menos'} gasto)` : '';
  return {
    dia: diaAmanha,
    diaSemana: NOME_DIA[dow],
    previsto,
    fator,
    criterio,
    amostras: usaDia ? mesmos.length : geral.length,
    alvo: { min, max },
    mediaGeral,
    texto: `AMANHÃ (${NOME_DIA[dow]}): gasto previsto ${_kcal(previsto)} (${criterio}${ajuste})${comparacao}; objetivo "${objetivo || '?'}" pede ${alvo.rotulo} -> comer entre ${_kcal(min)} e ${_kcal(max)}.`,
    zap: `*Amanhã* (${NOME_DIA[dow]}): você costuma gastar ${_kcal(previsto)}${comparacao} → mire ${_kcal(min)} a ${_kcal(max)}`,
  };
}

export function calcularVisao({ refeicoes = [], pesagens = [], perfil = {}, dia, gastos }) {
  if (!refeicoes.length && !pesagens.length) return null;
  const porDia = new Map(); // dia -> { kcal, p, n, nEst }
  for (const r of refeicoes) {
    const t = porDia.get(r.dia) || { kcal: 0, p: 0, n: 0, nEst: 0 };
    t.n += 1;
    if (r.estimativa?.kcal) {
      t.kcal += r.estimativa.kcal;
      t.p += r.estimativa.p || 0;
      t.nEst += 1;
    }
    porDia.set(r.dia, t);
  }
  const metaP = perfil.peso ? { min: Math.round(perfil.peso * 1.6), max: Math.round(perfil.peso * 2.2) } : null;
  const periodo = (n) => {
    const dias = _diasAte(dia, n);
    const comRegistro = dias.filter((d) => porDia.has(d));
    const comEst = comRegistro.filter((d) => porDia.get(d).nEst > 0);
    const kcal = comEst.length ? comEst.reduce((a, d) => a + porDia.get(d).kcal, 0) / comEst.length : null;
    const prot = comEst.length ? comEst.reduce((a, d) => a + porDia.get(d).p, 0) / comEst.length : null;
    const pes = pesagens.filter((x) => x.peso && dias.includes(x.dia)).sort((a, b) => a.dia.localeCompare(b.dia));
    const metade = Math.floor(n / 2);
    const recentes = pes.filter((x) => dias.slice(n - metade).includes(x.dia));
    const anteriores = pes.filter((x) => dias.slice(0, n - metade).includes(x.dia));
    return {
      n,
      comRegistro: comRegistro.length,
      comEstimativa: comEst.length,
      kcal,
      prot,
      pesoInicio: pes[0] || null,
      pesoFim: pes[pes.length - 1] || null,
      pesoMediaRecente: media(recentes.map((x) => x.peso)),
      pesoMediaAnterior: media(anteriores.map((x) => x.peso)),
    };
  };
  const sete = periodo(7);
  const trinta = periodo(30);
  const sequencia = sequenciaDe(refeicoes, dia);
  const meta = gastoAdaptativo({ refeicoes, pesagens, perfil, dia, gastos });
  let balanco = null;
  if (gastos && Object.keys(gastos).length) {
    const alvo = metaBalanco(perfil.objetivo);
    const hoje = porDia.get(dia);
    const diasGasto = Object.keys(gastos).filter((d) => d <= dia).sort();
    const ultimoGasto = diasGasto[diasGasto.length - 1];
    const fechados = _diasAte(dia, 8).slice(0, 7).filter((d) => porDia.has(d) && porDia.get(d).nEst > 0 && gastos[d]); // 7 dias fechados antes de hoje
    const media7 = fechados.length ? fechados.reduce((a, d) => a + (porDia.get(d).kcal - gastos[d]), 0) / fechados.length : null;
    balanco = {
      alvo,
      hoje: hoje && hoje.nEst ? { kcal: hoje.kcal, n: hoje.nEst, gasto: gastos[dia] || null } : null,
      ultimoCompleto: ultimoGasto && ultimoGasto !== dia && porDia.get(ultimoGasto)?.nEst ? { dia: ultimoGasto, kcal: porDia.get(ultimoGasto).kcal, gasto: gastos[ultimoGasto] } : null,
      media7,
      diasMedia7: fechados.length,
      situacao: media7 == null ? null : media7 < alvo.min ? 'abaixo' : media7 > alvo.max ? 'acima' : 'dentro',
    };
  }
  const amanha = previsaoGastoAmanha({ gastos, dia, objetivo: perfil.objetivo, metaAdaptativa: meta });
  return { sete, trinta, sequencia, meta, balanco, metaP, amanha };
}

/** Texto pro PROMPT da IA (com as dicas que evitam confusão de número). '' sem dados. */
export function visaoPeriodo(params) {
  const v = calcularVisao(params);
  if (!v) return '';
  const { perfil = {} } = params;
  const metaP = v.metaP ? ` (meta ${v.metaP.min} a ${v.metaP.max} g)` : '';
  const periodo = (x) => {
    if (!x.comRegistro) return `ÚLTIMOS ${x.n} DIAS: nenhuma refeição registrada.`;
    const media_ = x.kcal == null ? 'sem estimativas' : `média nos dias registrados ${_kcal(x.kcal)} e proteína ${Math.round(x.prot)} g/dia${metaP}`;
    const parcial = x.comEstimativa && x.comEstimativa < x.comRegistro ? ` (média sobre os ${x.comEstimativa} dias com estimativa)` : '';
    // média muito baixa quase sempre é refeição que não foi mandada, não jejum: a IA não pode ler como "comeu só isso"
    const alerta = x.kcal != null && x.kcal < 1000 ? ' (média baixa assim indica refeições NÃO registradas, não que a pessoa comeu só isso)' : '';
    const peso = x.pesoInicio && x.pesoFim && x.pesoInicio.dia !== x.pesoFim.dia ? ` · peso ${_kg(x.pesoInicio.peso)} (${_dm(x.pesoInicio.dia)}) -> ${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)})` : x.pesoFim ? ` · peso ${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)})` : '';
    return `ÚLTIMOS ${x.n} DIAS: ${x.comRegistro} de ${x.n} dias com registro · ${media_}${parcial}${alerta}${peso}`;
  };
  const linhas = [periodo(v.sete), periodo(v.trinta)];
  if (v.sequencia >= 2) linhas.push(`SEQUÊNCIA: ${v.sequencia} dia(s) seguidos registrando o dia completo.`);
  linhas.push(v.meta.texto);
  if (v.balanco) {
    const b = v.balanco;
    const partes = [];
    if (b.hoje) partes.push(`hoje até agora comeu ${_kcal(b.hoje.kcal)} no DIA INTEIRO (soma de ${b.hoje.n} refeição(ões), não o valor de uma delas)${b.hoje.gasto ? `; o relógio já estima ${_kcal(b.hoje.gasto)} gastas (${_sinal(b.hoje.kcal - b.hoje.gasto)} kcal, dia ainda incompleto)` : ' (o gasto de hoje só chega quando o relógio sincronizar)'}`);
    if (b.ultimoCompleto) partes.push(`último dia completo (${_dm(b.ultimoCompleto.dia)}): comeu ${_kcal(b.ultimoCompleto.kcal)}, gastou ${_kcal(b.ultimoCompleto.gasto)} -> ${_sinal(b.ultimoCompleto.kcal - b.ultimoCompleto.gasto)} kcal`);
    if (b.media7 != null) {
      const lado = b.situacao === 'abaixo' ? 'ABAIXO do alvo (comendo de menos pro objetivo)' : b.situacao === 'acima' ? 'ACIMA do alvo (comendo além do objetivo)' : 'no rumo';
      partes.push(`média dos últimos ${b.diasMedia7} dias com os dois dados: ${_sinal(b.media7)} kcal/dia; objetivo "${perfil.objetivo || '?'}" pede ${b.alvo.rotulo} -> ${lado}`);
    } else {
      partes.push(`objetivo "${perfil.objetivo || '?'}" pede ${b.alvo.rotulo}`);
    }
    linhas.push(`BALANÇO ENERGÉTICO (relógio; vale se registrou todas as refeições): ${partes.join(' · ')}.`);
  }
  if (v.amanha) linhas.push(v.amanha.texto);
  return linhas.join('\n');
}

/** Texto pro !hoje (WhatsApp), em tópicos, sem as dicas de prompt. '' sem dados. */
export function visaoZap(params) {
  const v = calcularVisao(params);
  if (!v) return '';
  const { perfil = {} } = params;
  const seta = ' → ';
  const bloco = (titulo, x) => {
    if (!x.comRegistro) return `*${titulo}*\n• Sem registros`;
    const linhas = [`*${titulo}*`, `• Registro: ${x.comRegistro} de ${x.n} dias`];
    if (x.kcal != null) linhas.push(`• Média: ${_kcal(x.kcal)} · Proteína ${Math.round(x.prot)} g/dia${v.metaP ? ` (meta ${v.metaP.min} a ${v.metaP.max} g)` : ''}${x.comEstimativa < x.comRegistro ? ` · sobre ${x.comEstimativa} dias com estimativa` : ''}`);
    if (x.pesoInicio && x.pesoFim && x.pesoInicio.dia !== x.pesoFim.dia) {
      const dif = Math.round((x.pesoFim.peso - x.pesoInicio.peso) * 10) / 10;
      const medias = x.pesoMediaRecente != null && x.pesoMediaAnterior != null ? ` · média ${x.pesoMediaAnterior.toFixed(1).replace('.', ',')} → ${x.pesoMediaRecente.toFixed(1).replace('.', ',')} kg` : '';
      linhas.push(`• Peso: ${_kg(x.pesoInicio.peso)} (${_dm(x.pesoInicio.dia)})${seta}${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)}) · ${dif > 0 ? '+' : ''}${String(dif).replace('.', ',')} kg${medias}`);
    } else if (x.pesoFim) linhas.push(`• Peso: ${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)})`);
    return linhas.join('\n');
  };
  const partes = [bloco('Últimos 7 dias', v.sete), bloco('Últimos 30 dias', v.trinta)];
  if (v.sequencia >= 2) partes.push(`*Sequência*: ${v.sequencia} dias seguidos com o dia completo`);
  const m = v.meta;
  if (m?.status === 'calibrado') {
    const t = m.tendenciaKgSemana;
    partes.push(`*Meta* (adaptativa, ${m.diasCompletos} dias): gasto real ~${_kcal(m.gasto)}/dia · peso ${Math.abs(t) < 0.05 ? 'estável' : `${t > 0 ? '+' : ''}${String(t).replace('.', ',')} kg/semana`}${seta}comer ${_kcal(m.alvo.min)} a ${_kcal(m.alvo.max)}`);
  } else if (m?.status === 'relogio') {
    partes.push(`*Meta* (pelo relógio, provisória): gasto ~${_kcal(m.gasto)}/dia${seta}comer ${_kcal(m.alvo.min)} a ${_kcal(m.alvo.max)}${m.diasCompletos < 10 ? ` · adaptativa em ${10 - m.diasCompletos} dia(s)` : ''}`);
  } else if (m) {
    partes.push(`*Meta*: ainda calibrando (${m.diasCompletos} de 10 dias completos)`);
  }
  if (v.balanco) {
    const b = v.balanco;
    const linhas = ['*Balanço energético* (relógio)'];
    if (b.hoje) linhas.push(`• Hoje: ${_kcal(b.hoje.kcal)} comidas${b.hoje.gasto ? ` · ${_kcal(b.hoje.gasto)} gastas${seta}${_sinal(b.hoje.kcal - b.hoje.gasto)} kcal (dia ainda incompleto)` : ''}`);
    if (b.ultimoCompleto) linhas.push(`• ${_dm(b.ultimoCompleto.dia)}: ${_kcal(b.ultimoCompleto.kcal)} comidas · ${_kcal(b.ultimoCompleto.gasto)} gastas${seta}${_sinal(b.ultimoCompleto.kcal - b.ultimoCompleto.gasto)} kcal`);
    const alvoTxt = `${_sinal(b.alvo.min)} a ${_sinal(b.alvo.max)} kcal/dia`;
    if (b.media7 != null) linhas.push(`• Últimos ${b.diasMedia7} dias: ${_sinal(b.media7)} kcal/dia · objetivo pede ${alvoTxt}${seta}${b.situacao === 'dentro' ? 'no alvo ✅' : b.situacao === 'acima' ? 'acima do alvo' : 'abaixo do alvo'}`);
    else linhas.push(`• Objetivo pede ${alvoTxt}`);
    partes.push(linhas.join('\n'));
  }
  if (v.amanha) partes.push(v.amanha.zap);
  return partes.join('\n\n');
}

// ============================================================
// Meta calórica adaptativa (estilo MacroFactor): gasto real = ingestão média nos dias completos - variação de peso x 7700.
// Precisa de dias "completos" (>= 3 refeições ou >= 1.200 kcal) e de pesagens que cubram pelo menos 7 dias.
// Enquanto não há dados, usa o gasto do relógio (se houver) e deixa claro que está calibrando.
// ============================================================
const DIA_COMPLETO_MIN_REF = 3;
const DIA_COMPLETO_MIN_KCAL = 1200;
export function gastoAdaptativo({ refeicoes = [], pesagens = [], perfil = {}, dia, gastos } = {}) {
  const dias = _diasAte(dia, 29).slice(0, 28); // 28 dias fechados antes de hoje
  const porDia = new Map();
  for (const r of refeicoes) {
    if (!r.estimativa?.kcal || !dias.includes(r.dia)) continue;
    const t = porDia.get(r.dia) || { kcal: 0, n: 0 };
    t.kcal += r.estimativa.kcal;
    t.n += 1;
    porDia.set(r.dia, t);
  }
  const completos = [...porDia.entries()].filter(([, t]) => t.n >= DIA_COMPLETO_MIN_REF || t.kcal >= DIA_COMPLETO_MIN_KCAL).map(([d, t]) => ({ dia: d, kcal: t.kcal }));
  const pesos = pesagens.filter((p) => p.peso && (dias.includes(p.dia) || p.dia === dia)).sort((a, b) => a.dia.localeCompare(b.dia));
  const meta = metaBalanco(perfil.objetivo);
  const alvo = (gasto) => ({ min: Math.round((gasto + meta.min) / 10) * 10, max: Math.round((gasto + meta.max) / 10) * 10 });
  const gastoRelogio = gastos ? media(Object.entries(gastos).filter(([d]) => dias.includes(d)).map(([, k]) => k).filter(Boolean)) : null;

  const spanDias = pesos.length >= 2 ? (new Date(`${pesos[pesos.length - 1].dia}T12:00:00Z`) - new Date(`${pesos[0].dia}T12:00:00Z`)) / 86400000 : 0;
  if (completos.length >= 10 && pesos.length >= 4 && spanDias >= 7) {
    // tendência do peso por regressão linear (kg/dia) sobre as pesagens do período
    const x0 = new Date(`${pesos[0].dia}T12:00:00Z`).getTime();
    const xs = pesos.map((p) => (new Date(`${p.dia}T12:00:00Z`).getTime() - x0) / 86400000);
    const ys = pesos.map((p) => p.peso);
    const mx = media(xs);
    const my = media(ys);
    const inclinacao = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1);
    const ingestao = media(completos.map((c) => c.kcal));
    const gasto = Math.round(ingestao - inclinacao * 7700);
    const a = alvo(gasto);
    const tend = Math.round(inclinacao * 7 * 100) / 100;
    return {
      status: 'calibrado',
      gasto,
      ingestao: Math.round(ingestao),
      tendenciaKgSemana: tend,
      diasCompletos: completos.length,
      alvo: a,
      texto: `META ADAPTATIVA: gasto real estimado ~${_kcal(gasto)}/dia (ingestão média ${_kcal(ingestao)} em ${completos.length} dias completos, peso ${Math.abs(tend) < 0.05 ? 'estável' : `${tend > 0 ? '+' : ''}${String(tend).replace('.', ',')} kg/semana`}${gastoRelogio ? `; relógio dizia ~${_kcal(gastoRelogio)}` : ''}). Objetivo "${perfil.objetivo || '?'}": comer entre ${_kcal(a.min)} e ${_kcal(a.max)} por dia.`,
    };
  }
  const faltam = [];
  if (completos.length < 10) faltam.push(`mais ${10 - completos.length} dia(s) completo(s) de registro (tem ${completos.length} de 10)`);
  if (pesos.length < 4 || spanDias < 7) faltam.push(`pesagens cobrindo 7 dias (tem ${pesos.length})`);
  if (gastoRelogio) {
    const a = alvo(gastoRelogio);
    return { status: 'relogio', gasto: Math.round(gastoRelogio), diasCompletos: completos.length, alvo: a, texto: `META (provisória, pelo relógio): gasto ~${_kcal(gastoRelogio)}/dia; objetivo "${perfil.objetivo || '?'}" -> comer entre ${_kcal(a.min)} e ${_kcal(a.max)} por dia. A meta adaptativa pela tendência do peso entra quando houver ${faltam.join(' e ')}.` };
  }
  return { status: 'calibrando', diasCompletos: completos.length, alvo: null, texto: `META ADAPTATIVA: ainda calibrando; falta ${faltam.join(' e ')}.` };
}

// ============================================================
// Sequências (dias seguidos registrando tudo) e placar da semana, em código
// ============================================================
export const diaCompleto = (regs) => regs.length >= DIA_COMPLETO_MIN_REF || regs.reduce((a, r) => a + (r.estimativa?.kcal || 0), 0) >= DIA_COMPLETO_MIN_KCAL;

/** Dias consecutivos, terminando hoje ou ontem, em que a pessoa registrou o dia completo. */
export function sequenciaDe(refeicoes, dia) {
  const porDia = new Map();
  for (const r of refeicoes) {
    if (!porDia.has(r.dia)) porDia.set(r.dia, []);
    porDia.get(r.dia).push(r);
  }
  let d = dia;
  let n = 0;
  // hoje ainda pode estar em andamento: se hoje não está completo, começa a contar de ontem
  if (!diaCompleto(porDia.get(d) || [])) d = _diasAte(d, 2)[0];
  while (diaCompleto(porDia.get(d) || [])) {
    n++;
    d = _diasAte(d, 2)[0];
  }
  return n;
}

/** Placar da semana: dias completos, dias com proteína batida (>= 1,6 g/kg) e sequência atual, por pessoa. */
export function placarSemana(refeicoes, perfis, dias) {
  const linhas = perfis.map((p) => {
    const minhas = refeicoes.filter((r) => (p.jids || []).includes(r.jid) || r.nome === p.nome);
    const porDia = new Map();
    for (const r of minhas) {
      if (!dias.includes(r.dia)) continue;
      if (!porDia.has(r.dia)) porDia.set(r.dia, []);
      porDia.get(r.dia).push(r);
    }
    const completos = [...porDia.values()].filter(diaCompleto).length;
    const metaP = p.peso ? p.peso * 1.6 : null;
    const proteina = metaP ? [...porDia.values()].filter((regs) => regs.reduce((a, r) => a + (r.estimativa?.p || 0), 0) >= metaP).length : 0;
    const seq = sequenciaDe(minhas, dias[dias.length - 1]);
    return { nome: p.apelido || p.nome.split(' ')[0], completos, proteina, seq, pontos: completos * 2 + proteina };
  });
  linhas.sort((a, b) => b.pontos - a.pontos);
  const medalha = ['🥇', '🥈', '🥉'];
  return linhas.map((l, i) => `${medalha[i] || '•'} ${l.nome}: ${l.completos} de ${dias.length} dias registrados por completo · proteína batida em ${l.proteina} dia(s) · sequência atual ${l.seq} dia(s)`).join('\n');
}
