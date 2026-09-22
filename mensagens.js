// mensagens.js - O fluxo de cada mensagem do grupo: apresentação e nome, comandos, cadastro, decisão de responder ou não,
// resposta da IA (com pesquisa quando ela não sabe), atualização de perfil e registro de refeição.

import { extractMessageContent, jidNormalizedUser, proto } from '@whiskeysockets/baileys';

import { buscarPerfil, salvarPerfil, listarPerfis, persistirMemoria, registrarRefeicao, salvarConfig, momentosRecentes, salvarPendentes, carregarPendentes, registrarPesagem } from './mongo.js';
import { mdPerfil } from './drive.js';
import * as ia from './gemini.js';
import { docsPara, salvarPesquisa } from './conhecimento.js';
import { pesquisar, formatarFontes } from './pesquisa.js';
import { dossieDe, salvarFicha } from './pessoas.js';
import { lerEstimativa, descricaoDaAnalise } from './resumo.js';
import { agora, fusoDe, fusoValido, slotDaHora, minutosDe, hhmmDe, mencionaNome } from './util.js';
import { estado, naFila, GRUPO_PERMITIDO } from './estado.js';
import { enviar, baixarMidia, meusJids, jidsDoRemetente, enviadosPeloBot, ACKS_FOTO, acaso } from './whatsapp.js';
import { lembrar, garantirDiaAtual, renomearNaMemoria } from './dia.js';
import { enriquecerPerfis, aplicarAtualizacao } from './perfis.js';
import { tratarComando } from './comandos.js';
import { avisarErro } from './avisos.js';

const IDADE_MAX_MSG_S = 6 * 60 * 60; // ignora mensagens com mais de 6h (flood após o bot voltar do sleep)
const PAPO_INTERVALO_MIN = Number(process.env.PAPO_INTERVALO_MIN) || 10; // papo aleatório: ela entra no máximo 1x a cada N min

const gruposIgnoradosLogados = new Set();

// ============================================================
// Entrada: o que o whatsapp.js chama
// ============================================================
// Mensagens chegam numa lista e a fila drena a lista inteira de uma vez. Se acumulou atraso (IA lenta, bot fora do ar),
// as mensagens de texto do lote entram só no histórico e a ÚLTIMA recebe a resposta, já sabendo de tudo que chegou.
// Fotos e áudios do lote continuam sendo analisados um a um. Comandos e cadastro também rodam normalmente.
const pendentes = [];
let processando = null; // mensagem em andamento (pra salvar no desligamento também)

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

async function drenar() {
  if (!pendentes.length) return;
  const lote = pendentes.splice(0, pendentes.length);
  if (lote.length > 1) console.log(`[bot] ${lote.length} mensagens juntas: lendo tudo e respondendo de uma vez`);
  for (let i = 0; i < lote.length; i++) {
    processando = lote[i];
    const ultima = i === lote.length - 1;
    try {
      await processar(lote[i], { emLote: !ultima, atrasadas: ultima ? lote.length - 1 : 0 });
    } catch (e) {
      console.error('[bot] erro ao processar:', e);
      const jid = lote[i]?.key?.remoteJid;
      if (jid?.endsWith('@g.us')) await avisarErro(jid, 'interno', e?.message);
    } finally {
      processando = null;
    }
  }
}

