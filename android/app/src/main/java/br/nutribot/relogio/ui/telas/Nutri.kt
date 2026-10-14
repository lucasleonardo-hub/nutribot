package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cabecalho
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Segmentado
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate

/** natureza: declarado | medido | inferido | hipotese | opiniao */
private fun corNatureza(n: String?): Pair<Color, Color> = when (n) {
    "medido" -> Cores.BomFundo to Cores.BomTinta
    "declarado" -> Cores.Trilho to Cores.LilasTexto
    "inferido" -> Cores.AtencaoFundo to Cores.AtencaoTinta
    "hipotese" -> Color(0xFFFFF0F5) to Color(0xFF8A2448)
    else -> Cores.CuidadoFundo to Cores.CuidadoTinta
}

private fun rotuloNatureza(n: String?): String = when (n) {
    "medido" -> "medido"
    "declarado" -> "você disse"
    "inferido" -> "a Nutri deduziu"
    "hipotese" -> "hipótese"
    "opiniao" -> "opinião da Nutri"
    else -> n ?: "—"
}

private fun quando(s: String?): String? = Formato.dia(s)?.let { Formato.diaCurto(it) } ?: s

/** Uma ação pendente sobre um fato ou hipótese (fase 3, A4): corrigir o texto, apagar o fato ou descartar a hipótese. */
private sealed class AcaoNutri {
    data class Corrigir(val fid: String, val texto: String) : AcaoNutri()
    data class Apagar(val fid: String) : AcaoNutri()
    data class Descartar(val hid: String) : AcaoNutri()
}

/**
 * O que a Nutri sabe: fatos, hipóteses, diário e avaliações do /nutri. Fase 3: fatos com `editavel` ganham "corrigir",
 * com `apagavel` ganham "apagar"; hipótese aberta com `apagavel` ganha "descartar". Toda resposta traz o /nutri recalculado,
 * que entra no lugar do guardado (vm.semear).
 */
@Composable
fun TelaNutri(vm: AppVM, perfil: Perfil?) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaNutri(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var aba by rememberSaveable { mutableIntStateOf(0) }
    var acao by remember { mutableStateOf<AcaoNutri?>(null) }
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            Cabecalho("O que a Nutri sabe", "sobre ${perfil.curto} · diário do grupo", Pose.DuplaConferindo, 60.dp)
            Segmentado(listOf("Fatos", "Hipóteses", "Diário", "Avaliações"), aba, { aba = it }, Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp))
        },
    ) { j ->
        when (aba) {
            0 -> ListaItens(j.arr("fatos").objs(), "Nenhum fato guardado ainda.", texto = { f -> f.str("texto") ?: f.str("campo") ?: "" }) { f ->
                val id = f.str("id")
                // `valor` é o texto cru (sem o rótulo "Dieta: "), que é o que o PUT recebe de volta
                if (id != null && f.bool("editavel") == true) Link("corrigir") { acao = AcaoNutri.Corrigir(id, f.str("valor") ?: f.str("texto") ?: "") }
                if (id != null && f.bool("apagavel") == true) Link("apagar") { acao = AcaoNutri.Apagar(id) }
            }
            1 -> ListaItens(j.arr("hipoteses").objs(), "Nenhuma hipótese aberta.", texto = { h -> h.str("texto") ?: "" }) { h ->
                val id = h.str("id")
                if (id != null && h.bool("apagavel") == true) Link("descartar") { acao = AcaoNutri.Descartar(id) }
            }
            2 -> Diario(j)
            else -> ListaItens(j.arr("avaliacoes").objs(), "Nenhuma avaliação recente.", texto = { a -> a.str("texto") ?: "" })
        }
    }
    when (val a = acao) {
        is AcaoNutri.Corrigir -> DialogoCorrigir(vm, perfil.id, a.fid, a.texto) { acao = null }
        is AcaoNutri.Apagar -> DialogoApagarNutri(vm, AppVM.rotaFato(perfil.id, a.fid), perfil.id, "Apagar este fato?", "A Nutri deixa de usar.", "Apagar") { acao = null }
        is AcaoNutri.Descartar -> DialogoApagarNutri(vm, AppVM.rotaHipotese(perfil.id, a.hid), perfil.id, "Descartar esta hipótese?", "A Nutri para de testar essa ideia.", "Descartar") { acao = null }
        null -> {}
    }
}

