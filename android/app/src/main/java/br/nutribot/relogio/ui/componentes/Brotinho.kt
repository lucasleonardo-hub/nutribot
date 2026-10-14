package br.nutribot.relogio.ui.componentes

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento

private fun caminho(d: String): Path = PathParser().parsePathString(d).toPath()

/** Desenho do vaso, com as mesmas formas do Brotinho.dc.html (viewBox 128 x 150). */
private class FormasBroto(murcho: Boolean) {
    val caule = caminho(if (murcho) "M64 104 C64 88 68 76 80 72" else "M64 104 C64 86 64 68 64 50")
    val folhaE = caminho(if (murcho) "M66 86 C54 90 44 98 42 106 C52 106 62 98 66 86Z" else "M64 78 C49 76 38 63 40 50 C55 52 64 63 64 78Z")
    val folhaD = caminho(if (murcho) "M78 74 C88 80 94 90 92 100 C82 96 76 86 78 74Z" else "M64 70 C79 66 90 53 88 40 C73 42 64 53 64 70Z")
    val brilho = caminho(if (murcho) "M58 92 C54 95 50 98 48 101" else "M50 58 C54 62 58 66 60 70 M80 48 C76 52 72 57 69 62")
    val broto = caminho("M64 50 C57 42 57 32 64 25 C71 32 71 42 64 50Z")
    val brotoBrilho = caminho("M62 44 C60 39 60 34 63 30")
    val vaso = caminho("M38 104 L90 104 L84 138 Q64 146 44 138 Z")
    val estrela1 = caminho("M100 40 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z")
    val estrela2 = caminho("M22 56 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z")
    val folhas = if (murcho) listOf(Color(0xFFF3EBC8), Color(0xFFD5C58E), Color(0xFFA8955E)) else listOf(Color(0xFFD2F7DF), Color(0xFF7DD3A8), Color(0xFF3E9B6A))
}

private fun DrawScope.gradienteFolha(p: Path, cores: List<Color>): Brush {
    val b = p.getBounds()
    return Brush.radialGradient(
        0f to cores[0], 0.6f to cores[1], 1f to cores[2],
        center = Offset(b.left + b.width * 0.3f, b.top + b.height * 0.25f),
        radius = maxOf(b.width, b.height) * 0.95f,
    )
}

/**
 * Brotinho com Caju e Lia: cresce com os dias de registro; murcho = Lia triste e Caju dormindo.
 * dias >= 20 vira festa (os dois comemorando).
 * escala < 1 encolhe o desenho (0,37 cabe num quadrado de 56 dp); soVaso = só a planta, sem os mascotes (cabeçalho do cartão).
 */
@Composable
fun Brotinho(dias: Int, murcho: Boolean, modifier: Modifier = Modifier, escala: Float = 1f, soVaso: Boolean = false) {
    val festa = !murcho && dias >= 20
    val formas = remember(murcho) { FormasBroto(murcho) }
    val parado = LocalReduzirMovimento.current
    val t = if (parado) null else rememberInfiniteTransition(label = "brotinho")
    val giro = t?.animateFloat(-3f, 3f, infiniteRepeatable(tween(2000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "balanca")
    val gota = t?.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "gota")
    val brilho = t?.animateFloat(0.2f, 1f, infiniteRepeatable(tween(1000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "brilho")
    val rotulo = if (murcho) "Brotinho murcho no vaso; Caju e Lia cansados" else "Brotinho verde no vaso, $dias dias regado"
    Row(modifier.semantics(mergeDescendants = true) { contentDescription = rotulo }, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        if (!murcho && !soVaso) Mascote(Pose.CorgiFesta, 112.dp * escala, descricao = false)
        Canvas(Modifier.size(128.dp * escala, 150.dp * escala)) {
            val g = giro?.value ?: 0f
            val fase = gota?.value ?: 0.5f
            val br = brilho?.value ?: 1f
            scale(size.width / 128f, size.height / 150f, pivot = Offset.Zero) {
                // sombra
                drawOval(Color(0x59B9A08A), topLeft = Offset(30f, 139f), size = Size(68f, 10f))
                // planta balançando a partir da base do caule
                rotate(if (murcho) 0f else g, pivot = Offset(64f, 104f)) {
                    drawPath(formas.caule, Color(0xFF5DB884), style = Stroke(6f, cap = StrokeCap.Round))
                    drawPath(formas.folhaE, gradienteFolha(formas.folhaE, formas.folhas))
                    drawPath(formas.folhaD, gradienteFolha(formas.folhaD, formas.folhas))
                    drawPath(formas.brilho, Color.White.copy(alpha = 0.55f), style = Stroke(2.5f, cap = StrokeCap.Round))
                    if (!murcho) {
                        drawPath(formas.broto, gradienteFolha(formas.broto, formas.folhas))
                        drawPath(formas.brotoBrilho, Color.White.copy(alpha = 0.6f), style = Stroke(2f, cap = StrokeCap.Round))
                    }
                }
                // vaso
                val bv = formas.vaso.getBounds()
                drawPath(formas.vaso, Brush.radialGradient(0f to Color(0xFFFFE2D8), 0.55f to Color(0xFFFFB8A3), 1f to Color(0xFFE58F79), center = Offset(bv.left + bv.width * 0.32f, bv.top + bv.height * 0.25f), radius = bv.width * 0.95f))
                drawOval(Brush.radialGradient(listOf(Color(0xFFFFF0EA), Color(0xFFF4B3A2)), center = Offset(58f, 98f), radius = 40f), topLeft = Offset(36f, 96f), size = Size(56f, 16f))
                drawOval(Brush.radialGradient(listOf(Color(0xFFA57A5B), Color(0xFF6E4B35)), center = Offset(64f, 102f), radius = 20f), topLeft = Offset(42f, 100f), size = Size(44f, 10f))
                drawOval(Color.White.copy(alpha = 0.38f), topLeft = Offset(45.5f, 107f), size = Size(9f, 22f))
                if (!murcho) {
                    // gotas caindo (três, defasadas) e brilhos piscando
                    listOf(Triple(50f, 20f, 0f), Triple(64f, 12f, 0.33f), Triple(78f, 18f, 0.66f)).forEach { (x, y, d) ->
                        val f = (fase + d) % 1f
                        val a = if (f < 0.2f) f / 0.2f else 1f - (f - 0.2f) / 0.8f
                        drawOval(Color(0xFF9BD2FF).copy(alpha = a.coerceIn(0f, 1f)), topLeft = Offset(x - 3f, y - 4.2f - 6f + 36f * f), size = Size(6f, 8.4f))
                    }
                    drawPath(formas.estrela1, Color(0xFFFFD166).copy(alpha = br))
                    drawPath(formas.estrela2, Color(0xFFFFB0C0).copy(alpha = 1.2f - br))
                }
            }
        }
        if (soVaso) return@Row
        if (murcho) {
            Mascote(Pose.LontraTriste, 92.dp * escala, descricao = false)
            Mascote(Pose.CorgiDormindo, 62.dp * escala, descricao = false)
        } else {
            Mascote(if (festa) Pose.LontraTrofeu else Pose.LontraComendo, 112.dp * escala, descricao = false)
        }
    }
}