/** Mensagens que ainda não foram processadas (pra salvar no desligamento). */
export function mensagensPendentes() {
  return [processando, ...pendentes].filter(Boolean);
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
export async function processar(msg, { emLote = false, atrasadas = 0 } = {}) {
  if (!msg.message) return;
  if (msg.key.fromMe && enviadosPeloBot.has(msg.key.id)) return; // resposta do próprio bot
  const jidGrupo = msg.key.remoteJid;
  if (!jidGrupo?.endsWith('@g.us')) return; // só grupos

  if (GRUPO_PERMITIDO && jidGrupo !== GRUPO_PERMITIDO) {
    if (!gruposIgnoradosLogados.has(jidGrupo)) {
      gruposIgnoradosLogados.add(jidGrupo);
      console.log(`[bot] ignorando grupo ${jidGrupo} (ALLOWED_GROUP_ID=${GRUPO_PERMITIDO})`);
    }
    return;
  }

  const ts = Number(msg.messageTimestamp) || 0;
  if (ts && Date.now() / 1000 - ts > IDADE_MAX_MSG_S) return;

  const conteudo = extractMessageContent(msg.message);
  if (!conteudo) return;
  const texto = (conteudo.conversation || conteudo.extendedTextMessage?.text || conteudo.imageMessage?.caption || '').trim();
  const temImagem = Boolean(conteudo.imageMessage);
  const temAudio = Boolean(conteudo.audioMessage);
  if (!texto && !temImagem && !temAudio) return; // sticker, vídeo, documento etc.

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
    const dossieNovo = await dossieDe(perfil).catch((e) => (console.error('[pessoas]', e.message), ''));
    const bemVindo = await ia.boasVindas(perfil, estado.persona, dossieNovo);
    await enviar(jidGrupo, bemVindo);
    await lembrar({ hora, jid: jids[0], nome: ia.nomeDaBot(), texto: bemVindo, tipo: 'bot' });
    salvarFicha(perfil, mdPerfil(perfil)).catch((e) => console.error('[drive]', e.message));
    return;
  }

  // ---------- Fluxo normal: texto e/ou foto ----------
  let imagem = null;
  let mimeType = null;
  if (temImagem) {
    // aviso imediato: a análise da foto demora alguns segundos
    enviar(jidGrupo, acaso(ACKS_FOTO), msg, { rapido: true }).catch(() => {});
    try {
      imagem = await baixarMidia(msg);
      mimeType = conteudo.imageMessage.mimetype || 'image/jpeg';
    } catch (e) {
      console.error('[wa] falha ao baixar imagem:', e.message);
      return avisarErro(jidGrupo, 'midia');
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
  const contextoHorario =
    `hora local de ${perfil.nome}: ${horaLocal}${eu.cidade ? ` em ${eu.cidade}` : ' (cidade/fuso ainda não informados, pode estar errada)'}; ` +
    `horário de ${slot.nome}; ${perfil.nome} costuma mandar ${slot.nome} ~${habitual}` +
    (atrasadas
      ? `. ATENÇÃO: as últimas ${atrasadas + 1} mensagens do histórico (esta incluída) chegaram juntas, em sequência. Trate como UMA fala só (mesmo contexto, mesma refeição se for comida, mesma pergunta se for dúvida): responda uma vez, considerando tudo, e não responda mensagem por mensagem`
      : '');
  // Papo aleatório não leva dossiê nem base de conhecimento (só persona, perfis e histórico): metade dos tokens
  const dossie = motivo ? await dossieDe(eu).catch((e) => (console.error('[pessoas]', e.message), '')) : '';
  const conhecimento = motivo ? docsPara(eu, { texto }) : '';
  const momentos = await momentosRecentes(12).catch(() => []);
  const citada = citacaoDe(conteudo, perfis);
  const marcaCitacao = citada ? `(respondendo a ${citada.autor}: "${citada.texto.slice(0, 80)}${citada.texto.length > 80 ? '…' : ''}") ` : '';
  const entradaTexto = `${marcaCitacao}${temImagem ? `📷 [foto]${texto ? ` ${texto}` : ''}` : temAudio ? '🎤 [áudio]' : texto}`;
  const historico = [...estado.memoria.mensagens];
  await lembrar({ hora, jid: jids[0], nome: perfil.nome, texto: entradaTexto, tipo: temImagem ? 'foto' : temAudio ? 'audio' : 'texto' });

  if (atrasadas >= 6) await avisarErro(jidGrupo, 'lenta'); // só quando foi atraso de verdade, não 2 ou 3 mensagens seguidas
  const citacao = citacaoDe(conteudo, perfis);
  const base = { texto, imagem, mimeType, audio, audioMime, perfil: eu, perfis, historico, dia, hora, contextoHorario, persona: estado.persona, dossie, momentos, citacao };
  let resposta;
  let atualizacao = null;
  try {
    // papo aleatório (sem foto, pergunta, menção ou assunto dela) vai pelos modelos leves; o resto pelos Flash
    ({ texto: resposta, atualizacao } = await ia.responder({ ...base, conhecimento, leve: !motivo }));
  } catch (e) {
    // Gemini (todos) e reservas fora do ar: avisa em vez de ficar muda
    console.error('[ia] falha total:', e.message);
    estado.memoria.mensagens.pop(); // não deixa a mensagem sem resposta no histórico como se tivesse sido ignorada
    persistirMemoria(estado.memoria).catch(() => {});
    return avisarErro(jidGrupo, 'ia'); // 1 aviso a cada 10 min, não um por mensagem
  }

  // A Nutri não sabia: pesquisa (PubMed/Wikipedia), responde de novo e guarda a nota de estudo no Drive
  const pedido = resposta?.match(/^\s*PESQUISAR:\s*(.+?)\s*$/im);
  if (pedido) {
    const consulta = pedido[1].replace(/["*]/g, '').trim();
    console.log(`[pesquisa] Nutri pediu pra pesquisar: ${consulta}`);
    enviar(jidGrupo, acaso(['Boa pergunta. Deixa eu conferir isso direito antes de falar besteira. 📚', 'Isso eu não vou chutar. Pesquisando... 🔎', 'Segura que eu vou ler sobre isso rapidinho. 🤓']), msg, { rapido: true }).catch(() => {});
    const fontes = await pesquisar({ en: consulta, pt: texto }).catch((e) => (console.error('[pesquisa]', e.message), []));
    const fontesTxt = formatarFontes(fontes, 8);
    const r2 = await ia.responder({
      ...base,
      jaPesquisou: true,
      conhecimento: `${docsPara(eu, { texto })}\n\n### Pesquisa que você acabou de fazer sobre "${consulta}"\n${fontesTxt}`,
    });
    resposta = r2.texto;
    atualizacao = r2.atualizacao || atualizacao;
    if (fontes.length) {
      ia.notaDeEstudo({ consulta, fontes: fontesTxt, dia })
        .then((nota) => salvarPesquisa({ consulta, nota, fontes, dia }))
        .then((d) => console.log(`[pesquisa] nota salva: ${d.id}`))
        .catch((e) => console.error('[pesquisa] falha ao salvar nota:', e.message));
    }
  }

  // Foi refeição? Só quando a Nutri analisou como refeição consumida (bloco "O que eu vi"/"Estimativa"). Foto de receita,
  // rótulo, cardápio ou dúvida ("isso é bom?") não conta como refeição, então não entra na rotina nem no resumo.
  const foiRefeicao = /O que eu vi|Estimativa[^:\n]*:/i.test(resposta || ''); // inclui "Estimativa corrigida:"

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

  if (resposta && !/^\s*PESQUISAR:/i.test(resposta)) {
    await enviar(jidGrupo, resposta, msg, { rapido: temImagem }); // foto já teve o aviso, não precisa de pausa
    await lembrar({ hora, jid: jids[0], nome: ia.nomeDaBot(), texto: resposta, tipo: 'bot' });
  }

  const resumoRefeicao = texto || (temImagem ? '[foto]' : temAudio ? '[áudio]' : '');
  if (foiRefeicao) {
    registrarRefeicao({
      jid: jids[0],
      nome: perfil.nome,
      dia,
      hora,
      minutos: minutosDe(horaLocal), // no fuso da pessoa: é assim que ela aprende o horário habitual
      slot: slot.id,
      resumo: resumoRefeicao.slice(0, 120),
      descricao: descricaoDaAnalise(resposta, resumoRefeicao),
      estimativa: lerEstimativa(resposta), // kcal e macros da análise, gravados agora: o resumo semanal soma daqui
    }).catch((e) => console.error('[refeicoes] falha ao registrar:', e.message));
    const mensagens = estado.memoria.mensagens;
    // marca a mensagem da pessoa (a última que não é da bot) como refeição, pro diário e pro resumo
    for (let i = mensagens.length - 1; i >= 0; i--) {
      if (mensagens[i].tipo !== 'bot') {
        mensagens[i].refeicao = slot.id;
        break;
      }
    }
  }
  // A daily note do Drive é regerada a partir da memória (agendarDiario, chamado por lembrar)
}
