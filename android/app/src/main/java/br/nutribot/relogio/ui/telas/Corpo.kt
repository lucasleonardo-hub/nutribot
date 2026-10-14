package br.nutribot.relogio.ui.telas

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.R
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cabecalho
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.LinhaValor
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Segmentado
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento
import org.json.JSONObject
import java.time.LocalDate

/** As 6 regiões do boneco, com as cores do protótipo. */
private enum class Regiao(val nome: String, val cor: Color) {
    Peito("Peito", Color(0xFFFF9F80)), Costas("Costas", Color(0xFF8EC5FF)), Ombros("Ombros", Color(0xFFFFD166)),
    Bracos("Braços", Color(0xFF7DD3A8)), Core("Core", Color(0xFFFFB0C0)), Pernas("Pernas", Color(0xFFB39DF5)),
}

/** Grupo do Hevy (chave em inglês, ex.: "chest") ou nome em português -> região do boneco. */
private fun regiaoDe(grupo: String?): Regiao? {
    val g = grupo?.lowercase() ?: return null
    return when {
        g in setOf("chest") || g.contains("peit") -> Regiao.Peito
        g in setOf("lats", "upper_back", "lower_back", "traps") || g.contains("costa") || g.contains("dorsa") || g.contains("lombar") || g.contains("trapé") -> Regiao.Costas
        g == "shoulders" || g.contains("ombro") || g.contains("deltoi") -> Regiao.Ombros
        g in setOf("biceps", "triceps", "forearms") || g.contains("bíceps") || g.contains("tríceps") || g.contains("antebra") || g.contains("braço") -> Regiao.Bracos
        g in setOf("abdominals", "obliques") || g.contains("abdom") || g.contains("core") || g.contains("oblíq") -> Regiao.Core
        g in setOf("quadriceps", "hamstrings", "glutes", "calves", "abductors", "adductors") || g.contains("quadr") || g.contains("posterior") || g.contains("glúte") || g.contains("panturr") || g.contains("perna") || g.contains("abdut") || g.contains("adut") -> Regiao.Pernas
        else -> null
    }
}

/** Zonas em % do recorte (centro x, centro y, largura, altura), medidas no protótipo. */
private val zonasFrente = listOf(
    Regiao.Bracos to floatArrayOf(20f, 45f, 15f, 13f), Regiao.Bracos to floatArrayOf(80f, 45f, 15f, 13f),
    Regiao.Ombros to floatArrayOf(30f, 41f, 11f, 8f), Regiao.Ombros to floatArrayOf(70f, 41f, 11f, 8f),
    Regiao.Peito to floatArrayOf(41f, 51f, 17f, 9f), Regiao.Peito to floatArrayOf(59f, 51f, 17f, 9f),
    Regiao.Core to floatArrayOf(50f, 65f, 24f, 15f),
    Regiao.Pernas to floatArrayOf(41f, 83f, 14f, 12f), Regiao.Pernas to floatArrayOf(59f, 83f, 14f, 12f),
)
private val zonasCostas = listOf(
    Regiao.Bracos to floatArrayOf(18f, 45f, 13f, 15f), Regiao.Bracos to floatArrayOf(82f, 45f, 13f, 15f),
    Regiao.Ombros to floatArrayOf(30f, 43f, 12f, 9f), Regiao.Ombros to floatArrayOf(70f, 43f, 12f, 9f),
    Regiao.Costas to floatArrayOf(50f, 44f, 30f, 8f), Regiao.Costas to floatArrayOf(39f, 54f, 20f, 15f), Regiao.Costas to floatArrayOf(61f, 54f, 20f, 15f),
    Regiao.Pernas to floatArrayOf(43f, 71f, 15f, 11f), Regiao.Pernas to floatArrayOf(57f, 71f, 15f, 11f),
    Regiao.Pernas to floatArrayOf(41f, 85f, 13f, 11f), Regiao.Pernas to floatArrayOf(59f, 85f, 13f, 11f),
)

/** Uma medição de /corpo.composicao: { dia, hora, fonte, peso, gordura, magra, confianca }. */
private data class Medicao(val dia: LocalDate, val fonte: String?, val peso: Double?, val gordura: Double?, val magra: Double?)

private fun medicoesDe(j: JSONObject): List<Medicao> = j.arr("composicao").objs().mapNotNull { m ->
    val d = Formato.dia(m.str("dia")) ?: return@mapNotNull null
    Medicao(d, m.str("fonte"), m.num("peso"), m.num("gordura"), m.num("magra"))
}.sortedBy { it.dia }

