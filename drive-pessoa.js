// drive-pessoa.js - Montadores PUROS dos arquivos de cada pessoa no Drive (fase 7, frente C; seção 4C do mapa do ecossistema).
// O Mongo é a fonte; estes arquivos são o espelho pro dono ler e de backup. A IA não lê nada daqui de volta: o dossiê
// (pessoas.js) ignora as subpastas e os arquivos Nutri-* (ver `entraNoDossie`).
//
// Arquivos (dentro da pasta da pessoa):
//   Dias/AAAA-MM/AAAA-MM-DD.md        -> o dia inteiro da pessoa (mdDiaPessoa)
//   Semanas/AAAA-Www.md               -> a semana (mdSemanaPessoa), no domingo
//   Nutri-Despensa.md                 -> estado atual da despensa + compras dos últimos 28 dias (mdDespensa)
//   Nutri-Pensamentos/AAAA-MM.md      -> pensamentos do mês (mdPensamentos)
//   Nutri-Conversas-App/AAAA-MM.md    -> perguntas e respostas do app no mês (mdConversasApp; D16: para sempre no Drive)
//   Planos/AAAA-Www.md                -> cada plano gerado para a semana (mdPlanoSemana)
//
// Privacidade: humor (texto), perguntas do app e pensamentos são confidência. Ficam só na pasta da própria pessoa e vêm
// marcados como tal; nada daqui entra em resumo do grupo, momentos, diário da Nutri ou memória vetorial.
// Oxigênio e temperatura da pele (D12) só aparecem no arquivo da própria pessoa. Localização não entra em nenhum arquivo.

import { montarSono, montarEnergia, montarAtividade, treinosPorTitulo, diaLocalDe, semZap } from './api-montadores.js';
import { nomeDoSlot } from './resumo.js';
import { fusoDe, diasAnteriores, semanaISO, dataExtenso } from './util.js';

// ============================================================
// Caminhos e o que o dossiê não relê
// ============================================================
/** Subpastas e arquivos que este módulo escreve na pasta da pessoa. */
export const PASTA_DIAS = 'Dias';
export const PASTA_SEMANAS = 'Semanas';
export const PASTA_PLANOS = 'Planos';
export const PASTA_PENSAMENTOS = 'Nutri-Pensamentos';
export const PASTA_CONVERSAS_APP = 'Nutri-Conversas-App';
export const ARQ_DESPENSA = 'Nutri-Despensa.md';

/** Puro. Onde fica cada arquivo: { pasta (relativa à pasta da pessoa; '' = a própria), arquivo }. */
export function caminhoDrive(tipo, ref) {
  switch (tipo) {
    case 'dia':
      return { pasta: `${PASTA_DIAS}/${String(ref).slice(0, 7)}`, arquivo: `${ref}.md` };
    case 'semana':
      return { pasta: PASTA_SEMANAS, arquivo: `${ref}.md` };
    case 'plano':
      return { pasta: PASTA_PLANOS, arquivo: `${ref}.md` };
    case 'pensamentos':
      return { pasta: PASTA_PENSAMENTOS, arquivo: `${ref}.md` };
    case 'conversas':
      return { pasta: PASTA_CONVERSAS_APP, arquivo: `${ref}.md` };
    case 'despensa':
      return { pasta: '', arquivo: ARQ_DESPENSA };
    default:
      throw new Error(`tipo de arquivo do Drive desconhecido: ${tipo}`);
  }
}

// Subpastas que são espelho do sistema (as novas, a das fotos do app e qualquer "Nutri-*"): o dossiê nunca relê
const PASTAS_ESPELHO = new Set([PASTA_DIAS, PASTA_SEMANAS, PASTA_PLANOS, 'Fotos'].map((n) => n.toLowerCase()));
const PASTA_DRIVE = 'application/vnd.google-apps.folder';
// .md com nome de dia, mês ou semana ("2026-10-15.md", "2026-10.md", "2026-W42.md"): é arquivo de espelho fora do lugar
const RE_ARQ_ESPELHO = /^\d{4}-(\d{2}(-\d{2})?|W\d{2})\.md$/i;

/**
 * Puro. O arquivo da pasta da pessoa entra no dossiê (o que a IA lê sobre ela)? Não entram: pastas (o dossiê não desce em
 * subpasta, e as do espelho nunca), arquivos "Nutri-*" (o que a própria Nutri escreve; Nutri-Notas.md é lido à parte em
 * pessoas.js) e .md com nome de dia, mês ou semana (um arquivo do espelho movido pra raiz da pasta). Sem isso, a IA
 * releria o próprio espelho, com o humor e as perguntas do app, e isso poderia sair no grupo.
 */
export function entraNoDossie(arq) {
  if (!arq?.name) return false;
  const nome = String(arq.name);
  if (arq.mimeType === PASTA_DRIVE) return false;
  if (PASTAS_ESPELHO.has(nome.toLowerCase())) return false;
  if (nome.startsWith('Nutri-')) return false;
  if (RE_ARQ_ESPELHO.test(nome)) return false;
  return true;
}

/** Puro. Chave da marca de pendência no Mongo (drive_pendentes): uma por pessoa, tipo e referência. */
export const chavePendente = ({ jid, tipo, ref }) => `${jid}|${tipo}|${ref}`;

