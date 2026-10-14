package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.DiaSerie
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Fredoka
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.roundToInt

/*
 * O gráfico único do Progresso (fase 4): uma série por dia do /dias, com camadas que a pessoa liga e desliga.
 * Eixo de kg à esquerda; eixo de kcal à direita só quando uma camada de kcal está ligada.
 */

/** Uma pesagem do /progresso: { dia, peso, gordura, fonte, hora, descartada, motivo }. */
internal data class Pesagem(val dia: LocalDate, val peso: Double, val descartada: Boolean, val motivo: String?, val fonte: String?)

internal fun pesagensDe(j: JSONObject): List<Pesagem> = j.arr("pesagens").objs().mapNotNull { p ->
    val d = Formato.dia(p.str("dia")) ?: return@mapNotNull null
    val kg = p.num("peso") ?: return@mapNotNull null
    Pesagem(d, kg, p.bool("descartada") ?: false, p.str("motivo"), p.str("fonte"))
}.sortedBy { it.dia }

/** A fonte de uma pesagem como a pessoa a conhece. */
internal fun nomeFonte(f: String?): String = when (f?.lowercase()) {
    null, "" -> "sem fonte"
    "relogio", "relógio", "watch", "health", "healthconnect" -> "relógio"
    "app" -> "app"
    "zap", "whatsapp", "bot", "chat" -> "WhatsApp"
    "balanca", "balança" -> "balança"
    else -> f
}

private val CorGasto = Color(0xFFE5655E)
private val CorMagra = Color(0xFFC2410C)
private val CorGrade = Color(0xFFF1EEF8)
private val CorBorda = Color(0xFFE6E0F5)

/** As camadas do gráfico. `kcal` = usa o eixo da direita. A ordem é a dos chips e da legenda. */
internal enum class Camada(val rotulo: String, val cor: Color, val kcal: Boolean) {
    Peso("Peso", Cores.AcaiEscuro, false),
    Media7("Média 7 d", Cores.Laranja, false),
    Tendencia("Tendência", Cores.LilasForte, false),
    Calorias("Calorias", Cores.Fibra, true),
    Gasto("Gasto", CorGasto, true),
    Meta("Meta", Cores.MetaVerde, true),
    Magra("Massa magra", CorMagra, false);

    companion object {
        val padrao: Set<Camada> = setOf(Peso, Media7, Tendencia)

        /** As camadas ligadas cabem num Int (um bit por camada) para o rememberSaveable. */
        fun mascara(c: Set<Camada>): Int = c.fold(0) { m, x -> m or (1 shl x.ordinal) }
        fun deMascara(m: Int): Set<Camada> = entries.filter { m and (1 shl it.ordinal) != 0 }.toSet()
    }
}

/** Dias de uma janela: x = dias desde o início; total = dias − 1 (a largura útil do gráfico). */
internal class Janela(val inicio: LocalDate, val fim: LocalDate) {
    val total: Double = ChronoUnit.DAYS.between(inicio, fim).toDouble().coerceAtLeast(1.0)
    val dias: Int = ChronoUnit.DAYS.between(inicio, fim).toInt() + 1
    fun x(d: LocalDate): Double = ChronoUnit.DAYS.between(inicio, d).toDouble()
    fun contem(d: LocalDate): Boolean = !d.isBefore(inicio) && !d.isAfter(fim)
}

internal fun nomeJanela(janela: Int) = "$janela dias"

/** Um valor num dia, já com o x da janela. */
private class Ponto(val dia: LocalDate, val x: Double, val v: Double)

/** A inclinação (kg/semana) da tendência do /progresso para a janela: 28 d = `kgSemana`; as outras vêm de `janelas`. */
internal fun inclinacaoDe(tend: JSONObject?, janela: Int): Double? =
    if (janela == 28) tend.num("kgSemana") else tend.arr("janelas").objs().firstOrNull { (it.num("dias") ?: 0.0).toInt() == janela }?.num("kgSemana")