@Composable
fun TelaCorpo(vm: AppVM, perfil: Perfil?) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaCorpo(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val atual = carga.dados.obj("atual")
    val sub = "${perfil.curto} · " + (Formato.dia(atual.str("dia"))?.let { "medição de ${Formato.diaCurto(it)}" } ?: "composição") + (if (perfil.temHevy) " + Hevy" else "")
    ConteudoCarga(carga, { vm.carregar(rota, forcar = true) }, topo = { Cabecalho("Corpo", sub, Pose.CorgiHalter, 64.dp) }) { j -> ConteudoCorpo(j) }
}

@Composable
private fun ConteudoCorpo(j: JSONObject) {
    val atual = j.obj("atual")
    val treino = j.obj("treino")
    val series = HashMap<Regiao, Double>()
    treino.arr("porGrupo").objs().forEach { g ->
        val r = regiaoDe(g.str("grupo")) ?: regiaoDe(g.str("nome")) ?: return@forEach
        series[r] = (series[r] ?: 0.0) + (g.num("series") ?: 0.0)
    }
    var lado by rememberSaveable { mutableIntStateOf(0) }

    Cartao(pincel = Brush.verticalGradient(listOf(Cores.Branco, Color(0xFFFBF8FF))), forma = Formas.Grande, padding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Segmentado(listOf("Frente", "Costas"), lado, { lado = it }, Modifier.width(180.dp))
            Spacer(Modifier.weight(1f))
            Formato.dia(atual.str("dia"))?.let { Text(Formato.diaCurto(it), style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3) }
        }
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Boneco(costas = lado == 1, series = series)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Numero("Peso", atual.num("peso")?.let { Formato.decimal(it) + " kg" })
                Numero("Gordura", atual.num("gordura")?.let { Formato.decimal(it) + "%" })
                Numero("Massa magra", atual.num("magra")?.let { Formato.decimal(it) + " kg" })
                j.obj("ritmo")?.let { r ->
                    Text(
                        listOfNotNull(r.num("magraKgSemana")?.let { "magra ${Formato.sinal(it)} kg/sem" }, r.num("gorduraKgSemana")?.let { "gordura ${Formato.sinal(it)} kg/sem" }).joinToString("\n"),
                        style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp,
                    )
                }
            }
        }
        LegendaMusculos(series, temTreino = treino != null)
    }

    if (treino != null) CartaoTreino(treino, j.obj("forca"))
    CartaoSugestoes(j.arr("sugestoesCarga").objs())
    CartaoBio(medicoesDe(j))
}

