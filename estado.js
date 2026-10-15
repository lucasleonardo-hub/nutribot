// estado.js - Estado compartilhado do bot (memória do dia, persona, config, conexão) e a fila única de trabalho.
// Os módulos leem e escrevem aqui em vez de trocar variáveis entre si; a fila garante que mensagem, fechamento do dia e
// cobrança nunca rodam ao mesmo tempo em cima da mesma memória.

import { agora } from './util.js';

export const GRUPO_PERMITIDO = (process.env.ALLOWED_GROUP_ID || '').trim(); // vazio = responde em qualquer grupo

export const estado = {
  memoria: { dia: agora().dia, grupo: GRUPO_PERMITIDO || null, mensagens: [], cobrancas: {} }, // RAM + backup no Mongo
  persona: '', // memória de personalidade da Nutri (evolui a cada fechamento de dia)
  config: { apresentadoEm: {} }, // { nomeBot, apresentadoEm: { [chaveGrupo]: ISO }, aguardandoNomeDesde, vozLigada, silencioAte }
  statusConexao: 'iniciando',
  ultimoQR: null,
  sock: null,
  fechandoDia: false,
  // silencioAte (ms; 0 = falando): definido logo abaixo, persistido em config
};

// !silencio / !falar e o app (PUT /config) escrevem `estado.silencioAte = ms`. Até a fase 6 isso vivia só na memória e se
// perdia no restart (o Render reinicia sozinho). Agora a escrita também vai pro documento `config` do Mongo
// (config.silencioAte, ISO ou null) e a leitura, enquanto este processo não escreveu nada, vem do estado.config que o boot
// carrega do Mongo (lerConfig). Quem lê e escreve continua usando o mesmo campo, sem saber disso.
let silencioLocal = null; // null = este processo ainda não definiu: vale o que veio do Mongo
const msDe = (v) => {
  if (v == null || v === '' || v === 0) return 0;
  const n = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
let persistirSilencio = async (ms) => {
  const { salvarConfig } = await import('./mongo.js');
  await salvarConfig({ silencioAte: ms ? new Date(ms).toISOString() : null });
};
/** Troca a gravação do silêncio (teste). */
export function definirPersistenciaSilencio(fn) {
  persistirSilencio = fn;
}
Object.defineProperty(estado, 'silencioAte', {
  enumerable: true,
  get() {
    return silencioLocal != null ? silencioLocal : msDe(estado.config?.silencioAte);
  },
  set(v) {
    const ms = msDe(v);
    silencioLocal = ms;
    if (estado.config && typeof estado.config === 'object') estado.config.silencioAte = ms ? new Date(ms).toISOString() : null;
    Promise.resolve()
      .then(() => persistirSilencio(ms))
      .catch((e) => {
        if (!/conectarMongo/.test(String(e?.message))) console.warn('[estado] silêncio não foi pro Mongo:', e?.message || e);
      });
  },
});

// Processa uma coisa por vez pra não embaralhar o contexto do dia
let fila = Promise.resolve();

/** Enfileira uma tarefa; erros são logados com o nome dado e não derrubam a fila. */
export function naFila(nome, fn) {
  fila = fila.then(fn).catch((e) => console.error(`[${nome}] erro:`, e?.message || e));
  return fila;
}
