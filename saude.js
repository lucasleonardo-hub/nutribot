// saude.js - Dados do relógio da pessoa (Galaxy Watch -> Samsung Health -> Health Connect -> app "Health Data Export" ->
// planilha Google na pasta da pessoa no Drive). A planilha tem 3 abas (Activity, Body Measurements, Sleep) e cresce todo
// dia; aqui ela vira um resumo curto (últimas 2 semanas + médias) que entra no dossiê da pessoa. Efeitos colaterais:
// cada peso da manhã vira uma pesagem com data (coleção pesagens), o peso do perfil acompanha a última medição, e um
// Nutri-Saude.md com o resumo fica na pasta da pessoa.

import { google } from 'googleapis';
import { somarGastosExtras } from './atividades.js';

import { autenticacaoGoogle, salvarEmPasta } from './drive.js';
import { colecao, registrarPesagem, salvarPerfil } from './mongo.js';
import { semanaISO } from './util.js';
import { preferirPesagem } from './progresso.js';
import { temHevy } from './treino.js';
// fase 7: a nota de sono e os fatores do sono e da energia são os MESMOS do app (fonte única em api-montadores.js). O ciclo de
// import (api-montadores importa energiaDoDia daqui) é seguro: nenhum dos dois chama o outro no carregamento do módulo
import { avaliarNoite, fatoresSono, fatoresEnergia } from './api-montadores.js';

const DIAS_DETALHE = 14; // dias listados um a um (peso) / noites (sono)
const DIAS_ATIVIDADE = 7;
const DIAS_PESAGENS = 60; // pesos gravados na coleção pesagens
const ARQ_SAUDE = 'Nutri-Saude.md';

/** A planilha do app de exportação de saúde? (nome dado pela pessoa: "Saude-Galaxy-Watch", "Health export"...) */
export const ehPlanilhaSaude = (arq) => arq?.mimeType === 'application/vnd.google-apps.spreadsheet' && /sa[uú]de|health|galaxy|watch|relogio|relógio/i.test(arq.name || '');

// ============================================================
// Leitura crua (Sheets API, mesma credencial do Drive)
// ============================================================
async function lerAbas(spreadsheetId) {
  const sheets = google.sheets({ version: 'v4', auth: autenticacaoGoogle() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title))' });
  const titulos = (meta.data.sheets || []).map((s) => s.properties.title);
  const abas = {};
  for (const t of titulos) {
    const v = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${t}'!A:Z` });
    abas[t] = v.data.values || [];
  }
  return abas;
}

