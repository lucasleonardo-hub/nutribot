// comandos.js - Comandos do grupo (!id, !nome, !perfil, !dossie, !fontes, !estudar, !persona, !status, !reset, !resumo, !ajuda).

import { buscarPerfil, apagarPerfil, salvarPerfil, listarPerfis, refeicoesDoDia, registrarRefeicao, refeicoesDesde, pesagensDesde, habitosDoDia, salvarConfig } from './mongo.js';
import { configGrafico, renderizar } from './graficos.js';
import { salvarEmPasta } from './drive.js';
import { pastaDe } from './pessoas.js';
import * as ia from './gemini.js';
import { listarDocs, docsPara } from './conhecimento.js';
import { notasDe, listarDocumentosDe } from './pessoas.js';
import { reservasDisponiveis } from './reservas.js';
import { fusoDe, formatarTokens, formatarDuracao, agora, slotDaHora, minutosDe, SLOTS, diasAnteriores } from './util.js';
import { resumirHoje, formatarEstimativa, lerTipoRefeicao, gastoAdaptativo } from './resumo.js';
import { visaoDe } from './acompanhamento.js';
import { lembrar } from './dia.js';
import { estado } from './estado.js';
import { enviar, enviarImagem } from './whatsapp.js';
import { fecharDia, estudar } from './dia.js';
import { enriquecerPerfis } from './perfis.js';

const SEM_CADASTRO = 'Você ainda não tem cadastro, criatura. Manda nome, peso, altura, objetivo, cidade e se é vegetariana(o) que eu te cadastro. 😉';

