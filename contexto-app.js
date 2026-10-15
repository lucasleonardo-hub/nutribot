// contexto-app.js - Fase 7: a Nutri sabe de tudo, e o que é confidência fica em confidência.
//
// Três partes:
// 1. Blocos PUROS com o que chega pelo app (humor dos últimos dias, eventos, perguntas feitas no app) pros prompts que já
//    existem (conversa do WhatsApp, pensamentos, reflexão, plano), sem chamada nova de IA.
// 2. Guardas em código (decisão D10 e a regra de privacidade do plano da fase 7): pergunta do app e texto do humor são
//    CONFIDÊNCIA. `semConfidencias` tira da resposta que vai pro grupo a frase que copia a confidência; `protegerFerramentas`
//    impede que ela vire anotação ou memória vetorial; `assuntoConfidencial` segura a mensagem espontânea nascida dela.
//    `slotsSuspensos` diz qual refeição um evento do app (comer fora, festa, viagem) tira da cobrança.
// 3. `montarContextoApp(perfil, { hoje })`: o contexto único de `sugerirRefeicao` e `responderApp` (a mesma cabeça do
//    WhatsApp): lições (já no prompt pelo gemini.js), fatos guardados, reflexão, pensamento de hoje, o que a própria pessoa
//    disse hoje no grupo, humor da semana, eventos, corpo (sono, energia, atividade) e o treino de hoje. Só Mongo e memória.
//
// Nada daqui é lido pelos compiladores do resumo do dia, da semana, dos momentos, do diário da Nutri nem pela memória
// vetorial: eles leem outras fontes (contextoDoDia, histórico do grupo), e este módulo não escreve em nenhuma delas.

import { SLOTS, slotDaHora, semAcento, diasAnteriores } from './util.js';

// ============================================================
// Datas
// ============================================================
const SIGLA_DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dm = (dia) => `${String(dia).slice(8, 10)}/${String(dia).slice(5, 7)}`;
const dowDe = (dia) => SIGLA_DOW[new Date(`${dia}T12:00:00Z`).getUTCDay()];
const somarDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** "hoje", "ontem", "amanhã" ou "sex 10/10". */
function quando(dia, hoje) {
  if (!hoje || !dia) return dia || '';
  if (dia === hoje) return 'hoje';
  if (dia === somarDias(hoje, -1)) return 'ontem';
  if (dia === somarDias(hoje, 1)) return 'amanhã';
  return `${dowDe(dia)} ${dm(dia)}`;
}
const corta = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s;
};

// ============================================================
// Humor dos últimos dias
// ============================================================
const ROTULO_HUMOR = ['', 'péssimo', 'ruim', 'ok', 'bom', 'ótimo'];
/**
 * Puro. Humor marcado no app nos últimos `dias` (até `hoje`), mais antigo primeiro. `confidencia: true` (só em prompt que
 * NÃO vai pro grupo: pensamentos, reflexão, app) acrescenta o que a pessoa escreveu, marcado como confidência. '' sem nada.
 */
export function blocoHumorDias(humores = [], { hoje, dias = 7, confidencia = false } = {}) {
  if (!hoje) return '';
  const desde = somarDias(hoje, -(dias - 1));
  const lista = (humores || []).filter((h) => h?.dia && h.dia >= desde && h.dia <= hoje && Number(h.humor) > 0).sort((a, b) => a.dia.localeCompare(b.dia));
  if (!lista.length) return '';
  const item = (h) => {
    const partes = [`${ROTULO_HUMOR[h.humor] || h.humor} (${h.humor}/5)`];
    if (Number(h.energia) > 0) partes.push(`energia ${h.energia}/5`);
    if (Number(h.sono) > 0) partes.push(`sono sentido ${h.sono}/5`);
    return `${quando(h.dia, hoje)}: ${partes.join(', ')}`;
  };
  let texto = `HUMOR PELO APP (${dias} dias, marcado pela própria pessoa): ${lista.map(item).join('; ')}.`;
  const comTexto = confidencia ? lista.filter((h) => String(h.texto || '').trim()) : [];
  if (comTexto.length) {
    texto += `\nEm confidência (leve em conta e não cite nem parafraseie em público): ${comTexto.map((h) => `${quando(h.dia, hoje)}: "${corta(h.texto, 200)}"`).join('; ')}.`;
  }
  return texto;
}

