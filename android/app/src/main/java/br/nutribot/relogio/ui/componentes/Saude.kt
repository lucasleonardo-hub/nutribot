package br.nutribot.relogio.ui.componentes

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import org.json.JSONObject
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/*
 * Peças do sono, da energia e da atividade (fase 6). A informação vem do relógio (Health Connect); a organização se
 * inspira nos apps de saúde (número grande + rótulo, grade de fatores com pílula, barras por hora, fases da noite,
 * anéis com meta), mas o visual é o nosso: pastel claro, cantos redondos, Fredoka.
 */

/** Cores dos anéis de atividade (do tema): passos menta, minutos ativos céu, kcal ativas pêssego. */
object CoresAtividade {
    val Passos = Cores.Verde
    val Minutos = Cores.Fibra
    val Kcal = Cores.Proteina
    val PassosTinta = Cores.GorduraTinta
    /** Tom escuro do céu (Fibra), só para texto: o céu claro não tem contraste sobre o branco. */
    val MinutosTinta = Color(0xFF2B6CB0)
    val KcalTinta = Cores.ProteinaTinta
}

/** Cores das fases do sono: acordado pêssego, REM céu, leve lilás, profundo açaí. */
object CoresFase {
    fun cor(t: String?): Color = when (t) {
        "acordado" -> Cores.Proteina
        "rem" -> Cores.Fibra
        "profundo" -> Cores.AcaiEscuro
        else -> Cores.LilasForte
    }

    fun tinta(t: String?): Color = when (t) {
        "acordado" -> Cores.ProteinaTinta
        "rem" -> CoresAtividade.MinutosTinta
        "profundo" -> Cores.AcaiEscuro
        else -> Cores.LilasTexto
    }

    fun nome(t: String?): String = when (t) {
        "acordado" -> "Acordado"
        "rem" -> "REM"
        "profundo" -> "Profundo"
        else -> "Leve"
    }

    /** De cima para baixo no gráfico da noite. */
    val ordem = listOf("acordado", "rem", "leve", "profundo")
}

/** Texto, fundo e tinta da pílula de um nível (fator) ou rótulo (nota). */
data class Nivel(val texto: String, val fundo: Color, val tinta: Color)

fun nivelDe(n: String?): Nivel? = when (n?.lowercase()) {
    "excelente" -> Nivel("Excelente", Cores.Lilas, Cores.LilasTexto)
    "bom" -> Nivel("Bom", Cores.BomFundo, Cores.BomTinta)
    "boa" -> Nivel("Boa", Cores.BomFundo, Cores.BomTinta)
    "razoavel", "razoável" -> Nivel("Razoável", Cores.AtencaoFundo, Cores.AtencaoTinta)
    "atencao", "atenção" -> Nivel("Atenção", Cores.CuidadoFundo, Cores.CuidadoTinta)
    else -> null
}

/** O rótulo de uma nota de 0 a 100, quando o servidor não mandou: 85 excelente, 70 boa, 55 razoável. */
fun rotuloDaNota(nota: Double?): String? = when {
    nota == null -> null
    nota >= 85 -> "excelente"
    nota >= 70 -> "boa"
    nota >= 55 -> "razoavel"
    else -> "atencao"
}

/** Cor de preenchimento (barras, anéis) pela nota: excelente lilás, boa menta, razoável manteiga, atenção pêssego. */
fun corDaNota(nota: Double?): Color = when {
    nota == null -> Cores.Cinza
    nota >= 85 -> Cores.LilasForte
    nota >= 70 -> Cores.Verde
    nota >= 55 -> Cores.Carbo
    else -> Cores.Proteina
}

/** Mascote pela nota (energia, sono). */
fun poseDaNota(nota: Double?): Pose = when {
    nota == null -> Pose.DuplaDescansando
    nota >= 85 -> Pose.CorgiFesta
    nota >= 70 -> Pose.DuplaFeliz
    nota >= 55 -> Pose.CorgiCansado
    else -> Pose.CorgiDormindo
}

/** "40 min" abaixo de uma hora; "6h32" daí para cima. */
fun duracaoCurta(min: Double?): String = when {
    min == null || !min.isFinite() || min < 0 -> "—"
    min < 60 -> "${min.roundToInt()} min"
    else -> Formato.sono(min)
}

