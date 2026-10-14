// api-escrita.js - Escrita da API v1 do app NutriBot (fase 2): registrar, ajustar e apagar refeição; humor; eventos da
// pessoa; pesagem; meta e objetivo. O contrato está em docs/app/2026-10-14-plano-fase2.md.
//
// Nada aqui refaz lógica do bot: cada rota chama a mesma função que o WhatsApp já chama (registrarRefeicao com sempreNova
// como o !refeicao, atualizarRefeicao, apagarRefeicaoPorId, registrarPesagem, aplicarAtualizacao + salvarPerfil). O que o
// bot não tinha (humor, eventos criados pela pessoa, itens com gramas) nasce aditivo. As validações são puras e testadas;
// as rotas são finas. O acesso ao banco e a IA são injetáveis (rotasDeEscrita({ escrita, ia })) pra testar sem Mongo.
//
// Dono: todo registro alterado ou apagado precisa ter `jid` entre os jids do perfil do pedido; senão 404 (não vaza nem
// que existe). PUT em vez de PATCH: o HttpURLConnection do Android não manda PATCH.

import { SLOTS, minutosDe, slotDaHora, diasAnteriores, fusoDe, TZ, agora as agoraEm, fusoValido } from './util.js';
import { erroApi } from './api-auth.js';
import { nomeDoSlot } from './resumo.js';
import { termosDeLugar, montarEvento, montarHumor, hashCurto, FATOS_EDITAVEIS, FATOS_APAGAVEIS } from './api-montadores.js';

/** Puro. `dia` + n dias (n pode ser negativo), em YYYY-MM-DD. */
export const somarDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export const TIPOS_EVENTO = ['comer_fora', 'festa', 'viagem', 'treino', 'consulta', 'outro'];
export const NOME_TIPO_EVENTO = { comer_fora: 'comer fora', festa: 'festa', viagem: 'viagem', treino: 'treino', consulta: 'consulta', outro: 'compromisso' };
export const MAX_FOTOS = 2;
export const MAX_FOTO_BYTES = 2 * 1024 * 1024; // decodificada
export const MAX_MINIATURA_CHARS = 32 * 1024; // base64 (~24 KB de JPEG)
export const MAX_DIAS_ATRAS = 31;
export const MAX_DIAS_FRENTE_EVENTO = 60;
export const MAX_ANALISES_HORA = 60; // chamadas à IA por hora, no processo todo (custo; o token já limita quem chama)
export const MAX_TEXTO_FATO = 400;
export const MAX_DIAS_PESAGENS = 366; // GET /pesagens?de=&ate= (fase 3: 90 dias e 1 ano no gráfico)
const SLOT_IDS = SLOTS.map((s) => s.id);
const MIMES_FOTO = ['image/jpeg', 'image/png', 'image/webp'];

// ============================================================
// Validações puras (lançam erroApi 400 no formato do contrato)
// ============================================================
export const ehDia = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};
export const ehHora = (h) => typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
const invalido = (msg) => erroApi(400, 'pedido_invalido', msg);
const numero = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

/** Puro. `dia` do pedido (padrão: hoje) dentro de [hoje − atras, hoje + frente]. */
export function diaValido(dia, hoje, { atras = MAX_DIAS_ATRAS, frente = 0, rotulo = 'dia' } = {}) {
  const d = dia == null || dia === '' ? hoje : String(dia);
  if (!ehDia(d)) throw erroApi(400, 'dia_invalido', `${rotulo} no formato YYYY-MM-DD`);
  if (d > somarDias(hoje, frente)) throw erroApi(400, 'dia_invalido', frente ? `${rotulo} até ${frente} dias à frente` : `${rotulo} no futuro (hoje é ${hoje} no fuso da pessoa)`);
  if (d < diasAnteriores(hoje, atras + 1)[0]) throw erroApi(400, 'dia_invalido', `${rotulo} até ${atras} dias para trás`);
  return d;
}

/**
 * Puro. Corpo do POST /refeicoes → { texto, fotos: [{ mimeType, data: Buffer }], miniatura, slot, horaLocal, dia }.
 * Precisa de texto ou foto. Sem hora: a de agora quando é hoje; nos dias anteriores, a hora padrão do slot.
 */
export function validarRefeicaoNova(corpo, { hoje, horaAgora }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const t = texto(c.texto, 500);
  const fotosIn = Array.isArray(c.fotos) ? c.fotos : [];
  if (fotosIn.length > MAX_FOTOS) throw invalido(`no máximo ${MAX_FOTOS} fotos`);
  const fotos = fotosIn.map((f, i) => {
    const mimeType = String(f?.mime || f?.mimeType || '').toLowerCase();
    if (!MIMES_FOTO.includes(mimeType)) throw invalido(`foto ${i + 1}: mime precisa ser ${MIMES_FOTO.join(', ')}`);
    const b64 = typeof f?.base64 === 'string' ? f.base64.replace(/^data:[^,]*,/, '') : '';
    if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw invalido(`foto ${i + 1}: base64 inválido`);
    const data = Buffer.from(b64, 'base64');
    if (data.length < 64) throw invalido(`foto ${i + 1}: vazia`);
    if (data.length > MAX_FOTO_BYTES) throw invalido(`foto ${i + 1}: maior que ${Math.round(MAX_FOTO_BYTES / 1024 / 1024)} MB; o app reduz antes de mandar`);
    return { mimeType, data };
  });
  if (!t && !fotos.length) throw invalido('mande o texto do que comeu ou uma foto');
  let miniatura = null;
  if (c.miniatura != null && c.miniatura !== '') {
    const m = String(c.miniatura).replace(/^data:[^,]*,/, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(m)) throw invalido('miniatura: base64 inválido');
    if (m.length > MAX_MINIATURA_CHARS) throw invalido('miniatura grande demais (até 24 KB)');
    miniatura = m;
  }
  const slot = c.slot == null || c.slot === '' ? null : String(c.slot);
  if (slot && !SLOT_IDS.includes(slot)) throw invalido(`slot precisa ser um de ${SLOT_IDS.join(', ')}`);
  const dia = diaValido(c.dia, hoje);
  let horaLocal = c.hora == null || c.hora === '' ? null : String(c.hora);
  if (horaLocal && !ehHora(horaLocal)) throw invalido('hora no formato HH:MM');
  if (!horaLocal) {
    const padrao = SLOTS.find((s) => s.id === slot)?.padrao;
    horaLocal = dia === hoje ? horaAgora : padrao != null ? hhmm(padrao) : '12:00';
  }
  return { texto: t, fotos, miniatura, slot, horaLocal, dia };
}
const hhmm = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Puro. Itens normalizados pro registro: nome, gramas, kcal/p/c/g por item e a DENSIDADE (kcal100, p100, c100, g100 =
 * por 100 g), com os valores escalados pra somar EXATAMENTE a estimativa da refeição (a IA nem sempre fecha a conta; a
 * fusão de um complemento pelo WhatsApp e a kcal digitada mudam o total sem mexer nos itens; o ajuste por gramas parte
 * dos itens, então eles precisam bater com o total antes). O resto do arredondamento vai pro maior item. Itens sem kcal
 * ficam como vieram. A densidade é o que deixa um item zerado (0 g) voltar depois.
 */
