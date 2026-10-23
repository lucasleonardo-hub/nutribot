// Claude como primeiro modelo do gerar() (claude.js): quem passa por ele (escopo, admin, áudio) e a conversão do histórico do
// Gemini (functionCall/functionResponse, com e sem o conteúdo bruto do Claude) para o formato de mensagens da Anthropic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeAtende, comoAdmin, pedidoDoAdmin, paraMensagens, gerarClaude, carregarUsoClaude, tetoDeHoje, _usarColecao } from '../claude.js';
import { tipoDaMensagem, cosseno, escolherExemplos, blocoExemplos } from '../exemplos.js';

/** Cliente de mentira: devolve a mensagem dada (o Claude "desobediente" dos testes) e guarda o pedido. */
function clienteFalso(content, stop_reason = 'end_turn', extra = {}) {
  const pedidos = [];
  return {
    pedidos,
    messages: { stream: (p) => (pedidos.push(p), { finalMessage: async () => ({ content, stop_reason, usage: {}, ...extra }) }) },
  };
}
const texto = (t) => [{ type: 'text', text: t }];

async function comEnv(vars, fn) {
  const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('sem chave ou com escopo off, ninguém passa pelo Claude', async () => {
  await comEnv({ ANTHROPIC_API_KEY: '', CLAUDE_ESCOPO: 'tudo' }, () => assert.equal(claudeAtende({}, 'oi'), false));
  await comEnv({ ANTHROPIC_API_KEY: 'x', CLAUDE_ESCOPO: 'off' }, () => assert.equal(claudeAtende({ pensar: 'alto' }, 'oi'), false));
});

test('escopo admin: conversa comum não, tarefa que cruza dados sim, pedido do admin sim', async () => {
  await comEnv({ ANTHROPIC_API_KEY: 'x', CLAUDE_ESCOPO: 'admin', CLAUDE_CRUZAR: '' }, async () => {
    assert.equal(claudeAtende({}, 'oi'), false);
    assert.equal(claudeAtende({ cruzar: true }, 'x'), true);
    assert.equal(claudeAtende({ pensar: 'alto' }, 'x'), true);
    await comoAdmin(async () => {
      await new Promise((r) => setTimeout(r, 1));
      assert.equal(pedidoDoAdmin(), true);
      assert.equal(claudeAtende({}, 'oi'), true);
    });
    assert.equal(pedidoDoAdmin(), false);
  });
  await comEnv({ ANTHROPIC_API_KEY: 'x', CLAUDE_ESCOPO: 'admin', CLAUDE_CRUZAR: 'off' }, () => assert.equal(claudeAtende({ cruzar: true }, 'x'), false));
});

test('áudio vai direto pro Gemini, mesmo com escopo tudo', async () => {
  await comEnv({ ANTHROPIC_API_KEY: 'x', CLAUDE_ESCOPO: 'tudo' }, () => {
    assert.equal(claudeAtende({}, [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/ogg', data: '' } }] }]), false);
    assert.equal(claudeAtende({}, [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: '' } }] }]), true);
  });
});

test('string e partes viram uma mensagem de usuário; foto e PDF viram blocos', () => {
  assert.deepEqual(paraMensagens('oi'), [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }]);
  const [m] = paraMensagens([{ text: 'olha' }, { inlineData: { mimeType: 'image/png', data: 'AAA' } }, { inlineData: { mimeType: 'application/pdf', data: 'BBB' } }]);
  assert.deepEqual(m.content.map((b) => b.type), ['text', 'image', 'document']);
});

test('rodada vinda do Claude volta com o conteúdo bruto (raciocínio incluso) e os ids dele', () => {
  const bruto = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'toolu_1', name: 'pesagens', input: {} }];
  const modelo = { role: 'model', parts: [{ functionCall: { id: 'toolu_1', name: 'pesagens', args: {} } }] };
  Object.defineProperty(modelo, '_claude', { value: bruto, enumerable: false });
  const msgs = paraMensagens([
    { role: 'user', parts: [{ text: 'como tá meu peso?' }] },
    modelo,
    { role: 'user', parts: [{ functionResponse: { id: 'toolu_1', name: 'pesagens', response: { resultado: '81 kg' } } }] },
  ]);
  assert.equal(msgs[1].content, bruto);
  assert.deepEqual(msgs[2].content, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '81 kg' }]);
  assert.equal(JSON.stringify(modelo).includes('thinking'), false); // não vaza pro Gemini se ele assumir a rodada seguinte
});

