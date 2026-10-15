// api-lacunas-montadores.js - Funções PURAS das rotas da fase 7 (api-lacunas.js): validação do que o app manda e montagem
// do JSON que volta. Nada aqui toca banco, Drive, IA ou relógio do sistema (o "hoje" e o "agora" chegam por parâmetro).
// Contrato: docs/app/2026-10-15-mapa-ecossistema.md, seções 1 e 3 (o plano da fase 7 vence onde divergir).
//
// Regras de texto: todo texto livre que vai pro app passa por semZap (sem *, _, emoji do WhatsApp) e, quando pode citar
// lugar, por tirarLocalizacao (mesmo filtro do resto da API). Coordenada nunca sai.

import { semZap, tirarLocalizacao } from './api-montadores.js';
import { erroApi } from './api-auth.js';

const invalido = (msg) => erroApi(400, 'pedido_invalido', msg);
const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const numero = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const ehDiaTxt = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; // 2030-02-31 e 2030-13-01 não passam
};
const ehHora = (h) => typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
const somarDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400_000);
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fmtNum = (q) => (Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100).replace('.', ','));
const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : Number.isNaN(new Date(d).getTime()) ? null : new Date(d).toISOString());

/** Puro. O perfil é do dono do grupo (o ADMIN_JID está entre os jids dele)? */
export const ehDono = (perfil, adminJid) => Boolean(adminJid && Array.isArray(perfil?.jids) && perfil.jids.includes(adminJid));

// ============================================================
// Despensa (W12–W16, W51)
// ============================================================
/** Categorias que o app pode escolher ao adicionar (só comida e bebida; as chaves batem com despensa.VALIDADE_PADRAO). */
export const CATEGORIAS_DESPENSA = ['carne', 'frango', 'peixe', 'ovo', 'laticínio', 'fruta', 'verdura', 'legume', 'pão', 'mercearia', 'congelado', 'bebida', 'outro'];
export const UNIDADES_DESPENSA = ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'dz', 'lata'];
export const ACOES_DESPENSA = ['acabou', 'acabando', 'usei', 'tem', 'comprei', 'tirar'];
const NOME_CATEGORIA = { carne: 'Carnes', frango: 'Frango', peixe: 'Peixes', ovo: 'Ovos', laticínio: 'Laticínios', fruta: 'Frutas', verdura: 'Verduras', legume: 'Legumes', pão: 'Pães', mercearia: 'Mercearia', congelado: 'Congelados', bebida: 'Bebidas', outro: 'Outros' };
const UNIDADE_ALIAS = { und: 'un', unid: 'un', unidade: 'un', unidades: 'un', quilo: 'kg', quilos: 'kg', gr: 'g', grama: 'g', gramas: 'g', litro: 'l', litros: 'l', pacote: 'pct', pacotes: 'pct', caixa: 'cx', caixas: 'cx', duzia: 'dz', dúzia: 'dz', latas: 'lata' };
const unidadeDoPedido = (u) => {
  if (u == null || u === '') return null;
  const x = String(u).toLowerCase().trim();
  const n = UNIDADE_ALIAS[x] || x;
  if (!UNIDADES_DESPENSA.includes(n)) throw invalido(`unidade precisa ser uma de ${UNIDADES_DESPENSA.join(', ')}`);
  return n;
};
const qtdDoPedido = (v, { obrigatoria = false } = {}) => {
  const n = numero(v);
  if (n == null) {
    if (obrigatoria) throw invalido('quantidade obrigatória');
    return null;
  }
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw invalido('quantidade entre 0 e 1000');
  return Math.round(n * 1000) / 1000;
};

/** Puro. Corpo do POST /despensa → { item, qtd, unidade, categoria }. */
export function validarItemDespensa(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const item = texto(c.item ?? c.nome, 60);
  if (!item || item.length < 2) throw invalido('nome do item obrigatório');
  const categoria = c.categoria == null || c.categoria === '' ? null : String(c.categoria).toLowerCase().trim();
  if (categoria && !CATEGORIAS_DESPENSA.includes(categoria)) throw invalido(`categoria precisa ser uma de ${CATEGORIAS_DESPENSA.join(', ')}`);
  return { item: item.toLowerCase(), qtd: qtdDoPedido(c.qtd ?? c.quantidade) ?? 1, unidade: unidadeDoPedido(c.unidade) || 'un', categoria };
}

/** Puro. Corpo do PUT /despensa/:k → { acao, qtd, unidade }. */
export function validarAcaoDespensa(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const acao = String(c.acao || '').toLowerCase().trim();
  if (!ACOES_DESPENSA.includes(acao)) throw invalido(`acao precisa ser uma de ${ACOES_DESPENSA.join(', ')}`);
  return { acao, qtd: qtdDoPedido(c.qtd ?? c.quantidade), unidade: unidadeDoPedido(c.unidade) };
}

