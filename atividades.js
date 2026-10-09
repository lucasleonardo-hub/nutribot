// atividades.js - Atividades fixas sem relógio (vôlei de quadra, vôlei de areia, futebol com os amigos): a pessoa cadastra
// dias, horário, intensidade (MET) e o lugar. Depois do horário, a bot confere pela localização do celular se ela esteve lá:
// esteve = soma o gasto estimado (MET × peso × horas) ao gasto do dia; estava em casa/longe = não soma; sem sinal ou em
// dúvida = pergunta no grupo e usa a resposta. Nada disso depende do relógio marcar o treino.

import { colecao, salvarPerfil, listarPerfis } from './mongo.js';
import { enviar } from './whatsapp.js';
import { estado } from './estado.js';
import { distanciaM, localDe } from './lugares.js';
import { fusoDe, agora } from './util.js';

const RAIO_PADRAO_M = 300;
const TOLERANCIA_MIN = 10; // confere a partir de 10 min depois do fim
const NOME_DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DOW_DE = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, sáb: 6 };

// ---------- puros ----------
export const kcalAtividade = (met, pesoKg, minutos) => Math.round(((Number(met) || 0) * (Number(pesoKg) || 70) * (Number(minutos) || 0)) / 60);
const hMin = (h) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const duracaoMin = (a) => Math.max(0, (hMin(a.fim) ?? 0) - (hMin(a.inicio) ?? 0));
export const descreverAtividade = (a, peso) =>
  `${a.nome} · ${a.dias.map((d) => NOME_DOW[d]).join(', ')} ${a.inicio}–${a.fim}${a.lugar?.nome ? ` · ${a.lugar.nome}` : ''} · MET ${a.met} ≈ ${kcalAtividade(a.met, peso, duracaoMin(a))} kcal`;

/** "seg,qua" -> [1,3]; "seg e qua" também. */
export function lerDias(texto) {
  return [...new Set(String(texto || '').toLowerCase().split(/[\s,;/]+/).filter((t) => t && t !== 'e').map((t) => DOW_DE[t.replace(/[^a-záé]/g, '')]).filter((d) => d != null))].sort();
}

/**
 * Puro. Pela localização, a pessoa esteve na atividade? pontos = [{ ts, lat, lon }] da janela; lugar = { lat, lon, raioM };
 * casa = { lat, lon } ou null. Devolve { estado: 'presente' | 'ausente' | 'incerto', minutosNoLugar, pontos, motivo }.
 */
export function avaliarPresenca({ pontos = [], lugar, casa = null, duracao = 60 }) {
  if (!lugar || !pontos.length) return { estado: 'incerto', minutosNoLugar: 0, pontos: pontos.length, motivo: pontos.length ? 'sem lugar cadastrado' : 'sem sinal do celular na janela' };
  const raio = lugar.raioM || RAIO_PADRAO_M;
  const noLugar = pontos.filter((p) => distanciaM(p, lugar) <= raio);
  // um ponto só pode ser a passagem de quem estava saindo da faculdade ao lado (30/09: 1 ponto virou "vôlei feito" com 20 min);
  // presente de verdade = 2 pontos ou mais no lugar
  if (noLugar.length >= 2) {
    // estadia = do primeiro ao último ponto no lugar, com crédito de meia amostra em cada ponta (15 min entre pontos)
    const ts = noLugar.map((p) => new Date(p.ts).getTime()).sort((a, b) => a - b);
    const minutos = Math.min(duracao, Math.round((ts[ts.length - 1] - ts[0]) / 60000) + 15);
    return { estado: 'presente', minutosNoLugar: Math.max(30, minutos), pontos: pontos.length, motivo: `${noLugar.length} pontos no lugar` };
  }
  if (noLugar.length === 1) return { estado: 'incerto', minutosNoLugar: 0, pontos: pontos.length, motivo: 'só 1 ponto no lugar (pode ter sido passagem)' };
  const emCasa = casa ? pontos.filter((p) => distanciaM(p, casa) <= RAIO_PADRAO_M).length : 0;
  const longe = pontos.filter((p) => distanciaM(p, lugar) > 1500).length;
  // a janela inteira em casa ou longe (com mais de um ponto pra não ser um ponto perdido) = não foi
  if (pontos.length >= 2 && (emCasa === pontos.length || longe === pontos.length)) return { estado: 'ausente', minutosNoLugar: 0, pontos: pontos.length, motivo: emCasa === pontos.length ? 'ficou em casa' : 'estava longe do lugar' };
  return { estado: 'incerto', minutosNoLugar: 0, pontos: pontos.length, motivo: 'pontos perto mas fora do raio, ou poucos pontos' };
}

