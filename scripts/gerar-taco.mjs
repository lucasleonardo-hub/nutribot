// scripts/gerar-taco.mjs - Gera dados/taco.json a partir do CSV normalizado da TACO (4ª ed., NEPA/UNICAMP),
// publicado em https://github.com/brolesi/taco (data/processed/taco/taco_composicao.csv).
// Uso: node scripts/gerar-taco.mjs [caminho/do/taco_composicao.csv]   (sem caminho: baixa do GitHub)
// Saída: dados/taco.json = { alimentos: [{ id, nome, kcal, p, c, g, fibra }], apelidos: { "arroz": id, ... }, extras: [...] }
// Valores por 100 g. Os apelidos ligam o jeito que o grupo fala ("sobrecoxa", "pão de forma") ao item da TACO.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_CSV = 'https://raw.githubusercontent.com/brolesi/taco/main/data/processed/taco/taco_composicao.csv';

// apelido (como as pessoas escrevem) -> regex do nome na TACO (o primeiro que casar vence). Ordem: do específico pro genérico.
const APELIDOS = [
  ['arroz integral', /^Arroz, integral, cozido/],
  ['arroz', /^Arroz, tipo 1, cozido/],
  ['feijão preto', /^Feijão, preto, cozido/],
  ['feijão carioca', /^Feijão, carioca, cozido/],
  ['feijão branco', /^Feijão, (branco|rajado), cozido/],
  ['feijão fradinho', /^Feijão, fradinho, cozido/],
  ['feijão', /^Feijão, carioca, cozido/],
  ['feijoada', /^Feijoada/],
  ['lentilha', /^Lentilha, cozida/],
  ['ervilha', /^Ervilha, enlatada, drenada/],
  ['peito de frango', /^Frango, peito, sem pele, grelhado/],
  ['filé de frango', /^Frango, peito, sem pele, grelhado/],
  ['frango grelhado', /^Frango, peito, sem pele, grelhado/],
  ['frango desfiado', /^Frango, peito, sem pele, cozido/],
  ['sobrecoxa', /^Frango, sobrecoxa, com pele, assada/],
  ['coxa de frango', /^Frango, coxa, com pele, assada/],
  ['asa de frango', /^Frango, asa, com pele, crua|^Frango, asa/],
  ['frango', /^Frango, peito, sem pele, grelhado/],
  ['picanha', /^Carne, bovina, picanha, com gordura, grelhada/],
  ['carne moída', /^Carne, bovina, acém, moído, cozido/],
  ['alcatra', /^Carne, bovina, patinho, sem gordura, grelhado/], // TACO não traz alcatra grelhada; patinho é o corte magro mais próximo
  ['patinho', /^Carne, bovina, patinho, sem gordura, grelhado/],
  ['contra filé', /^Carne, bovina, contra-filé, sem gordura, grelhado/],
  ['maminha', /^Carne, bovina, maminha, .*grelhada/],
  ['costela', /^Carne, bovina, costela, assada/],
  ['fígado', /^Carne, bovina, fígado, grelhado/],
  ['bisteca', /^Porco, bisteca, grelhada/],
  ['lombo', /^Porco, lombo, assado/],
  ['pernil', /^Porco, pernil, assado/],
  ['carne de porco', /^Porco, lombo, assado/],
  ['costela de porco', /^Porco, costela, assada/],
  ['carne', /^Carne, bovina, patinho, sem gordura, grelhado/],
  ['hambúrguer', /^Hambúrguer, bovino, grelhado/],
  ['linguiça', /^Ling[üu]i[çc]a, porco, frita|^Ling[üu]i[çc]a, frango, frita/],
  ['linguiça de frango', /^Ling[üu]i[çc]a, frango, frita|^Ling[üu]i[çc]a, frango, grelhada/],
  ['bacon', /^Toucinho, frito|^Toucinho/],
  ['presunto', /^Presunto, com capa de gordura|^Presunto/],
  ['mortadela', /^Mortadela/],
  ['ovo frito', /^Ovo, de galinha, inteiro, frito/],
  ['ovos fritos', /^Ovo, de galinha, inteiro, frito/],
  ['ovo mexido', /^Ovo, de galinha, inteiro, frito/],
  ['ovos mexidos', /^Ovo, de galinha, inteiro, frito/],
  ['omelete', /^Omelete, de queijo|^Omelete/],
  ['ovo', /^Ovo, de galinha, inteiro, cozido/],
  ['ovos', /^Ovo, de galinha, inteiro, cozido/],
  ['clara de ovo', /^Ovo, de galinha, clara, cozida/],
  ['pão francês', /^Pão, trigo, francês/],
  ['pãozinho', /^Pão, trigo, francês/],
  ['pão integral', /^Pão, trigo, forma, integral/],
  ['pão de forma integral', /^Pão, trigo, forma, integral/],
  ['pão de queijo', /^Pão, de queijo, assado|^Pão, de queijo/],
  ['pão', /^Pão, trigo, francês/],
  ['torrada', /^Torrada, pão francês|^Torrada/],
  ['queijo muçarela', /^Queijo, mozarela/],
  ['mussarela', /^Queijo, mozarela/],
  ['muçarela', /^Queijo, mozarela/],
  ['mozarela', /^Queijo, mozarela/],
  ['queijo prato', /^Queijo, prato/],
  ['queijo minas', /^Queijo, minas, frescal/],
  ['queijo branco', /^Queijo, minas, frescal/],
  ['ricota', /^Queijo, ricota/],
  ['cottage', /^Queijo, cottage|^Queijo, ricota/],
  ['parmesão', /^Queijo, parmesão/],
  ['queijo', /^Queijo, mozarela/],
  ['requeijão', /^Queijo, requeijão, cremoso/],
  ['margarina', /^Margarina, com sal, 80%|^Margarina, com sal|^Margarina/],
  ['manteiga', /^Manteiga, com sal/],
  ['azeite', /^Azeite, de oliva/],
  ['óleo', /^Óleo, de soja/],
  ['maionese', /^Maionese, tradicional|^Maionese/],
  ['leite em pó', /^Leite, de vaca, integral, pó/],
  ['iogurte desnatado', /^Iogurte, natural, desnatado/],
  ['iogurte zero', /^Iogurte, natural, desnatado/],
  ['iogurte natural', /^Iogurte, natural$|^Iogurte, natural,? ?(?!desnatado)/],
  ['iogurte', /^Iogurte, natural$|^Iogurte, natural,? ?(?!desnatado)/],
  ['banana nanica', /^Banana, nanica, crua/],
  ['banana', /^Banana, prata, crua/],
  ['bananas', /^Banana, prata, crua/],
  ['maçã', /^Maçã, Fuji, com casca, crua/],
  ['laranja', /^Laranja, p[êe]ra, crua/],
  ['tangerina', /^Tangerina, Poncã, crua/],
  ['bergamota', /^Tangerina, Poncã, crua/],
  ['mexerica', /^Tangerina, Poncã, crua/],
  ['mamão', /^Mamão, Formosa, cru/],
  ['abacate', /^Abacate, cru/],
  ['abacaxi', /^Abacaxi, cru/],
  ['morango', /^Morango, cru/],
  ['uva', /^Uva, Itália, crua/],
  ['melancia', /^Melancia, crua/],
  ['melão', /^Melão, cru/],
  ['manga', /^Manga, Palmer, crua/],
  ['goiaba', /^Goiaba, vermelha, com casca, crua/],
  ['pera', /^P[êe]ra, Williams, crua|^P[êe]ra/],
  ['kiwi', /^Kiwi, cru/],
  ['batata doce', /^Batata, doce, cozida/],
  ['batata frita', /^Batata, inglesa, frita/],
  ['purê de batata', /^Batata, inglesa, cozida/],
  ['batata', /^Batata, inglesa, cozida/],
  ['mandioca', /^Mandioca, cozida/],
  ['aipim', /^Mandioca, cozida/],
  ['macaxeira', /^Mandioca, cozida/],
  ['inhame', /^Inhame, cru/], // TACO só traz cru; cozido perde pouco
  ['macarrão instantâneo', /^Macarrão, instantâneo/],
  ['miojo', /^Macarrão, instantâneo/],
  ['lasanha', /^Lasanha, massa fresca, cozida/],
  ['nhoque', /^Nhoque, batata, cozido/],
  ['aveia', /^Aveia, flocos, crua/],
  ['tapioca', /^Tapioca, com manteiga|^Polvilho, doce/],
  ['cuscuz', /^Cuscuz, de milho, cozido com sal|^Cuscuz, de milho/],
  ['farofa', /^Farofa, de mandioca|^Farinha, de mandioca, torrada/],
  ['farinha de mandioca', /^Farinha, de mandioca, torrada/],
  ['polenta', /^Polenta, cozida|^Polenta/],
  ['milho', /^Milho, verde, enlatado, drenado/],
  ['alface', /^Alface, crespa, crua/],
  ['tomate', /^Tomate, com semente, cru/],
  ['cenoura', /^Cenoura, crua/],
  ['brócolis', /^Brócolis, cozido/],
  ['couve', /^Couve, manteiga, refogada/],
  ['repolho', /^Repolho, roxo, cru/],
  ['repolho roxo', /^Repolho, roxo, cru/],
  ['beterraba', /^Beterraba, crua/],
  ['abobrinha', /^Abobrinha, italiana, cozida/],
  ['abóbora', /^Abóbora, cabotian, cozida/],
  ['berinjela', /^Berinjela, cozida/],
  ['pepino', /^Pepino, cru/],
  ['cebola', /^Cebola, crua/],
  ['agrião', /^Agrião, cru/],
  ['rúcula', /^Rúcula, crua/],
  ['espinafre', /^Espinafre, Nova Zelândia, refogado|^Espinafre/],
  ['tofu', /^Soja, queijo \(tofu\)/],
  ['amendoim', /^Amendoim, torrado, salgado/],
  ['pasta de amendoim', /^Amendoim, torrado, salgado/],
  ['castanha de caju', /^Castanha-de-caju, torrada, salgada/],
  ['castanha do pará', /^Castanha-do-Brasil, crua/],
  ['castanha', /^Castanha-de-caju, torrada, salgada/],
  ['paçoca', /^Paçoca, amendoim/],
  ['chocolate', /^Chocolate, ao leite/],
  ['achocolatado', /^Achocolatado, pó/],
  ['refrigerante', /^Refrigerante, tipo cola/],
  ['coca', /^Refrigerante, tipo cola/],
  ['cerveja', /^Cerveja, pilsen/],
  ['suco de laranja', /^Laranja, p[êe]ra, suco/],
  ['café', /^Café, infusão/],
  ['açúcar', /^Açúcar, refinado/],
  ['mel', /^Mel, de abelha/],
  ['atum', /^Atum, conserva em óleo/],
  ['salmão', /^Salmão, filé, .*grelhado|^Salmão, .*grelhado|^Salmão/],
  ['sardinha', /^Sardinha, conserva em óleo/],
  ['camarão', /^Camarão, .*cozido|^Camarão/],
  ['merluza', /^Merluza, filé, .*assado|^Merluza/],
  ['peixe', /^Pescada, filé, .*frito|^Merluza, filé|^Tilápia/],
  ['coxinha', /^Coxinha de frango, frita|^Salgado, coxinha|coxinha/i],
  ['empanado', /^Frango, filé, à milanesa/],
  ['frango à milanesa', /^Frango, filé, à milanesa/],
  ['pastel', /^Pastel, de carne, frito|^Pastel/],
  ['quibe', /^Quibe, frito|^Quibe/],
  ['pipoca', /^Pipoca, com óleo de soja, sem sal|^Pipoca/],
  ['biscoito', /^Biscoito, salgado, cream cracker/],
  ['bolacha', /^Biscoito, salgado, cream cracker/],
  ['cookie', /^Biscoito, doce, recheado com chocolate/],
  ['biscoito recheado', /^Biscoito, doce, recheado com chocolate/],
  ['bolo', /^Bolo, pronto, chocolate/],
  ['doce de leite', /^Doce, de leite, cremoso/],
  ['brigadeiro', /^Brigadeiro|^Doce, de leite, cremoso/],
];

