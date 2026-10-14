package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cabecalho
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Uma pesagem do /progresso: { dia, peso, gordura, fonte, hora, descartada, motivo }. */
private data class Pesagem(val dia: LocalDate, val peso: Double, val descartada: Boolean, val motivo: String?, val fonte: String?)

private fun pesagensDe(j: JSONObject): List<Pesagem> = j.arr("pesagens").objs().mapNotNull { p ->
    val d = Formato.dia(p.str("dia")) ?: return@mapNotNull null
    val kg = p.num("peso") ?: return@mapNotNull null
    Pesagem(d, kg, p.bool("descartada") ?: false, p.str("motivo"), p.str("fonte"))
}.sortedBy { it.dia }

private fun statusVeredito(s: String?): Triple<String, Color, Color> {
    val t = s?.lowercase() ?: ""
    return when {
        t.contains("abaixo") -> Triple(s!!.replace('_', ' '), Color(0xFFFFE0C7), Color(0xFF8A4B12))
        t.contains("acima") -> Triple(s!!.replace('_', ' '), Cores.CuidadoFundo, Cores.CuidadoTinta)
        t.contains("ritmo") || t.contains("dentro") || t.contains("ok") || t.contains("compat") -> Triple(s!!.replace('_', ' '), Color(0xFFDDF5E8), Cores.BomTinta)
        t.isBlank() -> Triple("sem veredito", Cores.Trilho, Cores.LilasTexto)
        else -> Triple(s!!.replace('_', ' '), Cores.Trilho, Cores.LilasTexto)
    }
}

@Composable
fun TelaProgresso(vm: AppVM, perfil: Perfil?) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaProgresso(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    ConteudoCarga(carga, { vm.carregar(rota, forcar = true) }, topo = { Cabecalho("Progresso", "${perfil.curto} · peso e energia", Pose.CorgiBalanca, 64.dp) }) { j ->
        ConteudoProgresso(j)
    }
}

@Composable
private fun ConteudoProgresso(j: JSONObject) {
    val pesagens = remember(j) { pesagensDe(j) }
    val tend = j.obj("tendencia")
    var janela by rememberSaveable { mutableIntStateOf(28) }

    Cartao(forma = Formas.Grande) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text("Peso de tendência", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(Formato.decimal(tend.num("pesoHoje") ?: pesagens.lastOrNull { !it.descartada }?.peso), style = MaterialTheme.typography.displaySmall)
                    Text(" kg", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
                }
            }
            if (tend != null) Column(horizontalAlignment = Alignment.End) {
                Text("${Formato.sinal(tend.num("kgSemana"))} kg/sem", style = MaterialTheme.typography.titleLarge, color = Cores.AcaiEscuro)
                tend.obj("ic")?.let { ic -> Text("faixa de 95%: ${Formato.sinal(ic.num("min"))} a ${Formato.sinal(ic.num("max"))}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp) }
                tend.str("direcao")?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Cores.Tinta2) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(7, 14, 21, 28, 90).forEach { d ->
                val ativa = d == janela
                Box(
                    Modifier.weight(1f).heightIn(min = 48.dp).clip(Formas.Pilula).background(if (ativa) Cores.Acai else Cores.Trilho)
                        .clickable(role = Role.Tab) { janela = d },
                    contentAlignment = Alignment.Center,
                ) { Text("${d}d", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, color = if (ativa) Cores.Branco else Cores.LilasTexto) }
            }
        }
        GraficoPeso(pesagens, tend, janela)
        Legenda()
        janelaTexto(tend, janela)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 6.dp)) }
    }

    j.obj("veredito")?.let { v ->
        val (rot, fundo, tinta) = statusVeredito(v.str("status"))
        val prob = v.num("prob")?.let { if (it <= 1.0) it * 100 else it }
        Cartao(cor = Color(0xFFFFF1E8), atraso = 80) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.CorgiBalanca, 70.dp)
                Column(Modifier.weight(1f)) {
                    Pilula(rot + (prob?.let { " · ${Formato.inteiro(it)}%" } ?: ""), fundo, tinta)
                    v.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp)) }
                }
            }
        }
    }

    j.obj("meta")?.let { m ->
        Cartao(atraso = 140) {
            TituloSecao("Meta de energia")
            val mn = m.num("min")
            val mx = m.num("max")
            if (mn != null && mx != null) {
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 6.dp)) {
                    Text("${Formato.kcal(mn)}–${Formato.kcal(mx)}", style = MaterialTheme.typography.headlineMedium)
                    Text(" kcal registradas/dia", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
            }
            m.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 6.dp)) }
        }
    }

    val alertas = j.arr("alertas").objs()
    if (alertas.isNotEmpty()) {
        Cartao(cor = Cores.AtencaoFundo, atraso = 180) {
            TituloSecao("O que pesa na leitura")
            alertas.forEach { a ->
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(Cores.AtencaoTinta))
                    Text(a.str("texto") ?: a.str("tipo") ?: "", style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A3B00))
                }
            }
        }
    }

    j.str("texto")?.let { texto ->
        var aberto by rememberSaveable { mutableStateOf(false) }
        Cartao(atraso = 220) {
            Box(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(Formas.Pequeno).background(Cores.Trilho).clickable(role = Role.Button) { aberto = !aberto },
                contentAlignment = Alignment.Center,
            ) { Text(if (aberto) "Esconder a conta" else "Como cheguei nisso (o !progresso)", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 15.sp, color = Cores.LilasTexto) }
            if (aberto) Text(texto, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

private fun janelaTexto(tend: JSONObject?, janela: Int): String? {
    val k = tend.arr("janelas").objs().firstOrNull { (it.num("dias") ?: 0.0).toInt() == janela }?.num("kgSemana")
    return when {
        janela == 28 -> null
        janela == 90 -> "O /progresso traz as pesagens dos últimos 31 dias (a janela do !progresso); os 90 dias chegam numa próxima versão."
        k != null -> "Nos últimos $janela dias: ${Formato.sinal(k)} kg/sem. A faixa de 95% é da janela de 28 dias."
        else -> "Sem tendência calculada para $janela dias: só os pontos e a média de 7 dias."
    }
}

@Composable
private fun Legenda() {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        @Composable fun item(cor: Color, nome: String, ponto: Boolean = false, alto: Boolean = false) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Box(Modifier.width(if (ponto) 9.dp else 14.dp).height(if (ponto) 9.dp else if (alto) 10.dp else 4.dp).clip(if (ponto) CircleShape else RoundedCornerShape(2.dp)).background(cor))
                Text(nome, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp)
            }
        }
        item(Cores.Acai, "tendência")
        item(Cores.Lilas, "faixa 95%", alto = true)
        item(Cores.Gordura, "média 7 d")
        item(Cores.Cinza, "descartada", ponto = true)
    }
}

