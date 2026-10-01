import { test } from 'node:test';
import assert from 'node:assert/strict';
import { padraoAlimentar, repertorioDoGrupo, itensDaDescricao } from '../resumo.js';

const reg = (dia, slot, hora, descricao, kcal, jid = 'a@s') => ({ jid, nome: 'Lucas', dia, slot, hora, descricao, estimativa: kcal ? { kcal, p: 10, c: 10, g: 10 } : null });

test('itensDaDescricao limpa porções, medidas e palavras vazias', () => {
  assert.deepEqual(itensDaDescricao('150 g de arroz branco cozido, 2 ovos mexidos e 1 xícara de café puro'), ['arroz branco cozido', 'ovos mexidos', 'café puro']);
  assert.deepEqual(itensDaDescricao('[foto]'), []);
  assert.deepEqual(itensDaDescricao('boa camada de hommus (generosa) + 100 gramas de cubos de filé'), ['hommus', 'cubos filé']);
});

test('padraoAlimentar lista só as refeições da rotina e marca as ausentes', () => {
  const regs = [];
  for (let d = 1; d <= 10; d++) {
    const dia = `2026-09-${String(d).padStart(2, '0')}`;
    regs.push(reg(dia, 'almoco', '12:40', 'arroz, feijão e frango grelhado', 800));
    if (d % 2 === 0) regs.push(reg(dia, 'jantar', '20:10', 'ovos mexidos com pão', 500));
  }
  regs.push(reg('2026-09-03', 'ceia', '23:30', 'iogurte', 120)); // uma ceia solta em 10 dias não vira rotina
  const p = padraoAlimentar(regs, { periodoDias: 28 });
  assert.equal(p.diasComRegistro, 10);
  assert.deepEqual(Object.keys(p.slots), ['almoco', 'jantar']);
  assert.equal(p.slots.almoco.dias, 10);
  assert.equal(p.slots.almoco.hora, '12:40');
  assert.equal(p.slots.almoco.kcal, 800);
  assert.match(p.slots.almoco.itens.join(', '), /arroz \(10x\)/);
  assert.deepEqual(p.ausentes, ['café da manhã', 'lanche da manhã', 'lanche', 'ceia']);
  assert.match(p.texto, /PADRÃO REAL \(últimos 28 dias\): 10 dia\(s\) com registro/);
  assert.match(p.texto, /- Almoço: em 10 de 10 dias \(quase todo dia\), por volta das 12:40, em média 800 kcal\. Costuma: arroz \(10x\)/);
  assert.match(p.texto, /- Jantar: em 5 de 10 dias \(na maioria dos dias\)/);
  assert.match(p.texto, /NÃO registra: café da manhã, lanche da manhã, lanche, ceia/);
  assert.doesNotMatch(p.texto, /Ceia:/);
});

test('padraoAlimentar sem histórico pede pra perguntar', () => {
  const p = padraoAlimentar([], { periodoDias: 28 });
  assert.equal(p.diasComRegistro, 0);
  assert.deepEqual(p.slots, {});
  assert.match(p.texto, /Sem histórico suficiente/);
});

test('repertorioDoGrupo devolve itens repetidos das outras pessoas, sem a própria', () => {
  const regs = [
    reg('2026-09-01', 'almoco', '12:00', 'arroz e feijão', 600, 'eu@s'),
    reg('2026-09-01', 'almoco', '12:00', 'hommus com pão integral', 400, 'h@s'),
    reg('2026-09-02', 'jantar', '20:00', 'hommus e salada verde', 350, 'h@s'),
    reg('2026-09-02', 'cafe', '09:00', 'chia com tangerina', 200, 'a@s'),
    reg('2026-09-03', 'cafe', '09:00', 'chia e ovos cozidos', 250, 'a@s'),
  ];
  const r = repertorioDoGrupo(regs, { excluirJids: ['eu@s'] });
  assert.deepEqual(r, ['hommus', 'chia']);
});

import { semanaDoPlano, previsaoSemana } from '../resumo.js';
import { pareceAceitePlano } from '../consciencia.js';

test('semanaDoPlano: de sexta a domingo é a semana que vem; nos outros dias começa amanhã', () => {
  const sex = semanaDoPlano('2026-10-02'); // sexta
  assert.equal(sex.inicio, '2026-10-05');
  assert.equal(sex.fim, '2026-10-11');
  assert.equal(sex.proximaSemana, true);
  assert.equal(sex.dias[0].rotulo, 'Segunda 05/10');
  assert.equal(semanaDoPlano('2026-10-04').inicio, '2026-10-05'); // domingo
  const ter = semanaDoPlano('2026-09-29'); // terça
  assert.equal(ter.inicio, '2026-09-30');
  assert.equal(ter.proximaSemana, false);
  assert.equal(ter.dias[6].rotulo, 'Terça 06/10');
});

