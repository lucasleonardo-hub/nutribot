// test/contexto-ia.test.mjs - Fase 7, frente B: o que a Nutri passa a saber (sono, energia, atividade, humor, eventos,
// perguntas do app, treinos com a carga do dia) e as guardas de privacidade em código (nada de humor, pergunta do app,
// oxigênio ou temperatura no texto que vai pro grupo). Só funções puras e dublês; nada de rede, Mongo ou IA.
import test from 'node:test';
import assert from 'node:assert/strict';

import { indicadoresRelogio, resumoSaude, sinaisDaNoite, notaDaNoite, energiaComFatores, atividadeDoDia, fatoresFracos } from '../saude.js';
import {
  blocoHumorDias,
  slotsSuspensos,
  eventoQueSuspende,
  ehEventoDeRefeicao,
  blocoEventosApp,
  recortePerguntas,
  formatarPerguntas,
  perguntasParaPrompt,
  perguntasRecentes,
  confidenciasDe,
  contemConfidencia,
  semConfidencias,
  assuntoConfidencial,
  protegerFerramentas,
  falasDaPessoa,
  blocoContextoApp,
  corpoCompacto,
  montarContextoApp,
  semCorpoSensivel,
  mencionaCorpoSensivel,
  anotacaoConfidencial,
  blocoAppConversa,
  puxouAssunto,
} from '../contexto-app.js';
import { contextoDaCobranca } from '../cobranca.js';
import { guardarPensamento, pensamentoParaGrupo } from '../pensamentos.js';
import { intervencaoVaza } from '../proatividade.js';
import { gerarSugestoesCarga, blocoTreinosDoDia, progressaoForca } from '../contexto.js';
import { treinosPorTitulo, sugerirCargaExercicio } from '../api-montadores.js';
import { exigeAdmin, ehAdmin, RESPOSTA_SO_ADMIN, remetenteEhAdmin, enviarPlanoNoGrupo } from '../comandos.js';
import { eventosComoAgenda } from '../perfis.js';
import { assinaturaNovidade } from '../pensamentos.js';
import { responderApp, sugerirRefeicao, definirLicoes } from '../gemini.js';

const HOJE = '2026-10-15';
const somar = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const RE_PRIVADO = /oxig[êe]nio|spo2|satura[çc][ãa]o|temperatura da pele|°C|humor|perguntou no app|pelo app (voc[êe] )?(me )?(perguntou|contou)/i;

// ---------- dados de relógio de mentira (pessoa fictícia) ----------
function noite(dia, { total = 420, profundo = 70, rem = 90, acordado = 25, inicio = '23:30', fim = '07:10', ...extra } = {}) {
  return { dia, inicio: `${somar(dia, -1)} ${inicio}`, fim: `${dia} ${fim}`, total, leve: total - profundo - rem, profundo, rem, acordado, sessoes: 1, ...extra };
}
function diaAtiv(dia, extra = {}) {
  return { dia, passos: 8000, calorias: 2400, treinos: [], fcRepouso: 58, ...extra };
}
function relogioDe({ spo2 = null, temperatura = null, sonoCurto = false, semNovos = false } = {}) {
  const sonos = [];
  const atividades = [];
  for (let i = 9; i >= 1; i--) {
    sonos.push(noite(somar(HOJE, -i)));
    atividades.push(diaAtiv(somar(HOJE, -i)));
  }
  const ultima = sonoCurto ? noite(HOJE, { total: 290, profundo: 30, rem: 40, acordado: 70, inicio: '01:40', fim: '06:50' }) : noite(HOJE);
  if (spo2) ultima.spo2 = spo2;
  if (temperatura) ultima.temperatura = temperatura;
  sonos.push(ultima);
  atividades.push(diaAtiv(HOJE, semNovos ? {} : { minAtivos: 34, distanciaM: 4800, kcalAtivas: 280, porHora: { passos: Array.from({ length: 24 }, (_, h) => (h === 18 ? 3000 : 100)), kcal: Array(24).fill(80) } }));
  return { pesos: [], sonos, atividades };
}

// ============================================================
// Relógio: a linha do grupo x o que é só da pessoa (D2, D12)
// ============================================================
test('indicadoresRelogio: a linha (vai pro grupo) traz nota do sono, energia e atividade, nunca oxigênio nem temperatura', () => {
  const d = relogioDe({ spo2: { media: 92, min: 85, minutosAbaixo90: 12 }, temperatura: { media: 34.2, delta: 0.8 } });
  const r = indicadoresRelogio(d, { hoje: HOJE });
  assert.match(r.linha, /nota do sono \d+/);
  assert.match(r.linha, /energia \d+\/100/);
  assert.match(r.linha, /34 min ativos, 4,8 km, 280 kcal ativas/);
  assert.match(r.linha, /mais ativa\(o\) das 18h às 19h/);
  assert.doesNotMatch(r.linha, RE_PRIVADO, 'oxigênio/temperatura não podem ir na linha do grupo');
  // fica num campo à parte, só da própria pessoa
  assert.match(r.linhaPropria, /oxigênio no sono: média 92 %, mínimo 85 %, 12 min abaixo de 90 %/);
  assert.match(r.linhaPropria, /\+0,8 °C acima da sua base/);
  assert.equal(r.sono.dia, HOJE);
  assert.equal(typeof r.energia.nota, 'number');
  assert.deepEqual({ min: r.atividade.minAtivos, km: r.atividade.distanciaKm, kcal: r.atividade.kcalAtivas }, { min: 34, km: 4.8, kcal: 280 });
});

test('indicadoresRelogio: envio antigo (sem os campos novos) não quebra e não inventa atividade nem linha própria', () => {
  const r = indicadoresRelogio(relogioDe({ semNovos: true }), { hoje: HOJE });
  assert.match(r.linha, /nota do sono/);
  assert.doesNotMatch(r.linha, /min ativos|km|kcal ativas/);
  assert.equal(r.atividade, undefined);
  assert.equal(r.linhaPropria, '');
});

