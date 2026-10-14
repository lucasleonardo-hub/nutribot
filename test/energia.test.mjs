// Energia do dia (saude.energiaDoDia), a nota 0-100 do card do app: sono da noite que terminou no dia (40%), recuperação
// pelo batimento de repouso contra a média de 14 dias (35%) e carga de ontem (25%, invertida: ontem pesado = menos energia).
// Sem relógio (nem sono nem batimento) é null; componente sem dado sai e os pesos dos outros são redistribuídos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { energiaDoDia } from '../saude.js';

const DIA = '2030-03-29';
const ontem = '2030-03-28';
/** batimento de repouso de 14 dias até `ate`, todos em `bpm`, e o último dia com `ultimo` */
function batimentos({ ate = DIA, bpm = 58, ultimo = bpm, dias = 14, extra = {} } = {}) {
  const out = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(`${ate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const dia = d.toISOString().slice(0, 10);
    out.push({ dia, passos: 6000, calorias: 2500, treinos: [], fcRepouso: i === 0 ? ultimo : bpm, ...(extra[dia] || {}) });
  }
  return out;
}

test('sem relógio: null (nem sono nem batimento)', () => {
  assert.equal(energiaDoDia({ sonos: [], atividades: [], dia: DIA }), null);
  assert.equal(energiaDoDia({ dia: DIA }), null);
  // só a carga de ontem não basta pra dar nota de energia
  assert.equal(energiaDoDia({ sonos: [], atividades: [{ dia: ontem, passos: 15000, treinos: [] }], dia: DIA }), null);
});

test('noite boa, batimento na média e ontem leve: energia alta, sem carga', () => {
  const e = energiaDoDia({ sonos: [{ dia: DIA, total: 470 }], atividades: batimentos(), dia: DIA });
  assert.equal(e.sono, 100);
  assert.ok(e.recuperacao >= 55 && e.recuperacao <= 65, `recuperação ${e.recuperacao}`); // delta 0 bpm ≈ 62
  assert.equal(e.carga, 0);
  assert.ok(e.nota >= 80, `nota ${e.nota}`);
  assert.match(e.texto, /^Energia boa/);
  assert.match(e.texto, /dormiu 7h50/);
});

test('sono curto pesa 40%: 4h10 de sono derruba a nota', () => {
  const boa = energiaDoDia({ sonos: [{ dia: DIA, total: 470 }], atividades: batimentos(), dia: DIA });
  const curta = energiaDoDia({ sonos: [{ dia: DIA, total: 250 }], atividades: batimentos(), dia: DIA });
  assert.ok(curta.sono <= 5, `sono ${curta.sono}`);
  assert.ok(boa.nota - curta.nota >= 35, `${boa.nota} -> ${curta.nota}`);
  assert.match(curta.texto, /sono curto \(4h10\)/);
});

test('batimento acima do normal há 2+ dias: recuperação no máximo 40 e texto diz', () => {
  const ativ = batimentos({ bpm: 56, extra: { [ontem]: { fcRepouso: 64 } }, ultimo: 65 });
  const e = energiaDoDia({ sonos: [{ dia: DIA, total: 450 }], atividades: ativ, dia: DIA });
  assert.ok(e.recuperacao <= 40, `recuperação ${e.recuperacao}`);
  assert.match(e.texto, /batimento de repouso acima do normal/);
});

test('batimento velho (último há 3 dias) não conta como recuperação de hoje', () => {
  const velho = batimentos({ ate: '2030-03-26' });
  const e = energiaDoDia({ sonos: [{ dia: DIA, total: 450 }], atividades: velho, dia: DIA });
  assert.equal(e.recuperacao, null);
  assert.equal(e.sono, 100);
  assert.equal(e.nota, 100); // só o sono (carga de ontem sem dado: ontem fora da lista)
});

test('carga de ontem: treino de 90 min + 16 mil passos vira carga alta e baixa a nota', () => {
  const leve = energiaDoDia({ sonos: [{ dia: DIA, total: 450 }], atividades: batimentos(), dia: DIA });
  const pesado = energiaDoDia({
    sonos: [{ dia: DIA, total: 450 }],
    atividades: batimentos({ extra: { [ontem]: { passos: 16000, treinos: [{ nome: 'Musculação', min: 90, hora: '18:00' }] } } }),
    dia: DIA,
  });
  assert.ok(pesado.carga >= 60, `carga ${pesado.carga}`);
  assert.ok(leve.nota > pesado.nota);
  assert.match(pesado.texto, /ontem foi pesado/);
  // caminhada conta pela metade
  const caminhada = energiaDoDia({
    sonos: [{ dia: DIA, total: 450 }],
    atividades: batimentos({ extra: { [ontem]: { passos: 6000, treinos: [{ nome: 'Caminhada', min: 90, hora: '07:00' }] } } }),
    dia: DIA,
  });
  assert.ok(caminhada.carga < pesado.carga);
});

test('HRV baixa só tira da recuperação quando é do mesmo dia do batimento (HRV velha não conta)', () => {
  const comHrv = (diaHrvBaixa) => {
    const ativ = batimentos();
    for (const a of ativ.slice(0, -2)) a.hrv = 60;
    ativ.find((a) => a.dia === diaHrvBaixa).hrv = 30;
    return energiaDoDia({ sonos: [{ dia: DIA, total: 450 }], atividades: ativ, dia: DIA }).recuperacao;
  };
  const semHrv = energiaDoDia({ sonos: [{ dia: DIA, total: 450 }], atividades: batimentos(), dia: DIA }).recuperacao;
  assert.equal(comHrv(ontem), semHrv); // HRV de ontem, batimento de hoje: não desconta
  assert.equal(comHrv(DIA), semHrv - 15); // HRV de hoje, baixa: desconta 15
});

test('sem noite registrada no dia: nota pelo batimento e pela carga, sono null', () => {
  const e = energiaDoDia({ sonos: [{ dia: ontem, total: 480 }], atividades: batimentos(), dia: DIA });
  assert.equal(e.sono, null);
  assert.ok(Number.isInteger(e.nota) && e.nota >= 0 && e.nota <= 100);
  assert.doesNotMatch(e.texto, /dormiu/);
});