/**
 * Puro. O que a atividade soma ao gasto do relógio: o relógio já conta o TOTAL do dia (inclui o metabolismo de repouso das
 * 24 h), então da atividade só entra o que passa do repouso, ~1 kcal por kg por hora (1 MET). Somar o MET bruto contava o
 * basal dessas horas duas vezes (~150 kcal em 2 h de vôlei com 75 kg). Sem duração conhecida, vai o valor como veio.
 */
export const kcalLiquida = (kcal, minutos, peso) => Math.max(0, (Number(kcal) || 0) - (Number(minutos) > 0 ? ((Number(peso) > 0 ? Number(peso) : 70) * Number(minutos)) / 60 : 0));

/** Puro. Soma o gasto das atividades feitas ao mapa de gastos do relógio (dia -> kcal); devolve o mesmo objeto relogio. */
export function somarGastosExtras(relogio, feitas) {
  if (!relogio || !feitas) return relogio;
  relogio.gastos = { ...(relogio.gastos || {}) };
  for (const [dia, lista] of Object.entries(feitas)) {
    const extra = (lista || []).reduce((a, f) => a + kcalLiquida(f.kcal, f.minutos, relogio.peso), 0);
    if (extra > 0 && relogio.gastos[dia] != null) relogio.gastos[dia] = Math.round(relogio.gastos[dia] + extra);
  }
  return relogio;
}

/** sim/não curto ("teve sim", "não rolou hoje", "fui", "não fui") -> true/false/null. */
export function lerSimNao(texto) {
  const t = String(texto || '').trim().toLowerCase();
  if (!t || t.length > 80) return null;
  if (/\b(n[ãa]o|nao rolou|n[ãa]o teve|n[ãa]o fui|cancel\w*|faltei|nem fui|não deu)\b/.test(t)) return false;
  if (/\b(sim|teve|fui|rolou|joguei|treinei|claro|tive|foi sim|normal)\b/.test(t)) return true;
  return null;
}

// ---------- banco ----------
const jidDe = (perfil) => perfil?.jids?.[0] || null;
const casaDe = (perfil) => (perfil.lugares || []).find((l) => l.papel === 'casa') || null;
const instanteLocal = (dia, hhmm, fuso) => {
  // "2026-09-30" + "20:00" no fuso da pessoa -> Date (via deslocamento medido pelo Intl)
  const alvo = new Date(`${dia}T${hhmm}:00Z`);
  const l = localDe(alvo, fuso);
  const desvio = (Number(l.dia.slice(8, 10)) - Number(dia.slice(8, 10))) * 1440 + (l.hora * 60 - (hMin(hhmm) ?? 0));
  return new Date(alvo.getTime() - Math.round(desvio) * 60000);
};