export function normalizarItens(itens, estimativa) {
  const lista = (Array.isArray(itens) ? itens : [])
    .map((i) => ({
      nome: texto(i?.nome, 80),
      gramas: naoNegativo(numero(i?.gramas ?? i?.g_porcao)),
      kcal: naoNegativo(numero(i?.kcal)),
      p: naoNegativo(numero(i?.p ?? i?.proteina_g)),
      c: naoNegativo(numero(i?.c ?? i?.carboidratos_g)),
      g: naoNegativo(numero(i?.g ?? i?.gorduras_g)),
      kcal100: positivo(numero(i?.kcal100)),
      p100: naoNegativo(numero(i?.p100)),
      c100: naoNegativo(numero(i?.c100)),
      g100: naoNegativo(numero(i?.g100)),
    }))
    .filter((i) => i.nome)
    .slice(0, 15);
  const e = estimativa || {};
  const soma = (k) => lista.reduce((a, i) => a + (i.kcal != null ? Number(i[k]) || 0 : 0), 0);
  const fator = (k) => (soma(k) > 0 && Number(e[k]) > 0 ? Number(e[k]) / soma(k) : 1);
  const fk = fator('kcal');
  const fp = fator('p');
  const fc = fator('c');
  const fg = fator('g');
  const dens = (valor, gramas, antiga, f) => (gramas > 0 && valor != null ? r1((valor / gramas) * 100) : antiga != null ? r1(antiga * f) : null);
  const out = lista.map((i) => {
    if (i.kcal == null) return i;
    const kcal = Math.round(i.kcal * fk);
    const p = i.p == null ? null : r1(i.p * fp);
    const c = i.c == null ? null : r1(i.c * fc);
    const g = i.g == null ? null : r1(i.g * fg);
    return { ...i, kcal, p, c, g, kcal100: dens(kcal, i.gramas, i.kcal100, fk), p100: dens(p, i.gramas, i.p100, fp), c100: dens(c, i.gramas, i.c100, fc), g100: dens(g, i.gramas, i.g100, fg) };
  });
  // o resto do arredondamento (poucas kcal) vai pro maior item: a soma dos itens É a estimativa
  const alvo = Math.round(Number(e.kcal) || 0);
  const somaKcal = out.reduce((a, i) => a + (Number(i.kcal) || 0), 0);
  if (alvo > 0 && somaKcal > 0 && somaKcal !== alvo) {
    const maior = out.reduce((m, i) => (Number(i.kcal) > Number(m.kcal) ? i : m), out.find((i) => i.kcal != null));
    maior.kcal = Math.max(0, maior.kcal + (alvo - somaKcal));
  }
  return out;
}
const positivo = (n) => (n != null && Number.isFinite(n) && n > 0 ? n : null);
const naoNegativo = (n) => (n != null && Number.isFinite(n) && n >= 0 ? n : null);
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Puro. Ajuste por gramas: os itens novos ({ nome, gramas }) casam com os do registro pelo nome (sem caixa/acentos; nome
 * repetido casa pela posição); cada item com densidade (kcal100, ou kcal/gramas) é refeito pras gramas novas (0 g = tirou
 * do prato, e a densidade guardada deixa voltar); os outros ficam como estão. Devolve { itens, estimativa } com a
 * estimativa = soma dos itens, ou null quando nenhum item tem densidade (não há do que partir: o app manda kcal direto).
 */
export function aplicarGramas(registro, itensNovos) {
  const atuais = Array.isArray(registro?.itens) ? registro.itens : [];
  const densidade = (i, k, k100) => (Number(i?.[k100]) > 0 || (k100 === 'kcal100' ? false : Number(i?.[k100]) >= 0 && i?.[k100] != null) ? Number(i[k100]) / 100 : Number(i?.gramas) > 0 && i?.[k] != null ? Number(i[k]) / Number(i.gramas) : null);
  if (!atuais.some((i) => densidade(i, 'kcal', 'kcal100') > 0)) return null;
  const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const novos = Array.isArray(itensNovos) ? itensNovos : [];
  const repetidos = new Set(atuais.map((i) => chave(i?.nome)).filter((k, idx, arr) => arr.indexOf(k) !== idx));
  const itens = atuais.map((i, idx) => {
    const k = chave(i?.nome);
    const n = repetidos.has(k) || !texto(novos[idx]?.nome, 80) ? (chave(novos[idx]?.nome) === k || !texto(novos[idx]?.nome, 80) ? novos[idx] : null) : novos.find((x) => chave(x?.nome) === k);
    const g = naoNegativo(numero(n?.gramas));
    const dk = densidade(i, 'kcal', 'kcal100');
    if (g == null || !(dk > 0)) return { ...i };
    const por = (campo, campo100) => {
      const d = densidade(i, campo, campo100);
      return d == null ? null : r1(d * g);
    };
    return { ...i, gramas: Math.round(g), kcal: Math.round(dk * g), p: por('p', 'p100'), c: por('c', 'c100'), g: por('g', 'g100'), kcal100: r1(dk * 100), p100: i.p100 ?? (Number(i.gramas) > 0 && i.p != null ? r1((i.p / i.gramas) * 100) : null), c100: i.c100 ?? (Number(i.gramas) > 0 && i.c != null ? r1((i.c / i.gramas) * 100) : null), g100: i.g100 ?? (Number(i.gramas) > 0 && i.g != null ? r1((i.g / i.gramas) * 100) : null) };
  });
  const soma = (k) => Math.round(itens.reduce((a, i) => a + (Number(i[k]) || 0), 0));
  return { itens, estimativa: { kcal: soma('kcal'), p: soma('p'), c: soma('c'), g: soma('g') } };
}

