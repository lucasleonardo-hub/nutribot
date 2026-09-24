// graficos.js - Gráficos como imagem (PNG) via QuickChart (serviço gratuito que renderiza Chart.js), sem dependência nativa.
// Peso e calorias dos últimos 30 dias por pessoa, com a faixa da meta quando houver. Vai no !grafico e no resumo de domingo.

const URL = process.env.QUICKCHART_URL || 'https://quickchart.io/chart';
const TIMEOUT_MS = 20_000;

const diasAte = (dia, n) => {
  const base = new Date(`${dia}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
};
const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Configuração Chart.js (v2) do gráfico de período de uma pessoa. Pura, testável.
 * @param {object} p { nome, refeicoes, pesagens, gastos, alvo: {min,max}|null, dia, dias = 30 }
 */
export function configGrafico({ nome, refeicoes = [], pesagens = [], gastos, alvo, dia, dias = 30 }) {
  const eixo = diasAte(dia, dias);
  const kcalPorDia = new Map();
  const protPorDia = new Map();
  for (const r of refeicoes) {
    if (!r.estimativa?.kcal || !eixo.includes(r.dia)) continue;
    kcalPorDia.set(r.dia, (kcalPorDia.get(r.dia) || 0) + r.estimativa.kcal);
    protPorDia.set(r.dia, (protPorDia.get(r.dia) || 0) + (r.estimativa.p || 0));
  }
  const pesoPorDia = new Map(pesagens.filter((p) => p.peso && eixo.includes(p.dia)).map((p) => [p.dia, p.peso]));
  const temPeso = pesoPorDia.size > 0;
  const temGasto = gastos && eixo.some((d) => gastos[d]);
  const datasets = [
    { type: 'bar', label: 'Calorias comidas', yAxisID: 'kcal', backgroundColor: 'rgba(52, 152, 219, 0.75)', data: eixo.map((d) => (kcalPorDia.has(d) ? Math.round(kcalPorDia.get(d)) : null)) },
  ];
  if (temGasto) datasets.push({ type: 'line', label: 'Gasto (relógio)', yAxisID: 'kcal', borderColor: 'rgba(231, 76, 60, 0.9)', backgroundColor: 'transparent', pointRadius: 2, borderWidth: 2, spanGaps: true, data: eixo.map((d) => gastos[d] || null) });
  if (alvo) {
    datasets.push({ type: 'line', label: 'Meta (mín)', yAxisID: 'kcal', borderColor: 'rgba(39, 174, 96, 0.8)', backgroundColor: 'transparent', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, data: eixo.map(() => alvo.min) });
    datasets.push({ type: 'line', label: 'Meta (máx)', yAxisID: 'kcal', borderColor: 'rgba(39, 174, 96, 0.8)', backgroundColor: 'rgba(39, 174, 96, 0.10)', fill: '-1', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, data: eixo.map(() => alvo.max) });
  }
  if (temPeso) datasets.push({ type: 'line', label: 'Peso (kg)', yAxisID: 'peso', borderColor: 'rgba(142, 68, 173, 1)', backgroundColor: 'transparent', pointRadius: 3, borderWidth: 2, spanGaps: true, data: eixo.map((d) => pesoPorDia.get(d) ?? null) });
  const pesos = [...pesoPorDia.values()];
  const eixos = [{ id: 'kcal', position: 'left', ticks: { beginAtZero: true }, scaleLabel: { display: true, labelString: 'kcal / dia' } }];
  if (temPeso) eixos.push({ id: 'peso', position: 'right', gridLines: { drawOnChartArea: false }, ticks: { suggestedMin: Math.floor(Math.min(...pesos) - 1.5), suggestedMax: Math.ceil(Math.max(...pesos) + 1.5) }, scaleLabel: { display: true, labelString: 'kg' } });
  const diasComRegistro = kcalPorDia.size;
  const mediaProt = diasComRegistro ? Math.round([...protPorDia.values()].reduce((a, b) => a + b, 0) / diasComRegistro) : 0;
  return {
    type: 'bar',
    data: { labels: eixo.map((d, i) => (i % 3 === 0 || i === eixo.length - 1 ? dm(d) : '')), datasets },
    options: {
      title: { display: true, text: `${nome.split(' ')[0]} · últimos ${dias} dias · ${diasComRegistro} dias com registro · proteína média ${mediaProt} g/dia`, fontSize: 16 },
      legend: { position: 'bottom' },
      scales: { xAxes: [{ gridLines: { display: false } }], yAxes: eixos },
      plugins: { datalabels: { display: false } },
    },
  };
}

/** Renderiza o PNG (Buffer). Devolve null se o serviço falhar; nunca lança. */
export async function renderizar(config, { largura = 1000, altura = 520 } = {}) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: config, width: largura, height: altura, backgroundColor: 'white', format: 'png', version: '2' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('imagem vazia');
    return buf;
  } catch (e) {
    console.error('[graficos] falha ao renderizar:', e.message);
    return null;
  }
}