@Composable
private fun ListaItens(itens: List<JSONObject>, vazio: String, texto: (JSONObject) -> String, acoes: (@Composable (JSONObject) -> Unit)? = null) {
    if (itens.isEmpty()) { Vazio(vazio, Pose.CorgiLupa); return }
    itens.forEachIndexed { i, it ->
        val (fundo, tinta) = corNatureza(it.str("natureza"))
        Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pilula(rotuloNatureza(it.str("natureza")), fundo, tinta)
                it.str("status")?.let { s -> Pilula(s, Cores.Lavanda, Cores.Tinta2) }
                it.str("tipo")?.let { t -> Pilula(if (t == "reflexao") "reflexão" else t, Cores.Lavanda, Cores.Tinta2) }
            }
            Text(texto(it), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
            it.str("comoVerificar")?.let { c -> Text("Como verificar: $c", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 4.dp)) }
            it.str("evidencia")?.let { c -> Text("Evidência: $c", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp)) }
            val sinais = it.arr("sinais").objs()
            if (sinais.isNotEmpty()) {
                val aFavor = sinais.count { s -> s.str("direcao")?.contains("favor") == true || s.str("direcao") == "confirma" }
                Text("${sinais.size} sinais · $aFavor a favor, ${sinais.size - aFavor} contra", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 2.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                Text(
                    listOfNotNull(it.str("origem"), (it.str("dia")?.let { d -> quando(d) + (it.str("hora")?.let { h -> " $h" } ?: "") } ?: quando(it.str("atualizadoEm")))).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.weight(1f),
                )
                acoes?.invoke(it)
            }
        }
    }
}

/** Limite de cada fato (o mesmo do servidor): dieta e restrições 120; rotina 1500; notas 4000. */
private fun limiteDoFato(fid: String): Int = when (fid) {
    "dieta", "restricoes" -> 120
    "rotina" -> 1500
    "notas" -> 4000
    else -> 400
}