/** Puro. Corpo do PUT /refeicoes/:rid → { kcal, p, c, g, descricao, slot, horaLocal, itens } (só o que veio). */
export function validarAjuste(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const out = {};
  for (const k of ['kcal', 'p', 'c', 'g']) {
    if (c[k] == null || c[k] === '') continue;
    const n = numero(c[k]);
    if (!Number.isFinite(n) || n < 0 || n > (k === 'kcal' ? 8000 : 1500)) throw invalido(`${k} fora da faixa`);
    out[k] = Math.round(n);
  }
  if (c.descricao != null) {
    const d = texto(c.descricao, 220);
    if (!d) throw invalido('descrição vazia');
    out.descricao = d;
  }
  if (c.slot != null && c.slot !== '') {
    if (!SLOT_IDS.includes(String(c.slot))) throw invalido(`slot precisa ser um de ${SLOT_IDS.join(', ')}`);
    out.slot = String(c.slot);
  }
  if (c.hora != null && c.hora !== '') {
    if (!ehHora(String(c.hora))) throw invalido('hora no formato HH:MM');
    out.horaLocal = String(c.hora);
  }
  if (c.itens != null) {
    if (!Array.isArray(c.itens) || c.itens.length > 15) throw invalido('itens: lista de até 15 { nome, gramas }');
    out.itens = c.itens.map((i) => {
      const g = numero(i?.gramas);
      if (g == null || !Number.isFinite(g) || g < 0 || g > 5000) throw invalido('gramas fora da faixa (0 a 5000)');
      return { nome: texto(i?.nome, 80), gramas: g };
    });
  }
  if (!Object.keys(out).length) throw invalido('nada para ajustar');
  return out;
}

/** Puro. Corpo do PUT /humor → { dia, humor, energia, sono, texto }. */
export function validarHumor(corpo, { hoje }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const nota = (v, nome, obrigatorio) => {
    const n = numero(v);
    if (n == null) {
      if (obrigatorio) throw invalido(`${nome} de 1 a 5`);
      return null;
    }
    if (!Number.isInteger(n) || n < 1 || n > 5) throw invalido(`${nome} de 1 a 5`);
    return n;
  };
  return { dia: diaValido(c.dia, hoje), humor: nota(c.humor, 'humor', true), energia: nota(c.energia, 'energia', false), sono: nota(c.sono, 'sono', false), texto: texto(c.texto, 200) };
}

/** Puro. Corpo do POST /eventos → { dia, hora, titulo, tipo, nota }. Dia de 31 dias atrás até 60 à frente. */
export function validarEvento(corpo, { hoje }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const titulo = texto(c.titulo, 80);
  if (!titulo) throw invalido('título obrigatório');
  const tipo = c.tipo == null || c.tipo === '' ? 'outro' : String(c.tipo);
  if (!TIPOS_EVENTO.includes(tipo)) throw invalido(`tipo precisa ser um de ${TIPOS_EVENTO.join(', ')}`);
  const hora = c.hora == null || c.hora === '' ? null : String(c.hora);
  if (hora && !ehHora(hora)) throw invalido('hora no formato HH:MM');
  if (c.dia == null || c.dia === '') throw erroApi(400, 'dia_invalido', 'dia obrigatório (YYYY-MM-DD)');
  return { dia: diaValido(c.dia, hoje, { frente: MAX_DIAS_FRENTE_EVENTO }), hora, titulo, tipo, nota: texto(c.nota, 200) };
}

/** Puro. Corpo do POST /pesagens → { dia, peso, gordura, hora }. */
export function validarPesagem(corpo, { hoje }) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const peso = numero(c.peso);
  if (!Number.isFinite(peso) || peso < 25 || peso > 400) throw invalido('peso entre 25 e 400 kg');
  const gordura = numero(c.gordura);
  if (gordura != null && (!Number.isFinite(gordura) || gordura < 3 || gordura > 70)) throw invalido('gordura entre 3 e 70 %');
  const hora = c.hora == null || c.hora === '' ? null : String(c.hora);
  if (hora && !ehHora(hora)) throw invalido('hora no formato HH:MM');
  return { dia: diaValido(c.dia, hoje), peso: Math.round(peso * 100) / 100, gordura: gordura == null ? null : Math.round(gordura * 10) / 10, hora };
}

/**
 * Puro. Corpo do PUT /perfis/:id → objeto no formato da linha ATUALIZAR (perfis.aplicarAtualizacao faz as faixas e as datas):
 * { objetivo, meta_peso_kg, meta_prazo, altura_cm, ritmo, sem_meta_peso }. `metaPeso: null` tira a meta.
 */
export function validarPerfil(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const a = {};
  if (c.objetivo != null) {
    const o = texto(c.objetivo, 120);
    if (!o) throw invalido('objetivo vazio');
    a.objetivo = o;
  }
  if ('metaPeso' in c) {
    if (c.metaPeso === null || c.metaPeso === '') a.sem_meta_peso = true;
    else {
      const m = numero(c.metaPeso);
      if (!Number.isFinite(m) || m < 25 || m > 400) throw invalido('meta de peso entre 25 e 400 kg');
      a.meta_peso_kg = Math.round(m * 10) / 10;
    }
  }
  if ('metaPrazo' in c) {
    if (c.metaPrazo === null || c.metaPrazo === '') a.sem_meta_prazo = true;
    else {
      if (!ehDia(String(c.metaPrazo))) throw invalido('prazo no formato YYYY-MM-DD');
      a.meta_prazo = String(c.metaPrazo);
    }
  }
  if (c.altura != null && c.altura !== '') {
    const h = numero(c.altura);
    if (!Number.isFinite(h) || h <= 100 || h >= 250) throw invalido('altura entre 101 e 249 cm'); // os mesmos limites do aplicarAtualizacao
    a.altura_cm = Math.round(h);
  }
  if (c.ritmo != null && c.ritmo !== '') {
    if (!/^(maximo|medio|minimo)$/.test(String(c.ritmo))) throw invalido('ritmo: maximo, medio ou minimo');
    a.ritmo = String(c.ritmo);
  }
  if (!Object.keys(a).length) throw invalido('nada para alterar');
  return a;
}

