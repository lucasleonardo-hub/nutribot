// ferramentas.js - Ferramentas de LEITURA que a IA chama sozinha (function calling do Gemini) enquanto monta um documento:
// plano da semana e investigação antes do pensamento particular. Fase 1: só leitura, nenhuma ação; a conversa do grupo
// segue em uma chamada só. Cada ferramenta embrulha uma função que já existe no código e devolve texto curto (teto por
// ferramenta), porque o resultado volta pro modelo como contexto. Nunca lança: erro vira texto "(erro ...)".
import { refeicoesDesde, pesagensDesde, colecao, salvarPerfil, registrarPesagem } from './mongo.js';
import { guardarLembranca } from './memoria_semantica.js';
import { aplicarAtualizacao } from './perfis.js';
import { padraoAlimentar, semanaDoPlano } from './resumo.js';
import { semanaTipica, contextoLugares, mercadosProximos } from './lugares.js';
import { agendaDe, blocoAgenda } from './agenda.js';
import { analiseForca, blocoTreinoRefeicoes } from './contexto.js';
import { blocoDespensa } from './despensa.js';
import { docsPara } from './conhecimento.js';
import { lembrancasPara } from './memoria_semantica.js';
import { linhaDeTendencia } from './previsao.js';
import { tendenciaCompleta } from './tendencia.js';
import { progressoDe } from './acompanhamento.js';
import { diasDeComida, somarDias } from './progresso.js';
import { treinoDe, temHevy } from './treino.js';
import { ehDonoDaAgenda } from './agenda.js';
import { horariosHabituais, diasAnteriores, fusoDe } from './util.js';

const TETO_CHARS = 7000;
// a ferramenta pesagens junta o PROGRESSO inteiro, a lista de pesagens e a linha de tendência de 120 dias: com 7.000 a
// lista e o fim da tendência eram cortados (revisão de 09/10)
const TETO_POR_FERRAMENTA = { pesagens: 10000 };
const NOME_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const corta = (t, n = TETO_CHARS) => {
  const s = String(t ?? '').trim();
  if (!s) return '(nada encontrado)';
  return s.length > n ? `${s.slice(0, n)}\n[...cortado]` : s;
};
const inteiro = (v, min, max, padrao) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao;
};

/** Semana (segunda a domingo) que contém `dia`, no mesmo formato de semanaDoPlano. */
export function semanaAtual(dia) {
  const base = new Date(`${dia}T12:00:00Z`);
  const seg = new Date(base);
  seg.setUTCDate(seg.getUTCDate() - ((base.getUTCDay() + 6) % 7));
  const dias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(seg);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const nome = NOME_DIA[d.getUTCDay()];
    return { dia: iso, nome, rotulo: `${nome[0].toUpperCase()}${nome.slice(1)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` };
  });
  return { inicio: dias[0].dia, fim: dias[6].dia, dias, proximaSemana: false };
}

