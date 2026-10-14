// Fuso por pessoa (fase 0, P6): o `dia` de refeição, pesagem digitada e hábito é o do fuso da PESSOA (antes, o do grupo),
// e o fuso acompanha a localização do celular (Open-Meteo, sem serviço pago) quando a mudança se mantém.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marcaDeTempo, decidirFuso, fusosEquivalentes, agora } from '../util.js';
import { resumirHoje, registradasHojeParaPrompt, compilarRefeicoesDoBanco, compilarSemana, sequenciaDe, calcularVisao } from '../resumo.js';
import { fusoDasCoordenadas } from '../clima.js';

const heitor = { nome: 'Heitor', jids: ['h@lid'], fuso: 'Europe/Sofia' };
const lucas = { nome: 'Lucas', jids: ['l@lid'], fuso: 'America/Sao_Paulo' };

test('refeição às 00:30 em Sofia cai no dia de Sofia (não no do grupo, que ainda é o anterior)', () => {
  const quando = new Date('2026-10-13T21:30:00Z'); // 00:30 de 14/10 em Sofia; 18:30 de 13/10 em São Paulo
  const m = marcaDeTempo(heitor, quando);
  assert.equal(m.dia, '2026-10-14');
  assert.equal(m.horaLocal, '00:30');
  assert.equal(m.minutos, 30);
  assert.equal(m.hora, '18:30'); // relógio do grupo: liga o registro à conversa do dia (memória, diário)
  assert.equal(m.diaGrupo, '2026-10-13');
  // quem está no fuso do grupo não muda nada
  const l = marcaDeTempo(lucas, quando);
  assert.equal(l.dia, '2026-10-13');
  assert.equal(l.horaLocal, '18:30');
  // sem fuso no perfil: o do grupo
  assert.equal(marcaDeTempo({ nome: 'X' }, quando).dia, '2026-10-13');
});

