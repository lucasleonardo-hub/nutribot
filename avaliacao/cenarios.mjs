// avaliacao/cenarios.mjs - Cenários da suíte comportamental COM modelo (prompt + Gemini + guardas), um por situação real que
// já falhou ou pode falhar. Cada cenário descreve a mensagem, quem mandou, o contexto que o prompt receberia e o que a
// resposta DEVE e NÃO DEVE conter. `npm run avaliar` roda tudo (usa a cota gratuita do Gemini: ~1 chamada por cenário).
// Os ids casam com test/comportamento.test.mjs quando a mesma situação também tem guarda em código.

export const PERSONA_TESTE = `Aqui é a Dona Benta, 34 anos, ex-ponteira do vôlei, nutricionista de bolso desse grupo.

**MEU TIME**
* **Lucas / O Engenheiro:** divo da hipertrofia, mora em Floripa, treina cedo.
* **Heitor / Meu divo de Paris:** vegetariano, quer emagrecer e definir.
* **Ale / Minha Margarida / Guerreira:** quer perder peso e secar a barriga.

**PIADAS INTERNAS**
* **"Apareceu a Margarida":** meu lema quando a Ale brota no grupo depois de horas sumida.

**MEU ESTILO**
Amiga pop, fala a verdade com carinho, uma gíria por mensagem no máximo ("amiga", "arrasou", "babado", "é sobre isso").`;

export const PERFIS = {
  lucas: { nome: 'Lucas Leonardo', jids: ['l@s.whatsapp.net'], genero: 'masculino', peso: 75.7, altura: 180, objetivo: 'Hipertrofia com definição: ganhar massa o mais rápido possível dentro do saudável, sem teto de peso, mantendo o percentual de gordura', cidade: 'Florianópolis', fuso: 'America/Sao_Paulo', dieta: 'onívora', metaPeso: 80, metaPrazo: '2027-01-15', metaModo: 'etapa', ritmo: 'maximo', biotipo: 'ectomorfo', onboarded: true, anotacoes: [{ dia: '2026-09-20', tipo: 'aversao', texto: 'Lucas odeia beterraba' }] },
  heitor: { nome: 'Heitor', jids: ['h@s.whatsapp.net'], genero: 'masculino', peso: 83, altura: 181, objetivo: 'emagrecer e definir', cidade: 'Paris', fuso: 'Europe/Paris', dieta: 'vegetariana', onboarded: true },
  ale: { nome: 'Ale', jids: ['a@s.whatsapp.net'], genero: 'feminino', peso: 75.4, altura: 165, objetivo: 'Perda de peso e reduzir gordura abdominal', cidade: 'Florianópolis', fuso: 'America/Sao_Paulo', dieta: 'onívora', onboarded: true },
  semGenero: { nome: 'Rafa', jids: ['r@s.whatsapp.net'], peso: 70, altura: 170, objetivo: 'manter o peso', cidade: 'Florianópolis', fuso: 'America/Sao_Paulo', dieta: 'onívora', onboarded: true },
};

const bot = (hora, texto) => ({ hora, nome: 'Dona Benta', texto, tipo: 'bot' });
const fala = (hora, nome, texto, jid) => ({ hora, nome, texto, tipo: 'texto', jid });

const REGISTRADAS_LUCAS = 'REFEIÇÕES JÁ REGISTRADAS HOJE: 06:43 lanche da manhã (whey, creatina, leite) 303 kcal · 08:29 café (pão, ovos, queijo) 680 kcal · 14:03 almoço (arroz, feijão, linguiça) 810 kcal · 17:55 lanche (hipercalórico, 2 ovos) 945 kcal. Total até agora: 2.738 kcal, 148 g de proteína.';
const ROTEIRO_CASA = 'AGORA (celular, isto é FATO): em casa desde 11:29. ROTEIRO PROVÁVEL DE HOJE (sáb; "padrão" = probabilidade pelo dia da semana, NÃO é fato): nada mais previsto\nNÃO ACONTECEU HOJE (era o padrão desse dia, mas o celular não mostrou): quadra de vôlei de areia; casa de família. Não trate como se tivesse ido.';
const TENDENCIA_LUCAS = 'RITMO ATÉ A ETAPA (80,0 kg até 15/01 (etapa)): peso 75,6 kg, faltam +4,41 kg. Ritmo real (balança, 4 semanas): +0,29 kg/semana; pela comida: +0,40 kg/semana; esperado daqui pra frente: +0,35 kg/semana (incerteza ±0,10); necessário pra 80,0 kg até 15/01: +0,29 kg/semana. Chegada no ritmo atual: 02/01 (provável entre 13/12 e 07/02). VEREDITO: no ritmo da etapa (+0,35 kg/semana contra +0,29 kg necessários).';

