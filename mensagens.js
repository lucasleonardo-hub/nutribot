// mensagens.js - O fluxo de cada mensagem do grupo: apresentação e nome, comandos, cadastro, decisão de responder ou não,
// resposta da IA (com pesquisa quando ela não sabe), atualização de perfil e registro de refeição.

import { extractMessageContent, jidNormalizedUser, proto } from '@whiskeysockets/baileys';

import { buscarPerfil, salvarPerfil, listarPerfis, persistirMemoria, registrarRefeicao, salvarConfig, momentosRecentes, salvarPendentes, carregarPendentes, registrarPesagem, refeicoesDoDia, atualizarRefeicao, apagarRefeicaoPorId, registrarHabito, registrarCorrecao, pesagensDesde } from './mongo.js';
import { mdPerfil } from './drive.js';
import * as ia from './gemini.js';
import { docsPara, salvarPesquisa } from './conhecimento.js';
import { pesquisar, formatarFontes } from './pesquisa.js';
import { dossieDe, salvarFicha } from './pessoas.js';
import { lerEstimativa, descricaoDaAnalise, lerTipoRefeicao, registradasHojeParaPrompt, lerRotuloRefeicao, nomeDoSlot, acharRegistro } from './resumo.js';
import { visaoDe } from './acompanhamento.js';
import { agora, fusoDe, fusoValido, slotDaHora, minutosDe, hhmmDe, mencionaNome, comTempo, parecePedidoOuPlano, pareceCorrecao, pareceConsumo, pedidoDeAudio, diasAnteriores, ultimaDoChat } from './util.js';
import { estado, naFila, GRUPO_PERMITIDO } from './estado.js';
import { enviar, enviarAudio, baixarMidia, meusJids, jidsDoRemetente, jidsDoPrivado, enviadosPeloBot, ACKS_FOTO, acaso, reagir, estaDigitando } from './whatsapp.js';
import { sintetizar } from './voz.js';
import { lembrancasPara } from './memoria_semantica.js';
import { climaParaPrompt } from './clima.js';
import { rotulosPara, buscarPorNome, buscarPorCodigo, blocoRotulos, ehCodigoBarras } from './off.js';
import { pareceContestacao, totaisConhecidos, numerosSuspeitos, candidatoAFragmento, vocabularioErrado, removerFrasesCom, pareceMetaConversa, mencionaOutraRefeicao, temasJaDitos, removerRepeticoes, respostasRecentes, papoCurto, enxugarPapo, bordoesJaDitos, removerBordoesRepetidos, corrigirGirias, concordarVocativos, parecePergunta } from './consciencia.js';
import { ferramentasPara } from './ferramentas.js';
import { registrarCorrecaoEstimativa, ehCorrecaoDeEstimativa } from './calibracao.js';
import { marcarResposta } from './proatividade.js';
import { lembrar, garantirDiaAtual, renomearNaMemoria } from './dia.js';
import { enriquecerPerfis, aplicarAtualizacao } from './perfis.js';
import { tratarComando, AJUDA, aceiteDePlano } from './comandos.js';
import { responderPendente, registrarRelato } from './atividades.js';
import { lerQr, interpretarQr, padronizarItens, registrarNota, resumoNota, confirmacaoNota, aplicarLinhaDespensa, blocoDespensa, testarConsultaSefaz, parsearTextoNfce, receberNotaDoApp } from './despensa.js';
import { blocoForcaRecuperacao } from './contexto.js';
import { metaBalancoPara, tendenciaGordura } from './resumo.js';
import { linhaDeTendencia } from './previsao.js';

// a pessoa está falando de treino, carga, platô, recuperação ou suplemento? aí o bloco FORÇA x RECUPERAÇÃO entra
const RE_TREINO = /\b(treino|treinei|treinar|academia|carga|peso (no|na|do) (supino|agach|exerc)|supino|agachamento|levantamento|terra|remada|puxada|repeti[çc][õo]es|s[ée]ries?|plat[ôo]|estagn|evolu[çc][ãa]o|progress|for[çc]a|recupera[çc][ãa]o|descanso|deload|dor muscular|creatina|whey|hipercal[óo]rico|suplemento|hevy|rpe)\b/i;
export const falaDeTreino = (t) => RE_TREINO.test(String(t || ''));
import { avisarErro } from './avisos.js';
import { registrarParaRevisao } from './revisao.js';
import { notaDeAtraso, atrasoEmMinutos, ATRASO_DESCULPAS_MIN, RESGATE_IDADE_MAX_H } from './retomada.js';

const IDADE_MAX_MSG_S = 6 * 60 * 60; // ignora mensagens com mais de 6h (flood após o bot voltar do sleep)
// Pedido de desculpas pela demora: uma vez por "volta" (não em cada mensagem atrasada do mesmo lote)
let ultimaDesculpaEm = 0;
const DESCULPA_INTERVALO_MS = 30 * 60_000;
/** A bot acabou de pedir desculpas por outro caminho (aviso de volta): as próximas respostas atrasadas não repetem. */
export function marcarDesculpaDada() {
  ultimaDesculpaEm = Date.now();
}
const PAPO_INTERVALO_MIN = Number(process.env.PAPO_INTERVALO_MIN) || 10; // papo aleatório: ela entra no máximo 1x a cada N min

const gruposIgnoradosLogados = new Set();

// Áudio espontâneo (ela achou que o momento merecia): no máximo 1 por dia e 2 por semana, e só com a voz ligada (!voz)
function podeAudioEspontaneo() {
  if (estado.config.vozLigada === false) return false;
  const lista = (estado.config.audiosEspontaneos || []).filter((iso) => Date.now() - new Date(iso).getTime() < 7 * 86400_000);
  const hoje = agora().dia;
  if (lista.some((iso) => agora(undefined, new Date(iso)).dia === hoje)) return false;
  return lista.length < 2;
}
async function marcarAudioEspontaneo() {
  const lista = (estado.config.audiosEspontaneos || []).filter((iso) => Date.now() - new Date(iso).getTime() < 7 * 86400_000);
  lista.push(new Date().toISOString());
  estado.config = await salvarConfig({ audiosEspontaneos: lista }).catch(() => estado.config);
}

// ============================================================
// Entrada: o que o whatsapp.js chama
// ============================================================
// Mensagens chegam numa lista e a fila drena a lista inteira de uma vez. Se acumulou atraso (IA lenta, bot fora do ar),
// as mensagens de texto do lote entram só no histórico e a ÚLTIMA recebe a resposta, já sabendo de tudo que chegou.
// Fotos e áudios do lote continuam sendo analisados um a um. Comandos e cadastro também rodam normalmente.
const pendentes = [];
let processando = null; // mensagem em andamento (pra salvar no desligamento também)
let processandoExtras = []; // fotos que entraram junto com ela (mesma análise)

const MAX_FOTOS = Number(process.env.MAX_FOTOS_JUNTAS) || 6; // teto por análise (cada foto custa tokens de entrada)
const JANELA_FOTOS_S = Number(process.env.JANELA_FOTOS_S) || 300; // fotos a mais de 5 min não são "o mesmo prato"

const ehFoto = (m) => Boolean(extractMessageContent(m?.message)?.imageMessage);
const remetenteDe = (m) => (jidsDoRemetente(m?.key || {})[0] || '');
const segundosDe = (m) => Number(m?.messageTimestamp) || 0;

/**
 * Fotos seguidas da MESMA pessoa (ex.: 3 fotos do mesmo prato, ou prato + copo + sobremesa) viram UMA análise:
 * a primeira mensagem leva as outras como `fotosExtras`. Texto solto no meio do bloco entra junto como legenda.
 * Só agrupa a partir de 2 fotos; mensagem de outra pessoa, comando ou intervalo grande fecham o bloco.
 * @returns {Array<{ msg: object, extras: object[] }>}
 */
export function agruparFotos(lote) {
  const grupos = [];
  for (let i = 0; i < lote.length; i++) {
    const msg = lote[i];
    if (!ehFoto(msg)) {
      grupos.push({ msg, extras: [] });
      continue;
    }
    const dono = remetenteDe(msg);
    const extras = [];
    let fotos = 1;
    let ultimaFotoEm = segundosDe(msg);
    let j = i + 1;
    while (j < lote.length && fotos < MAX_FOTOS) {
      const prox = lote[j];
      const texto = (extractMessageContent(prox?.message)?.conversation || '').trim();
      if (remetenteDe(prox) !== dono) break; // outra pessoa falou: fecha o bloco
      if (texto.startsWith('!')) break; // comando não entra na análise
      const foto = ehFoto(prox);
      const quando = segundosDe(prox);
      if (foto && ultimaFotoEm && quando && quando - ultimaFotoEm > JANELA_FOTOS_S) break;
      if (!foto && !lote.slice(j + 1).some((m) => ehFoto(m) && remetenteDe(m) === dono)) break; // texto depois da última foto: fica pra ele
      extras.push(prox);
      if (foto) {
        fotos++;
        ultimaFotoEm = quando || ultimaFotoEm;
      }
      j++;
    }
    if (fotos >= 2) {
      grupos.push({ msg, extras });
      i = j - 1;
    } else {
      grupos.push({ msg, extras: [] });
    }
  }
  return grupos;
}

// Janela de espera: quem manda 3 mensagens seguidas ("comi arroz", "e feijão", "e uma banana") não quer 3 respostas.
// Cada mensagem nova reinicia a espera (até um teto), e aí o lote inteiro é lido de uma vez.
const ESPERA_LOTE_MS = Number(process.env.ESPERA_LOTE_MS) || 6000;
const ESPERA_LOTE_MAX_MS = Number(process.env.ESPERA_LOTE_MAX_MS) || 20000;
let esperaTimer = null;
let esperaDesde = 0;

export function enfileirarMensagem(msg) {
  pendentes.push(msg);
  const agoraMs = Date.now();
  if (!esperaDesde) esperaDesde = agoraMs;
  if (esperaTimer) clearTimeout(esperaTimer);
  const restante = Math.max(0, Math.min(ESPERA_LOTE_MS, esperaDesde + ESPERA_LOTE_MAX_MS - agoraMs));
  esperaTimer = setTimeout(() => {
    esperaTimer = null;
    esperaDesde = 0;
    naFila('bot', drenar);
  }, restante);
}

// "Isto parece só um pedaço de informação": quem manda a foto do almoço e vai completando ("abóbora", "batata",
// "tem alface") não quer uma análise por mensagem. A IA leve julga se a mensagem parece pedaço de uma refeição em
// andamento e se vale esperar; se sim, a resposta é segurada (👀 na mensagem) e tudo que a pessoa mandar em seguida entra
// junto, até ESPERA_FRAGMENTO_MS de silêncio (teto ESPERA_FRAGMENTO_MAX_MS). Aí sai UMA resposta.
const ESPERA_FRAGMENTO_MS = Number(process.env.ESPERA_FRAGMENTO_MS) || 45_000;
const ESPERA_FRAGMENTO_MAX_MS = Number(process.env.ESPERA_FRAGMENTO_MAX_MS) || 90_000;
const esperaFragmentos = new Map(); // jid da pessoa -> { msgs, desde, timer }

