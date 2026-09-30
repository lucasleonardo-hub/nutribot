// comandos.js - Comandos do grupo (!id, !nome, !perfil, !dossie, !fontes, !estudar, !persona, !status, !reset, !resumo, !ajuda).

import { buscarPerfil, apagarPerfil, salvarPerfil, listarPerfis, refeicoesDoDia, registrarRefeicao, refeicoesDesde, refeicoesGrupoDesde, pesagensDesde, habitosDoDia, salvarConfig, apagarRefeicaoPorId, registrarCorrecao, carregarAprendizados } from './mongo.js';
import { configGrafico, renderizar } from './graficos.js';
import { salvarEmPasta } from './drive.js';
import { pastaDe } from './pessoas.js';
import * as ia from './gemini.js';
import { listarDocs, docsPara } from './conhecimento.js';
import { notasDe, listarDocumentosDe } from './pessoas.js';
import { reservasDisponiveis } from './reservas.js';
import { fusoDe, formatarTokens, formatarDuracao, agora, slotDaHora, minutosDe, SLOTS, diasAnteriores } from './util.js';
import { resumirHoje, formatarEstimativaLinhas, lerTipoRefeicao, gastoAdaptativo, acharRegistro, nomeDoSlot, padraoAlimentar, repertorioDoGrupo, semanaDoPlano, previsaoSemana } from './resumo.js';
import { visaoDe } from './acompanhamento.js';
import { lembrar } from './dia.js';
import { estado } from './estado.js';
import { enviar, enviarImagem } from './whatsapp.js';
import { fecharDia, estudar } from './dia.js';
import { enriquecerPerfis } from './perfis.js';
import { situacaoRelogio } from './relogio.js';
import { treinoZap } from './treino.js';
import { agendaZap } from './agenda.js';
import { pareceAceitePlano } from './consciencia.js';
import { lugaresZap, marcarLugarAtual, esquecerLugares, mercadosProximos } from './lugares.js';
import { refletirSobre, reflexaoZap } from './reflexao.js';

const SEM_CADASTRO = 'Você ainda não tem cadastro, criatura. Manda nome, peso, altura, objetivo, cidade e se é vegetariana(o) que eu te cadastro. 😉';

