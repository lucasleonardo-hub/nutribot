package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import org.json.JSONObject
import java.time.LocalDate

/*
 * "Sua rotina" (fase 5): um item por dia da semana com treino nas últimas 4 semanas (contrato em
 * docs/app/2026-10-14-plano-fase5.md). Por exercício, a `frase` pronta do servidor é o destaque
 * ("Pegava 50 kg × 8. Próximo treino: +2 kg = 52 kg.") e, à direita, a carga de antes → a sugerida com a ação.
 */

/** exercicios[i]: { nome, grupo, ultimoKg, ultimasReps, series, sugeridoKg, deltaKg, sugeridasReps, acao, motivo, frase } */
internal data class ExercicioRotina(
    val nome: String,
    val grupo: String?,
    val ultimoKg: Double?,
    val ultimasReps: Int?,
    val series: Int?,
    val sugeridoKg: Double?,
    val deltaKg: Double?,
    val sugeridasReps: Int?,
    val acao: String?,
    val frase: String?,
)

/** rotina[i]: { diaSemana 1..7 (1 = segunda), nome, titulo, ultimaData, sessoes, exercicios } */
internal data class DiaRotina(
    val diaSemana: Int,
    val nome: String,
    val titulo: String?,
    val ultimaData: LocalDate?,
    val sessoes: Int,
    val exercicios: List<ExercicioRotina>,
)

private val nomesCurtos = listOf("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")

internal fun rotinaDe(j: JSONObject?): List<DiaRotina> = j.arr("rotina").objs().mapNotNull { d ->
    val dia = d.int("diaSemana")?.takeIf { it in 1..7 } ?: return@mapNotNull null
    DiaRotina(
        diaSemana = dia,
        nome = d.str("nome") ?: nomesCurtos[dia - 1],
        titulo = d.str("titulo"),
        ultimaData = Formato.dia(d.str("ultimaData")),
        sessoes = d.int("sessoes") ?: 0,
        exercicios = d.arr("exercicios").objs().map { e ->
            ExercicioRotina(
                nome = e.str("nome") ?: "Exercício",
                grupo = e.str("grupo"),
                ultimoKg = e.num("ultimoKg"),
                ultimasReps = e.int("ultimasReps"),
                series = e.int("series"),
                sugeridoKg = e.num("sugeridoKg"),
                deltaKg = e.num("deltaKg"),
                sugeridasReps = e.int("sugeridasReps"),
                acao = e.str("acao"),
                frase = e.str("frase"),
            )
        },
    )
}.sortedBy { it.diaSemana }

/** "50 kg" ou "52,5 kg": sem casa decimal quando a carga é inteira. */
internal fun kgCurto(v: Double): String = Formato.decimal(v, if (v % 1.0 == 0.0) 0 else 1) + " kg"

/** A pílula da ação: subir = verde "sobe", manter = âmbar "mantém", repetir = lilás "mais 1 rep". */
private fun pilulaAcao(e: ExercicioRotina): Triple<String, Color, Color>? = when (e.acao) {
    "subir" -> Triple("sobe", Cores.BomFundo, Cores.BomTinta)
    "manter" -> Triple("mantém", Cores.AtencaoFundo, Cores.AtencaoTinta)
    "repetir" -> {
        val mais = if (e.sugeridasReps != null && e.ultimasReps != null) e.sugeridasReps - e.ultimasReps else 1
        Triple(if (mais > 1) "mais $mais reps" else "mais 1 rep", Cores.Trilho, Cores.LilasTexto)
    }
    else -> null
}

/** O dia pré-selecionado: hoje, se tiver treino; senão o próximo dia da semana com treino. */
private fun diaInicial(rotina: List<DiaRotina>, hoje: LocalDate): Int {
    if (rotina.isEmpty()) return 0
    val h = hoje.dayOfWeek.value // 1 = segunda
    rotina.indexOfFirst { it.diaSemana == h }.takeIf { it >= 0 }?.let { return it }
    rotina.indexOfFirst { it.diaSemana > h }.takeIf { it >= 0 }?.let { return it }
    return 0
}

