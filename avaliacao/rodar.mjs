// avaliacao/rodar.mjs - Roda a suíte comportamental COM modelo: monta o mesmo prompt da conversa (ia.responder), passa a
// resposta pelas mesmas guardas de código do mensagens.js e confere o que o grupo veria. Não usa banco nem WhatsApp:
// perfis, histórico e ferramentas são de mentira (as ferramentas devolvem dados fixos e anotam o que o modelo pediu).
//
//   npm run avaliar                      -> todos os cenários
//   npm run avaliar -- --so C01,C20b     -> só esses ids
//   npm run avaliar -- --categoria gênero
//   npm run avaliar -- --limite 10       -> os 10 primeiros
//   npm run avaliar -- --modelo flash    -> fila principal (padrão quando há AVALIACAO_GEMINI_API_KEY; senão 'lite',
//                                           pra não gastar a cota diária Flash do bot em produção)
//   npm run avaliar -- --sem-falhar      -> código de saída 0 mesmo com falhas (só relatório)
//
// Relatório: resumo no terminal e JSON completo (prompt não, só resposta bruta, final, checagens, ferramentas, tempo) em
// avaliacao/relatorios/<data>_<hora>.json (pasta ignorada pelo git). Sai com código 1 se algum cenário falhar.
// Chave: AVALIACAO_GEMINI_API_KEY (de preferência um projeto Google separado, grátis) ou, na falta, a GEMINI_API_KEY do .env.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (nome) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] ?? '' : null;
};
const tem = (nome) => args.includes(`--${nome}`);

const chaveDedicada = (process.env.AVALIACAO_GEMINI_API_KEY || '').trim();
if (chaveDedicada) {
  process.env.GEMINI_API_KEY = chaveDedicada;
  process.env.GEMINI_API_KEYS = '';
}
if (!(process.env.GEMINI_API_KEY || '').trim()) {
  console.log('avaliar: sem GEMINI_API_KEY nem AVALIACAO_GEMINI_API_KEY; nada a rodar (a suíte sem modelo é o npm test).');
  process.exit(0);
}
process.env.PESQUISA_WEB = 'off';

const { CENARIOS, PERFIS, PERSONA_TESTE } = await import('./cenarios.mjs');
const ia = await import('../gemini.js');
const C = await import('../consciencia.js');
const { ferramentasPara } = await import('../ferramentas.js');
const { parecePedidoOuPlano, agora } = await import('../util.js');

const modelo = flag('modelo') || (chaveDedicada ? 'flash' : 'lite');
const leve = modelo !== 'flash';
const DIA = flag('dia') || agora('America/Sao_Paulo').dia;
const PAUSA_MS = Number(flag('pausa') || (leve ? 1500 : 4000));
const TEMPO_MAX_MS = 150_000;

// ---------- seleção ----------
let lista = [...CENARIOS];
if (flag('so')) {
  const ids = new Set(flag('so').split(',').map((s) => s.trim()).filter(Boolean));
  lista = lista.filter((c) => ids.has(c.id));
}
if (flag('categoria')) lista = lista.filter((c) => c.categoria === flag('categoria'));
if (flag('limite')) lista = lista.slice(0, Number(flag('limite')));
const dup = CENARIOS.map((c) => c.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) {
  console.error(`ids repetidos em cenarios.mjs: ${dup.join(', ')}`);
  process.exit(2);
}
if (!lista.length) {
  console.error('nenhum cenário selecionado');
  process.exit(2);
}

