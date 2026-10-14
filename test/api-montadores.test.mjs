// Montadores puros da API v1 do app (api-montadores.js) com dados fixos e fictícios. O ponto principal: os números do app
// são os mesmos do !hoje e do !progresso para os mesmos dados (a mesma análise, as mesmas janelas), e nada de localização
// ou de jid sai na resposta.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const M = await import('../api-montadores.js');
const { progressoDe } = await import('../acompanhamento.js');
const { calcularVisao, sequenciaDe } = await import('../resumo.js');
const { pesagensPorDia, somarDias } = await import('../progresso.js');
const { energiaDoDia } = await import('../saude.js');
const { diasAnteriores } = await import('../util.js');

const DIA = '2030-03-29';
const JID = 'pessoa-a@s.whatsapp.net';
const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

// ---------- fábrica de dados fictícios ----------
function gastos28() {
  const g = {};
  for (let i = 1; i <= 28; i++) g[somarDias(DIA, -i)] = 2600 + (i % 3) * 40;
  return g;
}
function perfilBase(extra = {}) {
  return {
    _id: { toString: () => ID },
    nome: 'Pessoa A Teste',
    apelido: 'Pê',
    jids: [JID, 'pessoa-a@lid'],
    fuso: 'America/Sao_Paulo',
    objetivo: 'Hipertrofia: ganhar massa',
    metaPeso: 80,
    metaPrazo: '2030-07-15',
    metaModo: 'etapa',
    ritmo: 'maximo',
    peso: 75,
    altura: 178,
    relogio: { linha: 'relógio de teste', gastos: gastos28(), pesoEm: DIA },
    atualizacoes: { peso: DIA, objetivo: '2030-01-10' },
    pensamento: { dia: DIA, hora: '11:30', texto: 'Ela tem caprichado no almoço. Ontem passou um tempão no bairro Ômega.', notar: [] },
    lugares: [
      { id: 'l1', papel: 'casa', tipo: 'casa', nome: null, bairro: 'Alfaville', cidade: 'Cidade Zeta' },
      { id: 'l2', tipo: 'academia', nome: 'Academia Beta', bairro: 'Deltópolis', cidade: 'Cidade Zeta' },
    ],
    ...extra,
  };
}
/** 34 dias fechados com café, almoço e jantar; hoje só o café (foto, incerteza alta). */
function refeicoes() {
  const out = [];
  let n = 0;
  const reg = (dia, slot, horaLocal, kcal, p, extra = {}) => {
    const [h, m] = horaLocal.split(':').map(Number);
    out.push({ _id: `r${++n}`, jid: JID, nome: 'Pessoa A Teste', dia, hora: horaLocal, horaLocal, minutos: h * 60 + m, slot, resumo: 'comida', descricao: `${slot} do dia`, estimativa: { kcal, p, c: Math.round(kcal / 8), g: Math.round(kcal / 30) }, ...extra });
  };
  for (let i = 34; i >= 1; i--) {
    const d = somarDias(DIA, -i);
    reg(d, 'cafe', '08:00', 600 + (i % 4) * 20, 30);
    reg(d, 'almoco', '12:30', 1200, 60);
    reg(d, 'jantar', '20:00', 1000 + (i % 5) * 30, 50);
  }
  reg(DIA, 'cafe', '08:10', 600, 32, { resumo: '[foto]', incerteza: 'alta', descricao: '2 ovos mexidos, pão francês e café com leite' });
  return out;
}
/** 120 dias de pesagens do relógio (manhã), subindo ~0,3 kg/semana, com gordura; um dia com digitada discordante e uma libra. */
function pesagensBrutas() {
  const raw = [];
  for (let i = 119; i >= 0; i--) {
    const d = somarDias(DIA, -i);
    const t = 119 - i;
    const peso = Math.round((72 + (0.3 * t) / 7 + 0.25 * Math.sin(t * 2.1)) * 10) / 10;
    raw.push({ jid: JID, dia: d, peso, gordura: Math.round((18 + 0.1 * Math.sin(t)) * 10) / 10, fonte: 'relogio', hora: '07:10' });
  }
  // dia com a digitada 1,5 kg acima da balança: a consolidação deixa ela de fora
  raw.push({ jid: JID, dia: somarDias(DIA, -3), peso: raw.find((x) => x.dia === somarDias(DIA, -3)).peso + 1.5, fonte: 'digitada' });
  // libra no meio dos quilos (o validarPesagens descarta)
  const libra = raw.find((x) => x.dia === somarDias(DIA, -10));
  libra.peso = Math.round(libra.peso * 2.2046 * 10) / 10;
  return raw;
}
const pesagens = () => pesagensPorDia(pesagensBrutas()); // como mongo.pesagensDesde devolve: uma por dia, consolidada
function saude() {
  const atividades = [];
  for (let i = 13; i >= 0; i--) {
    const d = somarDias(DIA, -i);
    atividades.push({ dia: d, passos: 7000, calorias: 2600, fcRepouso: 58, treinos: i === 1 ? [{ nome: 'Musculação', min: 70, hora: '18:00', fonte: 'hevy' }] : [] });
  }
  return { _id: JID, sonos: [{ dia: somarDias(DIA, -1), total: 420 }, { dia: DIA, total: 455, inicio: '2030-03-28 23:30', fim: '2030-03-29 07:05' }], atividades, ultimoEnvio: new Date('2030-03-29T16:40:00Z'), app: 'relogio 1.6' };
}
const janela31 = (lista) => lista.filter((x) => x.dia >= diasAnteriores(DIA, 31)[0] && x.dia <= DIA);
/** JSON puro: sem Map, sem Date, sem undefined (o que o app recebe é o que o objeto é) */
const ida = (x) => JSON.parse(JSON.stringify(x));

// ---------- perfil ----------
test('perfil: só os campos do contrato, id string, sem jids; ehDono pelo ADMIN_JID; semApelido = apelido null', () => {
  const p = M.montarPerfil(perfilBase(), { temHevy: true, adminJid: JID });
  assert.deepEqual(Object.keys(p).sort(), ['apelido', 'ehDono', 'fuso', 'id', 'metaPeso', 'metaPrazo', 'nome', 'objetivo', 'primeiroNome', 'temHevy', 'temRelogio', 'altura', 'ritmo'].sort());
  assert.deepEqual(p, { id: ID, nome: 'Pessoa A Teste', primeiroNome: 'Pessoa', apelido: 'Pê', fuso: 'America/Sao_Paulo', objetivo: 'Hipertrofia: ganhar massa', metaPeso: 80, metaPrazo: '2030-07-15', temRelogio: true, temHevy: true, ehDono: true, altura: 178, ritmo: 'maximo' });
  const outro = M.montarPerfil({ _id: 'b', nome: 'Pessoa B', jids: ['b@x'], semApelido: true, apelido: 'Bê', fuso: 'Fuso/Inexistente', altura: '172.6', ritmo: 'médio' }, { adminJid: JID });
  assert.equal(outro.apelido, null);
  assert.deepEqual([outro.altura, outro.ritmo], [173, null]); // ritmo só sem acento (como aplicarAtualizacao grava)
  assert.equal(M.montarPerfil({ _id: 'c', nome: 'C', ritmo: 'maximo' }).ritmo, 'maximo');
  assert.equal(outro.ehDono, false);
  assert.equal(outro.temRelogio, false);
  assert.equal(outro.metaPeso, null);
  assert.equal(outro.fuso, 'America/Sao_Paulo'); // fuso inválido cai no do grupo (util.fusoDe)
  assert.equal(JSON.stringify(p).includes('@'), false);
});

