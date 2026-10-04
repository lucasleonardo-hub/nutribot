// Suíte comportamental DETERMINÍSTICA: cada caso é uma situação real que já falhou (ou pode falhar) no grupo, verificada
// contra as guardas em código que cercam o modelo. Roda sem IA e sem banco, em segundos, em todo `npm test`.
// A parte que depende do modelo (prompt + Gemini) fica em avaliacao/ (npm run avaliar), com os mesmos ids de cenário.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const C = await import('../consciencia.js');
const { roteiroDoDia } = await import('../lugares.js');
const { separarAtualizacao } = await import('../gemini.js');
const { podeIntervir } = await import('../proatividade.js');
const { ferramentasPara } = await import('../ferramentas.js');
const { parseJsonTolerante, parecePedidoOuPlano, pareceConsumo, pareceCorrecao } = await import('../util.js');
const { confirmacaoNota } = await import('../despensa.js');
const { projecaoAteMeta, somarDias } = await import('../tendencia.js');
const { corrigirBalanco, ehCorrecaoDeEstimativa } = await import('../calibracao.js');
const { vazouInstrucao } = await import('../voz.js');

const PERSONA = `**MEU TIME**\n* **Lucas / O Engenheiro:** divo da hipertrofia.\n* **Ale / Minha Margarida:** guerreira.\n**PIADAS INTERNAS**\n* **"Apareceu a Margarida":** meu lema quando a Ale brota depois de sumir.`;
const caso = (id, titulo, fn) => test(`${id} ${titulo}`, fn);

// ---------- voz, gênero e gíria ----------
caso('C01', 'vocativo feminino pra homem é corrigido ("amada" pro Heitor)', () => {
  assert.equal(C.concordarVocativos('Só fica de olho na porção, amada! Menina, que lentilha.', { genero: 'masculino', outrosNomes: ['Ale'] }), 'Só fica de olho na porção, amado! Menino, que lentilha.');
});
caso('C02', 'vocativo masculino pra mulher é corrigido ("meu rei" pra Ale)', () => {
  assert.equal(C.concordarVocativos('Fechou bonito, meu rei!', { genero: 'feminino' }), 'Fechou bonito, minha rainha!');
});
caso('C03', 'frase sobre outra pessoa do grupo não é alterada', () => {
  assert.equal(C.concordarVocativos('A Ale, minha guerreira, comeu pouco hoje.', { genero: 'masculino', outrosNomes: ['Ale'] }), 'A Ale, minha guerreira, comeu pouco hoje.');
});
caso('C04', 'gíria com grafia inventada vira a certa ("Arraseu")', () => {
  assert.equal(C.corrigirGirias('Arraseu na escolha!'), 'Arrasou na escolha!');
});
caso('C05', 'bordão já usado hoje é cortado da abertura', () => {
  const historico = [{ tipo: 'bot', hora: '10:20', texto: 'Apareceu a Margarida! Cadê o café?' }];
  const r = C.removerBordoesRepetidos('Apareceu a margarida com o almoço! 🌼 Prato bonito, Ale.', { historico, persona: PERSONA });
  assert.equal(r.removidas.length, 1);
  assert.match(r.texto, /^🌼 Prato bonito, Ale\./);
});
caso('C06', 'bordão na primeira vez do dia passa', () => {
  assert.equal(C.removerBordoesRepetidos('Apareceu a Margarida! Que prato.', { historico: [], persona: PERSONA }).removidas.length, 0);
});
caso('C07', 'cobrança nunca abre com "Apareceu" nem vaza linha técnica', () => {
  const r = C.prepararCobranca('Apareceu a Margarida! Menina, cadê o café?\n\nREFEICAO: {"tipo": "cafe_manha", "kcal": 0}', { genero: 'feminino', persona: PERSONA });
  assert.equal(r.texto, 'Menina, cadê o café?');
});
caso('C08', 'comentário de clima repetido em 2 h sai da resposta', () => {
  const historico = [{ tipo: 'bot', hora: '11:00', texto: 'Com esse friozinho de 17°C em Floripa, sopa cai bem.' }];
  const r = C.removerRepeticoes('Bora de almoço! Esse friozinho de 17 graus em Floripa pede uma sopa quentinha. O prato tá ótimo e bem servido.', C.respostasRecentes(historico, '12:30'), { textoPessoa: 'almoço de hoje' });
  assert.doesNotMatch(r.texto, /friozinho|graus/);
  assert.match(r.texto, /O prato tá ótimo/);
});
caso('C33', 'registro hétero de academia não entra na correção automática (fica pro prompt), mas o chulo é detectável', () => {
  assert.equal(C.corrigirGirias('papo reto, brabo'), 'papo reto, brabo'); // não é grafia errada: é regra de prompt, testada em avaliacao/
});

