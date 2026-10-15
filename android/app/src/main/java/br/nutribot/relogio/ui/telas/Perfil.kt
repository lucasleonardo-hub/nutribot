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
import androidx.compose.runtime.LaunchedEffect
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.BuildConfig
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.PerfilExtra
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
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
    var editarSobre by rememberSaveable { mutableStateOf(false) }
    // fase 7: os campos novos vêm do JSON do perfil no /perfis; dieta e restrições, se faltarem lá, dos fatos do /nutri
    val perfisCarga by vm.carga(AppVM.ROTA_PERFIS).collectAsStateWithLifecycle()
    val rotaNutri = perfil?.let { AppVM.rotaNutri(it.id) }
    val nutriCarga by (rotaNutri?.let { vm.carga(it) } ?: vm.carga(AppVM.ROTA_PERFIS)).collectAsStateWithLifecycle()
    LaunchedEffect(rotaNutri) { rotaNutri?.let { vm.carregar(it) } }
    val bruto = perfisCarga.dados.arr("perfis").objs().firstOrNull { it.str("id", "_id") == perfil?.id }
    val extra = PerfilExtra.de(bruto, if (rotaNutri != null) nutriCarga.dados else null)
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
            Cartao(atraso = 80) {
                TituloSecao("Sobre ${perfil.curto}") { Link("Editar") { editarSobre = true } }
                LinhaValor("Apelido", extra.apelido ?: "sem apelido")
                LinhaValor("Idade", extra.idade?.let { "$it anos" } ?: "—")
                LinhaValor("Cidade", extra.cidade ?: "—")
                LinhaValor("Dieta", extra.dieta ?: "—")
                LinhaValor("Restrições", extra.restricoes ?: "—")
                Text("A Nutri usa isso nas dicas, aqui e no WhatsApp.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, modifier = Modifier.padding(top = 4.dp))
            }
            Cartao(atraso = 140, padding = PaddingValues(12.dp)) {
                Link("Agenda") { nav(Rotas.AGENDA) }
                Link("Atividades fixas") { nav(Rotas.ATIVIDADES_FIXAS) }
                // lugares e configurações do bot só no perfil do dono (D14, D15); o servidor também confere
                if (perfil.ehDono) Link("Lugares") { nav(Rotas.LUGARES) }
                Link("Integrações") { nav(Rotas.INTEGRACOES) }
                Link("O que a Nutri sabe") { nav(Rotas.NUTRI) }
                Link("Resumos") { nav(Rotas.RESUMOS) }
                if (perfil.ehDono) Link("Configurações do bot") { nav(Rotas.CONFIGURACOES) }
            }
        }
    }
    if (editar && perfil != null) DialogoPerfil(vm, perfil, aoFechar = { editar = false })
    if (editarSobre && perfil != null) DialogoSobre(vm, perfil, extra, aoFechar = { editarSobre = false })
}

/**
 * Fase 7 (W10, W11): apelido, idade, cidade, dieta e restrições. PUT /perfis/:id só com o que mudou; o servidor não apaga
 * idade, cidade, dieta nem restrições por aqui (o app avisa); o apelido apagado vai como semApelido: true, como o `!apelido nenhum`. Depois recarrega o /perfis e o /nutri.
 */
@Composable
private fun DialogoSobre(vm: AppVM, perfil: Perfil, atual: PerfilExtra, aoFechar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    var apelido by rememberSaveable { mutableStateOf(atual.apelido ?: "") }
    var idade by rememberSaveable { mutableStateOf(atual.idade?.toString() ?: "") }
    var cidade by rememberSaveable { mutableStateOf(atual.cidade ?: "") }
    var dieta by rememberSaveable { mutableStateOf(atual.dieta ?: "") }
    var restricoes by rememberSaveable { mutableStateOf(atual.restricoes ?: "") }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    fun salvar() {
        val corpo = JSONObject()
        val ap = apelido.trim()
        if (ap != (atual.apelido ?: "")) {
            if (ap.isBlank()) corpo.put("semApelido", true) else corpo.put("apelido", ap)
        }
        // o servidor não apaga cidade, idade, dieta nem restrições por aqui (dieta e restrições se apagam no que a Nutri sabe)
        val apagou = listOf(idade to atual.idade?.toString(), cidade to atual.cidade, dieta to atual.dieta, restricoes to atual.restricoes)
            .any { (novo, velho) -> novo.isBlank() && !velho.isNullOrBlank() }
        if (apagou) { erro = "Para apagar dieta ou restrições, use a aba Nutri. Idade e cidade não ficam em branco."; return }
        val id = idade.trim()
        if (id.isNotBlank() && id != (atual.idade?.toString() ?: "")) {
            val n = id.toIntOrNull()
            if (n == null || n < 10 || n > 110) { erro = "Idade entre 10 e 110 anos."; return }
            corpo.put("idade", n)
        }
        fun texto(chave: String, novo: String, velho: String?) {
            val t = novo.trim()
            if (t.isNotBlank() && t != (velho ?: "")) corpo.put(chave, t)
        }
        texto("cidade", cidade, atual.cidade)
        texto("dieta", dieta, atual.dieta)
        texto("restricoes", restricoes, atual.restricoes)
        if (corpo.length() == 0) { aoFechar(); return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                vm.escrever("PUT", AppVM.rotaPerfil(perfil.id), corpo)
                vm.carregar(AppVM.ROTA_PERFIS, forcar = true)
                vm.invalidar(perfil.id) // dieta e restrições também aparecem nos fatos da Nutri
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
        title = { Text("Sobre ${perfil.curto}", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(apelido, { apelido = it.take(30) }, label = { Text("Apelido") }, placeholder = { Text("em branco = sem apelido") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(idade, { idade = it.filter { c -> c.isDigit() }.take(3) }, label = { Text("Idade") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(cidade, { cidade = it.take(60) }, label = { Text("Cidade") }, placeholder = { Text("ex.: Florianópolis") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(dieta, { dieta = it.take(120) }, label = { Text("Dieta") }, placeholder = { Text("ex.: vegetariana, low carb") }, minLines = 1, maxLines = 3, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(restricoes, { restricoes = it.take(120) }, label = { Text("Restrições") }, placeholder = { Text("ex.: sem lactose, alergia a camarão") }, minLines = 1, maxLines = 3, modifier = Modifier.fillMaxWidth())
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = { Botao(if (enviando) "Salvando…" else "Salvar", habilitado = !enviando) { salvar() } },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
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