test('previsaoSemana dá uma faixa por dia da semana a partir do relógio', () => {
  const gastos = {};
  for (let i = 1; i <= 28; i++) {
    const d = new Date(Date.UTC(2026, 8, i, 12));
    const dow = d.getUTCDay();
    gastos[d.toISOString().slice(0, 10)] = dow === 2 || dow === 4 ? 3000 : 2400; // terça e quinta com treino
  }
  const p = previsaoSemana({ gastos, dia: '2026-10-02', objetivo: 'emagrecer', metaAdaptativa: null });
  assert.equal(p.dias.length, 7);
  const ter = p.dias.find((d) => d.nome === 'terça');
  const seg = p.dias.find((d) => d.nome === 'segunda');
  assert.equal(ter.prev.previsto, 3000);
  assert.equal(seg.prev.previsto, 2400);
  assert.ok(ter.prev.alvo.max < 3000 && seg.prev.alvo.max < 2400, 'emagrecer = comer abaixo do gasto');
  assert.match(p.texto, /META POR DIA/);
  assert.match(p.texto, /- Terça 06\/10: gasto previsto 3\.000 kcal/);
  assert.equal(previsaoSemana({ gastos: null, dia: '2026-10-02', objetivo: 'emagrecer' }), null);
});

test('pareceAceitePlano aceita resposta curta ou que fala do plano e extrai o pedido', () => {
  assert.deepEqual(pareceAceitePlano('quero'), { aceite: true, pedido: '' });
  assert.deepEqual(pareceAceitePlano('Bora!'), { aceite: true, pedido: '' });
  assert.deepEqual(pareceAceitePlano('manda aí'), { aceite: true, pedido: '' });
  assert.deepEqual(pareceAceitePlano('quero, orçamento curto e só mercado de bairro'), { aceite: true, pedido: 'orçamento curto e só mercado de bairro' });
  assert.deepEqual(pareceAceitePlano('pode montar o meu plano sem peixe'), { aceite: true, pedido: 'sem peixe' });
  assert.deepEqual(pareceAceitePlano('eu quero o plano, mas sem lactose'), { aceite: true, pedido: 'sem lactose' });
  assert.equal(pareceAceitePlano('eu almocei arroz, feijão e frango').aceite, false);
  assert.equal(pareceAceitePlano('pode me dizer quantas calorias tem isso?').aceite, false);
  assert.equal(pareceAceitePlano('não quero, obrigado').aceite, false);
  assert.equal(pareceAceitePlano('quero saber se essa marmita tá boa pro meu objetivo, comi ela inteira agora').aceite, false);
  assert.equal(pareceAceitePlano('!plano').aceite, false);
});

import { candidatoAFragmento, digitandoRecente } from '../consciencia.js';
test('candidatoAFragmento: anúncio de refeição espera mesmo sem refeição em andamento; papo comum não', () => {
  assert.equal(candidatoAFragmento({ texto: 'Meu almoço hoje vai ser adaptado', minutosDesdeUltima: Infinity }), true);
  assert.equal(candidatoAFragmento({ texto: 'Nao consigo sair do serviço', minutosDesdeUltima: Infinity }), true);
  assert.equal(candidatoAFragmento({ texto: 'vou mandar a janta já já', minutosDesdeUltima: Infinity }), true);
  assert.equal(candidatoAFragmento({ texto: 'bom dia gente', minutosDesdeUltima: Infinity }), false);
  assert.equal(candidatoAFragmento({ texto: 'quantas calorias tem isso?', minutosDesdeUltima: Infinity }), false);
  assert.equal(candidatoAFragmento({ texto: 'vai ser adaptado', temImagem: true, minutosDesdeUltima: Infinity }), false);
  assert.equal(candidatoAFragmento({ texto: 'e uma banana', minutosDesdeUltima: 5 }), true);
  assert.equal(candidatoAFragmento({ texto: '!hoje', minutosDesdeUltima: 5 }), false);
});

