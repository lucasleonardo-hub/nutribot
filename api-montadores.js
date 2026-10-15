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
import { calcularVisao, faixaDaMeta, sequenciaDe, previsaoGastoDia, nomeDoSlot, diaCompleto, gastoAdaptativo } from './resumo.js';
import { projecaoAteMeta } from './tendencia.js';
import { energiaDoDia } from './saude.js';
import { analisarTreinos, grupoEmPortugues } from './treino.js';
import { progressaoForca, conferirSugestoes, incrementoDeCarga } from './contexto.js';
import { createHash } from 'node:crypto';
import { SLOTS, fusoDe, diasAnteriores, diaSeguinte, horariosHabituais, minutosDe, semAcento, hhmmDe, marcaDeTempo, vetorRateado } from './util.js';

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
    // fase 3: a tela Perfil edita altura e ritmo (o PUT já aceitava; faltava devolver)
    altura: Number(perfil?.altura) > 0 ? int(perfil.altura) : null,
    ritmo: /^(maximo|medio|minimo)$/.test(String(perfil?.ritmo || '')) ? String(perfil.ritmo) : null,
    // fase 7 (W10, W11): o "Sobre" do menu do nome (o PUT /perfis/:id já aceita; o app precisa ler o que ficou)
    idade: Number.isInteger(Number(perfil?.idade)) && Number(perfil.idade) >= 10 && Number(perfil.idade) <= 110 ? Number(perfil.idade) : null,
    cidade: typeof perfil?.cidade === 'string' && perfil.cidade.trim() ? perfil.cidade.trim() : null,
    dieta: typeof perfil?.dieta === 'string' && perfil.dieta.trim() ? perfil.dieta.trim() : null,
    restricoes: typeof perfil?.restricoes === 'string' && perfil.restricoes.trim() ? perfil.restricoes.trim() : null,
    genero: /^(masculino|feminino|outro)$/.test(String(perfil?.genero || '')) ? String(perfil.genero) : null,
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

/** Puro. De onde veio o registro: 'app' | 'foto' | 'audio' | 'manual' (!refeicao e registro retroativo) | 'texto'. */
export function origemDaRefeicao(r) {
  if (r?.origem === 'app') return 'app';
  const res = String(r?.resumo || '');
  if (/\[(\d+\s+)?fotos?\]/i.test(res)) return 'foto';
  if (/\[[áa]udio\]/i.test(res)) return 'audio';
  if (r?.manual) return 'manual';
  return 'texto';
}

/**
 * Puro. Itens gravados no registro (fase 2: a análise pelo app traz nome, gramas e kcal/p/c/g por item); null quando o
 * registro não tem itens (aí os itens saem da descrição, sem gramas).
 */
function itensGravados(r, termosLocal) {
  if (!Array.isArray(r?.itens) || !r.itens.length) return null;
  const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return r.itens
    .filter((i) => i && typeof i.nome === 'string' && i.nome.trim())
    .slice(0, 15)
    .map((i) => ({ nome: tirarLocalizacao(i.nome, termosLocal).slice(0, 80), gramas: n(i.gramas), kcal: n(i.kcal), p: n(i.p), c: n(i.c), g: n(i.g) }));
}

/** Refeicao = { id, dia, slot, nome, hora, kcal, faixa, p, c, g, descricao, origem, incerteza, itens, miniatura }. */
export function montarRefeicao(r, termosLocal = []) {
  const e = r?.estimativa || {};
  const kcal = Number(e.kcal ?? r?.kcal) > 0 ? Math.round(Number(e.kcal ?? r.kcal)) : null;
  // a descrição é texto da IA ou da pessoa ("almoço no restaurante X do bairro Y"): passa pelo filtro de localização, e os
  // itens saem da descrição já filtrada
  const descricao = tirarLocalizacao(String(r?.descricao || r?.resumo || ''), termosLocal);
  const baseItens = r?.descricao ? descricao : /^\[/.test(String(r?.resumo || '')) ? '' : descricao;
  const incerteza = /^(alta|m[eé]dia|baixa)$/i.test(String(r?.incerteza || '')) ? String(r.incerteza).toLowerCase().replace('é', 'e') : null;
  return completar({
    id: String(r?._id ?? ''),
    dia: r?.dia || null,
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
    incerteza,
    itens: itensGravados(r, termosLocal) || itensDaRefeicao(baseItens).map((i) => ({ ...i, p: null, c: null, g: null })),
    // miniatura JPEG feita pelo app (≤ 24 KB) no registro pelo app; a foto em si não fica guardada no Mongo
    miniatura: typeof r?.miniatura === 'string' && r.miniatura ? `data:image/jpeg;base64,${r.miniatura}` : null,
    // fase 3: a foto do registro pelo app fica na pasta da pessoa no Drive (D6); só o link sai
    foto: r?.foto?.driveId ? { url: `https://drive.google.com/file/d/${encodeURIComponent(String(r.foto.driveId))}/view` } : null,
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
  if (v?.status === 'acima' && (v.confianca === 'alta' || v.confianca === 'media')) avisos.push({ tom: 'cuidado', titulo: 'Peso andando rápido demais', texto: semZap(cap(v.texto)) });
  for (const a of analise?.alertas || []) avisos.push({ tom: 'atencao', titulo: TITULO_ALERTA[a.tipo] || 'Atenção', texto: semZap(tirarRotulo(a.texto)) });
  for (const t of avisosTendencia || []) {
    if (/^sono médio/i.test(t)) avisos.push({ tom: 'atencao', titulo: 'Sono curto nas últimas semanas', texto: semZap(cap(t)) });
    else if (/treinos de força por semana/i.test(t)) avisos.push({ tom: 'atencao', titulo: 'Poucos treinos de força', texto: semZap(cap(t)) });
  }
  const texto = pensamento?.texto ? semZap(tirarLocalizacao(pensamento.texto, termosLocal)) : '';
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
const PREFIXO_VIA = new Set(['rua', 'r', 'av', 'avenida', 'alameda', 'travessa', 'rodovia', 'estrada', 'servidao', 'servidão', 'praca', 'praça', 'beco', 'largo', 'via', 'dos', 'das', 'do', 'da', 'de', 'dr', 'prof', 'sao', 'santa', 'santo', 'nossa', 'senhora']);
export function termosDeLugar(perfis = []) {
  const termos = new Set();
  for (const p of perfis || []) {
    for (const l of p?.lugares || []) {
      for (const t of [l?.bairro, l?.nome, l?.rua, l?.cidade]) {
        const n = semAcento(t).trim();
        if (n.length >= 4 && !LUGAR_GENERICO.has(n)) termos.add(n);
        // a IA abrevia ("R. Lauro Linhares") ou encurta ("na Garra"): cada palavra própria do nome/rua também é termo
        if (t === l?.nome || t === l?.rua) {
          for (const w of n.split(/[\s,.-]+/)) if (w.length >= 5 && !PREFIXO_VIA.has(w) && !LUGAR_GENERICO.has(w)) termos.add(w);
        }
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
      // "R. Lauro Linhares", "Av. Beira-Mar", "Dr. X": a abreviação não fecha a frase (senão o pedaço antes dela ficava)
      const frases = linha.split(/(?<=[.!?…])(?<!\b(?:R|Av|Dr|Dra|Prof|Sr|Sra|Pç|Al|Tv|Rod|Est)\.)\s+/i);
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
export function montarHoje({ perfil, dia, hoje = dia, horaAgora = '00:00', refeicoes = [], pesagens = [], saude = null, treinos = [], atrasoMin = 75, termosLocal = [], humor = null, eventos = [] }) {
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
        texto: semZap(cap(analise.veredito.texto)),
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
      // fase 6: % das kcal de cada macro no que foi comido contra a recomendada pelo objetivo
      distribuicao: distribuicaoMacros({ p: tot.p, c: tot.c, g: tot.g, objetivo: perfil.objetivo }),
    },
    refeicoes: doDia.map((r) => montarRefeicao(r, termosLocal)),
    pendentes: pendentesDoDia({ refeicoesDoDia: doDia, hab, agoraMin: dia < hoje ? 24 * 60 : minutosDe(horaAgora), atrasoMin }),
    peso,
    relogio,
    energia: saude ? ((e) => (e ? { ...e, texto: semZap(e.texto) } : e))(energiaDoDia({ sonos: saude.sonos, atividades: saude.atividades, dia })) : null,
    avisos: montarAvisos({ analise, pensamento: perfil.pensamento?.dia === dia ? perfil.pensamento : null, avisosTendencia: proj?.avisos || [], termosLocal }),
    brotinho: { dias, murcho: dias === 0 },
    resumoSemana: semana ? { texto: semZap(semana) } : null,
    // fase 2: o que a pessoa registrou no app nesse dia (humor é um por dia; eventos criados por ela)
    humor: montarHumor(humor),
    eventos: (eventos || []).filter((e) => e?.dia === dia).map(montarEvento),
    // fase 6: os anéis de atividade e o sono da noite (null sem relógio; sono null sem noite registrada)
    atividade: saude ? anelAtividade({ perfil, saude, dia, hoje, horaAgora }) : null,
    sono: saude ? sonoDoHoje(saude.sonos, dia) : null,
  });
}
/** Puro. O sono do Hoje: { nota, rotulo, dormidoMin, inicio, fim } da noite que terminou em `dia`, ou null. */
function sonoDoHoje(sonos, dia) {
  const a = avaliarNoite(sonos || [], dia);
  if (!a) return null;
  const hhmm = (v) => (minDoTexto(v) == null ? null : hhmmDe(minDoTexto(v)));
  return { nota: a.nota, rotulo: a.rotulo, dormidoMin: a.dormidoMin, inicio: hhmm(a.noite.inicio), fim: hhmm(a.noite.fim) };
}

/** Puro. Evento criado no app: { id, dia, hora, titulo, tipo, nota, criadoEm }. */
export const montarEvento = (e) => ({ id: String(e?._id ?? ''), dia: e?.dia || null, hora: e?.hora || null, titulo: String(e?.titulo || ''), tipo: e?.tipo || 'outro', nota: e?.nota || null, criadoEm: e?.criadoEm ? new Date(e.criadoEm).toISOString() : null });
/** Puro. Humor do dia: { humor, energia, sono, texto, atualizadoEm } | null. */
export const montarHumor = (h) => (h && h.humor != null ? { humor: h.humor, energia: h.energia ?? null, sono: h.sono ?? null, texto: h.texto || null, atualizadoEm: h.atualizadoEm ? new Date(h.atualizadoEm).toISOString() : null } : null);

// ============================================================
// Refeições por dia (diário da Comida)
// ============================================================
/**
 * GET /perfis/:id/refeicoes. `refeicoes` cobre [de, ate] e os 28 dias fechados antes de `hoje` (pra mediana do critério de
 * dia completo, a mesma do progresso e da meta adaptativa). Todo dia do intervalo aparece, mesmo sem registro.
 */
export function montarRefeicoes({ refeicoes = [], de, ate, hoje, termosLocal = [], eventos = [] }) {
  const base = diasDeComida(refeicoes, { dia: hoje, de: diasAnteriores(hoje, 29)[0] });
  const marcados = diasDeComida(refeicoes, { dia: hoje, de, ate, medianaRef: base.mediana });
  const completos = new Set(marcados.completos.map((c) => c.dia));
  return completar({
    dias: diasEntre(de, ate).map((dia) => {
      const regs = refeicoes.filter((r) => r.dia === dia).sort(porMinuto);
      const tot = somaEstimativas(regs);
      return {
        dia,
        completo: completos.has(dia),
        kcal: Math.round(tot.kcal),
        p: Math.round(tot.p),
        c: Math.round(tot.c),
        g: Math.round(tot.g),
        refeicoes: regs.map((r) => montarRefeicao(r, termosLocal)),
        eventos: (eventos || []).filter((e) => e?.dia === dia).map(montarEvento),
      };
    }),
  });
}

// ============================================================
// Progresso
// ============================================================
/** GET /perfis/:id/progresso: a mesma análise do !progresso (31 dias), estruturada; `texto` é o textoZap. */
/**
 * GET /perfis/:id/pesagens?de=&ate= (fase 3): a lista crua de um dia por pesagem, já consolidada entre as fontes pelo
 * mongo.pesagensDesde (a mesma régua do /progresso), sem a validação de outliers (ela é da janela de 31 dias). É o que o
 * app desenha em 90 dias e 1 ano: só pontos e média de 7 dias, sem tendência.
 */
export function montarPesagens(pesagens = []) {
  // um ponto por dia (perfil com dois jids pode trazer dois docs do mesmo dia: fica o último) e gordura só na faixa possível
  const porDia = new Map();
  for (const p of pesagens || []) {
    if (!p?.dia || !(Number(p.peso) > 0)) continue;
    const g = Number(p.gordura);
    porDia.set(p.dia, { dia: p.dia, peso: r2(p.peso), gordura: g >= 2 && g <= 70 ? r1(g) : null, fonte: p.fonte || 'digitada', hora: p.hora || null });
  }
  return completar([...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)));
}

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
    veredito: t.n ? { status: a.veredito.status, prob: arred(a.veredito.prob, 3), texto: semZap(cap(a.veredito.texto)) } : null,
    meta: m
      ? { min: m.min, max: m.max, texto: `${kcalTxt(m.min)} a ${kcalTxt(m.max)}/dia, ${m.base === 'balanca' ? 'em calorias registradas, calibrada pela balança' : 'provisória, pelo gasto do relógio'}${m.folga > 100 ? ` (incerteza ±${kcalTxt(m.folga)})` : ''}` }
      : null,
    alertas: a.alertas.map((x) => ({ tipo: x.tipo, texto: semZap(tirarRotulo(x.texto)) })),
    // o texto do !progresso, escrito pro WhatsApp: no app vira Markdown simples (negrito em **)
    texto: semZap(a.zap, { markdown: true }),
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
      .map((s) => ({ exercicio: s.exercicio ?? null, deKg: s.deKg ?? null, deReps: s.deReps ?? null, paraKg: s.paraKg ?? null, paraReps: s.paraReps ?? null, status: s.status ?? null, feitaEm: s.feitaEm || null, batidaEm: s.batidaEm || null, como: s.como || null, tentativas: s.tentativas ?? 0 }));
  }
  // fase 4: como dormiu e como comeu entram na sugestão de hoje (subir, manter ou repetir a carga)
  const ctx = contextoDoTreino({ perfil, dia, refeicoes, pesagens, saude });
  const ajustadas = ajustarSugestoesPeloDia(sugestoesCarga, ctx).map(({ tentativas, ...s }) => s);
  // fase 5: a rotina por dia da semana com a carga sugerida por exercício
  const rotina = temHevy ? montarRotina({ sessoes: treinos, catalogo, dia, contexto: ctx }) : [];
  // fase 6: os treinos em caixas, pelo título da sessão (a rotina fica pro app 2.5)
  const caixas = temHevy ? treinosPorTitulo({ sessoes: treinos, catalogo, dia, contexto: ctx, fuso: fusoDe(perfil) }) : [];
  return completar({ composicao, atual: composicao[composicao.length - 1] || null, ritmo, treino, forca, sugestoesCarga: ajustadas, contextoTreino: ctx, rotina, treinos: caixas, medidas: [] });
}

// ============================================================
// Rotina de treino com carga sugerida (fase 5)
// ============================================================
const NOME_DIA_SEMANA = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const serieValidaRotina = (s) => s && s.type !== 'warmup' && ((s.reps || 0) > 0 || (s.duration_seconds || 0) > 0);
const fmtKg = (kg) => (kg == null ? '' : String(Math.round(kg * 100) / 100).replace('.', ','));
/** 1 = segunda … 7 = domingo, pelo instante ISO da sessão no fuso dado. */
function diaDaSemanaDe(iso, fuso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const nome = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: fuso || TZ_PADRAO }).format(d);
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[nome] || null;
}
const TZ_PADRAO = 'America/Sao_Paulo';
/** Puro. O dia (AAAA-MM-DD) do instante ISO no fuso dado (o start_time do Hevy é UTC); inválido = os 10 primeiros caracteres. */
export function diaLocalDe(iso, fuso = TZ_PADRAO) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '').slice(0, 10);
  return d.toLocaleString('sv-SE', { timeZone: fuso || TZ_PADRAO }).slice(0, 10);
}

