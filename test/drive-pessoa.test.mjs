// Fase 7, frente C: os montadores puros dos arquivos de cada pessoa no Drive (drive-pessoa.js), o que o dossiê não relê
// e os utilitários do drive.js (repetição e as seções novas da ficha). Nomes e dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  entraNoDossie,
  caminhoDrive,
  chavePendente,
  fmPessoa,
  dadosDoDia,
  mdDiaPessoa,
  dadosDaSemana,
  mdSemanaPessoa,
  mdDespensa,
  mdPensamentos,
  mdConversasApp,
  mdPlanoSemana,
} from '../drive-pessoa.js';
import { comRepeticao, erroPermanenteDrive, mdPerfil, secaoAtividadesFixas, secaoMetasCarga } from '../drive.js';

const DIA = '2026-10-15'; // quinta-feira
const mostrar = (md) => {
  if (process.env.MOSTRAR_MD) console.log(md);
  return md;
};

const perfilBase = () => ({
  nome: 'Pessoa Teste',
  jids: ['5500000000001@s.whatsapp.net'],
  fuso: 'America/Sao_Paulo',
  peso: 80,
  altura: 178,
  objetivo: 'hipertrofia',
  lugares: [{ papel: 'casa', bairro: 'Bairro Secreto', nome: 'Rua Escondida', visitas: 9 }],
  atividades: [{ id: 'a1', nome: 'Vôlei', dias: [1, 4], inicio: '20:00', fim: '22:00', met: 6, lugar: { nome: 'Quadra Escondida', lat: 1, lon: 2 } }],
  atividadesFeitas: { [DIA]: [{ id: 'a1', feita: true, kcal: 960, minutos: 120, como: 'localizacao' }] },
});

function entradaDia() {
  const perfil = perfilBase();
  return {
    perfil,
    dia: DIA,
    refeicoes: [
      { dia: DIA, hora: '12:40', horaLocal: '12:40', minutos: 760, slot: 'almoco', descricao: 'arroz, feijão e frango', estimativa: { kcal: 700, p: 45, c: 80, g: 18 }, origem: 'app', foto: { driveId: 'x1', nome: '2026-10-15_1240_almoco.jpg' } },
      { dia: DIA, hora: '08:10', minutos: 490, slot: 'cafe', resumo: 'pão com ovo', estimativa: { kcal: 400, p: 22, c: 40, g: 15 } },
      { dia: '2026-10-14', hora: '20:00', minutos: 1200, slot: 'jantar', descricao: 'jantar de ontem', estimativa: { kcal: 900, p: 50, c: 90, g: 30 } },
    ],
    pesagens: [
      { dia: DIA, hora: '07:05', peso: 78.42, gordura: 18.2, fonte: 'relogio' },
      { dia: '2026-10-14', hora: '07:00', peso: 78.9, fonte: 'app' },
    ],
    humor: { dia: DIA, humor: 2, energia: 3, sono: 4, texto: 'semana pesada no trabalho' },
    eventos: [{ dia: DIA, hora: '20:00', titulo: 'Jantar de aniversário', tipo: 'comer_fora', nota: 'vai ter pizza' }],
    correcoes: [
      { dia: DIA, pessoa: 'Pessoa Teste', texto: 'Pessoa Teste ajustou pelo app a refeição das 12:40 (almoço): 650 para 700 kcal' },
      { dia: DIA, pessoa: 'Outra Pessoa', texto: 'Outra Pessoa apagou pelo app o lanche' },
    ],
    perguntas: [
      { dia: DIA, em: new Date('2026-10-15T18:02:00Z'), pergunta: 'Posso comer pão à noite?', resposta: 'Pode, dentro de 300 kcal.', tema: 'comida' },
      { dia: '2026-10-13', em: new Date('2026-10-13T12:00:00Z'), pergunta: 'Pergunta de outro dia', resposta: 'x', tema: 'outro' },
    ],
    saude: {
      sonos: [
        { dia: DIA, inicio: '2026-10-14 23:10', fim: '2026-10-15 06:40', total: 410, profundo: 70, rem: 90, leve: 250, acordado: 40, spo2: { media: 95.2, min: 89, minutosAbaixo90: 3 }, temperatura: { delta: 0.6 } },
        { dia: '2026-10-14', inicio: '2026-10-13 23:30', fim: '2026-10-14 06:30', total: 400 },
      ],
      atividades: [{ dia: DIA, passos: 9120, calorias: 2600, minAtivos: 48, distanciaM: 4800, kcalAtivas: 310, treinos: [{ nome: 'Caminhada', hora: '07:00', min: 30, kcal: 150 }] }],
    },
    treinos: [
      { inicio: '2026-10-08T21:00:00Z', fim: '2026-10-08T22:00:00Z', titulo: 'Treino A', exercicios: [{ title: 'Supino', exercise_template_id: 't1', sets: [{ type: 'normal', weight_kg: 50, reps: 8 }] }] },
      { inicio: '2026-10-15T21:00:00Z', fim: '2026-10-15T22:05:00Z', titulo: 'Treino A', exercicios: [{ title: 'Supino', exercise_template_id: 't1', sets: [{ type: 'warmup', weight_kg: 20, reps: 12 }, { type: 'normal', weight_kg: 50, reps: 10 }, { type: 'normal', weight_kg: 50, reps: 9 }] }] },
    ],
    catalogo: { t1: { primario: 'chest' } },
    contextoTreino: {},
    pensamentos: [
      { dia: DIA, hora: '17:30', texto: 'Comeu bem no almoço; à noite tem aniversário.', notar: ['aniversário hoje'], investigacao: 'NÃO DEVE APARECER' },
      { dia: DIA, hora: '11:30', texto: 'Dormiu bem.', notar: [] },
    ],
    despensa: [
      { item: 'arroz', compradoEm: DIA, quantidade: 2, unidade: 'kg', estado: 'tem' },
      { item: 'leite', acabouEm: DIA, estado: 'acabou' },
      { item: 'feijão', compradoEm: '2026-10-01', estado: 'tem' },
    ],
    habitos: { agua_ml: 2250, alcool_doses: 1 },
    falas: [{ dia: DIA, tipo: 'sexta', texto: 'Semana boa, gente.', em: new Date('2026-10-15T21:00:00Z') }],
    meta: { min: 2400, max: 2700 },
  };
}

