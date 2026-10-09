// resumo.js - Refeições do dia compiladas em código, a partir das análises que a própria Nutri escreveu no grupo.
// A IA só redige o resumo; quem lista as refeições e soma calorias e macros é o sistema. Assim nenhuma refeição
// some do resumo (o que acontecia quando o modelo reserva cortava o meio do prompt) e os números batem com o dia.

const NOME_SLOT = { cafe: '☕ Café da manhã', lanche_manha: '🥤 Lanche da manhã', almoco: '🍽️ Almoço', lanche: '🥪 Lanche', jantar: '🌙 Jantar', ceia: '🌃 Ceia' };
const JANELA_COMPLEMENTO_MIN = 20; // "a vitamina tem whey" 1 min depois da foto = mesma refeição, não outra

import { minutosDe, mediana } from './util.js';
import { diasDeComida, calibrarEnergia, validarPesagens, tendenciaPeso, regressao } from './progresso.js';

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
    `Calorias: *${Math.round(e.kcal).toLocaleString('pt-BR')} kcal*`,
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
    const linhas = minhas.map((r) => `${(NOME_SLOT[r.slot] || r.slot).replace(/^(\S+)\s+(.+)$/, '$1 *$2*')} · ${r.horaLocal || r.hora}\n${r.estimativa?.kcal ? `*${Math.round(r.estimativa.kcal)} kcal*` : 'sem estimativa'}${r.descricao ? `\n${r.descricao.slice(0, 90)}` : ''}`);
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
// Padrão alimentar real: que refeições a pessoa registra, em que horário e o que costuma comer em cada uma.
// Base do !plano: o plano só prescreve as refeições que a pessoa de fato faz (quem nunca manda café não ganha café no plano).
// ============================================================
const ORDEM_SLOT = ['cafe', 'lanche_manha', 'almoco', 'lanche', 'jantar', 'ceia'];
const PALAVRA_VAZIA = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'em', 'no', 'na', 'um', 'uma', 'uns', 'umas', 'ao', 'a', 'o', 'os', 'as', 'para', 'pra', 'por', 'sem', 'mais', 'menos', 'foto', 'prato', 'porção', 'porcao', 'pouco', 'bem', 'meio', 'meia', 'grande', 'pequeno', 'pequena', 'média', 'medio', 'média', 'cheio', 'cheia', 'fatia', 'fatias', 'unidade', 'unidades', 'colher', 'colheres', 'sopa', 'copo', 'copos', 'xícara', 'xicara', 'concha', 'conchas', 'pedaço', 'pedacos', 'pedaços', 'ml', 'g', 'kg', 'l', 'grama', 'gramas', 'aprox', 'aproximadamente', 'cerca', 'corrigido', 'descrição', 'boa', 'generosa', 'generoso', 'farta', 'farto', 'toque', 'camada', 'quantidade', 'dois', 'duas', 'três', 'tres', 'quatro', 'cinco', 'seis', 'rápida', 'rapida']);
/** Quebra "arroz, feijão, 150 g de frango grelhado e salada" em itens curtos e comparáveis. */
export function itensDaDescricao(texto) {
  if (!texto || /^\[foto\]$/.test(texto)) return [];
  return String(texto)
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\d+([.,]\d+)?\s*(kcal|g|ml|kg|l|un|und|unid|x)?(?![a-záàâãéêíóôõúüç])/g, ' ')
    .split(/[,;+/]|\s+e\s+|\s+com\s+|\s+mais\s+|\n/)
    .map((t) => t.replace(/[^a-záàâãéêíóôõúüç\s-]/g, ' ').split(/\s+/).filter((w) => w && !PALAVRA_VAZIA.has(w)).slice(0, 3).join(' ').trim())
    .filter((t) => t.length >= 3);
}
const minutosDeHora = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const horaDeMinutos = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
/**
 * refeicoes = registros da pessoa no período. Devolve { texto, slots, diasComRegistro, ausentes }.
 * slots[slot] = { dias (em quantos dias apareceu), hora (mediana), itens (mais frequentes) }.
 */
export function padraoAlimentar(refeicoes, { periodoDias } = {}) {
  const regs = (refeicoes || []).filter((r) => r.dia && r.slot);
  const diasComRegistro = new Set(regs.map((r) => r.dia)).size;
  const slots = {};
  for (const r of regs) {
    const s = (slots[r.slot] ||= { dias: new Set(), minutos: [], itens: new Map(), kcal: [] });
    s.dias.add(r.dia);
    const m = minutosDeHora(r.horaLocal || r.hora);
    if (m != null) s.minutos.push(m);
    if (r.estimativa?.kcal) s.kcal.push(r.estimativa.kcal);
    for (const it of new Set(itensDaDescricao(r.descricao || r.resumo))) s.itens.set(it, (s.itens.get(it) || 0) + 1);
  }
  const saida = {};
  const linhas = [];
  const ausentes = [];
  for (const slot of ORDEM_SLOT) {
    const s = slots[slot];
    const dias = s ? s.dias.size : 0;
    // menos de 1 dia em cada 5 registrados = não faz parte da rotina (uma ceia solta em 28 dias não vira ceia no plano)
    if (!diasComRegistro || dias / diasComRegistro < 0.2) {
      if (NOME_SLOT[slot]) ausentes.push(nomeDoSlot(slot).toLowerCase());
      continue;
    }
    const hora = s.minutos.length ? horaDeMinutos(mediana(s.minutos)) : null;
    const itens = [...s.itens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([it, n]) => (n > 1 ? `${it} (${n}x)` : it));
    const kcal = s.kcal.length ? Math.round(mediana(s.kcal)) : null;
    saida[slot] = { dias, hora, itens, kcal };
    const freq = dias / diasComRegistro >= 0.7 ? 'quase todo dia' : dias / diasComRegistro >= 0.4 ? 'na maioria dos dias' : 'às vezes';
    linhas.push(`- ${nomeDoSlot(slot)}: em ${dias} de ${diasComRegistro} dias (${freq})${hora ? `, por volta das ${hora}` : ''}${kcal ? `, em média ${kcal} kcal` : ''}. Costuma: ${itens.join(', ') || '(sem descrição)'}`);
  }
  const cab = `PADRÃO REAL${periodoDias ? ` (últimos ${periodoDias} dias)` : ''}: ${diasComRegistro} dia(s) com registro`;
  const texto = diasComRegistro
    ? `${cab}\n${linhas.join('\n')}${ausentes.length ? `\n- NÃO registra: ${ausentes.join(', ')} (não existe na rotina; não prescreva)` : ''}`
    : `${cab}. Sem histórico suficiente: monte o plano só com o que a pessoa contar e pergunte, em uma linha, quais refeições ela faz por dia.`;
  return { texto, slots: saida, diasComRegistro, ausentes };
}
/** O que o resto do grupo costuma mandar (itens mais frequentes), pra variar o plano com comida que já circula ali. */
export function repertorioDoGrupo(refeicoes, { excluirJids = [], max = 25 } = {}) {
  const cont = new Map();
  for (const r of refeicoes || []) {
    if (excluirJids.includes(r.jid)) continue;
    for (const it of new Set(itensDaDescricao(r.descricao || r.resumo))) cont.set(it, (cont.get(it) || 0) + 1);
  }
  return [...cont.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([it]) => it);
}

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
/**
 * Faixa de balanço diário LIGADA À META: ritmo necessário pra chegar a metaPeso até metaPrazo (ou o meio da faixa
 * saudável sem prazo), convertido em kcal/dia (7.700 kcal por kg), limitado à faixa segura (ganho 0,25–0,5% do peso por
 * semana; perda 0,5–1%). Perto da meta (≤ 1 kg) o ritmo cai pela metade; alcançada (≤ 0,3 kg), vira manutenção.
 * Sem metaPeso, cai na faixa genérica do objetivo (metaBalanco). Recalculada a cada chamada com o peso atual.
 */
