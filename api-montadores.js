// api-montadores.js - Montadores PUROS da API v1 do app: recebem os dados já buscados no Mongo (api.js faz a busca) e devolvem
// o JSON do contrato (docs/app/2026-10-14-plano-fase1.md). Nenhuma conta nova de nutrição ou de peso mora aqui: o veredito, a
// tendência, a meta de calorias, a visão de 7/30 dias, a sequência, a energia e a força vêm das mesmas funções que o
// WhatsApp usa (progresso.js, resumo.js, tendencia.js, saude.js, treino.js, contexto.js), chamadas com as MESMAS janelas do
// !hoje e do !progresso, pra o app e o bot dizerem os mesmos números. O que é só do app (faixa da refeição, itens a partir
// da descrição, pendentes, tom dos avisos, filtro de localização) está aqui, com o motivo.
//
// Regras do contrato: datas YYYY-MM-DD no fuso da pessoa, hora HH:MM local, `jids` nunca saem, nada de lugar/localização de
// ninguém (decisão do dono pra esta fase), e os objetos não levam campo fora do contrato (o app decodifica estrito).

import { analisarProgresso, diasDeComida, validarPesagens } from './progresso.js';
import { calcularVisao, faixaDaMeta, sequenciaDe, previsaoGastoDia, nomeDoSlot, diaCompleto } from './resumo.js';
import { projecaoAteMeta } from './tendencia.js';
import { energiaDoDia } from './saude.js';
import { analisarTreinos, grupoEmPortugues } from './treino.js';
import { progressaoForca, conferirSugestoes } from './contexto.js';
import { SLOTS, fusoDe, diasAnteriores, diaSeguinte, horariosHabituais, minutosDe, semAcento } from './util.js';

// ---------- números ----------
const arred = (x, casas = 0) => (x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x) * 10 ** casas) / 10 ** casas);
const r1 = (x) => arred(x, 1);
const r2 = (x) => arred(x, 2);
const int = (x) => arred(x, 0);
const kcalTxt = (n) => `${Math.round(n).toLocaleString('pt-BR')} kcal`;
const kgTxt = (n) => `${Number(n).toFixed(1).replace('.', ',')} kg`;
const dm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const cap = (t) => (t ? `${t[0].toUpperCase()}${t.slice(1)}` : t);
const iso = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
/**
 * Puro. Troca todo `undefined` (em qualquer nível) por null: o JSON.stringify APAGA a chave com undefined, e o app decodifica
 * estrito (revisão I4). Todo montador devolve o resultado por aqui; as chaves do contrato saem sempre, com null quando falta.
 */
export function completar(x) {
  if (x === undefined) return null;
  if (Array.isArray(x)) return x.map(completar);
  if (x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(x)) out[k] = completar(v);
    return out;
  }
  return x;
}

/** Os dias de `de` a `ate`, inclusive, em ordem. */
export function diasEntre(de, ate) {
  const out = [];
  for (let d = de; d <= ate && out.length < 400; d = diaSeguinte(d)) out.push(d);
  return out;
}

// ============================================================
// Perfil
// ============================================================
/** Perfil = { id, nome, primeiroNome, apelido, fuso, objetivo, metaPeso, metaPrazo, temRelogio, temHevy, ehDono }. Sem jids. */
export function montarPerfil(perfil, { temHevy = false, adminJid = '' } = {}) {
  const nome = String(perfil?.nome || '');
  return completar({
    id: String(perfil?._id ?? ''),
    nome,
    primeiroNome: nome.split(/\s+/)[0] || '',
    apelido: perfil?.semApelido ? null : perfil?.apelido || null,
    fuso: fusoDe(perfil),
    objetivo: perfil?.objetivo || null,
    metaPeso: perfil?.metaPeso != null && perfil.metaPeso !== '' && Number.isFinite(Number(perfil.metaPeso)) ? Number(perfil.metaPeso) : null,
    metaPrazo: perfil?.metaPrazo || null,
    temRelogio: Boolean(perfil?.relogio && typeof perfil.relogio === 'object' && Object.keys(perfil.relogio).length),
    temHevy: Boolean(temHevy),
    ehDono: Boolean(adminJid && (perfil?.jids || []).includes(adminJid)),
  });
}

// ============================================================
// Refeição
// ============================================================
// Margem da faixa de kcal de uma refeição pela INCERTEZA que a própria análise declarou (linha INCERTEZA do registro). Não
// existe faixa guardada no banco: isto é a régua do app até a fase 2. Estimativa de foto erra tipicamente 20 a 40%; sem
// incerteza declarada (texto, !refeicao, registro antigo), 25%.
export const MARGEM_INCERTEZA = { alta: 0.4, media: 0.25, baixa: 0.15 };
const MARGEM_PADRAO = 0.25;

/** Puro. Faixa {min,max} (arredondada a 10 kcal) de uma estimativa de kcal; null sem kcal. */
export function faixaDaRefeicao(kcal, incerteza = null) {
  const k = Number(kcal);
  if (!(k > 0)) return null;
  const m = MARGEM_INCERTEZA[String(incerteza || '').toLowerCase().replace('é', 'e')] ?? MARGEM_PADRAO;
  return { min: Math.round((k * (1 - m)) / 10) * 10, max: Math.round((k * (1 + m)) / 10) * 10 };
}