// ============================================================
// Corrigir o que a Nutri sabe (fase 3, puras)
// ============================================================
/** Limite de cada fato editável: dieta e restrições como o aplicarAtualizacao (120); notas como pessoas.js (4000); rotina ~150 palavras. */
export const LIMITE_FATO = { dieta: 120, restricoes: 120, rotina: 1500, notas: 4000 };

/**
 * Puro. Corpo do PUT /nutri/fatos/:fid → texto, com o limite do campo (400 quando passa; nunca trunca em silêncio) e as
 * quebras de linha preservadas (as notas são uma lista; só espaços repetidos na mesma linha são juntados).
 */
export function validarFato(corpo, fid = '') {
  const v = corpo && typeof corpo === 'object' ? corpo.texto : null;
  if (typeof v !== 'string') throw invalido('texto vazio');
  const t = v
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!t) throw invalido('texto vazio');
  const max = LIMITE_FATO[String(fid)] || MAX_TEXTO_FATO;
  if (t.length > max) throw invalido(`texto com mais de ${max} caracteres`);
  return t;
}

/**
 * Puro. A correção de um fato (texto novo, ou null = apagar) vira o patch pro salvarPerfil e a frase da correção do dia.
 * ids: 'dieta' | 'restricoes' | 'rotina' | 'notas' (editam e apagam), 'girias' (só apaga), 'produto:<hash>' e
 * 'anotacao:<hash>' (só apagam; o hash é o de api-montadores.hashCurto sobre o nome/texto gravado). 400 quando o id não
 * permite a operação; 404 quando não existe no perfil.
 */
export function aplicarCorrecaoFato(perfil, fid, textoNovo, hoje) {
  const id = String(fid || '');
  const [campo, hash] = id.split(':');
  const apagar = textoNovo == null;
  const naoEncontrado = () => erroApi(404, 'fato_nao_encontrado', 'fato não encontrado');
  const patch = { jids: perfil.jids, atualizacoes: { ...(perfil.atualizacoes || {}) } };
  const quem = perfil.nome;
  if (campo === 'produto' || campo === 'anotacao') {
    if (!apagar) throw erroApi(400, 'fato_nao_editavel', 'esse fato só pode ser apagado');
    const lista = Array.isArray(perfil[campo === 'produto' ? 'produtos' : 'anotacoes']) ? perfil[campo === 'produto' ? 'produtos' : 'anotacoes'] : [];
    const chave = (x) => hashCurto(campo === 'produto' ? x?.nome : x?.texto);
    const alvo = lista.find((x) => chave(x) === hash);
    if (!hash || !alvo) throw naoEncontrado();
    patch[campo === 'produto' ? 'produtos' : 'anotacoes'] = lista.filter((x) => chave(x) !== hash);
    // a linha da correção vai pro resumo do dia, que o grupo lê: o conteúdo de uma anotação é privado e não entra
    const oQue = campo === 'produto' ? `o produto fixo "${alvo.nome}"` : 'uma anotação da Nutri sobre ela(e) (conteúdo privado; não citar)';
    return { patch, correcao: `${quem} apagou pelo app ${oQue}` };
  }
  if (hash !== undefined) throw naoEncontrado();
  if (!FATOS_APAGAVEIS.includes(campo)) {
    // objetivo, meta, peso e altura existem como fatos, mas se editam na tela Perfil (PUT /perfis/:id)
    throw erroApi(400, apagar ? 'fato_nao_apagavel' : 'fato_nao_editavel', `${campo === 'girias' ? 'as gírias só podem ser apagadas' : 'esse fato se altera na tela Perfil'}`);
  }
  const atual = campo === 'girias' ? (Array.isArray(perfil.girias) && perfil.girias.length ? perfil.girias : null) : perfil[campo] || null;
  if (atual == null) throw naoEncontrado();
  if (apagar) {
    patch[campo] = campo === 'girias' ? [] : null;
    patch.atualizacoes[campo] = hoje;
    return { patch, correcao: `${quem} apagou pelo app ${campo === 'girias' ? 'as gírias' : campo === 'notas' ? 'as notas da Nutri sobre ela(e)' : campo === 'rotina' ? 'a ficha de rotina' : `o campo ${campo}`}` };
  }
  if (!FATOS_EDITAVEIS.includes(campo)) throw erroApi(400, 'fato_nao_editavel', 'as gírias só podem ser apagadas');
  const novo = campo === 'dieta' ? textoNovo.toLowerCase() : textoNovo;
  if (novo === atual) return { patch: null, correcao: null };
  patch[campo] = novo;
  patch.atualizacoes[campo] = hoje;
  // dieta e restrições já ficam no bloco PERFIS DO GRUPO (decisão D2); notas e rotina são privadas e não vão pro resumo
  return { patch, correcao: `${quem} corrigiu pelo app ${campo === 'notas' ? 'as notas da Nutri sobre ela(e) (conteúdo privado; não citar)' : campo === 'rotina' ? 'a ficha de rotina (conteúdo privado; não citar)' : `${campo}: "${novo.slice(0, 120)}"`}` };
}

/**
 * Puro. A pessoa descarta uma hipótese aberta: sai de perfil.hipoteses e vai, fechada como 'descartada', pra coleção
 * `hipoteses` (o mesmo destino das que a reflexão de domingo fecha). 404 se não está aberta.
 */
export function aplicarDescarteHipotese(perfil, hid, hoje) {
  const abertas = Array.isArray(perfil.hipoteses) ? perfil.hipoteses : [];
  const alvo = abertas.find((h) => h?.id && String(h.id) === String(hid || '') && (h.status || 'aberta') === 'aberta');
  if (!alvo) throw erroApi(404, 'hipotese_nao_encontrada', 'hipótese não encontrada');
  const fechada = { ...alvo, status: 'descartada', evidencia: 'descartada pela pessoa no app', fechadaEm: hoje, jid: perfil.jids?.[0], nome: perfil.nome };
  return {
    patch: { jids: perfil.jids, hipoteses: abertas.filter((h) => h !== alvo) },
    fechada,
    correcao: `${perfil.nome} descartou pelo app uma hipótese da reflexão (conteúdo privado; não citar)`,
  };
}

