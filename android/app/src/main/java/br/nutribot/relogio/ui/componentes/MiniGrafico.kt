package br.nutribot.relogio.ui.componentes

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas

/*
 * Mini-gráfico (fase 4, Resumos): um cartão pequeno com título, um número-resumo e um Canvas de ~90 dp.
 * Barras (kcal, sono, passos) ou linha com pontos (peso); uma faixa opcional (a meta de kcal) por trás.
 * Dia sem dado = buraco (null), nunca zero.
 */

enum class ModoGrafico { Barras, Linha }

@Composable
fun MiniGrafico(
    titulo: String,
    resumo: String,
    valores: List<Double?>,
    modo: ModoGrafico,
    cor: Color,
    modifier: Modifier = Modifier,
    faixa: Pair<Double, Double>? = null,
    corFaixa: Color = Cores.MetaVerde,
    altura: Dp = 90.dp,
    descricao: String = "$titulo: $resumo",
    atraso: Int = 0,
) {
    val f = animaAte(1f, 900, atraso)
    Cartao(modifier, forma = Formas.Cartao, padding = PaddingValues(12.dp), atraso = atraso) {
        Text(titulo, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(resumo, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Canvas(Modifier.fillMaxWidth().height(altura).padding(top = 6.dp).semantics { contentDescription = descricao }) {
            val n = valores.size
            if (n == 0) return@Canvas
            val presentes = valores.filterNotNull()
            if (presentes.isEmpty() && faixa == null) return@Canvas
            // escala: barras partem do zero; a linha enquadra só o que há (com 8% de folga)
            var lo = if (modo == ModoGrafico.Barras) 0.0 else (presentes.minOrNull() ?: 0.0)
            var hi = presentes.maxOrNull() ?: 0.0
            if (faixa != null) { lo = minOf(lo, faixa.first); hi = maxOf(hi, faixa.second) }
            if (modo == ModoGrafico.Linha) { val folga = (hi - lo).coerceAtLeast(0.5) * 0.08; lo -= folga; hi += folga }
            if (hi <= lo) hi = lo + 1.0
            fun y(v: Double): Float = (size.height - ((v - lo) / (hi - lo)).toFloat() * size.height).coerceIn(0f, size.height)
            val passo = size.width / n
            if (faixa != null) {
                val topo = y(faixa.second)
                drawRect(corFaixa, Offset(0f, topo), Size(size.width, (y(faixa.first) - topo).coerceAtLeast(1f)))
            }
            when (modo) {
                ModoGrafico.Barras -> {
                    val larg = (passo * 0.62f).coerceAtLeast(2f)
                    valores.forEachIndexed { i, v ->
                        if (v == null) return@forEachIndexed
                        val h = (size.height - y(v)) * f
                        drawRoundRect(cor, Offset(i * passo + (passo - larg) / 2, size.height - h), Size(larg, h), CornerRadius(larg / 2.5f))
                    }
                }
                ModoGrafico.Linha -> {
                    val pontos = valores.mapIndexedNotNull { i, v -> v?.let { Offset(i * passo + passo / 2, y(it)) } }
                    if (pontos.size >= 2) {
                        val caminho = Path().apply { moveTo(pontos[0].x, pontos[0].y); pontos.drop(1).forEach { lineTo(it.x, it.y) } }
                        drawPath(caminho, cor, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round), alpha = f)
                    }
                    val r = (passo * 0.22f).coerceIn(2.dp.toPx(), 4.dp.toPx())
                    pontos.forEach { p -> drawCircle(Cores.Branco, r + 1.5f, p, alpha = f); drawCircle(cor, r, p, alpha = f) }
                }
            }
        }
    }
}
