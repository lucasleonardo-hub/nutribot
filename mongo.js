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
  client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 15_000, socketTimeoutMS: 45_000, connectTimeoutMS: 15_000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || 'nutribot');
  console.log('[mongo] conectado ao banco', db.databaseName);
  return db;
}

/** Índices das consultas que rodam a cada mensagem (idempotente). */
export async function garantirIndices() {
  await Promise.all([
    colecao('perfis').createIndex({ jids: 1 }),
    colecao('refeicoes').createIndex({ jid: 1, dia: 1 }),
    colecao('refeicoes').createIndex({ dia: 1 }),
    colecao('arquivos_pessoa').createIndex({ arquivoId: 1 }),
    colecao('momentos').createIndex({ dia: -1 }),
    colecao('pesagens').createIndex({ jid: 1, dia: 1 }),
  ]).catch((e) => console.warn('[mongo] índices:', e.message));
}

export async function fecharMongo() {
  if (!client) return;
  await client.close().catch(() => {});
  client = null;
  db = null;
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
          // uma consulta só ($in) em vez de um findOne por chave
          const docs = await col.find({ _id: { $in: ids.map((id) => `${tipo}-${id}`) } }).toArray();
          const porId = new Map(docs.map((d) => [d._id, JSON.parse(d.data, BufferJSON.reviver)]));
          const resultado = {};
          for (const id of ids) {
            let valor = porId.get(`${tipo}-${id}`) ?? null;
            if (tipo === 'app-state-sync-key' && valor) {
              valor = proto.Message.AppStateSyncKeyData.fromObject(valor);
            }
            resultado[id] = valor;
          }
          return resultado;
        },
        set: async (dados) => {
          const ops = [];
          for (const categoria in dados) {
            for (const id in dados[categoria]) {
              const valor = dados[categoria][id];
              const chave = `${categoria}-${id}`;
              ops.push(
                valor
                  ? { replaceOne: { filter: { _id: chave }, replacement: { _id: chave, data: JSON.stringify(valor, BufferJSON.replacer), atualizadoEm: new Date() }, upsert: true } }
                  : { deleteOne: { filter: { _id: chave } } }
              );
            }
          }
          if (ops.length) await col.bulkWrite(ops, { ordered: false });
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

export async function salvarPersona(texto, dia) {
  const anterior = await colecao('persona').findOne({ _id: 'nutri' });
  if (anterior?.texto && anterior.texto !== texto) {
    // guarda a versão anterior: se uma reescrita sair ruim, dá pra voltar (collection persona_historico)
    await colecao('persona_historico').insertOne({ texto: anterior.texto, dia: anterior.dia || null, substituidoEm: new Date() }).catch(() => {});
  }
  await colecao('persona').replaceOne({ _id: 'nutri' }, { _id: 'nutri', texto, dia: dia || null, atualizadoEm: new Date() }, { upsert: true });
}

// ---------- Momentos memoráveis (memória de longo prazo: só acrescenta, nunca reescreve) ----------

export async function registrarMomentos(lista) {
  // lista = [{ dia, pessoa, texto, tipo }]
  if (!lista?.length) return;
  await colecao('momentos').insertMany(lista.map((m) => ({ ...m, criadoEm: new Date() })));
}

export async function momentosRecentes(limite = 30, pessoa) {
  const filtro = pessoa ? { pessoa } : {};
  const docs = await colecao('momentos').find(filtro).sort({ dia: -1, criadoEm: -1 }).limit(limite).toArray();
  return docs.reverse(); // mais antigo -> mais novo
}

// ---------- Refeições registradas (pra aprender a rotina de cada um e cobrar quem sumiu) ----------

export async function registrarRefeicao(r) {
  // r = { jid, nome, dia, hora, minutos, slot, resumo }
  // Complemento/correção da mesma refeição poucos minutos depois ("a vitamina tem whey") atualiza o registro em vez de criar outro
  const col = colecao('refeicoes');
  const ultima = await col.find({ jid: r.jid, dia: r.dia, slot: r.slot }).sort({ minutos: -1 }).limit(1).next();
  if (ultima && Math.abs(r.minutos - ultima.minutos) <= 30) {
    const set = { atualizadoEm: new Date() };
    if (r.estimativa) set.estimativa = r.estimativa; // estimativa corrigida substitui a anterior
    if (r.correcao) {
      // correção ("não é picanha, é fígado"): a descrição nova SUBSTITUI a antiga
      if (r.descricao) set.descricao = r.descricao.slice(0, 220);
      set.resumo = `${ultima.resumo || ''} (corrigido)`.slice(0, 200);
    } else {
      // complemento ("a vitamina tem whey"): soma
      set.resumo = ([ultima.resumo, r.resumo].filter((t) => t && t !== '[foto]').join(' + ') || ultima.resumo || r.resumo || '').slice(0, 200);
      const contem = (a, b) => a && b && a.toLowerCase().includes(b.toLowerCase().slice(0, 40));
      if (r.descricao && r.descricao !== ultima.descricao && !contem(ultima.descricao, r.descricao) && !contem(r.descricao, ultima.descricao)) {
        set.descricao = `${ultima.descricao || ''}${ultima.descricao ? ' (+ ' : ''}${r.descricao}${ultima.descricao ? ')' : ''}`.slice(0, 220);
      }
    }
    await col.updateOne({ _id: ultima._id }, { $set: set });
    return;
  }
  await col.insertOne({ ...r, criadoEm: new Date() });
}

/** Ajusta campos de um registro (ex.: tipo da refeição quando a pessoa diz "era o lanche da tarde"). */
export async function atualizarRefeicao(id, set) {
  await colecao('refeicoes').updateOne({ _id: id }, { $set: { ...set, atualizadoEm: new Date() } });
}

/** Apaga o registro de uma refeição específica (revisão descobriu que não era comida consumida). Devolve quantos apagou. */
export async function apagarRefeicaoEm({ jid, dia, slot, minutos }) {
  const r = await colecao('refeicoes').deleteOne({ jid, dia, slot, minutos });
  return r.deletedCount || 0;
}

export async function refeicoesDesde(jids, diaInicial) {
  return colecao('refeicoes').find({ jid: { $in: jids }, dia: { $gte: diaInicial } }).sort({ dia: 1, minutos: 1 }).toArray();
}

export async function refeicoesDoDia(dia) {
  return colecao('refeicoes').find({ dia }).toArray();
}

// ---------- Pesagens (peso com data, pra evolução) ----------

export async function registrarPesagem({ jid, nome, dia, peso, gordura, fonte }) {
  // uma por pessoa por dia: a última vale. fonte 'relogio' = veio da planilha do Galaxy Watch (saude.js)
  const doc = { jid, nome, dia, peso, criadoEm: new Date() };
  if (gordura != null) doc.gordura = gordura;
  if (fonte) doc.fonte = fonte;
  await colecao('pesagens').replaceOne({ jid, dia }, doc, { upsert: true });
}

/** Última pesagem da pessoa (qualquer fonte). */
export async function ultimaPesagem(jids) {
  return colecao('pesagens').find({ jid: { $in: jids } }).sort({ dia: -1 }).limit(1).next();
}

export async function pesagensDesde(jids, diaInicial) {
  return colecao('pesagens').find({ jid: { $in: jids }, dia: { $gte: diaInicial } }).sort({ dia: 1 }).toArray();
}

// ---------- Diário pessoal da Nutri (ela escreve toda noite; só acrescenta) ----------

export async function registrarDiarioNutri({ dia, texto }) {
  await colecao('diario_nutri').replaceOne({ _id: dia }, { _id: dia, dia, texto, criadoEm: new Date() }, { upsert: true });
}

export async function diarioNutriRecente(limite = 3) {
  const docs = await colecao('diario_nutri').find({}).sort({ dia: -1 }).limit(limite).toArray();
  return docs.reverse();
}

// ---------- Mensagens ainda não processadas (salvas no desligamento, reprocessadas no boot) ----------

export async function salvarPendentes(lista) {
  // lista = [{ id, b64 }]  (proto.WebMessageInfo codificado)
  const col = colecao('fila_pendente');
  await col.deleteMany({});
  if (lista?.length) await col.insertMany(lista.map((m) => ({ ...m, salvoEm: new Date() })));
}

export async function carregarPendentes() {
  const col = colecao('fila_pendente');
  const docs = await col.find({}).sort({ salvoEm: 1 }).toArray();
  if (docs.length) await col.deleteMany({});
  return docs;
}

// ---------- Respostas dadas por reserva externa, à espera de revisão pelo Gemini (revisao.js) ----------

export async function salvarRevisaoPendente(doc) {
  await colecao('revisoes_pendentes').insertOne({ ...doc, criadoEm: new Date() });
}

export async function revisoesPendentes(limite = 5) {
  return colecao('revisoes_pendentes').find({}).sort({ criadoEm: 1 }).limit(limite).toArray();
}

export async function apagarRevisaoPendente(id) {
  await colecao('revisoes_pendentes').deleteOne({ _id: id });
}

// ---------- Previsões semanais ("nesse ritmo, domingo que vem você está com X kg") ----------

export async function salvarPrevisao(p) {
  // uma por pessoa por domingo: refazer o resumo no mesmo dia substitui
  await colecao('previsoes').replaceOne({ jid: p.jid, feitaEm: p.feitaEm }, { ...p, criadoEm: new Date() }, { upsert: true });
}

/** Previsão ainda não conferida cujo alvo é hoje (ou já passou). */
export async function previsaoAberta(jids, dia) {
  return colecao('previsoes')
    .find({ jid: { $in: jids }, conferida: { $ne: true }, alvoDia: { $lte: dia } })
    .sort({ alvoDia: -1 })
    .limit(1)
    .next();
}

export async function marcarPrevisaoConferida(id, resultado) {
  await colecao('previsoes').updateOne({ _id: id }, { $set: { conferida: true, resultado, conferidaEm: new Date() } });
}

// ---------- Hábitos do dia (água em ml, álcool em doses), somados por pessoa e dia ----------

export async function registrarHabito({ jid, nome, dia, agua_ml = 0, alcool_doses = 0 }) {
  const inc = {};
  if (agua_ml > 0) inc.agua_ml = Math.min(agua_ml, 5000);
  if (alcool_doses > 0) inc.alcool_doses = Math.min(alcool_doses, 20);
  if (!Object.keys(inc).length) return;
  await colecao('habitos').updateOne({ jid, dia }, { $inc: inc, $set: { nome, atualizadoEm: new Date() }, $setOnInsert: { criadoEm: new Date() } }, { upsert: true });
}

export async function habitosDoDia(dia) {
  return colecao('habitos').find({ dia }).toArray();
}

// ---------- Configuração do bot (nome escolhido pelo grupo, apresentações feitas) ----------

export async function lerConfig() {
  return (await colecao('config').findOne({ _id: 'bot' })) || { _id: 'bot' };
}

export async function salvarConfig(patch) {
  const doc = await colecao('config').findOneAndUpdate(
    { _id: 'bot' },
    { $set: { ...patch, atualizadoEm: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
  return doc || { _id: 'bot' };
}
