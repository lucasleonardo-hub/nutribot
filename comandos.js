// comandos.js - Comandos do grupo (!id, !nome, !perfil, !dossie, !fontes, !estudar, !persona, !status, !reset, !resumo, !ajuda).

import { buscarPerfil, apagarPerfil, salvarPerfil, listarPerfis, refeicoesDosDias, registrarRefeicao, refeicoesDesde, refeicoesGrupoDesde, pesagensDesde, habitosDosDias, salvarConfig, apagarRefeicaoPorId, registrarCorrecao, carregarAprendizados, guardarPlano } from './mongo.js';
import { configGrafico, renderizar } from './graficos.js';
import { salvarEmPasta } from './drive.js';
import { pastaDe } from './pessoas.js';
import * as ia from './gemini.js';
import { listarDocs, docsPara } from './conhecimento.js';
import { notasDe, listarDocumentosDe } from './pessoas.js';
import { reservasDisponiveis } from './reservas.js';
import { usoClaudeHoje } from './claude.js';
import { fusoDe, formatarTokens, formatarDuracao, agora, slotDaHora, minutosDe, SLOTS, diasAnteriores, marcaDeTempo, registrosDaVirada, JANELA_VIRADA_MIN } from './util.js';
import { resumirHoje, formatarEstimativaLinhas, lerTipoRefeicao, gastoAdaptativo, acharRegistro, nomeDoSlot, padraoAlimentar, repertorioDoGrupo, semanaDoPlano, previsaoSemana } from './resumo.js';
import { visaoDe, progressoDe } from './acompanhamento.js';
import { lembrar } from './dia.js';
import { estado } from './estado.js';
import { enviar, enviarImagem } from './whatsapp.js';
import { fecharDia, estudar } from './dia.js';
import { enriquecerPerfis } from './perfis.js';
import { situacaoRelogio } from './relogio.js';
import { treinoZap } from './treino.js';
import { agendaZap, agendaDe } from './agenda.js';
import { pareceAceitePlano } from './consciencia.js';
import { ferramentasPara } from './ferramentas.js';
import { lugaresZap, marcarLugarAtual, esquecerLugares, mercadosProximos, semanaTipica } from './lugares.js';
import { refletirSobre, reflexaoZap } from './reflexao.js';
import { atividadesZap, criarAtividade, removerAtividade, responderPendente } from './atividades.js';
import { despensaZap, ajustarItem, extrairChave, interpretarQr, blocoDespensa, limparDespensa } from './despensa.js';
import { pensamentosZap, pensarSobre, pensamentoParaGrupo } from './pensamentos.js';
import { linhaDeTendencia } from './previsao.js';
import { tendenciaCompleta } from './tendencia.js';
import { resumoProatividade } from './proatividade.js';
import { faixaDaMeta } from './resumo.js';

/** O "hoje" da pessoa, no fuso dela (refeição, pesagem digitada e hábito são gravados no dia local desde 13/10). */
const diaLocal = (p) => marcaDeTempo(p).dia;

const SEM_CADASTRO = 'Você ainda não tem cadastro, criatura. Manda nome, peso, altura, objetivo, cidade e se é vegetariana(o) que eu te cadastro. 😉';

export const AJUDA =
  'Comandos: !refeicao café 2 ovos e 1 banana (registra à mão uma refeição que ficou sem registro; tipo opcional), !apagar 11:03 (apaga um registro seu de hoje pela hora do !hoje; !apagar ultimo), !hoje (seus totais do dia, meta e sequência; !hoje todos = grupo inteiro), !grafico (peso, calorias, gasto e meta dos últimos 30 dias em imagem; !grafico todos), !treino (séries por grupo, volume e progressão de carga da semana, pelo Hevy), !relogio (o que chegou do seu celular: passos, sono e peso de hoje, último envio), !despensa (o que você tem em casa, pelas fotos dos cupons do mercado que você me manda: itens padronizados, validade e tabela nutricional; !despensa add 2 kg arroz; !despensa tirar iogurte; !despensa acabando leite; ou é só me dizer "acabou o iogurte"), !nota (explica como entra a compra: foto do cupom), !atividade (esporte fixo sem relógio, ex.: vôlei seg e qua 20h–22h: eu confiro pela localização se você foi e somo o gasto estimado; !atividade nova Vôlei; seg,qua; 20:00-22:00; met 6; aqui | lugar UFSC; !atividade sim/não responde quando eu perguntar; !atividade remover 1), !progresso (como está o seu ritmo de peso, com as contas abertas: período, pesagens, tendência com a margem de erro, alvo, veredito, comida registrada x balança, meta de calorias calibrada pela balança, alertas e limites), !tendencia (sua linha de tendência pessoal pela bioimpedância: peso, gordura e massa magra por semana, ritmo e a projeção até a etapa),!pensamentos (o que eu andei pensando sobre você hoje: penso 3x por dia, em silêncio, quando há dado novo; !pensamentos agora força um), !reflexao (como eu te entendo hoje: a síntese da minha reflexão livre sobre você, reescrita aos domingos em Nutri-Reflexoes.md na sua pasta; !reflexao nova reescreve agora), !lugares (se você ligou a localização no app: onde está agora e os lugares que frequenta, com o padrão da semana; !lugares casa, !lugares aqui é academia X, !lugares esquecer), !agenda (seus compromissos de hoje e amanhã e as janelas livres), !plano (plano da semana + lista de compras e dicas de compra barata, só com as refeições que você costuma registrar e com a meta de cada dia da semana; de sexta a domingo é o plano da semana que vem; !plano orçamento apertado, só mercado de bairro = observação que fica guardada; !plano limpar; toda sexta ao meio-dia eu pergunto quem quer e basta responder "quero"), !voz (só o admin: liga/desliga minhas notas de voz de segunda, sexta e as espontâneas; pedir "em áudio" sempre funciona), !apelido X (fixa seu apelido; !apelido nenhum tira), !silencio 2h (só o admin: não entro em papo por um tempo; !falar cancela), !id, !nome NovoNome (só o admin: me rebatiza; !nome sozinho mostra o nome), !perfil, !dossie (sua pasta no Drive e minhas notas sobre você), !persona (o que eu já sei de vocês), !licoes (meu caderno de aprendizado: erros que cometi, causas e as regras que adotei), !fontes (o que eu estudei), !estudar (só o admin: revisa a base com estudos novos), !status (conexão, cota do Gemini e modelos), !reset e !resumo (só o admin; !resumo fecha o dia agora), !ajuda';

// ---------- trava do admin (D19, fase 7) ----------
/**
 * Comandos destrutivos ou de configuração do grupo inteiro: só o administrador (ADMIN_JID). `!nome` sem nome só mostra o
 * nome atual (livre); com nome, rebatiza (admin). `!plano` continua de todo mundo (D13).
 */
export const COMANDOS_DO_ADMIN = new Set(['!reset', '!resumo', '!estudar', '!voz', '!silencio', '!silêncio', '!falar']);
/** Puro. O comando (com o argumento) precisa do admin? */
export function exigeAdmin(cmd, argumento = '') {
  if (cmd === '!nome') return Boolean(String(argumento || '').trim());
  return COMANDOS_DO_ADMIN.has(cmd);
}
/** Puro. Algum dos jids do remetente é o ADMIN_JID? Sem ADMIN_JID configurado, ninguém é. */
export function ehAdmin(jids = [], adminJid = process.env.ADMIN_JID) {
  const a = String(adminJid || '').trim();
  return Boolean(a) && (jids || []).includes(a);
}
/**
 * O remetente é o admin? Primeiro pelos jids da chave; se não bater, pelos jids do cadastro (número e LID): a mensagem pode
 * chegar só com o LID (retomada depois de queda, grupo sem participant_pn), como no tratarPrivado. `buscar` é injetável.
 */
