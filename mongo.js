// mongo.js - Conexão com MongoDB Atlas + sessão do Baileys salva remotamente
// (assim o bot NÃO perde o QR Code quando o Render reinicia e apaga o disco)

import { MongoClient } from 'mongodb';
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';

let client;
let db;

export async function conectarMongo() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI não definida no .env');
  client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'nutribot');
  console.log('[mongo] conectado ao banco', db.databaseName);
  return db;
}

export function colecao(nome) {
  if (!db) throw new Error('Chame conectarMongo() antes de usar colecao()');
  return db.collection(nome);
}

/**
 * Substitui o useMultiFileAuthState do Baileys, guardando creds e chaves
 * do Signal em uma collection do Mongo (serialização com BufferJSON).
 */
export async function useMongoAuthState(nomeColecao = 'baileys_auth') {
  const col = colecao(nomeColecao);

  const escrever = (dados, id) =>
    col.replaceOne(
      { _id: id },
      { _id: id, data: JSON.stringify(dados, BufferJSON.replacer), atualizadoEm: new Date() },
      { upsert: true }
    );

  const ler = async (id) => {
    const doc = await col.findOne({ _id: id });
    return doc ? JSON.parse(doc.data, BufferJSON.reviver) : null;
  };

  const remover = (id) => col.deleteOne({ _id: id });

  const creds = (await ler('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const resultado = {};
          await Promise.all(
            ids.map(async (id) => {
              let valor = await ler(`${tipo}-${id}`);
              if (tipo === 'app-state-sync-key' && valor) {
                valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
              }
              resultado[id] = valor;
            })
          );
          return resultado;
        },
        set: async (dados) => {
          const tarefas = [];
          for (const categoria in dados) {
            for (const id in dados[categoria]) {
              const valor = dados[categoria][id];
              const chave = `${categoria}-${id}`;
              tarefas.push(valor ? escrever(valor, chave) : remover(chave));
            }
          }
          await Promise.all(tarefas);
        },
      },
    },
    saveCreds: () => escrever(creds, 'creds'),
    limparSessao: () => col.deleteMany({}),
  };
}

// ---------- Perfis dos usuários (onboarding) ----------

export async function buscarPerfil(jids) {
  return colecao('perfis').findOne({ jids: { $in: jids } });
}

export async function salvarPerfil(perfil) {
  const { _id, jids, ...resto } = perfil;
  const col = colecao('perfis');
  const existente = await col.findOne({ jids: { $in: jids } });
  if (existente) {
    const todosJids = [...new Set([...(Array.isArray(existente.jids) ? existente.jids : [existente.jids]), ...jids])];
    await col.updateOne({ _id: existente._id }, { $set: { ...resto, jids: todosJids, atualizadoEm: new Date() } });
  } else {
    await col.insertOne({ ...resto, jids: [...jids], criadoEm: resto.criadoEm || new Date(), atualizadoEm: new Date() });
  }
  return buscarPerfil(jids);
}

export async function listarPerfis() {
  return colecao('perfis').find({ onboarded: true }).toArray();
}

export async function apagarPerfil(jids) {
  await colecao('perfis').deleteOne({ jids: { $in: jids } });
}

// ---------- Memória do dia (backup da RAM, pro caso do Render reiniciar) ----------

export async function carregarMemoria() {
  return colecao('memoria').findOne({ _id: 'hoje' });
}

export async function persistirMemoria(memoria) {
  await colecao('memoria').replaceOne({ _id: 'hoje' }, { _id: 'hoje', ...memoria }, { upsert: true });
}

// ---------- Personalidade da Nutri (evolui a cada fechamento de dia) ----------

export async function carregarPersona() {
  const doc = await colecao('persona').findOne({ _id: 'nutri' });
  return doc?.texto || '';
}

export async function salvarPersona(texto) {
  await colecao('persona').replaceOne(
    { _id: 'nutri' },
    { _id: 'nutri', texto, atualizadoEm: new Date() },
    { upsert: true }
  );
}

// ---------- Refeições registradas (pra aprender a rotina de cada um e cobrar quem sumiu) ----------

export async function registrarRefeicao(r) {
  // r = { jid, nome, dia, hora, minutos, slot, resumo }
  await colecao('refeicoes').insertOne({ ...r, criadoEm: new Date() });
}

export async function refeicoesDesde(jids, diaInicial) {
  return colecao('refeicoes').find({ jid: { $in: jids }, dia: { $gte: diaInicial } }).sort({ dia: 1, minutos: 1 }).toArray();
}

export async function refeicoesDoDia(dia) {
  return colecao('refeicoes').find({ dia }).toArray();
}

// ---------- Configuração do bot (nome escolhido pelo grupo, apresentações feitas) ----------

export async function lerConfig() {
  return (await colecao('config').findOne({ _id: 'bot' })) || { _id: 'bot' };
}

export async function salvarConfig(patch) {
  await colecao('config').updateOne({ _id: 'bot' }, { $set: { ...patch, atualizadoEm: new Date() } }, { upsert: true });
  return lerConfig();
}
