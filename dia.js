// dia.js - Memória do dia, daily note no Drive, virada e fechamento do dia (resumo, momentos, gírias, rotina, notas,
// persona), fechamento da semana e a revisão mensal da base de conhecimento.

import { listarPerfis, salvarPerfil, persistirMemoria, salvarPersona, refeicoesDesde, registrarMomentos, momentosRecentes, registrarDiarioNutri, diarioNutriRecente, pesagensDesde, ultimaPesagem, salvarPrevisao, previsaoAberta, marcarPrevisaoConferida } from './mongo.js';
import { salvarMarkdown, lerMarkdown, registrarLog, frontmatter, mdDiario, mdMomento, mdPerfil, salvarNaPasta, comRepeticao, erroPermanenteDrive } from './drive.js';
import { correcoesDoDia, carregarAprendizados, salvarAprendizados, refeicoesDoDia as refeicoesDoDiaBanco, colecao, humorDe, eventosDe } from './mongo.js';
import { caminhoDrive, chavePendente, dadosDoDia, mdDiaPessoa, dadosDaSemana, mdSemanaPessoa, mdDespensa, mdPensamentos, mdConversasApp, mdPlanoSemana } from './drive-pessoa.js';
import { contextoDoTreino } from './api-montadores.js';
import { contestacoesDoDia } from './consciencia.js';
import { compilarRefeicoesDoBanco } from './resumo.js';
import * as ia from './gemini.js';
import { atualizarConhecimento, docsPara } from './conhecimento.js';
import { dossieDe, notasDe, salvarNotas, salvarFicha, pastaDe } from './pessoas.js';
import { compilarRefeicoes, compilarSemana, compilarMes, gastoAdaptativo, placarSemana } from './resumo.js';
import { visaoDe, progressoDe } from './acompanhamento.js';
import { linhaSemanaLugares, ondeMora } from './lugares.js';
import { refletirTodos } from './reflexao.js';
import { fecharPendentes } from './atividades.js';
import { contextoDoDia, contextoDoDiaDeTodos, analiseForca, gerarSugestoesCarga, textoSugestoesCarga } from './contexto.js';
import { preverSemana, conferirPrevisao, linhaDeTendencia } from './previsao.js';
import { tendenciaCompleta } from './tendencia.js';
import { calibrarNoDomingo } from './calibracao.js';
import { proporEtapa, faixaDaMeta, pesoDeReferencia } from './resumo.js';
import { validarPesagens } from './progresso.js';
import { indexarDia } from './memoria_semantica.js';
import { sintetizar } from './voz.js';
import { configGrafico, renderizar } from './graficos.js';
import { agora, semanaISO, diaSeguinte, diasAnteriores, ehDomingo, minutosDe, fusoDe } from './util.js';
import { estado } from './estado.js';
import { enviar, enviarImagem, enviarAudio } from './whatsapp.js';
import { enriquecerPerfis } from './perfis.js';
import { avisarErro, avisarAdmin } from './avisos.js';

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
const MAX_TENTATIVAS_DIARIO = 3;
let falhasDiario = 0;
let diarioTimer = null;
let diarioSujo = false;
export function agendarDiario() {
  diarioSujo = true;
  if (diarioTimer) return;
  diarioTimer = setTimeout(() => {
    diarioTimer = null;
    gravarDiario()
      .then(() => {
        falhasDiario = 0;
      })
      .catch((e) => {
        // 16/10: um timeout só ("The operation was aborted", logo depois de um deploy) virava aviso NO GRUPO. O diário é
        // regerado inteiro a partir da memória, então tenta de novo em 1 min; só depois de 3 falhas seguidas avisa o
        // administrador no privado (aviso de sistema não é assunto do grupo).
        falhasDiario++;
        diarioSujo = true;
        console.error(`[drive] falha ao salvar diário (${falhasDiario}ª seguida):`, e.message);
        if (falhasDiario <= MAX_TENTATIVAS_DIARIO) setTimeout(agendarDiario, 60_000).unref?.();
        if (falhasDiario === MAX_TENTATIVAS_DIARIO) {
          avisarAdmin('drive', `o Drive falhou ${falhasDiario} vezes seguidas ao salvar o diário (${String(e.message).slice(0, 80)}). As mensagens continuam no Mongo; o diário é refeito quando o Drive voltar.`).catch(() => {});
        }
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

/** No boot: marca na memória do dia as mensagens que correspondem a refeições registradas (corrigidas à mão ou não), pelo nome e hora (±3 min). */
export function sincronizarRefeicoesNaMemoria(registros) {
  let n = 0;
  const lista = registros || [];
  for (const r of lista) {
    const alvo = minutosDe(r.hora);
    for (const m of estado.memoria.mensagens) {
      if (m.tipo === 'bot' || m.refeicao || m.nome !== r.nome) continue;
      if (Math.abs(minutosDe(m.hora) - alvo) <= 3) {
        m.refeicao = r.slot;
        n++;
        break;
      }
    }
  }
  // marcação sem registro correspondente (ex.: sugestão que tinha sido registrada e depois apagada): limpa
  for (const m of estado.memoria.mensagens) {
    if (m.tipo === 'bot' || !m.refeicao) continue;
    const temRegistro = lista.some((r) => r.nome === m.nome && Math.abs(minutosDe(r.hora) - minutosDe(m.hora)) <= 3);
    if (!temRegistro) {
      delete m.refeicao;
      n++;
    }
  }
  if (n) {
    persistirMemoria(estado.memoria).catch(() => {});
    agendarDiario();
    console.log(`[memoria] ${n} mensagem(ns) marcada(s) como refeição a partir dos registros`);
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
  // atividade fixa perguntada e sem resposta até o fechamento: não houve (não infla o gasto)
  try {
    for (const p of (await listarPerfis()).filter((x) => x.atividadesPendentes?.length)) await fecharPendentes(p, diaAlvo || agora().dia);
  } catch (e) {
    console.warn('[atividades] pendentes:', e.message);
  }
  if (estado.fechandoDia) return;
  estado.fechandoDia = true;
  const dia = diaAlvo || estado.memoria.dia;
  const grupo = estado.memoria.grupo;
  try {
    const perfis = await enriquecerPerfis(await listarPerfis(), dia);
    const historico = [...estado.memoria.mensagens];

    if (grupo && (perfis.length || forcado)) {
      // números do dia vêm do BANCO (registros já corrigidos, fundidos e apagados); a transcrição é só reserva.
      // Regra do fuso (13/10): o `dia` do registro é o LOCAL de cada pessoa. O resumo do dia D do grupo (23:59 em São Paulo) traz,
      // de cada um, o dia local D dele. Pra quem está à frente do grupo (Heitor em Sofia, Lucas visitando a Europa) esse dia já
      // terminou; o que ele comeu depois da meia-noite local é do dia D+1 e entra no resumo de amanhã (nada some nem conta duas
      // vezes). Pra quem estiver ATRÁS do grupo (Américas do Norte), o fim do dia local dele ainda não aconteceu às 23:59 daqui:
      // isso fica no banco e entra na semana/mês, mas não neste resumo (ninguém do grupo mora atrás hoje).
      const refsDoDia = await refeicoesDoDiaBanco(dia).catch(() => []);
      const compilado = refsDoDia.length ? compilarRefeicoesDoBanco(refsDoDia, perfis, dia) : compilarRefeicoes(historico, perfis);
      // registros apagados/corrigidos durante o dia: os textos noturnos precisam saber que o que foi dito antes está errado
      const correcoes = await correcoesDoDia(dia).catch(() => []);
      if (correcoes.length) {
        compilado.texto += `\n\nCORREÇÕES FEITAS HOJE (depois delas, os totais acima são os certos; o que a conversa disse antes está ERRADO e não pode virar memória, momento, diário nem nota):\n${correcoes.map((c) => `- ${c.texto}`).join('\n')}`;
      }
      console.log(`[resumo] refeições compiladas:\n${compilado.texto}`);
      // Visão de 7/30 dias e balanço energético por pessoa (código): vai pro resumo do dia e pra reflexão da Nutri
      const acompanhamentos = await Promise.all(perfis.map(async (p) => ({ nome: p.nome, texto: await visaoDe(p, dia) })));
      const resultados = acompanhamentos.filter((a) => a.texto).map((a) => `${a.nome}:\n${a.texto}`).join('\n\n');
      const refeicoesTexto = compilado.texto + (resultados ? `\n\nACOMPANHAMENTO POR PESSOA (7/30 dias e balanço energético, calculados pelo sistema):\n${resultados}` : '');
      const resumo = ia.separarAtualizacao(await ia.resumoDiario({ dia, perfis, historico, persona: estado.persona, refeicoes: refeicoesTexto })).texto || '(sem resumo)';
      await enviar(grupo, `📋 *RESUMO DO DIA ${dia}*\n\n${resumo}`);
      await salvarMarkdown(
        'Resumos',
        `${dia}.md`,
        frontmatter({ tipo: 'resumo-diario', data: dia, tags: ['nutribot', 'resumo'] }) +
          `\n# Resumo do dia ${dia}\n\n${resumo}\n\n---\nConversa completa: [[Diario/${dia}|Diário de ${dia}]]\n`
      );

      // Momentos memoráveis do dia -> memória de longo prazo (Mongo + Perfis/Nutri-Momentos.md, só acrescenta)
      let momentosDoDia = [];
      try {
        const contextoTodos = await contextoDoDiaDeTodos(perfis, dia).catch(() => '');
        const momentos = await ia.extrairMomentos({ dia, perfis, historico, refeicoes: compilado.texto, contexto: contextoTodos });
        momentosDoDia = momentos;
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
          // ficha que termina no meio da frase (saída cortada) não substitui a anterior
          if (rotina?.trim() && /[.!?)"»]$/.test(rotina.trim())) {
            p.rotina = rotina.trim();
            await salvarPerfil({ jids: p.jids, rotina: p.rotina });
          } else if (rotina?.trim()) {
            console.warn(`[rotina] ${p.nome}: texto novo parece cortado ("...${rotina.trim().slice(-40)}"); mantendo a ficha anterior`);
          }
        } catch (e) {
          console.error(`[rotina] falha para ${p.nome}:`, e.message);
        }
        // Notas da Nutri sobre a pessoa (o que ela contou hoje, respostas às perguntas, metas) -> pasta da pessoa no Drive
        try {
          const notasAtuais = await notasDe(p);
          const dossieDocs = (await dossieDe(p)).split('--- Suas notas sobre')[0];
          // o bairro de casa pela localização entra no contexto: a reescrita noturna não pode voltar a copiar o do PDF antigo
          const notas = await ia.atualizarNotas({ perfil: p, notasAtuais, dossieDocs, historico, dia, refeicoes: compilado.texto, contexto: [await contextoDoDia(p, dia).catch(() => ''), ondeMora(p)].filter(Boolean).join('\n') });
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

      // Diário pessoal dela (só acrescenta): Mongo + Perfis/Nutri-Diario.md
      let entradaDiario = '';
      try {
        let entrada = (await ia.diarioDaNutri({ dia, perfis, historico, personaAtual: estado.persona, resultados, refeicoes: compilado.texto, contexto: await contextoDoDiaDeTodos(perfis, dia).catch(() => '') }))?.trim();
        // rede de segurança: nenhum texto gravado pode ser a palavra de silêncio do papo (já aconteceu com o modelo leve)
        if (entrada && /^sil[êe]ncio\W*$/i.test(entrada)) {
          console.warn('[diario-nutri] modelo devolveu "SILENCIO" no lugar do diário; descartado');
          entrada = '';
        }
        entradaDiario = entrada || '';
        if (entrada) {
          await registrarDiarioNutri({ dia, texto: entrada });
          const atual = (await lerMarkdown('Perfis', 'Nutri-Diario.md').catch(() => null)) || frontmatter({ tipo: 'diario-nutri', tags: ['nutribot', 'diario-nutri'] }) + `\n# Diário da ${ia.nomeDaBot()}\n`;
          await salvarMarkdown('Perfis', 'Nutri-Diario.md', `${atual.trimEnd()}\n\n## ${dia}\n${entrada}\n`).catch(() => {});
          console.log(`[diario-nutri] entrada de ${dia} gravada (${entrada.length} chars)`);
        }
      } catch (e) {
        console.error('[diario-nutri] falha:', e.message);
      }

      // Caderno de aprendizado: correções, contestações e autocrítica do dia viram lições com causa e regra (com raciocínio
      // ligado), e as regras ativas entram no prompt de toda resposta. Só chama a IA quando houve evidência nova.
      try {
        const contestacoes = contestacoesDoDia(historico);
        if (correcoes.length || contestacoes.length) {
          const atual = await carregarAprendizados().catch(() => null);
          const r = await ia.revisarErros({ dia, documentoAtual: atual?.documento || '', correcoes, contestacoes, diario: entradaDiario, refeicoes: compilado.texto });
          if (r?.documento?.trim()) {
            await salvarAprendizados({ documento: r.documento.trim(), regras: r.regras, dia });
            ia.definirLicoes(r.regras);
            await salvarMarkdown(
              'Perfis',
              'Nutri-Aprendizados.md',
              frontmatter({ tipo: 'aprendizados', atualizado: dia, tags: ['nutribot', 'aprendizados'] }) +
                `\n# Caderno de aprendizado da ${ia.nomeDaBot()}\n\n${r.documento.trim()}\n\n## Regras ativas (entram em toda resposta)\n${r.regras.map((x) => `- ${x}`).join('\n')}\n`
            ).catch(() => {});
            console.log(`[aprendizado] caderno atualizado: ${r.regras.length} regras ativas (${correcoes.length} correções, ${contestacoes.length} contestações)`);
          }
        }
      } catch (e) {
        console.error('[aprendizado] falha:', e.message);
      }

      // Memória de longo prazo por significado (Atlas Vector Search): o que cada um disse, o resumo, os momentos e o diário
      await indexarDia({ dia, perfis, historico, resumo, momentos: momentosDoDia, diario: entradaDiario, falasDe: ia.falasDe }).catch((e) => console.error('[memoria]', e.message));

      // A Nutri revisa quem ela é: apelidos, favoritos, implicâncias, padrões, opiniões e o que afiar amanhã
      try {
        const momentos = await momentosRecentes(30).catch(() => []);
        const diario = await diarioNutriRecente(3).catch(() => []);
        const nova = await ia.evoluirPersona({ dia, personaAtual: estado.persona, perfis, historico, momentos, diario, refeicoes: compilado.texto });
        if (estado.persona.length > 300 && (nova?.trim().length || 0) < estado.persona.length * 0.4) {
          console.warn('[persona] reescrita descartada: perdeu mais de 60% do conteúdo');
        } else if (nova?.trim()) {
          // linha oculta de conversa (ATUALIZAR {...}, NOTA, DESPENSA...) não é memória: o modelo às vezes copia o hábito pra cá
          estado.persona = nova.replace(/^[ \t]*(ATUALIZAR|NOTA|DESPENSA|ATIVIDADE|ADIAR|PESQUISAR|PRODUTO)[ \t]*:.*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
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
        // caderno livre sobre cada pessoa (Nutri-Reflexoes.md): depois da semana fechada, com os números da semana já prontos
        await refletirTodos({ perfis, dia, persona: estado.persona, motivo: 'domingo' }).catch((e) => console.error('[reflexao]', e.message));
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
    // espelho de cada pessoa no Drive (fase 7): em segundo plano, depois de tudo (o semanal já gravou sugestões e apostas).
    // Não espera nem lança: o fechamento do dia não depende do Drive. !resumo no meio do dia não grava (o dia não acabou).
    if (!forcado) espelharPessoasNoDrive({ dia }).catch((e) => console.error('[drive-pessoa] espelho do dia:', e.message));
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

  // Aposta da semana: confere a previsão do domingo passado e faz a do próximo (tudo calculado em código)
  const previsoes = [];
  for (const p of perfis) {
    const jids = p.jids || [];
    if (!jids.length) continue;
    const linhas = [];
    const refs30 = await refeicoesDesde(jids, diasAnteriores(dia, 30)[0]).catch(() => []);
    const pes30 = await pesagensDesde(jids, diasAnteriores(dia, 30)[0]).catch(() => []);
    try {
      const anterior = await previsaoAberta(jids, dia);
      if (anterior) {
        const conf = conferirPrevisao({ previsao: anterior, pesagens: pes30, dia });
        if (conf) {
          linhas.push(conf.texto);
          await marcarPrevisaoConferida(anterior._id, { realKg: conf.realKg ?? null, erroKg: conf.erroKg ?? null, acerto: conf.acerto || 'sem pesagem' }).catch(() => {});
          console.log(`[previsao] ${p.nome}: ${conf.acerto || 'sem pesagem'} (previu ${anterior.deltaKg?.toFixed?.(2)} kg, deu ${conf.realKg?.toFixed?.(2) ?? '?'} kg)`);
        }
      }
      // a análise vem ANTES da aposta: a aposta usa o mesmo viés registro x balança do !progresso (preverSemana)
      const analise = await progressoDe(p, dia, { refeicoes: refs30, pesagens: pes30 });
      const nova = preverSemana({ perfil: p, refeicoes: refs30, pesagens: pes30, gastos: p.relogio?.gastos, dia, analise });
      if (nova) linhas.push(nova.texto);
      // o RITMO é julgado pelo que a balança MEDIU (progresso.js), nunca pela aposta: até 04/10 a aposta feita pela comida
      // (+0,79 kg/semana) passava por avaliarRitmo e virava "RÁPIDO DEMAIS, ~450 kcal/dia a menos" com a balança marcando
      // −0,3 kg na semana, e projetarMeta repetia a aposta como se fosse o ritmo. Vai mesmo sem aposta (semana sem pesagem
      // perto do domingo ainda tem 30 dias de pesagens); a projeção até a etapa vem da linha de tendência, que parte da balança.
      if (analise?.tendencia?.n) linhas.push(analise.texto);
      if (nova) {
        if (!nova.semDados) {
          // linha de tendência pessoal (bioimpedância) contra o ritmo alvo: a resposta de "está no caminho?" vem pronta
          try {
            const pes60 = await pesagensDesde(jids, diasAnteriores(dia, 60)[0]).catch(() => pes30);
            const faixa = faixaDaMeta(p, dia, pes60);
            // linha completa (passado por semana cruzando comida, gasto, treino e sono; futuro semana a semana até a etapa; chegada)
            const tend = (await tendenciaCompleta(p, dia).catch(() => null)) || linhaDeTendencia({ pesagens: pes60, perfil: p, dia, alvoKgSemana: faixa?.ritmoKgSemana ?? null });
            if (tend) linhas.push(tend.texto);
            // calibração: o que a semana fechada ensinou sobre o viés comida registrada x balança (progressivo, nunca por um
            // dia). Segue alimentando a correção do balanço na projeção; o número não vai pro resumo porque o PROGRESSO já traz
            // o viés medido agora, com intervalo (dois números pro mesmo viés confundem)
            if (tend?.semanas) await calibrarNoDomingo(p, dia, { semanas: tend.semanas, ritmoReal: tend.ritmo?.real ?? null }).catch(() => null);
            const forca = await analiseForca(p, dia, { magraSem: tend?.magraSem ?? null }).catch(() => null);
            if (forca?.texto) linhas.push(forca.texto);
            // ciclo das sugestões de carga: fecha as da semana passada com resultado e, se a leitura permitir, propõe as novas
            if (forca?.prog) {
              const antigas = (forca.sugestoes || []).filter((s) => s.status !== 'encerrada');
              if (antigas.length) {
                const batidas = antigas.filter((s) => s.status === 'batida');
                const naoFez = antigas.filter((s) => s.status === 'aberta');
                const tentou = antigas.filter((s) => s.status === 'tentando');
                linhas.push(`RESULTADO DAS SUGESTÕES DE CARGA DA SEMANA PASSADA: ${batidas.length} de ${antigas.length} batida(s)${batidas.length ? ` (${batidas.map((s) => `${s.exercicio} ${s.como}`).join('; ')})` : ''}${tentou.length ? `; tentou sem subir: ${tentou.map((s) => s.exercicio).join(', ')}` : ''}${naoFez.length ? `; não fez o exercício: ${naoFez.map((s) => s.exercicio).join(', ')}` : ''}. Comemore o que bateu; no que não subiu, leia o motivo pelo bloco FORÇA x RECUPERAÇÃO (sono, comida) em vez de cobrar.`);
              }
              let sugestoes = antigas.map((s) => ({ ...s, status: 'encerrada', encerradaEm: dia }));
              if (forca.podePuxar) {
                const novas = gerarSugestoesCarga(forca.prog.parados, { dia, max: 3 });
                if (novas.length) {
                  sugestoes = [...sugestoes.slice(-12), ...novas];
                  linhas.push(`SUGESTÕES DE CARGA PARA ESTA SEMANA (a leitura permite: sono, comida e massa magra em dia; anuncie como meta da semana, uma mudança por exercício):\n${novas.map((s) => `- ${s.exercicio}: de ${String(s.deKg).replace('.', ',')} kg×${s.deReps} para ${String(s.paraKg).replace('.', ',')} kg (ou ${s.paraReps} repetições com ${String(s.deKg).replace('.', ',')} kg)`).join('\n')}`);
                  console.log(`[carga] ${p.nome}: ${novas.length} sugestão(ões) de carga pra semana`);
                }
              } else if (forca.prog.parados.length) linhas.push('SEM SUGESTÃO DE CARGA ESTA SEMANA: há exercícios parados, mas a leitura pede recuperação ou comida antes de puxar; diga isso com os números.');
              if (antigas.length || sugestoes.length !== (p.sugestoesCarga || []).length) await salvarPerfil({ jids: p.jids, sugestoesCarga: sugestoes }).catch(() => {});
            }
          } catch (e) {
            console.warn('[tendencia]', e.message);
          }
          // meta-etapa batida (sem teto): sobe o degrau e avisa; o ganho continua no ritmo saudável. Pelo peso de referência
          // suavizado (o mesmo da faixa da meta: tendência, média de 7 dias ou última), não pela pesagem do domingo, que pode
          // ser água: um pico perto da etapa subia o degrau com a linha de tendência dizendo que ainda faltava mais de 1 kg
          const pesoRef = pesoDeReferencia(validarPesagens(pes30, { dia }).pontos, dia, p).peso;
          if (p.metaModo === 'etapa' && p.metaPeso && pesoRef) {
            const ganho = /hipertrof|ganh|massa|bulk|for[çc]a/i.test(String(p.objetivo || ''));
            const bateu = ganho ? pesoRef >= p.metaPeso - 0.3 : pesoRef <= p.metaPeso + 0.3;
            if (bateu) {
              const prox = proporEtapa({ peso: pesoRef, ganho, dia });
              if (prox) {
                await salvarPerfil({ jids: p.jids, metaPeso: prox.metaPeso, metaPrazo: prox.metaPrazo, atualizacoes: { ...(p.atualizacoes || {}), metaPeso: dia } }).catch(() => {});
                linhas.push(`ETAPA BATIDA: ${String(p.metaPeso).replace('.', ',')} kg. Próxima etapa definida pelo sistema: ${prox.metaPeso} kg até ${prox.metaPrazo} (~${prox.semanas} semanas no ritmo saudável). Anuncie no resumo como conquista e apresente a próxima.`);
                console.log(`[meta] ${p.nome}: etapa ${p.metaPeso} kg batida; próxima ${prox.metaPeso} kg até ${prox.metaPrazo}`);
              }
            }
          }
          await salvarPrevisao({ jid: jids[0], nome: p.nome, feitaEm: dia, alvoDia: nova.alvoDia, pesoInicial: nova.pesoInicial, diaInicial: nova.diaInicial, deltaKg: nova.deltaKg, pesoPrevisto: nova.pesoPrevisto, magraKg: nova.magraKg, gorduraKg: nova.gorduraKg, base: nova.base, confianca: nova.confianca }).catch((e) => console.error('[previsao] falha ao salvar:', e.message));
          console.log(`[previsao] ${p.nome}: ${nova.texto.slice(0, 120)}`);
        }
      }
    } catch (e) {
      console.error(`[previsao] falha para ${p.nome}:`, e.message);
    }
    if (p._treino?.bloco) linhas.push(p._treino.bloco);
    const lugaresSemana = await linhaSemanaLugares(p).catch(() => null);
    if (lugaresSemana) linhas.push(lugaresSemana);
    if (linhas.length) previsoes.push(`${p.nome}:\n${linhas.join('\n')}`);
  }
  const blocoPrevisoes = previsoes.join('\n\n');

  // a base de conhecimento entra aqui pra ela julgar o ritmo com a faixa recomendada (0,25-0,5%/semana pra ganho etc.)
  const conhecimentoSemana = docsPara(perfis, { texto: 'ritmo de ganho e perda de peso por semana superávit déficit proteína' });
  const resumo = ia.separarAtualizacao(await ia.resumoSemanal({ semana, perfis, resumosDiarios, persona: estado.persona, tabela, previsoes: blocoPrevisoes, conhecimento: conhecimentoSemana })).texto || '(sem resumo)';
  await enviar(grupo, `📆 *RESUMO DA SEMANA ${semana}*\n\n${resumo}`);
  // Gráfico de 30 dias por pessoa (calorias, gasto do relógio, meta e peso), pra quem já tem registro
  for (const p of perfis) {
    try {
      const desde = diasAnteriores(dia, 30)[0];
      const [refs, pes] = await Promise.all([refeicoesDesde(p.jids || [], desde).catch(() => []), pesagensDesde(p.jids || [], desde).catch(() => [])]);
      if (refs.length + pes.length < 5) continue;
      const alvo = gastoAdaptativo({ refeicoes: refs, pesagens: pes, perfil: p, dia, gastos: p.relogio?.gastos }).alvo;
      const png = await renderizar(configGrafico({ nome: p.nome, refeicoes: refs, pesagens: pes, gastos: p.relogio?.gastos, alvo, dia }));
      if (png) await enviarImagem(grupo, png, `📈 *${p.apelido || p.nome.split(' ')[0]}* · últimos 30 dias${alvo ? ` · meta ${alvo.min} a ${alvo.max} kcal/dia` : ''}`);
    } catch (e) {
      console.error('[semana] gráfico:', e.message);
    }
  }
  await salvarMarkdown(
    'Resumos',
    `Semana-${semana}.md`,
    frontmatter({ tipo: 'resumo-semanal', semana, tags: ['nutribot', 'resumo', 'semanal'] }) +
      `\n# Semana ${semana}\n\n${resumo}\n\n---\nDias: ${resumosDiarios.map((r) => `[[Resumos/${r.dia}|${r.dia}]]`).join(' · ')}\n`
  );
}

// ============================================================
// Drive por pessoa (fase 7, seção 4C do mapa): o dia inteiro de cada um (Dias/AAAA-MM/AAAA-MM-DD.md), a despensa, os
// pensamentos e as conversas do app do mês, os planos da semana e, no domingo, a semana. O Mongo é a fonte e o Drive é o
// espelho (o dono lê; backup); a IA não lê nada disso de volta (pessoas.js ignora). Nenhuma chamada de IA aqui.
// Resistente a falha: cada arquivo é uma tarefa; erro numa tarefa ou numa pessoa não para as outras nem o fechamento, e o
// que falhou vira marca em `drive_pendentes` ({ _id: jid|tipo|ref, jid, nome, tipo, ref, dia, tentativas, ultimoErro }),
// refeita do Mongo no próximo espelho (o conteúdo é sempre remontado, nunca guardado). Desiste depois de 10 tentativas ou
// 30 dias, com aviso no log.
// ============================================================
const DRIVE_PENDENTES = 'drive_pendentes';
const MAX_TENTATIVAS_PENDENTE = 10;
const PRAZO_PENDENTE_MS = 30 * 86400_000;
const isoMenos = (dia, dias) => new Date(Date.parse(`${dia}T12:00:00Z`) - dias * 86400_000).toISOString();
let espelhando = false;

/**
 * As perguntas feitas no app pela pessoa desde `desde` (AAAA-MM-DD, comparado com o dia local da troca), pelo contrato de
 * perguntas.js da frente A (`perguntasDe(jids, { desde, n })`, da mais antiga pra mais nova). perguntasDe devolve no máximo
 * as 200 mais recentes: se veio cheio (um mês movimentado), lê a coleção `perguntas_app` direto, sem teto, pro arquivo do
 * mês não perder as primeiras. Sem o módulo, também lê direto.
 */
const TETO_PERGUNTAS_DE = 200;
async function perguntasDoApp(perfil, desde) {
  const jids = perfil.jids || [];
  if (!jids.length) return [];
  try {
    const m = await import('./perguntas.js');
    if (typeof m.perguntasDe === 'function') {
      const lista = await m.perguntasDe(jids, { desde, n: TETO_PERGUNTAS_DE });
      if (Array.isArray(lista) && lista.length < TETO_PERGUNTAS_DE) return lista;
    }
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') console.warn('[drive-pessoa] perguntas do app:', e.message);
  }
  return colecao('perguntas_app').find({ jid: { $in: jids }, dia: { $gte: desde } }).sort({ em: 1 }).toArray();
}

/** Tudo do dia de uma pessoa, das coleções que já existem, no formato de drive-pessoa.dadosDoDia. Lança se o Mongo falhar. */
async function dadosDoDiaDe(perfil, dia) {
  const jids = perfil.jids || [];
  const doJid = { $in: jids };
  const [refeicoes, pesagens35, pesagens, humor, eventos, correcoes, perguntas, saude, treinos, catalogo, pensamentos, despensa, habitos, falas] = await Promise.all([
    refeicoesDesde(jids, diasAnteriores(dia, 35)[0], dia),
    pesagensDesde(jids, diasAnteriores(dia, 35)[0], dia),
    colecao('pesagens').find({ jid: doJid, dia }).toArray(), // todas as do dia, com a fonte (inclusive as descartadas)
    humorDe(jids, dia, dia),
    eventosDe(jids, dia, dia),
    correcoesDoDia(dia),
    perguntasDoApp(perfil, dia),
    colecao('saude_relogio').findOne({ _id: jids[0] }),
    // 8 semanas de treinos: a carga sugerida do dia sai do histórico do exercício (o start_time do Hevy é UTC: 1 dia a mais)
    colecao('treinos').find({ jid: doJid, inicio: { $gte: isoMenos(dia, 57), $lte: `${diaSeguinte(dia)}T23:59:59.999Z` } }).toArray(),
    colecao('hevy_exercicios').findOne({ _id: 'catalogo' }).then((d) => d?.mapa || {}).catch(() => ({})),
    colecao('pensamentos').find({ jid: doJid, dia }).project({ investigacao: 0, sinais: 0, assinatura: 0 }).toArray(),
    colecao('despensa').find({ jid: doJid, $or: [{ compradoEm: dia }, { acabouEm: dia }] }).toArray(),
    colecao('habitos').findOne({ jid: doJid, dia }),
    colecao('falas').find({ dia }).sort({ em: 1 }).toArray(),
  ]);
  let meta = null;
  let contextoTreino = {};
  try {
    meta = gastoAdaptativo({ refeicoes, pesagens: pesagens35, perfil, dia, gastos: perfil.relogio?.gastos }).alvo || null;
  } catch (e) {
    console.warn(`[drive-pessoa] meta de ${perfil.nome}:`, e.message);
  }
  try {
    contextoTreino = contextoDoTreino({ perfil, dia, refeicoes, pesagens: pesagens35, saude });
  } catch {
    contextoTreino = {};
  }
  return dadosDoDia({ perfil, dia, refeicoes, pesagens, humor: humor[0] || null, eventos, correcoes, perguntas, saude, treinos: treinos.filter((t) => t?.inicio), catalogo, contextoTreino, pensamentos, despensa, habitos, falas, meta });
}

/** A semana que termina no domingo `dia`, no formato de drive-pessoa.dadosDaSemana. */
async function dadosDaSemanaDe(perfil, dia) {
  const jids = perfil.jids || [];
  const doJid = { $in: jids };
  const dias = diasAnteriores(dia, 7);
  const domingoAnterior = diasAnteriores(dia, 8)[0];
  const [refeicoes, pesagens, saude, humor, perguntas, previsaoNova, previsaoConferida] = await Promise.all([
    refeicoesDesde(jids, dias[0], dia),
    pesagensDesde(jids, dias[0], dia),
    colecao('saude_relogio').findOne({ _id: jids[0] }),
    humorDe(jids, dias[0], dia),
    perguntasDoApp(perfil, dias[0]),
    colecao('previsoes').findOne({ jid: doJid, feitaEm: dia }),
    colecao('previsoes').findOne({ jid: doJid, conferida: true, $or: [{ feitaEm: domingoAnterior }, { alvoDia: { $gte: dias[0], $lte: dia } }] }),
  ]);
  return dadosDaSemana({ perfil, dia, refeicoes, pesagens, saude, humor, perguntas, previsaoNova, previsaoConferida, sugestoes: perfil.sugestoesCarga || [] });
}

/** Monta o conteúdo de uma tarefa do espelho a partir do Mongo. tarefa = { tipo, ref, dia }. */
async function conteudoDaTarefa(perfil, tarefa) {
  const jids = perfil.jids || [];
  const doJid = { $in: jids };
  const { tipo, ref, dia } = tarefa;
  if (tipo === 'dia') return mdDiaPessoa(await dadosDoDiaDe(perfil, ref));
  if (tipo === 'semana') return mdSemanaPessoa(await dadosDaSemanaDe(perfil, dia));
  if (tipo === 'despensa') {
    // é o estado ATUAL (sobrescreve): mesmo uma pendência antiga grava o de agora
    const hoje = agora(fusoDe(perfil)).dia;
    const [itens, compras] = await Promise.all([colecao('despensa').find({ jid: doJid }).toArray(), colecao('notas').find({ jid: doJid, dia: { $gte: diasAnteriores(hoje, 28)[0] } }).toArray()]);
    return mdDespensa({ nome: perfil.nome, dia: hoje, itens, compras });
  }
  if (tipo === 'pensamentos') {
    const pensamentos = await colecao('pensamentos').find({ jid: doJid, dia: { $gte: `${ref}-01`, $lte: `${ref}-31` } }).project({ investigacao: 0, sinais: 0, assinatura: 0 }).toArray();
    return mdPensamentos({ nome: perfil.nome, mes: ref, pensamentos });
  }
  if (tipo === 'conversas') return mdConversasApp({ nome: perfil.nome, mes: ref, perguntas: await perguntasDoApp(perfil, `${ref}-01`), fuso: fusoDe(perfil) });
  if (tipo === 'plano') {
    const planos = await colecao('planos').find({ jid: doJid, semana: ref }).sort({ criadoEm: 1 }).toArray();
    return mdPlanoSemana({ nome: perfil.nome, semana: ref, planos });
  }
  throw new Error(`tarefa desconhecida: ${tipo}`);
}

/** As tarefas da noite de uma pessoa: o dia, o anterior se o relógio mandou dado depois que ele acabou, despensa, mês, planos novos, semana no domingo. */
async function tarefasDaNoite(perfil, dia) {
  const jids = perfil.jids || [];
  const mes = dia.slice(0, 7);
  const tarefas = [{ tipo: 'dia', ref: dia, dia }];
  // dado atrasado do relógio (passos e gasto do dia anterior chegam na sincronização da manhã seguinte): regrava ontem
  const ontem = diasAnteriores(dia, 2)[0];
  const saude = await colecao('saude_relogio').findOne({ _id: jids[0] }, { projection: { ultimoEnvio: 1 } }).catch(() => null);
  if (saude?.ultimoEnvio && new Date(saude.ultimoEnvio).toLocaleString('sv-SE', { timeZone: fusoDe(perfil) }).slice(0, 10) > ontem) tarefas.push({ tipo: 'dia', ref: ontem, dia: ontem });
  // pensamentos e conversas do app: o mês inteiro é remontado do Mongo e sobrescrito (repetir não duplica nada). O
  // fechamento das 23:59 é do dia que acabou, então o último dia do mês fecha o arquivo daquele mês.
  tarefas.push({ tipo: 'despensa', ref: 'atual', dia }, { tipo: 'pensamentos', ref: mes, dia }, { tipo: 'conversas', ref: mes, dia });
  // planos gerados nas últimas 48 h (pelo WhatsApp ou pelo app, D13): cada semana vira Planos/AAAA-Www.md
  const planos = await colecao('planos').find({ jid: { $in: jids }, criadoEm: { $gte: new Date(Date.now() - 48 * 3600_000) } }).project({ semana: 1, criadoEm: 1 }).toArray().catch(() => []);
  for (const s of new Set(planos.map((p) => p.semana || semanaISO(new Date(p.criadoEm).toISOString().slice(0, 10))))) tarefas.push({ tipo: 'plano', ref: s, dia });
  if (ehDomingo(dia)) tarefas.push({ tipo: 'semana', ref: semanaISO(dia), dia });
  return tarefas;
}

async function marcarPendente(perfil, tarefa, erro) {
  const jid = perfil.jids?.[0];
  if (!jid) return;
  const _id = chavePendente({ jid, tipo: tarefa.tipo, ref: tarefa.ref });
  await colecao(DRIVE_PENDENTES)
    .updateOne(
      { _id },
      { $set: { jid, nome: perfil.nome, tipo: tarefa.tipo, ref: tarefa.ref, dia: tarefa.dia || null, ultimoErro: String(erro?.message || erro || '').slice(0, 200), atualizadoEm: new Date() }, $inc: { tentativas: 1 }, $setOnInsert: { criadoEm: new Date() } },
      { upsert: true }
    )
    .catch((e) => console.error('[drive-pessoa] não consegui marcar a pendência:', e.message));
}
const limparPendente = (perfil, tarefa) => colecao(DRIVE_PENDENTES).deleteOne({ _id: chavePendente({ jid: perfil.jids?.[0], tipo: tarefa.tipo, ref: tarefa.ref }) }).catch(() => {});

/**
 * Espelho de cada pessoa no Drive. Com `dia`: as tarefas da noite (tarefasDaNoite) mais as pendentes; sem `dia`: só as
 * pendentes (pra quem quiser chamar no boot). Uma pessoa por vez, um arquivo por vez; nunca lança.
 * @returns {Promise<{ gravados: number, pendentes: number }>}
 */
export async function espelharPessoasNoDrive({ dia = null } = {}) {
  const vazio = { gravados: 0, pendentes: 0 };
  if (!(process.env.DRIVE_FOLDER_ID || '').trim()) return vazio;
  if (espelhando) return vazio;
  espelhando = true;
  let gravados = 0;
  let pendentes = 0;
  try {
    // perfis de novo do banco: o semanal acabou de gravar sugestões de carga e a atividade fixa pendente foi fechada
    const perfis = (await listarPerfis()).filter((p) => p.jids?.length);
    const porPessoa = new Map(perfis.map((p) => [p.jids[0], { perfil: p, tarefas: new Map() }]));
    const juntar = (jid, t) => {
      const alvo = porPessoa.get(jid);
      if (alvo) alvo.tarefas.set(chavePendente({ jid, tipo: t.tipo, ref: t.ref }), t);
    };
    // o que ficou de noites anteriores vem primeiro (tarefa repetida hoje vira uma só)
    const antigas = await colecao(DRIVE_PENDENTES).find({}).sort({ criadoEm: 1 }).limit(100).toArray().catch(() => []);
    for (const p of antigas) {
      const velha = Date.now() - new Date(p.criadoEm || 0).getTime() > PRAZO_PENDENTE_MS;
      if ((p.tentativas || 0) >= MAX_TENTATIVAS_PENDENTE || velha || !porPessoa.has(p.jid)) {
        console.warn(`[drive-pessoa] desisti de ${p.tipo} ${p.ref} de ${p.nome || p.jid} (${p.tentativas || 0} tentativa(s); último erro: ${p.ultimoErro || '?'})`);
        await colecao(DRIVE_PENDENTES).deleteOne({ _id: p._id }).catch(() => {});
        continue;
      }
      juntar(p.jid, { tipo: p.tipo, ref: p.ref, dia: p.dia || p.ref });
    }
    if (dia) {
      for (const { perfil } of porPessoa.values()) {
        for (const t of await tarefasDaNoite(perfil, dia).catch((e) => (console.warn(`[drive-pessoa] tarefas de ${perfil.nome}:`, e.message), [{ tipo: 'dia', ref: dia, dia }]))) juntar(perfil.jids[0], t);
      }
    }
    let travado = null; // erro permanente (credencial, cota): não adianta tentar o resto agora
    for (const { perfil, tarefas } of porPessoa.values()) {
      if (!tarefas.size) continue;
      // o dia primeiro (é o arquivo que mais importa), depois o resto na ordem
      const lista = [...tarefas.values()].sort((a, b) => Number(b.tipo === 'dia') - Number(a.tipo === 'dia'));
      let pastaId = null;
      if (!travado) {
        try {
          pastaId = await comRepeticao(() => pastaDe(perfil));
        } catch (e) {
          console.error(`[drive-pessoa] pasta de ${perfil.nome}:`, e.message);
          if (erroPermanenteDrive(e)) travado = e;
          for (const t of lista) await marcarPendente(perfil, t, e);
          pendentes += lista.length;
          continue;
        }
      }
      for (const t of lista) {
        if (travado) {
          await marcarPendente(perfil, t, travado);
          pendentes++;
          continue;
        }
        try {
          const conteudo = await conteudoDaTarefa(perfil, t);
          const { pasta, arquivo } = caminhoDrive(t.tipo, t.ref);
          await salvarNaPasta(pastaId, pasta, arquivo, conteudo);
          await limparPendente(perfil, t);
          gravados++;
        } catch (e) {
          console.error(`[drive-pessoa] ${t.tipo} ${t.ref} de ${perfil.nome}:`, e.message);
          if (erroPermanenteDrive(e)) travado = e;
          await marcarPendente(perfil, t, e);
          pendentes++;
        }
      }
    }
    if (gravados || pendentes) {
      console.log(`[drive-pessoa] ${gravados} arquivo(s) gravado(s)${pendentes ? `, ${pendentes} pendente(s) pra próxima noite` : ''}`);
      await registrarLog(dia || agora().dia, `${agora().hora} espelho das pessoas no Drive: ${gravados} arquivo(s)${pendentes ? `, ${pendentes} pendente(s)` : ''}`).catch(() => {});
    }
  } catch (e) {
    console.error('[drive-pessoa] espelho falhou:', e.message);
  } finally {
    espelhando = false;
  }
  return { gravados, pendentes };
}

/** Só as pendências do espelho (boot ou um cron de repescagem). Nunca lança. */
export const repetirPendentesDrive = () => espelharPessoasNoDrive({ dia: null });

// ============================================================
// Notas de voz programadas: segunda de manhã (abrir a semana) e sexta à tarde (fechar a semana), no personagem.
// Se a síntese falhar, vai em texto. Desligáveis com !voz off.
// ============================================================
export async function falaProgramada(tipo) {
  const grupo = estado.memoria.grupo;
  if (!grupo || estado.statusConexao !== 'conectado' || estado.config.vozLigada === false) return;
  const dia = agora().dia;
  const perfis = await enriquecerPerfis(await listarPerfis().catch(() => []), dia);
  if (!perfis.length) return;
  const dias = diasAnteriores(dia, 7);
  const registros = await refeicoesDesde(perfis.flatMap((p) => p.jids || []), dias[0]).catch(() => []);
  // comidas que apareceram na semana, por pessoa (descrições distintas, curtas), pra ela citar pratos de verdade
  const comidas = perfis
    .map((p) => {
      const minhas = registros.filter((r) => (p.jids || []).includes(r.jid));
      const vistas = [...new Set(minhas.map((r) => String(r.descricao || r.resumo || '').split(/[,;(]/)[0].trim().toLowerCase()).filter((t) => t && t.length > 3 && !t.startsWith('[')))].slice(0, 10);
      return `${p.nome.split(' ')[0]}: ${vistas.join(', ') || 'nada registrado'}`;
    })
    .join('\n');
  const dados = `${compilarSemana(registros, perfis, dias)}\n\nCOMIDAS QUE APARECERAM:\n${comidas}\n\nPLACAR:\n${placarSemana(registros, perfis, dias)}`;
  const texto = ia.separarAtualizacao(await ia.falaProgramada({ tipo, perfis, dados, persona: estado.persona, dia })).texto;
  if (!texto) return;
  let audio = true;
  try {
    await enviarAudio(grupo, await sintetizar(texto));
    console.log(`[voz] nota de voz de ${tipo} enviada (${texto.length} chars)`);
  } catch (e) {
    console.warn(`[voz] ${tipo} sem áudio, indo em texto:`, e.message);
    audio = false;
    await enviar(grupo, texto);
  }
  // D20: o texto da nota de voz fica guardado (coleção `falas`) pro app (/resumos) e pro arquivo do dia no Drive.
  // Foi dito no grupo, então não é confidência de ninguém.
  await guardarFala({ dia, tipo, texto, audio });
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: `(nota de voz) ${texto}`, tipo: 'bot' });
}

/**
 * Grava o texto de uma fala programada em `falas`: { dia, tipo ('segunda' | 'sexta' | ...), texto, audio (foi como áudio
 * ou caiu pra texto), em }. Melhor esforço: falha aqui não impede a fala.
 */
export async function guardarFala({ dia, tipo, texto, audio = true }) {
  if (!texto || !dia) return;
  await colecao('falas')
    .insertOne({ dia, tipo: String(tipo || 'fala'), texto: String(texto).slice(0, 4000), audio: Boolean(audio), em: new Date() })
    .catch((e) => console.warn('[voz] não guardei o texto da fala:', e.message));
}

// ============================================================
// Pesagem de domingo: pede o peso de todo mundo (sem IA); o peso dito no grupo entra via ATUALIZAR + pesagens e no semanal da noite
// ============================================================
export async function pedirPesagem() {
  const grupo = estado.memoria.grupo;
  if (!grupo || estado.statusConexao !== 'conectado') return;
  const perfis = await listarPerfis().catch(() => []);
  if (!perfis.length) return;
  // quem tem o relógio mandando o peso pela planilha (pesagem 'relogio' nos últimos 3 dias) não precisa mandar na mão
  const hoje = agora().dia;
  const limite = diasAnteriores(hoje, 3)[0];
  const comRelogio = [];
  const semRelogio = [];
  for (const p of perfis) {
    const u = await ultimaPesagem(p.jids || []).catch(() => null);
    (u?.fonte === 'relogio' && u.dia >= limite ? comRelogio : semRelogio).push(p);
  }
  const nomeDe = (p) => p.apelido || p.nome.split(' ')[0];
  if (!semRelogio.length) return; // todo mundo com relógio: nada a pedir
  const texto =
    `⚖️ *Domingo, dia de pesagem!* ${semRelogio.map(nomeDe).join(', ')}: manda o peso de hoje aqui no grupo (de manhã, em jejum, depois do banheiro e antes do café, pra comparar igual toda semana). ` +
    `Eu anoto com a data e já ponho a evolução no resumo da semana hoje à noite. Quem sumir da balança eu cobro. 👀` +
    (comRelogio.length ? ` (${comRelogio.map(nomeDe).join(' e ')}: o teu eu já pego do relógio, tá de boa 😎)` : '');
  await enviar(grupo, texto);
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto, tipo: 'bot' });
}

// ============================================================
// Relatório mensal (dia 1): números do mês anterior em código + texto da IA -> grupo e Drive (Resumos/Mes-YYYY-MM.md)
// ============================================================
export async function fecharMes() {
  const grupo = estado.memoria.grupo;
  if (!grupo) return;
  const hoje = agora().dia;
  const primeiroDoMesAtual = `${hoje.slice(0, 7)}-01`;
  const ultimoDoMesAnterior = diasAnteriores(primeiroDoMesAtual, 2)[0];
  const mes = ultimoDoMesAnterior.slice(0, 7);
  const dias = [];
  for (let d = `${mes}-01`; d <= ultimoDoMesAnterior; d = diaSeguinte(d)) dias.push(d);
  const perfis = await listarPerfis().catch(() => []);
  if (!perfis.length) return;
  const jids = perfis.flatMap((p) => p.jids || []);
  const refeicoes = await refeicoesDesde(jids, dias[0]).catch(() => []);
  const pesagens = (await pesagensDesde(jids, dias[0]).catch(() => [])).filter((x) => x.dia <= ultimoDoMesAnterior);
  const tabela = compilarMes(refeicoes.filter((r) => r.dia <= ultimoDoMesAnterior), pesagens, perfis, dias);
  console.log(`[mes] ${mes}:\n${tabela}`);
  const texto = ia.separarAtualizacao(await ia.resumoMensal({ mes, perfis, tabela, persona: estado.persona })).texto || '(sem relatório)';
  await enviar(grupo, `🗓️ *RELATÓRIO DO MÊS ${mes}*\n\n${texto}`);
  await salvarMarkdown(
    'Resumos',
    `Mes-${mes}.md`,
    frontmatter({ tipo: 'resumo-mensal', mes, tags: ['nutribot', 'resumo', 'mensal'] }) + `\n# Mês ${mes}\n\n${texto}\n\n---\n## Números\n\n\`\`\`\n${tabela}\n\`\`\`\n`
  ).catch((e) => console.error('[mes] drive:', e.message));
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