// ferramentas na conversa (fase 2): FERRAMENTAS_CONVERSA=off desliga; o caminho normal continua sendo a reserva
const FERRAMENTAS_CONVERSA_ON = !/^(off|false|0|n[ãa]o)$/i.test(process.env.FERRAMENTAS_CONVERSA || 'on');
/** A bot já perguntou algo sobre a refeição dessa pessoa há pouco? (uma pergunta por refeição, nunca interrogatório) */
function perguntaRecenteDe(jid, hora) {
  const p = estado.memoria?.perguntas?.[jid];
  if (!p?.hora) return '';
  const dt = minutosDe(hora) - minutosDe(p.hora);
  if (dt < 0 || dt > 45) return '';
  return `VOCÊ JÁ FEZ UMA PERGUNTA SOBRE A REFEIÇÃO DESSA PESSOA ÀS ${p.hora} ("${p.pergunta}"): não pergunte de novo. Se a resposta veio nesta mensagem, é correção do registro; se não veio, registre com a melhor estimativa e siga.`;
}
const imagemMsg = (m) => Boolean(extractMessageContent(m?.message)?.imageMessage);
/** Bloco FORÇA x RECUPERAÇÃO com a faixa e a massa magra da pessoa (pesagens de 60 dias). */
async function blocoForcaDe(perfil, dia) {
  const pes = await pesagensDesde(perfil.jids, diasAnteriores(dia, 60)[0]).catch(() => []);
  const pesoAtual = [...pes].sort((a, b) => a.dia.localeCompare(b.dia)).pop()?.peso || perfil.peso;
  const faixa = metaBalancoPara({ objetivo: perfil.objetivo, peso: pesoAtual, metaPeso: perfil.metaPeso, metaPrazo: perfil.metaPrazo, dia, ritmo: perfil.ritmo, metaModo: perfil.metaModo, gorduraTend: tendenciaGordura(pes.filter((p) => p.dia >= diasAnteriores(dia, 28)[0])) });
  const tend = linhaDeTendencia({ pesagens: pes, perfil, dia, alvoKgSemana: faixa?.ritmoKgSemana ?? null, semanas: 4 });
  const gasto = perfil.relogio?.gastos ? Object.values(perfil.relogio.gastos).slice(-14).filter(Boolean) : [];
  const gastoMedio = gasto.length ? gasto.reduce((a, b) => a + b, 0) / gasto.length : null;
  const faixaKcal = faixa && gastoMedio ? { min: Math.round(gastoMedio + faixa.min), max: Math.round(gastoMedio + faixa.max) } : null;
  return blocoForcaRecuperacao(perfil, dia, { magraSem: tend?.magraSem ?? null, faixa: faixaKcal });
}
function textoDe(m) {
  const c = extractMessageContent(m?.message);
  return (c?.conversation || c?.extendedTextMessage?.text || c?.imageMessage?.caption || '').trim();
}

/** Julga (pré-filtro em código + IA leve) se a mensagem parece pedaço de refeição em andamento e se vale esperar. */
async function deveEsperarFragmento(msg) {
  try {
    const conteudo = extractMessageContent(msg.message);
    if (!conteudo) return false;
    const texto = textoDe(msg);
    const temImagem = Boolean(conteudo.imageMessage);
    const temAudio = Boolean(conteudo.audioMessage);
    if (!texto && !temImagem) return false;
    if (pareceMetaConversa(texto)) return false; // "vou ajustar isso amanhã" é sobre o sistema, não pedaço de refeição
    const jids = jidsDoRemetente(msg.key);
    if (!jids.length) return false;
    const perfil = await buscarPerfil(jids).catch(() => null);
    if (!perfil?.onboarded) return false;
    const { dia } = agora();
    const horaLocal = agora(fusoDe(perfil)).hora;
    const refs = await refeicoesDoDia(dia).catch(() => []);
    const ultima = refs.filter((r) => jids.includes(r.jid)).sort((a, b) => b.minutos - a.minutos)[0];
    const minutosDesdeUltima = ultima ? minutosDe(horaLocal) - ultima.minutos : Infinity;
    if (!candidatoAFragmento({ texto, temImagem, temAudio, minutosDesdeUltima })) return false;
    if (ultima && mencionaOutraRefeicao(texto, ultima.slot)) return false; // "o café da tarde eu tomei agora" não é pedaço do café da manhã
    const ultimas = estado.memoria.mensagens.slice(-4);
    const j = await comTempo(
      ia.julgarFragmento({
        nome: perfil.nome.split(' ')[0],
        texto,
        temImagem,
        emAndamento: ultima && minutosDesdeUltima <= 30 ? { minutos: minutosDesdeUltima, descricao: ultima.descricao || ultima.resumo || '', kcal: ultima.estimativa?.kcal ? Math.round(ultima.estimativa.kcal) : null } : null,
        ultimas,
      }),
      15_000,
      'julgamento de fragmento'
    );
    console.log(`[fragmento] ${perfil.nome.split(' ')[0]} "${texto.slice(0, 40)}"${temImagem ? ' (foto)' : ''}: fragmento=${j.fragmento} esperar=${j.esperar} (${j.motivo})`);
    return j.fragmento && j.esperar;
  } catch (e) {
    console.warn('[fragmento] não julgado:', String(e.message).slice(0, 100));
    return false;
  }
}

function liberarFragmentos(dono) {
  const e = esperaFragmentos.get(dono);
  if (!e) return;
  // ainda digitando? a próxima parte está vindo: espera mais 3 s (até o teto)
  if (Date.now() - e.desde < ESPERA_FRAGMENTO_MAX_MS && estaDigitando(e.jids || [])) {
    e.timer = setTimeout(() => liberarFragmentos(dono), 3000);
    return;
  }
  esperaFragmentos.delete(dono);
  const [primeira, ...resto] = e.msgs;
  primeira._liberada = true;
  primeira._fragmentos = resto;
  console.log(`[fragmento] respondendo ${e.msgs.length} mensagem(ns) de uma vez depois de ${Math.round((Date.now() - e.desde) / 1000)} s`);
  pendentes.push(primeira);
  naFila('bot', drenar);
}

function iniciarEsperaFragmento(msg, { porDigitacao = false } = {}) {
  const dono = remetenteDe(msg);
  const jids = jidsDoRemetente(msg.key);
  // por digitação: confere a cada 3 s; solta assim que ela para de digitar (ou no teto). Por fragmento: 45 s de silêncio.
  const primeiraEspera = porDigitacao ? 3000 : ESPERA_FRAGMENTO_MS;
  esperaFragmentos.set(dono, { msgs: [msg], jids, desde: Date.now(), porDigitacao, timer: setTimeout(() => liberarFragmentos(dono), primeiraEspera) });
  // o 👀 avisa que ela viu e está esperando o resto; na espera por digitação só se passar de 8 s (senão é ruído)
  if (!porDigitacao) reagir(msg.key.remoteJid, msg.key, '👀').catch(() => {});
  else setTimeout(() => { if (esperaFragmentos.get(dono)?.msgs?.[0] === msg) reagir(msg.key.remoteJid, msg.key, '👀').catch(() => {}); }, 8000);
}

function juntarFragmento(dono, msg) {
  const e = esperaFragmentos.get(dono);
  e.msgs.push(msg);
  clearTimeout(e.timer);
  // chegou mais uma parte: espera de novo (por digitação, 6 s de silêncio; por fragmento, 45 s), sempre dentro do teto
  const base = e.porDigitacao ? 6000 : ESPERA_FRAGMENTO_MS;
  const restante = Math.max(1000, Math.min(base, e.desde + ESPERA_FRAGMENTO_MAX_MS - Date.now()));
  e.timer = setTimeout(() => liberarFragmentos(dono), restante);
}

async function drenar() {
  if (!pendentes.length) return;
  const lote = pendentes.splice(0, pendentes.length);
  // mensagens de quem está com fragmentos em espera entram no buffer dela (sem IA) e reiniciam a espera
  const restantes = [];
  for (const m of lote) {
    const dono = remetenteDe(m);
    if (!m._liberada && esperaFragmentos.has(dono)) juntarFragmento(dono, m);
    else restantes.push(m);
  }
  if (!restantes.length) return;
  if (restantes.length > 1) console.log(`[bot] ${restantes.length} mensagens juntas: lendo tudo e respondendo de uma vez`);
  const grupos = agruparFotos(restantes);
  for (let i = 0; i < grupos.length; i++) {
    const { msg, extras: extrasDoLote } = grupos[i];
    // a pessoa ainda está digitando (presença do WhatsApp)? a próxima parte vem já: segura e responde tudo de uma vez
    if (!msg._liberada && msg.key.remoteJid?.endsWith('@g.us') && !textoDe(msg).startsWith('!') && estaDigitando(jidsDoRemetente(msg.key))) {
      console.log(`[digitando] ${remetenteDe(msg).split('@')[0]} ainda digita: segurando a resposta`);
      iniciarEsperaFragmento(msg, { porDigitacao: true });
      continue;
    }
    // parece só um pedaço de informação e vem mais? segura e junta (uma vez por mensagem; a liberada não volta a esperar)
    // com limite de tempo: 04/10 13:11 a fila ficou 8 min parada antes do cão de guarda da mensagem (que só cerca o processar)
    if (!msg._liberada && !extrasDoLote.length && (await comTempo(deveEsperarFragmento(msg), 25_000, 'espera de fragmento').catch((e) => (console.warn('[fragmento]', e.message), false)))) {
      iniciarEsperaFragmento(msg);
      continue;
    }
    const extras = [...(msg._fragmentos || []), ...extrasDoLote];
    processando = msg;
    processandoExtras = extras;
    // "última do lote" é por conversa: uma mensagem de outro chat no fim do lote não pode roubar a resposta do grupo
    const ultimo = ultimaDoChat(grupos.map((g) => g.msg), i);
    try {
      // cão de guarda: nenhuma mensagem pode prender a fila por mais de 4 min (IA, Drive, Mongo e reservas somados)
      // mensagem resgatada do histórico (volta de queda de sessão) é respondida uma a uma: cada uma foi um chamado dela
      await comTempo(
        processar(msg, { emLote: !ultimo && !msg._resgatada, atrasadas: ultimo && !msg._resgatada ? grupos.length - 1 + (msg._fragmentos?.length || 0) : msg._fragmentos?.length || 0, fotosExtras: extras }),
        4 * 60_000,
        'processamento da mensagem'
      );
    } catch (e) {
      console.error('[bot] erro ao processar:', e);
      const jid = msg?.key?.remoteJid;
      if (jid?.endsWith('@g.us')) await avisarErro(jid, 'interno', e?.message);
    } finally {
      processando = null;
      processandoExtras = [];
    }
  }
}

/** Mensagens que ainda não foram processadas (pra salvar no desligamento). */
export function mensagensPendentes() {
  return [processando, ...processandoExtras, ...pendentes].filter(Boolean);
}

const codificar = (msg) => Buffer.from(proto.WebMessageInfo.encode(proto.WebMessageInfo.fromObject(msg)).finish()).toString('base64');
const decodificar = (b64) => proto.WebMessageInfo.decode(Buffer.from(b64, 'base64'));

/** Salva no Mongo o que ainda não foi respondido (chamado no SIGTERM do deploy). */
export async function salvarFilaPendente() {
  const lista = mensagensPendentes();
  await salvarPendentes(lista.map((m) => ({ id: m.key?.id, b64: codificar(m) })));
  if (lista.length) console.log(`[bot] ${lista.length} mensagem(ns) pendente(s) salva(s) pra depois do restart`);
}

/** No boot: reenfileira o que ficou pendente no processo anterior (respeitando a idade máxima). */
export async function restaurarFilaPendente() {
  const docs = await carregarPendentes().catch(() => []);
  let n = 0;
  for (const d of docs) {
    try {
      const msg = proto.WebMessageInfo.toObject(decodificar(d.b64), { longs: Number, defaults: false });
      pendentes.push(msg);
      n++;
    } catch (e) {
      console.warn('[bot] pendente ilegível, descartada:', e.message);
    }
  }
  if (n) {
    console.log(`[bot] ${n} mensagem(ns) do processo anterior reenfileirada(s)`);
    naFila('bot', drenar);
  }
}

/**
 * Mensagens resgatadas do histórico depois de uma queda de sessão (retomada.js já filtrou e marcou `_resgatada`):
 * entram na fila e são respondidas uma a uma, a primeira com pedido de desculpas pela demora.
 */
