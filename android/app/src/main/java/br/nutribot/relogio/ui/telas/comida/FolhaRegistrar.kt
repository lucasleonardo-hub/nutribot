package br.nutribot.relogio.ui.telas.comida

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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
import br.nutribot.relogio.ui.tema.Formas
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Folha "Registrar refeição": texto e/ou até 2 fotos (câmera do sistema ou galeria), slot, hora e o dia escolhido na tela.
 * Manda POST /perfis/:id/refeicoes com as fotos reduzidas (1280 px, JPEG 80) e a miniatura (160 px). A IA do servidor
 * estima; enquanto isso Caju olha o prato com a lupa. Erros ficam na folha, com o texto editável.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FolhaRegistrar(
    vm: AppVM,
    perfilId: String,
    dia: String,
    slotInicial: String?,
    aoFechar: () -> Unit,
    aoRegistrar: (Refeicao, JSONObject?) -> Unit,
) {
    val ctx = LocalContext.current
    val escopo = rememberCoroutineScope()
    val escrita by vm.escrita.collectAsStateWithLifecycle()
    var texto by rememberSaveable { mutableStateOf("") }
    var slot by rememberSaveable { mutableStateOf(Slots.normalizar(slotInicial) ?: Slots.pelaHora()) }
    var hora by rememberSaveable { mutableStateOf(Formato.agoraHHMM()) }
    // o arquivo que a câmera vai gravar fica guardado pelo nome: se o processo morrer com a câmera aberta, o resultado ainda acha a foto
    var arquivoCamera by rememberSaveable { mutableStateOf<String?>(null) }
    val fotos = remember { mutableStateListOf<FotoPronta>() }
    var processando by remember { mutableStateOf(false) }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    fun processar(uri: Uri) {
        if (fotos.size >= 2) return
        escopo.launch {
            processando = true
            erro = null
            val pronta = withContext(Dispatchers.IO) { runCatching { Imagens.reduzir(ctx, uri) }.getOrNull() }
            if (pronta == null) erro = "Não consegui ler essa foto. Tente outra." else fotos.add(pronta)
            processando = false
        }
    }

    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val nome = arquivoCamera
        if (ok && nome != null) {
            val f = File(Imagens.pastaFotos(ctx), nome)
            processar(Uri.fromFile(f))
        }
    }
    val galeria = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) processar(uri) }

    fun tirarFoto() {
        val f = File(Imagens.pastaFotos(ctx), "foto_${System.currentTimeMillis()}.jpg")
        arquivoCamera = f.name
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fotos", f)
        runCatching { camera.launch(uri) }.onFailure { erro = "Sem app de câmera. Use a galeria." }
    }

    fun enviar() {
        val t = texto.trim()
        if (t.isBlank() && fotos.isEmpty()) { erro = "Escreva o que você comeu ou mande uma foto."; return }
        if (!Formato.horaValida(hora)) { erro = "Hora no formato HH:MM."; return }
        if (t.length > 500) { erro = "Até 500 caracteres."; return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                val corpo = withContext(Dispatchers.IO) {
                    JSONObject().apply {
                        if (t.isNotBlank()) put("texto", t)
                        if (fotos.isNotEmpty()) {
                            put("fotos", JSONArray().apply { fotos.forEach { put(JSONObject().put("mime", "image/jpeg").put("base64", it.base64)) } })
                            Imagens.miniatura(fotos[0].jpeg)?.let { put("miniatura", it) }
                        }
                        put("slot", slot)
                        put("hora", hora.trim())
                        put("dia", dia)
                    }
                }
                val j = vm.escrever("POST", AppVM.rotaNovaRefeicao(perfilId), corpo)
                val r = j.obj("refeicao")?.let { Refeicao.de(it) } ?: throw ErroApi(201, "resposta_invalida", "Registrado. Puxe para atualizar.")
                Imagens.limparTemporarias(ctx)
                aoRegistrar(r, j.obj("hoje"))
            } catch (e: ErroApi) {
                erro = when {
                    e.status == 422 -> e.message ?: "A Nutri não viu comida aí. Descreva melhor."
                    e.semConexao -> "Sem resposta do servidor. Tente de novo."
                    else -> e.paraPessoa
                }
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
            Text("Registrar refeição", style = MaterialTheme.typography.headlineMedium)
            Text(Formato.dia(dia)?.let { Formato.diaLongo(it) } ?: dia, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            if (enviando) {
                Esperando("A Nutri está olhando o prato…", escrita, Pose.CorgiLupa)
                return@Column
            }
            OutlinedTextField(
                texto, { texto = it },
                label = { Text("O que você comeu?") },
                placeholder = { Text("ex.: 2 ovos mexidos, pão integral e café com leite") },
                minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Botao("Tirar foto", Modifier.weight(1f), suave = true, habilitado = !processando && fotos.size < 2) { tirarFoto() }
                Botao("Galeria", Modifier.weight(1f), suave = true, habilitado = !processando && fotos.size < 2) {
                    galeria.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
            }
            if (processando || fotos.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    fotos.forEachIndexed { i, f ->
                        Box(Modifier.size(96.dp)) {
                            Image(f.previa, contentDescription = "Foto ${i + 1} do prato", contentScale = ContentScale.Crop, modifier = Modifier.size(96.dp).clip(Formas.Pequeno))
                            Box(
                                Modifier.align(Alignment.TopEnd).size(28.dp).clip(CircleShape).background(Cores.Branco)
                                    .clickable(role = Role.Button, onClickLabel = "Remover foto ${i + 1}") { fotos.removeAt(i) },
                                contentAlignment = Alignment.Center,
                            ) { Text("×", color = Cores.CuidadoTinta, style = MaterialTheme.typography.labelLarge) }
                        }
                    }
                    if (processando) CircularProgressIndicator(Modifier.size(28.dp), color = Cores.Acai, strokeWidth = 3.dp)
                }
                Text("Até 2 fotos. A primeira fica na sua pasta do Drive.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
            }
            Text("Qual refeição?", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Slots.todos.forEach { (id, nome) -> Chip(nome, slot == id) { slot = id } }
            }
            OutlinedTextField(
                hora, { hora = it.take(5) },
                label = { Text("Hora") }, placeholder = { Text("HH:MM") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(140.dp),
                isError = hora.isNotBlank() && !Formato.horaValida(hora),
            )
            erro?.let { AvisoErro(it) }
            Spacer(Modifier.height(2.dp))
            Botao("Analisar e registrar", Modifier.fillMaxWidth(), habilitado = !processando) { enviar() }
            Text("A Nutri estima calorias e macros. Depois você ajusta por gramas.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
        }
    }
}