export async function remetenteEhAdmin(jids = [], { buscar = buscarPerfil, adminJid = process.env.ADMIN_JID } = {}) {
  if (ehAdmin(jids, adminJid)) return true;
  if (!String(adminJid || '').trim() || !(jids || []).length) return false;
  const perfil = await Promise.resolve()
    .then(() => buscar(jids))
    .catch(() => null);
  return ehAdmin([...(jids || []), ...(perfil?.jids || [])], adminJid);
}
export const RESPOSTA_SO_ADMIN ='Esse comando mexe com o grupo todo, então fica só com o administrador. Se precisar, pede pra ele que eu resolvo.';

/** "2h", "30m", "1h30", "90" (minutos) -> ms; null se não entendeu */
export function duracaoDe(texto) {
  const t = String(texto || '').toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m?)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const ms = (Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60_000;
  return ms > 0 ? Math.min(ms, 24 * 3600_000) : null;
}

/**
 * Trata um comando. Devolve true se era um comando (tratado ou não reconhecido), false se a mensagem não começa com "!".
 * @param {object} ctx { texto, jids, jidGrupo, msg, dia, nomeContato, batizar }
 */
/**
 * Plano da semana de uma pessoa: padrão real (28 dias), repertório do grupo, meta por dia da semana (relógio), agenda e o pedido
 * dela (orçamento, mercado perto). pedidoArg vem do "!plano <texto>" ou da resposta à oferta de sexta; fica guardado no perfil.
 */
/**
 * Manda o plano completo no grupo. Devolve true se saiu; false sem grupo ou quando o envio falhou (nunca lança). `enviarFn`
 * é injetável no teste.
 */
export async function enviarPlanoNoGrupo(texto, { jidGrupo, msg = undefined, enviarFn = enviar } = {}) {
  if (!jidGrupo || !String(texto || '').trim()) return false;
  try {
    await enviarFn(jidGrupo, texto, msg, { rapido: true });
    return true;
  } catch (e) {
    console.warn('[plano] envio do plano no grupo falhou:', e?.message || e);
    return false;
  }
}
const TENTATIVAS_PLANO = 4; // ~24 min no pior caso: 4 x (até 5 min de cadeia Flash com raciocínio alto + 1 min de espera)
const PRAZO_TENTATIVA_PLANO_MS = 300_000;
const ESPERA_PLANO_MS = 60_000;
/**
 * Fase 7 (D13 ajustada pelo dono: "pode ter o plano no WhatsApp também, pra quem não tem o app"): venha de onde vier (!plano,
 * "quero" de sexta ou o app, `origem: 'app'`), o plano é ENVIADO COMPLETO no grupo e GRAVADO em `planos` (aba Plano do app)
 * e no Drive. A gravação no Mongo vem antes do Drive: Drive fora do ar não pode apagar o plano do app nem mandar "não
 * consegui" depois de o plano já ter saído no grupo. Sem `jidGrupo` (grupo ainda não ligado), gera e grava sem enviar.
 * Devolve false quando falhou, ou quando havia grupo e o plano não saiu nele (o app libera um novo pedido no mesmo dia).
 */