export const AJUDA =
  'Comandos: !refeicao café 2 ovos e 1 banana (registra à mão uma refeição que ficou sem registro; tipo opcional), !apagar 11:03 (apaga um registro seu de hoje pela hora do !hoje; !apagar ultimo), !hoje (seus totais do dia, meta e sequência; !hoje todos = grupo inteiro), !grafico (peso, calorias, gasto e meta dos últimos 30 dias em imagem; !grafico todos), !treino (séries por grupo, volume e progressão de carga da semana, pelo Hevy), !relogio (o que chegou do seu celular: passos, sono e peso de hoje, último envio), !reflexao (como eu te entendo hoje: a síntese da minha reflexão livre sobre você, reescrita aos domingos em Nutri-Reflexoes.md na sua pasta; !reflexao nova reescreve agora), !lugares (se você ligou a localização no app: onde está agora e os lugares que frequenta, com o padrão da semana; !lugares casa, !lugares aqui é academia X, !lugares esquecer), !agenda (seus compromissos de hoje e amanhã e as janelas livres), !plano (plano da semana + lista de compras e dicas de compra barata, só com as refeições que você costuma registrar e com a meta de cada dia da semana; de sexta a domingo é o plano da semana que vem; !plano orçamento apertado, só mercado de bairro = observação que fica guardada; !plano limpar; toda sexta ao meio-dia eu pergunto quem quer e basta responder "quero"), !voz (liga/desliga minhas notas de voz de segunda, sexta e as espontâneas; pedir "em áudio" sempre funciona), !apelido X (fixa seu apelido; !apelido nenhum tira), !silencio 2h (não entro em papo por um tempo; !falar cancela), !id, !nome NovoNome (me rebatiza), !perfil, !dossie (sua pasta no Drive e minhas notas sobre você), !persona (o que eu já sei de vocês), !licoes (meu caderno de aprendizado: erros que cometi, causas e as regras que adotei), !fontes (o que eu estudei), !estudar (revisa a base com estudos novos), !status (conexão, cota do Gemini e modelos), !reset, !resumo (fecha o dia agora), !ajuda';

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
export async function gerarPlano({ perfil, jidGrupo, msg, dia, pedidoArg = '' }) {
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
  await enviar(jidGrupo, `Montando teu plano de ${rotuloSemana} com as refeições que você costuma registrar e a tua meta${pedido ? `, levando em conta: "${pedido}"` : ''}. Um minutinho. 📝`, msg, { rapido: true });
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
    const mercados = await mercadosProximos(perfil).catch(() => null);
    const gastos = comAgenda?.relogio?.gastos || perfil.relogio?.gastos;
    let metaSemana = null;
    if (gastos) {
      const meta = gastoAdaptativo({ refeicoes: minhas, pesagens, perfil, dia, gastos });
      metaSemana = previsaoSemana({ gastos, dia, objetivo: perfil.objetivo, metaAdaptativa: meta, semana })?.texto || null;
    }
    const plano = ia.separarAtualizacao(
      await ia.planoSemanal({ perfil: comAgenda, visao, conhecimento: docsPara(perfil, { texto: 'plano da semana lista de compras' }), persona: estado.persona, dia, agenda: comAgenda?._agenda?.bloco || '', padrao, grupo, pedido, semana, metaSemana, mercados, lugares: comAgenda?._lugares?.bloco || '' })
    ).texto;
    if (!plano) throw new Error('plano vazio');
    await enviar(jidGrupo, plano, msg, { rapido: true });
    await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: `(plano da semana de ${perfil.nome} enviado)`, tipo: 'bot' });
    const pastaId = await pastaDe(perfil);
    await salvarEmPasta(pastaId, 'Nutri-Plano.md', `---\ntipo: plano-semanal\npessoa: ${perfil.nome}\ngerado: ${dia}\nsemana: ${semana.inicio} a ${semana.fim}\ntags: [nutribot, pessoa, plano]\n---\n\n# Plano da semana de ${perfil.nome} (${semana.inicio} a ${semana.fim})\n\n${plano}\n`).catch((e) => console.error('[plano] Drive:', e.message));
    return true;
  } catch (e) {
    console.error('[plano]', e.message);
    await enviar(jidGrupo, 'Não consegui fechar o plano agora (a IA engasgou). Tenta de novo em alguns minutos. 🫠', msg, { rapido: true });
    return false;
  }
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
  await gerarPlano({ perfil, jidGrupo, msg, dia, pedidoArg: pedido });
  return true;
}