test('!hoje e o bloco do prompt mostram o dia LOCAL de cada um', () => {
  const quando = new Date('2026-10-13T21:30:00Z');
  const diaDe = (p) => marcaDeTempo(p, quando).dia;
  const refeicoes = [
    { jid: 'h@lid', nome: 'Heitor', dia: '2026-10-13', minutos: 20 * 60, horaLocal: '20:00', slot: 'jantar', descricao: 'jantar de ontem (pra ele)', estimativa: { kcal: 800 } },
    { jid: 'h@lid', nome: 'Heitor', dia: '2026-10-14', minutos: 30, horaLocal: '00:30', slot: 'ceia', descricao: 'iogurte', estimativa: { kcal: 150 } },
    { jid: 'l@lid', nome: 'Lucas', dia: '2026-10-13', minutos: 12 * 60, horaLocal: '12:00', slot: 'almoco', descricao: 'almoço', estimativa: { kcal: 900 } },
  ];
  const txt = resumirHoje(refeicoes, [heitor, lucas], '2026-10-13', [], { diaDe });
  assert.match(txt, /\*Heitor\* \(1 refeição\)[\s\S]*iogurte/);
  assert.doesNotMatch(txt, /jantar de ontem/);
  assert.match(txt, /\*Lucas\* \(1 refeição\)[\s\S]*almoço/);
  const prompt = registradasHojeParaPrompt(refeicoes, [heitor, lucas], '2026-10-13', { diaDe });
  assert.match(prompt, /- Heitor: Ceia 00:30 \(~150 kcal/);
  assert.match(prompt, /- Lucas: Almoço 12:00 \(~900 kcal/);
  // sem diaDe, o comportamento antigo (um dia só pra todo mundo)
  assert.match(resumirHoje(refeicoes, [heitor], '2026-10-13'), /jantar de ontem/);
});

// fuso do Lucas ao longo de uma viagem: São Paulo -> Lisboa (05/10 10:00 UTC) -> São Paulo (12/10 03:00 UTC)
const fusoNo = (t) => (t >= Date.parse('2026-10-05T10:00:00Z') && t < Date.parse('2026-10-12T03:00:00Z') ? 'Europe/Lisbon' : 'America/Sao_Paulo');

test('viagem Brasil -> Europa -> Brasil: nenhuma refeição perdida nem contada em dobro, nenhum dia some', () => {
  // uma refeição a cada 5 h (instantes reais), do dia 01/10 ao 16/10; o dia é o local no fuso que vale naquele instante
  const refeicoes = [];
  let kcal = 0;
  for (let t = Date.parse('2026-10-01T11:00:00Z'); t < Date.parse('2026-10-16T23:00:00Z'); t += 5 * 3600_000) {
    const m = marcaDeTempo({ ...lucas, fuso: fusoNo(t) }, new Date(t));
    const k = 300 + (refeicoes.length % 7) * 50;
    kcal += k;
    refeicoes.push({ jid: 'l@lid', nome: 'Lucas', dia: m.dia, hora: m.hora, horaLocal: m.horaLocal, minutos: m.minutos, slot: 'lanche', estimativa: { kcal: k, p: 10, c: 10, g: 5 } });
  }
  const dias = [...new Set(refeicoes.map((r) => r.dia))].sort();
  // sem buraco: todo dia do calendário entre o primeiro e o último tem registro
  for (let i = 1; i < dias.length; i++) {
    const esperado = new Date(Date.parse(`${dias[i - 1]}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
    assert.equal(dias[i], esperado, `dia perdido entre ${dias[i - 1]} e ${dias[i]}`);
  }
  // resumo do dia (o da meia-noite) dia a dia: cada refeição aparece uma vez, a soma bate com o total
  let soma = 0;
  let n = 0;
  for (const d of dias) {
    const c = compilarRefeicoesDoBanco(refeicoes, [lucas], d);
    soma += c.totais.Lucas.kcal;
    n += c.totais.Lucas.refeicoes;
  }
  assert.equal(n, refeicoes.length);
  assert.equal(soma, kcal);
  // semana (domingo) também
  const semana = compilarSemana(refeicoes, [lucas], dias);
  const contadas = [...semana.matchAll(/\): (\d+) refeiç/g)].map((m) => Number(m[1])); // linhas por dia ("2026-10-01 (qui): 4 refeições")
  assert.equal(contadas.reduce((a, b) => a + b, 0), refeicoes.length);
  // visão (7/30 dias) e sequência no último dia: todos os dias fechados contam (5 refeições a cada 25 h ~ 4,8 por dia)
  const v = calcularVisao({ refeicoes, perfil: lucas, dia: dias[dias.length - 1] });
  assert.equal(v.sete.comRegistro, 7);
  assert.ok(sequenciaDe(refeicoes, dias[dias.length - 1]) >= dias.length - 2);
});

test('fusos equivalentes (mesmo horário o ano todo) não contam como troca', () => {
  assert.equal(fusosEquivalentes('America/Sao_Paulo', 'America/Bahia'), true);
  assert.equal(fusosEquivalentes('America/Sao_Paulo', 'America/Sao_Paulo'), true);
  assert.equal(fusosEquivalentes('America/Sao_Paulo', 'Europe/Lisbon'), false);
  assert.equal(fusosEquivalentes('Europe/Lisbon', 'Europe/London'), true);
  assert.equal(fusosEquivalentes('Europe/Sofia', 'Europe/Lisbon'), false);
  assert.equal(fusosEquivalentes('America/Sao_Paulo', 'Nada/Disso'), false);
});

test('decisão de trocar o fuso: precisa de 2 leituras do fuso novo, com 30 min entre a primeira e a última', () => {
  const t0 = Date.parse('2026-10-05T10:00:00Z');
  const em = (min) => new Date(t0 + min * 60_000).toISOString();
  // mesma zona: nada muda, nada pendente
  let r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: null, leitura: 'America/Sao_Paulo', em: em(0) });
  assert.deepEqual(r, { trocar: false, fuso: 'America/Sao_Paulo', pendente: null });
  // equivalente (Bahia): também não
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: null, leitura: 'America/Bahia', em: em(0) });
  assert.equal(r.trocar, false);
  assert.equal(r.pendente, null);
  // 1ª leitura em Lisboa: fica pendente
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: null, leitura: 'Europe/Lisbon', em: em(0) });
  assert.equal(r.trocar, false);
  assert.deepEqual(r.pendente, { fuso: 'Europe/Lisbon', desde: em(0), ultima: em(0), n: 1 });
  // 2ª leitura 15 min depois: ainda não (30 min)
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: r.pendente, leitura: 'Europe/Lisbon', em: em(15) });
  assert.equal(r.trocar, false);
  assert.equal(r.pendente.n, 2);
  // 3ª, 30 min depois da primeira: troca
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: r.pendente, leitura: 'Europe/Lisbon', em: em(30) });
  assert.equal(r.trocar, true);
  assert.equal(r.fuso, 'Europe/Lisbon');
  assert.equal(r.pendente, null);
  // leitura de volta ao fuso atual zera a pendência (GPS pulou de fronteira e voltou)
  let p = decidirFuso({ atual: 'America/Sao_Paulo', pendente: null, leitura: 'America/Asuncion', em: em(0) }).pendente;
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: p, leitura: 'America/Sao_Paulo', em: em(20) });
  assert.equal(r.pendente, null);
  // leitura de outro fuso no meio recomeça a contagem
  p = decidirFuso({ atual: 'America/Sao_Paulo', pendente: null, leitura: 'Europe/Lisbon', em: em(0) }).pendente;
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: p, leitura: 'Europe/Madrid', em: em(40) });
  assert.equal(r.trocar, false);
  assert.deepEqual(r.pendente, { fuso: 'Europe/Madrid', desde: em(40), ultima: em(40), n: 1 });
  // 6 h com a mesma leitura também troca (2 leituras espaçadas)
  p = { fuso: 'Europe/Lisbon', desde: em(0), ultima: em(0), n: 1 };
  assert.equal(decidirFuso({ atual: 'America/Sao_Paulo', pendente: p, leitura: 'Europe/Lisbon', em: em(360) }).trocar, true);
  // leitura inválida ou ausente (sem rede): mantém tudo como está
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: p, leitura: null, em: em(50) });
  assert.deepEqual(r, { trocar: false, fuso: 'America/Sao_Paulo', pendente: p });
  r = decidirFuso({ atual: 'America/Sao_Paulo', pendente: p, leitura: 'Lugar/Nenhum', em: em(50) });
  assert.equal(r.trocar, false);
  assert.equal(r.pendente, p);
});

test('fuso pelas coordenadas: Open-Meteo (timezone=auto) com cache por área e tolerância a falha', async () => {
  let chamadas = 0;
  const buscar = async (url) => {
    chamadas++;
    assert.match(String(url), /timezone=auto/);
    assert.match(String(url), /latitude=38\.7/);
    return { ok: true, json: async () => ({ latitude: 38.7, longitude: -9.1, timezone: 'Europe/Lisbon', utc_offset_seconds: 3600 }) };
  };
  assert.equal(await fusoDasCoordenadas(38.72, -9.14, { buscar }), 'Europe/Lisbon');
  assert.equal(await fusoDasCoordenadas(38.73, -9.15, { buscar }), 'Europe/Lisbon'); // mesma área: cache
  assert.equal(chamadas, 1);
  // sem rede: null (quem chama mantém o fuso atual)
  const semRede = async () => {
    throw new Error('fetch failed');
  };
  assert.equal(await fusoDasCoordenadas(-23.5, -46.6, { buscar: semRede }), null);
  // resposta sem fuso válido: null
  const lixo = async () => ({ ok: true, json: async () => ({ timezone: 'GMT+3 talvez' }) });
  assert.equal(await fusoDasCoordenadas(10.1, 10.1, { buscar: lixo }), null);
  const erroHttp = async () => ({ ok: false, status: 429, json: async () => ({}) });
  assert.equal(await fusoDasCoordenadas(20.1, 20.1, { buscar: erroHttp }), null);
  // coordenada inválida: nem consulta
  assert.equal(await fusoDasCoordenadas(NaN, 3, { buscar }), null);
  assert.equal(chamadas, 1);
});

test('agora no fuso: sanidade do relógio usado nos testes acima', () => {
  assert.equal(agora('Europe/Sofia', new Date('2026-10-13T21:30:00Z')).dia, '2026-10-14');
});