/** "HH:MM" em minutos do dia. */
fun minutosDoDia(s: String?): Int? {
    val h = Formato.hora(s) ?: return null
    val p = h.split(':')
    val hh = p.getOrNull(0)?.toIntOrNull() ?: return null
    val mm = p.getOrNull(1)?.toIntOrNull() ?: return null
    return (hh * 60 + mm).coerceIn(0, 24 * 60 - 1)
}

/** "dormiu 6h32 · 22:45–05:57" (o que houver). */
fun linhaDormiu(dormidoMin: Double?, inicio: String?, fim: String?): String? {
    val partes = listOfNotNull(
        dormidoMin?.takeIf { it > 0 }?.let { "dormiu ${duracaoCurta(it)}" },
        if (inicio != null && fim != null) "$inicio–$fim" else null,
    )
    return partes.joinToString(" · ").ifBlank { null }
}

/** "Hoje", "Ontem" ou "terça, 13 de outubro". */
fun rotuloDia(dia: LocalDate, hoje: LocalDate): String = when (dia) {
    hoje -> "Hoje"
    hoje.minusDays(1) -> "Ontem"
    else -> Formato.diaLongo(dia).replaceFirstChar { it.uppercase() }
}

private val setaVariacao = icone("M12 19V5", "M6 11l6-6 6 6")
private val setaDireita = icone("M9 6l6 6-6 6")
private val setaEsquerda = icone("M15 6l-6 6 6 6")

/** Título pequeno de um cartão que abre outra tela, com a seta à direita. */
@Composable
fun TituloCartao(titulo: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(titulo, style = MaterialTheme.typography.titleMedium, color = Cores.Tinta3, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Icon(setaDireita, contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(20.dp))
    }
}

/** Seta da variação contra a semana: para cima verde, para baixo coral, com o número de pontos. */
@Composable
fun Variacao(v: Double?, modifier: Modifier = Modifier) {
    if (v == null || !v.isFinite()) return
    val r = v.roundToInt()
    if (r == 0) {
        Text("igual à semana", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = modifier)
        return
    }
    val sobe = r > 0
    val tinta = if (sobe) Cores.BomTinta else Cores.CuidadoTinta
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Icon(setaVariacao, contentDescription = null, tint = tinta, modifier = Modifier.size(14.dp).rotate(if (sobe) 0f else 180f))
        Text("${abs(r)}", style = MaterialTheme.typography.labelLarge, color = tinta)
    }
}

/**
 * Nota grande (0 a 100) com a variação e o rótulo em pílula ao lado, e o mascote à direita.
 * O leitor de tela ouve uma frase só: "Sono 78 de 100, boa, 7 pontos abaixo da média da semana".
 */
@Composable
fun NotaGrande(
    nota: Double?,
    rotulo: String?,
    variacao: Double?,
    modifier: Modifier = Modifier,
    nome: String = "Nota",
    pose: Pose? = null,
    tamanhoNumero: TextUnit = 64.sp,
    alturaMascote: Dp = 72.dp,
) {
    val nivel = nivelDe(rotulo ?: rotuloDaNota(nota))
    val desc = buildString {
        append(nome).append(' ')
        if (nota == null) append("sem nota") else append("${Formato.inteiro(nota)} de 100")
        nivel?.let { append(", ").append(it.texto.lowercase()) }
        variacao?.takeIf { it.isFinite() && it.roundToInt() != 0 }?.let {
            val p = abs(it.roundToInt())
            append(", $p ${if (p == 1) "ponto" else "pontos"} ${if (it > 0) "acima" else "abaixo"} da média da semana")
        }
    }
    Row(
        modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = desc },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(nota?.let { Formato.inteiro(it) } ?: "—", fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = tamanhoNumero, lineHeight = tamanhoNumero, color = Cores.Tinta)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Variacao(variacao)
            nivel?.let { Pilula(it.texto, it.fundo, it.tinta) }
        }
        if (pose != null) Mascote(pose, alturaMascote)
    }
}

/**
 * Grade 2×N de fatores { id, nome, valor, nivel, explicacao }: nome, valor (opcional) e a pílula do nível.
 * Com `comExplicacao`, tocar num fator abre a explicação logo abaixo da linha dele (tocar de novo fecha).
 * Sem ela, as células não são tocáveis (o cartão em volta é que abre a tela).
 */
