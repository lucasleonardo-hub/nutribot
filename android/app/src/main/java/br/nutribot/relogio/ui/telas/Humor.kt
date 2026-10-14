package br.nutribot.relogio.ui.telas

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject

/** Cores dos cinco humores, do pior ao melhor: coral → pêssego → âmbar → menta → verde (pastéis do tema). */
private val coresHumor = listOf(Cores.Proteina, Color(0xFFFFC4A3), Cores.Carbo, Cores.Gordura, Cores.Verde)
private val nomesHumor = listOf("péssimo", "ruim", "ok", "bem", "ótimo")
private val iconeRaio = icone("M13 2L4 14h7l-1 8 9-12h-7l1-8z")
private val iconeLua = icone("M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z")
private val pincelHumor = Brush.linearGradient(listOf(Cores.Lavanda, Cores.Pessego))

/**
 * Cartão "Como você está?" do Hoje (fase 5): cinco tiles com carinhas e rótulo, energia e sono em pílulas com ícone,
 * e o texto curto opcional que só aparece depois de escolher a carinha.
 * Cada toque manda PUT /perfis/:id/humor, juntando as mudanças de ~800 ms; o texto vai quando a pessoa toca em "salvar".
 * O estado inicial vem de hoje.humor; o /hoje devolvido pelo servidor entra no lugar do guardado (sem recarregar tudo).
 */
@Composable
fun CartaoHumor(vm: AppVM, perfilId: String, dia: String, inicial: JSONObject?, aoTocar: () -> Unit = {}, aoFechar: (() -> Unit)? = null) {
    // chave do servidor: quando o /hoje muda (outro dia, ou o que acabou de ser salvo), o cartão parte do que veio
    val chave = "$dia|${inicial?.toString() ?: ""}"
    var humor by remember(chave) { mutableIntStateOf(inicial.int("humor") ?: 0) }
    var energia by remember(chave) { mutableIntStateOf(inicial.int("energia") ?: 0) }
    var sono by remember(chave) { mutableIntStateOf(inicial.int("sono") ?: 0) }
    var texto by remember(chave) { mutableStateOf(inicial.str("texto") ?: "") }
    var textoSalvo by remember(chave) { mutableStateOf(inicial.str("texto") ?: "") }
    var tocado by remember(chave) { mutableIntStateOf(0) } // conta os toques: cada um reinicia a espera de 800 ms
    var estado by remember(chave) { mutableStateOf<String?>(null) } // "salvando", "salvo" ou o erro

    LaunchedEffect(tocado) {
        if (tocado == 0) return@LaunchedEffect
        if (humor == 0) { estado = "escolha uma carinha"; return@LaunchedEffect }
        delay(800)
        estado = "salvando…"
        try {
            val corpo = JSONObject().put("dia", dia).put("humor", humor)
            if (energia > 0) corpo.put("energia", energia)
            if (sono > 0) corpo.put("sono", sono)
            if (texto.trim().isNotBlank()) corpo.put("texto", texto.trim().take(200))
            val j = vm.escrever("PUT", AppVM.rotaHumor(perfilId), corpo)
            textoSalvo = texto.trim()
            estado = "salvo"
            // o /hoje já recalculado vem na resposta: entra no lugar do guardado, sem buscar tudo de novo
            j.obj("hoje")?.let { vm.semear(AppVM.rotaHoje(perfilId), it) }
        } catch (e: ErroApi) {
            estado = if (e.semConexao) "sem conexão; tente depois" else e.paraPessoa
        } catch (e: CancellationException) {
            throw e
        }
    }

    val parado = LocalReduzirMovimento.current
    Cartao(pincel = pincelHumor, atraso = 40) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Como você está?", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            estado?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (it == "salvo") Cores.BomTinta else Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        Text(
            if (humor > 0) "Hoje: ${nomesHumor[humor - 1]}" else "Toque na carinha que combina com o seu dia.",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 2.dp),
        )
        // os cinco tiles: o escolhido cresce e ganha sombra
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
            (1..5).forEach { n ->
                val ativa = humor == n
                TileHumor(n, ativa, parado, Modifier.weight(1f)) { humor = n; tocado++; aoTocar() }
            }
        }
        LinhaNota("Energia", iconeRaio, energia) { energia = it; tocado++; aoTocar() }
        LinhaNota("Sono", iconeLua, sono) { sono = it; tocado++; aoTocar() }
        // o texto só depois da carinha
        val mostrarTexto = humor > 0
        if (parado) {
            if (mostrarTexto) CampoTexto(texto, textoSalvo, { texto = it }) { tocado++; aoTocar() }
        } else {
            AnimatedVisibility(mostrarTexto, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                CampoTexto(texto, textoSalvo, { texto = it }) { tocado++; aoTocar() }
            }
        }
        // depois de responder, "pronto" recolhe o cartão para a linha pequena (fase 4)
        if (aoFechar != null && humor > 0 && estado == "salvo") Link("pronto", aoFechar)
    }
}