export async function gerarPlano({ perfil, jidGrupo, msg = undefined, dia, pedidoArg = '', origem = 'whatsapp' }) {
  // WhatsApp fora do ar não pode impedir o plano de ser gerado e gravado (pedido pelo app): o envio falha sozinho, com log
  const avisar = (texto) => (jidGrupo ? enviar(jidGrupo, texto, msg, { rapido: true }).catch((e) => console.warn('[plano] envio no grupo:', e.message)) : Promise.resolve());
  // "!plano orçamento apertado, mercado perto só tem o básico": o pedido vale pra este plano e fica guardado pros próximos.
  // "!plano limpar" esquece o pedido guardado.
  let pedido = perfil.planoPedido || '';
  if (/^(limpar|apagar|nenhum|zerar)$/i.test(pedidoArg)) {
    pedido = '';
    if (perfil.planoPedido) await salvarPerfil({ jids: perfil.jids, planoPedido: '' });
  } else if (pedidoArg) {
    pedido = pedidoArg.slice(0, 300);
    await salvarPerfil({ jids: perfil.jids, planoPedido: pedido });
  }
  const semana = semanaDoPlano(dia);
  const rotuloSemana = `${semana.dias[0].rotulo.split(' ')[1]} a ${semana.dias[6].rotulo.split(' ')[1]}`;
  const primeiroNome = String(perfil.nome || '').split(' ')[0];
  await avisar(
    origem === 'app'
      ? `${primeiroNome} pediu o plano de ${rotuloSemana} pelo app. Tô montando com as refeições que costuma registrar e a meta${pedido ? `, levando em conta: "${pedido}"` : ''}; sai aqui completo e fica no app também. Pode levar alguns minutos.`
      : `Montando teu plano de ${rotuloSemana} com as refeições que você costuma registrar e a tua meta${pedido ? `, levando em conta: "${pedido}"` : ''}. Pode levar alguns minutos: plano eu só entrego do modelo principal. 📝`
  );
  try {
    const visao = await visaoDe(perfil, dia);
    const [comAgenda] = await enriquecerPerfis([perfil], dia);
    // padrão real dos últimos 28 dias (que refeições faz, horário, o que come) + o que o resto do grupo manda
    const PERIODO = 28;
    const desde = diasAnteriores(dia, PERIODO)[0];
    const [doGrupo, pesagens] = await Promise.all([refeicoesGrupoDesde(desde), pesagensDesde(perfil.jids, desde).catch(() => [])]);
    const jidsDela = perfil.jids || [];
    const minhas = doGrupo.filter((r) => jidsDela.includes(r.jid) || r.nome === perfil.nome);
    const padrao = padraoAlimentar(minhas, { periodoDias: PERIODO });
    const grupo = repertorioDoGrupo(doGrupo.filter((r) => !minhas.includes(r)));
    // meta por dia da semana pra quem tem relógio (gasto do mesmo dia da semana nas últimas semanas)
    // mercados (Overpass pode levar 1 min em timeout), despensa e agenda da semana do plano em paralelo
    const [mercados, despensa, agendaSemana, app] = await Promise.all([
      mercadosProximos(perfil).catch(() => null),
      blocoDespensa(perfil).catch(() => ''),
      agendaDe(perfil, { dias: 10 }).catch(() => null),
      appDoPlano(perfil, { dia, semana }).catch(() => ''),
    ]);
    // onde a pessoa costuma estar em cada dia e em cada refeição da semana do plano (lugares, atividades fixas, agenda)
    const tipica = semanaTipica({ perfil: comAgenda || perfil, semana, hab: comAgenda?._hab || {}, slots: padrao?.slots ? Object.keys(padrao.slots) : [], agenda: agendaSemana?.lista || [], fuso: fusoDe(perfil) });
    const gastos = comAgenda?.relogio?.gastos || perfil.relogio?.gastos;
    let metaSemana = null;
    if (gastos) {
      const meta = gastoAdaptativo({ refeicoes: minhas, pesagens, perfil, dia, gastos });
      metaSemana = previsaoSemana({ gastos, dia, objetivo: perfil.objetivo, metaAdaptativa: meta, semana, perfil })?.texto || null;
    }
    // Plano é documento, não resposta na hora: só o modelo principal (Flash). Em "alta demanda" avisa, espera e tenta de
    // novo (até ~17 min) em vez de entregar plano do Lite; a cadeia completa (Lite, reservas) só como último recurso.
    // function calling (fase 1): além dos blocos prontos, a IA pode consultar o que quiser antes de escrever
    const ferramentas = ferramentasPara(comAgenda || perfil, { dia });
    const args = { perfil: comAgenda, visao, conhecimento: docsPara(perfil, { texto: 'plano da semana lista de compras' }), persona: estado.persona, dia, agenda: comAgenda?._agenda?.bloco || '', padrao, grupo, pedido, semana, metaSemana, mercados, lugares: comAgenda?._lugares?.bloco || '', despensa, semanaTipica: tipica, app, ferramentas };
    let bruto = null;
    let avisouEspera = false;
    for (let tentativa = 1; tentativa <= TENTATIVAS_PLANO && !bruto; tentativa++) {
      try {
        bruto = await ia.planoSemanal({ ...args, soPrincipal: true, prazoMs: PRAZO_TENTATIVA_PLANO_MS });
      } catch (e) {
        console.warn(`[plano] tentativa ${tentativa}/${TENTATIVAS_PLANO} no modelo principal falhou: ${String(e.message).slice(0, 120)}`);
        if (tentativa === TENTATIVAS_PLANO) break;
        if (!avisouEspera) {
          avisouEspera = true;
          await avisar('A IA principal tá em alta demanda agora. Plano eu não entrego de modelo reserva: vou esperar e tentar de novo em alguns minutos, segura aí. ⏳');
        }
        await new Promise((r) => setTimeout(r, ESPERA_PLANO_MS));
      }
    }
    if (!bruto) {
      console.warn('[plano] modelo principal não respondeu em nenhuma tentativa; último recurso: cadeia completa');
      bruto = await ia.planoSemanal(args);
    }
    const plano = ia.separarAtualizacao(bruto).texto.replace(/[~≈]\s?(?=\d)/g, ''); // "~480 kcal" vira "480 kcal" mesmo que o modelo insista
    if (!plano) throw new Error('plano vazio');
    if (ferramentas.usadas.length) console.log(`[plano] ${perfil.nome.split(' ')[0]} consultou: ${[...new Set(ferramentas.usadas)].join(', ')}`);
    // o app (aba Plano) lê o último plano do Mongo: grava primeiro, venha o plano do !plano, do "quero" ou do app (D13)
    await guardarPlano({ jid: perfil.jids?.[0], nome: perfil.nome, semana: `${semana.inicio}/${semana.fim}`, de: semana.inicio, ate: semana.fim, texto: plano }).catch((e) => console.error('[plano] mongo:', e.message));
    // completo no grupo pra todo mundo, inclusive pra quem não tem o app (D13 ajustada). O envio do plano NÃO engole a falha:
    // WhatsApp caído no meio da geração não pode virar "plano enviado" na memória do grupo nem travar o pedido do dia no app
    const enviado = await enviarPlanoNoGrupo(plano, { jidGrupo, msg });
    if (enviado) await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: `(plano da semana de ${perfil.nome} enviado${origem === 'app' ? ', pedido pelo app' : ''})`, tipo: 'bot' });
    else if (jidGrupo) console.warn(`[plano] ${primeiroNome}: o plano ficou no app e no Drive, mas não saiu no grupo`);
    // o Drive é a cópia da pessoa; falha nele não desfaz nada do que já saiu
    const pastaId = await pastaDe(perfil).catch((e) => (console.error('[plano] pasta:', e.message), null));
    if (pastaId) await salvarEmPasta(pastaId, 'Nutri-Plano.md', `---\ntipo: plano-semanal\npessoa: ${perfil.nome}\ngerado: ${dia}\nsemana: ${semana.inicio} a ${semana.fim}\ntags: [nutribot, pessoa, plano]\n---\n\n# Plano da semana de ${perfil.nome} (${semana.inicio} a ${semana.fim})\n\n${plano}\n`).catch((e) => console.error('[plano] Drive:', e.message));
    // sem grupo ligado, gerar e gravar é o serviço inteiro; com grupo, o plano tem que ter saído lá (o app libera um novo pedido)
    return jidGrupo ? enviado : true;
  } catch (e) {
    console.error('[plano]', e.message);
    await avisar('Não consegui fechar o plano agora (a IA engasgou). Tenta de novo em alguns minutos. 🫠').catch(() => {});
    return false;
  }
}

/**
 * Fase 7: o que o plano da semana passa a saber (bloco de texto no prompt que já existe). O plano SAI NO GRUPO, então só o
 * que não é confidência: eventos marcados no app na semana do plano (só refeição fora, festa e viagem, sem a nota), os treinos pelo título
 * com os dias de costume e as metas de carga (D18), e sono e energia da linha do relógio (D2). Nada de humor, pergunta do
 * app, oxigênio ou temperatura. '' sem nada.
 */
async function appDoPlano(perfil, { dia, semana }) {
  const { eventosDe } = await import('./mongo.js');
  const [{ blocoEventosApp }, { treinosDoDia, textoSugestoesCarga }] = await Promise.all([import('./contexto-app.js'), import('./contexto.js')]);
  const [eventos, treinos] = await Promise.all([eventosDe(perfil.jids || [], semana.inicio, semana.fim).catch(() => []), treinosDoDia(perfil, dia).catch(() => null)]);
  const partes = [];
  const ev = blocoEventosApp(eventos, { hoje: semana.inicio, dias: 6, titulo: 'MARCADO NO APP PRA SEMANA DO PLANO (refeição fora não entra no cardápio daquele dia; viagem muda o dia inteiro)', publico: true });
  if (ev) partes.push(ev);
  if (treinos?.caixas?.length) partes.push(`TREINOS DA SEMANA (pelo título no Hevy; dia de treino pede porção maior e pós-treino com proteína): ${treinos.caixas.slice(0, 5).map((c) => `${c.titulo} (${(c.dias || []).join(', ') || 'sem dia fixo'})`).join('; ')}`);
  const metas = textoSugestoesCarga(perfil.sugestoesCarga || [], { hoje: dia });
  if (metas) partes.push(metas);
  const r = perfil.relogio || {};
  const corpo = [r.sono?.nota != null ? `nota do sono ${r.sono.nota}${r.sono.fraco ? ` (ponto fraco: ${String(r.sono.fraco.nome).toLowerCase()})` : ''}` : null, r.energia?.nota != null ? `energia ${r.energia.nota}/100` : null].filter(Boolean);
  if (corpo.length) partes.push(`CORPO (relógio): ${corpo.join(', ')}. Sono curto pede jantar mais cedo e mais leve e nada de cafeína à noite.`);
  return partes.join('\n\n');
}

