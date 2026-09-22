// dia.js - Memória do dia, daily note no Drive, virada e fechamento do dia (resumo, momentos, gírias, rotina, notas,
// persona), fechamento da semana e a revisão mensal da base de conhecimento.

import { listarPerfis, salvarPerfil, persistirMemoria, salvarPersona, refeicoesDesde, registrarMomentos, momentosRecentes } from './mongo.js';
import { salvarMarkdown, lerMarkdown, registrarLog, frontmatter, mdDiario, mdMomento, mdPerfil } from './drive.js';
import * as ia from './gemini.js';
import { atualizarConhecimento } from './conhecimento.js';
import { dossieDe, notasDe, salvarNotas, salvarFicha } from './pessoas.js';
import { compilarRefeicoes, compilarSemana } from './resumo.js';
import { agora, semanaISO, diaSeguinte, diasAnteriores, ehDomingo } from './util.js';
import { estado } from './estado.js';
import { enviar } from './whatsapp.js';
import { enriquecerPerfis } from './perfis.js';
import { avisarErro } from './avisos.js';

// ============================================================
// Memória do dia (RAM + backup no Mongo) e daily note
// ============================================================
export async function lembrar(entrada) {
  const { memoria } = estado;
  memoria.mensagens.push(entrada);
  if (memoria.mensagens.length > 600) memoria.mensagens.splice(0, memoria.mensagens.length - 600);
  persistirMemoria(memoria).catch((e) => console.error('[memoria] falha ao persistir:', e.message));
  agendarDiario();
}

// Daily note no Drive (Diario/YYYY-MM-DD.md): regerada a partir da memória do dia, no máximo uma escrita a cada 30 s.
const DIARIO_DEBOUNCE_MS = 30_000;
let diarioTimer = null;
let diarioSujo = false;
export function agendarDiario() {
  diarioSujo = true;
  if (diarioTimer) return;
  diarioTimer = setTimeout(() => {
    diarioTimer = null;
    gravarDiario().catch((e) => {
      console.error('[drive] falha ao salvar diário:', e.message);
      if (estado.memoria.grupo) avisarErro(estado.memoria.grupo, 'drive', e.message);
    });
  }, DIARIO_DEBOUNCE_MS);
  diarioTimer.unref?.();
}
export async function gravarDiario(snapshot = estado.memoria) {
  if (!diarioSujo && snapshot === estado.memoria) return;
  diarioSujo = false;
  if (!snapshot.mensagens?.length) return;
  await salvarMarkdown('Diario', `${snapshot.dia}.md`, mdDiario({ dia: snapshot.dia, mensagens: snapshot.mensagens, nomeBot: ia.nomeDaBot() }));
}
export const diarioPendente = () => diarioSujo;

/** Pessoa mudou de nome no perfil (ex.: entrou como número e depois se cadastrou): renomeia no histórico do dia. */
export function renomearNaMemoria(antigo, novo) {
  if (!antigo || !novo || antigo === novo) return 0;
  let n = 0;
  for (const m of estado.memoria.mensagens) if (m.nome === antigo) { m.nome = novo; n++; }
  if (n) {
    persistirMemoria(estado.memoria).catch(() => {});
    agendarDiario();
    console.log(`[memoria] ${n} mensagem(ns) renomeada(s): ${antigo} -> ${novo}`);
  }
  return n;
}

/** No boot: mensagens do dia gravadas com um número no lugar do nome ganham o nome atual do perfil. */
export function normalizarNomesNaMemoria(perfis) {
  for (const p of perfis) {
    const numeros = (p.jids || []).map((j) => j.split('@')[0]).filter((n) => /^\d{6,}$/.test(n));
    for (const num of numeros) renomearNaMemoria(num, p.nome);
  }
}

// ============================================================
// Virada e fechamento do dia
// ============================================================
export async function garantirDiaAtual() {
  // "<" e não "!==": depois do fechamento das 23:59 a memória já aponta pro dia seguinte, e isso não pode disparar outro fechamento
  if (estado.memoria.dia < agora().dia && !estado.fechandoDia) {
    console.log(`[bot] virada de dia detectada (${estado.memoria.dia} -> ${agora().dia}); fechando o dia anterior`);
    await fecharDia({ diaAlvo: estado.memoria.dia });
  }
}

