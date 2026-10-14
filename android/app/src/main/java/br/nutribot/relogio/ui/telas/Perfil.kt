package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.BuildConfig
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.Rotas
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.LinhaValor
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/**
 * "America/Sao_Paulo" vira "São Paulo (GMT−3)": a cidade do id (sem underscore; acentos nos nomes mais comuns do Brasil)
 * e o deslocamento de agora. Id desconhecido volta como veio.
 */
fun fusoLegivel(fuso: String?): String {
    if (fuso.isNullOrBlank()) return "—"
    val zona = runCatching { ZoneId.of(fuso) }.getOrNull() ?: return fuso
    val cidade = fuso.substringAfterLast('/').replace('_', ' ').let { acentos[it] ?: it }
    val seg = zona.rules.getOffset(Instant.now()).totalSeconds
    val h = kotlin.math.abs(seg) / 3600
    val m = kotlin.math.abs(seg) % 3600 / 60
    val sinal = if (seg < 0) "−" else "+"
    val gmt = if (seg == 0) "GMT" else "GMT$sinal$h" + (if (m > 0) ":%02d".format(m) else "")
    return "$cidade ($gmt)"
}

private val acentos = mapOf(
    "Sao Paulo" to "São Paulo", "Belem" to "Belém", "Cuiaba" to "Cuiabá", "Maceio" to "Maceió", "Santarem" to "Santarém",
    "Araguaina" to "Araguaína", "Eirunepe" to "Eirunepé", "Noronha" to "Fernando de Noronha", "Lisbon" to "Lisboa", "Madrid" to "Madri",
    "London" to "Londres", "New York" to "Nova York", "Buenos Aires" to "Buenos Aires",
)

/** Perfil (menu do nome): o que o /perfis traz, e a edição de objetivo, meta, prazo, altura e ritmo (PUT /perfis/:id). */
@Composable
fun TelaPerfil(vm: AppVM, perfil: Perfil?, voltar: () -> Unit, nav: (String) -> Unit) {
    var editar by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().navigationBarsPadding().verticalScroll(rememberScrollState())) {
        CabecalhoVoltar("Perfil", perfil?.nome, Pose.DuplaFeliz, voltar)
        if (perfil == null) { Vazio("Nenhum perfil escolhido."); return@Column }
        Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // cabeçalho sem frases coladas com " · " (fase 4): apelido em pílula, objetivo em linha própria
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(Modifier.size(64.dp).clip(CircleShape).background(Color(0xFFC9B8FF)), contentAlignment = Alignment.Center) {
                        Text(perfil.inicial, style = MaterialTheme.typography.headlineLarge)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(perfil.nome, style = MaterialTheme.typography.headlineMedium)
                        if (perfil.apelido != null || perfil.ehDono) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                perfil.apelido?.let { Pilula(it, Cores.Trilho, Cores.LilasTexto) }
                                if (perfil.ehDono) Pilula("administra o grupo", Cores.BomFundo, Cores.BomTinta)
                            }
                        }
                        perfil.objetivo?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                    }
                }
            }
            Cartao(atraso = 60) {
                TituloSecao("Objetivo e meta") { Link("Editar") { editar = true } }
                LinhaValor("Objetivo", perfil.objetivo ?: "—")
                LinhaValor("Meta de peso", perfil.metaPeso?.let { Formato.decimal(it) + " kg" } ?: "sem meta")
                LinhaValor("Prazo", Formato.dia(perfil.metaPrazo)?.let { Formato.diaCurto(it) + "/" + it.year } ?: perfil.metaPrazo ?: "—")
                LinhaValor("Altura", perfil.altura?.let { "${Formato.inteiro(it)} cm" } ?: "—")
                LinhaValor("Ritmo", Perfil.rotuloRitmo(perfil.ritmo) ?: "—")
            }
            Cartao(atraso = 100) {
                TituloSecao("Dados e fontes")
                LinhaValor("Fuso", fusoLegivel(perfil.fuso))
                LinhaValor("Relógio", if (perfil.temRelogio) "ligado" else "não")
                LinhaValor("Hevy", if (perfil.temHevy) "ligado" else "não")
                LinhaValor("App neste celular", BuildConfig.VERSION_NAME)
            }
            Cartao(atraso = 140, padding = PaddingValues(12.dp)) {
                Link("Agenda") { nav(Rotas.AGENDA) }
                Link("Integrações") { nav(Rotas.INTEGRACOES) }
                Link("O que a Nutri sabe") { nav(Rotas.NUTRI) }
                Link("Resumos") { nav(Rotas.RESUMOS) }
            }
        }
    }
    if (editar && perfil != null) DialogoPerfil(vm, perfil, aoFechar = { editar = false })
}