/**
 * Puro. Nome do arquivo da foto no Drive (fase 3): "<dia> <hora> <slot>.jpg" com a hora sem ':' (nome de arquivo).
 * A pasta é "Fotos/<AAAA-MM>" dentro da pasta da pessoa.
 */
export function nomeDaFoto({ dia, horaLocal, slot, mimeType, id }) {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  // o fim do _id entra no nome: dois almoços na mesma hora (retroativos sem hora caem na hora padrão do slot) não podem
  // dividir o mesmo arquivo (salvarEmPasta sobrescreve pelo nome)
  const sufixo = id ? ` ${String(id).slice(-6)}` : '';
  return { pasta: String(dia).slice(0, 7), nome: `${dia} ${String(horaLocal || '').replace(':', 'h')} ${nomeDoSlot(slot)}${sufixo}.${ext}` };
}

/**
 * Sobe a primeira foto do registro pra pasta da pessoa no Drive (Fotos/<AAAA-MM>/) e anota { driveId, nome } no registro.
 * Roda DEPOIS da resposta ao app (o Drive leva segundos e o app não espera); qualquer falha vira só um aviso no log.
 * `drive` = { pastaDe(perfil), subpasta(id, nome), salvarEmPasta(id, nome, buffer, mime), lixeira(id) };
 * `atualizarRefeicao` (Mongo) devolve quantos registros casaram: se a refeição foi apagada enquanto a foto subia, a foto
 * vai pra lixeira em vez de ficar órfã no Drive.
 */
export async function guardarFotoNoDrive({ drive, atualizarRefeicao, perfil, registroId, registro, foto }) {
  if (!drive || !foto?.data?.length || !registroId) return null;
  const raiz = await drive.pastaDe(perfil);
  const fotos = await drive.subpasta(raiz, 'Fotos');
  const { pasta, nome } = nomeDaFoto({ ...registro, mimeType: foto.mimeType, id: registroId });
  const mes = await drive.subpasta(fotos, pasta);
  const driveId = await drive.salvarEmPasta(mes, nome, foto.data, foto.mimeType);
  if (!driveId) return null;
  const casou = await atualizarRefeicao(registroId, { foto: { driveId, nome } });
  if (casou === 0) {
    if (drive.lixeira) await drive.lixeira(driveId).catch(() => {});
    return null;
  }
  return { driveId, nome };
}

/**
 * Puro. Hora no relógio do GRUPO de um instante dado pelo dia e hora LOCAL da pessoa (é o `hora` do registro, que liga a
 * refeição à memória do dia). Sem fuso válido, a própria hora local.
 */
export function horaDoGrupo(perfil, dia, horaLocal) {
  const tz = fusoDe(perfil);
  if (!fusoValido(tz) || !ehDia(dia) || !ehHora(horaLocal)) return horaLocal;
  const [h, m] = horaLocal.split(':').map(Number);
  const [y, mo, d] = dia.split('-').map(Number);
  const alvo = Date.UTC(y, mo - 1, d, h, m);
  // duas passadas: o deslocamento do fuso depende do instante (horário de verão)
  let instante = alvo;
  for (let i = 0; i < 2; i++) instante = alvo - deslocamentoMin(tz, new Date(instante)) * 60_000;
  return agoraEm(TZ, new Date(instante)).hora;
}
function deslocamentoMin(tz, quando) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(quando);
  const g = (t) => Number(p.find((x) => x.type === t)?.value);
  return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - Math.floor(quando.getTime() / 60000) * 60000) / 60000);
}

/**
 * Puro. Bloco "PELO APP" do prompt da Nutri: humor/energia/sono de hoje e os eventos de hoje e dos próximos dias que a
 * pessoa criou no app. '' sem nada (o prompt não ganha seção vazia).
 */
export function blocoApp({ humor = null, eventos = [], hoje }) {
  const linhas = [];
  if (humor?.humor) {
    const rotulo = ['', 'péssimo', 'ruim', 'ok', 'bom', 'ótimo'];
    const partes = [`humor ${rotulo[humor.humor] || humor.humor}/5`];
    if (humor.energia) partes.push(`energia ${humor.energia}/5`);
    if (humor.sono) partes.push(`sono (como ela(e) sentiu) ${humor.sono}/5`);
    // o texto é da pessoa pra Nutri; a resposta sai no grupo, então o prompt manda levar em conta sem citar
    linhas.push(`- Hoje, pelo app: ${partes.join(', ')}${humor.texto ? ` — ela(e) contou, EM CONFIDÊNCIA (leve em conta; não cite nem parafraseie no grupo): "${humor.texto}"` : ''}`);
  }
  for (const e of (eventos || []).filter((x) => x?.dia && x.dia >= hoje).slice(0, 8)) {
    const quando = e.dia === hoje ? 'hoje' : e.dia === somarDias(hoje, 1) ? 'amanhã' : e.dia;
    linhas.push(`- ${quando}${e.hora ? ` ${e.hora}` : ''}: ${e.titulo} (${NOME_TIPO_EVENTO[e.tipo] || e.tipo})${e.nota ? ` — ${e.nota}` : ''}`);
  }
  return linhas.join('\n');
}

// ============================================================
// Limite de análises (IA custa; o token já limita QUEM chama, isto limita QUANTO)
// ============================================================
export function criarLimiteAnalises({ max = MAX_ANALISES_HORA, agora = () => Date.now() } = {}) {
  const marcas = [];
  return () => {
    const t = agora();
    while (marcas.length && t - marcas[0] > 3600_000) marcas.shift();
    if (marcas.length >= max) return false;
    marcas.push(t);
    return true;
  };
}

// ============================================================
// Rotas
// ============================================================
/**
 * Registra as rotas de escrita no roteador `r` (já autenticado). `perfilDo(req)` e `hojeDe(perfil, perfis, dia)` vêm do api.js
 * (o mesmo /hoje que a leitura monta); `escrita` = escritaPadrao() ou um dublê; `ia.estimarRefeicaoApp` idem.
 */