// Declarações no formato do Gemini (functionDeclarations). Sem `parameters` quando a ferramenta não recebe nada.
const DECLARACOES = [
  {
    name: 'refeicoes_periodo',
    description: 'O que a pessoa registrou de comida nos últimos N dias: dia, hora, refeição, descrição, kcal e proteína. Use pra ver padrão real, horários e o que ela come em dia de treino, vôlei ou aula.',
    parameters: { type: 'OBJECT', properties: { dias: { type: 'INTEGER', description: 'quantos dias pra trás (1 a 60; padrão 14)' } } },
  },
  {
    name: 'padrao_alimentar',
    description: 'Resumo do padrão alimentar da pessoa num período: quais refeições faz, horários e o que costuma comer em cada uma.',
    parameters: { type: 'OBJECT', properties: { dias: { type: 'INTEGER', description: '7 a 60; padrão 28' } } },
  },
  {
    name: 'agenda',
    description: 'Compromissos da agenda da pessoa (aula, trabalho, reunião, viagem) nos próximos N dias, com janelas livres.',
    parameters: { type: 'OBJECT', properties: { dias: { type: 'INTEGER', description: '1 a 14; padrão 7' } } },
  },
  {
    name: 'semana_tipica',
    description: 'Por dia da semana: onde a pessoa costuma estar (lugares aprendidos pelo celular, atividades fixas, agenda) e, pra cada refeição que ela registra, se cai em casa, fora de casa (onde) ou em cima de treino.',
    parameters: { type: 'OBJECT', properties: { semana: { type: 'STRING', description: '"proxima" (a semana do plano) ou "atual"' } } },
  },
  { name: 'lugares', description: 'Lugares que a pessoa frequenta (casa, trabalho, faculdade, academia, restaurantes) com o padrão de dias e horários, e onde ela está agora.' },
  { name: 'treino_forca', description: 'Treinos de força do Hevy (exercícios, cargas, progressão, platôs), a leitura de força x recuperação (sono, comida, massa magra) e o que ela comeu antes e depois do treino de hoje.' },
  {
    name: 'relogio',
    description: 'Dados do relógio por dia nos últimos N dias: passos, gasto calórico, batimento de repouso, sono (total, profundo, REM) e treinos detectados.',
    parameters: { type: 'OBJECT', properties: { dias: { type: 'INTEGER', description: '1 a 30; padrão 7' } } },
  },
  {
    name: 'pesagens',
    description: 'Progresso de peso com as contas abertas (período, pesagens, tendência com intervalo de confiança, alvo, veredito, comida registrada x balança, meta de calorias calibrada pela balança, alertas e limites) + linha de tendência completa (pesagens e bioimpedância por semana cruzadas com comida, gasto do relógio, treinos e sono; projeção semana a semana até a etapa e data de chegada). Peça sempre que a conversa for de ritmo, progresso, meta, etapa ou peso.',
    parameters: { type: 'OBJECT', properties: { dias: { type: 'INTEGER', description: 'quantos dias de pesagens listar no fim (7 a 120; padrão 42)' } } },
  },
  { name: 'despensa', description: 'O que a pessoa tem em casa (despensa alimentada pelas notas fiscais), com quantidades e validades.' },
  {
    name: 'conhecimento',
    description: 'Sua base de conhecimento técnico (nutrição, treino, suplementos, sono, recuperação) por assunto. Diga o assunto em poucas palavras.',
    parameters: { type: 'OBJECT', properties: { consulta: { type: 'STRING', description: 'assunto, ex.: "pré-treino carboidrato", "creatina saturação", "proteína em déficit"' } }, required: ['consulta'] },
  },
  {
    name: 'lembrancas',
    description: 'Memória de longo prazo das conversas do grupo (o que a pessoa disse, preferências, aversões, episódios), por semelhança com uma consulta.',
    parameters: { type: 'OBJECT', properties: { consulta: { type: 'STRING', description: 'o que você quer lembrar, em uma frase' } }, required: ['consulta'] },
  },
  { name: 'mercados_perto', description: 'Mercados, feiras e padarias perto dos lugares da pessoa (casa, trabalho, faculdade).' },
  { name: 'reflexao', description: 'Como você entende essa pessoa: sua reflexão de domingo, as hipóteses abertas com os sinais da semana e seu último pensamento particular.' },
];