// ---------- refeição ----------
test('refeição: id, hora local, faixa pela incerteza, macros, origem e itens da descrição', () => {
  const r = M.montarRefeicao({ _id: { toString: () => '65f0c0ffee' }, slot: 'almoco', hora: '15:27', horaLocal: '12:31', resumo: '[3 fotos]', descricao: 'arroz, feijão, 150 g de frango grelhado e salada', estimativa: { kcal: 812.4, p: 52.2, c: 90, g: 21 }, incerteza: 'media' });
  const item = (nome) => ({ nome, gramas: null, kcal: null, p: null, c: null, g: null });
  assert.deepEqual(r, {
    id: '65f0c0ffee',
    dia: null,
    slot: 'almoco',
    nome: 'Almoço',
    hora: '12:31',
    kcal: 812,
    faixa: { min: 610, max: 1020 },
    p: 52,
    c: 90,
    g: 21,
    descricao: 'arroz, feijão, 150 g de frango grelhado e salada',
    origem: 'foto',
    incerteza: 'media',
    itens: [item('arroz'), item('feijão'), item('150 g de frango grelhado'), item('salada')],
    miniatura: null,
    foto: null,
  });
  // fase 3: a foto no Drive sai só como link
  assert.deepEqual(M.montarRefeicao({ _id: 'f', foto: { driveId: 'abc 123', nome: 'x.jpg' } }).foto, { url: 'https://drive.google.com/file/d/abc%20123/view' });
  const semEst = M.montarRefeicao({ _id: 'x', slot: 'lanche', hora: '16:00', resumo: 'um pão de queijo', manual: true });
  assert.equal(semEst.kcal, null);
  assert.equal(semEst.faixa, null);
  assert.equal(semEst.p, null);
  assert.equal(semEst.origem, 'manual');
  assert.equal(semEst.hora, '16:00'); // sem horaLocal (registro antigo), a hora do grupo
  assert.deepEqual(semEst.itens, [{ nome: 'um pão de queijo', gramas: null, kcal: null, p: null, c: null, g: null }]);
  assert.equal(M.montarRefeicao({ _id: 'y', slot: 'jantar', resumo: '[áudio]', descricao: 'sopa' }).origem, 'audio');
  assert.equal(M.montarRefeicao({ _id: 'z', slot: 'jantar', resumo: 'janta', descricao: 'sopa' }).origem, 'texto');
});

test('faixa da refeição: alta ±40%, média ±25%, baixa ±15%, sem incerteza ±25%; sem kcal = null', () => {
  assert.deepEqual(M.faixaDaRefeicao(500, 'alta'), { min: 300, max: 700 });
  assert.deepEqual(M.faixaDaRefeicao(500, 'média'), { min: 380, max: 630 });
  assert.deepEqual(M.faixaDaRefeicao(500, 'baixa'), { min: 430, max: 580 });
  assert.deepEqual(M.faixaDaRefeicao(500), { min: 380, max: 630 });
  assert.equal(M.faixaDaRefeicao(0), null);
  assert.equal(M.faixaDaRefeicao(null), null);
});

test('itens: complemento fundido "A (+ B) (+ C)" vira itens; parêntese de quantidade fica; foto pura não tem item', () => {
  assert.deepEqual(M.itensDaRefeicao('pão com ovo (+ café com leite) (+ banana)').map((i) => i.nome), ['pão com ovo', 'café com leite', 'banana']);
  assert.deepEqual(M.itensDaRefeicao('frango (150 g); arroz + feijão').map((i) => i.nome), ['frango (150 g)', 'arroz', 'feijão']);
  assert.deepEqual(M.itensDaRefeicao('iogurte (+ granola e mel').map((i) => i.nome), ['iogurte', 'granola', 'mel']);
  assert.deepEqual(M.itensDaRefeicao('[foto]'), []);
  assert.deepEqual(M.itensDaRefeicao(''), []);
});

// ---------- hoje ----------
test('hoje: os números batem com o !progresso e a visão do !hoje (mesmos dados, mesmas janelas)', async () => {
  const perfil = perfilBase();
  const refs = refeicoes();
  const pes = pesagens();
  const s = saude();
  const h = M.montarHoje({ perfil, dia: DIA, hoje: DIA, horaAgora: '13:50', refeicoes: refs, pesagens: pes, saude: s, treinos: [], termosLocal: M.termosDeLugar([perfil]) });
  assert.deepEqual(Object.keys(h), ['dia', 'fuso', 'agora', 'kcal', 'macros', 'refeicoes', 'pendentes', 'peso', 'relogio', 'energia', 'avisos', 'brotinho', 'resumoSemana', 'humor', 'eventos']);
  assert.deepEqual(ida(h), h, 'só JSON puro');

  // a mesma análise que o !progresso e o !hoje montam (acompanhamento.progressoDe com os dados de 31 dias)
  const a = await progressoDe(perfil, DIA, { refeicoes: janela31(refs), pesagens: janela31(pes) });
  assert.ok(a.metaKcal, 'o cenário tem meta de calorias');
  assert.deepEqual(h.kcal.faixa, { min: a.metaKcal.min, max: a.metaKcal.max });
  assert.equal(h.kcal.err, Math.round(a.metaKcal.folga));
  assert.equal(h.kcal.situacao, a.situacaoIngestao);
  assert.equal(h.kcal.consumido, 600);
  assert.equal(h.peso.kgSemana, Math.round(a.tendencia.kgSemana * 100) / 100);
  assert.deepEqual(h.peso.ic, { min: Math.round(a.tendencia.ic95[0] * 100) / 100, max: Math.round(a.tendencia.ic95[1] * 100) / 100 });
  assert.equal(h.peso.veredito, a.veredito.status);
  assert.equal(h.peso.atual, a.tendencia.ultimo.peso);

  const v = calcularVisao({ refeicoes: janela31(refs), pesagens: janela31(pes), perfil, dia: DIA, gastos: perfil.relogio.gastos });
  assert.deepEqual(h.macros.proteina, { g: 32, meta: v.metaP });
  assert.equal(h.macros.carbo.meta, null);
  assert.equal(h.brotinho.dias, sequenciaDe(janela31(refs), DIA));
  assert.equal(h.brotinho.murcho, false);
  assert.match(h.resumoSemana.texto, /^Últimos 7 dias \(22\/03 a 28\/03\): 7 de 7 dias com registro/);

  // refeições de hoje, pendentes (almoço habitual 12:30 + 75 min de tolerância já passou às 13:50; jantar ainda não)
  assert.equal(h.refeicoes.length, 1);
  assert.equal(h.refeicoes[0].origem, 'foto');
  assert.deepEqual(h.refeicoes[0].faixa, { min: 360, max: 840 });
  assert.deepEqual(h.pendentes, [{ slot: 'almoco', nome: 'Almoço' }]);

  // relógio e energia
  assert.deepEqual(h.relogio, { sonoMin: 455, passos: 7000, gastoKcal: 2600, gastoPrevisto: h.relogio.gastoPrevisto, fcRepouso: 58, treinos: [], atualizadoEm: '2030-03-29T16:40:00.000Z' });
  assert.ok(h.relogio.gastoPrevisto > 2000);
  assert.deepEqual(h.energia, energiaDoDia({ sonos: s.sonos, atividades: s.atividades, dia: DIA }));

  // avisos: pensamento do dia sem a frase do bairro; alertas sem o rótulo em caixa alta
  const pens = h.avisos.find((x) => x.titulo.startsWith('Pensamento'));
  assert.equal(pens.tom, 'bom');
  assert.equal(pens.texto, 'Ela tem caprichado no almoço.');
  for (const x of h.avisos) {
    assert.ok(['bom', 'atencao', 'cuidado'].includes(x.tom));
    assert.doesNotMatch(x.texto, /^[A-ZÁÉÍÓÚÇ ]{6,}:/);
  }
  assert.equal(JSON.stringify(h).includes('Ômega'), false);
  assert.equal(JSON.stringify(h).includes('Alfaville'), false);
});

test('hoje sem relógio e sem dados: tudo null/vazio onde não há base, brotinho murcho', () => {
  const perfil = { _id: 'b', nome: 'Pessoa B', jids: ['b@x'], objetivo: 'manter', peso: 60 };
  const h = M.montarHoje({ perfil, dia: DIA, hoje: DIA, horaAgora: '09:00', refeicoes: [], pesagens: [], saude: null });
  assert.deepEqual(h.kcal, { consumido: 0, faixa: null, err: null, situacao: null });
  assert.deepEqual(h.macros.proteina, { g: 0, meta: { min: 96, max: 132 } });
  assert.equal(h.peso, null);
  assert.equal(h.relogio, null);
  assert.equal(h.energia, null);
  assert.deepEqual(h.brotinho, { dias: 0, murcho: true });
  assert.equal(h.resumoSemana, null);
  assert.deepEqual(h.pendentes, []); // 09:00: o café padrão (08:30) + 75 min ainda não passou
  assert.ok(h.avisos.some((x) => x.titulo === 'Poucas pesagens'));
});

test('pendentes: dia já fechado = toda refeição principal sem registro; horário aprendido manda', () => {
  assert.deepEqual(M.pendentesDoDia({ refeicoesDoDia: [{ slot: 'almoco' }], agoraMin: 24 * 60 }).map((p) => p.slot), ['cafe', 'jantar']);
  const hab = { cafe: { minutos: 6 * 60 }, almoco: { minutos: 11 * 60 }, jantar: { minutos: 19 * 60 } };
  assert.deepEqual(M.pendentesDoDia({ refeicoesDoDia: [], hab, agoraMin: 12 * 60 + 20 }).map((p) => p.slot), ['cafe', 'almoco']);
});