export async function enfileirarResgatadas(msgs) {
  let lista = (msgs || []).filter((m) => m?.key && m.message);
  if (!lista.length) return 0;
  // só de quem já tem cadastro: uma resgatada de jid desconhecido não pode virar pedido de cadastro horas depois
  const perfis = await listarPerfis().catch(() => null);
  if (perfis) {
    const conhecidos = new Set(perfis.flatMap((p) => p.jids || []));
    const antes = lista.length;
    lista = lista.filter((m) => jidsDoRemetente(m.key).some((j) => conhecidos.has(j)));
    if (lista.length < antes) console.log(`[retomada] ${antes - lista.length} mensagem(ns) de quem não tem cadastro ficaram de fora do resgate`);
    if (!lista.length) return 0;
  }
  pendentes.push(...lista);
  console.log(`[retomada] ${lista.length} mensagem(ns) resgatada(s) do histórico entram na fila: ${lista.map((m) => m._motivoResgate || '?').join(', ')}`);
  naFila('bot', drenar);
  return lista.length;
}

export function apresentarNaFila(jidGrupo, motivo) {
  if (GRUPO_PERMITIDO && jidGrupo !== GRUPO_PERMITIDO) return;
  naFila('apresentacao', () => apresentar(jidGrupo, motivo));
}

/** Outra pessoa foi adicionada: se ainda não tem cadastro, dá boas-vindas e já pede os dados (sem esperar ela falar). */
export function receberNovoMembro(jidGrupo, participantes) {
  if (GRUPO_PERMITIDO && jidGrupo !== GRUPO_PERMITIDO) return;
  naFila('novo-membro', async () => {
    if (!jaApresentada(jidGrupo)) return; // ela mesma ainda vai se apresentar; o pedido de cadastro já vai junto
    for (const p of participantes || []) {
      const jids = [...new Set([p.id, p.phoneNumber, p.lid].filter(Boolean).map((j) => jidNormalizedUser(j)))];
      if (!jids.length) continue;
      if (await buscarPerfil(jids)) continue; // já conhecida (voltou pro grupo)
      const nomeContato = jids.find((j) => j.endsWith('@s.whatsapp.net'))?.split('@')[0] || 'novato(a)';
      await salvarPerfil({ jids, nome: nomeContato, onboarded: false, girias: [], criadoEm: new Date() });
      const texto = await ia.boasVindasNovoMembro({ nomeContato, persona: estado.persona });
      await enviar(jidGrupo, texto);
      await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto, tipo: 'bot' });
      console.log(`[bot] novo membro ${jids[0]}: boas-vindas e pedido de cadastro enviados`);
    }
  });
}

// ============================================================
// Apresentação e nome
// ============================================================
// Chave do grupo dentro de config.apresentadoEm (JID tem ponto em "@g.us" e o Mongo não aceita ponto em nome de campo)
export const chaveGrupo = (jid) => jid.replace(/\./g, '_');
const jaApresentada = (jidGrupo) => Boolean(estado.config.apresentadoEm?.[chaveGrupo(jidGrupo)]);

async function apresentar(jidGrupo, motivo) {
  if (jaApresentada(jidGrupo)) return;
  const meta = await estado.sock.groupMetadata(jidGrupo).catch(() => null);
  console.log(`[apresentacao] ${motivo} em "${meta?.subject || jidGrupo}"`);
  if (!estado.memoria.grupo) estado.memoria.grupo = jidGrupo;
  const texto = await ia.apresentacao({ grupoNome: meta?.subject, membros: meta?.participants?.length, persona: estado.persona });
  await enviar(jidGrupo, texto);
  // Só marca como apresentada DEPOIS que a mensagem saiu: se a IA ou o envio falhar, tenta de novo na próxima
  estado.config = await salvarConfig({ [`apresentadoEm.${chaveGrupo(jidGrupo)}`]: new Date().toISOString(), aguardandoNomeDesde: estado.config.nomeBot ? null : new Date().toISOString() });
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto, tipo: 'bot' });
}

async function batizar(nome, quem, jidGrupo, msg) {
  estado.config = await salvarConfig({ nomeBot: nome, aguardandoNomeDesde: null });
  ia.definirNomeBot(nome);
  console.log(`[apresentacao] batizada de "${nome}" por ${quem}`);
  const reacao = await ia.reagirAoNome({ nome, quem, persona: estado.persona });
  await enviar(jidGrupo, reacao, msg);
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: reacao, tipo: 'bot' });
}

// ============================================================
// Quando ela responde: sempre a foto, áudio, comando, pergunta, menção/resposta a ela e assunto dela (comida, treino,
// sono, peso). Papo aleatório entre eles: no máximo uma vez a cada PAPO_INTERVALO_MIN, e nesse intervalo nem chama a IA.
// ============================================================
const ASSUNTO_DELA =
  /(?<![\p{L}\p{N}])(comi|comer|comendo|comida|almo[cç]\p{L}*|jant\p{L}*|caf[eé]|lanch\p{L}*|ceia|marmita|prato|refei[cç][aã]o|bebi|beber|[aá]gua|treino|treinei|treinar|academia|corrid\p{L}*|v[oô]lei|dormi\p{L}*|sono|acordei|peso|pesei|balan[cç]a|dieta|fome|pizza|hamb[uú]rguer|refri\p{L}*|cerveja|doce\p{L}*|chocolate|bolo|sorvete|p[aã]o|p[aã]es|massa|macarr[aã]o|ifood|delivery|whey|creatina|prote[ií]na|kcal|caloria\p{L}*|macro\p{L}*|carbo\p{L}*|gordura|salada|frango|ovo\p{L}*|arroz|feij[aã]o|fruta\p{L}*|suplemento|jejum|nutri)(?![\p{L}\p{N}])/iu;
let ultimoPapoEm = 0;

/** Mensagem citada (quando a pessoa responde marcando outra): { autor, texto } ou null. */
export function citacaoDe(conteudo, perfis) {
  const ctx = conteudo?.extendedTextMessage?.contextInfo || conteudo?.imageMessage?.contextInfo || conteudo?.audioMessage?.contextInfo;
  const q = ctx?.quotedMessage;
  if (!q) return null;
  const texto = (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || '').trim();
  const tipo = q.imageMessage ? '[foto]' : q.audioMessage ? '[áudio]' : q.stickerMessage ? '[figurinha]' : '';
  const jid = ctx.participant ? jidNormalizedUser(ctx.participant) : null;
  let autor = 'alguém';
  if (jid && meusJids().includes(jid)) autor = ia.nomeDaBot();
  else if (jid) autor = (perfis || []).find((p) => p.jids?.includes(jid))?.nome || autor;
  else if (ctx.stanzaId && enviadosPeloBot.has(ctx.stanzaId)) autor = ia.nomeDaBot();
  const trecho = `${tipo}${tipo && texto ? ' ' : ''}${texto}`.trim();
  return trecho ? { autor, texto: trecho.slice(0, 300) } : null;
}

/**
 * A mensagem marca (@) ou responde OUTRA pessoa do grupo, sem marcar a bot? Responder à própria mensagem ("Esse foi às
 * 10h" citando a própria foto) não é falar com outro: 04/10 10:33 isso virou silêncio e a correção da hora se perdeu.
 */
export function dirigidaAOutro(conteudo, jidsRemetente = []) {
  const ctx = conteudo?.extendedTextMessage?.contextInfo || conteudo?.imageMessage?.contextInfo;
  const meus = meusJids();
  const proprios = (jidsRemetente || []).map((j) => jidNormalizedUser(j));
  const mencionados = (ctx?.mentionedJid || []).map((j) => jidNormalizedUser(j));
  if (mencionados.some((j) => meus.includes(j))) return false;
  if (mencionados.some((j) => !proprios.includes(j))) return true;
  if (ctx?.participant) {
    const autor = jidNormalizedUser(ctx.participant);
    if (!meus.includes(autor) && !proprios.includes(autor) && !(ctx?.stanzaId && enviadosPeloBot.has(ctx.stanzaId))) return true;
  }
  return false;
}

export function prioridade({ texto, temImagem, temAudio, conteudo }) {
  if (temImagem || temAudio) return 'midia';
  if (/\?/.test(texto)) return 'pergunta';
  if (mencionaNome(texto, ia.nomeDaBot()) || /\bnutri\b/i.test(texto)) return 'mencao';
  const ctx = conteudo.extendedTextMessage?.contextInfo;
  if (ctx?.stanzaId && enviadosPeloBot.has(ctx.stanzaId)) return 'resposta-a-ela';
  if (ctx?.participant && meusJids().includes(jidNormalizedUser(ctx.participant))) return 'resposta-a-ela';
  if ((ctx?.mentionedJid || []).some((j) => meusJids().includes(jidNormalizedUser(j)))) return 'mencao';
  if (ASSUNTO_DELA.test(texto)) return 'assunto';
  return null; // papo aleatório
}

// ============================================================
// Lógica principal
// ============================================================
// ---------- Privado com o administrador: só !comandos, pra testar sem poluir o grupo ----------
// Quem não é o ADMIN_JID é ignorado em silêncio (o bot nunca conversa fora do grupo). Nada daqui entra na memória do grupo.
const ADMIN_PRIVADO = (process.env.ADMIN_JID || '').trim();
let dicaPrivadoEm = 0;
async function tratarPrivado(msg) {
  if (!ADMIN_PRIVADO || msg.key.fromMe) return;
  const conteudo = extractMessageContent(msg.message);
  const texto = (conteudo?.conversation || conteudo?.extendedTextMessage?.text || conteudo?.imageMessage?.caption || '').trim();
  const temFoto = Boolean(conteudo?.imageMessage);
  if (!texto && !temFoto) return;
  const jidsPriv = jidsDoPrivado(msg.key);
  const perfil = await buscarPerfil(jidsPriv).catch(() => null);
  const ehAdmin = jidsPriv.includes(ADMIN_PRIVADO) || Boolean(perfil?.jids?.includes(ADMIN_PRIVADO));
  if (!ehAdmin) return;
  // ---------- texto da página da SEFAZ colado no privado: entra na despensa de verdade ----------
  if (perfil?.onboarded && texto.length > 120 && parsearTextoNfce(texto).itens.length) {
    const jidPriv = msg.key.remoteJid;
    try {
      const r = await receberNotaDoApp({ perfil, chave: null, url: '', texto, dia: agora().dia });
      await enviar(jidPriv, r.ok ? r.resumoCompleto || r.resumo : `Não consegui separar os itens: ${r.erro}`, msg, { rapido: true });
    } catch (e) {
      await enviar(jidPriv, `Deu erro ao ler a nota: ${e.message}`, msg, { rapido: true });
    }
    return;
  }
  // ---------- modo de teste do cupom (só no privado do admin, nada é gravado): foto com QR ou link da SEFAZ ----------
  if (temFoto || /^https?:\/\/\S+/i.test(texto)) {
    const jidPriv = msg.key.remoteJid;
    try {
      let qrTexto = null;
      if (temFoto) qrTexto = await lerQr(await baixarMidia(msg));
      const q = interpretarQr(qrTexto || texto);
      if (!q) {
        await enviar(jidPriv, temFoto ? 'Não achei QR legível nessa foto (teste; nada gravado). Tenta com o QR maior e sem reflexo, ou cola o link que a câmera abre.' : 'Esse link não tem chave de NFC-e.', msg, { rapido: true });
        return;
      }
      await enviar(jidPriv, `QR lido ✅ (teste, nada gravado)\nUF ${q.uf || '?'} · emitida em ${q.emitidaEm} · chave ${q.chave.slice(0, 6)}…\n${q.url ? `Link: ${q.url.slice(0, 80)}…\nAbrindo o site da SEFAZ a partir do servidor...` : 'Sem link no QR (só a chave).'}`, msg, { rapido: true });
      if (!q.url) return;
      const t = await testarConsultaSefaz(q.url);
      const veredito = t.status === 'ok' ? `✅ O site abriu SEM desafio e mostrou a nota: ~${t.itensEstimados} item(ns) detectado(s).` : t.status === 'captcha' ? '⛔ O site redirecionou para a verificação anti-robô (Cloudflare Turnstile). Pelo servidor não passa.' : t.status === 'sem_itens' ? `⚠️ O site respondeu (HTTP ${t.http}) mas não reconheci itens no HTML.` : `⚠️ Erro ao abrir: ${t.erro || `HTTP ${t.http}`}`;
      await enviar(jidPriv, `${veredito}\n\nAmostra do que veio:\n${(t.amostra || '(vazio)').slice(0, 600)}`, msg, { rapido: true });
      console.log(`[despensa] teste SEFAZ ${q.uf}: ${t.status} (http ${t.http}, itens ~${t.itensEstimados})`);
    } catch (e) {
      console.error('[despensa] teste privado:', e.message);
      await enviar(jidPriv, `Deu erro no teste: ${e.message}`, msg, { rapido: true });
    }
    return;
  }
  if (!texto) return;
  await garantirDiaAtual();
  const { dia } = agora();
  const jidPrivado = msg.key.remoteJid;
  const jids = perfil?.jids?.length ? perfil.jids : jidsPriv; // os jids do cadastro (número e LID) pros comandos acharem o perfil
  if (texto.startsWith('!')) {
    const cmd = texto.toLowerCase().split(/\s+/)[0];
    if (cmd === '!resumo') {
      await enviar(jidPrivado, 'O !resumo fecha o dia e manda no GRUPO. Se for pra valer, roda lá.', msg, { rapido: true });
      return;
    }
    console.log(`[privado] comando do administrador: ${texto.slice(0, 60)}`);
    const tratado = await tratarComando({
      texto,
      jids,
      jidGrupo: jidPrivado, // as respostas do comando vão pro privado
      msg,
      dia,
      nomeContato: msg.pushName || 'admin',
      batizar: async () => enviar(jidPrivado, 'Rebatizar é no grupo, criatura.', msg, { rapido: true }),
    });
    if (!tratado) await enviar(jidPrivado, `Não conheço esse comando.\n\n${AJUDA}`, msg, { rapido: true });
    return;
  }
  if (Date.now() - dicaPrivadoEm > 6 * 3600_000) {
    dicaPrivadoEm = Date.now();
    await enviar(jidPrivado, 'Aqui no privado eu só respondo !comandos, pra você testar sem poluir o grupo. Conversa e comida, no grupo. 😉 Manda !ajuda pra ver a lista.', msg, { rapido: true });
  }
}

