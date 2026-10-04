import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { podeIntervir, LIMITE_POR_DIA } = await import('../proatividade.js');

const base = { hora: '15:10', dia: '2026-10-03', hojeNoGrupo: 0, ultimas: [], mensagensBotHoje: [], assunto: 'jantar tarde depois do vôlei', confianca: 0.8, minutosDesdeMsgPessoa: 200 };

test('podeIntervir: caso bom passa; cada freio barra com motivo claro', () => {
  assert.equal(LIMITE_POR_DIA, 1);
  assert.deepEqual(podeIntervir(base), { ok: true, motivo: 'vale falar' });
  assert.match(podeIntervir({ ...base, hora: '07:40' }).motivo, /fora do horário/);
  assert.match(podeIntervir({ ...base, hora: '21:00' }).motivo, /fora do horário/);
  assert.match(podeIntervir({ ...base, hojeNoGrupo: 1 }).motivo, /já houve intervenção hoje/);
  assert.match(podeIntervir({ ...base, confianca: 0.5 }).motivo, /confiança 0.5 abaixo/);
  assert.match(podeIntervir({ ...base, minutosDesdeMsgPessoa: 10 }).motivo, /acabou de falar/);
});

test('podeIntervir: pausa de 3 dias quando as últimas 3 foram ignoradas; volta depois da pausa', () => {
  const ignoradas = [
    { dia: '2026-10-02', respondida: false, assunto: 'x1' },
    { dia: '2026-10-01', respondida: false, assunto: 'x2' },
    { dia: '2026-09-30', respondida: false, assunto: 'x3' },
  ];
  assert.match(podeIntervir({ ...base, ultimas: ignoradas }).motivo, /ignoradas: pausa de 3 dias/);
  // a mais recente já tem mais de 3 dias: a pausa acabou
  const antigas = ignoradas.map((i, k) => ({ ...i, dia: `2026-09-${28 - k}` }));
  assert.equal(podeIntervir({ ...base, ultimas: antigas }).ok, true);
  // uma delas foi respondida: sem pausa
  const umaRespondida = [{ ...ignoradas[0], respondida: true }, ignoradas[1], ignoradas[2]];
  assert.equal(podeIntervir({ ...base, ultimas: umaRespondida }).ok, true);
});

test('podeIntervir: assunto repetido (intervenção recente ou mensagem do bot hoje) não passa', () => {
  const ultimas = [{ dia: '2026-10-01', respondida: true, assunto: 'jantar tarde depois do vôlei', texto: '' }];
  assert.match(podeIntervir({ ...base, ultimas }).motivo, /já tratado numa intervenção/);
  // intervenção com o mesmo assunto, mas há mais de 7 dias: pode
  assert.equal(podeIntervir({ ...base, ultimas: [{ ...ultimas[0], dia: '2026-09-20' }] }).ok, true);
  const bot = ['Lucas, vi que o jantar saiu tarde depois do vôlei de novo, bora adiantar?'];
  assert.match(podeIntervir({ ...base, mensagensBotHoje: bot }).motivo, /já apareceu hoje no grupo/);
  // assunto diferente passa mesmo com mensagens do bot hoje
  assert.equal(podeIntervir({ ...base, mensagensBotHoje: ['Bom dia, meu engenheiro! Café da manhã registrado.'] }).ok, true);
});