export function metaBalancoPara({ objetivo, peso, metaPeso, metaPrazo, dia, ritmo: ritmoPref = null, metaModo = 'final', gorduraTend = null, pesoRotulo = 'última pesagem' } = {}) {
  const base = metaBalanco(objetivo);
  const p = Number(peso) || 0;
  const alvoKg = Number(metaPeso) || 0;
  const querGanhar = /hipertrof|ganh|massa|bulk|engord|for[çc]a/.test(String(objetivo || '').toLowerCase());
  const querPerder = /emagre|perd|reduz|defin|secar|cutting|gordura/.test(String(objetivo || '').toLowerCase()) && !querGanhar;
  // freio pela composição: gordura subindo rápido (pontos percentuais em 28 dias) derruba o ritmo um ou dois degraus
  const degraus = ['minimo', 'medio', 'maximo'];
  const prefPedido = degraus.includes(ritmoPref) ? ritmoPref : 'medio';
  let pref = prefPedido;
  let freio = '';
  let degrauFreio = null; // teto que o freio impõe ao ritmo ('minimo' | 'medio'), com ou sem prazo
  if (gorduraTend != null && (querGanhar || (alvoKg && alvoKg > p))) {
    if (gorduraTend >= 1.5) { pref = 'minimo'; degrauFreio = 'minimo'; freio = `gordura corporal subindo ${String(Math.round(gorduraTend * 10) / 10).replace('.', ',')} pontos em 28 dias: superávit virando gordura, ritmo no mínimo saudável`; }
    else if (gorduraTend >= 0.8 && pref === 'maximo') { pref = 'medio'; degrauFreio = 'medio'; freio = `gordura corporal subindo ${String(Math.round(gorduraTend * 10) / 10).replace('.', ',')} pontos em 28 dias: um degrau abaixo do ritmo máximo`; }
    else if (gorduraTend <= -0.5) freio = `gordura corporal caindo ${String(Math.round(-gorduraTend * 10) / 10).replace('.', ',')} pontos em 28 dias: ganho limpo, pode manter o ritmo`;
  }
  // sem meta de peso mas com peso E ritmo dito pela pessoa: a faixa vem do ritmo preferido dentro do saudável ("ganhar o máximo que der, sem teto");
  // sem ritmo dito, fica a faixa genérica do objetivo
  if (p && !alvoKg && ritmoPref && (querGanhar || querPerder)) {
    const segura0 = querGanhar ? { min: p * 0.0025, max: p * 0.005 } : { min: p * 0.005, max: p * 0.01 };
    const r0 = pref === 'maximo' ? segura0.max : pref === 'minimo' ? segura0.min : (segura0.min + segura0.max) / 2;
    const kcal0 = (r0 * 7700) / 7;
    const c0 = querGanhar ? kcal0 : -kcal0;
    const ar = (x) => Math.round(x / 10) * 10;
    const rt = `${querGanhar ? '+' : '−'}${String(Math.round(r0 * 100) / 100).replace('.', ',')} kg/semana`;
    return { min: Math.max(querGanhar ? 100 : -900, ar(c0 - 100)), max: Math.min(querGanhar ? 700 : -100, ar(c0 + 100)), rotulo: `${querGanhar ? 'superávit' : 'déficit'} de ~${Math.abs(ar(c0))} kcal/dia (${rt}, ritmo ${pref} saudável, sem meta de peso)`, detalhe: `SEM META DE PESO: ritmo ${pref} da faixa saudável (${rt}) = ${querGanhar ? 'superávit' : 'déficit'} de ~${Math.abs(ar(c0))} kcal/dia${freio ? `. ${freio}` : ''}.`, fonte: 'ritmo', ritmoKgSemana: querGanhar ? r0 : -r0, fase: 'curso', freio };
  }
  if (!p || !alvoKg) return { ...base, fonte: 'objetivo' };
  const falta = alvoKg - p;
  if (Math.abs(falta) <= 0.3 && metaModo !== 'etapa') return { min: -150, max: 150, rotulo: `manutenção (meta de ${String(alvoKg).replace('.', ',')} kg alcançada: está em ${String(Math.round(p * 10) / 10).replace('.', ',')} kg)`, detalhe: 'META ALCANÇADA: faixa de manutenção (−150 a +150 kcal/dia) até ela decidir o próximo passo.', fonte: 'meta', ritmoKgSemana: 0, fase: 'manutencao' };
  // etapa não é teto: passar dela (no sentido do objetivo) segue o objetivo até o domingo propor a próxima. Antes, com 80,6 kg
  // e etapa de 80, "falta" negativa virava DÉFICIT de ~890 kcal/dia pra quem quer ganhar
  const passouEtapa = metaModo === 'etapa' && ((querGanhar && falta < -0.3) || (querPerder && falta > 0.3));
  const ganho = passouEtapa ? querGanhar : falta > 0 || (Math.abs(falta) <= 0.3 && querGanhar);
  const segura = ganho ? { min: p * 0.0025, max: p * 0.005 } : { min: p * 0.005, max: p * 0.01 }; // kg/semana, em módulo
  let ritmo = pref === 'maximo' ? segura.max : pref === 'minimo' ? segura.min : (segura.min + segura.max) / 2;
  let nota = `sem prazo: ritmo ${pref} da faixa saudável`;
  let prazoApertado = false;
  const etapaBatida = metaModo === 'etapa' && (Math.abs(falta) <= 0.3 || passouEtapa);
  if (etapaBatida) nota = `etapa de ${String(alvoKg).replace('.', ',')} kg batida: segue no ritmo ${pref} até a próxima etapa ser definida`;
  else if (pref === 'maximo' && metaPrazo && dia) {
    // "o mais rápido possível": o prazo é só referência; o ritmo é o teto saudável, e a nota diz quando chega
    const semanasAteMeta = Math.abs(falta) / ritmo;
    const chega = new Date(new Date(`${dia}T12:00:00Z`).getTime() + semanasAteMeta * 7 * 86400000).toISOString().slice(0, 10);
    nota = `ritmo máximo saudável: chega a ${String(alvoKg).replace('.', ',')} kg por volta de ${chega} (prazo ${metaPrazo}${chega <= metaPrazo ? ', antes' : ', depois'})`;
  } else if (metaPrazo && dia) {
    const semanas = (new Date(`${metaPrazo}T12:00:00Z`) - new Date(`${dia}T12:00:00Z`)) / (86400000 * 7);
    if (semanas > 0.5) {
      const necessario = Math.abs(falta) / semanas;
      if (necessario > segura.max) {
        ritmo = segura.max;
        prazoApertado = true;
        nota = `prazo ${metaPrazo} pede ${String(Math.round(necessario * 100) / 100).replace('.', ',')} kg/semana, acima do saudável: fica no teto seguro e o prazo vai escorregar`;
      } else if (necessario < segura.min) {
        ritmo = segura.min;
        nota = `prazo ${metaPrazo} dá folga: ritmo mínimo saudável já chega antes`;
      } else {
        ritmo = necessario;
        nota = `ritmo pra chegar a ${String(alvoKg).replace('.', ',')} kg até ${metaPrazo}`;
      }
    } else nota = `prazo ${metaPrazo} já passou ou está em cima: ritmo do meio da faixa saudável`;
  }
  // o freio da gordura manda mais que o prazo: com a gordura subindo rápido, o ritmo não passa do degrau do freio (antes, com
  // prazo, o ritmo voltava a ser o "necessário" e o freio ficava só no texto). Vale também quando o pedido já era o degrau do
  // freio: com 'minimo' pedido e prazo, o ritmo ficava no do prazo, acima do mínimo, com o texto dizendo "ritmo no mínimo"
  if (degrauFreio && ganho && !etapaBatida) {
    const teto = degrauFreio === 'minimo' ? segura.min : (segura.min + segura.max) / 2;
    if (ritmo > teto) {
      ritmo = teto;
      prazoApertado = Boolean(metaPrazo);
    }
  }
  let fase = 'curso';
  if (Math.abs(falta) <= 1 && metaModo !== 'etapa') {
    // etapa não desacelera: a próxima etapa vem logo depois; meta final sim, pra não passar do ponto
    ritmo = ritmo / 2;
    fase = 'aproximacao';
    nota += '; a 1 kg da meta, ritmo pela metade pra não passar do ponto';
  }
  if (etapaBatida) fase = 'etapa_batida';
  if (freio) nota += `; ${freio}`;
  const kcalDia = (ritmo * 7700) / 7; // módulo
  const centro = ganho ? kcalDia : -kcalDia;
  const arred = (x) => Math.round(x / 10) * 10;
  // ±100 em volta do centro, sem sair de uma faixa de segurança larga
  const min = Math.max(ganho ? 100 : -900, arred(centro - 100));
  const max = Math.min(ganho ? 700 : -100, arred(centro + 100));
  const ritmoTxt = `${ganho ? '+' : '−'}${String(Math.round(ritmo * 100) / 100).replace('.', ',')} kg/semana`;
  const rotulo = `${ganho ? 'superávit' : 'déficit'} de ~${Math.abs(arred(centro))} kcal/dia (${ritmoTxt} rumo a ${String(alvoKg).replace('.', ',')} kg${metaPrazo ? ` até ${metaPrazo}` : ''})`;
  const detalhe = `META DE PESO: ${String(alvoKg).replace('.', ',')} kg${metaPrazo ? ` até ${metaPrazo}` : ''}; está em ${String(Math.round(p * 10) / 10).replace('.', ',')} kg (${pesoRotulo}), ${passouEtapa ? 'passou' : 'faltam'} ${String(Math.round(Math.abs(falta) * 10) / 10).replace('.', ',')} kg${passouEtapa ? ' da etapa' : ''}; ritmo alvo ${ritmoTxt} (${nota}) = ${ganho ? 'superávit' : 'déficit'} de ~${Math.abs(arred(centro))} kcal/dia. A faixa diária é recalculada com o peso atual: quando o peso muda, a meta de calorias e de proteína mudam junto.`;
  const detalheEtapa = metaModo === 'etapa' ? ' Esta meta é uma ETAPA (não um teto): quando bater, a próxima etapa é definida e o ganho continua.' : '';
  return { min, max, rotulo: `${rotulo}${metaModo === 'etapa' ? ' [etapa]' : ''}`, detalhe: `${detalhe}${detalheEtapa}`, fonte: 'meta', ritmoKgSemana: ganho ? ritmo : -ritmo, prazoApertado, fase, falta: Math.round(falta * 10) / 10, freio, etapaBatida };
}

