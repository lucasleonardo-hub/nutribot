// Volta depois de queda de sessão (retomada.js): o que ela resgata do histórico, o que ignora, e como pede desculpas.
// Caso real: 04/10/2026 04:21 o WhatsApp removeu o aparelho vinculado (401 device_removed); a bot ficou 5 h+ gerando QR
// enquanto duas pessoas a marcaram no grupo. Sem resgate, as mensagens nunca chegariam (aparelho novo não recebe o que
// foi enviado ao antigo). Tudo aqui roda sem WhatsApp e sem IA.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selecionarResgate, motivoDoResgate, notaDeAtraso, descreverAtraso, avisoDeVolta, segundosDaMensagem, atrasoEmMinutos, criarRetomada, RESGATE_MAX } from '../retomada.js';

const GRUPO = '120363430197980778@g.us';
const BOT_PN = '554898488147@s.whatsapp.net';
const BOT_LID = '9876543210@lid';
const MEUS = [BOT_PN, BOT_LID];
const NOME_BOT = 'Dona Benta';
const QUEDA = Date.parse('2026-10-04T07:21:28Z');
const AGORA = Date.parse('2026-10-04T13:00:00Z');
const seg = (iso) => Math.floor(Date.parse(iso) / 1000);

let n = 0;
const texto = (iso, t, { de = '554888205166@s.whatsapp.net', mencionar = [], citarDe = null, fromMe = false, grupo = GRUPO, nome = 'Lucas' } = {}) => ({
  key: { remoteJid: grupo, fromMe, id: `MSG${++n}`, participant: de },
  pushName: nome,
  messageTimestamp: seg(iso),
  message: mencionar.length || citarDe
    ? { extendedTextMessage: { text: t, contextInfo: { mentionedJid: mencionar, participant: citarDe || undefined } } }
    : { conversation: t },
});
const foto = (iso, legenda = '', de = '554891616867@s.whatsapp.net') => ({
  key: { remoteJid: GRUPO, fromMe: false, id: `MSG${++n}`, participant: de },
  messageTimestamp: seg(iso),
  message: { imageMessage: { caption: legenda, mimetype: 'image/jpeg' } },
});

test('motivoDoResgate: menção pelo número ou pelo LID, resposta a uma fala dela, nome no texto, foto; papo entre eles não', () => {
  assert.equal(motivoDoResgate(texto('2026-10-04T10:00:00Z', '@Dona oi', { mencionar: [BOT_PN] }), { meusJids: MEUS, nomeBot: NOME_BOT }), 'mencao');
  assert.equal(motivoDoResgate(texto('2026-10-04T10:00:00Z', 'oi', { mencionar: ['9876543210:3@lid'] }), { meusJids: MEUS, nomeBot: NOME_BOT }), 'mencao');
  assert.equal(motivoDoResgate(texto('2026-10-04T10:00:00Z', 'faz sentido', { citarDe: '554898488147:4@s.whatsapp.net' }), { meusJids: MEUS, nomeBot: NOME_BOT }), 'resposta-a-ela');
  assert.equal(motivoDoResgate(texto('2026-10-04T10:00:00Z', 'Benta, quanto de proteína tem no ovo?'), { meusJids: MEUS, nomeBot: NOME_BOT }), 'nome');
  assert.equal(motivoDoResgate(texto('2026-10-04T10:00:00Z', 'nutri, me ajuda'), { meusJids: MEUS, nomeBot: NOME_BOT }), 'nome');
  assert.equal(motivoDoResgate(foto('2026-10-04T10:00:00Z', 'almoço'), { meusJids: MEUS, nomeBot: NOME_BOT }), 'midia');
  assert.equal(motivoDoResgate(texto('2026-10-04T10:00:00Z', 'bora no vôlei hoje?'), { meusJids: MEUS, nomeBot: NOME_BOT }), null);
  assert.equal(motivoDoResgate(texto('2026-10-04T10:00:00Z', '@Heitor bora', { mencionar: ['554899999999@s.whatsapp.net'] }), { meusJids: MEUS, nomeBot: NOME_BOT }), null);
});

