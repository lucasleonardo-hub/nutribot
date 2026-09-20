import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarAtualizacao } from '../perfis.js';

const perfil = { jids: ['a@s'], peso: 73, altura: 180, objetivo: 'hipertrofia', atualizacoes: { peso: '2026-09-01' } };

test('aplicarAtualizacao só grava o que mudou, com data, e valida faixas', () => {
  const novo = aplicarAtualizacao(perfil, { peso_kg: 74.5, altura_cm: 180, cidade: 'Curitiba', fuso: 'America/Sao_Paulo', dieta: 'Vegetariana' }, '2026-09-20');
  assert.deepEqual(novo, {
    jids: ['a@s'],
    atualizacoes: { peso: '2026-09-20', cidade: '2026-09-20', fuso: '2026-09-20', dieta: '2026-09-20' },
    peso: 74.5,
    cidade: 'Curitiba',
    fuso: 'America/Sao_Paulo',
    dieta: 'vegetariana',
  });
});

test('aplicarAtualizacao ignora lixo e devolve null sem mudança', () => {
  assert.equal(aplicarAtualizacao(perfil, { peso_kg: 900, altura_cm: 50, fuso: 'Marte/Cratera' }, '2026-09-20'), null);
  assert.equal(aplicarAtualizacao(perfil, { objetivo: 'hipertrofia' }, '2026-09-20'), null);
  assert.equal(aplicarAtualizacao(perfil, { peso: '75,2' }, '2026-09-20').peso, 75.2);
});