@Composable
private fun Numero(rotulo: String, valor: String?) {
    Column {
        Text(rotulo, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
        Text(valor ?: "—", style = MaterialTheme.typography.headlineMedium, fontSize = 21.sp)
    }
}

/** Boneco 3D (corpo_frente / corpo_costas) com brilhos por grupo: mais séries na semana, brilho mais forte. */
@Composable
private fun Boneco(costas: Boolean, series: Map<Regiao, Double>) {
    val max = series.values.maxOrNull()?.takeIf { it > 0 } ?: 1.0
    val parado = LocalReduzirMovimento.current
    // o pulso só é lido dentro do Canvas (fase de desenho): a animação não recompõe o boneco a cada quadro
    val pulso: State<Float> = if (parado) remember { mutableFloatStateOf(1f) } else {
        val t = rememberInfiniteTransition(label = "musculos")
        t.animateFloat(0.85f, 1.1f, infiniteRepeatable(tween(1300, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "pulsa")
    }
    val treinados = series.entries.sortedByDescending { it.value }.joinToString(", ") { "${it.key.nome} ${Formato.inteiro(it.value)} séries" }
    Box(Modifier.size(200.dp, 266.dp).semantics { contentDescription = (if (costas) "Corpo de costas" else "Corpo de frente") + if (treinados.isBlank()) ", sem treino registrado na semana" else ": $treinados" }) {
        Image(painterResource(if (costas) R.drawable.corpo_costas else R.drawable.corpo_frente), contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        Canvas(Modifier.fillMaxSize()) {
            val p = pulso.value
            (if (costas) zonasCostas else zonasFrente).forEach { (r, z) ->
                val s = series[r] ?: return@forEach
                if (s <= 0) return@forEach
                val op = (0.25 + 0.6 * (s / max)).toFloat().coerceAtMost(0.92f) * p.coerceAtMost(1f)
                val w = size.width * z[2] / 100f * p
                val h = size.height * z[3] / 100f * p
                val c = Offset(size.width * z[0] / 100f, size.height * z[1] / 100f)
                drawOval(
                    Brush.radialGradient(0f to r.cor.copy(alpha = op), 0.35f to r.cor.copy(alpha = op), 0.72f to r.cor.copy(alpha = 0f), center = c, radius = maxOf(w, h) / 2),
                    topLeft = Offset(c.x - w / 2, c.y - h / 2), size = Size(w, h),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LegendaMusculos(series: Map<Regiao, Double>, temTreino: Boolean) {
    if (!temTreino) {
        Text("Sem Hevy ligado: os brilhos dos músculos aparecem quando houver treino de força registrado.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 8.dp))
        return
    }
    FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Regiao.entries.forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(r.cor))
                Text("${r.nome} ${Formato.inteiro(series[r] ?: 0.0)}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp)
            }
        }
        Text("séries na semana · brilho mais forte = mais treinado", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 12.sp)
    }
}

/** treino: { sessoes, series, volumeKg, volumeAnteriorKg, variacaoVolume, rpeMedio, semanasComTreino, porGrupo, progressao } */
@Composable
private fun CartaoTreino(t: JSONObject, forca: JSONObject?) {
    Cartao(atraso = 50) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Mascote(Pose.DuplaCorrendo, 40.dp)
            Text("Treino da semana", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            t.num("variacaoVolume")?.let { v ->
                val pct = v * 100
                Pilula("volume ${Formato.sinal(pct, 0)}%", if (pct >= 0) Color(0xFFDDF5E8) else Cores.AtencaoFundo, if (pct >= 0) Cores.BomTinta else Cores.AtencaoTinta)
            }
        }
        Spacer(Modifier.height(6.dp))
        LinhaValor("Sessões", Formato.inteiro(t.num("sessoes")))
        LinhaValor("Séries", Formato.inteiro(t.num("series")))
        t.num("volumeKg")?.let { LinhaValor("Volume", "${Formato.inteiro(it)} kg" + (t.num("volumeAnteriorKg")?.let { a -> " (antes ${Formato.inteiro(a)})" } ?: "")) }
        t.num("rpeMedio")?.let { LinhaValor("Esforço médio (RPE)", Formato.decimal(it)) }
        t.num("semanasComTreino")?.let { LinhaValor("Semanas com treino", Formato.inteiro(it)) }
        val prog = t.arr("progressao").objs()
        if (prog.isNotEmpty()) {
            Text("Força estimada (1RM)", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
            prog.take(8).forEach { e ->
                val v = e.num("variacao")
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(e.str("exercicio") ?: "Exercício", style = MaterialTheme.typography.labelLarge)
                        e.str("grupo")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp) }
                    }
                    Text(
                        (e.num("rmKg")?.let { Formato.decimal(it) + " kg" } ?: "—") + (v?.let { " · ${Formato.sinal(it * 100, 0)}%" } ?: ""),
                        style = MaterialTheme.typography.labelLarge,
                        color = if ((v ?: 0.0) > 0) Cores.BomTinta else if ((v ?: 0.0) < 0) Cores.CuidadoTinta else Cores.Tinta2,
                    )
                }
            }
        }
        // força em 8 semanas: subindo, parados, caindo
        if (forca != null) {
            listOf(Triple("subindo", "Subindo", Cores.BomTinta), Triple("parados", "Parados", Cores.AtencaoTinta), Triple("caindo", "Caindo", Cores.CuidadoTinta)).forEach { (k, rot, cor) ->
                val l = forca.arr(k).objs()
                if (l.isNotEmpty()) {
                    Text("$rot (8 semanas)", style = MaterialTheme.typography.labelLarge, color = cor, modifier = Modifier.padding(top = 8.dp))
                    l.take(5).forEach { e ->
                        Text(
                            "• ${e.str("exercicio") ?: "?"}: " + listOfNotNull(
                                e.num("melhorKg")?.let { "${Formato.decimal(it)} kg" + (e.num("reps")?.let { r -> " × ${Formato.inteiro(r)}" } ?: "") },
                                e.num("desdeKg")?.let { "desde ${Formato.decimal(it)} kg" },
                                e.num("semanasParado")?.takeIf { it > 0 && k == "parados" }?.let { "parado há ${Formato.inteiro(it)} sem" },
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2,
                        )
                    }
                }
            }
        }
    }
}

/** sugestoesCarga: [{ exercicio, deKg, deReps, paraKg, paraReps, status, feitaEm, batidaEm, como }] */
@Composable
private fun CartaoSugestoes(lista: List<JSONObject>) {
    if (lista.isEmpty()) return
    Cartao(atraso = 80) {
        TituloSecao("Sugestões de carga")
        lista.forEach { s ->
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(s.str("exercicio") ?: "Exercício", style = MaterialTheme.typography.labelLarge)
                    val de = s.num("deKg")?.let { "${Formato.decimal(it)} kg" + (s.num("deReps")?.let { r -> " × ${Formato.inteiro(r)}" } ?: "") }
                    de?.let { Text("última: $it", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp) }
                    s.str("como")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp) }
                }
                val status = s.str("status")
                val (fundo, tinta) = when (status) {
                    "batida" -> Color(0xFFDDF5E8) to Cores.BomTinta
                    "tentando" -> Cores.AtencaoFundo to Cores.AtencaoTinta
                    else -> Cores.Trilho to Cores.LilasTexto
                }
                Column(Modifier.clip(Formas.Pequeno).background(fundo).padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        s.num("paraKg")?.let { "${Formato.decimal(it)} kg" } ?: "—",
                        fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 14.sp, color = tinta,
                    )
                    s.num("paraReps")?.let { Text("× ${Formato.inteiro(it)}", fontSize = 11.sp, color = tinta) }
                    status?.let { Text(it, fontSize = 10.sp, color = tinta) }
                }
            }
        }
        Text(
            "Sugestões do NutriBot a partir do Hevy: sobe carga quando você fecha o topo das repetições com folga; sobe repetição quando o esforço já está alto.",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp),
        )
    }
}

