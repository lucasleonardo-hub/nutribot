// api-auth.js - Pareamento e token de aparelho do app NutriBot (API v1). O dono manda "!app" no privado com o bot e recebe
// um código de 6 dígitos (10 min, uso único); o app troca o código por um token de 32 bytes em POST /api/v1/parear e manda
// o token em todo pedido (Authorization: Bearer). No Mongo ficam só os hashes: codigos_app guarda o sha256 do código e
// dispositivos o sha256 do token ({ hash, aparelho, criadoEm, ultimoUso, revogadoEm }). "!app sair" revoga todos.
//
// O acesso ao banco é injetado (criarAuth({ colecao })), pra testar sem Mongo. O limite de tentativas fica na memória do
// processo: o Render roda uma instância só, e um restart zera a contagem (o código vale 10 min e é de uso único, então o
// limite é segunda linha de defesa, não a primeira).

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { colecao as colecaoMongo } from './mongo.js';

export const CODIGO_VALIDADE_MIN = 10;
export const MAX_TENTATIVAS_HORA = 5; // por IP, contando só as erradas (parear um segundo celular não gasta a cota)
export const MAX_FALHAS_GLOBAIS_HORA = 20; // chute espalhado por muitos IPs: apaga o código aberto (o dono gera outro)
const HORA_MS = 3600_000;

/** sha256 em hex. */
export const sha256 = (t) => createHash('sha256').update(String(t)).digest('hex');
/** Código de 6 dígitos (com zeros à esquerda). `sortear(min, max)` é injetável pro teste. */
export const gerarCodigo = (sortear = randomInt) => String(sortear(0, 1_000_000)).padStart(6, '0');
/** Token de 32 bytes aleatórios em base64url (43 caracteres). */
export const gerarToken = () => randomBytes(32).toString('base64url');

/** Compara dois hashes hex em tempo constante; false se algum faltar ou os tamanhos diferirem. */
export function mesmoHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Erro da API no formato do contrato: o roteador transforma em { erro: { codigo, mensagem } } com o status. */
export function erroApi(status, codigo, mensagem) {
  return Object.assign(new Error(mensagem), { status, codigo });
}

/**
 * Quantos proxies acrescentam endereço no X-Forwarded-For antes do Node (API_PROXY_SALTOS; 1 = só o balanceador do Render,
 * que é o padrão seguro: o último endereço é o que ele viu). Inválido ou < 1 = 1; teto 5.
 */
export const saltosDoProxy = (v = process.env.API_PROXY_SALTOS) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 5) : 1;
};
const xffDe = (req) =>
  String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * IP de quem chamou: o endereço que o proxy mais próximo do cliente acrescentou ao X-Forwarded-For (contando `saltos` a
 * partir do fim; os anteriores o próprio cliente pode inventar), senão o do socket. Só serve pros limites de tentativas.
 */
export function ipDe(req, saltos = saltosDoProxy()) {
  const xff = xffDe(req);
  return xff[Math.max(0, xff.length - saltos)] || req?.socket?.remoteAddress || '?';
}

/**
 * Diagnóstico pra acertar o API_PROXY_SALTOS no teste de fumaça: na primeira requisição, loga QUANTOS endereços o
 * X-Forwarded-For trouxe (nunca os IPs). Uma vez por processo.
 */
export function criarDiagnosticoXff(log = (t) => console.log(t)) {
  let feito = false;
  return (req) => {
    if (feito) return;
    feito = true;
    log(`[api] x-forwarded-for com ${xffDe(req).length} endereço(s) na 1ª requisição (API_PROXY_SALTOS=${saltosDoProxy()})`);
  };
}

/**
 * Janela deslizante de eventos por chave, em memória. `registrar` e `cheia` são síncronos: conferir e contar em sequência,
 * sem await no meio, é atômico no Node (uma thread), e é isso que segura uma rajada de pedidos paralelos.
 */
function criarJanela({ max, janelaMs, agoraMs }) {
  const mapa = new Map();
  const vivos = (chave) => {
    const t = agoraMs();
    const lista = (mapa.get(chave) || []).filter((x) => t - x < janelaMs);
    if (lista.length) mapa.set(chave, lista);
    else mapa.delete(chave);
    return lista;
  };
  // chave que nunca volta (IP de passagem) só sai quando é lida de novo: varre tudo quando o mapa cresce demais
  const varrer = () => {
    if (mapa.size <= 5000) return;
    for (const k of [...mapa.keys()]) vivos(k);
  };
  return {
    cheia: (chave) => vivos(chave).length >= max,
    registrar: (chave) => {
      mapa.set(chave, [...vivos(chave), agoraMs()]);
      varrer();
    },
    /** Devolve a última tentativa contada (o acerto não gasta cota). */
    desfazer: (chave) => {
      const l = vivos(chave);
      l.pop();
      if (l.length) mapa.set(chave, l);
      else mapa.delete(chave);
    },
    limpar: (chave) => mapa.delete(chave),
  };
}

