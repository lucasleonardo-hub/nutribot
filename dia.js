// dia.js - Memória do dia, daily note no Drive, virada e fechamento do dia (resumo, momentos, gírias, rotina, notas,
// persona), fechamento da semana e a revisão mensal da base de conhecimento.

import { listarPerfis, salvarPerfil, persistirMemoria, salvarPersona, refeicoesDesde, registrarMomentos, momentosRecentes, registrarDiarioNutri, diarioNutriRecente, pesagensDesde, ultimaPesagem, salvarPrevisao, previsaoAberta, marcarPrevisaoConferida } from './mongo.js';
import { salvarMarkdown, lerMarkdown, registrarLog, frontmatter, mdDiario, mdMomento, mdPerfil } from './drive.js';
import * as ia from './gemini.js';
import { atualizarConhecimento, docsPara } from './conhecimento.js';
import { dossieDe, notasDe, salvarNotas, salvarFicha } from './pessoas.js';
import { compilarRefeicoes, compilarSemana, compilarMes, gastoAdaptativo, placarSemana } from './resumo.js';
import { visaoDe } from './acompanhamento.js';
import { preverSemana, conferirPrevisao, avaliarRitmo, projetarMeta } from './previsao.js';
import { indexarDia } from './memoria_semantica.js';
import { sintetizar } from './voz.js';
import { configGrafico, renderizar } from './graficos.js';
import { agora, semanaISO, diaSeguinte, diasAnteriores, ehDomingo, minutosDe } from './util.js';
import { estado } from './estado.js';
import { enviar, enviarImagem, enviarAudio } from './whatsapp.js';
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
        const momentos = await ia.extrairMomentos({ dia, perfis, historico });
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

      // Diário pessoal dela (só acrescenta): Mongo + Perfis/Nutri-Diario.md
      let entradaDiario = '';
      try {
        let entrada = (await ia.diarioDaNutri({ dia, perfis, historico, personaAtual: estado.persona, resultados }))?.trim();
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

      // Memória de longo prazo por significado (Atlas Vector Search): o que cada um disse, o resumo, os momentos e o diário
      await indexarDia({ dia, perfis, historico, resumo, momentos: momentosDoDia, diario: entradaDiario, falasDe: ia.falasDe }).catch((e) => console.error('[memoria]', e.message));

      // A Nutri revisa quem ela é: apelidos, favoritos, implicâncias, padrões, opiniões e o que afiar amanhã
      try {
        const momentos = await momentosRecentes(30).catch(() => []);
        const diario = await diarioNutriRecente(3).catch(() => []);
        const nova = await ia.evoluirPersona({ dia, personaAtual: estado.persona, perfis, historico, momentos, diario });
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
      const nova = preverSemana({ perfil: p, refeicoes: refs30, pesagens: pes30, gastos: p.relogio?.gastos, dia });
      if (nova) {
        linhas.push(nova.texto);
        if (!nova.semDados) {
          const ritmo = avaliarRitmo({ peso: nova.pesoInicial, deltaKg: nova.deltaKg, objetivo: p.objetivo });
          if (ritmo) linhas.push(ritmo);
          const projecao = projetarMeta({ perfil: p, deltaKgSemana: nova.deltaKg, pesoAtual: nova.pesoInicial, dia });
          if (projecao) linhas.push(projecao);
          await salvarPrevisao({ jid: jids[0], nome: p.nome, feitaEm: dia, alvoDia: nova.alvoDia, pesoInicial: nova.pesoInicial, diaInicial: nova.diaInicial, deltaKg: nova.deltaKg, pesoPrevisto: nova.pesoPrevisto, magraKg: nova.magraKg, gorduraKg: nova.gorduraKg, base: nova.base, confianca: nova.confianca }).catch((e) => console.error('[previsao] falha ao salvar:', e.message));
          console.log(`[previsao] ${p.nome}: ${nova.texto.slice(0, 120)}`);
        }
      }
    } catch (e) {
      console.error(`[previsao] falha para ${p.nome}:`, e.message);
    }
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
  try {
    await enviarAudio(grupo, await sintetizar(texto));
    console.log(`[voz] nota de voz de ${tipo} enviada (${texto.length} chars)`);
  } catch (e) {
    console.warn(`[voz] ${tipo} sem áudio, indo em texto:`, e.message);
    await enviar(grupo, texto);
  }
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: `(nota de voz) ${texto}`, tipo: 'bot' });
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