async function registrar(perfil, dia, a, { feita, kcal = 0, minutos = 0, como, detalhe }) {
  const feitas = { ...(perfil.atividadesFeitas || {}) };
  feitas[dia] = [...(feitas[dia] || []).filter((f) => f.id !== a.id), { id: a.id, nome: a.nome, feita, kcal: feita ? kcal : 0, minutos: feita ? minutos : 0, como, detalhe, em: new Date().toISOString() }];
  // mantém 60 dias
  for (const d of Object.keys(feitas)) if (d < agora().dia.slice(0, 8) + '01' && Object.keys(feitas).length > 60) delete feitas[d];
  const pendentes = (perfil.atividadesPendentes || []).filter((p) => !(p.id === a.id && p.dia === dia));
  const patch = { jids: perfil.jids, atividadesFeitas: feitas, atividadesPendentes: pendentes };
  // no gasto do dia entra o LÍQUIDO (o que passa do repouso), o mesmo que somarGastosExtras soma quando o relógio sincroniza
  // de novo: antes entrava o bruto aqui e o líquido depois da sincronização, e o mesmo dia mudava de gasto sozinho
  const somadas = feita ? Math.round(kcalLiquida(kcal, minutos, perfil.relogio?.peso)) : 0;
  if (somadas > 0 && perfil.relogio?.gastos) {
    const relogio = { ...perfil.relogio, gastos: { ...perfil.relogio.gastos } };
    relogio.gastos[dia] = Math.round((relogio.gastos[dia] || 0) + somadas);
    patch.relogio = relogio;
  }
  await salvarPerfil(patch);
  console.log(`[atividades] ${perfil.nome}: ${a.nome} ${dia} ${feita ? `FEITA (${kcal} kcal, +${somadas} no gasto, ${como})` : `não feita (${como})`}${detalhe ? ` — ${detalhe}` : ''}`);
  return { feita, kcal, somadas };
}

/**
 * Cron (a cada 15 min): pra cada pessoa e atividade cujo horário de hoje já passou, decide pela localização;
 * na dúvida pergunta no grupo uma vez e deixa pendente. `lembrar` grava a pergunta na memória do dia.
 */
export async function verificarAtividades({ lembrar } = {}) {
  const grupo = estado.memoria.grupo;
  const perfis = (await listarPerfis().catch(() => [])).filter((p) => p.onboarded && p.atividades?.length);
  for (const perfil of perfis) {
    const fuso = fusoDe(perfil);
    const ag = localDe(new Date(), fuso);
    for (const a of perfil.atividades) {
      if (!a.dias?.includes(ag.dow)) continue;
      const fimMin = hMin(a.fim);
      if (fimMin == null || ag.hora * 60 < fimMin + TOLERANCIA_MIN) continue; // ainda não acabou
      const dia = ag.dia;
      if ((perfil.atividadesFeitas?.[dia] || []).some((f) => f.id === a.id)) continue; // já decidida
      if ((perfil.atividadesPendentes || []).some((p) => p.id === a.id && p.dia === dia)) continue; // já perguntada
      const ini = instanteLocal(dia, a.inicio, fuso);
      const fim = instanteLocal(dia, a.fim, fuso);
      const pontos = perfil.lugaresAtivo
        ? await colecao('locais_brutos').find({ jid: jidDe(perfil), ts: { $gte: new Date(ini.getTime() - 10 * 60000), $lte: new Date(fim.getTime() + 10 * 60000) } }).toArray().catch(() => [])
        : [];
      const av = avaliarPresenca({ pontos, lugar: a.lugar, casa: casaDe(perfil), duracao: duracaoMin(a) });
      if (av.estado === 'presente') {
        await registrar(perfil, dia, a, { feita: true, kcal: kcalAtividade(a.met, perfil.peso, av.minutosNoLugar), minutos: av.minutosNoLugar, como: 'localizacao', detalhe: av.motivo });
      } else if (av.estado === 'ausente') {
        await registrar(perfil, dia, a, { feita: false, como: 'localizacao', detalhe: av.motivo });
      } else {
        // pergunta uma vez; a resposta curta ("teve", "não rolou") resolve em responderPendente
        const pendentes = [...(perfil.atividadesPendentes || []), { id: a.id, dia, perguntadoEm: new Date().toISOString(), motivo: av.motivo }];
        await salvarPerfil({ jids: perfil.jids, atividadesPendentes: pendentes });
        if (grupo && estado.statusConexao === 'conectado') {
          const texto = `${perfil.nome.split(' ')[0]}, teve ${a.nome} hoje? Não consegui ver pelo celular (${av.motivo}). Me diz "teve" ou "não teve" que eu acerto teu gasto do dia. 🏐`;
          await enviar(grupo, texto).catch(() => {});
          if (lembrar) await lembrar({ hora: agora().hora, jid: null, nome: 'bot', texto, tipo: 'bot' }).catch(() => {});
        }
        console.log(`[atividades] ${perfil.nome}: ${a.nome} ${dia} em dúvida (${av.motivo}); perguntei`);
      }
    }
  }
}

