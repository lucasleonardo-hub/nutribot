import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilarRefeicoes, lerEstimativa, descricaoDaAnalise, compilarSemana, lerTipoRefeicao } from '../resumo.js';

const L = 'Lucas';

test('lerEstimativa entende o formato novo e o antigo', () => {
  assert.deepEqual(lerEstimativa('🔥 *Estimativa:* ~1.250 kcal · Proteína 60 g · Carboidratos 130 g · Gorduras 45 g'), { kcal: 1250, p: 60, c: 130, g: 45 });
  assert.deepEqual(lerEstimativa('🔥 *Estimativa:* ~780 kcal | P: 36g | C: 72g | G: 38g'), { kcal: 780, p: 36, c: 72, g: 38 });
  assert.deepEqual(lerEstimativa('🔥 *Estimativa corrigida:* ~750 kcal · Proteína 40 g · Carboidratos 90 g · Gorduras 25 g'), { kcal: 750, p: 40, c: 90, g: 25 });
  assert.equal(lerEstimativa('sem números aqui'), null);
  // formatos de modelo reserva
  assert.deepEqual(lerEstimativa('🔥 Estimativa: 420 kcal, proteínas 25g, carboidratos 50g e gorduras 10g'), { kcal: 420, p: 25, c: 50, g: 10 });
  assert.deepEqual(lerEstimativa('Estimativa:\nCalorias: ~500 kcal\nProteína: 30 g\nCarboidratos: 60 g\nGorduras: 12 g'), { kcal: 500, p: 30, c: 60, g: 12 });
  assert.deepEqual(lerEstimativa('Esse prato tem uns 650 kcal (Proteína 40 g, Carboidratos 70 g, Gorduras 20 g).'), { kcal: 650, p: 40, c: 70, g: 20 });
});

test('descricaoDaAnalise tira o bloco "O que eu vi"', () => {
  const d = descricaoDaAnalise('Oi!\n\n🍽️ *O que eu vi:*\n- 2 ovos.\n- 1 banana.\n\n🔥 *Estimativa:* ~300 kcal', 'fallback');
  assert.equal(d, '2 ovos. 1 banana.');
  assert.equal(descricaoDaAnalise('', '📷 [foto de comida] cachorro quente'), 'cachorro quente');
});