// ---------- refeições por dia ----------
test('refeições por dia: todo dia do intervalo, totais, completo pelo critério do progresso; hoje nunca completo', () => {
  const refs = refeicoes();
  const de = somarDias(DIA, -3);
  const r = M.montarRefeicoes({ refeicoes: refs, de, ate: DIA, hoje: DIA });
  assert.deepEqual(r.dias.map((d) => d.dia), [de, somarDias(DIA, -2), somarDias(DIA, -1), DIA]);
  const ontem = r.dias[2];
  assert.equal(ontem.completo, true);
  assert.equal(ontem.refeicoes.length, 3);
  assert.equal(ontem.kcal, ontem.refeicoes.reduce((a, x) => a + x.kcal, 0));
  assert.deepEqual(ontem.refeicoes.map((x) => x.slot), ['cafe', 'almoco', 'jantar']);
  assert.equal(r.dias[3].completo, false);
  assert.equal(r.dias[3].kcal, 600);
  // dia sem registro aparece vazio
  const vazio = M.montarRefeicoes({ refeicoes: [], de: DIA, ate: DIA, hoje: DIA });
  assert.deepEqual(vazio, { dias: [{ dia: DIA, completo: false, kcal: 0, p: 0, c: 0, g: 0, refeicoes: [], eventos: [] }] });
});

// ---------- progresso ----------
test('progresso: texto é o textoZap do !progresso; pesagens com as descartadas (libra e a da consolidação)', async () => {
  const perfil = perfilBase();
  const refs = refeicoes();
  const pes = pesagens();
  const p = M.montarProgresso({ perfil, dia: DIA, refeicoes: refs, pesagens: pes });
  const a = await progressoDe(perfil, DIA, { refeicoes: janela31(refs), pesagens: janela31(pes) });
  assert.deepEqual(Object.keys(p), ['pesagens', 'tendencia', 'veredito', 'meta', 'alertas', 'texto']);
  assert.equal(p.texto, M.semZap(a.zap, { markdown: true })); // fase 5: o texto do !progresso sem a marcação do WhatsApp (negrito em **)
  assert.equal(p.tendencia.kgSemana, Math.round(a.tendencia.kgSemana * 100) / 100);
  assert.equal(p.tendencia.direcao, a.tendencia.direcao);
  assert.deepEqual(p.tendencia.janelas.map((j) => j.dias), [7, 14, 21, 28]);
  assert.deepEqual(p.veredito, { status: a.veredito.status, prob: Math.round(a.veredito.prob * 1000) / 1000, texto: a.veredito.texto[0].toUpperCase() + a.veredito.texto.slice(1) });
  assert.equal(p.meta.min, a.metaKcal.min);
  assert.deepEqual(p.alertas.map((x) => x.tipo), a.alertas.map((x) => x.tipo));

  const libra = p.pesagens.find((x) => x.descartada && /libra/.test(x.motivo));
  assert.ok(libra, 'a libra aparece como descartada');
  assert.equal(libra.dia, somarDias(DIA, -10));
  assert.equal(libra.fonte, 'relogio');
  const digitada = p.pesagens.find((x) => x.descartada && x.fonte === 'digitada');
  assert.ok(digitada, 'a digitada discordante aparece como descartada');
  assert.match(digitada.motivo, /discorda da balança/);
  const validas = p.pesagens.filter((x) => !x.descartada);
  assert.equal(validas.length, a.pesagens.pontos.length);
  assert.ok(validas.every((x) => x.motivo === null && x.fonte === 'relogio' && x.hora === '07:10'));
  assert.deepEqual(ida(p), p);
});

test('progresso sem pesagens: tendência, veredito e meta null; alerta de poucas pesagens', () => {
  const p = M.montarProgresso({ perfil: { _id: 'b', nome: 'B', jids: ['b'], objetivo: 'manter' }, dia: DIA, refeicoes: [], pesagens: [] });
  assert.deepEqual(p.pesagens, []);
  assert.equal(p.tendencia, null);
  assert.equal(p.veredito, null);
  assert.equal(p.meta, null);
  assert.match(p.texto, /Sem pesagens/);
});

// ---------- corpo ----------
function hevy() {
  const sessao = (dia, kg, reps) => ({
    jid: JID,
    inicio: `${dia}T18:00:00Z`,
    titulo: 'Treino A',
    exercicios: [
      { title: 'Supino Reto (Barra)', exercise_template_id: 'sup', sets: [{ type: 'normal', weight_kg: kg, reps }, { type: 'warmup', weight_kg: 20, reps: 10 }] },
      { title: 'Agachamento', exercise_template_id: 'aga', sets: [{ type: 'normal', weight_kg: 80, reps: 8 }] },
    ],
  });
  const treinos = [];
  for (let s = 6; s >= 0; s--) treinos.push(sessao(somarDias(DIA, -s * 4 - 1), s > 3 ? 60 : 62.5, 8));
  return { treinos, catalogo: { sup: { primario: 'chest', secundarios: ['triceps'] }, aga: { primario: 'quadriceps', secundarios: [] } } };
}

test('corpo: composição das pesagens com gordura (+ documento que não virou pesagem); treino por grupo vira lista; sugestões conferidas', () => {
  const { treinos, catalogo } = hevy();
  const perfil = perfilBase({
    documentos: [{ arquivo: 'bio.pdf', tipo: 'bioimpedancia', data: '2029-11-20', confianca: 'alta', medidas: { peso_kg: 70, gordura_pct: 17, massa_magra_kg: 58.1 } }],
    sugestoesCarga: [{ id: 's1', exercicio: 'Agachamento', deKg: 80, deReps: 8, paraKg: 82.5, paraReps: 10, feitaEm: somarDias(DIA, -9), status: 'aberta', tentativas: 0 }],
  });
  const c = M.montarCorpo({ perfil, dia: DIA, pesagens: pesagens(), refeicoes: refeicoes(), saude: saude(), treinos, catalogo, temHevy: true });
  assert.deepEqual(Object.keys(c), ['composicao', 'atual', 'ritmo', 'treino', 'forca', 'sugestoesCarga', 'contextoTreino', 'rotina', 'medidas']);
  assert.ok(Array.isArray(c.rotina));
  c.rotina.forEach((d) => { confere(d, 'DiaRotina'); d.exercicios.forEach((e) => confere(e, 'ExercicioRotina')); });
  assert.deepEqual(ida(c), c);
  const doc = c.composicao.find((x) => x.fonte === 'documento');
  assert.deepEqual(doc, { dia: '2029-11-20', hora: null, fonte: 'documento', peso: 70, gordura: 17, magra: 58.1, confianca: 'alta' });
  const ultima = c.composicao[c.composicao.length - 1];
  assert.equal(c.atual.dia, DIA);
  assert.equal(ultima.magra, Math.round(ultima.peso * (1 - ultima.gordura / 100) * 10) / 10);
  assert.ok(c.composicao.every((x, i, l) => i === 0 || l[i - 1].dia <= x.dia));
  assert.ok(c.ritmo && Number.isFinite(c.ritmo.magraKgSemana));
  assert.ok(Array.isArray(c.treino.porGrupo));
  assert.deepEqual(c.treino.porGrupo.map((g) => g.grupo), ['chest', 'quadriceps', 'triceps']);
  assert.equal(c.treino.porGrupo[0].nome, 'peito');
  assert.equal(c.treino.sessoes, 2);
  assert.ok(c.forca.parados.some((e) => e.exercicio === 'Agachamento'));
  assert.deepEqual(c.sugestoesCarga.map((s) => [s.exercicio, s.status]), [['Agachamento', 'tentando']]);
  // fase 4: cada sugestão diz o que fazer HOJE pelo sono/energia/comida, e o contexto vem junto
  assert.ok(['subir', 'manter', 'repetir'].includes(c.sugestoesCarga[0].hoje), JSON.stringify(c.sugestoesCarga[0]));
  assert.equal(typeof c.sugestoesCarga[0].motivo, 'string');
  assert.equal('tentativas' in c.sugestoesCarga[0], false); // campo interno não sai
  assert.deepEqual(Object.keys(c.contextoTreino), ['energia', 'sonoMin', 'comida', 'texto']);
  assert.equal(typeof c.contextoTreino.texto, 'string');
  assert.deepEqual(c.medidas, []);
});

test('corpo sem Hevy: treino e força null, sem sugestões', () => {
  const c = M.montarCorpo({ perfil: perfilBase(), dia: DIA, pesagens: [], refeicoes: [], temHevy: false });
  assert.deepEqual(c, { composicao: [], atual: null, ritmo: null, treino: null, forca: null, sugestoesCarga: [], contextoTreino: { energia: null, sonoMin: null, comida: null, texto: 'Sem dados do relógio hoje: siga as sugestões como estão.' }, rotina: [], medidas: [] });
});

