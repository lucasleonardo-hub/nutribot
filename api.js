// api.js - API v1 do app NutriBot (Android), montada em /api/v1 no index.js. Só leitura nesta fase (o contrato está em
// docs/app/2026-10-14-plano-fase1.md). Aditiva: nenhuma rota existente muda, o WhatsApp não muda, o express.json vale só
// aqui dentro. Sem CORS (o cliente é app nativo, não navegador).
//
// Camadas: este arquivo autentica (api-auth.js), valida o pedido, busca no Mongo (uma camada fina: `dadosPadrao`) e entrega
// aos montadores puros (api-montadores.js), que chamam as mesmas funções do bot (progresso, resumo, tendência, saúde...).
// Rota de API não faz conta. A busca é injetável (criarApi({ dados, auth })) pra testar as rotas sem Mongo.
//
// Identidade: perfis pelo _id do documento `perfis`; as coleções são lidas com { jid: { $in: perfil.jids } }. Dia e hora no
// fuso da pessoa (util.marcaDeTempo). Lugares e localização não saem (decisão do dono pra esta fase).

import express from 'express';
import { listarPerfis, refeicoesDesde, pesagensDesde, colecao, humorDe, eventosDe, comMiniaturas } from './mongo.js';
import { authPadrao, erroApi, ipDe, criarDiagnosticoXff } from './api-auth.js';
import { montarPerfil, montarHoje, montarRefeicao, montarRefeicoes, montarProgresso, montarCorpo, montarNutri, montarResumos, montarIntegracoes, termosDeLugar } from './api-montadores.js';
import { rotasDeEscrita, escritaPadrao } from './api-escrita.js';
import { estimarRefeicaoApp } from './gemini.js';
import { marcaDeTempo, diasAnteriores } from './util.js';
import { temHevy } from './treino.js';
import { ehDonoDaAgenda } from './agenda.js';
import { ATRASO_COBRANCA_MIN } from './cobranca.js';
import { estado } from './estado.js';
import { desconectadoHaMin } from './whatsapp.js';

export const MAX_DIAS_REFEICOES = 31;
const ehDia = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; // 2030-02-31 e 2030-13-01 não passam
};
const isoMenos = (dia, dias) => new Date(Date.parse(`${dia}T12:00:00Z`) - dias * 86400_000).toISOString();