/**
 * Puro. A faixa da meta da pessoa em `dia`, com critério único: peso de referência suavizado (pesoDeReferencia) e freio da
 * gordura pela tendência dos últimos 28 dias, só quando ela é significativa. Quem julga ritmo ou monta meta de calorias usa
 * esta, pra todo mundo falar do MESMO alvo (antes cada lugar chamava metaBalancoPara com uma janela de gordura: 28 dias, 30
 * dias ou nenhuma).
 */
export function faixaDaMeta(perfil = {}, dia, pesagens = []) {
  const pontos = validarPesagens(pesagens, { dia }).pontos;
  const ref = pesoDeReferencia(pontos, dia, perfil);
  const desde = _diasAte(dia, 28)[0];
  // freio só com a gordura mudando de verdade (IC 95% da inclinação inteiro de um lado do zero): a bioimpedância do relógio
  // oscila ~1,3 pp por leitura, e com a inclinação crua o freio ligava em 13 a 24% das janelas com a gordura parada,
  // baixando o alvo do veredito e a faixa de calorias por ruído de medida (revisão de 09/10)
  const g = tendenciaGorduraIC(pontos.filter((p) => p.dia >= desde));
  const gorduraTend = g && (g.ic[0] > 0 || g.ic[1] < 0) ? Math.round(g.pp28 * 10) / 10 : null;
  return metaBalancoPara({ objetivo: perfil.objetivo, peso: ref.peso, pesoRotulo: ref.rotulo, metaPeso: perfil.metaPeso, metaPrazo: perfil.metaPrazo, dia, ritmo: perfil.ritmo, metaModo: perfil.metaModo, gorduraTend });
}

/**
 * Puro. Peso de referência da meta em `dia`: o de tendência (fim da regressão de 28 dias) quando há pesagens bastantes; senão
 * a média das pesagens dos últimos 7 dias (2+); senão a última; senão a do perfil. Uma pesagem só carrega água, sal e roupa:
 * com a última crua, um pico de ~1 kg baixava o alvo de quem tem prazo e ligava "etapa batida" perto da etapa, enquanto o
 * PROGRESSO e o RITMO ATÉ A ETAPA da mesma mensagem usavam o peso de tendência e a média de 7 dias (revisão de 09/10).
 */