// ---------- Oferta de sexta: plano da semana que vem + lista de compras pra comprar no fim de semana ----------
const OFERTA_PLANO_HORAS = 60; // vale até domingo à noite
/** Cron de sexta (meio-dia): pergunta no grupo quem quer o plano da semana que vem; o aceite vem por resposta simples. */
export async function oferecerPlano() {
  const grupo = estado.memoria.grupo;
  if (!grupo || estado.statusConexao !== 'conectado') return;
  const perfis = (await listarPerfis().catch(() => [])).filter((p) => p.onboarded);
  if (!perfis.length) return;
  const ate = new Date(Date.now() + OFERTA_PLANO_HORAS * 3600 * 1000).toISOString();
  estado.config = await salvarConfig({ ofertaPlano: { dia: agora().dia, ate, atendidos: [] } }).catch(() => ({ ...estado.config, ofertaPlano: { dia: agora().dia, ate, atendidos: [] } }));
  const texto =
    `Sexta-feira! 🛒\n\n` +
    `Quem quiser, eu monto agora o *plano da semana que vem* com a *lista de compras*, pra vocês comprarem no fim de semana.\n\n` +
    `É só responder *quero*, ou !plano.\n\n` +
    `Se tiver orçamento apertado, ou quiser dizer o que tem no mercado perto de casa, escreve junto (ex.: "quero, orçamento curto, só mercado de bairro") que eu monto em cima disso.`;
  await enviar(grupo, texto);
  await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: `(oferta) ${texto}`, tipo: 'bot' });
}
/**
 * Resposta de "quero" à oferta de sexta (válida até domingo): gera o plano da pessoa e devolve true; qualquer outro texto, false.
 * O texto que vem depois do aceite ("quero, orçamento apertado") vira o pedido do plano.
 */
export async function aceiteDePlano({ texto, perfil, jidGrupo, msg, dia }) {
  const oferta = estado.config?.ofertaPlano;
  if (!oferta?.ate || new Date(oferta.ate).getTime() < Date.now() || !perfil?.onboarded) return false;
  const { aceite, pedido } = pareceAceitePlano(texto);
  if (!aceite) return false;
  const chave = perfil.jids?.[0] || perfil.nome;
  if ((oferta.atendidos || []).includes(chave)) return false;
  estado.config = await salvarConfig({ 'ofertaPlano.atendidos': [...(oferta.atendidos || []), chave] }).catch(() => estado.config);
  // roda solto: o plano pode levar minutos (IA em alta demanda) e não pode prender a fila nem estourar o cão de guarda de 4 min
  void gerarPlano({ perfil, jidGrupo, msg, dia, pedidoArg: pedido });
  return true;
}