// Não estão na TACO: valores típicos de rótulo (por 100 g). Marcados como "rótulo típico".
const EXTRAS = [
  { id: 'x-whey', nome: 'Whey protein concentrado (rótulo típico)', kcal: 400, p: 78, c: 8, g: 6, fibra: 0, porcao: { scoop: 30, dose: 30 } },
  { id: 'x-whey-isolado', nome: 'Whey protein isolado (rótulo típico)', kcal: 370, p: 88, c: 3, g: 1, fibra: 0, porcao: { scoop: 30, dose: 30 } },
  { id: 'x-hipercalorico', nome: 'Hipercalórico em pó (rótulo típico)', kcal: 380, p: 15, c: 72, g: 4, fibra: 1, porcao: { dose: 100, scoop: 50 } },
  { id: 'x-creatina', nome: 'Creatina (não tem caloria relevante)', kcal: 0, p: 0, c: 0, g: 0, fibra: 0, porcao: { dose: 5 } },
  { id: 'x-hommus', nome: 'Hommus (rótulo típico)', kcal: 180, p: 7, c: 15, g: 10, fibra: 5, porcao: { colher: 30 } },
  { id: 'x-presunto-vegetal', nome: 'Presunto vegetariano (rótulo típico)', kcal: 130, p: 15, c: 6, g: 5, fibra: 2, porcao: { fatia: 20 } },
  { id: 'x-linguica-vegetal', nome: 'Linguiça vegetariana (rótulo típico)', kcal: 200, p: 16, c: 8, g: 12, fibra: 3, porcao: { unidade: 50 } },
  { id: 'x-nuggets-vegetal', nome: 'Nuggets vegetais (rótulo típico)', kcal: 220, p: 12, c: 20, g: 10, fibra: 3, porcao: { unidade: 20 } },
  { id: 'x-falafel', nome: 'Falafel frito (rótulo típico)', kcal: 330, p: 13, c: 32, g: 18, fibra: 5, porcao: { unidade: 25 } },
  { id: 'x-power', nome: 'Bebida láctea proteica tipo Power (rótulo típico, por 100 ml)', kcal: 55, p: 6, c: 6, g: 1, fibra: 0, porcao: { garrafa: 250, unidade: 250 } },
  { id: 'x-pao-batata-doce', nome: 'Pão de batata doce (rótulo típico)', kcal: 250, p: 8, c: 45, g: 4, fibra: 3, porcao: { fatia: 30, unidade: 60 } },
  { id: 'x-calzone', nome: 'Calzone de frango de lanchonete (estimativa)', kcal: 260, p: 12, c: 30, g: 10, fibra: 1, porcao: { unidade: 180 } },
  // A TACO não tem leite fluido com valores (linhas vazias), nem massa cozida, pão de forma branco, grão-de-bico cozido etc.
  { id: 'x-leite-integral', nome: 'Leite integral (rótulo típico, por 100 ml)', kcal: 61, p: 3.2, c: 4.7, g: 3.2, fibra: 0, porcao: { copo: 200, xicara: 200, ml: 1 } },
  { id: 'x-leite-desnatado', nome: 'Leite desnatado (rótulo típico, por 100 ml)', kcal: 35, p: 3.4, c: 4.9, g: 0.2, fibra: 0, porcao: { copo: 200, xicara: 200, ml: 1 } },
  { id: 'x-macarrao-cozido', nome: 'Macarrão cozido (referência USDA)', kcal: 140, p: 5, c: 28, g: 1, fibra: 1.5, porcao: { pegador: 110, colher: 30 } },
  { id: 'x-pao-forma', nome: 'Pão de forma branco (rótulo típico)', kcal: 270, p: 8, c: 50, g: 3.5, fibra: 2.5, porcao: { fatia: 25, unidade: 25 } },
  { id: 'x-grao-de-bico', nome: 'Grão-de-bico cozido (referência USDA)', kcal: 164, p: 8.9, c: 27, g: 2.6, fibra: 7.6, porcao: { concha: 120, colher: 20 } },
  { id: 'x-pts', nome: 'Proteína texturizada de soja hidratada (rótulo típico)', kcal: 100, p: 16, c: 8, g: 0.5, fibra: 4, porcao: { colher: 30 } },
  { id: 'x-nuggets', nome: 'Nuggets de frango (rótulo típico)', kcal: 250, p: 14, c: 15, g: 15, fibra: 1, porcao: { unidade: 20 } },
  { id: 'x-pizza', nome: 'Pizza de muçarela (referência)', kcal: 270, p: 11, c: 30, g: 12, fibra: 1.5, porcao: { fatia: 120, pedaco: 120 } },
  { id: 'x-esfiha', nome: 'Esfiha de carne (referência)', kcal: 250, p: 9, c: 30, g: 10, fibra: 1, porcao: { unidade: 80 } },
  { id: 'x-sorvete', nome: 'Sorvete de massa (referência)', kcal: 200, p: 3.5, c: 24, g: 10, fibra: 0, porcao: { bola: 60, unidade: 60 } },
  { id: 'x-pudim', nome: 'Pudim de leite (referência)', kcal: 150, p: 4, c: 25, g: 4, fibra: 0, porcao: { fatia: 100 } },
  { id: 'x-granola', nome: 'Granola (rótulo típico)', kcal: 430, p: 10, c: 65, g: 15, fibra: 6, porcao: { colher: 15 } },
  { id: 'x-cachorro-quente', nome: 'Cachorro-quente completo (referência)', kcal: 260, p: 9, c: 25, g: 14, fibra: 1, porcao: { unidade: 200 } },
  { id: 'x-tilapia', nome: 'Tilápia grelhada (referência USDA)', kcal: 128, p: 26, c: 0, g: 2.7, fibra: 0, porcao: { file: 120, unidade: 120 } },
  { id: 'x-salsicha', nome: 'Salsicha (rótulo típico)', kcal: 250, p: 12, c: 3, g: 21, fibra: 0, porcao: { unidade: 50 } },
  { id: 'x-queijo-coalho', nome: 'Queijo coalho (rótulo típico)', kcal: 320, p: 22, c: 2, g: 25, fibra: 0, porcao: { fatia: 30, espeto: 80 } },
];
const APELIDOS_EXTRAS = [
  ['whey isolado', 'x-whey-isolado'], ['whey', 'x-whey'], ['hipercalórico', 'x-hipercalorico'], ['hipercalorico', 'x-hipercalorico'], ['creatina', 'x-creatina'],
  ['hommus', 'x-hommus'], ['homus', 'x-hommus'], ['presunto vegetariano', 'x-presunto-vegetal'], ['presunto vegetal', 'x-presunto-vegetal'],
  ['linguiça vegetariana', 'x-linguica-vegetal'], ['linguiças vegetarianas', 'x-linguica-vegetal'], ['nuggets vegetais', 'x-nuggets-vegetal'], ['nugget vegetal', 'x-nuggets-vegetal'],
  ['falafel', 'x-falafel'], ['power', 'x-power'], ['pão de batata doce', 'x-pao-batata-doce'], ['calzone', 'x-calzone'],
  ['leite desnatado', 'x-leite-desnatado'], ['leite integral', 'x-leite-integral'], ['leite', 'x-leite-integral'],
  ['macarrão', 'x-macarrao-cozido'], ['espaguete', 'x-macarrao-cozido'], ['massa', 'x-macarrao-cozido'], ['penne', 'x-macarrao-cozido'],
  ['pão de forma', 'x-pao-forma'], ['pão de fôrma', 'x-pao-forma'], ['pão branco', 'x-pao-forma'],
  ['grão de bico', 'x-grao-de-bico'], ['grão-de-bico', 'x-grao-de-bico'], ['proteína de soja', 'x-pts'], ['proteína texturizada', 'x-pts'], ['proteína vegetal texturizada', 'x-pts'],
  ['nuggets', 'x-nuggets'], ['nugget', 'x-nuggets'], ['pizza', 'x-pizza'], ['esfiha', 'x-esfiha'], ['esfirra', 'x-esfiha'], ['sorvete', 'x-sorvete'], ['pudim', 'x-pudim'],
  ['granola', 'x-granola'], ['cachorro quente', 'x-cachorro-quente'], ['cachorro-quente', 'x-cachorro-quente'], ['tilápia', 'x-tilapia'], ['salsicha', 'x-salsicha'], ['queijo coalho', 'x-queijo-coalho'],
];

