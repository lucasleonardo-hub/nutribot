// reflexao.js - Reflexão livre da Nutri sobre cada pessoa: um texto sem formato fixo onde ela pensa sobre tudo que sabe
// (comida, gasto, lugares, treino, sono, jeito de ser) e forma uma opinião. Vai pra <Nome>/Nutri-Reflexoes.md no Drive e a
// síntese (o último parágrafo, "Em uma frase") entra na conversa com a pessoa quando fizer sentido. Reescrita aos domingos.
//
// Ciclo de hipóteses: cada reflexão deixa suspeitas ("quero observar"). Antes da próxima, ela confere cada uma nos dados da
// semana (confirmada / refutada / ainda aberta, com a evidência) e só então reescreve, sabendo o que acertou e o que caiu.

import { colecao, salvarPerfil, refeicoesDesde } from './mongo.js';
import { salvarEmPasta } from './drive.js';
import { pastaDe, notasDe, dossieDe } from './pessoas.js';
import { enriquecerPerfis } from './perfis.js';
import { visaoDe } from './acompanhamento.js';
import { padraoAlimentar, compilarSemana } from './resumo.js';
import { textoRelogio } from './relogio.js';
import { diasAnteriores } from './util.js';
import * as ia from './gemini.js';
import { resumoDespensaPeriodo } from './despensa.js';

export const ARQ_REFLEXOES = 'Nutri-Reflexoes.md';
const MAX_SINTESE = 600;
const MAX_ABERTAS = 8;

