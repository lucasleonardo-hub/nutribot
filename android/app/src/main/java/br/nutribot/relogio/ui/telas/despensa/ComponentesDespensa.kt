package br.nutribot.relogio.ui.telas.despensa

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.SeloValidade
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.rotuloUnidade
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka

/** Laranja do selo "vence em 2 dias" (o mesmo pêssego queimado do "semana abaixo da faixa" do Hoje). */
internal val LaranjaFundo = Color(0xFFFFE9D6)
internal val LaranjaTinta = Color(0xFF8A4B12)

private val iconeVoltar = icone("M15 6l-6 6 6 6")
internal val iconeSetaDespensa = icone("M6 9l6 6 6-6")
internal val iconeCesta = icone("M4 10h16l-1.5 9h-13z", "M8 10l3-6M16 10l-3-6", "M9 14v2M15 14v2")

/** Unidades oferecidas ao adicionar um item (as chaves que o servidor aceita). */
internal val unidadesDespensa = listOf("un", "kg", "g", "l", "ml", "pct")

/** Mensagem de uma escrita que falhou. Rota que o servidor ainda não tem vira o aviso da atualização. */
internal fun mensagemErroDespensa(e: ErroApi): String = when {
    e.status == 404 && e.codigo == "rota_inexistente" -> "Isso chega com a próxima atualização do servidor."
    e.semConexao -> "Sem resposta do servidor. Tente de novo."
    else -> e.paraPessoa
}

/** O servidor ainda não tem a rota (servidor antigo): a tela mostra o aviso em vez do erro genérico. */
internal fun ErroApi?.rotaAusente(): Boolean = this != null && status == 404 && codigo == "rota_inexistente"

/** Botão de voltar da tela cheia (48 dp). */
@Composable
internal fun BotaoVoltar(aoTocar: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(Formas.Pilula).background(Cores.Branco)
            .clickable(role = Role.Button, onClickLabel = "Voltar", onClick = aoTocar)
            .semantics { contentDescription = "Voltar" },
        contentAlignment = Alignment.Center,
    ) { Icon(iconeVoltar, contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(20.dp)) }
}

/** Texto do selo de validade. */
internal fun textoSelo(selo: SeloValidade, dias: Int?): String = when (selo) {
    SeloValidade.Passou -> "passou do prazo: ainda tem?"
    SeloValidade.VenceLogo -> when (dias) {
        0 -> "vence hoje"
        1 -> "vence amanhã"
        null -> "vence logo"
        else -> "vence em $dias dias"
    }
}

/** Selo laranja (vence logo) ou vermelho (passou do prazo). */
@Composable
internal fun SeloDeValidade(selo: SeloValidade, dias: Int?, modifier: Modifier = Modifier) {
    val (fundo, tinta) = when (selo) {
        SeloValidade.VenceLogo -> LaranjaFundo to LaranjaTinta
        SeloValidade.Passou -> Cores.CuidadoFundo to Cores.CuidadoTinta
    }
    Pilula(textoSelo(selo, dias), fundo, tinta, modifier, ponto = true)
}

/** Ação de um item em pílula (48 dp): destaque = açaí escuro; o resto, suave. */
@Composable
internal fun BotaoAcao(texto: String, destaque: Boolean = false, habilitado: Boolean = true, rotulo: String? = null, aoTocar: () -> Unit) {
    val fundo = when {
        !habilitado -> Cores.Trilho
        destaque -> Cores.AcaiEscuro
        else -> Cores.Trilho
    }
    val tinta = when {
        !habilitado -> Cores.Tinta4
        destaque -> Cores.Branco
        else -> Cores.LilasTexto
    }
    Box(
        Modifier.heightIn(min = 48.dp).clip(Formas.Pilula).background(fundo)
            .clickable(enabled = habilitado, role = Role.Button, onClickLabel = rotulo, onClick = aoTocar)
            .let { m -> if (rotulo != null) m.semantics { contentDescription = rotulo } else m }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) { Text(texto, color = tinta, fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, maxLines = 1) }
}

/** Botão quadrado de menos ou mais (48 dp). */
@Composable
private fun BotaoPasso(texto: String, rotulo: String, habilitado: Boolean, aoTocar: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(Formas.Pequeno).background(Cores.Trilho)
            .clickable(enabled = habilitado, role = Role.Button, onClickLabel = rotulo, onClick = aoTocar)
            .semantics { contentDescription = rotulo },
        contentAlignment = Alignment.Center,
    ) { Text(texto, fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 22.sp, color = if (habilitado) Cores.AcaiEscuro else Cores.Tinta4) }
}

/** Passo do menos/mais: meio em kg e litro, 50 em g e ml, 1 no resto. */
private fun passoDe(unidade: String?): Double = when (unidade?.lowercase()) {
    "kg", "l" -> 0.5
    "g", "ml" -> 50.0
    else -> 1.0
}

/** Número para o campo (sem separador de milhar, vírgula decimal): 1, 1,5, 0,25. */
private fun textoNumero(v: Double): String =
    if (v == Math.floor(v)) v.toLong().toString()
    else String.format(java.util.Locale.US, "%.2f", v).trimEnd('0').trimEnd('.').replace('.', ',')

/** Valor inicial do campo: 100 em g e ml, 1 no resto. */
private fun inicialDe(unidade: String?): String = if (passoDe(unidade) == 50.0) "100" else "1"

