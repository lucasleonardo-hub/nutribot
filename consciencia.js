// consciencia.js - O que dá pra construir de "perceber o próprio erro" sem introspecção do modelo (funções puras):
// 1) detectar quando alguém a contesta; 2) conferir, antes de enviar, se um total de calorias citado na resposta existe
// nos registros; 3) juntar as contestações do dia pro caderno de aprendizado; 4) montar o bloco de lições pro prompt.

const RE_CONTESTACAO =
  /t[áa] errad|est[áa] errad|errad[oa]s?\b|corrig|conserta|n[ãa]o foi isso|n[ãa]o (é|era) isso|voc[êe] errou|errou\b|n[ãa]o bate|isso n[ãa]o (existe|aconteceu|rolou)|de onde (tirou|veio)|inventou|n[ãa]o (comi|tomei|registrei) isso|remove|apaga|tira (esse|essa|isso)|dnv|de novo/i;

/** A mensagem contesta o que a bot disse? (o chamador ainda confere se é resposta a ela / menção / logo depois de fala dela) */
export const pareceContestacao = (texto) => RE_CONTESTACAO.test(String(texto || ''));

/** Totais conhecidos do dia: por pessoa (total, cada refeição) e o conjunto de todos os valores, pra conferência. */
export function totaisConhecidos(refeicoesHoje, perfis) {
  const porPessoa = new Map();
  for (const p of perfis || []) {
    const minhas = (refeicoesHoje || []).filter((r) => (p.jids || []).includes(r.jid) || r.nome === p.nome);
    const refeicoes = minhas.map((r) => Number(r.estimativa?.kcal) || 0).filter(Boolean);
    porPessoa.set(p.nome, { total: refeicoes.reduce((a, b) => a + b, 0), refeicoes });
  }
  const todos = new Set();
  for (const { total, refeicoes } of porPessoa.values()) {
    if (total) todos.add(total);
    for (const k of refeicoes) todos.add(k);
  }
  return { porPessoa, todos };
}

const numPt = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));

/**
 * Números de calorias na resposta que se apresentam como TOTAL (do dia, "bateu", "acumulou", "somando") e não batem com
 * nenhum valor conhecido (com tolerância). Ignora metas, gasto/TMB e valores por dia ("3.500 kcal/dia").
 * `extras`: valores legítimos que ainda não estão nos registros (a estimativa da própria resposta, o total + ela).
 */
export function numerosSuspeitos(resposta, conhecidos, { minimo = 1500, tolerancia = 0.08, extras = [] } = {}) {
  const t = String(resposta || '');
  const validos = [...(conhecidos?.todos || []), ...extras].filter((n) => Number.isFinite(n) && n > 0);
  const achados = [];
  for (const m of t.matchAll(/(\d{1,2}\.\d{3}|\d{3,5})\s*(?:kcal|calorias)/gi)) {
    const n = numPt(m[1]);
    if (!Number.isFinite(n) || n < minimo) continue;
    const antes = t.slice(Math.max(0, m.index - 80), m.index);
    const depois = t.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const janela = `${antes} ${depois}`;
    if (/meta|alvo|precisa|deveria|recomend|faixa|por dia|\/dia|gasto|basal|tmb|queim|ideal|objetivo de/i.test(janela)) continue;
    if (!/total|no dia|do dia|hoje|bateu|acumul|somando|soma|fechou|fecha|j[áa] (est[áa]|t[áa]|foi|vai)|passou de|mais de|quase|chegou/i.test(janela)) continue;
    const bate = validos.some((k) => Math.abs(n - k) / k <= tolerancia);
    if (!bate) achados.push({ numero: n, trecho: t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20).replace(/\s+/g, ' ').trim() });
  }
  return achados;
}

/** Pares (contestação da pessoa, o que a bot tinha dito antes) do dia, pro caderno de aprendizado. */
export function contestacoesDoDia(historico) {
  const lista = [];
  const msgs = historico || [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.tipo === 'bot' || !pareceContestacao(m.texto)) continue;
    let anterior = null;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      if (msgs[j].tipo === 'bot') {
        anterior = msgs[j];
        break;
      }
    }
    if (!anterior) continue;
    lista.push({ hora: m.hora, pessoa: m.nome, texto: String(m.texto || '').slice(0, 240), respostaAnterior: String(anterior.texto || '').slice(0, 320) });
  }
  return lista;
}

/**
 * Pré-filtro barato (sem IA) de "isto pode ser só um pedaço de informação": mensagem curta, de quem registrou uma
 * refeição há pouco. Só os candidatos vão pro julgamento da IA leve (julgarFragmento). Comando, áudio e texto longo não.
 */
export function candidatoAFragmento({ texto, temImagem = false, temAudio = false, minutosDesdeUltima = Infinity } = {}) {
  const t = String(texto || '').trim();
  if (temAudio || t.startsWith('!')) return false;
  if (!(minutosDesdeUltima >= 0 && minutosDesdeUltima <= 30)) return false;
  if (temImagem) return t.length <= 60;
  return t.length > 0 && t.length <= 80 && !/\?\s*$/.test(t);
}