// ============================================================
// Caminhos e o que o dossiê relê
// ============================================================
test('entraNoDossie: pastas, Nutri-* e arquivos com nome de dia, mês ou semana ficam de fora', () => {
  const pasta = 'application/vnd.google-apps.folder';
  assert.equal(entraNoDossie({ name: 'Dias', mimeType: pasta }), false);
  assert.equal(entraNoDossie({ name: 'Qualquer', mimeType: pasta }), false);
  assert.equal(entraNoDossie({ name: 'Fotos', mimeType: 'text/plain' }), false);
  for (const nome of ['Nutri-Despensa.md', 'Nutri-Ficha.md', 'Nutri-Pensamentos', 'Nutri-Conversas-App', '2026-10-15.md', '2026-10.md', '2026-W42.md']) {
    assert.equal(entraNoDossie({ name: nome, mimeType: 'text/markdown' }), false, nome);
  }
  // o que a pessoa deixa continua entrando, inclusive um exame com data no nome
  for (const nome of ['bioimpedancia.pdf', '2026-10-15.pdf', 'treino.txt', 'Anotações 2026-10.md']) {
    assert.equal(entraNoDossie({ name: nome, mimeType: 'application/pdf' }), true, nome);
  }
  assert.equal(entraNoDossie(null), false);
});

test('pessoas.js usa entraNoDossie na leitura da pasta (o espelho nunca vira dossiê)', () => {
  const fonte = readFileSync(new URL('../pessoas.js', import.meta.url), 'utf8');
  assert.match(fonte, /import \{ entraNoDossie \} from '\.\/drive-pessoa\.js'/);
  assert.match(fonte, /if \(!entraNoDossie\(arq\)\) continue;/);
  // a listagem não desce em subpasta
  assert.match(fonte, /filter\(\(f\) => f\.mimeType !== 'application\/vnd\.google-apps\.folder'\)/);
});

