// api-lacunas.js - Rotas da fase 7 da API v1 (docs/app/2026-10-15-plano-fase7.md, frente A): o que existe no WhatsApp e
// faltava no app. Despensa completa e compras, atividades fixas, lugares (só do dono), agenda do Google (só leitura, só do
// dono da credencial), configurações do bot (mudança só do dono, D14), lições, persona, base de conhecimento, proatividade,
// momentos, documentos, status, resumo do dia e falas (D20), previsões, água e álcool, histórico de perguntas do app e o
// pedido de plano da semana (D13: o plano pedido pelo app também chega completo no grupo, pra quem não tem o app).
//
// Camadas iguais às do api.js: a rota valida (api-lacunas-montadores.js, puro), busca/grava por `lacunas` (lacunasPadrao()
// ou um dublê no teste) e monta o JSON. Nenhuma rota chama IA, exceto o plano, que é a mesma geração do "!plano".
// Montado por api.js dentro do roteador autenticado (rotasDeLacunas(r, {...})), antes do 404.

import { erroApi } from './api-auth.js';
import { termosDeLugar } from './api-montadores.js';
import { diasAnteriores, fusoDe } from './util.js';
import { estado } from './estado.js';
import { montarPergunta } from './perguntas.js';
import * as M from './api-lacunas-montadores.js';