test('compilarRefeicoes lista tudo, soma em código e junta complemento da mesma refeição', () => {
  const historico = [
    { hora: '09:41', nome: L, texto: '📷 [foto de comida]', tipo: 'foto', refeicao: 'cafe' },
    { hora: '09:41', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- pão e ovos.\n\n🔥 *Estimativa:* ~780 kcal | P: 36g | C: 72g | G: 38g' },
    { hora: '10:37', nome: L, texto: 'papo', tipo: 'texto' },
    { hora: '12:49', nome: L, texto: '📷 [foto de comida]', tipo: 'foto', refeicao: 'almoco' },
    { hora: '12:49', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- macarrão.\n\n🔥 *Estimativa:* ~620 kcal · Proteína 32 g · Carboidratos 82 g · Gorduras 16 g' },
    { hora: '17:27', nome: L, texto: '📷 [foto de comida] pão de batata doce', tipo: 'foto', refeicao: 'lanche' },
    { hora: '17:27', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- pão e vitamina.\n\n🔥 *Estimativa:* ~680 kcal · Proteína 30 g · Carboidratos 80 g · Gorduras 25 g' },
    { hora: '17:28', nome: L, texto: 'a vitamina tem whey', tipo: 'texto', refeicao: 'lanche' },
    { hora: '17:28', nome: 'Nutri', tipo: 'bot', texto: 'Boa! 🔥 *Estimativa corrigida:* ~750 kcal · Proteína 40 g · Carboidratos 90 g · Gorduras 25 g' },
    { hora: '20:53', nome: L, texto: '📷 [foto de comida] 2 cachorros-quentes', tipo: 'foto', refeicao: 'jantar' },
    { hora: '20:53', nome: 'Nutri', tipo: 'bot', texto: '🍽️ *O que eu vi:*\n- 2 dogs.\n\n🔥 *Estimativa:* ~800 kcal | P: 25g | C: 70g | G: 40g' },
  ];
  const r = compilarRefeicoes(historico, [{ nome: L, peso: 73 }, { nome: 'Heitor', peso: 90 }]);
  assert.deepEqual(r.totais[L], { refeicoes: 4, kcal: 2950, p: 133, c: 314, g: 119 });
  assert.deepEqual(r.totais.Heitor, { refeicoes: 0, kcal: 0, p: 0, c: 0, g: 0 });
  assert.match(r.texto, /Lanche \(17:27\).*\(\+ a vitamina tem whey\)/);
  assert.match(r.texto, /Heitor: 0 refeição/);
});

test('compilarSemana monta a tabela por dia e a média', () => {
  const refeicoes = [
    { jid: 'a@s', nome: L, dia: '2026-09-19', slot: 'cafe', estimativa: { kcal: 500, p: 30, c: 50, g: 20 } },
    { jid: 'a@s', nome: L, dia: '2026-09-19', slot: 'almoco', estimativa: { kcal: 700, p: 40, c: 80, g: 20 } },
    { jid: 'a@s', nome: L, dia: '2026-09-20', slot: 'almoco', estimativa: null },
  ];
  const t = compilarSemana(refeicoes, [{ nome: L, jids: ['a@s'], peso: 73 }], ['2026-09-19', '2026-09-20']);
  assert.match(t, /2026-09-19 \(sáb\): 2 refeições .* 1200 kcal · Proteína 70 g/);
  assert.match(t, /2026-09-20 \(dom\): 1 refeição/);
  assert.match(t, /MÉDIA nos 1 dia\(s\) com estimativa: 1200 kcal/);
});

test('lerTipoRefeicao entende a linha "Refeição:" da análise', () => {
  assert.equal(lerTipoRefeicao('🕐 *Refeição:* café da manhã\n🍽️ *O que eu vi:* ovos'), 'cafe');
  assert.equal(lerTipoRefeicao('🕐 *Refeição:* Almoço'), 'almoco');
  assert.equal(lerTipoRefeicao('Refeição: lanche pós-treino'), 'lanche');
  assert.equal(lerTipoRefeicao('🕐 *Refeição:* jantar tardio'), 'jantar');
  assert.equal(lerTipoRefeicao('sem a linha'), null);
  assert.equal(lerTipoRefeicao('🕐 *Refeição:* lanche da manhã (pré-treino)'), 'lanche_manha');
  assert.equal(lerTipoRefeicao('Refeição: pós-treino'), 'lanche'); // sem "manhã", vale o lanche comum
  assert.equal(lerTipoRefeicao('🕐 *Refeição:* pré-treino da manhã'), 'lanche_manha');
  assert.equal(lerTipoRefeicao('Refeição: lanche da tarde'), 'lanche');
});

import { metaBalancoPara } from '../resumo.js';
test('metaBalancoPara: faixa vem do ritmo até a meta, dentro do saudável; sem meta cai no objetivo; perto da meta desacelera', () => {
  // 77 kg -> 80 kg até 2026-12-24 (12 semanas): 0,25 kg/semana, dentro de 0,19–0,385 (0,25–0,5%) -> ~275 kcal/dia
  const m = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 77, metaPeso: 80, metaPrazo: '2026-12-24', dia: '2026-10-01' });
  assert.equal(m.fonte, 'meta');
  assert.ok(m.ritmoKgSemana > 0.24 && m.ritmoKgSemana < 0.26, `ritmo ${m.ritmoKgSemana}`);
  assert.ok(m.min >= 170 && m.max <= 380 && m.min < m.max, `faixa ${m.min}–${m.max}`);
  assert.match(m.rotulo, /superávit de ~2[6-9]0 kcal\/dia \(\+0,25 kg\/semana rumo a 80 kg até 2026-12-24\)/);
  assert.equal(m.prazoApertado, false);
  // prazo impossível: trava no teto saudável e avisa
  const ap = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 77, metaPeso: 85, metaPrazo: '2026-11-01', dia: '2026-10-01' });
  assert.equal(ap.prazoApertado, true);
  assert.ok(Math.abs(ap.ritmoKgSemana - 77 * 0.005) < 0.001);
  // sem prazo: meio da faixa saudável (0,375% = 0,289 kg/sem -> ~318 kcal)
  const sp = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 77, metaPeso: 80, dia: '2026-10-01' });
  assert.ok(sp.ritmoKgSemana > 0.28 && sp.ritmoKgSemana < 0.30);
  // perda: 70 -> 65 em 10 semanas = 0,5 kg/sem (dentro de 0,35–0,7) -> déficit ~550
  const pd = metaBalancoPara({ objetivo: 'perda de peso', peso: 70, metaPeso: 65, metaPrazo: '2026-12-10', dia: '2026-10-01' });
  assert.ok(pd.min < 0 && pd.max < 0 && pd.ritmoKgSemana < 0);
  assert.match(pd.rotulo, /déficit de ~5[4-6]0 kcal\/dia/);
  // a 1 kg da meta: metade do ritmo; alcançada: manutenção; sem meta de peso: faixa do objetivo
  assert.equal(metaBalancoPara({ objetivo: 'Hipertrofia', peso: 79.2, metaPeso: 80, dia: '2026-10-01' }).fase, 'aproximacao');
  assert.equal(metaBalancoPara({ objetivo: 'Hipertrofia', peso: 79.8, metaPeso: 80, dia: '2026-10-01' }).fase, 'manutencao');
  // sem meta de peso mas com peso e objetivo de ganho: ritmo médio da faixa saudável (sem teto)
  const sm = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 77, dia: '2026-10-01', ritmo: 'medio' });
  assert.equal(sm.fonte, 'ritmo');
  assert.equal(metaBalancoPara({ objetivo: 'Hipertrofia', peso: 77, dia: '2026-10-01' }).fonte, 'objetivo', 'sem ritmo dito, faixa genérica');
  assert.ok(sm.ritmoKgSemana > 0.28 && sm.ritmoKgSemana < 0.30);
  // sem peso: faixa genérica do objetivo
  assert.deepEqual(metaBalancoPara({ objetivo: 'Hipertrofia', dia: '2026-10-01' }), { min: 250, max: 500, rotulo: 'superávit de 250 a 500 kcal/dia', fonte: 'objetivo' });
});


