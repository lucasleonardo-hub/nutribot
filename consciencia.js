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
// mensagem que só ANUNCIA a refeição sem dizer o que é ("meu almoço hoje vai ser adaptado", "não consigo sair do serviço",
// "vou mandar a janta"): a comida vem em seguida, então vale esperar mesmo sem refeição em andamento
const RE_ANUNCIO = /\b(vai ser|vou (mandar|comer|almo[çc]ar|jantar|fazer|pedir)|hoje (vai|foi|é|t[ôo]|vou)|adaptad\w*|j[áa] (mando|passo|envio)|depois (mando|complemento|passo|envio)|n[ãa]o consigo|n[ãa]o deu|segura|pera|espera a[íi]|calma)\b/i;
export function candidatoAFragmento({ texto, temImagem = false, temAudio = false, minutosDesdeUltima = Infinity } = {}) {
  const t = String(texto || '').trim();
  if (temAudio || t.startsWith('!')) return false;
  const emAndamento = minutosDesdeUltima >= 0 && minutosDesdeUltima <= 30;
  if (!emAndamento) return !temImagem && t.length > 0 && t.length <= 70 && !/\?\s*$/.test(t) && RE_ANUNCIO.test(t);
  if (temImagem) return t.length <= 60;
  return t.length > 0 && t.length <= 80 && !/\?\s*$/.test(t);
}
/** registros = Map jid -> { estado, em } vindo da presença do WhatsApp; true se algum jid da pessoa digitava/gravava há menos de janelaMs. */
export function digitandoRecente(registros, jids, agoraMs = Date.now(), janelaMs = 10_000) {
  for (const j of jids || []) {
    const r = registros?.get?.(j);
    if (r && (r.estado === 'composing' || r.estado === 'recording') && agoraMs - r.em <= janelaMs) return true;
  }
  return false;
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

// ---------- Repetição entre mensagens seguidas (clima, sono, agenda, total do dia ditos duas vezes) ----------
const CATEGORIAS_CONTEXTO = [
  ['clima', /\b\d{1,2}\s?°\s?c\b|graus|garoa|chuva|chuvisc|friozinho|frio\b|calor[ãa]o|calor\b|tempinho|tempo (?:fechado|abafado|nublado)|nublado|ventando|vento\b|sol forte/i],
  ['sono', /\bdormiu?\b|\bsono\b|noite mal dormida|\b\dh\d{2} (?:de sono|na última noite)|menos de \dh/i],
  ['agenda', /\bamanh[ãa]\b[^.!?\n]{0,60}\b(aula|reuni[ãa]o|prova|trabalho|compromisso|cedo)\b|\b(aula|reuni[ãa]o|prova) (?:de|às)\b/i],
  ['total', /j[áa] (?:mandou|bateu|comeu|somou|consumiu)[^.!?\n]{0,40}\d[\d.]*\s?kcal|\d[\d.]*\s?kcal (?:pra dentro|no dia|hoje)|\d{2,3}\s?g de \[\[?prote[íi]na\]?\]? hoje/i],
  ['passos', /\d[\d.]*\s?passos/i],
];
const norm = (t) => semAcentoC(t).replace(/\[\[|\]\]/g, '').replace(/[*_~`]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const PALAVRAS_FRACAS = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'que', 'pra', 'para', 'com', 'em', 'no', 'na', 'um', 'uma', 'se', 'sua', 'seu', 'voce', 'você', 'ja', 'mais', 'por', 'ou', 'os', 'as', 'dos', 'das', 'ao', 'tá', 'ta', 'é', 'eh', 'meu', 'minha', 'esse', 'essa', 'isso']);
const palavras = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 2 && !PALAVRAS_FRACAS.has(w)));
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
};
const LINHA_ESTRUTURADA = /^\s*(?:[🕐🍽️🔥⚖️💡📊🛒📍🪞🏐]|\*?(?:Calorias|Prote[íi]na|Carboidratos|Gorduras|Refei[çc][ãa]o|Estimativa|Veredito|Dica|Sugest[ãa]o)\b)/u;
const frasesDe = (t) => String(t || '').split(/(?<=[.!?…])\s+(?=[A-ZÀ-Ú"“(*_\d])/u);

/** Mensagens do bot nos últimos `janelaMin` minutos (hora "HH:MM" no mesmo dia). */
export function respostasRecentes(historico, horaAgora, janelaMin = 120) {
  const agoraMin = _min(horaAgora);
  return (historico || []).filter((m) => m.tipo === 'bot' && m.texto && !/^\(/.test(m.texto) && agoraMin - _min(m.hora) >= 0 && agoraMin - _min(m.hora) <= janelaMin);
}
const _min = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1e9;
};

/** Resumo pro prompt: que comentários de contexto já saíram nas últimas 2 h e quantas vezes. '' se nada. */
export function temasJaDitos(historico, horaAgora, { janelaMin = 120 } = {}) {
  const recentes = respostasRecentes(historico, horaAgora, janelaMin);
  const vistos = new Map();
  for (const m of recentes) {
    for (const [cat, re] of CATEGORIAS_CONTEXTO) {
      if (!re.test(m.texto)) continue;
      const v = vistos.get(cat) || { n: 0, ultima: m.hora, para: new Set() };
      v.n += 1;
      v.ultima = m.hora;
      vistos.set(cat, v);
    }
  }
  if (!vistos.size) return '';
  const nome = { clima: 'clima/temperatura', sono: 'sono curto', agenda: 'agenda de amanhã/aula', total: 'total do dia (kcal/proteína)', passos: 'passos' };
  return (
    `JÁ DITO POR VOCÊ NAS ÚLTIMAS 2 H (o grupo inteiro leu; NÃO repita nem reformule, nem pra outra pessoa; só volte ao tema se a mensagem atual pedir): ` +
    [...vistos.entries()].map(([c, v]) => `${nome[c]} (${v.n}x, última ${v.ultima})`).join(' · ')
  );
}

/**
 * Tira da resposta as frases que repetem (quase) literalmente algo dito nas últimas respostas, e os comentários de clima,
 * sono e agenda que já saíram na janela (a menos que a pessoa tenha puxado o assunto). Linhas do bloco estruturado ficam.
 */
export function removerRepeticoes(resposta, anteriores, { textoPessoa = '', limiar = 0.6 } = {}) {
  const prev = (anteriores || []).flatMap((m) => frasesDe(m.texto)).map((f) => ({ f, p: palavras(f) })).filter((x) => x.p.size >= 5);
  const catsAnteriores = new Set();
  for (const m of anteriores || []) for (const [cat, re] of CATEGORIAS_CONTEXTO) if (re.test(m.texto)) catsAnteriores.add(cat);
  // com borda de palavra: "hipercalórico" não é falar de calor, "insônia" é falar de sono
  const pessoaFalou = (cat) => (cat === 'clima' ? /\b(clima|tempo|frio|friozinho|calor|calor[ãa]o|chuva|garoa|graus)\b|°/i : cat === 'sono' ? /\b(dormi\w*|sono|ins[ôo]nia|cansad\w*|acordei)\b/i : cat === 'agenda' ? /\b(amanh[ãa]|aula|prova|reuni[ãa]o)\b/i : /./).test(textoPessoa);
  const removidas = [];
  const linhas = String(resposta || '').split('\n');
  const saida = linhas.map((linha) => {
    if (!linha.trim() || LINHA_ESTRUTURADA.test(linha)) return linha;
    const frases = frasesDe(linha);
    if (frases.length === 1 && palavras(linha).size < 5) return linha;
    const mantidas = frases.filter((fr) => {
      const p = palavras(fr);
      if (p.size >= 5 && prev.some((x) => jaccard(p, x.p) >= limiar)) return removidas.push(fr), false;
      for (const [cat, re] of CATEGORIAS_CONTEXTO) {
        if (['clima', 'sono', 'agenda'].includes(cat) && catsAnteriores.has(cat) && re.test(fr) && !pessoaFalou(cat)) return removidas.push(fr), false;
      }
      return true;
    });
    return mantidas.join(' ');
  });
  let texto = saida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // conector órfão no começo de linha ("Aliás, falando em sono," sem o resto) sai junto
  texto = texto.replace(/^(?:ali[áa]s|e|mas|por[ée]m|al[ée]m disso)[,:]?\s*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!texto) return { texto: resposta, removidas: [] };
  return { texto, removidas };
}

// ---------- Oferta de sexta do plano da semana: resposta de aceite ----------
// aceite curto e inequívoco ("quero", "bora", "manda aí", "pode montar") ou frase que fala do plano/lista ("quero o plano, orçamento curto").
// "eu almocei arroz" ou "pode me dizer as calorias?" não podem virar plano só porque a oferta está aberta.
const RE_ACEITE_CURTO = /^(?:sim|quero|bora|claro|topo|dale|partiu|manda(?:\s+a[ií]|\s+sim|\s+o\s+meu|\s+o\s+plano|\s+a\s+lista)?|pode\s+(?:mandar|montar|fazer)|monta(?:\s+o\s+meu|\s+pra\s+mim)?|faz\s+o\s+meu|quero\s+(?:sim|o\s+meu|o\s+plano|a\s+lista))\b/i;
const RE_FALA_DO_PLANO = /\b(plano|lista\s+de\s+compras|compras)\b/i;
const RE_VERBO_ACEITE = /\b(quero|sim|manda|pode|bora|monta|faz|topo|vamos)\b/i;
const RE_RECUSA_PLANO = /\b(n[aã]o|nem|dispenso|depois|passo|semana que vem)\b/i;
/** Lê a resposta à oferta: { aceite, pedido } (pedido = o que sobra depois do "quero": orçamento, mercado perto, restrição). */
export function pareceAceitePlano(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 160 || t.startsWith('!') || RE_RECUSA_PLANO.test(t)) return { aceite: false, pedido: '' };
  const curto = RE_ACEITE_CURTO.test(t) && t.length <= 60;
  const doPlano = RE_FALA_DO_PLANO.test(t) && RE_VERBO_ACEITE.test(t);
  if (!curto && !doPlano) return { aceite: false, pedido: '' };
  let pedido = t.replace(RE_ACEITE_CURTO, '').replace(/^[\s,.:;!-]+/, '');
  // tira o que ainda é parte do aceite ("o meu plano", "a lista", "mas", "por favor") até sobrar só o pedido
  const RE_SOBRA = /^(?:eu|sim|quero|manda|monta|faz|o\s+meu|meu|o\s+plano|plano|a\s+lista(?:\s+de\s+compras)?|lista|de\s+compras|por\s+favor|pfv|mas|e|s[óo]|s[óo]\s+que|que)\b[\s,.:;!-]*/i;
  for (let i = 0; i < 6 && RE_SOBRA.test(pedido); i++) pedido = pedido.replace(RE_SOBRA, '');
  pedido = pedido.trim();
  return { aceite: true, pedido: pedido.length >= 6 ? pedido : '' };
}