test('selecionarResgate: só o grupo, só depois da queda, só o que era pra ela, em ordem, sem repetição, sem o que ela mesma mandou', () => {
  const m1 = texto('2026-10-04T09:10:00Z', '@Benta tô com fome, o que como?', { mencionar: [BOT_PN] });
  const m2 = texto('2026-10-04T11:30:00Z', 'Benta? sumiu?', { de: '554891616867@s.whatsapp.net', nome: 'Ale' });
  const historico = [
    m2, // fora de ordem de propósito
    texto('2026-10-04T06:50:00Z', '@Benta boa noite', { mencionar: [BOT_PN] }), // ANTES da queda: já foi respondida na época
    texto('2026-10-04T10:00:00Z', 'alguém viu meu carregador?'), // papo entre eles
    texto('2026-10-04T10:05:00Z', 'tô indo pro treino', { de: '554899999999@s.whatsapp.net', nome: 'Heitor' }),
    { ...m1 }, // repetida (mesmo id) não conta duas vezes
    m1,
    texto('2026-10-04T10:30:00Z', 'oi gente', { fromMe: true, de: BOT_PN }), // dela mesma
    texto('2026-10-04T10:40:00Z', '@Benta oi', { mencionar: [BOT_PN], grupo: '5511999999999@s.whatsapp.net' }), // outro chat
    { key: { remoteJid: GRUPO, fromMe: false, id: 'STUB1' }, messageTimestamp: seg('2026-10-04T10:45:00Z'), messageStubType: 27 }, // sistema, sem message
    texto('2026-10-04T12:00:00Z', '!hoje'), // comando antigo não roda horas depois
  ];
  const r = selecionarResgate(historico, { desdeMs: QUEDA, agoraMs: AGORA, grupo: GRUPO, meusJids: MEUS, nomeBot: NOME_BOT });
  assert.deepEqual(r.resgatadas.map((m) => m.key.id), [m1.key.id, m2.key.id]);
  assert.deepEqual(r.motivos, ['mencao', 'nome']);
  assert.equal(r.vistasDoGrupo, 5, 'as 5 mensagens de outros no grupo depois da queda (m1, m2, 2 papos, !hoje) contam como vistas');
  for (const m of r.resgatadas) {
    assert.equal(m._resgatada, true);
    assert.equal(m._liberada, true, 'resgatada não espera fragmento nem digitação');
  }
});

test('selecionarResgate: passou do teto, ficam as mais recentes; histórico sem o grupo dá zero vistas', () => {
  const muitas = [];
  for (let i = 0; i < RESGATE_MAX + 4; i++) muitas.push(texto(new Date(Date.parse('2026-10-04T08:00:00Z') + i * 10 * 60_000).toISOString(), `@Benta pergunta ${i}`, { mencionar: [BOT_PN] }));
  const r = selecionarResgate(muitas, { desdeMs: QUEDA, agoraMs: AGORA, grupo: GRUPO, meusJids: MEUS, nomeBot: NOME_BOT });
  assert.equal(r.resgatadas.length, RESGATE_MAX);
  assert.equal(r.resgatadas.at(-1).key.id, muitas.at(-1).key.id, 'a última é a mais recente');
  const vazio = selecionarResgate([texto('2026-10-04T10:00:00Z', '@Benta', { mencionar: [BOT_PN], grupo: 'outro@g.us' })], { desdeMs: QUEDA, agoraMs: AGORA, grupo: GRUPO, meusJids: MEUS, nomeBot: NOME_BOT });
  assert.equal(vazio.vistasDoGrupo, 0);
  assert.equal(vazio.resgatadas.length, 0);
});