test('rodada vinda do Gemini (sem id) ganha ids casados por ordem; raciocínio do Gemini fica de fora', () => {
  const msgs = paraMensagens([
    { role: 'user', parts: [{ text: 'e o treino?' }] },
    { role: 'model', parts: [{ text: 'pensando', thought: true }, { functionCall: { name: 'treinos', args: {} } }, { functionCall: { name: 'pesagens', args: { dias: 7 } } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'treinos', response: { resultado: 'supino' } } }, { functionResponse: { name: 'pesagens', response: { resultado: { kg: 81 } } } }] },
  ]);
  const usos = msgs[1].content;
  assert.deepEqual(usos.map((b) => b.type), ['tool_use', 'tool_use']);
  assert.deepEqual(msgs[2].content.map((b) => b.tool_use_id), usos.map((b) => b.id));
  assert.equal(msgs[2].content[1].content, '{"kg":81}');
});

// Dublês desobedientes: toda resposta que não cumpre o contrato tem de LANÇAR (o gerar() então cai pro Gemini), nunca
// chegar ao grupo vazia, recusada, cortada num documento estrito ou com JSON quebrado.
test('Claude desobediente: vazio, recusa, JSON quebrado, cortado em estrito e fora do formato lançam', async () => {
  await assert.rejects(gerarClaude({ contents: 'oi', _cliente: clienteFalso(texto('  ')) }), /vazio/);
  await assert.rejects(gerarClaude({ contents: 'oi', _cliente: clienteFalso([], 'refusal', { stop_details: { category: 'bio' } }) }), /recusou \(bio\)/);
  await assert.rejects(gerarClaude({ contents: 'x', config: { responseMimeType: 'application/json' }, _cliente: clienteFalso(texto('{"a": ')) }), SyntaxError);
  await assert.rejects(gerarClaude({ contents: 'x', config: { estrito: true }, _cliente: clienteFalso(texto('plano pela met'), 'max_tokens') }), (e) => e.cortada === true);
  await assert.rejects(gerarClaude({ contents: 'x', config: { validar: () => false }, _cliente: clienteFalso(texto('ok')) }), (e) => e.invalida === true);
});

test('JSON com cercas de código sai limpo; pedido leva o esquema, o effort e as ferramentas desligadas na última rodada', async () => {
  const c = clienteFalso(texto('```json\n[{"item":"ovo"}]\n```'));
  const r = await gerarClaude({ contents: 'x', config: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { q: { type: 'NUMBER', nullable: true } } } }, pensar: 'alto', tools: [{ functionDeclarations: [{ name: 'f', parameters: { type: 'OBJECT', properties: {} } }] }], toolConfig: { functionCallingConfig: { mode: 'NONE' } } }, _cliente: c });
  assert.equal(r, '[{"item":"ovo"}]');
  const p = c.pedidos[0];
  assert.equal(p.output_config.effort, 'high');
  assert.match(p.system[0].text, /"q":\{"type":\["number","null"\]\}/);
  assert.deepEqual(p.tool_choice, { type: 'none' });
  assert.equal('temperature' in p, false); // o Opus 5.5 recusa temperature
});

test('pediu ferramenta: volta no formato do Gemini, com o conteúdo bruto escondido do JSON', async () => {
  const bruto = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'toolu_9', name: 'pesagens', input: { dias: 7 } }];
  const r = await gerarClaude({ contents: 'x', config: { bruto: true, tools: [{ functionDeclarations: [{ name: 'pesagens' }] }] }, _cliente: clienteFalso(bruto, 'tool_use') });
  assert.deepEqual(r.chamadas, [{ id: 'toolu_9', name: 'pesagens', args: { dias: 7 } }]);
  assert.equal(r.conteudo._claude, bruto);
  assert.equal(JSON.stringify(r.conteudo).includes('signature'), false);
});

test('teto do dia: passou do teto, o pedido vai pro Gemini', async () => {
  await comEnv({ ANTHROPIC_API_KEY: 'x', CLAUDE_ESCOPO: 'tudo', CLAUDE_TETO_USD_DIA: '0.000001' }, async () => {
    assert.equal(claudeAtende({}, 'oi'), true);
    await gerarClaude({ contents: 'x', _cliente: clienteFalso(texto('ok'), 'end_turn', { usage: { input_tokens: 1000, output_tokens: 10 } }) });
    assert.equal(claudeAtende({}, 'oi'), false);
  });
});