export async function fecharDia({ forcado = false, diaAlvo } = {}) {
  if (estado.fechandoDia) return;
  estado.fechandoDia = true;
  const dia = diaAlvo || estado.memoria.dia;
  const grupo = estado.memoria.grupo;
  try {
    const perfis = await enriquecerPerfis(await listarPerfis(), dia);
    const historico = [...estado.memoria.mensagens];

    if (grupo && (perfis.length || forcado)) {
      const compilado = compilarRefeicoes(historico, perfis);
      console.log(`[resumo] refeições compiladas:\n${compilado.texto}`);
      const resumo = ia.separarAtualizacao(await ia.resumoDiario({ dia, perfis, historico, persona: estado.persona, refeicoes: compilado.texto })).texto || '(sem resumo)';
      await enviar(grupo, `📋 *RESUMO DO DIA ${dia}*\n\n${resumo}`);
      await salvarMarkdown(
        'Resumos',
        `${dia}.md`,
        frontmatter({ tipo: 'resumo-diario', data: dia, tags: ['nutribot', 'resumo'] }) +
          `\n# Resumo do dia ${dia}\n\n${resumo}\n\n---\nConversa completa: [[Diario/${dia}|Diário de ${dia}]]\n`
      );

      // Momentos memoráveis do dia -> memória de longo prazo (Mongo + Perfis/Nutri-Momentos.md, só acrescenta)
      try {
        const momentos = await ia.extrairMomentos({ dia, perfis, historico });
        if (momentos.length) {
          await registrarMomentos(momentos);
          const atual = (await lerMarkdown('Perfis', 'Nutri-Momentos.md').catch(() => null)) || frontmatter({ tipo: 'momentos', tags: ['nutribot', 'momentos'] }) + `\n# Momentos memoráveis\n`;
          await salvarMarkdown('Perfis', 'Nutri-Momentos.md', `${atual.trimEnd()}\n${momentos.map(mdMomento).join('\n')}\n`).catch(() => {});
          console.log(`[momentos] ${momentos.length} registrados`);
        }
      } catch (e) {
        console.error('[momentos] falha:', e.message);
      }

      // Aprende gírias, rotina de cada um e atualiza fichas
      const girias = await ia.extrairGirias({ perfis, historico }).catch(() => ({}));
      for (const p of perfis) {
        const novas = girias[p.nome.toLowerCase()] || [];
        if (novas.length) {
          const conjunto = [...new Set([...(p.girias || []), ...novas])].slice(-15);
          p.girias = conjunto;
          await salvarPerfil({ jids: p.jids, girias: conjunto });
        }
        try {
          const rotina = await ia.atualizarRotina({ perfil: p, refeicoes: p._refs || [], historico, dia });
          if (rotina?.trim()) {
            p.rotina = rotina.trim();
            await salvarPerfil({ jids: p.jids, rotina: p.rotina });
          }
        } catch (e) {
          console.error(`[rotina] falha para ${p.nome}:`, e.message);
        }
        // Notas da Nutri sobre a pessoa (o que ela contou hoje, respostas às perguntas, metas) -> pasta da pessoa no Drive
        try {
          const notasAtuais = await notasDe(p);
          const dossieDocs = (await dossieDe(p)).split('--- Suas notas sobre')[0];
          const notas = await ia.atualizarNotas({ perfil: p, notasAtuais, dossieDocs, historico, dia });
          const encolheuDemais = notasAtuais.trim().length > 300 && (notas?.trim().length || 0) < notasAtuais.trim().length * 0.4;
          if (encolheuDemais) console.warn(`[pessoas] notas de ${p.nome} descartadas: reescrita perdeu mais de 60% do conteúdo`);
          if (notas?.trim() && !encolheuDemais && notas.trim() !== notasAtuais.trim()) {
            await salvarNotas(p, notas, dia);
            p.notas = notas.trim();
            console.log(`[pessoas] notas de ${p.nome} atualizadas`);
          }
        } catch (e) {
          console.error(`[pessoas] falha nas notas de ${p.nome}:`, e.message);
        }
        await salvarFicha(p, mdPerfil(p)).catch(() => {});
      }

      // A Nutri revisa quem ela é: apelidos, piadas internas, padrões e o que afiar amanhã
      try {
        const momentos = await momentosRecentes(30).catch(() => []);
        const nova = await ia.evoluirPersona({ dia, personaAtual: estado.persona, perfis, historico, momentos });
        if (estado.persona.length > 300 && (nova?.trim().length || 0) < estado.persona.length * 0.4) {
          console.warn('[persona] reescrita descartada: perdeu mais de 60% do conteúdo');
        } else if (nova?.trim()) {
          estado.persona = nova.trim();
          await salvarPersona(estado.persona, dia);
          await salvarMarkdown(
            'Perfis',
            'Nutri.md',
            frontmatter({ tipo: 'persona', atualizado: dia, tags: ['nutribot', 'persona'] }) + `\n# ${ia.nomeDaBot()} (memória de personalidade)\n\n${estado.persona}\n\n---\nMomentos memoráveis: [[Nutri-Momentos]]\n`
          ).catch(() => {});
          console.log(`[persona] atualizada (${estado.persona.length} chars)`);
        }
      } catch (e) {
        console.error('[persona] falha ao evoluir:', e.message);
      }

      // Semanal só no fechamento automático de domingo (um !resumo no domingo não pode disparar dois semanais)
      if ((!forcado && ehDomingo(dia)) || (forcado && process.env.FORCAR_SEMANAL === 'true')) {
        await fecharSemana({ dia, perfis, grupo });
      }
    } else {
      console.log('[bot] nada pra resumir hoje (sem grupo ou sem perfis).');
    }

    await registrarLog(dia, `${agora().hora} dia fechado (${historico.length} mensagens)`);
  } catch (e) {
    console.error('[bot] erro ao fechar o dia:', e);
    if (grupo) await avisarErro(grupo, 'resumo', e.message);
  } finally {
    if (forcado) {
      // !resumo no meio do dia: fecha o resumo mas NÃO apaga a memória, senão a tarde começa sem contexto
      agendarDiario();
    } else {
      // Daily note final do dia fechado, depois começa o próximo. Se o cron das 23:59 terminou antes da meia-noite,
      // o próximo dia é "amanhã" (senão a virada às 00:00 fecharia o mesmo dia de novo, com resumo vazio).
      await gravarDiario(estado.memoria).catch(() => {});
      const proximo = agora().dia > dia ? agora().dia : diaSeguinte(dia);
      estado.memoria = { dia: proximo, grupo, mensagens: [], cobrancas: {} };
      diarioSujo = false;
      await persistirMemoria(estado.memoria).catch(() => {});
    }
    estado.fechandoDia = false;
  }
}

