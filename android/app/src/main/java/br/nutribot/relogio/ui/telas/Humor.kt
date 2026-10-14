package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.componentes.CartaoExpansivel
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.tema.Cores
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject

private val coresHumor = listOf(Cores.Proteina, Color(0xFFFFC4A3), Cores.Carbo, Cores.Gordura, Cores.Verde)
private val nomesHumor = listOf("muito mal", "mal", "mais ou menos", "bem", "muito bem")

/**
 * Cartão "Como você está?" do Hoje: humor (5 carinhas), energia e sono (1 a 5) e um texto curto opcional.
 * Cada toque manda PUT /perfis/:id/humor, juntando as mudanças de ~800 ms; o texto vai quando a pessoa toca em "salvar".
 * O estado inicial vem de hoje.humor; o /hoje devolvido pelo servidor entra no lugar do guardado (sem recarregar tudo).
 * Fase 3: no cabeçalho (altura padrão dos cartões) ficam o título e as carinhas; energia, sono e o texto ficam no detalhe.
 */
@Composable
fun CartaoHumor(vm: AppVM, perfilId: String, dia: String, inicial: JSONObject?) {
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

    CartaoExpansivel(
        "humor", atraso = 40,
        cabecalho = {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Como você está?", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    estado?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (it == "salvo") Cores.BomTinta else Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    (1..5).forEach { n ->
                        val ativa = humor == n
                        Box(
                            Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.RadioButton, onClickLabel = "Humor ${nomesHumor[n - 1]}") { humor = n; tocado++ }
                                .semantics { selected = ativa; contentDescription = "Humor ${nomesHumor[n - 1]}" },
                            contentAlignment = Alignment.Center,
                        ) { Carinha(n, ativa) }
                    }
                }
            }
        },
    ) {
        Text(if (humor > 0) "Humor: ${nomesHumor[humor - 1]}" else "Toque numa carinha.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        LinhaNota("Energia", energia) { energia = it; tocado++ }
        LinhaNota("Sono", sono) { sono = it; tocado++ }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            OutlinedTextField(
                texto, { texto = it.take(200) }, label = { Text("Quer contar algo?") }, singleLine = true,
                modifier = Modifier.weight(1f),
            )
            if (texto.trim() != textoSalvo) Link("salvar") { tocado++ }
        }
    }
}

/** Cinco pílulas de 1 a 5 (alvo de 48 dp cada). */
@Composable
private fun LinhaNota(nome: String, valor: Int, aoEscolher: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(nome, style = MaterialTheme.typography.labelLarge, modifier = Modifier.heightIn(min = 48.dp).padding(end = 4.dp).width(64.dp))
        (1..5).forEach { n -> Chip("$n", valor == n, Modifier.weight(1f).semantics { contentDescription = "$nome $n de 5" }) { aoEscolher(n) } }
    }
}

/** Carinha desenhada no estilo do app: círculo colorido pelo nível, dois olhos e a boca de triste (1) a sorridente (5). */
@Composable
private fun Carinha(nivel: Int, ativa: Boolean) {
    val cor = if (ativa) coresHumor[nivel - 1] else Cores.Trilho
    val tinta = if (ativa) Cores.Tinta else Cores.Tinta4
    Canvas(Modifier.size(if (ativa) 44.dp else 38.dp)) {
        val r = size.minDimension / 2
        val c = Offset(r, r)
        drawCircle(cor, r, c)
        if (ativa) drawCircle(Color.White.copy(alpha = 0.35f), r * 0.78f, c, style = Stroke(r * 0.08f))
        val olho = r * 0.1f
        drawCircle(tinta, olho, Offset(c.x - r * 0.35f, c.y - r * 0.2f))
        drawCircle(tinta, olho, Offset(c.x + r * 0.35f, c.y - r * 0.2f))
        // curvatura da boca: -1 (triste) a +1 (feliz)
        val curva = (nivel - 3) / 2f
        val y = c.y + r * 0.3f
        val boca = Path().apply {
            moveTo(c.x - r * 0.42f, y - curva * r * 0.12f)
            quadraticTo(c.x, y + curva * r * 0.5f, c.x + r * 0.42f, y - curva * r * 0.12f)
        }
        drawPath(boca, tinta, style = Stroke(r * 0.11f, cap = StrokeCap.Round))
    }
}