// ---------- ferramentas de mentira ----------
const diasAtras = (n) => {
  const d = new Date(`${DIA}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const FIXAS = {
  refeicoes_periodo: () =>
    `9 refeições em 3 dias (todas):\n` +
    `${diasAtras(3)} 08:10 [cafe] pão com ovos (420 kcal, P 22 g)\n${diasAtras(3)} 12:50 [almoco] arroz, feijão e frango grelhado (780 kcal, P 48 g)\n${diasAtras(3)} 20:10 [jantar] macarrão com carne moída (690 kcal, P 35 g)\n` +
    `${diasAtras(2)} 08:00 [cafe] aveia com banana e whey (410 kcal, P 30 g)\n${diasAtras(2)} 13:05 [almoco] prato feito do RU (820 kcal, P 40 g)\n${diasAtras(2)} 20:30 [jantar] omelete de 3 ovos com queijo (430 kcal, P 28 g)\n` +
    `${diasAtras(1)} 08:20 [cafe] pão com queijo e café (350 kcal, P 14 g)\n${diasAtras(1)} 12:40 [almoco] arroz, feijão e bife (760 kcal, P 45 g)\n${diasAtras(1)} 19:50 [jantar] sopa de legumes com frango desfiado (380 kcal, P 26 g)`,
  padrao_alimentar: () => 'PADRÃO (28 dias): café ~08:10 (pão/ovos/aveia), almoço ~12:50 (arroz, feijão e uma proteína), jantar ~20:10 (variado, mais leve). Lanche da tarde em 40% dos dias.',
  agenda: () => '(sem compromissos nos próximos 7 dias)',
  semana_tipica: () => '(sem lugares aprendidos ainda)',
  lugares: () => '(essa pessoa não ligou a localização)',
  treino_forca: () => '(sem treinos de força registrados)',
  relogio: () => '(sem dados do relógio nos últimos 7 dias)',
  pesagens: () => 'RITMO: peso estável nas últimas 4 semanas (variação dentro da margem).\n\nÚLTIMAS PESAGENS:\n' + [28, 21, 14, 7, 0].map((n) => `${diasAtras(n)}: 75,5 kg`).join('\n'),
  despensa: () => 'DESPENSA (nota de mercado de 7 dias atrás): arroz, feijão, ovos, aveia, banana, iogurte natural, frango, batata doce, azeite.',
  conhecimento: () => '(nada na base sobre isso)',
  lembrancas: () => '(nenhuma lembrança parecida)',
  mercados_perto: () => '(sem mercados mapeados)',
  reflexao: () => '(ainda sem reflexão sobre essa pessoa)',
  anotar_memoria: ({ texto, tipo } = {}) => `anotado (${tipo || 'contexto'}): ${String(texto || '').slice(0, 120)}`,
  atualizar_perfil: (a = {}) => `perfil atualizado: ${JSON.stringify(a)}`,
};
function ferramentasDeMentira(perfil, modo) {
  const reais = ferramentasPara(perfil, { dia: DIA, escrita: modo === 'escrita' });
  const usadas = [];
  return {
    declaracoes: reais.declaracoes,
    usadas,
    async executar(nome, args = {}) {
      usadas.push(nome);
      if (modo === 'falha') return `(erro ao consultar ${nome}: tempo esgotado; não chame de novo, responda com o que já tem e sem citar o erro)`;
      const fn = FIXAS[nome];
      return fn ? fn(args) : `(ferramenta desconhecida: ${nome})`;
    },
  };
}

// ---------- as mesmas guardas do mensagens.js, na mesma ordem ----------
const TEM_BLOCO = /Refei[cç][aã]o:\*?\s*(caf[eé]|almo[cç]o|lanche|jantar|ceia)|O que eu vi/i;
function contextoHorarioDe(hora) {
  const h = Number(hora.slice(0, 2));
  if (h < 11) return 'manhã';
  if (h < 15) return 'hora do almoço';
  if (h < 19) return 'tarde';
  return 'noite';
}
async function aplicarGuardas({ r, base, cen, perfil, perfis, texto, historico, hora }) {
  const guardas = [];
  let resposta = r.texto || '';
  let refeicao = r.refeicao;
  if (!resposta) return { final: null, refeicao, guardas };
  // (1) objetivo trocado: barra e refaz, como em produção; se ainda vier, a frase sai
  const termos = perfil.objetivo ? C.vocabularioErrado(resposta, perfil.objetivo) : [];
  if (termos.length) {
    guardas.push(`objetivo trocado refeito (${termos.join(', ')})`);
    const aviso = `\n\nCONFERÊNCIA DO SISTEMA (feita ANTES de enviar sua resposta anterior, que foi barrada): sua resposta para ${perfil.nome.split(' ')[0]} usou vocabulário do objetivo OPOSTO ao dela(e): ${termos.join(', ')}. O objetivo de ${perfil.nome.split(' ')[0]} é "${perfil.objetivo}". Reescreva sem esses termos. Não mencione esta conferência.`;
    const r3 = await ia.responder({ ...base, ferramentas: null, jaPesquisou: true, conhecimento: aviso }).catch(() => null);
    if (r3?.texto) {
      resposta = r3.texto;
      refeicao = r3.refeicao || refeicao;
    }
    const ainda = C.vocabularioErrado(resposta, perfil.objetivo);
    if (ainda.length) {
      resposta = C.removerFrasesCom(resposta, ainda);
      guardas.push(`frases com objetivo trocado removidas (${ainda.join(', ')})`);
    }
  }
  // (2) plano/pedido com bloco de refeição: bloco sai
  if (parecePedidoOuPlano(texto) && /Refei[cç][aã]o:|O que eu vi/i.test(resposta)) {
    const antes = resposta;
    resposta = resposta
      .split('\n')
      .filter((l) => !/^\s*(?:🕐|⚖️)|Refei[cç][aã]o:\*?\s*(caf[eé]|almo[cç]o|lanche|jantar|ceia)|^\s*\*?Veredito/i.test(l))
      .map((l) => l.replace(/^(\s*🍽️\s*\*?)O que eu vi:?\*?/i, '$1Se for isso:*').replace(/^(\s*🔥\s*\*?)Estimativa:?\*?/i, '$1Ficaria em:*'))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (resposta !== antes) guardas.push('bloco de refeição retirado (plano)');
  }
  // (3) papo curto
  if (C.papoCurto(texto) && !cen.extras?.contestacao) {
    const enxuta = C.enxugarPapo(resposta);
    if (enxuta !== resposta.trim()) {
      resposta = enxuta;
      guardas.push('papo enxugado');
    }
  }
  // (4) repetição do que já foi dito nas últimas 2 h
  {
    const rep = C.removerRepeticoes(resposta, C.respostasRecentes(historico, hora), { textoPessoa: texto });
    if (rep.removidas.length) {
      resposta = rep.texto;
      guardas.push(`repetição removida (${rep.removidas.length})`);
    }
  }
  // (5) bordão repetido, gíria inventada, vocativo no gênero errado
  {
    const b = C.removerBordoesRepetidos(resposta, { historico, persona: PERSONA_TESTE });
    if (b.removidas.length) {
      resposta = b.texto;
      guardas.push('bordão repetido removido');
    }
    const antes = resposta;
    resposta = C.concordarVocativos(C.corrigirGirias(resposta), { genero: perfil.genero, outrosNomes: perfis.filter((p) => p !== perfil).map((p) => p.nome.split(' ')[0]) });
    if (resposta !== antes) guardas.push('gíria/vocativo corrigido');
  }
  return { final: resposta, refeicao, guardas };
}

// ---------- checagens ----------
function checar(cen, { texto, refeicao, usadas, r }) {
  const falhas = [];
  if (texto == null) {
    if (!cen.podeCalar) falhas.push('ficou em silêncio');
    return falhas;
  }
  for (const re of cen.deve || []) if (!re.test(texto)) falhas.push(`faltou ${re}`);
  for (const re of cen.naoDeve || []) {
    const m = texto.match(re);
    if (m) falhas.push(`apareceu ${re} ("${m[0].slice(0, 40)}")`);
  }
  if (cen.maxChars && texto.length > cen.maxChars) falhas.push(`${texto.length} chars (máximo ${cen.maxChars})`);
  if (cen.semBlocoRefeicao && TEM_BLOCO.test(texto)) falhas.push('veio bloco de refeição');
  if (cen.refeicao && !cen.refeicao(refeicao || null)) falhas.push(`linha REFEICAO fora do esperado: ${refeicao ? JSON.stringify(refeicao).slice(0, 160) : 'ausente'}`);
  if (cen.usadas) {
    if (cen.usadas.includes('nenhuma')) {
      if (usadas.length) falhas.push(`usou ferramenta sem precisar: ${usadas.join(', ')}`);
    } else for (const u of cen.usadas) if (!usadas.includes(u)) falhas.push(`não consultou ${u} (usou: ${usadas.join(', ') || 'nada'})`);
  }
  if (cen.perguntaOuIncerteza && !(r.pergunta || ['alta', 'media'].includes(r.incerteza) || /\?/.test(texto))) falhas.push('nem perguntou nem marcou incerteza');
  return falhas;
}

// ---------- execução ----------
const dormir = (ms) => new Promise((res) => setTimeout(res, ms));
const resultados = [];
console.log(`avaliar: ${lista.length} cenário(s) · modelo ${modelo} · dia ${DIA} · chave ${chaveDedicada ? 'dedicada' : 'do .env (produção)'}\n`);
for (const [i, cen] of lista.entries()) {
  const perfil = structuredClone(PERFIS[cen.quem]);
  if (!perfil) {
    console.error(`${cen.id}: perfil "${cen.quem}" não existe`);
    process.exit(2);
  }
  const perfis = ['lucas', 'heitor', 'ale'].map((k) => (k === cen.quem ? perfil : structuredClone(PERFIS[k])));
  if (!['lucas', 'heitor', 'ale'].includes(cen.quem)) perfis.push(perfil);
  const historico = (cen.historico || []).map((m) => ({ ...m }));
  const extras = cen.extras || {};
  const ferramentas = cen.ferramentas ? ferramentasDeMentira(perfil, cen.ferramentas) : null;
  const base = {
    texto: cen.texto,
    perfil,
    perfis,
    historico,
    dia: cen.dia || DIA,
    hora: cen.hora,
    contextoHorario: contextoHorarioDe(cen.hora),
    persona: PERSONA_TESTE,
    conhecimento: '',
    dossie: '',
    momentos: '',
    citacao: null,
    registradas: extras.registradas || '',
    visao: extras.visao || '',
    lembrancas: extras.lembrancas || '',
    agenda: '',
    lugares: extras.lugares || '',
    roteiro: extras.roteiro || '',
    atividades: '',
    treinoHoje: '',
    forca: '',
    jaDito: extras.jaDito || '',
    despensa: '',
    rotulos: null,
    planejando: Boolean(extras.planejando),
    contestacao: Boolean(extras.contestacao),
    emAndamento: extras.emAndamento || null,
    metaConversa: Boolean(extras.metaConversa),
    leve,
    calibracao: '',
  };
  const t0 = Date.now();
  const item = { id: cen.id, categoria: cen.categoria, titulo: cen.titulo, quem: cen.quem, texto: cen.texto, status: 'ok', falhas: [], falhasBruto: [], guardas: [], usadas: [], ms: 0 };
  try {
    const comPrazo = (p) =>
      Promise.race([
        p,
        dormir(TEMPO_MAX_MS).then(() => {
          throw new Error(`tempo esgotado (${TEMPO_MAX_MS / 1000} s)`);
        }),
      ]);
    // como em produção (mensagens.js): se o caminho com ferramentas falhar, a resposta sai pelo caminho normal
    let r;
    if (ferramentas) {
      r = await comPrazo(ia.responder({ ...base, ferramentas, maxRodadas: 2 })).catch((e) => {
        item.guardas.push(`caminho com ferramentas falhou (${String(e?.message || e).slice(0, 80)}); caminho normal`);
        return null;
      });
    }
    if (!r) r = await comPrazo(ia.responder({ ...base, ferramentas: null }));
    const usadas = ferramentas?.usadas || [];
    const { final, refeicao, guardas } = await aplicarGuardas({ r, base, cen, perfil, perfis, texto: cen.texto, historico, hora: cen.hora });
    item.bruto = r.texto;
    item.final = final;
    item.refeicao = refeicao || null;
    item.incerteza = r.incerteza || null;
    item.pergunta = r.pergunta || null;
    item.usadas = [...usadas];
    item.guardas = guardas;
    item.falhas = checar(cen, { texto: final, refeicao, usadas, r });
    item.falhasBruto = checar(cen, { texto: r.texto, refeicao: r.refeicao, usadas, r });
    item.status = item.falhas.length ? 'falhou' : item.falhasBruto.length ? 'ok-pela-guarda' : 'ok';
  } catch (e) {
    item.status = 'erro';
    item.erro = String(e?.message || e).slice(0, 300);
  }
  item.ms = Date.now() - t0;
  resultados.push(item);
  const icone = item.status === 'ok' ? '✅' : item.status === 'ok-pela-guarda' ? '🟡' : item.status === 'erro' ? '⚠️' : '❌';
  const detalhe = item.status === 'erro' ? item.erro : item.falhas.length ? item.falhas.join('; ') : item.status === 'ok-pela-guarda' ? `o modelo errou, a guarda segurou (${item.guardas.join('; ')})` : item.guardas.length ? `guardas: ${item.guardas.join('; ')}` : '';
  console.log(`${icone} ${cen.id} [${cen.categoria}] ${cen.titulo} · ${(item.ms / 1000).toFixed(1)} s${item.usadas.length ? ` · ferramentas: ${item.usadas.join(', ')}` : ''}${detalhe ? `\n     ${detalhe}` : ''}`);
  if (tem('verboso')) console.log(`     bruto: ${String(item.bruto || '(silêncio)').replace(/\n/g, ' ⏎ ').slice(0, 600)}\n`);
  if (i < lista.length - 1) await dormir(PAUSA_MS);
}

// ---------- resumo e relatório ----------
const conta = (s) => resultados.filter((x) => x.status === s).length;
const resumo = { dia: DIA, modelo, total: resultados.length, ok: conta('ok'), okPelaGuarda: conta('ok-pela-guarda'), falharam: conta('falhou'), erros: conta('erro'), ms: resultados.reduce((a, x) => a + x.ms, 0) };
console.log(`\nResultado: ${resumo.ok + resumo.okPelaGuarda}/${resumo.total} passaram (${resumo.okPelaGuarda} só pela guarda em código), ${resumo.falharam} falharam, ${resumo.erros} com erro de chamada · ${(resumo.ms / 1000).toFixed(0)} s`);
const falhos = resultados.filter((x) => x.status === 'falhou');
if (falhos.length) console.log(`Falharam: ${falhos.map((x) => x.id).join(', ')}`);
const pelaGuarda = resultados.filter((x) => x.status === 'ok-pela-guarda');
if (pelaGuarda.length) console.log(`Só pela guarda (o prompt ainda produz isso): ${pelaGuarda.map((x) => `${x.id} (${x.falhasBruto[0]})`).join('; ')}`);

const pasta = join(dirname(fileURLToPath(import.meta.url)), 'relatorios');
mkdirSync(pasta, { recursive: true });
const arquivo = join(pasta, `${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}.json`);
writeFileSync(arquivo, JSON.stringify({ resumo, resultados }, null, 2));
console.log(`Relatório: ${arquivo}`);
process.exit(resumo.falharam && !tem('sem-falhar') ? 1 : 0);