export async function fecharSemana({ dia, perfis, grupo }) {
  const semana = semanaISO(dia);
  const dias = diasAnteriores(dia, 7);
  const resumosDiarios = [];
  for (const d of dias) {
    const conteudo = await lerMarkdown('Resumos', `${d}.md`).catch(() => null);
    if (conteudo) resumosDiarios.push({ dia: d, conteudo: conteudo.replace(/^---[\s\S]*?---\n/, '') });
  }
  // Números da semana vêm dos registros (estimativa gravada na hora de cada refeição), não da releitura dos textos
  const todasJids = perfis.flatMap((p) => p.jids || []);
  const registros = await refeicoesDesde(todasJids, dias[0]).catch(() => []);
  const tabela = compilarSemana(registros, perfis, dias);
  console.log(`[semana] tabela:\n${tabela}`);
  const resumo = ia.separarAtualizacao(await ia.resumoSemanal({ semana, perfis, resumosDiarios, persona: estado.persona, tabela })).texto || '(sem resumo)';
  await enviar(grupo, `📆 *RESUMO DA SEMANA ${semana}*\n\n${resumo}`);
  await salvarMarkdown(
    'Resumos',
    `Semana-${semana}.md`,
    frontmatter({ tipo: 'resumo-semanal', semana, tags: ['nutribot', 'resumo', 'semanal'] }) +
      `\n# Semana ${semana}\n\n${resumo}\n\n---\nDias: ${resumosDiarios.map((r) => `[[Resumos/${r.dia}|${r.dia}]]`).join(' · ')}\n`
  );
}

// ============================================================
// Estudo: revisa a base de conhecimento com o que saiu de novo (PubMed)
// ============================================================
let estudando = false;
export async function estudar({ dia, motivo }) {
  if (estudando) return;
  estudando = true;
  try {
    console.log(`[conhecimento] revisando base (${motivo})...`);
    const relatorio = await atualizarConhecimento({ ia, dia });
    const mudou = relatorio.filter((l) => /ATUALIZADO/.test(l));
    console.log('[conhecimento]\n' + relatorio.join('\n'));
    await registrarLog(dia, `revisão da base de conhecimento (${motivo}): ${mudou.length} doc(s) atualizados`);
    if (estado.memoria.grupo && estado.statusConexao === 'conectado') {
      const texto = mudou.length
        ? `📚 Revisei meu material com estudos novos. Atualizei:\n${mudou.join('\n')}\n\nTá tudo no Drive, pasta Conhecimento. Preparem-se, agora eu sei mais. 😈`
        : motivo === 'pedido no grupo'
          ? `📚 Revisei tudo. Nenhuma novidade que mude o que eu já falo pra vocês. Ou seja: a ciência tá tranquila, agora é com a gente. 😉`
          : null;
      if (texto) await enviar(estado.memoria.grupo, texto);
    }
  } finally {
    estudando = false;
  }
}
