import { test } from 'node:test';
import assert from 'node:assert/strict';

// os módulos leem chaves do ambiente ao carregar; em teste não há .env
process.env.GEMINI_API_KEY ||= 'chave-de-teste';
const { ferramentasPara, semanaAtual } = await import('../ferramentas.js');
const { gerarComFerramentas } = await import('../gemini.js');

test('ferramentasPara: declarações válidas, nomes únicos, executor pra cada uma, desconhecida não lança', async () => {
  const f = ferramentasPara({ nome: 'Teste Pessoa', jids: [], lugares: [], atividades: [], lugaresAtivo: true, relogio: { gastos: { '2026-10-01': 2500 } }, treino: 'x' }, { dia: '2026-10-02' });
  const nomes = f.declaracoes.map((d) => d.name);
  assert.equal(new Set(nomes).size, nomes.length);
  assert.ok(nomes.includes('refeicoes_periodo') && nomes.includes('semana_tipica') && nomes.includes('conhecimento') && nomes.includes('reflexao') && nomes.includes('relogio') && nomes.includes('treino_forca'));
  // quem não tem relógio, localização nem Hevy não recebe essas ferramentas (Heitor e Ale chamavam e recebiam "não tem")
  const semNada = ferramentasPara({ nome: 'Outra', jids: [] }, { dia: '2026-10-02' }).declaracoes.map((d) => d.name);
  for (const n of ['relogio', 'semana_tipica', 'lugares', 'mercados_perto', 'treino_forca', 'agenda']) assert.ok(!semNada.includes(n), n);
  assert.ok(semNada.includes('refeicoes_periodo') && semNada.includes('pesagens') && semNada.includes('lembrancas'));
  // escrita: true traz as duas ações; 'anotar' (investigação antes do pensamento) só a memória, nunca o perfil
  const ambas = ferramentasPara({ nome: 'Outra', jids: [] }, { dia: '2026-10-02', escrita: true }).declaracoes.map((d) => d.name);
  assert.ok(ambas.includes('anotar_memoria') && ambas.includes('atualizar_perfil'));
  const soAnotar = ferramentasPara({ nome: 'Outra', jids: [] }, { dia: '2026-10-02', escrita: 'anotar' }).declaracoes.map((d) => d.name);
  assert.ok(soAnotar.includes('anotar_memoria') && !soAnotar.includes('atualizar_perfil'));
  assert.ok(!semNada.includes('anotar_memoria'));
  // anotar_memoria é seletiva antes de tocar no banco: temporário, curto e repetido não são guardados
  const comNota = ferramentasPara({ nome: 'Outra', jids: [], anotacoes: [{ dia: '2026-09-20', tipo: 'aversao', texto: 'Outra odeia beterraba cozida' }] }, { dia: '2026-10-02', escrita: 'anotar' });
  assert.match(await comNota.executar('anotar_memoria', { texto: 'hoje está sem fome por causa do calor', tipo: 'contexto', validade: 'temporaria' }), /temporária/);
  assert.match(await comNota.executar('anotar_memoria', { texto: 'sem fome', tipo: 'contexto' }), /curto demais/);
  assert.match(await comNota.executar('anotar_memoria', { texto: 'Outra odeia beterraba cozida e crua', tipo: 'aversao' }), /já estava anotado/);
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

test('gerarComFerramentas: modelo que pede ferramenta mesmo com elas desligadas ganha UMA rodada extra pedindo texto; texto junto da chamada serve', async () => {
  // 04/10: ferramenta devolveu erro, o 3.5-flash (reserva) repetiu a chamada na rodada com mode NONE e o laço lançava;
  // a conversa caía no caminho normal e o cenário C44 da avaliação ficava sem resposta
  const execs = [];
  const ferramentas = { declaracoes: [{ name: 'eco', description: 'x' }], usadas: [], executar: async (n) => (execs.push(n), '(erro ao consultar eco: tempo esgotado)') };
  const vistos = [];
  const teimoso = async ({ contents, config }) => {
    vistos.push({ contents, config });
    if (vistos.length <= 2) return { texto: '', chamadas: [{ name: 'eco', args: {} }], conteudo: { role: 'model', parts: [{ functionCall: { name: 'eco', args: {} } }] } };
    return { texto: 'enfim em texto', chamadas: [] };
  };
  assert.equal(await gerarComFerramentas({ contents: 'oi', config: {}, ferramentas, maxRodadas: 2, _gerar: teimoso }), 'enfim em texto');
  assert.equal(vistos.length, 3);
  assert.equal(execs.length, 2); // as duas chamadas foram executadas e devolvidas
  assert.equal(vistos[2].config.toolConfig.functionCallingConfig.mode, 'NONE');
  const ultimo = vistos[2].contents.at(-1);
  assert.equal(ultimo.role, 'user');
  assert.match(ultimo.parts[0].text, /responda em texto/i);
  // texto junto da chamada na última rodada: vale como resposta, sem rodada extra
  const comTexto = async ({ config }) => (config.toolConfig ? { texto: 'resposta com chamada junto', chamadas: [{ name: 'eco', args: {} }] } : { texto: '', chamadas: [{ name: 'eco', args: {} }], conteudo: { role: 'model', parts: [{ functionCall: { name: 'eco', args: {} } }] } });
  assert.equal(await gerarComFerramentas({ contents: 'oi', config: {}, ferramentas, maxRodadas: 2, _gerar: comTexto }), 'resposta com chamada junto');
  // nem a rodada extra trouxe texto: lança (quem chamou cai no caminho normal)
  const mudo = async () => ({ texto: '', chamadas: [{ name: 'eco', args: {} }], conteudo: { role: 'model', parts: [{ functionCall: { name: 'eco', args: {} } }] } });
  await assert.rejects(() => gerarComFerramentas({ contents: 'oi', config: {}, ferramentas, maxRodadas: 1, _gerar: mudo }), /estourou as rodadas/);
});