private class ItemLegenda(val cor: Color, val nome: String, val ponto: Boolean = false, val alto: Boolean = false, val tracejado: Boolean = false)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legenda(itens: List<ItemLegenda>, modifier: Modifier = Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        itens.forEach { it ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (it.tracejado) Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) { repeat(3) { _ -> Box(Modifier.width(4.dp).height(3.dp).background(it.cor)) } }
                else Box(Modifier.width(if (it.ponto) 9.dp else 14.dp).height(if (it.ponto) 9.dp else if (it.alto) 10.dp else 4.dp).clip(if (it.ponto) CircleShape else RoundedCornerShape(2.dp)).background(it.cor))
                Text(it.nome, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp)
            }
        }
    }
}

/** Linha suave (Catmull-Rom em Bézier cúbica) pelos pontos, sem voltar para trás no x. */
private fun Path.suave(pts: List<Offset>) {
    if (pts.isEmpty()) return
    moveTo(pts[0].x, pts[0].y)
    for (i in 0 until pts.size - 1) {
        val p0 = pts[maxOf(i - 1, 0)]
        val p1 = pts[i]
        val p2 = pts[i + 1]
        val p3 = pts[minOf(i + 2, pts.size - 1)]
        val c1x = (p1.x + (p2.x - p0.x) / 6f).coerceAtMost(p2.x)
        val c2x = (p2.x - (p3.x - p1.x) / 6f).coerceAtLeast(p1.x)
        cubicTo(c1x, p1.y + (p2.y - p0.y) / 6f, c2x, p2.y - (p3.y - p1.y) / 6f, p2.x, p2.y)
    }
}

private enum class Alinhar { Esquerda, Centro, Direita }

/** Rótulo dos eixos em Fredoka 10 sp; (x, y) é o ponto de ancoragem, com y no meio da linha. */
private fun DrawScope.rotulo(medidor: TextMeasurer, estilo: TextStyle, s: String, x: Float, y: Float, al: Alinhar) {
    val r = medidor.measure(AnnotatedString(s), estilo)
    val tx = when (al) { Alinhar.Esquerda -> x; Alinhar.Centro -> x - r.size.width / 2f; Alinhar.Direita -> x - r.size.width }
    drawText(r, topLeft = Offset(tx, y - r.size.height / 2f))
}

/**
 * O gráfico em Canvas. `dias` = a série do /dias dentro da janela; `pesagens` = as do /progresso dentro da janela (as
 * descartadas aparecem em cinza; a fonte entra na linha do dia escolhido). Toque num dia: guia vertical e a linha com o que há.
 */