test('semZap: tira a marcação do WhatsApp e os emojis; com markdown o negrito vira **; listas com • viram -', () => {
  assert.equal(M.semZap('🔥 *Estimativa:* 812 kcal _(aprox.)_ ~ok~\n• item'), 'Estimativa: 812 kcal (aprox.) ok\n- item');
  assert.equal(M.semZap('*Semana boa* 💪\n\n\n• comeu bem\n• dormiu 7h', { markdown: true }), '**Semana boa**\n\n- comeu bem\n- dormiu 7h');
  assert.equal(M.semZap('peso 2*3 e snake_case ficam'), 'peso 2*3 e snake_case ficam');
  assert.equal(M.semZap('`!progresso` → veja'), '!progresso → veja');
  assert.equal(M.semZap(null), null);
});

test('sugerirCargaExercicio: contexto segura; reps ≥ 10 sobe pelo incremento; subiu na última = repete; sem carga = mantém', () => {
  const h = (lista) => lista.map(([dia, kg, reps]) => ({ dia, kg, reps }));
  const s = M.sugerirCargaExercicio({ nome: 'Supino reto', historico: h([['2030-03-01', 50, 8], ['2030-03-08', 50, 9], ['2030-03-15', 50, 10]]), contexto: { comida: 'dentro' } });
  assert.deepEqual([s.acao, s.ultimoKg, s.ultimasReps, s.sugeridoKg, s.deltaKg, s.sugeridasReps], ['subir', 50, 10, 52.5, 2.5, 8]);
  assert.equal(s.frase, 'Pegava 50 kg × 10. Próximo treino: +2,5 kg = 52,5 kg.');
  const halter = M.sugerirCargaExercicio({ nome: 'Rosca com halter', historico: h([['2030-03-01', 12, 10], ['2030-03-08', 12, 10], ['2030-03-15', 12, 11]]), contexto: {} });
  assert.deepEqual([halter.acao, halter.sugeridoKg, halter.deltaKg], ['subir', 13, 1]);
  const rep = M.sugerirCargaExercicio({ nome: 'Supino reto', historico: h([['2030-03-08', 50, 10], ['2030-03-15', 52.5, 6]]), contexto: {} });
  assert.deepEqual([rep.acao, rep.sugeridoKg, rep.sugeridasReps], ['repetir', 52.5, 7]);
  assert.equal(rep.frase, 'Pegava 52,5 kg × 6. Próximo treino: 52,5 kg, tenta 7 repetições.');
  const sono = M.sugerirCargaExercicio({ nome: 'Supino reto', historico: h([['2030-03-15', 50, 10]]), contexto: { sonoMin: 300 } });
  assert.deepEqual([sono.acao, sono.sugeridoKg, sono.frase], ['manter', 50, 'Dormiu pouco: mantém 50 kg × 10.']);
  assert.equal(M.sugerirCargaExercicio({ nome: 'Supino', historico: h([['2030-03-15', 50, 10]]), contexto: { comida: 'abaixo' } }).acao, 'manter');
  const corpo = M.sugerirCargaExercicio({ nome: 'Prancha', historico: h([['2030-03-15', 0, 1]]), contexto: {} });
  assert.deepEqual([corpo.acao, corpo.ultimoKg, corpo.sugeridoKg], ['manter', null, null]);
  // parado há 2+ semanas com 8 reps também sobe
  const parado = M.sugerirCargaExercicio({ nome: 'Agachamento', historico: h([['2030-02-20', 80, 8], ['2030-03-01', 80, 8], ['2030-03-08', 80, 8], ['2030-03-15', 80, 8]]), contexto: {} });
  assert.deepEqual([parado.acao, parado.sugeridoKg], ['subir', 82.5]);
  assert.equal(M.sugerirCargaExercicio({ nome: 'x', historico: [] }), null);
});

test('montarRotina: um item por dia da semana com 2+ sessões em 4 semanas; exercícios da última sessão do dia, com a sugestão', () => {
  const sessao = (inicio, titulo, exercicios) => ({ inicio, titulo, exercicios: exercicios.map(([title, kg, reps, id]) => ({ title, exercise_template_id: id, sets: [{ type: 'warmup', weight_kg: 20, reps: 10 }, { weight_kg: kg, reps }, { weight_kg: kg, reps }] })) });
  // segundas 15:00Z = 12:00 em São Paulo: 2030-03-04, 03-11, 03-18, 03-25 (segundas); uma quarta solta
  const sessoes = [
    sessao('2030-03-04T15:00:00Z', 'Peito e tríceps', [['Supino reto', 50, 8, 's1']]),
    sessao('2030-03-11T15:00:00Z', 'Peito e tríceps', [['Supino reto', 50, 10, 's1'], ['Tríceps corda', 25, 12, 't1']]),
    sessao('2030-03-18T15:00:00Z', 'Peito e tríceps', [['Supino reto', 50, 10, 's1'], ['Tríceps corda', 25, 12, 't1']]),
    sessao('2030-03-25T15:00:00Z', 'Peito', [['Supino reto', 50, 10, 's1'], ['Tríceps corda', 25, 12, 't1']]),
    sessao('2030-03-27T15:00:00Z', 'Pernas', [['Agachamento', 80, 8, 'a1']]),
  ];
  const r = M.montarRotina({ sessoes, catalogo: { s1: { primario: 'chest' }, t1: { primario: 'triceps' } }, dia: '2030-03-29', contexto: {} });
  assert.equal(r.length, 1); // quarta só teve 1 sessão
  assert.deepEqual([r[0].diaSemana, r[0].nome, r[0].titulo, r[0].ultimaData, r[0].sessoes], [1, 'Segunda', 'Peito e tríceps', '2030-03-25', 4]);
  assert.deepEqual(r[0].exercicios.map((e) => [e.nome, e.grupo, e.series, e.acao, e.sugeridoKg]), [['Supino reto', 'peito', 2, 'subir', 52.5], ['Tríceps corda', 'tríceps', 2, 'subir', 27.5]]);
  assert.deepEqual(M.montarRotina({ sessoes: [], dia: '2030-03-29' }), []);
});

test('ajustarSugestoesPeloDia: sono curto ou energia baixa seguram; comida abaixo segura; 2 tentativas = repetir; senão sobe; batida não muda', () => {
  const s = [{ exercicio: 'A', deKg: 80, status: 'aberta', tentativas: 0 }, { exercicio: 'B', deKg: 40, status: 'tentando', tentativas: 2 }, { exercicio: 'C', status: 'batida' }];
  const hoje = (ctx) => M.ajustarSugestoesPeloDia(s, ctx).map((x) => x.hoje);
  assert.deepEqual(hoje({ sonoMin: 300, energia: 80, comida: 'dentro' }), ['manter', 'manter', null]);
  assert.deepEqual(hoje({ sonoMin: 450, energia: 30, comida: 'dentro' }), ['manter', 'manter', null]);
  assert.deepEqual(hoje({ sonoMin: 450, energia: 80, comida: 'abaixo' }), ['manter', 'manter', null]);
  assert.deepEqual(hoje({ sonoMin: 450, energia: 80, comida: 'dentro' }), ['subir', 'repetir', null]);
  assert.deepEqual(hoje({}), ['subir', 'repetir', null]);
  assert.match(M.ajustarSugestoesPeloDia(s, { sonoMin: 300 })[0].motivo, /dormiu pouco/);
  assert.match(M.ajustarSugestoesPeloDia(s, {})[1].motivo, /repete 40 kg/);
});

test('montarDias: um item por dia com null onde falta; kcal/proteína das refeições; gasto do relógio (ou perfil.relogio.gastos); magra; sono; meta', () => {
  const perfil = perfilBase({ relogio: { gastos: { '2030-03-27': 2300, '2030-03-26': 500 } } });
  const d = M.montarDias({
    perfil,
    de: '2030-03-26',
    ate: '2030-03-29',
    refeicoes: [{ dia: '2030-03-27', estimativa: { kcal: 600, p: 40 } }, { dia: '2030-03-27', estimativa: { kcal: 400.4, p: 20 } }, { dia: '2030-03-28', resumo: 'sem estimativa' }],
    pesagens: [{ dia: '2030-03-27', peso: 78.456, gordura: 18.26 }, { dia: '2030-03-29', peso: 78.1, gordura: 150 }],
    saude: { sonos: [{ dia: '2030-03-27', total: 430, inicio: '2030-03-26 23:40', fim: '2030-03-27 06:50' }, { dia: '2030-03-28', total: 0 }], atividades: [{ dia: '2030-03-28', passos: 9000, calorias: 2450, treinos: [{ nome: 'Corrida', min: 30 }, { nome: 'Caminhada', min: 20 }] }, { dia: '2030-03-29', passos: 100, calorias: 300 }] },
    meta: { min: 2100.4, max: 2300 },
  });
  assert.deepEqual(d.meta, { min: 2100, max: 2300 });
  assert.deepEqual(d.dias.map((x) => x.dia), ['2030-03-26', '2030-03-27', '2030-03-28', '2030-03-29']);
  assert.deepEqual(d.dias[0], { dia: '2030-03-26', kcal: null, proteina: null, gasto: null, peso: null, gordura: null, magra: null, sonoMin: null, sonoInicio: null, sonoFim: null, passos: null, treinoMin: null }); // gasto 500 ≤ 800 = relógio fora do pulso
  assert.deepEqual(d.dias[1], { dia: '2030-03-27', kcal: 1000, proteina: 60, gasto: 2300, peso: 78.46, gordura: 18.3, magra: 64.1, sonoMin: 430, sonoInicio: '23:40', sonoFim: '06:50', passos: null, treinoMin: null });
  assert.deepEqual([d.dias[2].kcal, d.dias[2].gasto, d.dias[2].passos, d.dias[2].treinoMin, d.dias[2].sonoMin], [null, 2450, 9000, 50, null]);
  assert.deepEqual([d.dias[3].peso, d.dias[3].gordura, d.dias[3].magra, d.dias[3].gasto], [78.1, null, null, null]); // gordura impossível e gasto baixo viram null
  assert.deepEqual(M.montarDias({ de: '2030-03-29', ate: '2030-03-29' }).meta, null);
});