/**
 * Puro. Itens a partir da descrição gravada (os itens com gramas não existem no banco nesta fase): quebra em vírgula, ponto e
 * vírgula, "+", quebra de linha e " e "; o complemento fundido "A (+ B)" vira dois itens. Mantém o texto do item como foi
 * escrito (com quantidade), gramas e kcal null.
 */
export function itensDaRefeicao(descricao) {
  let t = String(descricao || '').trim();
  if (!t || /^\[[^\]]*\]$/.test(t)) return [];
  // "A (+ B) (+ C)" da fusão de complementos (mongo.registrarRefeicao); o corte em 220 caracteres pode deixar "(+ D" aberto
  for (let antes = ''; antes !== t; ) {
    antes = t;
    t = t.replace(/\s*\(\+\s*([^()]*)\)/, ', $1');
  }
  t = t.replace(/\s*\(\+\s*/g, ', ');
  return t
    .split(/\s*(?:[,;+\n]|\s+e\s+)\s*/i)
    .map((s) => s.replace(/^[-•*\s]+|[.\s]+$/g, '').trim())
    .filter((s) => s.length >= 2)
    .slice(0, 15)
    .map((nome) => ({ nome: nome.slice(0, 80), gramas: null, kcal: null }));
}

/** Puro. De onde veio o registro: 'foto' | 'audio' | 'manual' (!refeicao e registro retroativo) | 'texto'. */
export function origemDaRefeicao(r) {
  const res = String(r?.resumo || '');
  if (/\[(\d+\s+)?fotos?\]/i.test(res)) return 'foto';
  if (/\[[áa]udio\]/i.test(res)) return 'audio';
  if (r?.manual) return 'manual';
  return 'texto';
}

/** Refeicao = { id, slot, nome, hora, kcal, faixa, p, c, g, descricao, origem, itens }. */
export function montarRefeicao(r, termosLocal = []) {
  const e = r?.estimativa || {};
  const kcal = Number(e.kcal ?? r?.kcal) > 0 ? Math.round(Number(e.kcal ?? r.kcal)) : null;
  // a descrição é texto da IA ou da pessoa ("almoço no restaurante X do bairro Y"): passa pelo filtro de localização, e os
  // itens saem da descrição já filtrada
  const descricao = tirarLocalizacao(String(r?.descricao || r?.resumo || ''), termosLocal);
  const baseItens = r?.descricao ? descricao : /^\[/.test(String(r?.resumo || '')) ? '' : descricao;
  return completar({
    id: String(r?._id ?? ''),
    slot: r?.slot || null,
    nome: r?.slot ? nomeDoSlot(r.slot) : null,
    hora: r?.horaLocal || r?.hora || null,
    kcal,
    faixa: faixaDaRefeicao(kcal, r?.incerteza),
    p: kcal != null ? int(e.p ?? r?.proteina ?? 0) : null,
    c: kcal != null ? int(e.c ?? 0) : null,
    g: kcal != null ? int(e.g ?? 0) : null,
    descricao,
    origem: origemDaRefeicao(r),
    itens: itensDaRefeicao(baseItens),
  });
}
const porMinuto = (a, b) => (Number(a.minutos) || 0) - (Number(b.minutos) || 0);
const somaEstimativas = (regs) =>
  regs.reduce((a, r) => (r.estimativa?.kcal ? { kcal: a.kcal + Number(r.estimativa.kcal), p: a.p + (Number(r.estimativa.p) || 0), c: a.c + (Number(r.estimativa.c) || 0), g: a.g + (Number(r.estimativa.g) || 0) } : a), { kcal: 0, p: 0, c: 0, g: 0 });

// ============================================================
// Pendentes, avisos e localização
// ============================================================
/**
 * Puro. Refeições principais (as que a cobrança cobra: café, almoço, jantar) cujo horário habitual (aprendido em 21 dias,
 * ou o padrão) mais o atraso tolerado da cobrança já passou sem registro no dia. `agoraMin` = minutos locais (24h para dia
 * já fechado).
 */
export function pendentesDoDia({ refeicoesDoDia = [], hab = {}, agoraMin = 0, atrasoMin = 75 } = {}) {
  return SLOTS.filter((s) => s.cobrar)
    .filter((s) => agoraMin >= (hab[s.id]?.minutos ?? s.padrao) + atrasoMin && !refeicoesDoDia.some((r) => r.slot === s.id))
    .map((s) => ({ slot: s.id, nome: nomeDoSlot(s.id) }));
}

/** Puro. Tira o rótulo em CAIXA ALTA que os alertas do progresso trazem pra IA ("REGISTRO x BALANÇA: ...") e capitaliza. */
export function tirarRotulo(texto) {
  return cap(String(texto || '').replace(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9 ,x/-]*:\s+/, ''));
}

const TITULO_ALERTA = {
  registro_acima_da_balanca: 'Registro e balança não batem',
  registro_abaixo_da_balanca: 'Balança acima do registro',
  curto_vs_longo: 'Oscilação curta no peso',
  janelas_divergem: 'As semanas contam histórias diferentes',
  dados_insuficientes: 'Poucas pesagens',
  tendencia_fragil: 'Tendência frágil',
  meta_mudou: 'Meta alterada no período',
  pesagem_suspeita: 'Pesagem suspeita',
  pesagem_descartada: 'Pesagem descartada',
};
const ORDEM_TOM = { cuidado: 0, atencao: 1, bom: 2 };