/**
 * Puro. A sugestão pra um exercício a partir do histórico dele (lista de { dia, kg, reps } da mais antiga pra mais recente)
 * e do contexto do dia. acao: manter (sono/energia/comida seguram, ou exercício sem carga), subir (reps ≥ 10 na carga, ou
 * carga parada há 2+ semanas com reps ≥ 8) pelo incrementoDeCarga, senão repetir (mesma carga, +1 rep).
 */
export function sugerirCargaExercicio({ nome, historico = [], contexto = {} }) {
  const ultimo = historico[historico.length - 1];
  if (!ultimo) return null;
  const kg = Number(ultimo.kg) || 0;
  const reps = Number(ultimo.reps) || 0;
  const base = { ultimoKg: kg || null, ultimasReps: reps || null, sugeridoKg: kg || null, deltaKg: 0, sugeridasReps: reps || null };
  const pouco = (contexto.sonoMin != null && contexto.sonoMin < SONO_CURTO_MIN) || (contexto.energia != null && contexto.energia < 45);
  if (!kg) return { ...base, acao: 'manter', motivo: 'exercício sem carga: mantém', frase: `Fez ${reps || '?'} repetições. Próximo treino: repete.` };
  if (pouco) return { ...base, acao: 'manter', motivo: 'dormiu pouco ou energia baixa', frase: `Dormiu pouco: mantém ${fmtKg(kg)} kg × ${reps}.` };
  if (contexto.comida === 'abaixo') return { ...base, acao: 'manter', motivo: 'comeu abaixo da meta nos últimos dias', frase: `Comeu abaixo da meta: mantém ${fmtKg(kg)} kg × ${reps}.` };
  // quando a carga subiu pela última vez
  let ultimaSubida = historico[0]?.dia || null;
  for (let i = 1; i < historico.length; i++) if ((historico[i].kg || 0) > (historico[i - 1].kg || 0)) ultimaSubida = historico[i].dia;
  const subiuNaUltima = historico.length >= 2 && (ultimo.kg || 0) > (historico[historico.length - 2].kg || 0);
  const semanasParado = ultimaSubida ? Math.floor((Date.parse(`${ultimo.dia}T12:00:00Z`) - Date.parse(`${ultimaSubida}T12:00:00Z`)) / (7 * 86400_000)) : 0;
  const inc = incrementoDeCarga(nome, kg);
  if (!subiuNaUltima && (reps >= 10 || (semanasParado >= 2 && reps >= 8))) {
    const novo = Math.round((kg + inc) * 100) / 100;
    return { ...base, sugeridoKg: novo, deltaKg: inc, sugeridasReps: Math.max(6, reps - 2), acao: 'subir', motivo: reps >= 10 ? `fez ${reps} repetições com ${fmtKg(kg)} kg: dá pra subir` : `parado há ${semanasParado} semanas com ${reps} repetições: dá pra subir`, frase: `Pegava ${fmtKg(kg)} kg × ${reps}. Próximo treino: +${fmtKg(inc)} kg = ${fmtKg(novo)} kg.` };
  }
  return { ...base, sugeridasReps: reps + 1, acao: 'repetir', motivo: subiuNaUltima ? 'subiu a carga no último treino: firma antes de subir de novo' : reps < 6 ? 'poucas repetições na carga: firma primeiro' : 'firma a carga com mais uma repetição', frase: `Pegava ${fmtKg(kg)} kg × ${reps}. Próximo treino: ${fmtKg(kg)} kg, tenta ${reps + 1} repetições.` };
}

/**
 * Puro. A rotina por dia da semana das últimas 4 semanas de sessões do Hevy: só dias com 2+ sessões; o título mais frequente
 * naquele dia; os exercícios da sessão mais recente daquele dia, na ordem feita, cada um com a sugestão (histórico de 8
 * semanas do exercício em qualquer dia).
 */