export function pesoDeReferencia(pontos = [], dia, perfil = {}) {
  const t = tendenciaPeso(pontos, { dia });
  if (t.suficiente && Number.isFinite(t.pesoTendenciaFim)) return { peso: Math.round(t.pesoTendenciaFim * 100) / 100, rotulo: 'peso de tendência' };
  const semana = pontos.filter((p) => p.dia <= dia && p.dia >= _diasAte(dia, 7)[0]);
  if (semana.length >= 2) return { peso: Math.round(media(semana.map((p) => p.peso)) * 100) / 100, rotulo: `média das ${semana.length} pesagens dos últimos 7 dias` };
  if (pontos.length) return { peso: pontos[pontos.length - 1].peso, rotulo: 'última pesagem' };
  return { peso: perfil.peso, rotulo: 'peso do perfil' };
}

/**
 * Puro. Tendência da gordura corporal em pontos percentuais por 28 dias, com o intervalo de 95% (a mesma regressão do peso,
 * com a autocorrelação das leituras); null com menos de 6 leituras ou menos de 14 dias.
 */
export function tendenciaGorduraIC(pesagens = []) {
  const pts = pesagens.filter((p) => p.gordura != null && p.dia).sort((a, b) => a.dia.localeCompare(b.dia));
  if (pts.length < 6) return null;
  const x0 = new Date(`${pts[0].dia}T12:00:00Z`).getTime();
  const xs = pts.map((p) => (new Date(`${p.dia}T12:00:00Z`).getTime() - x0) / 86400000);
  if (xs[xs.length - 1] < 14) return null;
  const r = regressao(xs, pts.map((p) => Number(p.gordura)));
  return r ? { pp28: r.b * 28, ic: r.ic.map((v) => v * 28) } : null;
}

/** Puro. Tendência da gordura corporal (pontos percentuais por 28 dias, uma casa); null com pouco dado. */
export function tendenciaGordura(pesagens = []) {
  const g = tendenciaGorduraIC(pesagens);
  return g ? Math.round(g.pp28 * 10) / 10 : null;
}

/** Puro. Próxima etapa de peso: +4 kg (ganho) ou −4 kg (perda), inteiro, com prazo pelo ritmo máximo saudável + 2 semanas de folga. */
export function proporEtapa({ peso, ganho = true, dia }) {
  const p = Number(peso) || 0;
  if (!p) return null;
  const alvo = ganho ? Math.ceil(p + 3.5) : Math.floor(p - 3.5);
  const ritmo = ganho ? p * 0.005 : p * 0.0075;
  const semanas = Math.abs(alvo - p) / ritmo + 2;
  const prazo = new Date(new Date(`${dia}T12:00:00Z`).getTime() + Math.round(semanas * 7) * 86400000).toISOString().slice(0, 10);
  return { metaPeso: alvo, metaPrazo: prazo, semanas: Math.round(semanas) };
}