// ============================================================
// Eventos do app e a cobrança
// ============================================================
const NOME_TIPO = { comer_fora: 'refeição fora', festa: 'festa', viagem: 'viagem', treino: 'treino', consulta: 'consulta', outro: 'compromisso' };
const RE_FORA = /\b(restaurante|rod[ií]zio|churrasco|anivers[aá]rio|happy ?hour|jantar fora|almo[cç]o fora|lanche fora|caf[eé] fora|pizzaria|hamburgueria|boteco|confraterniza)/i;
// sem \b depois do "é": em JS o \b só conhece ASCII, e "café " (acento seguido de espaço ou do fim) não casaria
const PALAVRA_SLOT = [
  [/\bcaf[eé](?![a-zà-ÿ])/i, 'cafe'],
  [/\balmo[cç]/i, 'almoco'],
  [/\blanche\b/i, 'lanche'],
  [/\bjant|\bjanta\b/i, 'jantar'],
  [/\bceia\b/i, 'ceia'],
];
/** Puro. O evento é de refeição fora de casa (comer fora, festa, ou um compromisso com cara de restaurante)? */
export const ehEventoDeRefeicao = (e) => Boolean(e && (e.tipo === 'comer_fora' || e.tipo === 'festa' || ((e.tipo === 'outro' || !e.tipo) && RE_FORA.test(`${e.titulo || ''} ${e.nota || ''}`))));

/**
 * Puro. Quais refeições de `dia` os eventos do app tiram da cobrança: viagem = o dia inteiro; refeição fora (comer fora,
 * festa) = a refeição da hora marcada (slotDaHora) ou, sem hora, a que o título ou a nota nomeiam; sem pista, festa = jantar e
 * comer fora = almoço e jantar. Devolve um Map slotId -> evento (o primeiro que suspendeu).
 */
export function slotsSuspensos(eventos = [], dia) {
  const m = new Map();
  const marcar = (id, e) => {
    if (!m.has(id)) m.set(id, e);
  };
  for (const e of eventos || []) {
    if (!e || e.dia !== dia) continue;
    if (e.tipo === 'viagem') {
      for (const s of SLOTS) marcar(s.id, e);
      continue;
    }
    if (!ehEventoDeRefeicao(e)) continue;
    if (e.hora && /^\d{1,2}:\d{2}$/.test(e.hora)) {
      marcar(slotDaHora(e.hora).id, e);
      continue;
    }
    const texto = `${e.titulo || ''} ${e.nota || ''}`;
    const nomeados = PALAVRA_SLOT.filter(([re]) => re.test(texto)).map(([, id]) => id);
    const ids = nomeados.length ? nomeados : e.tipo === 'festa' ? ['jantar'] : ['almoco', 'jantar'];
    for (const id of ids) marcar(id, e);
  }
  return m;
}
/** Puro. O evento que suspende a cobrança desse slot hoje, ou null. */
export const eventoQueSuspende = (eventos, dia, slotId) => slotsSuspensos(eventos, dia).get(slotId) || null;

/**
 * Puro. Uma linha por evento de hoje até `dias` à frente, mais cedo primeiro. '' sem nada. `publico: true` (prompt cujo
 * texto sai no GRUPO: cobrança, plano da semana) leva só refeição fora, festa e viagem, e sem a nota: consulta, treino e
 * compromisso pessoal marcados no app não chegam a quem pode citá-los no grupo.
 */
export function blocoEventosApp(eventos = [], { hoje, dias = 3, titulo = 'EVENTOS MARCADOS NO APP pela própria pessoa', publico = false } = {}) {
  if (!hoje) return '';
  const ate = somarDias(hoje, dias);
  const lista = (eventos || [])
    .filter((e) => e?.dia && e.dia >= hoje && e.dia <= ate)
    .filter((e) => !publico || e.tipo === 'viagem' || ehEventoDeRefeicao(e))
    .sort((a, b) => `${a.dia} ${a.hora || '99'}`.localeCompare(`${b.dia} ${b.hora || '99'}`));
  if (!lista.length) return '';
  const linhas = lista.slice(0, 8).map((e) => {
    const susp = slotsSuspensos([e], e.dia);
    const refeicoes = [...susp.keys()].map((id) => SLOTS.find((s) => s.id === id)?.nome).filter(Boolean);
    const efeito = e.tipo === 'viagem' ? ' (viagem: sem cobrança de refeição nesse dia)' : refeicoes.length ? ` (${refeicoes.join(' e ')} fora de casa: não cobre e encaixe o resto do dia)` : '';
    return `- ${quando(e.dia, hoje)}${e.hora ? ` ${e.hora}` : ''}: ${corta(e.titulo, 80)} (${NOME_TIPO[e.tipo] || e.tipo || 'compromisso'})${e.nota && !publico ? ` — ${corta(e.nota, 120)}` : ''}${efeito}`;
  });
  return `${titulo}:\n${linhas.join('\n')}`;
}