/** Bioimpedância: gordura (%) ou massa magra (kg) por medição, com eixos, pontos tocáveis e a medição escolhida. */
@Composable
private fun CartaoBio(medicoes: List<Medicao>) {
    var aba by rememberSaveable { mutableIntStateOf(0) }
    val ehGordura = aba == 0
    val serie = medicoes.mapNotNull { m -> (if (ehGordura) m.gordura else m.magra)?.let { m to it } }
    var sel by rememberSaveable(aba, serie.size) { mutableIntStateOf((serie.size - 1).coerceAtLeast(0)) }
    Cartao(atraso = 110) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text("Bioimpedância", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            Text("${medicoes.size} ${if (medicoes.size == 1) "medição" else "medições"}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
        }
        Segmentado(listOf("Gordura", "Massa magra"), aba, { aba = it }, Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 6.dp))
        if (serie.isEmpty()) {
            Text("Nenhuma medição com ${if (ehGordura) "gordura" else "massa magra"} ainda (balança com bioimpedância ou avaliação em PDF).", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 16.dp))
            return@Cartao
        }
        val cor = if (ehGordura) Color(0xFFFF8A65) else Cores.Verde
        val (mSel, vSel) = serie[sel.coerceIn(0, serie.size - 1)]
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
            BotaoRedondo("‹", "Medição anterior", sel > 0) { sel-- }
            Column(Modifier.weight(1f)) {
                Text(Formato.decimal(vSel) + if (ehGordura) "%" else " kg", fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 26.sp, color = cor)
                val desde = serie.first()
                Text(
                    Formato.diaCurto(mSel.dia) + " · " + (if (mSel.fonte == "documento") "avaliação em documento" else "balança (${mSel.fonte ?: "?"})") +
                        (if (sel > 0) " · ${Formato.sinal(vSel - desde.second, 1)}${if (ehGordura) " pt" else " kg"} desde ${Formato.diaCurto(desde.first.dia)}" else ""),
                    style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp,
                )
            }
            BotaoRedondo("›", "Próxima medição", sel < serie.size - 1) { sel++ }
        }
        GraficoBio(serie.map { it.first.dia to it.second }, serie.map { it.first.fonte == "documento" }, sel, cor, if (ehGordura) "%" else " kg") { sel = it }
    }
}

@Composable
private fun BotaoRedondo(txt: String, rotulo: String, habilitado: Boolean, aoTocar: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(CircleShape).background(Color(0xFFF3EEFF)).clickable(enabled = habilitado, role = Role.Button, onClickLabel = rotulo, onClick = aoTocar).semantics { contentDescription = rotulo },
        contentAlignment = Alignment.Center,
    ) { Text(txt, color = if (habilitado) Cores.AcaiEscuro else Cores.Cinza, fontSize = 18.sp, fontWeight = FontWeight.W700) }
}

