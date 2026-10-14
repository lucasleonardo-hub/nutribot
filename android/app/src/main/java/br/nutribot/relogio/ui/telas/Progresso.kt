package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
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
import br.nutribot.relogio.ui.componentes.Segmentado
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.abs

/** Uma pesagem do /progresso: { dia, peso, gordura, fonte, hora, descartada, motivo }. */
private data class Pesagem(val dia: LocalDate, val peso: Double, val descartada: Boolean, val motivo: String?, val fonte: String?)

private fun pesagensDe(j: JSONObject): List<Pesagem> = j.arr("pesagens").objs().mapNotNull { p ->
    val d = Formato.dia(p.str("dia")) ?: return@mapNotNull null
    val kg = p.num("peso") ?: return@mapNotNull null
    Pesagem(d, kg, p.bool("descartada") ?: false, p.str("motivo"), p.str("fonte"))
}.sortedBy { it.dia }

/** Um dia do /refeicoes com registro: { dia, completo, kcal, refeicoes }. Dia sem refeição não entra (não é zero: é sem barra). */
private data class DiaKcal(val dia: LocalDate, val kcal: Double)

private fun diasKcalDe(j: JSONObject): List<DiaKcal> = j.arr("dias").objs().mapNotNull { d ->
    val dia = Formato.dia(d.str("dia")) ?: return@mapNotNull null
    val kcal = d.num("kcal") ?: return@mapNotNull null
    if (kcal <= 0 && d.arr("refeicoes").objs().isEmpty()) return@mapNotNull null
    DiaKcal(dia, kcal)
}.sortedBy { it.dia }

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

/** Janelas do gráfico: até 28 dias vêm do /progresso; 90 dias e 1 ano vêm da rota de pesagens por intervalo (fase 3). */
private val janelas = listOf(7 to "7 d", 14 to "14 d", 21 to "21 d", 28 to "28 d", 90 to "90 d", 365 to "1 ano")

/** O /refeicoes aceita até 31 dias por pedido: nas janelas de 90 d e 1 ano, as calorias mostram só os últimos 31. */
private const val MAX_DIAS_KCAL = 31

private fun nomeJanela(janela: Int) = when (janela) { 365 -> "1 ano"; else -> "$janela dias" }

/**
 * Modos do gráfico (2.3): cada um desenha só o seu; "Cruzar" põe as outras séries de peso por cima.
 * Peso = pontos + média de 7 dias · Tendência = linha e faixa de 95 % (pontos esmaecidos atrás) · Calorias = barras de kcal por dia.
 */
private enum class Modo(val rotulo: String) { Peso("Peso"), Tendencia("Tendência"), Calorias("Calorias") }

/** Dias de uma janela: x = dias desde o início; total = dias − 1 (a largura útil do gráfico). */
private class Janela(val inicio: LocalDate, val fim: LocalDate) {
    val total: Double = ChronoUnit.DAYS.between(inicio, fim).toDouble().coerceAtLeast(1.0)
    val dias: Int = ChronoUnit.DAYS.between(inicio, fim).toInt() + 1
    fun x(d: LocalDate): Double = ChronoUnit.DAYS.between(inicio, d).toDouble()
    fun contem(d: LocalDate): Boolean = !d.isBefore(inicio) && !d.isAfter(fim)
}

