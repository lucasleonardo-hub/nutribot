// cobranca.js - "Cadê a refeição de hoje?": cobra quem passou do horário habitual (aprendido) sem mandar a refeição.

import { listarPerfis, refeicoesDosDias, persistirMemoria } from './mongo.js';
import * as ia from './gemini.js';
import { docsPara } from './conhecimento.js';
import { dossieDe } from './pessoas.js';
import { agora, fusoDe, SLOTS, minutosDe, hhmmDe, comTempo, marcaDeTempo } from './util.js';
import { estado } from './estado.js';
import { enviar } from './whatsapp.js';
import { lembrar, garantirDiaAtual } from './dia.js';
import { vocabularioErrado, removerFrasesCom, prepararCobranca } from './consciencia.js';
import { enriquecerPerfis } from './perfis.js';
import { ocupadoAgora } from './agenda.js';
import { slotsSuspensos, blocoEventosApp, semCorpoSensivel } from './contexto-app.js';
import { humorDe } from './mongo.js';

/**
 * Puro. O que a cobrança passa a saber (fase 7), em texto pro prompt que já existe (sem chamada nova): eventos do app de hoje
 * (os que suspenderam outra refeição explicam o dia: "almoçou fora"), sono e energia da linha do relógio, e o humor de hoje só como tom (sem número nem texto:
 * a cobrança sai no grupo). '' sem nada.
 */
export function contextoDaCobranca({ perfil, dia, eventos = [], humor = null } = {}) {
  const partes = [];
  // a cobrança sai no grupo: só refeição fora, festa e viagem, sem a nota (consulta, treino e compromisso pessoal não)
  const ev = blocoEventosApp(eventos, { hoje: dia, dias: 0, titulo: 'MARCADO NO APP PRA HOJE (só pra entender o dia; não cite no grupo)', publico: true });
  if (ev) partes.push(ev);
  const r = perfil?.relogio || {};
  const corpo = [r.sono?.nota != null ? `nota do sono ${r.sono.nota}${r.sono.fraco ? ` (ponto fraco: ${String(r.sono.fraco.nome).toLowerCase()})` : ''}` : null, r.energia?.nota != null && r.energia.dia === dia ? `energia ${r.energia.nota}/100` : null].filter(Boolean);
  if (corpo.length) partes.push(`CORPO HOJE (relógio): ${corpo.join(', ')}. Sono ruim ou energia baixa pedem cobrança mais leve.`);
  if (humor?.humor && Number(humor.humor) <= 2) partes.push('TOM: pelo app, a pessoa marcou que o dia não está bom. Cobre com carinho, sem pressão, e NÃO cite humor, app ou o que ela marcou.');
  return partes.join('\n');
}

// ---------- adiamento avisado na conversa ("vou almoçar mais tarde", "almoço vai demorar 1h30"; pedido do dono em 15/10) ----------
/** Folga depois da hora que a pessoa disse, antes de cobrar. */
export const FOLGA_ADIAMENTO_MIN = 30;
/** Sem hora dita ("vou almoçar mais tarde"): segura por este tanto a partir do aviso. */
export const ADIAMENTO_PADRAO_MIN = 120;

/** Puro. O slot cobrado a partir do nome que a IA mandou ("almoço", "janta", "café da manhã"); null se não for cobrado. */
export function slotDoNome(nome) {
  const t = String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/almoc/.test(t)) return 'almoco';
  if (/jant|janta/.test(t)) return 'jantar';
  if (/cafe|desjejum/.test(t)) return 'cafe';
  return null;
}

/**
 * Puro. Grava o adiamento em `memoria.adiamentos` (a memória do dia: vira a página à meia-noite) e devolve { slot, dia,
 * ateMin } ou null. `ate` "HH:MM" no horário da pessoa; sem ela (ou inválida), `agoraMin` + 2 h. Hora antes de agora vale
 * como dita errado: usa o padrão.
 */
export function registrarAdiamento(memoria, { nome, refeicao, ate, dia, agoraMin }) {
  const slot = slotDoNome(refeicao);
  if (!slot || !nome || !dia || !Number.isFinite(agoraMin)) return null;
  const dita = /^\d{1,2}:\d{2}$/.test(String(ate || '')) ? minutosDe(ate) : null;
  const ateMin = dita != null && dita > agoraMin && dita < 24 * 60 ? dita : agoraMin + ADIAMENTO_PADRAO_MIN;
  memoria.adiamentos ||= {};
  memoria.adiamentos[`${nome}:${slot}`] = { dia, ateMin };
  // a pessoa avisou de novo depois de já ter sido cobrada: a próxima cobrança volta a valer depois da hora nova
  if (memoria.cobrancas) delete memoria.cobrancas[`${nome}:${slot}`];
  return { slot, dia, ateMin };
}

