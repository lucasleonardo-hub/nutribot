import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirHoje, compilarMes } from '../resumo.js';
import { duracaoDe } from '../comandos.js';

const perfis = [
  { nome: 'Lucas Leonardo', jids: ['a@s'], peso: 73, objetivo: 'hipertrofia' },
  { nome: 'Ale', jids: ['b@s'], peso: 74, objetivo: 'emagrecer', apelido: 'Alezinha' },
];

test('resumirHoje soma o dia por pessoa e mostra quem não registrou', () => {
  const refeicoes = [
    { jid: 'a@s', nome: 'Lucas Leonardo', dia: '2026-09-22', hora: '08:20', minutos: 500, slot: 'cafe', estimativa: { kcal: 400, p: 25, c: 40, g: 12 }, descricao: 'ovos' },
    { jid: 'a@s', nome: 'Lucas Leonardo', dia: '2026-09-22', hora: '12:00', minutos: 720, slot: 'almoco', estimativa: { kcal: 700, p: 45, c: 80, g: 20 } },
    { jid: 'a@s', nome: 'Lucas Leonardo', dia: '2026-09-21', hora: '12:00', minutos: 720, slot: 'almoco', estimativa: { kcal: 999, p: 1, c: 1, g: 1 } }, // ontem: fora
  ];
  const t = resumirHoje(refeicoes, perfis, '2026-09-22');
  assert.match(t, /\*Lucas\* \(2 refeições\)/);
  assert.match(t, /~1100 kcal · Proteína 70 g/);
  assert.match(t, /meta de proteína 117 a 161 g/);
  assert.match(t, /\*Alezinha\*: nada registrado hoje ainda/);
});

test('compilarMes: peso, médias por semana e dias sem registro', () => {
  const dias = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  const refeicoes = [
    { jid: 'a@s', dia: '2026-09-01', slot: 'almoco', estimativa: { kcal: 2000, p: 100, c: 200, g: 60 } },
    { jid: 'a@s', dia: '2026-09-02', slot: 'almoco', estimativa: { kcal: 1000, p: 50, c: 100, g: 30 } },
    { jid: 'a@s', dia: '2026-09-09', slot: 'jantar', estimativa: { kcal: 1500, p: 80, c: 150, g: 40 } },
  ];
  const pesagens = [
    { jid: 'a@s', dia: '2026-09-01', peso: 73 },
    { jid: 'a@s', dia: '2026-09-14', peso: 74.2 },
  ];
  const t = compilarMes(refeicoes, pesagens, perfis, dias);
  assert.match(t, /peso: 73 kg \(09-01\) -> 74\.2 kg \(09-14\) = 1\.2 kg no período/);
  assert.match(t, /semana 1: média\/dia ~1500 kcal · Proteína 75 g/);
  assert.match(t, /semana 2: média\/dia ~1500 kcal/);
  assert.match(t, /3 refeição\(ões\) registrada\(s\); 11 dia\(s\) sem nenhum registro/);
  assert.match(t, /Ale \(objetivo: emagrecer\)\n  - peso: nenhuma pesagem registrada/);
});

test('duracaoDe entende 2h, 30m, 1h30 e minutos soltos', () => {
  assert.equal(duracaoDe('2h'), 2 * 3600_000);
  assert.equal(duracaoDe('30m'), 30 * 60_000);
  assert.equal(duracaoDe('1h30'), 90 * 60_000);
  assert.equal(duracaoDe('90'), 90 * 60_000);
  assert.equal(duracaoDe('abc'), null);
  assert.equal(duracaoDe(''), null);
});
