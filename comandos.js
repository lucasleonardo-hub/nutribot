// comandos.js - Comandos do grupo (!id, !nome, !perfil, !dossie, !fontes, !estudar, !persona, !status, !reset, !resumo, !ajuda).

import { buscarPerfil, apagarPerfil, salvarPerfil, listarPerfis, refeicoesDoDia } from './mongo.js';
import * as ia from './gemini.js';
import { listarDocs } from './conhecimento.js';
import { notasDe, listarDocumentosDe } from './pessoas.js';
import { reservasDisponiveis } from './reservas.js';
import { fusoDe, formatarTokens, formatarDuracao } from './util.js';
import { resumirHoje } from './resumo.js';
import { estado } from './estado.js';
import { enviar } from './whatsapp.js';
import { fecharDia, estudar } from './dia.js';
import { enriquecerPerfis } from './perfis.js';

const SEM_CADASTRO = 'Você ainda não tem cadastro, criatura. Manda nome, peso, altura, objetivo, cidade e se é vegetariana(o) que eu te cadastro. 😉';

export const AJUDA =
  'Comandos: !hoje (seus totais do dia; !hoje todos = grupo inteiro), !apelido X (fixa seu apelido; !apelido nenhum tira), !silencio 2h (não entro em papo por um tempo; !falar cancela), !id, !nome NovoNome (me rebatiza), !perfil, !dossie (sua pasta no Drive e minhas notas sobre você), !persona (o que eu já sei de vocês), !fontes (o que eu estudei), !estudar (revisa a base com estudos novos), !status (conexão, cota do Gemini e modelos), !reset, !resumo (fecha o dia agora), !ajuda';

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
      ? `${pe.nome}: ${pe.peso} kg${em('peso')}, ${pe.altura} cm, objetivo: ${pe.objetivo}${em('objetivo')}.\nMora em: ${pe.cidade ? `${pe.cidade} (fuso ${fusoDe(pe)})` : 'ainda não me contou 🗺️'}\nDieta: ${pe.dieta || 'ainda não me contou'}${pe.restricoes ? ` · restrições: ${pe.restricoes}` : ''}\nGírias que eu já peguei: ${(pe.girias || []).join(', ') || 'nenhuma ainda'}\nHorários (no seu fuso): ${pe.horarios}\nRotina: ${pe.rotina || 'ainda te observando 👀'}`
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
    await enviar(jidGrupo, `📊 *${todos ? 'Hoje, todo mundo' : 'Seu dia'} (${dia})*\n\n${resumirHoje(refeicoes, alvo, dia)}${todos ? '' : '\n\n_(!hoje todos mostra o grupo inteiro)_'}`, msg, { rapido: true });
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
  if (cmd === '!ajuda') {
    await enviar(jidGrupo, AJUDA, msg);
    return true;
  }
  return true; // começou com "!" mas não é comando conhecido: ignora em silêncio, como antes
}