@Composable
private fun CampoTexto(texto: String, textoSalvo: String, aoMudar: (String) -> Unit, aoSalvar: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
        OutlinedTextField(
            texto, { aoMudar(it.take(200)) }, label = { Text("Quer contar algo?") }, singleLine = true,
            modifier = Modifier.weight(1f),
        )
        if (texto.trim() != textoSalvo) Link("salvar", aoSalvar)
    }
}

/** Um tile de humor: quadrado arredondado (≥ 56 dp) na cor do nível, a carinha dentro e o rótulo embaixo. */
@Composable
private fun TileHumor(nivel: Int, ativa: Boolean, parado: Boolean, modifier: Modifier = Modifier, aoTocar: () -> Unit) {
    val nome = nomesHumor[nivel - 1]
    val cor = coresHumor[nivel - 1]
    val escalaAlvo = if (ativa) 1.08f else 1f
    val escala = if (parado) escalaAlvo else animateFloatAsState(escalaAlvo, label = "tile").value
    val forma = RoundedCornerShape(18.dp)
    Column(
        modifier
            .clip(RoundedCornerShape(22.dp))
            .clickable(role = Role.RadioButton, onClickLabel = "Humor $nome", onClick = aoTocar)
            .semantics { selected = ativa; contentDescription = "Humor $nome" }
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .sizeIn(minWidth = 56.dp, minHeight = 56.dp)
                .aspectRatio(1f)
                .graphicsLayer { scaleX = escala; scaleY = escala }
                .let { if (ativa) it.shadow(8.dp, forma, ambientColor = cor.copy(alpha = 0.5f), spotColor = cor.copy(alpha = 0.6f)) else it }
                .clip(forma)
                .background(if (ativa) cor else lerp(cor, Color.White, 0.55f)),
            contentAlignment = Alignment.Center,
        ) {
            Carinha(nivel, ativa, 40.dp)
        }
        Text(
            nome, style = MaterialTheme.typography.labelSmall, fontSize = 11.sp, textAlign = TextAlign.Center,
            color = if (ativa) Cores.Tinta else Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * A linha pequena que fica no lugar do cartão depois que a pessoa respondeu (fase 4): "Hoje: bem · energia 4 · sono 3 · mudar".
 * "mudar" reabre o cartão.
 */
@Composable
fun LinhaHumor(humor: JSONObject?, aoMudar: () -> Unit) {
    val h = humor.int("humor")?.coerceIn(1, 5) ?: return
    val partes = listOfNotNull(
        "Hoje: ${nomesHumor[h - 1]}",
        humor.int("energia")?.let { "energia $it" },
        humor.int("sono")?.let { "sono $it" },
    )
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(coresHumor[h - 1]), contentAlignment = Alignment.Center) { Carinha(h, true, 24.dp) }
        Text(partes.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Link("mudar", aoMudar)
    }
}

/** Energia ou sono: ícone + rótulo curto e cinco pílulas de 1 a 5 (alvo de 48 dp cada). */
@Composable
private fun LinhaNota(nome: String, simbolo: androidx.compose.ui.graphics.vector.ImageVector, valor: Int, aoEscolher: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.width(76.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(simbolo, contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(16.dp))
            Text(nome, style = MaterialTheme.typography.labelLarge, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        (1..5).forEach { n -> Chip("$n", valor == n, Modifier.weight(1f).semantics { contentDescription = "$nome $n de 5" }) { aoEscolher(n) } }
    }
}

/**
 * Carinha desenhada: rosto redondo com bochechas, olhos com brilho e a boca de triste (1) a sorridente (5).
 * Dentro do tile a cor do fundo já diz o nível; o rosto é cor de creme para contrastar com qualquer um dos cinco.
 */
@Composable
private fun Carinha(nivel: Int, ativa: Boolean, tamanho: Dp) {
    val rosto = if (ativa) Color(0xFFFFF4E0) else Color(0xFFFFFBF2)
    val tinta = if (ativa) Cores.Tinta else Cores.Tinta4
    val bochecha = Color(0xFFFF9FB2).copy(alpha = if (ativa) 0.55f else 0.35f)
    Canvas(Modifier.size(tamanho)) {
        val r = size.minDimension / 2
        val c = Offset(r, r)
        drawCircle(rosto, r, c)
        drawCircle(Color(0xFF2B2340).copy(alpha = 0.10f), r, c, style = Stroke(r * 0.07f))
        // bochechas
        drawCircle(bochecha, r * 0.17f, Offset(c.x - r * 0.52f, c.y + r * 0.18f))
        drawCircle(bochecha, r * 0.17f, Offset(c.x + r * 0.52f, c.y + r * 0.18f))
        // olhos (1 = pequenos e caídos; 5 = arqueados de alegria)
        val olho = r * 0.11f
        val yOlho = c.y - r * 0.22f
        if (nivel == 5) {
            listOf(-1f, 1f).forEach { lado ->
                val x = c.x + lado * r * 0.36f
                val arco = Path().apply {
                    moveTo(x - r * 0.16f, yOlho + r * 0.05f)
                    quadraticTo(x, yOlho - r * 0.22f, x + r * 0.16f, yOlho + r * 0.05f)
                }
                drawPath(arco, tinta, style = Stroke(r * 0.1f, cap = StrokeCap.Round))
            }
        } else {
            listOf(-1f, 1f).forEach { lado ->
                val x = c.x + lado * r * 0.36f
                drawCircle(tinta, olho, Offset(x, yOlho))
                drawCircle(Color.White, olho * 0.4f, Offset(x + olho * 0.35f, yOlho - olho * 0.35f))
            }
            if (nivel == 1) {
                // sobrancelhas caídas
                listOf(-1f, 1f).forEach { lado ->
                    val x = c.x + lado * r * 0.36f
                    drawLine(tinta, Offset(x - lado * r * 0.18f, yOlho - r * 0.3f), Offset(x + lado * r * 0.14f, yOlho - r * 0.2f), strokeWidth = r * 0.08f, cap = StrokeCap.Round)
                }
            }
        }
        // boca: curvatura de -1 (triste) a +1 (feliz); no 5 a boca é aberta e cheia
        val curva = (nivel - 3) / 2f
        val yBoca = c.y + r * 0.32f
        val largura = r * (0.3f + 0.1f * kotlin.math.abs(curva))
        if (nivel == 5) {
            val sorriso = Path().apply {
                moveTo(c.x - largura, yBoca - r * 0.08f)
                quadraticTo(c.x, yBoca + r * 0.55f, c.x + largura, yBoca - r * 0.08f)
                close()
            }
            drawPath(sorriso, tinta, style = Fill)
        } else if (nivel == 3) {
            drawLine(tinta, Offset(c.x - largura, yBoca), Offset(c.x + largura, yBoca), strokeWidth = r * 0.11f, cap = StrokeCap.Round)
        } else {
            val boca = Path().apply {
                moveTo(c.x - largura, yBoca - curva * r * 0.1f)
                quadraticTo(c.x, yBoca + curva * r * 0.45f, c.x + largura, yBoca - curva * r * 0.1f)
            }
            drawPath(boca, tinta, style = Stroke(r * 0.11f, cap = StrokeCap.Round))
        }
    }
}