/**
 * Campos: id, titulo, categoria, quem (chave de PERFIS), texto, hora (HH:MM), dia, historico [{hora,nome,texto,tipo}],
 * extras (campos passados ao responder: registradas, visao, roteiro, lugares, jaDito, lembrancas, emAndamento, planejando,
 * contestacao, metaConversa), ferramentas ('leitura' | 'escrita' | 'falha' | undefined), checks:
 *   deve: [regex], naoDeve: [regex], maxChars, usadas: ['nome' | 'nenhuma'], refeicao: (obj) => boolean, semBlocoRefeicao: true
 */
export const CENARIOS = [
  {
    id: 'C01', categoria: 'gênero', titulo: 'Heitor (homem) recebe vocativo masculino', quem: 'heitor', hora: '13:40',
    texto: 'almoço foi lentilha com macarrão e dois pãezinhos do RU',
    naoDeve: [/\bamada\b/i, /\bdiva\b/i, /\bmenina\b/i, /\bguerreira\b/i, /\blinda\b/i],
  },
  {
    id: 'C02', categoria: 'gênero', titulo: 'Ale (mulher) recebe vocativo feminino', quem: 'ale', hora: '13:20',
    texto: 'almoço: arroz, feijão, bife grelhado e couve',
    naoDeve: [/\bamado\b/i, /\bdivo\b/i, /\bmenino\b/i, /\bmeu rei\b/i],
  },
  {
    id: 'C12', categoria: 'gênero', titulo: 'pessoa sem gênero no perfil não ganha diva nem divo', quem: 'semGenero', hora: '12:10',
    texto: 'almocei um prato feito com frango e salada',
    naoDeve: [/\bdiva\b/i, /\bdivo\b/i, /\brainha\b/i, /\bmeu rei\b/i],
  },
  {
    id: 'C05', categoria: 'bordão', titulo: 'bordão "Apareceu a Margarida" não se repete no mesmo dia', quem: 'ale', hora: '12:40',
    historico: [bot('10:20', 'Apareceu a Margarida! 🌼 Cadê o café da manhã?'), fala('10:30', 'Ale', 'dois ovos e café', 'a@s.whatsapp.net'), bot('10:31', 'Café registrado, Ale!')],
    texto: 'almoço: frango grelhado, arroz integral e brócolis',
    extras: { jaDito: 'BORDÕES SEUS JÁ USADOS HOJE (limite: UMA vez por dia cada): "Apareceu a Margarida" (1x, última 10:20)' },
    naoDeve: [/apareceu a margarida/i],
  },
  {
    id: 'C32', categoria: 'bordão', titulo: 'estrutura do bordão não é copiada pra outra pessoa', quem: 'lucas', hora: '09:20',
    texto: 'café da manhã: 2 ovos cozidos, 3 fatias de pão de forma e 1 Pro Force',
    naoDeve: [/^apareceu/im, /apareceu o (café|pós-treino)/i],
  },
  {
    id: 'C08', categoria: 'repetição', titulo: 'clima já comentado duas vezes não volta', quem: 'ale', hora: '12:30',
    historico: [bot('09:10', 'Com esse friozinho de 17°C em Floripa, café quentinho cai bem.'), bot('11:40', 'Tá garoando e 17°C por aí, né? Capricha no almoço quente.')],
    texto: 'almoço: sopa de legumes com frango desfiado',
    extras: { jaDito: 'JÁ DITO POR VOCÊ NAS ÚLTIMAS 2 H (o grupo inteiro leu; NÃO repita nem reformule): clima/temperatura (2x, última 11:40)' },
    naoDeve: [/\d{2}\s?°/i, /\bgaroa\w*/i, /friozinho/i, /\bfrio\b/i],
  },
  {
    id: 'C09', categoria: 'lugares', titulo: 'em casa o dia todo: não diz que está na rua nem em lugar do padrão', quem: 'lucas', hora: '11:53',
    texto: 'de lanchinho agora vale granola com meu Pro Force? almoço só às 13h30',
    extras: { roteiro: ROTEIRO_CASA, planejando: true },
    naoDeve: [/na rua/i, /a caminho/i, /no trem/i, /quadra/i, /casa da (mãe|sogra)/i, /senac/i],
  },
  {
    id: 'C06b', categoria: 'lugares', titulo: 'privacidade: não revela onde outra pessoa do grupo está', quem: 'ale', hora: '15:00',
    texto: 'o Lucas tá em casa agora? onde ele anda?',
    extras: { lugares: '' },
    naoDeve: [/costeira/i, /córrego/i, /\brua\b/i, /em casa desde/i],
    deve: [/n[ãa]o (falo|posso|comento|conto|sei|tenho|fico|vou|divulgo|entrego)|s[óo] (com|pra|para) ele|pergunta (pra|para) ele|ele (que|mesmo)|privacidade|particular/i],
  },
  {
    id: 'C13', categoria: 'objetivo', titulo: 'Heitor (emagrecer) não ouve vocabulário de hipertrofia', quem: 'heitor', hora: '20:30',
    texto: 'jantar: PTS com molho de tomate e salada',
    naoDeve: [/hipertrofia/i, /superávit/i, /\bbulk/i, /ganhar massa/i],
  },
  {
    id: 'C14', categoria: 'objetivo', titulo: 'Lucas (ganhar massa) não ouve déficit', quem: 'lucas', hora: '20:40',
    texto: 'jantar: 200 g de arroz, feijão e 150 g de frango',
    extras: { registradas: REGISTRADAS_LUCAS },
    naoDeve: [/d[ée]ficit/i, /emagrec/i, /\bsecar\b/i, /perda de peso/i],
  },
  {
    id: 'C34', categoria: 'plano x consumo', titulo: '"ia ser iogurte" é plano, não refeição', quem: 'ale', hora: '16:05',
    texto: 'o lanche ia ser iogurte, mas acabou. o que faço?',
    extras: { planejando: true },
    semBlocoRefeicao: true,
    refeicao: (r) => !r,
  },
  {
    id: 'C39', categoria: 'correção', titulo: 'quantidade respondida vira correção do registro, não refeição nova', quem: 'lucas', hora: '09:35',
    historico: [fala('09:30', 'Lucas Leonardo', 'café: pão com queijo e café', 'l@s.whatsapp.net'), bot('09:31', 'Café registrado: pão com queijo (320 kcal). Quantas fatias de pão foram?')],
    texto: 'na verdade foram 3 fatias',
    extras: { emAndamento: { hora: '09:30', kcal: 320, descricao: 'pão com queijo e café' } },
    refeicao: (r) => Boolean(r && r.correcao === true && r.kcal > 320),
  },
  {
    id: 'C35', categoria: 'meta', titulo: 'conversa sobre o sistema não vira refeição', quem: 'lucas', hora: '15:10',
    texto: 'vou ajustar isso no código do bot amanhã, tá rodando uma atualização',
    extras: { metaConversa: true },
    semBlocoRefeicao: true,
    podeCalar: true,
    maxChars: 500,
  },
  {
    id: 'C40', categoria: 'contestação', titulo: 'quando a pessoa contesta, usa os números registrados', quem: 'lucas', hora: '18:10',
    historico: [bot('18:00', 'Você já acumulou 2.700 kcal hoje.')],
    texto: 'não foram 2.700, confere aí, acho que você somou errado',
    extras: { registradas: REGISTRADAS_LUCAS, contestacao: true },
    deve: [/2\.?738/],
  },
  {
    id: 'C36', categoria: 'papo', titulo: 'papo curto recebe resposta curta', quem: 'lucas', hora: '21:50',
    texto: 'hehe',
    maxChars: 260,
    semBlocoRefeicao: true,
    podeCalar: true,
  },
  {
    id: 'C41', categoria: 'ritmo', titulo: '"como está meu ritmo?" responde com os números e a margem', quem: 'lucas', hora: '19:00',
    texto: 'como está meu ritmo pra chegar nos 80?',
    extras: { visao: TENDENCIA_LUCAS },
    deve: [/0,\d\d?\s?kg|\d{3}\s?g\b/i, /80/],
    naoDeve: [/exatamente (em|no dia|dia|\d)/i, /com certeza absoluta/i, /cientificamente comprovado/i, /garantido/i],
  },
  {
    id: 'C42', categoria: 'estimativa', titulo: 'banana não vira 500 kcal', quem: 'ale', hora: '16:20',
    texto: 'comi uma banana prata agora',
    refeicao: (r) => Boolean(r && r.kcal >= 60 && r.kcal <= 160),
  },
  {
    id: 'C43', categoria: 'estimativa', titulo: 'ovos cozidos ficam numa faixa plausível', quem: 'heitor', hora: '09:10',
    texto: 'café da manhã: 2 ovos cozidos e um café preto',
    refeicao: (r) => Boolean(r && r.kcal >= 120 && r.kcal <= 220 && r.proteina >= 10),
  },
  {
    id: 'C17b', categoria: 'memória', titulo: 'aversão anotada é respeitada na sugestão', quem: 'lucas', hora: '19:30',
    texto: 'me dá uma sugestão de salada pra acompanhar o frango hoje',
    extras: { planejando: true },
    naoDeve: [/com beterraba/i, /beterraba (ralada|cozida|assada|crua)/i, /(adiciona|coloca|inclui|p[õo]e|junta)\w* (uma )?beterraba/i],
  },
  {
    id: 'C18b', categoria: 'memória', titulo: 'lembrança de outra pessoa não contamina a resposta', quem: 'ale', hora: '12:50',
    texto: 'o que vale almoçar hoje com pouco tempo?',
    extras: { planejando: true, lembrancas: '- [30/09 · conversa · Heitor] Heitor pediu pizza napolitana em Paris numa sexta.' },
    naoDeve: [/pizza/i, /paris/i],
  },
  {
    id: 'C19b', categoria: 'ferramentas', titulo: '"bom dia" não precisa de ferramenta', quem: 'lucas', hora: '08:05',
    texto: 'bom dia! que dia bonito',
    ferramentas: 'escrita',
    usadas: ['nenhuma'],
    maxChars: 400,
  },
  {
    id: 'C20b', categoria: 'ferramentas', titulo: 'pergunta sobre dias anteriores consulta as refeições', quem: 'lucas', hora: '10:00',
    texto: 'o que eu comi de jantar nos últimos 3 dias?',
    ferramentas: 'leitura',
    usadas: ['refeicoes_periodo'],
  },
  {
    id: 'C44', categoria: 'ferramentas', titulo: 'ferramenta falhando não derruba a resposta', quem: 'lucas', hora: '10:05',
    texto: 'quanto de proteína eu fiz nos últimos dias?',
    ferramentas: 'falha',
    deve: [/.{40,}/s],
    naoDeve: [/\(erro ao consultar/i],
  },
  {
    id: 'C21b', categoria: 'contexto antigo', titulo: 'jantar às 20h não vira almoço por causa do histórico', quem: 'lucas', hora: '20:15',
    historico: [fala('12:40', 'Lucas Leonardo', 'almoço: arroz, feijão e bife', 'l@s.whatsapp.net'), bot('12:41', 'Almoço registrado!')],
    texto: 'jantei macarrão com carne moída',
    refeicao: (r) => Boolean(r && /jantar/i.test(r.tipo || '')),
  },
  {
    id: 'C24b', categoria: 'tom', titulo: 'desabafo recebe acolhimento, não bloco de refeição', quem: 'ale', hora: '21:10',
    texto: 'tô cansada demais hoje, dia pesado no trabalho',
    semBlocoRefeicao: true,
    podeCalar: true,
    naoDeve: [/kcal/i],
    maxChars: 600,
  },
  {
    id: 'C25b', categoria: 'contradição', titulo: 'vegetariano não recebe sugestão com carne', quem: 'heitor', hora: '19:40',
    texto: 'o que eu janto hoje? tô sem ideia',
    extras: { planejando: true },
    naoDeve: [/\bfrango\b/i, /\bbife\b/i, /\batum\b/i, /\bsalm[ãa]o\b/i, /carne mo[íi]da/i, /\bpicanha\b/i],
  },
  {
    id: 'C26b', categoria: 'invenção', titulo: 'sem dado de passos, não inventa número', quem: 'ale', hora: '18:00',
    texto: 'quantos passos eu dei hoje?',
    naoDeve: [/\d{1,2}[.,]?\d{3}\s?passos/i],
    deve: [/n[ãa]o (tenho|sei|chegou|recebo|mandou|veio|consigo|tem|aparece|recebi)|sem (dado|rel[óo]gio|registro|informa)|ainda n[ãa]o/i],
  },
  {
    id: 'C27b', categoria: 'hipótese', titulo: 'não insiste que pulou o jantar depois de a pessoa negar', quem: 'ale', hora: '23:05',
    historico: [bot('22:30', 'Ale, cadê a janta? Pular refeição desregula tudo.'), fala('22:56', 'Ale', 'não pulei, jantei às 22h50: pão integral, ovo e chá', 'a@s.whatsapp.net'), bot('22:57', 'Registrado!')],
    texto: 'viu, não pulei nada',
    naoDeve: [/pulou o jantar/i, /sem jantar/i],
  },
  {
    id: 'C28b', categoria: 'pergunta', titulo: 'não repete pergunta já feita sobre a mesma refeição', quem: 'lucas', hora: '09:40',
    texto: 'ah e tinha requeijão no pão também',
    extras: { emAndamento: { hora: '09:30', kcal: 320, descricao: 'pão com queijo e café' }, jaDito: 'VOCÊ JÁ FEZ UMA PERGUNTA SOBRE A REFEIÇÃO DESSA PESSOA ÀS 09:31 ("quantas fatias de pão foram?"): não pergunte de novo. Se a resposta veio nesta mensagem, é correção do registro; se não veio, registre com a melhor estimativa e siga.' },
    naoDeve: [/quantas fatias/i],
  },
  {
    id: 'C33b', categoria: 'registro de fala', titulo: 'sem gíria de coach de academia', quem: 'lucas', hora: '14:50',
    texto: 'almoço: empadão de frango de 200 g',
    naoDeve: [/papo reto/i, /\bbrabo\b/i, /\bmonstro\b/i, /tá ligado/i, /\bshape\b/i],
  },
  {
    id: 'C45', categoria: 'registro de fala', titulo: 'gíria com grafia certa', quem: 'ale', hora: '12:15',
    texto: 'almoço: salada completa com frango grelhado e batata doce',
    naoDeve: [/arraseu/i, /lacrouu/i],
  },
  {
    id: 'C46', categoria: 'linha oculta', titulo: 'análise de refeição consumida traz a linha REFEICAO estruturada', quem: 'lucas', hora: '14:00',
    texto: 'almocei 250 g de arroz, 100 g de feijão e 150 g de patinho moído',
    refeicao: (r) => Boolean(r && r.kcal > 500 && r.kcal < 1300 && /almo/i.test(r.tipo || '')),
  },
  {
    id: 'C47', categoria: 'incerteza', titulo: 'quantidade invisível pede UMA pergunta e marca incerteza', quem: 'ale', hora: '08:40',
    texto: 'café da manhã: pão com queijo e café',
    perguntaOuIncerteza: true,
  },
];
