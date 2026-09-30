// reflexao.js - Reflexão livre da Nutri sobre cada pessoa: um texto sem formato fixo onde ela pensa sobre tudo que sabe
// (comida, gasto, lugares, treino, sono, jeito de ser) e forma uma opinião. Vai pra <Nome>/Nutri-Reflexoes.md no Drive e a
// síntese (o último parágrafo, "Em uma frase") entra na conversa com a pessoa quando fizer sentido. Reescrita aos domingos.

import { colecao, salvarPerfil, refeicoesDesde } from './mongo.js';
import { salvarEmPasta } from './drive.js';
import { pastaDe, notasDe, dossieDe } from './pessoas.js';
import { enriquecerPerfis } from './perfis.js';
import { visaoDe } from './acompanhamento.js';
import { padraoAlimentar } from './resumo.js';
import { textoRelogio } from './relogio.js';
import { diasAnteriores } from './util.js';
import * as ia from './gemini.js';

export const ARQ_REFLEXOES = 'Nutri-Reflexoes.md';
const MAX_SINTESE = 600;

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

/** Reúne tudo que a Nutri sabe da pessoa (sem endereço, sem dado de outra pessoa) e pede a reflexão. Salva Drive + perfil. */
export async function refletirSobre(perfil, { dia, persona, motivo = 'domingo' } = {}) {
  const [comExtras] = await enriquecerPerfis([perfil], dia);
  const desde = diasAnteriores(dia, 28)[0];
  const [notas, visao, refs, relogio, docs, anterior] = await Promise.all([
    notasDe(perfil).catch(() => ''),
    visaoDe(perfil, dia).catch(() => ''),
    refeicoesDesde(perfil.jids, desde).catch(() => []),
    textoRelogio(perfil).catch(() => null),
    dossieDe(perfil).catch(() => ''),
    colecao('reflexoes').find({ jid: perfil.jids?.[0] }).sort({ dia: -1 }).limit(1).next().catch(() => null),
  ]);
  const padrao = padraoAlimentar(refs, { periodoDias: 28 });
  const texto = await ia.refletirSobrePessoa({
    perfil: comExtras,
    notas,
    visao,
    padrao: padrao.texto,
    lugares: comExtras._lugares?.bloco || '',
    treino: comExtras._treino?.bloco || comExtras.treino || '',
    relogio,
    documentos: String(docs || '').slice(0, 4000),
    anterior: anterior?.texto || '',
    persona,
    dia,
  });
  const limpo = ia.separarAtualizacao(texto).texto?.trim();
  if (!limpo || limpo.length < 200) throw new Error('reflexão vazia ou curta demais');
  const sintese = extrairSintese(limpo);
  await colecao('reflexoes').insertOne({ jid: perfil.jids?.[0], nome: perfil.nome, dia, motivo, texto: limpo, sintese, criadoEm: new Date() });
  await salvarPerfil({ jids: perfil.jids, reflexao: { dia, sintese } });
  const pastaId = await pastaDe(perfil).catch(() => null);
  if (pastaId) {
    const md =
      `---\ntipo: reflexao\npessoa: ${perfil.nome}\natualizado: ${dia}\ntags: [nutribot, pessoa, reflexao]\n---\n\n` +
      `# O que eu penso sobre ${perfil.nome.split(' ')[0]} (${dia})\n\n` +
      `_Texto livre da ${ia.nomeDaBot()}, reescrito aos domingos a partir de tudo que ela sabe: comida, gasto, lugares, treino, sono, jeito de ser. Sem endereços. A versão anterior fica no banco._\n\n` +
      `${limpo}\n`;
    await salvarEmPasta(pastaId, ARQ_REFLEXOES, md).catch((e) => console.error('[reflexao] Drive:', e.message));
  }
  console.log(`[reflexao] ${perfil.nome}: ${limpo.length} chars; síntese: ${sintese.slice(0, 90)}`);
  return { texto: limpo, sintese };
}

/** Todas as pessoas com cadastro completo (uma chamada cada; erro de uma não derruba as outras). */
export async function refletirTodos({ perfis, dia, persona, motivo }) {
  for (const p of perfis.filter((x) => x.onboarded)) {
    try {
      await refletirSobre(p, { dia, persona, motivo });
    } catch (e) {
      console.error(`[reflexao] ${p.nome}:`, e.message);
    }
  }
}

/** Texto do !reflexao: a síntese atual e onde está o texto inteiro. */
export function reflexaoZap(perfil) {
  const r = perfil?.reflexao;
  if (!r?.sintese) return 'Ainda não escrevi minha reflexão sobre você. Ela nasce no fechamento de domingo, ou agora com "!reflexao nova".';
  return `🪞 *Como eu te entendo hoje*\n\n${r.sintese}\n\n_Escrito em ${r.dia.slice(8, 10)}/${r.dia.slice(5, 7)}. O texto inteiro está em ${ARQ_REFLEXOES}, na sua pasta do Drive. "!reflexao nova" reescreve agora._`;
}