/**
 * Puro. Um item da despensa pro app. venceEmDias = dias até a validade típica (negativo = passou); selo só pra perecível:
 * 'passou' ("passou do prazo: ainda tem?", vermelho) ou 'vence' (de hoje a 2 dias, laranja). perguntar = mostrar Tem/Acabou.
 */
export function montarItemDespensa(d, hoje) {
  const vence = d?.validadeEm && ehDiaTxt(String(d.validadeEm)) ? diasEntre(hoje, String(d.validadeEm)) : null;
  const perecivel = Boolean(d?.perecivel);
  const ativo = d?.estado !== 'acabou';
  let selo = null;
  let seloTexto = null;
  if (perecivel && ativo && vence != null) {
    if (vence < 0) [selo, seloTexto] = ['passou', 'passou do prazo: ainda tem?'];
    else if (vence <= 2) [selo, seloTexto] = ['vence', vence === 0 ? 'vence hoje' : vence === 1 ? 'vence amanhã' : `vence em ${vence} dias`];
  }
  const q = Number(d?.quantidade);
  const unidade = d?.unidade || 'un';
  return {
    k: String(d?.k || ''),
    item: d?.item || '',
    categoria: CATEGORIAS_DESPENSA.includes(d?.categoria) ? d.categoria : 'outro',
    quantidade: Number.isFinite(q) ? q : null,
    unidade,
    quantidadeTexto: d?.granel ? (d?.estado === 'acabando' ? 'acabando' : Number.isFinite(q) && q > 0 ? `${fmtNum(q)} ${unidade}` : 'tem') : Number.isFinite(q) && q > 0 ? `${fmtNum(q)} ${unidade}` : '',
    granel: Boolean(d?.granel),
    estado: ['tem', 'acabando', 'acabou'].includes(d?.estado) ? d.estado : 'tem',
    validadeEm: d?.validadeEm || null,
    venceEmDias: vence,
    perecivel,
    selo,
    seloTexto,
    perguntar: selo === 'passou' || (perecivel && ativo && vence === 0),
    loja: d?.loja || null,
    compradoEm: d?.compradoEm || null,
    kcal100: d?.nutri?.kcal ?? null,
    p100: d?.nutri?.p ?? null,
  };
}

/**
 * Puro. GET /despensa: os itens (já vêm por validade) e os mesmos agrupados por categoria, na ordem da cozinha; contagens
 * do que vence (até 2 dias), do que passou e do que está acabando.
 */
export function montarDespensa({ itens = [], hoje }) {
  const lista = (itens || []).filter((d) => d && d.alimento !== false).map((d) => montarItemDespensa(d, hoje));
  const ordem = (x) => {
    const i = CATEGORIAS_DESPENSA.indexOf(x.categoria);
    return i < 0 ? 99 : i;
  };
  const porValidade = (a, b) => (a.venceEmDias ?? 9999) - (b.venceEmDias ?? 9999) || a.item.localeCompare(b.item);
  const ordenada = [...lista].sort((a, b) => ordem(a) - ordem(b) || porValidade(a, b));
  const categorias = [];
  for (const x of ordenada) {
    let g = categorias.find((c) => c.categoria === x.categoria);
    if (!g) categorias.push((g = { categoria: x.categoria, nome: NOME_CATEGORIA[x.categoria] || 'Outros', itens: [] }));
    g.itens.push(x);
  }
  return {
    itens: [...lista].sort(porValidade),
    categorias,
    total: lista.filter((x) => x.estado !== 'acabou').length,
    vencendo: lista.filter((x) => x.selo === 'vence').length,
    passou: lista.filter((x) => x.selo === 'passou').length,
    acabando: lista.filter((x) => x.estado === 'acabando').length,
  };
}

/**
 * Puro. GET /compras: os cupons lidos (coleção `notas`, sem CPF nem total da nota, que nunca são guardados) e um resumo
 * calculado daqui mesmo: gasto nos itens lidos, o que compra sempre e o perecível que passou do prazo sem baixa. O resumo
 * da despensa do WhatsApp cruza com a localização; este não (o app mostra a despensa das três pessoas, D15).
 */