test('montarRelatorio, montarPlano, proximoSlot e montarSugestaoRefeicao (fase 4)', () => {
  const r = M.montarRelatorio({ nome: 'Semana-2030-W13.md', modifiedTime: '2030-03-30T03:00:00Z', texto: '---\ntipo: resumo-semanal\n---\n\n# Semana 2030-W13\n\nSemana boa. A Pessoa A mora na Rua X.\n\n---\nDias: [[a]] · [[b]]\n' });
  assert.deepEqual(r, { titulo: 'Semana 2030-W13', texto: 'Semana boa.', criadoEm: '2030-03-30T03:00:00.000Z' });
  assert.equal(M.montarRelatorio(null), null);
  assert.equal(M.montarRelatorio({ texto: '# Só título\n' }), null);
  assert.deepEqual(M.montarPlano(null), { plano: null });
  const p = M.montarPlano({ semana: '2030-03-31/2030-04-06', de: '2030-03-31', ate: '2030-04-06', texto: 'Seg: arroz.\nMora no bairro Y.', criadoEm: new Date('2030-03-29T15:00:00Z') });
  assert.deepEqual(p.plano, { semana: '2030-03-31/2030-04-06', de: '2030-03-31', ate: '2030-04-06', texto: 'Seg: arroz.', criadoEm: '2030-03-29T15:00:00.000Z' });
  const slots = { cafe: { hora: '08:00' }, almoco: { hora: '12:30' }, jantar: { hora: '20:00' } };
  assert.deepEqual(M.proximoSlot({ slots, registradosHoje: ['cafe'], horaAgora: '10:00' }), { slot: 'almoco', hora: '12:30' });
  assert.deepEqual(M.proximoSlot({ slots, registradosHoje: ['cafe', 'almoco'], horaAgora: '13:00' }), { slot: 'jantar', hora: '20:00' });
  assert.deepEqual(M.proximoSlot({ slots, registradosHoje: [], horaAgora: '12:00' }).slot, 'almoco'); // café habitual já passou há mais de 90 min
  assert.deepEqual(M.proximoSlot({ slots: {}, registradosHoje: ['almoco'], horaAgora: '12:00' }), { slot: 'lanche', hora: '16:00' }); // sem rotina: pelo horário, pulando o já feito
  // 21h, jantar habitual às 19h e nada registrado: cai no fallback, mas a hora é a DA ROTINA, não a padrão (revisão, achado 2)
  assert.deepEqual(M.proximoSlot({ slots: { jantar: { hora: '19:00' } }, registradosHoje: [], horaAgora: '21:00' }), { slot: 'jantar', hora: '19:00' });
  assert.deepEqual([M.horaDoSlot({ cafe: { hora: '07:15' } }, 'cafe'), M.horaDoSlot({}, 'ceia'), M.horaDoSlot({}, 'x')], ['07:15', '23:00', null]);
  // termos de lugar: cidade, e as palavras próprias de nome e rua (a IA abrevia "R. Lauro Linhares" ou encurta "na Garra")
  const termos = M.termosDeLugar([{ lugares: [{ nome: 'Garra Academia', rua: 'Rua Lauro Linhares', cidade: 'Florianópolis', bairro: 'Trindade' }] }]);
  for (const t of ['garra', 'lauro', 'linhares', 'florianopolis', 'trindade']) assert.ok(termos.includes(t), t);
  assert.equal(termos.includes('rua'), false);
  assert.equal(M.tirarLocalizacao('Passa na padaria da R. Lauro Linhares. Treino na Garra às 18h. Come em casa.', termos), 'Come em casa.');
  // a resposta da IA vira o contrato: no máximo 3 opções, nome obrigatório, onde válido, números inteiros, localização fora
  const s = M.montarSugestaoRefeicao({
    slot: 'almoco', hora: '12:30', restam: 850.6, geradaEm: 'x', termosLocal: ['deltopolis'],
    resposta: { opcoes: [{ nome: 'Arroz, feijão e frango', porque: 'cabe na faixa', kcal: 650.2, proteina_g: 45, onde: 'casa', preparo: 'Grelha o frango.' }, { nome: 'Marmita do RU', porque: 'Fica na Rua X, perto.', kcal: 700, proteina: 40, onde: 'rua' }, { nome: '', onde: 'fora' }, { nome: 'quarta', onde: 'casa' }, { nome: 'quinta', onde: 'casa' }], levar: 'Leva uma fruta.', dica: null },
  });
  assert.deepEqual(s, {
    slot: 'almoco', nome: 'Almoço', hora: '12:30', restam: 851, geradaEm: 'x',
    opcoes: [{ nome: 'Arroz, feijão e frango', porque: 'cabe na faixa', kcal: 650, proteina: 45, onde: 'casa', preparo: 'Grelha o frango.' }, { nome: 'Marmita do RU', porque: null, kcal: 700, proteina: 40, onde: 'casa', preparo: null }],
    levar: 'Leva uma fruta.', dica: null,
  });
  s.opcoes.forEach((o) => confere(o, 'OpcaoRefeicao'));
  confere(s, 'SugestaoRefeicao');
});