// ============================================================
// Busca no Mongo (fina: só consulta; nenhuma conta)
// ============================================================
/** Busca padrão (Mongo do bot). Cada função recebe o perfil já achado e devolve dados crus pros montadores. */
export function dadosPadrao() {
  const doJid = (perfil) => ({ $in: perfil.jids || [] });
  // toda consulta tem início E fim (revisão M3): um ?dia= antigo lê só a janela dele, nunca o histórico até hoje
  return {
    listarPerfis: () => listarPerfis(),

    /**
     * Hoje, corpo: 35 dias de refeições, 120 de pesagens (uma por dia), relógio e treinos (as janelas de tendenciaCompleta),
     * e o humor e os eventos do dia registrados no app (fase 2).
     */
    async doDia(perfil, dia, { treinosCompletos = false } = {}) {
      const projecao = treinosCompletos ? {} : { inicio: 1 };
      const [refeicoes, pesagens, saude, treinos, humor, eventos] = await Promise.all([
        refeicoesDesde(perfil.jids || [], diasAnteriores(dia, 35)[0], dia),
        pesagensDesde(perfil.jids || [], diasAnteriores(dia, 120)[0], dia),
        colecao('saude_relogio').findOne({ _id: perfil.jids?.[0] }),
        colecao('treinos').find({ jid: doJid(perfil), inicio: { $gte: isoMenos(dia, 100), $lte: `${dia}T23:59:59.999Z` } }).project(projecao).toArray(),
        humorDe(perfil.jids || [], dia, dia),
        eventosDe(perfil.jids || [], dia, dia),
      ]);
      // miniaturas só do dia pedido (é o que o app mostra); os 35 dias de histórico servem só às contas
      const doDiaComMini = await comMiniaturas(refeicoes.filter((r) => r.dia === dia));
      return { refeicoes: [...refeicoes.filter((r) => r.dia !== dia), ...doDiaComMini], pesagens, saude, treinos, humor: humor[0] || null, eventos };
    },

    /** Eventos criados no app num intervalo (diário da Comida e agenda). */
    eventosEntre: (perfil, de, ate) => eventosDe(perfil.jids || [], de, ate),

    /**
     * Refeições de [de, ate] e dos 28 dias fechados antes de hoje (a mediana do critério de dia completo), em duas consultas
     * fechadas: um intervalo antigo não puxa tudo até hoje.
     */
    async refeicoesEntre(perfil, de, ateDia, hoje) {
      const [doIntervalo, base] = await Promise.all([
        refeicoesDesde(perfil.jids || [], de, ateDia),
        refeicoesDesde(perfil.jids || [], diasAnteriores(hoje, 29)[0], diasAnteriores(hoje, 2)[0]),
      ]);
      const vistos = new Set(doIntervalo.map((r) => String(r._id)));
      return [...(await comMiniaturas(doIntervalo)), ...base.filter((r) => !vistos.has(String(r._id)))];
    },

    /** Progresso e resumos: os 31 dias de acompanhamento.dadosDe. */
    async de31(perfil, dia) {
      const desde = diasAnteriores(dia, 31)[0];
      const [refeicoes, pesagens] = await Promise.all([refeicoesDesde(perfil.jids || [], desde, dia), pesagensDesde(perfil.jids || [], desde, dia)]);
      return { refeicoes, pesagens };
    },

    /** Catálogo do Hevy guardado no Mongo (sem ir à API do Hevy: GET não sincroniza nada). */
    async catalogoHevy() {
      return (await colecao('hevy_exercicios').findOne({ _id: 'catalogo' }))?.mapa || {};
    },

    async daNutri(perfil) {
      const [hipotesesFechadas, reflexoes, pensamentos, diario] = await Promise.all([
        colecao('hipoteses').find({ jid: doJid(perfil) }).sort({ fechadaEm: -1 }).limit(20).toArray(),
        colecao('reflexoes').find({ jid: doJid(perfil) }).sort({ dia: -1, criadoEm: -1 }).limit(5).toArray(),
        colecao('pensamentos').find({ jid: doJid(perfil) }).sort({ criadoEm: -1 }).limit(10).project({ investigacao: 0, sinais: 0, assinatura: 0 }).toArray(),
        colecao('diario_nutri').find({}).sort({ dia: -1 }).limit(14).toArray(),
      ]);
      return { hipotesesFechadas, reflexoes, pensamentos, diario };
    },

    async integracoes(perfis) {
      const porPerfil = new Map();
      await Promise.all(
        perfis.map(async (p) => {
          const [saude, treino, nota] = await Promise.all([
            colecao('saude_relogio').findOne({ _id: p.jids?.[0] }, { projection: { ultimoEnvio: 1, app: 1 } }),
            colecao('treinos').find({ jid: doJid(p) }).sort({ inicio: -1 }).limit(1).project({ inicio: 1 }).next(),
            colecao('notas').find({ jid: doJid(p) }).sort({ criadoEm: -1 }).limit(1).project({ dia: 1 }).next(),
          ]);
          porPerfil.set(String(p._id), { saude, ultimoTreino: treino?.inicio || null, ultimaNota: nota || null });
        })
      );
      return {
        porPerfil,
        whatsapp: { estado: estado.statusConexao, desconectadoHaMin: estado.statusConexao === 'conectado' ? 0 : desconectadoHaMin() },
        driveConfigurado: Boolean((process.env.DRIVE_FOLDER_ID || '').trim()),
      };
    },
  };
}

// ============================================================
// Roteador
// ============================================================
function enviarErro(res, status, codigo, mensagem) {
  res.status(status).json({ erro: { codigo, mensagem } });
}

/**
 * Roteador da API v1. `auth` = api-auth.criarAuth (pareamento e token); `dados` = dadosPadrao() ou um dublê; `agora()` o
 * instante (dia e hora de cada pessoa saem dele, no fuso dela); `adminJid` marca o perfil do dono.
 */