test('digitandoRecente: só composing/recording dentro da janela, por qualquer jid da pessoa', () => {
  const agoraMs = 1_000_000;
  const reg = new Map([
    ['1@s.whatsapp.net', { estado: 'composing', em: agoraMs - 4000 }],
    ['2@lid', { estado: 'paused', em: agoraMs - 1000 }],
    ['3@s.whatsapp.net', { estado: 'composing', em: agoraMs - 30_000 }],
  ]);
  assert.equal(digitandoRecente(reg, ['1@s.whatsapp.net'], agoraMs), true);
  assert.equal(digitandoRecente(reg, ['9@s.whatsapp.net', '2@lid'], agoraMs), false);
  assert.equal(digitandoRecente(reg, ['3@s.whatsapp.net'], agoraMs), false);
  assert.equal(digitandoRecente(reg, ['x@lid', '1@s.whatsapp.net'], agoraMs), true);
  assert.equal(digitandoRecente(null, ['1@s.whatsapp.net'], agoraMs), false);
});

import { extrairSintese } from '../reflexao.js';
test('extrairSintese pega o parágrafo "Em uma frase" (ou o último), limpo e curto', () => {
  const t = 'Penso que o Lucas treina cedo e come tarde.\n\nOutro parágrafo com *negrito*.\n\n*Em uma frase:* engenheiro disciplinado de manhã, **frouxo** à noite, que precisa de jantar pronto.\n';
  assert.equal(extrairSintese(t), 'engenheiro disciplinado de manhã, frouxo à noite, que precisa de jantar pronto.');
  assert.equal(extrairSintese('Só um parágrafo, sem marcador.'), 'Só um parágrafo, sem marcador.');
  assert.equal(extrairSintese(''), '');
  assert.ok(extrairSintese('a\n\nEm uma frase: ' + 'x'.repeat(900)).length <= 600);
});

import { fundirHipoteses, aplicarVereditos } from '../reflexao.js';
test('fundirHipoteses e aplicarVereditos: sem duplicar, com teto, fechando confirmadas/refutadas e inconclusivas', () => {
  const abertas = [{ id: 'h1', texto: 'Come mais à noite em dia de faculdade', status: 'aberta', criadaEm: '2026-09-20' }];
  const novas = [{ texto: 'come mais à noite em dia de faculdade!', como_verificar: 'kcal após 20h x dias de UFSC' }, { texto: 'Dorme menos em semana de prova', como_verificar: 'sono do relógio' }];
  const f = fundirHipoteses(abertas, novas, '2026-09-27');
  assert.equal(f.length, 2);
  assert.equal(f[1].texto, 'Dorme menos em semana de prova');
  assert.match(f[1].id, /^h20260927/);
  const muitas = fundirHipoteses([], Array.from({ length: 12 }, (_, i) => ({ texto: `hipótese ${i}` })), '2026-09-27');
  assert.equal(muitas.length, 8);
  const v = aplicarVereditos(f, [{ id: 'h1', veredito: 'confirmada', evidencia: '3 de 3 noites de UFSC acima de 900 kcal' }, { id: f[1].id, veredito: 'aberta', evidencia: 'sem prova esta semana' }], '2026-10-04');
  assert.equal(v.fechadas.length, 1);
  assert.equal(v.fechadas[0].status, 'confirmada');
  assert.equal(v.abertas.length, 1);
  assert.equal(v.abertas[0].semanasAbertas, 1);
  const velha = aplicarVereditos([{ id: 'x', texto: 'nunca decide', status: 'aberta', semanasAbertas: 5 }], [], '2026-10-04');
  assert.equal(velha.abertas.length, 0);
  assert.equal(velha.fechadas[0].status, 'inconclusiva');
});

import { kcalAtividade, lerDias, avaliarPresenca, somarGastosExtras, lerSimNao, duracaoMin } from '../atividades.js';
test('atividades: kcal por MET, dias, presença pela localização, soma no gasto e sim/não', () => {
  assert.equal(kcalAtividade(6, 77, 120), 924);
  assert.deepEqual(lerDias('seg,qua'), [1, 3]);
  assert.deepEqual(lerDias('Qui e sáb'), [4, 6]);
  assert.equal(duracaoMin({ inicio: '17:30', fim: '20:00' }), 150);
  const lugar = { lat: -27.603, lon: -48.5195, raioM: 300 };
  const casa = { lat: -27.5969, lon: -48.5495 };
  const t = (m) => new Date(Date.UTC(2026, 8, 30, 23, m));
  const la = avaliarPresenca({ pontos: [{ ts: t(5), ...casa }, { ts: t(20), lat: -27.6031, lon: -48.5193 }, { ts: t(50), lat: -27.6029, lon: -48.5197 }], lugar, casa, duracao: 120 });
  assert.equal(la.estado, 'presente');
  assert.ok(la.minutosNoLugar >= 40 && la.minutosNoLugar <= 60, `min ${la.minutosNoLugar}`);
  assert.equal(avaliarPresenca({ pontos: [{ ts: t(5), ...casa }, { ts: t(35), ...casa }], lugar, casa }).estado, 'ausente');
  assert.equal(avaliarPresenca({ pontos: [], lugar, casa }).estado, 'incerto');
  assert.equal(avaliarPresenca({ pontos: [{ ts: t(5), lat: -27.598, lon: -48.52 }], lugar, casa }).estado, 'incerto');
  const rel = somarGastosExtras({ gastos: { '2026-09-28': 2500, '2026-09-29': 2400 } }, { '2026-09-28': [{ kcal: 900 }], '2026-09-27': [{ kcal: 500 }] });
  assert.deepEqual(rel.gastos, { '2026-09-28': 3400, '2026-09-29': 2400 });
  assert.equal(lerSimNao('teve sim'), true);
  assert.equal(lerSimNao('não rolou hoje'), false);
  assert.equal(lerSimNao('fui'), true);
  assert.equal(lerSimNao('comi arroz com frango e salada no almoço'), null);
});