export function rotasDeEscrita(r, { escrita, ia, perfilDo, hojeDe, nutriDe = async () => null, lerJsonFoto = (_req, _res, next) => next(), agora = () => new Date(), temHevyDe = () => false, adminJid = '', montarPerfil, montarRefeicao, podeAnalisar = criarLimiteAnalises() }) {
  const dono = (perfil, doc) => doc && Array.isArray(perfil.jids) && perfil.jids.includes(doc.jid);

  // ---------- refeição ----------
  // o corpo (até 6 MB, com fotos) só é lido AQUI, depois do token: anônimo não faz o servidor parsear 6 MB
  r.post('/perfis/:id/refeicoes', lerJsonFoto, async (req, res) => {
    const { perfil, perfis, hoje, hora } = await perfilDo(req);
    const v = validarRefeicaoNova(req.body, { hoje, horaAgora: hora });
    if (!podeAnalisar()) throw erroApi(429, 'muitas_analises', 'muitas análises na última hora; tente mais tarde');
    const analise = await ia.estimarRefeicaoApp({ descricao: v.texto, fotos: v.fotos, perfil, horaLocal: v.horaLocal, slot: v.slot }).catch((e) => {
      console.error('[api] análise de refeição falhou:', e?.message || e);
      throw erroApi(503, 'ia_indisponivel', 'a Nutri não conseguiu analisar agora; tente de novo em instantes');
    });
    if (!analise?.estimativa) throw erroApi(422, 'nao_e_refeicao', analise?.motivo || 'não consegui ver uma refeição aí; descreva o que comeu');
    const slot = v.slot || analise.tipo || slotDaHora(v.horaLocal).id;
    const descricao = String(analise.descricao || v.texto || '').slice(0, 220);
    const resumo = (v.texto ? `(app) ${v.texto}` : `(app) ${v.fotos.length > 1 ? `[${v.fotos.length} fotos]` : '[foto]'}`).slice(0, 120);
    const registro = {
      jid: perfil.jids[0],
      nome: perfil.nome,
      dia: v.dia,
      hora: horaDoGrupo(perfil, v.dia, v.horaLocal),
      horaLocal: v.horaLocal,
      minutos: minutosDe(v.horaLocal),
      slot,
      resumo,
      descricao,
      estimativa: analise.estimativa,
      ...(analise.incerteza ? { incerteza: analise.incerteza } : {}),
      itens: normalizarItens(analise.itens, analise.estimativa),
      origem: 'app',
      manual: true,
      sempreNova: true, // como o !refeicao: nunca funde nem substitui (a pessoa está registrando de propósito)
    };
    const id = await escrita.registrarRefeicao(registro);
    // a miniatura fica numa coleção própria (miniaturas), fora de `refeicoes`: o bot lê os registros a cada mensagem e
    // não precisa carregar JPEG; só a API junta as duas na leitura
    if (v.miniatura && id) await escrita.salvarMiniatura(id, v.miniatura).catch((e) => console.warn('[api] miniatura não gravada:', e.message));
    // a hora na memória é a da refeição (não a de agora, como no !refeicao): é por ela que dia.sincronizarRefeicoesNaMemoria casa
    if (v.dia === hoje) await escrita.lembrar({ hora: registro.hora, jid: perfil.jids[0], nome: perfil.nome, texto: `(registro pelo app) ${descricao}`, tipo: 'texto', refeicao: slot }).catch(() => {});
    const salvo = (id && (await escrita.refeicaoPorId(id))) || { _id: id, ...registro };
    res.status(201).json({ refeicao: montarRefeicao({ ...salvo, ...(v.miniatura ? { miniatura: v.miniatura } : {}) }, termos(perfis)), hoje: await hojeDe(perfil, perfis, v.dia) });
    // fase 3 (D6): a primeira foto vai pra pasta da pessoa no Drive, depois da resposta; o link aparece na próxima leitura
    if (v.fotos.length && id && escrita.guardarFoto) {
      escrita.guardarFoto({ perfil, registroId: id, registro, foto: v.fotos[0] }).catch((e) => console.warn('[api] foto não foi pro Drive:', e?.message || e));
    }
  });

  r.put('/perfis/:id/refeicoes/:rid', async (req, res) => {
    const { perfil, perfis } = await perfilDo(req);
    const atual = await escrita.refeicaoPorId(req.params.rid);
    if (!dono(perfil, atual)) throw erroApi(404, 'refeicao_nao_encontrada', 'refeição não encontrada');
    const a = validarAjuste(req.body);
    const set = {};
    // os itens são reescalados pro total ATUAL antes do ajuste: uma sobremesa fundida pelo WhatsApp ou uma kcal digitada
    // mudam a estimativa sem mexer nos itens, e o ajuste por gramas parte dos itens (revisão, achado 1)
    const base = Array.isArray(atual.itens) && atual.itens.length && Number(atual.estimativa?.kcal) > 0 ? { ...atual, itens: normalizarItens(atual.itens, atual.estimativa) } : atual;
    const porGramas = a.itens ? aplicarGramas(base, a.itens) : null;
    if (porGramas) {
      if (porGramas.estimativa.kcal > 8000) throw erroApi(400, 'pedido_invalido', 'o total passou de 8000 kcal; confira as gramas');
      set.itens = porGramas.itens;
      set.estimativa = porGramas.estimativa;
    }
    if (a.kcal != null || a.p != null || a.c != null || a.g != null) {
      const ref = set.estimativa || atual.estimativa || { kcal: 0, p: 0, c: 0, g: 0 };
      set.estimativa = { kcal: a.kcal ?? ref.kcal ?? 0, p: a.p ?? ref.p ?? 0, c: a.c ?? ref.c ?? 0, g: a.g ?? ref.g ?? 0 };
      // kcal digitada reescala os itens junto, senão o próximo ajuste por gramas volta à escala antiga
      const itensRef = set.itens || atual.itens;
      if (Array.isArray(itensRef) && itensRef.length) set.itens = normalizarItens(itensRef, set.estimativa);
    }
    if (a.descricao) set.descricao = a.descricao;
    if (a.slot) set.slot = a.slot;
    if (a.horaLocal) {
      set.horaLocal = a.horaLocal;
      set.minutos = minutosDe(a.horaLocal);
      set.hora = horaDoGrupo(perfil, atual.dia, a.horaLocal);
    }
    if (!Object.keys(set).length) throw erroApi(400, 'pedido_invalido', 'nada para ajustar');
    const estimativaAntes = atual.estimativa ? { ...atual.estimativa } : null; // copiada antes do update
    const antes = Number(estimativaAntes?.kcal) || 0;
    const depois = set.estimativa ? Number(set.estimativa.kcal) || 0 : antes;
    await escrita.atualizarRefeicao(atual._id, set);
    // correção de verdade (não o resto de arredondamento de mandar as mesmas gramas): 5 kcal ou 2 %, o que for maior
    const mudouKcal = set.estimativa && antes && depois && Math.abs(antes - depois) >= Math.max(5, 0.02 * antes);
    if (mudouKcal) {
      await escrita.registrarCorrecaoEstimativa({ jid: atual.jid, nome: atual.nome, dia: atual.dia, slot: set.slot || atual.slot, antes: estimativaAntes, depois: set.estimativa, origem: 'app', descricao: set.descricao || atual.descricao || '', texto: 'ajuste pelo app' });
    }
    const mudou = Object.keys(set)
      .filter((k) => k !== 'itens' && k !== 'minutos' && k !== 'hora' && (k !== 'estimativa' || mudouKcal))
      .map((k) => (k === 'estimativa' ? `kcal ${antes} -> ${depois}` : k))
      .join(', ');
    if (mudou) await escrita.registrarCorrecao({ dia: atual.dia, pessoa: atual.nome, texto: `${perfil.nome} ajustou pelo app a refeição das ${atual.horaLocal || atual.hora} (${nomeDoSlot(set.slot || atual.slot)}): ${mudou}` }).catch(() => {});
    const salvo = (await escrita.refeicaoPorId(atual._id)) || { ...atual, ...set };
    res.json({ refeicao: montarRefeicao(salvo, termos(perfis)), hoje: await hojeDe(perfil, perfis, atual.dia) });
  });

  r.delete('/perfis/:id/refeicoes/:rid', async (req, res) => {
    const { perfil, perfis } = await perfilDo(req);
    const atual = await escrita.refeicaoPorId(req.params.rid);
    if (!dono(perfil, atual)) throw erroApi(404, 'refeicao_nao_encontrada', 'refeição não encontrada');
    await escrita.apagarRefeicaoPorId(atual._id);
    await escrita.apagarMiniatura(atual._id).catch(() => {});
    // a foto no Drive vai pra lixeira (reversível); falha ali não desfaz o apagamento do registro
    if (atual.foto?.driveId && escrita.lixeiraDrive) escrita.lixeiraDrive(atual.foto.driveId).catch((e) => console.warn('[api] foto não foi pra lixeira do Drive:', e?.message || e));
    await escrita.registrarCorrecao({ dia: atual.dia, pessoa: atual.nome, texto: `${perfil.nome} apagou pelo app a refeição das ${atual.horaLocal || atual.hora} (${nomeDoSlot(atual.slot)}, ${Math.round(Number(atual.estimativa?.kcal) || 0)} kcal)` }).catch(() => {});
    res.json({ apagada: true, hoje: await hojeDe(perfil, perfis, atual.dia) });
  });

  // ---------- humor ----------
  r.put('/perfis/:id/humor', async (req, res) => {
    const { perfil, perfis, hoje } = await perfilDo(req);
    const h = validarHumor(req.body, { hoje });
    const salvo = await escrita.salvarHumor({ jid: perfil.jids[0], nome: perfil.nome, ...h });
    res.json({ humor: montarHumor(salvo), hoje: await hojeDe(perfil, perfis, h.dia) });
  });

  // ---------- eventos ----------
  r.get('/perfis/:id/eventos', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const de = diaValido(req.query.de, hoje, { atras: MAX_DIAS_ATRAS, frente: MAX_DIAS_FRENTE_EVENTO, rotulo: 'de' });
    const ate = diaValido(req.query.ate, hoje, { atras: MAX_DIAS_ATRAS, frente: MAX_DIAS_FRENTE_EVENTO, rotulo: 'ate' });
    if (de > ate) throw erroApi(400, 'intervalo_invalido', 'de depois de ate');
    if (diasAnteriores(ate, 62)[0] > de) throw erroApi(400, 'intervalo_invalido', 'no máximo 62 dias por pedido');
    const lista = await escrita.eventosDe(perfil.jids || [], de, ate);
    res.json({ eventos: lista.map(montarEvento) });
  });

  r.post('/perfis/:id/eventos', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const e = validarEvento(req.body, { hoje });
    const salvo = await escrita.inserirEvento({ jid: perfil.jids[0], nome: perfil.nome, ...e, criadoEm: agora() });
    res.status(201).json({ evento: montarEvento(salvo) });
  });

  r.delete('/perfis/:id/eventos/:eid', async (req, res) => {
    const { perfil } = await perfilDo(req);
    const n = await escrita.apagarEvento(req.params.eid, perfil.jids || []);
    if (!n) throw erroApi(404, 'evento_nao_encontrado', 'evento não encontrado');
    res.json({ apagado: true });
  });

  // ---------- pesagem ----------
  r.post('/perfis/:id/pesagens', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const p = validarPesagem(req.body, { hoje });
    await escrita.registrarPesagem({ jid: perfil.jids[0], nome: perfil.nome, dia: p.dia, peso: p.peso, gordura: p.gordura ?? undefined, fonte: 'app', hora: p.hora || undefined });
    res.status(201).json({ pesagem: { dia: p.dia, peso: p.peso, gordura: p.gordura, fonte: 'app', hora: p.hora } });
  });

  // ---------- perfil (objetivo, meta, prazo, altura, ritmo) ----------
  r.put('/perfis/:id', async (req, res) => {
    const { perfil, hoje } = await perfilDo(req);
    const a = validarPerfil(req.body);
    const patch = escrita.aplicarAtualizacao(perfil, a, hoje);
    let novo = perfil;
    if (patch) {
      await escrita.salvarPerfil(patch);
      novo = { ...perfil, ...patch };
    }
    res.json({ perfil: montarPerfil(novo, { temHevy: temHevyDe(novo), adminJid }) });
  });

  // ---------- o que a Nutri sabe (fase 3): corrigir e apagar fatos, descartar hipótese ----------
  // a gravação é a mesma da conversa (salvarPerfil) e a correção vai pra correcoes_dia, que o fechamento do dia lê
  // as notas da Nutri moram em três lugares (Mongo, o cache de pessoas.js e Nutri-Notas.md no Drive): a reescrita noturna
  // parte do cache, então a correção passa por salvarNotas, senão a noite devolve o texto antigo por cima da correção
  const gravarFato = async (perfil, patch, correcao, hoje) => {
    // as notas vão PRIMEIRO (cache + Drive + Mongo); se o Drive falhar, nada do Mongo muda e o app recebe 503 pra tentar
    // de novo (gravar só no Mongo e responder 200 deixaria a correção pra noite desfazer)
    if ('notas' in patch && escrita.salvarNotas) {
      await escrita.salvarNotas(perfil, patch.notas || '', hoje).catch((e) => {
        console.warn('[api] notas não foram pro Drive:', e?.message || e);
        throw erroApi(503, 'drive_indisponivel', 'não consegui gravar as notas agora; tente de novo em instantes');
      });
    }
    await escrita.salvarPerfil(patch);
    await escrita.registrarCorrecao({ dia: hoje, pessoa: perfil.nome, texto: correcao }).catch(() => {});
  };

  r.put('/perfis/:id/nutri/fatos/:fid', async (req, res) => {
    const { perfil, perfis, hoje } = await perfilDo(req);
    const { patch, correcao } = aplicarCorrecaoFato(perfil, req.params.fid, validarFato(req.body, req.params.fid), hoje);
    let novo = perfil;
    if (patch) {
      await gravarFato(perfil, patch, correcao, hoje);
      novo = { ...perfil, ...patch };
    }
    res.json({ nutri: await nutriDe(novo, perfis) });
  });

  r.delete('/perfis/:id/nutri/fatos/:fid', async (req, res) => {
    const { perfil, perfis, hoje } = await perfilDo(req);
    const { patch, correcao } = aplicarCorrecaoFato(perfil, req.params.fid, null, hoje);
    await gravarFato(perfil, patch, correcao, hoje);
    res.json({ apagado: true, nutri: await nutriDe({ ...perfil, ...patch }, perfis) });
  });

  r.delete('/perfis/:id/nutri/hipoteses/:hid', async (req, res) => {
    const { perfil, perfis, hoje } = await perfilDo(req);
    const { patch, fechada, correcao } = aplicarDescarteHipotese(perfil, req.params.hid, hoje);
    // primeiro a cópia fechada na coleção, depois sai do perfil: se o insert falhar, a hipótese não some dos dois lugares
    await escrita.guardarHipoteseFechada(fechada);
    await escrita.salvarPerfil(patch);
    await escrita.registrarCorrecao({ dia: hoje, pessoa: perfil.nome, texto: correcao }).catch(() => {});
    res.json({ apagado: true, nutri: await nutriDe({ ...perfil, ...patch }, perfis) });
  });
}
const termos = (perfis) => termosDeLugar(perfis);