test('selecionarResgate: no histórico o remetente vem em msg.participant (não em key.participant); passa pra key', () => {
  const m = texto('2026-10-04T10:00:00Z', '@Benta oi', { mencionar: [BOT_PN] });
  delete m.key.participant;
  m.participant = '209826399420424@lid';
  const r = selecionarResgate([m], { desdeMs: QUEDA, agoraMs: AGORA, grupo: GRUPO, meusJids: MEUS, nomeBot: NOME_BOT });
  assert.equal(r.resgatadas.length, 1);
  assert.equal(r.resgatadas[0].key.participant, '209826399420424@lid');
});

test('selecionarResgate: o que chegou DEPOIS de religar não é resgate (já veio ao vivo), mesmo estando no histórico', () => {
  const religou = Date.parse('2026-10-04T12:40:00Z');
  const antes = texto('2026-10-04T12:30:00Z', '@Benta oi', { mencionar: [BOT_PN] });
  const depois = texto('2026-10-04T12:45:00Z', '@Benta voltou?', { mencionar: [BOT_PN] });
  const r = selecionarResgate([antes, depois], { desdeMs: QUEDA, ateMs: religou, agoraMs: AGORA, grupo: GRUPO, meusJids: MEUS, nomeBot: NOME_BOT });
  assert.deepEqual(r.resgatadas.map((m) => m.key.id), [antes.key.id]);
  assert.equal(r.vistasDoGrupo, 1);
});

test('selecionarResgate: mais velha que RESGATE_IDADE_MAX_H fica de fora mesmo depois da queda', () => {
  const velha = texto('2026-10-01T10:00:00Z', '@Benta oi', { mencionar: [BOT_PN] });
  const r = selecionarResgate([velha], { desdeMs: Date.parse('2026-09-30T00:00:00Z'), agoraMs: AGORA, grupo: GRUPO, meusJids: MEUS, nomeBot: NOME_BOT });
  assert.equal(r.resgatadas.length, 0);
});

test('segundosDaMensagem aceita número, string e Long do protobuf; atrasoEmMinutos conta a partir dele', () => {
  assert.equal(segundosDaMensagem({ messageTimestamp: 1791100000 }), 1791100000);
  assert.equal(segundosDaMensagem({ messageTimestamp: '1791100000' }), 1791100000);
  assert.equal(segundosDaMensagem({ messageTimestamp: { low: 1791100000, high: 0, unsigned: true, toNumber: () => 1791100000 } }), 1791100000);
  assert.equal(segundosDaMensagem({}), 0);
  assert.equal(Math.round(atrasoEmMinutos({ messageTimestamp: seg('2026-10-04T12:00:00Z') }, AGORA)), 60);
  assert.equal(atrasoEmMinutos({}, AGORA), 0);
});

test('notaDeAtraso: nada abaixo de 15 min; a primeira pede desculpas, a seguinte não repete', () => {
  assert.equal(notaDeAtraso(3), '');
  const primeira = notaDeAtraso(340, { primeira: true, motivo: 'seu WhatsApp foi desconectado' });
  assert.match(primeira, /desculpas pela demora/);
  assert.match(primeira, /há 5 h e 40 min/);
  assert.match(primeira, /seu WhatsApp foi desconectado/);
  const seguinte = notaDeAtraso(300, { primeira: false });
  assert.match(seguinte, /JÁ pediu desculpas/);
  assert.match(seguinte, /não peça de novo/);
});

test('descreverAtraso e avisoDeVolta', () => {
  assert.equal(descreverAtraso(7), 'há 7 min');
  assert.equal(descreverAtraso(125), 'há 2 h');
  assert.equal(descreverAtraso(135), 'há 2 h e 15 min');
  assert.equal(descreverAtraso(3 * 1440 + 10), 'há 3 dias');
  const aviso = avisoDeVolta(340);
  assert.match(aviso, /Voltei/);
  assert.match(aviso, /5 h e 40 min/);
  assert.match(aviso, /desculpa a demora/);
});