// ============================================================
// Interpretação (puro; testável)
// ============================================================
const num = (v) => {
  if (v == null || v === '') return null;
  let s = String(v).trim();
  if (s.includes('=')) s = s.split('=').pop(); // "2026-09-16 07:10:52=1.810" (altura vem assim do app)
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.'); // decimal com vírgula
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const col = (cab, ...nomes) => {
  const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (const n of nomes) {
    const i = cab.findIndex((c) => norm(c).startsWith(norm(n)));
    if (i >= 0) return i;
  }
  return -1;
};
const diaDe = (v) => String(v || '').slice(0, 10);
const horaDe = (v) => String(v || '').slice(11, 16);
const ehSamsung = (fonte) => /shealth|samsung/i.test(String(fonte || ''));

/** Linhas cruas das abas -> { pesos, sonos, atividades } ordenados por dia (mais antigo primeiro). */
export function interpretarAbas(abas) {
  const acharAba = (re) => Object.entries(abas || {}).find(([t]) => re.test(t))?.[1] || [];
  const corpo = acharAba(/body|corpo|peso|weight/i);
  const sono = acharAba(/sleep|sono/i);
  const atividade = acharAba(/activity|atividade/i);

  // ---- peso e composição: uma medição por dia (a primeira da manhã; prefere Samsung Health: progresso.preferirPesagem)
  const pesos = new Map();
  if (corpo.length > 1) {
    const cab = corpo[0];
    const iData = col(cab, 'date');
    const iFonte = col(cab, 'source');
    const iPeso = col(cab, 'weight');
    const iGord = col(cab, 'body fat');
    const iAlt = col(cab, 'height');
    const iMagra = col(cab, 'lean body mass');
    for (const l of corpo.slice(1)) {
      const dia = diaDe(l[iData]);
      const peso = iPeso >= 0 ? num(l[iPeso]) : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !peso) continue;
      const nova = {
        dia,
        hora: horaDe(l[iData]),
        peso,
        gordura: iGord >= 0 ? num(l[iGord]) : null,
        altura: iAlt >= 0 ? num(l[iAlt]) : null,
        magra: iMagra >= 0 ? num(l[iMagra]) : null,
        fonte: l[iFonte] || '',
      };
      pesos.set(dia, preferirPesagem(pesos.get(dia), nova, ehSamsung));
    }
  }

  // ---- sono: por noite (Date = dia em que acordou); mais de uma sessão no mesmo dia soma
  const sonos = new Map();
  if (sono.length > 1) {
    const cab = sono[0];
    const iData = col(cab, 'date');
    const iIni = col(cab, 'start');
    const iFim = col(cab, 'end');
    const iLeve = col(cab, 'light');
    const iProf = col(cab, 'deep');
    const iRem = col(cab, 'rem');
    const iAco = col(cab, 'awake');
    for (const l of sono.slice(1)) {
      const dia = diaDe(l[iData]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
      const s = sonos.get(dia) || { dia, inicio: null, fim: null, principal: 0, leve: 0, profundo: 0, rem: 0, acordado: 0, sessoes: 0 };
      const leve = num(l[iLeve]) || 0;
      const profundo = num(l[iProf]) || 0;
      const rem = num(l[iRem]) || 0;
      const duracao = leve + profundo + rem;
      // a sessão mais longa é a noite (define deitou/levantou); cochilos só somam nas horas
      if (duracao >= s.principal) {
        s.principal = duracao;
        s.inicio = String(l[iIni] || '') || s.inicio;
        s.fim = String(l[iFim] || '') || s.fim;
      }
      s.leve += leve;
      s.profundo += profundo;
      s.rem += rem;
      s.acordado += num(l[iAco]) || 0;
      s.sessoes += 1;
      s.total = s.leve + s.profundo + s.rem;
      sonos.set(dia, s);
    }
  }

  // ---- atividade: por dia, juntando fontes (passos = maior valor; treinos = linhas com nome de exercício)
  const atividades = new Map();
  if (atividade.length > 1) {
    const cab = atividade[0];
    const iData = col(cab, 'date');
    const iFonte = col(cab, 'source');
    const iPassos = col(cab, 'steps');
    const iCal = col(cab, 'total calories');
    const iNome = col(cab, 'exercise name');
    const iDur = col(cab, 'duration');
    const iIni = col(cab, 'start date');
    for (const l of atividade.slice(1)) {
      const dia = diaDe(l[iData]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
      const a = atividades.get(dia) || { dia, passos: null, calorias: null, treinos: [] };
      const passos = iPassos >= 0 ? num(l[iPassos]) : null;
      if (passos && (!a.passos || passos > a.passos)) a.passos = Math.round(passos);
      const cal = iCal >= 0 ? num(l[iCal]) : null;
      if (cal && !a.calorias) a.calorias = Math.round(cal);
      const nome = iNome >= 0 ? String(l[iNome] || '').replace(/^\d+\s*-\s*/, '').trim() : '';
      if (nome) {
        const min = iDur >= 0 ? num(l[iDur]) : null;
        a.treinos.push({ nome, min: min ? Math.round(min) : null, hora: iIni >= 0 ? horaDe(l[iIni]) : '', fonte: l[iFonte] || '' });
      }
      atividades.set(dia, a);
    }
  }

  const ordenar = (m) => [...m.values()].sort((x, y) => x.dia.localeCompare(y.dia));
  return { pesos: ordenar(pesos), sonos: ordenar(sonos), atividades: ordenar(atividades) };
}

// ============================================================
// Resumo em texto (puro; testável)
// ============================================================
const kg = (n) => `${n.toFixed(1).replace('.', ',')} kg`;
const pct = (n) => `${n.toFixed(1).replace('.', ',')}%`;
const dm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const hm = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sinal = (n, casas = 1) => `${n > 0 ? '+' : ''}${n.toFixed(casas).replace('.', ',')}`;
const milhar = (n) => Math.round(n).toLocaleString('pt-BR');
const diasAtras = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Texto compacto pro dossiê da Nutri (e pro Nutri-Saude.md). `hoje` = dia de referência (YYYY-MM-DD). */
/**
 * Recuperação pelo batimento de repouso (e HRV quando houver), medidos no sono pelo app Relógio.
 * Não entra na conta de calorias: é o sinal de "o corpo está aguentando o plano?". Últimos dias contra a média de 14.
 * Devolve null sem dado. status: 'acima' (>= +5 bpm por 2+ dias: cansaço/doença/sobrecarga), 'abaixo' (<= -5), 'normal'.
 */
export function recuperacao(atividades, hoje) {
  const dias = (atividades || []).filter((a) => a.fcRepouso && a.dia >= diasAtras(hoje, 13) && a.dia <= hoje).sort((a, b) => a.dia.localeCompare(b.dia));
  if (dias.length < 2) return null;
  const media14 = media(dias.map((a) => a.fcRepouso));
  const ultimo = dias[dias.length - 1];
  let diasAcima = 0;
  for (let i = dias.length - 1; i >= 0 && dias[i].fcRepouso >= media14 + 5; i--) diasAcima++;
  const delta = ultimo.fcRepouso - media14;
  const status = diasAcima >= 2 ? 'acima' : delta <= -5 ? 'abaixo' : 'normal';
  const hrvs = dias.filter((a) => a.hrv);
  const hrvMedia = hrvs.length >= 3 ? media(hrvs.map((a) => a.hrv)) : null;
  const hrvUltimo = hrvs.length ? hrvs[hrvs.length - 1] : null;
  const hrvBaixo = hrvMedia && hrvUltimo && hrvUltimo.dia === ultimo.dia && hrvUltimo.hrv < hrvMedia * 0.8;
  const frase =
    status === 'acima'
      ? `batimento de repouso acima do normal há ${diasAcima} dias (${ultimo.fcRepouso} bpm contra média de ${Math.round(media14)}): sinal de cansaço, doença chegando ou treino pesado demais. Semana de segurar, dormir e hidratar, não de empurrar.`
      : status === 'abaixo'
        ? `batimento de repouso ${ultimo.fcRepouso} bpm, abaixo da média de ${Math.round(media14)}: recuperação boa, pode manter ou puxar o ritmo.`
        : `batimento de repouso ${ultimo.fcRepouso} bpm, na média (${Math.round(media14)}): recuperação normal.`;
  const curta =
    status === 'acima'
      ? `batimento de repouso ${ultimo.fcRepouso} bpm, acima do normal há ${diasAcima} dias (média ${Math.round(media14)}): sinal de cansaço`
      : `batimento de repouso ${ultimo.fcRepouso} bpm (média ${Math.round(media14)}${status === 'abaixo' ? ', recuperação boa' : ', na média'})`;
  return {
    dias: dias.slice(-7).reverse(),
    ultimo: ultimo.fcRepouso,
    media14: Math.round(media14),
    delta: Math.round(delta),
    diasAcima,
    status,
    hrvMedia: hrvMedia ? Math.round(hrvMedia) : null,
    hrvUltimo: hrvUltimo?.hrv || null,
    hrvBaixo: Boolean(hrvBaixo), // só a HRV do MESMO dia do último batimento, abaixo de 80% da média
    frase: frase + (hrvBaixo ? ` HRV ${hrvUltimo.hrv} ms bem abaixo da sua média (${Math.round(hrvMedia)}): reforça o sinal de estresse.` : ''),
    curta: curta + (hrvBaixo ? `, HRV baixa` : ''),
  };
}

// ============================================================
// Energia do dia (card do app): uma nota 0-100 a partir do que o relógio já manda
// ============================================================
const SONO_CHEIO_MIN = 450; // 7h30 ou mais = sono cheio (100)
const SONO_VAZIO_MIN = 240; // 4h ou menos = 0
const SONO_CURTO_MIN = 390; // menos de 6h30 é "sono curto" (o mesmo corte do aviso da tendência e da leitura de força)
const PESOS_ENERGIA = { sono: 0.4, recuperacao: 0.35, carga: 0.25 };
const limitar = (x) => Math.max(0, Math.min(100, x));

/**
 * Puro. Energia do dia (0-100) pro app: sono da noite que terminou em `dia` (40%), recuperação pelo batimento de repouso
 * contra a média de 14 dias (35%, a mesma conta de `recuperacao`) e carga de ontem (25%, invertida: ontem pesado = menos
 * energia hoje). Cada componente sai em 0-100: `sono` e `recuperacao` quanto maior melhor; `carga` quanto maior, mais pesado
 * foi ontem (treinos em minutos, caminhada pela metade, mais os passos acima de 10 mil; 200 min-equivalentes = 100).
 * Componente sem dado fica null e os pesos dos outros são redistribuídos; sem sono e sem batimento (sem relógio) = null.
 * Batimento só vale se a última medição for de hoje ou de ontem. Não entra em conta de calorias: é leitura de prontidão.
 * @returns {{ nota, sono, recuperacao, carga, texto } | null}
 */
export function energiaDoDia({ sonos = [], atividades = [], dia } = {}) {
  if (!dia) return null;
  const noite = (sonos || []).find((s) => s?.dia === dia && Number(s.total) > 0) || null;
  const sono = noite ? limitar(((Number(noite.total) - SONO_VAZIO_MIN) / (SONO_CHEIO_MIN - SONO_VAZIO_MIN)) * 100) : null;

  const rec = recuperacao(atividades, dia);
  const recente = rec && rec.dias[0] && rec.dias[0].dia >= diasAtras(dia, 1);
  let recup = null;
  if (recente) {
    // −5 bpm (ou menos) contra a média = 100; +8 bpm (ou mais) = 0; acima do normal há 2+ dias segura em 40; HRV baixa tira 15
    recup = limitar(100 - ((rec.delta + 5) * 100) / 13);
    if (rec.status === 'acima') recup = Math.min(recup, 40);
    // HRV baixa só conta se for do mesmo dia do batimento (revisão M7: uma HRV velha baixava a energia de hoje)
    if (rec.hrvBaixo) recup = Math.max(0, recup - 15);
  }

  const ontem = (atividades || []).find((a) => a?.dia === diasAtras(dia, 1)) || null;
  let carga = null;
  if (ontem) {
    const treinoMin = (ontem.treinos || []).reduce((s, t) => s + (Number(t.min) > 0 ? Number(t.min) : 30) * (/walk|caminh/i.test(t.nome || '') ? 0.5 : 1), 0);
    const passosExtra = Math.max(0, (Number(ontem.passos) || 0) - 10000) / 150;
    carga = limitar((treinoMin + passosExtra) * 0.5);
  }

  if (sono == null && recup == null) return null;
  const partes = [
    [sono, PESOS_ENERGIA.sono],
    [recup, PESOS_ENERGIA.recuperacao],
    [carga == null ? null : 100 - carga, PESOS_ENERGIA.carga],
  ].filter(([v]) => v != null);
  const soma = partes.reduce((a, [, p]) => a + p, 0);
  const nota = Math.round(partes.reduce((a, [v, p]) => a + v * p, 0) / soma);

  const frases = [];
  if (noite) frases.push(Number(noite.total) >= SONO_CURTO_MIN ? `dormiu ${hm(Number(noite.total))}` : `sono curto (${hm(Number(noite.total))})`);
  if (recente) {
    if (rec.status === 'acima') frases.push(`batimento de repouso acima do normal há ${rec.diasAcima} dias (${rec.ultimo} bpm, média ${rec.media14})`);
    else if (rec.status === 'abaixo') frases.push(`batimento de repouso abaixo da média (${rec.ultimo} bpm): recuperação boa`);
    else frases.push(`batimento de repouso na média (${rec.ultimo} bpm)`);
  }
  if (carga != null) frases.push(carga >= 60 ? 'ontem foi pesado' : carga <= 20 ? 'ontem foi leve' : 'ontem foi moderado');
  const juntas = frases.length > 1 ? `${frases.slice(0, -1).join(', ')} e ${frases[frases.length - 1]}` : frases[0];
  const rotulo = nota >= 70 ? 'Energia boa' : nota >= 45 ? 'Energia média' : 'Energia baixa';
  return {
    nota,
    sono: sono == null ? null : Math.round(sono),
    recuperacao: recup == null ? null : Math.round(recup),
    carga: carga == null ? null : Math.round(carga),
    texto: `${rotulo}: ${juntas}.`,
  };
}

// ============================================================
// Fase 7: o que a IA passa a saber do relógio (nota de sono, energia, atividade, oxigênio e temperatura)
// ============================================================
const ORDEM_NIVEL = { atencao: 0, razoavel: 1, bom: 2, excelente: 3 };
const TXT_NIVEL = { atencao: 'pede atenção', razoavel: 'razoável', bom: 'bom', excelente: 'excelente' };
const TXT_ROTULO_NOTA = { excelente: 'excelente', boa: 'boa', razoavel: 'razoável', atencao: 'pede atenção' };
/** Puro. Os fatores fracos (atenção ou razoável), do pior pro melhor; os sem dado (nivel null) ficam de fora. */
export function fatoresFracos(fatores = [], max = 2) {
  return (fatores || [])
    .filter((f) => f && (f.nivel === 'atencao' || f.nivel === 'razoavel'))
    .sort((a, b) => ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel])
    .slice(0, max);
}
const fatorTxt = (f) => `${String(f.nome).toLowerCase()} ${f.valor} (${TXT_NIVEL[f.nivel] || f.nivel})`;

/** Faixas do "normal" da noite (adulto saudável dormindo): fora delas a IA fica sabendo; dentro, não vira assunto. */
export const LIMITES_NOITE = { spo2Media: 94, spo2Min: 88, minutosAbaixo90: 5, deltaTemperatura: 0.5 };
const decimal = (n, casas = 1) => Number(n).toFixed(casas).replace('.', ',');
/**
 * Puro. Oxigênio no sangue e temperatura da pele da noite (campos opcionais do coletor, fase 6b: `spo2 { media, min,
 * minutosAbaixo90 }` e `temperatura { media, delta }`; podem não existir). Devolve os textos e se cada um fugiu do normal
 * (LIMITES_NOITE). Decisão D12: isto é só da própria pessoa (dossiê, pensamentos, reflexão), nunca da linha do grupo.
 * @returns {{ spo2: { texto, fora } | null, temperatura: { texto, fora } | null, foraDoNormal: string }}
 */
export function sinaisDaNoite(noite) {
  const s = noite?.spo2;
  const media = Number(s?.media);
  const min = Number(s?.min);
  const abaixo = Number(s?.minutosAbaixo90);
  let spo2 = null;
  if (Number.isFinite(media) && media > 50 && media <= 100) {
    const fora = media < LIMITES_NOITE.spo2Media || (Number.isFinite(min) && min > 0 && min < LIMITES_NOITE.spo2Min) || (Number.isFinite(abaixo) && abaixo >= LIMITES_NOITE.minutosAbaixo90);
    const partes = [`média ${Math.round(media)} %`];
    if (Number.isFinite(min) && min > 0) partes.push(`mínimo ${Math.round(min)} %`);
    if (Number.isFinite(abaixo) && abaixo >= 0) partes.push(`${Math.round(abaixo)} min abaixo de 90 %`);
    spo2 = { texto: `oxigênio no sono: ${partes.join(', ')}`, fora };
  }
  const t = noite?.temperatura;
  const delta = Number(t?.delta);
  let temperatura = null;
  if (t && Number.isFinite(delta)) {
    const fora = Math.abs(delta) >= LIMITES_NOITE.deltaTemperatura;
    temperatura = { texto: `temperatura da pele na noite: ${delta >= 0 ? '+' : '−'}${decimal(Math.abs(delta))} °C ${delta >= 0 ? 'acima' : 'abaixo'} da sua base`, fora };
  } else if (t && Number.isFinite(Number(t.media))) {
    temperatura = { texto: `temperatura da pele na noite: média ${decimal(Number(t.media))} °C (sem base pra comparar)`, fora: false };
  }
  const foras = [spo2, temperatura].filter((x) => x?.fora).map((x) => x.texto);
  return { spo2, temperatura, foraDoNormal: foras.length ? `${foras.join('; ')} (fora do normal)` : '' };
}

/** Puro. Nota da noite que terminou em `dia` e o fator mais fraco, na mesma conta do app. null sem sono. */
export function notaDaNoite({ sonos = [], atividades = [], dia }) {
  const a = avaliarNoite(sonos, dia);
  if (!a || a.nota == null) return null;
  const fraco = fatoresFracos(fatoresSono({ sonos, atividades, dia }), 1)[0] || null;
  return { dia, nota: a.nota, rotulo: a.rotulo, fraco: fraco ? { id: fraco.id, nome: fraco.nome, valor: fraco.valor, nivel: fraco.nivel } : null, texto: `nota do sono ${a.nota} (${TXT_ROTULO_NOTA[a.rotulo] || a.rotulo})${fraco ? `, ponto fraco: ${fatorTxt(fraco)}` : ''}` };
}

/** Puro. Energia do dia (a mesma do app) e até 2 fatores fracos. null sem relógio. */
export function energiaComFatores({ sonos = [], atividades = [], dia }) {
  const e = energiaDoDia({ sonos, atividades, dia });
  if (!e) return null;
  const fracos = fatoresFracos(fatoresEnergia({ sonos, atividades, dia }), 2);
  return { nota: e.nota, fracos: fracos.map((f) => ({ id: f.id, nome: f.nome, valor: f.valor, nivel: f.nivel })), texto: `energia ${e.nota}/100${fracos.length ? `, puxada pra baixo por ${fracos.map(fatorTxt).join(' e ')}` : ''}` };
}

/**
 * Puro. Atividade de um dia em texto: minutos ativos, distância (`distanciaM`), calorias ativas oficiais (`kcalAtivas`, só
 * quando o coletor manda: a estimativa precisa do perfil e fica no app) e a hora mais ativa (`porHora.passos`). null sem nada.
 * As calorias ativas NÃO somam ao gasto total, que já entra no balanço.
 */
export function atividadeDoDia(at) {
  if (!at) return null;
  const partes = [];
  const min = Number(at.minAtivos);
  if (Number.isFinite(min) && min >= 0 && at.minAtivos != null) partes.push(`${Math.round(min)} min ativos`);
  const dist = Number(at.distanciaM);
  if (Number.isFinite(dist) && dist > 0) partes.push(`${decimal(dist / 1000)} km`);
  const ka = Number(at.kcalAtivas);
  if (Number.isFinite(ka) && ka > 0) partes.push(`${milhar(ka)} kcal ativas (já dentro do gasto total)`);
  const ph = Array.isArray(at.porHora?.passos) ? at.porHora.passos.map(Number) : null;
  let pico = null;
  if (ph?.length === 24) {
    const max = Math.max(...ph);
    if (max > 0) {
      const h = ph.indexOf(max);
      pico = `das ${h}h às ${(h + 1) % 24}h`;
      partes.push(`mais ativa(o) ${pico}`);
    }
  }
  if (!partes.length) return null;
  return { minAtivos: Number.isFinite(min) && at.minAtivos != null ? Math.round(min) : null, distanciaKm: dist > 0 ? Math.round(dist / 100) / 10 : null, kcalAtivas: ka > 0 ? Math.round(ka) : null, pico, texto: partes.join(', ') };
}

export function resumoSaude({ pesos, sonos, atividades }, { hoje, nomePlanilha = 'planilha de saúde', comHevy = false } = {}) {
  hoje ||= [...pesos, ...sonos, ...atividades].map((x) => x.dia).sort().pop() || new Date().toISOString().slice(0, 10);
  const linhas = [];
  linhas.push(`Fonte: Galaxy Watch via Health Connect ("${nomePlanilha}", atualiza sozinha todo dia). Última leitura: ${dm(hoje)}/${hoje.slice(0, 4)}. Bioimpedância de relógio vale pra TENDÊNCIA, não pra valor absoluto.`);

  // ---- peso e composição
  if (pesos.length) {
    const recentes = pesos.filter((p) => p.dia >= diasAtras(hoje, DIAS_DETALHE - 1)).slice().reverse();
    linhas.push('', 'PESO E COMPOSIÇÃO (uma por dia: a primeira da manhã quando há; mais recente primeiro; o ritmo de verdade está no PROGRESSO DE PESO, não na diferença entre dois dias):');
    for (const p of recentes) {
      // pesagem fora da manhã sai marcada: depois de comer e beber o peso sobe 0,5 a 1,5 kg
      const foraDaManha = p.hora && !(p.hora >= '04:00' && p.hora < '11:00');
      let l = `- ${dm(p.dia)}: ${kg(p.peso)}${foraDaManha ? ` (às ${p.hora}, fora da manhã: tende a sair mais alto)` : ''}`;
      // fase 7 (A23): a massa magra MEDIDA pelo relógio vale mais que a calculada a partir da gordura
      const magraMedida = Number(p.magra) > 10 && Number(p.magra) < p.peso ? Number(p.magra) : null;
      if (p.gordura) l += ` · gordura ${pct(p.gordura)} (massa gorda ~${kg((p.peso * p.gordura) / 100)}, magra ${magraMedida ? `${kg(magraMedida)} medida` : `~${kg(p.peso * (1 - p.gordura / 100))}`})`;
      else if (magraMedida) l += ` · massa magra ${kg(magraMedida)} medida`;
      linhas.push(l);
    }
    const ultimo = pesos[pesos.length - 1];
    const altura = pesos.map((p) => p.altura).filter(Boolean).pop();
    const sete = pesos.filter((p) => p.dia >= diasAtras(hoje, 6));
    const anteriores = pesos.filter((p) => p.dia < diasAtras(hoje, 6) && p.dia >= diasAtras(hoje, 13));
    const extras = [];
    if (altura) extras.push(`altura ${altura.toFixed(2).replace('.', ',')} m` + (ultimo.peso ? ` · IMC ${(ultimo.peso / (altura * altura)).toFixed(1).replace('.', ',')}` : ''));
    if (sete.length) {
      const mp = media(sete.map((p) => p.peso));
      const mg = media(sete.map((p) => p.gordura).filter(Boolean));
      extras.push(`média 7 dias ${kg(mp)}${mg ? ` · ${pct(mg)} gordura` : ''}`);
      if (anteriores.length) {
        const mpA = media(anteriores.map((p) => p.peso));
        const mgA = media(anteriores.map((p) => p.gordura).filter(Boolean));
        extras.push(`vs 7 dias anteriores: ${sinal(mp - mpA)} kg${mg && mgA ? `, ${sinal(mg - mgA)} pt de gordura` : ''}`);
      }
    }
    const primeiro = pesos[0];
    if (primeiro.dia !== ultimo.dia) extras.push(`desde ${dm(primeiro.dia)} (${kg(primeiro.peso)}): ${sinal(ultimo.peso - primeiro.peso)} kg`);
    if (extras.length) linhas.push(`- ${extras.join(' · ')}`);
    // médias semanais quando há histórico maior que o detalhe
    const semanas = new Map();
    for (const p of pesos) {
      const w = semanaISO(p.dia);
      if (!semanas.has(w)) semanas.set(w, []);
      semanas.get(w).push(p);
    }
    if (semanas.size > 2) {
      const ult = [...semanas.entries()].slice(-6);
      linhas.push(`- Médias por semana: ${ult.map(([w, ps]) => `${w.slice(5)} ${kg(media(ps.map((p) => p.peso)))}${media(ps.map((p) => p.gordura).filter(Boolean)) ? `/${pct(media(ps.map((p) => p.gordura).filter(Boolean)))}` : ''}`).join(' · ')}`);
    }
  }

  // ---- sono
  if (sonos.length) {
    const recentes = sonos.filter((s) => s.dia >= diasAtras(hoje, DIAS_DETALHE - 1)).slice().reverse();
    linhas.push('', 'SONO (noite que termina no dia indicado; mais recente primeiro):');
    for (const s of recentes) {
      const parcial = s.total < 180 ? ' ⚠️ curto/parcial (cochilo ou sincronização incompleta)' : '';
      linhas.push(`- ${dm(s.dia)}: ${hm(s.total)} dormindo (leve ${hm(s.leve)}, profundo ${hm(s.profundo)}, REM ${hm(s.rem)}, acordado ${Math.round(s.acordado)} min)${s.inicio ? ` · deitou ${horaDe(s.inicio)}, levantou ${horaDe(s.fim)}` : ''}${parcial}`);
    }
    const sete = sonos.filter((s) => s.dia >= diasAtras(hoje, 6) && s.total >= 180);
    if (sete.length) {
      const mt = media(sete.map((s) => s.total));
      const mProf = media(sete.map((s) => s.profundo));
      const deitar = sete.map((s) => s.inicio).filter(Boolean).map((t) => {
        const [h, m] = horaDe(t).split(':').map(Number);
        return (h < 12 ? h + 24 : h) * 60 + m; // madrugada conta como 24h+ pra 23:30 e 00:30 ficarem próximos na média
      });
      const md = media(deitar);
      const hDeitar = md == null ? '' : ` · deita em média ${String(Math.floor(md / 60) % 24).padStart(2, '0')}:${String(Math.round(md % 60)).padStart(2, '0')}`;
      linhas.push(`- Média das noites completas nos últimos 7 dias: ${hm(mt)} dormindo (profundo ${hm(mProf)})${hDeitar}. Referência: 7 a 9 h; profundo 1 a 2 h.`);
    }
    // fase 7: a nota da última noite (a mesma do app) e, quando vierem do coletor, oxigênio e temperatura da pele. Este
    // resumo é o dossiê DA PRÓPRIA PESSOA (D12): oxigênio e temperatura nunca vão pra linha do grupo
    const ultima = sonos[sonos.length - 1];
    const nd = ultima ? notaDaNoite({ sonos, atividades, dia: ultima.dia }) : null;
    const sn = ultima ? sinaisDaNoite(ultima) : null;
    const extrasNoite = [nd?.texto, sn?.spo2 ? `${sn.spo2.texto}${sn.spo2.fora ? ' (fora do normal)' : ' (normal)'}` : null, sn?.temperatura ? `${sn.temperatura.texto}${sn.temperatura.fora ? ' (fora do normal)' : ''}` : null].filter(Boolean);
    if (extrasNoite.length) linhas.push(`- Última noite (${dm(ultima.dia)}): ${extrasNoite.join('; ')}.${sn?.spo2 || sn?.temperatura ? ' Oxigênio e temperatura são dado sensível: comente só se a própria pessoa perguntar do sono, nunca com outra pessoa.' : ''}`);
  }

  // ---- recuperação (batimento de repouso e HRV, do app Relógio; a planilha antiga não traz)
  const rec = recuperacao(atividades, hoje);
  if (rec) {
    linhas.push('', 'RECUPERAÇÃO (batimento cardíaco de repouso medido no sono; mais recente primeiro; NÃO entra na conta de calorias):');
    for (const d of rec.dias) linhas.push(`- ${dm(d.dia)}: ${d.fcRepouso} bpm${d.hrv ? ` · HRV ${d.hrv} ms` : ''}`);
    linhas.push(`- Leitura: ${rec.frase}`);
  }

  // ---- atividade
  if (atividades.length) {
    const recentes = atividades.filter((a) => a.dia >= diasAtras(hoje, DIAS_ATIVIDADE - 1)).slice().reverse();
    linhas.push('', 'ATIVIDADE (últimos 7 dias; mais recente primeiro):');
    for (const a of recentes) {
      const partes = [];
      if (a.passos) partes.push(`${milhar(a.passos)} passos`);
      if (a.calorias) partes.push(`gasto total ${milhar(a.calorias)} kcal`);
      // com o Hevy ligado, a musculação vem de lá com série e carga: aqui fica só o resto (caminhada, vôlei, corrida)
      const treinosAqui = comHevy ? a.treinos.filter((t) => !/hevy/i.test(t.fonte || '')) : a.treinos;
      if (treinosAqui.length) {
        // mesma atividade várias vezes no dia (3 caminhadas) vira uma só, somando os minutos
        const porNome = new Map();
        for (const t of treinosAqui) {
          const g = porNome.get(t.nome) || { nome: t.nome, min: 0, vezes: 0 };
          g.min += t.min || 0;
          g.vezes += 1;
          porNome.set(t.nome, g);
        }
        partes.push(`treino: ${[...porNome.values()].map((g) => `${g.nome}${g.min ? ` (${g.min} min${g.vezes > 1 ? ` em ${g.vezes}x` : ''})` : ''}`).join(', ')}`);
      }
      if (partes.length) linhas.push(`- ${dm(a.dia)}: ${partes.join(' · ')}`);
    }
    const sete = atividades.filter((a) => a.dia >= diasAtras(hoje, 6));
    const mp = media(sete.map((a) => a.passos).filter(Boolean));
    const mc = media(sete.map((a) => a.calorias).filter(Boolean));
    const nTreinos = sete.reduce((n, a) => n + a.treinos.length, 0);
    linhas.push(`- Média 7 dias: ${mp ? `${milhar(mp)} passos/dia` : 'passos sem dado'}${mc ? ` · gasto total ~${milhar(mc)} kcal/dia (estimativa do relógio, inclui o basal)` : ''} · ${nTreinos} treino(s) registrado(s).`);
    const maisRecente = atividades[atividades.length - 1];
    const ad = atividadeDoDia(maisRecente);
    if (ad) linhas.push(`- Em ${dm(maisRecente.dia)}: ${ad.texto}.`);
  }

  return linhas.join('\n').trim();
}

/**
 * Indicadores curtos pro PERFIL (entram em TODA resposta, até no papo aleatório que não carrega o dossiê):
 * última noite, média de sono, horário que costuma deitar/levantar, passos/dia, peso e gordura mais recentes.
 */
export function indicadoresRelogio({ pesos, sonos, atividades }, { hoje, comHevy = false } = {}) {
  hoje ||= [...pesos, ...sonos, ...atividades].map((x) => x.dia).sort().pop();
  if (!hoje) return null;
  const minutosDeHora = (t, madrugada = false) => {
    const [h, m] = horaDe(t).split(':').map(Number);
    if (!Number.isFinite(h)) return null;
    return (madrugada && h < 12 ? h + 24 : h) * 60 + m;
  };
  const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
  const r = { atualizado: hoje };
  const partes = [];

  const ultimoPeso = pesos[pesos.length - 1];
  if (ultimoPeso) {
    Object.assign(r, { peso: ultimoPeso.peso, gordura: ultimoPeso.gordura, pesoEm: ultimoPeso.dia });
    partes.push(`peso ${kg(ultimoPeso.peso)}${ultimoPeso.gordura ? ` com ${pct(ultimoPeso.gordura)} de gordura` : ''} em ${dm(ultimoPeso.dia)}`);
  }
  const ultimaNoite = sonos[sonos.length - 1];
  if (ultimaNoite) {
    Object.assign(r, { ultimaNoite: { dia: ultimaNoite.dia, min: ultimaNoite.total, deitou: horaDe(ultimaNoite.inicio), levantou: horaDe(ultimaNoite.fim) } });
    partes.push(`última noite (${dm(ultimaNoite.dia)}) ${hm(ultimaNoite.total)} dormindo, deitou ${horaDe(ultimaNoite.inicio)} e levantou ${horaDe(ultimaNoite.fim)}${ultimaNoite.total < 180 ? ' (parcial)' : ''}`);
  }
  const noites = sonos.filter((s) => s.dia >= diasAtras(hoje, 13) && s.total >= 180);
  if (noites.length >= 2) {
    const mSono = media(noites.map((s) => s.total));
    const mDeita = media(noites.map((s) => minutosDeHora(s.inicio, true)).filter((x) => x != null));
    const mLevanta = media(noites.map((s) => minutosDeHora(s.fim)).filter((x) => x != null));
    Object.assign(r, { sonoMedioMin: Math.round(mSono), deitaMedia: hhmm(mDeita), levantaMedia: hhmm(mLevanta) });
    partes.push(`média ${hm(mSono)}/noite nas últimas ${noites.length} noites, costuma deitar ~${hhmm(mDeita)} e levantar ~${hhmm(mLevanta)}`);
  }
  const dias = atividades.filter((a) => a.dia >= diasAtras(hoje, 6));
  const mPassos = media(dias.map((a) => a.passos).filter(Boolean));
  // treinos7d conta só o que NÃO vem do Hevy quando ele está ligado (senão a mesma sessão contaria duas vezes)
  const treinos = dias.reduce((n, a) => n + a.treinos.filter((t) => !/walk|caminh/i.test(t.nome) && !(comHevy && /hevy/i.test(t.fonte || ''))).length, 0);
  if (mPassos) {
    Object.assign(r, { passosMedia: Math.round(mPassos), treinos7d: treinos });
    partes.push(`~${milhar(mPassos)} passos/dia e ${treinos} treino(s) de musculação/esporte nos últimos 7 dias`);
  }
  // recuperação: batimento de repouso contra a média (sinal pra segurar ou empurrar; não entra na conta de calorias)
  const rec = recuperacao(atividades, hoje);
  if (rec) {
    Object.assign(r, { fcRepouso: rec.ultimo, fcMedia: rec.media14, recuperacao: rec.status, hrv: rec.hrvUltimo });
    partes.push(rec.curta);
  }
  // fase 7: nota do sono e o ponto fraco, energia e os fatores fracos, atividade do dia (D2: saúde pode circular no grupo)
  if (ultimaNoite) {
    const nd = notaDaNoite({ sonos, atividades, dia: ultimaNoite.dia });
    if (nd) {
      r.sono = { dia: nd.dia, nota: nd.nota, rotulo: nd.rotulo, fraco: nd.fraco };
      partes.push(nd.texto);
    }
  }
  const en = energiaComFatores({ sonos, atividades, dia: hoje });
  if (en) {
    r.energia = { dia: hoje, nota: en.nota, fracos: en.fracos };
    partes.push(`${en.texto} em ${dm(hoje)}`);
  }
  const atHoje = atividades.find((a) => a.dia === hoje);
  const ad = atividadeDoDia(atHoje);
  if (ad) {
    r.atividade = { dia: hoje, minAtivos: ad.minAtivos, distanciaKm: ad.distanciaKm, kcalAtivas: ad.kcalAtivas, pico: ad.pico };
    partes.push(`atividade em ${dm(hoje)} (até o último envio): ${ad.texto}`);
  }
  // D12: oxigênio e temperatura fora do normal ficam num campo À PARTE, que só entra no contexto da própria pessoa. A `linha`
  // (bloco PERFIS DO GRUPO, resumos, fala programada) nunca leva esses dois
  const sn = ultimaNoite ? sinaisDaNoite(ultimaNoite) : null;
  r.linhaPropria = sn?.foraDoNormal ? `noite de ${dm(ultimaNoite.dia)}: ${sn.foraDoNormal}` : '';
  // gasto total por dia (últimos 30 dias) pro balanço energético em código (resumo.js visaoPeriodo)
  const gastos = {};
  for (const a of atividades.filter((x) => x.dia >= diasAtras(hoje, 29) && x.calorias)) gastos[a.dia] = a.calorias;
  if (Object.keys(gastos).length) r.gastos = gastos;
  r.linha = partes.join('; ');
  return r;
}

// ============================================================
// Sincronização (chamada pelo dossiê quando a planilha mudou)
// ============================================================
/**
 * Lê a planilha (só quando modifiedTime mudou; senão vem do cache em arquivos_pessoa), grava pesagens, atualiza o peso
 * do perfil, salva Nutri-Saude.md e devolve o texto do resumo pro dossiê.
 */
export async function sincronizarSaude(perfil, arq, { pastaId, hoje } = {}) {
  const cache = colecao('arquivos_pessoa');
  const chave = `${arq.id}:${arq.modifiedTime}`;
  const emCache = await cache.findOne({ _id: chave });
  if (emCache) return emCache.texto;

  console.log(`[saude] lendo planilha "${arq.name}" de ${perfil.nome}...`);
  const abas = await lerAbas(arq.id);
  const dados = interpretarAbas(abas);
  const texto = await aplicarDadosSaude(perfil, dados, { hoje, fonteNome: arq.name, pastaId });

  await cache.replaceOne({ _id: chave }, { _id: chave, arquivoId: arq.id, nome: arq.name, texto, salvoEm: new Date() }, { upsert: true });
  await cache.deleteMany({ arquivoId: arq.id, _id: { $ne: chave } });
  return texto;
}

/**
 * O que acontece com os dados do relógio venham de onde vierem (planilha do Drive ou o app Relógio mandando direto):
 * resumo em texto pro dossiê, cada peso vira pesagem com data, o peso do perfil acompanha a última medição,
 * indicadores curtos no perfil (valem em toda resposta) e um Nutri-Saude.md na pasta da pessoa. Devolve o texto.
 */
export async function aplicarDadosSaude(perfil, dados, { hoje, fonteNome = 'relógio', pastaId } = {}) {
  const comHevy = temHevy(perfil);
  const texto = resumoSaude(dados, { hoje, nomePlanilha: fonteNome, comHevy });
  console.log(`[saude] ${perfil.nome} (${fonteNome}): ${dados.pesos.length} pesagens, ${dados.sonos.length} noites, ${dados.atividades.length} dias de atividade -> resumo de ${texto.length} chars`);

  // Efeitos colaterais, sem derrubar o dossiê se falharem
  const jid = perfil.jids?.[0];
  if (jid && dados.pesos.length) {
    const ultimo = dados.pesos[dados.pesos.length - 1];
    const desde = diasAtras(ultimo.dia, DIAS_PESAGENS);
    for (const p of dados.pesos.filter((x) => x.dia >= desde)) {
      await registrarPesagem({ jid, nome: perfil.nome, dia: p.dia, peso: p.peso, gordura: p.gordura ?? undefined, fonte: 'relogio', hora: p.hora }).catch((e) => console.error('[saude] pesagem:', e.message));
    }
    // peso do perfil acompanha o relógio quando a medição é mais nova que o último dado informado na conversa
    const dataPerfil = perfil.atualizacoes?.peso || '';
    if (ultimo.dia >= dataPerfil && Math.abs((perfil.peso || 0) - ultimo.peso) >= 0.1) {
      await salvarPerfil({ jids: perfil.jids, peso: ultimo.peso, atualizacoes: { ...(perfil.atualizacoes || {}), peso: ultimo.dia } }).catch((e) => console.error('[saude] perfil:', e.message));
      console.log(`[saude] peso de ${perfil.nome} no perfil: ${perfil.peso} -> ${ultimo.peso} kg (relógio, ${ultimo.dia})`);
    }
  }
  // indicadores curtos no perfil: valem em toda resposta, inclusive no papo que não carrega o dossiê
  if (jid) {
    const relogio = indicadoresRelogio(dados, { hoje, comHevy });
    somarGastosExtras(relogio, perfil.atividadesFeitas); // vôlei sem relógio confirmado pela localização entra no gasto do dia
    if (relogio?.linha) await salvarPerfil({ jids: perfil.jids, relogio }).catch((e) => console.error('[saude] indicadores no perfil:', e.message));
  }
  if (pastaId) {
    const md = `---\ntipo: saude\npessoa: ${perfil.nome}\natualizado: ${hoje || new Date().toISOString().slice(0, 10)}\nfonte: "${fonteNome}"\ntags: [nutribot, pessoa, saude, galaxy-watch]\n---\n\n# Saúde de ${perfil.nome} (relógio)\n\n${texto}\n`;
    await salvarEmPasta(pastaId, ARQ_SAUDE, md).catch((e) => console.error('[saude] Nutri-Saude.md:', e.message));
  }
  return texto;
}
