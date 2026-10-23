// exemplos.js - O Claude como professor dos outros modelos. Cada resposta que ele deu no grupo e passou pelas guardas fica
// guardada (coleção exemplos_claude: mensagem da pessoa, tipo e a resposta final que o grupo viu). Quando o Claude não
// atende (teto do dia, falha), o Gemini recebe as respostas dele mais parecidas com a situação atual como PADRÃO: copiar o
// jeito (tom, tamanho, estrutura, cuidado), nunca os fatos e números, que são de outro momento.
//
// Privacidade: só exemplos da PRÓPRIA pessoa, pela chave do perfil (chaveDaPessoa), nunca pelo nome: a resposta de um não
// serve de molde pra outro e não vaza nada entre eles.
// Escolha por significado (embedding do Gemini, cosseno calculado aqui) com preferência pelo mesmo tipo de mensagem.
// Tudo aqui é "melhor esforço": falhou, o Gemini responde sem exemplos.
import { colecao } from './mongo.js';
import { embutir } from './gemini.js';

const COLECAO = 'exemplos_claude';
const POR_PESSOA = Number(process.env.EXEMPLOS_POR_PESSOA) || 300; // guardados (os mais antigos saem)
const CANDIDATOS = 150; // os mais recentes, comparados por significado
const MAX_CHARS_RESPOSTA = 1200;
let indice = null;

/** Puro. Chave da pessoa: o _id do perfil (único e fixo); nome repete e muda (perfil novo nasce com o número). */
export function chaveDaPessoa(perfil) {
  if (perfil?._id) return `perfil:${String(perfil._id)}`;
  return perfil?.jids?.[0] ? `jid:${perfil.jids[0]}` : null;
}

/** Puro. Tipo da mensagem, com as mesmas decisões que montaram o prompt (mensagens.js). */
export function tipoDaMensagem({ temImagem = false, planejando = false, perguntaProgresso = false, contestacao = false, metaConversa = false } = {}) {
  if (perguntaProgresso) return 'progresso';
  if (contestacao) return 'contestacao';
  if (metaConversa) return 'sistema';
  if (temImagem) return 'foto';
  if (planejando) return 'opiniao';
  return 'conversa';
}

/** Puro. Cosseno entre dois vetores do mesmo tamanho (0 se faltar algum). */
export function cosseno(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let p = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    p += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? p / Math.sqrt(na * nb) : 0;
}

/** Puro. Os n melhores: parecença por significado + bônus pro mesmo tipo; sem repetir resposta igual. */
export function escolherExemplos(candidatos, vetor, tipo, n = 3) {
  const vistos = new Set();
  return candidatos
    .map((c) => ({ ...c, nota: cosseno(c.vetor, vetor) + (c.tipo === tipo ? 0.15 : 0) }))
    .sort((a, b) => b.nota - a.nota)
    .filter((c) => !vistos.has(c.resposta) && vistos.add(c.resposta))
    .slice(0, n);
}

/** Puro. O bloco que entra no prompt do Gemini. */
export function blocoExemplos(lista) {
  if (!lista.length) return '';
  const itens = lista.map((e, i) => `EXEMPLO ${i + 1} (${e.tipo}, ${e.dia})\nMensagem: ${e.mensagem}\nResposta: ${e.resposta}`).join('\n\n');
  return (
    `\n\nPADRÃO DE RESPOSTA (respostas reais que o seu modelo principal deu a esta mesma pessoa, em situações parecidas): ` +
    `imite o JEITO (tom, tamanho, estrutura dos blocos, o cuidado com o que afirma, o que ele escolheu NÃO dizer). ` +
    `NUNCA copie fatos, números, horários ou refeições daqui: são de outro momento; os dados de agora estão no contexto. ` +
    `Os exemplos mostram só o texto que o grupo viu; as linhas ocultas (REFEICAO, REGISTRO etc.) seguem as regras de sempre.\n\n${itens}`
  );
}

/** Guarda a resposta final que o Claude deu. Nunca lança. */
export async function guardarExemplo({ pessoa, tipo, mensagem, resposta, dia }) {
  try {
    const m = String(mensagem || '').trim();
    const r = String(resposta || '').trim();
    if (!pessoa || m.length < 3 || r.length < 20) return;
    const vetor = await embutir(m.slice(0, 2000), 'RETRIEVAL_DOCUMENT');
    if (!vetor?.length) return;
    const col = colecao(COLECAO);
    indice ||= col.createIndex({ pessoa: 1, criadoEm: -1 }).catch(() => null);
    await col.insertOne({ pessoa, tipo, mensagem: m.slice(0, 600), resposta: r.slice(0, MAX_CHARS_RESPOSTA), dia, vetor, criadoEm: new Date() });
    const velhos = await col.find({ pessoa }, { projection: { _id: 1 } }).sort({ criadoEm: -1 }).skip(POR_PESSOA).toArray();
    if (velhos.length) await col.deleteMany({ _id: { $in: velhos.map((v) => v._id) } });
    console.log(`[exemplos] guardada resposta do Claude pra ${pessoa} (${tipo})`);
  } catch (e) {
    console.warn(`[exemplos] não guardei: ${String(e.message).slice(0, 100)}`);
  }
}

/**
 * Bloco de exemplos pra esta mensagem, ou ''. Devolve uma função preguiçosa e memorizada: o gerar() só a chama quando
 * o Claude não atendeu (o embedding da consulta não é gasto à toa) e as rodadas de ferramenta reaproveitam o resultado.
 */
export function exemplosPreguicosos({ pessoa, tipo, mensagem }) {
  let promessa = null;
  return () =>
    (promessa ||= (async () => {
      try {
        if (!pessoa || !String(mensagem || '').trim()) return '';
        const candidatos = await colecao(COLECAO).find({ pessoa }).sort({ criadoEm: -1 }).limit(CANDIDATOS).toArray();
        if (!candidatos.length) return '';
        const vetor = await embutir(String(mensagem).slice(0, 2000), 'RETRIEVAL_QUERY');
        const escolhidos = escolherExemplos(candidatos, vetor, tipo);
        if (escolhidos.length) console.log(`[exemplos] ${escolhidos.length} resposta(s) do Claude como padrão pro Gemini (${pessoa}, ${tipo})`);
        return blocoExemplos(escolhidos);
      } catch (e) {
        console.warn(`[exemplos] sem exemplos: ${String(e.message).slice(0, 100)}`);
        return '';
      }
    })());
}