@Composable
fun GradeFatores(
    fatores: List<JSONObject>,
    chave: String,
    modifier: Modifier = Modifier,
    comValor: Boolean = true,
    comExplicacao: Boolean = true,
    fundoCelula: Color = Cores.Branco,
) {
    if (fatores.isEmpty()) return
    var aberto by rememberSaveable(chave) { mutableStateOf<String?>(null) }
    fun idDe(f: JSONObject, i: Int) = f.str("id") ?: f.str("nome") ?: "f$i"
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        fatores.withIndex().chunked(2).forEach { par ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                par.forEach { (i, f) ->
                    val id = idDe(f, i)
                    val ativo = comExplicacao && aberto == id
                    CelulaFator(
                        f, comValor, ativo, fundoCelula,
                        aoTocar = if (comExplicacao && f.str("explicacao") != null) ({ aberto = if (ativo) null else id }) else null,
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    )
                }
                if (par.size == 1) Spacer(Modifier.weight(1f))
            }
            if (comExplicacao) {
                par.firstOrNull { (i, f) -> idDe(f, i) == aberto }?.let { (_, f) ->
                    val nivel = nivelDe(f.str("nivel"))
                    Column(
                        Modifier.fillMaxWidth().clip(Formas.Pequeno).background(nivel?.fundo ?: Cores.Trilho).padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(f.str("nome") ?: "Fator", style = MaterialTheme.typography.labelLarge, color = nivel?.tinta ?: Cores.LilasTexto)
                        Text(semZap(f.str("explicacao") ?: ""), style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                    }
                }
            }
        }
    }
}