import { temasJaDitos, removerRepeticoes, respostasRecentes } from '../consciencia.js';
test('temasJaDitos e removerRepeticoes: clima e sono ditos duas vezes seguidas (30/09) caem na segunda', () => {
  const historico = [
    { hora: '21:06', nome: 'Dona Benta', tipo: 'bot', texto: 'Eita que a quarta-feira tá agitada! Com esse friozinho de 16°C e garoa em Floripa, nada melhor do que uma janta quentinha pra fechar o dia. Manda a foto!' },
    { hora: '21:14', nome: 'Dona Benta', tipo: 'bot', texto: 'Papo reto: não toma agora! Você já mandou 3.633 kcal pra dentro hoje em 6 refeições. E o seu relógio já vem acusando que você dorme menos de 6h por noite, né?' },
    { hora: '19:00', nome: 'Dona Benta', tipo: 'bot', texto: 'Mensagem velha com chuva e frio que já saiu da janela.' },
    { hora: '21:10', nome: 'Lucas', tipo: 'pessoa', texto: 'acabei de comer' },
  ];
  const tema = temasJaDitos(historico, '21:16');
  assert.match(tema, /clima\/temperatura \(1x, última 21:06\)/);
  assert.match(tema, /sono curto \(1x, última 21:14\)/);
  assert.match(tema, /total do dia/);
  assert.equal(respostasRecentes(historico, '21:16').length, 2);
  const resposta =
    'Aí sim, meu engenheiro! Orgulho da nutricionista aqui! 👏✨\n\n' +
    'Como você já bateu 3.633 kcal e impressionantes 239 g de [[Proteína]] hoje, o seu superávit tá garantido.\n\n' +
    'Aliás, falando em sono, o relógio me contou que você dormiu só 5h42 na última noite. Com esse friozinho de 16°C em Floripa, aproveita que tá em casa cedo pra deitar mais cedo. Amanhã 08h20 já tem aula de Cálculo Numérico, então o descanso vai ser o seu maior suplemento.\n\n' +
    '🔥 *Estimativa:*\nCalorias: *950 kcal*\n💡 *Dica:* Agora é só tomar água e dormir.';
  const r = removerRepeticoes(resposta, respostasRecentes(historico, '21:16'), { textoPessoa: 'Vou confiar em vc então e n tomar o hipercalorico' });
  assert.doesNotMatch(r.texto, /16°C|garoa/);
  assert.doesNotMatch(r.texto, /dormiu só 5h42/);
  assert.match(r.texto, /aula de Cálculo/); // agenda ainda não tinha sido citada: primeira menção fica
  assert.match(r.texto, /Orgulho da nutricionista/);
  assert.match(r.texto, /Calorias: \*950 kcal\*/);
  assert.match(r.texto, /💡 \*Dica:\* Agora é só tomar água e dormir\./);
  assert.ok(r.removidas.length >= 2, `removidas: ${r.removidas.length}`);
  // se a pessoa puxou o assunto do sono, o comentário fica
  const r2 = removerRepeticoes('Você dormiu só 5h42 na última noite, por isso a fome.', respostasRecentes(historico, '21:16'), { textoPessoa: 'dormi mal hoje, isso explica a fome?' });
  assert.match(r2.texto, /dormiu só 5h42/);
  // frase quase igual a uma anterior cai
  const r3 = removerRepeticoes('Você já mandou 3.633 kcal pra dentro hoje em 6 refeições, criatura. Bora dormir.', respostasRecentes(historico, '21:16'));
  assert.doesNotMatch(r3.texto, /3\.633/);
  assert.match(r3.texto, /Bora dormir/);
  // sem nada repetido, não mexe
  assert.equal(removerRepeticoes('Boa noite, gente!', []).texto, 'Boa noite, gente!');
});