// ---------- lugares ----------
const lugares = [
  { id: 'quadra', tipo: 'quadra de vôlei de areia', nome: 'Arena', diasIdx: [6], horaTipica: 9.9, horaFim: 12.6, dias: 3, manual: true, ultimaVez: '2026-08-15' },
  { id: 'mae', tipo: 'casa', nome: 'da mãe', diasIdx: [6], horaTipica: 12.4, horaFim: 15.1, dias: 8, manual: true, ultimaVez: '2026-09-19' },
  { id: 'senac', tipo: 'faculdade', nome: 'Senac', diasIdx: [6], horaTipica: 18.8, horaFim: 19.1, dias: 4, porDow: [0, 0, 0, 0, 0, 0, 2], ultimaVez: '2026-09-26' },
];
const baseRoteiro = { lugares, agenda: [], treinos: [], dow: 6, nomeDia: 'sábado', dia: '2026-10-03' };
caso('C09', 'em casa o dia todo: o roteiro não afirma que a pessoa foi aos lugares do padrão', () => {
  const r = roteiroDoDia({ ...baseRoteiro, horaAgora: 17.5, situacao: { estado: 'casa', desde: '11:29' }, visitasHoje: [] });
  assert.match(r, /^AGORA \(celular, isto é FATO\): em casa/);
  assert.match(r, /NÃO ACONTECEU HOJE[^\n]*casa da mãe/);
  assert.doesNotMatch(r, /✓/);
});
caso('C10', 'lugar sem ida há mais de 5 semanas fica fora do roteiro', () => {
  assert.doesNotMatch(roteiroDoDia({ ...baseRoteiro, horaAgora: 8 }), /Arena/);
});
caso('C11', 'passagem de 18 minutos não vira parada do roteiro', () => {
  assert.doesNotMatch(roteiroDoDia({ ...baseRoteiro, horaAgora: 8 }), /Senac/);
});
caso('C12', 'sem sinal do celular, nada é dado como "não foi"', () => {
  const r = roteiroDoDia({ ...baseRoteiro, horaAgora: 17.5, situacao: { estado: 'sem_sinal' } });
  assert.doesNotMatch(r, /NÃO ACONTECEU/);
});

// ---------- objetivo ----------
caso('C13', 'vocabulário do objetivo oposto é detectado e a frase sai', () => {
  const termos = C.vocabularioErrado('Capricha no carbo pro superávit!', 'emagrecer e definir');
  assert.deepEqual(termos, ['superávit']);
  assert.doesNotMatch(C.removerFrasesCom('Bom prato. Capricha no carbo pro superávit! Segue firme.', termos), /superávit/);
});
caso('C14', '"Hipertrofia com definição, mantendo a gordura" é ganho, não perda', () => {
  assert.equal(C.ladoDoObjetivo('Hipertrofia com definição: ganhar massa, mantendo o percentual de gordura'), 'ganho');
  assert.deepEqual(C.vocabularioErrado('bora de superávit pra [[hipertrofia]]', 'Hipertrofia com definição, mantendo o percentual de gordura'), []);
});

// ---------- o que a mensagem é ----------
caso('C15', 'pergunta e pedido vão pelo caminho com ferramentas', () => {
  assert.equal(C.parecePergunta('como está meu ritmo essa semana?'), true);
  assert.equal(C.parecePergunta('me diz o que tenho pra jantar com o que tem em casa'), true);
});
caso('C16', 'relato de consumo não é pergunta', () => {
  assert.equal(C.parecePergunta('comi 2 ovos e pão, tá bom?'), false);
});
caso('C17', 'comando não é pergunta', () => {
  assert.equal(C.parecePergunta('!tendencia?'), false);
});
caso('C34', 'plano não é consumo; consumo não é plano; correção é correção', () => {
  assert.equal(parecePedidoOuPlano('o lanche ia ser iogurte'), true);
  assert.equal(pareceConsumo('o lanche ia ser iogurte'), false);
  assert.equal(pareceConsumo('comi um iogurte agora'), true);
  assert.equal(pareceCorrecao('na verdade eram 3 fatias'), true);
});
caso('C35', 'aceite do plano: "quero" sim; "pode me dizer as calorias?" não; conversa sobre o sistema é meta', () => {
  assert.equal(C.pareceAceitePlano('quero').aceite, true);
  assert.equal(C.pareceAceitePlano('pode me dizer as calorias do pão?').aceite, false);
  assert.equal(C.pareceMetaConversa('vou ajustar isso no código do bot amanhã'), true);
});
caso('C36', 'papo curto recebe resposta curta, sem Dica', () => {
  assert.equal(C.papoCurto('hehe', {}), true);
  const enxuta = C.enxugarPapo('Kkkk adorei! 😂\n\n💡 *Dica:* coma mais proteína.\nE mais uma frase longa sobre o treino de amanhã.');
  assert.doesNotMatch(enxuta, /Dica/);
});