/** Resposta curta a uma pergunta pendente de hoje/ontem: registra e devolve o texto de confirmação, ou null se não era isso. */
export async function responderPendente(perfil, texto) {
  const pend = (perfil?.atividadesPendentes || []).filter((p) => p.dia >= agora(fusoDe(perfil)).dia.slice(0, 8) + '01' || true).slice(-2);
  if (!pend.length) return null;
  const resposta = lerSimNao(texto);
  if (resposta == null) return null;
  const p = pend[pend.length - 1];
  const a = (perfil.atividades || []).find((x) => x.id === p.id);
  if (!a) return null;
  const minutos = duracaoMin(a);
  const r = await registrar(perfil, p.dia, a, { feita: resposta, kcal: kcalAtividade(a.met, perfil.peso, minutos), minutos, como: 'resposta' });
  return r.feita ? `Anotado: ${a.nome} feito, somei uns *${r.somadas} kcal* no teu gasto de ${p.dia === agora(fusoDe(perfil)).dia ? 'hoje' : p.dia.slice(8, 10) + '/' + p.dia.slice(5, 7)} (o que passa do repouso, que o relógio já conta). 🏐` : `Anotado: sem ${a.nome} ${p.dia === agora(fusoDe(perfil)).dia ? 'hoje' : 'nesse dia'}. Gasto fica só o do relógio.`;
}

/**
 * Relato na conversa, vindo da linha oculta ATIVIDADE da IA: { nome, feita, inicio?, fim?, dia? }.
 * "adiantei o vôlei pras 18h" = feita com o horário dito; "hoje não teve vôlei" = não feita. Devolve texto curto ou null.
 */
export async function registrarRelato(perfil, relato, diaHoje) {
  if (!relato || !perfil?.atividades?.length) return null;
  const alvo = String(relato.nome || '').toLowerCase();
  const a = perfil.atividades.find((x) => x.nome.toLowerCase().includes(alvo) || alvo.includes(x.nome.toLowerCase().split(' ')[0])) || (perfil.atividades.length === 1 ? perfil.atividades[0] : null);
  if (!a) return null;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(relato.dia || '') ? relato.dia : diaHoje;
  const feita = relato.feita !== false;
  let minutos = duracaoMin(a);
  if (hMin(relato.inicio) != null && hMin(relato.fim) != null && hMin(relato.fim) > hMin(relato.inicio)) minutos = hMin(relato.fim) - hMin(relato.inicio);
  const kcal = kcalAtividade(a.met, perfil.peso, minutos);
  // já estava registrada pela localização com valor diferente? o relato da pessoa manda: desfaz o anterior no gasto
  const anterior = (perfil.atividadesFeitas?.[dia] || []).find((f) => f.id === a.id);
  if (anterior?.kcal && perfil.relogio?.gastos?.[dia] != null) {
    // desfaz o que tinha sido SOMADO (o líquido), não o bruto da atividade
    const relogio = { ...perfil.relogio, gastos: { ...perfil.relogio.gastos } };
    relogio.gastos[dia] = Math.round(relogio.gastos[dia] - kcalLiquida(anterior.kcal, anterior.minutos, perfil.relogio.peso));
    await salvarPerfil({ jids: perfil.jids, relogio });
    perfil = { ...perfil, relogio };
  }
  const r = await registrar(perfil, dia, a, { feita, kcal, minutos, como: 'relato', detalhe: relato.inicio ? `disse que foi ${relato.inicio}–${relato.fim || '?'}` : 'disse na conversa' });
  return feita ? `(${a.nome}: +${r.somadas} kcal no gasto de ${dia === diaHoje ? 'hoje' : dia}, o que passa do repouso)` : `(${a.nome}: sem ${dia === diaHoje ? 'hoje' : dia}, gasto só do relógio)`;
}