@Composable
private fun CelulaFator(f: JSONObject, comValor: Boolean, ativo: Boolean, fundo: Color, aoTocar: (() -> Unit)?, modifier: Modifier) {
    val nome = f.str("nome") ?: "Fator"
    val valor = f.str("valor")?.let { semZap(it) }?.takeIf { it.isNotBlank() }
    val nivel = nivelDe(f.str("nivel"))
    var m = modifier.heightIn(min = 48.dp).clip(Formas.Pequeno).background(fundo)
        .border(if (ativo) 2.dp else 1.dp, if (ativo) Cores.LilasForte else Cores.Trilho, Formas.Pequeno)
    if (aoTocar != null) m = m.clickable(role = Role.Button, onClickLabel = if (ativo) "Fechar a explicação" else "Ver a explicação", onClick = aoTocar).semantics { selected = ativo }
    Column(m.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(nome, style = MaterialTheme.typography.labelLarge, color = Cores.Tinta2, maxLines = 2, overflow = TextOverflow.Ellipsis)
        // valor em até 2 linhas ("12.345 passos · 45 min" não cabe em meia largura); "sem dado" aparece uma vez só
        val semDado = valor == null || valor.equals("sem dado", ignoreCase = true)
        val mostraValor = comValor && !semDado
        if (mostraValor) Text(valor!!, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.weight(1f))
        if (nivel != null) Pilula(nivel.texto, nivel.fundo, nivel.tinta)
        else if (!mostraValor) Text("sem dado", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
    }
}

/** Cartão curto de uma medida (FC no sono, VFC, gasto total): título pequeno, valor grande, uma linha de apoio. */
@Composable
fun CartaoMedida(titulo: String, valor: String, sub: String?, modifier: Modifier = Modifier, cor: Color = Cores.Branco) {
    Column(
        modifier.clip(Formas.Cartao).background(cor).padding(14.dp).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(titulo, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(valor, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** As partes de uma nota (energia: sono, recuperação, carga) em barras de 0 a 100. */
@Composable
fun BarrasPartes(partes: List<Triple<String, Double?, Color>>, modifier: Modifier = Modifier, trilho: Color = Cores.Trilho) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        partes.forEachIndexed { i, (nome, v, cor) ->
            val f = animaAte(((v ?: 0.0) / 100).toFloat().coerceIn(0f, 1f), 900, 150 + i * 80)
            Column(
                Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "$nome ${v?.let { Formato.inteiro(it) + " de 100" } ?: "sem dado"}" },
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Row {
                    Text(nome, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                    Text(v?.let { Formato.inteiro(it) } ?: "—", style = MaterialTheme.typography.labelLarge, color = Cores.Tinta2)
                }
                Box(Modifier.fillMaxWidth().height(10.dp).clip(Formas.Pilula).background(trilho)) {
                    Box(Modifier.fillMaxWidth(f).height(10.dp).clip(Formas.Pilula).background(cor))
                }
            }
        }
    }
}

/** Uma parte (sono, recuperacao, carga) que pode vir como número ou como { nota|valor|pct }. */
fun parteDe(o: JSONObject?, chave: String): Double? = o.num(chave) ?: o.obj(chave).num("nota", "valor", "pct")

/**
 * Três anéis concêntricos: passos (fora), minutos ativos (meio), kcal ativas (dentro). Frações da meta; passou da meta,
 * a segunda volta sai num tom mais escuro (até duas voltas).
 */
@Composable
fun AneisAtividade(
    passos: Float,
    minutos: Float,
    kcal: Float,
    tamanho: Dp,
    descricao: String?,
    modifier: Modifier = Modifier,
    espessuraRel: Float = 0.1f,
) {
    val fp = animaAte(passos.coerceIn(0f, 2f))
    val fm = animaAte(minutos.coerceIn(0f, 2f), atraso = 120)
    val fk = animaAte(kcal.coerceIn(0f, 2f), atraso = 240)
    val m = modifier.size(tamanho).let { if (descricao != null) it.semantics { contentDescription = descricao } else it }
    Canvas(m) {
        val esp = size.minDimension * espessuraRel
        val folga = esp * 0.25f
        listOf(fp to CoresAtividade.Passos, fm to CoresAtividade.Minutos, fk to CoresAtividade.Kcal).forEachIndexed { i, (f, cor) ->
            val r = size.minDimension / 2 - esp / 2 - i * (esp + folga)
            if (r <= 0f) return@forEachIndexed
            drawCircle(cor.copy(alpha = 0.22f), r, center, style = Stroke(esp))
            if (f > 0.005f) arcoAnel(r, esp, 360f * f.coerceAtMost(1f), cor)
            if (f > 1f) arcoAnel(r, esp, 360f * (f - 1f).coerceAtMost(1f), lerp(cor, Color.Black, 0.2f))
        }
    }
}

private fun DrawScope.arcoAnel(r: Float, esp: Float, varredura: Float, cor: Color) {
    drawArc(
        cor, startAngle = -90f, sweepAngle = varredura, useCenter = false,
        topLeft = Offset(center.x - r, center.y - r), size = Size(r * 2, r * 2),
        style = Stroke(width = esp, cap = StrokeCap.Round),
    )
}

/** Fração da meta (0 quando falta valor ou meta). */
fun fracao(v: Double?, meta: Double?): Float = if (v == null || meta == null || meta <= 0) 0f else (v / meta).toFloat().coerceIn(0f, 2f)

/** Número de um anel com a meta embaixo ("7.951 / 8.000"), o nome na cor do anel. */
@Composable
fun NumeroMeta(nome: String, valor: Double?, meta: Double?, unidade: String?, tinta: Color, modifier: Modifier = Modifier, fundo: Color = Cores.Lavanda) {
    val desc = "$nome ${Formato.inteiro(valor)}${unidade?.let { " $it" } ?: ""} de ${Formato.inteiro(meta)}"
    Column(
        modifier.clip(Formas.Pequeno).background(fundo).padding(horizontal = 6.dp, vertical = 10.dp).clearAndSetSemantics { contentDescription = desc },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(nome, style = MaterialTheme.typography.labelMedium, color = tinta, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.Bottom) {
            Text(Formato.inteiro(valor), fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 22.sp, color = Cores.Tinta, maxLines = 1)
            if (unidade != null) Text(" $unidade", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(bottom = 2.dp))
        }
        Text("/${Formato.inteiro(meta)}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
    }
}

/**
 * A semana em mini-anéis: `semana` = [{ dia, passosPct, minPct, kcalPct }]. Com `aoEscolher`, cada dia é tocável (48 dp de altura; a largura é 1/7 do cartão, cerca de 40 dp num celular de 360 dp)
 * e o escolhido ganha fundo; sem, é só leitura (o cartão do Hoje abre a tela inteira).
 */
@Composable
fun SemanaAneis(semana: List<JSONObject>, selecionado: String?, modifier: Modifier = Modifier, aoEscolher: ((String) -> Unit)? = null) {
    if (semana.isEmpty()) return
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        semana.take(7).forEach { s ->
            val diaStr = s.str("dia") ?: return@forEach
            val d = Formato.dia(diaStr)
            val ativo = diaStr == selecionado
            val fp = (s.num("passosPct") ?: 0.0).toFloat()
            val fm = (s.num("minPct") ?: 0.0).toFloat()
            val fk = (s.num("kcalPct") ?: 0.0).toFloat()
            val desc = (d?.let { Formato.diaLongo(it) } ?: diaStr) +
                ": passos ${(fp * 100).roundToInt()}%, minutos ativos ${(fm * 100).roundToInt()}%, calorias ${(fk * 100).roundToInt()}% da meta"
            var m = Modifier.weight(1f).heightIn(min = 48.dp).clip(Formas.Pequeno).background(if (ativo) Cores.Trilho else Color.Transparent)
            if (aoEscolher != null) m = m.clickable(role = Role.RadioButton, onClickLabel = "Ver este dia") { aoEscolher(diaStr) }
            Column(
                m.clearAndSetSemantics { contentDescription = desc; selected = ativo }.padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(d?.let { Formato.semanaCurta(it) } ?: "", style = MaterialTheme.typography.labelSmall, color = if (ativo) Cores.AcaiEscuro else Cores.Tinta3)
                AneisAtividade(fp, fm, fk, 34.dp, null, espessuraRel = 0.14f)
            }
        }
    }
}

/** "07:00–08:00" da hora com mais movimento (null quando tudo é zero). */
fun picoDe(v: List<Double>): String? {
    val i = v.indices.maxByOrNull { v[it] } ?: return null
    if (v[i] <= 0) return null
    return "%02d:00–%02d:00".format(i, (i + 1) % 24)
}

/** 24 barras por hora com o eixo 0h, 6h, 12h, 18h e "mais ativo: 07:00–08:00". Hora sem dado = sem barra. */
@Composable
fun BarrasHora(titulo: String, valores: List<Double>, cor: Color, unidade: String, pico: String?, modifier: Modifier = Modifier) {
    val f = animaAte(1f, 900)
    val maximo = valores.maxOrNull() ?: 0.0
    val picoTxt = pico ?: picoDe(valores)
    val total = valores.sum()
    val desc = "$titulo por hora. " + (if (picoTxt != null) "Mais ativo das ${picoTxt.replace("–", " às ")}. Total ${Formato.inteiro(total)} $unidade." else "Sem movimento registrado.")
    Column(modifier.fillMaxWidth()) {
        Text(titulo, style = MaterialTheme.typography.titleMedium)
        Text(if (picoTxt != null) "mais ativo: $picoTxt" else "sem movimento registrado", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        Canvas(Modifier.fillMaxWidth().padding(top = 8.dp).height(96.dp).semantics { contentDescription = desc }) {
            val n = 24
            val passo = size.width / n
            val larg = passo * 0.56f
            val base = size.height - 1.dp.toPx()
            drawLine(Cores.Cinza, Offset(0f, base), Offset(size.width, base), strokeWidth = 1.dp.toPx())
            for (k in 1..3) {
                val x = size.width * k / 4f
                drawLine(Cores.Cinza, Offset(x, base), Offset(x, base - 4.dp.toPx()), strokeWidth = 1.dp.toPx())
            }
            if (maximo <= 0) return@Canvas
            valores.take(n).forEachIndexed { i, v ->
                if (v > 0) {
                    val h = ((v / maximo).toFloat() * (base - 2.dp.toPx()) * f).coerceAtLeast(2.dp.toPx())
                    drawRoundRect(cor, topLeft = Offset(i * passo + (passo - larg) / 2, base - h), size = Size(larg, h), cornerRadius = CornerRadius(larg / 2))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
            listOf("0h", "6h", "12h", "18h").forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = Cores.Tinta3, modifier = Modifier.weight(1f)) }
        }
    }
}

/** Uma etapa da noite em minutos desde o início da sessão. */
private data class EtapaNoite(val ini: Int, val fim: Int, val t: String)

/**
 * As fases ao longo da noite em degraus: acordado em cima, depois REM, leve e profundo embaixo; cada etapa é um bloco
 * da cor da fase e um fio liga a etapa à seguinte. `etapas` = [{ ini: "HH:MM", fim: "HH:MM", t }]. Eixo com 4 horários.
 */
@Composable
fun Hipnograma(etapas: List<JSONObject>, inicio: String?, fim: String?, descricao: String, modifier: Modifier = Modifier) {
    val ini0 = minutosDoDia(inicio) ?: etapas.firstNotNullOfOrNull { minutosDoDia(it.str("ini")) } ?: return
    fun rel(m: Int) = ((m - ini0) % 1440 + 1440) % 1440
    val brutas = etapas.mapNotNull { e ->
        val a = minutosDoDia(e.str("ini")) ?: return@mapNotNull null
        val b = minutosDoDia(e.str("fim")) ?: return@mapNotNull null
        val t = e.str("t")?.lowercase() ?: return@mapNotNull null
        val ra = rel(a)
        EtapaNoite(ra, max(rel(b), ra), t)
    }.filter { it.ini < 18 * 60 } // etapa "antes" do início daria a volta no relógio
    val total = (minutosDoDia(fim)?.let { rel(it) }?.takeIf { it > 0 } ?: brutas.maxOfOrNull { it.fim } ?: return).coerceAtLeast(1)
    val lista = brutas.filter { it.ini < total }.sortedBy { it.ini }
    if (lista.isEmpty()) return
    val f = animaAte(1f, 1200)
    val altura = 132.dp * LocalDensity.current.fontScale.coerceIn(1f, 1.3f)
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth()) {
            Column(Modifier.width(72.dp).height(altura)) {
                CoresFase.ordem.forEach { t ->
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                        Text(CoresFase.nome(t), style = MaterialTheme.typography.labelSmall, color = CoresFase.tinta(t), maxLines = 1)
                    }
                }
            }
            Canvas(Modifier.weight(1f).height(altura).semantics { contentDescription = descricao }) {
                val linhaH = size.height / 4
                val barH = linhaH * 0.62f
                val guia = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))
                for (k in 0..3) {
                    val y = linhaH * k + linhaH / 2
                    drawLine(Cores.Trilho, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx(), pathEffect = guia)
                }
                fun x(m: Int) = m.toFloat() / total * size.width
                clipRect(right = size.width * f) {
                    var anterior: Int? = null
                    lista.forEach { e ->
                        val k = CoresFase.ordem.indexOf(e.t).takeIf { it >= 0 } ?: 2
                        val x0 = x(e.ini)
                        val x1 = max(x(e.fim), x0 + 1.5.dp.toPx())
                        val ka = anterior
                        if (ka != null && ka != k) {
                            drawLine(Cores.LilasMedio, Offset(x0, linhaH * ka + linhaH / 2), Offset(x0, linhaH * k + linhaH / 2), strokeWidth = 1.5.dp.toPx())
                        }
                        val y = linhaH * k + (linhaH - barH) / 2
                        drawRoundRect(CoresFase.cor(e.t), topLeft = Offset(x0, y), size = Size(x1 - x0, barH), cornerRadius = CornerRadius(min(barH / 3, (x1 - x0) / 2)))
                        anterior = k
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(start = 72.dp, top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            (0..3).forEach { i ->
                val m = (ini0 + total * i / 3) % 1440
                Text("%02d:%02d".format(m / 60, m % 60), style = MaterialTheme.typography.labelSmall, color = Cores.Tinta3)
            }
        }
    }
}

/**
 * Barra de uma fase: "REM 21%" e a duração; a barra cheia até a % da noite e, por cima, a faixa típica de adultos
 * hachurada e translúcida. `escala` = a % do fim da barra (a mesma para as quatro fases).
 */
@Composable
fun BarraFase(t: String, pct: Double?, min: Double?, tipMin: Double?, tipMax: Double?, escala: Double, atraso: Int = 0) {
    val cor = CoresFase.cor(t)
    val tinta = CoresFase.tinta(t)
    val nome = CoresFase.nome(t)
    val f = animaAte(((pct ?: 0.0) / escala).toFloat().coerceIn(0f, 1f), 900, atraso)
    val temTipica = tipMin != null && tipMax != null && tipMax > tipMin
    val desc = "$nome ${pct?.let { "${it.roundToInt()}% da noite" } ?: "sem dado"}, ${duracaoCurta(min)}" +
        (if (temTipica) ", faixa típica de ${tipMin!!.roundToInt()} a ${tipMax!!.roundToInt()}%" else "")
    Column(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = desc }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(nome, style = MaterialTheme.typography.labelLarge)
            Text("  ${pct?.let { "${it.roundToInt()}%" } ?: "—"}", style = MaterialTheme.typography.labelLarge, color = tinta)
            Spacer(Modifier.weight(1f))
            Text(duracaoCurta(min), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
        }
        Canvas(Modifier.fillMaxWidth().height(14.dp)) {
            val r = CornerRadius(size.height / 2)
            drawRoundRect(Cores.Trilho, cornerRadius = r)
            if (f > 0f) drawRoundRect(cor, size = Size(max(size.width * f, size.height), size.height), cornerRadius = r)
            if (temTipica) {
                val a = (tipMin!! / escala).toFloat().coerceIn(0f, 1f) * size.width
                val b = (tipMax!! / escala).toFloat().coerceIn(0f, 1f) * size.width
                clipRect(left = a, right = b) {
                    drawRoundRect(tinta.copy(alpha = 0.14f), cornerRadius = r)
                    hachura(tinta.copy(alpha = 0.5f), 5.dp.toPx(), 1.2.dp.toPx())
                }
            }
        }
    }
}

/** Legenda "faixa típica" com a amostra hachurada. */
@Composable
fun LegendaTipica(modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.size(width = 18.dp, height = 12.dp).clip(RoundedCornerShape(3.dp))) {
            drawRect(Cores.Tinta3.copy(alpha = 0.14f))
            hachura(Cores.Tinta3.copy(alpha = 0.6f), 4.dp.toPx(), 1.dp.toPx())
        }
        Text("faixa típica", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
    }
}

private fun DrawScope.hachura(cor: Color, passo: Float, largura: Float) {
    var x = -size.height
    while (x < size.width) {
        drawLine(cor, Offset(x, size.height), Offset(x + size.height, 0f), strokeWidth = largura)
        x += passo
    }
}

/**
 * Os 7 dias numa linha com o valor escrito em cima de cada ponto (nota de 0 a 100); dia sem nota = buraco.
 * Embaixo, os dias da semana; com `aoEscolher`, tocar num dia o escolhe (48 dp de altura, 1/7 da largura).
 */
@Composable
fun LinhaSemana(
    pontos: List<Pair<String, Double?>>,
    descricao: String,
    modifier: Modifier = Modifier,
    selecionado: String? = null,
    aoEscolher: ((String) -> Unit)? = null,
) {
    if (pontos.isEmpty()) return
    val medidor = rememberTextMeasurer()
    val estilo = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 13.sp)
    val f = animaAte(1f, 900)
    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(128.dp).semantics { contentDescription = descricao }) {
            val n = pontos.size
            val passo = size.width / n
            val topo = 24.dp.toPx()
            val base = size.height - 8.dp.toPx()
            fun y(v: Double) = base - (v / 100).toFloat().coerceIn(0f, 1f) * (base - topo) * f
            fun x(i: Int) = passo * i + passo / 2
            val guia = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx()))
            listOf(50.0, 100.0).forEach { g -> drawLine(Cores.Trilho, Offset(0f, y(g)), Offset(size.width, y(g)), strokeWidth = 1.dp.toPx(), pathEffect = guia) }
            // a linha liga só dias vizinhos com nota (o buraco fica aberto)
            var caminho: Path? = null
            pontos.forEachIndexed { i, (_, v) ->
                if (v == null) {
                    caminho?.let { drawPath(it, Cores.LilasMedio, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round)) }
                    caminho = null
                } else {
                    val c = caminho
                    if (c == null) caminho = Path().apply { moveTo(x(i), y(v)) } else c.lineTo(x(i), y(v))
                }
            }
            caminho?.let { drawPath(it, Cores.LilasMedio, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round)) }
            pontos.forEachIndexed { i, (dia, v) ->
                if (v == null) return@forEachIndexed
                val nivel = nivelDe(rotuloDaNota(v))
                val cor = nivel?.tinta ?: Cores.Acai
                val p = Offset(x(i), y(v))
                if (dia == selecionado) drawCircle(cor.copy(alpha = 0.18f), 11.dp.toPx(), p)
                drawCircle(Cores.Branco, 6.dp.toPx(), p)
                drawCircle(cor, 4.5.dp.toPx(), p)
                val r = medidor.measure(AnnotatedString(Formato.inteiro(v)), estilo.copy(color = cor))
                drawText(r, topLeft = Offset(p.x - r.size.width / 2f, p.y - 10.dp.toPx() - r.size.height))
            }
        }
        RotulosDias(pontos.map { it.first }, selecionado, aoEscolher)
    }
}

