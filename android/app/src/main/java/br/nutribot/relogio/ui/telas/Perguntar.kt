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
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import br.nutribot.relogio.dados.PerguntaApp
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.semZap
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Uma troca com a Nutri: o que a pessoa perguntou e o que ela respondeu. Fase 7: `id` = a troca guardada no servidor
 * (coleção perguntas_app), que dá para apagar; null = servidor antigo, que não guarda (a troca fica só nesta sessão).
 * `dia` = o dia da troca (AAAA-MM-DD), para separar as conversas antigas por dia.
 */
data class Troca(val pergunta: String, val resposta: String, val id: String? = null, val dia: String? = null)

private const val MAX_TEXTO = 400
private const val ANTERIORES = 5
private const val HISTORICO_INICIAL = 20
private const val HISTORICO_MAX = 100
private val sugestoes = listOf("O que como agora?", "Como foi minha semana?", "Posso treinar hoje?")
private val iconeEnviar = icone("M12 19V5", "M5 12l7-7 7 7")

/**
 * As trocas desta sessão, guardadas fora da folha (sobrevivem a fechar a folha e à rotação; zeram ao trocar de perfil).
 * Serializadas como uma lista plana [pergunta, resposta, id, dia, …] (id e dia vazios = null).
 */
@Composable
fun rememberTrocas(perfilId: String?): SnapshotStateList<Troca> = rememberSaveable(
    perfilId,
    saver = listSaver<SnapshotStateList<Troca>, String>(
        save = { lista -> lista.flatMap { listOf(it.pergunta, it.resposta, it.id ?: "", it.dia ?: "") } },
        restore = { plana ->
            mutableStateListOf<Troca>().apply {
                plana.chunked(4).forEach { if (it.size == 4) add(Troca(it[0], it[1], it[2].ifBlank { null }, it[3].ifBlank { null })) }
            }
        },
    ),
) { mutableStateListOf() }

/** O que pede confirmação na folha: apagar uma troca ou todas. */
private sealed class Apagar {
    data class Uma(val id: String) : Apagar()
    data object Todas : Apagar()
}