/** Campo de quantidade com menos e mais. */
@Composable
private fun CampoQuantidade(valor: String, unidade: String?, habilitado: Boolean, aoMudar: (String) -> Unit) {
    val passo = passoDe(unidade)
    val atual = Formato.numeroDigitado(valor) ?: 0.0
    val sufixo = rotuloUnidade(unidade).takeIf { it != "unidade" }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BotaoPasso("−", "Diminuir", habilitado && atual > passo) { aoMudar(textoNumero((atual - passo).coerceAtLeast(passo))) }
        OutlinedTextField(
            valor, { aoMudar(it.take(7)) },
            singleLine = true, enabled = habilitado,
            label = { Text("Quantidade") },
            suffix = if (sufixo != null) {
                { Text(sufixo) }
            } else {
                null
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.Center),
            modifier = Modifier.width(140.dp),
        )
        BotaoPasso("+", "Aumentar", habilitado) { aoMudar(textoNumero(atual + passo)) }
    }
}

/**
 * Diálogo de quantidade (Usei, Comprei): começa em 1 (ou no passo da unidade) e manda o número digitado.
 * `enviando` trava os botões; `erro` aparece embaixo do campo.
 */
@Composable
internal fun DialogoQuantidade(
    titulo: String,
    explicacao: String,
    unidade: String?,
    confirmar: String,
    enviando: Boolean,
    erro: String?,
    aoFechar: () -> Unit,
    aoConfirmar: (Double) -> Unit,
) {
    var valor by rememberSaveable(titulo) { mutableStateOf(inicialDe(unidade)) }
    val numero = Formato.numeroDigitado(valor)?.takeIf { it > 0 }
    AlertDialog(
        onDismissRequest = { if (!enviando) aoFechar() },
        containerColor = Cores.Branco,
        title = { Text(titulo, style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(explicacao, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                CampoQuantidade(valor, unidade, !enviando) { valor = it }
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = { Botao(if (enviando) "Enviando…" else confirmar, habilitado = !enviando && numero != null) { numero?.let(aoConfirmar) } },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
}

/** As categorias que o POST /despensa aceita (api-lacunas-montadores.CATEGORIAS_DESPENSA), na ordem da cozinha. */
private val categoriasDespensa = listOf(
    "carne" to "carne", "frango" to "frango", "peixe" to "peixe", "ovo" to "ovo", "laticínio" to "laticínio", "fruta" to "fruta",
    "verdura" to "verdura", "legume" to "legume", "pão" to "pão", "mercearia" to "mercearia", "congelado" to "congelado",
    "bebida" to "bebida", "outro" to "outro",
)

/** Diálogo "Adicionar item": nome, quantidade, unidade e o tipo (categoria). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DialogoAdicionar(enviando: Boolean, erro: String?, aoFechar: () -> Unit, aoConfirmar: (String, Double?, String, String?) -> Unit) {
    var nome by rememberSaveable { mutableStateOf("") }
    var unidade by rememberSaveable { mutableStateOf("un") }
    var valor by rememberSaveable { mutableStateOf("1") }
    // a categoria decide a ordem da cozinha, se o item é perecível e a validade padrão (sem escolher, o servidor põe "outro")
    var categoria by rememberSaveable { mutableStateOf<String?>(null) }
    val numero = Formato.numeroDigitado(valor)?.takeIf { it > 0 }
    AlertDialog(
        onDismissRequest = { if (!enviando) aoFechar() },
        containerColor = Cores.Branco,
        title = { Text("Adicionar à despensa", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    nome, { nome = it.take(60) },
                    label = { Text("O que é?") }, placeholder = { Text("ex.: arroz integral") },
                    singleLine = true, enabled = !enviando,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.fillMaxWidth(),
                )
                CampoQuantidade(valor, unidade, !enviando) { valor = it }
                Text("Unidade", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    unidadesDespensa.forEach { u -> Chip(rotuloUnidade(u), unidade == u) { unidade = u } }
                }
                Text("Tipo", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    categoriasDespensa.forEach { (c, rotulo) -> Chip(rotulo, categoria == c) { categoria = if (categoria == c) null else c } }
                }
                Text("Se o item já está na despensa, a quantidade soma.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = {
            Botao(if (enviando) "Enviando…" else "Adicionar", habilitado = !enviando && nome.isNotBlank()) { aoConfirmar(nome.trim(), numero, unidade, categoria) }
        },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
}

/** Confirmação curta (tirar da lista). */
@Composable
internal fun DialogoConfirmar(titulo: String, texto: String, confirmar: String, enviando: Boolean, erro: String?, aoFechar: () -> Unit, aoConfirmar: () -> Unit) {
    AlertDialog(
        onDismissRequest = { if (!enviando) aoFechar() },
        containerColor = Cores.Branco,
        title = { Text(titulo, style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(texto, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = { Botao(if (enviando) "Enviando…" else confirmar, habilitado = !enviando) { aoConfirmar() } },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
}

/** Recado de confirmação depois de uma ação (verde). */
@Composable
internal fun RecadoFeito(texto: String, modifier: Modifier = Modifier) {
    Text(
        texto, color = Cores.BomTinta, style = MaterialTheme.typography.bodySmall,
        modifier = modifier.fillMaxWidth().clip(Formas.Pequeno).background(Cores.BomFundo).padding(horizontal = 12.dp, vertical = 8.dp),
    )
}