/**
 * Gráfico do peso em Canvas: pontos (descartadas em cinza), média móvel de 7 dias centrada (só onde há 3 dias dos dois lados),
 * linha de tendência e banda do IC 95%. A linha passa pelo centro das pesagens válidas da janela com a inclinação do servidor
 * (28 dias: tendencia.kgSemana; outras janelas: tendencia.janelas). A banda (só 28 dias) abre a partir desse centro com o IC.
 */
@Composable
private fun GraficoPeso(pesagens: List<Pesagem>, tend: JSONObject?, janela: Int) {
    val hoje = pesagens.lastOrNull()?.dia?.let { maxOf(it, LocalDate.now()) } ?: LocalDate.now()
    val inicio = hoje.minusDays((janela - 1).toLong())
    val pts = pesagens.filter { !it.dia.isBefore(inicio) }
    val validos = pts.filter { !it.descartada }
    if (pts.isEmpty()) {
        Text("Sem pesagens nos últimos $janela dias.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 30.dp))
        return
    }
    val k = if (janela == 28) tend.num("kgSemana") else tend.arr("janelas").objs().firstOrNull { (it.num("dias") ?: 0.0).toInt() == janela }?.num("kgSemana")
    val ic = if (janela == 28) tend.obj("ic") else null
    fun x(d: LocalDate) = ChronoUnit.DAYS.between(inicio, d).toDouble()
    val xm = if (validos.isNotEmpty()) validos.sumOf { x(it.dia) } / validos.size else 0.0
    val ym = if (validos.isNotEmpty()) validos.sumOf { it.peso } / validos.size else pts.sumOf { it.peso } / pts.size
    // média de 7 dias centrada
    val movel = validos.mapNotNull { p ->
        val antes = validos.count { val d = ChronoUnit.DAYS.between(it.dia, p.dia); d in 1..3 }
        val depois = validos.count { val d = ChronoUnit.DAYS.between(p.dia, it.dia); d in 1..3 }
        if (antes == 0 || depois == 0) null else {
            val jan = validos.filter { kotlin.math.abs(ChronoUnit.DAYS.between(it.dia, p.dia)) <= 3 }
            x(p.dia) to jan.sumOf { it.peso } / jan.size
        }
    }
    val total = (janela - 1).toDouble().coerceAtLeast(1.0)
    fun linha(xx: Double, kg: Double) = ym + kg / 7.0 * (xx - xm)
    var lo = pts.minOf { it.peso } - 0.6
    var hi = pts.maxOf { it.peso } + 0.6
    if (k != null) {
        listOf(0.0, total).forEach { xx -> lo = minOf(lo, linha(xx, k) - 0.2); hi = maxOf(hi, linha(xx, k) + 0.2) }
    }
    val prog = animaAte(1f, 1200)
    val pontosAlpha = animaAte(1f, 600, 600)
    val descricao = "Peso nos últimos $janela dias: ${validos.size} pesagens válidas" + (k?.let { ", tendência ${Formato.sinal(it)} kg por semana" } ?: "") +
        (ic?.let { ", faixa de 95% entre ${Formato.sinal(it.num("min"))} e ${Formato.sinal(it.num("max"))}" } ?: "")
    Canvas(Modifier.fillMaxWidth().aspectRatio(340f / 190f).semantics { contentDescription = descricao }) {
        val esq = 4.dp.toPx()
        val dir = size.width - 40.dp.toPx()
        val topo = 14.dp.toPx()
        val base = size.height - 22.dp.toPx()
        fun px(xx: Double) = (esq + (xx / total) * (dir - esq)).toFloat()
        fun py(kg: Double) = (base - (kg - lo) / (hi - lo) * (base - topo)).toFloat()
        val paint = android.graphics.Paint().apply { isAntiAlias = true; textSize = 10.sp.toPx(); color = android.graphics.Color.rgb(0x6E, 0x65, 0x87) }
        // grade e eixos
        val ticks = 3
        for (i in 0..ticks) {
            val kg = lo + 0.3 + (hi - lo - 0.6) * i / ticks
            val y = py(kg)
            drawLine(Cores.Trilho, Offset(esq, y), Offset(dir, y), 1.dp.toPx())
            drawContext.canvas.nativeCanvas.drawText(Formato.decimal(kg) + " kg", dir + 4.dp.toPx(), y + 3.dp.toPx(), paint)
        }
        drawContext.canvas.nativeCanvas.drawText(if (janela == 90) "há 3 meses" else "há $janela dias", esq, size.height - 6.dp.toPx(), paint)
        paint.textAlign = android.graphics.Paint.Align.RIGHT
        drawContext.canvas.nativeCanvas.drawText("hoje", dir, size.height - 6.dp.toPx(), paint)

        clipRect(esq, 0f, dir, base + 2.dp.toPx()) {
            // banda do IC 95% (28 dias)
            if (k != null && ic != null) {
                val kMin = ic.num("min") ?: k
                val kMax = ic.num("max") ?: k
                val passos = 12
                val cima = (0..passos).map { s -> val xx = total * s / passos; Offset(px(xx), py(maxOf(linha(xx, kMin), linha(xx, kMax)))) }
                val baixo = (0..passos).map { s -> val xx = total * s / passos; Offset(px(xx), py(minOf(linha(xx, kMin), linha(xx, kMax)))) }.reversed()
                val banda = Path().apply { (cima + baixo).forEachIndexed { i, o -> if (i == 0) moveTo(o.x, o.y) else lineTo(o.x, o.y) }; close() }
                drawPath(banda, Cores.Lilas, alpha = prog)
            }
            // média móvel de 7 dias
            if (movel.size > 1) {
                val m = Path().apply { movel.forEachIndexed { i, (xx, kg) -> if (i == 0) moveTo(px(xx), py(kg)) else lineTo(px(xx), py(kg)) } }
                drawPath(m, Cores.Gordura, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round), alpha = prog)
            }
            // tendência (desenha da esquerda para a direita ao abrir)
            if (k != null) {
                val xFim = total * prog
                drawLine(Cores.Acai, Offset(px(0.0), py(linha(0.0, k))), Offset(px(xFim), py(linha(xFim, k))), 3.5.dp.toPx(), cap = StrokeCap.Round)
            }
        }
        // pontos
        pts.forEach { p ->
            val c = Offset(px(x(p.dia)), py(p.peso))
            drawCircle(Color.White, radius = (if (p.descartada) 3.5f else 4.5f).dp.toPx() + 1.5.dp.toPx(), center = c, alpha = pontosAlpha)
            drawCircle(if (p.descartada) Cores.Cinza else Cores.AcaiEscuro, radius = (if (p.descartada) 3.5f else 4.5f).dp.toPx(), center = c, alpha = pontosAlpha)
        }
    }
    val descartadas = pts.filter { it.descartada }
    if (descartadas.isNotEmpty()) {
        Text(
            "Descartadas: " + descartadas.joinToString("; ") { Formato.diaCurto(it.dia) + (it.motivo?.let { m -> " ($m)" } ?: "") },
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp),
        )
    }
}