test('sinaisDaNoite: só o que foge do normal vira assunto; ausência é tratada', () => {
  assert.equal(sinaisDaNoite(null).foraDoNormal, '');
  assert.equal(sinaisDaNoite({}).spo2, null);
  const normal = sinaisDaNoite({ spo2: { media: 96, min: 91, minutosAbaixo90: 0 }, temperatura: { media: 34, delta: 0.2 } });
  assert.equal(normal.spo2.fora, false);
  assert.equal(normal.temperatura.fora, false);
  assert.equal(normal.foraDoNormal, '');
  assert.equal(sinaisDaNoite({ spo2: { media: 95, min: 87 } }).spo2.fora, true, 'mínimo abaixo de 88 %');
  assert.equal(sinaisDaNoite({ spo2: { media: 95, min: 90, minutosAbaixo90: 6 } }).spo2.fora, true, '5+ min abaixo de 90 %');
  assert.equal(sinaisDaNoite({ temperatura: { delta: -0.6 } }).temperatura.fora, true);
  assert.match(sinaisDaNoite({ temperatura: { delta: -0.6 } }).temperatura.texto, /−0,6 °C abaixo/);
  assert.equal(sinaisDaNoite({ temperatura: { media: 34.5 } }).temperatura.fora, false, 'sem base não há como dizer que fugiu');
  assert.equal(sinaisDaNoite({ spo2: { media: 'x' } }).spo2, null);
});

test('resumoSaude (dossiê da própria pessoa) traz a nota da noite, oxigênio e temperatura com o aviso de dado sensível', () => {
  const t = resumoSaude(relogioDe({ spo2: { media: 96, min: 92, minutosAbaixo90: 0 }, temperatura: { delta: 0.7 } }), { hoje: HOJE });
  assert.match(t, /Última noite \(15\/10\): nota do sono \d+/);
  assert.match(t, /oxigênio no sono: média 96 %.*\(normal\)/);
  assert.match(t, /temperatura da pele.*\(fora do normal\)/);
  assert.match(t, /dado sensível/);
  assert.match(t, /Em 15\/10: 34 min ativos, 4,8 km/);
});

test('nota do sono, energia e fatores fracos são os mesmos do app (fonte única)', () => {
  const d = relogioDe({ sonoCurto: true });
  const n = notaDaNoite({ sonos: d.sonos, atividades: d.atividades, dia: HOJE });
  assert.ok(n.nota < 70, `noite curta tem nota baixa (${n.nota})`);
  assert.ok(n.fraco, 'aponta o ponto fraco');
  const e = energiaComFatores({ sonos: d.sonos, atividades: d.atividades, dia: HOJE });
  assert.equal(typeof e.nota, 'number');
  assert.deepEqual(fatoresFracos([{ nivel: 'bom' }, { nivel: 'atencao', nome: 'A' }, { nivel: 'razoavel', nome: 'B' }, { nivel: null }]).map((f) => f.nome), ['A', 'B']);
  assert.equal(atividadeDoDia(null), null);
  assert.equal(atividadeDoDia({ dia: HOJE, passos: 10 }), null);
});

// ============================================================
// Humor dos últimos dias
// ============================================================
const HUMORES = [
  { dia: somar(HOJE, -2), humor: 2, energia: 2, texto: 'semana pesada no trabalho' },
  { dia: somar(HOJE, -1), humor: 4 },
  { dia: HOJE, humor: 3, sono: 2, texto: 'acordei moída' },
  { dia: somar(HOJE, -20), humor: 1 },
];
test('blocoHumorDias: números da semana; o texto só em prompt particular (confidência)', () => {
  const publico = blocoHumorDias(HUMORES, { hoje: HOJE });
  assert.match(publico, /HUMOR PELO APP \(7 dias/);
  assert.match(publico, /ruim \(2\/5\), energia 2\/5; ontem: bom \(4\/5\); hoje: ok \(3\/5\), sono sentido 2\/5/);
  assert.doesNotMatch(publico, /semana pesada|moída/);
  assert.doesNotMatch(publico, /péssimo/, 'fora da janela de 7 dias');
  const particular = blocoHumorDias(HUMORES, { hoje: HOJE, confidencia: true });
  assert.match(particular, /Em confidência.*"semana pesada no trabalho".*hoje: "acordei moída"/s);
  assert.equal(blocoHumorDias([], { hoje: HOJE }), '');
});

// ============================================================
// Eventos do app e a cobrança
// ============================================================
test('slotsSuspensos: comer fora, festa e viagem tiram a refeição certa da cobrança', () => {
  const ev = (x) => ({ dia: HOJE, titulo: 'evento', ...x });
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora', hora: '20:00', titulo: 'Aniversário da prima' })], HOJE).keys()], ['jantar']);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora', hora: '12:30' })], HOJE).keys()], ['almoco']);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora', titulo: 'Almoço com a equipe' })], HOJE).keys()], ['almoco']);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'festa' })], HOJE).keys()], ['jantar']);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora' })], HOJE).keys()].sort(), ['almoco', 'jantar']);
  assert.equal(slotsSuspensos([ev({ tipo: 'viagem' })], HOJE).size, 6);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'outro', titulo: 'Rodízio de pizza', hora: '21:00' })], HOJE).keys()], ['jantar']);
  assert.equal(slotsSuspensos([ev({ tipo: 'treino', hora: '19:00' }), ev({ tipo: 'consulta', hora: '12:00' })], HOJE).size, 0);
  assert.equal(slotsSuspensos([{ ...ev({ tipo: 'comer_fora', hora: '20:00' }), dia: somar(HOJE, 1) }], HOJE).size, 0, 'evento de outro dia não suspende hoje');
  assert.equal(eventoQueSuspende([ev({ tipo: 'festa', hora: '21:00', titulo: 'Festa' })], HOJE, 'jantar').titulo, 'Festa');
  assert.equal(eventoQueSuspende([], HOJE, 'jantar'), null);
  assert.equal(ehEventoDeRefeicao({ tipo: 'outro', titulo: 'Reunião' }), false);
  // "café" com acento seguido de espaço ou do fim (o \b do JS só conhece ASCII)
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora', titulo: 'Café na padaria' })], HOJE).keys()], ['cafe']);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora', titulo: 'Padaria', nota: 'só o café' })], HOJE).keys()], ['cafe']);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora', titulo: 'Café da manhã do hotel' })], HOJE).keys()], ['cafe']);
  assert.deepEqual([...slotsSuspensos([ev({ tipo: 'comer_fora', titulo: 'Cafeteria nova' })], HOJE).keys()].sort(), ['almoco', 'jantar'], 'cafeteria não é o café da manhã');
});