// ---------- Objetivo da pessoa x vocabulário da resposta ----------
const semAcentoC = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RE_VOCAB_GANHO = /\[\[hipertrofia\]\]|hipertrofia|ganho de massa|ganhar massa|ganhar peso|super[áa]vit|bulk(?:ing)?|massa muscular subir|engordar/gi;
const RE_VOCAB_PERDA = /\[\[d[ée]ficit cal[óo]rico\]\]|d[ée]ficit cal[óo]rico|emagrec\w*|secar|perder gordura|queimar gordura|cutting|\[\[perda de peso\]\]/gi;

/** 'perda' (emagrecer/definir/secar), 'ganho' (hipertrofia/massa/força) ou null. */
export function ladoDoObjetivo(objetivo) {
  const t = semAcentoC(objetivo);
  if (!t) return null;
  if (/emagre|perd|reduz|defin|secar|gordura|deficit/.test(t)) return 'perda';
  if (/hipertrof|ganh|massa|bulk|forca|volume|crescer/.test(t)) return 'ganho';
  return null;
}

/** Termos do objetivo OPOSTO que apareceram na resposta (vazios = ok). "massa magra" e "definição" não contam. */
export function vocabularioErrado(resposta, objetivo) {
  const lado = ladoDoObjetivo(objetivo);
  if (!lado) return [];
  const re = new RegExp((lado === 'perda' ? RE_VOCAB_GANHO : RE_VOCAB_PERDA).source, 'gi');
  return [...new Set([...String(resposta || '').matchAll(re)].map((m) => m[0].toLowerCase()))];
}

/** Última defesa: tira as frases que contêm os termos (linha a linha, sem mexer no resto). */
export function removerFrasesCom(texto, termos) {
  if (!termos?.length) return texto;
  const tem = (s) => termos.some((t) => s.toLowerCase().includes(t.toLowerCase()));
  return String(texto || '')
    .split('\n')
    .map((linha) => {
      if (!tem(linha)) return linha;
      const rotulo = linha.match(/^(\s*(?:[🕐🍽️🔥⚖️💡]\s*)?\*[^*]+:\*\s*)/u)?.[1] || '';
      const corpo = linha.slice(rotulo.length);
      const frases = corpo.split(/(?<=[.!?…])\s+/).filter((f) => !tem(f));
      const resto = frases.join(' ').trim();
      if (!resto && rotulo) return `${rotulo}segue no seu objetivo.`;
      return resto ? `${rotulo}${resto}` : null;
    })
    .filter((l) => l !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- Conversa SOBRE a bot (bug, ajuste, sistema) e menção a outra refeição ----------
const RE_META =
  /\b(bugs?|bugou|bugada|vou ajustar|vou arrumar|vou ver aqui|vou corrigir (ela|isso|o bot|a bot)|arrumar (isso|ela)|ajustar (isso|ela|o bot|a bot|amanh[ãa]|depois|dps)|atualiza[çc][ãa]o|atualizar (ela|o bot|a bot)|deploy|c[óo]digo|codigo|sistema|painel|planilha|compila|banco de dados|servidor|render|prompt|api|prob\w*ma de vis[ãa]o|doidinh\w*|caducando|caducou|alta demanda|rodando (uma )?atualiza|t[áa] rodando|ela (t[áa]|est[áa]|ficou|cismou|pensa|entende|aprende|corrige|errou|confundiu|leu)|coitada|meio estranho|dps ela corrige|depois ela corrige)\b/i;
/** A mensagem fala DA bot (bug, ajuste, sistema, "ela cismou"), não de comida? */
export const pareceMetaConversa = (texto) => RE_META.test(String(texto || ''));

const TIPO_REFEICAO = [
  ['lanche_manha', /lanche da manh[ãa]|pr[ée][\s-]?treino|p[óo]s[\s-]?treino/i],
  ['lanche', /lanche(?: da tarde)?|caf[eé] da tarde|lanchinho/i],
  ['cafe', /caf[eé](?: da manh[ãa])?(?! da tarde)/i],
  ['almoco', /almo[çc]o|almocei/i],
  ['jantar', /janta(?:r|rzinho|inha)?|jantei/i],
  ['ceia', /ceia/i],
];
/** A mensagem nomeia uma refeição DIFERENTE da última registrada ("o café da tarde eu tomei agora" logo depois do café)? */
export function mencionaOutraRefeicao(texto, slotUltima) {
  const t = String(texto || '');
  const achados = TIPO_REFEICAO.filter(([, re]) => re.test(t)).map(([id]) => id);
  if (!achados.length) return false;
  // "café da tarde" casa com lanche e não com cafe: a ordem da lista e o lookahead cuidam disso
  return achados.some((id) => id !== slotUltima);
}

/** Bloco das regras ativas pro system prompt. '' sem regras. */
export function blocoLicoes(regras) {
  const lista = (regras || []).map((r) => String(r || '').trim()).filter(Boolean).slice(0, 8);
  if (!lista.length) return '';
  return `MINHAS LIÇÕES (erros que eu já cometi com este grupo e regras que adotei; valem em TODA resposta, antes de qualquer número ou bronca):\n${lista.map((r) => `- ${r}`).join('\n')}`;
}