/** Pílula menor que a padrão, para o grupo muscular ao lado do nome do exercício. */
@Composable
internal fun PilulaMini(texto: String, fundo: Color = Cores.Trilho, tinta: Color = Cores.LilasTexto, modifier: Modifier = Modifier) {
    Text(
        texto, color = tinta, style = MaterialTheme.typography.labelSmall, maxLines = 1,
        modifier = modifier.clip(Formas.Pilula).background(fundo).padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
internal fun CartaoRotina(rotina: List<DiaRotina>, hoje: LocalDate) {
    Cartao(atraso = 30) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Mascote(Pose.CorgiHalter, 40.dp)
            Text("Sua rotina", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            if (rotina.isNotEmpty()) Text("4 semanas", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3)
        }
        if (rotina.isEmpty()) {
            Text("Sem treino nas últimas 4 semanas.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(top = 8.dp))
            return@Cartao
        }
        val chave = rotina.joinToString(",") { it.diaSemana.toString() }
        var sel by rememberSaveable(chave) { mutableIntStateOf(diaInicial(rotina, hoje)) }
        val dia = rotina[sel.coerceIn(0, rotina.size - 1)]

        Row(
            Modifier.fillMaxWidth().padding(top = 10.dp).horizontalScroll(rememberScrollState()).semantics { contentDescription = "Dias com treino" },
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            rotina.forEachIndexed { i, d -> Chip(nomesCurtos[d.diaSemana - 1], i == sel, papel = Role.Tab) { sel = i } }
        }

        Text(dia.titulo ?: dia.nome, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
        Text(
            listOfNotNull(
                dia.ultimaData?.let { "última vez ${Formato.diaCurto(it)}" },
                "${dia.sessoes} ${if (dia.sessoes == 1) "sessão" else "sessões"} em 4 semanas",
            ).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3,
        )

        if (dia.exercicios.isEmpty()) {
            Text("Sem exercícios registrados nesse dia.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 8.dp))
            return@Cartao
        }
        dia.exercicios.forEachIndexed { i, e ->
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Cores.Trilho))
            LinhaExercicio(e)
        }
    }
}

@Composable
private fun LinhaExercicio(e: ExercicioRotina) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 10.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(e.nome, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f, fill = false))
                e.grupo?.let { PilulaMini(it) }
            }
            val frase = e.frase ?: fraseLocal(e)
            if (frase != null) Text(frase, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta)
            e.series?.takeIf { it > 0 }?.let { Text("$it ${if (it == 1) "série" else "séries"}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 12.sp) }
        }
        BlocoCarga(e)
    }
}

/** Sem `frase` do servidor (versão antiga), uma frase curta montada aqui com os números que vieram. */
private fun fraseLocal(e: ExercicioRotina): String? {
    val de = e.ultimoKg ?: return null
    val antes = "Pegava ${kgCurto(de)}" + (e.ultimasReps?.let { " × $it" } ?: "") + "."
    val para = e.sugeridoKg ?: return antes
    return when {
        para > de -> "$antes Próximo treino: ${Formato.sinal(para - de, if ((para - de) % 1.0 == 0.0) 0 else 1)} kg = ${kgCurto(para)}."
        e.sugeridasReps != null && e.ultimasReps != null && e.sugeridasReps > e.ultimasReps -> "$antes Próximo treino: ${kgCurto(para)}, tenta ${e.sugeridasReps} repetições."
        else -> "$antes Próximo treino: mantém ${kgCurto(para)}."
    }
}

/** À direita: "50 → 52 kg" (ou só a carga, quando não muda), as repetições sugeridas e a pílula da ação. */
@Composable
private fun BlocoCarga(e: ExercicioRotina) {
    val acao = pilulaAcao(e)
    val de = e.ultimoKg
    val para = e.sugeridoKg
    val carga = when {
        de != null && para != null && para != de -> "${Formato.decimal(de, if (de % 1.0 == 0.0) 0 else 1)} → ${kgCurto(para)}"
        para != null -> kgCurto(para)
        de != null -> kgCurto(de)
        else -> "sem carga"
    }
    Column(Modifier.widthIn(min = 72.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(carga, fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 16.sp, color = acao?.third ?: Cores.Tinta2, maxLines = 1)
        e.sugeridasReps?.let { Text("× $it", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3) }
        acao?.let { (rot, fundo, tinta) -> Pilula(rot, fundo, tinta) }
    }
}
