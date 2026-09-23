// revisao.js - Segunda opinião da própria Nutri. Quando uma resposta sai por reserva externa (Gemini em "alta demanda"),
// ela fica anotada aqui. Quando o Gemini volta, a Nutri relê a mensagem original (com a foto, se tinha) e o que foi dito
// em nome dela. Se estava certo, fica quieta. Se estava errado, corrige no grupo citando a mensagem antiga, e conserta
// (ou apaga) o registro da refeição que aquela resposta gerou.

import { proto } from '@whiskeysockets/baileys';

import { salvarRevisaoPendente, revisoesPendentes, apagarRevisaoPendente, registrarRefeicao, apagarRefeicaoEm } from './mongo.js';
import * as ia from './gemini.js';
import { estado } from './estado.js';
import { enviar, acaso } from './whatsapp.js';
import { lembrar } from './dia.js';
import { lerEstimativa, descricaoDaAnalise } from './resumo.js';
import { agora } from './util.js';

const IDADE_MAX_H = 24; // depois disso não vale mais corrigir (o dia já fechou, o resumo já saiu)
const IMAGEM_MAX_BYTES = 1_500_000; // foto do WhatsApp costuma ter 50-300 KB; acima disso a revisão vai só pelo texto
const POR_RODADA = 4; // revisões por passada do cron (cada uma é uma chamada ao Gemini)

export const DESCULPAS = [
  'Gente, desculpa, ali eu tava doidinha 🤪 Meu cérebro principal tinha caído e respondi no modo reserva. Revisei agora e tô corrigindo:',
  'Errei feio ali em cima 🫣 Tava rodando no cérebro reserva (o Google tinha me abandonado). Agora com a cabeça no lugar:',
  'Desculpa, minha versão de baixa qualidade respondeu isso aí 😵‍💫 Voltei ao normal, revisei e o certo é:',
  'Ó, aquela resposta ali foi a minha estagiária que deu enquanto eu tava fora do ar 🫠 Corrigindo:',
];

const codificar = (msg) => Buffer.from(proto.WebMessageInfo.encode(proto.WebMessageInfo.fromObject(msg)).finish()).toString('base64');
const decodificar = (b64) => proto.WebMessageInfo.decode(Buffer.from(b64, 'base64'));

/** Texto final da correção: a desculpa (no personagem) e a resposta revisada. */
export function montarCorrecao(respostaCorrigida, desculpa = acaso(DESCULPAS)) {
  return `${desculpa}\n\n${String(respostaCorrigida || '').trim()}`;
}

/**
 * Anota uma resposta dada por reserva externa pra revisão futura.
 * enviado = mensagem que o bot mandou (key + message), pra citar na correção; refeicao = { slot, minutos } se registrou.
 */
export async function registrarParaRevisao({ jidGrupo, jid, perfil, texto, imagem, mimeType, resposta, dia, hora, horaLocal, enviado, refeicao }) {
  await salvarRevisaoPendente({
    jidGrupo,
    jid,
    perfil: { nome: perfil.nome, apelido: perfil.apelido || null, objetivo: perfil.objetivo || null, peso: perfil.peso || null, dieta: perfil.dieta || null },
    texto: texto || '',
    imagem: imagem && imagem.length <= IMAGEM_MAX_BYTES ? imagem.toString('base64') : null,
    mimeType: mimeType || null,
    resposta,
    dia,
    hora,
    horaLocal: horaLocal || hora,
    enviadoB64: codificar({ key: enviado.key, message: enviado.message }),
    refeicao: refeicao || null,
  });
  console.log(`[revisao] resposta de reserva pra ${perfil.nome} anotada pra revisão quando o Gemini voltar`);
}

/** Cron (a cada 10 min, na fila): revisa o que ficou pendente. Só roda no Gemini; se ele ainda estiver fora, espera a próxima. */
export async function revisarPendentes() {
  if (estado.statusConexao !== 'conectado' || estado.fechandoDia) return;
  const lista = await revisoesPendentes(POR_RODADA).catch(() => []);
  if (!lista.length) return;

  for (const p of lista) {
    const idadeH = (Date.now() - new Date(p.criadoEm).getTime()) / 3600_000;
    if (idadeH > IDADE_MAX_H) {
      console.log(`[revisao] descartada (mais de ${IDADE_MAX_H}h): ${p.perfil?.nome} ${p.dia} ${p.horaLocal}`);
      await apagarRevisaoPendente(p._id).catch(() => {});
      continue;
    }

    let r;
    try {
      r = await ia.revisarRespostaReserva({
        perfil: p.perfil,
        texto: p.texto,
        imagem: p.imagem ? Buffer.from(p.imagem, 'base64') : null,
        mimeType: p.mimeType,
        respostaReserva: p.resposta,
        dia: p.dia,
        hora: p.horaLocal || p.hora,
        persona: estado.persona,
      });
    } catch (e) {
      // Gemini ainda em alta demanda: nada de corrigir com outra reserva. Fica pra próxima passada.
      console.warn(`[revisao] Gemini ainda indisponível, fica pra próxima: ${String(e.message).slice(0, 120)}`);
      return;
    }

    if (r.ok || !r.resposta_corrigida) {
      console.log(`[revisao] resposta de reserva pra ${p.perfil.nome} (${p.horaLocal}) estava ok${r.motivo ? `: ${r.motivo}` : ''}`);
      await apagarRevisaoPendente(p._id).catch(() => {});
      continue;
    }

    // Estava errada: corrige no grupo citando a mensagem antiga
    const textoFinal = montarCorrecao(r.resposta_corrigida);
    let citada;
    try {
      citada = proto.WebMessageInfo.toObject(decodificar(p.enviadoB64), { longs: Number, defaults: false });
    } catch {
      citada = undefined;
    }
    await enviar(p.jidGrupo, textoFinal, citada);
    await lembrar({ hora: agora().hora, jid: null, nome: ia.nomeDaBot(), texto: textoFinal, tipo: 'bot' });
    console.log(`[revisao] corrigi no grupo a resposta de reserva pra ${p.perfil.nome} (${p.horaLocal}): ${r.motivo || 'sem motivo informado'}`);

    // E o registro da refeição que aquela resposta gerou?
    if (p.refeicao) {
      if (r.refeicao_consumida === false) {
        // não era comida consumida (receita, dúvida, sugestão): o registro não devia existir
        await apagarRefeicaoEm({ jid: p.jid, dia: p.dia, slot: p.refeicao.slot, minutos: p.refeicao.minutos })
          .then((n) => n && console.log(`[revisao] registro de refeição apagado (${p.perfil.nome} ${p.refeicao.slot} ${p.horaLocal})`))
          .catch((e) => console.error('[revisao] falha ao apagar refeição:', e.message));
      } else {
        const estimativa = lerEstimativa(r.resposta_corrigida);
        if (estimativa) {
          await registrarRefeicao({
            jid: p.jid,
            nome: p.perfil.nome,
            dia: p.dia,
            hora: p.hora,
            horaLocal: p.horaLocal,
            minutos: p.refeicao.minutos, // mesmo horário: cai no registro que a reserva criou e o substitui
            slot: p.refeicao.slot,
            resumo: (p.texto || '[foto]').slice(0, 120),
            descricao: descricaoDaAnalise(r.resposta_corrigida, p.texto || '[foto]'),
            estimativa,
            correcao: true,
          }).catch((e) => console.error('[revisao] falha ao corrigir refeição:', e.message));
        }
      }
    }
    await apagarRevisaoPendente(p._id).catch(() => {});
  }
}
