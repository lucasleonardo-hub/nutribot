// revisao.js - Segunda opinião da própria Nutri. Quando uma resposta sai por reserva externa (Gemini em "alta demanda"),
// ela fica anotada aqui. Quando o Gemini volta, a Nutri relê a mensagem original (com a foto, se tinha) e o que foi dito
// em nome dela. Se estava certo, fica quieta. Se estava errado, corrige no grupo citando a mensagem antiga, e conserta
// (ou apaga) o registro da refeição que aquela resposta gerou.

import { proto } from '@whiskeysockets/baileys';

import { salvarRevisaoPendente, revisoesPendentes, apagarRevisaoPendente, registrarRefeicao, apagarRefeicaoEm, salvarConfig } from './mongo.js';
import * as ia from './gemini.js';
import { estado } from './estado.js';
import { enviar, acaso } from './whatsapp.js';
import { lembrar } from './dia.js';
import { lerEstimativa, descricaoDaAnalise } from './resumo.js';
import { agora } from './util.js';

const IDADE_MAX_H = 24; // depois disso não vale mais corrigir (o dia já fechou, o resumo já saiu)
const IMAGEM_MAX_BYTES = 1_500_000; // foto do WhatsApp costuma ter 50-300 KB; acima disso a revisão vai só pelo texto

// AMOSTRAGEM: conferir TODA resposta de reserva custa caro (cada uma é uma chamada Flash, e a cota grátis é de 20/dia
// por modelo). Então ela confere só algumas por semana, em horas aleatórias: pega UMA pendente ao acaso, confere,
// e o resto expira sem conferência. Serve pra medir se as reservas estão falando bobagem, não pra auditar tudo.
const POR_SEMANA = Number(process.env.REVISOES_POR_SEMANA) || 2;
const GAP_MIN_H = Number(process.env.REVISAO_GAP_H) || 20; // horas mínimas entre duas conferências
const CHANCE = Number(process.env.REVISAO_CHANCE) || 0.2; // por hora elegível, pra cair em horário variado

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

/** Conferências feitas nos últimos 7 dias (guardadas na config do bot). */
function amostrasRecentes() {
  return (estado.config.revisoesAmostra || []).filter((iso) => Date.now() - new Date(iso).getTime() < 7 * 86400_000);
}

/** É hora de conferir por amostragem? (cota da semana, intervalo mínimo e sorteio, pra cair em horários variados) */
function horaDeAmostrar() {
  const feitas = amostrasRecentes();
  if (feitas.length >= POR_SEMANA) return false;
  const ultima = feitas.map((iso) => new Date(iso).getTime()).sort().pop();
  if (ultima && Date.now() - ultima < GAP_MIN_H * 3600_000) return false;
  return Math.random() < CHANCE;
}

async function marcarAmostra() {
  const lista = [...amostrasRecentes(), new Date().toISOString()];
  estado.config = await salvarConfig({ revisoesAmostra: lista }).catch(() => estado.config);
}

/**
 * Cron (de hora em hora, na fila): limpa o que expirou e, de vez em quando, confere UMA resposta de reserva por
 * amostragem. Só roda no Gemini; se ele estiver fora, não gasta a cota da semana e tenta depois.
 */
export async function revisarPendentes() {
  if (estado.statusConexao !== 'conectado' || estado.fechandoDia) return;
  const lista = await revisoesPendentes(30).catch(() => []);
  if (!lista.length) return;

  // 1) expira o que passou de 24h (a maioria: a amostragem confere poucas)
  const vivas = [];
  for (const p of lista) {
    if ((Date.now() - new Date(p.criadoEm).getTime()) / 3600_000 > IDADE_MAX_H) await apagarRevisaoPendente(p._id).catch(() => {});
    else vivas.push(p);
  }
  if (!vivas.length) return;

  // 2) amostragem: uma pendente ao acaso, poucas vezes por semana
  if (!horaDeAmostrar()) return;
  const p = vivas[Math.floor(Math.random() * vivas.length)];
  console.log(`[revisao] conferindo por amostragem (${amostrasRecentes().length + 1}/${POR_SEMANA} da semana; ${vivas.length} pendente(s)): ${p.perfil?.nome} ${p.dia} ${p.horaLocal}`);

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
    await marcarAmostra();
  } catch (e) {
    if (e.jsonInvalido) {
      // o Gemini respondeu, mas o JSON veio quebrado: gastou a chamada, não adianta repetir essa
      console.warn(`[revisao] descartada (${e.message.slice(0, 80)})`);
      await marcarAmostra();
      await apagarRevisaoPendente(p._id).catch(() => {});
      return;
    }
    // Gemini em alta demanda: não gasta a cota da semana, tenta numa próxima hora
    console.warn(`[revisao] Gemini indisponível agora, fica pra depois: ${String(e.message).slice(0, 100)}`);
    return;
  }

  if (r.ok || !r.resposta_corrigida) {
    console.log(`[revisao] resposta de reserva pra ${p.perfil.nome} (${p.horaLocal}) estava ok${r.motivo ? `: ${r.motivo}` : ''}`);
    await apagarRevisaoPendente(p._id).catch(() => {});
    return;
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