export function montarCompras({ notas = [], itens = [], hoje, dias = 28 }) {
  const lista = (notas || []).map((n) => {
    const its = (n.itens || []).map((i) => ({ item: i.item || i.descricao || '', qtd: Number(i.quantidade ?? i.qtd) || null, unidade: i.unidade || null, preco: Number(i.preco ?? i.valorTotal) || null }));
    const total = its.reduce((a, i) => a + (i.preco || 0), 0);
    return { id: String(n._id ?? ''), loja: n.loja || null, dia: n.dia || null, origem: n.origem || null, itens: its, total: total ? Math.round(total * 100) / 100 : null };
  });
  const gasto = lista.reduce((a, n) => a + (n.total || 0), 0);
  const recorrentes = (itens || []).filter((i) => (i.compras || 0) >= 2).sort((a, b) => (b.compras || 0) - (a.compras || 0)).map((i) => i.item).slice(0, 10);
  const desperdicio = (itens || []).filter((i) => i.perecivel && i.estado !== 'acabou' && i.validadeEm && diasEntre(hoje, i.validadeEm) < -2).map((i) => i.item).slice(0, 8);
  const partes = [`${lista.length} ${lista.length === 1 ? 'cupom lido' : 'cupons lidos'} em ${dias} dias${gasto ? `, cerca de R$ ${Math.round(gasto)} em itens` : ''}.`];
  if (recorrentes.length) partes.push(`Compra sempre: ${recorrentes.join(', ')}.`);
  if (desperdicio.length) partes.push(`Passou do prazo sem baixa: ${desperdicio.join(', ')}.`);
  return { notas: lista, resumo: { cupons: lista.length, gasto: gasto ? Math.round(gasto * 100) / 100 : 0, recorrentes, desperdicio, texto: partes.join(' ') } };
}

/** Puro. Corpo do POST /compras → { chave, url, texto }: precisa do texto da página da nota (o app abre a SEFAZ no celular). */
export function validarCompra(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const t = typeof c.texto === 'string' ? c.texto : '';
  if (t.length < 50) throw invalido('mande o texto da página da nota (o app abre a nota no celular e copia o texto)');
  if (t.length > 300_000) throw invalido('texto da nota grande demais');
  const chave = typeof c.chave === 'string' && /^\d{44}$/.test(c.chave.replace(/\s+/g, '')) ? c.chave.replace(/\s+/g, '') : null;
  const url = typeof c.url === 'string' && /^https?:\/\//i.test(c.url) ? c.url.slice(0, 500) : '';
  return { chave, url, texto: t };
}