/** Corrigir um fato de texto livre: PUT /perfis/:id/nutri/fatos/:fid { texto } -> { nutri }. As notas são uma lista: várias linhas. */
@Composable
private fun DialogoCorrigir(vm: AppVM, perfilId: String, fid: String, textoInicial: String, aoFechar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    val limite = limiteDoFato(fid)
    var texto by rememberSaveable { mutableStateOf(textoInicial) }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    fun salvar() {
        val t = texto.trim()
        if (t.isBlank()) { erro = "Escreva o texto corrigido."; return }
        if (t == textoInicial.trim()) { aoFechar(); return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                val j = vm.escrever("PUT", AppVM.rotaFato(perfilId, fid), JSONObject().put("texto", t))
                j.obj("nutri")?.let { vm.semear(AppVM.rotaNutri(perfilId), it) } ?: vm.carregar(AppVM.rotaNutri(perfilId), forcar = true)
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
        title = { Text("Corrigir", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(texto, { texto = it.take(limite) }, label = { Text("Como é de verdade?") }, minLines = 2, maxLines = if (limite > 400) 12 else 6, modifier = Modifier.fillMaxWidth())
                Text("${texto.length}/$limite", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = { Botao(if (enviando) "Salvando…" else "Salvar", habilitado = !enviando) { salvar() } },
        dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aoFechar() } },
    )
}

/** Confirmação antes de apagar um fato ou descartar uma hipótese: DELETE na rota -> { apagado, nutri }. */
@Composable
private fun DialogoApagarNutri(vm: AppVM, rota: String, perfilId: String, titulo: String, texto: String, botao: String, aoFechar: () -> Unit) {
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
            Botao(if (enviando) "Enviando…" else botao, habilitado = !enviando) {
                escopo.launch {
                    enviando = true
                    erro = null
                    try {
                        val j = vm.escrever("DELETE", rota, null)
                        j.obj("nutri")?.let { vm.semear(AppVM.rotaNutri(perfilId), it) } ?: vm.carregar(AppVM.rotaNutri(perfilId), forcar = true)
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

/** Diário da Nutri: agenda simples por dia (calendário do mês; tocar num dia mostra as notas). É do grupo todo. */
@Composable
private fun Diario(j: JSONObject) {
    // o diário da Nutri é sempre do grupo todo (S-api §3): vem em "diario" (ou "diarioGrupo") e leva o rótulo de grupo
    val notas = (j.arr("diario").objs() + j.arr("diarioGrupo").objs()).mapNotNull { n -> Formato.dia(n.str("dia"))?.let { it to n } }
    val porDia = notas.groupBy({ it.first }, { it.second })
    val ultimo = notas.maxOfOrNull { it.first } ?: LocalDate.now()
    var selStr by rememberSaveable { mutableStateOf(Formato.iso(ultimo)) }
    val sel = Formato.dia(selStr) ?: ultimo
    var mesStr by rememberSaveable { mutableStateOf(Formato.iso(ultimo.withDayOfMonth(1))) }
    val mes = Formato.dia(mesStr) ?: ultimo.withDayOfMonth(1)

    Cartao {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("‹", fontSize = 22.sp, color = Cores.AcaiEscuro, modifier = Modifier.minimumInteractiveComponentSize().clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Mês anterior") { mesStr = Formato.iso(mes.minusMonths(1)) }.padding(horizontal = 14.dp, vertical = 6.dp))
            Text(Formato.mesAno(mes), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
            Text("›", fontSize = 22.sp, color = Cores.AcaiEscuro, modifier = Modifier.minimumInteractiveComponentSize().clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Próximo mês") { mesStr = Formato.iso(mes.plusMonths(1)) }.padding(horizontal = 14.dp, vertical = 6.dp))
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            listOf("D", "S", "T", "Q", "Q", "S", "S").forEach { Text(it, Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3) }
        }
        val primeiro = mes.dayOfWeek.value % 7 // domingo = 0
        val diasNoMes = mes.lengthOfMonth()
        val celulas = (0 until primeiro).map { null } + (1..diasNoMes).map { mes.withDayOfMonth(it) }
        celulas.chunked(7).forEach { semana ->
            Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                for (i in 0 until 7) {
                    val d = semana.getOrNull(i)
                    // a célula inteira (cerca de 48 dp) é o alvo do toque; o círculo é só o desenho
                    Box(
                        Modifier.weight(1f).heightIn(min = 48.dp).aspectRatio(1f)
                            .let { m -> if (d != null) m.clickable(role = Role.Button) { selStr = Formato.iso(d) }.semantics { contentDescription = Formato.diaLongo(d) + if (porDia.containsKey(d)) ", com nota" else "" } else m },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (d != null) {
                            val tem = porDia.containsKey(d)
                            val ativo = d == sel
                            Box(
                                Modifier.size(38.dp).clip(CircleShape)
                                    .background(if (ativo) Cores.Acai else if (tem) Cores.Trilho else Color.Transparent)
                                    .let { if (tem && !ativo) it.border(1.5.dp, Cores.LilasForte, CircleShape) else it },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("${d.dayOfMonth}", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, color = if (ativo) Cores.Branco else if (tem) Cores.AcaiEscuro else Cores.Tinta2)
                            }
                        }
                    }
                }
            }
        }
    }
    Text(Formato.diaLongo(sel).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleLarge)
    val doDia = porDia[sel].orEmpty()
    if (doDia.isEmpty()) {
        Text("Sem nota neste dia.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
    } else {
        doDia.forEach { n ->
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp)) {
                Pilula("diário da Nutri (grupo)", Cores.Trilho, Cores.LilasTexto, Modifier.padding(bottom = 6.dp))
                Text(n.str("texto") ?: "", style = MaterialTheme.typography.bodyMedium)
                n.str("origem")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp)) }
            }
        }
    }
}