const prazo = (p, ms, rotulo) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${rotulo} demorou demais`)), ms))]);
const driveLigado = () => Boolean((process.env.DRIVE_FOLDER_ID || '').trim());
const inteiro = (v, { padrao, min, max, rotulo }) => {
  const n = v == null || v === '' ? padrao : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw erroApi(400, 'pedido_invalido', `${rotulo} entre ${min} e ${max}`);
  return n;
};

// ============================================================
// Acesso padrão (Mongo, Drive, módulos do bot), por import dinâmico: vários módulos daqui importam o whatsapp.js e o
// gemini.js, que não precisam carregar só porque o roteador nasceu
// ============================================================
export function lacunasPadrao() {
  const mongo = () => import('./mongo.js');
  const col = async (nome) => (await mongo()).colecao(nome);
  const doJid = (perfil) => ({ $in: perfil.jids || [] });
  return {
    // ---------- despensa ----------
    listarDespensa: async (perfil, { incluirAcabou = false } = {}) => (await import('./despensa.js')).listarDespensa(perfil, { incluirAcabou }),
    ajustarItem: async (perfil, args, opts) => (await import('./despensa.js')).ajustarItem(perfil, args, opts),
    removerItem: async (perfil, k) => (await import('./despensa.js')).removerItem(perfil, k),
    limparDespensa: async (perfil) => (await import('./despensa.js')).limparDespensa(perfil),
    notasDesde: async (perfil, desde) => (await col('notas')).find({ jid: doJid(perfil), dia: { $gte: desde } }).sort({ dia: -1, criadoEm: -1 }).limit(60).toArray(),
    /** Lê o cupom em segundo plano (Gemini + Open Food Facts pode passar de 1 min); o grupo recebe a confirmação curta, como no /nota. */
    receberNota: async ({ perfil, chave, url, texto, dia }) => {
      const [{ receberNotaDoApp }, { enviar }, { lembrar }] = await Promise.all([import('./despensa.js'), import('./whatsapp.js'), import('./dia.js')]);
      const grupo = estado.memoria.grupo;
      const avisarGrupo = grupo
        ? async (t) => {
            await enviar(grupo, t);
            await lembrar({ hora: (await import('./util.js')).agora().hora, jid: perfil.jids?.[0], nome: perfil.nome, texto: '(leu o cupom do mercado pelo app)', tipo: 'texto' }).catch(() => {});
          }
        : null;
      return receberNotaDoApp({ perfil, chave, url, texto, dia, avisarGrupo });
    },

    // ---------- atividades fixas ----------
    criarAtividade: async (perfil, v) => (await import('./atividades.js')).criarAtividadeDeObjeto(perfil, v),
    removerAtividade: async (perfil, aid) => (await import('./atividades.js')).removerAtividadePorId(perfil, aid),
    responderAtividade: async (perfil, r) => (await import('./atividades.js')).responderAtividade(perfil, r),
    editarAtividade: async (perfil, aid, v) => (await import('./atividades.js')).editarAtividadePorId(perfil, aid, v),
    avisarAtividade: async (perfil, r) => (await import('./atividades.js')).avisarAtividade(perfil, r),

    // ---------- lugares (só do dono) ----------
    situacaoAtual: async (perfil) => (perfil.lugaresAtivo ? (await import('./lugares.js')).situacaoAtual(perfil) : null),
    marcarLugar: async (perfil, lid, m) => (await import('./lugares.js')).marcarLugarPorId(perfil, lid, m),
    esquecerLugares: async (perfil) => (await import('./lugares.js')).esquecerLugares(perfil),

    // ---------- agenda do Google ----------
    ehDonoDaAgenda: async (perfil) => (await import('./agenda.js')).ehDonoDaAgenda(perfil),
    agendaDe: async (perfil, { dias }) => (await import('./agenda.js')).agendaDe(perfil, { dias }),

    // ---------- configurações ----------
    config: () => ({ config: estado.config || {}, silencioAteMs: estado.silencioAte, nomeBot: estado.config?.nomeBot || process.env.BOT_NOME || 'Nutri' }),
    salvarVoz: async (ligada) => {
      estado.config = await (await mongo()).salvarConfig({ vozLigada: ligada });
    },
    definirSilencio: async (ms) => {
      estado.silencioAte = ms; // estado.js grava no Mongo (config.silencioAte) e o restart não perde
    },

    // ---------- Nutri ----------
    licoes: async () => (await mongo()).carregarAprendizados(),
    persona: async () => {
      const [doc, historico] = await Promise.all([(await col('persona')).findOne({ _id: 'nutri' }), (await col('persona_historico')).find({}).sort({ substituidoEm: -1 }).limit(10).toArray()]);
      return { doc, historico };
    },
    conhecimento: async () => (await import('./conhecimento.js')).listarDocs(),
    docConhecimento: async (id) => {
      const d = await (await col('conhecimento')).findOne({ _id: String(id) });
      return d ? { ...d, id: d._id } : null;
    },
    estudar: async ({ dia }) => (await import('./dia.js')).estudar({ dia, motivo: 'pedido pelo app' }),
    proatividade: async (dias) => (await import('./proatividade.js')).resumoProatividade(dias),
    momentos: async (desde) => (await col('momentos')).find({ dia: { $gte: desde } }).sort({ dia: -1, criadoEm: -1 }).limit(60).toArray(),

    // ---------- documentos e status ----------
    documentos: async (perfil) => {
      const analisados = await (await col('documentos_pessoa')).find({ jid: doJid(perfil) }).project({ nome: 1, tipo: 1, data: 1, resumo: 1, modificado: 1 }).toArray();
      if (!driveLigado()) return { arquivos: null, analisados, pastaId: null };
      const p = await import('./pessoas.js');
      const [arquivos, pastaId] = await Promise.all([prazo(p.listarDocumentosDe(perfil), 8000, 'Drive').catch(() => null), prazo(p.pastaDe(perfil), 8000, 'Drive').catch(() => null)]);
      return { arquivos, analisados, pastaId };
    },
    status: async () => {
      const [ia, { reservasDisponiveis }, { desconectadoHaMin }] = await Promise.all([import('./gemini.js'), import('./reservas.js'), import('./whatsapp.js')]);
      return { uptimeSeg: process.uptime(), conexao: estado.statusConexao, desconectadoHaMin: estado.statusConexao === 'conectado' ? 0 : desconectadoHaMin(), dia: estado.memoria.dia, mensagensHoje: estado.memoria.mensagens.length, uso: ia.usoDeHoje(), modelos: ia.situacaoModelos(), reservas: reservasDisponiveis() };
    },

    // ---------- resumo do dia, falas, previsões ----------
    /** O resumo do dia: do Mongo (`relatorios`, quando o fechamento grava) ou do Drive (Resumos/AAAA-MM-DD.md), com prazo. */
    resumoDoDia: async (dia) => {
      const doc = await (await col('relatorios')).findOne({ tipo: 'dia', dia }).catch(() => null);
      if (doc?.texto) return doc.texto;
      if (!driveLigado()) return null;
      return prazo((await import('./drive.js')).lerMarkdown('Resumos', `${dia}.md`), 6000, 'Drive').catch(() => null);
    },
    falas: async (de, ate) => (await col('falas')).find({ dia: { $gte: de, $lte: ate } }).sort({ dia: -1, criadoEm: -1 }).limit(60).toArray(),
    previsoes: async (perfil, n) => (await col('previsoes')).find({ jid: doJid(perfil) }).sort({ feitaEm: -1 }).limit(n).toArray(),

    // ---------- água e álcool ----------
    habitosDe: async (perfil, dia) => {
      const docs = await (await col('habitos')).find({ jid: doJid(perfil), dia }).toArray();
      return docs.reduce((a, d) => ({ agua_ml: a.agua_ml + (Number(d.agua_ml) || 0), alcool_doses: a.alcool_doses + (Number(d.alcool_doses) || 0) }), { agua_ml: 0, alcool_doses: 0 });
    },
    registrarHabito: async (perfil, { dia, aguaMl, alcoolDoses }) => (await mongo()).registrarHabito({ jid: perfil.jids[0], nome: perfil.nome, dia, agua_ml: aguaMl, alcool_doses: alcoolDoses }),

    // ---------- perguntas do app ----------
    perguntasDe: async (perfil, opts) => (await import('./perguntas.js')).perguntasDe(perfil.jids || [], opts),
    apagarPergunta: async (perfil, id) => (await import('./perguntas.js')).apagarPergunta(perfil.jids || [], id),
    apagarPerguntas: async (perfil) => (await import('./perguntas.js')).apagarPerguntasDe(perfil.jids || []),

    // ---------- plano da semana ----------
    whatsappPronto: () => estado.statusConexao === 'conectado' && Boolean(estado.memoria.grupo),
    /** A mesma geração do "!plano": avisa e manda o plano completo no grupo, grava no Drive e em `planos` (a aba Plano lê de lá). */
    gerarPlano: async ({ perfil, dia, pedido }) => (await import('./comandos.js')).gerarPlano({ perfil, jidGrupo: estado.memoria.grupo, msg: null, dia, pedidoArg: pedido, origem: 'app' }),
  };
}

// ============================================================
// Rotas
// ============================================================
/**
 * Registra as rotas no roteador `r` (já autenticado). `perfilDo(req)` vem do api.js ({ perfil, perfis, hoje, hora }),
 * `listarPerfis()` também; `adminJid` marca o dono do grupo; `agora()` o instante.
 */
export function rotasDeLacunas(r, { lacunas = lacunasPadrao(), perfilDo, listarPerfis, adminJid = '', agora = () => new Date(), lerJsonNota = (_req, _res, next) => next() }) {
  // ---------- quem é o dono (D14) ----------
  // Quem é o aparelho vem do pareamento (req.aparelho.dono = jid de quem mandou o !app), nunca de cabeçalho, query ou
  // corpo do pedido. Aparelho pareado antes desse campo existir não tem `dono`: o !app sempre foi só do privado do admin,
  // então vale como do admin.
  const jidDoAparelho = (req) => req.aparelho?.dono || adminJid;
  const aparelhoDoDono = (req) => Boolean(adminJid) && jidDoAparelho(req) === adminJid;
  const soDono = (perfil, req) => {
    if (!aparelhoDoDono(req) || !M.ehDono(perfil, adminJid)) throw erroApi(403, 'so_dono', 'só o aparelho do dono do grupo pode fazer isso');
  };
  /** As rotas sem :id (/config, /sistema/status, estudar) valem para o perfil do próprio aparelho, se ele for o do dono. */
  async function exigirDonoSemId(req) {
    if (!aparelhoDoDono(req)) throw erroApi(403, 'so_dono', 'só o aparelho do dono do grupo pode fazer isso');
    const perfil = (await listarPerfis()).find((p) => M.ehDono(p, adminJid));
    if (!perfil) throw erroApi(403, 'so_dono', 'só o aparelho do dono do grupo pode fazer isso');
    return perfil;
  }
  const termos = (perfis) => termosDeLugar(perfis);

  // ============ despensa (W12–W16, W51) ============
  const despensaDe = async (perfil, hoje, incluirAcabou = false) => M.montarDespensa({ itens: await lacunas.listarDespensa(perfil, { incluirAcabou }), hoje });

  r.get('/perfis/:id/despensa', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const acabou = req.query.acabou == null || req.query.acabou === '' ? '0' : String(req.query.acabou);
    if (!/^[01]$/.test(acabou)) throw erroApi(400, 'pedido_invalido', 'acabou: 0 ou 1');
    res.json(await despensaDe(perfil, hoje, acabou === '1'));
  });

  r.post('/perfis/:id/despensa', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const v = M.validarItemDespensa(req.body);
    const doc = await lacunas.ajustarItem(perfil, { item: v.item, acao: 'comprei', qtd: v.qtd, unidade: v.unidade, categoria: v.categoria }, { dia: hoje });
    if (!doc) throw erroApi(503, 'despensa_indisponivel', 'não consegui gravar na despensa agora; tente de novo');
    res.status(201).json({ item: M.montarItemDespensa(doc, hoje) });
  });

  r.put('/perfis/:id/despensa/:k', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const v = M.validarAcaoDespensa(req.body);
    const doc = await lacunas.ajustarItem(perfil, { k: req.params.k, acao: v.acao, qtd: v.qtd, unidade: v.unidade }, { dia: hoje });
    if (!doc) throw erroApi(404, 'item_nao_encontrado', 'item não encontrado na despensa');
    res.json({ item: M.montarItemDespensa(doc, hoje) });
  });

  r.delete('/perfis/:id/despensa/:k', async (req, res) => {
    const { perfil } = await perfilDo(req);
    const n = await lacunas.removerItem(perfil, req.params.k);
    if (!n) throw erroApi(404, 'item_nao_encontrado', 'item não encontrado na despensa');
    res.json({ apagado: true });
  });

  r.delete('/perfis/:id/despensa', async (req, res) => {
    const { perfil } = await perfilDo(req);
    if (req.query.confirmar !== 'sim') throw erroApi(400, 'confirmacao', 'para zerar a despensa mande ?confirmar=sim');
    res.json({ apagados: await lacunas.limparDespensa(perfil) });
  });

  r.get('/perfis/:id/compras', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const dias = inteiro(req.query.dias, { padrao: 28, min: 1, max: 120, rotulo: 'dias' });
    const desde = diasAnteriores(hoje, dias)[0];
    const [notas, itens] = await Promise.all([lacunas.notasDesde(perfil, desde), lacunas.listarDespensa(perfil, { incluirAcabou: true })]);
    res.json(M.montarCompras({ notas, itens, hoje, dias }));
  });

  // o texto da página da nota pode passar de 32 kb: este corpo é lido aqui (o api.js deixa esta rota fora do leitor pequeno)
  r.post('/perfis/:id/compras', lerJsonNota, async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const v = M.validarCompra(req.body);
    res.status(202).json({ recebido: true, mensagem: 'Cupom recebido. Estou lendo e aviso no grupo quando entrar na despensa.' });
    const inicio = Date.now();
    lacunas
      .receberNota({ perfil, chave: v.chave, url: v.url, texto: v.texto, dia: hoje })
      .then((x) => console.log(`[api] cupom pelo app de ${perfil.nome}: ${x?.ok ? `${x.itens} itens${x.repetida ? ' (repetido)' : ''}` : x?.erro || 'sem itens'} em ${Math.round((Date.now() - inicio) / 1000)} s`))
      .catch((e) => console.warn('[api] cupom pelo app falhou:', e?.message || e));
  });

  // ============ atividades fixas (W17–W20) ============
  r.get('/perfis/:id/atividades', async (req, res) => {
    const { perfil, perfis, hoje, hora } = await perfilDo(req);
    res.json(M.montarAtividades({ perfil, dia: hoje, hora, termos: termos(perfis) }));
  });

  // editar (mesmo id e histórico) e o aviso antes ("vai ter hoje?"): pedido do dono em 15/10
  r.put('/perfis/:id/atividades/:aid', async (req, res) => {
    const { perfil, perfis } = await perfilDo(req);
    const v = M.validarAtividade(req.body);
    const x = await lacunas.editarAtividade(perfil, req.params.aid, v);
    if (!x) throw erroApi(404, 'atividade_nao_encontrada', 'atividade não encontrada');
    if (x.erro) throw erroApi(400, 'pedido_invalido', x.erro);
    res.json({ atividade: M.montarAtividade(x.atividade, { peso: perfil.peso, termos: termos(perfis) }) });
  });

  r.post('/perfis/:id/atividades/:aid/aviso', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const v = M.validarAvisoAtividade(req.body, { hoje });
    const a = (perfil.atividades || []).find((x) => String(x.id) === String(req.params.aid));
    if (!a) throw erroApi(404, 'atividade_nao_encontrada', 'atividade não encontrada');
    if (!(a.dias || []).includes(M.diaDaSemana(v.dia))) throw erroApi(400, 'dia_invalido', `${a.nome} não acontece nesse dia da semana`);
    const x = await lacunas.avisarAtividade(perfil, { id: a.id, dia: v.dia, valor: v.valor });
    if (!x) throw erroApi(404, 'atividade_nao_encontrada', 'atividade não encontrada');
    if (x.conflito) throw erroApi(409, 'ja_registrada', `esse dia já está registrado como ${x.feita ? 'feito' : 'não feito'}; use "teve / não teve" para corrigir`);
    res.json(x);
  });

  r.post('/perfis/:id/atividades', async (req, res) => {
    const { perfil, perfis } = await perfilDo(req);
    const v = M.validarAtividade(req.body);
    const x = await lacunas.criarAtividade(perfil, v);
    if (x?.erro) throw erroApi(400, 'pedido_invalido', x.erro);
    res.status(201).json({ atividade: M.montarAtividade(x.atividade, { peso: perfil.peso, termos: termos(perfis) }) });
  });

  r.delete('/perfis/:id/atividades/:aid', async (req, res) => {
    const { perfil } = await perfilDo(req);
    const rem = await lacunas.removerAtividade(perfil, req.params.aid);
    if (!rem) throw erroApi(404, 'atividade_nao_encontrada', 'atividade não encontrada');
    res.json({ apagada: true });
  });

  r.post('/perfis/:id/atividades/:aid/resposta', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const v = M.validarRespostaAtividade(req.body, { hoje });
    const x = await lacunas.responderAtividade(perfil, { id: req.params.aid, dia: v.dia, feita: v.feita });
    if (!x) throw erroApi(404, 'atividade_nao_encontrada', 'atividade não encontrada');
    res.json({ dia: v.dia, feita: Boolean(x.feita), kcal: Math.round(Number(x.kcal) || 0), somadas: Math.round(Number(x.somadas) || 0) });
  });

  // ============ lugares (W23–W25): só o perfil do dono ============
  r.get('/perfis/:id/lugares', async (req, res) => {
    const { perfil } = await perfilDo(req);
    soDono(perfil, req);
    const situacao = await lacunas.situacaoAtual(perfil).catch(() => null);
    res.json(M.montarLugares({ perfil, situacao }));
  });

  r.put('/perfis/:id/lugares/:lid', async (req, res) => {
    const { perfil } = await perfilDo(req);
    soDono(perfil, req);
    const m = M.validarMarcacaoLugar(req.body);
    const l = await lacunas.marcarLugar(perfil, req.params.lid, m);
    if (!l) throw erroApi(404, 'lugar_nao_encontrado', 'lugar não encontrado');
    res.json({ lugar: M.montarLugar(l) });
  });

  r.delete('/perfis/:id/lugares', async (req, res) => {
    const { perfil } = await perfilDo(req);
    soDono(perfil, req);
    if (req.query.confirmar !== 'sim') throw erroApi(400, 'confirmacao', 'para esquecer os lugares mande ?confirmar=sim');
    await lacunas.esquecerLugares(perfil);
    res.json({ apagado: true });
  });

  // ============ agenda do Google (W26): só leitura, só do dono da credencial ============
  r.get('/perfis/:id/agenda-google', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const dias = inteiro(req.query.dias, { padrao: 7, min: 1, max: 14, rotulo: 'dias' });
    // quem não é dono da credencial recebe a agenda vazia (a agenda é de uma pessoa só; nada dela vaza pras outras)
    // e só pelo aparelho dessa pessoa (o dono vem do pareamento, como nas outras rotas do dono)
    const doAparelho = Array.isArray(perfil?.jids) && perfil.jids.includes(jidDoAparelho(req));
    if (!doAparelho || !(await lacunas.ehDonoDaAgenda(perfil))) return res.json({ ativa: false, eventos: [], janelas: [] });
    const a = await lacunas.agendaDe(perfil, { dias }).catch(() => null);
    if (!a?.lista) return res.json({ ativa: false, eventos: [], janelas: [], indisponivel: true });
    res.json(M.montarAgendaGoogle({ lista: a.lista, fuso: fusoDe(perfil), hoje, dias }));
  });

  // ============ configurações do bot (W29–W31; D14) ============
  const configAtual = async (podeEditar) => {
    const c = await lacunas.config();
    return M.montarConfig({ ...c, agoraMs: agora().getTime(), podeEditar });
  };
  const mudarConfig = async (req) => {
    const v = M.validarConfig(req.body, { agoraMs: agora().getTime() });
    if ('vozLigada' in v) await lacunas.salvarVoz(v.vozLigada);
    if ('silencioAteMs' in v) await lacunas.definirSilencio(v.silencioAteMs);
  };
  r.get('/config', async (req, res) => {
    res.json(await configAtual(aparelhoDoDono(req)));
  });
  r.put('/config', async (req, res) => {
    await exigirDonoSemId(req);
    await mudarConfig(req);
    res.json(await configAtual(true));
  });
  r.get('/perfis/:id/config', async (req, res) => {
    const { perfil } = await perfilDo(req);
    res.json(await configAtual(aparelhoDoDono(req) && M.ehDono(perfil, adminJid)));
  });
  r.put('/perfis/:id/config', async (req, res) => {
    const { perfil } = await perfilDo(req);
    soDono(perfil, req);
    await mudarConfig(req);
    res.json(await configAtual(true));
  });

  // ============ Nutri (W33–W37, W57) ============
  r.get('/nutri/licoes', async (_req, res) => {
    res.json(M.montarLicoes(await lacunas.licoes()));
  });
  r.get('/nutri/persona', async (_req, res) => {
    const [x, perfis] = await Promise.all([lacunas.persona(), listarPerfis()]);
    res.json(M.montarPersona({ ...x, termos: termos(perfis) }));
  });
  r.get('/nutri/conhecimento', async (_req, res) => {
    res.json(M.montarConhecimento(await lacunas.conhecimento()));
  });
  r.get('/nutri/conhecimento/:cid', async (req, res) => {
    const d = await lacunas.docConhecimento(req.params.cid);
    if (!d) throw erroApi(404, 'documento_nao_encontrado', 'documento não encontrado');
    res.json(M.montarDocConhecimento(d));
  });
  // revisar a base chama IA pesada (pesquisa + reescrita): só o dono, uma vez por dia, em segundo plano (o cron mensal já faz)
  let estudoEm = null;
  const estudar = async (req, res, perfil) => {
    soDono(perfil, req);
    const dia = agora().toISOString().slice(0, 10);
    if (estudoEm === dia) throw erroApi(429, 'limite_diario', 'a base já foi revisada hoje; tente amanhã');
    estudoEm = dia;
    res.status(202).json({ emAndamento: true });
    lacunas.estudar({ dia }).catch((e) => console.warn('[api] estudar pelo app falhou:', e?.message || e));
  };
  r.post('/nutri/conhecimento/estudar', async (req, res) => estudar(req, res, await exigirDonoSemId(req)));
  r.post('/perfis/:id/nutri/conhecimento/estudar', async (req, res) => estudar(req, res, (await perfilDo(req)).perfil));
  r.get('/nutri/proatividade', async (req, res) => {
    const dias = inteiro(req.query.dias, { padrao: 14, min: 1, max: 60, rotulo: 'dias' });
    const [x, perfis] = await Promise.all([lacunas.proatividade(dias), listarPerfis()]);
    res.json(M.montarProatividade(x, { termos: termos(perfis) }));
  });
  r.get('/nutri/momentos', async (req, res) => {
    const dias = inteiro(req.query.dias, { padrao: 30, min: 1, max: 365, rotulo: 'dias' });
    const desde = diasAnteriores(agora().toISOString().slice(0, 10), dias + 1)[0];
    const [lista, perfis] = await Promise.all([lacunas.momentos(desde), listarPerfis()]);
    res.json(M.montarMomentos(lista, { termos: termos(perfis) }));
  });

  // ============ documentos (W32) e status (W38) ============
  r.get('/perfis/:id/documentos', async (req, res) => {
    const { perfil } = await perfilDo(req);
    res.json(M.montarDocumentos(await lacunas.documentos(perfil)));
  });
  const status = async (_req, res) => res.json(M.montarStatus(await lacunas.status()));
  r.get('/sistema/status', async (req, res) => {
    await exigirDonoSemId(req);
    await status(req, res);
  });
  r.get('/perfis/:id/sistema/status', async (req, res) => {
    soDono((await perfilDo(req)).perfil, req);
    await status(req, res);
  });

  // ============ resumo do dia e falas (W44, W58; D20), previsões (W46) ============
  r.get('/perfis/:id/resumos/dia', async (req, res) => {
    const { perfis, hoje } = await perfilDo(req);
    const dia = req.query.dia == null || req.query.dia === '' ? diasAnteriores(hoje, 2)[0] : String(req.query.dia); // padrão: ontem (o de hoje fecha às 23:59)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T12:00:00Z`))) throw erroApi(400, 'dia_invalido', 'dia no formato YYYY-MM-DD');
    if (dia > hoje) throw erroApi(400, 'dia_invalido', `dia no futuro (hoje é ${hoje} no fuso da pessoa)`);
    const [texto, falas] = await Promise.all([lacunas.resumoDoDia(dia).catch(() => null), lacunas.falas(dia, dia).catch(() => [])]);
    res.json(M.montarResumoDia({ dia, texto, falas, termos: termos(perfis) }));
  });
  r.get('/perfis/:id/falas', async (req, res) => {
    const { perfis, hoje } = await perfilDo(req);
    const dias = inteiro(req.query.dias, { padrao: 30, min: 1, max: 180, rotulo: 'dias' });
    res.json({ falas: M.montarFalas(await lacunas.falas(diasAnteriores(hoje, dias)[0], hoje), { termos: termos(perfis) }) });
  });
  r.get('/perfis/:id/previsoes', async (req, res) => {
    const { perfil } = await perfilDo(req);
    const n = inteiro(req.query.n, { padrao: 8, min: 1, max: 52, rotulo: 'n' });
    res.json(M.montarPrevisoes(await lacunas.previsoes(perfil, n)));
  });

  // ============ água e álcool (W61) ============
  r.get('/perfis/:id/habitos', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const dia = req.query.dia == null || req.query.dia === '' ? hoje : String(req.query.dia);
    M.validarHabitos({ dia, aguaMl: 1 }, { hoje }); // só confere o dia
    res.json(M.montarHabitos(await lacunas.habitosDe(perfil, dia), dia));
  });
  r.post('/perfis/:id/habitos', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const v = M.validarHabitos(req.body, { hoje });
    await lacunas.registrarHabito(perfil, v);
    res.status(201).json(M.montarHabitos(await lacunas.habitosDe(perfil, v.dia), v.dia));
  });

  // ============ perguntas do app (seção 3; D10, D16) ============
  r.get('/perfis/:id/perguntas', async (req, res) => {
    const { perfil } = await perfilDo(req);
    const { n, antes } = M.validarPaginaPerguntas(req.query);
    const lista = await lacunas.perguntasDe(perfil, { antes, n: n + 1 }); // cronológica; uma a mais pra saber se há mais
    const mais = lista.length > n;
    res.json({ perguntas: lista.slice(-n).reverse().map(montarPergunta), mais });
  });
  r.delete('/perfis/:id/perguntas/:pid', async (req, res) => {
    const { perfil } = await perfilDo(req);
    const apagadas = await lacunas.apagarPergunta(perfil, req.params.pid);
    if (!apagadas) throw erroApi(404, 'pergunta_nao_encontrada', 'pergunta não encontrada');
    res.json({ apagado: true });
  });
  r.delete('/perfis/:id/perguntas', async (req, res) => {
    const { perfil } = await perfilDo(req);
    if (req.query.confirmar !== 'sim') throw erroApi(400, 'confirmacao', 'para apagar o histórico mande ?confirmar=sim');
    res.json({ apagadas: await lacunas.apagarPerguntas(perfil) });
  });

  // ============ plano da semana (W28; D13 ajustada pelo dono em 15/10) ============
  // "Pode ter o plano no WhatsApp também, pra quem não tem o app": o plano pedido pelo app é a mesma geração do !plano e
  // sai COMPLETO no grupo, além de ficar no app (coleção planos, aba Plano) e no Drive. Uma geração por pessoa por dia (IA
  // pesada, até 4 tentativas no modelo principal) e nunca duas ao mesmo tempo pra mesma pessoa.
  const planos = new Map(); // perfilId -> { dia, emAndamento }
  r.post('/perfis/:id/plano', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const { pedido } = M.validarPedidoPlano(req.body);
    const id = String(perfil._id);
    const atual = planos.get(id);
    if (atual?.emAndamento) throw erroApi(409, 'plano_em_andamento', 'o plano já está sendo montado; ele chega no grupo e na aba Plano');
    if (atual?.dia === hoje) throw erroApi(429, 'limite_diario', 'já montei um plano hoje pra essa pessoa; peça de novo amanhã');
    if (!lacunas.whatsappPronto()) throw erroApi(503, 'whatsapp_desconectado', 'o WhatsApp do bot está fora do ar agora; peça o plano de novo quando ele voltar');
    planos.set(id, { dia: hoje, emAndamento: true });
    res.status(202).json({ emAndamento: true, mensagem: 'Montando o plano. Ele chega completo no grupo e aparece na aba Plano em alguns minutos.' });
    Promise.resolve()
      .then(() => lacunas.gerarPlano({ perfil, dia: hoje, pedido }))
      .then((ok) => {
        // falhou (ou o plano não saiu no grupo porque o WhatsApp caiu no meio): libera pra tentar de novo hoje
        planos.set(id, ok === false ? { dia: null, emAndamento: false } : { dia: hoje, emAndamento: false });
      })
      .catch((e) => {
        console.warn('[api] plano pelo app falhou:', e?.message || e);
        planos.set(id, { dia: null, emAndamento: false });
      });
  });
}