function parseCsv(texto) {
  const linhas = [];
  let campo = '';
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ',') { linha.push(campo); campo = ''; }
    else if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (ch !== '\r') campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const cab = linhas[0];
  return linhas.slice(1).filter((l) => l.length === cab.length).map((l) => Object.fromEntries(cab.map((c, i) => [c, l[i]])));
}

const n1 = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Math.round(Number(v) * 10) / 10);

async function main() {
  const caminho = process.argv[2];
  const csv = caminho ? fs.readFileSync(caminho, 'utf8') : await (await fetch(URL_CSV)).text();
  const linhas = parseCsv(csv);
  const alimentos = linhas.map((r) => ({
    id: Number(r.numero_alimento),
    nome: r.descricao.trim(),
    kcal: n1(r.energia_kcal),
    p: n1(r.proteina_g),
    c: n1(r.carboidrato_g),
    g: n1(r.lipideos_g),
    fibra: n1(r.fibra_g),
  }));
  const apelidos = {};
  const faltando = [];
  for (const [apelido, re] of APELIDOS) {
    const achado = alimentos.find((a) => re.test(a.nome.trim()) && a.kcal > 0);
    if (achado) apelidos[apelido] = achado.id;
    else faltando.push(apelido);
  }
  for (const [apelido, id] of APELIDOS_EXTRAS) apelidos[apelido] = id;
  const saida = { fonte: 'TACO 4ª ed. (NEPA/UNICAMP) via github.com/brolesi/taco; extras = rótulos típicos', geradoEm: new Date().toISOString().slice(0, 10), alimentos, extras: EXTRAS, apelidos };
  fs.mkdirSync(path.join(RAIZ, 'dados'), { recursive: true });
  fs.writeFileSync(path.join(RAIZ, 'dados', 'taco.json'), JSON.stringify(saida));
  console.log(`dados/taco.json: ${alimentos.length} alimentos, ${Object.keys(apelidos).length} apelidos, ${EXTRAS.length} extras`);
  if (faltando.length) console.log('apelidos SEM item na TACO (ficam de fora):', faltando.join(', '));
  for (const [apelido, id] of Object.entries(apelidos).slice(0, 400)) {
    const a = alimentos.find((x) => x.id === id) || EXTRAS.find((x) => x.id === id);
    console.log(`  ${apelido.padEnd(24)} -> ${a.nome} (${a.kcal} kcal/100 g)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