// ---------- linhas ocultas: incerteza e pergunta ----------
caso('C18', 'INCERTEZA e PERGUNTA saem do texto e viram campos', () => {
  const r = separarAtualizacao('Prato bonito! Quantas fatias de pão foram?\nREFEICAO: {"tipo": "cafe", "itens": "pão com queijo", "kcal": 320, "proteina": 12, "carbo": 40, "gordura": 10, "correcao": false}\nINCERTEZA: alta\nPERGUNTA: quantas fatias de pão foram?');
  assert.equal(r.incerteza, 'alta');
  assert.equal(r.pergunta, 'quantas fatias de pão foram?');
  assert.equal(r.refeicao?.kcal, 320);
  assert.doesNotMatch(r.texto, /INCERTEZA|PERGUNTA:|REFEICAO/);
  assert.match(r.texto, /Quantas fatias de pão foram\?/);
});
caso('C19', 'resposta sem linhas ocultas passa intacta', () => {
  const r = separarAtualizacao('Tudo certo, meu engenheiro! Bora de jantar leve.');
  assert.equal(r.texto, 'Tudo certo, meu engenheiro! Bora de jantar leve.');
  assert.equal(r.incerteza, null);
  assert.equal(r.pergunta, null);
});

// ---------- proatividade ----------
const prob = { hora: '15:10', dia: '2026-10-03', hojeNoGrupo: 0, ultimas: [], mensagensBotHoje: [], assunto: 'jantar tarde depois do vôlei', confianca: 0.8, minutosDesdeMsgPessoa: 200 };
caso('C20', 'no máximo uma intervenção por dia', () => assert.equal(podeIntervir({ ...prob, hojeNoGrupo: 1 }).ok, false));
caso('C21', 'nada de intervenção fora de 8h-21h', () => assert.equal(podeIntervir({ ...prob, hora: '22:30' }).ok, false));
caso('C22', 'assunto já dito hoje no grupo não vira intervenção', () => assert.equal(podeIntervir({ ...prob, mensagensBotHoje: ['Lucas, o jantar saiu tarde depois do vôlei de novo'] }).ok, false));
caso('C23', 'três intervenções ignoradas seguidas = pausa de 3 dias', () => {
  const ign = ['2026-10-02', '2026-10-01', '2026-09-30'].map((dia, k) => ({ dia, respondida: false, assunto: `x${k}` }));
  assert.equal(podeIntervir({ ...prob, ultimas: ign }).ok, false);
});
caso('C24', 'a pessoa acabou de falar: responde no fluxo, não intervém', () => assert.equal(podeIntervir({ ...prob, minutosDesdeMsgPessoa: 5 }).ok, false));
caso('C37', 'intervenção com tudo certo passa', () => assert.equal(podeIntervir(prob).ok, true));

// ---------- memória seletiva (ação anotar_memoria) ----------
const perfilAnot = { nome: 'Lucas Leonardo', jids: [], anotacoes: [{ dia: '2026-09-20', tipo: 'aversao', texto: 'Lucas odeia beterraba cozida' }] };
caso('C25', 'informação temporária não vira memória de longo prazo', async () => {
  const f = ferramentasPara(perfilAnot, { dia: '2026-10-03', escrita: true });
  assert.match(await f.executar('anotar_memoria', { texto: 'Lucas almoçou empadão hoje às 14h45', tipo: 'contexto', validade: 'temporaria' }), /não guardei: coisa temporária/);
});
caso('C26', 'anotação curta demais não é guardada', async () => {
  const f = ferramentasPara(perfilAnot, { dia: '2026-10-03', escrita: true });
  assert.match(await f.executar('anotar_memoria', { texto: 'ovo', tipo: 'preferencia' }), /curto demais/);
});
caso('C27', 'anotação repetida não duplica a memória', async () => {
  const f = ferramentasPara(perfilAnot, { dia: '2026-10-03', escrita: true });
  assert.match(await f.executar('anotar_memoria', { texto: 'Lucas odeia beterraba cozida no almoço', tipo: 'aversao' }), /já estava anotado/);
});
caso('C28', 'ferramentas de escrita só aparecem quando pedidas; leitura só do que a pessoa tem', () => {
  const soLeitura = ferramentasPara(perfilAnot, { dia: '2026-10-03' }).declaracoes.map((d) => d.name);
  assert.ok(!soLeitura.includes('anotar_memoria') && !soLeitura.includes('relogio'));
  const comEscrita = ferramentasPara(perfilAnot, { dia: '2026-10-03', escrita: true }).declaracoes.map((d) => d.name);
  assert.ok(comEscrita.includes('anotar_memoria') && comEscrita.includes('atualizar_perfil'));
});