// ============================================================
// Perguntas feitas no app (confidência, D10)
// ============================================================
const MS_H = 3600_000;
const instante = (p) => {
  const t = p?.em ? new Date(p.em).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const horaDe = (p, fuso) => {
  const t = instante(p);
  if (t == null) return '';
  try {
    return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso || 'America/Sao_Paulo' });
  } catch {
    return '';
  }
};
const CABECALHO_PERGUNTAS = {
  conversa: 'PERGUNTOU NO APP (em confidência: leve em conta e retome só se ela(e) mesma(o) puxar o assunto; NUNCA cite no grupo, nem diga que ela(e) perguntou)',
  pensamentos: 'PERGUNTAS QUE FEZ NO APP HOJE (confidência: use pra entender, não copie a pergunta no pensamento)',
  reflexao: 'O QUE PERGUNTOU NO APP NA SEMANA (confidência: sinal pras suas suspeitas; não copie as perguntas no texto)',
};
/**
 * Puro. Recorte das perguntas do app por prompt (mapa, seção 3): conversa = as 3 últimas de 48 h; pensamentos = as do dia;
 * reflexão = temas e contagem da semana + até 10 perguntas. `agoraMs` = instante de referência. Lista vazia = [].
 */
export function recortePerguntas(lista = [], { modo = 'conversa', agoraMs = Date.now(), hoje = null } = {}) {
  const validas = (lista || []).filter((p) => p && String(p.pergunta || '').trim()).sort((a, b) => (instante(a) || 0) - (instante(b) || 0));
  if (modo === 'pensamentos') return validas.filter((p) => (hoje ? p.dia === hoje : (instante(p) || 0) >= agoraMs - 24 * MS_H));
  if (modo === 'reflexao') return validas.filter((p) => (instante(p) || 0) >= agoraMs - 7 * 24 * MS_H).slice(-10);
  return validas.filter((p) => (instante(p) || 0) >= agoraMs - 48 * MS_H).slice(-3);
}
/**
 * Puro. O texto das perguntas pro prompt, no formato desta frente (o módulo perguntas.js da frente A tem o seu
 * `blocoPerguntasApp`; `perguntasParaPrompt` usa o dele quando existe e cai neste quando não). '' sem nada.
 */
export function formatarPerguntas(lista = [], { modo = 'conversa', hoje = null, fuso = null, agoraMs = Date.now() } = {}) {
  const sel = recortePerguntas(lista, { modo, agoraMs, hoje });
  if (!sel.length) return '';
  const linha = (p) => `- ${quando(p.dia, hoje) || ''}${horaDe(p, fuso) ? ` ${horaDe(p, fuso)}` : ''}: "${corta(p.pergunta, 120)}"${p.resposta ? ` → você respondeu: ${corta(p.resposta, 140)}` : ''}`;
  let texto = `${CABECALHO_PERGUNTAS[modo] || CABECALHO_PERGUNTAS.conversa}:\n${sel.map(linha).join('\n')}`;
  if (modo === 'reflexao') {
    const temas = new Map();
    for (const p of sel) temas.set(p.tema || 'outro', (temas.get(p.tema || 'outro') || 0) + 1);
    texto = `${CABECALHO_PERGUNTAS.reflexao}: ${sel.length} pergunta(s); temas: ${[...temas.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(', ')}.\n${sel.map(linha).join('\n')}`;
  }
  return texto;
}
// perguntas.js (frente A): modos 'conversa', 'pensamento' (singular) e 'reflexao'
const MODO_FRENTE_A = { conversa: 'conversa', pensamentos: 'pensamento', reflexao: 'reflexao' };
/**
 * O bloco das perguntas pro prompt: o `blocoPerguntasApp(lista, { modo })` do perguntas.js quando existe e devolve texto,
 * senão o formatarPerguntas daqui. Sempre recorta antes (o mesmo recorte vale pros dois).
 */
