package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.semZap
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Uma troca com a Nutri: o que a pessoa perguntou e o que ela respondeu. Fica só em memória, nesta sessão do app. */
data class Troca(val pergunta: String, val resposta: String)

private const val MAX_TEXTO = 400
private const val ANTERIORES = 5
private val sugestoes = listOf("O que como agora?", "Como foi minha semana?", "Posso treinar hoje?")
private val iconeEnviar = icone("M12 19V5", "M5 12l7-7 7 7")

/**
 * As trocas da sessão, guardadas fora da folha (sobrevivem a fechar a folha e à rotação; zeram ao trocar de perfil).
 * Serializadas como uma lista plana [pergunta, resposta, pergunta, resposta…].
 */
@Composable
fun rememberTrocas(perfilId: String?): SnapshotStateList<Troca> = rememberSaveable(
    perfilId,
    saver = listSaver<SnapshotStateList<Troca>, String>(
        save = { lista -> lista.flatMap { listOf(it.pergunta, it.resposta) } },
        restore = { plana -> mutableStateListOf<Troca>().apply { plana.chunked(2).forEach { if (it.size == 2) add(Troca(it[0], it[1])) } } },
    ),
) { mutableStateListOf() }

/**
 * Folha "Perguntar à Nutri" (fase 5): o mascote, as trocas em balões, o campo (≤ 400 letras) e o botão de enviar.
 * POST /perfis/:id/perguntar { texto, anteriores: últimas 5 trocas } -> { resposta }. Nada é gravado no servidor.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolhaPerguntar(vm: AppVM, perfil: Perfil, trocas: SnapshotStateList<Troca>, aoFechar: () -> Unit) {
    var texto by rememberSaveable { mutableStateOf("") }
    var pensando by rememberSaveable { mutableStateOf(false) }
    var erro by rememberSaveable { mutableStateOf<String?>(null) }
    val escrita by vm.escrita.collectAsStateWithLifecycle()
    val escopo = rememberCoroutineScope()
    val rolagem = rememberScrollState()

    // a lista rola até o fim quando chega uma resposta ou começa a espera
    LaunchedEffect(trocas.size, pensando) { rolagem.animateScrollTo(rolagem.maxValue) }

    fun enviar(bruto: String) {
        val t = bruto.trim().take(MAX_TEXTO)
        if (t.isBlank() || pensando) return
        erro = null
        pensando = true
        texto = ""
        escopo.launch {
            try {
                val anteriores = JSONArray()
                trocas.takeLast(ANTERIORES).forEach { anteriores.put(JSONObject().put("pergunta", it.pergunta).put("resposta", it.resposta)) }
                val j = vm.escrever("POST", AppVM.rotaPerguntar(perfil.id), JSONObject().put("texto", t).put("anteriores", anteriores))
                val resposta = j.str("resposta")?.let { semZap(it) }?.takeIf { it.isNotBlank() } ?: "A Nutri não respondeu. Tente de novo."
                trocas.add(Troca(t, resposta))
            } catch (e: ErroApi) {
                erro = when {
                    e.status == 429 -> "Muitas perguntas agora. Espere um pouco."
                    e.semConexao -> "Sem resposta do servidor. Tente de novo."
                    else -> e.paraPessoa
                }
                texto = t // devolve o que a pessoa escreveu para tentar de novo
            } catch (e: CancellationException) {
                throw e
            } finally {
                pensando = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = aoFechar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Cores.Lavanda) {
        Column(
            Modifier.fillMaxWidth().imePadding().navigationBarsPadding().padding(start = 18.dp, end = 18.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.LontraChef, 56.dp)
                Column(Modifier.weight(1f)) {
                    Text("Pergunte à Nutri", style = MaterialTheme.typography.headlineMedium)
                    Text("Resposta curta, com o que ela sabe de hoje. Nada fica guardado.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
            }
            Column(
                Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rolagem),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (trocas.isEmpty() && !pensando) {
                    Text("Por exemplo:", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3)
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.Start) {
                        sugestoes.forEach { s -> Chip(s, false, papel = Role.Button) { enviar(s) } }
                    }
                }
                trocas.forEach { t ->
                    Balao(t.pergunta, pergunta = true)
                    Balao(t.resposta, pergunta = false)
                }
                if (pensando) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 2.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), color = Cores.Acai, strokeWidth = 2.dp)
                        Text(if (escrita.acordando) "Pensando… o servidor está acordando, pode levar até 1 minuto." else "Pensando…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    }
                }
                erro?.let { AvisoErro(it) }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    texto, { texto = it.take(MAX_TEXTO) },
                    placeholder = { Text("Pergunte algo rápido") },
                    supportingText = if (texto.length >= MAX_TEXTO - 60) ({ Text("${texto.length}/$MAX_TEXTO", textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth()) }) else null,
                    maxLines = 3,
                    enabled = !pensando,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { enviar(texto) }),
                    modifier = Modifier.weight(1f),
                )
                val pode = texto.isNotBlank() && !pensando
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(if (pode) Cores.AcaiEscuro else Cores.Trilho)
                        .clickable(enabled = pode, role = Role.Button) { enviar(texto) }
                        .semantics { contentDescription = "Enviar pergunta" },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(iconeEnviar, contentDescription = null, tint = if (pode) Cores.Branco else Cores.Tinta4, modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

/** Balão da conversa: a pergunta à direita (açaí, texto branco), a resposta à esquerda (branco). */
@Composable
private fun Balao(texto: String, pergunta: Boolean) {
    val forma = if (pergunta) RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp) else RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)
    Box(Modifier.fillMaxWidth(), contentAlignment = if (pergunta) Alignment.CenterEnd else Alignment.CenterStart) {
        Text(
            texto,
            style = MaterialTheme.typography.bodyMedium,
            color = if (pergunta) Cores.Branco else Cores.Tinta,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(forma)
                .background(if (pergunta) Cores.Acai else Cores.Branco)
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .semantics { contentDescription = (if (pergunta) "Você: " else "Nutri: ") + texto },
        )
    }
}