/**
 * Puro. Avisos do Hoje: os alertas do progresso (atenção), o veredito "rápido demais" com confiança alta ou média (cuidado),
 * os avisos da tendência de sono curto e poucos treinos (atenção; o de registro x balança já vem nos alertas) e o pensamento
 * da Nutri do dia (bom). Ordem: cuidado, atenção, bom.
 */
export function montarAvisos({ analise = null, pensamento = null, avisosTendencia = [], termosLocal = [] } = {}) {
  const avisos = [];
  const v = analise?.veredito;
  if (v?.status === 'acima' && (v.confianca === 'alta' || v.confianca === 'media')) avisos.push({ tom: 'cuidado', titulo: 'Peso andando rápido demais', texto: cap(v.texto) });
  for (const a of analise?.alertas || []) avisos.push({ tom: 'atencao', titulo: TITULO_ALERTA[a.tipo] || 'Atenção', texto: tirarRotulo(a.texto) });
  for (const t of avisosTendencia || []) {
    if (/^sono médio/i.test(t)) avisos.push({ tom: 'atencao', titulo: 'Sono curto nas últimas semanas', texto: cap(t) });
    else if (/treinos de força por semana/i.test(t)) avisos.push({ tom: 'atencao', titulo: 'Poucos treinos de força', texto: cap(t) });
  }
  const texto = pensamento?.texto ? tirarLocalizacao(pensamento.texto, termosLocal) : '';
  if (texto) avisos.push({ tom: 'bom', titulo: `Pensamento da Nutri${pensamento.hora ? ` (${pensamento.hora})` : ''}`, texto });
  return avisos.sort((a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom]);
}

// Localização fica fora da API nesta fase (decisão do dono). Os textos livres da IA (pensamento, notas, rotina, diário,
// reflexão, anotações) podem citar onde a pessoa mora ou esteve: a frase inteira sai quando fala de endereço, bairro, rua,
// localização, ou cita o nome/bairro/rua de um lugar aprendido pela localização (perfil.lugares de qualquer pessoa).
const RE_LOCAL = /(?<![\p{L}\p{N}])(bairros?|ruas?|avenidas?|av\.|travessa|rodovia|endere[çc]os?|cep|localiza[çc][ãa]o|coordenadas?|gps|mora(?:ndo|va)?\s+(?:no|na|em|perto)|perto de casa)(?![\p{L}\p{N}])/iu;
const LUGAR_GENERICO = new Set(['casa', 'trabalho', 'academia', 'mercado', 'supermercado', 'restaurante', 'padaria', 'faculdade', 'escola', 'bar', 'cafe', 'shopping', 'parque', 'igreja', 'hospital', 'farmacia', 'praia', 'clinica']);
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Puro. Termos de lugar (bairro, nome não genérico, rua) aprendidos pela localização, de todos os perfis. */
export function termosDeLugar(perfis = []) {
  const termos = new Set();
  for (const p of perfis || []) {
    for (const l of p?.lugares || []) {
      for (const t of [l?.bairro, l?.nome, l?.rua]) {
        const n = semAcento(t).trim();
        if (n.length >= 4 && !LUGAR_GENERICO.has(n)) termos.add(n);
      }
    }
  }
  return [...termos];
}

