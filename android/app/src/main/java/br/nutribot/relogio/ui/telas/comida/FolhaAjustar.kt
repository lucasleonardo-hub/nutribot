package br.nutribot.relogio.ui.telas.comida

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Item
import br.nutribot.relogio.dados.Refeicao
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.Esperando
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.tema.Cores
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * Folha "Ajustar refeição": uma barra em gramas por item (0 até 2x o original, passo 5 g) com kcal e macros recalculados ao
 * vivo na proporção; kcal/P/C/G editáveis (se a pessoa mexer neles, mandam no corpo e vencem o recálculo); descrição, slot e hora.
 * Manda PUT /perfis/:id/refeicoes/:rid só com o que mudou.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FolhaAjustar(vm: AppVM, perfilId: String, r: Refeicao, aoFechar: () -> Unit, aoSalvar: (Refeicao, JSONObject?) -> Unit) {
    val escopo = rememberCoroutineScope()
    val escrita by vm.escrita.collectAsStateWithLifecycle()
    val gramas = remember(r.id) { mutableStateListOf(*r.itens.map { (it.gramas ?: 0.0).toFloat() }.toTypedArray()) }
    // null = o campo segue o recálculo; texto = a pessoa mexeu e o valor dela vale
    var kcalManual by remember(r.id) { mutableStateOf<String?>(null) }
    var pManual by remember(r.id) { mutableStateOf<String?>(null) }
    var cManual by remember(r.id) { mutableStateOf<String?>(null) }
    var gManual by remember(r.id) { mutableStateOf<String?>(null) }
    var descricao by remember(r.id) { mutableStateOf(r.descricao ?: "") }
    var slot by remember(r.id) { mutableStateOf(Slots.normalizar(r.slot) ?: Slots.pelaHora()) }
    var hora by remember(r.id) { mutableStateOf(r.hora ?: "") }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    /**
     * Recálculo na proporção: cada item com gramas contribui `valor × (novas/originais − 1)` sobre o total original
     * (assim os itens sem gramas e a parte do total que não está nos itens ficam fixos). Sem total original, soma os itens.
     */
    fun recalculado(total: Double?, campo: (Item) -> Double?): Double? {
        val base = total ?: r.itens.mapNotNull(campo).takeIf { it.isNotEmpty() }?.sum() ?: return null
        var v = base
        r.itens.forEachIndexed { i, it ->
            val g0 = it.gramas ?: return@forEachIndexed
            val x = campo(it) ?: return@forEachIndexed
            if (g0 > 0) v += x * (gramas[i] / g0 - 1)
        }
        return v.coerceAtLeast(0.0)
    }
    val kcalCalc = recalculado(r.kcal) { it.kcal }
    val pCalc = recalculado(r.p) { it.p }
    val cCalc = recalculado(r.c) { it.c }
    val gCalc = recalculado(r.g) { it.g }
    fun texto(v: Double?): String = v?.roundToInt()?.toString() ?: ""

    fun salvar() {
        if (hora.isNotBlank() && !Formato.horaValida(hora)) { erro = "Hora no formato HH:MM."; return }
        if (descricao.trim().length > 220) { erro = "Descrição: até 220 caracteres."; return }
        val corpo = JSONObject()
        val mudouGramas = r.itens.indices.any { i -> r.itens[i].gramas != null && abs(gramas[i] - (r.itens[i].gramas ?: 0.0)) >= 0.5 }
        if (mudouGramas) {
            corpo.put("itens", JSONArray().apply {
                r.itens.forEachIndexed { i, it -> if (it.gramas != null) put(JSONObject().put("nome", it.nome).put("gramas", gramas[i].roundToInt())) }
            })
        }
        if (descricao.trim() != (r.descricao ?: "")) corpo.put("descricao", descricao.trim())
        if (slot != Slots.normalizar(r.slot)) corpo.put("slot", slot)
        if (hora.isNotBlank() && hora.trim() != r.hora) corpo.put("hora", hora.trim())
        fun manual(chave: String, m: String?, original: Double?) {
            val v = Formato.numeroDigitado(m) ?: return
            if (v < 0) return
            if (original == null || abs(v - original) >= 0.5) corpo.put(chave, v)
        }
        manual("kcal", kcalManual, r.kcal)
        manual("p", pManual, r.p)
        manual("c", cManual, r.c)
        manual("g", gManual, r.g)
        if (corpo.length() == 0) { aoFechar(); return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                val j = vm.escrever("PUT", AppVM.rotaRefeicao(perfilId, r.id), corpo)
                val nova = j.obj("refeicao")?.let { Refeicao.de(it) } ?: r
                aoSalvar(nova, j.obj("hoje"))
            } catch (e: ErroApi) {
                erro = if (e.semConexao) "Sem resposta do servidor. Tente de novo." else e.paraPessoa
            } catch (e: CancellationException) {
                throw e
            } finally {
                enviando = false
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!enviando) aoFechar() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Cores.Lavanda,
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(start = 18.dp, end = 18.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Ajustar ${r.nome}", style = MaterialTheme.typography.headlineMedium)
            if (enviando) {
                Esperando("Salvando o ajuste…", escrita, Pose.DuplaConferindo)
                return@Column
            }
            val comGramas = r.itens.withIndex().filter { (it.value.gramas ?: 0.0) > 0 }
            if (comGramas.isNotEmpty()) {
                Text("Quantidade de cada item", style = MaterialTheme.typography.labelLarge)
                comGramas.forEach { (i, item) ->
                    val g0 = item.gramas ?: return@forEach
                    val max = (ceil(2 * g0 / 5.0) * 5).toFloat().coerceAtLeast(5f)
                    val kcalItem = item.kcal?.let { k -> k * gramas[i] / g0 }
                    val rotulo = "${item.nome} — ${gramas[i].roundToInt()} g" + (kcalItem?.let { k -> " · ${Formato.kcal(k)} kcal" } ?: "")
                    Column {
                        Text(rotulo, style = MaterialTheme.typography.bodyMedium)
                        Slider(
                            value = gramas[i],
                            onValueChange = { gramas[i] = (it / 5f).roundToInt() * 5f },
                            valueRange = 0f..max,
                            steps = ((max / 5f).roundToInt() - 1).coerceAtLeast(0),
                            colors = SliderDefaults.colors(thumbColor = Cores.Acai, activeTrackColor = Cores.Acai, inactiveTrackColor = Cores.Trilho, activeTickColor = Cores.Acai, inactiveTickColor = Cores.LilasMedio),
                            modifier = Modifier.fillMaxWidth().semantics { contentDescription = rotulo },
                        )
                    }
                }
            } else {
                Text("Registro do WhatsApp: sem itens em gramas. Ajuste os totais.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            }
            Text("Totais da refeição", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(kcalManual ?: texto(kcalCalc), { kcalManual = it }, label = { Text("kcal") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                OutlinedTextField(pManual ?: texto(pCalc), { pManual = it }, label = { Text("Proteína g") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(cManual ?: texto(cCalc), { cManual = it }, label = { Text("Carboidrato g") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                OutlinedTextField(gManual ?: texto(gCalc), { gManual = it }, label = { Text("Gordura g") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
            }
            if (listOf(kcalManual, pManual, cManual, gManual).any { it != null }) {
                Text("Totais digitados valem no lugar das gramas.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
            }
            OutlinedTextField(descricao, { descricao = it }, label = { Text("Descrição") }, minLines = 1, maxLines = 3, modifier = Modifier.fillMaxWidth())
            Text("Qual refeição?", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Slots.todos.forEach { (id, nome) -> Chip(nome, slot == id) { slot = id } }
            }
            OutlinedTextField(
                hora, { hora = it.take(5) }, label = { Text("Hora") }, placeholder = { Text("HH:MM") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(140.dp),
                isError = hora.isNotBlank() && !Formato.horaValida(hora),
            )
            erro?.let { AvisoErro(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Botao("Cancelar", Modifier.weight(1f), suave = true) { aoFechar() }
                Botao("Salvar", Modifier.weight(1f)) { salvar() }
            }
        }
    }
}