export async function processar(msg, { emLote = false, atrasadas = 0, fotosExtras = [] } = {}) {
  if (!msg.message) return;
  if (msg.key.fromMe && enviadosPeloBot.has(msg.key.id)) return; // resposta do próprio bot
  const jidGrupo = msg.key.remoteJid;
  if (!jidGrupo?.endsWith('@g.us')) return tratarPrivado(msg); // fora do grupo: só o administrador, só !comandos

  if (GRUPO_PERMITIDO && jidGrupo !== GRUPO_PERMITIDO) {
    if (!gruposIgnoradosLogados.has(jidGrupo)) {
      gruposIgnoradosLogados.add(jidGrupo);
      console.log(`[bot] ignorando grupo ${jidGrupo} (ALLOWED_GROUP_ID=${GRUPO_PERMITIDO})`);
    }
    return;
  }

  // mensagem resgatada do histórico depois de uma queda de sessão pode ter horas; o teto dela é outro (retomada.js)
  const idadeMaxS = msg._resgatada ? RESGATE_IDADE_MAX_H * 3600 : IDADE_MAX_MSG_S;
  const atrasoMin = atrasoEmMinutos(msg);
  if (atrasoMin * 60 > idadeMaxS) return;

  const conteudo = extractMessageContent(msg.message);
  if (!conteudo) return;
  const legendas = [conteudo.conversation || conteudo.extendedTextMessage?.text || conteudo.imageMessage?.caption || ''];
  for (const extra of fotosExtras) {
    const c = extractMessageContent(extra.message);
    const t = (c?.conversation || c?.extendedTextMessage?.text || c?.imageMessage?.caption || '').trim();
    if (t) legendas.push(t);
  }
  const texto = legendas.map((t) => String(t).trim()).filter(Boolean).join(' ');
  // a foto pode estar na mensagem ou numa das que vieram junto (fragmentos: "tem alface" e depois a foto da abóbora)
  const temImagem = Boolean(conteudo.imageMessage) || fotosExtras.some((e) => Boolean(extractMessageContent(e.message)?.imageMessage));
  const temAudio = Boolean(conteudo.audioMessage);
  const temPdf = /pdf/i.test(conteudo.documentMessage?.mimetype || '') || /\.pdf$/i.test(conteudo.documentMessage?.fileName || '');
  if (!texto && !temImagem && !temAudio && !temPdf) return; // sticker, vídeo, outros documentos etc.

  await garantirDiaAtual();
  if (!GRUPO_PERMITIDO && estado.memoria.grupo !== jidGrupo) {
    estado.memoria.grupo = jidGrupo;
    console.log(`[bot] respondendo no grupo ${jidGrupo}. Dica: coloque ALLOWED_GROUP_ID=${jidGrupo} no .env`);
  }

  const jids = jidsDoRemetente(msg.key);
  if (!jids.length) return;
  const nomeContato = msg.pushName || jids[0].split('@')[0];
  const { dia, hora } = agora();
  const { config } = estado;

  // Primeira vez que ela vê esse grupo (ex.: entrou enquanto o bot estava offline): se apresenta antes de tudo
  if (!jaApresentada(jidGrupo)) await apresentar(jidGrupo, 'primeira mensagem vista no grupo').catch((e) => console.error('[apresentacao]', e.message));

  // Escolha do nome dela (nas 48h após a apresentação). Só mensagens curtas e SEM número: "Lucas, 80kg, 1,80m, secar" é cadastro,
  // não batismo, e não pode gastar uma chamada de IA nem virar nome da bot.
  if (!config.nomeBot && config.aguardandoNomeDesde && texto && !texto.startsWith('!') && texto.length <= 40 && !/\d/.test(texto)) {
    const horas = (Date.now() - new Date(config.aguardandoNomeDesde).getTime()) / 36e5;
    if (horas <= 48) {
      const nome = await ia.extrairNomeBot(texto).catch(() => null);
      if (nome) {
        await batizar(nome, nomeContato, jidGrupo, msg);
        return;
      }
    }
  }

  // ---------- Comandos utilitários ----------
  if (await tratarComando({ texto, jids, jidGrupo, msg, dia, nomeContato, batizar })) return;

  // ---------- Onboarding ----------
  let perfil = await buscarPerfil(jids);

  if (!perfil) {
    await salvarPerfil({ jids, nome: nomeContato, onboarded: false, girias: [], criadoEm: new Date() });
    const pedido = await ia.pedirOnboarding(nomeContato, estado.persona);
    await enviar(jidGrupo, pedido, msg);
    return;
  }

  // Perfil criado na entrada no grupo fica com o número como nome até a pessoa dizer o dela; o nome do contato já ajuda
  const nomeNumerico = (n) => !n || /^\d{6,}$/.test(String(n));
  if (nomeNumerico(perfil.nome) && msg.pushName && !/^\d+$/.test(msg.pushName)) {
    const antigo = perfil.nome;
    perfil = await salvarPerfil({ jids, nome: msg.pushName.trim().slice(0, 60) }).catch(() => perfil);
    renomearNaMemoria(antigo, perfil.nome);
  }

  if (!perfil.onboarded) {
    if (!texto) return enviar(jidGrupo, 'Foto e áudio não valem como cadastro 😅 Manda em TEXTO: nome, peso, altura, objetivo, cidade onde mora e se é vegetariana(o) ou tem restrição.', msg);
    const d = await ia.extrairDadosOnboarding(texto);
    const parcial = { jids, atualizacoes: { ...(perfil.atualizacoes || {}) } };
    const marcar = (campo, valor) => {
      parcial[campo] = valor;
      parcial.atualizacoes[campo] = dia;
    };
    const nomeAntes = perfil.nome;
    if (d.nome) marcar('nome', d.nome);
    if (d.peso_kg) marcar('peso', d.peso_kg);
    if (d.altura_cm) marcar('altura', d.altura_cm);
    if (d.objetivo) marcar('objetivo', d.objetivo);
    if (d.cidade) marcar('cidade', d.cidade);
    if (fusoValido(d.fuso)) marcar('fuso', d.fuso);
    if (d.dieta) marcar('dieta', d.dieta);
    if (d.restricoes) marcar('restricoes', d.restricoes);
    if (d.genero && /^(masculino|feminino|outro)$/i.test(d.genero)) marcar('genero', d.genero.toLowerCase());
    perfil = await salvarPerfil(parcial);
    if (perfil.nome !== nomeAntes) renomearNaMemoria(nomeAntes, perfil.nome);

    const faltando = [];
    if (nomeNumerico(perfil.nome)) faltando.push('nome');
    if (!perfil.peso) faltando.push('peso');
    if (!perfil.altura) faltando.push('altura');
    if (!perfil.objetivo) faltando.push('objetivo');
    if (!perfil.cidade) faltando.push('cidade onde mora');
    if (!perfil.dieta) faltando.push('se é vegetariana(o)/vegana(o) ou come de tudo');
    if (faltando.length) return enviar(jidGrupo, await ia.cobrarDadosFaltando(faltando, estado.persona), msg);

    perfil = await salvarPerfil({ jids, onboarded: true });
    const dossieNovo = await comTempo(dossieDe(perfil), 20_000, 'leitura da pasta no Drive').catch((e) => (console.error('[pessoas]', e.message), ''));
    const bemVindo = await ia.boasVindas(perfil, estado.persona, dossieNovo);
    await enviar(jidGrupo, bemVindo);
    await lembrar({ hora, jid: jids[0], nome: ia.nomeDaBot(), texto: bemVindo, tipo: 'bot' });
    salvarFicha(perfil, mdPerfil(perfil)).catch((e) => console.error('[drive]', e.message));
    return;
  }

  // ---------- Nota de compra sem app: texto da página da SEFAZ colado, ou PDF da nota ----------
  if (temPdf || (texto.length > 120 && parsearTextoNfce(texto).itens.length)) {
    try {
      let textoNota = texto;
      if (temPdf) {
        enviar(jidGrupo, 'Lendo o PDF...', msg, { rapido: true }).catch(() => {});
        const pdf = await baixarMidia(msg);
        textoNota = await ia.transcreverPdf(pdf);
      }
      const r = await receberNotaDoApp({ perfil, chave: null, url: '', texto: textoNota, dia });
      const resposta = r.ok ? r.confirmacao || r.resumo : 'Vi que é uma nota, mas não consegui separar os itens. Se for a página da SEFAZ, cola o texto inteiro (Selecionar tudo, Copiar) ou manda a captura de tela com rolagem.';
      await enviar(jidGrupo, resposta, msg, { rapido: true });
      await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto: temPdf ? '📄 [PDF de nota de compra]' : '📋 [texto da nota de compra colado]', tipo: 'texto' });
      await lembrar({ hora, jid: null, nome: ia.nomeDaBot(), texto: resposta, tipo: 'bot' });
    } catch (e) {
      console.error('[despensa] nota por texto/PDF:', e.message);
      await enviar(jidGrupo, 'Não consegui ler essa nota agora. Tenta de novo daqui a pouco.', msg, { rapido: true });
    }
    return;
  }

  // ---------- Aceite da oferta de sexta ("quero" = plano da semana que vem com lista de compras) ----------
  if (await aceiteDePlano({ texto, perfil, jidGrupo, msg, dia })) return;
  // ---------- "teve"/"não teve" pra uma atividade fixa em dúvida (vôlei sem relógio) ----------
  if (perfil.atividadesPendentes?.length && !imagemMsg(msg)) {
    const r = await responderPendente(perfil, texto).catch((e) => (console.error('[atividades]', e.message), null));
    if (r) {
      await enviar(jidGrupo, r, msg, { rapido: true });
      await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto, tipo: 'pessoa' }).catch(() => {});
      await lembrar({ hora, jid: null, nome: ia.nomeDaBot(), texto: r, tipo: 'bot' }).catch(() => {});
      return;
    }
  }

  // ---------- Fluxo normal: texto e/ou foto ----------
  let imagem = null;
  let mimeType = null;
  const imagens = []; // todas as fotos que entram NESTA análise (a da mensagem + as que vieram juntas)
  if (temImagem) {
    // aviso imediato: a análise da foto demora alguns segundos (um aviso só, mesmo com várias fotos)
    enviar(jidGrupo, acaso(ACKS_FOTO), msg, { rapido: true }).catch(() => {});
    if (conteudo.imageMessage) {
      try {
        imagem = await baixarMidia(msg);
        mimeType = conteudo.imageMessage.mimetype || 'image/jpeg';
        imagens.push({ data: imagem, mimeType });
      } catch (e) {
        console.error('[wa] falha ao baixar imagem:', e.message);
        return avisarErro(jidGrupo, 'midia');
      }
    }
    for (const extra of fotosExtras) {
      const c = extractMessageContent(extra.message);
      if (!c?.imageMessage) continue;
      try {
        imagens.push({ data: await baixarMidia(extra), mimeType: c.imageMessage.mimetype || 'image/jpeg' });
      } catch (e) {
        console.error('[wa] falha ao baixar foto do bloco (analiso com as que baixaram):', e.message);
      }
    }
    if (imagens.length > 1) console.log(`[bot] ${imagens.length} fotos de ${nomeContato} analisadas juntas`);
    // cupom de mercado com QR da NFC-e: lê o QR no servidor, extrai os itens pela visão e monta a despensa (não é refeição)
    try {
      let qr = null;
      for (const f of imagens) {
        qr = interpretarQr(await lerQr(f.data));
        if (qr) break;
      }
      if (!qr && /\b(cupom|nota fiscal|nfc-?e|compras do mercado|minha compra)\b/i.test(texto)) qr = { chave: null, url: null, uf: null };
      if (qr) {
        console.log(`[despensa] cupom de ${perfil.nome}${qr.chave ? ` (chave ${qr.chave.slice(0, 8)}…, ${qr.uf || 'UF ?'})` : ' (sem QR legível)'}: lendo itens pela foto`);
        const lido = await ia.extrairItensCupom({ imagens });
        if (!lido.itens.length) throw new Error('nenhum item legível');
        const itens = await padronizarItens(lido.itens, { perfil, dia });
        const r = await registrarNota({ perfil, chave: qr.chave, loja: lido.loja, data: lido.data, itens, origem: qr.chave ? 'qr+foto' : 'foto' });
        const resposta = confirmacaoNota({ loja: lido.loja, dia: r.dia, itens, repetida: r.repetida }); // no grupo só a confirmação; a lista fica no !despensa
        await enviar(jidGrupo, resposta, msg, { rapido: true });
        await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto: `📷 [cupom de mercado${lido.loja ? `: ${lido.loja}` : ''}] ${texto}`.trim(), tipo: 'texto' });
        await lembrar({ hora, jid: null, nome: ia.nomeDaBot(), texto: resposta, tipo: 'bot' });
        return;
      }
    } catch (e) {
      console.error('[despensa] cupom:', e.message);
      await enviar(jidGrupo, 'Vi que é um cupom, mas não consegui ler os itens direito. Tenta uma foto mais de perto, com a lista inteira e sem reflexo.', msg, { rapido: true });
      return;
    }
  }

  let audio = null;
  let audioMime = null;
  if (temAudio) {
    try {
      audio = await baixarMidia(msg);
      audioMime = (conteudo.audioMessage.mimetype || 'audio/ogg').split(';')[0];
    } catch (e) {
      console.error('[wa] falha ao baixar áudio:', e.message);
      return avisarErro(jidGrupo, 'audio');
    }
  }

  const motivo = prioridade({ texto, temImagem, temAudio, conteudo });
  // Conversa entre eles (marca ou responde outro membro, sem chamar a bot): ela só ouve, salvo foto
  if (dirigidaAOutro(conteudo, jids) && motivo !== 'midia' && motivo !== 'mencao' && motivo !== 'resposta-a-ela') {
    await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto, tipo: 'texto' });
    return;
  }
  if (emLote && !temImagem && !temAudio) {
    // Mensagem atrasada de texto: entra no histórico; a resposta vai na última mensagem do lote, já sabendo desta
    await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto, tipo: 'texto' });
    return;
  }
  // !silencio: nesse período só foto/áudio, comando e menção/resposta direta a ela passam; o resto vai só pro histórico
  if (estado.silencioAte > Date.now() && !['midia', 'mencao', 'resposta-a-ela'].includes(motivo)) {
    await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto, tipo: 'texto' });
    return;
  }
  marcarResposta(jids, dia, hora).catch(() => {}); // havia intervenção proativa pra essa pessoa hoje? conta como respondida
  const papoLiberado = Date.now() - ultimoPapoEm >= PAPO_INTERVALO_MIN * 60_000;
  if (!motivo && !papoLiberado && !atrasadas) {
    // Papo entre eles dentro do intervalo: só guarda no histórico (ela "ouviu"), sem gastar IA nem responder
    await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto, tipo: 'texto' });
    return;
  }

  const perfis = await enriquecerPerfis(await listarPerfis(), dia);
  const eu = perfis.find((p) => p.jids?.some((j) => jids.includes(j))) || perfil;
  // Hora no fuso da pessoa (cidade informada no cadastro/conversa); sem cidade, usa o fuso do grupo
  const horaLocal = agora(fusoDe(eu)).hora;
  const slot = slotDaHora(horaLocal);
  const habitual = eu._hab ? hhmmDe(eu._hab[slot.id].minutos) : hhmmDe(slot.padrao);
  // estação do ano e tempo agora na cidade da pessoa (Open-Meteo, grátis; cache de 30 min; só na via completa)
  const clima = motivo ? await comTempo(climaParaPrompt(eu, dia), 5_000, 'clima').catch(() => '') : '';
  // A mensagem é de muito tempo atrás (bot fora do ar: sessão derrubada, processo parado)? Ela pede desculpas pela demora
  // na primeira resposta depois da volta e não finge que a mensagem acabou de chegar nas seguintes.
  let notaAtraso = '';
  if (atrasoMin >= ATRASO_DESCULPAS_MIN) {
    const primeira = Date.now() - ultimaDesculpaEm > DESCULPA_INTERVALO_MS;
    notaAtraso = notaDeAtraso(atrasoMin, { primeira, motivo: msg._resgatada ? 'seu WhatsApp foi desconectado e precisou ser religado' : 'você estava fora do ar' });
    if (primeira) ultimaDesculpaEm = Date.now();
    console.log(`[retomada] ${perfil.nome}: mensagem de ${Math.round(atrasoMin)} min atrás${msg._resgatada ? ` (resgatada do histórico: ${msg._motivoResgate})` : ''}; ${primeira ? 'pedindo desculpas pela demora' : 'desculpas já pedidas'}`);
  }
  const contextoHorario =
    `hora local de ${perfil.nome}: ${horaLocal}${eu.cidade ? ` em ${eu.cidade}` : ' (cidade/fuso ainda não informados, pode estar errada)'}; ` +
    `horário de ${slot.nome}; ${perfil.nome} costuma mandar ${slot.nome} ~${habitual}` +
    (clima ? `; ${clima}` : '') +
    (atrasadas
      ? `. ATENÇÃO: as últimas ${atrasadas + 1} mensagens do histórico (esta incluída) chegaram juntas, em sequência. Trate como UMA fala só (mesmo contexto, mesma refeição se for comida, mesma pergunta se for dúvida): responda uma vez, considerando tudo, e não responda mensagem por mensagem`
      : '') +
    (notaAtraso ? `. ${notaAtraso}` : '');
  // Papo aleatório não leva dossiê nem base de conhecimento (só persona, perfis e histórico): metade dos tokens
  // Drive e Mongo com limite de tempo: se o Google/Atlas pendurar, ela responde sem o dossiê em vez de travar a fila
  const dossie = motivo ? await comTempo(dossieDe(eu), 20_000, 'leitura da pasta no Drive').catch((e) => (console.error('[pessoas]', e.message), '')) : '';
  const conhecimento = motivo ? docsPara(eu, { texto }) : '';
  const momentos = await comTempo(momentosRecentes(12), 8_000, 'momentos').catch(() => []);
  const refeicoesHoje = await comTempo(refeicoesDoDia(dia), 8_000, 'refeições do dia').catch(() => []);
  const registradas = registradasHojeParaPrompt(refeicoesHoje, perfis, dia);
  const minhaUltima = refeicoesHoje.filter((r) => jids.includes(r.jid)).sort((a, b) => b.minutos - a.minutos)[0];
  const citada = citacaoDe(conteudo, perfis);
  // Decidir se é relato ou plano olhando TAMBÉM a própria mensagem citada: "meu primeiro café da manhã às 8h" citando
  // "tomei meu whey com creatina..." é relato (04/10: virou "se for isso", nada registrado, e ela disse que registrou)
  const textoDecisao = citada && citada.autor === perfil.nome ? `${citada.texto} ${texto}` : texto;
  const marcaCitacao = citada ? `(respondendo a ${citada.autor}: "${citada.texto.slice(0, 80)}${citada.texto.length > 80 ? '…' : ''}") ` : '';
  const rotuloFoto = imagens.length > 1 ? `📷 [${imagens.length} fotos]` : '📷 [foto]';
  const entradaTexto = `${marcaCitacao}${temImagem ? `${rotuloFoto}${texto ? ` ${texto}` : ''}` : temAudio ? '🎤 [áudio]' : texto}`;
  const historico = [...estado.memoria.mensagens];
  await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto: entradaTexto, tipo: temImagem ? 'foto' : temAudio ? 'audio' : 'texto' });

  if (atrasadas >= 6) await avisarErro(jidGrupo, 'lenta'); // só quando foi atraso de verdade, não 2 ou 3 mensagens seguidas
  // "Lanche da tarde" / "era o almoço" logo depois de uma foto já analisada: só rótulo. Ajusta o tipo do registro
  // anterior e confirma em uma linha, sem gastar chamada de IA e sem análise (nem registro) em dobro.
  const rotulo = !temImagem && !temAudio && lerRotuloRefeicao(texto, horaLocal);
  if (rotulo && minhaUltima && minutosDe(horaLocal) - minhaUltima.minutos <= 45) {
    if (minhaUltima.slot !== rotulo) {
      await atualizarRefeicao(minhaUltima._id, { slot: rotulo }).catch((e) => console.error('[refeicoes] falha ao ajustar tipo:', e.message));
      for (let i = estado.memoria.mensagens.length - 1; i >= 0; i--) {
        if (estado.memoria.mensagens[i].refeicao === minhaUltima.slot) { estado.memoria.mensagens[i].refeicao = rotulo; break; }
      }
    }
    const confirmacao = acaso([`Anotado como ${nomeDoSlot(rotulo)} ✅`, `Fechou, ficou como ${nomeDoSlot(rotulo)} 📝`, `Tá marcado: ${nomeDoSlot(rotulo)} 👍`]);
    await enviar(jidGrupo, confirmacao, msg, { rapido: true });
    await lembrar({ hora, jid: null, nome: ia.nomeDaBot(), texto: confirmacao, tipo: 'bot' });
    console.log(`[refeicoes] rótulo "${texto}" de ${perfil.nome}: registro das ${minhaUltima.horaLocal || minhaUltima.hora} -> ${rotulo}`);
    return;
  }

  // Visão de 7/30 dias + balanço energético da PESSOA ATUAL (código, sem IA); só nas respostas completas
  const visao = motivo ? await comTempo(visaoDe(eu, dia), 8_000, 'acompanhamento').catch(() => '') : '';
  // Memória de longo prazo por significado: lembranças de dias anteriores parecidas com a mensagem (só na via completa)
  const citados = perfis.filter((p) => p.nome !== eu.nome && mencionaNome(texto, p.nome)).map((p) => p.nome);
  const lembrancas = motivo && texto ? await comTempo(lembrancasPara({ consulta: texto, pessoa: eu.nome, outros: citados, excluirDia: dia }), 6_000, 'lembranças').catch(() => '') : '';
  const citacao = citacaoDe(conteudo, perfis);
  // código de barras na mensagem vira rótulo do Open Food Facts antes mesmo de ela responder
  const rotulos = motivo && texto ? await comTempo(rotulosPara(texto), 10_000, 'rótulos').catch(() => '') : '';
  // a pessoa está contestando algo que a bot disse? (resposta citando a bot, menção, ou logo depois de uma fala dela)
  const anteriorFoiBot = historico.length >= 2 && historico[historico.length - 2]?.tipo === 'bot';
  // conversa SOBRE a bot ("vou ajustar isso amanhã", "ela cismou", "tá rodando uma atualização"): não é comida, não é
  // correção de refeição, não é fragmento; ela responde como gente e não registra nada
  const metaConversa = !temImagem && !temAudio && pareceMetaConversa(texto);
  if (metaConversa) console.log(`[consciencia] ${perfil.nome}: mensagem sobre o sistema, não sobre comida ("${String(texto).slice(0, 60)}")`);
  const contestacao = !temImagem && !metaConversa && pareceContestacao(texto) && (Boolean(citacao && citacao.autor === ia.nomeDaBot()) || mencionaNome(texto, ia.nomeDaBot()) || anteriorFoiBot);
  if (contestacao) console.log(`[consciencia] ${perfil.nome} está contestando: "${String(texto).slice(0, 80)}"`);
  let rotulosAtuais = rotulos; // pode crescer se ela pedir PRODUTO
  // Mensagem parcelada da MESMA refeição (foto de mais um item, "tem X", "não tem Y", "pra substituir Z") até 30 min
  // depois do último registro: entra como refeição em andamento, e o registro é ajustado em vez de duplicado
  const minutosDesdeUltima = minhaUltima ? minutosDe(horaLocal) - minhaUltima.minutos : Infinity;
  // não é parte da mesma: conversa sobre o sistema, ou mensagem que nomeia OUTRA refeição ("o café da tarde eu tomei agora")
  const parteDaMesma =
    minhaUltima && minutosDesdeUltima >= 0 && minutosDesdeUltima <= 30 && !temAudio && !metaConversa && !mencionaOutraRefeicao(texto, minhaUltima.slot) &&
    ((temImagem && String(texto || '').trim().length <= 60) || (!temImagem && String(texto || '').trim().length <= 80 && !parecePedidoOuPlano(textoDecisao)));
  const emAndamento = parteDaMesma ? { hora: minhaUltima.horaLocal || minhaUltima.hora, kcal: minhaUltima.estimativa?.kcal ? Math.round(minhaUltima.estimativa.kcal) : null, descricao: minhaUltima.descricao || minhaUltima.resumo || '' } : null;
  if (emAndamento) console.log(`[refeicoes] ${perfil.nome}: mensagem tratada como parte da refeição das ${emAndamento.hora}`);
  const base = { texto, imagem, mimeType, imagens, audio, audioMime, perfil: eu, perfis, historico, dia, hora, contextoHorario, persona: estado.persona, dossie, momentos, citacao, registradas, visao, lembrancas, agenda: motivo ? eu._agenda?.bloco || '' : '', lugares: motivo ? eu._lugares?.bloco || '' : '', roteiro: motivo ? eu._roteiro || '' : '', atividades: motivo ? eu._atividades || '' : '', treinoHoje: motivo ? eu._treinoHoje || '' : '', jaDito: [temasJaDitos(historico, hora), bordoesJaDitos(historico, estado.persona), perguntaRecenteDe(jids[0], hora)].filter(Boolean).join('\n'), despensa: motivo ? await blocoDespensa(eu).catch(() => '') : '', planejando: !temImagem && !temAudio && parecePedidoOuPlano(textoDecisao), forca: falaDeTreino(texto) ? await blocoForcaDe(eu, dia).catch(() => '') : '', rotulos, contestacao, emAndamento, metaConversa };
  let resposta;
  let atualizacao = null;
  let habito = null;
  let querAudio = false;
  let registro = null; // linhas REGISTRO da IA: apagar/corrigir registros do dia a pedido da pessoa
  let refeicao = null; // linha REFEICAO da IA: números e tipo da refeição consumida, estruturados
  let produto = null; // "PRODUTO: x": ela quer o rótulo do Open Food Facts antes de responder
  let reacao = null; // linha REAGIR: ⭐ -> reação com emoji na mensagem da pessoa
  let incertezaIA = null; // linha INCERTEZA da análise de foto (alta|media|baixa): vai pro registro
  let perguntaIA = null; // linha PERGUNTA: a bot pediu um dado (uma por refeição)
  let atividadeRelato = null; // linha ATIVIDADE: relato de atividade fixa feita/não feita fora do horário
  let notaLida = null; // linha NOTA: a foto era um cupom de mercado (itens pra despensa)
  let despensaLinha = null; // linha DESPENSA: baixas/entradas na despensa
  try {
    // papo aleatório (sem foto, pergunta, menção ou assunto dela) vai pelos modelos leves; o resto pelos Flash
    // ferramentas na conversa (fase 2): pergunta ou pedido em texto, sem foto, pelo modelo principal, teto de 2 rodadas; falhou, caminho normal
    let r1 = null;
    const ferramentasConversa = FERRAMENTAS_CONVERSA_ON && !temImagem && !temAudio && motivo && !contestacao && !metaConversa && (parecePergunta(texto) || parecePedidoOuPlano(textoDecisao)) ? ferramentasPara(eu, { dia, escrita: true }) : null;
    if (ferramentasConversa) {
      try {
        r1 = await ia.responder({ ...base, despensa: '', lugares: '', forca: '', conhecimento, leve: false, ferramentas: ferramentasConversa, maxRodadas: 2 });
        console.log(`[ferramentas] conversa com ${perfil.nome.split(' ')[0]}: ${ferramentasConversa.usadas.length ? [...new Set(ferramentasConversa.usadas)].join(', ') : 'sem consulta'}`);
      } catch (e) {
        console.warn('[ferramentas] conversa falhou; caminho normal:', e.message);
      }
    }
    ({ texto: resposta, atualizacao, habito, audio: querAudio, registro, refeicao, produto, reacao, atividade: atividadeRelato, nota: notaLida, despensa: despensaLinha, incerteza: incertezaIA, pergunta: perguntaIA } = r1 || (await ia.responder({ ...base, conhecimento, leve: !motivo })));
  } catch (e) {
    // Gemini (todos) e reservas fora do ar: avisa em vez de ficar muda
    console.error('[ia] falha total:', e.message);
    estado.memoria.mensagens.pop(); // não deixa a mensagem sem resposta no histórico como se tivesse sido ignorada
    persistirMemoria(estado.memoria).catch(() => {});
    return avisarErro(jidGrupo, 'ia'); // 1 aviso a cada 10 min, não um por mensagem
  }
  let origemExterna = ia.ultimaFoiExterna(); // saiu por Cohere/OpenRouter/Groq/HF? então vai pra revisão quando o Gemini voltar

  // A Nutri não sabia: pesquisa (PubMed/Wikipedia), responde de novo e guarda a nota de estudo no Drive
  const pedido = resposta?.match(/^\s*PESQUISAR:\s*(.+?)\s*$/im);
  if (pedido) {
    const consulta = pedido[1].replace(/["*]/g, '').trim();
    console.log(`[pesquisa] Nutri pediu pra pesquisar: ${consulta}`);
    enviar(jidGrupo, acaso(['Boa pergunta. Deixa eu conferir isso direito antes de falar besteira. 📚', 'Isso eu não vou chutar. Pesquisando... 🔎', 'Segura que eu vou ler sobre isso rapidinho. 🤓']), msg, { rapido: true }).catch(() => {});
    // PubMed/Wikipedia/Brave e, quando ligado (PESQUISA_WEB=on, exige faturamento no Google), a busca do Google pelo Gemini
    const [fontesBase, web] = await Promise.all([
      pesquisar({ en: consulta, pt: texto }).catch((e) => (console.error('[pesquisa]', e.message), [])),
      ia.pesquisarNaWeb(consulta).catch(() => null),
    ]);
    const fontes = web
      ? [{ fonte: 'Google (busca na web com fontes)', titulo: `Resumo da busca: ${web.consultas.slice(0, 2).join(' / ') || consulta}`, url: web.fontes[0]?.url || `https://www.google.com/search?q=${encodeURIComponent(consulta)}`, trecho: `${web.texto}\nFontes: ${web.fontes.slice(0, 5).map((f) => f.url).join(' ')}` }, ...fontesBase]
      : fontesBase;
    const fontesTxt = formatarFontes(fontes, 8);
    const r2 = await ia.responder({
      ...base,
      jaPesquisou: true,
      conhecimento: `${docsPara(eu, { texto })}\n\n### Pesquisa que você acabou de fazer sobre "${consulta}"\n${fontesTxt}`,
    });
    resposta = r2.texto;
    atualizacao = r2.atualizacao || atualizacao;
    habito = r2.habito || habito;
    querAudio = r2.audio || querAudio;
    registro = r2.registro || registro;
    refeicao = r2.refeicao || refeicao;
    reacao = r2.reacao || reacao;
    origemExterna = ia.ultimaFoiExterna();
    if (fontes.length) {
      ia.notaDeEstudo({ consulta, fontes: fontesTxt, dia })
        .then((nota) => salvarPesquisa({ consulta, nota, fontes, dia }))
        .then((d) => console.log(`[pesquisa] nota salva: ${d.id}`))
        .catch((e) => console.error('[pesquisa] falha ao salvar nota:', e.message));
    }
  }

  // A Nutri quer o rótulo de um produto industrializado (Open Food Facts) antes de responder: busca e pergunta de novo
  if (produto && !pedido) {
    console.log(`[rotulo] Nutri pediu o rótulo de: ${produto}`);
    const achados = await comTempo(ehCodigoBarras(produto) ? buscarPorCodigo(produto).then((p) => (p ? [p] : [])) : buscarPorNome(produto), 15_000, 'Open Food Facts').catch((e) => (console.warn('[rotulo]', e.message), []));
    const bloco = achados.length ? blocoRotulos(achados) : `(nenhum produto encontrado no Open Food Facts para "${produto}": estime pelo que sabe do tipo de produto e diga que é estimativa)`;
    console.log(`[rotulo] ${achados.length} produto(s) para "${produto}"`);
    rotulosAtuais = [base.rotulos, bloco].filter(Boolean).join('\n');
    const r2 = await ia.responder({ ...base, rotulos: rotulosAtuais, jaPesquisou: true, conhecimento });
    resposta = r2.texto;
    atualizacao = r2.atualizacao || atualizacao;
    habito = r2.habito || habito;
    querAudio = r2.audio || querAudio;
    registro = r2.registro || registro;
    refeicao = r2.refeicao || refeicao;
    reacao = r2.reacao || reacao;
    origemExterna = ia.ultimaFoiExterna();
  }

  // CONFERÊNCIA ANTES DE ENVIAR (a parte de "perceber o erro" que dá pra construir):
  // (a) em código, sem IA: um total de calorias citado como "do dia" que não existe nos registros barra o envio;
  // (b) quando a pessoa contestou, o modelo leve confere a resposta contra os registros.
  // Nos dois casos ela responde de novo UMA vez com o problema apontado; se insistir, vai assim mesmo e fica no log.
  if (resposta && !/^\s*PESQUISAR:/i.test(resposta) && motivo) {
    const conhecidos = totaisConhecidos(refeicoesHoje, perfis);
    const meu = conhecidos.porPessoa.get(perfil.nome) || { total: 0, refeicoes: [] };
    const novaKcal = Number(refeicao?.kcal) || 0;
    const extras = [novaKcal, meu.total + novaKcal].filter(Boolean);
    let problema = '';
    const suspeitos = numerosSuspeitos(resposta, conhecidos, { extras });
    if (suspeitos.length) {
      const totais = [...conhecidos.porPessoa.entries()].map(([n, v]) => `${n.split(' ')[0]} ${Math.round(v.total)} kcal`).join(', ');
      problema = `sua resposta citou ${suspeitos.map((s) => `${s.numero} kcal ("${s.trecho}")`).join(' e ')} como total, e esse número NÃO existe nos registros. Totais oficiais de hoje: ${totais || 'nenhum'}${novaKcal ? ` (+ ${novaKcal} kcal desta refeição de ${perfil.nome.split(' ')[0]})` : ''}.`;
    } else if (contestacao) {
      const c = await ia.conferirResposta({ resposta, registradas, texto, nome: perfil.nome });
      if (!c.ok && c.problema) problema = c.problema;
    }
    // (c) objetivo trocado: vocabulário do objetivo OPOSTO ao da pessoa ("[[Hipertrofia]]" pra quem quer emagrecer) barra o
    // envio; reserva externa faz isso com frequência (Heitor, 28/09 14:15, pelo Qwen3-VL)
    const termosErrados = eu.objetivo ? vocabularioErrado(resposta, eu.objetivo) : [];
    if (!problema && termosErrados.length) {
      problema = `sua resposta para ${perfil.nome.split(' ')[0]} usou vocabulário do objetivo OPOSTO ao dela(e): ${termosErrados.join(', ')}. O objetivo de ${perfil.nome.split(' ')[0]} é "${eu.objetivo}". Reescreva sem esses termos, com veredito, dica e [[links]] alinhados a ESSE objetivo.`;
    }
    if (problema) {
      console.warn(`[consciencia] resposta barrada e refeita: ${problema.slice(0, 200)}`);
      const aviso = `\n\nCONFERÊNCIA DO SISTEMA (feita ANTES de enviar sua resposta anterior, que foi barrada): ${problema} Reescreva a resposta usando SÓ os números do bloco "REFEIÇÕES JÁ REGISTRADAS HOJE"; se a pessoa tiver razão, ceda e corrija (linha REGISTRO quando for registro). Não mencione esta conferência.`;
      const r3 = await ia.responder({ ...base, rotulos: rotulosAtuais, jaPesquisou: true, conhecimento: `${conhecimento || ''}${aviso}` }).catch(() => null);
      if (r3?.texto) {
        resposta = r3.texto;
        atualizacao = r3.atualizacao || atualizacao;
        habito = r3.habito || habito;
        querAudio = r3.audio || querAudio;
        registro = r3.registro || registro;
        refeicao = r3.refeicao || refeicao;
        reacao = r3.reacao || reacao;
        origemExterna = ia.ultimaFoiExterna();
        const ainda = numerosSuspeitos(resposta, conhecidos, { extras: [Number(refeicao?.kcal) || 0, meu.total + (Number(refeicao?.kcal) || 0)].filter(Boolean) });
        if (ainda.length) console.warn(`[consciencia] ainda suspeito depois de refazer: ${ainda.map((s) => s.numero).join(', ')} kcal (enviando assim mesmo)`);
      }
      // objetivo trocado não passa de jeito nenhum: se a reescrita (ou a falta dela) ainda trouxer o termo, a frase sai
      const aindaErrados = eu.objetivo ? vocabularioErrado(resposta, eu.objetivo) : [];
      if (aindaErrados.length) {
        resposta = removerFrasesCom(resposta, aindaErrados);
        console.warn(`[consciencia] frases com objetivo trocado removidas da resposta pra ${perfil.nome}: ${aindaErrados.join(', ')}`);
      }
    }
  }

  // Plano/pedido de opinião: se a IA ainda assim montou bloco de refeição, ele sai ("🕐 Refeição", "O que eu vi", Veredito); a estimativa vira "se comer isso"
  if (!temImagem && !temAudio && parecePedidoOuPlano(textoDecisao) && /Refei[cç][aã]o:|O que eu vi/i.test(resposta || '')) {
    const antes = resposta;
    resposta = String(resposta || '')
      .split('\n')
      .filter((l) => !/^\s*(?:🕐|⚖️)|Refei[cç][aã]o:\*?\s*(caf[eé]|almo[cç]o|lanche|jantar|ceia)|^\s*\*?Veredito/i.test(l))
      .map((l) => l.replace(/^(\s*🍽️\s*\*?)O que eu vi:?\*?/i, '$1Se for isso:*').replace(/^(\s*🔥\s*\*?)Estimativa:?\*?/i, '$1Ficaria em:*'))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (resposta !== antes) console.log(`[consciencia] plano de ${perfil.nome} ("${texto.slice(0, 40)}"): bloco de refeição retirado da resposta`);
  }
  // Papo curto ("hehe", "ai demora um pouco"): resposta de uma ou duas frases, sem bloco, Dica nem [[links]]
  if (papoCurto(texto, { temImagem, temAudio }) && !contestacao) {
    const enxuta = enxugarPapo(resposta);
    if (enxuta !== resposta.trim()) {
      console.log(`[consciencia] papo curto de ${perfil.nome}: resposta enxugada de ${resposta.length} pra ${enxuta.length} chars`);
      resposta = enxuta;
    }
  }
  // Repetição: frase (quase) igual a algo dito nas últimas 2 h, ou comentário de clima/sono/agenda que já saiu, não vai de novo
  {
    const rep = removerRepeticoes(resposta, respostasRecentes(historico, hora), { textoPessoa: texto });
    if (rep.removidas.length) {
      console.log(`[consciencia] ${rep.removidas.length} frase(s) repetida(s) removida(s) da resposta pra ${perfil.nome}: ${rep.removidas.map((f) => f.slice(0, 60)).join(' | ')}`);
      resposta = rep.texto;
    }
  }

  // Bordão de chegada já usado hoje sai; gíria com grafia inventada ("Arraseu") e vocativo no gênero errado ("amada" pro Heitor) são corrigidos
  {
    const b = removerBordoesRepetidos(resposta, { historico, persona: estado.persona });
    if (b.removidas.length) {
      console.log(`[consciencia] bordão repetido removido da resposta pra ${perfil.nome}: ${b.removidas.map((f) => f.slice(0, 60)).join(' | ')}`);
      resposta = b.texto;
    }
    const antes = resposta;
    resposta = concordarVocativos(corrigirGirias(resposta), { genero: eu.genero || perfil.genero, outrosNomes: perfis.filter((p) => p !== eu).map((p) => p.nome.split(' ')[0]) });
    if (resposta !== antes) console.log(`[consciencia] gíria/concordância corrigida na resposta pra ${perfil.nome}`);
  }

  // Foi refeição? Quando a análise traz "🕐 Refeição:" ou "O que eu vi" (comida consumida). "Estimativa" sozinha não basta:
  // sugestões também trazem estimativa e não são refeição. Exceção: foto com legenda de comida cuja resposta veio sem
  // bloco (modelo reserva esqueceu) e não diz que é receita/rótulo/produto: registra mesmo assim, sem estimativa.
  const temBloco = /Refei[cç][aã]o:\*?\s*(caf[eé]|almo[cç]o|lanche|jantar|ceia)|O que eu vi/i.test(resposta || '');
  // "rótulo", "tabela nutricional" etc. na resposta normalmente significam "não foi refeição". Mas quando a pessoa DIZ que
  // consumiu ("tomei 200 ml desse iogurte" + foto do rótulo), é refeição sim: aí só a negação explícita dela vale.
  const RE_NAO_COMIDA = pareceConsumo(texto)
    ? /não (é|foi) (uma )?refei|comeu isso ou|é (só )?(pra|para) avaliar/i
    : /receita|r[óo]tulo|tabela nutricional|card[áa]pio|produto|embalagem|print|suplemento novo|não (é|foi) (uma )?refei|comeu isso ou/i;
  const naoEhComida = RE_NAO_COMIDA.test(resposta || '');
  const blocoDeSugestao = /O que eu vi:\*?[^\n]*sugest|Estimativa[^:\n]*:[^\n]*sugest/i.test(resposta || '');
  // Texto sem foto que é pedido de sugestão ou plano futuro NUNCA vira refeição, mesmo que a IA tenha posto o bloco
  const ehPedido = !temImagem && !temAudio && parecePedidoOuPlano(textoDecisao);
  // Correção de uma análise recente ("não é picanha, é fígado") com estimativa nova: atualiza o registro anterior
  // Vale também COM foto: o rótulo/tabela mandado minutos depois do shake ("segue a tabela, dá uma ajustada") corrige o
  // registro do shake, não vira uma segunda refeição de 800 kcal
  // Linha REFEICAO da IA (estruturada): números e tipo vêm dela, não de regex no texto. O texto continua como reserva
  // (modelo externo que não escreveu a linha).
  const TIPOS = new Set(['cafe', 'lanche_manha', 'almoco', 'lanche', 'jantar', 'ceia']);
  const estruturada = refeicao && Number(refeicao.kcal) > 0 && Number(refeicao.kcal) < 8000 ? refeicao : null;
  // a pessoa disse QUANDO comeu ("esqueci de informar meu café da manhã, foi às 8h20"): a refeição é retroativa, com a
  // hora dita, e não é correção nem parte da última refeição registrada
  const horaDita = typeof estruturada?.hora === 'string' && /^\d{1,2}[:h]\d{2}$/.test(estruturada.hora.trim()) ? estruturada.hora.trim().replace('h', ':').padStart(5, '0') : null;
  const retroativa = horaDita != null && Math.abs(minutosDe(horaDita) - minutosDe(horaLocal)) > 45;
  const correcaoEstruturada = !retroativa && Boolean(estruturada?.correcao) && minhaUltima && minutosDe(horaLocal) - minhaUltima.minutos <= 45;
  // parte da mesma refeição (mensagem parcelada) com números novos também é correção do registro anterior, não refeição nova
  const correcaoRecente = !retroativa && (correcaoEstruturada || ((parteDaMesma || (!temAudio && !metaConversa && pareceCorrecao(texto) && minhaUltima && minutosDe(horaLocal) - minhaUltima.minutos <= 30)) && Boolean(estruturada || lerEstimativa(resposta))));
  const foiRefeicao = !ehPedido && !metaConversa && !blocoDeSugestao && (Boolean(estruturada) || temBloco || correcaoRecente || (temImagem && Boolean(resposta) && !naoEhComida));

  // Papo aleatório avaliado pela IA (respondendo ou não): o próximo só daqui a PAPO_INTERVALO_MIN
  if (!motivo && !foiRefeicao) ultimoPapoEm = Date.now();

  // A pessoa contou um dado novo (peso, cidade, dieta...): sobrescreve o perfil agora, com a data, e a ficha no Drive
  if (atualizacao && typeof atualizacao === 'object') {
    const novo = aplicarAtualizacao(perfil, atualizacao, dia);
    if (novo) {
      perfil = await salvarPerfil(novo).catch((e) => (console.error('[perfil] falha ao atualizar:', e.message), perfil));
      console.log(`[perfil] ${perfil.nome} atualizado: ${Object.keys(novo).filter((k) => !['jids', 'atualizacoes'].includes(k)).join(', ')}`);
      if (novo.peso) registrarPesagem({ jid: jids[0], nome: perfil.nome, dia, peso: novo.peso }).catch(() => {}); // evolução de peso com data
      salvarFicha(perfil, mdPerfil(perfil)).catch(() => {});
    }
  }

  let enviado = null;
  if (resposta && !/^\s*PESQUISAR:/i.test(resposta)) {
    enviado = await enviar(jidGrupo, resposta, msg, { rapido: temImagem }); // foto já teve o aviso, não precisa de pausa
    if (perguntaIA) {
      // uma pergunta por refeição: a próxima mensagem dessa pessoa sabe que já perguntou
      estado.memoria.perguntas ||= {};
      estado.memoria.perguntas[jids[0]] = { hora, pergunta: perguntaIA };
    }
    // reação com emoji na mensagem da pessoa (linha REAGIR da IA): prato nota 10, piada boa, conquista
    if (reacao && !contestacao) reagir(jidGrupo, msg.key, reacao).catch(() => {});
    if (atividadeRelato) {
      const nota = await registrarRelato(eu, atividadeRelato, dia).catch((e) => (console.error('[atividades] relato:', e.message), null));
      if (nota) console.log(`[atividades] relato de ${perfil.nome}: ${nota}`);
    }
    if (despensaLinha) {
      const feitos = await aplicarLinhaDespensa(eu, despensaLinha, { dia }).catch((e) => (console.error('[despensa] linha:', e.message), []));
      if (feitos.length) console.log(`[despensa] ${perfil.nome}: ${feitos.join(' | ')}`);
    }
    if (notaLida?.itens?.length) {
      // a IA reconheceu um cupom sem QR legível: padroniza e entra na despensa; avisa em mensagem separada
      padronizarItens(notaLida.itens, { perfil: eu, dia })
        .then((itens) => registrarNota({ perfil: eu, loja: notaLida.loja, data: notaLida.data, itens, origem: 'foto' }).then((r) => enviar(jidGrupo, confirmacaoNota({ loja: notaLida.loja, dia: r.dia, itens, repetida: r.repetida }), msg, { rapido: true })))
        .catch((e) => console.error('[despensa] nota pela IA:', e.message));
    }
    await lembrar({ hora, jid: jids[0], nome: ia.nomeDaBot(), texto: resposta, tipo: 'bot' });
    // Nota de voz: sempre quando a pessoa pediu; fora de pedido só quando ela marcou AUDIO: sim, com teto (1 por dia, 2 por semana)
    const pediu = pedidoDeAudio(texto);
    if ((pediu || querAudio) && (pediu || podeAudioEspontaneo())) {
      sintetizar(resposta)
        .then(async (ogg) => {
          await enviarAudio(jidGrupo, ogg, msg);
          if (!pediu) await marcarAudioEspontaneo();
        })
        .catch((e) => console.warn('[voz] resposta sem áudio:', e.message));
    }
  }
  // (a checagem de objetivo trocado agora acontece ANTES do envio, no bloco de conferência acima)
  // água/álcool ditos agora (linha oculta HABITO da IA) -> somados no dia; aparecem no !hoje
  if (habito && typeof habito === 'object') {
    registrarHabito({ jid: jids[0], nome: perfil.nome, dia, agua_ml: Number(habito.agua_ml) || 0, alcool_doses: Number(habito.alcool_doses) || 0 }).catch((e) => console.error('[habitos]', e.message));
  }
  // A pessoa pediu pra apagar ou corrigir um registro do dia (linha oculta REGISTRO da IA): o sistema executa aqui,
  // só nos registros DELA. Sem a linha, nada muda (e a regra manda a IA não prometer que "já ajustou").
  for (const reg of Array.isArray(registro) ? registro : []) {
    try {
      const meus = refeicoesHoje.filter((r) => jids.includes(r.jid));
      const alvo = acharRegistro(meus, reg.apagar ?? reg.hora);
      if (!alvo) {
        console.warn(`[refeicoes] REGISTRO de ${perfil.nome} sem alvo: ${JSON.stringify(reg)} (registros: ${meus.map((r) => r.horaLocal || r.hora).join(', ') || 'nenhum'})`);
        continue;
      }
      if (reg.apagar != null) {
        await apagarRefeicaoPorId(alvo._id);
        console.log(`[refeicoes] ${perfil.nome} apagou o registro das ${alvo.horaLocal || alvo.hora} (${alvo.slot}, ~${alvo.estimativa?.kcal || '?'} kcal)`);
        registrarCorrecao({ dia, pessoa: perfil.nome, texto: `registro de ${nomeDoSlot(alvo.slot)} das ${alvo.horaLocal || alvo.hora} (~${alvo.estimativa?.kcal || '?'} kcal) APAGADO a pedido de ${perfil.nome.split(' ')[0]}: era duplicado ou errado; qualquer total do dia dito na conversa antes disso está errado` }).catch(() => {});
        continue;
      }
      const set = {};
      const est = { ...(alvo.estimativa || {}) };
      if (Number(reg.kcal) > 0) est.kcal = Number(reg.kcal);
      if (reg.proteina != null && Number(reg.proteina) >= 0) est.p = Number(reg.proteina);
      if (reg.carbo != null && Number(reg.carbo) >= 0) est.c = Number(reg.carbo);
      if (reg.gordura != null && Number(reg.gordura) >= 0) est.g = Number(reg.gordura);
      if (est.kcal) set.estimativa = est;
      const tipo = reg.tipo && lerTipoRefeicao(`Refeição: ${reg.tipo}`);
      if (tipo) set.slot = tipo;
      // "o café foi às 8h20, não agora": move o registro pra hora em que a pessoa comeu
      const novaHora = typeof reg.mover_para === 'string' && /^\d{1,2}[:h]\d{2}$/.test(reg.mover_para.trim()) ? reg.mover_para.trim().replace('h', ':').padStart(5, '0') : null;
      if (novaHora) {
        set.horaLocal = novaHora;
        set.minutos = minutosDe(novaHora);
        if (!tipo && alvo.slot === slotDaHora(alvo.horaLocal || alvo.hora).id) set.slot = slotDaHora(novaHora).id; // tipo era só pela hora: acompanha
      }
      if (typeof reg.descricao === 'string' && reg.descricao.trim()) set.descricao = reg.descricao.trim().slice(0, 220);
      if (Object.keys(set).length) {
        await atualizarRefeicao(alvo._id, set);
        if (set.estimativa && alvo.estimativa?.kcal) registrarCorrecaoEstimativa({ jid: jids[0], nome: perfil.nome, dia, slot: alvo.slot, antes: alvo.estimativa, depois: set.estimativa, origem: 'registro', descricao: alvo.descricao, texto }).catch(() => {});
        console.log(`[refeicoes] ${perfil.nome} corrigiu o registro das ${alvo.horaLocal || alvo.hora}: ${JSON.stringify(set)}`);
        registrarCorrecao({ dia, pessoa: perfil.nome, texto: `registro das ${alvo.horaLocal || alvo.hora} CORRIGIDO a pedido de ${perfil.nome.split(' ')[0]}${set.estimativa ? ` para ~${set.estimativa.kcal} kcal` : ''}${set.slot ? ` (tipo: ${nomeDoSlot(set.slot)})` : ''}; o valor dito antes na conversa está errado` }).catch(() => {});
      }
    } catch (e) {
      console.error('[refeicoes] REGISTRO falhou:', e.message);
    }
  }

  const resumoRefeicao = texto || (temImagem ? (imagens.length > 1 ? `[${imagens.length} fotos]` : '[foto]') : temAudio ? '[áudio]' : '');
  let refeicaoRegistrada = null; // { slot, minutos } do registro feito agora, pra revisão poder corrigi-lo
  if (foiRefeicao) {
    // O tipo da refeição vem do que a IA entendeu (a pessoa disse "café da manhã"); numa correção, o da refeição corrigida
    const tipoEstruturado = estruturada && TIPOS.has(String(estruturada.tipo || '').trim()) ? String(estruturada.tipo).trim() : null;
    // refeição retroativa: hora e tipo pela hora DITA (café das 8h20 informado às 15h é café, às 08:20)
    const horaRegistro = retroativa ? horaDita : horaLocal;
    const slotFinal = (correcaoRecente && minhaUltima?.slot) || tipoEstruturado || (retroativa ? slotDaHora(horaDita).id : null) || lerTipoRefeicao(resposta) || slot.id;
    if (retroativa) console.log(`[refeicoes] ${perfil.nome}: refeição informada agora mas comida às ${horaDita} (registro retroativo, ${slotFinal})`);
    // Números: primeiro a linha REFEICAO; sem ela, o texto; sem números legíveis (modelo reserva), estimativa num modelo leve
    let estimativa = estruturada
      ? { kcal: Math.round(Number(estruturada.kcal)), p: Math.round(Number(estruturada.proteina) || 0), c: Math.round(Number(estruturada.carbo) || 0), g: Math.round(Number(estruturada.gordura) || 0) }
      : lerEstimativa(resposta);
    const descricaoBase = (typeof estruturada?.itens === 'string' && estruturada.itens.trim().slice(0, 220)) || descricaoDaAnalise(resposta, resumoRefeicao);
    if (!estimativa && descricaoBase && !/^\[(foto|áudio)\]$/.test(descricaoBase)) {
      estimativa = (await ia.estimarRefeicaoManual({ descricao: descricaoBase, perfil }).catch(() => null))?.estimativa || null;
      if (estimativa) console.log(`[refeicoes] estimativa de reserva pra ${perfil.nome}: ${JSON.stringify(estimativa)}`);
    }
    registrarRefeicao({
      jid: jids[0],
      nome: perfil.nome,
      dia,
      hora,
      horaLocal: horaRegistro, // no fuso da pessoa (Paris é Paris); na retroativa, a hora em que ela COMEU
      minutos: correcaoRecente ? minhaUltima.minutos : minutosDe(horaRegistro), // correção cai no registro que corrige
      slot: slotFinal,
      resumo: resumoRefeicao.slice(0, 120),
      descricao: descricaoBase,
      estimativa, // kcal e macros da análise (ou estimativa de reserva), gravados agora: o resumo semanal soma daqui
      incerteza: incertezaIA || undefined, // alta|media|baixa: a bot sabia que estava chutando?
      correcao: Boolean(correcaoRecente),
      correcaoEstimativa: Boolean(correcaoRecente) && ehCorrecaoDeEstimativa(texto), // só quantidade/alimento/rótulo entra na calibração; "tem também um suco" não
      manual: retroativa, // retroativa não se funde com o registro vizinho no banco
      // "lanche" 1 min depois do almoço é outra refeição, não complemento: quando a pessoa nomeia outra refeição, não funde
      slotExplicito: Boolean(minhaUltima) && slotFinal !== minhaUltima.slot && mencionaOutraRefeicao(texto, minhaUltima.slot),
    }).catch((e) => console.error('[refeicoes] falha ao registrar:', e.message));
    refeicaoRegistrada = { slot: slotFinal, minutos: correcaoRecente ? minhaUltima.minutos : minutosDe(horaRegistro) };
    const mensagens = estado.memoria.mensagens;
    // marca a mensagem da pessoa (a última que não é da bot) como refeição, pro diário e pro resumo
    for (let i = mensagens.length - 1; i >= 0; i--) {
      if (mensagens[i].tipo !== 'bot') {
        mensagens[i].refeicao = slotFinal;
        break;
      }
    }
  }

  // Resposta saiu por reserva externa (Gemini em alta demanda): fica anotada pra ela mesma revisar quando o Gemini voltar.
  // Se estava errada, ela corrige no grupo citando a mensagem e conserta o registro da refeição (revisao.js, cron de 10 min).
  if (origemExterna && enviado?.key && resposta && !/^\s*PESQUISAR:/i.test(resposta)) {
    registrarParaRevisao({ jidGrupo, jid: jids[0], perfil, texto, imagem, mimeType, resposta, dia, hora, horaLocal, enviado, refeicao: refeicaoRegistrada })
      .catch((e) => console.error('[revisao] falha ao anotar pra revisão:', e.message));
  }
  // A daily note do Drive é regerada a partir da memória (agendarDiario, chamado por lembrar)
}
