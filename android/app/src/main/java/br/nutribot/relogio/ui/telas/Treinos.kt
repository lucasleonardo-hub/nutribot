package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.dados.textos
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import org.json.JSONObject
import java.text.Normalizer
import java.time.LocalDate

/*
 * "Seus treinos" (fase 6, contrato em docs/app/2026-10-15-plano-fase6.md, seção 6): uma caixa por treino (o título da
 * sessão no Hevy), 2 por linha. Tocar numa caixa abre a folha com os exercícios: quanto está pegando, quanto pode pegar
 * (na cor da ação), o motivo e o histórico de carga. Substitui "Sua rotina" da fase 5.
 */

/** Um ponto do histórico de carga de um exercício (mais antigo primeiro). */
internal data class CargaAntiga(val dia: LocalDate?, val kg: Double, val reps: Int?)

/** exercicios[i]: { nome, grupo, series: [{kg, reps}], ultimoKg, ultimasReps, sugeridoKg, deltaKg, sugeridasReps, acao, motivo, frase, historico } */
internal data class ExercicioTreino(
    val nome: String,
    val grupo: String?,
    val series: Int?,
    val ultimoKg: Double?,
    val ultimasReps: Int?,
    val sugeridoKg: Double?,
    val deltaKg: Double?,
    val sugeridasReps: Int?,
    val acao: String?,
    val motivo: String?,
    val frase: String?,
    val historico: List<CargaAntiga>,
    /** O "Pegando": maior carga das séries da última sessão DESTE treino e as repetições nela (fase 5: ultimoKg/ultimasReps). */
    val pegandoKg: Double? = ultimoKg,
    val pegandoReps: Int? = ultimasReps,
)

/** treinos[i]: { id, titulo, dias, ultimaData, sessoes8sem, duracaoMin, grupos, proxima: { acao, resumo }, exercicios } */
internal data class Treino(
    val id: String,
    val titulo: String,
    val dias: List<String>,
    val ultimaData: LocalDate?,
    val sessoes: Int?,
    val duracaoMin: Int?,
    val grupos: List<String>,
    val acao: String?,
    val resumo: String?,
    val exercicios: List<ExercicioTreino>,
)

private val nomesCurtos = listOf("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")

/** "50 kg" ou "52,5 kg": sem casa decimal quando a carga é inteira. */
internal fun kgCurto(v: Double): String = Formato.decimal(v, if (v % 1.0 == 0.0) 0 else 1) + " kg"

