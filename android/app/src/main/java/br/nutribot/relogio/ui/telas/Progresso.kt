package br.nutribot.relogio.ui.telas

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.DiaSerie
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cabecalho
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

private fun statusVeredito(s: String?): Triple<String, Color, Color> {
    val t = s?.lowercase() ?: ""
    return when {
        t.contains("abaixo") -> Triple(s!!.replace('_', ' '), Color(0xFFFFE0C7), Color(0xFF8A4B12))
        t.contains("acima") -> Triple(s!!.replace('_', ' '), Cores.CuidadoFundo, Cores.CuidadoTinta)
        t.contains("ritmo") || t.contains("dentro") || t.contains("ok") || t.contains("compat") -> Triple(s!!.replace('_', ' '), Color(0xFFDDF5E8), Cores.BomTinta)
        t.isBlank() -> Triple("sem veredito", Cores.Trilho, Cores.LilasTexto)
        else -> Triple(s!!.replace('_', ' '), Cores.Trilho, Cores.LilasTexto)
    }
}

@Composable
fun TelaProgresso(vm: AppVM, perfil: Perfil?) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaProgresso(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var pesar by rememberSaveable { mutableStateOf(false) }
    ConteudoCarga(carga, { vm.carregar(rota, forcar = true) }, topo = { Cabecalho("Progresso", "${perfil.curto} · peso e energia", Pose.CorgiBalanca, 64.dp) }) { j ->
        Botao("Registrar peso", Modifier.fillMaxWidth()) { pesar = true }
        ConteudoProgresso(vm, perfil, j)
    }
    if (pesar) DialogoPeso(vm, perfil.id, aoFechar = { pesar = false }) { pesar = false; vm.invalidar(perfil.id) }
}