export async function tratarComando({ texto, jids, jidGrupo, msg, dia, nomeContato, batizar }) {
  if (!texto.startsWith('!')) return false;
  const cmd = texto.toLowerCase().split(/\s+/)[0];
  // D19: destrutivo ou de configuração do grupo inteiro = só o admin; os outros recebem uma resposta curta e simpática
  if (exigeAdmin(cmd, texto.slice(cmd.length)) && !(await remetenteEhAdmin(jids))) {
    console.log(`[comandos] ${cmd} negado: não é o admin`);
    await enviar(jidGrupo, RESPOSTA_SO_ADMIN, msg, { rapido: true });
    return true;
  }

  if (cmd === '!id') {
    await enviar(jidGrupo, `ID deste grupo: ${jidGrupo}\nSeu ID: ${jids.join(' / ')}`, msg);
    return true;
  }
  if (cmd === '!nome') {
    const novo = texto.slice(5).trim().replace(/^["']|["']$/g, '');
    if (!novo) await enviar(jidGrupo, `Meu nome é *${ia.nomeDaBot()}*. Quer trocar? Manda "!nome NovoNome", criatura.`, msg);
    else if (novo.length > 40) await enviar(jidGrupo, 'Nome com mais de 40 letras? Tá me batizando ou escrevendo TCC? Encurta isso.', msg);
    else await batizar(novo, nomeContato, jidGrupo, msg);
    return true;
  }
  if (cmd === '!resumo') {
    await fecharDia({ forcado: true });
    return true;
  }
  if (cmd === '!reset') {
    await apagarPerfil(jids);
    await enviar(jidGrupo, 'Perfil apagado. Manda qualquer coisa que eu te cadastro de novo, criatura.', msg);
    return true;
  }
  if (cmd === '!perfil') {
    const p = await buscarPerfil(jids);
    const [pe] = p?.onboarded ? await enriquecerPerfis([p], dia) : [null];
    const em = (c) => (pe?.atualizacoes?.[c] ? ` (desde ${pe.atualizacoes[c]})` : '');
    const ficha = pe
      ? [
          `*${pe.nome}*`,
          `• Peso: ${pe.peso} kg${em('peso')}`,
          `• Altura: ${pe.altura} cm`,
          `• Objetivo: ${pe.objetivo}${em('objetivo')}`,
          pe.metaPeso ? `• Meta: ${String(pe.metaPeso).replace('.', ',')} kg${pe.metaPrazo ? ` até ${pe.metaPrazo}` : ''}` : null,
          `• Mora em: ${pe.cidade ? `${pe.cidade} (fuso ${fusoDe(pe)})` : 'ainda não me contou 🗺️'}`,
          `• Dieta: ${pe.dieta || 'ainda não me contou'}${pe.restricoes ? ` · restrições: ${pe.restricoes}` : ''}`,
          pe.produtos?.length ? `• Produtos fixos: ${pe.produtos.map((x) => `${x.nome} (${x.kcal} kcal)`).join(', ')}` : null,
          `• Gírias que eu já peguei: ${(pe.girias || []).join(', ') || 'nenhuma ainda'}`,
          `• Horários (no seu fuso): ${pe.horarios}`,
          '',
          '*Rotina que eu observei*',
          pe.rotina || 'ainda te observando 👀',
        ]
          .filter((l) => l !== null)
          .join('\n')
      : SEM_CADASTRO;
    await enviar(jidGrupo, ficha, msg);
    return true;
  }
  if (cmd === '!dossie' || cmd === '!pasta') {
    const p = await buscarPerfil(jids);
    if (!p?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const docs = await listarDocumentosDe(p).catch(() => []);
    const notas = await notasDe(p).catch(() => '');
    const lista = docs.map((d) => `• ${d.nome}${d.daNutri ? ' (meu)' : d.lido ? ' ✅ lido' : ' ⚠️ não consegui ler'}`).join('\n') || '(pasta vazia)';
    await enviar(jidGrupo, `📂 *Sua pasta no Drive:*\n${lista}\n\n🧠 *Minhas notas sobre você:*\n${notas ? notas.slice(0, 1200) : 'ainda nada, mas eu tô de olho 👀'}`, msg);
    return true;
  }
  if (cmd === '!fontes') {
    const lista = listarDocs().map((d) => `• ${d.titulo} (v${d.versao}, ${d.atualizado})`).join('\n');
    await enviar(jidGrupo, `📚 *O que eu já estudei:*\n${lista || 'nada ainda'}\n\nTá tudo no Drive, pasta Conhecimento. Manda !estudar se quiser que eu revise com o que saiu de novo.`, msg);
    return true;
  }
  if (cmd === '!estudar') {
    await enviar(jidGrupo, 'Tá, vou revisar meu material. Isso leva uns minutos, já volto. 📚', msg);
    estudar({ dia, motivo: 'pedido no grupo' }).catch((e) => console.error('[conhecimento] falha ao estudar:', e.message));
    return true;
  }
  if (cmd === '!licoes' || cmd === '!lições') {
    // Caderno de aprendizado: erros, causas e regras que ela adotou (Perfis/Nutri-Aprendizados.md)
    const a = await carregarAprendizados().catch(() => null);
    if (!a?.documento) {
      await enviar(jidGrupo, 'Meu caderno de aprendizado ainda está vazio: nenhuma correção ou contestação virou lição até agora. Quando eu errar e vocês me corrigirem, ele começa.', msg, { rapido: true });
      return true;
    }
    const regras = (a.regras || []).map((r, i) => `${i + 1}. ${r}`).join('\n');
    await enviar(jidGrupo, `📓 *Meu caderno de aprendizado* (atualizado em ${a.dia || '?'})\n\n*Regras que eu sigo hoje:*\n${regras || '(nenhuma ativa)'}\n\n${a.documento.slice(0, 2500)}${a.documento.length > 2500 ? '\n(...) completo em Perfis/Nutri-Aprendizados.md' : ''}`, msg, { rapido: true });
    return true;
  }
  if (cmd === '!persona') {
    await enviar(jidGrupo, estado.persona ? `🧠 *Minha memória de personalidade:*\n\n${estado.persona}` : 'Ainda tô te conhecendo, criatura. Volta depois do primeiro resumo do dia. 🙄', msg);
    return true;
  }
  if (cmd === '!status' || cmd === '!cota') {
    const u = ia.usoDeHoje();
    const modelos = ia.situacaoModelos();
    const fora = modelos.filter((m) => !m.livre);
    const lite = modelos.filter((m) => m.papel === 'leve').length;
    const minutos = Math.round(process.uptime() / 60);
    const linhas = [
      `🩺 *Status da ${ia.nomeDaBot()}*`,
      `• No ar há: ${minutos >= 60 ? `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}` : `${minutos} min`}`,
      `• Hoje (${estado.memoria.dia}): ${estado.memoria.mensagens.length} mensagens na memória`,
      '',
      '*Gemini hoje*',
      `• Chamadas: ${u.chamadas}`,
      `• Tokens: ${formatarTokens(u.entrada)} de entrada (${formatarTokens(u.cache)} em cache), ${formatarTokens(u.saida)} de saída`,
      `• Modelos: ${modelos.length} na fila (${modelos.length - lite} Flash, ${lite} Lite) · chaves do Gemini: ${ia.totalDeChaves()}${ia.totalDeChaves() > 1 ? ` (uso hoje: ${Object.entries(u.porChave || {}).map(([c, n]) => `chave ${c} = ${n}`).join(', ') || 'nenhum'})` : ''}`,
      fora.length ? `• De castigo (todas as chaves): ${fora.map((m) => `${m.modelo} (volta em ${m.voltaEm})`).join(', ')}` : '• De castigo: nenhum ✅',
      `• Reservas externas: ${reservasDisponiveis().join(', ') || 'nenhuma'}`,
      '',
      ...(() => {
        const c = usoClaudeHoje();
        if (c.escopo === 'off') return ['*Claude*: desligado', ''];
        return [`*Claude hoje* (${c.modelo}, escopo ${c.escopo})`, `• Chamadas: ${c.chamadas} · ${formatarTokens(c.entrada)} entrada (${formatarTokens(c.cache)} em cache), ${formatarTokens(c.saida)} saída · ~US$ ${c.usd.toFixed(2)}`, ''];
      })(),
      '*Últimas respostas*',
      ...(ia.ultimasRespostas(6).length ? ia.ultimasRespostas(6).map((r) => `• ${r.hora} ${String(r.modelo).replace(/^gemini-/, '')}${r.chave ? ` (chave ${r.chave})` : ''}${r.motivo ? `: ${r.motivo}` : ''}`) : ['• nenhuma desde o último restart']),
    ];
    await enviar(jidGrupo, linhas.join('\n'), msg, { rapido: true });
    return true;
  }
  if (cmd === '!hoje') {
    // Só de quem mandou o comando; "!hoje todos" mostra o grupo inteiro
    const todos = /\btodos?\b|\bgeral\b/i.test(texto.slice(cmd.length));
    const perfis = await listarPerfis();
    const alvo = todos ? perfis : perfis.filter((p) => p.jids?.some((j) => jids.includes(j)));
    if (!alvo.length) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    // o "hoje" de cada pessoa é o do fuso dela (refeição e hábito são gravados no dia local desde 13/10)
    const dias = alvo.map(diaLocal);
    const [refeicoes, habitos] = await Promise.all([refeicoesDosDias(dias).catch(() => []), habitosDosDias(dias).catch(() => [])]);
    const diaTitulo = todos ? dia : dias[0];
    // só pra uma pessoa: junta a visão de 7/30 dias, meta e balanço energético (quem tem relógio), em linguagem de WhatsApp
    const visao = todos ? '' : await visaoDe(alvo[0], dias[0], { formato: 'zap' }); // 7/30 dias, sequência, meta e balanço em tópicos
    await enviar(jidGrupo, `📊 *${todos ? 'Hoje, todo mundo' : 'Seu dia'} (${diaTitulo})*\n\n${resumirHoje(refeicoes, alvo, diaTitulo, habitos, { diaDe: diaLocal })}${visao ? `\n\n${visao}` : ''}${todos ? '' : '\n\n_(!hoje todos mostra o grupo inteiro · !grafico mostra em imagem)_'}`, msg, { rapido: true });
    return true;
  }
  if (cmd === '!apagar') {
    // Apaga um registro SEU de hoje: "!apagar 11:03" (hora local do registro, como aparece no !hoje) ou "!apagar ultimo"
    const p = await buscarPerfil(jids);
    if (!p?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const ref = texto.slice(cmd.length).trim() || 'ultimo';
    // "hoje" no fuso dela; na 1ª hora do dia local, sem registro hoje, os de ontem (a ceia das 23:55 apagada à 00:10)
    const { dia: hojeP, minutos: minutosAgora } = marcaDeTempo(p);
    const ontemP = minutosAgora < JANELA_VIRADA_MIN ? diasAnteriores(hojeP, 2)[0] : null;
    const doisDias = (await refeicoesDosDias([hojeP, ontemP]).catch(() => [])).filter((r) => jids.includes(r.jid));
    const minhas = registrosDaVirada(doisDias.filter((r) => r.dia === hojeP), doisDias.filter((r) => r.dia === ontemP), minutosAgora).sort((a, b) => a.minutos - b.minutos);
    const deOntem = minhas.length > 0 && minhas[0].dia === ontemP;
    const alvo = acharRegistro(minhas, ref);
    if (!alvo) {
      const lista = minhas.map((r) => `${r.horaLocal || r.hora} ${nomeDoSlot(r.slot)}`).join(', ');
      await enviar(jidGrupo, minhas.length ? `Não achei registro seu às ${ref}. Os de ${deOntem ? 'ontem' : 'hoje'}: ${lista}. Use "!apagar 11:03" ou "!apagar ultimo".` : 'Você não tem registro hoje.', msg, { rapido: true });
      return true;
    }
    await apagarRefeicaoPorId(alvo._id);
    console.log(`[refeicoes] !apagar de ${p.nome}: ${alvo.horaLocal || alvo.hora} ${alvo.slot} (~${alvo.estimativa?.kcal || '?'} kcal)`);
    registrarCorrecao({ dia, pessoa: p.nome, texto: `registro de ${nomeDoSlot(alvo.slot)} das ${alvo.horaLocal || alvo.hora} (~${alvo.estimativa?.kcal || '?'} kcal) APAGADO por ${p.nome.split(' ')[0]} (!apagar): era duplicado ou errado; qualquer total do dia dito na conversa antes disso está errado` }).catch(() => {});
    await enviar(jidGrupo, `🗑️ Apagado: ${nomeDoSlot(alvo.slot)} das ${alvo.horaLocal || alvo.hora}${deOntem ? ' de ontem' : ''}${alvo.estimativa?.kcal ? ` (~${Math.round(alvo.estimativa.kcal)} kcal)` : ''}. O !hoje já reflete.`, msg, { rapido: true });
    return true;
  }
  if (cmd === '!refeicao' || cmd === '!refeição') {
    const p = await buscarPerfil(jids);
    if (!p?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    let resto = texto.slice(cmd.length).trim();
    if (!resto) {
      await enviar(jidGrupo, 'Assim: "!refeicao café 2 ovos mexidos e 1 banana" ou "!refeicao almoço arroz, feijão e 150 g de frango". O tipo (café/almoço/lanche/jantar/ceia) é opcional: sem ele eu uso o horário.', msg, { rapido: true });
      return true;
    }
    const tipoDito = lerTipoRefeicao(`Refeição: ${resto.split(/\s+/).slice(0, 3).join(' ')}`);
    if (tipoDito) resto = resto.replace(/^(caf[eé](\s+da\s+manh[ãa])?|almo[cç]o|lanche(\s+da\s+tarde)?|jantar?|ceia)\s*[:\-]?\s*/i, '').trim();
    if (!resto) {
      await enviar(jidGrupo, 'Faltou dizer o que comeu 😅', msg, { rapido: true });
      return true;
    }
    // dia e hora no fuso da pessoa (o `hora` é o do grupo, liga o registro à conversa)
    const tempo = marcaDeTempo(p);
    const horaLocal = tempo.horaLocal;
    const est = await ia.estimarRefeicaoManual({ descricao: resto, perfil: p }).catch(() => ({ estimativa: null, descricao: resto, tipo: null }));
    const slot = tipoDito || est.tipo || slotDaHora(horaLocal).id;
    await registrarRefeicao({
      jid: jids[0],
      nome: p.nome,
      dia: tempo.dia,
      hora: tempo.hora,
      horaLocal,
      minutos: tempo.minutos,
      slot,
      resumo: resto.slice(0, 120),
      descricao: est.descricao,
      estimativa: est.estimativa,
      manual: true,
      // "registra à mão uma refeição que ficou sem registro": SEMPRE uma refeição nova. Até 13/10 o !refeicao 5 min depois de
      // uma foto substituía aquela refeição (regra dos ±10 min da correção retroativa, que valia pra todo registro manual)
      sempreNova: true,
    });
    await lembrar({ hora: agora().hora, jid: jids[0], nome: p.nome, texto: `(registro manual) ${resto}`, tipo: 'texto', refeicao: slot });
    const nomeSlot = SLOTS.find((s) => s.id === slot)?.nome || slot;
    await enviar(jidGrupo, `✅ Anotei como *${nomeSlot}* (${horaLocal}): ${est.descricao}${est.estimativa ? `\n🔥 *Estimativa:*\n${formatarEstimativaLinhas(est.estimativa)}` : '\n(sem estimativa, a IA não respondeu; fica registrado mesmo assim)'}`, msg, { rapido: true });
    return true;
  }
  if (cmd === '!silencio' || cmd === '!silêncio') {
    const ms = duracaoDe(texto.slice(cmd.length).trim()) || 3600_000;
    estado.silencioAte = Date.now() + ms;
    await enviar(jidGrupo, `🤫 Tá, fico na minha por ${formatarDuracao(ms)}. Foto de comida, comando e quem me chamar pelo nome eu ainda respondo. Manda !falar se quiser me soltar antes.`, msg, { rapido: true });
    return true;
  }
  if (cmd === '!falar') {
    estado.silencioAte = 0;
    await enviar(jidGrupo, 'Voltei a falar. Sentiram minha falta? 😏', msg, { rapido: true });
    return true;
  }
  if (cmd === '!apelido') {
    const p = await buscarPerfil(jids);
    if (!p?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const valor = texto.slice(cmd.length).trim().replace(/^["']|["']$/g, '');
    if (!valor) {
      await enviar(jidGrupo, p.semApelido ? 'Você pediu pra eu te chamar só pelo nome. Quer apelido? Manda "!apelido Fulano".' : p.apelido ? `Seu apelido fixado é *${p.apelido}*. Pra trocar: "!apelido Novo". Pra tirar: "!apelido nenhum".` : 'Você não fixou apelido, então eu invento o meu 😏 Pra fixar: "!apelido Fulano". Pra eu chamar só pelo nome: "!apelido nenhum".', msg);
      return true;
    }
    if (/^(nenhum|nenhuma|nao|não|tirar|remover|off)$/i.test(valor)) {
      await salvarPerfil({ jids, apelido: '', semApelido: true });
      await enviar(jidGrupo, `Combinado, ${p.nome.split(' ')[0]}: só pelo nome daqui pra frente. 🫡`, msg);
      return true;
    }
    if (valor.length > 30) {
      await enviar(jidGrupo, 'Apelido com mais de 30 letras não é apelido, é biografia. Encurta.', msg);
      return true;
    }
    await salvarPerfil({ jids, apelido: valor.slice(0, 30), semApelido: false });
    await enviar(jidGrupo, `Anotado: você agora é *${valor}*. Vou respeitar (na maioria das vezes 😏).`, msg);
    return true;
  }
  if (cmd === '!relogio' || cmd === '!relógio') {
    // O que chegou do app Relógio (Health Connect direto do celular): último envio e números de hoje
    const p = await buscarPerfil(jids);
    if (!p?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const s = await situacaoRelogio(p, diaLocal(p)).catch(() => null);
    if (!s) {
      await enviar(jidGrupo, 'Ainda não recebi nada do seu celular. Instale o app Relógio do NutriBot (guia, seção "Dados do relógio"), coloque seu nome e o token e toque em Sincronizar.', msg, { rapido: true });
      return true;
    }
    const ha = Math.round((Date.now() - new Date(s.ultimoEnvio).getTime()) / 60000);
    const hm = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
    const linhas = [
      `⌚ *Relógio (${p.nome.split(' ')[0]})*`,
      `Último envio: há ${ha < 60 ? `${ha} min` : hm(ha)}${s.app ? ` (${s.app})` : ''} · ${s.dias} dias guardados`,
      s.passosHoje ? `Hoje: ${s.passosHoje.toLocaleString('pt-BR')} passos${s.caloriasHoje ? ` · gasto ${s.caloriasHoje.toLocaleString('pt-BR')} kcal` : ''}` : 'Hoje: sem passos ainda',
      s.treinosHoje.length ? `Treinos hoje: ${s.treinosHoje.map((t) => `${t.nome}${t.min ? ` ${t.min} min` : ''} (${t.hora})`).join(', ')}` : null,
      s.ultimaNoite ? `Última noite (${s.ultimaNoite.dia.slice(8, 10)}/${s.ultimaNoite.dia.slice(5, 7)}): ${hm(s.ultimaNoite.total)}${s.ultimaNoite.inicio ? `, deitou ${s.ultimaNoite.inicio.slice(11)} e levantou ${s.ultimaNoite.fim.slice(11)}` : ''}` : null,
      s.ultimoPeso ? `Último peso (${s.ultimoPeso.dia.slice(8, 10)}/${s.ultimoPeso.dia.slice(5, 7)} ${s.ultimoPeso.hora}): ${String(s.ultimoPeso.peso).replace('.', ',')} kg${s.ultimoPeso.gordura ? ` · ${String(s.ultimoPeso.gordura).replace('.', ',')}% gordura` : ''}` : null,
    ].filter(Boolean);
    await enviar(jidGrupo, linhas.join('\n'), msg, { rapido: true });
    return true;
  }
  if (cmd === '!agenda') {
    const perfis = await enriquecerPerfis(await listarPerfis(), dia);
    const eu = perfis.find((p) => p.jids?.some((j) => jids.includes(j)));
    if (!eu) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    if (!eu._agenda?.bloco) {
      await enviar(jidGrupo, 'Não tenho tua agenda ligada aqui 🗓️ (só leio a agenda de quem configurou a conta Google no bot).', msg, { rapido: true });
      return true;
    }
    await enviar(jidGrupo, `🗓️ *Sua agenda*\n\n${(eu._agenda.lista?.length && agendaZap(eu._agenda.lista, { perfil: eu })) || eu._agenda.bloco}`, msg, { rapido: true });
    return true;
  }

  if (cmd === '!treino') {
    const perfis = await enriquecerPerfis(await listarPerfis(), dia);
    const alvo = /\btodos?\b/i.test(texto.slice(cmd.length)) ? perfis : perfis.filter((p) => p.jids?.some((j) => jids.includes(j)));
    if (!alvo.length) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const partes = alvo.map((p) => (p._treino?.analise ? treinoZap(p._treino.analise, { nome: alvo.length > 1 ? p.nome.split(' ')[0] : null }) : `*${p.nome.split(' ')[0]}*\n• Sem treino sincronizado (o Hevy só entra pra quem tem a chave configurada)`));
    await enviar(jidGrupo, `🏋️ *Treino da semana* (Hevy, últimos 7 dias)\n\n${partes.join('\n\n')}`, msg, { rapido: true });
    return true;
  }

  if (cmd === '!grafico' || cmd === '!gráfico') {
    const todos = /\btodos?\b|\bgeral\b/i.test(texto.slice(cmd.length));
    const perfis = await listarPerfis();
    const alvo = todos ? perfis : perfis.filter((p) => p.jids?.some((j) => jids.includes(j)));
    if (!alvo.length) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    for (const p of alvo) {
      const diaP = diaLocal(p); // o "hoje" no fuso de cada um
      const desde = diasAnteriores(diaP, 30)[0];
      const [refs, pes] = await Promise.all([refeicoesDesde(p.jids || [], desde).catch(() => []), pesagensDesde(p.jids || [], desde).catch(() => [])]);
      if (refs.length + pes.length < 3) {
        await enviar(jidGrupo, `${p.apelido || p.nome.split(' ')[0]}: ainda tem pouco registro pra virar gráfico. Manda as refeições que eu desenho. 📈`, msg, { rapido: true });
        continue;
      }
      const alvoKcal = gastoAdaptativo({ refeicoes: refs, pesagens: pes, perfil: p, dia: diaP, gastos: p.relogio?.gastos }).alvo;
      const png = await renderizar(configGrafico({ nome: p.nome, refeicoes: refs, pesagens: pes, gastos: p.relogio?.gastos, alvo: alvoKcal, dia: diaP }));
      if (png) await enviarImagem(jidGrupo, png, `📈 *${p.apelido || p.nome.split(' ')[0]}* · últimos 30 dias${alvoKcal ? ` · meta ${alvoKcal.min} a ${alvoKcal.max} kcal/dia` : ''}`, msg);
      else await enviar(jidGrupo, 'O desenhista do gráfico não respondeu agora 🫠 Tenta de novo daqui a pouco.', msg, { rapido: true });
    }
    return true;
  }

  if (cmd === '!despensa' || cmd === '!nota') {
    const perfil = await buscarPerfil(jids);
    if (!perfil?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const arg = texto.slice(cmd.length).trim();
    try {
      let resposta;
      if (cmd === '!nota') {
        const q = interpretarQr(arg) || (extrairChave(arg) ? { chave: extrairChave(arg) } : null);
        // a consulta por chave na SEFAZ exige captcha (Cloudflare Turnstile em SC): o caminho que funciona sempre é a foto do cupom
        resposta = q
          ? `Chave anotada (${q.uf || 'UF ?'}, ${q.chave.slice(0, 4)}…). Pelo servidor a SEFAZ pede verificação; use o botão "Ler cupom" do app Relógio (ele abre a nota no teu celular e me manda os itens exatos) ou manda a FOTO do cupom aqui.`
          : 'Dois jeitos de entrar a compra: botão "Ler cupom" no app Relógio (QR da nota; itens e preços exatos) ou a foto do cupom aqui no grupo.';
      } else if (/^(limpar|zerar)$/i.test(arg)) {
        const n = await limparDespensa(perfil);
        resposta = `Despensa zerada (${n} registro(s) apagados). Manda um cupom novo quando quiser recomeçar.`;
      } else if (/^add\s+/i.test(arg)) {
        const m = /^add\s+(?:(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|un|unid|unidades?|pct|pacotes?|cx|caixas?)?\s+)?(.+)$/i.exec(arg);
        const r = m ? await ajustarItem(perfil, { item: m[3], acao: 'comprei', qtd: m[1] ? Number(m[1].replace(',', '.')) : 1, unidade: (m[2] || 'un').toLowerCase() }, { dia }) : null;
        resposta = r ? `Anotado na despensa: ${r.item} (${r.quantidade} ${r.unidade}).` : 'Formato: !despensa add 2 kg arroz';
      } else if (/^(tirar|acabou|remover)\s+/i.test(arg)) {
        const r = await ajustarItem(perfil, { item: arg.replace(/^(tirar|acabou|remover)\s+/i, ''), acao: 'acabou' }, { dia });
        resposta = r ? `Baixa feita: ${r.item} acabou.` : 'Não achei esse item na tua despensa. Veja !despensa.';
      } else if (/^acabando\s+/i.test(arg)) {
        const r = await ajustarItem(perfil, { item: arg.replace(/^acabando\s+/i, ''), acao: 'acabando' }, { dia });
        resposta = r ? `Anotado: ${r.item} está acabando.` : 'Não achei esse item na tua despensa.';
      } else resposta = await despensaZap(perfil);
      await enviar(jidGrupo, resposta, msg, { rapido: true });
    } catch (e) {
      console.error('[despensa]', e.message);
      await enviar(jidGrupo, 'Não consegui mexer na despensa agora.', msg, { rapido: true });
    }
    return true;
  }

  if (cmd === '!atividade' || cmd === '!atividades') {
    const perfil = await buscarPerfil(jids);
    if (!perfil?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const arg = texto.slice(cmd.length).trim();
    try {
      let resposta;
      if (/^nova\s+/i.test(arg)) {
        const r = await criarAtividade(perfil, arg.replace(/^nova\s+/i, ''));
        resposta = r.ok || r.erro;
      } else if (/^remover\s+\d+$/i.test(arg)) resposta = await removerAtividade(perfil, arg.replace(/^remover\s+/i, ''));
      else if (/^(sim|n[ãa]o|teve|n[ãa]o teve)$/i.test(arg)) resposta = (await responderPendente(perfil, arg)) || 'Não tenho nenhuma atividade em dúvida agora.';
      else resposta = atividadesZap(perfil);
      await enviar(jidGrupo, resposta, msg, { rapido: true });
    } catch (e) {
      console.error('[atividades]', e.message);
      await enviar(jidGrupo, 'Não consegui mexer nas atividades agora.', msg, { rapido: true });
    }
    return true;
  }

  if (cmd === '!proativa' || cmd === '!proatividade') {
    const r = await resumoProatividade(14).catch(() => null);
    if (!r) {
      await enviar(jidGrupo, 'Não consegui ler o histórico agora.', msg, { rapido: true });
      return true;
    }
    const linhas = r.ultimas.map((i) => `- ${i.dia.slice(8, 10)}/${i.dia.slice(5, 7)} ${i.hora} · ${i.nome.split(' ')[0]} · ${i.assunto || '(sem assunto)'}${i.respondida ? ' · respondida' : ' · sem resposta'}`);
    await enviar(jidGrupo, `🗣️ *Quando eu falei por conta própria (14 dias)*\n${r.total} no total · ${r.respondidas} respondida(s) · ${r.ignoradas} sem resposta\nFreio: 1 por dia, só entre 8h e 21h, só assunto novo, e pausa de 3 dias se 3 seguidas forem ignoradas.${linhas.length ? `\n\n${linhas.join('\n')}` : ''}`, msg, { rapido: true });
    return true;
  }
  if (cmd === '!tendencia' || cmd === '!tendência') {
    const perfil = await buscarPerfil(jids);
    if (!perfil?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    try {
      const diaP = diaLocal(perfil); // "hoje" no fuso dela: a pesagem digitada de hoje não vira "data no futuro"
      const pes = await pesagensDesde(perfil.jids, diasAnteriores(diaP, 60)[0]).catch(() => []);
      const faixa = faixaDaMeta(perfil, diaP, pes);
      // linha completa: passado (todas as semanas com pesagem), ritmo pela balança e pela comida, projeção semana a semana até a etapa
      const t = (await tendenciaCompleta(perfil, diaP).catch(() => null)) || linhaDeTendencia({ pesagens: pes, perfil, dia: diaP, alvoKgSemana: faixa?.ritmoKgSemana ?? null });
      await enviar(jidGrupo, t ? `${t.zap}\n\n_(as contas do veredito, comida x balança e a meta calibrada: !progresso)_` : 'Ainda não tenho pesagens suficientes pra uma tendência (preciso de pelo menos 4 em 10 dias ou mais). Sobe na balança do relógio que eu monto.', msg, { rapido: true });
    } catch (e) {
      console.error('[tendencia]', e.message);
      await enviar(jidGrupo, 'Não consegui montar a tendência agora.', msg, { rapido: true });
    }
    return true;
  }
  if (cmd === '!progresso') {
    // o relatório que dá pra conferir: período, pesagens, tendência com intervalo, alvo, veredito, comida x balança, meta
    // calibrada, alertas e limites (progresso.js; o mesmo veredito do !hoje, do !tendencia e do que a IA recebe)
    const perfil = await buscarPerfil(jids);
    if (!perfil?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const a = await progressoDe(perfil, diaLocal(perfil)); // "hoje" no fuso dela
    await enviar(jidGrupo, a ? a.zap : 'Não consegui montar o progresso agora.', msg, { rapido: true });
    return true;
  }

  if (cmd === '!pensamentos' || cmd === '!pensamento') {
    const perfil = await buscarPerfil(jids);
    if (!perfil?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const arg = texto.slice(cmd.length).trim().toLowerCase();
    try {
      if (/^(agora|novo|pensa)$/.test(arg)) {
        const p = await pensarSobre(perfil, { dia, persona: estado.persona, forcar: true });
        // sai no grupo: o pensamento nascido de confidência do app não aparece (D10)
        await enviar(jidGrupo, p ? `💭 ${pensamentoParaGrupo(p)}` : 'Não consegui pensar agora (a IA engasgou).', msg, { rapido: true });
      } else await enviar(jidGrupo, await pensamentosZap(perfil), msg, { rapido: true });
    } catch (e) {
      console.error('[pensamentos]', e.message);
      await enviar(jidGrupo, 'Não consegui buscar meus pensamentos agora.', msg, { rapido: true });
    }
    return true;
  }

  if (cmd === '!reflexao' || cmd === '!reflexão') {
    const perfil = await buscarPerfil(jids);
    if (!perfil?.onboarded) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const arg = texto.slice(cmd.length).trim().toLowerCase();
    if (/^(nova|agora|refazer|atualizar)$/.test(arg)) {
      await enviar(jidGrupo, 'Deixa eu pensar em você com calma. Um minutinho. 🪞', msg, { rapido: true });
      try {
        const r = await refletirSobre(perfil, { dia, persona: estado.persona, motivo: 'pedido' });
        await enviar(jidGrupo, `🪞 *Como eu te entendo hoje*\n\n${r.sintese}\n\n_O texto inteiro foi pra Nutri-Reflexoes.md, na sua pasta do Drive._`, msg, { rapido: true });
      } catch (e) {
        console.error('[reflexao]', e.message);
        await enviar(jidGrupo, 'Não consegui escrever agora (a IA engasgou). Tenta daqui a pouco.', msg, { rapido: true });
      }
      return true;
    }
    await enviar(jidGrupo, reflexaoZap(perfil), msg, { rapido: true });
    return true;
  }

  if (cmd === '!lugares') {
    const perfil = await buscarPerfil(jids);
    if (!perfil) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const arg = texto.slice(cmd.length).trim();
    try {
      let resposta;
      if (/^(esquecer|apagar|zerar)$/i.test(arg)) resposta = await esquecerLugares(perfil);
      else if (/^casa$/i.test(arg)) resposta = await marcarLugarAtual(perfil, { casa: true });
      else if (/^aqui\s+[ée]\s+/i.test(arg)) {
        // "!lugares aqui é academia Smart Fit": primeira palavra é o tipo, o resto é o nome
        const resto = arg.replace(/^aqui\s+[ée]\s+(a|o|um|uma|minha|meu)?\s*/i, '').trim();
        const [tipo, ...nome] = resto.split(/\s+/);
        resposta = await marcarLugarAtual(perfil, { tipo, nome: nome.join(' ') || null });
      } else resposta = await lugaresZap(perfil);
      await enviar(jidGrupo, resposta, msg, { rapido: true });
    } catch (e) {
      console.error('[lugares]', e.message);
      await enviar(jidGrupo, 'Não consegui mexer nos lugares agora. Tenta de novo daqui a pouco.', msg, { rapido: true });
    }
    return true;
  }

  if (cmd === '!plano') {
    const perfis = await listarPerfis();
    const perfil = perfis.find((p) => p.jids?.some((j) => jids.includes(j)));
    if (!perfil) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    void gerarPlano({ perfil, jidGrupo, msg, dia, pedidoArg: texto.slice(cmd.length).trim() }); // solto da fila (ver aceiteDePlano)
    return true;
  }

  if (cmd === '!voz') {
    // chave do grupo: liga/desliga as notas de voz que ELA decide mandar (segunda, sexta e as espontâneas). Pedido explícito sempre funciona.
    const arg = texto.slice(cmd.length).trim().toLowerCase();
    const atual = estado.config.vozLigada !== false;
    const ligar = /^(on|liga|ligar|sim|1)$/.test(arg) ? true : /^(off|desliga|desligar|n[ãa]o|0)$/.test(arg) ? false : !atual;
    estado.config = await salvarConfig({ vozLigada: ligar });
    await enviar(jidGrupo, ligar ? 'Voz ligada 🎙️ Vou mandar nota de voz na segunda de manhã, na sexta à tarde e, de vez em quando, quando o momento merecer (no máximo 2 por semana). Se pedirem "em áudio", eu falo na hora.' : 'Voz programada desligada 🤐 Só falo em áudio quando alguém pedir ("manda em áudio").', msg, { rapido: true });
    return true;
  }

  if (cmd === '!ajuda') {
    await enviar(jidGrupo, AJUDA, msg);
    return true;
  }
  return true; // começou com "!" mas não é comando conhecido: ignora em silêncio, como antes
}