// ---------- nutri ----------
test('nutri: todo item com natureza, origem, atualizadoEm e escopo; o diário vem marcado como do grupo; localização sai', () => {
  const perfil = perfilBase({
    dieta: 'onívora',
    restricoes: 'Só almoça no restaurante da Deltópolis.',
    girias: ['bah', 'tri'],
    produtos: [{ nome: 'Whey X', kcal: 120, em: '2030-02-01' }],
    rotina: 'Acorda às 6h. Treina na Academia Beta às 18h. Janta tarde.',
    notas: '- Gosta de café sem açúcar.\n- Mora no bairro Épsilon.\n- Odeia beterraba.',
    anotacoes: [{ dia: '2030-03-01', tipo: 'preferencia', texto: 'Prefere arroz integral' }, { dia: '2030-03-02', tipo: 'contexto', texto: 'Trabalha perto da Deltópolis' }],
    hipoteses: [{ id: 'h1', texto: 'Come menos em dia de treino pesado', comoVerificar: 'kcal x Hevy', criadaEm: '2030-03-10', status: 'aberta', sinais: [{ dia: '2030-03-20', direcao: 'a_favor', evidencia: 'só 1.800 kcal no dia do treino' }] }],
  });
  const n = M.montarNutri({
    perfil,
    hipotesesFechadas: [{ id: 'h0', texto: 'Pula o café quando acorda tarde', comoVerificar: 'Ver se para na padaria da Deltópolis.', status: 'confirmada', evidencia: '5 de 6 dias', criadaEm: '2030-02-01', fechadaEm: '2030-03-03' }],
    reflexoes: [{ dia: '2030-03-24', motivo: 'domingo', texto: 'Semana boa. Andou muito pela rua Gama Sul.', criadoEm: new Date('2030-03-24T22:00:00Z') }],
    pensamentos: [{ dia: DIA, hora: '11:30', texto: 'Café caprichado hoje.', criadoEm: new Date('2030-03-29T14:30:00Z') }],
    diario: [{ dia: '2030-03-28', texto: 'O grupo comeu bem. A Pessoa A foi à Alfaville.', criadoEm: new Date('2030-03-29T02:59:00Z') }],
    termosLocal: M.termosDeLugar([perfil]),
  });
  assert.deepEqual(Object.keys(n), ['fatos', 'hipoteses', 'diario', 'avaliacoes']);
  for (const item of [...n.fatos, ...n.hipoteses, ...n.diario, ...n.avaliacoes]) {
    assert.ok(['declarado', 'medido', 'inferido', 'hipotese', 'opiniao'].includes(item.natureza), JSON.stringify(item));
    assert.equal(typeof item.origem, 'string');
    assert.ok('atualizadoEm' in item);
    assert.equal(item.escopo, n.diario.includes(item) ? 'grupo' : 'pessoa');
  }
  assert.equal(n.diario[0].escopo, 'grupo');
  assert.equal(n.fatos.some((f) => f.campo === 'restricoes'), false); // só falava de lugar
  assert.equal(n.hipoteses.find((h) => h.id === 'h0').comoVerificar, null);
  const json = JSON.stringify(n);
  for (const proibido of ['Épsilon', 'Deltópolis', 'Beta', 'Gama Sul', 'Alfaville']) assert.equal(json.includes(proibido), false, proibido);
  assert.equal(n.fatos.find((f) => f.campo === 'peso').natureza, 'medido'); // relogio.pesoEm == atualizacoes.peso
  assert.equal(n.fatos.find((f) => f.campo === 'objetivo').atualizadoEm, '2030-01-10');
  assert.equal(n.fatos.find((f) => f.campo === 'notas').texto, '- Gosta de café sem açúcar.\n- Odeia beterraba.');
  assert.equal(n.fatos.find((f) => f.campo === 'rotina').texto, 'Acorda às 6h. Janta tarde.');
  assert.deepEqual(n.fatos.filter((f) => f.campo === 'anotacao').map((f) => f.texto), ['Prefere arroz integral']);
  // fase 3: ids estáveis e o que a pessoa pode fazer com cada fato no app
  // rotina e notas aqui tiveram frases de lugar filtradas: NÃO são editáveis (salvar o texto filtrado apagaria o bairro de vez)
  assert.deepEqual(n.fatos.map((f) => [f.id, f.editavel, f.apagavel, f.valor]), [
    ['objetivo', false, false, null], ['metaPeso', false, false, null], ['peso', false, false, null], ['altura', false, false, null], ['dieta', true, true, 'onívora'],
    [`produto:${M.hashCurto('Whey X')}`, false, true, null], ['girias', false, true, null], ['rotina', false, true, null], ['notas', false, true, null], [`anotacao:${M.hashCurto('Prefere arroz integral')}`, false, true, null],
  ]);
  const limpo = M.montarNutri({ perfil: perfilBase({ rotina: 'Acorda às 6h.', notas: '- Gosta de café.\n- Odeia beterraba.' }) });
  assert.deepEqual(limpo.fatos.filter((f) => f.editavel).map((f) => [f.id, f.valor]), [['rotina', 'Acorda às 6h.'], ['notas', '- Gosta de café.\n- Odeia beterraba.']]);
  assert.match(n.fatos.find((f) => f.campo === 'produto').id, /^produto:[0-9a-f]{8}$/);
  assert.deepEqual(n.hipoteses.map((h) => [h.id, h.status, h.apagavel]), [['h1', 'aberta', true], ['h0', 'confirmada', false]]);
  assert.equal(n.hipoteses[1].atualizadoEm, '2030-03-03');
  assert.deepEqual(n.diario.map((d) => d.texto), ['O grupo comeu bem.']);
  assert.deepEqual(n.avaliacoes.map((x) => x.tipo), ['pensamento', 'reflexao']);
  assert.equal(n.avaliacoes[1].texto, 'Semana boa.');
});

test('localização: frase com bairro/rua/endereço sai; o resto da linha fica; lugar genérico não vira termo', () => {
  assert.equal(M.tirarLocalizacao('Comeu bem. Mora na Rua X, 10. Dormiu cedo.'), 'Comeu bem. Dormiu cedo.');
  assert.equal(M.tirarLocalizacao('Ficou em casa o dia todo.'), 'Ficou em casa o dia todo.');
  assert.equal(M.tirarLocalizacao('Endereço novo anotado.'), '');
  assert.deepEqual(M.termosDeLugar([{ lugares: [{ nome: 'Casa', bairro: 'Centro' }, { nome: 'Academia' }] }]), ['centro']);
});

// ---------- resumos ----------
test('resumos: semana e mês = os 7 e 30 dias fechados da visão do !hoje', () => {
  const perfil = perfilBase();
  const refs = refeicoes();
  const pes = pesagens();
  const r = M.montarResumos({ perfil, dia: DIA, refeicoes: refs, pesagens: pes });
  const v = calcularVisao({ refeicoes: janela31(refs), pesagens: janela31(pes), perfil, dia: DIA, gastos: perfil.relogio.gastos });
  assert.equal(r.semana.kcalMedia, Math.round(v.sete.kcal));
  assert.equal(r.semana.de, v.sete.de);
  assert.equal(r.semana.diasCompletos, 7); // 3 registros por dia = hábito de registro completo
  assert.equal(r.semana.diasProteinaBatida, 7); // 140 g >= 75 × 1,6
  assert.equal(r.mes.dias, 30);
  assert.equal(r.mes.diasComRegistro, 30);
  assert.equal(r.sequencia, v.sequencia);
  assert.match(r.semana.texto, /^Últimos 7 dias/);
  assert.deepEqual(M.montarResumos({ perfil: { nome: 'B', jids: ['b'] }, dia: DIA }), { semana: null, mes: null, sequencia: 0, relatorio: { semana: null, mes: null } });
  // fase 4: o último resumo/relatório da Nutri (Drive) vem limpo e filtrado
  const comRel = M.montarResumos({ perfil: { nome: 'B', jids: ['b'] }, dia: DIA, relatorios: { semana: { nome: 'Semana-2030-W13.md', modifiedTime: '2030-03-30T03:00:00Z', texto: '---\nx: 1\n---\n# Semana 2030-W13\n\nSemana boa.\n' }, mes: null } });
  assert.deepEqual(comRel.relatorio, { semana: { titulo: 'Semana 2030-W13', texto: 'Semana boa.', criadoEm: '2030-03-30T03:00:00.000Z' }, mes: null });
});

// ---------- integrações ----------
test('integrações: estado do relógio pelo tempo do último envio; Hevy e agenda por perfil; nada de lugares', () => {
  const agoraMs = Date.parse('2030-03-29T18:00:00Z');
  const perfis = [
    { _id: 'a', nome: 'A', lugares: [{ bairro: 'X' }], lugaresAtivo: true },
    { _id: 'b', nome: 'B' },
    { _id: 'c', nome: 'C' },
  ];
  const porPerfil = new Map([
    ['a', { saude: { ultimoEnvio: new Date('2030-03-29T17:40:00Z'), app: '1.6' }, ultimoTreino: '2030-03-28T18:00:00Z', ultimaNota: { dia: '2030-03-20', loja: 'Mercado' } }],
    ['b', { saude: { ultimoEnvio: new Date('2030-03-29T08:00:00Z'), app: '1.5' } }],
    ['c', { saude: { ultimoEnvio: new Date('2030-03-26T08:00:00Z') } }],
  ]);
  const i = M.montarIntegracoes({ perfis, whatsapp: { estado: 'conectado' }, driveConfigurado: true, porPerfil, temHevy: (p) => p.nome === 'A', ehDonoDaAgenda: (p) => p.nome === 'A', agoraMs });
  assert.deepEqual(i.whatsapp, { estado: 'conectado', conectado: true, desconectadoHaMin: 0 });
  assert.deepEqual(i.perfis.map((p) => p.relogio.estado), ['ok', 'atrasado', 'parado']);
  assert.equal(i.perfis[0].relogio.haMin, 20);
  assert.deepEqual(i.perfis[0].hevy, { ativo: true, ultimoTreino: '2030-03-28T18:00:00.000Z' });
  assert.deepEqual(i.perfis[0].cupom, { ultimaNota: { dia: '2030-03-20' } }); // a loja não sai (lugar frequentado)
  assert.equal(JSON.stringify(i).includes('Mercado'), false);
  assert.equal(i.perfis[1].agenda.ativo, false);
  assert.equal(JSON.stringify(i).toLowerCase().includes('lugar'), false);
  const semZap = M.montarIntegracoes({ perfis: [{ _id: 'd', nome: 'D' }], whatsapp: { estado: 'desconectado', desconectadoHaMin: 12.4 } });
  assert.deepEqual(semZap.whatsapp, { estado: 'desconectado', conectado: false, desconectadoHaMin: 12 });
  assert.equal(semZap.perfis[0].relogio.estado, 'sem_dados');
});