@Composable
private fun ConteudoProgresso(vm: AppVM, perfil: Perfil, j: JSONObject) {
    val pesagens = remember(j) { pesagensDe(j) }
    val tend = j.obj("tendencia")
    val meta = j.obj("meta")
    var janela by rememberSaveable { mutableIntStateOf(28) }
    var modoIdx by rememberSaveable { mutableIntStateOf(0) }
    val modo = Modo.entries[modoIdx.coerceIn(0, Modo.entries.size - 1)]
    var cruzar by rememberSaveable { mutableStateOf(false) }
    val longa = janela > 28
    val hoje = Formato.hojeDe(j.str("dia"), perfil.fuso)
    // 90 d e 1 ano: pesagens do intervalo [hoje − janela + 1, hoje], só pontos e média de 7 dias (sem tendência nem banda)
    val rotaLonga = AppVM.rotaPesagensEntre(perfil.id, Formato.iso(hoje.minusDays((janela - 1).toLong())), Formato.iso(hoje))
    val cargaLonga by vm.carga(rotaLonga).collectAsStateWithLifecycle()
    LaunchedEffect(rotaLonga, longa) { if (longa) vm.carregar(rotaLonga) }
    // calorias: kcal por dia do /refeicoes, até 31 dias por pedido; só busca quando o modo está aberto
    val diasKcal = minOf(janela, MAX_DIAS_KCAL)
    val rotaKcal = AppVM.rotaRefeicoes(perfil.id, Formato.iso(hoje.minusDays((diasKcal - 1).toLong())), Formato.iso(hoje))
    val cargaKcal by vm.carga(rotaKcal).collectAsStateWithLifecycle()
    val calorias = modo == Modo.Calorias
    LaunchedEffect(rotaKcal, calorias) { if (calorias) vm.carregar(rotaKcal) }

    // a lista de pesagens da janela (curta: /progresso; longa: a rota por intervalo, que pode ainda não ter chegado)
    val dadosLonga = cargaLonga.dados
    val lista: List<Pesagem>? = if (!longa) pesagens else remember(dadosLonga) { dadosLonga?.let { pesagensDe(it) } }
    val fimGrafico = maxOf(hoje, lista?.lastOrNull()?.dia ?: hoje)
    val jan = Janela(fimGrafico.minusDays((if (calorias) diasKcal else janela) - 1L), fimGrafico)
    val pts = remember(lista, jan.inicio, jan.fim) { lista.orEmpty().filter { jan.contem(it.dia) } }
    var sel by rememberSaveable(modoIdx, janela, pts.size) { mutableIntStateOf(pts.size - 1) }
    val dadosKcal = cargaKcal.dados
    val diasComKcal = remember(dadosKcal) { dadosKcal?.let { diasKcalDe(it) } }
    val barras = remember(diasComKcal, jan.inicio, jan.fim) { diasComKcal.orEmpty().filter { jan.contem(it.dia) } }
    var selKcal by rememberSaveable(janela, barras.size) { mutableIntStateOf(barras.size - 1) }

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
        Segmentado(Modo.entries.map { it.rotulo }, modoIdx, { modoIdx = it }, Modifier.fillMaxWidth().padding(top = 12.dp))
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
        val tendJanela = if (longa) null else tend
        when {
            calorias && dadosKcal != null -> GraficoCalorias(barras, meta, jan, if (cruzar) pts else null, selKcal) { selKcal = it }
            calorias -> Aguardando(cargaKcal.erro)
            lista != null -> GraficoPeso(pts, tendJanela, janela, jan, modo, cruzar, sel) { sel = it }
            else -> Aguardando(cargaLonga.erro)
        }
        val temBanda = janela == 28 && tendJanela.num("kgSemana") != null && tendJanela.obj("ic") != null
        val temTendencia = !longa && (janela == 28 || tendJanela.arr("janelas").objs().any { (it.num("dias") ?: 0.0).toInt() == janela })
        val temDescartada = pts.any { it.descartada }
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Legenda(legendaDe(modo, cruzar, temTendencia, temBanda, temDescartada, meta != null, cruzar && pts.any { !it.descartada }), Modifier.weight(1f))
            Chip("Cruzar", cruzar, papel = Role.Switch) { cruzar = !cruzar }
        }
        if (calorias && janela > MAX_DIAS_KCAL) Text("Calorias: só até 31 dias.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 4.dp))
    }

    CartaoGraficoNutri(vm, perfil.id, atraso = 40)

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