// ---------- robustez de dados ----------
caso('C29', 'JSON cortado pelo limite de saída não perde a lista inteira', () => {
  assert.deepEqual(parseJsonTolerante('[{"nome":"arroz"},{"nome":"feij'), [{ nome: 'arroz' }]);
});
caso('C30', 'cupom no grupo só confirma, sem listar o que a pessoa comprou', () => {
  const t = confirmacaoNota({ loja: 'Bistek', dia: '2026-10-02', itens: [{ item: 'arroz', perecivel: false }, { item: 'frango', perecivel: true }] });
  assert.match(t, /Cupom recebido/);
  assert.doesNotMatch(t, /arroz|frango/);
});
caso('C31', 'ritmo: veredito pela data de chegada e incerteza declarada', () => {
  const pes = [];
  for (let d = 55; d >= 0; d -= 2) pes.push({ dia: somarDias('2026-10-03', -d), peso: Math.round((74 + (0.25 * (55 - d)) / 7) * 100) / 100, gordura: 18.5 });
  const p = projecaoAteMeta({ perfil: { nome: 'Lucas', objetivo: 'Hipertrofia', metaPeso: 80, metaPrazo: '2027-01-15', metaModo: 'etapa' }, dia: '2026-10-03', pesagens: pes, faixa: { ritmoKgSemana: 0.3 } });
  assert.equal(p.status, 'abaixo');
  assert.ok(p.incerteza >= 0.06);
  assert.match(p.textoCurto, /incerteza ±/);
});
caso('C32', 'calibração só corrige com confiança suficiente', () => {
  assert.equal(corrigirBalanco(800, { energia: { viesKcalDia: 400, confianca: 0.25 } }).aplicado, false);
  assert.equal(corrigirBalanco(800, { energia: { viesKcalDia: 400, confianca: 1 } }).valor, 400);
});

// ---------- voz ----------
caso('C38', 'instrução de estilo lida em voz alta é detectada na transcrição', () => {
  const fala = 'Sexta-feira chegou, meu time! Vamos ao placar da semana.';
  assert.equal(vazouInstrucao('Diga com voz jovem, calorosa e bem-humorada. Sexta-feira chegou, meu time! Vamos ao placar da semana.', fala).vazou, true);
  assert.equal(vazouInstrucao('Sexta-feira chegou, meu time! Vamos ao placar da semana.', fala).vazou, false);
});

// ---------- parser das linhas ocultas ----------
caso('C48', 'resposta "SILENCIO" (ou vazia) não derruba o parser: texto null e nada mais', () => {
  // 04/10 (avaliação C26b): o modelo leve respondeu SILENCIO e separarAtualizacao lançava TypeError no .match da ATIVIDADE
  for (const bruto of ['SILENCIO', 'silencio.', '', null, undefined]) {
    const r = separarAtualizacao(bruto);
    assert.equal(r.texto, null, JSON.stringify(bruto));
    assert.equal(r.refeicao, null);
    assert.equal(r.atividade, null);
  }
  // linhas ocultas depois do texto continuam sendo extraídas na ordem de sempre
  const r = separarAtualizacao('Fechou!\nATIVIDADE: {"nome":"vôlei","feita":true}\nINCERTEZA: alta\nPERGUNTA: quantas fatias?');
  assert.equal(r.texto, 'Fechou!');
  assert.equal(r.atividade.nome, 'vôlei');
  assert.equal(r.incerteza, 'alta');
  assert.equal(r.pergunta, 'quantas fatias?');
  // só linha oculta, sem texto visível: texto null, mas o dado vem
  const so = separarAtualizacao('REFEICAO: {"tipo":"lanche","itens":"1 banana","kcal":90,"proteina":1}');
  assert.equal(so.texto, null);
  assert.equal(so.refeicao.kcal, 90);
});

// ---------- calibração: o que conta como correção de estimativa ----------
caso('C49', 'acréscimo de item não vira "erro de estimativa"; quantidade, alimento e rótulo viram', () => {
  for (const t of ['na verdade foram 3 fatias', 'eram 2 pães', 'não é picanha, é fígado', 'segue a tabela do hipercalórico, dá uma ajustada', 'esqueci de falar: eram 3 fatias', 'foi só 100 g de arroz', 'tá muito alto isso, metade disso']) {
    assert.equal(ehCorrecaoDeEstimativa(t), true, t);
  }
  for (const t of ['tem também um suco de laranja', 'esqueci do suco', 'e mais um ovo', 'junto tinha uma salada', '', null]) {
    assert.equal(ehCorrecaoDeEstimativa(t), false, String(t));
  }
});