const PISTA_ATRASO = /(vai demorar|vai atrasar|demorar (ainda|mais|um pouco)|mais tarde|atrasad[oa]|ainda n[aã]o (almocei|jantei|tomei caf[eé])|vou (almo[cç]ar|jantar|comer|tomar caf[eé])\s+(s[oó]\s+)?(depois|mais tarde|l[aá] pel[ao]s|[àa]s|perto d[ae]s?)|s[oó] vou (almo[cç]ar|jantar|comer)|(almo[cç]o|janta|jantar)\s+(s[oó]\s+)?(vai ser|fica|sai)\s+(depois|mais tarde|l[aá] pel[ao]s|[àa]s|perto d[ae]s?|daqui))/i;

/**
 * Puro. Rede de segurança da linha ADIAR, em código: frase da pessoa que diz que o almoço, o jantar ou o café vão atrasar
 * ("meu almoço vai demorar ainda 1h30", "vou almoçar mais tarde", "janto lá pelas 21h"). Devolve { refeicao, ate } (ate
 * "HH:MM" ou null) ou null. `agoraMin` = minutos do dia no horário da pessoa.
 */
export function detectarAdiamento(texto, agoraMin) {
  const t = String(texto || '').toLowerCase();
  if (!t || !PISTA_ATRASO.test(t)) return null;
  const refeicao = /almo[cç]/.test(t) ? 'almoço' : /jant/.test(t) ? 'jantar' : /caf[eé] da manh[aã]|tomar caf[eé]|tomei caf[eé]/.test(t) ? 'café da manhã' : null;
  if (!refeicao || !Number.isFinite(agoraMin)) return null;
  let ateMin = null;
  const h = t.match(/(\d{1,2})\s*h(?:oras?|rs?)?\s*(?:e\s*)?(\d{1,2})?(?:\s*min)?/);
  const so = t.match(/(\d{1,3})\s*min/);
  const relogio = t.match(/(?:[àa]s|pel[ao]s|perto d[ae]s?)\s*(\d{1,2})(?:[:h](\d{2})|h)?(?!\d)/);
  if (/meia hora/.test(t)) ateMin = agoraMin + 30;
  else if (/uma hora e meia/.test(t)) ateMin = agoraMin + 90;
  else if (/uma hora/.test(t)) ateMin = agoraMin + 60;
  else if (relogio) ateMin = Number(relogio[1]) * 60 + Number(relogio[2] || 0);
  else if (h && Number(h[1]) <= 5) ateMin = agoraMin + Number(h[1]) * 60 + Number(h[2] || 0);
  else if (so) ateMin = agoraMin + Number(so[1]);
  const ate = ateMin != null && ateMin > agoraMin && ateMin < 24 * 60 ? hhmmDe(ateMin) : null;
  return { refeicao, ate };
}

/** Puro. Até quando (minutos do dia) a refeição está adiada hoje, ou null. */
export function adiadoAte(memoria, nome, slot, dia) {
  const a = memoria?.adiamentos?.[`${nome}:${slot}`];
  return a && a.dia === dia && Number.isFinite(a.ateMin) ? a.ateMin : null;
}

export const ATRASO_COBRANCA_MIN = Number(process.env.ATRASO_COBRANCA_MIN) || 75; // minutos depois do horário habitual
export const JANELA_COBRANCA_MIN = Number(process.env.JANELA_COBRANCA_MIN) || 120; // depois disso não cobra mais (fica pro resumo do dia)

