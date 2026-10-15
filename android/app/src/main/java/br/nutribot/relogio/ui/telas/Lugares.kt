package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Lugar
import br.nutribot.relogio.dados.LugarAgora
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.semZap
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.ZoneId

/** "18:10" (hoje) ou "14/10 18:10": quando a pessoa chegou ou esteve por último. O "agora" já vem como "HH:MM". */
private fun quandoLugar(s: String?, fuso: String?): String? {
    s?.trim()?.takeIf { Formato.horaValida(it) }?.let { return it }
    val i = Formato.instante(s) ?: return Formato.dia(s)?.let { Formato.diaCurto(it) }
    val z = runCatching { ZoneId.of(fuso ?: "") }.getOrNull() ?: ZoneId.systemDefault()
    val dt = i.atZone(z)
    val hora = "%02d:%02d".format(dt.hour, dt.minute)
    return if (dt.toLocalDate() == java.time.LocalDate.now(z)) hora else Formato.diaCurto(dt.toLocalDate()) + " " + hora
}

/**
 * Lugares (fase 7, W23–W25): só no perfil do dono (decisão de 13/10 e D15; o servidor devolve 403 para os outros).
 * Onde está agora, os lugares que frequenta (tipo, bairro, papel, visitas, padrão) e editar nome, tipo e papel.
 * GET /perfis/:id/lugares; PUT /perfis/:id/lugares/:lid { nome?, tipo?, papel? }; DELETE /perfis/:id/lugares?confirmar=sim.
 * Nada daqui vai para o grupo: o app mostra só no perfil do dono.
 */
@Composable
fun TelaLugares(vm: AppVM, perfil: Perfil?, voltar: () -> Unit) {
    if (perfil == null || !perfil.ehDono) {
        Column(Modifier.fillMaxSize()) {
            CabecalhoVoltar("Lugares", null, Pose.LontraRelogio, voltar)
            Vazio("Os lugares só aparecem no perfil de quem administra o grupo.", Pose.CorgiLupa)
        }
        return
    }
    val rota = AppVM.rotaLugares(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var editar by remember { mutableStateOf<Lugar?>(null) }
    var esquecer by rememberSaveable { mutableStateOf(false) }

    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = { CabecalhoVoltar("Lugares", "só ${perfil.curto} vê", Pose.LontraRelogio, voltar) },
    ) { j ->
        val agora = LugarAgora.de(j)
        val lugares = Lugar.lista(j)
        Cartao(cor = Cores.Trilho) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Agora", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3)
                    val semSinal = agora == null || agora.estado == "sem_sinal"
                    val titulo = when {
                        semSinal -> "Sem sinal de localização recente."
                        agora?.estado == "casa" -> "Em casa"
                        agora?.estado == "fora" -> "Fora dos lugares conhecidos"
                        else -> listOfNotNull(agora?.tipo, agora?.nome).joinToString(" · ").replaceFirstChar { it.uppercase() }.ifBlank { "Num lugar conhecido" }
                    }
                    Text(titulo, style = MaterialTheme.typography.titleMedium)
                    quandoLugar(agora?.desde, perfil.fuso)?.let { Text(if (semSinal) "último sinal $it" else "desde $it", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2) }
                }
                Mascote(Pose.LontraRelogio, 56.dp)
            }
        }
        Text("A Nutri usa os lugares para conferir as atividades fixas e saber quando você passa no mercado.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        if (lugares.isEmpty()) {
            Vazio("Nenhum lugar guardado ainda. Ligue a localização nas Integrações.", Pose.CorgiLupa)
        } else {
            TituloSecao("Lugares que você frequenta")
            lugares.forEachIndexed { i, l -> CartaoLugar(l, perfil.fuso, (i * 30).coerceAtMost(300)) { editar = l } }
            Link("Esquecer todos os lugares") { esquecer = true }
        }
    }

    editar?.let { l -> DialogoLugar(vm, perfil.id, l, aoFechar = { editar = null }) { vm.carregar(rota, forcar = true) } }
    if (esquecer) DialogoEsquecerLugares(vm, perfil.id, aoFechar = { esquecer = false }) { vm.carregar(rota, forcar = true) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CartaoLugar(l: Lugar, fuso: String?, atraso: Int, aoEditar: () -> Unit) {
    Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = atraso) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(l.titulo, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Link("editar") { aoEditar() }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 4.dp)) {
            l.papel?.let { Pilula(it, Cores.BomFundo, Cores.BomTinta) }
            l.tipo?.let { Pilula(it, Cores.Trilho, Cores.LilasTexto) }
            l.bairro?.let { Pilula(it, Cores.Lavanda, Cores.Tinta2) }
        }
        l.padrao?.let { Text(semZap(it), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 6.dp)) }
        val rodape = listOfNotNull(l.visitas?.let { if (it == 1) "1 visita" else "$it visitas" }, quandoLugar(l.ultimaVez, fuso)?.let { "última vez $it" }).joinToString(" · ")
        if (rodape.isNotBlank()) Text(rodape, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
    }
}