/** No fechamento do dia: pergunta sem resposta vira "não feita (sem resposta)", pra não inflar o gasto. */
export async function fecharPendentes(perfil, dia) {
  const pend = (perfil?.atividadesPendentes || []).filter((p) => p.dia <= dia);
  let atual = perfil;
  for (const p of pend) {
    const a = (atual.atividades || []).find((x) => x.id === p.id);
    if (!a) continue;
    await registrar(atual, p.dia, a, { feita: false, como: 'sem_resposta' });
    atual = { ...atual, atividadesFeitas: { ...(atual.atividadesFeitas || {}), [p.dia]: [...((atual.atividadesFeitas || {})[p.dia] || []), { id: a.id }] }, atividadesPendentes: (atual.atividadesPendentes || []).filter((x) => x !== p) };
  }
}

// ---------- textos ----------
/** Bloco pro prompt e pro roteiro: agenda fixa + situação de hoje. */
export function blocoAtividades(perfil, { dia, dow } = {}) {
  const lista = perfil?.atividades || [];
  if (!lista.length) return '';
  const hoje = lista.filter((a) => a.dias?.includes(dow));
  const feitas = perfil.atividadesFeitas?.[dia] || [];
  const pend = (perfil.atividadesPendentes || []).filter((p) => p.dia === dia);
  const st = (a) => {
    const f = feitas.find((x) => x.id === a.id);
    if (f) return f.feita ? `FEITA hoje (~${f.kcal} kcal da atividade; +${Math.round(kcalLiquida(f.kcal, f.minutos, perfil.relogio?.peso))} já somados no gasto, o que passa do repouso que o relógio já conta)` : `NÃO houve hoje (${f.como === 'sem_resposta' ? 'sem resposta' : f.como === 'resposta' ? 'ela(e) disse' : 'pela localização'})`;
    if (pend.some((p) => p.id === a.id)) return 'em dúvida, já perguntei; se ela(e) responder, o sistema anota';
    return 'ainda vai acontecer / ainda não conferi';
  };
  return (
    `ATIVIDADES FIXAS SEM RELÓGIO (o gasto é estimado por MET e só entra quando confirmado pela localização ou pela pessoa; não some por conta própria):\n` +
    lista.map((a) => `- ${descreverAtividade(a, perfil.peso)}${hoje.includes(a) ? ` → HOJE: ${st(a)}` : ''}`).join('\n')
  );
}
/** Itens de hoje pro roteiroDoDia (mesma forma dos eventos de agenda). */
export function atividadesComoAgenda(perfil, { dia, dow, fuso }) {
  return (perfil?.atividades || [])
    .filter((a) => a.dias?.includes(dow))
    .map((a) => {
      const f = (perfil.atividadesFeitas?.[dia] || []).find((x) => x.id === a.id);
      const marca = f ? (f.feita ? ' ✔ confirmado' : ' ✘ não houve') : '';
      return { titulo: `${a.nome}${marca}`, tipo: 'atividade fixa', inicio: instanteLocal(dia, a.inicio, fuso).toISOString(), fim: instanteLocal(dia, a.fim, fuso).toISOString() };
    });
}
/** !atividade */
export function atividadesZap(perfil) {
  const lista = perfil?.atividades || [];
  const { dia, dow } = localDe(new Date(), fusoDe(perfil));
  if (!lista.length) return 'Nenhuma atividade fixa cadastrada. Exemplo: !atividade nova Vôlei; seg,qua; 20:00-22:00; met 6; aqui (usa o lugar onde você está) ou "; lugar UFSC".';
  const feitas = perfil.atividadesFeitas?.[dia] || [];
  const linhas = lista.map((a, i) => {
    const f = feitas.find((x) => x.id === a.id);
    const hoje = a.dias.includes(dow) ? (f ? (f.feita ? `\nHoje: feita, +${f.kcal} kcal` : '\nHoje: não houve') : '\nHoje: ainda vou conferir') : '';
    return `${i + 1}) *${a.nome}*\n${a.dias.map((d) => NOME_DOW[d]).join(', ')} · ${a.inicio}–${a.fim}\n${a.lugar?.nome || 'lugar não definido'} · MET ${a.met} ≈ *${kcalAtividade(a.met, perfil.peso, duracaoMin(a))} kcal*${hoje}`;
  });
  return `🏐 *Atividades fixas*\n\n${linhas.join('\n\n')}\n\n_Confiro pela localização depois do horário; na dúvida pergunto. "!atividade sim" ou "!atividade não" responde; "!atividade remover 2" apaga._`;
}
/** !atividade nova Nome; seg,qua; 20:00-22:00; met 6; aqui | lugar <trecho do nome de um lugar seu> */
export async function criarAtividade(perfil, texto) {
  const partes = String(texto || '').split(';').map((t) => t.trim());
  const [nome, diasTxt, horario, metTxt, lugarTxt] = partes;
  const dias = lerDias(diasTxt);
  const h = /^(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})$/.exec(horario || '');
  const met = Number((metTxt || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 5;
  if (!nome || !dias.length || !h) return { erro: 'Formato: !atividade nova Vôlei; seg,qua; 20:00-22:00; met 6; aqui' };
  let lugar = null;
  if (/^aqui$/i.test(lugarTxt || '')) {
    const ultimo = await colecao('locais_brutos').find({ jid: jidDe(perfil) }).sort({ ts: -1 }).limit(1).next();
    if (!ultimo) return { erro: 'Não tenho tua localização agora (abre o app Relógio e sincroniza).' };
    lugar = { lat: ultimo.lat, lon: ultimo.lon, nome: 'onde você estava ao cadastrar', raioM: RAIO_PADRAO_M };
  } else if (/^lugar\s+/i.test(lugarTxt || '')) {
    const trecho = lugarTxt.replace(/^lugar\s+/i, '').toLowerCase();
    const l = (perfil.lugares || []).find((x) => `${x.nome || ''} ${x.tipo || ''} ${x.bairro || ''}`.toLowerCase().includes(trecho));
    if (!l) return { erro: `Não achei um lugar teu com "${trecho}". Veja !lugares.` };
    lugar = { lat: l.lat, lon: l.lon, nome: l.nome || l.tipo, raioM: RAIO_PADRAO_M };
  }
  const a = { id: `a${Date.now().toString(36)}`, nome, dias, inicio: h[1].padStart(5, '0'), fim: h[2].padStart(5, '0'), met, lugar, criadoEm: agora().dia };
  await salvarPerfil({ jids: perfil.jids, atividades: [...(perfil.atividades || []), a] });
  return { ok: `Cadastrado: ${descreverAtividade(a, perfil.peso)}${lugar ? '' : ' (sem lugar: vou sempre perguntar)'}` };
}
export async function removerAtividade(perfil, n) {
  const lista = [...(perfil.atividades || [])];
  const i = Number(n) - 1;
  if (!(i >= 0 && i < lista.length)) return 'Número inválido. Veja !atividade.';
  const [rem] = lista.splice(i, 1);
  await salvarPerfil({ jids: perfil.jids, atividades: lista });
  return `Removida: ${rem.nome}.`;
}