/** "Registrar peso": peso em kg (vírgula ou ponto) e gordura % opcional -> POST /perfis/:id/pesagens (fonte app; o relógio vence). */
@Composable
private fun DialogoPeso(vm: AppVM, perfilId: String, aoFechar: () -> Unit, aoRegistrar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    var peso by rememberSaveable { mutableStateOf("") }
    var gordura by rememberSaveable { mutableStateOf("") }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    fun enviar() {
        val kg = Formato.numeroDigitado(peso)
        if (kg == null || kg < 25 || kg > 400) { erro = "Peso entre 25 e 400 kg."; return }
        val pct = if (gordura.isBlank()) null else Formato.numeroDigitado(gordura)
        if (gordura.isNotBlank() && (pct == null || pct < 3 || pct > 70)) { erro = "Gordura entre 3 e 70%, ou em branco."; return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                val corpo = JSONObject().put("peso", kg)
                if (pct != null) corpo.put("gordura", pct)
                vm.escrever("POST", AppVM.rotaPesagens(perfilId), corpo)
                aoRegistrar()
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
        title = { Text("Registrar peso", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Pesagem de hoje. Se o relógio pesar, vale a dele.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                OutlinedTextField(peso, { peso = it.take(6) }, label = { Text("Peso (kg)") }, placeholder = { Text("68,2") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(gordura, { gordura = it.take(5) }, label = { Text("Gordura % (opcional)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = { Botao(if (enviando) "Salvando…" else "Salvar", habilitado = !enviando) { enviar() } },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
}

/** Janelas do gráfico: todas vêm do /dias (até 92 dias por pedido). */
private val janelas = listOf(7 to "7 d", 14 to "14 d", 21 to "21 d", 28 to "28 d", 90 to "90 d")

/**
 * O gráfico único (fase 4): a série por dia do /dias (kcal, gasto, peso, massa magra e a faixa da meta) com camadas ligadas
 * por chips. As pesagens descartadas e a tendência continuam vindo do /progresso.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConteudoProgresso(vm: AppVM, perfil: Perfil, j: JSONObject) {
    val pesagens = remember(j) { pesagensDe(j) }
    val tend = j.obj("tendencia")
    val meta = j.obj("meta")
    var janela by rememberSaveable { mutableIntStateOf(28) }
    var mascara by rememberSaveable { mutableIntStateOf(Camada.mascara(Camada.padrao)) }
    val camadas = remember(mascara) { Camada.deMascara(mascara) }
    val hoje = Formato.hojeDe(j.str("dia"), perfil.fuso)
    val jan = Janela(hoje.minusDays(janela - 1L), hoje)
    val rotaDias = AppVM.rotaDias(perfil.id, Formato.iso(jan.inicio), Formato.iso(jan.fim))
    val cargaDias by vm.carga(rotaDias).collectAsStateWithLifecycle()
    LaunchedEffect(rotaDias) { vm.carregar(rotaDias) }
    val dadosDias = cargaDias.dados
    val dias = remember(dadosDias) { DiaSerie.lista(dadosDias) }
    val metaDias = dadosDias.obj("meta") ?: meta
    val pesagensJanela = remember(pesagens, jan.inicio, jan.fim) { pesagens.filter { jan.contem(it.dia) } }
    // o dia escolhido no toque; sem toque, hoje
    var selIso by rememberSaveable(janela) { mutableStateOf<String?>(null) }
    val sel = Formato.dia(selIso)?.takeIf { jan.contem(it) } ?: jan.fim

    Cartao(forma = Formas.Grande) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text("Peso de tendência", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(Formato.decimal(tend.num("pesoHoje") ?: pesagens.lastOrNull { !it.descartada }?.peso), style = MaterialTheme.typography.displaySmall)
                    Text(" kg", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
                }
            }
            if (tend != null) Column(horizontalAlignment = Alignment.End) {
                Text("${Formato.sinal(tend.num("kgSemana"))} kg/sem", style = MaterialTheme.typography.titleLarge, color = Cores.AcaiEscuro)
                tend.obj("ic")?.let { ic -> Text("faixa de 95%: ${Formato.sinal(ic.num("min"))} a ${Formato.sinal(ic.num("max"))}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp) }
                tend.str("direcao")?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Cores.Tinta2) }
            }
        }
        // camadas: cada chip liga ou desliga uma
        FlowRow(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Camada.entries.forEach { c ->
                Chip(c.rotulo, c in camadas, papel = Role.Switch) { mascara = mascara xor (1 shl c.ordinal) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            janelas.forEach { (d, nome) ->
                val ativa = d == janela
                Box(
                    Modifier.weight(1f).heightIn(min = 48.dp).clip(Formas.Pilula).background(if (ativa) Cores.Acai else Cores.Trilho)
                        .clickable(role = Role.Tab) { janela = d },
                    contentAlignment = Alignment.Center,
                ) { Text(nome, fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 13.sp, maxLines = 1, color = if (ativa) Cores.Branco else Cores.LilasTexto) }
            }
        }
        if (dadosDias != null) GraficoDias(dias, pesagensJanela, tend, metaDias, janela, jan, camadas, sel) { selIso = Formato.iso(it) }
        else Aguardando(cargaDias.erro)
    }

    j.obj("veredito")?.let { v ->
        val (rot, fundo, tinta) = statusVeredito(v.str("status"))
        val prob = v.num("prob")?.let { if (it <= 1.0) it * 100 else it }
        Cartao(cor = Color(0xFFFFF1E8), atraso = 80) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.CorgiBalanca, 70.dp)
                Column(Modifier.weight(1f)) {
                    Pilula(rot + (prob?.let { " · ${Formato.inteiro(it)}%" } ?: ""), fundo, tinta)
                    v.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp)) }
                }
            }
        }
    }

    meta?.let { m ->
        Cartao(atraso = 140) {
            TituloSecao("Meta de energia")
            val mn = m.num("min")
            val mx = m.num("max")
            if (mn != null && mx != null) {
                Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 6.dp)) {
                    Text("${Formato.kcal(mn)}–${Formato.kcal(mx)}", style = MaterialTheme.typography.headlineMedium)
                    Text(" kcal registradas/dia", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
            }
            m.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 6.dp)) }
        }
    }

    val alertas = j.arr("alertas").objs()
    if (alertas.isNotEmpty()) {
        Cartao(cor = Cores.AtencaoFundo, atraso = 180) {
            TituloSecao("O que pesa na leitura")
            alertas.forEach { a ->
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(Cores.AtencaoTinta))
                    Text(a.str("texto") ?: a.str("tipo") ?: "", style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A3B00))
                }
            }
        }
    }

    j.str("texto")?.let { texto ->
        var aberto by rememberSaveable { mutableStateOf(false) }
        Cartao(atraso = 220) {
            Box(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(Formas.Pequeno).background(Cores.Trilho).clickable(role = Role.Button) { aberto = !aberto },
                contentAlignment = Alignment.Center,
            ) { Text(if (aberto) "Esconder a conta" else "Como cheguei nisso", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 15.sp, color = Cores.LilasTexto) }
            if (aberto) Text(texto, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 10.dp))
        }
    }
}

/** No lugar do gráfico enquanto o /dias não chegou: "Carregando…" ou o erro, curtos. */
@Composable
private fun Aguardando(erro: ErroApi?) {
    if (erro != null) Text(erro.paraPessoa, style = MaterialTheme.typography.bodySmall, color = Cores.CuidadoTinta, modifier = Modifier.padding(vertical = 30.dp))
    else Text("Carregando…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 30.dp))
}
