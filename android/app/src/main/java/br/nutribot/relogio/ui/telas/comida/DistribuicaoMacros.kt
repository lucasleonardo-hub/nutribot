package br.nutribot.relogio.ui.telas.comida

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import org.json.JSONObject
import java.text.Normalizer
import kotlin.math.roundToInt

/*
 * Distribuição dos macros (fase 6): de onde vêm as calorias do dia (real) contra a divisão recomendada pelo objetivo.
 * Contrato: hoje.macros.distribuicao = { real: { c, g, p }, recomendada: { c, g, p } } (% das kcal), em
 * docs/app/2026-10-15-plano-fase6.md, seção 5. O real sai dos gramas do dia mostrado (kcal = 4p + 4c + 9g), para
 * bater com os números logo acima; a recomendada vem do /hoje e, sem ela, do objetivo do perfil.
 */

/** Percentuais das kcal (0 a 100) de proteína, carboidrato e gordura. */
data class Distribuicao(val p: Double, val c: Double, val g: Double)

/** Divide as kcal dos gramas do dia. Sem nada comido, null. */
fun distribuicaoDeGramas(p: Double?, c: Double?, g: Double?): Distribuicao? {
    val kp = 4 * (p ?: 0.0)
    val kc = 4 * (c ?: 0.0)
    val kg = 9 * (g ?: 0.0)
    val total = kp + kc + kg
    if (total <= 0.0) return null
    return Distribuicao(kp / total * 100, kc / total * 100, kg / total * 100)
}

/** { c, g, p } do servidor; aceita fração (0..1) ou percentual (0..100). */
fun distribuicaoDeJson(j: JSONObject?): Distribuicao? {
    val p = j.num("p") ?: return null
    val c = j.num("c") ?: return null
    val g = j.num("g") ?: return null
    val soma = p + c + g
    if (soma <= 0.0) return null
    val f = if (soma <= 1.5) 100.0 else 1.0
    return Distribuicao(p * f, c * f, g * f)
}

/** A recomendada pelo objetivo (mesma regra do servidor): hipertrofia 50/25/25, emagrecimento 40/30/30, senão 50/30/20 (c/g/p). */
fun distribuicaoDoObjetivo(objetivo: String?): Distribuicao {
    val o = Normalizer.normalize(objetivo.orEmpty(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()
    return when {
        listOf("hipertrof", "ganhar massa", "ganho de massa", "massa muscular", "bulking").any { it in o } -> Distribuicao(p = 25.0, c = 50.0, g = 25.0)
        listOf("emagrec", "perder", "perda de", "secar", "definir", "definicao", "cutting").any { it in o } -> Distribuicao(p = 30.0, c = 40.0, g = 30.0)
        else -> Distribuicao(p = 20.0, c = 50.0, g = 30.0)
    }
}

private data class Fatia(val nome: String, val real: Double, val rec: Double, val cor: Color, val trilho: Color, val tinta: Color)

/**
 * A barra segmentada: os % reais em cima, a barra real, a recomendada (mais fina, nas cores suaves) e os % dela embaixo.
 * Ordem igual à das caixas de gramas do cartão (proteína, carboidrato, gordura).
 */
@Composable
fun DistribuicaoMacros(real: Distribuicao, recomendada: Distribuicao, modifier: Modifier = Modifier) {
    val fatias = listOf(
        Fatia("proteína", real.p, recomendada.p, Cores.Proteina, Cores.ProteinaTrilho, Cores.ProteinaTinta),
        Fatia("carboidrato", real.c, recomendada.c, Cores.Carbo, Cores.CarboTrilho, Cores.CarboTinta),
        Fatia("gordura", real.g, recomendada.g, Cores.Gordura, Cores.GorduraTrilho, Cores.GorduraTinta),
    )
    fun pct(v: Double) = "${v.roundToInt()}%"
    val desc = "Calorias do dia: " + fatias.joinToString(", ") { "${it.nome} ${pct(it.real)}" } +
        ". Recomendado: " + fatias.joinToString(", ") { "${it.nome} ${pct(it.rec)}" } + "."
    val f = animaAte(1f, 900, 150)
    Column(modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = desc }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Real", style = MaterialTheme.typography.labelSmall, color = Cores.Tinta3)
        LinhaPct(fatias.map { pct(it.real) to it.tinta }, forte = true)
        Barra(fatias.map { it.real to it.cor }, 14.dp, f)
        Barra(fatias.map { it.rec to it.trilho.misturar(it.cor) }, 7.dp, f)
        LinhaPct(fatias.map { pct(it.rec) to it.tinta }, forte = false)
        Text("Recomendado", style = MaterialTheme.typography.labelSmall, color = Cores.Tinta3)
    }
}

/** Meio caminho entre o trilho e a cor do macro: a recomendada fica visível, mas mais suave que a real. */
private fun Color.misturar(outra: Color): Color = Color(
    red = (red + outra.red) / 2, green = (green + outra.green) / 2, blue = (blue + outra.blue) / 2, alpha = 1f,
)

/** Os três % alinhados: o primeiro à esquerda, o do meio no centro, o último à direita (como as fatias). */
@Composable
private fun LinhaPct(itens: List<Pair<String, Color>>, forte: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        itens.forEach { (t, cor) ->
            if (forte) Text(t, fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 15.sp, color = cor)
            else Text(t, style = MaterialTheme.typography.labelMedium, color = cor)
        }
    }
}

/** Barra em fatias (peso = %), com um respiro entre elas; enche da esquerda ao abrir. */
@Composable
private fun Barra(fatias: List<Pair<Double, Color>>, altura: Dp, progresso: Float) {
    val visiveis = fatias.filter { it.first > 0.0 }
    Box(Modifier.fillMaxWidth().height(altura).clip(Formas.Pilula).background(Cores.Trilho)) {
        Row(
            Modifier.fillMaxWidth(progresso.coerceIn(0.001f, 1f)).height(altura).clip(Formas.Pilula),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            visiveis.forEach { (v, cor) ->
                Box(Modifier.weight(v.toFloat().coerceAtLeast(0.5f)).height(altura).clip(Formas.Pilula).background(cor))
            }
        }
    }
}