@Composable
private fun GraficoBio(pontos: List<Pair<LocalDate, Double>>, doc: List<Boolean>, sel: Int, cor: Color, unidade: String, aoEscolher: (Int) -> Unit) {
    val lo0 = pontos.minOf { it.second }
    val hi0 = pontos.maxOf { it.second }
    val folga = maxOf((hi0 - lo0) * 0.15, 0.5)
    val lo = lo0 - folga
    val hi = hi0 + folga
    val d0 = pontos.first().first
    val total = maxOf(java.time.temporal.ChronoUnit.DAYS.between(d0, pontos.last().first).toDouble(), 1.0)
    val prog = animaAte(1f, 1200)
    val desc = "Gráfico de ${Formato.decimal(pontos.first().second)}$unidade em ${Formato.diaCurto(d0)} para ${Formato.decimal(pontos.last().second)}$unidade em ${Formato.diaCurto(pontos.last().first)}"
    val xs = remember(pontos) { pontos.map { java.time.temporal.ChronoUnit.DAYS.between(d0, it.first) / total } }
    Canvas(
        Modifier.fillMaxWidth().aspectRatio(330f / 196f).semantics { contentDescription = desc }
            .pointerInput(pontos) {
                detectTapGestures { o ->
                    val esq = 34.dp.toPx(); val dir = size.width - 10.dp.toPx()
                    val f = ((o.x - esq) / (dir - esq)).coerceIn(0f, 1f)
                    val i = xs.indices.minByOrNull { kotlin.math.abs(xs[it] - f) } ?: return@detectTapGestures
                    aoEscolher(i)
                }
            },
    ) {
        val esq = 34.dp.toPx()
        val dir = size.width - 10.dp.toPx()
        val topo = 10.dp.toPx()
        val base = size.height - 24.dp.toPx()
        fun px(f: Double) = (esq + f * (dir - esq)).toFloat()
        fun py(v: Double) = (base - (v - lo) / (hi - lo) * (base - topo)).toFloat()
        val paint = android.graphics.Paint().apply { isAntiAlias = true; textSize = 10.sp.toPx(); color = android.graphics.Color.rgb(0x6E, 0x65, 0x87); textAlign = android.graphics.Paint.Align.RIGHT }
        // eixo y com 4 marcas
        for (i in 0..3) {
            val v = lo + (hi - lo) * i / 3
            val y = py(v)
            drawLine(Cores.Trilho, Offset(esq, y), Offset(dir, y), 1.dp.toPx())
            drawContext.canvas.nativeCanvas.drawText(Formato.decimal(v), esq - 4.dp.toPx(), y + 3.dp.toPx(), paint)
        }
        drawLine(Cores.LilasMedio, Offset(esq, topo), Offset(esq, base), 1.dp.toPx())
        drawLine(Cores.LilasMedio, Offset(esq, base), Offset(dir, base), 1.dp.toPx())
        // eixo x: datas (alternadas para não encavalar)
        paint.textAlign = android.graphics.Paint.Align.CENTER
        val passo = maxOf(1, pontos.size / 5)
        pontos.forEachIndexed { i, (d, _) ->
            if (i % passo == 0 || i == pontos.size - 1) {
                paint.isFakeBoldText = i == sel
                drawContext.canvas.nativeCanvas.drawText(Formato.diaCurto(d), px(xs[i]).coerceIn(esq + 12.dp.toPx(), dir - 12.dp.toPx()), size.height - 6.dp.toPx(), paint)
            }
        }
        // linha (desenha ao abrir) e pontos
        if (pontos.size > 1) {
            val n = (pontos.size - 1) * prog
            val p = Path()
            pontos.forEachIndexed { i, (_, v) ->
                if (i <= n + 0.001f) { if (i == 0) p.moveTo(px(xs[i]), py(v)) else p.lineTo(px(xs[i]), py(v)) }
            }
            drawPath(p, cor, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        drawLine(Cores.LilasMedio, Offset(px(xs[sel]), topo), Offset(px(xs[sel]), base), 1.dp.toPx())
        pontos.forEachIndexed { i, (_, v) ->
            val c = Offset(px(xs[i]), py(v))
            val r = (if (i == sel) 7.5f else 5f).dp.toPx()
            drawCircle(Color.White, r + 2.dp.toPx(), c)
            drawCircle(if (doc[i]) Cores.Acai else cor, r, c)
        }
    }
    Text("Toque num ponto para ver a medição. Pontos roxos: avaliação em documento.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp)
}