export function montarRotina({ sessoes = [], catalogo = {}, dia, contexto = {}, fuso = TZ_PADRAO }) {
  const desde4 = new Date(Date.parse(`${dia}T12:00:00Z`) - 28 * 86400_000).toISOString();
  const desde8 = new Date(Date.parse(`${dia}T12:00:00Z`) - 56 * 86400_000).toISOString();
  const ordenadas = [...sessoes].filter((s) => s?.inicio && String(s.inicio) >= desde8 && String(s.inicio).slice(0, 10) <= dia).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  // histórico por exercício (8 semanas), pra sugestão
  const historico = new Map();
  for (const s of ordenadas) {
    for (const e of s.exercicios || []) {
      const validas = (e.sets || []).filter(serieValidaRotina);
      if (!validas.length) continue;
      const kg = Math.max(...validas.map((x) => x.weight_kg || 0));
      const reps = Math.max(...validas.filter((x) => (x.weight_kg || 0) === kg).map((x) => x.reps || 0));
      const l = historico.get(e.title) || [];
      l.push({ dia: String(s.inicio).slice(0, 10), kg, reps });
      historico.set(e.title, l);
    }
  }
  const porDia = new Map();
  for (const s of ordenadas.filter((x) => String(x.inicio) >= desde4)) {
    const dow = diaDaSemanaDe(s.inicio, fuso);
    if (!dow) continue;
    const l = porDia.get(dow) || [];
    l.push(s);
    porDia.set(dow, l);
  }
  const rotina = [];
  for (const [dow, lista] of [...porDia.entries()].sort((a, b) => a[0] - b[0])) {
    if (lista.length < 2) continue;
    const titulos = new Map();
    for (const s of lista) if (s.titulo) titulos.set(s.titulo, (titulos.get(s.titulo) || 0) + 1);
    const titulo = [...titulos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const ultima = lista[lista.length - 1];
    const vistos = new Set();
    const exercicios = [];
    for (const e of ultima.exercicios || []) {
      if (!e?.title || vistos.has(e.title)) continue;
      vistos.add(e.title);
      const validas = (e.sets || []).filter(serieValidaRotina);
      const sug = sugerirCargaExercicio({ nome: e.title, historico: historico.get(e.title) || [], contexto });
      if (!sug) continue;
      const grupo = catalogo[e.exercise_template_id]?.primario;
      exercicios.push({ nome: e.title, grupo: grupo ? grupoEmPortugues(grupo) : null, series: validas.length, ...sug });
    }
    rotina.push({ diaSemana: dow, nome: NOME_DIA_SEMANA[dow], titulo, ultimaData: String(ultima.inicio).slice(0, 10), sessoes: lista.length, exercicios });
  }
  return rotina;
}

// ============================================================
// Treinos em caixas, pelo título da sessão no Hevy (fase 6)
// ============================================================
const SIGLA_DIA = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
/** Puro. Título do Hevy normalizado pra agrupar: caixa baixa, sem acento, sem espaço sobrando. */
export const normalizarTitulo = (t) => semAcento(String(t || '')).replace(/\s+/g, ' ').trim();
/** Puro. Slug do título normalizado (id estável da caixa). */
export const slugTitulo = (t) => normalizarTitulo(t).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'treino';
/** Maior carga da sessão e as repetições feitas nela (o mesmo critério da rotina). */
function cargaDaSessao(validas) {
  const kg = Math.max(...validas.map((x) => x.weight_kg || 0));
  const reps = Math.max(...validas.filter((x) => (x.weight_kg || 0) === kg).map((x) => x.reps || 0));
  return { kg, reps };
}

/**
 * Puro. Os treinos da pessoa em caixas: sessões das últimas 8 semanas agrupadas pelo título (normalizarTitulo), só títulos com
 * 2+ sessões; o título mostrado é o mais escrito. Cada caixa: dias da semana em que costuma fazer (os que aparecem 2+ vezes; sem nenhum, o da última sessão),
 * última data, sessões, duração mediana, grupos musculares e os exercícios da sessão mais recente na ordem feita, cada um com
 * as séries válidas, a sugestão (sugerirCargaExercicio, com o contexto do dia) e o histórico de até 8 sessões. `proxima`
 * resume: subir se algum exercício sobe, senão repetir se algum repete, senão manter. Ordem: a próxima a acontecer pelo dia
 * da semana a partir de `dia` (empate: a feita há mais tempo primeiro).
 */
export function treinosPorTitulo({ sessoes = [], catalogo = {}, dia, contexto = {}, fuso = TZ_PADRAO }) {
  const desde8 = new Date(Date.parse(`${dia}T12:00:00Z`) - 56 * 86400_000).toISOString();
  // o dia de cada sessão no fuso da pessoa: o treino das 22:00 é do dia em que foi feito, não do dia UTC seguinte
  const diaDe = new Map();
  for (const s of sessoes || []) if (s?.inicio) diaDe.set(s, diaLocalDe(s.inicio, fuso));
  const ordenadas = [...(sessoes || [])].filter((s) => s?.inicio && String(s.inicio) >= desde8 && diaDe.get(s) <= dia).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  const historico = new Map();
  for (const s of ordenadas) {
    for (const e of s.exercicios || []) {
      const validas = (e?.sets || []).filter(serieValidaRotina);
      if (!e?.title || !validas.length) continue;
      const l = historico.get(e.title) || [];
      l.push({ dia: diaDe.get(s), ...cargaDaSessao(validas) });
      historico.set(e.title, l);
    }
  }
  const grupos = new Map();
  for (const s of ordenadas) {
    const chave = normalizarTitulo(s.titulo);
    if (!chave) continue;
    const l = grupos.get(chave) || [];
    l.push(s);
    grupos.set(chave, l);
  }
  const hojeDow = ((new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const caixas = [];
  for (const [chave, lista] of grupos) {
    if (lista.length < 2) continue;
    const ultima = lista[lista.length - 1];
    const contagem = new Map();
    for (const s of lista) {
      const d = diaDaSemanaDe(s.inicio, fuso);
      if (d) contagem.set(d, (contagem.get(d) || 0) + 1);
    }
    let dows = [...contagem.entries()].filter(([, c]) => c >= 2).map(([d]) => d);
    if (!dows.length) dows = [diaDaSemanaDe(ultima.inicio, fuso)].filter(Boolean);
    dows.sort((a, b) => a - b);
    const duracoes = lista.map((s) => (Date.parse(s.fim) - Date.parse(s.inicio)) / 60_000).filter((m) => Number.isFinite(m) && m > 0 && m < 600);
    const vistos = new Set();
    const exercicios = [];
    const seriesPorGrupo = new Map();
    for (const e of ultima.exercicios || []) {
      if (!e?.title || vistos.has(e.title)) continue;
      vistos.add(e.title);
      const validas = (e.sets || []).filter(serieValidaRotina);
      const hist = historico.get(e.title) || [];
      const sug = sugerirCargaExercicio({ nome: e.title, historico: hist, contexto });
      if (!sug || !validas.length) continue;
      const g = catalogo[e.exercise_template_id]?.primario;
      const grupo = g ? grupoEmPortugues(g) : null;
      if (grupo) seriesPorGrupo.set(grupo, (seriesPorGrupo.get(grupo) || 0) + validas.length);
      exercicios.push({
        nome: e.title,
        grupo,
        series: validas.map((x) => ({ kg: Number(x.weight_kg) > 0 ? r2(x.weight_kg) : null, reps: Number(x.reps) > 0 ? int(x.reps) : null })),
        ...sug,
        motivo: semZap(sug.motivo),
        frase: semZap(sug.frase),
        historico: hist.slice(-8).map((h) => ({ dia: h.dia, kg: h.kg > 0 ? r2(h.kg) : null, reps: h.reps > 0 ? int(h.reps) : null })),
      });
    }
    if (!exercicios.length) continue;
    const conta = (acao) => exercicios.filter((e) => e.acao === acao).length;
    const plural = (n) => `${n} exercício${n > 1 ? 's' : ''}`;
    const proxima = conta('subir') ? { acao: 'subir', resumo: `${plural(conta('subir'))} pra subir` } : conta('repetir') ? { acao: 'repetir', resumo: `${plural(conta('repetir'))} pra firmar` } : { acao: 'manter', resumo: 'Manter as cargas' };
    const durMed = medianaDe(duracoes);
    // o título como a pessoa mais escreve (empate: o da sessão mais recente)
    const escritos = new Map();
    lista.forEach((s, i) => {
      const t = String(s.titulo).replace(/\s+/g, ' ').trim();
      escritos.set(t, { n: (escritos.get(t)?.n || 0) + 1, ultima: i });
    });
    const titulo = [...escritos.entries()].sort((a, b) => b[1].n - a[1].n || b[1].ultima - a[1].ultima)[0][0];
    caixas.push({
      id: slugTitulo(chave),
      titulo: semZap(titulo),
      dias: dows.map((d) => SIGLA_DIA[d]),
      ultimaData: diaDe.get(ultima),
      sessoes8sem: lista.length,
      duracaoMin: durMed == null ? null : Math.round(durMed),
      grupos: [...seriesPorGrupo.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 4),
      proxima,
      exercicios,
      _ate: Math.min(...dows.map((d) => (d - hojeDow + 7) % 7)),
    });
  }
  caixas.sort((a, b) => a._ate - b._ate || a.ultimaData.localeCompare(b.ultimaData) || a.titulo.localeCompare(b.titulo));
  return caixas.map(({ _ate, ...c }) => c);
}

/**
 * Puro. O contexto do treino de hoje: energia e sono da noite (saude.energiaDoDia) e a comida dos 3 dias fechados antes
 * de hoje contra a faixa de kcal (gastoAdaptativo). comida: 'abaixo' | 'dentro' | 'acima' | null (sem registro ou sem faixa).
 */
export function contextoDoTreino({ perfil, dia, refeicoes = [], pesagens = [], saude = null }) {
  const e = saude ? energiaDoDia({ sonos: saude.sonos || [], atividades: saude.atividades || [], dia }) : null;
  const noite = (saude?.sonos || []).find((s) => s?.dia === dia && Number(s.total) > 0);
  const sonoMin = noite ? int(noite.total) : null;
  const energia = Number.isFinite(Number(e?.nota)) ? int(e.nota) : null;
  const tresDias = diasAnteriores(dia, 4).slice(0, 3);
  const porDia = tresDias.map((d) => refeicoes.filter((r) => r.dia === d && Number(r.estimativa?.kcal) > 0).reduce((s, r) => s + Number(r.estimativa.kcal), 0)).filter((k) => k > 0);
  const alvo = gastoAdaptativo({ refeicoes, pesagens, perfil, dia, gastos: perfil?.relogio?.gastos }).alvo;
  let comida = null;
  if (porDia.length >= 2 && alvo?.min && alvo?.max) {
    const media = porDia.reduce((a, b) => a + b, 0) / porDia.length;
    comida = media < alvo.min ? 'abaixo' : media > alvo.max ? 'acima' : 'dentro';
  }
  const fmtH = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  const partes = [];
  if (sonoMin != null) partes.push(`dormiu ${fmtH(sonoMin)}`);
  if (energia != null) partes.push(`energia ${energia} de 100`);
  if (comida) partes.push(comida === 'dentro' ? 'comeu na faixa nos últimos dias' : comida === 'abaixo' ? 'comeu abaixo da faixa nos últimos dias' : 'comeu acima da faixa nos últimos dias');
  const pouco = (sonoMin != null && sonoMin < SONO_CURTO_MIN) || (energia != null && energia < 45);
  const veredito = pouco ? 'Hoje é dia de segurar a carga e caprichar nas repetições.' : comida === 'abaixo' ? 'Sobe a carga quando a comida voltar à faixa.' : partes.length ? 'Dá para subir a carga hoje.' : 'Sem dados do relógio hoje: siga as sugestões como estão.';
  return { energia, sonoMin, comida, texto: `${partes.length ? `${cap(partes.join(', '))}. ` : ''}${veredito}` };
}

/**
 * Puro. Cada sugestão de carga ganha `hoje` e `motivo` pelo contexto do dia: sono < 6 h ou energia < 45 → manter; comida
 * abaixo da faixa → manter; já tentou 2+ vezes sem bater → repetir (carga de partida com mais repetições); senão subir.
 * Sugestão batida não muda.
 */
const SONO_CURTO_MIN = 390; // 6h30: o mesmo corte de "sono curto" do saude.js (leitura de força)
export function ajustarSugestoesPeloDia(sugestoes = [], { sonoMin = null, energia = null, comida = null } = {}) {
  return (sugestoes || []).map((s) => {
    if (s.status === 'batida') return { ...s, hoje: null, motivo: null };
    if (sonoMin != null && sonoMin < SONO_CURTO_MIN) return { ...s, hoje: 'manter', motivo: 'dormiu pouco: segura a carga e capricha nas repetições' };
    if (energia != null && energia < 45) return { ...s, hoje: 'manter', motivo: 'energia baixa hoje: mantém a carga' };
    if (comida === 'abaixo') return { ...s, hoje: 'manter', motivo: 'comeu abaixo da meta: sobe quando a energia voltar' };
    if ((s.tentativas || 0) >= 2) return { ...s, hoje: 'repetir', motivo: `fez ${s.tentativas} vezes sem bater: repete ${s.deKg != null ? `${String(s.deKg).replace('.', ',')} kg` : 'a carga'} com mais repetições` };
    return { ...s, hoje: 'subir', motivo: comida === 'dentro' ? 'dormiu e comeu bem: pode subir' : 'pode tentar subir hoje' };
  });
}

// ============================================================
// Sono, energia e atividade no nível do relógio (fase 6, docs/app/2026-10-15-plano-fase6.md)
// ============================================================
// As notas são NOSSAS, com a conta aberta aqui. Nenhuma entra em conta de calorias: são leitura de como a pessoa está.
const limitar100 = (x) => Math.max(0, Math.min(100, x));
const hmTxt = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const milharTxt = (n) => Math.round(n).toLocaleString('pt-BR');
const mediaDe = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const desvioDe = (xs) => {
  const m = mediaDe(xs);
  return m == null ? null : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};
const medianaDe = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
/** "AAAA-MM-DD HH:MM" ou "HH:MM" -> minutos do dia; null sem hora. */
const minDoTexto = (v) => {
  const m = /(\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** Hora de dormir em minutos contados a partir do meio-dia (23:00 = 660, 01:00 = 780): média e mediana não quebram na meia-noite. */
const horaDormirMin = (inicio) => {
  const m = minDoTexto(inicio);
  return m == null ? null : (m - 720 + 1440) % 1440;
};
const horaDoMeioDia = (x) => hhmmDe((Math.round(x) + 720) % 1440);
/** Minutos entre dois "AAAA-MM-DD HH:MM" do relogio.js (horas locais, sem fuso: a diferença é a mesma). */
const minutosEntre = (a, b) => {
  const p = (s) => Date.parse(`${String(s).slice(0, 10)}T${String(s).slice(11, 16)}:00Z`);
  const d = (p(b) - p(a)) / 60_000;
  return Number.isFinite(d) ? d : null;
};

export const ROTULOS_NOTA = ['excelente', 'boa', 'razoavel', 'atencao'];
/** Puro. Rótulo de uma nota 0-100: ≥ 85 excelente, ≥ 70 boa, ≥ 55 razoável, senão atenção; null sem nota. */
export function rotuloNota(nota) {
  if (nota == null || !Number.isFinite(Number(nota))) return null;
  return nota >= 85 ? 'excelente' : nota >= 70 ? 'boa' : nota >= 55 ? 'razoavel' : 'atencao';
}
/** Puro. Nível de um fator pela pontuação 0-100: ≥ 90 excelente, ≥ 70 bom, ≥ 50 razoável, senão atenção; null sem dado. */
export function nivelDosPontos(p) {
  if (p == null || !Number.isFinite(Number(p))) return null;
  return p >= 90 ? 'excelente' : p >= 70 ? 'bom' : p >= 50 ? 'razoavel' : 'atencao';
}

// faixas de referência de adultos (% do tempo na cama); a nota usa profundo e REM, o app desenha as quatro
export const FASES_TIPICAS = { acordado: { min: 0, max: 10 }, rem: { min: 18, max: 25 }, leve: { min: 45, max: 60 }, profundo: { min: 13, max: 23 } };
const PESOS_SONO = { duracao: 0.4, profundo: 0.2, rem: 0.2, acordado: 0.1, regularidade: 0.1 };

/** Puro. Pontos 0-100 da duração dormida: 7–9 h = 100; de 4 h (0) a 7 h, linear; de 9 a 10 h cai até 80; acima de 10 h, 80. */
export function pontosDuracaoSono(min) {
  if (min == null || !Number.isFinite(Number(min))) return null;
  if (min <= 240) return 0;
  if (min < 420) return ((min - 240) / 180) * 100;
  if (min <= 540) return 100;
  if (min <= 600) return 100 - ((min - 540) / 60) * 20;
  return 80;
}
/** Pontos de uma fase pela faixa: dentro = 100; abaixo, proporcional (0 % = 0); acima, perde 5 por ponto percentual. */
const pontosFaixa = (pct, { min, max }) => (pct == null ? null : pct < min ? (pct / min) * 100 : pct <= max ? 100 : limitar100(100 - (pct - max) * 5));
const pontosAcordado = (pct) => (pct == null ? null : pct <= 10 ? 100 : limitar100(100 - (pct - 10) * 5));
/** Hora de dormir a até 30 min da mediana = 100; 2 h ou mais = 0; linear entre os dois. */
const pontosRegularidade = (desvio) => (desvio == null ? null : desvio <= 30 ? 100 : desvio >= 120 ? 0 : 100 - ((desvio - 30) / 90) * 100);

/**
 * Puro. Nota de sono 0-100 (nossa): duração dormida (40 %), sono profundo (20 %, 13–23 % = 100), REM (20 %, 18–25 % = 100),
 * acordado (10 %, até 10 % = 100) e regularidade (10 %, hora de dormir até 30 min da mediana dos 7 dias anteriores = 100,
 * 2 h = 0). Componente sem dado sai e os pesos dos outros são redistribuídos (sem fases: só duração e regularidade). Sem
 * duração, nota null. Percentuais sobre o tempo na cama.
 * @returns {{ nota: number|null, rotulo: string|null, partes: { duracao, profundo, rem, acordado, regularidade } }}
 */
export function notaSono({ dormidoMin = null, profundoPct = null, remPct = null, acordadoPct = null, desvioHoraMin = null } = {}) {
  const partes = {
    duracao: pontosDuracaoSono(dormidoMin),
    profundo: pontosFaixa(profundoPct, FASES_TIPICAS.profundo),
    rem: pontosFaixa(remPct, FASES_TIPICAS.rem),
    acordado: pontosAcordado(acordadoPct),
    regularidade: pontosRegularidade(desvioHoraMin),
  };
  const arredPartes = Object.fromEntries(Object.entries(partes).map(([k, v]) => [k, v == null ? null : Math.round(v)]));
  if (partes.duracao == null) return { nota: null, rotulo: null, partes: arredPartes };
  const usadas = Object.entries(partes).filter(([, v]) => v != null);
  const soma = usadas.reduce((a, [k]) => a + PESOS_SONO[k], 0);
  const nota = Math.round(usadas.reduce((a, [k, v]) => a + v * PESOS_SONO[k], 0) / soma);
  return { nota, rotulo: rotuloNota(nota), partes: arredPartes };
}

/** A noite que terminou em `dia` (sono principal + cochilos somados), como o relogio.js guarda; null sem sono. */
const noiteDe = (sonos, dia) => (sonos || []).find((s) => s?.dia === dia && Number(s.total) > 0) || null;

/**
 * Puro. Tudo que a nota de uma noite precisa: tempo na cama (dormido + acordado), fases em minutos e %, desvio da hora de
 * dormir contra a mediana dos 7 dias anteriores (3+ noites), a nota e o rótulo. null sem sono no dia.
 */
export function avaliarNoite(sonos = [], dia) {
  const noite = noiteDe(sonos, dia);
  if (!noite) return null;
  const dormidoMin = Math.round(Number(noite.total));
  const acordado = Math.max(0, Number(noite.acordado) || 0);
  const emCamaMin = Math.round(dormidoMin + acordado);
  const temFases = (Number(noite.profundo) || 0) + (Number(noite.rem) || 0) > 0;
  const pct = (m) => (emCamaMin > 0 ? (m / emCamaMin) * 100 : 0);
  const fases = temFases
    ? Object.fromEntries(['acordado', 'rem', 'leve', 'profundo'].map((k) => [k, { min: Math.round(Number(noite[k]) || 0), pct: Math.round(pct(Number(noite[k]) || 0)) }]))
    : null;
  const anteriores = diasAnteriores(dia, 8).slice(0, 7).map((d) => horaDormirMin(noiteDe(sonos, d)?.inicio)).filter((x) => x != null);
  const hora = horaDormirMin(noite.inicio);
  const desvioHoraMin = hora != null && anteriores.length >= 3 ? Math.abs(hora - medianaDe(anteriores)) : null;
  const n = notaSono({
    dormidoMin,
    profundoPct: temFases ? pct(Number(noite.profundo) || 0) : null,
    remPct: temFases ? pct(Number(noite.rem) || 0) : null,
    acordadoPct: temFases ? pct(acordado) : null,
    desvioHoraMin,
  });
  return { noite, dormidoMin, emCamaMin, fases, temFases, desvioHoraMin, ...n };
}

/** Puro. Minutos de "acordado" do início da sessão até o primeiro estágio de sono (só com etapas); null sem isso. */
export function latenciaDoSono(noite) {
  const etapas = noite?.etapas || [];
  const ini = minDoTexto(noite?.inicio);
  const primeiro = etapas.find((e) => e?.t && e.t !== 'acordado');
  if (!etapas.length || ini == null || !primeiro) return null;
  const lat = (minDoTexto(primeiro.ini) - ini + 1440) % 1440;
  return lat <= 240 ? lat : null; // mais de 4 h é estágio de outra sessão, não latência
}

/** Puro. Fator do batimento no sono: abaixo ou igual à média = excelente; até +3 bpm bom; até +6 razoável; acima, atenção. */
function fatorFc(atual, historico) {
  const media = historico.length >= 3 ? mediaDe(historico) : null;
  const nivel = atual == null || media == null ? null : atual <= media ? 'excelente' : atual <= media + 3 ? 'bom' : atual <= media + 6 ? 'razoavel' : 'atencao';
  return { id: 'fc_sono', nome: 'Batimento no sono', valor: atual == null ? 'sem dado' : `${atual} bpm`, nivel, explicacao: 'Batimento abaixo do seu normal indica descanso.' };
}
/** Puro. Fator da VFC no sono: na média ou acima = excelente; 90 % bom; 80 % razoável; abaixo, atenção. */
function fatorVfc(atual, historico) {
  const media = historico.length >= 3 ? mediaDe(historico) : null;
  const r = atual == null || media == null ? null : atual / media;
  const nivel = r == null ? null : r >= 1 ? 'excelente' : r >= 0.9 ? 'bom' : r >= 0.8 ? 'razoavel' : 'atencao';
  return { id: 'vfc_sono', nome: 'VFC no sono', valor: atual == null ? 'sem dado' : `${atual} ms`, nivel, explicacao: 'Variação acima da sua média indica corpo recuperado.' };
}
/**
 * FC e VFC do sono da noite (sono principal; sem eles, a FC de repouso e a VFC do dia que o Relógio 1.6 já manda) e as dos 14
 * dias anteriores DA MESMA MEDIDA: a FC de repouso (média dos 20 % menores batimentos do sono) é sempre mais baixa que a
 * média do sono, então misturar as duas dava "atenção" ou "excelente" sem nada ter mudado. Usa a medida do sono quando ela
 * tem hoje e 3+ dias de histórico; senão a do dia, se tiver; senão a do sono com histórico curto (nível null).
 */
function fcVfcDoDia({ sonos = [], atividades = [], dia }) {
  const pos = (v) => (Number(v) > 0 ? Number(v) : null);
  const doDia = (d) => {
    const s = noiteDe(sonos, d);
    const a = (atividades || []).find((x) => x?.dia === d);
    return { fcSono: pos(s?.fcMedia), fcDia: pos(a?.fcRepouso), hrvSono: pos(s?.hrv), hrvDia: pos(a?.hrv) };
  };
  const antes = diasAnteriores(dia, 15).slice(0, 14).map(doDia);
  const hoje = doDia(dia);
  const escolher = (kSono, kDia) => {
    const hist = (k) => antes.map((x) => x[k]).filter((x) => x != null);
    if (hoje[kSono] != null && hist(kSono).length >= 3) return { atual: hoje[kSono], hist: hist(kSono) };
    if (hoje[kDia] != null) return { atual: hoje[kDia], hist: hist(kDia) };
    return { atual: hoje[kSono], hist: hoje[kSono] != null ? hist(kSono) : [] };
  };
  const fc = escolher('fcSono', 'fcDia');
  const hrv = escolher('hrvSono', 'hrvDia');
  return { fc: fc.atual, hrv: hrv.atual, fcHist: fc.hist, hrvHist: hrv.hist };
}

/**
 * Puro. Os fatores da nota de sono: tempo dormido, sono profundo, REM, acordado, latência, FC e VFC no sono. Cada um
 * { id, nome, valor, nivel, explicacao }; sem dado, valor 'sem dado' e nivel null.
 */
export function fatoresSono({ sonos = [], atividades = [], dia }) {
  const a = avaliarNoite(sonos, dia);
  const f = a?.fases;
  const fase = (k, pts) => (f ? { valor: `${f[k].pct} %`, nivel: nivelDosPontos(pts) } : { valor: 'sem dado', nivel: null });
  const lat = latenciaDoSono(a?.noite);
  const fv = fcVfcDoDia({ sonos, atividades, dia });
  return [
    { id: 'tempo', nome: 'Tempo dormido', valor: a ? hmTxt(a.dormidoMin) : 'sem dado', nivel: nivelDosPontos(a?.partes.duracao), explicacao: 'Adultos rendem melhor com 7 a 9 horas.' },
    { id: 'profundo', nome: 'Sono profundo', ...fase('profundo', a?.partes.profundo), explicacao: 'É o sono que recupera o corpo. O normal é 13 a 23 %.' },
    { id: 'rem', nome: 'Sono REM', ...fase('rem', a?.partes.rem), explicacao: 'Ajuda a memória e o humor. O normal é 18 a 25 %.' },
    { id: 'acordado', nome: 'Acordado', ...(f ? { valor: `${f.acordado.min} min`, nivel: nivelDosPontos(a.partes.acordado) } : { valor: 'sem dado', nivel: null }), explicacao: 'Acordar um pouco é normal. Até 10 % da noite está bem.' },
    { id: 'latencia', nome: 'Tempo pra dormir', valor: lat == null ? 'sem dado' : `${lat} min`, nivel: lat == null ? null : lat <= 20 ? 'excelente' : lat <= 30 ? 'bom' : lat <= 45 ? 'razoavel' : 'atencao', explicacao: 'Até 20 minutos pra pegar no sono é o ideal.' },
    fatorFc(fv.fc, fv.fcHist),
    fatorVfc(fv.hrv, fv.hrvHist),
  ];
}

// ---------- fase 7: oxigênio no sangue e temperatura da pele no sono (permissões opcionais do coletor) ----------
const numOuNull = (v) => (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
const decTxt = (v, casas = 1) => String(arred(v, casas)).replace('.', ',');
/** Puro. O oxigênio da noite como o relogio.js guardou ({ media, min, minutosAbaixo90 }); null sem média. */
export function spo2DaNoite(s) {
  const media = numOuNull(s?.media);
  if (!(media > 0)) return null;
  const min = numOuNull(s.min);
  const abaixo = numOuNull(s.minutosAbaixo90);
  return { media: r1(media), min: min > 0 ? r1(min) : null, minutosAbaixo90: abaixo != null && abaixo >= 0 ? int(abaixo) : null };
}
/** Puro. A temperatura da pele da noite ({ media|null, delta }); null sem `delta` (sem ele não há "diferença do normal"). */
export function temperaturaDaNoite(t) {
  const delta = numOuNull(t?.delta);
  if (delta == null) return null;
  const media = numOuNull(t.media);
  return { media: media > 0 ? r1(media) : null, delta: r2(delta) };
}
/**
 * Puro. Fator "Oxigênio no sangue": média ≥ 95 % e até 1 min abaixo de 90 % = excelente; ≥ 94 % e até 5 min = bom; ≥ 92 % e
 * até 15 min = razoável; senão atenção. null sem dado (o fator só aparece quando o relógio mandou).
 */
export function fatorOxigenio(spo2) {
  if (!spo2 || spo2.media == null) return null;
  const m = spo2.media;
  const abaixo = spo2.minutosAbaixo90 ?? 0;
  const nivel = m >= 95 && abaixo <= 1 ? 'excelente' : m >= 94 && abaixo <= 5 ? 'bom' : m >= 92 && abaixo <= 15 ? 'razoavel' : 'atencao';
  return { id: 'spo2', nome: 'Oxigênio no sangue', valor: `${decTxt(m)} %`, nivel, explicacao: 'No sono o normal é 95 % ou mais, sem quedas longas.' };
}
/** Puro. Fator "Temperatura da pele": diferença do normal até 0,5 °C = excelente; até 1 = bom; até 1,5 = razoável; senão atenção. */
export function fatorTemperatura(t) {
  if (!t || t.delta == null) return null;
  const d = Math.abs(t.delta);
  const nivel = d <= 0.5 ? 'excelente' : d <= 1 ? 'bom' : d <= 1.5 ? 'razoavel' : 'atencao';
  const sinal = t.delta < 0 && arred(d, 1) > 0 ? '−' : '+';
  return { id: 'temperatura', nome: 'Temperatura da pele', valor: `${sinal}${decTxt(d)} °C`, nivel, explicacao: 'Diferença do seu normal. Subida grande pode ser sinal de doença.' };
}

const TXT_ROTULO = { excelente: 'excelente', boa: 'bom', razoavel: 'razoável', atencao: 'pede atenção' };

/**
 * GET /perfis/:id/sono?dia=. A noite que terminou em `dia` (doc de saude_relogio): nota e rótulo (notaSono), variação contra
 * a média das notas dos 7 dias anteriores, horários, fases (null sem fases), faixas típicas, estágios ao longo da noite
 * (vazio no envio antigo), FC/VFC, fatores e a semana. Fase 7: `spo2` { media, min, minutosAbaixo90 } e `temperatura`
 * { media, delta } só quando vieram, cada um com o seu fator no fim da lista.
 */
export function montarSono({ saude = null, dia }) {
  const sonos = saude?.sonos || [];
  const atividades = saude?.atividades || [];
  const a = avaliarNoite(sonos, dia);
  const notasAntes = diasAnteriores(dia, 8).slice(0, 7).map((d) => avaliarNoite(sonos, d)?.nota).filter((x) => x != null);
  const hhmm = (v) => {
    const m = minDoTexto(v);
    return m == null ? null : hhmmDe(m);
  };
  const noite = a?.noite;
  // fase 7: as chaves `spo2` e `temperatura` só existem quando o relógio mandou (permissão opcional); o app esconde a linha
  const spo2 = spo2DaNoite(noite?.spo2);
  const temperatura = temperaturaDaNoite(noite?.temperatura);
  return completar({
    dia,
    nota: a?.nota ?? null,
    rotulo: a?.rotulo ?? null,
    variacao: a?.nota != null && notasAntes.length ? Math.round(a.nota - mediaDe(notasAntes)) : null,
    inicio: hhmm(noite?.inicio),
    fim: hhmm(noite?.fim),
    emCamaMin: a ? a.emCamaMin : null,
    dormidoMin: a ? a.dormidoMin : null,
    latenciaMin: latenciaDoSono(noite),
    fases: a?.fases || null,
    tipicas: FASES_TIPICAS,
    etapas: (noite?.etapas || []).map((e) => ({ ini: e.ini ?? null, fim: e.fim ?? null, t: e.t ?? null })),
    fcMedia: Number(noite?.fcMedia) > 0 ? int(noite.fcMedia) : null,
    fcMin: Number(noite?.fcMin) > 0 ? int(noite.fcMin) : null,
    hrv: Number(noite?.hrv) > 0 ? int(noite.hrv) : null,
    ...(spo2 ? { spo2 } : {}),
    ...(temperatura ? { temperatura } : {}),
    fatores: a ? [...fatoresSono({ sonos, atividades, dia }), fatorOxigenio(spo2), fatorTemperatura(temperatura)].filter(Boolean) : [],
    semana: diasAnteriores(dia, 7).map((d) => {
      const x = avaliarNoite(sonos, d);
      return { dia: d, nota: x?.nota ?? null, dormidoMin: x ? x.dormidoMin : null };
    }),
    texto: semZap(a ? `Sono ${TXT_ROTULO[a.rotulo]}: dormiu ${hmTxt(a.dormidoMin)}.` : 'Sem sono registrado nessa noite.'),
  });
}

/** Metas de atividade: 8.000 passos, 60 min ativos e 500 kcal ativas; `perfil.metasAtividade` sobrescreve o que trouxer. */
export const METAS_ATIVIDADE = { passos: 8000, min: 60, kcal: 500 };
export function metasAtividadeDe(perfil) {
  const m = perfil?.metasAtividade || {};
  const ok = (v, padrao) => (Number(v) > 0 ? Math.round(Number(v)) : padrao);
  return { passos: ok(m.passos, METAS_ATIVIDADE.passos), min: ok(m.min ?? m.minAtivos, METAS_ATIVIDADE.min), kcal: ok(m.kcal ?? m.kcalAtivas, METAS_ATIVIDADE.kcal) };
}

/**
 * Puro. Fatores da energia: média de sono (7 dias), consistência do tempo de sono (desvio padrão), regularidade (desvio da
 * hora de dormir), hora de dormir (mediana; antes de 23h30 = excelente), atividade de ontem (passos e minutos ativos),
 * consistência da atividade (dias fechados na meta de passos), FC e VFC no sono.
 */
export function fatoresEnergia({ sonos = [], atividades = [], dia, metaPassos = METAS_ATIVIDADE.passos }) {
  const sete = diasAnteriores(dia, 7).map((d) => noiteDe(sonos, d)).filter(Boolean);
  const totais = sete.map((s) => Number(s.total));
  const horas = sete.map((s) => horaDormirMin(s.inicio)).filter((x) => x != null);
  const mSono = mediaDe(totais);
  const dpSono = totais.length >= 3 ? desvioDe(totais) : null;
  const dpHora = horas.length >= 3 ? desvioDe(horas) : null;
  const medHora = horas.length ? medianaDe(horas) : null;
  const nivelDesvio = (d) => (d == null ? null : d <= 30 ? 'excelente' : d <= 60 ? 'bom' : d <= 90 ? 'razoavel' : 'atencao');
  const ontem = (atividades || []).find((a) => a?.dia === diasAnteriores(dia, 2)[0]) || null;
  const minOntem = ontem ? (ontem.minAtivos != null ? Number(ontem.minAtivos) : (ontem.treinos || []).reduce((s, t) => s + (Number(t.min) || 0), 0)) : null;
  const ptsOntem = ontem ? Math.max((Number(ontem.passos) || 0) / metaPassos, (minOntem || 0) / METAS_ATIVIDADE.min) : null;
  const fechados = diasAnteriores(dia, 8).slice(0, 7).map((d) => (atividades || []).find((a) => a?.dia === d && Number(a.passos) > 0)).filter(Boolean);
  const naMeta = fechados.filter((a) => Number(a.passos) >= metaPassos).length;
  const fracMeta = fechados.length >= 3 ? naMeta / fechados.length : null;
  const fv = fcVfcDoDia({ sonos, atividades, dia });
  return [
    { id: 'media_sono', nome: 'Média de sono', valor: mSono == null ? 'sem dado' : hmTxt(mSono), nivel: mSono == null ? null : mSono >= 420 ? 'excelente' : mSono >= 390 ? 'bom' : mSono >= 360 ? 'razoavel' : 'atencao', explicacao: 'Média das últimas 7 noites. O ideal é 7 horas ou mais.' },
    { id: 'consistencia_sono', nome: 'Constância do sono', valor: dpSono == null ? 'sem dado' : `± ${Math.round(dpSono)} min`, nivel: nivelDesvio(dpSono), explicacao: 'Dormir quantidades parecidas toda noite ajuda a energia.' },
    { id: 'regularidade', nome: 'Regularidade', valor: dpHora == null ? 'sem dado' : `± ${Math.round(dpHora)} min`, nivel: nivelDesvio(dpHora), explicacao: 'Deitar no mesmo horário ajuda o corpo a se preparar.' },
    { id: 'hora_dormir', nome: 'Hora de dormir', valor: medHora == null ? 'sem dado' : horaDoMeioDia(medHora), nivel: medHora == null ? null : medHora <= 690 ? 'excelente' : medHora <= 750 ? 'bom' : medHora <= 810 ? 'razoavel' : 'atencao', explicacao: 'Deitar antes das 23h30 costuma render mais energia.' },
    { id: 'atividade_ontem', nome: 'Atividade de ontem', valor: ontem ? `${milharTxt(Number(ontem.passos) || 0)} passos · ${Math.round(minOntem || 0)} min` : 'sem dado', nivel: ptsOntem == null ? null : ptsOntem >= 1 ? 'excelente' : ptsOntem >= 0.6 ? 'bom' : ptsOntem >= 0.3 ? 'razoavel' : 'atencao', explicacao: 'Mexer o corpo ontem ajuda o sono e a disposição de hoje.' },
    { id: 'consistencia_atividade', nome: 'Constância da atividade', valor: fracMeta == null ? 'sem dado' : `${naMeta} de ${fechados.length} dias na meta`, nivel: fracMeta == null ? null : fracMeta >= 0.7 ? 'excelente' : fracMeta >= 0.4 ? 'bom' : fracMeta >= 0.15 ? 'razoavel' : 'atencao', explicacao: 'Dias ativos em sequência mantêm a energia estável.' },
    fatorFc(fv.fc, fv.fcHist),
    fatorVfc(fv.hrv, fv.hrvHist),
  ];
}

/**
 * GET /perfis/:id/energia?dia=. A nota é a de sempre (saude.energiaDoDia, a mesma do Hoje); aqui entram o rótulo, a variação
 * contra a média dos 7 dias anteriores, as partes, os fatores e a semana.
 */
export function montarEnergia({ perfil = {}, saude = null, dia }) {
  const sonos = saude?.sonos || [];
  const atividades = saude?.atividades || [];
  const energia = (d) => (saude ? energiaDoDia({ sonos, atividades, dia: d }) : null);
  const e = energia(dia);
  const antes = diasAnteriores(dia, 8).slice(0, 7).map((d) => energia(d)?.nota).filter((x) => x != null);
  return completar({
    dia,
    nota: e?.nota ?? null,
    rotulo: rotuloNota(e?.nota),
    variacao: e?.nota != null && antes.length ? Math.round(e.nota - mediaDe(antes)) : null,
    partes: { sono: e?.sono ?? null, recuperacao: e?.recuperacao ?? null, carga: e?.carga ?? null },
    fatores: saude ? fatoresEnergia({ sonos, atividades, dia, metaPassos: metasAtividadeDe(perfil).passos }) : [],
    semana: diasAnteriores(dia, 7).map((d) => ({ dia: d, nota: energia(d)?.nota ?? null })),
    texto: semZap(e?.texto || 'Sem dados do relógio pra calcular a energia.'),
  });
}

/**
 * Puro. Taxa basal (kcal/dia) por Mifflin–St Jeor: 10 × peso + 6,25 × altura (cm) − 5 × idade + 5 (homem) ou − 161 (mulher).
 * Sem idade usa 30 anos; sem altura, 170 cm; sem gênero, a média dos dois (−78). Qualquer valor suposto = `estimada: true`.
 * Sem peso, null.
 * @returns {{ kcal: number, estimada: boolean } | null}
 */
export function kcalBasal({ peso = null, altura = null, idade = null, genero = null } = {}) {
  const p = Number(peso);
  if (!(p > 25 && p < 400)) return null;
  let a = Number(altura);
  if (a > 0 && a < 3) a *= 100; // altura em metros (planilha do relógio)
  const alturaOk = a > 100 && a < 250;
  const i = Number(idade);
  const idadeOk = i >= 10 && i <= 110;
  const g = semAcento(genero);
  const s = /^(masc|homem|m$)/.test(g) ? 5 : /^(fem|mulher|f$)/.test(g) ? -161 : null;
  const kcal = 10 * p + 6.25 * (alturaOk ? a : 170) - 5 * (idadeOk ? i : 30) + (s ?? -78);
  return { kcal: Math.round(kcal), estimada: !(alturaOk && idadeOk && s != null) };
}

/** Puro. Calorias ativas = gasto total − basal × fração do dia (dia fechado = 1); nunca negativo; null sem gasto ou sem basal. */
export function kcalAtivasDoDia({ kcalTotal = null, basal = null, fracaoDia = 1 } = {}) {
  if (!(Number(kcalTotal) > 0) || !(Number(basal) > 0)) return null;
  return Math.max(0, Math.round(Number(kcalTotal) - Number(basal) * Math.max(0, Math.min(1, fracaoDia))));
}

/**
 * Os números de atividade de um dia (anéis do Hoje e da tela Atividade). `fracaoDia` só < 1 no dia em andamento. Fase 7: as
 * calorias ativas oficiais do Health Connect (`at.kcalAtivas`, permissão opcional) vencem a estimativa por Mifflin; a
 * distância (`at.distanciaM`) só existe com a permissão.
 */
function numerosAtividade({ at = null, basal = null, fracaoDia = 1 }) {
  const minTreinos = (at?.treinos || []).reduce((s, t) => s + (Number(t.min) || 0), 0);
  const oficial = numOuNull(at?.kcalAtivas);
  const distancia = numOuNull(at?.distanciaM);
  return {
    passos: at?.passos != null ? int(at.passos) : null,
    minAtivos: at ? (at.minAtivos != null ? int(at.minAtivos) : int(minTreinos)) : null,
    kcalTotal: Number(at?.calorias) > 0 ? int(at.calorias) : null,
    kcalAtivas: oficial != null && oficial >= 0 ? int(oficial) : kcalAtivasDoDia({ kcalTotal: at?.calorias, basal: basal?.kcal, fracaoDia }),
    kcalAtivasOficial: oficial != null && oficial >= 0,
    distanciaM: distancia != null && distancia >= 0 ? int(distancia) : null,
  };
}
/** A basal da pessoa (peso do perfil; sem ele, a última pesagem do relógio). */
const basalDe = (perfil, saude) => {
  const pesos = saude?.pesos || [];
  return kcalBasal({ peso: Number(perfil?.peso) || pesos[pesos.length - 1]?.peso, altura: perfil?.altura || pesos.map((p) => p.altura).filter(Boolean).pop(), idade: perfil?.idade, genero: perfil?.genero });
};
/**
 * Fração do dia já passada pra basal do dia em andamento: a hora do último envio do relógio, se foi no mesmo dia (o gasto
 * total é o daquele instante); senão a hora de agora. Dia fechado = 1.
 */
function fracaoDoDia({ perfil, saude, dia, hoje, horaAgora }) {
  if (dia < hoje) return 1;
  let hora = horaAgora;
  if (saude?.ultimoEnvio) {
    const t = marcaDeTempo(perfil, new Date(saude.ultimoEnvio));
    if (t.dia === dia) hora = t.horaLocal;
  }
  return Math.max(1, minutosDe(hora)) / 1440;
}

/** Puro. Os anéis do Hoje: { passos, metaPassos, minAtivos, metaMin, kcalAtivas, metaKcal } (números null sem dado). */
export function anelAtividade({ perfil = {}, saude = null, dia, hoje = dia, horaAgora = '23:59' }) {
  const metas = metasAtividadeDe(perfil);
  const at = (saude?.atividades || []).find((a) => a?.dia === dia) || null;
  const x = numerosAtividade({ at, basal: basalDe(perfil, saude), fracaoDia: fracaoDoDia({ perfil, saude, dia, hoje, horaAgora }) });
  return { passos: x.passos, metaPassos: metas.passos, minAtivos: x.minAtivos, metaMin: metas.min, kcalAtivas: x.kcalAtivas, metaKcal: metas.kcal };
}

/**
 * GET /perfis/:id/atividade?dia=. Passos, minutos ativos (do coletor; sem ele, os minutos de exercício) e calorias ativas
 * (gasto total − basal Mifflin–St Jeor) contra as metas, por hora (só os 14 dias mais recentes têm), a hora de pico de
 * passos, os exercícios do dia e a semana em frações da meta. Fase 7: com as kcal ativas oficiais do Health Connect elas
 * substituem a estimativa (`kcalAtivasEstimada: false`); `distanciaKm` e `porHora.kcalAtivas` só quando vieram.
 */
export function montarAtividade({ perfil = {}, saude = null, dia, hoje = dia, horaAgora = '23:59' }) {
  const metas = metasAtividadeDe(perfil);
  const basal = basalDe(perfil, saude);
  const ativ = (d) => (saude?.atividades || []).find((a) => a?.dia === d) || null;
  const at = ativ(dia);
  const x = numerosAtividade({ at, basal, fracaoDia: fracaoDoDia({ perfil, saude, dia, hoje, horaAgora }) });
  // o que já está guardado também passa pelo filtro do rateio (total do dia dividido igual por 24 não é dado por hora)
  const real = (v) => (Array.isArray(v) && !vetorRateado(v) ? v.map(int) : null);
  const porHora = { passos: real(at?.porHora?.passos), kcal: real(at?.porHora?.kcal) };
  // fase 7: calorias ativas por hora oficiais (a chave só existe quando o relógio mandou)
  if (Array.isArray(at?.porHora?.kcalAtivas) && at.porHora.kcalAtivas.length === 24 && !vetorRateado(at.porHora.kcalAtivas)) porHora.kcalAtivas = at.porHora.kcalAtivas.map(int);
  let picoHora = null;
  if (porHora.passos) {
    const max = Math.max(...porHora.passos);
    const h = porHora.passos.indexOf(max);
    if (max > 0) picoHora = `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
  }
  const fr = (v, meta) => (v == null ? 0 : r2(v / meta));
  return completar({
    dia,
    passos: x.passos,
    metaPassos: metas.passos,
    minAtivos: x.minAtivos,
    metaMin: metas.min,
    kcalAtivas: x.kcalAtivas,
    metaKcal: metas.kcal,
    kcalTotal: x.kcalTotal,
    // fase 7: a chave `distanciaKm` só existe com a permissão de distância (o app esconde a linha sem ela)
    ...(x.distanciaM != null ? { distanciaKm: r2(x.distanciaM / 1000) } : {}),
    // com as kcal ativas oficiais do Health Connect não há estimativa
    kcalAtivasEstimada: x.kcalAtivasOficial ? false : Boolean(basal?.estimada ?? true),
    porHora,
    picoHora,
    exercicios: (at?.treinos || []).map((t) => ({ nome: semZap(String(t.nome || 'Exercício')), hora: t.hora ?? null, min: t.min ?? null, kcal: Number(t.kcal) > 0 ? int(t.kcal) : null, fcMedia: Number(t.fcMedia) > 0 ? int(t.fcMedia) : null })),
    semana: diasAnteriores(dia, 7).map((d) => {
      const y = numerosAtividade({ at: ativ(d), basal, fracaoDia: fracaoDoDia({ perfil, saude, dia: d, hoje, horaAgora }) });
      return { dia: d, passosPct: fr(y.passos, metas.passos), minPct: fr(y.minAtivos, metas.min), kcalPct: fr(y.kcalAtivas, metas.kcal) };
    }),
  });
}

/** Distribuição recomendada dos macros (% das kcal) pelo objetivo: hipertrofia 50/25/25, emagrecimento 40/30/30, manutenção 50/30/20 (c/g/p). */
export function macrosRecomendados(objetivo) {
  const o = semAcento(objetivo);
  if (/hipertrof|ganh|massa|bulk|engord|forca/.test(o)) return { c: 50, g: 25, p: 25 };
  if (/emagre|perd|reduz|defin|secar|cutting|gordura/.test(o)) return { c: 40, g: 30, p: 30 };
  return { c: 50, g: 30, p: 20 };
}
/** Puro. % das kcal de cada macro (4/4/9 kcal por grama) no que foi comido e a recomendada; sem comida, real zerado. */
export function distribuicaoMacros({ p = 0, c = 0, g = 0, objetivo = null } = {}) {
  const kp = (Number(p) || 0) * 4;
  const kc = (Number(c) || 0) * 4;
  const kg = (Number(g) || 0) * 9;
  const total = kp + kc + kg;
  const real = total > 0 ? { c: Math.round((kc / total) * 100), g: Math.round((kg / total) * 100), p: Math.round((kp / total) * 100) } : { c: 0, g: 0, p: 0 };
  return { real, recomendada: macrosRecomendados(objetivo) };
}

// ============================================================
// Série por dia (fase 4): a fonte do gráfico único do app
// ============================================================
/**
 * Puro. Um item por dia de [de, ate] com kcal/proteína registradas (sem registro = null), gasto do relógio (atividades do
 * saude_relogio; sem ele, perfil.relogio.gastos), pesagem consolidada (peso, gordura, massa magra), sono da noite de que
 * acordou no dia, passos e minutos de treino. `meta` = a faixa de kcal (gastoAdaptativo) do dia `ate`.
 */
export function montarDias({ perfil = {}, de, ate, refeicoes = [], pesagens = [], saude = null, meta = null }) {
  const kcal = new Map();
  const prot = new Map();
  for (const r of refeicoes) {
    if (!r?.dia || !(Number(r.estimativa?.kcal) > 0)) continue;
    kcal.set(r.dia, (kcal.get(r.dia) || 0) + Number(r.estimativa.kcal));
    prot.set(r.dia, (prot.get(r.dia) || 0) + (Number(r.estimativa.p) || 0));
  }
  const peso = new Map(pesagens.filter((p) => p?.dia && Number(p.peso) > 0).map((p) => [p.dia, p]));
  const sono = new Map((saude?.sonos || []).filter((s) => s?.dia).map((s) => [s.dia, s]));
  const ativ = new Map((saude?.atividades || []).filter((a) => a?.dia).map((a) => [a.dia, a]));
  const gastos = perfil?.relogio?.gastos || {};
  // relogio.js grava inicio/fim como "AAAA-MM-DD HH:MM" (a noite pode começar na véspera); o app só precisa da hora
  const hhmm = (v) => {
    const m = /(\d{2}:\d{2})/.exec(String(v ?? ''));
    return m ? m[1] : null;
  };
  const dias = diasEntre(de, ate).map((dia) => {
    const p = peso.get(dia);
    const g = p && p.gordura != null && Number(p.gordura) >= 2 && Number(p.gordura) <= 70 ? r1(p.gordura) : null;
    const s = sono.get(dia);
    const a = ativ.get(dia);
    const gasto = Number(a?.calorias) > 800 ? int(a.calorias) : Number(gastos[dia]) > 800 ? int(gastos[dia]) : null;
    return {
      dia,
      kcal: kcal.has(dia) ? int(kcal.get(dia)) : null,
      proteina: prot.has(dia) ? int(prot.get(dia)) : null,
      gasto,
      peso: p ? r2(p.peso) : null,
      gordura: g,
      magra: p && g != null ? r1(Number(p.peso) * (1 - g / 100)) : null,
      sonoMin: Number(s?.total) > 0 ? int(s.total) : null,
      sonoInicio: hhmm(s?.inicio),
      sonoFim: hhmm(s?.fim),
      passos: a?.passos != null ? int(a.passos) : null,
      treinoMin: a?.treinos?.length ? int((a.treinos || []).reduce((t, x) => t + (Number(x.min) || 0), 0)) : null,
    };
  });
  return completar({ meta: meta?.min != null && meta?.max != null ? { min: int(meta.min), max: int(meta.max) } : null, dias });
}

// ============================================================
// Plano da semana, relatórios da Nutri e sugestão de refeição (fase 4)
// ============================================================
/** Puro. O documento de `planos` (ou null) no formato do contrato; o texto passa pelo filtro de localização. */
export function montarPlano(doc, termosLocal = []) {
  if (!doc?.texto) return completar({ plano: null });
  return completar({ plano: { semana: doc.semana || null, de: doc.de || null, ate: doc.ate || null, texto: semZap(tirarLocalizacao(doc.texto, termosLocal), { markdown: true }), criadoEm: iso(doc.criadoEm) || null } });
}

/** Puro. Um .md do Drive (Resumos/Semana-*.md ou Mes-*.md) vira { titulo, texto, criadoEm }: sem frontmatter nem rodapé de links. */
export function montarRelatorio(arquivo, termosLocal = []) {
  if (!arquivo?.texto) return null;
  let t = String(arquivo.texto).replace(/^---[\s\S]*?---\s*/, '');
  t = t.replace(/\n---\n(?:Dias:|## Números)[\s\S]*$/, ''); // os links pros dias e a tabela crua ficam no Drive
  const m = /^#\s+(.+)$/m.exec(t);
  const titulo = (m ? semZap(tirarLocalizacao(m[1].trim(), termosLocal)) : '') || String(arquivo.nome || '').replace(/\.md$/i, '') || null;
  if (m) t = t.replace(m[0], '');
  const texto = semZap(tirarLocalizacao(t.trim(), termosLocal), { markdown: true });
  return texto ? { titulo, texto, criadoEm: iso(arquivo.modifiedTime) || null } : null;
}

const ORDEM_SLOTS = ['cafe', 'lanche_manha', 'almoco', 'lanche', 'jantar', 'ceia'];
/**
 * Puro. A próxima refeição do dia: o primeiro slot da rotina (padraoAlimentar.slots, hora habitual) ainda não registrado
 * hoje cuja hora habitual é depois de agora menos 90 min; sem rotina, pelo horário (café até 10h, almoço até 14h30, lanche
 * até 18h, jantar até 22h, senão ceia).
 */
export function proximoSlot({ slots = {}, registradosHoje = [], horaAgora = '12:00' }) {
  const agoraMin = minutosDe(horaAgora);
  const feitos = new Set(registradosHoje);
  for (const s of ORDEM_SLOTS) {
    const h = slots[s]?.hora;
    if (!h || feitos.has(s)) continue;
    if (minutosDe(h) >= agoraMin - 90) return { slot: s, hora: h };
  }
  const porHora = agoraMin < 10 * 60 ? 'cafe' : agoraMin < 14 * 60 + 30 ? 'almoco' : agoraMin < 18 * 60 ? 'lanche' : agoraMin < 22 * 60 ? 'jantar' : 'ceia';
  const livre = ORDEM_SLOTS.slice(ORDEM_SLOTS.indexOf(porHora)).find((s) => !feitos.has(s)) || porHora;
  return { slot: livre, hora: horaDoSlot(slots, livre) };
}
const horaDeMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Puro. A hora habitual do slot (rotina) ou, sem rotina, a hora padrão do slot (util.SLOTS). */
export function horaDoSlot(slots = {}, slot) {
  if (slots?.[slot]?.hora) return slots[slot].hora;
  const padrao = SLOTS.find((x) => x.id === slot)?.padrao;
  return padrao != null ? horaDeMin(padrao) : null;
}

/** Puro. A resposta da IA (ia.sugerirRefeicao) no formato do contrato, filtrada de localização e com limites de tamanho. */
export function montarSugestaoRefeicao({ slot, hora = null, restam = null, geradaEm = null, resposta = {}, termosLocal = [] }) {
  const sem = (t, max) => (t == null ? null : semZap(tirarLocalizacao(String(t), termosLocal)).slice(0, max) || null);
  const onde = (v) => (['casa', 'levar', 'fora'].includes(String(v)) ? String(v) : 'casa');
  const opcoes = (Array.isArray(resposta.opcoes) ? resposta.opcoes : [])
    .slice(0, 3)
    .map((o) => ({ nome: sem(o?.nome, 80), porque: sem(o?.porque, 160), kcal: int(o?.kcal), proteina: int(o?.proteina_g ?? o?.proteina), onde: onde(o?.onde), preparo: sem(o?.preparo, 300) }))
    .filter((o) => o.nome);
  return completar({ slot, nome: nomeDoSlot(slot), hora, restam: int(restam), geradaEm, opcoes, levar: sem(resposta.levar, 200), dica: sem(resposta.dica, 200) });
}

// ============================================================
// Nutri (o que a IA sabe da pessoa)
// ============================================================
const ROTULO_CAMPO = { objetivo: 'Objetivo', metaPeso: 'Meta de peso', peso: 'Peso', altura: 'Altura', dieta: 'Dieta', restricoes: 'Restrições', genero: 'Gênero' };

// ============================================================
// Textos sem a marcação do WhatsApp (fase 5)
// ============================================================
const RE_EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;
/**
 * Puro. Texto escrito pro WhatsApp vira texto do app: sem *negrito*, _itálico_, ~riscado~, crases nem emoji, e sem
 * espaço sobrando. Com `markdown: true` (textos longos que o app mostra como Markdown simples), o *negrito* vira
 * **negrito** em vez de sumir.
 */
export function semZap(texto, { markdown = false } = {}) {
  if (texto == null) return texto;
  let t = String(texto).replace(/\r\n?/g, '\n');
  t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '')).replace(/`([^`\n]+)`/g, '$1');
  t = t.replace(/(^|[\s(])\*([^*\n]{1,200}?)\*(?=[\s).,;:!?]|$)/g, markdown ? '$1**$2**' : '$1$2');
  t = t.replace(/(^|[\s(])_([^_\n]{1,200}?)_(?=[\s).,;:!?]|$)/g, '$1$2');
  t = t.replace(/(^|[\s(])~([^~\n]{1,200}?)~(?=[\s).,;:!?]|$)/g, '$1$2');
  t = t.replace(RE_EMOJI, '');
  // marcador de lista do WhatsApp ("• ") vira o do Markdown; "→" fica
  t = t.replace(/^[ \t]*[•▪◦]\s*/gm, '- ');
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Puro. 8 hex do sha1 do texto: identifica um produto fixo (pelo nome) ou uma anotação (pelo texto gravado) sem depender da posição na lista. */
export const hashCurto = (t) => createHash('sha1').update(String(t ?? '')).digest('hex').slice(0, 8);
/** Fatos de texto livre que a pessoa corrige no app (fase 3); objetivo, meta, peso e altura se editam na tela Perfil. */
export const FATOS_EDITAVEIS = ['dieta', 'restricoes', 'rotina', 'notas'];
/** Fatos que a pessoa apaga no app: os editáveis, as gírias (a lista toda), e cada produto fixo e anotação pelo id. */
export const FATOS_APAGAVEIS = [...FATOS_EDITAVEIS, 'girias'];

/**
 * GET /perfis/:id/nutri. fatos (cadastro, produtos fixos, gírias, rotina, notas e anotações), hipóteses (abertas no perfil e
 * fechadas na coleção), diário da Nutri e avaliações (reflexões e pensamentos). Todo item traz natureza ('declarado' |
 * 'medido' | 'inferido' | 'hipotese' | 'opiniao'), origem, atualizadoEm e escopo: 'pessoa', ou 'grupo' no diário (decisão
 * do dono: o diário fica no /nutri, mas marcado como texto sobre o grupo todo, não dado desta pessoa). Texto livre passa pelo
 * filtro de localização. Fase 3: cada fato traz id, editavel e apagavel (contrato em docs/app/2026-10-14-plano-fase3.md);
 * a hipótese aberta traz apagavel (a pessoa descarta).
 */
export function montarNutri({ perfil, hipotesesFechadas = [], reflexoes = [], pensamentos = [], diario = [], termosLocal = [] }) {
  const sem = (t) => semZap(tirarLocalizacao(t, termosLocal));
  const at = perfil.atualizacoes || {};
  const fatos = [];
  // todo texto de fato passa pelo filtro (dieta, restrições e produto também: "só como no restaurante X")
  // `valor` = o texto cru que o PUT recebe de volta (sem o rótulo "Dieta: "); só nos editáveis. Se o filtro de localização
  // tirou alguma frase, o fato NÃO é editável: salvar o texto filtrado apagaria de vez o bairro de casa que o bot usa
  const fato = (campo, texto, natureza, origem, atualizadoEm, id = campo, valor = null) => {
    const t = sem(String(texto || '')).trim();
    if (!t) return;
    const cru = valor == null ? null : String(valor).trim();
    const filtrado = cru != null && sem(cru).trim() !== cru;
    const editavel = FATOS_EDITAVEIS.includes(campo) && !filtrado;
    fatos.push({ id, campo, texto: t, natureza, origem, atualizadoEm: atualizadoEm || null, escopo: 'pessoa', editavel, apagavel: FATOS_APAGAVEIS.includes(campo) || campo === 'produto' || campo === 'anotacao', valor: editavel ? cru : null });
  };
  const comVirgula = (n) => String(n).replace('.', ',');
  if (perfil.objetivo) fato('objetivo', `${ROTULO_CAMPO.objetivo}: ${perfil.objetivo}`, 'declarado', 'cadastro e conversa', at.objetivo);
  if (perfil.metaPeso) fato('metaPeso', `${ROTULO_CAMPO.metaPeso}: ${comVirgula(perfil.metaPeso)} kg${perfil.metaPrazo ? ` até ${perfil.metaPrazo}` : ''}`, 'declarado', 'cadastro e conversa', at.metaPeso || at.metaPrazo);
  if (perfil.peso) {
    const doRelogio = perfil.relogio?.pesoEm && perfil.relogio.pesoEm === at.peso;
    fato('peso', `${ROTULO_CAMPO.peso}: ${comVirgula(perfil.peso)} kg`, doRelogio ? 'medido' : 'declarado', doRelogio ? 'balança do relógio' : 'cadastro e conversa', at.peso);
  }
  if (perfil.altura) fato('altura', `${ROTULO_CAMPO.altura}: ${perfil.altura} cm`, 'declarado', 'cadastro', at.altura);
  if (perfil.dieta) fato('dieta', `${ROTULO_CAMPO.dieta}: ${perfil.dieta}`, 'declarado', 'cadastro e conversa', at.dieta, 'dieta', perfil.dieta);
  if (perfil.restricoes) fato('restricoes', `${ROTULO_CAMPO.restricoes}: ${perfil.restricoes}`, 'declarado', 'cadastro e conversa', at.restricoes, 'restricoes', perfil.restricoes);
  for (const p of perfil.produtos || []) fato('produto', `Produto fixo: ${p.nome}${p.kcal ? ` (${p.kcal} kcal)` : ''}`, 'declarado', 'rótulo ou conversa', p.em, `produto:${hashCurto(p.nome)}`);
  if (perfil.girias?.length) fato('girias', `Gírias: ${perfil.girias.join(', ')}`, 'inferido', 'conversa no grupo (lida pela IA toda noite)', null);
  if (perfil.rotina) fato('rotina', perfil.rotina, 'inferido', 'ficha de rotina (IA, toda noite)', at.rotina, 'rotina', perfil.rotina);
  if (perfil.notas) fato('notas', perfil.notas, 'inferido', 'notas da Nutri sobre a pessoa (IA, toda noite)', at.notas, 'notas', perfil.notas);
  for (const a of perfil.anotacoes || []) fato('anotacao', sem(a.texto), 'inferido', `anotação da Nutri${a.tipo ? ` (${a.tipo})` : ''}`, a.dia, `anotacao:${hashCurto(a.texto)}`);

  const hip = (h, origem, apagavel) => ({
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
    apagavel: Boolean(apagavel && h.id),
  });
  const hipoteses = [
    ...(perfil.hipoteses || []).filter((h) => h.status === 'aberta').map((h) => hip(h, 'reflexão de domingo (IA); sinais dos pensamentos', true)),
    ...hipotesesFechadas.map((h) => hip(h, h.status === 'descartada' ? 'descartada pela pessoa no app' : 'reflexão de domingo (IA), conferida nos dados', false)),
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
export function montarResumos({ perfil, dia, refeicoes = [], pesagens = [], relatorios = null, termosLocal = [] }) {
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
  // fase 4: o último resumo da semana e o último relatório do mês que a Nutri escreveu (Drive; textos sobre o grupo)
  const relatorio = { semana: montarRelatorio(relatorios?.semana, termosLocal), mes: montarRelatorio(relatorios?.mes, termosLocal) };
  return completar({ semana: v ? periodo(v.sete, 'Últimos 7 dias') : null, mes: v ? periodo(v.trinta, 'Últimos 30 dias') : null, sequencia: v ? v.sequencia : 0, relatorio });
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