// ============================================================
// Atividades fixas (W17–W20, W52)
// ============================================================
const NOME_DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DOW_DE = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, sáb: 6 };
const minutosDe = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const kcalMet = (met, peso, min) => Math.round(((Number(met) || 0) * (Number(peso) || 70) * (Number(min) || 0)) / 60);
/** Puro. Dia da semana (0 = domingo) de um YYYY-MM-DD. */
export const diaDaSemana = (dia) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** Puro. Corpo do POST /atividades → { nome, dias: [0-6], inicio, fim, met, lugarId, aqui }. */
export function validarAtividade(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const nome = texto(c.nome, 40);
  if (!nome) throw invalido('nome obrigatório');
  const brutos = Array.isArray(c.dias) ? c.dias : typeof c.dias === 'string' ? c.dias.split(/[\s,;/]+/) : [];
  const dias = [...new Set(brutos.map((d) => (typeof d === 'number' ? d : /^\d$/.test(String(d)) ? Number(d) : DOW_DE[String(d).toLowerCase().trim()])).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!dias.length) throw invalido('escolha pelo menos um dia da semana');
  const inicio = String(c.inicio || '').padStart(5, '0');
  const fim = String(c.fim || '').padStart(5, '0');
  if (!ehHora(inicio) || !ehHora(fim)) throw invalido('início e fim no formato HH:MM');
  if (minutosDe(fim) <= minutosDe(inicio)) throw invalido('o fim precisa ser depois do início');
  const met = c.met == null || c.met === '' ? 5 : numero(c.met);
  if (!Number.isFinite(met) || met < 1 || met > 20) throw invalido('intensidade (MET) entre 1 e 20');
  const lugarId = c.lugarId == null || c.lugarId === '' ? null : String(c.lugarId).slice(0, 80);
  const aqui = !lugarId && c.aqui === true;
  // só na edição: sem lugarId nem aqui o lugar fica o que era; semLugar: true tira
  return { nome, dias, inicio, fim, met: Math.round(met * 10) / 10, lugarId, aqui, semLugar: !lugarId && !aqui && c.semLugar === true };
}

/** Puro. Corpo do POST /atividades/:aid/aviso → { dia, valor: 'vai'|'nao'|null }; dia de hoje até 13 dias pra frente. */
export function validarAvisoAtividade(corpo, { hoje }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const bruto = c.valor === undefined ? c.vai : c.valor;
  const valor = bruto === true || bruto === 'vai' ? 'vai' : bruto === false || bruto === 'nao' || bruto === 'não' ? 'nao' : bruto == null || bruto === '' ? null : undefined;
  if (valor === undefined) throw invalido("valor: 'vai', 'nao' ou null (desfazer)");
  const dia = c.dia == null || c.dia === '' ? hoje : String(c.dia);
  if (!ehDiaTxt(dia)) throw erroApi(400, 'dia_invalido', 'dia no formato YYYY-MM-DD');
  if (dia < hoje || diasEntre(hoje, dia) > 13) throw erroApi(400, 'dia_invalido', 'dia de hoje até 13 dias pra frente');
  return { dia, valor };
}

/** Puro. Corpo do POST /atividades/:aid/resposta → { dia, feita }; dia de até 7 dias atrás (padrão: hoje). */
export function validarRespostaAtividade(corpo, { hoje }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  if (typeof c.feita !== 'boolean') throw invalido('feita: true ou false');
  const dia = c.dia == null || c.dia === '' ? hoje : String(c.dia);
  if (!ehDiaTxt(dia)) throw erroApi(400, 'dia_invalido', 'dia no formato YYYY-MM-DD');
  if (dia > hoje || diasEntre(dia, hoje) > 7) throw erroApi(400, 'dia_invalido', 'dia de hoje até 7 dias atrás');
  return { dia, feita: c.feita };
}

/**
 * Puro. GET /atividades: as fixas (sem coordenada; o nome do lugar passa pelo filtro de localização, porque o app mostra as
 * atividades das três pessoas), as de hoje com o que já se sabe (feita, não houve, em dúvida) e as perguntas em aberto.
 */
export function montarAtividades({ perfil, dia, hora = null, termos = [] }) {
  const lista = perfil?.atividades || [];
  const dow = diaDaSemana(dia);
  const feitas = perfil?.atividadesFeitas?.[dia] || [];
  const pend = perfil?.atividadesPendentes || [];
  const duracao = (a) => Math.max(0, minutosDe(a.fim || '00:00') - minutosDe(a.inicio || '00:00'));
  const lugarDe = (a) => (a.lugar ? { nome: tirarLocalizacao(String(a.lugar.nome || ''), termos).trim() || 'lugar marcado' } : null);
  const avisoDe = (d, id) => perfil?.atividadesAvisos?.[d]?.[String(id)] ?? null;
  const agoraMin = ehHora(String(hora || '')) ? minutosDe(hora) : null;
  // as próximas duas semanas (a agenda e o "vai ter?" do app): o que a pessoa avisou e o que já foi registrado
  const proximas = [];
  for (let i = 0; i <= 13; i++) {
    const d = new Date(Date.parse(`${dia}T12:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
    const dw = diaDaSemana(d);
    for (const a of lista) {
      if (!(a.dias || []).includes(dw)) continue;
      const f = (perfil?.atividadesFeitas?.[d] || []).find((x) => x.id === a.id);
      proximas.push({ dia: d, id: String(a.id), nome: a.nome, inicio: a.inicio, fim: a.fim, aviso: avisoDe(d, a.id), feita: f ? Boolean(f.feita) : null, como: f?.como || null });
    }
  }
  return {
    fixas: lista.map((a) => ({ id: String(a.id), nome: a.nome, dias: a.dias || [], diasTexto: (a.dias || []).map((d) => NOME_DOW[d]).join(', '), inicio: a.inicio, fim: a.fim, met: a.met, lugar: lugarDe(a), kcal: kcalMet(a.met, perfil?.peso, duracao(a)) })),
    hoje: lista
      .filter((a) => (a.dias || []).includes(dow))
      .map((a) => {
        const f = feitas.find((x) => x.id === a.id);
        const emDuvida = pend.some((p) => p.id === a.id && p.dia === dia);
        // passou = o horário de hoje já acabou: o app troca o "vai ter?" pelo "teve?"
        const passou = agoraMin != null && ehHora(String(a.fim || '')) ? agoraMin >= minutosDe(a.fim) : null;
        return { id: String(a.id), nome: a.nome, inicio: a.inicio, fim: a.fim, feita: f ? Boolean(f.feita) : null, kcal: f?.feita ? Math.round(Number(f.kcal) || 0) : null, como: f?.como || null, emDuvida: !f && emDuvida, aviso: avisoDe(dia, a.id), passou };
      }),
    proximas,
    pendentes: pend
      .map((p) => ({ p, a: lista.find((a) => a.id === p.id) }))
      .filter(({ a }) => a)
      .map(({ p, a }) => ({ id: String(a.id), nome: a.nome, dia: p.dia })),
  };
}

/** Puro. Uma atividade no formato da lista do app (depois de criar). */
export function montarAtividade(a, { peso = null, termos = [] } = {}) {
  return montarAtividades({ perfil: { atividades: [a], peso }, dia: '2000-01-02', termos }).fixas[0];
}

// ============================================================
// Lugares (W23–W25): só do dono
// ============================================================
export const TIPOS_LUGAR = ['casa', 'trabalho', 'academia', 'faculdade', 'escola', 'mercado', 'padaria', 'restaurante', 'café', 'bar', 'parque', 'praia', 'igreja', 'saúde', 'shopping', 'loja', 'hotel', 'transporte', 'residência', 'outro'];

/** Puro. Corpo do PUT /lugares/:lid → { tipo?, nome?, papel? } (só o que veio). */
export function validarMarcacaoLugar(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const out = {};
  if ('tipo' in c) {
    const t = c.tipo == null || c.tipo === '' ? null : String(c.tipo).toLowerCase().trim();
    if (t && !TIPOS_LUGAR.includes(t)) throw invalido(`tipo precisa ser um de ${TIPOS_LUGAR.join(', ')}`);
    out.tipo = t;
  }
  if ('nome' in c) out.nome = texto(c.nome, 60);
  if ('papel' in c) {
    const p = c.papel == null || c.papel === '' ? null : String(c.papel);
    if (p && p !== 'casa' && p !== 'trabalho') throw invalido('papel: casa, trabalho ou null');
    out.papel = p;
  }
  if (!Object.keys(out).length) throw invalido('nada para alterar');
  return out;
}

/** Puro. Um lugar pro app, sem coordenada. */
export function montarLugar(l) {
  return { id: String(l.id), tipo: l.tipo || null, nome: l.nome || null, bairro: l.bairro || null, papel: l.papel || null, visitas: Number(l.visitas) || 0, padrao: l.padrao || '', ultimaVez: l.ultimaVez || null, manual: Boolean(l.manual) };
}

/** Puro. GET /lugares: onde está agora (lugares.situacaoAtual) e os lugares que frequenta, os mais visitados primeiro. */
export function montarLugares({ perfil, situacao = null }) {
  let agora = null;
  if (situacao && situacao.estado !== 'sem_sinal') {
    const l = situacao.lugar;
    agora = { estado: situacao.estado, tipo: situacao.estado === 'casa' ? 'casa' : l?.tipo || null, nome: situacao.estado === 'lugar' ? l?.nome || null : null, lugarId: l?.id ? String(l.id) : null, desde: situacao.desde || null };
  } else if (situacao) agora = { estado: 'sem_sinal', tipo: null, nome: null, lugarId: null, desde: situacao.ultimo || null };
  const lugares = (perfil?.lugares || []).map(montarLugar).sort((a, b) => (b.papel === 'casa') - (a.papel === 'casa') || (b.papel === 'trabalho') - (a.papel === 'trabalho') || b.visitas - a.visitas);
  return { ativo: Boolean(perfil?.lugaresAtivo), agora, lugares };
}

// ============================================================
// Agenda do Google (W26): só leitura e só do dono da credencial
// ============================================================
const hhmmLocal = (iso, fuso) => new Date(iso).toLocaleTimeString('sv-SE', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).slice(0, 5);
const diaLocal = (iso, fuso) => new Date(iso).toLocaleString('sv-SE', { timeZone: fuso }).slice(0, 10);
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Puro. GET /agenda-google: os eventos de [hoje, hoje + dias) no fuso da pessoa ({ dia, inicio, fim, diaTodo, titulo, tipo };
 * o local do evento e a descrição não saem) e as janelas livres de cada dia entre 7h e 23h (45 min ou mais).
 */
export function montarAgendaGoogle({ lista = [], fuso = 'America/Sao_Paulo', hoje, dias = 7 }) {
  const ate = somarDias(hoje, dias);
  const eventos = (lista || [])
    .filter((e) => e?.inicio)
    .map((e) => ({ dia: diaLocal(e.inicio, fuso), inicio: e.diaTodo ? null : hhmmLocal(e.inicio, fuso), fim: e.diaTodo ? null : hhmmLocal(e.fim || e.inicio, fuso), diaTodo: Boolean(e.diaTodo), titulo: semZap(String(e.titulo || '(sem título)')).slice(0, 120), tipo: e.tipo || 'compromisso', _ini: e.inicio, _fim: e.fim || e.inicio }))
    .filter((e) => e.dia >= hoje && e.dia < ate)
    .sort((a, b) => a._ini.localeCompare(b._ini));
  const janelas = [];
  for (let i = 0; i < dias; i++) {
    const d = somarDias(hoje, i);
    const ocupado = eventos
      .filter((e) => e.dia === d && !e.diaTodo)
      .map((e) => [minutosDe(e.inicio), diaLocal(e._fim, fuso) > d ? 24 * 60 : minutosDe(e.fim)])
      .sort((a, b) => a[0] - b[0]);
    let cursor = 7 * 60;
    for (const [ini, fim] of ocupado) {
      if (ini - cursor >= 45) janelas.push({ dia: d, inicio: fmtMin(cursor), fim: fmtMin(ini) });
      cursor = Math.max(cursor, fim);
    }
    if (23 * 60 - cursor >= 45) janelas.push({ dia: d, inicio: fmtMin(cursor), fim: fmtMin(23 * 60) });
  }
  return { ativa: true, eventos: eventos.map(({ _ini, _fim, ...e }) => e), janelas };
}

// ============================================================
// Configurações do bot (W29–W31): leitura pra todos, mudança só do dono (D14)
// ============================================================
export const MAX_SILENCIO_MIN = 7 * 24 * 60;

/** Puro. GET /config: voz, silêncio (ISO só enquanto vale) e o nome que o grupo deu (só leitura: rebatizar é no grupo). */
export function montarConfig({ config = {}, silencioAteMs = 0, agoraMs, nomeBot = 'Nutri', podeEditar = false }) {
  const ativo = Number(silencioAteMs) > agoraMs;
  return { vozLigada: config?.vozLigada !== false, silencioAte: ativo ? new Date(silencioAteMs).toISOString() : null, silencioAtivo: ativo, nomeBot: nomeBot || 'Nutri', podeEditar: Boolean(podeEditar) };
}

/**
 * Puro. Corpo do PUT /config → { vozLigada?, silencioAteMs? } (0 = voltar a falar). Silêncio por `silencioMin` (1 a 7 dias
 * em minutos) ou `silencioAte` (ISO no futuro, até 7 dias; null = voltar a falar).
 */
export function validarConfig(corpo, { agoraMs }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const out = {};
  if ('vozLigada' in c) {
    if (typeof c.vozLigada !== 'boolean') throw invalido('vozLigada: true ou false');
    out.vozLigada = c.vozLigada;
  }
  if (c.silencioMin != null && c.silencioMin !== '') {
    const m = numero(c.silencioMin);
    if (!Number.isFinite(m) || m < 0 || m > MAX_SILENCIO_MIN) throw invalido('silencioMin de 0 a 10080 (7 dias)');
    out.silencioAteMs = m === 0 ? 0 : agoraMs + Math.round(m) * 60_000;
  } else if ('silencioAte' in c) {
    if (c.silencioAte == null || c.silencioAte === '' || c.silencioAte === false) out.silencioAteMs = 0;
    else {
      const t = Date.parse(String(c.silencioAte));
      if (!Number.isFinite(t)) throw invalido('silencioAte em ISO 8601, ou null pra voltar a falar');
      if (t <= agoraMs) out.silencioAteMs = 0;
      else if (t - agoraMs > MAX_SILENCIO_MIN * 60_000) throw invalido('silêncio de no máximo 7 dias');
      else out.silencioAteMs = t;
    }
  }
  if ('nomeBot' in c) throw erroApi(400, 'so_no_grupo', 'o nome da Nutri só muda no grupo (!nome)');
  if (!Object.keys(out).length) throw invalido('nada para alterar');
  return out;
}

// ============================================================
// Nutri: lições, persona, base de conhecimento, proatividade, momentos (W33–W37, W57)
// ============================================================
/** Puro. GET /nutri/licoes (caderno de aprendizado: regras ativas e o documento). */
export function montarLicoes(doc) {
  return { regras: (doc?.regras || []).map((r) => semZap(String(r))).filter(Boolean), documento: doc?.documento ? semZap(String(doc.documento)) : '', dia: doc?.dia || null, atualizadoEm: iso(doc?.atualizadoEm) };
}

/** Puro. GET /nutri/persona: o texto de hoje e as versões anteriores (trecho do começo), sem localização. */
export function montarPersona({ doc = null, historico = [], termos = [] }) {
  const limpo = (t) => semZap(tirarLocalizacao(String(t || ''), termos));
  return {
    texto: limpo(doc?.texto),
    atualizado: doc?.dia || null,
    atualizadoEm: iso(doc?.atualizadoEm),
    versoes: (historico || []).map((h) => {
      const t = limpo(h.texto);
      return { dia: h.dia || null, em: iso(h.substituidoEm), trecho: t.length > 240 ? `${t.slice(0, 239).trimEnd()}…` : t };
    }),
  };
}

/** Puro. GET /nutri/conhecimento: a lista da base (sem o corpo). */
export function montarConhecimento(lista) {
  const ordem = ['base', 'emagrecimento', 'hipertrofia', 'performance', 'saude', 'rotina', 'pesquisa'];
  const pos = (f) => (ordem.indexOf(f) < 0 ? 50 : ordem.indexOf(f));
  return { docs: (lista || []).map((d) => ({ id: String(d.id ?? d._id), titulo: semZap(String(d.titulo || d.id || '')), foco: d.foco || 'base', versao: Number(d.versao) || 1, atualizado: d.atualizado || null })).sort((a, b) => pos(a.foco) - pos(b.foco) || a.titulo.localeCompare(b.titulo)) };
}

/** Puro. GET /nutri/conhecimento/:id: o documento inteiro, em texto. */
export function montarDocConhecimento(d) {
  return { id: String(d.id ?? d._id), titulo: semZap(String(d.titulo || '')), foco: d.foco || 'base', versao: Number(d.versao) || 1, atualizado: d.atualizado || null, texto: semZap(String(d.corpo || '')) };
}

/** Puro. GET /nutri/proatividade: quando ela puxou assunto no grupo e se responderam. */
export function montarProatividade(r, { termos = [] } = {}) {
  return {
    total: Number(r?.total) || 0,
    respondidas: Number(r?.respondidas) || 0,
    ignoradas: Number(r?.ignoradas) || 0,
    ultimas: (r?.ultimas || []).map((i) => ({ dia: i.dia || null, hora: i.hora || null, pessoa: primeiroNome(i.nome), assunto: semZap(tirarLocalizacao(String(i.assunto || ''), termos)) || null, respondida: Boolean(i.respondida) })),
  };
}

/** Puro. GET /nutri/momentos: momentos memoráveis do grupo (o que já foi dito no grupo), sem localização. */
export function montarMomentos(lista, { termos = [] } = {}) {
  return { momentos: (lista || []).map((m) => ({ dia: m.dia || null, pessoa: primeiroNome(m.pessoa), tipo: m.tipo || null, texto: semZap(tirarLocalizacao(String(m.texto || ''), termos)) })).filter((m) => m.texto) };
}

// ============================================================
// Dossiê / documentos (W32) e status (W38)
// ============================================================
/**
 * Puro. GET /documentos: os arquivos da pasta da pessoa no Drive (quando o Drive respondeu) somados ao que a Nutri extraiu
 * de cada um (documentos_pessoa: tipo, data e resumo). Sem o Drive, só os analisados.
 */
export function montarDocumentos({ arquivos = null, analisados = [], pastaId = null }) {
  const porNome = new Map((analisados || []).map((a) => [a.nome, a]));
  const linha = (nome, extra = {}) => {
    const a = porNome.get(nome);
    return { nome, tipo: extra.tipo || null, daNutri: Boolean(extra.daNutri), lido: extra.lido ?? Boolean(a), modificadoEm: a?.modificado || null, tipoDocumento: a?.tipo || null, data: a?.data || null, resumo: a?.resumo ? semZap(String(a.resumo)) : null };
  };
  const lista = Array.isArray(arquivos) ? arquivos.map((f) => linha(f.nome, f)) : (analisados || []).map((a) => linha(a.nome, { lido: true }));
  return { arquivos: lista.sort((a, b) => a.daNutri - b.daNutri || a.nome.localeCompare(b.nome)), pastaUrl: pastaId ? `https://drive.google.com/drive/folders/${pastaId}` : null, driveRespondeu: Array.isArray(arquivos) };
}

/** Puro. GET /sistema/status (só o dono): conexão, cota do Gemini, modelos de castigo e reservas. Sem número nem grupo. */
export function montarStatus({ uptimeSeg = 0, conexao = '?', desconectadoHaMin = 0, dia = null, mensagensHoje = 0, uso = {}, modelos = [], reservas = [] }) {
  return {
    uptimeMin: Math.round((Number(uptimeSeg) || 0) / 60),
    whatsapp: { estado: conexao, desconectadoHaMin: conexao === 'conectado' ? 0 : Number(desconectadoHaMin) || 0 },
    dia,
    mensagensHoje: Number(mensagensHoje) || 0,
    gemini: { chamadas: Number(uso.chamadas) || 0, tokensEntrada: Number(uso.entrada) || 0, tokensCache: Number(uso.cache) || 0, tokensSaida: Number(uso.saida) || 0 },
    modelos: (modelos || []).map((m) => ({ modelo: m.modelo, papel: m.papel, livre: Boolean(m.livre), voltaEm: m.voltaEm || null })),
    reservas: [...(reservas || [])],
  };
}

// ============================================================
// Resumo do dia, falas, previsões (W44, W46, W58)
// ============================================================
/** Puro. Texto de um .md do Drive sem o frontmatter, sem os links do Obsidian ([[a|b]] vira b) e sem a marcação do WhatsApp. */
export function limparMarkdown(t) {
  return semZap(
    String(t || '')
      .replace(/^﻿?---\n[\s\S]*?\n---\n?/, '')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .trim()
  );
}

/** Puro. As falas programadas (notas de voz de segunda e sexta) em texto (D20). */
export function montarFalas(lista, { termos = [] } = {}) {
  return (lista || []).map((f) => ({ dia: f.dia || null, tipo: f.tipo || null, texto: semZap(tirarLocalizacao(String(f.texto || ''), termos)) })).filter((f) => f.texto);
}

/** Puro. GET /resumos/dia: o resumo que o grupo recebeu às 23:59 e as falas do dia. texto null = ainda não há resumo. */
export function montarResumoDia({ dia, texto = null, falas = [], termos = [] }) {
  const t = texto ? tirarLocalizacao(limparMarkdown(texto), termos) : '';
  return { dia, texto: t || null, falas: montarFalas(falas, { termos }) };
}

/** Puro. GET /previsoes: a aposta de cada domingo e a conferência na semana seguinte. */
export function montarPrevisoes(lista) {
  return {
    previsoes: (lista || []).map((p) => ({
      semana: p.feitaEm || null,
      alvoDia: p.alvoDia || null,
      pesoInicial: p.pesoInicial ?? null,
      previsto: p.pesoPrevisto ?? null,
      deltaKg: p.deltaKg ?? null,
      confianca: p.confianca ?? null,
      conferida: Boolean(p.conferida),
      real: p.resultado?.realKg ?? null,
      erroKg: p.resultado?.erroKg ?? null,
      acerto: p.resultado?.acerto || null,
    })),
  };
}

// ============================================================
// Água e álcool (W61)
// ============================================================
/** Puro. Corpo do POST /habitos → { dia, aguaMl, alcoolDoses } (soma ao que já tem no dia). */
export function validarHabitos(corpo, { hoje }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const dia = c.dia == null || c.dia === '' ? hoje : String(c.dia);
  if (!ehDiaTxt(dia)) throw erroApi(400, 'dia_invalido', 'dia no formato YYYY-MM-DD');
  if (dia > hoje || diasEntre(dia, hoje) > 31) throw erroApi(400, 'dia_invalido', 'dia de hoje até 31 dias atrás');
  const agua = numero(c.aguaMl);
  const alcool = numero(c.alcoolDoses);
  if (agua != null && (!Number.isFinite(agua) || agua < 0 || agua > 5000)) throw invalido('água entre 0 e 5000 ml');
  if (alcool != null && (!Number.isFinite(alcool) || alcool < 0 || alcool > 20)) throw invalido('álcool entre 0 e 20 doses');
  if (!(agua > 0) && !(alcool > 0)) throw invalido('mande aguaMl ou alcoolDoses');
  return { dia, aguaMl: agua > 0 ? Math.round(agua) : 0, alcoolDoses: alcool > 0 ? Math.round(alcool * 2) / 2 : 0 };
}

/** Puro. Os hábitos de um dia ({ dia, aguaMl, alcoolDoses }). */
export function montarHabitos(doc, dia) {
  return { dia, aguaMl: Math.round(Number(doc?.agua_ml) || 0), alcoolDoses: Number(doc?.alcool_doses) || 0 };
}

// ============================================================
// Plano (W28) e perguntas (seção 3)
// ============================================================
/** Puro. Corpo do POST /plano → { pedido } ('' = o pedido guardado; 'limpar' esquece o guardado). */
export function validarPedidoPlano(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  if (c.pedido == null || c.pedido === '') return { pedido: '' };
  if (typeof c.pedido !== 'string') throw invalido('pedido em texto');
  return { pedido: c.pedido.trim().replace(/\s+/g, ' ').slice(0, 300) };
}

/** Puro. ?n= e ?antes= do GET /perguntas → { n (1 a 50), antes (Date|null) }. */
export function validarPaginaPerguntas(query) {
  const q = query || {};
  const n = q.n == null || q.n === '' ? 20 : Number(q.n);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw invalido('n entre 1 e 100'); // o app pede 20, 60 e 100 ("ver mais")
  let antes = null;
  if (q.antes != null && q.antes !== '') {
    const t = Date.parse(String(q.antes));
    if (!Number.isFinite(t)) throw invalido('antes em ISO 8601');
    antes = new Date(t);
  }
  return { n, antes };
}