// Orçamento do mês: o teto de hoje é o que sobra dividido pelos dias que faltam; o gasto vem do Mongo (não zera no deploy)
test('orçamento do mês: sobra dividida pelos dias que faltam, lida do Mongo', async () => {
  await comEnv({ CLAUDE_ORCAMENTO_MES_USD: '100', CLAUDE_TETO_USD_DIA: '' }, async () => {
    const docs = [{ _id: '2026-10-01', usd: 40 }, { _id: '2026-10-22', usd: 20 }, { _id: '2026-10-23', usd: 1.5, chamadas: 30 }, { _id: '2026-09-30', usd: 99 }];
    _usarColecao({ find: (q) => ({ toArray: async () => docs.filter((d) => new RegExp(q._id.$regex).test(d._id)) }) });
    await carregarUsoClaude('2026-10-23');
    // 100 - (40 + 20) = 40 pros 9 dias de 23 a 31 de outubro; setembro não conta
    assert.equal(tetoDeHoje('2026-10-23').toFixed(3), (40 / 9).toFixed(3));
    // primeiro dia do mês seguinte: o mês todo de novo, dividido por 30
    assert.equal(tetoDeHoje('2026-11-01').toFixed(3), (100 / 30).toFixed(3));
    _usarColecao(null);
  });
  await comEnv({ CLAUDE_ORCAMENTO_MES_USD: '100', CLAUDE_TETO_USD_DIA: '2' }, async () => assert.equal(tetoDeHoje('2026-11-01'), 2)); // limite extra vence
  // começou no dia 23: outubro tem só 9/31 do orçamento; o gasto de antes (40 + 20, de outro uso da chave) já passa disso
  await comEnv({ CLAUDE_ORCAMENTO_MES_USD: '100', CLAUDE_TETO_USD_DIA: '', CLAUDE_INICIO: '2026-10-23' }, async () => {
    assert.equal(tetoDeHoje('2026-10-23'), 0);
    assert.equal(tetoDeHoje('2026-11-01').toFixed(3), (100 / 30).toFixed(3));
  });
  await comEnv({ CLAUDE_ORCAMENTO_MES_USD: '0', CLAUDE_TETO_USD_DIA: '' }, async () => assert.equal(tetoDeHoje('2026-11-01'), Infinity));
});

// Exemplos do Claude pro Gemini (exemplos.js)
test('tipo da mensagem segue as mesmas decisões do prompt', () => {
  assert.equal(tipoDaMensagem({ perguntaProgresso: true, temImagem: true }), 'progresso');
  assert.equal(tipoDaMensagem({ temImagem: true }), 'foto');
  assert.equal(tipoDaMensagem({ planejando: true }), 'opiniao');
  assert.equal(tipoDaMensagem({ contestacao: true }), 'contestacao');
  assert.equal(tipoDaMensagem({}), 'conversa');
});

test('escolha dos exemplos: significado primeiro, bônus pro mesmo tipo, sem repetir resposta', () => {
  assert.equal(cosseno([1, 0], [1, 0]), 1);
  assert.equal(cosseno([1, 0], [0, 1]), 0);
  assert.equal(cosseno([1], [1, 2]), 0);
  const c = [
    { tipo: 'foto', resposta: 'A', vetor: [1, 0] },
    { tipo: 'conversa', resposta: 'B', vetor: [0.9, 0.1] },
    { tipo: 'conversa', resposta: 'B', vetor: [0.9, 0.1] },
    { tipo: 'conversa', resposta: 'C', vetor: [0, 1] },
  ];
  assert.deepEqual(escolherExemplos(c, [1, 0], 'conversa', 2).map((e) => e.resposta), ['B', 'A']);
});

test('bloco de exemplos manda imitar o jeito e proíbe copiar números', () => {
  assert.equal(blocoExemplos([]), '');
  const b = blocoExemplos([{ tipo: 'foto', dia: '2026-10-20', mensagem: 'almoço', resposta: '🔥 *Estimativa:* 650 kcal' }]);
  assert.match(b, /imite o JEITO/);
  assert.match(b, /NUNCA copie fatos, números/);
  assert.match(b, /Mensagem: almoço\nResposta: 🔥/);
});