test('criarRetomada: religada -> espera o histórico -> enfileira o que era pra ela e apaga a marca', async () => {
  const enfileiradas = [];
  const enviadas = [];
  let marcaApagada = 0;
  const r = criarRetomada({
    grupo: () => GRUPO,
    meusJids: () => MEUS,
    nomeBot: () => NOME_BOT,
    enfileirar: (msgs) => (enfileiradas.push(...msgs), msgs.length),
    enviar: async (jid, t) => enviadas.push({ jid, t }),
    limparMarca: async () => marcaApagada++,
    agora: () => AGORA,
  });
  assert.equal(r.aoConectar({ relogada: false, desdeMs: 0 }), false, 'reconexão comum não abre janela');
  assert.equal(r.aoConectar({ relogada: true, desdeMs: QUEDA }), true);
  assert.equal(r.aberta(), true);
  r.aoHistorico({ messages: [texto('2026-10-04T09:10:00Z', '@Benta tô com fome', { mencionar: [BOT_PN] }), texto('2026-10-04T10:00:00Z', 'papo')] });
  r.aoHistorico({ messages: [texto('2026-10-04T11:30:00Z', 'Benta? sumiu?', { de: '554891616867@s.whatsapp.net' })] });
  r.aoHistoricoCompleto({ syncType: 0, status: 'complete' }); // INITIAL_BOOTSTRAP não fecha: ainda pode vir o RECENT
  assert.equal(r.aberta(), true);
  r.aoHistoricoCompleto({ syncType: 3, status: 'complete' }); // RECENT = 3 no proto
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(r.aberta(), false);
  assert.equal(enfileiradas.length, 2);
  assert.equal(enviadas.length, 0, 'achou o que responder: não manda aviso genérico');
  assert.equal(marcaApagada, 1);
});

test('criarRetomada: histórico sem nada do grupo depois de queda longa -> aviso de volta no grupo; queda curta -> silêncio', async () => {
  const enviadas = [];
  const r = criarRetomada({ grupo: () => GRUPO, meusJids: () => MEUS, nomeBot: () => NOME_BOT, enfileirar: () => 0, enviar: async (jid, t) => enviadas.push({ jid, t }), limparMarca: async () => {}, agora: () => AGORA });
  r.aoConectar({ relogada: true, desdeMs: QUEDA });
  const res = await r.concluir('teste');
  assert.equal(res.acao, 'aviso');
  assert.equal(enviadas.length, 1);
  assert.equal(enviadas[0].jid, GRUPO);
  assert.match(enviadas[0].t, /Voltei/);

  const curta = criarRetomada({ grupo: () => GRUPO, meusJids: () => MEUS, nomeBot: () => NOME_BOT, enfileirar: () => 0, enviar: async (jid, t) => enviadas.push({ jid, t }), limparMarca: async () => {}, agora: () => AGORA });
  curta.aoConectar({ relogada: true, desdeMs: AGORA - 5 * 60_000 });
  const res2 = await curta.concluir('teste');
  assert.equal(res2.acao, 'silencio');
  assert.equal(enviadas.length, 1);
});

test('criarRetomada: o grupo apareceu no histórico mas ninguém a chamou -> volta em silêncio', async () => {
  const enviadas = [];
  const r = criarRetomada({ grupo: () => GRUPO, meusJids: () => MEUS, nomeBot: () => NOME_BOT, enfileirar: () => 0, enviar: async (jid, t) => enviadas.push({ jid, t }), limparMarca: async () => {}, agora: () => AGORA });
  r.aoConectar({ relogada: true, desdeMs: QUEDA });
  r.aoHistorico({ messages: [texto('2026-10-04T10:00:00Z', 'bora no vôlei?'), texto('2026-10-04T10:01:00Z', 'bora', { de: '554899999999@s.whatsapp.net' })] });
  const res = await r.concluir('teste');
  assert.equal(res.acao, 'silencio');
  assert.equal(res.vistasDoGrupo, 2);
  assert.equal(enviadas.length, 0);
});