// ============================================================
// Formatação
// ============================================================
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const int = (v) => (num(v) == null ? null : Math.round(num(v)));
const arred = (v, casas = 1) => (num(v) == null ? null : Math.round(num(v) * 10 ** casas) / 10 ** casas);
/** 78.45 -> "78,5" (texto do corpo, com vírgula). */
const dec = (v, casas = 1) => (num(v) == null ? null : String(arred(v, casas)).replace('.', ','));
const milhar = (v) => (int(v) == null ? null : String(int(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
const hm = (min) => (int(min) == null ? null : `${Math.floor(int(min) / 60)}h${String(int(min) % 60).padStart(2, '0')}`);
const ddmm = (dia) => `${String(dia).slice(8, 10)}/${String(dia).slice(5, 7)}`;
const umaLinha = (t, max = 400) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Texto de várias linhas recuado pra caber num item de lista. */
const recuar = (t, max = 4000, recuo = '  ') => String(t ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max).replace(/\n/g, `\n${recuo}`);
const media = (xs) => {
  const v = xs.map(num).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const minDe = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** Hora local (HH:MM) de um instante no fuso; null se o instante for inválido. */
function horaEm(em, fuso) {
  const d = em instanceof Date ? em : new Date(em);
  if (em == null || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('sv-SE', { timeZone: fuso }).slice(11, 16);
}
/** Dia local (AAAA-MM-DD) de um instante no fuso; null se inválido. */
function diaEm(em, fuso) {
  const d = em instanceof Date ? em : new Date(em);
  if (em == null || Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('sv-SE', { timeZone: fuso }).slice(0, 10);
}
const ROTULO = { excelente: 'excelente', boa: 'boa', bom: 'bom', razoavel: 'razoável', atencao: 'pede atenção' };
const rotulo = (r) => (r ? ROTULO[r] || String(r) : null);
const FONTE_PESO = { relogio: 'relógio', app: 'app', documento: 'documento', whatsapp: 'WhatsApp', zap: 'WhatsApp', manual: 'WhatsApp' };
const TIPO_EVENTO = { comer_fora: 'refeição fora', festa: 'festa', viagem: 'viagem', treino: 'treino', consulta: 'consulta', outro: 'outro' };
const NOME_FALA = { segunda: 'abertura da semana (segunda)', sexta: 'fechamento da semana (sexta)' };

/**
 * Puro. Frontmatter no estilo dos outros arquivos (tipo, tags nutribot). Campo nulo ou vazio fica de fora; texto com
 * caractere especial vai entre aspas; números e datas vão crus.
 */
export function fmPessoa(campos) {
  const linhas = [];
  for (const [k, v] of Object.entries(campos)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) linhas.push(`${k}: [${v.join(', ')}]`);
    else if (typeof v === 'number' || typeof v === 'boolean') linhas.push(`${k}: ${v}`);
    else linhas.push(`${k}: ${/^[\w.\/-]+$/u.test(String(v)) ? v : JSON.stringify(String(v))}`);
  }
  return `---\n${linhas.join('\n')}\n---\n`;
}

// ============================================================
// O dia da pessoa
// ============================================================
const serieValida = (s) => s && s.type !== 'warmup' && ((Number(s.reps) || 0) > 0 || (Number(s.duration_seconds) || 0) > 0);
const textoSerie = (s) => {
  const kg = num(s.weight_kg);
  const reps = int(s.reps);
  if (reps > 0) return kg > 0 ? `${dec(kg, 2)} kg × ${reps}` : `${reps} repetições`;
  return `${int(s.duration_seconds)} s`;
};

/**
 * Puro. Junta os dados crus de um dia de uma pessoa (o que dia.js buscou nas coleções) numa estrutura pronta pro markdown.
 * Usa os mesmos montadores do app (sono, energia, atividade, treinos por título), então o Drive diz o mesmo número que o app.
 * Tudo é filtrado pelo `dia` aqui também: quem chama pode mandar uma janela maior (os treinos vêm com 8 semanas, pra
 * sugestão de carga do dia).
 * @returns {object} { nome, dia, fuso, refeicoes, totais, meta, correcoes, pesagens, humor, eventos, perguntas, sono,
 *   energia, atividade, atividadesFixas, treinos, habitos, despensa, pensamentos, falas }
 */
export function dadosDoDia({
  perfil = {},
  dia,
  refeicoes = [],
  pesagens = [],
  humor = null,
  eventos = [],
  correcoes = [],
  perguntas = [],
  saude = null,
  treinos = [],
  catalogo = {},
  contextoTreino = {},
  pensamentos = [],
  despensa = [],
  habitos = null,
  falas = [],
  meta = null,
}) {
  const fuso = fusoDe(perfil);
  const refs = (refeicoes || [])
    .filter((r) => r?.dia === dia)
    .map((r) => ({ r, min: num(r.minutos) ?? minDe(r.horaLocal || r.hora) ?? 0 }))
    .sort((a, b) => a.min - b.min)
    .map(({ r }) => ({
      hora: r.horaLocal || r.hora || null,
      tipo: r.slot ? nomeDoSlot(r.slot) : 'refeição',
      descricao: umaLinha(r.descricao || r.resumo || '', 240) || null,
      kcal: int(r.estimativa?.kcal),
      p: int(r.estimativa?.p),
      c: int(r.estimativa?.c),
      g: int(r.estimativa?.g),
      foto: r.foto?.nome || null,
      origem: r.origem === 'app' ? 'app' : 'WhatsApp',
    }));
  const soma = (k) => refs.reduce((s, r) => s + (r[k] || 0), 0);
  const totais = refs.length ? { kcal: soma('kcal'), p: soma('p'), c: soma('c'), g: soma('g') } : null;

  // sono, energia e atividade: os montadores do app (nota, fases, fatores); oxigênio e temperatura direto do coletor
  let sono = null;
  let energia = null;
  let atividade = null;
  if (saude) {
    const s = montarSono({ saude, dia });
    if (s.nota != null || s.dormidoMin != null) {
      const noite = (saude.sonos || []).find((x) => x?.dia === dia) || {};
      sono = {
        nota: s.nota,
        rotulo: rotulo(s.rotulo),
        inicio: s.inicio,
        fim: s.fim,
        dormidoMin: s.dormidoMin,
        emCamaMin: s.emCamaMin,
        latenciaMin: s.latenciaMin,
        fases: s.fases,
        fcMedia: s.fcMedia,
        fcMin: s.fcMin,
        hrv: s.hrv,
        fatores: (s.fatores || []).filter((f) => f?.valor && f.valor !== 'sem dado').map((f) => ({ nome: f.nome, valor: f.valor, nivel: rotulo(f.nivel) })),
        spo2: noite.spo2 && num(noite.spo2.media) != null ? { media: arred(noite.spo2.media), min: arred(noite.spo2.min), minutosAbaixo90: int(noite.spo2.minutosAbaixo90) } : null,
        temperatura: noite.temperatura && (num(noite.temperatura.delta) != null || num(noite.temperatura.media) != null) ? { media: arred(noite.temperatura.media), delta: arred(noite.temperatura.delta) } : null,
      };
    }
    const e = montarEnergia({ perfil, saude, dia });
    if (e.nota != null) energia = { nota: e.nota, rotulo: rotulo(e.rotulo), partes: e.partes, fatores: (e.fatores || []).filter((f) => f?.valor && f.valor !== 'sem dado').map((f) => ({ nome: f.nome, valor: f.valor, nivel: rotulo(f.nivel) })) };
    const a = montarAtividade({ perfil, saude, dia, hoje: dia });
    const bruto = (saude.atividades || []).find((x) => x?.dia === dia) || null;
    if (bruto || a.passos != null) {
      const kcalOficial = num(bruto?.kcalAtivas) > 0 ? int(bruto.kcalAtivas) : null;
      atividade = {
        passos: a.passos,
        metaPassos: a.metaPassos,
        minAtivos: a.minAtivos,
        metaMin: a.metaMin,
        kcalAtivas: kcalOficial ?? a.kcalAtivas,
        kcalAtivasEstimada: kcalOficial == null,
        metaKcal: a.metaKcal,
        kcalTotal: a.kcalTotal,
        distanciaKm: num(bruto?.distanciaM) > 0 ? arred(Number(bruto.distanciaM) / 1000, 1) : null,
        picoHora: a.picoHora,
        exercicios: a.exercicios || [],
      };
    }
  }

  // atividades fixas decididas no dia (feita ou não, e como se soube)
  const fixas = (perfil.atividades || []).reduce((m, a) => m.set(a.id, a), new Map());
  const atividadesFixas = (perfil.atividadesFeitas?.[dia] || []).map((f) => ({
    nome: fixas.get(f.id)?.nome || 'atividade fixa',
    feita: Boolean(f.feita),
    kcal: int(f.kcal),
    minutos: int(f.minutos),
    como: f.como === 'sem_resposta' ? 'sem resposta' : f.como === 'resposta' ? 'disse no grupo' : f.como ? 'pela localização' : null,
  }));

  // treinos do Hevy feitos no dia (no fuso da pessoa), com a carga sugerida pra próxima vez (a mesma do app, D18)
  const doDia = (treinos || []).filter((t) => t?.inicio && diaLocalDe(t.inicio, fuso) === dia).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  const sugestao = new Map();
  if (doDia.length) {
    try {
      for (const caixa of treinosPorTitulo({ sessoes: treinos, catalogo, dia, contexto: contextoTreino, fuso })) {
        if (caixa.ultimaData !== dia) continue;
        for (const e of caixa.exercicios || []) if (e.frase) sugestao.set(e.nome, e.frase);
      }
    } catch {
      // sem sugestão: o treino entra assim mesmo
    }
  }
  const treinosDia = doDia.map((t) => {
    const dur = (Date.parse(t.fim) - Date.parse(t.inicio)) / 60_000;
    return {
      titulo: umaLinha(t.titulo || 'Treino', 80),
      hora: horaEm(t.inicio, fuso),
      duracaoMin: Number.isFinite(dur) && dur > 0 && dur < 600 ? Math.round(dur) : null,
      exercicios: (t.exercicios || [])
        .map((e) => ({ nome: umaLinha(e?.title || 'Exercício', 80), series: (e?.sets || []).filter(serieValida).map(textoSerie), sugestao: sugestao.get(e?.title) || null }))
        .filter((e) => e.series.length),
    };
  });

  const pesagensDia = (pesagens || [])
    .filter((p) => p?.dia === dia && num(p.peso) > 0)
    .sort((a, b) => (minDe(a.hora) ?? 0) - (minDe(b.hora) ?? 0))
    .map((p) => ({ hora: p.hora || null, peso: arred(p.peso, 2), gordura: num(p.gordura) != null ? arred(p.gordura) : null, fonte: FONTE_PESO[p.fonte] || (p.fonte ? String(p.fonte) : 'WhatsApp'), descartada: Boolean(p.descartada) }));

  const perguntasDia = (perguntas || [])
    .filter((q) => (q?.dia || diaEm(q?.em, fuso)) === dia)
    .sort((a, b) => new Date(a.em || 0) - new Date(b.em || 0))
    .map((q) => ({ hora: horaEm(q.em, fuso), pergunta: umaLinha(q.pergunta, 400), resposta: recuar(q.resposta, 1200, '  '), tema: q.tema || null }));

  return {
    nome: perfil.nome || 'Pessoa',
    dia,
    fuso,
    refeicoes: refs,
    totais,
    meta: meta && num(meta.min) != null && num(meta.max) != null ? { min: int(meta.min), max: int(meta.max) } : null,
    correcoes: (correcoes || []).filter((c) => !c?.pessoa || c.pessoa === perfil.nome).map((c) => umaLinha(c.texto, 300)).filter(Boolean),
    pesagens: pesagensDia,
    humor: humor && (num(humor.humor) != null || humor.texto) ? { humor: int(humor.humor), energia: int(humor.energia), sono: int(humor.sono), texto: humor.texto ? recuar(humor.texto, 600, '> ') : null } : null,
    eventos: (eventos || [])
      .filter((e) => e?.dia === dia)
      .sort((a, b) => (minDe(a.hora) ?? 9999) - (minDe(b.hora) ?? 9999))
      .map((e) => ({ hora: e.hora || null, titulo: umaLinha(e.titulo, 80), tipo: TIPO_EVENTO[e.tipo] || 'outro', nota: e.nota ? umaLinha(e.nota, 200) : null })),
    perguntas: perguntasDia,
    sono,
    energia,
    atividade,
    atividadesFixas,
    treinos: treinosDia,
    habitos: habitos && (num(habitos.agua_ml) > 0 || num(habitos.alcool_doses) > 0) ? { aguaMl: int(habitos.agua_ml) || 0, alcoolDoses: arred(habitos.alcool_doses) || 0 } : null,
    despensa: {
      entrou: (despensa || []).filter((i) => i?.compradoEm === dia).map((i) => ({ item: umaLinha(i.item, 80), quantidade: num(i.quantidade), unidade: i.unidade || 'un' })),
      acabou: (despensa || []).filter((i) => i?.acabouEm === dia).map((i) => ({ item: umaLinha(i.item, 80) })),
    },
    pensamentos: (pensamentos || [])
      .filter((p) => p?.dia === dia)
      .sort((a, b) => (minDe(a.hora) ?? 0) - (minDe(b.hora) ?? 0))
      .map((p) => ({ hora: p.hora || null, texto: recuar(p.texto, 1200), notar: (p.notar || []).map((n) => umaLinha(n, 200)).filter(Boolean) })),
    falas: (falas || [])
      .filter((f) => f?.dia === dia && f.texto)
      .map((f) => ({ hora: horaEm(f.em, fuso), tipo: NOME_FALA[f.tipo] || (f.tipo ? String(f.tipo) : 'nota de voz'), texto: recuar(f.texto, 3000) })),
  };
}

/** Puro. O arquivo Dias/AAAA-MM/AAAA-MM-DD.md da pessoa (dados de `dadosDoDia`). */
export function mdDiaPessoa(d) {
  const partes = [];
  const fm = fmPessoa({
    tipo: 'dia-pessoa',
    pessoa: `[[${d.nome}]]`,
    data: d.dia,
    kcal: d.totais ? d.totais.kcal : null,
    meta_kcal: d.meta ? `${d.meta.min}-${d.meta.max}` : null,
    proteina_g: d.totais ? d.totais.p : null,
    peso_kg: d.pesagens.find((p) => !p.descartada)?.peso ?? null,
    sono_min: d.sono?.dormidoMin ?? null,
    nota_sono: d.sono?.nota ?? null,
    energia: d.energia?.nota ?? null,
    passos: d.atividade?.passos ?? null,
    min_ativos: d.atividade?.minAtivos ?? null,
    humor: d.humor?.humor ?? null,
    tags: ['nutribot', 'pessoa', 'dia'],
  });
  partes.push(`# ${d.nome} · ${dataExtenso(d.dia)}`);

  // Comida
  const comida = [];
  if (d.refeicoes.length) {
    for (const r of d.refeicoes) {
      const macros = [r.kcal != null ? `${r.kcal} kcal` : null, r.p != null ? `P ${r.p} g` : null, r.c != null ? `C ${r.c} g` : null, r.g != null ? `G ${r.g} g` : null].filter(Boolean).join(' · ');
      comida.push(`- ${r.hora || '--:--'} ${r.tipo}${r.descricao ? `: ${r.descricao}` : ''}${macros ? ` · ${macros}` : ''} (${r.origem})${r.foto ? ` · foto: [[${r.foto}]]` : ''}`);
    }
    comida.push('');
    comida.push(`Total do dia: ${d.totais.kcal} kcal · proteína ${d.totais.p} g · carboidratos ${d.totais.c} g · gorduras ${d.totais.g} g`);
  } else {
    comida.push('Nenhuma refeição registrada.');
  }
  if (d.meta) comida.push(`Meta do dia: ${d.meta.min} a ${d.meta.max} kcal`);
  partes.push(`## Comida\n${comida.join('\n')}`);
  if (d.correcoes.length) partes.push(`## Correções do dia (app e WhatsApp)\n${d.correcoes.map((c) => `- ${c}`).join('\n')}`);
  if (d.habitos) partes.push(`## Água e álcool\n- Água: ${milhar(d.habitos.aguaMl)} ml\n- Álcool: ${dec(d.habitos.alcoolDoses)} dose(s)`);

  // Corpo
  if (d.pesagens.length) {
    partes.push(
      `## Pesagens\n${d.pesagens.map((p) => `- ${p.hora ? `${p.hora} ` : ''}${dec(p.peso, 2)} kg${p.gordura != null ? ` · gordura ${dec(p.gordura)} %` : ''} · ${p.fonte}${p.descartada ? ' (descartada pela validação)' : ''}`).join('\n')}`
    );
  }
  if (d.sono) {
    const s = d.sono;
    const l = [];
    l.push(`- Nota ${s.nota ?? 'sem nota'}${s.rotulo ? ` (${s.rotulo})` : ''}: dormiu ${hm(s.dormidoMin) || '?'}${s.emCamaMin != null ? ` de ${hm(s.emCamaMin)} na cama` : ''}${s.inicio && s.fim ? `, das ${s.inicio} às ${s.fim}` : ''}`);
    if (s.fases) l.push(`- Fases: profundo ${s.fases.profundo.min} min (${s.fases.profundo.pct} %) · REM ${s.fases.rem.min} min (${s.fases.rem.pct} %) · leve ${s.fases.leve.min} min (${s.fases.leve.pct} %) · acordado ${s.fases.acordado.min} min`);
    if (s.latenciaMin != null) l.push(`- Pegou no sono em ${s.latenciaMin} min`);
    if (s.fcMedia != null || s.hrv != null) l.push(`- No sono: ${[s.fcMedia != null ? `FC média ${s.fcMedia}` : null, s.fcMin != null ? `mínima ${s.fcMin}` : null, s.hrv != null ? `VFC ${s.hrv} ms` : null].filter(Boolean).join(' · ')}`);
    if (s.spo2) l.push(`- Oxigênio no sono: média ${dec(s.spo2.media)} %${s.spo2.min != null ? `, mínimo ${dec(s.spo2.min)} %` : ''}${s.spo2.minutosAbaixo90 != null ? `, ${s.spo2.minutosAbaixo90} min abaixo de 90 %` : ''}`);
    if (s.temperatura) l.push(`- Temperatura da pele: ${s.temperatura.delta != null ? `${s.temperatura.delta > 0 ? '+' : ''}${dec(s.temperatura.delta)} °C em relação à sua base` : `média ${dec(s.temperatura.media)} °C`}`);
    if (s.fatores.length) l.push(`- Fatores: ${s.fatores.map((f) => `${f.nome} ${f.valor}${f.nivel ? ` (${f.nivel})` : ''}`).join(' · ')}`);
    partes.push(`## Sono (noite que terminou neste dia)\n${l.join('\n')}`);
  }
  if (d.energia) {
    const e = d.energia;
    const p = e.partes || {};
    const comp = [p.sono != null ? `sono ${p.sono}` : null, p.recuperacao != null ? `recuperação ${p.recuperacao}` : null, p.carga != null ? `carga ${p.carga}` : null].filter(Boolean);
    const l = [`- Nota ${e.nota}${e.rotulo ? ` (${e.rotulo})` : ''}${comp.length ? `: ${comp.join(', ')}` : ''}`];
    if (e.fatores.length) l.push(`- Fatores: ${e.fatores.map((f) => `${f.nome} ${f.valor}${f.nivel ? ` (${f.nivel})` : ''}`).join(' · ')}`);
    partes.push(`## Energia\n${l.join('\n')}`);
  }
  if (d.atividade || d.atividadesFixas.length) {
    const l = [];
    const a = d.atividade;
    if (a) {
      l.push(`- Passos: ${a.passos != null ? milhar(a.passos) : 'sem dado'} de ${milhar(a.metaPassos)}${a.distanciaKm != null ? ` · ${dec(a.distanciaKm)} km` : ''}`);
      l.push(`- Minutos ativos: ${a.minAtivos ?? 'sem dado'} de ${a.metaMin}`);
      l.push(`- Calorias ativas: ${a.kcalAtivas ?? 'sem dado'} de ${a.metaKcal}${a.kcalAtivas != null ? (a.kcalAtivasEstimada ? ' (estimadas)' : ' (do relógio)') : ''}${a.kcalTotal != null ? ` · gasto total ${milhar(a.kcalTotal)} kcal` : ''}`);
      if (a.picoHora) l.push(`- Mais ativa(o) entre ${a.picoHora.replace('–', ' e ')}`);
      for (const x of a.exercicios) l.push(`- Exercício no relógio: ${x.nome}${x.hora ? ` às ${x.hora}` : ''}${x.min != null ? `, ${x.min} min` : ''}${x.kcal != null ? `, ${x.kcal} kcal` : ''}${x.fcMedia != null ? `, FC média ${x.fcMedia}` : ''}`);
    }
    for (const f of d.atividadesFixas) l.push(`- ${f.nome}: ${f.feita ? `feita${f.kcal != null ? ` (~${f.kcal} kcal${f.minutos != null ? ` em ${f.minutos} min` : ''})` : ''}` : 'não houve'}${f.como ? ` · ${f.como}` : ''}`);
    partes.push(`## Atividade\n${l.join('\n')}`);
  }
  if (d.treinos.length) {
    const blocos = d.treinos.map((t) => {
      const cab = `### ${t.titulo}${t.hora ? ` (${t.hora}` : ''}${t.hora && t.duracaoMin != null ? `, ${t.duracaoMin} min)` : t.hora ? ')' : ''}`;
      const ex = t.exercicios.map((e) => `- ${e.nome}: ${e.series.join(' · ')}${e.sugestao ? `\n  - Próxima vez: ${e.sugestao}` : ''}`);
      return `${cab}\n${ex.join('\n') || '- (sem séries válidas)'}`;
    });
    partes.push(`## Treinos e cargas\n${blocos.join('\n\n')}`);
  }

  // App e cabeça
  if (d.humor) {
    const h = d.humor;
    const nums = [h.humor != null ? `humor ${h.humor}/5` : null, h.energia != null ? `energia ${h.energia}/5` : null, h.sono != null ? `sono ${h.sono}/5` : null].filter(Boolean).join(' · ');
    partes.push(`## Humor (pelo app)\n${nums ? `- ${nums}\n` : ''}${h.texto ? `\nConfidência (a Nutri leva em conta e não cita no grupo):\n> ${h.texto}` : ''}`.trimEnd());
  }
  if (d.eventos.length) partes.push(`## Eventos marcados no app\n${d.eventos.map((e) => `- ${e.hora || 'sem hora'} ${e.titulo} (${e.tipo})${e.nota ? `: ${e.nota}` : ''}`).join('\n')}`);
  if (d.despensa.entrou.length || d.despensa.acabou.length) {
    const l = [];
    if (d.despensa.entrou.length) l.push(`- Entrou: ${d.despensa.entrou.map((i) => `${i.item}${i.quantidade != null ? ` (${dec(i.quantidade, 2)} ${i.unidade})` : ''}`).join(', ')}`);
    if (d.despensa.acabou.length) l.push(`- Acabou: ${d.despensa.acabou.map((i) => i.item).join(', ')}`);
    partes.push(`## Despensa\n${l.join('\n')}`);
  }
  if (d.perguntas.length) {
    partes.push(
      `## Perguntas no app (confidência: não citar no grupo)\n${d.perguntas.map((q) => `- ${q.hora || '--:--'} ${q.pergunta}${q.resposta ? `\n  Resposta: ${q.resposta}` : ''}`).join('\n')}`
    );
  }
  if (d.pensamentos.length) {
    partes.push(
      `## Pensamentos da Nutri (particulares)\n${d.pensamentos.map((p) => `- ${p.hora || '--:--'} ${p.texto}${p.notar.length ? `\n  Anotou: ${p.notar.join('; ')}` : ''}`).join('\n')}`
    );
  }
  if (d.falas.length) partes.push(`## Notas de voz da Nutri no grupo\n${d.falas.map((f) => `- ${f.hora ? `${f.hora} ` : ''}${f.tipo}: ${f.texto}`).join('\n')}`);

  partes.push(`---\nConversa do grupo: [[Diario/${d.dia}|Diário de ${d.dia}]] · Resumo: [[Resumos/${d.dia}|${d.dia}]]`);
  return `${fm}\n${partes.join('\n\n')}\n`;
}

// ============================================================
// A semana da pessoa (domingo)
// ============================================================
/**
 * Puro. Médias e fatos da semana que termina em `dia` (domingo): kcal e proteína (só dias com registro), sono e nota de
 * sono, energia, passos e minutos ativos (relógio), peso no início e no fim, aposta da semana e a conferida, sugestões de
 * carga (as novas e o resultado das que fecharam hoje), temas das perguntas do app e humor médio.
 */
export function dadosDaSemana({ perfil = {}, dia, refeicoes = [], pesagens = [], saude = null, humor = [], perguntas = [], previsaoNova = null, previsaoConferida = null, sugestoes = [] }) {
  const dias = diasAnteriores(dia, 7);
  const naSemana = (d) => d >= dias[0] && d <= dia;
  const kcalDia = new Map();
  const protDia = new Map();
  for (const r of refeicoes || []) {
    if (!naSemana(r?.dia) || !(num(r.estimativa?.kcal) > 0)) continue;
    kcalDia.set(r.dia, (kcalDia.get(r.dia) || 0) + Number(r.estimativa.kcal));
    protDia.set(r.dia, (protDia.get(r.dia) || 0) + (num(r.estimativa.p) || 0));
  }
  const sonoSemana = saude ? montarSono({ saude, dia }).semana || [] : [];
  const energiaSemana = saude ? montarEnergia({ perfil, saude, dia }).semana || [] : [];
  const ativ = dias.map((d) => (saude?.atividades || []).find((a) => a?.dia === d)).filter(Boolean);
  const minAtivos = ativ.map((a) => (a.minAtivos != null ? a.minAtivos : (a.treinos || []).reduce((s, t) => s + (Number(t.min) || 0), 0)));
  const pes = (pesagens || []).filter((p) => naSemana(p?.dia) && num(p.peso) > 0 && !p.descartada).sort((a, b) => a.dia.localeCompare(b.dia));
  const hum = (humor || []).filter((h) => naSemana(h?.dia));
  const fuso = fusoDe(perfil);
  const temas = new Map();
  let nPerguntas = 0;
  for (const q of perguntas || []) {
    const d = q?.dia || diaEm(q?.em, fuso);
    if (!d || !naSemana(d)) continue;
    nPerguntas++;
    const t = q.tema || 'outro';
    temas.set(t, (temas.get(t) || 0) + 1);
  }
  const ok = (v) => (v == null ? null : v);
  const viva = (s) => s && s.status !== 'encerrada';
  return {
    nome: perfil.nome || 'Pessoa',
    semana: semanaISO(dia),
    de: dias[0],
    ate: dia,
    dias,
    diasComComida: kcalDia.size,
    kcalMedia: ok(int(media([...kcalDia.values()]))),
    proteinaMedia: ok(int(media([...protDia.values()]))),
    sonoMedioMin: ok(int(media(sonoSemana.map((s) => s.dormidoMin)))),
    notaSonoMedia: ok(int(media(sonoSemana.map((s) => s.nota)))),
    energiaMedia: ok(int(media(energiaSemana.map((e) => e.nota)))),
    passosMedia: ok(int(media(ativ.map((a) => a.passos)))),
    minAtivosMedia: ok(int(media(minAtivos))),
    pesoInicio: pes.length ? { dia: pes[0].dia, peso: arred(pes[0].peso, 2) } : null,
    pesoFim: pes.length > 1 ? { dia: pes[pes.length - 1].dia, peso: arred(pes[pes.length - 1].peso, 2) } : null,
    aposta: previsaoNova ? { deltaKg: arred(previsaoNova.deltaKg, 2), pesoPrevisto: arred(previsaoNova.pesoPrevisto, 2), alvoDia: previsaoNova.alvoDia || null } : null,
    conferida: previsaoConferida
      ? { deltaKg: arred(previsaoConferida.deltaKg, 2), realKg: arred(previsaoConferida.resultado?.realKg, 2), erroKg: arred(previsaoConferida.resultado?.erroKg, 2), acerto: previsaoConferida.resultado?.acerto || null }
      : null,
    metasCarga: (sugestoes || []).filter(viva).map((s) => ({ exercicio: s.exercicio, deKg: num(s.deKg), deReps: int(s.deReps), paraKg: num(s.paraKg), paraReps: int(s.paraReps), status: s.status, batidaEm: s.batidaEm || null, como: s.como || null })),
    resultadoCarga: (sugestoes || [])
      .filter((s) => s?.status === 'encerrada' && s.encerradaEm === dia)
      .map((s) => ({ exercicio: s.exercicio, resultado: s.batidaEm ? `bateu em ${ddmm(s.batidaEm)}${s.como ? ` (${s.como})` : ''}` : (s.tentativas || 0) > 0 ? `tentou ${s.tentativas} vez(es) sem subir` : 'não fez o exercício' })),
    perguntas: nPerguntas,
    temas: [...temas.entries()].sort((a, b) => b[1] - a[1]).map(([tema, n]) => ({ tema, n })),
    humorMedio: ok(arred(media(hum.map((h) => h.humor)))),
    energiaHumorMedia: ok(arred(media(hum.map((h) => h.energia)))),
    diasComHumor: hum.length,
  };
}

const kgTxt = (v) => (v == null ? '?' : `${dec(v, 2)} kg`);
const sinal = (v) => (v == null ? '?' : `${v > 0 ? '+' : ''}${dec(v, 2)} kg`);

/** Puro. O arquivo Semanas/AAAA-Www.md da pessoa (dados de `dadosDaSemana`). */
export function mdSemanaPessoa(s) {
  const fm = fmPessoa({
    tipo: 'semana-pessoa',
    pessoa: `[[${s.nome}]]`,
    semana: s.semana,
    de: s.de,
    ate: s.ate,
    kcal_media: s.kcalMedia,
    proteina_media_g: s.proteinaMedia,
    sono_medio_min: s.sonoMedioMin,
    nota_sono_media: s.notaSonoMedia,
    energia_media: s.energiaMedia,
    passos_media: s.passosMedia,
    min_ativos_media: s.minAtivosMedia,
    peso_inicio_kg: s.pesoInicio?.peso ?? null,
    peso_fim_kg: s.pesoFim?.peso ?? null,
    humor_medio: s.humorMedio,
    tags: ['nutribot', 'pessoa', 'semana'],
  });
  const partes = [`# ${s.nome} · semana ${s.semana} (${ddmm(s.de)} a ${ddmm(s.ate)})`];
  const med = [];
  med.push(`- Comida: ${s.kcalMedia != null ? `${s.kcalMedia} kcal e ${s.proteinaMedia} g de proteína por dia (${s.diasComComida} dia(s) com registro)` : 'nenhum dia com registro'}`);
  if (s.sonoMedioMin != null) med.push(`- Sono: ${hm(s.sonoMedioMin)} por noite${s.notaSonoMedia != null ? ` · nota média ${s.notaSonoMedia}` : ''}`);
  if (s.energiaMedia != null) med.push(`- Energia média: ${s.energiaMedia}`);
  if (s.passosMedia != null) med.push(`- Atividade: ${milhar(s.passosMedia)} passos por dia${s.minAtivosMedia != null ? ` · ${s.minAtivosMedia} min ativos` : ''}`);
  partes.push(`## Médias\n${med.join('\n')}`);
  const peso = [];
  if (s.pesoInicio) peso.push(`- Início: ${kgTxt(s.pesoInicio.peso)} (${ddmm(s.pesoInicio.dia)})`);
  if (s.pesoFim) peso.push(`- Fim: ${kgTxt(s.pesoFim.peso)} (${ddmm(s.pesoFim.dia)}) · variação ${sinal(s.pesoFim.peso - s.pesoInicio.peso)}`);
  if (s.conferida) peso.push(`- Aposta da semana passada: previa ${sinal(s.conferida.deltaKg)}, deu ${s.conferida.realKg != null ? sinal(s.conferida.realKg) : 'sem pesagem'}${s.conferida.acerto ? ` (${s.conferida.acerto})` : ''}`);
  if (s.aposta) peso.push(`- Aposta para a próxima: ${sinal(s.aposta.deltaKg)}${s.aposta.pesoPrevisto != null ? `, ${kgTxt(s.aposta.pesoPrevisto)}` : ''}${s.aposta.alvoDia ? ` até ${ddmm(s.aposta.alvoDia)}` : ''}`);
  partes.push(`## Peso\n${peso.join('\n') || 'Sem pesagem na semana.'}`);
  if (s.metasCarga.length || s.resultadoCarga.length) {
    const l = [];
    for (const r of s.resultadoCarga) l.push(`- Semana que fechou: ${r.exercicio}, ${r.resultado}`);
    for (const m of s.metasCarga) l.push(`- Meta: ${m.exercicio} de ${dec(m.deKg, 2)} kg × ${m.deReps} para ${dec(m.paraKg, 2)} kg (ou ${m.paraReps} repetições)${m.status === 'batida' && m.batidaEm ? `, bateu em ${ddmm(m.batidaEm)}` : ''}`);
    partes.push(`## Cargas\n${l.join('\n')}`);
  }
  if (s.diasComHumor || s.perguntas) {
    const l = [];
    if (s.diasComHumor) l.push(`- Humor médio ${dec(s.humorMedio)}/5${s.energiaHumorMedia != null ? ` · energia ${dec(s.energiaHumorMedia)}/5` : ''} (${s.diasComHumor} dia(s))`);
    if (s.perguntas) l.push(`- ${s.perguntas} pergunta(s) no app: ${s.temas.map((t) => `${t.tema} ${t.n}`).join(', ')}`);
    partes.push(`## Pelo app (confidência: não citar no grupo)\n${l.join('\n')}`);
  }
  partes.push(`---\nDias: ${s.dias.map((d) => `[[${PASTA_DIAS}/${d.slice(0, 7)}/${d}|${ddmm(d)}]]`).join(' · ')}`);
  return `${fm}\n${partes.join('\n\n')}\n`;
}

// ============================================================
// Despensa, pensamentos, conversas do app e planos
// ============================================================
const ESTADO_ITEM = { tem: 'tem', acabando: 'acabando', acabou: 'acabou' };

/**
 * Puro. Nutri-Despensa.md: o estado atual por categoria (quantidade, estado, validade; o que acabou fica no fim de cada
 * categoria) e as compras dos últimos 28 dias (coleção `notas`: loja, dia e itens).
 */
export function mdDespensa({ nome, dia, itens = [], compras = [] }) {
  const fm = fmPessoa({ tipo: 'despensa', pessoa: `[[${nome}]]`, atualizado: dia, itens: (itens || []).filter((i) => i?.estado !== 'acabou').length, tags: ['nutribot', 'pessoa', 'despensa'] });
  const partes = [`# Despensa de ${nome}`];
  const porCategoria = new Map();
  for (const i of itens || []) {
    if (!i?.item) continue;
    const c = String(i.categoria || 'outro');
    if (!porCategoria.has(c)) porCategoria.set(c, []);
    porCategoria.get(c).push(i);
  }
  if (!porCategoria.size) partes.push('Nada na despensa.');
  for (const [cat, lista] of [...porCategoria.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))) {
    const ordem = (i) => (i.estado === 'acabou' ? 1 : 0);
    const linhas = [...lista]
      .sort((a, b) => ordem(a) - ordem(b) || String(a.validadeEm || '9999').localeCompare(String(b.validadeEm || '9999')) || String(a.item).localeCompare(String(b.item), 'pt-BR'))
      .map((i) => {
        const qtd = i.estado === 'acabou' ? null : num(i.quantidade) != null ? `${dec(i.quantidade, 2)} ${i.unidade || 'un'}` : null;
        return `- ${umaLinha(i.item, 80)}${qtd ? `: ${qtd}` : ''} · ${ESTADO_ITEM[i.estado] || 'tem'}${i.estado !== 'acabou' && i.validadeEm ? ` · vence ${ddmm(i.validadeEm)}` : ''}${i.estado === 'acabou' && i.acabouEm ? ` em ${ddmm(i.acabouEm)}` : ''}`;
      });
    partes.push(`## ${cat.charAt(0).toUpperCase()}${cat.slice(1)}\n${linhas.join('\n')}`);
  }
  const desde = diasAnteriores(dia, 28)[0];
  const recentes = (compras || []).filter((n) => n?.dia && n.dia >= desde && n.dia <= dia).sort((a, b) => b.dia.localeCompare(a.dia));
  if (recentes.length) {
    partes.push(
      `## Compras dos últimos 28 dias\n${recentes
        .map((n) => {
          const itensNota = (n.itens || []).map((x) => umaLinha(x?.item, 60)).filter(Boolean);
          return `- ${ddmm(n.dia)}${n.loja ? ` · ${umaLinha(n.loja, 60)}` : ''} · ${itensNota.length} item(ns)${itensNota.length ? `: ${itensNota.slice(0, 30).join(', ')}${itensNota.length > 30 ? '…' : ''}` : ''}`;
        })
        .join('\n')}`
    );
  }
  return `${fm}\n${partes.join('\n\n')}\n`;
}

/** Puro. Agrupa uma lista por dia (na ordem dos dias) com a chave dada. */
function porDia(lista, diaDe) {
  const m = new Map();
  for (const x of lista) {
    const d = diaDe(x);
    if (!d) continue;
    if (!m.has(d)) m.set(d, []);
    m.get(d).push(x);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Puro. Nutri-Pensamentos/AAAA-MM.md: os pensamentos do mês sobre a pessoa, por dia e hora (particulares). */
export function mdPensamentos({ nome, mes, pensamentos = [] }) {
  const doMes = (pensamentos || []).filter((p) => String(p?.dia || '').startsWith(mes) && p.texto);
  const fm = fmPessoa({ tipo: 'pensamentos', pessoa: `[[${nome}]]`, mes, total: doMes.length, tags: ['nutribot', 'pessoa', 'pensamentos'] });
  const dias = porDia(doMes, (p) => p.dia).map(([d, lista]) => {
    const itens = [...lista]
      .sort((a, b) => (minDe(a.hora) ?? 0) - (minDe(b.hora) ?? 0))
      .map((p) => `- ${p.hora || '--:--'}${p.assunto ? ` (${umaLinha(p.assunto, 60)})` : ''} ${recuar(p.texto, 1200)}${(p.notar || []).length ? `\n  Anotou: ${p.notar.map((n) => umaLinha(n, 200)).join('; ')}` : ''}`);
    return `## ${dataExtenso(d)}\n${itens.join('\n')}`;
  });
  return `${fm}\n# Pensamentos da Nutri sobre ${nome} · ${mes}\n\nParticulares: a Nutri usa de pano de fundo e não manda no grupo.\n\n${dias.join('\n\n') || 'Nenhum pensamento neste mês.'}\n`;
}

/**
 * Puro. Nutri-Conversas-App/AAAA-MM.md: as perguntas feitas no app e as respostas, por dia (D16: no Drive para sempre;
 * no Mongo, 180 dias). Confidência: nunca vai para o grupo.
 */
export function mdConversasApp({ nome, mes, perguntas = [], fuso = 'America/Sao_Paulo' }) {
  const doMes = (perguntas || []).filter((q) => q?.pergunta && String(q.dia || diaEm(q.em, fuso) || '').startsWith(mes));
  const fm = fmPessoa({ tipo: 'conversas-app', pessoa: `[[${nome}]]`, mes, total: doMes.length, tags: ['nutribot', 'pessoa', 'conversas-app'] });
  const dias = porDia(doMes, (q) => q.dia || diaEm(q.em, fuso)).map(([d, lista]) => {
    const itens = [...lista]
      .sort((a, b) => new Date(a.em || 0) - new Date(b.em || 0))
      .map((q) => `- ${horaEm(q.em, fuso) || '--:--'}${q.tema ? ` (${q.tema})` : ''} Pergunta: ${umaLinha(q.pergunta, 400)}${q.resposta ? `\n  Resposta: ${recuar(q.resposta, 1200, '  ')}` : ''}`);
    return `## ${dataExtenso(d)}\n${itens.join('\n')}`;
  });
  return `${fm}\n# Conversas de ${nome} com a Nutri no app · ${mes}\n\nConfidência: a Nutri leva em conta e só retoma se a pessoa puxar; nunca cita no grupo.\n\n${dias.join('\n\n') || 'Nenhuma pergunta neste mês.'}\n`;
}

/**
 * Puro. Planos/AAAA-Www.md: todos os planos gerados para a semana (venham do WhatsApp ou do app, D13), do mais antigo ao
 * mais novo. O Nutri-Plano.md continua sendo só o atual. O texto do WhatsApp vira markdown (*negrito* -> **negrito**).
 */
export function mdPlanoSemana({ nome, semana, planos = [] }) {
  const lista = (planos || []).filter((p) => p?.texto).sort((a, b) => new Date(a.criadoEm || 0) - new Date(b.criadoEm || 0));
  const fm = fmPessoa({ tipo: 'plano-semana', pessoa: `[[${nome}]]`, semana, de: lista[lista.length - 1]?.de || null, ate: lista[lista.length - 1]?.ate || null, versoes: lista.length, tags: ['nutribot', 'pessoa', 'plano'] });
  const blocos = lista.map((p, i) => {
    const quando = p.criadoEm ? new Date(p.criadoEm) : null;
    const cab = lista.length > 1 ? `## Versão ${i + 1}${quando && !Number.isNaN(quando.getTime()) ? ` (gerada em ${ddmm(quando.toISOString().slice(0, 10))})` : ''}` : '';
    return `${cab ? `${cab}\n\n` : ''}${semZap(String(p.texto), { markdown: true })}`;
  });
  return `${fm}\n# Plano de ${nome} · semana ${semana}${lista[lista.length - 1]?.de && lista[lista.length - 1]?.ate ? ` (${ddmm(lista[lista.length - 1].de)} a ${ddmm(lista[lista.length - 1].ate)})` : ''}\n\n${blocos.join('\n\n') || 'Nenhum plano.'}\n`;
}