/** Os dias da semana embaixo de um gráfico de 7 dias; com `aoEscolher`, cada um é um alvo de 48 dp de altura (largura de 1/7 da linha). */
@Composable
fun RotulosDias(dias: List<String>, selecionado: String?, aoEscolher: ((String) -> Unit)?) {
    Row(Modifier.fillMaxWidth()) {
        dias.forEach { diaStr ->
            val d = Formato.dia(diaStr)
            val ativo = diaStr == selecionado
            var m = Modifier.weight(1f).heightIn(min = if (aoEscolher != null) 48.dp else 20.dp).clip(Formas.Pequeno)
            if (aoEscolher != null) {
                m = m.clickable(role = Role.RadioButton, onClickLabel = "Ver este dia") { aoEscolher(diaStr) }
                    .semantics { selected = ativo; contentDescription = d?.let { Formato.diaLongo(it) } ?: diaStr }
            }
            Box(m, contentAlignment = Alignment.Center) {
                Text(
                    d?.let { Formato.semanaCurta(it) } ?: "", style = MaterialTheme.typography.labelSmall,
                    color = if (ativo) Cores.AcaiEscuro else Cores.Tinta3, fontWeight = if (ativo) FontWeight.W700 else FontWeight.W600,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/**
 * Seletor de dia ‹ Hoje ›: volta até `minimo`, avança até `hoje` (nunca o futuro). Setas de 48 dp; a seta que não
 * pode ir fica cinza e desligada.
 */
@Composable
fun SeletorDia(dia: LocalDate, hoje: LocalDate, minimo: LocalDate, aoMudar: (LocalDate) -> Unit, modifier: Modifier = Modifier) {
    val podeVoltar = dia.isAfter(minimo)
    val podeAvancar = dia.isBefore(hoje)
    Row(modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        BotaoDia("Dia anterior", setaEsquerda, podeVoltar) { aoMudar(dia.minusDays(1)) }
        Box(Modifier.weight(1f).heightIn(min = 44.dp).clip(Formas.Pilula).background(Cores.Branco), contentAlignment = Alignment.Center) {
            Text(rotuloDia(dia, hoje), fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 16.sp, color = Cores.Tinta, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        BotaoDia("Próximo dia", setaDireita, podeAvancar) { aoMudar(dia.plusDays(1)) }
    }
}

@Composable
private fun BotaoDia(rotulo: String, seta: androidx.compose.ui.graphics.vector.ImageVector, habilitado: Boolean, aoTocar: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(Formas.Pilula).clickable(enabled = habilitado, role = Role.Button, onClickLabel = rotulo, onClick = aoTocar).semantics { contentDescription = rotulo },
        contentAlignment = Alignment.Center,
    ) { Icon(seta, contentDescription = null, tint = if (habilitado) Cores.AcaiEscuro else Cores.Cinza, modifier = Modifier.size(20.dp)) }
}

/**
 * Barras pequenas dos 7 dias (nota de sono): a barra na cor do nível, o valor em cima, o dia embaixo.
 * Com `aoEscolher`, a coluna inteira é o alvo de toque.
 */
@Composable
fun BarrasSemana(
    dias: List<Pair<String, Double?>>,
    selecionado: String?,
    descreverDia: (String, Double?) -> String,
    modifier: Modifier = Modifier,
    aoEscolher: ((String) -> Unit)? = null,
) {
    if (dias.isEmpty()) return
    val f = animaAte(1f, 900)
    val alturaMax = 72.dp
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
        dias.forEach { (diaStr, v) ->
            val d = Formato.dia(diaStr)
            val ativo = diaStr == selecionado
            var m = Modifier.weight(1f).clip(Formas.Pequeno).background(if (ativo) Cores.Trilho else Color.Transparent)
            if (aoEscolher != null) m = m.clickable(role = Role.RadioButton, onClickLabel = "Ver este dia") { aoEscolher(diaStr) }
            Column(
                m.clearAndSetSemantics { contentDescription = descreverDia(diaStr, v); selected = ativo }.padding(vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Bottom,
            ) {
                Text(v?.let { Formato.inteiro(it) } ?: "", style = MaterialTheme.typography.labelSmall, color = Cores.Tinta2)
                Box(Modifier.height(alturaMax), contentAlignment = Alignment.BottomCenter) {
                    if (v == null) {
                        Box(Modifier.width(18.dp).height(3.dp).clip(Formas.Pilula).background(Cores.Cinza))
                    } else {
                        val cor = corDaNota(v)
                        Box(Modifier.width(18.dp).height(alturaMax * (v / 100).toFloat().coerceIn(0.05f, 1f) * f).clip(RoundedCornerShape(6.dp)).background(cor))
                    }
                }
                Text(
                    d?.let { Formato.semanaCurta(it) } ?: "", style = MaterialTheme.typography.labelSmall,
                    color = if (ativo) Cores.AcaiEscuro else Cores.Tinta3, modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}