/**
 * Edição: objetivo (texto), meta de peso (kg, em branco = sem meta), prazo (AAAA-MM-DD, em branco = sem prazo),
 * altura (cm, 101–249, em branco = não mexe) e ritmo (chips máximo/médio/mínimo).
 * Manda PUT /perfis/:id só com o que mudou (null tira a meta/prazo) e recarrega o /perfis para mostrar o que ficou.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DialogoPerfil(vm: AppVM, perfil: Perfil, aoFechar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    var objetivo by rememberSaveable { mutableStateOf(perfil.objetivo ?: "") }
    var meta by rememberSaveable { mutableStateOf(perfil.metaPeso?.let { Formato.decimal(it) } ?: "") }
    var prazo by rememberSaveable { mutableStateOf(perfil.metaPrazo?.take(10) ?: "") }
    var altura by rememberSaveable { mutableStateOf(perfil.altura?.let { Formato.inteiro(it) } ?: "") }
    var ritmo by rememberSaveable { mutableStateOf(perfil.ritmo) }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    fun salvar() {
        val corpo = JSONObject()
        val obj = objetivo.trim()
        if (obj != (perfil.objetivo ?: "")) corpo.put("objetivo", obj)
        if (meta.isBlank()) {
            if (perfil.metaPeso != null) corpo.put("metaPeso", JSONObject.NULL)
        } else {
            val kg = Formato.numeroDigitado(meta)
            if (kg == null || kg < 25 || kg > 400) { erro = "Meta entre 25 e 400 kg. Em branco tira a meta."; return }
            if (perfil.metaPeso == null || kotlin.math.abs(kg - perfil.metaPeso) >= 0.05) corpo.put("metaPeso", kg)
        }
        val p = prazo.trim()
        if (p.isBlank()) {
            if (perfil.metaPrazo != null) corpo.put("metaPrazo", JSONObject.NULL)
        } else {
            val d = Formato.dia(p)
            if (d == null || p.length != 10) { erro = "Prazo como AAAA-MM-DD. Em branco tira o prazo."; return }
            if (p != perfil.metaPrazo?.take(10)) corpo.put("metaPrazo", p)
        }
        if (altura.isNotBlank()) {
            val cm = Formato.numeroDigitado(altura)
            if (cm == null || cm <= 100 || cm >= 250) { erro = "Altura entre 101 e 249 cm."; return } // os limites do servidor
            if (perfil.altura == null || kotlin.math.abs(cm - perfil.altura) >= 0.5) corpo.put("altura", cm)
        }
        if (ritmo != null && ritmo != perfil.ritmo) corpo.put("ritmo", ritmo)
        if (corpo.length() == 0) { aoFechar(); return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                vm.escrever("PUT", AppVM.rotaPerfil(perfil.id), corpo)
                vm.carregar(AppVM.ROTA_PERFIS, forcar = true)
                vm.invalidar(perfil.id) // a meta muda a faixa de kcal do Hoje e o veredito do Progresso
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

    AlertDialog(
        onDismissRequest = { if (!enviando) aoFechar() },
        containerColor = Cores.Branco,
        title = { Text("Objetivo e meta", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(objetivo, { objetivo = it.take(120) }, label = { Text("Objetivo") }, placeholder = { Text("ex.: ganhar massa com pouca gordura") }, minLines = 1, maxLines = 3, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(meta, { meta = it.take(6) }, label = { Text("Meta de peso (kg)") }, placeholder = { Text("em branco = sem meta") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(prazo, { prazo = it.take(10) }, label = { Text("Prazo (AAAA-MM-DD)") }, placeholder = { Text("em branco = sem prazo") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(altura, { altura = it.take(3) }, label = { Text("Altura (cm)") }, placeholder = { Text("ex.: 180") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                Text("Ritmo", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Perfil.ritmos.forEach { (id, nome) -> Chip(nome, ritmo == id) { ritmo = id } }
                }
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = { Botao(if (enviando) "Salvando…" else "Salvar", habilitado = !enviando) { salvar() } },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
}