export function perguntasParaPrompt(lista = [], { modo = 'conversa', hoje = null, fuso = null, agoraMs = Date.now(), modulo = null, nome = '' } = {}) {
  const sel = recortePerguntas(lista, { modo, agoraMs, hoje });
  if (!sel.length) return '';
  if (typeof modulo?.blocoPerguntasApp === 'function') {
    try {
      const t = String(modulo.blocoPerguntasApp(sel, { modo: MODO_FRENTE_A[modo] || modo, nome }) || '').trim();
      if (t) return t;
    } catch {}
  }
  return formatarPerguntas(sel, { modo, hoje, fuso, agoraMs });
}
/**
 * Puro. A mensagem de agora puxa o assunto dessa confidência? (D10: "só retoma se a pessoa puxar".) Uma palavra de
 * conteúdo (5+ letras) com o mesmo começo (4 letras: "ansiosa" e "ansiedade") basta. `textoAtual` null = não se sabe
 * (quem chama sem a mensagem): conta como puxou, o comportamento de antes.
 */
export function puxouAssunto(textoAtual, confidencia) {
  if (textoAtual == null) return true;
  const radicais = (t) => new Set(palavras(t).filter((p) => p.length >= 5 && !PARADAS.has(p)).map((p) => p.slice(0, 4)));
  const a = radicais(textoAtual);
  if (!a.size) return false;
  return [...radicais(confidencia)].some((r) => a.has(r));
}

/**
 * Puro. O bloco "PELO APP" da conversa do WhatsApp (a resposta sai no GRUPO), o MESMO em produção (mensagens.js) e na
 * avaliação (avaliacao/cenarios.mjs): a linha do humor de hoje (`formatarHoje(humor)`, o api-escrita.blocoApp), o humor dos
 * dias anteriores só em números, os eventos de hoje a +3 dias, as 3 últimas perguntas do app em 48 h (pelo perguntas.js
 * quando `modulo` vem) e a linha só desta pessoa (D12). '' sem nada.
 * D10 em código: o modelo parafraseia o que recebe ("ansiosa" vira "ansiedade" no grupo), então o texto do humor e as
 * perguntas do app só entram quando `textoAtual` (a mensagem de agora) puxa o assunto deles; senão o humor vai só em números.
 */