export const AJUDA =
  'Comandos: !refeicao café 2 ovos e 1 banana (registra à mão uma refeição que ficou sem registro; tipo opcional), !hoje (seus totais do dia, meta e sequência; !hoje todos = grupo inteiro), !grafico (peso, calorias, gasto e meta dos últimos 30 dias em imagem; !grafico todos), !treino (séries por grupo, volume e progressão de carga da semana, pelo Hevy), !plano (plano da semana + lista de compras, salvo na sua pasta do Drive), !voz (liga/desliga minhas notas de voz de segunda, sexta e as espontâneas; pedir "em áudio" sempre funciona), !apelido X (fixa seu apelido; !apelido nenhum tira), !silencio 2h (não entro em papo por um tempo; !falar cancela), !id, !nome NovoNome (me rebatiza), !perfil, !dossie (sua pasta no Drive e minhas notas sobre você), !persona (o que eu já sei de vocês), !fontes (o que eu estudei), !estudar (revisa a base com estudos novos), !status (conexão, cota do Gemini e modelos), !reset, !resumo (fecha o dia agora), !ajuda';

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
      ? `${pe.nome}: ${pe.peso} kg${em('peso')}, ${pe.altura} cm, objetivo: ${pe.objetivo}${em('objetivo')}${pe.metaPeso ? `\nMeta: ${String(pe.metaPeso).replace('.', ',')} kg${pe.metaPrazo ? ` até ${pe.metaPrazo}` : ''}` : ''}.\nMora em: ${pe.cidade ? `${pe.cidade} (fuso ${fusoDe(pe)})` : 'ainda não me contou 🗺️'}\nDieta: ${pe.dieta || 'ainda não me contou'}${pe.restricoes ? ` · restrições: ${pe.restricoes}` : ''}\nGírias que eu já peguei: ${(pe.girias || []).join(', ') || 'nenhuma ainda'}\nHorários (no seu fuso): ${pe.horarios}\nRotina: ${pe.rotina || 'ainda te observando 👀'}`
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
  if (cmd === '!persona') {
    await enviar(jidGrupo, estado.persona ? `🧠 *Minha memória de personalidade:*\n\n${estado.persona}` : 'Ainda tô te conhecendo, criatura. Volta depois do primeiro resumo do dia. 🙄', msg);
    return true;
  }
  if (cmd === '!status' || cmd === '!cota') {
    const u = ia.usoDeHoje();
    const modelos = ia.situacaoModelos();
    const fora = modelos.filter((m) => !m.livre);
    const lite = modelos.filter((m) => m.papel === 'leve').length;
    const linhas = [
      `🩺 *Status da ${ia.nomeDaBot()}*`,
      `No ar há ${Math.round(process.uptime() / 60)} min · hoje (${estado.memoria.dia}): ${estado.memoria.mensagens.length} mensagens na memória`,
      `Gemini hoje: ${u.chamadas} chamadas · ${formatarTokens(u.entrada)} tokens de entrada (${formatarTokens(u.cache)} em cache) · ${formatarTokens(u.saida)} de saída`,
      `Modelos: ${modelos.length} na fila (${modelos.length - lite} Flash, ${lite} Lite) · chaves do Gemini: ${ia.totalDeChaves()}${ia.totalDeChaves() > 1 ? ` (uso hoje: ${Object.entries(u.porChave || {}).map(([c, n]) => `chave ${c} = ${n}`).join(', ') || 'nenhum'})` : ''}`,
      fora.length ? `De castigo (todas as chaves): ${fora.map((m) => `${m.modelo} (volta em ${m.voltaEm})`).join(', ')}` : 'De castigo: nenhum ✅',
      `Reservas externas: ${reservasDisponiveis().join(', ') || 'nenhuma'}`,
      `Últimas respostas: ${ia.ultimasRespostas(6).map((r) => `${r.hora} ${String(r.modelo).replace(/^gemini-/, '')}${r.chave ? ` ch${r.chave}` : ''}${r.motivo ? ` (${r.motivo})` : ''}`).join(' · ') || 'nenhuma desde o último restart'}`,
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
    const visao = todos ? '' : (await visaoDe(alvo[0], dia)).replace(/^(ÚLTIMOS \d+ DIAS|BALANÇO ENERGÉTICO|META ADAPTATIVA|META \(provisória, pelo relógio\)|SEQUÊNCIA)([^:]*):/gm, '*$1$2:*');
    await enviar(jidGrupo, `📊 *${todos ? 'Hoje, todo mundo' : 'Seu dia'} (${dia})*\n\n${resumirHoje(refeicoes, alvo, dia, habitos)}${visao ? `\n\n${visao}` : ''}${todos ? '' : '\n\n_(!hoje todos mostra o grupo inteiro · !grafico mostra em imagem)_'}`, msg, { rapido: true });
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
    await enviar(jidGrupo, `✅ Anotei como *${nomeSlot}* (${horaLocal}): ${est.descricao}${est.estimativa ? `\n🔥 ${formatarEstimativa(est.estimativa)}` : '\n(sem estimativa, a IA não respondeu; fica registrado mesmo assim)'}`, msg, { rapido: true });
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
  if (cmd === '!treino') {
    const perfis = await enriquecerPerfis(await listarPerfis(), dia);
    const alvo = /\btodos?\b/i.test(texto.slice(cmd.length)) ? perfis : perfis.filter((p) => p.jids?.some((j) => jids.includes(j)));
    if (!alvo.length) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    const partes = alvo.map((p) => (p._treino?.bloco ? p._treino.bloco : `${p.nome.split(' ')[0]}: sem treino sincronizado (o Hevy só entra pra quem tem a chave configurada).`));
    await enviar(jidGrupo, `🏋️ *Treino da semana*\n\n${partes.join('\n\n')}`, msg, { rapido: true });
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

  if (cmd === '!plano') {
    const perfis = await listarPerfis();
    const perfil = perfis.find((p) => p.jids?.some((j) => jids.includes(j)));
    if (!perfil) {
      await enviar(jidGrupo, SEM_CADASTRO, msg);
      return true;
    }
    await enviar(jidGrupo, 'Montando teu plano da semana com o que você já come e a tua meta. Um minutinho. 📝', msg, { rapido: true });
    try {
      const visao = await visaoDe(perfil, dia);
      const plano = ia.separarAtualizacao(await ia.planoSemanal({ perfil, visao, conhecimento: docsPara(perfil, { texto: 'plano da semana lista de compras' }), persona: estado.persona, dia })).texto;
      if (!plano) throw new Error('plano vazio');
      await enviar(jidGrupo, plano, msg, { rapido: true });
      await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: `(plano da semana de ${perfil.nome} enviado)`, tipo: 'bot' });
      const pastaId = await pastaDe(perfil);
      await salvarEmPasta(pastaId, 'Nutri-Plano.md', `---\ntipo: plano-semanal\npessoa: ${perfil.nome}\ngerado: ${dia}\ntags: [nutribot, pessoa, plano]\n---\n\n# Plano da semana de ${perfil.nome} (${dia})\n\n${plano}\n`).catch((e) => console.error('[plano] Drive:', e.message));
    } catch (e) {
      console.error('[plano]', e.message);
      await enviar(jidGrupo, 'Não consegui fechar o plano agora (a IA engasgou). Tenta de novo em alguns minutos. 🫠', msg, { rapido: true });
    }
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