test('caminhoDrive e chavePendente', () => {
  assert.deepEqual(caminhoDrive('dia', DIA), { pasta: 'Dias/2026-10', arquivo: '2026-10-15.md' });
  assert.deepEqual(caminhoDrive('semana', '2026-W42'), { pasta: 'Semanas', arquivo: '2026-W42.md' });
  assert.deepEqual(caminhoDrive('plano', '2026-W43'), { pasta: 'Planos', arquivo: '2026-W43.md' });
  assert.deepEqual(caminhoDrive('pensamentos', '2026-10'), { pasta: 'Nutri-Pensamentos', arquivo: '2026-10.md' });
  assert.deepEqual(caminhoDrive('conversas', '2026-10'), { pasta: 'Nutri-Conversas-App', arquivo: '2026-10.md' });
  assert.deepEqual(caminhoDrive('despensa', 'atual'), { pasta: '', arquivo: 'Nutri-Despensa.md' });
  assert.throws(() => caminhoDrive('outro', 'x'));
  assert.equal(chavePendente({ jid: 'j1', tipo: 'dia', ref: DIA }), `j1|dia|${DIA}`);
});

test('fmPessoa: pula nulos, aspas em texto com espaço ou acento, números e datas crus', () => {
  const fm = fmPessoa({ tipo: 'dia-pessoa', pessoa: '[[Pessoa Teste]]', data: DIA, kcal: 1840, vazio: null, branco: '', meta_kcal: '1900-2100', tags: ['nutribot', 'dia'] });
  assert.equal(fm, '---\ntipo: dia-pessoa\npessoa: "[[Pessoa Teste]]"\ndata: 2026-10-15\nkcal: 1840\nmeta_kcal: 1900-2100\ntags: [nutribot, dia]\n---\n');
  assert.match(fmPessoa({ nome: 'Ação' }), /nome: "Ação"/);
});

