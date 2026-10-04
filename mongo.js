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
  // waitQueueTimeoutMS: sem isso uma operação espera PARA SEMPRE por uma conexão livre quando as 5 do pool estão ocupadas
  // (ex.: gravação grande de chaves do histórico logo depois de um pareamento novo), e a fila de mensagens para sem erro
  client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 15_000, socketTimeoutMS: 45_000, connectTimeoutMS: 15_000, waitQueueTimeoutMS: 20_000 });
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
    // localização do app Relógio: ponto bruto some em 7 dias (TTL); visita é única por início
    colecao('locais_brutos').createIndex({ jid: 1, ts: 1 }, { unique: true }),
    colecao('locais_brutos').createIndex({ ts: 1 }, { expireAfterSeconds: 7 * 86400 }),
    colecao('visitas').createIndex({ jid: 1, inicio: 1 }, { unique: true }),
    colecao('notas_brutas').createIndex({ criadoEm: 1 }, { expireAfterSeconds: 3 * 86400 }), // texto de nota que o parser não leu (3 dias)
    colecao('intervencoes').createIndex({ dia: 1 }), // intervenções proativas (1 por dia no grupo)
    colecao('correcoes_estimativa').createIndex({ jid: 1, criadoEm: -1 }), // correções da pessoa (antes x depois) pra calibração
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

export async function registrarRefeicao(entrada) {
  const { slotExplicito = false, ...r } = entrada;
  // r = { jid, nome, dia, hora, minutos, slot, resumo }
  // Complemento/correção da mesma refeição poucos minutos depois ("a vitamina tem whey") atualiza o registro em vez de criar outro
  const col = colecao('refeicoes');
  // O ÚLTIMO registro da pessoa, de qualquer tipo: rótulo mandado 4 min depois do shake (que a IA chamou de "jantar")
  // e a sobremesa 7 min depois da janta (que ela chamou de "ceia") são a MESMA refeição, não uma segunda.
  // Só o registro manual (!refeicao) com tipo diferente fica separado, porque ali a pessoa disse o tipo de propósito.
  const ultima = await col.find({ jid: r.jid, dia: r.dia }).sort({ minutos: -1 }).limit(1).next();
  // mesma refeição: mesmo tipo em até 30 min; tipo diferente só funde quando não foi dito de propósito (sobremesa 7 min
  // depois da janta funde; "lanche" nomeado 1 min depois do almoço não funde, nem o registro manual)
  const mesmaRefeicao = ultima && Math.abs(r.minutos - ultima.minutos) <= 30 && (ultima.slot === r.slot || (!r.manual && !slotExplicito));
  if (mesmaRefeicao) {
    const set = { atualizadoEm: new Date() };
    // correção ("eram 2 pães", rótulo): a estimativa nova é da refeição inteira e SUBSTITUI a anterior.
    // complemento (a sobremesa 18 min depois da janta): a estimativa nova é só do item novo e SOMA na anterior.
    // (em 28/09 o brownie de 160 kcal substituiu os 420 kcal da janta do Heitor por falta desta distinção)
    if (r.estimativa) {
      // calibração: correção com estimativa anterior conhecida vira um par antes x depois (a pessoa é a fonte da verdade)
      if (r.correcao && r.correcaoEstimativa === true && ultima.estimativa?.kcal && r.estimativa?.kcal) {
        colecao('correcoes_estimativa')
          .insertOne({ jid: r.jid, nome: r.nome, dia: r.dia, slot: ultima.slot, antes: { kcal: ultima.estimativa.kcal, p: ultima.estimativa.p ?? null }, depois: { kcal: r.estimativa.kcal, p: r.estimativa.p ?? null }, origem: 'correcao', descricao: String(r.descricao || ultima.descricao || '').slice(0, 160), texto: String(r.resumo || '').slice(0, 200), criadoEm: new Date() })
          .catch(() => {});
      }
      if (r.correcao || !ultima.estimativa?.kcal) set.estimativa = r.estimativa;
      else set.estimativa = { kcal: (ultima.estimativa.kcal || 0) + (r.estimativa.kcal || 0), p: (ultima.estimativa.p || 0) + (r.estimativa.p || 0), c: (ultima.estimativa.c || 0) + (r.estimativa.c || 0), g: (ultima.estimativa.g || 0) + (r.estimativa.g || 0) };
    }
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

// ---------- Caderno de aprendizado (lições com causa e regra; as regras ativas entram no prompt) ----------
export async function carregarAprendizados() {
  return colecao('aprendizados').findOne({ _id: 'nutri' });
}
export async function salvarAprendizados({ documento, regras, dia }) {
  const anterior = await colecao('aprendizados').findOne({ _id: 'nutri' });
  if (anterior?.documento && anterior.documento !== documento) {
    const { _id, ...resto } = anterior;
    await colecao('aprendizados_historico').insertOne({ ...resto, substituidoEm: new Date() }).catch(() => {});
  }
  await colecao('aprendizados').replaceOne({ _id: 'nutri' }, { _id: 'nutri', documento, regras: regras || [], dia: dia || null, atualizadoEm: new Date() }, { upsert: true });
}

// ---------- Correções do dia (registro apagado/corrigido depois de a IA já ter falado sobre ele) ----------
// Entram nos textos noturnos (resumo, momentos, diário, memória, notas): o que foi dito na conversa antes da correção
// não pode virar "fato" na memória dela. Já aconteceu: "4.700 kcal" de registros duplicados ficou no diário e na persona.
export async function registrarCorrecao({ dia, pessoa, texto }) {
  await colecao('correcoes_dia').insertOne({ dia, pessoa, texto: String(texto).slice(0, 300), em: new Date() });
}
export async function correcoesDoDia(dia) {
  return colecao('correcoes_dia').find({ dia }).sort({ em: 1 }).toArray();
}

/** Apaga um registro pelo _id (pedido da pessoa: "remove esse almoço das 11:03", ou !apagar). */
export async function apagarRefeicaoPorId(id) {
  const r = await colecao('refeicoes').deleteOne({ _id: id });
  return r.deletedCount || 0;
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

/** Registros de todo o grupo desde um dia (repertório do que circula ali; alimenta o !plano). */
export async function refeicoesGrupoDesde(diaInicial) {
  return colecao('refeicoes').find({ dia: { $gte: diaInicial } }).sort({ dia: 1, minutos: 1 }).toArray();
}