// ---------- avisos ----------
test('avisos: rótulo em caixa alta sai; rápido demais = cuidado; sono e treino da tendência = atenção; ordem por tom', () => {
  assert.equal(M.tirarRotulo('REGISTRO x BALANÇA: pela conta comida'), 'Pela conta comida');
  assert.equal(M.tirarRotulo('OSCILAÇÃO CURTA: de 01/03 a 05/03'), 'De 01/03 a 05/03');
  assert.equal(M.tirarRotulo('Ritmo: ok'), 'Ritmo: ok');
  const av = M.montarAvisos({
    analise: { veredito: { status: 'acima', confianca: 'media', texto: 'subindo mais rápido que o saudável' }, alertas: [{ tipo: 'curto_vs_longo', texto: 'OSCILAÇÃO CURTA: subiu 1 kg' }] },
    pensamento: { hora: '17:30', texto: 'Tudo certo.' },
    avisosTendencia: ['sono médio de 5h50 nas últimas semanas (menos de 6h30 trava recuperação e apetite)', '1,5 treinos de força por semana (menos de 3 segura o ganho de massa)', 'balança (+0,10/sem) e comida (+0,40/sem) discordam'],
  });
  assert.deepEqual(av.map((x) => [x.tom, x.titulo]), [
    ['cuidado', 'Peso andando rápido demais'],
    ['atencao', 'Oscilação curta no peso'],
    ['atencao', 'Sono curto nas últimas semanas'],
    ['atencao', 'Poucos treinos de força'],
    ['bom', 'Pensamento da Nutri (17:30)'],
  ]);
  assert.equal(av[1].texto, 'Subiu 1 kg');
});

// ---------- I4: todas as chaves do contrato, sempre (com null quando falta), em dados mínimos ----------
const ESQUEMA = {
  Perfil: ['id', 'nome', 'primeiroNome', 'apelido', 'fuso', 'objetivo', 'metaPeso', 'metaPrazo', 'temRelogio', 'temHevy', 'ehDono', 'altura', 'ritmo'],
  Hoje: ['dia', 'fuso', 'agora', 'kcal', 'macros', 'refeicoes', 'pendentes', 'peso', 'relogio', 'energia', 'avisos', 'brotinho', 'resumoSemana', 'humor', 'eventos'],
  Kcal: ['consumido', 'faixa', 'err', 'situacao'],
  Macro: ['g', 'meta'],
  // fase 2: dia, incerteza, miniatura e itens com macros (o ajuste por gramas parte deles)
  // fase 3: foto no Drive (só o link)
  Refeicao: ['id', 'dia', 'slot', 'nome', 'hora', 'kcal', 'faixa', 'p', 'c', 'g', 'descricao', 'origem', 'incerteza', 'itens', 'miniatura', 'foto'],
  Item: ['nome', 'gramas', 'kcal', 'p', 'c', 'g'],
  Evento: ['id', 'dia', 'hora', 'titulo', 'tipo', 'nota', 'criadoEm'],
  Humor: ['humor', 'energia', 'sono', 'texto', 'atualizadoEm'],
  Pendente: ['slot', 'nome'],
  Peso: ['atual', 'kgSemana', 'ic', 'veredito', 'texto'],
  Relogio: ['sonoMin', 'passos', 'gastoKcal', 'gastoPrevisto', 'fcRepouso', 'treinos', 'atualizadoEm'],
  TreinoRelogio: ['nome', 'min', 'hora'],
  Energia: ['nota', 'sono', 'recuperacao', 'carga', 'texto'],
  Aviso: ['tom', 'titulo', 'texto'],
  DiaRefeicoes: ['dia', 'completo', 'kcal', 'p', 'c', 'g', 'refeicoes', 'eventos'],
  Progresso: ['pesagens', 'tendencia', 'veredito', 'meta', 'alertas', 'texto'],
  Pesagem: ['dia', 'peso', 'gordura', 'fonte', 'hora', 'descartada', 'motivo'],
  Corpo: ['composicao', 'atual', 'ritmo', 'treino', 'forca', 'sugestoesCarga', 'contextoTreino', 'rotina', 'medidas'],
  DiaRotina: ['diaSemana', 'nome', 'titulo', 'ultimaData', 'sessoes', 'exercicios'],
  ExercicioRotina: ['nome', 'grupo', 'series', 'ultimoKg', 'ultimasReps', 'sugeridoKg', 'deltaKg', 'sugeridasReps', 'acao', 'motivo', 'frase'],
  ContextoTreino: ['energia', 'sonoMin', 'comida', 'texto'],
  DiaSerie: ['dia', 'kcal', 'proteina', 'gasto', 'peso', 'gordura', 'magra', 'sonoMin', 'sonoInicio', 'sonoFim', 'passos', 'treinoMin'],
  Relatorio: ['titulo', 'texto', 'criadoEm'],
  Plano: ['semana', 'de', 'ate', 'texto', 'criadoEm'],
  SugestaoRefeicao: ['slot', 'nome', 'hora', 'restam', 'geradaEm', 'opcoes', 'levar', 'dica'],
  OpcaoRefeicao: ['nome', 'porque', 'kcal', 'proteina', 'onde', 'preparo'],
  Medicao: ['dia', 'hora', 'fonte', 'peso', 'gordura', 'magra', 'confianca'],
  Treino: ['sessoes', 'series', 'volumeKg', 'volumeAnteriorKg', 'variacaoVolume', 'rpeMedio', 'semanasComTreino', 'porGrupo', 'progressao'],
  Exercicio: ['exercicio', 'sessoes', 'melhorKg', 'reps', 'desdeKg', 'ultimaSubida', 'semanasParado'],
  Sugestao: ['exercicio', 'deKg', 'deReps', 'paraKg', 'paraReps', 'status', 'feitaEm', 'batidaEm', 'como', 'hoje', 'motivo'],
  Fato: ['id', 'campo', 'texto', 'natureza', 'origem', 'atualizadoEm', 'escopo', 'editavel', 'apagavel', 'valor'],
  Hipotese: ['id', 'texto', 'status', 'comoVerificar', 'evidencia', 'sinais', 'natureza', 'origem', 'atualizadoEm', 'escopo', 'apagavel'],
  PesagemSimples: ['dia', 'peso', 'gordura', 'fonte', 'hora'],
  Diario: ['dia', 'texto', 'natureza', 'origem', 'atualizadoEm', 'escopo'],
  Avaliacao: ['tipo', 'dia', 'hora', 'texto', 'natureza', 'origem', 'atualizadoEm', 'escopo'],
  Periodo: ['de', 'ate', 'dias', 'diasComRegistro', 'diasComEstimativa', 'kcalMedia', 'proteinaMedia', 'metaProteina', 'diasCompletos', 'diasProteinaBatida', 'peso', 'texto'],
  PerfilIntegracao: ['id', 'nome', 'relogio', 'hevy', 'agenda', 'cupom'],
};
/** As chaves exatas do esquema e nenhum valor undefined (o JSON apagaria a chave). */
function confere(obj, tipo) {
  assert.ok(obj && typeof obj === 'object' && !Array.isArray(obj), `${tipo}: objeto`);
  assert.deepEqual(Object.keys(obj).sort(), [...ESQUEMA[tipo]].sort(), tipo);
  for (const [k, v] of Object.entries(obj)) assert.notEqual(v, undefined, `${tipo}.${k} undefined`);
  assert.deepEqual(Object.keys(ida(obj)).sort(), [...ESQUEMA[tipo]].sort(), `${tipo} depois do JSON`);
}
const confereRefeicao = (r) => {
  confere(r, 'Refeicao');
  r.itens.forEach((i) => confere(i, 'Item'));
};