import { tendenciaGordura, proporEtapa } from '../resumo.js';
test('metas-etapa, ritmo máximo e freio pela gordura', () => {
  // ritmo máximo com etapa: 75,8 -> 80 kg, prazo só referência; ritmo = 0,5% = 0,379 kg/sem -> ~417 kcal
  const e = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 75.8, metaPeso: 80, metaPrazo: '2027-01-15', dia: '2026-10-01', ritmo: 'maximo', metaModo: 'etapa' });
  assert.ok(Math.abs(e.ritmoKgSemana - 75.8 * 0.005) < 0.001, `ritmo ${e.ritmoKgSemana}`);
  assert.match(e.rotulo, /superávit de ~4[12]0 kcal\/dia .*\[etapa\]$/);
  assert.match(e.detalhe, /chega a 80 kg por volta de 2026-12-1\d \(prazo 2027-01-15, antes\)/);
  assert.match(e.detalhe, /ETAPA \(não um teto\)/);
  // etapa batida: não vira manutenção, segue no ritmo e sinaliza
  const b = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 80.1, metaPeso: 80, dia: '2026-12-20', ritmo: 'maximo', metaModo: 'etapa' });
  assert.equal(b.etapaBatida, true);
  assert.ok(b.ritmoKgSemana > 0.39 && b.ritmoKgSemana < 0.41);
  // freio: gordura subindo 1,0 ponto em 28 dias derruba do máximo pro médio; 1,6 pro mínimo
  const f1 = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 76, metaPeso: 80, dia: '2026-10-01', ritmo: 'maximo', metaModo: 'etapa', gorduraTend: 1.0 });
  assert.ok(Math.abs(f1.ritmoKgSemana - 76 * 0.00375) < 0.001, `ritmo ${f1.ritmoKgSemana}`);
  assert.match(f1.freio, /um degrau abaixo do ritmo máximo/);
  const f2 = metaBalancoPara({ objetivo: 'Hipertrofia', peso: 76, metaPeso: 80, dia: '2026-10-01', ritmo: 'maximo', metaModo: 'etapa', gorduraTend: 1.6 });
  assert.ok(Math.abs(f2.ritmoKgSemana - 76 * 0.0025) < 0.001);
  // tendência da gordura: sobe 0,05 pp/dia por 28 dias = +1,4 pontos
  const pes = Array.from({ length: 10 }, (_, i) => ({ dia: `2026-09-${String(1 + i * 3).padStart(2, '0')}`, peso: 76, gordura: 17 + 0.05 * i * 3 }));
  assert.ok(Math.abs(tendenciaGordura(pes) - 1.4) < 0.15, `tend ${tendenciaGordura(pes)}`);
  assert.equal(tendenciaGordura(pes.slice(0, 4)), null);
  // próxima etapa: 80,1 -> 84 kg, ~12 semanas (10,3 no ritmo + 2 de folga)
  const px = proporEtapa({ peso: 80.1, ganho: true, dia: '2026-12-20' });
  assert.equal(px.metaPeso, 84);
  assert.ok(px.semanas >= 11 && px.semanas <= 13, `semanas ${px.semanas}`);
  assert.match(px.metaPrazo, /^2027-03-/);
});

