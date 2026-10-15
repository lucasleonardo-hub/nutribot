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
      const limite = h.minutos + ATRASO_COBRANCA_MIN;
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