test('I4: chaves do contrato sempre presentes com dados mínimos (sem relógio, sem pesagem, refeição sem estimativa)', () => {
  const minima = { _id: 'm', nome: 'Pessoa Mínima', jids: ['m@x'] };
  const refs = [
    { _id: 'r1', jid: 'm@x', dia: DIA, resumo: '[foto]' }, // registro antigo: sem slot, sem hora, sem estimativa
    { _id: 'r2', jid: 'm@x', dia: DIA, slot: 'almoco', hora: '12:00', minutos: 720, descricao: 'sopa de legumes' },
  ];
  confere(M.montarPerfil(minima), 'Perfil');
  // fase 3: pesagens por intervalo (uma por dia, sem validação de outliers)
  const ps = M.montarPesagens([{ dia: '2030-03-02', peso: 70.123, fonte: 'relogio', hora: '07:10', gordura: 150 }, { dia: '2030-03-01', peso: 70.4, jid: 'x@y' }, { dia: '2030-03-01', peso: 70.6, gordura: 18.26, jid: 'z@y' }, { dia: '2030-03-03' }]);
  ps.forEach((x) => confere(x, 'PesagemSimples'));
  // um ponto por dia (dois jids no mesmo dia: fica o último), gordura impossível vira null, nada de jid
  assert.deepEqual(ps, [{ dia: '2030-03-01', peso: 70.6, gordura: 18.3, fonte: 'digitada', hora: null }, { dia: '2030-03-02', peso: 70.12, gordura: null, fonte: 'relogio', hora: '07:10' }]);

  const h = M.montarHoje({ perfil: minima, dia: DIA, hoje: DIA, horaAgora: '23:00', refeicoes: refs });
  confere(h, 'Hoje');
  confere(h.kcal, 'Kcal');
  for (const k of ['proteina', 'carbo', 'gordura']) confere(h.macros[k], 'Macro');
  h.refeicoes.forEach(confereRefeicao);
  assert.equal(h.refeicoes.find((r) => r.id === 'r1').slot, null);
  assert.equal(h.refeicoes.find((r) => r.id === 'r1').hora, null);
  assert.equal(h.refeicoes.find((r) => r.id === 'r2').kcal, null);
  h.pendentes.forEach((p) => confere(p, 'Pendente'));
  h.avisos.forEach((a) => confere(a, 'Aviso'));
  assert.deepEqual([h.peso, h.relogio, h.energia, h.resumoSemana, h.humor], [null, null, null, null, null]);
  assert.deepEqual(h.eventos, []);

  // fase 2: humor e eventos do dia no /hoje; eventos por dia no /refeicoes (só os do dia)
  const ev = [{ _id: 'e1', dia: DIA, hora: '19:30', titulo: 'Jantar fora', tipo: 'comer_fora', criadoEm: new Date('2030-01-01T00:00:00Z') }, { _id: 'e2', dia: somarDias(DIA, -1), titulo: 'Viagem', tipo: 'viagem' }];
  const h2 = M.montarHoje({ perfil: minima, dia: DIA, hoje: DIA, horaAgora: '23:00', refeicoes: refs, humor: { humor: 4, energia: 3, texto: 'cansado' }, eventos: ev });
  confere(h2, 'Hoje');
  confere(h2.humor, 'Humor');
  assert.deepEqual(h2.humor, { humor: 4, energia: 3, sono: null, texto: 'cansado', atualizadoEm: null });
  assert.equal(h2.eventos.length, 1);
  confere(h2.eventos[0], 'Evento');
  assert.equal(h2.eventos[0].criadoEm, '2030-01-01T00:00:00.000Z');

  const r = M.montarRefeicoes({ refeicoes: refs, eventos: ev, de: somarDias(DIA, -1), ate: DIA, hoje: DIA });
  r.dias.forEach((d) => {
    confere(d, 'DiaRefeicoes');
    d.refeicoes.forEach(confereRefeicao);
    d.eventos.forEach((e) => confere(e, 'Evento'));
  });
  assert.deepEqual(r.dias.map((d) => d.eventos.map((e) => e.id)), [['e2'], ['e1']]);

  // registro feito pelo app: itens gravados (com gramas e macros) vencem os da descrição; miniatura vira data URI; origem app
  const doApp = M.montarRefeicao({ _id: 'a1', dia: DIA, slot: 'almoco', horaLocal: '12:10', origem: 'app', incerteza: 'media', miniatura: 'AAAA', descricao: 'arroz, frango', estimativa: { kcal: 500, p: 40, c: 50, g: 12 }, itens: [{ nome: 'arroz', gramas: 150, kcal: 190, p: 4, c: 42, g: 0.3 }, { nome: 'frango', gramas: 120, kcal: 310, p: 36, c: 8, g: 11.7 }] });
  confereRefeicao(doApp);
  assert.deepEqual([doApp.origem, doApp.incerteza, doApp.miniatura, doApp.dia], ['app', 'media', 'data:image/jpeg;base64,AAAA', DIA]);
  assert.deepEqual(doApp.itens.map((i) => [i.nome, i.gramas, i.kcal]), [['arroz', 150, 190], ['frango', 120, 310]]);

  const p = M.montarProgresso({ perfil: minima, dia: DIA, refeicoes: refs, pesagens: [] });
  confere(p, 'Progresso');
  p.alertas.forEach((a) => assert.deepEqual(Object.keys(a), ['tipo', 'texto']));

  const c = M.montarCorpo({ perfil: minima, dia: DIA, temHevy: true, treinos: [] });
  confere(c, 'Corpo');
  confere(c.treino, 'Treino');

  const n = M.montarNutri({ perfil: minima, diario: [{ texto: 'Dia calmo.' }], pensamentos: [{ texto: 'Sem dados ainda.' }], hipotesesFechadas: [{ texto: 'Uma hipótese' }] });
  n.fatos.forEach((f) => confere(f, 'Fato'));
  n.hipoteses.forEach((x) => confere(x, 'Hipotese'));
  n.diario.forEach((x) => confere(x, 'Diario'));
  n.avaliacoes.forEach((x) => confere(x, 'Avaliacao'));
  assert.equal(n.diario[0].dia, null);

  const s = M.montarResumos({ perfil: minima, dia: DIA, refeicoes: refs });
  confere(s.semana, 'Periodo');
  confere(s.mes, 'Periodo');

  const i = M.montarIntegracoes({ perfis: [{ _id: 'm' }] });
  i.perfis.forEach((x) => confere(x, 'PerfilIntegracao'));
  assert.equal(i.perfis[0].nome, null);
});

test('I4: dados parciais (uma pesagem, treino do relógio sem nome, Hevy com sugestão incompleta) não apagam chave', () => {
  const perfil = { _id: 'p', nome: 'Pessoa Parcial', jids: ['p@x'], objetivo: 'ganhar massa', peso: 70, relogio: { linha: 'x' }, sugestoesCarga: [{ exercicio: 'Remada', status: 'aberta', feitaEm: somarDias(DIA, -3) }] };
  const saudeParcial = { sonos: [], atividades: [{ dia: DIA, treinos: [{}] }], ultimoEnvio: null };
  const h = M.montarHoje({ perfil, dia: DIA, hoje: DIA, horaAgora: '10:00', refeicoes: [], pesagens: [{ jid: 'p@x', dia: DIA, peso: 70.2 }], saude: saudeParcial });
  confere(h.peso, 'Peso');
  assert.equal(h.peso.kgSemana, null);
  assert.equal(h.peso.ic, null);
  confere(h.relogio, 'Relogio');
  confere(h.relogio.treinos[0], 'TreinoRelogio');
  assert.deepEqual(h.relogio.treinos[0], { nome: null, min: null, hora: null });
  assert.equal(h.relogio.atualizadoEm, null);

  const p = M.montarProgresso({ perfil, dia: DIA, pesagens: [{ jid: 'p@x', dia: DIA, peso: 70.2 }] });
  p.pesagens.forEach((x) => confere(x, 'Pesagem'));
  assert.equal(p.tendencia, null);

  const sessao = (dia) => ({ inicio: `${dia}T18:00:00Z`, exercicios: [{ title: 'Remada', sets: [{ type: 'normal', weight_kg: 40, reps: 10 }] }] });
  const treinos = [sessao(somarDias(DIA, -20)), sessao(somarDias(DIA, -10)), sessao(somarDias(DIA, -1))];
  const c = M.montarCorpo({ perfil, dia: DIA, pesagens: [{ jid: 'p@x', dia: DIA, peso: 70.2, gordura: 20 }], treinos, temHevy: true });
  c.composicao.forEach((x) => confere(x, 'Medicao'));
  confere(c.atual, 'Medicao');
  for (const lista of Object.values(c.forca)) lista.forEach((e) => confere(e, 'Exercicio'));
  assert.ok(c.forca.parados.length + c.forca.subindo.length + c.forca.caindo.length > 0);
  c.sugestoesCarga.forEach((x) => confere(x, 'Sugestao'));
  assert.equal(c.sugestoesCarga[0].deKg, null);
});

test('completar: undefined vira null em qualquer nível; Date e números ficam', () => {
  const d = new Date('2030-01-01T00:00:00Z');
  assert.deepEqual(M.completar({ a: undefined, b: [undefined, { c: undefined }], d, e: 0 }), { a: null, b: [null, { c: null }], d, e: 0 });
});

test('M4: descrição e itens da refeição passam pelo filtro de lugares', () => {
  const termos = M.termosDeLugar([{ lugares: [{ bairro: 'Deltópolis' }] }]);
  const r = M.montarRefeicao({ _id: 'x', slot: 'almoco', horaLocal: '12:30', descricao: 'arroz, feijão e bife. Comido no restaurante da Deltópolis.', estimativa: { kcal: 700 } }, termos);
  assert.equal(r.descricao, 'arroz, feijão e bife.');
  assert.deepEqual(r.itens.map((i) => i.nome), ['arroz', 'feijão', 'bife']);
});