export function blocoAppConversa({ formatarHoje = null, humores = [], eventos = [], perguntas = [], dia, fuso = null, agoraMs = Date.now(), modulo = null, linhaPropria = '', textoAtual = null } = {}) {
  const deHoje = (humores || []).find((h) => h?.dia === dia) || null;
  const humorHoje = deHoje && deHoje.texto && !puxouAssunto(textoAtual, deHoje.texto) ? { ...deHoje, texto: '' } : deHoje;
  const puxadas = (perguntas || []).filter((p) => puxouAssunto(textoAtual, p?.pergunta));
  return [
    humorHoje && typeof formatarHoje === 'function' ? formatarHoje(humorHoje) : '',
    blocoHumorDias((humores || []).filter((h) => h?.dia && h.dia < dia), { hoje: dia, dias: 7 }),
    blocoEventosApp(eventos, { hoje: dia, dias: 3, titulo: 'Compromissos que ela(e) marcou no app' }),
    perguntasParaPrompt(puxadas, { modo: 'conversa', hoje: dia, fuso, agoraMs, modulo }),
    linhaPropria ? `Só desta pessoa (dado sensível; comente só se ela(e) perguntar do próprio sono, nunca com outra pessoa): ${linhaPropria}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

let moduloPerguntas; // undefined = ainda não tentou; null = não existe
async function carregarModuloPerguntas() {
  if (moduloPerguntas !== undefined) return moduloPerguntas;
  moduloPerguntas = await import('./perguntas.js').catch(() => null);
  return moduloPerguntas;
}
/**
 * As perguntas do app da pessoa desde `desde` (Date), pelo `perguntasDe(jid, { desde, n })` do perguntas.js (frente A).
 * Sem o módulo ou com falha: []. Filtra de novo pelo instante, pra não depender do formato de `desde` do outro lado.
 */
export async function perguntasRecentes(perfil, { desde, n = 30, modulo = undefined } = {}) {
  const jid = perfil?.jids?.[0];
  if (!jid) return [];
  const m = modulo === undefined ? await carregarModuloPerguntas() : modulo;
  if (typeof m?.perguntasDe !== 'function') return [];
  const lista = await Promise.resolve(m.perguntasDe(jid, { desde, n })).catch(() => []);
  const corte = desde instanceof Date ? desde.getTime() : null;
  return (Array.isArray(lista) ? lista : []).filter((p) => corte == null || (instante(p) ?? corte) >= corte);
}
export const moduloDePerguntas = () => carregarModuloPerguntas();

// ============================================================
// Guardas de confidência (D10, D11): em código, não só no prompt
// ============================================================
const PARADAS = new Set('a o as os um uma uns umas de da do das dos e em no na nos nas que pra para por com sem se eu me mim meu minha voce vc ele ela isso isto esse essa ja mais muito pouco tem ter tava estou to ta foi ser sou e nao sim mas ou como quando onde porque qual quais ate apos sobre'.split(' '));
const normalizar = (t) =>
  semAcento(String(t || ''))
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const palavras = (t) => normalizar(t).split(' ').filter(Boolean);
const JANELA = 5; // palavras seguidas iguais à confidência = cópia
/** Menção explícita de que a pessoa perguntou/contou no app ("você me perguntou no app", "pelo app você contou"). */
const RE_MENCAO_APP = /(perguntou|perguntaste|contou|disse|falou|escreveu|desabafou|confessou|comentou)\s+(?:\S+\s+){0,3}(no|pelo|pela|na)\s+(app|aplicativo|conversa privada)|(no|pelo|pela)\s+(app|aplicativo)\s+(?:\S+\s+){0,3}(perguntou|contou|disse|falou|escreveu|desabafou|confessou|comentou)|(sua|tua)\s+pergunta\s+(no|do|pelo)\s+(app|aplicativo)|(no|pelo)\s+(app|aplicativo)\s+(?:\S+\s+){0,2}(humor|desabafo)/;

/**
 * Puro. Os textos que são confidência: perguntas do app, o começo da resposta (o "respondi: ..." que entra no prompt, até
 * 400 letras: cobre os recortes de 140 e 240 do perguntas.js) e o texto do humor.
 */
export function confidenciasDe({ perguntas = [], humores = [] } = {}) {
  const out = [];
  for (const p of perguntas || []) {
    if (String(p?.pergunta || '').trim()) out.push(String(p.pergunta));
    if (String(p?.resposta || '').trim()) out.push(String(p.resposta).slice(0, 400));
  }
  for (const h of humores || []) if (String(h?.texto || '').trim()) out.push(String(h.texto));
  return out;
}

// D12 em código: oxigênio no sangue e temperatura da pele são só da própria pessoa. Texto que é republicado no grupo
// (pensamento no !pensamentos, mensagem espontânea, reflexão no !reflexao, cobrança) não pode carregar isso.
const RE_CORPO_SENSIVEL = /\b(oxigenio|oxigenacao|saturacao|saturando|saturou|spo2|oximetr\w*)\b|temperatura\s+(?:\S+\s+){0,2}(pele|corporal|corpo)\b/;
/** Puro. O texto fala de oxigênio no sangue ou temperatura da pele/corpo (D12)? */
export const mencionaCorpoSensivel = (texto) => RE_CORPO_SENSIVEL.test(normalizar(texto));
/** Puro. Tira as frases que falam de oxigênio ou temperatura da pele (D12). Devolve { texto, removidas }. */
export const semCorpoSensivel = (texto) => tirarFrasesQue(texto, (f) => mencionaCorpoSensivel(f));
/** Puro. O trecho copia uma confidência (5+ palavras seguidas iguais, ou ela inteira quando tem 3 a 4 palavras com conteúdo)? */
export function contemConfidencia(texto, confidencias = []) {
  const alvo = ` ${palavras(texto).join(' ')} `;
  if (alvo.trim().length === 0) return false;
  for (const c of confidencias || []) {
    const ps = palavras(c);
    if (ps.length < 3) continue;
    if (ps.length < JANELA) {
      const conteudo = ps.filter((p) => !PARADAS.has(p) && p.length >= 3);
      if (conteudo.length >= 2 && alvo.includes(` ${ps.join(' ')} `)) return true;
      continue;
    }
    for (let i = 0; i + JANELA <= ps.length; i++) {
      const janela = ps.slice(i, i + JANELA);
      if (janela.filter((p) => !PARADAS.has(p)).length < 2) continue; // "eu to com uma" não é cópia de nada
      if (alvo.includes(` ${janela.join(' ')} `)) return true;
    }
  }
  return false;
}
/**
 * Puro. Tira do texto que vai pro GRUPO as frases que copiam uma confidência ou dizem que a pessoa perguntou/contou algo no
 * app. Linha por linha, frase por frase; o resto fica como estava. Devolve { texto, removidas }.
 */
export function semConfidencias(texto, confidencias = []) {
  return tirarFrasesQue(texto, (f) => contemConfidencia(f, confidencias) || RE_MENCAO_APP.test(normalizar(f)));
}
/** Puro. Tira, linha por linha e frase por frase, as frases em que `vaza(frase)` é verdadeiro. Devolve { texto, removidas }. */
function tirarFrasesQue(texto, vaza) {
  const original = String(texto || '');
  if (!original.trim()) return { texto: original, removidas: [] };
  const removidas = [];
  const linhas = original.split('\n').map((linha) => {
    if (!linha.trim()) return linha;
    const frases = linha.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g) || [linha];
    const ficam = frases.filter((f) => {
      const sai = vaza(f);
      if (sai && f.trim()) removidas.push(f.trim());
      return !sai;
    });
    return ficam.join('').replace(/\s+$/, '');
  });
  if (!removidas.length) return { texto: original, removidas };
  const limpo = linhas
    .filter((l, i) => l.trim() || !original.split('\n')[i].trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { texto: limpo, removidas };
}
/**
 * Puro. O assunto de uma mensagem espontânea nasceu de uma confidência? (2+ palavras de conteúdo, com 5+ letras, em comum
 * com alguma pergunta do app ou texto do humor.) Aí a Nutri não puxa o assunto no grupo.
 */
export function assuntoConfidencial(assunto, confidencias = []) {
  const chaves = (t) => new Set(palavras(t).filter((p) => p.length >= 5 && !PARADAS.has(p)));
  const a = chaves(assunto);
  if (!a.size) return false;
  return (confidencias || []).some((c) => [...chaves(c)].filter((p) => a.has(p)).length >= 2);
}
/**
 * Puro. A anotação (`anotar_memoria`) nasceu de confidência ou de dado sensível? Copia a confidência, diz que veio do app,
 * divide 2+ palavras de conteúdo com ela (paráfrase: "sono ruim atrapalha emagrecer") ou fala de oxigênio/temperatura (D12).
 * A anotação vai pra memória vetorial com o nome da pessoa e volta no prompt de outra pessoa no grupo.
 */
export function anotacaoConfidencial(texto, confidencias = []) {
  const t = String(texto || '');
  if (!t.trim()) return false;
  if (RE_MENCAO_APP.test(normalizar(t)) || mencionaCorpoSensivel(t)) return true;
  return Boolean(confidencias?.length) && (contemConfidencia(t, confidencias) || assuntoConfidencial(t, confidencias));
}
/**
 * As ferramentas da conversa/pensamento com a escrita protegida: `anotar_memoria` de confidência (cópia ou paráfrase) ou de
 * oxigênio/temperatura não grava (nem nas anotações, nem na memória vetorial). O resto passa igual; `usadas` é o mesmo array.
 */
export function protegerFerramentas(ferramentas, confidencias = []) {
  if (!ferramentas) return ferramentas;
  return {
    ...ferramentas,
    async executar(nome, args = {}) {
      if (nome === 'anotar_memoria' && anotacaoConfidencial(args?.texto, confidencias)) {
        ferramentas.usadas?.push?.(nome);
        return '(não guardei: isso veio em confidência pelo app e não vai pra memória; leve em conta só agora)';
      }
      return ferramentas.executar(nome, args);
    },
  };
}

// ============================================================
// Conversa do dia no grupo: só o que a própria pessoa disse
// ============================================================
/** Puro. As falas da própria pessoa hoje no grupo (sem respostas da bot nem falas dos outros), as últimas `n`. */
export function falasDaPessoa(mensagens = [], nome, { n = 10 } = {}) {
  const minhas = (mensagens || []).filter((m) => m && m.tipo !== 'bot' && m.nome === nome && String(m.texto || '').trim());
  return minhas.slice(-n).map((m) => `[${m.hora || '?'}] ${corta(m.texto, 180)}`);
}

// ============================================================
// Contexto único do app (sugerirRefeicao e responderApp)
// ============================================================
/**
 * Puro. O bloco de texto do contexto do app a partir das partes já buscadas. '' sem nada.
 * partes: { nome, fatos: [string], sintese, pensamento: { hora, texto }, falas: [string], humor, eventos, corpo, treino, fixas }
 */
export function blocoContextoApp(partes = {}) {
  const primeiro = String(partes.nome || 'a pessoa').split(' ')[0];
  const secoes = [];
  if (partes.fatos?.length) secoes.push(`FATOS QUE VOCÊ GUARDOU SOBRE ${primeiro.toUpperCase()} (aversões, combinados, rotina; respeite): ${partes.fatos.join(' · ')}`);
  if (partes.sintese) secoes.push(`COMO VOCÊ ENTENDE ${primeiro.toUpperCase()} (sua reflexão; pano de fundo, sem dizer que refletiu): ${corta(partes.sintese, 600)}`);
  if (partes.pensamento?.texto) secoes.push(`SEU PENSAMENTO DE HOJE SOBRE ${primeiro.toUpperCase()}${partes.pensamento.hora ? ` (${partes.pensamento.hora})` : ''} (particular; use pra escolher o que vale dizer): ${corta(partes.pensamento.texto, 700)}`);
  if (partes.falas?.length) secoes.push(`HOJE NO GRUPO DO WHATSAPP ${primeiro.toUpperCase()} DISSE (só as falas dela(e); é a mesma conversa, continue de onde parou):\n${partes.falas.join('\n')}`);
  if (partes.humor) secoes.push(partes.humor);
  if (partes.eventos) secoes.push(partes.eventos);
  if (partes.corpo) secoes.push(partes.corpo);
  if (partes.treino) secoes.push(partes.treino);
  if (partes.fixas) secoes.push(partes.fixas);
  return secoes.join('\n\n');
}

const TXT_ROTULO = { excelente: 'excelente', boa: 'boa', razoavel: 'razoável', atencao: 'pede atenção' };
/**
 * Puro. O corpo em uma linha a partir de `perfil.relogio` (saude.indicadoresRelogio): nota do sono e o ponto fraco, energia e
 * os fatores fracos, atividade (minutos ativos, distância, kcal ativas, pico). `propria: true` (só em prompt da própria
 * pessoa: reflexão e app; o pensamento NÃO, porque é republicado no grupo) acrescenta oxigênio e temperatura fora do normal
 * (D12). '' sem nada.
 */
export function corpoCompacto(relogio, { propria = false } = {}) {
  const r = relogio || {};
  const partes = [];
  if (r.sono?.nota != null) partes.push(`sono de ${dm(r.sono.dia)} nota ${r.sono.nota} (${TXT_ROTULO[r.sono.rotulo] || r.sono.rotulo || '?'})${r.sono.fraco ? `, ponto fraco: ${String(r.sono.fraco.nome).toLowerCase()} ${r.sono.fraco.valor}` : ''}`);
  if (r.energia?.nota != null) partes.push(`energia ${r.energia.nota}/100 em ${dm(r.energia.dia)}${r.energia.fracos?.length ? ` (puxada por ${r.energia.fracos.map((f) => `${String(f.nome).toLowerCase()} ${f.valor}`).join(' e ')})` : ''}`);
  const a = r.atividade;
  if (a) {
    const at = [a.minAtivos != null ? `${a.minAtivos} min ativos` : null, a.distanciaKm ? `${String(a.distanciaKm).replace('.', ',')} km` : null, a.kcalAtivas ? `${a.kcalAtivas} kcal ativas` : null, a.pico ? `mais ativa(o) ${a.pico}` : null].filter(Boolean);
    if (at.length) partes.push(`atividade em ${dm(a.dia)}: ${at.join(', ')}`);
  }
  if (propria && r.linhaPropria) partes.push(`${r.linhaPropria} (dado sensível: só desta pessoa)`);
  return partes.length ? `CORPO (relógio, a mesma conta do app): ${partes.join('; ')}.` : '';
}

/** Puro. Corpo em texto pro app (é só da própria pessoa: oxigênio e temperatura fora do normal entram). '' sem relógio. */
export const corpoParaApp = (relogio) => corpoCompacto(relogio, { propria: true });

function fontesPadrao() {
  return {
    async humores(perfil, de, ate) {
      return (await import('./mongo.js')).humorDe(perfil.jids || [], de, ate);
    },
    async eventos(perfil, de, ate) {
      return (await import('./mongo.js')).eventosDe(perfil.jids || [], de, ate);
    },
    async despensa(perfil) {
      return (await import('./despensa.js')).blocoDespensa(perfil);
    },
    async agenda(perfil) {
      return (await import('./agenda.js')).agendaDe(perfil, { dias: 1 }).then((a) => a?.bloco || '');
    },
    async ondeEsta(perfil) {
      if (!perfil.lugaresAtivo) return '';
      const s = await (await import('./lugares.js')).situacaoAtual(perfil);
      return (await import('./api.js')).ondeEstaGenerico(s);
    },
    async treino(perfil, dia) {
      return (await import('./contexto.js')).treinosDoDia(perfil, dia);
    },
    async fixas(perfil, dia) {
      const { blocoAtividades } = await import('./atividades.js');
      const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
      // o nome do lugar da atividade não vai pra IA do app (a resposta volta pro app sem passar pelo filtro inteiro)
      const semLugar = { ...perfil, atividades: (perfil.atividades || []).map(({ lugar: _l, ...a }) => a) };
      return blocoAtividades(semLugar, { dia, dow });
    },
    async estado() {
      return (await import('./estado.js')).estado;
    },
  };
}

/**
 * O contexto único do app. Devolve o que o api.js já usava do `contextoSugestao` ({ humor (o de hoje), eventos (os de hoje),
 * despensa, agenda, lugares (só o tipo de lugar), persona }) e mais:
 *   bloco: o texto pra `contextoApp` de sugerirRefeicao e responderApp (fatos, reflexão, pensamento de hoje, falas de hoje
 *          no grupo, humor da semana, eventos até +3 dias, corpo, treino de hoje, atividades fixas);
 *   confidencias: os textos que são confidência (pra quem quiser aplicar semConfidencias).
 * Cada fonte que falhar só fica de fora. `fontes` é injetável nos testes.
 */
export async function montarContextoApp(perfil, { hoje, fontes = fontesPadrao() } = {}) {
  const p = perfil || {};
  const nome = String(p.nome || '');
  const tenta = (fn, padrao) => Promise.resolve().then(fn).catch(() => padrao);
  const [humores, eventos, despensa, agenda, lugares, treino, fixas, estado] = await Promise.all([
    tenta(() => fontes.humores(p, diasAnteriores(hoje, 7)[0], hoje), []),
    tenta(() => fontes.eventos(p, hoje, somarDias(hoje, 3)), []),
    tenta(() => fontes.despensa(p), ''),
    tenta(() => fontes.agenda(p), ''),
    tenta(() => fontes.ondeEsta(p), ''),
    tenta(() => fontes.treino(p, hoje), null),
    tenta(() => fontes.fixas(p, hoje), ''),
    tenta(() => fontes.estado(), null),
  ]);
  const humorHoje = (humores || []).find((h) => h?.dia === hoje) || null;
  const caixasHoje = (treino?.caixas || []).filter((c) => (c.dias || []).includes(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][new Date(`${hoje}T12:00:00Z`).getUTCDay()]));
  let treinoTxt = '';
  if (caixasHoje.length) {
    const { blocoTreinosDoDia } = await import('./contexto.js');
    treinoTxt = blocoTreinosDoDia(caixasHoje, { dia: hoje, contexto: treino?.contexto || null, nome });
  }
  const falas = estado?.memoria?.dia === hoje || !estado?.memoria?.dia ? falasDaPessoa(estado?.memoria?.mensagens || [], nome) : [];
  const fatos = (p.anotacoes || []).slice(-10).map((a) => corta(a?.texto, 200)).filter(Boolean);
  const bloco = blocoContextoApp({
    nome,
    fatos,
    sintese: p.reflexao?.sintese || '',
    pensamento: p.pensamento?.dia === hoje ? p.pensamento : null,
    falas,
    humor: blocoHumorDias(humores, { hoje, dias: 7, confidencia: true }),
    eventos: blocoEventosApp(eventos, { hoje, dias: 3 }),
    corpo: corpoParaApp(p.relogio),
    treino: treinoTxt,
    fixas,
  });
  return {
    humor: humorHoje,
    eventos: (eventos || []).filter((e) => e?.dia === hoje),
    despensa: despensa || '',
    agenda: agenda || '',
    lugares: lugares || '',
    persona: estado?.persona || '',
    bloco,
    confidencias: confidenciasDe({ humores }),
  };
}