export function criarApi({ auth = authPadrao(), dados = dadosPadrao(), escrita = escritaPadrao(), ia = { estimarRefeicaoApp }, agora = () => new Date(), adminJid = (process.env.ADMIN_JID || '').trim(), temHevyDe = temHevy, ehDonoDaAgendaDe = ehDonoDaAgenda, podeAnalisar } = {}) {
  const r = express.Router();
  const diagnosticoXff = criarDiagnosticoXff();
  r.use((req, _res, next) => {
    diagnosticoXff(req); // uma vez por processo: quantos endereços o X-Forwarded-For traz (pra acertar API_PROXY_SALTOS)
    next();
  });
  // 32 kb pra tudo, menos o registro de refeição pelo app, que leva até 2 fotos em base64 (fase 2): esse corpo só é lido
  // na própria rota, depois do token (revisão: anônimo não faz o servidor parsear 6 MB)
  const jsonPequeno = express.json({ limit: '32kb' });
  const jsonFoto = express.json({ limit: '6mb' });
  r.use((req, res, next) => (req.method === 'POST' && /^\/perfis\/[^/]+\/refeicoes\/?$/.test(req.path) ? next() : jsonPequeno(req, res, next)));

  // ---------- pareamento (sem token) ----------
  r.post('/parear', async (req, res) => {
    // os perfis antes de consumir o código (revisão M6): se a busca falhar, o código continua valendo e nenhum aparelho
    // fica pareado sem que o app tenha recebido o token
    const perfis = await dados.listarPerfis();
    const { token } = await auth.parear({ codigo: req.body?.codigo, aparelho: req.body?.aparelho, ip: ipDe(req) });
    res.json({ token, perfis: perfis.map((p) => montarPerfil(p, { temHevy: temHevyDe(p), adminJid })) });
  });

  // ---------- daqui pra baixo, só com token de aparelho ----------
  // pedido sem token válido: limite por IP (30 em 10 min), e token fora do formato nem chega ao banco (api-auth)
  r.use(async (req, res, next) => {
    const ip = ipDe(req);
    if (auth.semTokenBloqueado(ip)) return enviarErro(res, 429, 'muitas_tentativas', 'muitos pedidos sem token válido; tente de novo em alguns minutos');
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') || '');
    if (!m) {
      auth.registrarSemToken(ip);
      return enviarErro(res, 401, 'sem_token', 'mande o cabeçalho Authorization: Bearer <token>');
    }
    const aparelho = await auth.autenticar(m[1]);
    if (!aparelho) {
      auth.registrarSemToken(ip);
      return enviarErro(res, 401, 'token_invalido', 'token inválido ou revogado; pareie de novo com !app');
    }
    req.aparelho = aparelho;
    next();
  });

  /** O perfil do :id (404 se não existe) e o "hoje"/hora local dele. */
  async function perfilDo(req) {
    const perfis = await dados.listarPerfis();
    const perfil = perfis.find((p) => String(p._id) === String(req.params.id));
    if (!perfil) throw erroApi(404, 'perfil_nao_encontrado', 'perfil não encontrado');
    if (!Array.isArray(perfil.jids) || !perfil.jids.length) throw erroApi(409, 'perfil_sem_jid', 'perfil sem número de WhatsApp ligado');
    const t = marcaDeTempo(perfil, agora());
    return { perfil, perfis, hoje: t.dia, hora: t.horaLocal };
  }
  /** ?dia= opcional; padrão o hoje da pessoa; não aceita futuro. */
  function diaDoPedido(req, hoje) {
    const dia = req.query.dia == null || req.query.dia === '' ? hoje : String(req.query.dia);
    if (!ehDia(dia)) throw erroApi(400, 'dia_invalido', 'dia no formato YYYY-MM-DD');
    if (dia > hoje) throw erroApi(400, 'dia_invalido', `dia no futuro (hoje é ${hoje} no fuso da pessoa)`);
    return dia;
  }

  r.get('/perfis', async (_req, res) => {
    const perfis = await dados.listarPerfis();
    res.json({ perfis: perfis.map((p) => montarPerfil(p, { temHevy: temHevyDe(p), adminJid })) });
  });

  /** O /hoje de um dia (a leitura e as escritas devolvem o mesmo objeto). */
  async function hojeDe(perfil, perfis, dia) {
    const t = marcaDeTempo(perfil, agora());
    const d = await dados.doDia(perfil, dia);
    return montarHoje({ perfil, dia, hoje: t.dia, horaAgora: t.horaLocal, ...d, atrasoMin: ATRASO_COBRANCA_MIN, termosLocal: termosDeLugar(perfis) });
  }

  r.get('/perfis/:id/hoje', async (req, res) => {
    const { perfil, perfis, hoje } = await perfilDo(req);
    res.json(await hojeDe(perfil, perfis, diaDoPedido(req, hoje)));
  });

  r.get('/perfis/:id/refeicoes', async (req, res) => {
    const { perfil, perfis, hoje } = await perfilDo(req);
    const ateDia = req.query.ate ? String(req.query.ate) : hoje;
    // o `ate` é conferido antes de calcular o `de` padrão a partir dele (revisão M1: ?ate=abc virava 500)
    if (!ehDia(ateDia)) throw erroApi(400, 'intervalo_invalido', 'ate no formato YYYY-MM-DD');
    const de = req.query.de ? String(req.query.de) : diasAnteriores(ateDia, 7)[0];
    if (!ehDia(de)) throw erroApi(400, 'intervalo_invalido', 'de no formato YYYY-MM-DD');
    if (de > ateDia) throw erroApi(400, 'intervalo_invalido', 'de depois de ate');
    if (ateDia > hoje) throw erroApi(400, 'intervalo_invalido', `ate no futuro (hoje é ${hoje} no fuso da pessoa)`);
    if (diasAnteriores(ateDia, MAX_DIAS_REFEICOES)[0] > de) throw erroApi(400, 'intervalo_invalido', `no máximo ${MAX_DIAS_REFEICOES} dias por pedido`);
    const [refeicoes, eventos] = await Promise.all([dados.refeicoesEntre(perfil, de, ateDia, hoje), dados.eventosEntre ? dados.eventosEntre(perfil, de, ateDia) : []]);
    res.json(montarRefeicoes({ refeicoes, eventos, de, ate: ateDia, hoje, termosLocal: termosDeLugar(perfis) }));
  });

  r.get('/perfis/:id/progresso', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const dia = diaDoPedido(req, hoje);
    res.json(montarProgresso({ perfil, dia, ...(await dados.de31(perfil, dia)) }));
  });

  r.get('/perfis/:id/corpo', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const dia = diaDoPedido(req, hoje);
    const comHevy = Boolean(temHevyDe(perfil));
    const [d, catalogo] = await Promise.all([dados.doDia(perfil, dia, { treinosCompletos: true }), comHevy ? dados.catalogoHevy() : {}]);
    res.json(montarCorpo({ perfil, dia, ...d, catalogo, temHevy: comHevy }));
  });

  r.get('/perfis/:id/nutri', async (req, res) => {
    const { perfil, perfis } = await perfilDo(req);
    res.json(montarNutri({ perfil, ...(await dados.daNutri(perfil)), termosLocal: termosDeLugar(perfis) }));
  });

  r.get('/perfis/:id/resumos', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const dia = diaDoPedido(req, hoje);
    res.json(montarResumos({ perfil, dia, ...(await dados.de31(perfil, dia)) }));
  });

  r.get('/integracoes', async (_req, res) => {
    const perfis = await dados.listarPerfis();
    const x = await dados.integracoes(perfis);
    res.json(montarIntegracoes({ perfis, ...x, temHevy: temHevyDe, ehDonoDaAgenda: ehDonoDaAgendaDe, agoraMs: agora().getTime() }));
  });

  // ---------- escrita (fase 2): refeição, humor, eventos, pesagem, perfil ----------
  rotasDeEscrita(r, { escrita, ia, perfilDo, hojeDe, lerJsonFoto: jsonFoto, agora, temHevyDe, adminJid, montarPerfil, montarRefeicao, ...(podeAnalisar ? { podeAnalisar } : {}) });

  // ---------- o resto: 404 e erros no formato do contrato ----------
  r.use((_req, res) => enviarErro(res, 404, 'rota_inexistente', 'rota inexistente na API v1'));
  // eslint-disable-next-line no-unused-vars
  r.use((e, req, res, _next) => {
    if (e?.type === 'entity.parse.failed') return enviarErro(res, 400, 'json_invalido', 'corpo JSON inválido');
    if (e?.type === 'entity.too.large') return enviarErro(res, 400, 'corpo_grande', 'corpo grande demais');
    // outros erros do leitor de corpo (charset ou encoding não suportados, 415) são do pedido, não do servidor
    if (e?.type && Number(e.status) >= 400 && Number(e.status) < 500) return enviarErro(res, 400, 'pedido_invalido', 'pedido inválido');
    if (e?.status && e?.codigo) return enviarErro(res, e.status, e.codigo, e.message);
    // Mongo ainda não conectado (o servidor HTTP sobe antes do banco no boot)
    if (/conectarMongo|Topology|ECONNREFUSED|server selection/i.test(String(e?.message))) return enviarErro(res, 503, 'servidor_iniciando', 'servidor iniciando ou banco indisponível; tente de novo em instantes');
    console.error(`[api] ${req.method} ${req.path}:`, e?.stack || e?.message || e);
    return enviarErro(res, 500, 'erro_interno', 'erro interno');
  });
  return r;
}