/** Chave para casar nomes de exercício (caixa baixa, sem acento, sem espaço sobrando). */
internal fun nomeChave(s: String?): String =
    Normalizer.normalize(s.orEmpty(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase().trim().replace(Regex("\\s+"), " ")

private fun exercicioDe(e: JSONObject): ExercicioTreino {
    val feitas = e.arr("series").objs()
    // ultimoKg vem do histórico do exercício em qualquer treino; o "Pegando" desta caixa sai das séries dela
    val comKg = feitas.mapNotNull { s -> s.num("kg")?.takeIf { it > 0 }?.let { it to s.int("reps") } }
    val maiorKg = comKg.maxOfOrNull { it.first }
    val repsDaSerie = if (maiorKg != null) comKg.filter { it.first == maiorKg }.mapNotNull { it.second }.maxOrNull()
    else feitas.mapNotNull { it.int("reps") }.maxOrNull()
    return ExercicioTreino(
        pegandoKg = if (feitas.isNotEmpty()) maiorKg else e.num("ultimoKg"),
        pegandoReps = if (feitas.isNotEmpty()) repsDaSerie else e.int("ultimasReps"),
        nome = e.str("nome") ?: "Exercício",
        grupo = e.str("grupo"),
        // fase 6: a lista das séries válidas; fase 5: só o número
        series = if (feitas.isNotEmpty()) feitas.size else e.int("series"),
        ultimoKg = e.num("ultimoKg"),
        ultimasReps = e.int("ultimasReps"),
        sugeridoKg = e.num("sugeridoKg"),
        deltaKg = e.num("deltaKg"),
        sugeridasReps = e.int("sugeridasReps"),
        acao = e.str("acao"),
        motivo = e.str("motivo"),
        frase = e.str("frase"),
        historico = e.arr("historico").objs().mapNotNull { h ->
            val kg = h.num("kg")?.takeIf { it > 0 } ?: return@mapNotNull null
            CargaAntiga(Formato.dia(h.str("dia")), kg, h.int("reps"))
        }.takeLast(8),
    )
}

/** Os treinos do /corpo. Servidor da fase 5 (sem `treinos`): uma caixa por dia da `rotina`. */
internal fun treinosDe(j: JSONObject?): List<Treino> {
    val lista = j.arr("treinos")
    if (lista != null) return lista.objs().mapNotNull { t ->
        val titulo = t.str("titulo") ?: return@mapNotNull null
        val ex = t.arr("exercicios").objs().map(::exercicioDe)
        Treino(
            id = t.str("id") ?: titulo,
            titulo = titulo,
            dias = t.arr("dias").textos(),
            ultimaData = Formato.dia(t.str("ultimaData")),
            sessoes = t.int("sessoes8sem"),
            duracaoMin = t.int("duracaoMin"),
            grupos = t.arr("grupos").textos().ifEmpty { ex.mapNotNull { it.grupo }.distinct() },
            acao = t.obj("proxima").str("acao"),
            resumo = t.obj("proxima").str("resumo"),
            exercicios = ex,
        )
    }
    return j.arr("rotina").objs().mapNotNull { d ->
        val dia = d.int("diaSemana")?.takeIf { it in 1..7 } ?: return@mapNotNull null
        val ex = d.arr("exercicios").objs().map(::exercicioDe)
        Treino(
            id = "dia$dia",
            titulo = d.str("titulo") ?: d.str("nome") ?: nomesCurtos[dia - 1],
            dias = listOf(nomesCurtos[dia - 1]),
            ultimaData = Formato.dia(d.str("ultimaData")),
            sessoes = null,
            duracaoMin = null,
            grupos = ex.mapNotNull { it.grupo }.distinct(),
            acao = null,
            resumo = null,
            exercicios = ex,
        )
    }
}

/** Cores da ação: subir = verde, manter = âmbar, repetir (e o resto) = lilás. */
private fun coresAcao(acao: String?): Pair<Color, Color> = when (acao) {
    "subir" -> Cores.BomFundo to Cores.BomTinta
    "manter" -> Cores.AtencaoFundo to Cores.AtencaoTinta
    else -> Cores.Trilho to Cores.LilasTexto
}

/** A pílula da próxima ação da caixa ("3 pra subir"), contada nos exercícios. */
private fun proximaDe(t: Treino): Triple<String, Color, Color>? {
    val acao = t.acao ?: when {
        t.exercicios.any { it.acao == "subir" } -> "subir"
        t.exercicios.any { it.acao == "repetir" } -> "repetir"
        t.exercicios.any { it.acao == "manter" } -> "manter"
        else -> null
    } ?: return null
    val n = t.exercicios.count { it.acao == acao }
    val texto = when (acao) {
        "subir" -> if (n > 0) "$n pra subir" else "dá pra subir"
        "repetir" -> if (n > 0) "$n pra firmar" else "firmar a carga"
        else -> "manter a carga"
    }
    val (fundo, tinta) = coresAcao(acao)
    return Triple(texto, fundo, tinta)
}

/** O dia de hoje está entre os dias em que esse treino costuma cair? */
private fun ehDeHoje(t: Treino, hoje: LocalDate): Boolean {
    val h = nomeChave(nomesCurtos[hoje.dayOfWeek.value - 1])
    return t.dias.any { nomeChave(it).take(3) == h }
}

/** Pílula menor que a padrão (grupo muscular, "hoje"). */
@Composable
internal fun PilulaMini(texto: String, fundo: Color = Cores.Trilho, tinta: Color = Cores.LilasTexto, modifier: Modifier = Modifier) {
    Text(
        texto, color = tinta, style = MaterialTheme.typography.labelSmall, maxLines = 1,
        modifier = modifier.clip(Formas.Pilula).background(fundo).padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/**
 * O cartão "Seus treinos": título, o recado do dia (contextoTreino.texto) e a grade de caixas. Sem Hevy ou sem treinos,
 * uma linha. `sugestoes` (sugestoesCarga) entram na folha, no exercício de mesmo nome.
 */
@Composable
internal fun CartaoTreinos(treinos: List<Treino>, temHevy: Boolean, hoje: LocalDate, recado: String?, sugestoes: List<JSONObject>) {
    var aberto by rememberSaveable { mutableStateOf<String?>(null) }
    Cartao(atraso = 30) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Mascote(Pose.CorgiHalter, 40.dp)
            Text("Seus treinos", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            if (treinos.isNotEmpty()) Text("8 semanas", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3)
        }
        if (recado != null && (treinos.isNotEmpty() || temHevy)) {
            Text(
                recado, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta, maxLines = 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clip(Formas.Pequeno).background(Color(0xFFF3EEFF)).padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
        when {
            treinos.isEmpty() -> Text(
                if (temHevy) "Nenhum treino repetido nas últimas 8 semanas." else "Conecte o Hevy para ver seus treinos.",
                style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(top = 8.dp),
            )
            else -> Column(Modifier.fillMaxWidth().padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                treinos.chunked(2).forEach { par ->
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        par.forEach { t -> CaixaTreino(t, ehDeHoje(t, hoje), Modifier.weight(1f).fillMaxHeight()) { aberto = t.id } }
                        if (par.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
    treinos.firstOrNull { it.id == aberto }?.let { t -> FolhaTreino(t, sugestoes) { aberto = null } }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CaixaTreino(t: Treino, hoje: Boolean, modifier: Modifier, aoTocar: () -> Unit) {
    val forma = RoundedCornerShape(22.dp)
    val proxima = proximaDe(t)
    Column(
        modifier.heightIn(min = 132.dp).clip(forma)
            .background(if (hoje) Color(0xFFF3EEFF) else Cores.Lavanda)
            .border(if (hoje) 2.dp else 1.dp, if (hoje) Cores.LilasForte else Cores.Lilas, forma)
            .clickable(role = Role.Button, onClickLabel = "Ver exercícios", onClick = aoTocar)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(t.titulo, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (t.dias.isNotEmpty() || hoje) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (t.dias.isNotEmpty()) Text(t.dias.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = Cores.AcaiEscuro, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (hoje) PilulaMini("hoje", Cores.Acai, Cores.Branco)
            }
        }
        t.ultimaData?.let { Text("última vez ${Formato.diaCurto(it)}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp) }
        if (t.grupos.isNotEmpty()) {
            FlowRow(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                t.grupos.take(3).forEach { PilulaMini(it) }
                if (t.grupos.size > 3) PilulaMini("+${t.grupos.size - 3}")
            }
        }
        Spacer(Modifier.weight(1f))
        proxima?.let { (texto, fundo, tinta) -> Pilula(texto, fundo, tinta, Modifier.padding(top = 6.dp)) }
    }
}

/** "Pegando 50 kg × 8 · 3 séries" (ou as repetições, quando é sem carga). */
private fun pegando(e: ExercicioTreino): String {
    val kg = e.pegandoKg?.takeIf { it > 0 }
    val base = when {
        kg != null -> "Pegando ${kgCurto(kg)}" + (e.pegandoReps?.let { " × $it" } ?: "")
        e.pegandoReps != null -> "Fazendo ${e.pegandoReps} repetições"
        else -> "Sem carga registrada"
    }
    val s = e.series?.takeIf { it > 0 }?.let { " · $it ${if (it == 1) "série" else "séries"}" } ?: ""
    return base + s
}

/** "Pode pegar 52,5 kg × 8" (ou "Pode fazer 13 repetições"; sem sugestão, a frase do servidor). */
private fun podePegar(e: ExercicioTreino): String? {
    val kg = e.sugeridoKg?.takeIf { it > 0 }
    return when {
        kg != null -> "Pode pegar ${kgCurto(kg)}" + (e.sugeridasReps?.let { " × $it" } ?: "")
        e.sugeridasReps != null -> "Pode fazer ${e.sugeridasReps} repetições"
        else -> e.frase
    }
}

/** À direita do "pode pegar": "+2,5 kg", "+1 rep" ou "mantém". */
private fun rotuloAcao(e: ExercicioTreino): String? = when (e.acao) {
    "subir" -> e.deltaKg?.takeIf { it > 0 }?.let { "+${kgCurto(it)}" } ?: "sobe"
    "repetir" -> {
        val mais = if (e.sugeridasReps != null && e.ultimasReps != null) e.sugeridasReps - e.ultimasReps else 1
        if (mais > 1) "+$mais reps" else "+1 rep"
    }
    "manter" -> "mantém"
    else -> null
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FolhaTreino(t: Treino, sugestoes: List<JSONObject>, aoFechar: () -> Unit) {
    ModalBottomSheet(onDismissRequest = aoFechar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Cores.Lavanda) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(start = 18.dp, end = 18.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(t.titulo, style = MaterialTheme.typography.headlineMedium)
                    val sub = listOfNotNull(
                        t.ultimaData?.let { "última vez ${Formato.diaCurto(it)}" },
                        t.dias.takeIf { it.isNotEmpty() }?.joinToString(" · "),
                        t.duracaoMin?.takeIf { it > 0 }?.let { "cerca de $it min" },
                    ).joinToString(" · ")
                    if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
                Mascote(Pose.CorgiHalter, 56.dp)
            }
            if (t.exercicios.isEmpty()) {
                Text("Sem exercícios com carga nesse treino.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
            }
            t.exercicios.forEach { e ->
                val chave = nomeChave(e.nome)
                CartaoExercicio(e, sugestoes.firstOrNull { nomeChave(it.str("exercicio")) == chave })
            }
        }
    }
}

/** A pílula do estado de uma meta da Nutri: batida = verde, tentando = âmbar, o resto = lilás. */
private fun pilulaMeta(status: String?): Triple<String, Color, Color> = when (status) {
    "batida" -> Triple("batida", Cores.BomFundo, Cores.BomTinta)
    "tentando" -> Triple("tentando", Cores.AtencaoFundo, Cores.AtencaoTinta)
    else -> Triple(status ?: "sugerida", Cores.Trilho, Cores.LilasTexto)
}

@Composable
private fun CartaoExercicio(e: ExercicioTreino, meta: JSONObject?) {
    val (fundo, tinta) = coresAcao(e.acao)
    Column(
        Modifier.fillMaxWidth().clip(Formas.Cartao).background(Cores.Branco).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(e.nome, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, modifier = Modifier.weight(1f, fill = false))
                e.grupo?.let { PilulaMini(it) }
            }
            Text(pegando(e), style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
            podePegar(e)?.let { texto ->
                Row(
                    Modifier.fillMaxWidth().clip(Formas.Pequeno).background(fundo).padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(texto, fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 17.sp, color = tinta, modifier = Modifier.weight(1f))
                    rotuloAcao(e)?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = tinta, maxLines = 1) }
                }
            }
            e.motivo?.let { Text(it.replaceFirstChar { c -> c.uppercase() } + (if (it.trimEnd().last() in ".!?") "" else "."), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        if (e.historico.size >= 2) HistoricoCarga(e.historico, e.sugeridoKg?.takeIf { e.acao == "subir" }, tinta)
        meta?.let { m ->
            val para = m.num("paraKg")?.let { kgCurto(it) + (m.int("paraReps")?.let { r -> " × $r" } ?: "") }
            if (para != null) {
                val (rot, f, tt) = pilulaMeta(m.str("status"))
                Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Meta da Nutri: $para", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.weight(1f))
                    Pilula(rot, f, tt)
                }
            }
        }
    }
}

/** Linha das cargas dos últimos treinos (até 8) e, quando é pra subir, o próximo passo tracejado na cor da ação. */
@Composable
private fun HistoricoCarga(h: List<CargaAntiga>, proximo: Double?, cor: Color) {
    val f = animaAte(1f, 800)
    val kgs = h.map { it.kg }
    val todos = kgs + listOfNotNull(proximo)
    val lo0 = todos.min()
    val hi0 = todos.max()
    val folga = maxOf((hi0 - lo0) * 0.15, 1.0)
    val lo = lo0 - folga
    val hi = hi0 + folga
    val desc = "Carga nos últimos ${h.size} treinos: de ${kgCurto(kgs.first())} para ${kgCurto(kgs.last())}" + (proximo?.let { ". Próximo: ${kgCurto(it)}" } ?: "")
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Canvas(Modifier.fillMaxWidth().height(52.dp).semantics { contentDescription = desc }) {
            val pad = 6.dp.toPx()
            val n = todos.size
            fun x(i: Int) = if (n <= 1) size.width / 2 else pad + i * (size.width - 2 * pad) / (n - 1)
            fun y(v: Double) = (pad + (1 - (v - lo) / (hi - lo)) * (size.height - 2 * pad)).toFloat()
            drawLine(Cores.Trilho, Offset(0f, size.height - 1.dp.toPx()), Offset(size.width, size.height - 1.dp.toPx()), 1.dp.toPx())
            val caminho = Path()
            kgs.forEachIndexed { i, v -> if (i == 0) caminho.moveTo(x(i), y(v)) else caminho.lineTo(x(i), y(v)) }
            drawPath(caminho, Cores.LilasForte, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round), alpha = f)
            if (proximo != null) {
                val a = Offset(x(kgs.size - 1), y(kgs.last()))
                val b = Offset(x(kgs.size), y(proximo))
                drawLine(cor, a, b, 2.5.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx())), alpha = f)
                drawCircle(Cores.Branco, 5.dp.toPx(), b, alpha = f)
                drawCircle(cor, 5.dp.toPx(), b, style = Stroke(2.dp.toPx()), alpha = f)
            }
            kgs.forEachIndexed { i, v ->
                val c = Offset(x(i), y(v))
                val ultimo = i == kgs.size - 1
                val r = (if (ultimo) 4.5f else 3f).dp.toPx()
                drawCircle(Cores.Branco, r + 1.5.dp.toPx(), c, alpha = f)
                drawCircle(if (ultimo) Cores.Acai else Cores.LilasForte, r, c, alpha = f)
            }
        }
        Text(
            "${kgCurto(kgs.first())} → ${kgCurto(kgs.last())} em ${h.size} treinos",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp,
            // o Canvas acima já descreve a mesma coisa para o leitor de tela
            modifier = Modifier.clearAndSetSemantics {},
        )
    }
}
