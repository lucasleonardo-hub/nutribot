// estado.js - Estado compartilhado do bot (memória do dia, persona, config, conexão) e a fila única de trabalho.
// Os módulos leem e escrevem aqui em vez de trocar variáveis entre si; a fila garante que mensagem, fechamento do dia e
// cobrança nunca rodam ao mesmo tempo em cima da mesma memória.

import { agora } from './util.js';

export const GRUPO_PERMITIDO = (process.env.ALLOWED_GROUP_ID || '').trim(); // vazio = responde em qualquer grupo

export const estado = {
  memoria: { dia: agora().dia, grupo: GRUPO_PERMITIDO || null, mensagens: [], cobrancas: {} }, // RAM + backup no Mongo
  persona: '', // memória de personalidade da Nutri (evolui a cada fechamento de dia)
  config: { apresentadoEm: {} }, // { nomeBot, apresentadoEm: { [chaveGrupo]: ISO }, aguardandoNomeDesde }
  statusConexao: 'iniciando',
  ultimoQR: null,
  sock: null,
  fechandoDia: false,
  silencioAte: 0, // !silencio: até quando ela não entra em papo (foto, comando e menção direta continuam)
};

// Processa uma coisa por vez pra não embaralhar o contexto do dia
let fila = Promise.resolve();

/** Enfileira uma tarefa; erros são logados com o nome dado e não derrubam a fila. */
export function naFila(nome, fn) {
  fila = fila.then(fn).catch((e) => console.error(`[${nome}] erro:`, e?.message || e));
  return fila;
}