/** Puro. Tira as frases que falam de localização (ver RE_LOCAL) ou citam um termo de lugar. Linha que esvazia some. */
export function tirarLocalizacao(texto, termos = []) {
  const re = termos.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${termos.map(escapar).join('|')})(?![\\p{L}\\p{N}])`, 'u') : null;
  const fala = (frase) => RE_LOCAL.test(frase) || (re && re.test(semAcento(frase)));
  return String(texto || '')
    .split('\n')
    .map((linha) => {
      const frases = linha.split(/(?<=[.!?…])\s+/);
      const ficam = frases.filter((f) => !fala(f));
      if (ficam.length === frases.length) return linha;
      return ficam.join(' ').trim() || null; // linha que só falava de lugar some (não vira linha em branco)
    })
    .filter((linha) => linha !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ============================================================
// Hoje
// ============================================================
/**
 * Os dados que o !hoje e o !progresso usam, com as mesmas janelas: refeições e pesagens dos 31 dias até `dia` (30 fechados +
 * o dia; acompanhamento.dadosDe), a análise do progresso (progressoDe), a visão de 7/30 dias (visaoDe) e a projeção com 120
 * dias de pesagens (tendenciaCompleta). `refeicoes` e `pesagens` podem vir com mais dias: aqui se corta.
 */
function janela31({ dia, refeicoes = [], pesagens = [] }) {
  const d31 = diasAnteriores(dia, 31)[0];
  return { r31: refeicoes.filter((r) => r.dia >= d31 && r.dia <= dia), p31: pesagens.filter((p) => p.dia >= d31 && p.dia <= dia) };
}
/** progresso.analisarProgresso exatamente como acompanhamento.progressoDe chama (o do !progresso e do !hoje). */
const progressoComo = ({ perfil, dia, r31, p31 }) => analisarProgresso({ perfil, dia, pesagens: p31, refeicoes: r31, gastos: perfil.relogio?.gastos || {}, faixa: faixaDaMeta(perfil, dia, p31) });
/** tendencia.projecaoAteMeta como tendencia.tendenciaCompleta chama (120 dias de pesagens, 35 de comida); null sem 4 pesagens. */
function projecaoComo({ perfil, dia, refeicoes = [], pesagens = [], saude = null, treinos = [] }) {
  const p120 = pesagens.filter((p) => p.dia <= dia);
  if (p120.length < 4) return null;
  const r35 = refeicoes.filter((r) => r.dia >= diasAnteriores(dia, 35)[0] && r.dia <= dia);
  return projecaoAteMeta({ perfil, dia, pesagens: p120, refeicoes: r35, gastos: perfil.relogio?.gastos || {}, sonos: saude?.sonos || [], treinos, faixa: faixaDaMeta(perfil, dia, p120) });
}
function analisesDoDia({ perfil, dia, refeicoes = [], pesagens = [], saude = null, treinos = [] }) {
  const { r31, p31 } = janela31({ dia, refeicoes, pesagens });
  const analise = progressoComo({ perfil, dia, r31, p31 });
  // resumo.calcularVisao como acompanhamento.visaoDe chama (gastos podem faltar: aí não há balanço)
  const visao = calcularVisao({ refeicoes: r31, pesagens: p31, perfil, dia, gastos: perfil.relogio?.gastos });
  const proj = projecaoComo({ perfil, dia, refeicoes, pesagens, saude, treinos });
  return { r31, p31, analise, visao, proj };
}

/** Puro. Texto curto da semana (os 7 dias fechados da visão). null sem registro. */
function textoSemana(sete, metaP) {
  if (!sete?.comRegistro) return null;
  const partes = [`${sete.comRegistro} de ${sete.n} dias com registro`];
  if (sete.kcal != null) partes.push(`média ${kcalTxt(sete.kcal)}/dia`);
  if (sete.prot != null) partes.push(`proteína ${Math.round(sete.prot)} g/dia${metaP ? ` (meta ${metaP.min} a ${metaP.max} g)` : ''}`);
  if (sete.pesoInicio && sete.pesoFim && sete.pesoInicio.dia !== sete.pesoFim.dia) partes.push(`peso ${kgTxt(sete.pesoInicio.peso)} → ${kgTxt(sete.pesoFim.peso)}`);
  return `Últimos 7 dias (${dm(sete.de)} a ${dm(sete.ate)}): ${partes.join(' · ')}.`;
}

/**
 * GET /perfis/:id/hoje. `refeicoes` (35+ dias até `dia`), `pesagens` (até 120 dias, uma por dia como pesagensDesde devolve),
 * `saude` (doc de saude_relogio ou null), `treinos` (Hevy, só `inicio` basta), `hoje`/`horaAgora` no fuso da pessoa.
 */
export function montarHoje({ perfil, dia, hoje = dia, horaAgora = '00:00', refeicoes = [], pesagens = [], saude = null, treinos = [], atrasoMin = 75, termosLocal = [] }) {
  const { r31, analise, visao, proj } = analisesDoDia({ perfil, dia, refeicoes, pesagens, saude, treinos });
  const doDia = r31.filter((r) => r.dia === dia).sort(porMinuto);
  const tot = somaEstimativas(doDia);

  // meta de calorias: a do !progresso (calibrada pela balança ou provisória pelo relógio), com a folga da incerteza e o
  // julgamento da última semana; sem ela, a meta provisória da visão (a mesma conta do !hoje), sem julgamento
  const m = analise.metaKcal;
  const mv = !m && visao?.meta?.alvo && (visao.meta.status === 'calibrado' || visao.meta.status === 'relogio') ? visao.meta : null;
  const metaP = visao?.metaP || (Number(perfil.peso) ? { min: Math.round(perfil.peso * 1.6), max: Math.round(perfil.peso * 2.2) } : null);

  const t = analise.tendencia;
  const peso = t.n
    ? {
        atual: r2(t.ultimo.peso),
        kgSemana: t.suficiente ? r2(t.kgSemana) : null,
        ic: t.suficiente ? { min: r2(t.ic95[0]), max: r2(t.ic95[1]) } : null,
        veredito: analise.veredito.status,
        texto: cap(analise.veredito.texto),
      }
    : null;

  let relogio = null;
  if (saude) {
    const at = (saude.atividades || []).find((a) => a.dia === dia);
    const noite = (saude.sonos || []).find((s) => s.dia === dia);
    const prev = previsaoGastoDia({ gastos: perfil.relogio?.gastos, dia, objetivo: perfil.objetivo, metaAdaptativa: visao?.meta, diaAlvo: dia, perfil });
    relogio = {
      sonoMin: noite?.total ? int(noite.total) : null,
      passos: at?.passos ?? null,
      gastoKcal: at?.calorias ?? null,
      gastoPrevisto: prev?.previsto ?? null,
      fcRepouso: at?.fcRepouso ?? null,
      treinos: (at?.treinos || []).map((x) => ({ nome: x.nome ?? null, min: x.min ?? null, hora: x.hora ?? null })),
      atualizadoEm: iso(saude.ultimoEnvio),
    };
  }

  const hab = horariosHabituais(r31.filter((r) => r.dia >= diasAnteriores(dia, 21)[0]));
  const dias = sequenciaDe(r31, dia);
  const semana = textoSemana(visao?.sete, metaP);
  return completar({
    dia,
    fuso: fusoDe(perfil),
    agora: horaAgora,
    kcal: {
      consumido: Math.round(tot.kcal),
      faixa: m ? { min: m.min, max: m.max } : mv ? { min: mv.alvo.min, max: mv.alvo.max } : null,
      err: m ? int(m.folga) : mv ? int(mv.folga || 100) : null,
      situacao: m ? analise.situacaoIngestao || null : null,
    },
    macros: {
      proteina: { g: Math.round(tot.p), meta: metaP },
      carbo: { g: Math.round(tot.c), meta: null },
      gordura: { g: Math.round(tot.g), meta: null },
    },
    refeicoes: doDia.map((r) => montarRefeicao(r, termosLocal)),
    pendentes: pendentesDoDia({ refeicoesDoDia: doDia, hab, agoraMin: dia < hoje ? 24 * 60 : minutosDe(horaAgora), atrasoMin }),
    peso,
    relogio,
    energia: saude ? energiaDoDia({ sonos: saude.sonos, atividades: saude.atividades, dia }) : null,
    avisos: montarAvisos({ analise, pensamento: perfil.pensamento?.dia === dia ? perfil.pensamento : null, avisosTendencia: proj?.avisos || [], termosLocal }),
    brotinho: { dias, murcho: dias === 0 },
    resumoSemana: semana ? { texto: semana } : null,
  });
}

// ============================================================
// Refeições por dia (diário da Comida)
// ============================================================
/**
 * GET /perfis/:id/refeicoes. `refeicoes` cobre [de, ate] e os 28 dias fechados antes de `hoje` (pra mediana do critério de
 * dia completo, a mesma do progresso e da meta adaptativa). Todo dia do intervalo aparece, mesmo sem registro.
 */
export function montarRefeicoes({ refeicoes = [], de, ate, hoje, termosLocal = [] }) {
  const base = diasDeComida(refeicoes, { dia: hoje, de: diasAnteriores(hoje, 29)[0] });
  const marcados = diasDeComida(refeicoes, { dia: hoje, de, ate, medianaRef: base.mediana });
  const completos = new Set(marcados.completos.map((c) => c.dia));
  return completar({
    dias: diasEntre(de, ate).map((dia) => {
      const regs = refeicoes.filter((r) => r.dia === dia).sort(porMinuto);
      const tot = somaEstimativas(regs);
      return { dia, completo: completos.has(dia), kcal: Math.round(tot.kcal), p: Math.round(tot.p), c: Math.round(tot.c), g: Math.round(tot.g), refeicoes: regs.map((r) => montarRefeicao(r, termosLocal)) };
    }),
  });
}

// ============================================================
// Progresso
// ============================================================
/** GET /perfis/:id/progresso: a mesma análise do !progresso (31 dias), estruturada; `texto` é o textoZap. */
export function montarProgresso({ perfil, dia, refeicoes = [], pesagens = [] }) {
  const { r31, p31 } = janela31({ dia, refeicoes, pesagens });
  const a = progressoComo({ perfil, dia, r31, p31 });
  const t = a.tendencia;
  const lista = a.pesagens.pontos.map((p) => ({ dia: p.dia, peso: r2(p.peso), gordura: r1(p.gordura), fonte: p.fonte || 'digitada', hora: p.hora || null, descartada: false, motivo: null }));
  for (const d of a.pesagens.descartadas) {
    const orig = p31.find((x) => x.dia === d.dia && Number(x.peso) === Number(d.peso));
    lista.push({ dia: d.dia, peso: r2(d.peso), gordura: r1(orig?.gordura), fonte: orig?.fonte || null, hora: orig?.hora || null, descartada: true, motivo: d.motivo });
  }
  // as que a consolidação do dia deixou de fora (outra fonte discordando da balança, pesagem da noite)
  for (const doc of p31) {
    for (const d of doc.descartadasNoDia || []) lista.push({ dia: doc.dia, peso: r2(d.peso), gordura: r1(d.gordura), fonte: d.fonte || null, hora: d.hora || null, descartada: true, motivo: d.motivo });
  }
  lista.sort((x, y) => x.dia.localeCompare(y.dia) || Number(x.descartada) - Number(y.descartada));
  const m = a.metaKcal;
  return completar({
    pesagens: lista,
    tendencia: t.suficiente
      ? {
          kgSemana: r2(t.kgSemana),
          ic: { min: r2(t.ic95[0]), max: r2(t.ic95[1]) },
          pesoHoje: r2(t.pesoTendenciaFim),
          direcao: t.direcao,
          janelas: (a.leitura?.janelas || [{ dias: 28, kgSemana: t.kgSemana }]).map((j) => ({ dias: j.dias, kgSemana: r2(j.kgSemana) })),
        }
      : null,
    veredito: t.n ? { status: a.veredito.status, prob: arred(a.veredito.prob, 3), texto: cap(a.veredito.texto) } : null,
    meta: m
      ? { min: m.min, max: m.max, texto: `${kcalTxt(m.min)} a ${kcalTxt(m.max)}/dia, ${m.base === 'balanca' ? 'em calorias registradas, calibrada pela balança' : 'provisória, pelo gasto do relógio'}${m.folga > 100 ? ` (incerteza ±${kcalTxt(m.folga)})` : ''}` }
      : null,
    alertas: a.alertas.map((x) => ({ tipo: x.tipo, texto: tirarRotulo(x.texto) })),
    texto: a.zap,
  });
}

// ============================================================
// Corpo
// ============================================================
/**
 * GET /perfis/:id/corpo. Composição por medição (pesagens com gordura, consolidadas por dia; e bioimpedância de documento
 * que não virou pesagem), ritmo de massa magra e gordura da projeção (tendencia.js), treino da semana por grupo muscular
 * (treino.analisarTreinos, que devolve Map: aqui vira lista), progressão por exercício (contexto.progressaoForca), sugestões
 * de carga conferidas no Hevy (contexto.conferirSugestoes, sem gravar) e medidas (vazio nesta fase).
 */
export function montarCorpo({ perfil, dia, pesagens = [], refeicoes = [], saude = null, treinos = [], catalogo = {}, temHevy = false }) {
  const p120 = pesagens.filter((p) => p.dia <= dia);
  const composicao = validarPesagens(p120, { dia })
    .pontos.filter((p) => p.gordura != null)
    .map((p) => ({ dia: p.dia, hora: p.hora || null, fonte: p.fonte || 'digitada', peso: r2(p.peso), gordura: r1(p.gordura), magra: r1(p.peso * (1 - p.gordura / 100)), confianca: null }));
  for (const d of perfil.documentos || []) {
    const md = d?.medidas || {};
    if (!d?.data || d.data > dia || (md.gordura_pct == null && md.massa_magra_kg == null)) continue;
    if (p120.some((p) => p.dia === d.data && (p.fonte === 'documento' || (p.fontes || []).includes('documento')))) continue;
    const peso = Number(md.peso_kg) || null;
    const g = Number(md.gordura_pct) || null;
    composicao.push({ dia: d.data, hora: null, fonte: 'documento', peso: r2(peso), gordura: r1(g), magra: r1(md.massa_magra_kg ?? (peso && g ? peso * (1 - g / 100) : null)), confianca: d.confianca || null });
  }
  composicao.sort((a, b) => a.dia.localeCompare(b.dia));

  const proj = projecaoComo({ perfil, dia, refeicoes, pesagens, saude, treinos });
  const ritmo = proj && (proj.magraSem != null || proj.gorduraSem != null) ? { magraKgSemana: r2(proj.magraSem), gorduraKgSemana: r2(proj.gorduraSem) } : null;

  let treino = null;
  let forca = null;
  let sugestoesCarga = [];
  if (temHevy) {
    const a = analisarTreinos(treinos, catalogo, dia);
    treino = {
      sessoes: a.sessoes,
      series: a.series,
      volumeKg: int(a.volume),
      volumeAnteriorKg: int(a.volumeAnterior),
      variacaoVolume: arred(a.variacaoVolume, 3),
      rpeMedio: r1(a.rpeMedio),
      semanasComTreino: a.semanasComTreino,
      porGrupo: [...(a.seriesPorGrupo || new Map())].map(([grupo, series]) => ({ grupo, nome: grupoEmPortugues(grupo), series: r1(series) })).sort((x, y) => y.series - x.series),
      progressao: a.progressao.map((p) => ({ exercicio: p.nome ?? null, grupo: grupoEmPortugues(p.grupo), rmKg: r1(p.rm), antesKg: r1(p.antes), variacao: arred(p.variacao, 3) })),
    };
    const pf = progressaoForca(treinos, { dia });
    const ex = (e) => ({ exercicio: e.title ?? null, sessoes: e.sessoes ?? 0, melhorKg: r2(e.melhor), reps: e.reps ?? null, desdeKg: r2(e.desde), ultimaSubida: e.ultimaSubida || null, semanasParado: e.semanasParado ?? null });
    forca = { subindo: pf.subindo.map(ex), parados: pf.parados.map(ex), caindo: pf.caindo.map(ex) };
    sugestoesCarga = conferirSugestoes(perfil.sugestoesCarga || [], treinos)
      .filter((s) => s.status !== 'encerrada')
      .map((s) => ({ exercicio: s.exercicio ?? null, deKg: s.deKg ?? null, deReps: s.deReps ?? null, paraKg: s.paraKg ?? null, paraReps: s.paraReps ?? null, status: s.status ?? null, feitaEm: s.feitaEm || null, batidaEm: s.batidaEm || null, como: s.como || null }));
  }
  return completar({ composicao, atual: composicao[composicao.length - 1] || null, ritmo, treino, forca, sugestoesCarga, medidas: [] });
}

// ============================================================
// Nutri (o que a IA sabe da pessoa)
// ============================================================
const ROTULO_CAMPO = { objetivo: 'Objetivo', metaPeso: 'Meta de peso', peso: 'Peso', altura: 'Altura', dieta: 'Dieta', restricoes: 'Restrições', genero: 'Gênero' };

/**
 * GET /perfis/:id/nutri. fatos (cadastro, produtos fixos, gírias, rotina, notas e anotações), hipóteses (abertas no perfil e
 * fechadas na coleção), diário da Nutri e avaliações (reflexões e pensamentos). Todo item traz natureza ('declarado' |
 * 'medido' | 'inferido' | 'hipotese' | 'opiniao'), origem, atualizadoEm e escopo: 'pessoa', ou 'grupo' no diário (decisão
 * do dono: o diário fica no /nutri, mas marcado como texto sobre o grupo todo, não dado desta pessoa). Texto livre passa pelo
 * filtro de localização.
 */
export function montarNutri({ perfil, hipotesesFechadas = [], reflexoes = [], pensamentos = [], diario = [], termosLocal = [] }) {
  const sem = (t) => tirarLocalizacao(t, termosLocal);
  const at = perfil.atualizacoes || {};
  const fatos = [];
  // todo texto de fato passa pelo filtro (dieta, restrições e produto também: "só como no restaurante X")
  const fato = (campo, texto, natureza, origem, atualizadoEm) => {
    const t = sem(String(texto || '')).trim();
    if (t) fatos.push({ campo, texto: t, natureza, origem, atualizadoEm: atualizadoEm || null, escopo: 'pessoa' });
  };
  const comVirgula = (n) => String(n).replace('.', ',');
  if (perfil.objetivo) fato('objetivo', `${ROTULO_CAMPO.objetivo}: ${perfil.objetivo}`, 'declarado', 'cadastro e conversa', at.objetivo);
  if (perfil.metaPeso) fato('metaPeso', `${ROTULO_CAMPO.metaPeso}: ${comVirgula(perfil.metaPeso)} kg${perfil.metaPrazo ? ` até ${perfil.metaPrazo}` : ''}`, 'declarado', 'cadastro e conversa', at.metaPeso || at.metaPrazo);
  if (perfil.peso) {
    const doRelogio = perfil.relogio?.pesoEm && perfil.relogio.pesoEm === at.peso;
    fato('peso', `${ROTULO_CAMPO.peso}: ${comVirgula(perfil.peso)} kg`, doRelogio ? 'medido' : 'declarado', doRelogio ? 'balança do relógio' : 'cadastro e conversa', at.peso);
  }
  if (perfil.altura) fato('altura', `${ROTULO_CAMPO.altura}: ${perfil.altura} cm`, 'declarado', 'cadastro', at.altura);
  if (perfil.dieta) fato('dieta', `${ROTULO_CAMPO.dieta}: ${perfil.dieta}`, 'declarado', 'cadastro e conversa', at.dieta);
  if (perfil.restricoes) fato('restricoes', `${ROTULO_CAMPO.restricoes}: ${perfil.restricoes}`, 'declarado', 'cadastro e conversa', at.restricoes);
  for (const p of perfil.produtos || []) fato('produto', `Produto fixo: ${p.nome}${p.kcal ? ` (${p.kcal} kcal)` : ''}`, 'declarado', 'rótulo ou conversa', p.em);
  if (perfil.girias?.length) fato('girias', `Gírias: ${perfil.girias.join(', ')}`, 'inferido', 'conversa no grupo (lida pela IA toda noite)', null);
  if (perfil.rotina) fato('rotina', sem(perfil.rotina), 'inferido', 'ficha de rotina (IA, toda noite)', null);
  if (perfil.notas) fato('notas', sem(perfil.notas), 'inferido', 'notas da Nutri sobre a pessoa (IA, toda noite)', null);
  for (const a of perfil.anotacoes || []) fato('anotacao', sem(a.texto), 'inferido', `anotação da Nutri${a.tipo ? ` (${a.tipo})` : ''}`, a.dia);

  const hip = (h, origem) => ({
    id: h.id || null,
    texto: sem(h.texto),
    status: h.status || 'aberta',
    comoVerificar: h.comoVerificar ? sem(h.comoVerificar) || null : null,
    evidencia: h.evidencia ? sem(h.evidencia) || null : null,
    sinais: (h.sinais || []).map((s) => ({ dia: s.dia || null, direcao: s.direcao || null, evidencia: sem(s.evidencia) || null })),
    natureza: 'hipotese',
    origem,
    atualizadoEm: h.fechadaEm || h.ultimaChecagem || h.criadaEm || null,
    escopo: 'pessoa',
  });
  const hipoteses = [
    ...(perfil.hipoteses || []).filter((h) => h.status === 'aberta').map((h) => hip(h, 'reflexão de domingo (IA); sinais dos pensamentos')),
    ...hipotesesFechadas.map((h) => hip(h, 'reflexão de domingo (IA), conferida nos dados')),
  ].filter((h) => h.texto);

  const avaliacoes = [
    ...reflexoes.map((r) => ({ tipo: 'reflexao', dia: r.dia || null, hora: null, texto: sem(r.texto || r.sintese), natureza: 'opiniao', origem: `reflexão da Nutri (${r.motivo || 'domingo'})`, atualizadoEm: iso(r.criadoEm) || r.dia || null, escopo: 'pessoa' })),
    ...pensamentos.map((p) => ({ tipo: 'pensamento', dia: p.dia || null, hora: p.hora || null, texto: sem(p.texto), natureza: 'opiniao', origem: 'pensamento particular da Nutri', atualizadoEm: iso(p.criadoEm) || p.dia || null, escopo: 'pessoa' })),
  ]
    .filter((x) => x.texto)
    .sort((a, b) => `${b.dia || ''} ${b.hora || ''}`.localeCompare(`${a.dia || ''} ${a.hora || ''}`));

  return completar({
    fatos,
    hipoteses,
    diario: diario.map((d) => ({ dia: d.dia ?? null, texto: sem(d.texto), natureza: 'opiniao', origem: 'diário da Nutri (sobre o grupo todo)', atualizadoEm: iso(d.criadoEm) || d.dia || null, escopo: 'grupo' })).filter((d) => d.texto),
    avaliacoes,
  });
}

// ============================================================
// Resumos
// ============================================================
/**
 * GET /perfis/:id/resumos: a última semana (7 dias fechados) e o último mês (30 dias fechados) da visão do !hoje
 * (resumo.calcularVisao), mais dias com as refeições registradas (resumo.diaCompleto, a régua do placar) e dias com a
 * proteína batida (≥ 1,6 g/kg, a do placar). Os relatórios escritos pela IA estão só no Drive e não entram nesta fase.
 */
export function montarResumos({ perfil, dia, refeicoes = [], pesagens = [] }) {
  const d31 = diasAnteriores(dia, 31)[0];
  const r31 = refeicoes.filter((r) => r.dia >= d31 && r.dia <= dia);
  const p31 = pesagens.filter((p) => p.dia >= d31 && p.dia <= dia);
  const v = calcularVisao({ refeicoes: r31, pesagens: p31, perfil, dia, gastos: perfil.relogio?.gastos });
  const metaP = v?.metaP || null;
  const periodo = (x, rotulo) => {
    const dias = diasEntre(x.de, x.ate);
    const porDia = dias.map((d) => r31.filter((r) => r.dia === d)).filter((regs) => regs.length);
    const pesoAlvo = Number(perfil.peso) ? perfil.peso * 1.6 : null;
    const ini = x.pesoInicio ? { dia: x.pesoInicio.dia, peso: r2(x.pesoInicio.peso) } : null;
    const fim = x.pesoFim ? { dia: x.pesoFim.dia, peso: r2(x.pesoFim.peso) } : null;
    const partes = [`${x.comRegistro} de ${x.n} dias com registro`];
    if (x.kcal != null) partes.push(`média ${kcalTxt(x.kcal)}/dia`);
    if (x.prot != null) partes.push(`proteína ${Math.round(x.prot)} g/dia`);
    if (ini && fim && ini.dia !== fim.dia) partes.push(`peso ${kgTxt(ini.peso)} → ${kgTxt(fim.peso)}`);
    return {
      de: x.de,
      ate: x.ate,
      dias: x.n,
      diasComRegistro: x.comRegistro,
      diasComEstimativa: x.comEstimativa,
      kcalMedia: int(x.kcal),
      proteinaMedia: int(x.prot),
      metaProteina: metaP,
      diasCompletos: porDia.filter(diaCompleto).length,
      diasProteinaBatida: pesoAlvo ? porDia.filter((regs) => regs.reduce((a, r) => a + (Number(r.estimativa?.p) || 0), 0) >= pesoAlvo).length : null,
      peso: { inicio: ini, fim, variacao: ini && fim && ini.dia !== fim.dia ? r2(fim.peso - ini.peso) : null },
      texto: x.comRegistro ? `${rotulo} (${dm(x.de)} a ${dm(x.ate)}): ${partes.join(' · ')}.` : `${rotulo} (${dm(x.de)} a ${dm(x.ate)}): sem registros.`,
    };
  };
  return completar({ semana: v ? periodo(v.sete, 'Últimos 7 dias') : null, mes: v ? periodo(v.trinta, 'Últimos 30 dias') : null, sequencia: v ? v.sequencia : 0 });
}

// ============================================================
// Integrações
// ============================================================
const RELOGIO_OK_MIN = 90; // o app manda a cada 15 min; 1h30 sem envio já é atraso
const RELOGIO_PARADO_H = 36; // o mesmo "fresco" do relogio.js: depois disso o dado do app não vale como atual

/**
 * GET /integracoes. `porPerfil` = Map id -> { saude: { ultimoEnvio, app } | null, ultimoTreino, ultimaNota: { dia } }.
 * Lugares e localização não aparecem (decisão do dono pra esta fase); por isso a última nota fiscal vai só com o dia, sem a
 * loja (nome de loja com data é um lugar frequentado; revisão M4).
 */
export function montarIntegracoes({ perfis = [], whatsapp = {}, driveConfigurado = false, porPerfil = new Map(), temHevy = () => false, ehDonoDaAgenda = () => false, agoraMs = Date.now() }) {
  return completar({
    whatsapp: { estado: whatsapp.estado || 'desconhecido', conectado: whatsapp.estado === 'conectado', desconectadoHaMin: whatsapp.estado === 'conectado' ? 0 : int(whatsapp.desconectadoHaMin) },
    drive: { configurado: Boolean(driveConfigurado) },
    perfis: perfis.map((p) => {
      const id = String(p._id ?? '');
      const x = porPerfil.get(id) || {};
      const ultimo = x.saude?.ultimoEnvio ? new Date(x.saude.ultimoEnvio) : null;
      const haMin = ultimo && !Number.isNaN(ultimo.getTime()) ? Math.max(0, Math.round((agoraMs - ultimo.getTime()) / 60_000)) : null;
      const estado = haMin == null ? 'sem_dados' : haMin <= RELOGIO_OK_MIN ? 'ok' : haMin <= RELOGIO_PARADO_H * 60 ? 'atrasado' : 'parado';
      return {
        id,
        nome: p.nome ?? null,
        relogio: { estado, ultimoEnvio: iso(ultimo), haMin, app: x.saude?.app || null },
        hevy: { ativo: Boolean(temHevy(p)), ultimoTreino: iso(x.ultimoTreino) },
        agenda: { ativo: Boolean(ehDonoDaAgenda(p)) },
        cupom: { ultimaNota: x.ultimaNota ? { dia: x.ultimaNota.dia || null } : null },
      };
    }),
  });
}