@Composable
internal fun GraficoDias(
    dias: List<DiaSerie>,
    pesagens: List<Pesagem>,
    tend: JSONObject?,
    meta: JSONObject?,
    janela: Int,
    jan: Janela,
    camadas: Set<Camada>,
    sel: LocalDate,
    aoEscolher: (LocalDate) -> Unit,
) {
    if (camadas.isEmpty()) {
        Text("Ligue uma camada para ver o gráfico.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 30.dp))
        return
    }
    val liga = { c: Camada -> c in camadas }
    val porDia = remember(dias) { dias.associateBy { it.dia } }
    fun serie(f: (DiaSerie) -> Double?): List<Ponto> = dias.mapNotNull { d ->
        val dia = Formato.dia(d.dia) ?: return@mapNotNull null
        val v = f(d) ?: return@mapNotNull null
        if (!jan.contem(dia)) null else Ponto(dia, jan.x(dia), v)
    }
    val pesos = remember(dias, jan.inicio, jan.fim) { serie { it.peso } }
    val magras = remember(dias, jan.inicio, jan.fim) { serie { it.magra } }
    val kcals = remember(dias, jan.inicio, jan.fim) { serie { it.kcal } }
    val gastos = remember(dias, jan.inicio, jan.fim) { serie { it.gasto } }
    val descartadas = remember(pesagens) { pesagens.filter { it.descartada } }
    val precisaPeso = liga(Camada.Peso) || liga(Camada.Media7) || liga(Camada.Tendencia)
    // média de 7 dias centrada: só onde há pesagem até 3 dias antes e até 3 dias depois
    val movel = remember(pesos, camadas) {
        if (!liga(Camada.Media7)) emptyList() else pesos.mapNotNull { p ->
            val grupo = pesos.filter { abs(ChronoUnit.DAYS.between(it.dia, p.dia)) <= 3 }
            val antes = grupo.any { it.dia.isBefore(p.dia) }
            val depois = grupo.any { it.dia.isAfter(p.dia) }
            if (!antes || !depois) null else Ponto(p.dia, p.x, grupo.sumOf { it.v } / grupo.size)
        }
    }
    // tendência: a inclinação do servidor passando pelo centro das pesagens válidas da janela
    val k = if (liga(Camada.Tendencia) && pesos.isNotEmpty()) inclinacaoDe(tend, janela) else null
    val ic = if (janela == 28 && k != null) tend.obj("ic") else null
    val xm = if (pesos.isNotEmpty()) pesos.sumOf { it.x } / pesos.size else 0.0
    val ym = if (pesos.isNotEmpty()) pesos.sumOf { it.v } / pesos.size else 0.0
    val total = jan.total
    fun linha(xx: Double, kg: Double) = ym + kg / 7.0 * (xx - xm)

    // eixo de kg: só as camadas ligadas entram na escala
    val valoresKg = ArrayList<Double>()
    if (precisaPeso) valoresKg += pesos.map { it.v }
    if (liga(Camada.Peso)) valoresKg += descartadas.map { it.peso }
    if (liga(Camada.Magra)) valoresKg += magras.map { it.v }
    if (k != null) {
        valoresKg += linha(0.0, k)
        valoresKg += linha(total, k)
        ic?.let { i -> listOf(i.num("min"), i.num("max")).filterNotNull().forEach { kk -> valoresKg += linha(0.0, kk); valoresKg += linha(total, kk) } }
    }
    val temKg = valoresKg.isNotEmpty()
    val loKg = if (temKg) valoresKg.min() - 0.6 else 0.0
    val hiKg = if (temKg) valoresKg.max() + 0.6 else 1.0
    // eixo de kcal: aparece quando alguma camada de kcal está ligada
    val mn = meta.num("min")
    val mx = meta.num("max")
    val temMeta = liga(Camada.Meta) && mn != null && mx != null && mx > mn
    val eixoKcal = camadas.any { it.kcal }
    val valoresKcal = ArrayList<Double>()
    if (liga(Camada.Calorias)) valoresKcal += kcals.map { it.v }
    if (liga(Camada.Gasto)) valoresKcal += gastos.map { it.v }
    if (temMeta) valoresKcal += mx!!
    val topoKcal = ((valoresKcal.maxOrNull() ?: 2000.0) * 1.12).coerceAtLeast(500.0)
    val temAlgo = temKg || valoresKcal.isNotEmpty()
    if (!temAlgo) {
        Text("Sem dados nos últimos ${nomeJanela(janela)}.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 30.dp))
        return
    }

    val prog = animaAte(1f, 900)
    val medidor = rememberTextMeasurer()
    val estilo = TextStyle(fontFamily = Fredoka, fontSize = 10.sp, color = Cores.Tinta4)
    val descricao = remember(camadas, pesos, kcals, gastos, magras, janela) {
        buildString {
            append("Últimos ${nomeJanela(janela)}. Camadas: ${camadas.joinToString { it.rotulo.lowercase() }}.")
            if (precisaPeso && pesos.isNotEmpty()) append(" Peso de ${Formato.decimal(pesos.minOf { it.v })} a ${Formato.decimal(pesos.maxOf { it.v })} kg em ${pesos.size} pesagens.")
            if (k != null) append(" Tendência de ${Formato.sinal(k)} kg por semana.")
            if (liga(Camada.Calorias) && kcals.isNotEmpty()) append(" Calorias: média de ${Formato.kcal(kcals.sumOf { it.v } / kcals.size)} kcal em ${kcals.size} dias.")
            if (liga(Camada.Gasto) && gastos.isNotEmpty()) append(" Gasto médio de ${Formato.kcal(gastos.sumOf { it.v } / gastos.size)} kcal.")
            if (temMeta) append(" Meta de ${Formato.kcal(mn)} a ${Formato.kcal(mx)} kcal.")
            if (liga(Camada.Magra) && magras.isNotEmpty()) append(" Massa magra de ${Formato.decimal(magras.first().v)} a ${Formato.decimal(magras.last().v)} kg.")
        }
    }
    val margemDir = if (eixoKcal) 46.dp else 12.dp
    Canvas(
        Modifier.fillMaxWidth().aspectRatio(340f / 210f).semantics { contentDescription = descricao }
            .pointerInput(jan.inicio, jan.fim, eixoKcal) {
                detectTapGestures { o ->
                    val esq = 44.dp.toPx()
                    val dir = size.width - margemDir.toPx()
                    val f = ((o.x - esq) / (dir - esq)).coerceIn(0f, 1f)
                    aoEscolher(jan.inicio.plusDays((f * total).roundToInt().toLong()))
                }
            },
    ) {
        val esq = 44.dp.toPx()
        val dir = size.width - margemDir.toPx()
        val topo = 12.dp.toPx()
        val base = size.height - 24.dp.toPx()
        val passo = ((dir - esq) / jan.dias)
        fun px(xx: Double) = (esq + (xx / total) * (dir - esq)).toFloat()
        fun pyKg(kg: Double) = (base - (kg - loKg) / (hiKg - loKg) * (base - topo)).toFloat()
        fun pyKcal(v: Double) = (base - v / topoKcal * (base - topo)).toFloat()
        val grosso = 2.5.dp.toPx()
        val raio = 3.5.dp.toPx()

        // fundo branco com cantos arredondados e grade bem clara
        drawRoundRect(Color.White, topLeft = Offset(esq, topo), size = Size(dir - esq, base - topo), cornerRadius = CornerRadius(12.dp.toPx()))
        drawRoundRect(CorBorda, topLeft = Offset(esq, topo), size = Size(dir - esq, base - topo), cornerRadius = CornerRadius(12.dp.toPx()), style = Stroke(1.dp.toPx()))
        val ticks = 4
        for (i in 0..ticks) {
            val y = topo + (base - topo) * i / ticks
            if (i in 1 until ticks) drawLine(CorGrade, Offset(esq, y), Offset(dir, y), 1.dp.toPx())
            // rótulos: kg à esquerda (do topo para a base), kcal à direita
            val yy = y.coerceIn(topo + 6.dp.toPx(), base - 6.dp.toPx())
            if (temKg) rotulo(medidor, estilo, Formato.decimal(hiKg - (hiKg - loKg) * i / ticks), esq - 5.dp.toPx(), yy, Alinhar.Direita)
            if (eixoKcal) rotulo(medidor, estilo, Formato.kcal(topoKcal * (ticks - i) / ticks), dir + 5.dp.toPx(), yy, Alinhar.Esquerda)
        }
        for (q in 1..3) drawLine(CorGrade, Offset(px(total * q / 4), topo), Offset(px(total * q / 4), base), 1.dp.toPx())
        // datas: início, meio e hoje; as unidades embaixo dos eixos
        val yData = size.height - 9.dp.toPx()
        rotulo(medidor, estilo, Formato.diaCurto(jan.inicio), esq, yData, Alinhar.Esquerda)
        rotulo(medidor, estilo, Formato.diaCurto(jan.inicio.plusDays((total / 2).roundToInt().toLong())), px(total / 2), yData, Alinhar.Centro)
        rotulo(medidor, estilo, "hoje", dir, yData, Alinhar.Direita)
        if (temKg) rotulo(medidor, estilo, "kg", esq - 5.dp.toPx(), yData, Alinhar.Direita)
        if (eixoKcal) rotulo(medidor, estilo, "kcal", dir + 5.dp.toPx(), yData, Alinhar.Esquerda)

        clipRect(esq, topo, dir, base) {
            // meta: faixa verde clara
            if (temMeta) drawRect(Cores.MetaVerde, topLeft = Offset(esq, pyKcal(mx!!)), size = Size(dir - esq, pyKcal(mn!!) - pyKcal(mx)), alpha = 0.8f * prog)
            // calorias: barras por dia
            if (liga(Camada.Calorias)) {
                val largura = (passo * 0.6f).coerceAtLeast(2.dp.toPx())
                kcals.forEach { p ->
                    val h = (base - pyKcal(p.v)) * prog
                    drawRoundRect(Cores.Fibra, topLeft = Offset(px(p.x) - largura / 2, base - h), size = Size(largura, h), cornerRadius = CornerRadius(3.dp.toPx()), alpha = 0.85f)
                }
            }
            // faixa de 95 % da tendência (só 28 dias)
            if (k != null && ic != null) {
                val kMin = ic.num("min") ?: k
                val kMax = ic.num("max") ?: k
                val banda = Path().apply {
                    moveTo(px(0.0), pyKg(maxOf(linha(0.0, kMin), linha(0.0, kMax))))
                    lineTo(px(total), pyKg(maxOf(linha(total, kMin), linha(total, kMax))))
                    lineTo(px(total), pyKg(minOf(linha(total, kMin), linha(total, kMax))))
                    lineTo(px(0.0), pyKg(minOf(linha(0.0, kMin), linha(0.0, kMax))))
                    close()
                }
                drawPath(banda, Cores.Lilas, alpha = 0.7f * prog)
            }
            // gasto: linha vermelha suave com pontos pequenos
            if (liga(Camada.Gasto) && gastos.isNotEmpty()) {
                val pts = gastos.map { Offset(px(it.x), pyKcal(it.v)) }
                if (pts.size > 1) drawPath(Path().apply { suave(pts) }, CorGasto, alpha = prog, style = Stroke(grosso, cap = StrokeCap.Round, join = StrokeJoin.Round))
                pts.forEach { drawCircle(CorGasto, 2.dp.toPx(), it, alpha = prog) }
            }
            // massa magra: tracejada laranja-escura
            if (liga(Camada.Magra) && magras.isNotEmpty()) {
                val pts = magras.map { Offset(px(it.x), pyKg(it.v)) }
                if (pts.size > 1) drawPath(Path().apply { suave(pts) }, CorMagra, alpha = prog, style = Stroke(grosso, cap = StrokeCap.Round, join = StrokeJoin.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx(), 5.dp.toPx()))))
                else pts.forEach { drawCircle(CorMagra, raio, it, alpha = prog) }
            }
            // média de 7 dias
            if (movel.size > 1) drawPath(Path().apply { suave(movel.map { Offset(px(it.x), pyKg(it.v)) }) }, Cores.Laranja, alpha = prog, style = Stroke(grosso, cap = StrokeCap.Round, join = StrokeJoin.Round))
            // tendência (desenha da esquerda para a direita ao abrir)
            if (k != null) {
                val xFim = total * prog
                drawLine(Cores.LilasForte, Offset(px(0.0), pyKg(linha(0.0, k))), Offset(px(xFim), pyKg(linha(xFim, k))), grosso, cap = StrokeCap.Round)
            }
            // guia vertical do dia escolhido
            if (jan.contem(sel)) drawLine(Cores.LilasMedio, Offset(px(jan.x(sel)), topo), Offset(px(jan.x(sel)), base), 1.dp.toPx())
            // peso: linha suave açaí com pontos; descartadas em cinza, sem linha
            if (liga(Camada.Peso)) {
                val pts = pesos.map { Offset(px(it.x), pyKg(it.v)) }
                if (pts.size > 1) drawPath(Path().apply { suave(pts) }, Cores.AcaiEscuro, alpha = prog, style = Stroke(grosso, cap = StrokeCap.Round, join = StrokeJoin.Round))
                descartadas.forEach { d ->
                    val c = Offset(px(jan.x(d.dia)), pyKg(d.peso))
                    drawCircle(Color.White, raio + 1.dp.toPx(), c, alpha = prog)
                    drawCircle(Cores.Cinza, raio - 0.5.dp.toPx(), c, alpha = prog)
                }
                pesos.forEachIndexed { i, p ->
                    val r = if (p.dia == sel) raio + 2.dp.toPx() else raio
                    drawCircle(Color.White, r + 1.5.dp.toPx(), pts[i], alpha = prog)
                    drawCircle(Cores.AcaiEscuro, r, pts[i], alpha = prog)
                }
            }
        }
    }

    // a linha do dia escolhido: só o que há nesse dia, das camadas ligadas
    val d = porDia[Formato.iso(sel)]
    val pesagemSel = pesagens.firstOrNull { it.dia == sel && !it.descartada }
    val descartadaSel = descartadas.firstOrNull { it.dia == sel }
    val partes = ArrayList<String>()
    if (liga(Camada.Peso) || liga(Camada.Media7) || liga(Camada.Tendencia)) {
        d?.peso?.let { partes += "${Formato.decimal(it)} kg" + (pesagemSel?.let { p -> " (${nomeFonte(p.fonte)})" } ?: "") }
        if (liga(Camada.Peso) && descartadaSel != null) partes += "${Formato.decimal(descartadaSel.peso)} kg descartada" + (descartadaSel.motivo?.let { ": $it" } ?: "")
    }
    if (liga(Camada.Magra)) d?.magra?.let { partes += "magra ${Formato.decimal(it)} kg" }
    if (liga(Camada.Calorias)) d?.kcal?.let { partes += "${Formato.kcal(it)} kcal" }
    if (liga(Camada.Gasto)) d?.gasto?.let { partes += "gasto ${Formato.kcal(it)}" }
    Text(
        Formato.diaCurto(sel) + " · " + (if (partes.isEmpty()) "sem registro" else partes.joinToString(" · ")),
        style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 4.dp),
    )
    Text("Toque num dia para ver.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp)
    // legenda só das camadas ligadas
    val legenda = ArrayList<ItemLegenda>()
    camadas.sortedBy { it.ordinal }.forEach { c ->
        when (c) {
            Camada.Peso -> { legenda += ItemLegenda(Cores.AcaiEscuro, "peso", ponto = true); if (descartadas.isNotEmpty()) legenda += ItemLegenda(Cores.Cinza, "descartada", ponto = true) }
            Camada.Media7 -> legenda += ItemLegenda(Cores.Laranja, "média 7 d")
            Camada.Tendencia -> { legenda += ItemLegenda(Cores.LilasForte, "tendência"); if (ic != null) legenda += ItemLegenda(Cores.Lilas, "faixa 95%", alto = true) }
            Camada.Calorias -> legenda += ItemLegenda(Cores.Fibra, "kcal do dia", alto = true)
            Camada.Gasto -> legenda += ItemLegenda(CorGasto, "gasto")
            Camada.Meta -> legenda += ItemLegenda(Cores.MetaVerde, "faixa da meta", alto = true)
            Camada.Magra -> legenda += ItemLegenda(CorMagra, "massa magra", tracejado = true)
        }
    }
    Legenda(legenda, Modifier.fillMaxWidth().padding(top = 6.dp))
    if (liga(Camada.Tendencia)) {
        Text(
            when {
                k != null && janela == 28 -> listOfNotNull("${Formato.sinal(k)} kg/sem", ic?.let { "faixa ${Formato.sinal(it.num("min"))} a ${Formato.sinal(it.num("max"))}" }, tend.str("direcao")).joinToString(" · ")
                k != null -> "Últimos $janela dias: ${Formato.sinal(k)} kg/sem."
                else -> "Sem tendência em ${nomeJanela(janela)}."
            },
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 4.dp),
        )
    }
}