// separadores invisíveis que podem vir num código colado do WhatsApp (util.protegerNumeros põe o U+2060), por código
// numérico: escritos literalmente no fonte, um editor que limpa invisíveis quebraria a tolerância sem ninguém ver
const INVISIVEIS = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
/** Puro. O código só com os dígitos que a pessoa digitou: sem espaço e sem separador invisível. */
export const limparCodigo = (c) =>
  [...String(c ?? '')]
    .filter((ch) => !INVISIVEIS.has(ch.codePointAt(0)) && !/\s/.test(ch))
    .join('');

export const TOKEN_FORMATO = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url, sem padding
export const CACHE_APARELHOS_MS = 60_000;
export const INATIVO_DIAS = 90; // aparelho sem uso há mais que isso deixa de valer (pareia de novo com !app)
export const MAX_SEM_TOKEN = 30; // pedidos sem token válido por IP...
export const JANELA_SEM_TOKEN_MIN = 10; // ...nesta janela; depois, 429 até a janela passar

/**
 * Autenticação do app. `colecao(nome)` devolve a coleção (codigos_app, dispositivos); `agora()` o instante (injetável).
 * @returns {{ novoCodigo, parear, autenticar, revogarTodos }}
 */
export function criarAuth({ colecao = colecaoMongo, agora = () => new Date() } = {}) {
  const codigos = () => colecao('codigos_app');
  const dispositivos = () => colecao('dispositivos');
  const agoraMs = () => agora().getTime();
  const porIp = criarJanela({ max: MAX_TENTATIVAS_HORA, janelaMs: HORA_MS, agoraMs });
  const global = criarJanela({ max: MAX_FALHAS_GLOBAIS_HORA, janelaMs: HORA_MS, agoraMs });
  const semToken = criarJanela({ max: MAX_SEM_TOKEN, janelaMs: JANELA_SEM_TOKEN_MIN * 60_000, agoraMs });
  const invalido = () => erroApi(401, 'codigo_invalido', 'código inválido ou expirado');

  // hashes dos aparelhos ativos em memória por 60 s: pedido com token (certo ou errado) não vira uma consulta no Mongo do
  // bot a cada vez. Parear e revogar rodam neste processo e invalidam na hora, então a revogação continua imediata.
  let cache = { ate: 0, ativos: [] };
  const invalidarCache = () => {
    cache = { ate: 0, ativos: [] };
  };
  async function aparelhosAtivos() {
    if (agoraMs() < cache.ate) return cache.ativos;
    const ativos = await dispositivos().find({ revogadoEm: null }, { projection: { hash: 1, aparelho: 1, ultimoUso: 1 } }).toArray();
    cache = { ate: agoraMs() + CACHE_APARELHOS_MS, ativos };
    return ativos;
  }

  return {
    /** Gera um código novo (apaga os ainda não usados) e destrava o freio global. Devolve o código em claro (só pro privado). */
    async novoCodigo() {
      const codigo = gerarCodigo();
      const criadoEm = agora();
      const expiraEm = new Date(criadoEm.getTime() + CODIGO_VALIDADE_MIN * 60_000);
      await codigos().deleteMany({ usadoEm: null });
      await codigos().insertOne({ hash: sha256(codigo), criadoEm, expiraEm, usadoEm: null });
      global.limpar('*');
      return { codigo, expiraEm };
    },

    /**
     * Troca código por token (uso único, atômico). Lança 429 muitas_tentativas ou 401 codigo_invalido. A tentativa é
     * contada ANTES de qualquer await (revisão B1: contada depois, uma rajada paralela passava toda pela checagem e chegava
     * ao banco); o acerto devolve a cota. Com 20 erros na hora (de qualquer IP) o código aberto é apagado e o pareamento
     * fica travado até o dono mandar !app de novo.
     */
    async parear({ codigo, aparelho, ip = '?' } = {}) {
      if (porIp.cheia(ip)) throw erroApi(429, 'muitas_tentativas', 'muitas tentativas; tente de novo em 1 hora');
      if (global.cheia('*')) throw invalido();
      porIp.registrar(ip);
      global.registrar('*');
      if (global.cheia('*')) {
        codigos()
          .deleteMany({ usadoEm: null })
          .catch(() => {});
        console.warn(`[api] ${MAX_FALHAS_GLOBAIS_HORA} tentativas de código na última hora: código de pareamento aberto apagado (mande !app de novo)`);
        throw invalido();
      }
      // tolera o espaço do "123 456" da mensagem e o separador invisível do envio do WhatsApp, se a pessoa colar
      const c = limparCodigo(codigo);
      if (!/^\d{6}$/.test(c)) throw invalido();
      const agoraD = agora();
      const doc = await codigos().findOneAndUpdate({ hash: sha256(c), usadoEm: null, expiraEm: { $gt: agoraD } }, { $set: { usadoEm: agoraD } });
      if (!doc) throw invalido();
      porIp.desfazer(ip);
      global.desfazer('*');
      const token = gerarToken();
      const nome = String(aparelho ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'aparelho';
      await dispositivos().insertOne({ hash: sha256(token), aparelho: nome, criadoEm: agoraD, ultimoUso: agoraD, revogadoEm: null });
      invalidarCache();
      console.log(`[api] aparelho pareado: ${nome}`);
      return { token };
    },

    /**
     * Aparelho do token (ou null). Token fora do formato (43 caracteres base64url) volta null sem consultar nada. Compara o
     * hash com cada aparelho ativo em tempo constante (são poucos); aparelho parado há mais de 90 dias não vale; atualiza o
     * ultimoUso sem segurar a resposta (no máximo uma vez por minuto).
     */
    async autenticar(token) {
      if (typeof token !== 'string' || !TOKEN_FORMATO.test(token)) return null;
      const h = sha256(token);
      const d = (await aparelhosAtivos()).find((x) => mesmoHash(x.hash, h));
      if (!d) return null;
      const agoraD = agora();
      const uso = d.ultimoUso instanceof Date ? d.ultimoUso.getTime() : null;
      if (uso != null && agoraD.getTime() - uso > INATIVO_DIAS * 86400_000) return null;
      if (uso == null || agoraD.getTime() - uso >= 60_000) {
        d.ultimoUso = agoraD; // o cache acompanha (senão gravaria a cada pedido depois de 1 min)
        dispositivos()
          .updateOne({ _id: d._id }, { $set: { ultimoUso: agoraD } })
          .catch(() => {});
      }
      return { id: String(d._id), aparelho: d.aparelho };
    },

    /** Revoga todos os aparelhos e apaga código aberto. Devolve quantos aparelhos foram revogados. */
    async revogarTodos() {
      const r = await dispositivos().updateMany({ revogadoEm: null }, { $set: { revogadoEm: agora() } });
      invalidarCache();
      await codigos().deleteMany({ usadoEm: null }).catch(() => {});
      return r.modifiedCount || 0;
    },

    /** Limite de pedidos sem token válido por IP (o roteador confere antes e registra cada 401). */
    semTokenBloqueado: (ip) => semToken.cheia(ip),
    registrarSemToken: (ip) => semToken.registrar(ip),
  };
}

let padrao = null;
/** A instância do processo (a do roteador e a do "!app" no privado têm de ser a mesma, pelo limite em memória). */
export const authPadrao = () => (padrao ||= criarAuth());

/** Índices das coleções do app (idempotente; erro só é logado, como no garantirIndices). */
export async function garantirIndicesApp(colecao = colecaoMongo) {
  await Promise.all([
    colecao('dispositivos').createIndex({ hash: 1 }, { unique: true }),
    colecao('dispositivos').createIndex({ revogadoEm: 1 }),
    colecao('codigos_app').createIndex({ hash: 1 }),
    colecao('codigos_app').createIndex({ expiraEm: 1 }, { expireAfterSeconds: 86400 }), // código vencido some 1 dia depois
  ]).catch((e) => console.warn('[api] índices:', e.message));
}

/**
 * "!app" (gera código) e "!app sair" (revoga todos os aparelhos). Só o privado do ADMIN_JID chama isto (mensagens.js).
 * Devolve o texto da resposta.
 */
export async function comandoApp(texto, auth = authPadrao()) {
  const resto = String(texto || '')
    .trim()
    .replace(/^!app\b/i, '')
    .trim()
    .toLowerCase();
  if (/^(sair|revogar|desconectar)$/.test(resto)) {
    const n = await auth.revogarTodos();
    return `🔒 ${n} aparelho(s) desconectado(s) do app. Pra conectar de novo, mande !app.`;
  }
  if (resto) return 'Assim: "!app" gera o código pra conectar o app; "!app sair" desconecta todos os aparelhos.';
  const { codigo } = await auth.novoCodigo();
  // "123 456": com o espaço o envio não mexe no número (util.protegerNumeros só pega 4+ dígitos seguidos) e fica fácil de ler
  return `📱 Código do app: *${codigo.slice(0, 3)} ${codigo.slice(3)}*\nVale por ${CODIGO_VALIDADE_MIN} minutos e uma vez só. Digite no app NutriBot. (Mandar !app de novo troca o código.)`;
}