export async function tratarComando({ texto, jids, jidGrupo, msg, dia, nomeContato, batizar }) {
  if (!texto.startsWith('!')) return false;
  const cmd = texto.toLowerCase().split(/\s+/)[0];

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
    const refeicoes = await refeicoesDoDia(dia).catch(() => []);
    const habitos = await habitosDoDia(dia).catch(() => []);
    // só pra uma pessoa: junta a visão de 7/30 dias, meta e balanço energético (quem tem relógio), em linguagem de WhatsApp
    const visao = todos ? '' : await visaoDe(alvo[0], dia, { formato: 'zap' }); // 7/30 dias, sequência, meta e balanço em tópicos
    await enviar(jidGrupo, `📊 *${todos ? 'Hoje, todo mundo' : 'Seu dia'} (${dia})*\n\n${resumirHoje(refeicoes, alvo, dia, habitos)}${visao ? `\n\n${visao}` : ''}${todos ? '' : '\n\n_(!hoje todos mostra o grupo inteiro · !grafico mostra em imagem)_'}`, msg, { rapido: true });
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
    const minhas = (await refeicoesDoDia(dia).catch(() => [])).filter((r) => jids.includes(r.jid)).sort((a, b) => a.minutos - b.minutos);
    const alvo = acharRegistro(minhas, ref);
    if (!alvo) {
      const lista = minhas.map((r) => `${r.horaLocal || r.hora} ${nomeDoSlot(r.slot)}`).join(', ');
      await enviar(jidGrupo, minhas.length ? `Não achei registro seu às ${ref}. Os de hoje: ${lista}. Use "!apagar 11:03" ou "!apagar ultimo".` : 'Você não tem registro hoje.', msg, { rapido: true });
      return true;
    }
    await apagarRefeicaoPorId(alvo._id);
    console.log(`[refeicoes] !apagar de ${p.nome}: ${alvo.horaLocal || alvo.hora} ${alvo.slot} (~${alvo.estimativa?.kcal || '?'} kcal)`);
    registrarCorrecao({ dia, pessoa: p.nome, texto: `registro de ${nomeDoSlot(alvo.slot)} das ${alvo.horaLocal || alvo.hora} (~${alvo.estimativa?.kcal || '?'} kcal) APAGADO por ${p.nome.split(' ')[0]} (!apagar): era duplicado ou errado; qualquer total do dia dito na conversa antes disso está errado` }).catch(() => {});
    await enviar(jidGrupo, `🗑️ Apagado: ${nomeDoSlot(alvo.slot)} das ${alvo.horaLocal || alvo.hora}${alvo.estimativa?.kcal ? ` (~${Math.round(alvo.estimativa.kcal)} kcal)` : ''}. O !hoje já reflete.`, msg, { rapido: true });
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
    const horaLocal = agora(fusoDe(p)).hora;
    const est = await ia.estimarRefeicaoManual({ descricao: resto, perfil: p }).catch(() => ({ estimativa: null, descricao: resto, tipo: null }));
    const slot = tipoDito || est.tipo || slotDaHora(horaLocal).id;
    await registrarRefeicao({
      jid: jids[0],
      nome: p.nome,
      dia,
      hora: agora().hora,
      horaLocal,
      minutos: minutosDe(horaLocal),
      slot,
      resumo: resto.slice(0, 120),
      descricao: est.descricao,
      estimativa: est.estimativa,
      manual: true,
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
    const s = await situacaoRelogio(p, dia).catch(() => null);
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
    const desde = diasAnteriores(dia, 30)[0];
    for (const p of alvo) {
      const [refs, pes] = await Promise.all([refeicoesDesde(p.jids || [], desde).catch(() => []), pesagensDesde(p.jids || [], desde).catch(() => [])]);
      if (refs.length + pes.length < 3) {
        await enviar(jidGrupo, `${p.apelido || p.nome.split(' ')[0]}: ainda tem pouco registro pra virar gráfico. Manda as refeições que eu desenho. 📈`, msg, { rapido: true });
        continue;
      }
      const alvoKcal = gastoAdaptativo({ refeicoes: refs, pesagens: pes, perfil: p, dia, gastos: p.relogio?.gastos }).alvo;
      const png = await renderizar(configGrafico({ nome: p.nome, refeicoes: refs, pesagens: pes, gastos: p.relogio?.gastos, alvo: alvoKcal, dia }));
      if (png) await enviarImagem(jidGrupo, png, `📈 *${p.apelido || p.nome.split(' ')[0]}* · últimos 30 dias${alvoKcal ? ` · meta ${alvoKcal.min} a ${alvoKcal.max} kcal/dia` : ''}`, msg);
      else await enviar(jidGrupo, 'O desenhista do gráfico não respondeu agora 🫠 Tenta de novo daqui a pouco.', msg, { rapido: true });
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
    await gerarPlano({ perfil, jidGrupo, msg, dia, pedidoArg: texto.slice(cmd.length).trim() });
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