/** Editar um lugar: nome (em branco = sem nome), tipo e papel. PUT só com o que mudou; papel "nenhum" vai como null. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DialogoLugar(vm: AppVM, perfilId: String, l: Lugar, aoFechar: () -> Unit, aoSalvar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    var nome by rememberSaveable(l.id) { mutableStateOf(l.nome ?: "") }
    var tipo by rememberSaveable(l.id) { mutableStateOf(l.tipo) }
    var papel by rememberSaveable(l.id) { mutableStateOf(l.papel) }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    fun salvar() {
        val corpo = JSONObject()
        val n = nome.trim()
        if (n != (l.nome ?: "")) corpo.put("nome", if (n.isBlank()) JSONObject.NULL else n)
        if (tipo != l.tipo && tipo != null) corpo.put("tipo", tipo)
        if (papel != l.papel) corpo.put("papel", papel ?: JSONObject.NULL)
        if (corpo.length() == 0) { aoFechar(); return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                vm.escrever("PUT", AppVM.rotaLugar(perfilId, l.id), corpo)
                aoSalvar()
                aoFechar()
            } catch (e: ErroApi) {
                erro = when {
                    e.status == 403 -> "Só o celular de quem administra o grupo muda os lugares."
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
    AlertDialog(
        onDismissRequest = { if (!enviando) aoFechar() },
        containerColor = Cores.Branco,
        title = { Text("Editar lugar", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(nome, { nome = it.take(60) }, label = { Text("Nome") }, placeholder = { Text("ex.: academia do bairro") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("Tipo", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Lugar.tipos.forEach { t -> Chip(t, tipo == t) { tipo = t } }
                }
                Text("Marcar como", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Lugar.papeis.forEach { (id, rotulo) -> Chip(rotulo, papel == id) { papel = id } }
                }
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = { Botao(if (enviando) "Salvando…" else "Salvar", habilitado = !enviando) { salvar() } },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
}

/** Esquecer todos os lugares: some a lista e o histórico de visitas. Não dá para desfazer. */
@Composable
private fun DialogoEsquecerLugares(vm: AppVM, perfilId: String, aoFechar: () -> Unit, aoEsquecer: () -> Unit) {
    val escopo = rememberCoroutineScope()
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!enviando) aoFechar() },
        containerColor = Cores.Branco,
        title = { Text("Esquecer todos os lugares?", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("A Nutri apaga os lugares e as visitas. Não dá para desfazer. Ela volta a aprender com a localização ligada.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = {
            Botao(if (enviando) "Apagando…" else "Esquecer", habilitado = !enviando) {
                escopo.launch {
                    enviando = true
                    erro = null
                    try {
                        vm.escrever("DELETE", AppVM.rotaEsquecerLugares(perfilId), null)
                        aoEsquecer()
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