/** Último parágrafo que começa com "Em uma frase" (ou o último parágrafo do texto), limpo, até 600 caracteres. */
export function extrairSintese(texto) {
  const paras = String(texto || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return '';
  const marcado = [...paras].reverse().find((p) => /^\*?_?\s*em uma frase/i.test(p.replace(/^[#*_\s]+/, '')));
  const alvo = marcado || paras[paras.length - 1];
  return alvo
    .replace(/^[#*_\s]*em uma frase[*_\s]*[:.\-–—]?\s*/i, '')
    .replace(/[*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SINTESE);
}

/**
 * Puro. Junta as hipóteses abertas com as novas extraídas do texto: novas entram com id e data; repetidas (mesmo texto
 * normalizado ou marcadas pela IA como já existentes) não duplicam; no máximo MAX_ABERTAS, as mais antigas saem primeiro.
 */
export function fundirHipoteses(abertas = [], novas = [], dia) {
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9áàâãéêíóôõúüç ]/g, '').replace(/\s+/g, ' ').trim();
  const lista = abertas.map((h) => ({ ...h }));
  const vistas = new Set(lista.map((h) => norm(h.texto)));
  let seq = lista.length;
  for (const n of novas) {
    const texto = String(n?.texto || '').trim();
    if (!texto || vistas.has(norm(texto))) continue;
    vistas.add(norm(texto));
    seq += 1;
    lista.push({ id: `h${dia.replace(/-/g, '')}${seq}`, texto: texto.slice(0, 240), comoVerificar: String(n.como_verificar || n.comoVerificar || '').slice(0, 200), criadaEm: dia, status: 'aberta' });
  }
  return lista.slice(-MAX_ABERTAS);
}

/** Puro. Aplica os vereditos da IA às hipóteses abertas; devolve { abertas, fechadas }. */
export function aplicarVereditos(abertas = [], vereditos = [], dia) {
  const porId = new Map(vereditos.map((v) => [v.id, v]));
  const ainda = [];
  const fechadas = [];
  for (const h of abertas) {
    const v = porId.get(h.id);
    const st = v?.veredito;
    if (st === 'confirmada' || st === 'refutada') fechadas.push({ ...h, status: st, evidencia: String(v.evidencia || '').slice(0, 300), fechadaEm: dia });
    else ainda.push({ ...h, ultimaChecagem: dia, evidencia: v?.evidencia ? String(v.evidencia).slice(0, 300) : h.evidencia, semanasAbertas: (h.semanasAbertas || 0) + 1 });
  }
  // hipótese que passa 6 semanas sem se decidir vira "inconclusiva" e sai da lista (senão acumula ruído)
  const vivas = ainda.filter((h) => (h.semanasAbertas || 0) < 6);
  for (const h of ainda.filter((h) => (h.semanasAbertas || 0) >= 6)) fechadas.push({ ...h, status: 'inconclusiva', fechadaEm: dia });
  return { abertas: vivas, fechadas };
}

const blocoHipoteses = (abertas, fechadasRecentes) => {
  const linhas = [];
  for (const h of fechadasRecentes) linhas.push(`- [${h.status.toUpperCase()}] ${h.texto}${h.evidencia ? ` — evidência: ${h.evidencia}` : ''}`);
  for (const h of abertas) linhas.push(`- [AINDA ABERTA${h.semanasAbertas ? `, ${h.semanasAbertas} sem.` : ''}] ${h.texto}${h.evidencia ? ` — até agora: ${h.evidencia}` : ''}`);
  return linhas.length ? `SUAS HIPÓTESES E O QUE OS DADOS DISSERAM (aprenda com isto: o que se confirmou pode virar conclusão; o que foi refutado, admita e mude de ideia; o que segue aberto, diga o que falta pra decidir):\n${linhas.join('\n')}` : '';
};

async function dadosDaSemana(perfil, dia) {
  const dias = diasAnteriores(dia, 7);
  const refs = await refeicoesDesde(perfil.jids, dias[0]).catch(() => []);
  return compilarSemana(refs, [perfil], dias);
}

/** Reúne tudo que a Nutri sabe da pessoa (sem endereço, sem dado de outra pessoa), confere as hipóteses e pede a reflexão. */
export async function refletirSobre(perfil, { dia, persona, motivo = 'domingo' } = {}) {
  const [comExtras] = await enriquecerPerfis([perfil], dia);
  const desde = diasAnteriores(dia, 28)[0];
  const [notas, visao, refs, relogio, docs, anterior, semana] = await Promise.all([
    notasDe(perfil).catch(() => ''),
    visaoDe(perfil, dia).catch(() => ''),
    refeicoesDesde(perfil.jids, desde).catch(() => []),
    textoRelogio(perfil).catch(() => null),
    dossieDe(perfil).catch(() => ''),
    colecao('reflexoes').find({ jid: perfil.jids?.[0] }).sort({ dia: -1 }).limit(1).next().catch(() => null),
    dadosDaSemana(perfil, dia).catch(() => ''),
  ]);
  const despensa = await resumoDespensaPeriodo(perfil, dia).catch(() => '');
  const padrao = padraoAlimentar(refs, { periodoDias: 28 });
  const fontes = {
    visao,
    padrao: padrao.texto,
    lugares: comExtras._lugares?.bloco || '',
    treino: comExtras._treino?.bloco || comExtras.treino || '',
    relogio,
    semana,
  };

  // 1) confere as hipóteses abertas nos dados da semana (só quando há alguma)
  let abertas = (perfil.hipoteses || []).filter((h) => h.status === 'aberta');
  let fechadas = [];
  if (abertas.length) {
    try {
      const vereditos = await ia.verificarHipoteses({ perfil: comExtras, hipoteses: abertas, fontes, dia });
      ({ abertas, fechadas } = aplicarVereditos(abertas, vereditos, dia));
      if (fechadas.length) await colecao('hipoteses').insertMany(fechadas.map((h) => ({ ...h, jid: perfil.jids?.[0], nome: perfil.nome }))).catch(() => {});
      console.log(`[reflexao] ${perfil.nome}: hipóteses ${fechadas.filter((h) => h.status === 'confirmada').length} confirmada(s), ${fechadas.filter((h) => h.status === 'refutada').length} refutada(s), ${abertas.length} aberta(s)`);
    } catch (e) {
      console.warn('[reflexao] verificação de hipóteses falhou:', e.message);
    }
  }

  // 2) a reflexão em si, já sabendo o que acertou e o que caiu
  const texto = await ia.refletirSobrePessoa({
    perfil: comExtras,
    notas,
    visao,
    padrao: padrao.texto,
    lugares: fontes.lugares,
    treino: fontes.treino,
    relogio,
    documentos: String(docs || '').slice(0, 4000),
    anterior: anterior?.texto || '',
    hipoteses: blocoHipoteses(abertas, fechadas),
    despensa,
    persona,
    dia,
  });
  const limpo = ia.separarAtualizacao(texto).texto?.trim();
  if (!limpo || limpo.length < 200) throw new Error('reflexão vazia ou curta demais');
  const sintese = extrairSintese(limpo);

  // 3) novas suspeitas do texto viram hipóteses abertas (pra conferir na semana que vem)
  try {
    const novas = await ia.extrairHipoteses({ perfil: comExtras, texto: limpo, abertas, dia });
    abertas = fundirHipoteses(abertas, novas, dia);
  } catch (e) {
    console.warn('[reflexao] extração de hipóteses falhou:', e.message);
  }

  await colecao('reflexoes').insertOne({ jid: perfil.jids?.[0], nome: perfil.nome, dia, motivo, texto: limpo, sintese, hipotesesAbertas: abertas, hipotesesFechadas: fechadas, criadoEm: new Date() });
  await salvarPerfil({ jids: perfil.jids, reflexao: { dia, sintese }, hipoteses: abertas });
  const pastaId = await pastaDe(perfil).catch(() => null);
  if (pastaId) {
    const md =
      `---\ntipo: reflexao\npessoa: ${perfil.nome}\natualizado: ${dia}\ntags: [nutribot, pessoa, reflexao]\n---\n\n` +
      `# O que eu penso sobre ${perfil.nome.split(' ')[0]} (${dia})\n\n` +
      `_Texto livre da ${ia.nomeDaBot()}, reescrito aos domingos a partir de tudo que ela sabe: comida, gasto, lugares, treino, sono, jeito de ser. Sem endereços. As versões anteriores ficam no banco._\n\n` +
      `${limpo}\n` +
      (fechadas.length ? `\n## O que os dados desta semana disseram\n${fechadas.map((h) => `- **${h.status}**: ${h.texto}${h.evidencia ? ` — ${h.evidencia}` : ''}`).join('\n')}\n` : '') +
      (abertas.length ? `\n## Hipóteses em observação\n${abertas.map((h) => `- ${h.texto}${h.comoVerificar ? ` _(como conferir: ${h.comoVerificar})_` : ''}${h.criadaEm ? ` — desde ${h.criadaEm}` : ''}`).join('\n')}\n` : '');
    await salvarEmPasta(pastaId, ARQ_REFLEXOES, md).catch((e) => console.error('[reflexao] Drive:', e.message));
  }
  console.log(`[reflexao] ${perfil.nome}: ${limpo.length} chars; ${abertas.length} hipótese(s) aberta(s); síntese: ${sintese.slice(0, 90)}`);
  return { texto: limpo, sintese, abertas, fechadas };
}

/** Todas as pessoas com cadastro completo (uma rodada cada; erro de uma não derruba as outras). */
export async function refletirTodos({ perfis, dia, persona, motivo }) {
  for (const p of perfis.filter((x) => x.onboarded)) {
    try {
      await refletirSobre(p, { dia, persona, motivo });
    } catch (e) {
      console.error(`[reflexao] ${p.nome}:`, e.message);
    }
  }
}

/** Texto do !reflexao: a síntese atual, as hipóteses em observação e onde está o texto inteiro. */
export function reflexaoZap(perfil) {
  const r = perfil?.reflexao;
  if (!r?.sintese) return 'Ainda não escrevi minha reflexão sobre você. Ela nasce no fechamento de domingo, ou agora com "!reflexao nova".';
  const abertas = (perfil.hipoteses || []).filter((h) => h.status === 'aberta');
  return (
    `🪞 *Como eu te entendo hoje*\n\n${r.sintese}\n\n` +
    (abertas.length ? `*O que estou observando*\n${abertas.map((h) => `- ${h.texto}`).join('\n')}\n\n` : '') +
    `_Escrito em ${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)}. O texto inteiro está em ${ARQ_REFLEXOES}, na sua pasta do Drive. No domingo eu confiro essas suspeitas nos dados da semana antes de reescrever. "!reflexao nova" reescreve agora._`
  );
}