import { linhaDeTendencia } from '../previsao.js';
test('linhaDeTendencia: médias semanais, inclinação de peso/magra/gordura e veredito contra o alvo', () => {
  // 6 semanas, pesagem a cada 2 dias: peso sobe 0,35 kg/semana, gordura estável em 17,5% (ganho limpo)
  const pes = [];
  for (let d = 0; d < 42; d += 2) {
    const dia = new Date(Date.UTC(2026, 7, 21 + d, 12)).toISOString().slice(0, 10); // 21/08 -> 01/10
    pes.push({ dia, peso: Math.round((73.8 + (0.35 * d) / 7) * 10) / 10, gordura: 17.5 + (d % 4 === 0 ? 0.4 : -0.4) });
  }
  const t = linhaDeTendencia({ pesagens: pes, perfil: { objetivo: 'Hipertrofia' }, dia: '2026-10-01', alvoKgSemana: 0.38 });
  assert.ok(t, 'tendência existe');
  assert.ok(t.semanas.length >= 5 && t.semanas.length <= 6, `semanas ${t.semanas.length}`);
  assert.ok(Math.abs(t.pesoSem - 0.35) < 0.05, `peso/sem ${t.pesoSem}`);
  assert.ok(Math.abs(t.gorduraPpSem) < 0.1, `gordura pp/sem ${t.gorduraPpSem}`);
  assert.ok(t.magraSem > 0.2, `magra/sem ${t.magraSem}`);
  assert.equal(t.status, 'ok');
  assert.match(t.texto, /VEREDITO: no caminho \(\+0,3\d kg\/semana, alvo \+0,38 kg/);
  assert.match(t.zap, /✅ No caminho/);
  // ganhando rápido demais com gordura subindo: 🛑
  const rapido = pes.map((p, i) => ({ ...p, peso: Math.round((73.8 + (0.9 * i * 2) / 7) * 10) / 10, gordura: 17 + (i * 2) / 14 }));
  const r = linhaDeTendencia({ pesagens: rapido, perfil: { objetivo: 'Hipertrofia' }, dia: '2026-10-01', alvoKgSemana: 0.38 });
  assert.equal(r.status, 'acima_gordura');
  assert.match(r.zap, /🛑/);
  // estagnado
  const parado = pes.map((p) => ({ ...p, peso: 75 }));
  assert.equal(linhaDeTendencia({ pesagens: parado, perfil: { objetivo: 'Hipertrofia' }, dia: '2026-10-01' }).status, 'abaixo');
  // poucos dados
  assert.equal(linhaDeTendencia({ pesagens: pes.slice(-2), perfil: { objetivo: 'Hipertrofia' }, dia: '2026-10-01' }), null);
});