export async function verificarCobrancas() {
  const { memoria } = estado;
  if (estado.statusConexao !== 'conectado' || !memoria.grupo || estado.fechandoDia) return;
  await garantirDiaAtual();
  const { dia } = agora();

  const perfis = await enriquecerPerfis(await listarPerfis(), dia);
  // o "hoje" de cada pessoa é o do fuso dela (as refeições são gravadas no dia local desde 13/10)
  const hoje = await refeicoesDosDias([dia, ...perfis.map((p) => marcaDeTempo(p).dia)]).catch(() => []);
  estado.memoria.cobrancas ||= {};

  for (const p of perfis) {
    // tudo no fuso da pessoa: dia e hora atuais, janela de 7h-23h e horário habitual aprendido
    const { dia: diaP, horaLocal: hora } = marcaDeTempo(p);
    const agoraMin = minutosDe(hora);
    if (agoraMin < 7 * 60 || agoraMin > 23 * 60) continue; // ninguém merece cobrança de madrugada
    // fase 7: refeição que um evento do app tirou de casa (comer fora, festa, viagem) não é cobrada
    const suspensos = slotsSuspensos(p._eventosApp || [], diaP);
    // pega só a refeição atrasada mais recente (se o bot ficou fora, não dispara 3 cobranças de uma vez)
    const pendentes = SLOTS.filter((s) => s.cobrar).filter((s) => {
      if (suspensos.has(s.id)) {
        const chave = `${p.nome}:${s.id}`;
        if (!estado.memoria.cobrancas[chave]) {
          const e = suspensos.get(s.id);
          console.log(`[cobranca] ${p.nome}: ${s.nome} suspenso pelo evento do app "${e.titulo}" (${e.tipo}); não cobro`);
          estado.memoria.cobrancas[chave] = true;
        }
        return false;
      }
      const h = p._hab[s.id];
      if (!h.aprendido) return false; // só cobra horário que ela JÁ aprendeu (3+ refeições registradas nesse slot)
      // avisou que vai atrasar: o limite passa a ser a hora dita + folga (a janela de cobrança anda junto)
      const adiado = adiadoAte(estado.memoria, p.nome, s.id, diaP);
      const limite = Math.max(h.minutos + ATRASO_COBRANCA_MIN, adiado != null ? adiado + FOLGA_ADIAMENTO_MIN : 0);
      if (agoraMin < limite || agoraMin > limite + JANELA_COBRANCA_MIN) return false; // passou da janela: fica pro resumo do dia
      const jaMandou = hoje.some((r) => r.dia === diaP && r.slot === s.id && p.jids.includes(r.jid));
      return !jaMandou && !estado.memoria.cobrancas[`${p.nome}:${s.id}`];
    });
    if (!pendentes.length) continue;
    const slot = pendentes[pendentes.length - 1];
    for (const s of pendentes) estado.memoria.cobrancas[`${p.nome}:${s.id}`] = true; // marca todas, cobra só a última
    persistirMemoria(estado.memoria).catch(() => {});

    const costume = p._refs
      .filter((r) => r.slot === slot.id)
      .slice(-5)
      .map((r) => r.resumo)
      .filter((r) => r && r !== '[foto]')
      .join('; ');
    try {
      // no meio de aula, reunião ou trabalho a cobrança vira barulho: espera o intervalo
      const ocupado = p._agenda?.lista ? ocupadoAgora(p._agenda.lista, { perfil: p }) : null;
      if (ocupado && ['aula', 'reunião', 'trabalho', 'viagem', 'saúde'].includes(ocupado.tipo)) {
        console.log(`[cobranca] ${p.nome} está em "${ocupado.titulo}" (${ocupado.tipo}) até ${ocupado.terminaEm}; não cobro agora`);
        continue;
      }
      // pela localização do celular: num restaurante/bar/padaria a comida está vindo; na academia, cobrar é barulho
      const lugarAgora = p._lugares?.situacao?.estado === 'lugar' ? p._lugares.situacao.lugar : null;
      if (lugarAgora && ['restaurante', 'bar', 'café', 'padaria', 'academia'].includes(lugarAgora.tipo)) {
        console.log(`[cobranca] ${p.nome} está em ${lugarAgora.tipo} desde ${p._lugares.situacao.desde}; não cobro agora`);
        continue;
      }
      const msg = await ia.cobrarRefeicao({
        perfil: p,
        dia,
        slot: slot.nome,
        horaAgora: hora,
        horaHabitual: hhmmDe(p._hab[slot.id].minutos),
        costume,
        persona: estado.persona,
        historico: estado.memoria.mensagens,
        conhecimento: docsPara(p, { soBase: true }), // só o documento base: cobrança não precisa da base inteira
        // a cobrança sai no grupo: a linha de oxigênio e temperatura do dossiê não entra no prompt (D12)
        dossie: semCorpoSensivel(await comTempo(dossieDe(p), 20_000, 'dossiê').catch(() => '')).texto,
        contexto: contextoDaCobranca({ perfil: p, dia: diaP, eventos: p._eventosApp || [], humor: (await humorDe(p.jids || [], diaP, diaP).catch(() => []))[0] || null }),
      });
      if (msg && !/^silencio\W*$/i.test(msg)) {
        // objetivo trocado não passa nem na cobrança ("seu déficit (ops, superávit)" pra quem faz hipertrofia, 28/09 22:30)
        let textoCobranca = msg;
        const termos = p.objetivo ? vocabularioErrado(textoCobranca, p.objetivo) : [];
        if (termos.length) {
          textoCobranca = removerFrasesCom(textoCobranca, termos);
          console.warn(`[cobranca] frases com objetivo trocado removidas pra ${p.nome}: ${termos.join(', ')}`);
        }
        // linha técnica (REFEICAO: {...} vazou na cobrança da Ale, 02/10 10:20), bordão de chegada ("Apareceu a Margarida" pra quem NÃO apareceu)
        // e vocativo no gênero errado não saem na cobrança
        const prep = prepararCobranca(textoCobranca, { genero: p.genero, outrosNomes: perfis.filter((o) => o !== p).map((o) => o.nome.split(' ')[0]), persona: estado.persona });
        if (prep.removidas.length) console.log(`[cobranca] bordão de chegada removido da cobrança de ${p.nome}: ${prep.removidas.map((f) => f.slice(0, 60)).join(' | ')}`);
        textoCobranca = prep.texto;
        if (!textoCobranca.trim()) continue;
        await enviar(estado.memoria.grupo, textoCobranca);
        await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: textoCobranca, tipo: 'bot' });
        console.log(`[cobranca] ${p.nome} sem ${slot.nome} (habitual ${hhmmDe(p._hab[slot.id].minutos)}, fuso ${fusoDe(p)})`);
      }
    } catch (e) {
      console.error('[cobranca] falha:', e.message);
    }
  }
}