/**
 * Acesso padrão (Mongo do bot, calibração, perfis e memória do dia) das rotas de escrita. Os módulos entram por import
 * dinâmico na primeira chamada: dia.js e mensagens.js importam este arquivo (bloco PELO APP), e um import estático daqui
 * pra lá fecharia um ciclo.
 */
export function escritaPadrao() {
  const de = (modulo, nome) => async (...args) => (await import(modulo))[nome](...args);
  return {
    registrarRefeicao: de('./mongo.js', 'registrarRefeicao'),
    // o registro com a miniatura junto (a API devolve a refeição de volta pro app)
    refeicaoPorId: async (id) => {
      const m = await import('./mongo.js');
      const r = await m.refeicaoPorId(id);
      if (!r) return null;
      const mini = (await m.miniaturasDe([r._id])).get(String(r._id));
      return mini ? { ...r, miniatura: mini } : r;
    },
    salvarMiniatura: de('./mongo.js', 'salvarMiniatura'),
    apagarMiniatura: de('./mongo.js', 'apagarMiniatura'),
    atualizarRefeicao: de('./mongo.js', 'atualizarRefeicao'),
    apagarRefeicaoPorId: de('./mongo.js', 'apagarRefeicaoPorId'),
    registrarCorrecao: de('./mongo.js', 'registrarCorrecao'),
    registrarCorrecaoEstimativa: de('./calibracao.js', 'registrarCorrecaoEstimativa'),
    salvarHumor: de('./mongo.js', 'salvarHumor'),
    inserirEvento: de('./mongo.js', 'inserirEvento'),
    eventosDe: de('./mongo.js', 'eventosDe'),
    apagarEvento: de('./mongo.js', 'apagarEvento'),
    registrarPesagem: de('./mongo.js', 'registrarPesagem'),
    aplicarAtualizacao: (...args) => aplicarAtualizacaoPura(...args),
    salvarPerfil: de('./mongo.js', 'salvarPerfil'),
    lembrar: de('./dia.js', 'lembrar'),
    guardarHipoteseFechada: de('./mongo.js', 'guardarHipoteseFechada'),
    salvarNotas: de('./pessoas.js', 'salvarNotas'),
    // fase 3: foto da refeição na pasta da pessoa no Drive (só com DRIVE_FOLDER_ID; sem ele, nada sobe)
    guardarFoto: async ({ perfil, registroId, registro, foto }) => {
      if (!(process.env.DRIVE_FOLDER_ID || '').trim()) return null;
      const [d, p, m] = await Promise.all([import('./drive.js'), import('./pessoas.js'), import('./mongo.js')]);
      return guardarFotoNoDrive({ drive: { pastaDe: p.pastaDe, subpasta: d.subpasta, salvarEmPasta: d.salvarEmPasta, lixeira: d.lixeira }, atualizarRefeicao: m.atualizarRefeicao, perfil, registroId, registro, foto });
    },
    lixeiraDrive: async (fileId) => {
      if (!(process.env.DRIVE_FOLDER_ID || '').trim()) return;
      await (await import('./drive.js')).lixeira(fileId);
    },
  };
}
// aplicarAtualizacao é pura e síncrona (perfis.js não importa nada daqui)
import { aplicarAtualizacao as aplicarAtualizacaoPura } from './perfis.js';
