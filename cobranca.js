// cobranca.js - "Cadê a refeição de hoje?": cobra quem passou do horário habitual (aprendido) sem mandar a refeição.

import { listarPerfis, refeicoesDoDia, persistirMemoria } from './mongo.js';
import * as ia from './gemini.js';
import { docsPara } from './conhecimento.js';
import { dossieDe } from './pessoas.js';
import { agora, fusoDe, SLOTS, minutosDe, hhmmDe, comTempo } from './util.js';
import { estado } from './estado.js';
import { enviar } from './whatsapp.js';
import { lembrar, garantirDiaAtual } from './dia.js';
import { enriquecerPerfis } from './perfis.js';

export const ATRASO_COBRANCA_MIN = Number(process.env.ATRASO_COBRANCA_MIN) || 75; // minutos depois do horário habitual
export const JANELA_COBRANCA_MIN = Number(process.env.JANELA_COBRANCA_MIN) || 120; // depois disso não cobra mais (fica pro resumo do dia)

export async function verificarCobrancas() {
  const { memoria } = estado;
  if (estado.statusConexao !== 'conectado' || !memoria.grupo || estado.fechandoDia) return;
  await garantirDiaAtual();
  const { dia } = agora();

  const perfis = await enriquecerPerfis(await listarPerfis(), dia);
  const hoje = await refeicoesDoDia(dia).catch(() => []);
  estado.memoria.cobrancas ||= {};

  for (const p of perfis) {
    // tudo no fuso da pessoa: hora atual, janela de 7h-23h e horário habitual aprendido
    const hora = agora(fusoDe(p)).hora;
    const agoraMin = minutosDe(hora);
    if (agoraMin < 7 * 60 || agoraMin > 23 * 60) continue; // ninguém merece cobrança de madrugada
    // pega só a refeição atrasada mais recente (se o bot ficou fora, não dispara 3 cobranças de uma vez)
    const pendentes = SLOTS.filter((s) => s.cobrar).filter((s) => {
      const h = p._hab[s.id];
      if (!h.aprendido) return false; // só cobra horário que ela JÁ aprendeu (3+ refeições registradas nesse slot)
      const limite = h.minutos + ATRASO_COBRANCA_MIN;
      if (agoraMin < limite || agoraMin > limite + JANELA_COBRANCA_MIN) return false; // passou da janela: fica pro resumo do dia
      const jaMandou = hoje.some((r) => r.slot === s.id && p.jids.includes(r.jid));
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
        dossie: await comTempo(dossieDe(p), 20_000, 'dossiê').catch(() => ''),
      });
      if (msg && !/^silencio\W*$/i.test(msg)) {
        await enviar(estado.memoria.grupo, msg);
        await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: msg, tipo: 'bot' });
        console.log(`[cobranca] ${p.nome} sem ${slot.nome} (habitual ${hhmmDe(p._hab[slot.id].minutos)}, fuso ${fusoDe(p)})`);
      }
    } catch (e) {
      console.error('[cobranca] falha:', e.message);
    }
  }
}