// ============================================================
// O dia
// ============================================================
test('mdDiaPessoa: o dia inteiro com frontmatter, só deste dia e desta pessoa', () => {
  const md = mostrar(mdDiaPessoa(dadosDoDia(entradaDia())));
  // frontmatter
  assert.match(md, /^---\ntipo: dia-pessoa\npessoa: "\[\[Pessoa Teste\]\]"\ndata: 2026-10-15\n/);
  assert.match(md, /\nkcal: 1100\n/);
  assert.match(md, /\nmeta_kcal: 2400-2700\n/);
  assert.match(md, /\nproteina_g: 67\n/);
  assert.match(md, /\npeso_kg: 78\.42\n/);
  assert.match(md, /\nsono_min: 410\n/);
  assert.match(md, /\nnota_sono: \d+\n/);
  assert.match(md, /\npassos: 9120\n/);
  assert.match(md, /\nmin_ativos: 48\n/);
  assert.match(md, /\nhumor: 2\n/);
  assert.match(md, /\ntags: \[nutribot, pessoa, dia\]\n---\n/);
  // comida em ordem de hora, com origem e foto; o jantar de ontem não entra
  assert.ok(md.indexOf('- 08:10 Café da manhã: pão com ovo') > 0);
  assert.ok(md.indexOf('- 08:10 Café da manhã: pão com ovo') < md.indexOf('- 12:40 Almoço: arroz, feijão e frango'));
  assert.match(md, /pão com ovo · 400 kcal · P 22 g · C 40 g · G 15 g \(WhatsApp\)/);
  assert.match(md, /700 kcal · P 45 g · C 80 g · G 18 g \(app\) · foto: \[\[2026-10-15_1240_almoco\.jpg\]\]/);
  assert.match(md, /Total do dia: 1100 kcal · proteína 67 g/);
  assert.match(md, /Meta do dia: 2400 a 2700 kcal/);
  assert.doesNotMatch(md, /jantar de ontem/);
  // correções só desta pessoa
  assert.match(md, /650 para 700 kcal/);
  assert.doesNotMatch(md, /Outra Pessoa/);
  // pesagem do dia com fonte; a de ontem não
  assert.match(md, /07:05 78,42 kg · gordura 18,2 % · relógio/);
  assert.doesNotMatch(md, /78,9/);
  // sono com fases, oxigênio e temperatura (só no arquivo da própria pessoa, D12)
  assert.match(md, /dormiu 6h50/);
  assert.match(md, /Fases: profundo 70 min/);
  assert.match(md, /Oxigênio no sono: média 95,2 %, mínimo 89 %, 3 min abaixo de 90 %/);
  assert.match(md, /Temperatura da pele: \+0,6 °C/);
  // energia: só as partes que existem (nada de "?")
  assert.match(md, /## Energia\n- Nota \d+ \([a-zá ]+\): sono \d+\n/);
  assert.doesNotMatch(md, / \?[,\n]/);
  // atividade: distância e kcal ativas oficiais; atividade fixa feita
  assert.match(md, /Passos: 9\.120 de 8\.000 · 4,8 km/);
  assert.match(md, /Calorias ativas: 310 de 500 \(do relógio\)/);
  assert.match(md, /Exercício no relógio: Caminhada às 07:00, 30 min, 150 kcal/);
  assert.match(md, /Vôlei: feita \(~960 kcal em 120 min\) · pela localização/);
  // treino do dia: séries válidas (sem aquecimento) e a carga sugerida
  assert.match(md, /### Treino A \(18:00, 65 min\)/);
  assert.match(md, /Supino: 50 kg × 10 · 50 kg × 9/);
  assert.doesNotMatch(md, /20 kg × 12/);
  assert.match(md, /Próxima vez: /);
  // água e álcool, eventos, despensa do dia
  assert.match(md, /Água: 2\.250 ml/);
  assert.match(md, /20:00 Jantar de aniversário \(refeição fora\): vai ter pizza/);
  assert.match(md, /Entrou: arroz \(2 kg\)/);
  assert.match(md, /Acabou: leite/);
  assert.doesNotMatch(md, /feijão \(/);
  // humor com o texto marcado como confidência (D11); perguntas do app como confidência, só as do dia
  assert.match(md, /humor 2\/5 · energia 3\/5 · sono 4\/5/);
  assert.match(md, /Confidência \(a Nutri leva em conta e não cita no grupo\):\n> semana pesada no trabalho/);
  assert.match(md, /## Perguntas no app \(confidência: não citar no grupo\)\n- 15:02 Posso comer pão à noite\?\n  Resposta: Pode, dentro de 300 kcal\./);
  assert.doesNotMatch(md, /Pergunta de outro dia/);
  // pensamentos em ordem, sem a investigação; falas do dia (D20)
  assert.ok(md.indexOf('11:30 Dormiu bem.') < md.indexOf('17:30 Comeu bem'));
  assert.match(md, /Anotou: aniversário hoje/);
  assert.doesNotMatch(md, /NÃO DEVE APARECER/);
  assert.match(md, /18:00 fechamento da semana \(sexta\): Semana boa, gente\./);
  // localização nunca entra (nem o lugar da atividade fixa)
  assert.doesNotMatch(md, /Bairro Secreto|Rua Escondida|Quadra Escondida/);
  // sem marcação do WhatsApp nem emoji
  assert.doesNotMatch(md, /\*/);
  assert.match(md, /\[\[Diario\/2026-10-15\|Diário de 2026-10-15\]\]/);
});

test('mdDiaPessoa: dia vazio diz que não há refeição e não inventa seção', () => {
  const md = mostrar(mdDiaPessoa(dadosDoDia({ perfil: { nome: 'Pessoa Teste', jids: ['j'] }, dia: DIA })));
  assert.match(md, /Nenhuma refeição registrada\./);
  assert.doesNotMatch(md, /\nkcal:|\nnota_sono:|\nhumor:/);
  for (const secao of ['## Sono', '## Energia', '## Atividade', '## Treinos', '## Humor', '## Perguntas', '## Pensamentos', '## Pesagens']) assert.ok(!md.includes(secao), secao);
});

test('dadosDoDia: perguntas sem o campo dia usam o dia local de `em`; humor só com número não cria confidência', () => {
  const d = dadosDoDia({
    perfil: { nome: 'Pessoa Teste', fuso: 'America/Sao_Paulo' },
    dia: DIA,
    // 02:30Z do dia 16 ainda é 23:30 do dia 15 em São Paulo
    perguntas: [{ em: '2026-10-16T02:30:00Z', pergunta: 'Tarde da noite?', resposta: 'sim' }],
    humor: { humor: 4, texto: null },
  });
  assert.equal(d.perguntas.length, 1);
  assert.equal(d.perguntas[0].hora, '23:30');
  const md = mdDiaPessoa(d);
  assert.match(md, /humor 4\/5/);
  assert.doesNotMatch(md, /Confidência/);
});

// ============================================================
// A semana
// ============================================================
test('mdSemanaPessoa: médias, peso, apostas, cargas e o que veio do app', () => {
  const domingo = '2026-10-18';
  const perfil = perfilBase();
  const dias = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
  const s = dadosDaSemana({
    perfil,
    dia: domingo,
    refeicoes: [
      { dia: '2026-10-12', estimativa: { kcal: 2000, p: 120 } },
      { dia: '2026-10-13', estimativa: { kcal: 2400, p: 140 } },
      { dia: '2026-10-05', estimativa: { kcal: 9999, p: 999 } }, // fora da semana
    ],
    pesagens: [
      { dia: '2026-10-12', peso: 79.0 },
      { dia: '2026-10-18', peso: 78.6 },
    ],
    saude: { sonos: dias.map((d) => ({ dia: d, total: 420, inicio: `${d} 06:00`, fim: `${d} 13:00` })), atividades: dias.slice(0, 2).map((d, i) => ({ dia: d, passos: 8000 + i * 2000, minAtivos: 40 + i * 20 })) },
    humor: [
      { dia: '2026-10-13', humor: 3, energia: 2 },
      { dia: '2026-10-15', humor: 5, energia: 4 },
    ],
    perguntas: [
      { dia: '2026-10-14', tema: 'sono' },
      { dia: '2026-10-15', tema: 'sono' },
      { dia: '2026-10-16', tema: 'comida' },
      { dia: '2026-10-01', tema: 'peso' }, // fora
    ],
    previsaoNova: { deltaKg: 0.2, pesoPrevisto: 78.8, alvoDia: '2026-10-25' },
    previsaoConferida: { deltaKg: 0.3, resultado: { realKg: -0.4, erroKg: 0.7, acerto: 'errou' } },
    sugestoes: [
      { exercicio: 'Supino', deKg: 50, deReps: 8, paraKg: 52.5, paraReps: 10, status: 'aberta', feitaEm: domingo },
      { exercicio: 'Remada', deKg: 40, deReps: 10, paraKg: 42.5, paraReps: 12, status: 'encerrada', encerradaEm: domingo, batidaEm: '2026-10-16', como: '42,5 kg' },
      { exercicio: 'Agachamento', status: 'encerrada', encerradaEm: domingo, tentativas: 2 },
      { exercicio: 'Antigo', status: 'encerrada', encerradaEm: '2026-10-11' },
    ],
  });
  assert.equal(s.semana, '2026-W42');
  assert.equal(s.kcalMedia, 2200);
  assert.equal(s.proteinaMedia, 130);
  assert.equal(s.diasComComida, 2);
  assert.equal(s.sonoMedioMin, 420);
  assert.equal(s.passosMedia, 9000);
  assert.equal(s.minAtivosMedia, 50);
  assert.equal(s.perguntas, 3);
  assert.deepEqual(s.temas, [{ tema: 'sono', n: 2 }, { tema: 'comida', n: 1 }]);
  assert.equal(s.humorMedio, 4);
  const md = mostrar(mdSemanaPessoa(s));
  assert.match(md, /^---\ntipo: semana-pessoa\npessoa: "\[\[Pessoa Teste\]\]"\nsemana: 2026-W42\nde: 2026-10-12\nate: 2026-10-18\n/);
  assert.match(md, /kcal_media: 2200/);
  assert.match(md, /2200 kcal e 130 g de proteína por dia \(2 dia\(s\) com registro\)/);
  assert.match(md, /Início: 79 kg \(12\/10\)/);
  assert.match(md, /Fim: 78,6 kg \(18\/10\) · variação -0,4 kg/);
  assert.match(md, /Aposta da semana passada: previa \+0,3 kg, deu -0,4 kg \(errou\)/);
  assert.match(md, /Aposta para a próxima: \+0,2 kg, 78,8 kg até 25\/10/);
  assert.match(md, /Remada, bateu em 16\/10 \(42,5 kg\)/);
  assert.match(md, /Agachamento, tentou 2 vez\(es\) sem subir/);
  assert.doesNotMatch(md, /Antigo/);
  assert.match(md, /Meta: Supino de 50 kg × 8 para 52,5 kg \(ou 10 repetições\)/);
  assert.match(md, /## Pelo app \(confidência: não citar no grupo\)/);
  assert.match(md, /3 pergunta\(s\) no app: sono 2, comida 1/);
  assert.match(md, /\[\[Dias\/2026-10\/2026-10-12\|12\/10\]\]/);
});

// ============================================================
// Despensa, pensamentos, conversas e planos
// ============================================================
test('mdDespensa: por categoria, acabou no fim, compras só dos últimos 28 dias', () => {
  const md = mostrar(
    mdDespensa({
      nome: 'Pessoa Teste',
      dia: DIA,
      itens: [
        { item: 'leite', categoria: 'laticínios', estado: 'acabou', acabouEm: '2026-10-14' },
        { item: 'iogurte', categoria: 'laticínios', estado: 'tem', quantidade: 4, unidade: 'un', validadeEm: '2026-10-20' },
        { item: 'arroz', categoria: 'grãos', estado: 'acabando', quantidade: 0.5, unidade: 'kg', validadeEm: '2027-01-01' },
      ],
      compras: [
        { dia: '2026-10-10', loja: 'Mercado Exemplo', itens: [{ item: 'iogurte' }, { item: 'arroz' }] },
        { dia: '2026-09-01', loja: 'Compra antiga', itens: [{ item: 'x' }] },
      ],
    })
  );
  assert.match(md, /^---\ntipo: despensa\npessoa: "\[\[Pessoa Teste\]\]"\natualizado: 2026-10-15\nitens: 2\n/);
  assert.ok(md.indexOf('## Grãos') < md.indexOf('## Laticínios'));
  assert.match(md, /- arroz: 0,5 kg · acabando · vence 01\/01/);
  assert.ok(md.indexOf('- iogurte: 4 un · tem · vence 20/10') < md.indexOf('- leite · acabou em 14/10'));
  assert.match(md, /- 10\/10 · Mercado Exemplo · 2 item\(ns\): iogurte, arroz/);
  assert.doesNotMatch(md, /Compra antiga/);
  assert.match(mdDespensa({ nome: 'Pessoa Teste', dia: DIA }), /Nada na despensa\./);
});

test('mdPensamentos: só o mês, por dia e hora, marcados como particulares', () => {
  const md = mostrar(
    mdPensamentos({
      nome: 'Pessoa Teste',
      mes: '2026-10',
      pensamentos: [
        { dia: '2026-10-15', hora: '21:30', texto: 'Noite tranquila.' },
        { dia: '2026-10-15', hora: '11:30', texto: 'Manhã corrida.', notar: ['pulou o café'], assunto: 'rotina' },
        { dia: '2026-10-02', hora: '17:30', texto: 'Começo do mês.' },
        { dia: '2026-09-30', hora: '17:30', texto: 'Mês passado.' },
      ],
    })
  );
  assert.match(md, /tipo: pensamentos\npessoa: "\[\[Pessoa Teste\]\]"\nmes: 2026-10\ntotal: 3\n/);
  assert.match(md, /Particulares/);
  assert.ok(md.indexOf('Começo do mês') < md.indexOf('Manhã corrida'));
  assert.ok(md.indexOf('11:30 (rotina) Manhã corrida.') < md.indexOf('21:30 Noite tranquila.'));
  assert.match(md, /Anotou: pulou o café/);
  assert.doesNotMatch(md, /Mês passado/);
});

test('mdConversasApp: perguntas do mês com a hora local, marcadas como confidência (D16)', () => {
  const md = mostrar(
    mdConversasApp({
      nome: 'Pessoa Teste',
      mes: '2026-10',
      fuso: 'America/Sao_Paulo',
      perguntas: [
        { dia: '2026-10-15', em: '2026-10-15T18:02:00Z', pergunta: 'Posso comer pão à noite?', resposta: 'Pode.\nDentro de 300 kcal.', tema: 'comida' },
        { em: '2026-10-01T02:00:00Z', pergunta: 'Ainda é setembro aqui', resposta: 'sim' }, // 23:00 de 30/09 em São Paulo
        { dia: '2026-10-03', em: '2026-10-03T12:00:00Z', pergunta: 'Dormi mal', resposta: 'Vamos ver o sono.' },
      ],
    })
  );
  assert.match(md, /tipo: conversas-app\npessoa: "\[\[Pessoa Teste\]\]"\nmes: 2026-10\ntotal: 2\n/);
  assert.match(md, /Confidência: .*nunca cita no grupo/);
  assert.match(md, /- 15:02 \(comida\) Pergunta: Posso comer pão à noite\?\n  Resposta: Pode\.\n  Dentro de 300 kcal\./);
  assert.ok(md.indexOf('Dormi mal') < md.indexOf('Posso comer pão'));
  assert.doesNotMatch(md, /Ainda é setembro/);
});

test('mdPlanoSemana: todas as versões da semana, texto do WhatsApp vira markdown sem emoji', () => {
  const md = mostrar(
    mdPlanoSemana({
      nome: 'Pessoa Teste',
      semana: '2026-W43',
      planos: [
        { semana: '2026-W43', de: '2026-10-19', ate: '2026-10-25', texto: '*Segunda*\n• Almoço: frango 🍗', criadoEm: new Date('2026-10-17T21:00:00Z') },
        { semana: '2026-W43', de: '2026-10-19', ate: '2026-10-25', texto: '*Segunda*\n• Almoço: peixe', criadoEm: new Date('2026-10-18T12:00:00Z') },
      ],
    })
  );
  assert.match(md, /tipo: plano-semana\npessoa: "\[\[Pessoa Teste\]\]"\nsemana: 2026-W43\nde: 2026-10-19\nate: 2026-10-25\nversoes: 2\n/);
  assert.match(md, /# Plano de Pessoa Teste · semana 2026-W43 \(19\/10 a 25\/10\)/);
  assert.ok(md.indexOf('## Versão 1 (gerada em 17/10)') < md.indexOf('## Versão 2 (gerada em 18/10)'));
  assert.match(md, /\*\*Segunda\*\*\n- Almoço: frango\n/);
  assert.doesNotMatch(md, /🍗/);
  // um plano só: sem cabeçalho de versão
  assert.doesNotMatch(mdPlanoSemana({ nome: 'Pessoa Teste', semana: '2026-W43', planos: [{ texto: 'x' }] }), /Versão/);
});

// ============================================================
// drive.js: repetição e a ficha
// ============================================================
test('comRepeticao: repete o erro passageiro com espera crescente e devolve o resultado', async () => {
  const esperas = [];
  let n = 0;
  const r = await comRepeticao(
    async () => {
      n++;
      if (n < 3) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return 'ok';
    },
    { tentativas: 3, esperaMs: 10, dormir: async (ms) => esperas.push(ms) }
  );
  assert.equal(r, 'ok');
  assert.equal(n, 3);
  assert.deepEqual(esperas, [10, 30]);
});

test('comRepeticao: erro permanente (credencial) não repete; esgotou as tentativas, lança o último erro', async () => {
  let n = 0;
  await assert.rejects(
    comRepeticao(async () => {
      n++;
      throw new Error('invalid_grant: token has been expired or revoked');
    }, { dormir: async () => {} }),
    /invalid_grant/
  );
  assert.equal(n, 1);
  let m = 0;
  await assert.rejects(
    comRepeticao(async () => {
      m++;
      throw Object.assign(new Error(`falha ${m}`), { code: 503 });
    }, { tentativas: 2, dormir: async () => {} }),
    /falha 2/
  );
  assert.equal(m, 2);
  assert.equal(erroPermanenteDrive({ message: 'x', code: 401 }), true);
  assert.equal(erroPermanenteDrive({ message: 'rate limit', code: 429 }), false);
  assert.equal(erroPermanenteDrive({ message: 'File not found', code: 404 }), false);
});

test('mdPerfil: ficha ganha atividades fixas (sem o lugar) e metas de carga em aberto', () => {
  const p = {
    ...perfilBase(),
    sugestoesCarga: [
      { exercicio: 'Supino', deKg: 50, deReps: 8, paraKg: 52.5, paraReps: 10, status: 'batida', batidaEm: '2026-10-16', como: '52,5 kg', feitaEm: '2026-10-11' },
      { exercicio: 'Remada', deKg: 40, deReps: 10, paraKg: 42.5, paraReps: 12, status: 'tentando', tentativas: 2, feitaEm: '2026-10-11' },
      { exercicio: 'Velha', deKg: 10, deReps: 10, paraKg: 12, paraReps: 12, status: 'encerrada' },
    ],
  };
  const md = mostrar(mdPerfil(p));
  assert.match(md, /## Atividades fixas\n- Vôlei · seg, qui 20:00–22:00 · MET 6 ≈ 960 kcal\n/);
  assert.doesNotMatch(md, /Quadra Escondida/);
  assert.match(md, /## Metas de carga da semana \(desde 11\/10\)\n- Supino: de 50 kg × 8 para 52,5 kg \(ou 10 repetições com 50 kg\) · bateu em 16\/10 \(52,5 kg\)\n- Remada: de 40 kg × 10 para 42,5 kg \(ou 12 repetições com 40 kg\) · tentou 2 vez\(es\)\n/);
  assert.doesNotMatch(md, /Velha/);
  assert.equal(secaoAtividadesFixas({}), '');
  assert.equal(secaoMetasCarga({ sugestoesCarga: [{ exercicio: 'X', status: 'encerrada' }] }), '');
});