// Ações (fase 3, só as aditivas e seguras): guardar fato de longo prazo e atualizar o perfil. Registro de refeição continua
// pela linha oculta REFEICAO, que é o coração do bot e tem suas próprias guardas.
const DECLARACOES_ESCRITA = [
  {
    name: 'anotar_memoria',
    description: 'Guarda na memória de longo prazo UM fato que vale lembrar em outros dias: preferência ou aversão recorrente, alergia/restrição, rotina fixa, meta ou combinado, contexto de vida duradouro. NÃO use pra coisa de hoje (o que comeu, onde está, como dormiu), nem pra dado que já está no perfil (peso, objetivo, cidade). Se não tiver certeza de que vale daqui a 30 dias, não guarde.',
    parameters: { type: 'OBJECT', properties: { texto: { type: 'STRING', description: 'o fato em uma frase, começando pelo nome da pessoa' }, tipo: { type: 'STRING', description: 'preferencia | aversao | restricao | rotina | combinado | contexto' }, validade: { type: 'STRING', description: '"longa" (meses) ou "temporaria" (dias; não é guardada)' } }, required: ['texto', 'tipo'] },
  },
  {
    name: 'atualizar_perfil',
    description: 'Atualiza no perfil um dado que a pessoa ACABOU de informar: peso_kg, altura_cm, objetivo, cidade, dieta, restricoes, genero (masculino|feminino|outro), meta_peso_kg, meta_prazo (AAAA-MM-DD), ritmo (maximo|medio|minimo), meta_modo (etapa|final), biotipo. Só com dado dito pela própria pessoa; nunca por dedução.',
    parameters: { type: 'OBJECT', properties: { peso_kg: { type: 'NUMBER' }, altura_cm: { type: 'NUMBER' }, objetivo: { type: 'STRING' }, cidade: { type: 'STRING' }, dieta: { type: 'STRING' }, restricoes: { type: 'STRING' }, genero: { type: 'STRING' }, meta_peso_kg: { type: 'NUMBER' }, meta_prazo: { type: 'STRING' }, ritmo: { type: 'STRING' }, meta_modo: { type: 'STRING' }, biotipo: { type: 'STRING' } } },
  },
];
const normTexto = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const palavrasDe = (t) => new Set(normTexto(t).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const parecidos = (a, b) => {
  const A = palavrasDe(a);
  const B = palavrasDe(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.6;
};

/**
 * Ferramentas pra UMA pessoa. Devolve { declaracoes, executar(nome, args), usadas }.
 * `apenas` restringe a lista (nomes); `escrita` inclui as ações (true = anotar_memoria e atualizar_perfil; 'anotar' = só anotar_memoria). Os executores são
 * preguiçosos: nada é consultado até o modelo pedir.
 */
export function ferramentasPara(perfil, { dia, apenas = null, escrita = false } = {}) {
  const fuso = fusoDe(perfil);
  const jids = perfil?.jids || [];
  const usadas = [];
  const exec = {
    async refeicoes_periodo({ dias } = {}) {
      const n = inteiro(dias, 1, 60, 14);
      // busca ao menos 28 dias: o dia completo usa a mediana dos 28 dias da pessoa (critério único do !progresso e da meta
      // adaptativa); a lista e os totais mostram só os n dias pedidos
      const desde = diasAnteriores(dia, n)[0];
      const todas = await refeicoesDesde(jids, diasAnteriores(dia, Math.max(n, 29))[0]);
      const refs = todas.filter((r) => r.dia >= desde);
      if (!refs.length) return `(nenhuma refeição registrada nos últimos ${n} dias)`;
      const linhas = refs
        .slice(-120)
        .map((r) => {
          const kcal = Number(r.estimativa?.kcal ?? r.kcal) || 0;
          const prot = Number(r.estimativa?.p ?? r.proteina) || 0;
          return `${r.dia} ${r.horaLocal || r.hora || ''} [${r.slot || '?'}] ${r.descricao || r.resumo || ''}${kcal ? ` (${Math.round(kcal)} kcal${prot ? `, P ${Math.round(prot)} g` : ''})` : ''}`;
        });
      // totais por dia já somados, com o dia completo marcado (critério único): sem isso a IA somava a lista cortada nas 120
      // últimas e dividia pelo período inteiro, e a média saía baixa
      const c = diasDeComida(todas, { dia: somarDias(dia, 1), de: desde, medianaRef: diasDeComida(todas, { dia, de: somarDias(dia, -28) }).mediana });
      const totais = c.dias.map((x) => `${x.dia}${x.dia === dia ? ' (hoje, em andamento)' : ''}: ${Math.round(x.kcal)} kcal, P ${Math.round(x.p)} g, ${x.n} registro(s)${x.completo ? '' : ' (incompleto: fora das médias)'}`);
      const completosFechados = c.completos.filter((x) => x.dia < dia);
      const media = completosFechados.length ? Math.round(completosFechados.reduce((a, x) => a + x.kcal, 0) / completosFechados.length) : null;
      return `TOTAIS POR DIA (${n} dias; média dos ${completosFechados.length} dias completos fechados: ${media != null ? `${media} kcal/dia` : 'sem dias completos'}):\n${totais.join('\n')}\n\n${refs.length} refeições em ${n} dias (${linhas.length < refs.length ? 'as últimas 120' : 'todas'}):\n${linhas.join('\n')}`;
    },
    async padrao_alimentar({ dias } = {}) {
      const n = inteiro(dias, 7, 60, 28);
      const refs = await refeicoesDesde(jids, diasAnteriores(dia, n)[0]);
      return padraoAlimentar(refs, { periodoDias: n })?.texto || '(sem registros suficientes)';
    },
    async agenda({ dias } = {}) {
      const n = inteiro(dias, 1, 14, 7);
      const ag = await agendaDe(perfil, { dias: n });
      if (!ag) return '(essa pessoa não tem agenda ligada)';
      return blocoAgenda(ag.lista, { perfil, dias: n }) || `(sem compromissos nos próximos ${n} dias)`;
    },
    async semana_tipica({ semana } = {}) {
      const sem = /atual/i.test(String(semana || '')) ? semanaAtual(dia) : semanaDoPlano(dia);
      const refs = await refeicoesDesde(jids, diasAnteriores(dia, 60)[0]);
      const padrao = padraoAlimentar(refs.filter((r) => r.dia >= diasAnteriores(dia, 28)[0]), { periodoDias: 28 });
      const agendaSemana = await agendaDe(perfil, { dias: 14 }).catch(() => null);
      return semanaTipica({ perfil, semana: sem, hab: horariosHabituais(refs), slots: padrao?.slots ? Object.keys(padrao.slots) : [], agenda: agendaSemana?.lista || [], fuso }) || '(sem lugares aprendidos ainda)';
    },
    async lugares() {
      if (!perfil?.lugaresAtivo) return '(essa pessoa não ligou a localização)';
      const ctx = await contextoLugares(perfil).catch(() => null);
      const lista = (perfil.lugares || [])
        .filter((l) => l.visitas >= 2 || l.papel || l.manual)
        .slice(0, 15)
        .map((l) => `- ${l.papel || l.tipo || 'lugar'}${l.nome ? ` ${l.nome}` : ''}: ${l.padrao || 'sem padrão'}`);
      return [ctx?.bloco || '', lista.length ? `LUGARES COM PADRÃO:\n${lista.join('\n')}` : ''].filter(Boolean).join('\n\n') || '(sem lugares ainda)';
    },
    async treino_forca() {
      const [forca, treino, hoje] = await Promise.all([
        analiseForca(perfil, dia).catch(() => null),
        treinoDe(perfil, dia, { sincronizar: false }).catch(() => null),
        blocoTreinoRefeicoes(perfil, dia).catch(() => ''),
      ]);
      return [treino?.bloco || '', forca?.texto || '', hoje].filter(Boolean).join('\n\n') || '(sem treino de força registrado)';
    },
    async relogio({ dias } = {}) {
      const n = inteiro(dias, 1, 30, 7);
      const d = jids[0] ? await colecao('saude_relogio').findOne({ _id: jids[0] }).catch(() => null) : null;
      if (!d) return '(essa pessoa não tem relógio ligado)';
      const desde = diasAnteriores(dia, n)[0];
      const hm = (min) => (min == null ? '?' : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`);
      const sonos = new Map((d.sonos || []).filter((s) => s.dia >= desde).map((s) => [s.dia, s]));
      const ats = (d.atividades || []).filter((a) => a.dia >= desde);
      const diasTodos = [...new Set([...ats.map((a) => a.dia), ...sonos.keys()])].sort();
      const linhas = diasTodos.map((x) => {
        const a = ats.find((y) => y.dia === x);
        const s = sonos.get(x);
        return (
          `${x}${x === dia ? ' (hoje, parcial: o relógio ainda está somando)' : ''}: ${a?.passos ? `${a.passos} passos` : 'passos ?'} · ${a?.calorias ? `gasto ${a.calorias} kcal` : 'gasto ?'}` +
          (a?.fcRepouso ? ` · repouso ${a.fcRepouso} bpm` : '') +
          (s ? ` · sono ${hm(s.total)} (profundo ${hm(s.profundo)}, REM ${hm(s.rem)})` : '') +
          (a?.treinos?.length ? ` · treinos: ${a.treinos.map((t) => `${t.nome} ${t.hora}${t.min ? ` ${t.min} min` : ''}${t.kcal ? ` ${Math.round(t.kcal)} kcal` : ''}`).join(', ')}` : '')
        );
      });
      return linhas.length ? `RELÓGIO, últimos ${n} dias (último envio ${d.ultimoEnvio || '?'}):\n${linhas.join('\n')}` : `(sem dados do relógio nos últimos ${n} dias)`;
    },
    async pesagens({ dias } = {}) {
      const n = inteiro(dias, 7, 120, 42);
      const pes = await pesagensDesde(jids, diasAnteriores(dia, n)[0]);
      // o PROGRESSO (veredito, comida x balança, meta calibrada, alertas) é o mesmo do prompt e do !progresso; sem pesagem nos
      // últimos N dias ele e a linha de 120 dias ainda valem (antes a ferramenta devolvia só "sem pesagens" e a tendência sumia)
      const [analise, completa] = await Promise.all([progressoDe(perfil, dia).catch(() => null), tendenciaCompleta(perfil, dia).catch(() => null)]);
      const tend = completa || (pes.length ? linhaDeTendencia({ pesagens: pes, perfil, dia, semanas: 6 }) : null);
      const ult = [...pes]
        .sort((a, b) => a.dia.localeCompare(b.dia))
        .slice(-12)
        .map((p) => `${p.dia}: ${p.peso} kg${p.gordura != null ? ` · gordura ${p.gordura}%` : ''}${p.magra != null ? ` · magra ${p.magra} kg` : ''}`);
      // a lista curta vem antes da linha de tendência (a parte mais longa): se o teto cortar, corta o fim da tendência
      return [analise?.tendencia?.n ? analise.texto : '', ult.length ? `ÚLTIMAS PESAGENS:\n${ult.join('\n')}` : `(sem pesagens nos últimos ${n} dias)`, tend?.texto || ''].filter(Boolean).join('\n\n');
    },
    async despensa() {
      return (await blocoDespensa(perfil)) || '(despensa vazia ou sem notas)';
    },
    async conhecimento({ consulta } = {}) {
      return docsPara(perfil, { texto: String(consulta || '') }) || '(nada na base sobre isso)';
    },
    async lembrancas({ consulta } = {}) {
      return (await lembrancasPara({ consulta: String(consulta || ''), pessoa: perfil?.nome, limite: 6 })) || '(nenhuma lembrança parecida)';
    },
    async mercados_perto() {
      return (await mercadosProximos(perfil)) || '(sem mercados mapeados perto dos lugares dela)';
    },
    async anotar_memoria({ texto, tipo, validade } = {}) {
      const t = String(texto || '').trim();
      if (/tempor/i.test(String(validade || ''))) return '(não guardei: coisa temporária não vai pra memória de longo prazo)';
      if (t.length < 15) return '(não guardei: texto curto demais)';
      const anteriores = perfil?.anotacoes || [];
      if (anteriores.some((a) => parecidos(a.texto, t))) return '(já estava anotado; nada a fazer)';
      const item = { dia, tipo: String(tipo || 'contexto').toLowerCase().slice(0, 20), texto: t.slice(0, 240) };
      const anotacoes = [...anteriores.slice(-19), item];
      await salvarPerfil({ jids: perfil.jids, anotacoes });
      perfil.anotacoes = anotacoes; // a mesma conversa já enxerga
      await guardarLembranca({ chave: `anotacao:${jids[0] || perfil.nome}:${Date.now()}`, tipo: 'anotacao', pessoa: perfil.nome, dia, texto: `${item.texto} (anotado por você em ${dia}; ${item.tipo})` }).catch(() => false);
      return `anotado (${item.tipo}): ${item.texto}`;
    },
    async atualizar_perfil(args = {}) {
      const novo = aplicarAtualizacao(perfil, args || {}, dia);
      const campos = novo ? Object.keys(novo).filter((k) => !['jids', 'atualizacoes'].includes(k)) : [];
      if (!campos.length) return '(nada válido pra atualizar: valor fora do permitido ou igual ao que já está)';
      await salvarPerfil(novo);
      Object.assign(perfil, novo);
      if (novo.peso && jids[0]) registrarPesagem({ jid: jids[0], nome: perfil.nome, dia, peso: novo.peso }).catch(() => {});
      return `perfil atualizado: ${campos.map((k) => `${k}=${JSON.stringify(novo[k])}`).join(', ')}`;
    },
    async reflexao() {
      const abertas = (perfil?.hipoteses || []).filter((h) => h.status === 'aberta');
      return (
        [
          perfil?.reflexao?.sintese ? `SÍNTESE: ${perfil.reflexao.sintese}` : '',
          abertas.length
            ? `HIPÓTESES ABERTAS:\n${abertas.map((h) => `- ${h.texto}${h.sinais?.length ? ` (sinais: ${h.sinais.map((s) => `${String(s.dia || '').slice(5)} ${s.direcao === 'a_favor' ? '+' : '−'} ${s.evidencia}`).join('; ')})` : ''}`).join('\n')}`
            : '',
          perfil?.pensamento?.texto ? `ÚLTIMO PENSAMENTO (${perfil.pensamento.dia} ${perfil.pensamento.hora}): ${perfil.pensamento.texto}` : '',
        ]
          .filter(Boolean)
          .join('\n\n') || '(ainda sem reflexão sobre essa pessoa)'
      );
    },
  };
  // só o que a pessoa tem: sem relógio não há `relogio`; sem localização não há lugares/semana típica/mercados; sem Hevy não há
  // treino_forca; agenda só do dono. (Heitor e Ale chamavam relogio e pesagens toda vez e recebiam "não tem".)
  const temRelogio = Boolean(perfil?.relogio && Object.keys(perfil.relogio.gastos || {}).length);
  const disponivel = (nome) => {
    if (nome === 'relogio') return temRelogio;
    if (nome === 'lugares' || nome === 'semana_tipica' || nome === 'mercados_perto') return Boolean(perfil?.lugaresAtivo);
    if (nome === 'treino_forca') return Boolean(temHevy(perfil) || perfil?.treino);
    if (nome === 'agenda') return Boolean(ehDonoDaAgenda(perfil));
    return true;
  };
  // escrita: true = anotar_memoria + atualizar_perfil (conversa, onde a pessoa acabou de falar); 'anotar' = só anotar_memoria
  // (investigação antes do pensamento: não há fala nova, então perfil não se mexe por inferência)
  const base = escrita ? [...DECLARACOES, ...DECLARACOES_ESCRITA.filter((d) => escrita === true || d.name === 'anotar_memoria')] : DECLARACOES;
  const declaracoes = base.filter((d) => (!apenas || apenas.includes(d.name)) && disponivel(d.name));
  async function executar(nome, args = {}) {
    const fn = exec[nome];
    if (!fn || !declaracoes.some((d) => d.name === nome)) return `(ferramenta desconhecida: ${nome})`;
    const t0 = Date.now();
    try {
      const saida = corta(await fn(args || {}), TETO_POR_FERRAMENTA[nome] || TETO_CHARS);
      usadas.push(nome);
      console.log(`[ferramentas] ${String(perfil?.nome || '').split(' ')[0]}: ${nome}(${JSON.stringify(args || {})}) -> ${(saida.length / 1000).toFixed(1)}k chars em ${Date.now() - t0} ms`);
      return saida;
    } catch (e) {
      console.warn(`[ferramentas] ${nome} falhou:`, e.message);
      return `(erro ao consultar ${nome}: ${String(e.message).slice(0, 120)}; não chame de novo, responda com o que já tem e sem citar o erro)`;
    }
  }
  return { declaracoes, executar, usadas };
}