const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const _kcal = (n) => `${Math.round(n).toLocaleString('pt-BR')} kcal`;
const _sinal = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('pt-BR')}`;
const _dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const _sinalKg = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${String(Math.abs(n)).replace('.', ',')}`; // −0,13 com o sinal de menos tipográfico, como no resto
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
export function previsaoGastoAmanha(params) {
  return previsaoGastoDia(params);
}
/** Mesma previsão pra um dia qualquer à frente (diaAlvo AAAA-MM-DD); sem diaAlvo, amanhã. */
export function previsaoGastoDia({ gastos, dia, objetivo, metaAdaptativa, diaAlvo, perfil = null }) {
  if (!gastos || !dia) return null;
  const entradas = Object.entries(gastos).filter(([d, k]) => d < dia && Number(k) > 800).sort(([a], [b]) => a.localeCompare(b)); // dias fechados; hoje ainda está incompleto
  if (entradas.length < 7) return null;
  const amanha = new Date(`${dia}T12:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  const diaAmanha = diaAlvo || amanha.toISOString().slice(0, 10);
  const dow = _dow(diaAmanha);
  const mesmos = entradas.filter(([d]) => _dow(d) === dow).slice(-4).map(([, k]) => Number(k));
  const geral = entradas.slice(-14).map(([, k]) => Number(k));
  const usaDia = mesmos.length >= 2;
  const base = usaDia ? media(mesmos) : media(geral);
  const criterio = usaDia ? `média das últimas ${mesmos.length} ${NOME_DIA[dow]}s` : `média dos últimos ${geral.length} dias`;
  // gasto real pela balança (meta adaptativa) x relógio: a razão corrige o dia previsto. Limite 0,7-1,6: até 09/10 era
  // 0,8-1,25 e, com o relógio marcando ~35% a menos do que a balança mostrava, o "mire" do dia seguinte ficava ~400 kcal
  // abaixo da própria meta adaptativa
  let fator = 1;
  if (metaAdaptativa?.status === 'calibrado' && metaAdaptativa.gasto) {
    const relogio28 = media(entradas.slice(-28).map(([, k]) => Number(k)));
    if (relogio28) fator = Math.min(1.6, Math.max(0.7, metaAdaptativa.gasto / relogio28));
  }
  const previsto = Math.round((base * fator) / 10) * 10;
  // mesma faixa da meta adaptativa (que já vem da faixaDaMeta); sem ela, a do perfil ou a genérica do objetivo
  const alvo = metaAdaptativa?.faixa || (perfil ? metaBalancoPara({ objetivo: perfil.objetivo || objetivo, peso: perfil.peso, metaPeso: perfil.metaPeso, metaPrazo: perfil.metaPrazo, dia, ritmo: perfil.ritmo, metaModo: perfil.metaModo }) : metaBalanco(objetivo));
  const min = Math.round((previsto + alvo.min) / 10) * 10;
  const max = Math.round((previsto + alvo.max) / 10) * 10;
  // o gasto calibrado está na régua das calorias REGISTRADAS: foto superestimada dá a mesma razão que relógio baixo, então o
  // texto não põe a diferença toda no relógio (o alerta do PROGRESSO da mesma mensagem diz que não dá pra separar as duas)
  const ajuste = Math.abs(fator - 1) >= 0.02 ? `, corrigida pela balança (x${fator.toFixed(2).replace('.', ',')}${Math.abs(fator - 1) >= 0.2 ? `: na régua das calorias registradas, o gasto real é ${Math.round(Math.abs(fator - 1) * 100)}% ${fator > 1 ? 'maior' : 'menor'} do que o relógio marca; vem do relógio ${fator > 1 ? 'baixo' : 'alto'} e/ou das fotos ${fator > 1 ? 'altas' : 'baixas'}, e os dados não separam as duas` : ''})` : '';
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

/**
 * Semana que o !plano cobre: de sexta a domingo o plano é da semana que vem (segunda a domingo, pra comprar no fim de semana);
 * nos outros dias começa amanhã e vai 7 dias. Devolve { inicio, fim, dias: [{ dia, nome, rotulo }] }.
 */
export function semanaDoPlano(dia) {
  const base = new Date(`${dia}T12:00:00Z`);
  const dow = base.getUTCDay();
  const pulo = dow === 5 ? 3 : dow === 6 ? 2 : dow === 0 ? 1 : 1; // sex→seg (3), sáb→seg (2), dom→seg (1), demais→amanhã
  const ini = new Date(base);
  ini.setUTCDate(ini.getUTCDate() + pulo);
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ini);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const nome = NOME_DIA[d.getUTCDay()];
    return { dia: iso, nome, rotulo: `${nome[0].toUpperCase()}${nome.slice(1)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` };
  });
  return { inicio: dias[0].dia, fim: dias[6].dia, dias, proximaSemana: dow === 5 || dow === 6 || dow === 0 };
}
/**
 * Meta calórica por dia da semana do plano, pra quem tem relógio: gasto previsto no mesmo dia da semana das últimas
 * semanas e a faixa de ingestão que o objetivo pede. null sem relógio ou com menos de 7 dias fechados.
 */
export function previsaoSemana({ gastos, dia, objetivo, metaAdaptativa, semana, perfil = null }) {
  const sem = semana || semanaDoPlano(dia);
  const dias = sem.dias.map((d) => ({ ...d, prev: previsaoGastoDia({ gastos, dia, objetivo, metaAdaptativa, diaAlvo: d.dia, perfil }) })).filter((d) => d.prev);
  if (!dias.length) return null;
  const linhas = dias.map((d) => `- ${d.rotulo}: gasto previsto ${_kcal(d.prev.previsto)} (${d.prev.criterio}) -> comer entre ${_kcal(d.prev.alvo.min)} e ${_kcal(d.prev.alvo.max)}`);
  const mediaAlvo = Math.round(media(dias.map((d) => (d.prev.alvo.min + d.prev.alvo.max) / 2)) / 10) * 10;
  return {
    dias,
    mediaAlvo,
    texto: `META POR DIA (gasto medido pelo relógio nas últimas semanas, no mesmo dia da semana; a faixa de ingestão vem do objetivo "${objetivo || '?'}"; monte cada dia pra cair dentro da faixa dele, com os dias de mais gasto ganhando porção maior):\n${linhas.join('\n')}`,
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
    // comida: os n dias FECHADOS antes de hoje. Hoje ainda está em andamento e aparece à parte (balanço "hoje"): até 09/10
    // entrava na média e, às 06:51, "últimos 7 dias: 3.516 kcal/dia" era 4.006 com o café de 230 kcal de hoje no meio
    const dias = _diasAte(dia, n + 1).slice(0, n);
    // peso: até hoje (a pesagem da manhã é medida completa)
    const diasPeso = _diasAte(dia, n);
    const comRegistro = dias.filter((d) => porDia.has(d));
    const comEst = comRegistro.filter((d) => porDia.get(d).nEst > 0);
    const kcal = comEst.length ? comEst.reduce((a, d) => a + porDia.get(d).kcal, 0) / comEst.length : null;
    const prot = comEst.length ? comEst.reduce((a, d) => a + porDia.get(d).p, 0) / comEst.length : null;
    const pes = pesagens.filter((x) => x.peso && diasPeso.includes(x.dia)).sort((a, b) => a.dia.localeCompare(b.dia));
    const metade = Math.floor(n / 2);
    const recentes = pes.filter((x) => diasPeso.slice(n - metade).includes(x.dia));
    const anteriores = pes.filter((x) => diasPeso.slice(0, n - metade).includes(x.dia));
    return {
      n,
      de: dias[0],
      ate: dias[n - 1],
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
    const alvo = faixaDaMeta(perfil, dia, pesagens);
    const hoje = porDia.get(dia);
    // relógio com 800 kcal ou menos é dia fora do pulso ou sincronização parcial: o mesmo piso das outras contas
    const gastoOk = (d) => Number(gastos[d]) > 800;
    // 7 dias fechados antes de hoje, só os COMPLETOS (critério único do progresso.js): dia com só o café registrado não é déficit
    // (mediana dos 28 dias, como no progresso.js e na meta adaptativa: o mesmo dia é completo ou não em todo lugar)
    const completos7 = diasDeComida(refeicoes, { dia, de: _diasAte(dia, 29)[0] }).completos.filter((c) => c.dia >= _diasAte(dia, 8)[0]);
    const fechados = completos7.filter((c) => gastoOk(c.dia)).sort((x, y) => x.dia.localeCompare(y.dia));
    const media7 = fechados.length ? fechados.reduce((a, c) => a + (c.kcal - Number(gastos[c.dia])), 0) / fechados.length : null;
    // "último dia completo" é completo de verdade (antes: o último dia com gasto, mesmo com um registro só ou com o relógio no
    // carregador) e fechado (com o gasto parcial de hoje já sincronizado, a linha sumia)
    const ultimo = fechados[fechados.length - 1] || null;
    // a comida da semana é julgada contra a meta da pessoa com a MESMA régua do !progresso: a calibrada pela balança (com a
    // folga da incerteza dela) ou, enquanto não calibra, a provisória (gasto do relógio em 28 dias + faixa, margem de 100).
    // Até 09/10 o !hoje dizia "+1.113 kcal/dia, ACIMA do alvo" pelo saldo do relógio, com a balança mostrando que o relógio
    // marcava ~900 kcal/dia a menos que o gasto real; e, sem calibração, o saldo de 7 dias contra a faixa, sem margem, dava
    // "acima do alvo" na mesma mensagem em que o !progresso dizia "dentro"
    const calibrado = meta?.status === 'calibrado' && meta.alvo;
    const temMeta = (calibrado || meta?.status === 'relogio') && meta.alvo;
    const ingestao7 = completos7.length ? completos7.reduce((a, c) => a + c.kcal, 0) / completos7.length : null;
    const folga = calibrado && meta.folga ? meta.folga : 100;
    const situacaoRelogio = media7 == null ? null : media7 < alvo.min ? 'abaixo' : media7 > alvo.max ? 'acima' : 'dentro';
    const situacaoMeta = temMeta && ingestao7 != null ? (ingestao7 < meta.alvo.min - folga ? 'abaixo' : ingestao7 > meta.alvo.max + folga ? 'acima' : 'dentro') : null;
    balanco = {
      alvo,
      hoje: hoje && hoje.nEst ? { kcal: hoje.kcal, n: hoje.nEst, gasto: gastos[dia] || null } : null,
      ultimoCompleto: ultimo ? { dia: ultimo.dia, kcal: ultimo.kcal, gasto: Number(gastos[ultimo.dia]) } : null,
      media7,
      diasMedia7: fechados.length,
      ingestao7,
      diasIngestao7: completos7.length,
      base: calibrado ? 'balanca' : 'relogio',
      folga,
      // dentro da folga mas fora da faixa: "compatível" (como no !progresso), não "no alvo"
      naFaixa: situacaoMeta == null || (ingestao7 >= meta.alvo.min - 100 && ingestao7 <= meta.alvo.max + 100),
      situacaoRelogio,
      situacao: situacaoMeta ?? situacaoRelogio,
    };
  }
  const amanha = previsaoGastoAmanha({ gastos, dia, objetivo: perfil.objetivo, metaAdaptativa: meta, perfil });
  return { sete, trinta, sequencia, meta, balanco, metaP, amanha };
}

/** Texto pro PROMPT da IA (com as dicas que evitam confusão de número). '' sem dados. */
export function visaoPeriodo(params) {
  const v = calcularVisao(params);
  if (!v) return '';
  const { perfil = {} } = params;
  const metaP = v.metaP ? ` (meta ${v.metaP.min} a ${v.metaP.max} g)` : '';
  const periodo = (x) => {
    const rotulo = `ÚLTIMOS ${x.n} DIAS (${_dm(x.de)} a ${_dm(x.ate)}, dias fechados; hoje fica à parte)`;
    if (!x.comRegistro) return `${rotulo}: nenhuma refeição registrada.`;
    const media_ = x.kcal == null ? 'sem estimativas' : `média nos dias registrados ${_kcal(x.kcal)} e proteína ${Math.round(x.prot)} g/dia${metaP}`;
    const parcial = x.comEstimativa && x.comEstimativa < x.comRegistro ? ` (média sobre os ${x.comEstimativa} dias com estimativa)` : '';
    // média muito baixa quase sempre é refeição que não foi mandada, não jejum: a IA não pode ler como "comeu só isso"
    const alerta = x.kcal != null && x.kcal < 1000 ? ' (média baixa assim indica refeições NÃO registradas, não que a pessoa comeu só isso)' : '';
    const peso = x.pesoInicio && x.pesoFim && x.pesoInicio.dia !== x.pesoFim.dia ? ` · peso ${_kg(x.pesoInicio.peso)} (${_dm(x.pesoInicio.dia)}) -> ${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)})` : x.pesoFim ? ` · peso ${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)})` : '';
    return `${rotulo}: ${x.comRegistro} de ${x.n} dias com registro · ${media_}${parcial}${alerta}${peso}`;
  };
  const linhas = [periodo(v.sete), periodo(v.trinta)];
  // a sequência mede o HÁBITO de registrar (3+ registros ou 1.200+ kcal, com ou sem estimativa); "dias completos" das contas
  // de calorias é outra régua (progresso.diasDeComida), e os dois nomes iguais na mesma mensagem pareciam contradição
  if (v.sequencia >= 2) linhas.push(`SEQUÊNCIA: ${v.sequencia} dia(s) seguidos registrando as refeições (hábito de registro; nas contas de calorias valem só os dias completos do PROGRESSO e da meta).`);
  linhas.push(v.meta.texto);
  if (v.meta?.faixa?.detalhe) linhas.push(v.meta.faixa.detalhe);
  if (v.balanco) {
    const b = v.balanco;
    const partes = [];
    if (b.hoje) partes.push(`hoje até agora comeu ${_kcal(b.hoje.kcal)} no DIA INTEIRO (soma de ${b.hoje.n} refeição(ões), não o valor de uma delas)${b.hoje.gasto ? `; o relógio já estima ${_kcal(b.hoje.gasto)} gastas (${_sinal(b.hoje.kcal - b.hoje.gasto)} kcal, dia ainda incompleto)` : ' (o gasto de hoje só chega quando o relógio sincronizar)'}`);
    if (b.ultimoCompleto) partes.push(`último dia completo (${_dm(b.ultimoCompleto.dia)}): comeu ${_kcal(b.ultimoCompleto.kcal)}, gastou ${_kcal(b.ultimoCompleto.gasto)} -> ${_sinal(b.ultimoCompleto.kcal - b.ultimoCompleto.gasto)} kcal`);
    const lado = (s) => (s === 'abaixo' ? 'ABAIXO do alvo (comendo de menos pro objetivo)' : s === 'acima' ? 'ACIMA do alvo (comendo além do objetivo)' : b.naFaixa ? 'no rumo' : `compatível (fora da faixa, mas dentro da incerteza dela, ±${_kcal(b.folga)})`);
    if (b.base === 'balanca') {
      // relógio descalibrado em relação à balança: o saldo do relógio vai como dado, o julgamento vem da meta calibrada
      if (b.media7 != null) partes.push(`média de ${b.diasMedia7} dia(s) completo(s) recente(s) PELO RELÓGIO: ${_sinal(b.media7)} kcal/dia (só um dado: ${v.meta.gastoRelogio ? `o relógio marca ~${_kcal(v.meta.gastoRelogio)}/dia e ` : ''}a balança mostra gasto real de ~${_kcal(v.meta.gasto)}/dia, então esse saldo não vale como superávit real)`);
      if (b.ingestao7 != null) partes.push(`JULGAMENTO pela meta calibrada pela balança: últimos ${b.diasIngestao7} dia(s) completo(s) com ${_kcal(b.ingestao7)}/dia contra ${_kcal(v.meta.alvo.min)} a ${_kcal(v.meta.alvo.max)} -> ${lado(b.situacao)}`);
      else partes.push(`objetivo "${perfil.objetivo || '?'}" pede ${b.alvo.rotulo} (meta calibrada: ${_kcal(v.meta.alvo.min)} a ${_kcal(v.meta.alvo.max)}/dia)`);
    } else if (v.meta?.status === 'relogio' && b.ingestao7 != null) {
      // meta ainda provisória: o julgamento é o mesmo do !progresso (comida contra gasto do relógio em 28 dias + objetivo)
      if (b.media7 != null) partes.push(`média de ${b.diasMedia7} dia(s) completo(s) recente(s) com os dois dados: ${_sinal(b.media7)} kcal/dia (saldo do dia a dia pelo relógio, um dado)`);
      partes.push(`JULGAMENTO pela meta provisória (gasto do relógio em 28 dias + objetivo "${perfil.objetivo || '?'}", ${b.alvo.rotulo}; ainda sem calibração pela balança): últimos ${b.diasIngestao7} dia(s) completo(s) com ${_kcal(b.ingestao7)}/dia contra ${_kcal(v.meta.alvo.min)} a ${_kcal(v.meta.alvo.max)} -> ${lado(b.situacao)}`);
    } else if (b.media7 != null) {
      partes.push(`média de ${b.diasMedia7} dia(s) completo(s) recente(s) com os dois dados: ${_sinal(b.media7)} kcal/dia; objetivo "${perfil.objetivo || '?'}" pede ${b.alvo.rotulo} -> ${lado(b.situacao)} (relógio ainda sem calibração pela balança)`);
    } else {
      partes.push(`objetivo "${perfil.objetivo || '?'}" pede ${b.alvo.rotulo}`);
    }
    linhas.push(`BALANÇO ENERGÉTICO (relógio; vale se registrou todas as refeições): ${partes.join(' · ')}.`);
  }
  if (v.amanha) linhas.push(v.amanha.texto);
  return linhas.join('\n');
}

/** Texto pro !hoje (WhatsApp): um dado por linha, sem as dicas de prompt. '' sem dados. */
export function visaoZap(params) {
  const v = calcularVisao(params);
  if (!v) return '';
  const kg1 = (n) => `${Number(n).toFixed(1).replace('.', ',')} kg`;
  const bloco = (titulo, x) => {
    const linhas = [`*${titulo}* (${_dm(x.de)} a ${_dm(x.ate)})`];
    if (!x.comRegistro) return `${linhas[0]}\n• Sem registros`;
    linhas.push(`• Registro: ${x.comRegistro} de ${x.n} dias`);
    if (x.kcal != null) {
      linhas.push(`• Média: ${_kcal(x.kcal)}/dia${x.comEstimativa < x.comRegistro ? ` (sobre ${x.comEstimativa} dias com estimativa)` : ''}`);
      linhas.push(`• Proteína: ${Math.round(x.prot)} g/dia${v.metaP ? ` (meta ${v.metaP.min} a ${v.metaP.max} g)` : ''}`);
    }
    if (x.pesoInicio && x.pesoFim && x.pesoInicio.dia !== x.pesoFim.dia) {
      const dif = Math.round((x.pesoFim.peso - x.pesoInicio.peso) * 10) / 10;
      linhas.push(`• Peso: ${_kg(x.pesoInicio.peso)} (${_dm(x.pesoInicio.dia)}) → ${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)}), ${dif > 0 ? '+' : dif < 0 ? '−' : ''}${Math.abs(dif).toFixed(1).replace('.', ',')} kg`);
      if (x.pesoMediaRecente != null && x.pesoMediaAnterior != null) linhas.push(`• Média de peso: ${kg1(x.pesoMediaAnterior)} → ${kg1(x.pesoMediaRecente)}`);
    } else if (x.pesoFim) linhas.push(`• Peso: ${_kg(x.pesoFim.peso)} (${_dm(x.pesoFim.dia)})`);
    return linhas.join('\n');
  };
  const partes = [bloco('Últimos 7 dias', v.sete), bloco('Últimos 30 dias', v.trinta)];
  if (v.sequencia >= 2) partes.push(`*Sequência*\n• ${v.sequencia} dias seguidos registrando as refeições`);
  const m = v.meta;
  if (m?.status === 'calibrado' && (m.faixa?.fonte === 'meta' || m.faixa?.fonte === 'ritmo')) partes.push(`*Ritmo alvo*\n• ${m.faixa.rotulo}${m.faixa.freio ? `\n• ${m.faixa.freio}` : ''}`);
  if (m?.status === 'calibrado') {
    const t = m.tendenciaKgSemana;
    // o peso aqui é o do TRECHO com comida registrada (a conta do gasto real), não a tendência de 4 semanas do Progresso:
    // diz as datas pra dois números de janelas diferentes não parecerem contradição
    const trecho = m.de && m.ate ? `${_dm(m.de)} a ${_dm(_diasAte(m.ate, 2)[0])}` : null;
    partes.push([`*Meta adaptativa* (${m.diasCompletos} dias completos${trecho ? `, ${trecho}` : ''})`, `• Gasto real pela balança: ${_kcal(m.gasto)}/dia${m.ic ? ` (IC ${_kcal(m.ic[0])} a ${_kcal(m.ic[1])})` : ''}`, `• Peso ${trecho ? 'nesse trecho' : 'no período'}: ${Math.abs(t) < 0.05 ? 'estável' : `${_sinalKg(t)} kg/semana`}`, `• Comer: ${_kcal(m.alvo.min)} a ${_kcal(m.alvo.max)}/dia`].join('\n'));
  } else if (m?.status === 'relogio') {
    if (m.faixa?.fonte === 'meta' || m.faixa?.fonte === 'ritmo') partes.push(`*Ritmo alvo*\n• ${m.faixa.rotulo}${m.faixa.freio ? `\n• ${m.faixa.freio}` : ''}`);
    partes.push([`*Meta provisória* (pelo relógio)`, `• Gasto: ${_kcal(m.gasto)}/dia`, `• Comer: ${_kcal(m.alvo.min)} a ${_kcal(m.alvo.max)}/dia`, m.diasCompletos < 10 ? `• Meta adaptativa em ${10 - m.diasCompletos} dia(s) completo(s)` : null].filter(Boolean).join('\n'));
  } else if (m) {
    partes.push(`*Meta*\n• Ainda calibrando (${m.diasCompletos} de 10 dias completos)`);
  }
  if (v.balanco) {
    const b = v.balanco;
    const linhas = ['*Balanço energético* (relógio)'];
    if (b.hoje) {
      linhas.push(`• Hoje: comeu ${_kcal(b.hoje.kcal)}${b.hoje.gasto ? `, gastou ${_kcal(b.hoje.gasto)}` : ''}`);
      if (b.hoje.gasto) linhas.push(`• Saldo de hoje: ${_sinal(b.hoje.kcal - b.hoje.gasto)} kcal (dia ainda incompleto)`);
    }
    if (b.ultimoCompleto) linhas.push(`• ${_dm(b.ultimoCompleto.dia)}: comeu ${_kcal(b.ultimoCompleto.kcal)}, gastou ${_kcal(b.ultimoCompleto.gasto)}, saldo ${_sinal(b.ultimoCompleto.kcal - b.ultimoCompleto.gasto)} kcal`);
    const lado = (s) => (s === 'dentro' ? (b.naFaixa ? 'no alvo ✅' : `compatível (dentro da incerteza de ±${_kcal(b.folga)})`) : s === 'acima' ? 'acima do alvo' : 'abaixo do alvo');
    if (b.base === 'balanca') {
      // relógio descalibrado: o saldo dele é só dado; o veredito vem da meta calibrada pela balança (a mesma do !progresso)
      if (b.media7 != null) linhas.push(`• Últimos ${b.diasMedia7} dias pelo relógio: ${_sinal(b.media7)} kcal/dia`);
      linhas.push(`• A balança indica gasto real de ~${_kcal(m.gasto)}/dia${m.gastoRelogio ? ` (o relógio marca ~${_kcal(m.gastoRelogio)})` : ''}: o saldo do relógio não é o real`);
      if (b.ingestao7 != null) linhas.push(`• Últimos ${b.diasIngestao7} dias completos: ${_kcal(b.ingestao7)}/dia contra a meta ${_kcal(m.alvo.min)} a ${_kcal(m.alvo.max)} → ${lado(b.situacao)}`);
    } else if (m?.status === 'relogio' && b.ingestao7 != null) {
      // meta provisória: o mesmo julgamento do !progresso (comida contra gasto do relógio em 28 dias + objetivo)
      if (b.media7 != null) linhas.push(`• Últimos ${b.diasMedia7} dias pelo relógio: ${_sinal(b.media7)} kcal/dia`);
      linhas.push(`• Últimos ${b.diasIngestao7} dias completos: ${_kcal(b.ingestao7)}/dia contra a meta provisória ${_kcal(m.alvo.min)} a ${_kcal(m.alvo.max)} → ${lado(b.situacao)}`);
    } else {
      if (b.media7 != null) linhas.push(`• Últimos ${b.diasMedia7} dias: ${_sinal(b.media7)} kcal/dia`);
      linhas.push(`• Objetivo pede: ${_sinal(b.alvo.min)} a ${_sinal(b.alvo.max)} kcal/dia${b.media7 != null ? ` → ${lado(b.situacao)}` : ''}`);
    }
    partes.push(linhas.join('\n'));
  }
  if (v.amanha) {
    const a = v.amanha;
    const desvio = a.mediaGeral ? (a.previsto - a.mediaGeral) / a.mediaGeral : 0;
    partes.push([
      `*Amanhã* (${a.diaSemana})`,
      `• Gasto previsto: ${_kcal(a.previsto)}`,
      Math.abs(desvio) >= 0.08 ? `• ${a.diaSemana.charAt(0).toUpperCase()}${a.diaSemana.slice(1)} costuma gastar ${desvio > 0 ? 'mais' : 'menos'} que sua média geral (${_kcal(a.mediaGeral)})` : null,
      `• Mire: ${_kcal(a.alvo.min)} a ${_kcal(a.alvo.max)}`,
    ].filter(Boolean).join('\n'));
  }
  return partes.join('\n\n');
}

// ============================================================
// Meta calórica adaptativa (estilo MacroFactor): gasto real = ingestão média nos dias completos − variação de peso × 7700.
// A conta é a de progresso.calibrarEnergia (a MESMA do !progresso): dias completos pelo critério único (2+ registros, 500+
// kcal e 65%+ da mediana da pessoa) nos 28 dias fechados antes de hoje, e a tendência do peso SÓ no trecho desses dias (do
// 1º dia completo à manhã seguinte ao último). Até 09/10 a tendência pegava as pesagens dos 28 dias inteiros e a comida só
// dos dias registrados: as pesagens de antes do 1º registro (13 a 16/09, subindo) entravam, o 1º dia (1.300 kcal, metade do
// dia) também, e o gasto real saía ~450 kcal/dia baixo (3.155 contra ~3.600 no trecho alinhado).
// Enquanto não há dados, usa o gasto do relógio (se houver) e deixa claro que está calibrando.
// ============================================================
const DIA_COMPLETO_MIN_REF = 3;
const DIA_COMPLETO_MIN_KCAL = 1200;
export function gastoAdaptativo({ refeicoes = [], pesagens = [], perfil = {}, dia, gastos } = {}) {
  const dias = _diasAte(dia, 29).slice(0, 28); // 28 dias fechados antes de hoje
  const completos = diasDeComida(refeicoes, { dia, de: dias[0] }).completos;
  const pesos = validarPesagens(pesagens, { dia }).pontos.filter((p) => dias.includes(p.dia) || p.dia === dia);
  // a faixa vem da META DE PESO (ritmo necessário até o prazo, dentro do saudável) e do peso mais recente; sem meta, do tipo de objetivo
  const meta = faixaDaMeta(perfil, dia, pesagens);
  const alvo = (gasto) => ({ min: Math.round((gasto + meta.min) / 10) * 10, max: Math.round((gasto + meta.max) / 10) * 10 });
  // dia com relógio fora do pulso ou sincronização parcial (≤ 800 kcal) não é gasto do dia (o mesmo piso das outras contas)
  const gastoRelogio = gastos ? media(Object.entries(gastos).filter(([d]) => dias.includes(d)).map(([, k]) => Number(k)).filter((k) => k > 800)) : null;

  const cal = calibrarEnergia({ pontos: pesos, completos, gastos: gastos || {} });
  if (cal && !cal.insuficiente) {
    const gasto = Math.round(cal.gastoReal);
    const a = alvo(gasto);
    const tend = Math.round(cal.tendencia.kgSemana * 100) / 100;
    const ic = cal.icGasto.map((x) => Math.round(x));
    return {
      status: 'calibrado',
      gasto,
      ic,
      // incerteza da meta: meia largura do IC do gasto (mín. 100), a MESMA folga do !progresso (sem o arredondamento do ic)
      folga: Math.max(100, (cal.icGasto[1] - cal.icGasto[0]) / 2),
      ingestao: Math.round(cal.ingestao),
      tendenciaKgSemana: tend,
      diasCompletos: completos.length,
      de: cal.de,
      ate: cal.ate,
      gastoRelogio: gastoRelogio ? Math.round(gastoRelogio) : null,
      alvo: a,
      faixa: meta,
      texto: `META ADAPTATIVA (calibrada pela balança, ${_dm(cal.de)} a ${_dm(_diasAte(cal.ate, 2)[0])}): gasto real estimado ~${_kcal(gasto)}/dia (IC 95% ${_kcal(ic[0])} a ${_kcal(ic[1])}; ingestão média ${_kcal(cal.ingestao)} em ${completos.length} dias completos, peso ${Math.abs(tend) < 0.05 ? 'estável' : `${_sinalKg(tend)} kg/semana`} no mesmo trecho${gastoRelogio ? `; relógio dizia ~${_kcal(gastoRelogio)}` : ''}). Objetivo "${perfil.objetivo || '?'}": comer entre ${_kcal(a.min)} e ${_kcal(a.max)} por dia (calorias registradas, a mesma régua das fotos).`,
    };
  }
  const faltam = [];
  if (completos.length < 10) faltam.push(`mais ${10 - completos.length} dia(s) completo(s) de registro (tem ${completos.length} de 10)`);
  // pesagens: a mesma regra do veredito (tendenciaPeso), dita como ela é (antes: "pesagens cobrindo 7 dias (tem 3)" pra
  // quem tinha 3 domingos cobrindo 14 dias e precisava de mais um)
  if (cal?.insuficiente) faltam.push(`pesagens no trecho com registro (${cal.motivo})`);
  else if (!tendenciaPeso(pesos, { dia }).suficiente) faltam.push(`pesagens (${tendenciaPeso(pesos, { dia }).motivo})`);
  if (gastoRelogio) {
    const a = alvo(gastoRelogio);
    return { status: 'relogio', gasto: Math.round(gastoRelogio), diasCompletos: completos.length, alvo: a, faixa: meta, texto: `META (provisória, pelo relógio): gasto ~${_kcal(gastoRelogio)}/dia; objetivo "${perfil.objetivo || '?'}" -> comer entre ${_kcal(a.min)} e ${_kcal(a.max)} por dia. A meta adaptativa pela tendência do peso entra quando houver ${faltam.join(' e ')}.` };
  }
  return { status: 'calibrando', diasCompletos: completos.length, alvo: null, texto: `META ADAPTATIVA: ainda calibrando; falta ${faltam.join(' e ')}.` };
}

// ============================================================
// Sequências (dias seguidos registrando tudo) e placar da semana, em código
// ============================================================
export const diaCompleto = (regs) => regs.length >= DIA_COMPLETO_MIN_REF || regs.reduce((a, r) => a + (r.estimativa?.kcal || 0), 0) >= DIA_COMPLETO_MIN_KCAL;

/**
 * Dias consecutivos, terminando hoje ou ontem, em que a pessoa registrou as refeições do dia (hábito de registro: 3+
 * registros ou 1.200+ kcal, com ou sem estimativa). Não é o "dia completo" das contas de calorias (progresso.diasDeComida).
 */
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
  return linhas.map((l, i) => `${medalha[i] || '•'} ${l.nome}: ${l.completos} de ${dias.length} dias com as refeições registradas · proteína batida em ${l.proteina} dia(s) · sequência atual ${l.seq} dia(s)`).join('\n');
}
