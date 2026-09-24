// saude.js - Dados do relógio da pessoa (Galaxy Watch -> Samsung Health -> Health Connect -> app "Health Data Export" ->
// planilha Google na pasta da pessoa no Drive). A planilha tem 3 abas (Activity, Body Measurements, Sleep) e cresce todo
// dia; aqui ela vira um resumo curto (últimas 2 semanas + médias) que entra no dossiê da pessoa. Efeitos colaterais:
// cada peso da manhã vira uma pesagem com data (coleção pesagens), o peso do perfil acompanha a última medição, e um
// Nutri-Saude.md com o resumo fica na pasta da pessoa.

import { google } from 'googleapis';

import { autenticacaoGoogle, salvarEmPasta } from './drive.js';
import { colecao, registrarPesagem, salvarPerfil } from './mongo.js';
import { semanaISO } from './util.js';

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

  // ---- peso e composição: uma medição por dia (a última do dia; prefere Samsung Health)
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
      const atual = pesos.get(dia);
      if (atual && ehSamsung(atual.fonte) && !ehSamsung(l[iFonte])) continue;
      pesos.set(dia, {
        dia,
        hora: horaDe(l[iData]),
        peso,
        gordura: iGord >= 0 ? num(l[iGord]) : null,
        altura: iAlt >= 0 ? num(l[iAlt]) : null,
        magra: iMagra >= 0 ? num(l[iMagra]) : null,
        fonte: l[iFonte] || '',
      });
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
export function resumoSaude({ pesos, sonos, atividades }, { hoje, nomePlanilha = 'planilha de saúde' } = {}) {
  hoje ||= [...pesos, ...sonos, ...atividades].map((x) => x.dia).sort().pop() || new Date().toISOString().slice(0, 10);
  const linhas = [];
  linhas.push(`Fonte: Galaxy Watch via Health Connect ("${nomePlanilha}", atualiza sozinha todo dia). Última leitura: ${dm(hoje)}/${hoje.slice(0, 4)}. Bioimpedância de relógio vale pra TENDÊNCIA, não pra valor absoluto.`);

  // ---- peso e composição
  if (pesos.length) {
    const recentes = pesos.filter((p) => p.dia >= diasAtras(hoje, DIAS_DETALHE - 1)).slice().reverse();
    linhas.push('', 'PESO E COMPOSIÇÃO (medição da manhã; mais recente primeiro):');
    for (const p of recentes) {
      let l = `- ${dm(p.dia)}: ${kg(p.peso)}`;
      if (p.gordura) l += ` · gordura ${pct(p.gordura)} (massa gorda ~${kg((p.peso * p.gordura) / 100)}, magra ~${kg(p.peso * (1 - p.gordura / 100))})`;
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
  }

  // ---- atividade
  if (atividades.length) {
    const recentes = atividades.filter((a) => a.dia >= diasAtras(hoje, DIAS_ATIVIDADE - 1)).slice().reverse();
    linhas.push('', 'ATIVIDADE (últimos 7 dias; mais recente primeiro):');
    for (const a of recentes) {
      const partes = [];
      if (a.passos) partes.push(`${milhar(a.passos)} passos`);
      if (a.calorias) partes.push(`gasto total ${milhar(a.calorias)} kcal`);
      if (a.treinos.length) {
        // mesma atividade várias vezes no dia (3 caminhadas) vira uma só, somando os minutos
        const porNome = new Map();
        for (const t of a.treinos) {
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
  }

  return linhas.join('\n').trim();
}

/**
 * Indicadores curtos pro PERFIL (entram em TODA resposta, até no papo aleatório que não carrega o dossiê):
 * última noite, média de sono, horário que costuma deitar/levantar, passos/dia, peso e gordura mais recentes.
 */
export function indicadoresRelogio({ pesos, sonos, atividades }, { hoje } = {}) {
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
  const treinos = dias.reduce((n, a) => n + a.treinos.filter((t) => !/walk|caminh/i.test(t.nome)).length, 0);
  if (mPassos) {
    Object.assign(r, { passosMedia: Math.round(mPassos), treinos7d: treinos });
    partes.push(`~${milhar(mPassos)} passos/dia e ${treinos} treino(s) de musculação/esporte nos últimos 7 dias`);
  }
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
  const texto = resumoSaude(dados, { hoje, nomePlanilha: arq.name });
  console.log(`[saude] ${perfil.nome}: ${dados.pesos.length} pesagens, ${dados.sonos.length} noites, ${dados.atividades.length} dias de atividade -> resumo de ${texto.length} chars`);

  await cache.replaceOne({ _id: chave }, { _id: chave, arquivoId: arq.id, nome: arq.name, texto, salvoEm: new Date() }, { upsert: true });
  await cache.deleteMany({ arquivoId: arq.id, _id: { $ne: chave } });

  // Efeitos colaterais, sem derrubar o dossiê se falharem
  const jid = perfil.jids?.[0];
  if (jid && dados.pesos.length) {
    const ultimo = dados.pesos[dados.pesos.length - 1];
    const desde = diasAtras(ultimo.dia, DIAS_PESAGENS);
    for (const p of dados.pesos.filter((x) => x.dia >= desde)) {
      await registrarPesagem({ jid, nome: perfil.nome, dia: p.dia, peso: p.peso, gordura: p.gordura ?? undefined, fonte: 'relogio' }).catch((e) => console.error('[saude] pesagem:', e.message));
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
    const relogio = indicadoresRelogio(dados, { hoje });
    if (relogio?.linha) await salvarPerfil({ jids: perfil.jids, relogio }).catch((e) => console.error('[saude] indicadores no perfil:', e.message));
  }
  if (pastaId) {
    const md = `---\ntipo: saude\npessoa: ${perfil.nome}\natualizado: ${hoje || new Date().toISOString().slice(0, 10)}\nfonte: "${arq.name}"\ntags: [nutribot, pessoa, saude, galaxy-watch]\n---\n\n# Saúde de ${perfil.nome} (relógio)\n\n${texto}\n`;
    await salvarEmPasta(pastaId, ARQ_SAUDE, md).catch((e) => console.error('[saude] Nutri-Saude.md:', e.message));
  }
  return texto;
}
