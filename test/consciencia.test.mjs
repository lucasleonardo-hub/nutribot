import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bordoesDaPersona, bordoesUsados, bordoesJaDitos, removerBordoesRepetidos, corrigirGirias, concordarVocativos, prepararCobranca } from '../consciencia.js';

const PERSONA = `**PIADAS INTERNAS & BABADOS DO GRUPO**

*   **"Apareceu a Margarida":** Meu lema oficial toda vez que a Ale brota no grupo depois de horas sumida no trabalho.
*   **"O Engenheiro":** Lucas e a mania de calcular tudo.
*   **"A mortadela da salvação":** A nova pérola do Lucas pro pós-treino improvisado.`;

test('bordoesDaPersona: frases em negrito entre aspas com 3+ palavras', () => {
  assert.deepEqual(bordoesDaPersona(PERSONA), ['Apareceu a Margarida', 'A mortadela da salvação']);
  assert.deepEqual(bordoesDaPersona(''), []);
});

test('bordoesUsados/bordoesJaDitos: conta nas mensagens do bot de hoje', () => {
  const historico = [
    { tipo: 'bot', hora: '10:20', texto: 'Apareceu a Margarida! 🌼 Menina, onde é que você se meteu?' },
    { tipo: 'texto', hora: '10:23', nome: 'Ale', texto: 'Dois ovos cozidos' },
    { tipo: 'bot', hora: '11:39', texto: 'Apareceu a margarida com o café da manhã de respeito! 🌼 Menina, arrasou.' },
  ];
  const usados = bordoesUsados(historico, PERSONA);
  assert.equal(usados.length, 1);
  assert.equal(usados[0].n, 2);
  assert.equal(usados[0].ultima, '11:39');
  assert.match(bordoesJaDitos(historico, PERSONA), /"Apareceu a Margarida" \(2x, última 11:39\)/);
  assert.equal(bordoesJaDitos([], PERSONA), '');
});

test('removerBordoesRepetidos: a frase que abre com bordão já usado hoje sai; o resto e o bloco ficam', () => {
  const historico = [{ tipo: 'bot', hora: '10:20', texto: 'Apareceu a Margarida! Já era hora.' }];
  const r = removerBordoesRepetidos(
    'Apareceu a margarida com o café da manhã de respeito! 🌼 Menina, arrasou demais nessa escolha, a gente ama!\n🕐 *Refeição:* café da manhã',
    { historico, persona: PERSONA }
  );
  assert.equal(r.removidas.length, 1);
  assert.equal(r.texto, '🌼 Menina, arrasou demais nessa escolha, a gente ama!\n🕐 *Refeição:* café da manhã');
  // primeira vez no dia: passa
  const ok = removerBordoesRepetidos('Apareceu a Margarida! Que prato.', { historico: [], persona: PERSONA });
  assert.equal(ok.removidas.length, 0);
  assert.equal(ok.texto, 'Apareceu a Margarida! Que prato.');
});

test('removerBordoesRepetidos em cobrança: qualquer "Apareceu…" sai, mesmo na primeira vez do dia', () => {
  const r = removerBordoesRepetidos('Apareceu a Margarida! 🌼 Menina, onde é que você se meteu essa hora? Me manda o café!', { historico: [], persona: PERSONA, cobranca: true });
  assert.equal(r.removidas.length, 1);
  assert.equal(r.texto, '🌼 Menina, onde é que você se meteu essa hora? Me manda o café!');
});

test('corrigirGirias: "Arraseu" vira "Arrasou" mantendo a caixa', () => {
  assert.equal(corrigirGirias('Arraseu na escolha da lentilha! Você arraseu mesmo.'), 'Arrasou na escolha da lentilha! Você arrasou mesmo.');
  assert.equal(corrigirGirias('arrasou demais'), 'arrasou demais');
});

test('concordarVocativos: vocativo feminino pra homem vira masculino; frase sobre outra pessoa não muda', () => {
  const t = 'Só fica de olho que a porção pesou um pouco, amada! Menina, que lentilha. A Ale, minha guerreira, comeu pouco. Você é uma diva, minha guerreira!';
  const r = concordarVocativos(t, { genero: 'masculino', outrosNomes: ['Ale', 'Lucas'] });
  assert.equal(r, 'Só fica de olho que a porção pesou um pouco, amado! Menino, que lentilha. A Ale, minha guerreira, comeu pouco. Você é uma diva, meu guerreiro!');
  // mulher: "meu rei" vira "minha rainha"; sem gênero (ou "outro") não mexe
  assert.equal(concordarVocativos('Fechou bonito, meu rei!', { genero: 'feminino' }), 'Fechou bonito, minha rainha!');
  assert.equal(concordarVocativos('Fechou bonito, amada!', { genero: 'outro' }), 'Fechou bonito, amada!');
  assert.equal(concordarVocativos('Fechou bonito, amada!', {}), 'Fechou bonito, amada!');
});

test('prepararCobranca: tira linha técnica e bordão de chegada, conserta gíria', () => {
  const msg = 'Apareceu a Margarida! 🌼 Menina, cadê o café? Arraseu ontem, mas hoje sumiu.\n\nREFEICAO: {"tipo": "cafe_manha", "itens": "", "kcal": 0}';
  const r = prepararCobranca(msg, { genero: 'feminino', outrosNomes: ['Lucas', 'Heitor'], persona: PERSONA });
  assert.equal(r.texto, '🌼 Menina, cadê o café? Arrasou ontem, mas hoje sumiu.');
  assert.equal(r.removidas.length, 1);
});