/** No lugar do gráfico enquanto a rota do modo (90 d, 1 ano, calorias) não chegou: "Carregando…" ou o erro, curtos. */
@Composable
private fun Aguardando(erro: ErroApi?) {
    if (erro != null) Text(erro.paraPessoa, style = MaterialTheme.typography.bodySmall, color = Cores.CuidadoTinta, modifier = Modifier.padding(vertical = 30.dp))
    else Text("Carregando…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 30.dp))
}

/** A fonte de uma pesagem como a pessoa a conhece. */
private fun nomeFonte(f: String?): String = when (f?.lowercase()) {
    null, "" -> "sem fonte"
    "relogio", "relógio", "watch", "health", "healthconnect" -> "relógio"
    "app" -> "app"
    "zap", "whatsapp", "bot", "chat" -> "WhatsApp"
    "balanca", "balança" -> "balança"
    else -> f
}

private class ItemLegenda(val cor: Color, val nome: String, val ponto: Boolean = false, val alto: Boolean = false)

/** Só o que está desenhado entra na legenda. */
private fun legendaDe(modo: Modo, cruzar: Boolean, temTendencia: Boolean, temBanda: Boolean, temDescartada: Boolean, temMeta: Boolean, temPesoNasBarras: Boolean): List<ItemLegenda> {
    val pesagem = ItemLegenda(Cores.AcaiEscuro, "pesagem", ponto = true)
    val media = ItemLegenda(Cores.Laranja, "média 7 d")
    val descartada = ItemLegenda(Cores.Cinza, "descartada", ponto = true)
    val tendencia = ItemLegenda(Cores.Acai, "tendência")
    val banda = ItemLegenda(Cores.Lilas, "faixa 95%", alto = true)
    return when (modo) {
        Modo.Peso -> listOfNotNull(pesagem, media, descartada.takeIf { temDescartada }, tendencia.takeIf { cruzar && temTendencia }, banda.takeIf { cruzar && temBanda })
        Modo.Tendencia -> listOfNotNull(
            tendencia.takeIf { temTendencia }, banda.takeIf { temBanda },
            if (cruzar) pesagem else ItemLegenda(Cores.LilasMedio, "pesagens", ponto = true),
            media.takeIf { cruzar }, descartada.takeIf { cruzar && temDescartada },
        )
        Modo.Calorias -> listOfNotNull(ItemLegenda(Cores.LilasForte, "kcal do dia", alto = true), ItemLegenda(Cores.MetaVerde, "faixa da meta", alto = true).takeIf { temMeta }, ItemLegenda(Cores.AcaiEscuro, "peso").takeIf { temPesoNasBarras })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legenda(itens: List<ItemLegenda>, modifier: Modifier = Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        itens.forEach { it ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Box(Modifier.width(if (it.ponto) 9.dp else 14.dp).height(if (it.ponto) 9.dp else if (it.alto) 10.dp else 4.dp).clip(if (it.ponto) CircleShape else RoundedCornerShape(2.dp)).background(it.cor))
                Text(it.nome, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp)
            }
        }
    }
}

/**
 * Gráfico do peso em Canvas, por modo. Peso: pontos (descartadas em cinza, menores) e média móvel de 7 dias centrada (só onde há
 * 3 dias dos dois lados); toque num ponto escolhe (dia, peso, fonte, motivo). Tendência: a linha com a inclinação do servidor
 * (28 dias: tendencia.kgSemana; outras: tendencia.janelas) passando pelo centro das pesagens válidas, e a banda do IC 95 %
 * (só 28 dias), com os pontos esmaecidos atrás. Cruzar: tudo junto.
 */
@Composable
private fun GraficoPeso(pts: List<Pesagem>, tend: JSONObject?, janela: Int, jan: Janela, modo: Modo, cruzar: Boolean, sel: Int, aoEscolher: (Int) -> Unit) {
    if (pts.isEmpty()) {
        Text("Sem pesagens nos últimos ${nomeJanela(janela)}.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 30.dp))
        return
    }
    val validos = pts.filter { !it.descartada }
    val descartadas = pts.size - validos.size
    val comMedia = modo == Modo.Peso || cruzar
    val comTendencia = modo == Modo.Tendencia || cruzar
    val k = if (!comTendencia) null else if (janela == 28) tend.num("kgSemana") else tend.arr("janelas").objs().firstOrNull { (it.num("dias") ?: 0.0).toInt() == janela }?.num("kgSemana")
    val ic = if (janela == 28 && k != null) tend.obj("ic") else null
    val xm = if (validos.isNotEmpty()) validos.sumOf { jan.x(it.dia) } / validos.size else 0.0
    val ym = if (validos.isNotEmpty()) validos.sumOf { it.peso } / validos.size else pts.sumOf { it.peso } / pts.size
    // média de 7 dias centrada
    val movel = if (!comMedia) emptyList() else validos.mapNotNull { p ->
        val antes = validos.count { val d = ChronoUnit.DAYS.between(it.dia, p.dia); d in 1..3 }
        val depois = validos.count { val d = ChronoUnit.DAYS.between(p.dia, it.dia); d in 1..3 }
        if (antes == 0 || depois == 0) null else {
            val grupo = validos.filter { abs(ChronoUnit.DAYS.between(it.dia, p.dia)) <= 3 }
            jan.x(p.dia) to grupo.sumOf { it.peso } / grupo.size
        }
    }
    val total = jan.total
    fun linha(xx: Double, kg: Double) = ym + kg / 7.0 * (xx - xm)
    var lo = pts.minOf { it.peso } - 0.6
    var hi = pts.maxOf { it.peso } + 0.6
    if (k != null) {
        listOf(0.0, total).forEach { xx -> lo = minOf(lo, linha(xx, k) - 0.2); hi = maxOf(hi, linha(xx, k) + 0.2) }
    }
    val prog = animaAte(1f, 1200)
    val pontosAlpha = animaAte(if (modo == Modo.Tendencia && !cruzar) 0.25f else 1f, 600, 600)
    val descricao = buildString {
        if (modo == Modo.Peso || cruzar) {
            append("Peso nos últimos ${nomeJanela(janela)}: ${validos.size} pesagens válidas")
            if (descartadas > 0) append(", $descartadas descartadas")
            append(", de ${Formato.decimal(pts.minOf { it.peso })} a ${Formato.decimal(pts.maxOf { it.peso })} kg")
        }
        if (comTendencia) {
            if (isNotEmpty()) append(". ")
            append(
                k?.let { "Tendência de ${Formato.sinal(it)} kg por semana" + (ic?.let { i -> ", faixa de 95% entre ${Formato.sinal(i.num("min"))} e ${Formato.sinal(i.num("max"))}" } ?: "") }
                    ?: "Sem tendência em ${nomeJanela(janela)}",
            )
        }
    }
    Canvas(
        Modifier.fillMaxWidth().aspectRatio(340f / 190f).semantics { contentDescription = descricao }
            .pointerInput(pts, modo, lo, hi) {
                if (modo != Modo.Peso) return@pointerInput
                detectTapGestures { o ->
                    val esq = 4.dp.toPx()
                    val dir = size.width - 40.dp.toPx()
                    val topo = 14.dp.toPx()
                    val base = size.height - 22.dp.toPx()
                    val i = pts.indices.minByOrNull { i ->
                        val p = pts[i]
                        val px = esq + (jan.x(p.dia) / total * (dir - esq)).toFloat()
                        val py = base - ((p.peso - lo) / (hi - lo) * (base - topo)).toFloat()
                        (o.x - px) * (o.x - px) + (o.y - py) * (o.y - py)
                    }
                    if (i != null) aoEscolher(i)
                }
            },
    ) {
        val esq = 4.dp.toPx()
        val dir = size.width - 40.dp.toPx()
        val topo = 14.dp.toPx()
        val base = size.height - 22.dp.toPx()
        fun px(xx: Double) = (esq + (xx / total) * (dir - esq)).toFloat()
        fun py(kg: Double) = (base - (kg - lo) / (hi - lo) * (base - topo)).toFloat()
        val paint = android.graphics.Paint().apply { isAntiAlias = true; textSize = 10.sp.toPx(); color = android.graphics.Color.rgb(0x6E, 0x65, 0x87) }
        // grade e eixos
        val ticks = 3
        for (i in 0..ticks) {
            val kg = lo + 0.3 + (hi - lo - 0.6) * i / ticks
            val y = py(kg)
            drawLine(Cores.Trilho, Offset(esq, y), Offset(dir, y), 1.dp.toPx())
            drawContext.canvas.nativeCanvas.drawText(Formato.decimal(kg) + " kg", dir + 4.dp.toPx(), y + 3.dp.toPx(), paint)
        }
        drawContext.canvas.nativeCanvas.drawText(when (janela) { 90 -> "há 3 meses"; 365 -> "há 1 ano"; else -> "há $janela dias" }, esq, size.height - 6.dp.toPx(), paint)
        paint.textAlign = android.graphics.Paint.Align.RIGHT
        drawContext.canvas.nativeCanvas.drawText("hoje", dir, size.height - 6.dp.toPx(), paint)

        clipRect(esq, 0f, dir, base + 2.dp.toPx()) {
            // banda do IC 95% (28 dias)
            if (k != null && ic != null) {
                val kMin = ic.num("min") ?: k
                val kMax = ic.num("max") ?: k
                val passos = 12
                val cima = (0..passos).map { s -> val xx = total * s / passos; Offset(px(xx), py(maxOf(linha(xx, kMin), linha(xx, kMax)))) }
                val baixo = (0..passos).map { s -> val xx = total * s / passos; Offset(px(xx), py(minOf(linha(xx, kMin), linha(xx, kMax)))) }.reversed()
                val banda = Path().apply { (cima + baixo).forEachIndexed { i, o -> if (i == 0) moveTo(o.x, o.y) else lineTo(o.x, o.y) }; close() }
                drawPath(banda, Cores.Lilas, alpha = prog)
            }
            // média móvel de 7 dias
            if (movel.size > 1) {
                val m = Path().apply { movel.forEachIndexed { i, (xx, kg) -> if (i == 0) moveTo(px(xx), py(kg)) else lineTo(px(xx), py(kg)) } }
                drawPath(m, Cores.Laranja, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round), alpha = prog)
            }
            // tendência (desenha da esquerda para a direita ao abrir)
            if (k != null) {
                val xFim = total * prog
                drawLine(Cores.Acai, Offset(px(0.0), py(linha(0.0, k))), Offset(px(xFim), py(linha(xFim, k))), 3.5.dp.toPx(), cap = StrokeCap.Round)
            }
        }
        // o ponto escolhido (modo Peso): guia vertical, como no gráfico de bioimpedância
        val escolhido = if (modo == Modo.Peso) pts.getOrNull(sel) else null
        if (escolhido != null) drawLine(Cores.LilasMedio, Offset(px(jan.x(escolhido.dia)), topo), Offset(px(jan.x(escolhido.dia)), base), 1.dp.toPx())
        // pontos
        pts.forEachIndexed { i, p ->
            val c = Offset(px(jan.x(p.dia)), py(p.peso))
            val r = (if (escolhido != null && i == sel) 7f else if (p.descartada) 3.5f else 4.5f).dp.toPx()
            drawCircle(Color.White, radius = r + 1.5.dp.toPx(), center = c, alpha = pontosAlpha)
            drawCircle(if (p.descartada) Cores.Cinza else Cores.AcaiEscuro, radius = r, center = c, alpha = pontosAlpha)
        }
    }
    when (modo) {
        Modo.Peso -> {
            pts.getOrNull(sel)?.let { p ->
                Text(
                    "${Formato.diaCurto(p.dia)} · ${Formato.decimal(p.peso)} kg · ${nomeFonte(p.fonte)}" + (if (p.descartada) " · descartada" + (p.motivo?.let { ": $it" } ?: "") else ""),
                    style = MaterialTheme.typography.bodySmall, color = if (p.descartada) Cores.Tinta4 else Cores.Tinta2, modifier = Modifier.padding(top = 2.dp),
                )
            }
            Text("Toque num ponto para ver.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp)
        }
        Modo.Tendencia -> Text(
            when {
                k != null && janela == 28 -> listOfNotNull(
                    "${Formato.sinal(k)} kg/sem",
                    ic?.let { "faixa ${Formato.sinal(it.num("min"))} a ${Formato.sinal(it.num("max"))}" },
                    tend.str("direcao"),
                ).joinToString(" · ")
                k != null -> "Últimos $janela dias: ${Formato.sinal(k)} kg/sem."
                else -> "Sem tendência em ${nomeJanela(janela)}: só os pontos."
            },
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp),
        )
        Modo.Calorias -> {}
    }
}

/**
 * Calorias por dia em barras (kcal do /refeicoes), com a faixa da meta (/progresso → meta {min,max}) em verde claro atrás.
 * Dia sem registro fica sem barra. Com "Cruzar", a linha do peso (pesagens válidas) por cima, com o eixo de kg à direita.
 */
@Composable
private fun GraficoCalorias(barras: List<DiaKcal>, meta: JSONObject?, jan: Janela, pesos: List<Pesagem>?, sel: Int, aoEscolher: (Int) -> Unit) {
    if (barras.isEmpty()) {
        Text("Sem refeições registradas nos últimos ${jan.dias} dias.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3, modifier = Modifier.padding(vertical = 30.dp))
        return
    }
    val mn = meta.num("min")
    val mx = meta.num("max")
    val temMeta = mn != null && mx != null && mx > mn
    val topoKcal = (maxOf(barras.maxOf { it.kcal }, mx ?: 0.0) * 1.12).coerceAtLeast(500.0)
    val validos = pesos.orEmpty().filter { !it.descartada }
    val comPeso = validos.isNotEmpty()
    val loKg = if (comPeso) validos.minOf { it.peso } - 0.6 else 0.0
    val hiKg = if (comPeso) validos.maxOf { it.peso } + 0.6 else 1.0
    val prog = animaAte(1f, 900)
    val media = barras.sumOf { it.kcal } / barras.size
    val descricao = "Calorias por dia nos últimos ${jan.dias} dias: ${barras.size} dias com registro, média de ${Formato.kcal(media)} kcal" +
        (if (temMeta) ", meta de ${Formato.kcal(mn)} a ${Formato.kcal(mx)} kcal" else "") +
        (if (comPeso) ", peso de ${Formato.decimal(validos.first().peso)} a ${Formato.decimal(validos.last().peso)} kg" else "")
    val margemDir = if (comPeso) 40.dp else 10.dp
    Canvas(
        Modifier.fillMaxWidth().aspectRatio(340f / 190f).semantics { contentDescription = descricao }
            .pointerInput(barras, comPeso) {
                detectTapGestures { o ->
                    val esq = 36.dp.toPx()
                    val dir = size.width - margemDir.toPx()
                    val passo = (dir - esq) / jan.dias
                    val i = barras.indices.minByOrNull { abs(o.x - (esq + (jan.x(barras[it].dia) + 0.5).toFloat() * passo)) }
                    if (i != null) aoEscolher(i)
                }
            },
    ) {
        val esq = 36.dp.toPx()
        val dir = size.width - margemDir.toPx()
        val topo = 14.dp.toPx()
        val base = size.height - 22.dp.toPx()
        val passo = (dir - esq) / jan.dias
        fun px(xx: Double) = esq + (xx + 0.5).toFloat() * passo
        fun py(kcal: Double) = (base - kcal / topoKcal * (base - topo)).toFloat()
        val paint = android.graphics.Paint().apply { isAntiAlias = true; textSize = 10.sp.toPx(); color = android.graphics.Color.rgb(0x6E, 0x65, 0x87); textAlign = android.graphics.Paint.Align.RIGHT }
        // grade de kcal à esquerda
        for (i in 0..3) {
            val v = topoKcal * i / 3
            val y = py(v)
            drawLine(Cores.Trilho, Offset(esq, y), Offset(dir, y), 1.dp.toPx())
            drawContext.canvas.nativeCanvas.drawText(Formato.kcal(v), esq - 4.dp.toPx(), y + 3.dp.toPx(), paint)
        }
        paint.textAlign = android.graphics.Paint.Align.LEFT
        drawContext.canvas.nativeCanvas.drawText("há ${jan.dias} dias", esq, size.height - 6.dp.toPx(), paint)
        paint.textAlign = android.graphics.Paint.Align.RIGHT
        drawContext.canvas.nativeCanvas.drawText("hoje", dir, size.height - 6.dp.toPx(), paint)
        clipRect(esq, 0f, dir, base) {
            if (temMeta) drawRect(Cores.MetaVerde, topLeft = Offset(esq, py(mx!!)), size = Size(dir - esq, py(mn!!) - py(mx)), alpha = 0.85f)
            val largura = passo * 0.62f
            barras.forEachIndexed { i, b ->
                val h = (base - py(b.kcal)) * prog
                drawRoundRect(
                    if (i == sel) Cores.Acai else Cores.LilasForte,
                    topLeft = Offset(px(jan.x(b.dia)) - largura / 2, base - h), size = Size(largura, h), cornerRadius = CornerRadius(3.dp.toPx()),
                )
            }
            if (comPeso) {
                fun pyKg(kg: Double) = (base - (kg - loKg) / (hiKg - loKg) * (base - topo)).toFloat()
                if (validos.size > 1) {
                    val linha = Path().apply { validos.forEachIndexed { i, p -> if (i == 0) moveTo(px(jan.x(p.dia)), pyKg(p.peso)) else lineTo(px(jan.x(p.dia)), pyKg(p.peso)) } }
                    drawPath(linha, Cores.AcaiEscuro, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round), alpha = prog)
                }
                validos.forEach { p ->
                    val c = Offset(px(jan.x(p.dia)), pyKg(p.peso))
                    drawCircle(Color.White, radius = 4.5.dp.toPx(), center = c, alpha = prog)
                    drawCircle(Cores.AcaiEscuro, radius = 3.dp.toPx(), center = c, alpha = prog)
                }
            }
        }
        if (comPeso) {
            // eixo de kg à direita (sem grade: a grade é das calorias)
            paint.textAlign = android.graphics.Paint.Align.LEFT
            for (i in 0..2) {
                val kg = loKg + 0.3 + (hiKg - loKg - 0.6) * i / 2
                val y = (base - (kg - loKg) / (hiKg - loKg) * (base - topo)).toFloat()
                drawContext.canvas.nativeCanvas.drawText(Formato.decimal(kg) + " kg", dir + 4.dp.toPx(), y + 3.dp.toPx(), paint)
            }
        }
    }
    barras.getOrNull(sel)?.let { b ->
        val estado = when {
            !temMeta -> null
            b.kcal < mn!! -> "abaixo da meta"
            b.kcal > mx!! -> "acima da meta"
            else -> "na meta"
        }
        Text(
            "${Formato.diaCurto(b.dia)} · ${Formato.kcal(b.kcal)} kcal" + (estado?.let { " · $it" } ?: ""),
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp),
        )
    }
    Text("Toque numa barra para ver.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp)
}
