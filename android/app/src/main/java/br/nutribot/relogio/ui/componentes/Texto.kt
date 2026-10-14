package br.nutribot.relogio.ui.componentes

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.ui.tema.Cores

/*
 * Texto em Markdown simples, sem biblioteca (fase 4): o plano da semana e os relatórios da Nutri.
 * Linha a linha: "# título" vira título; "- item" vira lista; "**negrito**" vira negrito; linha em branco separa parágrafos.
 */

private val negritoZapRe = Regex("(^|[\\s(])\\*([^*\\n]{1,200}?)\\*(?=[\\s).,;:!?]|$)")
private val italicoZapRe = Regex("(^|[\\s(])_([^_\\n]{1,200}?)_(?=[\\s).,;:!?]|$)")
private val riscadoZapRe = Regex("(^|[\\s(])~([^~\\n]{1,200}?)~(?=[\\s).,;:!?]|$)")
private val craseRe = Regex("`([^`\\n]+)`")
// emojis e pictogramas (pares substitutos, símbolos diversos, setas enfeitadas, seletor de variação e o juntador)
private val emojiRe = Regex("[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}\\x{2190}-\\x{21FF}\\x{FE0F}\\x{200D}]")
private val espacosRe = Regex("[ \\t]{2,}")
private val espacoAntesPontuacaoRe = Regex("\\s+([.,;:!?])")

/**
 * Tira a marcação do WhatsApp de um texto curto (fase 5): `*negrito*`, `_itálico_`, `~riscado~`, crases e emojis somem;
 * espaços duplos viram um. O servidor já limpa, mas o que o app monta ou guardou de antes passa por aqui também.
 */
fun semZap(texto: String): String {
    var t = texto.replace("\r\n", "\n").replace('\r', '\n')
    t = craseRe.replace(t) { it.groupValues[1] }
    t = negritoZapRe.replace(t) { it.groupValues[1] + it.groupValues[2] }
    t = italicoZapRe.replace(t) { it.groupValues[1] + it.groupValues[2] }
    t = riscadoZapRe.replace(t) { it.groupValues[1] + it.groupValues[2] }
    t = emojiRe.replace(t, "")
    return t.split('\n').joinToString("\n") { l -> espacoAntesPontuacaoRe.replace(espacosRe.replace(l, " "), "$1").trim() }.trim()
}

private val tituloRe = Regex("^#{1,6}\\s+(.*)$")
private val itemRe = Regex("^\\s*[-*•]\\s+(.*)$")
private val numeradoRe = Regex("^\\s*(\\d+)[.)]\\s+(.*)$")

/** Troca "**x**" por x em negrito (o resto fica como está). */
fun comNegrito(texto: String): AnnotatedString = buildAnnotatedString {
    val partes = texto.split("**")
    partes.forEachIndexed { i, p ->
        // partes ímpares estão entre dois "**"; se o fecho faltar, o último pedaço fica normal
        if (i % 2 == 1 && i < partes.size - 1) withStyle(SpanStyle(fontWeight = FontWeight.W700)) { append(p) } else append(p)
    }
}

@Composable
fun MarkdownSimples(texto: String, modifier: Modifier = Modifier, cor: Color = Cores.Tinta2) {
    val linhas = texto.replace("\r\n", "\n").split('\n')
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        var vazias = 0
        linhas.forEach { bruta ->
            val l = bruta.trimEnd()
            if (l.isBlank()) {
                vazias++
                if (vazias == 1) Spacer(Modifier.height(6.dp))
                return@forEach
            }
            vazias = 0
            tituloRe.find(l)?.let { m ->
                Text(comNegrito(m.groupValues[1].trim()), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 6.dp))
                return@forEach
            }
            itemRe.find(l)?.let { m ->
                Row(Modifier.fillMaxWidth()) {
                    Text("•", style = MaterialTheme.typography.bodyMedium, color = Cores.AcaiEscuro, modifier = Modifier.width(16.dp))
                    Text(comNegrito(m.groupValues[1].trim()), style = MaterialTheme.typography.bodyMedium, color = cor, modifier = Modifier.weight(1f))
                }
                return@forEach
            }
            numeradoRe.find(l)?.let { m ->
                Row(Modifier.fillMaxWidth()) {
                    Text("${m.groupValues[1]}.", style = MaterialTheme.typography.bodyMedium, color = Cores.AcaiEscuro, modifier = Modifier.width(22.dp))
                    Text(comNegrito(m.groupValues[2].trim()), style = MaterialTheme.typography.bodyMedium, color = cor, modifier = Modifier.weight(1f))
                }
                return@forEach
            }
            Text(comNegrito(l.trim()), style = MaterialTheme.typography.bodyMedium, color = cor)
        }
    }
}