/**
 * Folha "Perguntar à Nutri" (fase 5; fase 7 com o histórico do servidor). O mascote, as trocas em balões (as guardadas no
 * servidor primeiro, depois as desta sessão que ainda não voltaram de lá), o campo (≤ 400 letras) e o botão de enviar.
 * POST /perfis/:id/perguntar { texto, anteriores } -> { resposta, id? }. GET /perfis/:id/perguntas?n= traz o histórico;
 * DELETE /perfis/:id/perguntas/:pid apaga uma troca e DELETE /perfis/:id/perguntas?confirmar=sim apaga todas.
 * Pergunta feita aqui é confidência (D10): a Nutri leva em conta e não cita no grupo.
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

    // histórico do servidor: o último que chegou fica guardado enquanto um pedido maior ("ver mais antigas") carrega
    var quantas by rememberSaveable(perfil.id) { mutableIntStateOf(HISTORICO_INICIAL) }
    val rotaHist = AppVM.rotaPerguntas(perfil.id, quantas)
    val histCarga by vm.carga(rotaHist).collectAsStateWithLifecycle()
    LaunchedEffect(rotaHist) { vm.carregar(rotaHist) }
    var ultimoHist by remember(perfil.id) { mutableStateOf<List<PerguntaApp>>(emptyList()) }
    LaunchedEffect(histCarga.dados) { histCarga.dados?.let { ultimoHist = PerguntaApp.lista(it) } }
    val apagadas = remember(perfil.id) { mutableStateListOf<String>() }
    var confirmar by remember { mutableStateOf<Apagar?>(null) }

    val servidor = ultimoHist.filter { it.id !in apagadas }
    val idsServidor = servidor.map { it.id }.toSet()
    val recentes = servidor.takeLast(10).map { it.pergunta }.toSet()
    val daSessao = trocas.filter { t -> if (t.id != null) t.id !in idsServidor && t.id !in apagadas else t.pergunta !in recentes }
    val exibidas = servidor.map { Troca(it.pergunta, semZap(it.resposta), it.id, it.dia?.take(10)) } + daSessao
    // o histórico do servidor antigo (sem a rota) volta 404: aí a folha funciona como antes, só com a sessão
    val erroHist = histCarga.erro?.takeIf { histCarga.dados == null && it.status != 404 }

    // a lista rola até o fim quando chega uma resposta, chega o histórico ou começa a espera
    LaunchedEffect(exibidas.size, pensando) { rolagem.animateScrollTo(rolagem.maxValue) }

    fun enviar(bruto: String) {
        val t = bruto.trim().take(MAX_TEXTO)
        if (t.isBlank() || pensando) return
        erro = null
        pensando = true
        texto = ""
        escopo.launch {
            try {
                val anteriores = JSONArray()
                exibidas.takeLast(ANTERIORES).forEach { anteriores.put(JSONObject().put("pergunta", it.pergunta).put("resposta", it.resposta)) }
                val j = vm.escrever("POST", AppVM.rotaPerguntar(perfil.id), JSONObject().put("texto", t).put("anteriores", anteriores))
                val resposta = j.str("resposta")?.let { semZap(it) }?.takeIf { it.isNotBlank() } ?: "A Nutri não respondeu. Tente de novo."
                val id = j.str("id") ?: j.obj("pergunta").str("id") ?: j.obj("troca").str("id")
                trocas.add(Troca(t, resposta, id, j.str("dia")))
                if (id != null) vm.carregar(rotaHist, forcar = true)
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
                    Text("Fica guardado só para você. A Nutri leva em conta e não comenta no grupo.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
            }
            Column(
                Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rolagem),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (servidor.size >= quantas && quantas < HISTORICO_MAX) {
                    Link("Ver conversas mais antigas") { quantas = (quantas + 40).coerceAtMost(HISTORICO_MAX) }
                }
                if (histCarga.carregando && ultimoHist.isEmpty()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), color = Cores.Acai, strokeWidth = 2.dp)
                        Text(if (histCarga.acordando) "Buscando as conversas… o servidor está acordando." else "Buscando as conversas…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    }
                }
                if (erroHist != null) {
                    Text("As conversas antigas não vieram: ${erroHist.paraPessoa}", style = MaterialTheme.typography.bodySmall, color = Cores.CuidadoTinta)
                    Link("tentar de novo") { vm.carregar(rotaHist, forcar = true) }
                }
                if (exibidas.isEmpty() && !pensando) {
                    Text("Por exemplo:", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3)
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.Start) {
                        sugestoes.forEach { s -> Chip(s, false, papel = Role.Button) { enviar(s) } }
                    }
                }
                var diaAnterior: String? = null
                exibidas.forEach { t ->
                    // separador por dia nas conversas guardadas ("14/10"), só quando o dia muda
                    if (t.dia != null && t.dia != diaAnterior) {
                        Formato.dia(t.dia)?.let { d ->
                            Text(Formato.diaLongo(d).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelMedium, color = Cores.Tinta4, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
                        }
                        diaAnterior = t.dia
                    }
                    Balao(t.pergunta, pergunta = true)
                    Balao(t.resposta, pergunta = false)
                    val id = t.id
                    if (id != null) {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
                            Link("apagar esta conversa") { confirmar = Apagar.Uma(id) }
                        }
                    }
                }
                if (pensando) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 2.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), color = Cores.Acai, strokeWidth = 2.dp)
                        Text(if (escrita.acordando) "Pensando… o servidor está acordando, pode levar até 1 minuto." else "Pensando…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    }
                }
                erro?.let { AvisoErro(it) }
                if (exibidas.isNotEmpty() && !pensando) {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                        Link("Apagar todas as conversas") { confirmar = Apagar.Todas }
                    }
                }
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

    when (val c = confirmar) {
        is Apagar.Uma -> DialogoApagarConversa(
            vm, titulo = "Apagar esta conversa?", texto = "Some do app e a Nutri deixa de levar em conta.",
            rota = AppVM.rotaPerguntaApp(perfil.id, c.id), soLocal = false,
            aoFechar = { confirmar = null },
        ) {
            apagadas.add(c.id)
            trocas.removeAll { it.id == c.id }
            vm.carregar(rotaHist, forcar = true)
        }
        Apagar.Todas -> DialogoApagarConversa(
            vm, titulo = "Apagar todas as conversas?", texto = "Some tudo o que você perguntou aqui. A Nutri deixa de levar em conta.",
            // a troca desta sessão que voltou com id já está gravada no servidor: aí o DELETE é obrigatório
            rota = AppVM.rotaApagarPerguntas(perfil.id), soLocal = servidor.isEmpty() && trocas.none { it.id != null },
            aoFechar = { confirmar = null },
        ) {
            apagadas.addAll(servidor.map { it.id })
            apagadas.addAll(trocas.mapNotNull { it.id })
            trocas.clear()
            ultimoHist = emptyList()
            vm.carregar(rotaHist, forcar = true)
        }
        null -> {}
    }
}

/**
 * Confirmação antes de apagar: DELETE na rota e, se deu certo, `aoApagar`. `soLocal` = não há nada no servidor (servidor
 * antigo): só limpa a sessão, sem chamar a API.
 */
@Composable
private fun DialogoApagarConversa(vm: AppVM, titulo: String, texto: String, rota: String, soLocal: Boolean, aoFechar: () -> Unit, aoApagar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
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
        confirmButton = {
            Botao(if (enviando) "Apagando…" else "Apagar", habilitado = !enviando) {
                if (soLocal) { aoApagar(); aoFechar(); return@Botao }
                escopo.launch {
                    enviando = true
                    erro = null
                    try {
                        vm.escrever("DELETE", rota, null)
                        aoApagar()
                        aoFechar()
                    } catch (e: ErroApi) {
                        erro = if (e.semConexao) "Sem resposta do servidor. Tente de novo." else e.paraPessoa
                    } catch (e: CancellationException) {
                        throw e
                    } finally {
                        enviando = false
                    }
                }
            }
        },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
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
