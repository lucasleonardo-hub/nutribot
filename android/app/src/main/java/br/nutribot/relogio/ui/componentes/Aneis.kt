package br.nutribot.relogio.ui.componentes

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.tema.Atkinson
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Fredoka
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento

private val Suave = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/** Anima de 0 até o alvo ao abrir (o anel enche); fica parado com "remover animações". */
@Composable
fun animaAte(alvo: Float, duracao: Int = 1100, atraso: Int = 0): Float {
    val parado = LocalReduzirMovimento.current
    val a = remember { Animatable(if (parado) alvo else 0f) }
    LaunchedEffect(alvo) {
        if (parado) a.snapTo(alvo) else a.animateTo(alvo, tween(duracao, delayMillis = atraso, easing = Suave))
    }
    return a.value
}

private fun DrawScope.arco(raio: Float, espessura: Float, inicio: Float, varredura: Float, cor: Color, ponta: StrokeCap = StrokeCap.Butt, efeito: PathEffect? = null, alpha: Float = 1f) {
    if (varredura <= 0f) return
    val c = Offset(size.width / 2, size.height / 2)
    drawArc(
        color = cor,
        startAngle = -90f + inicio,
        sweepAngle = varredura,
        useCenter = false,
        topLeft = Offset(c.x - raio, c.y - raio),
        size = Size(raio * 2, raio * 2),
        style = Stroke(width = espessura, cap = ponta, pathEffect = efeito),
        alpha = alpha,
    )
}

/**
 * Anel de kcal: trilho, faixa da meta (verde), o consumido (açaí, enche ao abrir) e a banda de incerteza listrada
 * (consumido ± err) por cima, como no protótipo. err em kcal.
 */
@Composable
fun AnelKcal(consumido: Double, faixaMin: Double?, faixaMax: Double?, err: Double?, tamanho: Dp = 170.dp) {
    val escala = maxOf((faixaMax ?: consumido) * 1.15, consumido + (err ?: 0.0), 1.0)
    val prog = animaAte((consumido / escala).toFloat().coerceIn(0f, 1f))
    val faixaAlpha = animaAte(1f, duracao = 500, atraso = 1000)
    val rotulo = buildString {
        append("${Formato.kcal(consumido)} kcal comidas")
        if (err != null && err > 0) append(", estimativa entre ${Formato.kcal((consumido - err).coerceAtLeast(0.0))} e ${Formato.kcal(consumido + err)}")
        if (faixaMin != null && faixaMax != null) append("; faixa da meta ${Formato.kcal(faixaMin)} a ${Formato.kcal(faixaMax)}")
    }
    Box(Modifier.size(tamanho).semantics { contentDescription = rotulo }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val s = size.minDimension / 200f
            val r = 78f * s
            fun graus(v: Double) = (v / escala * 360.0).toFloat()
            arco(r, 20f * s, 0f, 360f, Cores.Trilho)
            if (faixaMin != null && faixaMax != null && faixaMax > faixaMin) arco(r, 20f * s, graus(faixaMin), graus(faixaMax - faixaMin), Cores.MetaVerde)
            arco(r, 20f * s, 0f, 360f * prog, Cores.Acai, StrokeCap.Round)
            if (err != null && err > 0) {
                val ini = graus((consumido - err).coerceAtLeast(0.0))
                val fim = graus(consumido + err)
                arco(r, 26f * s, ini, fim - ini, Color(0xFFB9A6F5), alpha = 0.55f * faixaAlpha)
                arco(r, 26f * s, ini, fim - ini, Cores.Acai, efeito = PathEffect.dashPathEffect(floatArrayOf(4f * s, 4f * s)), alpha = 0.55f * faixaAlpha)
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(Formato.kcal(consumido), fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = (tamanho.value * 0.17f).sp, color = Cores.Tinta)
            Text("kcal comidas", fontFamily = Atkinson, fontSize = 13.sp, color = Cores.Tinta3)
        }
    }
}

/**
 * Anel com o número no centro (notas do dia, energia): fração 0..1, uma segunda fração por baixo (mais clara),
 * selo pequeno abaixo do número.
 */
@Composable
fun AnelNumero(
    fracao: Float,
    centro: String,
    selo: String?,
    cor: Color,
    trilho: Color,
    miolo: Color,
    tinta: Color,
    rotulo: String,
    tamanho: Dp = 96.dp,
    fracao2: Float? = null,
    cor2: Color = cor,
    espessuraRel: Float = 0.11f,
) {
    val f = animaAte(fracao.coerceIn(0f, 1f))
    val f2 = animaAte((fracao2 ?: 0f).coerceIn(0f, 1f))
    Box(Modifier.size(tamanho).semantics { contentDescription = rotulo }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val esp = size.minDimension * espessuraRel
            val r = size.minDimension / 2 - esp / 2 - size.minDimension * 0.05f
            arco(r, esp, 0f, 360f, trilho)
            if (fracao2 != null) arco(r, esp, 0f, 360f * f2.coerceAtLeast(0.01f), cor2, StrokeCap.Round)
            arco(r, esp, 0f, 360f * f.coerceAtLeast(0.01f), cor, StrokeCap.Round)
            drawCircle(miolo, radius = r - esp / 2 - size.minDimension * 0.01f)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(centro, fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = (tamanho.value * 0.24f).sp, color = Cores.Tinta, textAlign = TextAlign.Center)
            if (selo != null) Text(selo, fontFamily = Atkinson, fontWeight = FontWeight.W700, fontSize = (tamanho.value * 0.085f).coerceAtLeast(8f).sp, color = tinta, textAlign = TextAlign.Center)
        }
    }
}
