import { test } from 'node:test';
import assert from 'node:assert/strict';

// os módulos leem chaves do ambiente ao carregar; em teste não há .env
process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { ferramentasPara, semanaAtual } = await import('../ferramentas.js');
const { gerarComFerramentas } = await import('../gemini.js');

test('ferramentasPara: declarações válidas, nomes únicos, executor pra cada uma, desconhecida não lança', async () => {
  const f = ferramentasPara({ nome: 'Teste Pessoa', jids: [], lugares: [], atividades: [] }, { dia: '2026-10-02' });
  const nomes = f.declaracoes.map((d) => d.name);
  assert.equal(new Set(nomes).size, nomes.length);
  assert.ok(nomes.includes('refeicoes_periodo') && nomes.includes('semana_tipica') && nomes.includes('conhecimento') && nomes.includes('reflexao'));
  for (const d of f.declaracoes) {
    assert.match(d.name, /^[a-z_]+$/);
    assert.ok(d.description.length > 20, d.name);
    if (d.parameters) {
      assert.equal(d.parameters.type, 'OBJECT');
      for (const p of Object.values(d.parameters.properties)) assert.ok(['INTEGER', 'STRING'].includes(p.type));
    }
  }
  assert.match(await f.executar('nao_existe', {}), /desconhecida/);
  // reflexao não depende de banco: roda de verdade e conta como usada
  assert.match(await f.executar('reflexao', {}), /ainda sem reflexão/);
  assert.deepEqual(f.usadas, ['reflexao']);
  // com reflexão e hipótese no perfil
  const g = ferramentasPara({ nome: 'X', jids: [], reflexao: { sintese: 'come pouco à noite' }, hipoteses: [{ status: 'aberta', texto: 'pula jantar em dia de vôlei', sinais: [{ dia: '2026-10-01', direcao: 'a_favor', evidencia: 'jantou 23h' }] }] }, { dia: '2026-10-02' });
  const r = await g.executar('reflexao', {});
  assert.match(r, /SÍNTESE: come pouco à noite/);
  assert.match(r, /pula jantar em dia de vôlei \(sinais: 10-01 \+ jantou 23h\)/);
  // apenas: restringe a lista e o executor
  const h = ferramentasPara({ nome: 'X', jids: [] }, { dia: '2026-10-02', apenas: ['despensa'] });
  assert.deepEqual(h.declaracoes.map((d) => d.name), ['despensa']);
  assert.match(await h.executar('reflexao', {}), /desconhecida/);
});

test('semanaAtual: segunda a domingo da semana que contém o dia', () => {
  const s = semanaAtual('2026-10-02'); // sexta
  assert.equal(s.inicio, '2026-09-28');
  assert.equal(s.fim, '2026-10-04');
  assert.equal(s.dias[0].rotulo, 'Segunda 28/09');
  assert.equal(semanaAtual('2026-10-04').inicio, '2026-09-28'); // domingo ainda é a mesma semana
  assert.equal(semanaAtual('2026-10-05').inicio, '2026-10-05');
});

test('gerarComFerramentas: executa o pedido, devolve o resultado ao modelo e termina em texto', async () => {
  const chamadas = [];
  const ferramentas = { declaracoes: [{ name: 'eco', description: 'devolve o que recebe' }], usadas: [], executar: async (nome, args) => (chamadas.push([nome, args]), `eco:${args.x}`) };
  const vistos = [];
  const falso = async ({ contents, config }) => {
    vistos.push({ contents, config });
    if (vistos.length === 1) return { texto: '', chamadas: [{ name: 'eco', args: { x: 1 } }], conteudo: { role: 'model', parts: [{ functionCall: { name: 'eco', args: { x: 1 } } }] }, modelo: 'fake' };
    return { texto: 'pronto', chamadas: [], conteudo: null, modelo: 'fake' };
  };
  const r = await gerarComFerramentas({ contents: 'oi', config: { temperature: 0.5 }, ferramentas, maxRodadas: 3, _gerar: falso });
  assert.equal(r, 'pronto');
  assert.deepEqual(chamadas, [['eco', { x: 1 }]]);
  assert.equal(vistos.length, 2);
  assert.equal(vistos[0].config.bruto, true);
  assert.equal(vistos[0].config.semReserva, true);
  assert.equal(vistos[0].config.temperature, 0.5);
  assert.equal(vistos[0].config.tools[0].functionDeclarations[0].name, 'eco');
  const segunda = vistos[1].contents;
  assert.equal(segunda.length, 3); // pergunta, pedido do modelo, resposta da ferramenta
  assert.equal(segunda[0].parts[0].text, 'oi');
  assert.equal(segunda[1].parts[0].functionCall.name, 'eco');
  assert.equal(segunda[2].role, 'user');
  assert.equal(segunda[2].parts[0].functionResponse.name, 'eco');
  assert.equal(segunda[2].parts[0].functionResponse.response.resultado, 'eco:1');
});

test('gerarComFerramentas: na última rodada desliga as ferramentas pra forçar texto; sem ferramentas vai direto', async () => {
  const ferramentas = { declaracoes: [{ name: 'eco', description: 'x' }], usadas: [], executar: async () => 'ok' };
  const configs = [];
  const falso = async ({ config }) => {
    configs.push(config);
    if (configs.length < 2) return { texto: '', chamadas: [{ name: 'eco', args: {} }], conteudo: { role: 'model', parts: [{ functionCall: { name: 'eco', args: {} } }] } };
    return { texto: 'fim', chamadas: [] };
  };
  assert.equal(await gerarComFerramentas({ contents: 'oi', config: {}, ferramentas, maxRodadas: 2, _gerar: falso }), 'fim');
  assert.equal(configs[0].toolConfig, undefined);
  assert.equal(configs[1].toolConfig.functionCallingConfig.mode, 'NONE');
  // sem declarações: chamada normal, resposta em texto
  const direto = async () => 'texto puro';
  assert.equal(await gerarComFerramentas({ contents: 'oi', config: {}, ferramentas: { declaracoes: [] }, _gerar: direto }), 'texto puro');
});