test('blocoEventosApp publico (cobrança, plano: saem no grupo): só refeição fora, festa e viagem, sem a nota', () => {
  const eventos = [
    { dia: HOJE, hora: '15:00', titulo: 'Consulta', tipo: 'consulta', nota: 'psiquiatra, falar da ansiedade' },
    { dia: HOJE, hora: '20:00', titulo: 'Jantar fora', tipo: 'comer_fora', nota: 'com a ex' },
    { dia: HOJE, hora: '07:00', titulo: 'Treino', tipo: 'treino' },
  ];
  const t = blocoEventosApp(eventos, { hoje: HOJE, dias: 0, publico: true });
  assert.match(t, /Jantar fora \(refeição fora\)/);
  assert.doesNotMatch(t, /Consulta|psiquiatra|ansiedade|com a ex|Treino/);
  assert.match(blocoEventosApp(eventos, { hoje: HOJE, dias: 0 }), /psiquiatra/, 'na conversa da própria pessoa, completo');
  const cob = contextoDaCobranca({ perfil: { nome: 'Pessoa Teste' }, dia: HOJE, eventos });
  assert.doesNotMatch(cob, /Consulta|psiquiatra|ansiedade|com a ex/);
});

test('blocoEventosApp: diz a refeição que sai de casa e respeita a janela', () => {
  const t = blocoEventosApp(
    [
      { dia: HOJE, hora: '20:00', titulo: 'Jantar de aniversário', tipo: 'comer_fora', nota: 'pizzaria' },
      { dia: somar(HOJE, 1), titulo: 'Viagem', tipo: 'viagem' },
      { dia: somar(HOJE, 9), titulo: 'Longe', tipo: 'festa' },
    ],
    { hoje: HOJE, dias: 3 }
  );
  assert.match(t, /- hoje 20:00: Jantar de aniversário \(refeição fora\) — pizzaria \(jantar fora de casa: não cobre/);
  assert.match(t, /- amanhã: Viagem \(viagem\) \(viagem: sem cobrança/);
  assert.doesNotMatch(t, /Longe/);
});

test('contextoDaCobranca: eventos e corpo entram; humor só como tom, sem número nem texto (a cobrança sai no grupo)', () => {
  const perfil = { nome: 'Pessoa Teste', relogio: indicadoresRelogio(relogioDe({ spo2: { media: 90, min: 80, minutosAbaixo90: 20 } }), { hoje: HOJE }) };
  const t = contextoDaCobranca({ perfil, dia: HOJE, eventos: [{ dia: HOJE, hora: '12:30', titulo: 'Almoço com o time', tipo: 'comer_fora' }], humor: { humor: 1, texto: 'tô péssima com a família' } });
  assert.match(t, /Almoço com o time/);
  assert.match(t, /nota do sono \d+/);
  assert.match(t, /TOM:/);
  assert.doesNotMatch(t, /péssima|família|1\/5|oxig|temperatura/i);
  assert.doesNotMatch(contextoDaCobranca({ perfil, dia: HOJE, humor: { humor: 4 } }), /TOM:/);
});

// ============================================================
// Perguntas do app (D10)
// ============================================================
const AGORA = Date.parse(`${HOJE}T18:00:00Z`);
const P = (horasAtras, pergunta, extra = {}) => {
  const em = new Date(AGORA - horasAtras * 3600_000);
  return { em: em.toISOString(), dia: em.toISOString().slice(0, 10), pergunta, resposta: 'respondi com calma', tema: 'outro', ...extra };
};
const PERGUNTAS = [P(70, 'pergunta velha demais pra conversa'), P(30, 'posso comer pão francês à noite sem culpa?', { tema: 'comida' }), P(20, 'é normal sentir compulsão depois das dez da noite?', { tema: 'humor' }), P(5, 'quanto de proteína no pós treino de hoje?', { tema: 'treino' }), P(2, 'dormi mal, treino perna mesmo assim?', { tema: 'sono' })];

test('recortePerguntas: conversa = 3 últimas de 48 h; pensamentos = do dia; reflexão = semana (até 10)', () => {
  assert.deepEqual(recortePerguntas(PERGUNTAS, { modo: 'conversa', agoraMs: AGORA }).map((p) => p.pergunta.slice(0, 10)), ['é normal s', 'quanto de ', 'dormi mal,']);
  assert.equal(recortePerguntas(PERGUNTAS, { modo: 'pensamentos', agoraMs: AGORA, hoje: HOJE }).length, 2);
  assert.equal(recortePerguntas(PERGUNTAS, { modo: 'reflexao', agoraMs: AGORA }).length, 5);
  const r = formatarPerguntas(PERGUNTAS, { modo: 'reflexao', agoraMs: AGORA, hoje: HOJE });
  assert.match(r, /5 pergunta\(s\); temas: /);
  assert.match(formatarPerguntas(PERGUNTAS, { modo: 'conversa', agoraMs: AGORA, hoje: HOJE }), /NUNCA cite no grupo/);
  assert.equal(formatarPerguntas([], { modo: 'conversa' }), '');
});

test('perguntasParaPrompt usa o blocoPerguntasApp do perguntas.js quando existe e cai no daqui quando ele não devolve texto', () => {
  const chamadas = [];
  const modulo = { blocoPerguntasApp: (lista, { modo }) => (chamadas.push([lista.length, modo]), 'BLOCO DA FRENTE A') };
  assert.equal(perguntasParaPrompt(PERGUNTAS, { modo: 'conversa', agoraMs: AGORA, modulo }), 'BLOCO DA FRENTE A');
  assert.deepEqual(chamadas, [[3, 'conversa']], 'recebe já recortado');
  const vazio = { blocoPerguntasApp: () => '' };
  assert.match(perguntasParaPrompt(PERGUNTAS, { modo: 'conversa', agoraMs: AGORA, modulo: vazio }), /PERGUNTOU NO APP/);
  const quebra = { blocoPerguntasApp: () => { throw new Error('x'); } };
  assert.match(perguntasParaPrompt(PERGUNTAS, { modo: 'conversa', agoraMs: AGORA, modulo: quebra }), /PERGUNTOU NO APP/);
  const nomes = [];
  perguntasParaPrompt(PERGUNTAS, { modo: 'pensamentos', agoraMs: AGORA, hoje: HOJE, modulo: { blocoPerguntasApp: (_l, o) => (nomes.push(o.modo), 'x') } });
  assert.deepEqual(nomes, ['pensamento'], 'o modo do perguntas.js é "pensamento", no singular');
});

test('perguntasParaPrompt com o perguntas.js de verdade (frente A), quando ele existe', async (t) => {
  const real = await import('../perguntas.js').catch(() => null);
  if (typeof real?.blocoPerguntasApp !== 'function') return t.skip('perguntas.js ainda não existe');
  const conv = perguntasParaPrompt(PERGUNTAS, { modo: 'conversa', agoraMs: AGORA, hoje: HOJE, modulo: real });
  assert.match(conv, /CONFIDÊNCIA/);
  assert.doesNotMatch(conv, /pergunta velha demais/, 'só as 3 últimas de 48 h');
  assert.match(perguntasParaPrompt(PERGUNTAS, { modo: 'pensamentos', agoraMs: AGORA, hoje: HOJE, modulo: real }), /HOJE/);
  assert.match(perguntasParaPrompt(PERGUNTAS, { modo: 'reflexao', agoraMs: AGORA, hoje: HOJE, modulo: real }), /temas/);
});

test('perguntasRecentes: pelo perguntasDe(jid, { desde, n }); sem o módulo, lista vazia', async () => {
  const pedidos = [];
  const modulo = { perguntasDe: async (jid, o) => (pedidos.push([jid, o.n]), PERGUNTAS) };
  const l = await perguntasRecentes({ jids: ['p@teste'] }, { desde: new Date(AGORA - 48 * 3600_000), modulo });
  assert.deepEqual(pedidos, [['p@teste', 30]]);
  assert.equal(l.length, 4, 'refiltra pelo instante');
  assert.deepEqual(await perguntasRecentes({ jids: ['p@teste'] }, { modulo: null }), []);
  assert.deepEqual(await perguntasRecentes({}, { modulo }), []);
});

// ============================================================
// Guardas de confidência em código
// ============================================================
const CONF = confidenciasDe({ perguntas: PERGUNTAS, humores: HUMORES });
test('confidenciasDe junta perguntas, o começo das respostas e textos do humor', () => {
  assert.ok(CONF.includes('é normal sentir compulsão depois das dez da noite?'));
  assert.ok(CONF.includes('semana pesada no trabalho'));
  assert.ok(CONF.includes('respondi com calma'));
  assert.equal(CONF.length, 12);
  // o "respondi: ..." que vai pro prompt do grupo também é confidência (a pergunta pode ter outra redação)
  const conf = confidenciasDe({ perguntas: [{ pergunta: 'é normal sentir isso à noite?', resposta: 'Sobre a compulsão por doce depois das dez, um lanche com proteína às 16h ajuda.' }] });
  assert.equal(semConfidencias('Boa! Sobre a compulsão por doce depois das dez, segura firme. Janta leve.', conf).removidas.length, 1);
});

test('semConfidencias: frase que copia a pergunta do app ou diz que ela perguntou/contou no app sai; o resto fica', () => {
  const resposta = 'Arrasou no almoço, amiga! Sobre sentir compulsão depois das dez da noite, isso é comum. Como você me perguntou no app, vou repetir aqui.\nPra janta, capricha na proteína.';
  const r = semConfidencias(resposta, CONF);
  assert.equal(r.removidas.length, 2);
  assert.equal(r.texto, 'Arrasou no almoço, amiga!\nPra janta, capricha na proteína.');
  assert.doesNotMatch(r.texto, /compuls|no app/i);
  // nada a tirar: o texto volta igual
  const limpo = 'Boa! Arroz, feijão e frango fecham bem o dia.';
  assert.deepEqual(semConfidencias(limpo, CONF), { texto: limpo, removidas: [] });
  // palavras soltas em comum não contam como cópia
  assert.equal(contemConfidencia('pão francês é ótimo no café', CONF), false);
  assert.equal(contemConfidencia('Ela disse: semana pesada no trabalho, né', CONF), true, 'texto curto do humor copiado inteiro');
  assert.equal(semConfidencias('Pelo app você contou que tá cansada.', []).removidas.length, 1, 'a menção ao app sai mesmo sem lista');
});

test('assuntoConfidencial e protegerFerramentas: confidência não vira mensagem espontânea nem anotação/memória vetorial', async () => {
  assert.equal(assuntoConfidencial('compulsão noturna', CONF), false, 'uma palavra em comum não basta');
  assert.equal(assuntoConfidencial('compulsão depois das dez', ['compulsão depois das dez da noite']), true);
  assert.equal(assuntoConfidencial('treino de perna', CONF), true, 'veio da pergunta "dormi mal, treino perna mesmo assim?"');
  assert.equal(assuntoConfidencial('jantar de domingo', CONF), false);
  const chamadas = [];
  const base = { declaracoes: [], usadas: [], executar: async (nome, args) => (chamadas.push([nome, args.texto]), 'ok') };
  const f = protegerFerramentas(base, CONF);
  assert.match(await f.executar('anotar_memoria', { texto: 'Perguntou se é normal sentir compulsão depois das dez da noite' }), /não guardei/);
  assert.match(await f.executar('anotar_memoria', { texto: 'Me contou pelo app que anda cansada' }), /não guardei/);
  assert.equal(await f.executar('anotar_memoria', { texto: 'Não come peixe de jeito nenhum' }), 'ok');
  assert.equal(await f.executar('refeicoes', {}), 'ok');
  assert.deepEqual(chamadas.map((c) => c[0]), ['anotar_memoria', 'refeicoes']);
  assert.equal(f.usadas, base.usadas, 'o mesmo array de usadas');
  assert.equal(protegerFerramentas(null, CONF), null);
});

test('protegerFerramentas: paráfrase da confidência e oxigênio/temperatura não viram anotação nem memória vetorial', async () => {
  const chamadas = [];
  const base = { declaracoes: [], usadas: [], executar: async (nome, args) => (chamadas.push([nome, args.texto]), 'ok') };
  const conf = confidenciasDe({ perguntas: [{ pergunta: 'estou dormindo mal, isso atrapalha emagrecer?' }] });
  const f = protegerFerramentas(base, conf);
  assert.match(await f.executar('anotar_memoria', { texto: 'Anda preocupada que o sono ruim atrapalha emagrecer' }), /não guardei/, 'paráfrase');
  assert.match(await f.executar('anotar_memoria', { texto: 'Oxigênio no sono costuma cair abaixo de 90%' }), /não guardei/);
  assert.equal(await f.executar('anotar_memoria', { texto: 'Não come peixe de jeito nenhum' }), 'ok');
  // sem confidência nenhuma, a guarda do oxigênio e da temperatura continua
  const semConf = protegerFerramentas(base, []);
  assert.match(await semConf.executar('anotar_memoria', { texto: 'A temperatura da pele subiu 1 grau nas últimas noites' }), /não guardei/);
  assert.equal(await semConf.executar('anotar_memoria', { texto: 'Treina perna às quintas' }), 'ok');
  assert.deepEqual(chamadas.map((c) => c[1]), ['Não come peixe de jeito nenhum', 'Treina perna às quintas']);
});

test('blocoAppConversa (vai pro prompt do GRUPO): texto do humor e pergunta do app só quando a mensagem puxa o assunto (D10)', () => {
  const humores = [{ dia: HOJE, humor: 2, energia: 2, texto: 'tô ansiosa com a prova de amanhã' }, { dia: somar(HOJE, -1), humor: 4, texto: 'dia ótimo' }];
  const perguntas = [P(5, 'é normal sentir compulsão por doce depois das dez?')];
  const formatarHoje = (h) => `HOJE humor ${h.humor}${h.texto ? ` CONFIDÊNCIA "${h.texto}"` : ''}`;
  const montar = (textoAtual) => blocoAppConversa({ formatarHoje, humores, perguntas, dia: HOJE, agoraMs: AGORA, textoAtual });
  const papo = montar('jantei pizza de calabresa');
  assert.match(papo, /HOJE humor 2/, 'o humor de hoje vai em número (tom)');
  assert.doesNotMatch(papo, /ansiosa|prova|compuls|dia ótimo/);
  const ansiedade = montar('tô com uma ansiedade danada hoje');
  assert.match(ansiedade, /CONFIDÊNCIA "tô ansiosa com a prova de amanhã"/);
  assert.doesNotMatch(ansiedade, /compuls/, 'só a confidência que ela puxou');
  assert.match(montar('bateu uma compulsão por doce agora'), /compulsão por doce/);
  assert.match(blocoAppConversa({ formatarHoje, humores, perguntas, dia: HOJE, agoraMs: AGORA }), /ansiosa[\s\S]*compuls/, 'sem a mensagem (null), como antes');
  assert.equal(puxouAssunto('oi', 'tô ansiosa'), false);
  assert.equal(puxouAssunto(null, 'qualquer'), true);
});

test('semCorpoSensivel e mencionaCorpoSensivel: oxigênio e temperatura da pele saem do texto republicado (D12)', () => {
  const t = 'Dormiu pouco de novo. A noite teve oxigênio caindo para 88%, quero ver se pesa no treino. Amanhã confiro o almoço.';
  const r = semCorpoSensivel(t);
  assert.equal(r.removidas.length, 1);
  assert.equal(r.texto, 'Dormiu pouco de novo. Amanhã confiro o almoço.');
  assert.equal(mencionaCorpoSensivel('saturação baixa essa noite'), true);
  assert.equal(mencionaCorpoSensivel('temperatura da pele +0,8 °C'), true);
  assert.equal(mencionaCorpoSensivel('a temperatura hoje em Floripa é 28 graus'), false, 'clima não é dado do corpo');
  assert.equal(anotacaoConfidencial('Gosta de café sem açúcar', []), false);
});

test('pensamento: oxigênio e confidência não chegam ao grupo pelo !pensamentos nem pela mensagem espontânea', () => {
  const conf = confidenciasDe({ perguntas: [{ pergunta: 'estou dormindo mal, isso atrapalha emagrecer?' }], humores: [{ texto: 'tô ansiosa com a prova' }] });
  // 1) oxigênio sai do texto; o resto fica e pode falar
  const a = guardarPensamento({ pensamento: 'Bateu a proteína do almoço. A noite teve oxigênio caindo para 88%, quero ver se pesa no treino.', notar: ['saturação baixa na terça', 'almoça às 13h'], vale_falar: true, assunto: 'proteína no jantar' }, { confidencias: conf });
  assert.equal(a.texto, 'Bateu a proteína do almoço.');
  assert.deepEqual(a.notar, ['almoça às 13h']);
  assert.equal(a.privado, false);
  assert.equal(a.valeFalar, true);
  // 2) paráfrase da confidência: fica privado, não vira mensagem e não aparece no !pensamentos
  const b = guardarPensamento({ pensamento: 'Ela anda dormindo mal e acha que isso atrapalha emagrecer; quero olhar o jantar.', vale_falar: true, assunto: 'jantar mais cedo' }, { confidencias: conf });
  assert.equal(b.privado, true);
  assert.equal(b.valeFalar, false);
  const zap = pensamentoParaGrupo({ texto: b.texto, privado: b.privado });
  assert.doesNotMatch(zap, /dormindo|emagrecer|app/i);
  assert.match(pensamentoParaGrupo({ texto: a.texto, notar: a.notar, privado: false }), /proteína do almoço[\s\S]*Anotei: almoça às 13h/);
  assert.doesNotMatch(pensamentoParaGrupo({ texto: 'Oxigênio da noite em 88%. Bom almoço.', privado: false }), /oxig/i, 'pensamento antigo com oxigênio também é filtrado');
  // 3) a saída da mensagem espontânea é conferida antes de ir pro grupo
  assert.equal(intervencaoVaza('Bia, teu oxigênio caiu essa noite, pega leve no supino.', conf), true);
  assert.equal(intervencaoVaza('Bia, tô ansiosa com a prova também! Bora jantar cedo?', conf), true);
  assert.equal(intervencaoVaza('Bia, pelo app você contou que tá cansada.', []), true);
  assert.equal(intervencaoVaza('Bia, bora caprichar na proteína do jantar?', conf), false);
});

test('privacidade: o que vai pro grupo (linha do relógio, cobrança, treinos, plano) não carrega humor, pergunta do app, oxigênio nem temperatura', () => {
  const relogio = indicadoresRelogio(relogioDe({ spo2: { media: 89, min: 80, minutosAbaixo90: 30 }, temperatura: { delta: 1.1 } }), { hoje: HOJE });
  const perfil = { nome: 'Pessoa Teste', relogio };
  const textosDoGrupo = [
    relogio.linha, // bloco PERFIS DO GRUPO, resumos, fala programada
    contextoDaCobranca({ perfil, dia: HOJE, eventos: [], humor: HUMORES[2] }),
    corpoCompacto(relogio), // sem propria
    blocoTreinosDoDia(treinosPorTitulo({ sessoes: SESSOES, dia: HOJE, contexto: {} }), { dia: HOJE }),
  ];
  for (const t of textosDoGrupo) {
    assert.doesNotMatch(t, RE_PRIVADO, `vazou: ${t.slice(0, 120)}`);
    for (const c of CONF) assert.equal(contemConfidencia(t, [c]), false);
  }
  // e o contexto da própria pessoa leva o que é dela
  assert.match(corpoCompacto(relogio, { propria: true }), /oxigênio no sono.*dado sensível/);
});

// ============================================================
// Treinos com a carga do dia (D18: fonte única)
// ============================================================
const sessao = (dia, kgSupino, repsSupino, extra = {}) => ({
  inicio: `${dia}T10:00:00Z`,
  fim: `${dia}T11:00:00Z`,
  titulo: 'Peito e tríceps',
  exercicios: [
    { title: 'Supino Reto (Barra)', sets: [{ type: 'normal', weight_kg: kgSupino, reps: repsSupino }] },
    { title: 'Tríceps na Polia', sets: [{ type: 'normal', weight_kg: 30, reps: 12 }] },
  ],
  ...extra,
});
// quinta-feira (15/10/2026) é dia do treino nas últimas semanas
const SESSOES = [sessao('2026-09-17', 50, 8), sessao('2026-09-24', 50, 8), sessao('2026-10-01', 50, 9), sessao('2026-10-08', 50, 10)];

test('blocoTreinosDoDia: carga de hoje por título, a mesma conta do app; marca o treino de hoje', () => {
  const caixas = treinosPorTitulo({ sessoes: SESSOES, dia: HOJE, contexto: {} });
  const t = blocoTreinosDoDia(caixas, { dia: HOJE, nome: 'Pessoa' });
  assert.match(t, /TREINOS DE PESSOA PELO TÍTULO/);
  assert.match(t, /Peito e tríceps \(Qui; É HOJE\)/);
  assert.match(t, /Supino Reto \(Barra\): pegou 50 kg × 10 → hoje sobe pra 52,5 kg × 8/);
  assert.equal(blocoTreinosDoDia([], { dia: HOJE }), '');
});

test('sono ruim muda a sugestão de treino: com a noite curta, a carga de hoje é manter', () => {
  const d = relogioDe({ sonoCurto: true });
  const sonoMin = d.sonos[d.sonos.length - 1].total;
  const caixas = treinosPorTitulo({ sessoes: SESSOES, dia: HOJE, contexto: { sonoMin, energia: 40 } });
  const t = blocoTreinosDoDia(caixas, { dia: HOJE, contexto: { texto: 'Dormiu 4h50. Hoje é dia de segurar a carga e caprichar nas repetições.' } });
  assert.match(t, /Supino Reto \(Barra\): pegou 50 kg × 10 → hoje mantém 50 kg × 10/);
  assert.match(t, /segurar a carga/);
});

test('gerarSugestoesCarga (meta da semana) sai da mesma conta do dia quando há histórico', () => {
  const prog = progressaoForca([sessao('2026-09-03', 50, 12), sessao('2026-09-10', 50, 12), sessao('2026-09-17', 50, 12), sessao('2026-09-24', 50, 12)], { dia: '2026-09-27' });
  const parado = prog.parados.find((e) => e.title === 'Supino Reto (Barra)');
  assert.ok(parado?.historico?.length >= 3, 'progressaoForca devolve o histórico');
  const [meta] = gerarSugestoesCarga([parado], { dia: '2026-09-27', max: 1 });
  const doDia = sugerirCargaExercicio({ nome: parado.title, historico: parado.historico, contexto: {} });
  assert.equal(doDia.acao, 'subir');
  assert.equal(meta.paraKg, doDia.sugeridoKg, 'a meta da semana é a carga sugerida do dia');
  assert.equal(meta.origem, 'dia');
  // "repetir" (subiu na última): a meta é firmar com mais repetições, com a próxima carga como alternativa
  const subiu = { title: 'Remada', melhor: 40, reps: 6, semanasParado: 2, historico: [{ dia: '2026-09-10', kg: 37.5, reps: 8 }, { dia: '2026-09-17', kg: 40, reps: 6 }] };
  const [m2] = gerarSugestoesCarga([subiu], { dia: '2026-09-27' });
  assert.equal(m2.paraReps, 7);
  assert.equal(m2.paraKg, 42.5);
});

// ============================================================
// Trava do admin (D19)
// ============================================================
test('exigeAdmin/ehAdmin: destrutivos e de configuração só com o ADMIN_JID; !nome sozinho é livre', () => {
  for (const c of ['!reset', '!resumo', '!estudar', '!voz', '!silencio', '!falar']) assert.equal(exigeAdmin(c), true, c);
  assert.equal(exigeAdmin('!nome', ''), false);
  assert.equal(exigeAdmin('!nome', ' Dona Teste'), true);
  for (const c of ['!hoje', '!plano', '!perfil', '!despensa', '!ajuda']) assert.equal(exigeAdmin(c), false, c);
  assert.equal(ehAdmin(['adm@s.whatsapp.net', 'x@lid'], 'adm@s.whatsapp.net'), true);
  assert.equal(ehAdmin(['outra@s.whatsapp.net'], 'adm@s.whatsapp.net'), false);
  assert.equal(ehAdmin(['adm@s.whatsapp.net'], ''), false, 'sem ADMIN_JID ninguém é admin');
  assert.doesNotMatch(RESPOSTA_SO_ADMIN, /\*|[\u{1F300}-\u{1FAFF}]/u);
});

test('remetenteEhAdmin: mensagem só com o LID (retomada, grupo sem participant_pn) acha o admin pelo cadastro', async () => {
  const ADM = 'adm@s.whatsapp.net';
  const cadastro = { jids: [ADM, 'adm123@lid'] };
  const buscas = [];
  const buscar = async (jids) => (buscas.push(jids), jids.includes('adm123@lid') ? cadastro : null);
  assert.equal(await remetenteEhAdmin(['adm123@lid'], { buscar, adminJid: ADM }), true);
  assert.equal(await remetenteEhAdmin([ADM], { buscar, adminJid: ADM }), true);
  assert.equal(buscas.length, 1, 'com o número na chave nem busca o cadastro');
  assert.equal(await remetenteEhAdmin(['outra@lid'], { buscar, adminJid: ADM }), false);
  assert.equal(await remetenteEhAdmin(['adm123@lid'], { buscar: async () => { throw new Error('sem Mongo'); }, adminJid: ADM }), false);
  assert.equal(await remetenteEhAdmin(['adm123@lid'], { buscar, adminJid: '' }), false, 'sem ADMIN_JID ninguém é admin');
});

test('plano (D13): o envio no grupo devolve se saiu; falha de envio não vira "plano enviado"', async () => {
  const enviados = [];
  const ok = async (jid, texto) => enviados.push([jid, texto]);
  assert.equal(await enviarPlanoNoGrupo('PLANO', { jidGrupo: 'g@g.us', enviarFn: ok }), true);
  assert.deepEqual(enviados, [['g@g.us', 'PLANO']]);
  assert.equal(await enviarPlanoNoGrupo('PLANO', { jidGrupo: 'g@g.us', enviarFn: async () => { throw new Error('Connection Closed'); } }), false);
  assert.equal(await enviarPlanoNoGrupo('PLANO', { jidGrupo: null, enviarFn: ok }), false, 'sem grupo ligado');
  assert.equal(enviados.length, 1);
});

// ============================================================
// Roteiro, assinatura do pensamento
// ============================================================
test('eventosComoAgenda: só os de hoje com hora, no fuso da pessoa', () => {
  const l = eventosComoAgenda([{ dia: HOJE, hora: '20:00', titulo: 'Jantar fora', tipo: 'comer_fora' }, { dia: HOJE, titulo: 'Sem hora', tipo: 'festa' }, { dia: somar(HOJE, 1), hora: '12:00', titulo: 'Amanhã', tipo: 'outro' }], { dia: HOJE, fuso: 'America/Sao_Paulo' });
  assert.equal(l.length, 1);
  assert.equal(l[0].inicio, `${HOJE}T23:00:00.000Z`);
  assert.equal(l[0].fim, `${somar(HOJE, 1)}T00:30:00.000Z`);
  assert.match(l[0].tipo, /app refeição fora/);
});

test('assinaturaNovidade: igual à de antes sem app; muda quando chega coisa do app', () => {
  const base = { refeicoes: 2, visitas: 1, notas: 0, atividades: 0, passos: 4000, hora: '11:30' };
  assert.equal(assinaturaNovidade(base), 'r2v1n0a0p2h1');
  assert.notEqual(assinaturaNovidade({ ...base, app: 2 }), assinaturaNovidade(base));
});

// ============================================================
// Contexto único do app (sugerirRefeicao e responderApp)
// ============================================================
test('falasDaPessoa: só o que a própria pessoa disse, sem bot e sem os outros', () => {
  const msgs = [
    { hora: '08:00', nome: 'Pessoa Teste', texto: 'tô sem fome nenhuma hoje', tipo: 'texto' },
    { hora: '08:01', nome: 'Nutri', texto: 'resposta da bot', tipo: 'bot' },
    { hora: '09:00', nome: 'Outra Pessoa', texto: 'almocei cedo', tipo: 'texto' },
    { hora: '10:00', nome: 'Pessoa Teste', texto: '📷 [foto] café', tipo: 'foto' },
  ];
  assert.deepEqual(falasDaPessoa(msgs, 'Pessoa Teste'), ['[08:00] tô sem fome nenhuma hoje', '[10:00] 📷 [foto] café']);
});

test('montarContextoApp: devolve o mesmo do contextoSugestao e o bloco com fatos, falas do dia, humor, eventos, corpo e treino de hoje', async () => {
  const relogio = indicadoresRelogio(relogioDe({ spo2: { media: 90, min: 84, minutosAbaixo90: 15 } }), { hoje: HOJE });
  const perfil = { nome: 'Pessoa Teste', jids: ['p@teste'], anotacoes: [{ texto: 'não come peixe' }], reflexao: { sintese: 'funciona melhor com rotina' }, pensamento: { dia: HOJE, hora: '11:30', texto: 'almoçou tarde de novo' }, relogio };
  const caixas = treinosPorTitulo({ sessoes: SESSOES, dia: HOJE, contexto: {} });
  const fontes = {
    humores: async () => HUMORES,
    eventos: async () => [{ dia: HOJE, hora: '20:00', titulo: 'Jantar fora', tipo: 'comer_fora' }],
    despensa: async () => 'DESPENSA: ovos',
    agenda: async () => '',
    ondeEsta: async () => 'Agora ela(e) está em casa.',
    treino: async () => ({ caixas, contexto: { texto: 'Dá para subir a carga hoje.' } }),
    fixas: async () => { throw new Error('sem atividades'); },
    estado: async () => ({ persona: 'PERSONA', memoria: { dia: HOJE, mensagens: [{ hora: '08:00', nome: 'Pessoa Teste', texto: 'tô sem fome nenhuma', tipo: 'texto' }, { hora: '08:05', nome: 'Outra Pessoa', texto: 'segredo da outra', tipo: 'texto' }] } }),
  };
  const c = await montarContextoApp(perfil, { hoje: HOJE, fontes });
  assert.equal(c.humor.dia, HOJE);
  assert.equal(c.eventos.length, 1);
  assert.equal(c.despensa, 'DESPENSA: ovos');
  assert.equal(c.lugares, 'Agora ela(e) está em casa.');
  assert.equal(c.persona, 'PERSONA');
  assert.match(c.bloco, /FATOS QUE VOCÊ GUARDOU.*não come peixe/);
  assert.match(c.bloco, /funciona melhor com rotina/);
  assert.match(c.bloco, /almoçou tarde de novo/);
  assert.match(c.bloco, /\[08:00\] tô sem fome nenhuma/);
  assert.doesNotMatch(c.bloco, /segredo da outra/, 'só as falas da própria pessoa');
  assert.match(c.bloco, /"acordei moída"/, 'no app (particular) o texto do humor entra');
  assert.match(c.bloco, /Jantar fora/);
  assert.match(c.bloco, /oxigênio no sono/, 'no app da própria pessoa o oxigênio fora do normal entra');
  assert.match(c.bloco, /Peito e tríceps.*É HOJE/);
  assert.ok(c.confidencias.includes('acordei moída'));
  // tudo falhando: não derruba, devolve vazio
  const nada = await montarContextoApp({ nome: 'X' }, { hoje: HOJE, fontes: Object.fromEntries(Object.keys(fontes).map((k) => [k, async () => { throw new Error('fora'); }])) });
  assert.deepEqual({ bloco: nada.bloco, despensa: nada.despensa, eventos: nada.eventos }, { bloco: '', despensa: '', eventos: [] });
  assert.equal(blocoContextoApp({}), '');
});

test('responderApp e sugerirRefeicao: lições, fatos guardados e o contexto do app entram no prompt (a mesma cabeça do WhatsApp)', async () => {
  definirLicoes(['não somar o pão duas vezes']);
  try {
    let prompt = '';
    const _gerar = async ({ contents }) => {
      prompt = contents[0].parts[0].text;
      return 'resposta';
    };
    const perfil = { nome: 'Pessoa Teste', objetivo: 'emagrecer', anotacoes: [{ texto: 'não come peixe' }] };
    await responderApp({ perfil, pergunta: 'o que eu janto?', dia: HOJE, contextoApp: 'HOJE NO GRUPO DO WHATSAPP PESSOA DISSE:\n[08:00] tô sem fome', _gerar });
    assert.match(prompt, /MINHAS LIÇÕES[\s\S]*não somar o pão duas vezes/);
    assert.match(prompt, /FATOS QUE VOCÊ GUARDOU SOBRE A PESSOA.*não come peixe/);
    assert.match(prompt, /tô sem fome/);
    const json = JSON.stringify({ opcoes: [{ nome: 'Omelete', porque: 'proteína', kcal: 400, proteina_g: 30, onde: 'casa' }] });
    await sugerirRefeicao({ perfil, slot: 'jantar', nomeSlot: 'jantar', dia: HOJE, _gerar: async ({ contents }) => ((prompt = contents[0].parts[0].text), json) });
    assert.match(prompt, /não somar o pão/);
    assert.match(prompt, /não come peixe/);
  } finally {
    definirLicoes([]);
  }
});
