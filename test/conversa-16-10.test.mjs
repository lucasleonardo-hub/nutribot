// Ajustes da conversa de 16/10 (pedido do dono): continuação de refeição, foto de balança, histórico com a dica, citação
// com o fim, horário habitual por dia da semana.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/teste';
const { pareceContinuacaoDeRefeicao, citacaoDe } = await import('../mensagens.js');
const { encurtarFala } = await import('../gemini.js');
const { habitualDoDiaDaSemana } = await import('../cobranca.js');

test('continuação de refeição: comida, quantidade ou "tem/sem/era"; agenda e treino não reabrem a refeição', () => {
  for (const t of ['tem também um suco de laranja', 'sem açúcar', 'era integral', '200 g', 'e mais 2 fatias', 'faltou o molho', 'banana', 'com requeijão']) assert.equal(pareceContinuacaoDeRefeicao(t), true, t);
  for (const t of ['N é reunião é academia as 7h', 'Beleza vou subiu a carga', 'Calma que hoje é dia de inglês', 'Meu dia so começa após as 10h', 'valeu', '']) assert.equal(pareceContinuacaoDeRefeicao(t), false, t);
});

test('histórico: fala longa da Nutri guarda o começo, a estimativa e a dica do fim', () => {
  const longa = `Bom dia, Lu! ${'Texto de abertura bem comprido. '.repeat(15)}\n🔥 *Estimativa:* 285 kcal\n⚖️ Veredito: 10/10\n💡 *Dica:* tenta subir aquele Agachamento no Smith pra 52,5 kg conforme a gente planejou.`;
  const r = encurtarFala({ tipo: 'bot', texto: longa });
  assert.match(r, /^Bom dia, Lu!/);
  assert.match(r, /Estimativa:\* 285 kcal/);
  assert.match(r, /Agachamento no Smith pra 52,5 kg/);
  assert.ok(r.length < longa.length);
  assert.equal(encurtarFala({ tipo: 'texto', texto: longa }), longa, 'fala da pessoa não é cortada');
});

test('citação: mensagem longa da Nutri chega com o começo e o fim (a proposta do fim não se perde)', () => {
  const texto = `Bom dia, Lu! ${'abertura '.repeat(60)} 💡 Dica: tenta subir o Agachamento no Smith pra 52,5 kg hoje.`;
  const c = citacaoDe({ extendedTextMessage: { text: 'Beleza vou subir a carga', contextInfo: { quotedMessage: { conversation: texto } } } }, []);
  assert.match(c.texto, /^Bom dia, Lu!/);
  assert.match(c.texto, /52,5 kg hoje\.$/);
  assert.ok(c.texto.length <= 520);
  const curta = citacaoDe({ extendedTextMessage: { text: 'ok', contextInfo: { quotedMessage: { conversation: 'mensagem curta' } } } }, []);
  assert.equal(curta.texto, 'mensagem curta');
});

test('cobrança: horário habitual do dia da semana (sexta de inglês) com 2+ registros; senão null', () => {
  // 16/10/2026 é sexta; sextas anteriores: 09 e 02/10 (café às 11:00 e 11:20), outros dias às 08:40
  const refs = [
    { slot: 'cafe', dia: '2026-10-09', minutos: 660 },
    { slot: 'cafe', dia: '2026-10-02', minutos: 680 },
    { slot: 'cafe', dia: '2026-10-14', minutos: 520 },
    { slot: 'cafe', dia: '2026-10-13', minutos: 520 },
    { slot: 'almoco', dia: '2026-10-09', minutos: 800 },
  ];
  assert.equal(habitualDoDiaDaSemana(refs, 'cafe', '2026-10-16'), 670);
  assert.equal(habitualDoDiaDaSemana(refs, 'almoco', '2026-10-16'), null, 'só 1 sexta');
  assert.equal(habitualDoDiaDaSemana(refs, 'cafe', '2026-10-15'), null, 'quinta: nenhuma');
  assert.equal(habitualDoDiaDaSemana([...refs, { slot: 'cafe', dia: '2026-10-16', minutos: 700 }], 'cafe', '2026-10-16'), 670, 'o próprio dia não entra');
});

test('contestação: "tá doida?", "como assim", "pirou" contam; conversa normal não', async () => {
  const { pareceContestacao } = await import('../consciencia.js');
  for (const t of ['Ontem nao registrei nada? Ta doida?', 'tá doida?', 'como assim?', 'pirou?', 'nada a ver isso', 'eu não disse isso']) assert.equal(pareceContestacao(t), true, t);
  for (const t of ['Meu cafe', 'bom dia', 'hoje comi bem', 'vou subir a carga']) assert.equal(pareceContestacao(t), false, t);
});
