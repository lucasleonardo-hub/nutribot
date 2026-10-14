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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.MarkdownSimples
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

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

private val abasNutri = listOf("Fatos", "Hipóteses", "Pensamentos", "Plano", "Diário")

private val soData = Regex("^\\d{4}-\\d{2}-\\d{2}$")

/** O fuso da pessoa para mostrar instantes; sem fuso válido, o do celular. */
private fun zona(fuso: String?): ZoneId = runCatching { ZoneId.of(fuso ?: "") }.getOrNull() ?: ZoneId.systemDefault()

/** Um instante ou dia da API como "14/10 11:30" ou "14/10" (nunca ISO cru). */
private fun quandoCurto(s: String?, fuso: String?): String? {
    if (s.isNullOrBlank()) return null
    if (soData.matches(s)) return Formato.dia(s)?.let { Formato.diaCurto(it) }
    val i = Formato.instante(s) ?: return Formato.dia(s)?.let { Formato.diaCurto(it) }
    val dt = i.atZone(zona(fuso))
    return "%02d/%02d %02d:%02d".format(dt.dayOfMonth, dt.monthValue, dt.hour, dt.minute)
}

/** O dia (no fuso da pessoa) de um instante ou dia da API. */
private fun diaDe(s: String?, fuso: String?): LocalDate? {
    if (s.isNullOrBlank()) return null
    if (soData.matches(s)) return Formato.dia(s)
    return Formato.instante(s)?.atZone(zona(fuso))?.toLocalDate() ?: Formato.dia(s)
}

/** Origem curta: até o primeiro parêntese ou ponto e vírgula ("reflexão de domingo (IA); sinais..." vira "reflexão de domingo"). */
private fun origemCurta(s: String?): String? = s?.substringBefore(" (")?.substringBefore(";")?.trim()?.takeIf { it.isNotBlank() }

/** Rodapé de um item: "origem curta · 14/10 11:30" (dia + hora quando o item tem `dia`; senão `atualizadoEm`). */
private fun rodape(it: JSONObject, fuso: String?): String {
    val data = it.str("dia")?.let { d -> Formato.dia(d)?.let { Formato.diaCurto(it) }?.let { q -> q + (it.str("hora")?.let { h -> " $h" } ?: "") } }
        ?: quandoCurto(it.str("atualizadoEm"), fuso)
    return listOfNotNull(origemCurta(it.str("origem")), data).joinToString(" · ")
}

/** Uma ação pendente sobre um fato ou hipótese (fase 3, A4): corrigir o texto, apagar o fato ou descartar a hipótese. */
private sealed class AcaoNutri {
    data class Corrigir(val fid: String, val texto: String) : AcaoNutri()
    data class Apagar(val fid: String) : AcaoNutri()
    data class Descartar(val hid: String) : AcaoNutri()
}

/**
 * O que a Nutri sabe, em cinco abas (fase 4): Fatos | Hipóteses | Pensamentos | Plano | Diário. Fatos com `editavel` ganham
 * "corrigir", com `apagavel` ganham "apagar"; hipótese aberta com `apagavel` ganha "descartar". Toda resposta traz o /nutri
 * recalculado, que entra no lugar do guardado (vm.semear). Tudo o que tem data (diário, pensamentos, reflexões, anotações,
 * hipóteses fechadas) aparece também no Diário. O Plano vem do /plano.
 */
@Composable
fun TelaNutri(vm: AppVM, perfil: Perfil?) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaNutri(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var aba by rememberSaveable { mutableIntStateOf(0) }
    var acao by remember { mutableStateOf<AcaoNutri?>(null) }
    val fuso = perfil.fuso
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            Cabecalho("O que a Nutri sabe", "sobre ${perfil.curto}", Pose.DuplaConferindo, 60.dp)
            // cinco abas não cabem num segmentado: chips roláveis, nenhum texto cortado
            LazyRow(
                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Abas" },
            ) {
                itemsIndexed(abasNutri) { i, nome -> Chip(nome, aba == i, papel = Role.Tab) { aba = i } }
            }
        },
    ) { j ->
        when (aba) {
            // anotações com data vão para o Diário (com "apagar" lá); aqui ficam os fatos de cadastro e as fichas
            0 -> ListaItens(j.arr("fatos").objs().filter { it.str("campo") != "anotacao" }, "Nenhum fato guardado ainda.", fuso, texto = { f -> f.str("texto") ?: f.str("campo") ?: "" }) { f -> AcoesFato(f) { acao = it } }
            1 -> ListaItens(j.arr("hipoteses").objs(), "Nenhuma hipótese aberta.", fuso, texto = { h -> h.str("texto") ?: "" }) { h ->
                val id = h.str("id")
                if (id != null && h.bool("apagavel") == true) Link("descartar") { acao = AcaoNutri.Descartar(id) }
            }
            2 -> Pensamentos(j, fuso)
            3 -> Plano(vm, perfil.id)
            else -> Diario(j, fuso) { acao = it }
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
private fun AcoesFato(f: JSONObject, aoEscolher: (AcaoNutri) -> Unit) {
    val id = f.str("id")
    // `valor` é o texto cru (sem o rótulo "Dieta: "), que é o que o PUT recebe de volta
    if (id != null && f.bool("editavel") == true) Link("corrigir") { aoEscolher(AcaoNutri.Corrigir(id, f.str("valor") ?: f.str("texto") ?: "")) }
    if (id != null && f.bool("apagavel") == true) Link("apagar") { aoEscolher(AcaoNutri.Apagar(id)) }
}

@Composable
private fun ListaItens(itens: List<JSONObject>, vazio: String, fuso: String?, texto: (JSONObject) -> String, acoes: (@Composable (JSONObject) -> Unit)? = null) {
    if (itens.isEmpty()) { Vazio(vazio, Pose.CorgiLupa); return }
    itens.forEachIndexed { i, it -> CartaoItem(it, texto(it), fuso, (i * 30).coerceAtMost(300), acoes) }
}

/**
 * Cartão de fato, hipótese ou avaliação: pílulas, texto, UMA linha de rodapé (origem curta · 14/10 11:30) e as ações.
 * Como verificar, evidência e sinais ficam dentro de "ver mais".
 */
@Composable
private fun CartaoItem(it: JSONObject, texto: String, fuso: String?, atraso: Int = 0, acoes: (@Composable (JSONObject) -> Unit)? = null, pilulaExtra: String? = null) {
    val (fundo, tinta) = corNatureza(it.str("natureza"))
    val comoVerificar = it.str("comoVerificar")
    val evidencia = it.str("evidencia")
    val sinais = it.arr("sinais").objs()
    val temMais = comoVerificar != null || evidencia != null || sinais.isNotEmpty()
    var mais by rememberSaveable(it.str("id") ?: texto) { mutableStateOf(false) }
    Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = atraso) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pilula(rotuloNatureza(it.str("natureza")), fundo, tinta)
            it.str("status")?.let { s -> Pilula(s, Cores.Lavanda, Cores.Tinta2) }
            pilulaExtra?.let { p -> Pilula(p, Cores.Lavanda, Cores.Tinta2) }
        }
        Text(texto, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
        if (temMais && mais) {
            comoVerificar?.let { c -> Text("Como verificar: $c", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 4.dp)) }
            evidencia?.let { c -> Text("Evidência: $c", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp)) }
            if (sinais.isNotEmpty()) {
                val aFavor = sinais.count { s -> s.str("direcao")?.contains("favor") == true || s.str("direcao") == "confirma" }
                Text("${sinais.size} sinais · $aFavor a favor, ${sinais.size - aFavor} contra", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 2.dp))
                sinais.take(6).forEach { s ->
                    val d = Formato.dia(s.str("dia"))?.let { Formato.diaCurto(it) }
                    Text(listOfNotNull(d, s.str("direcao"), s.str("evidencia")).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 2.dp))
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
            Text(rodape(it, fuso), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.weight(1f))
            if (temMais) Link(if (mais) "ver menos" else "ver mais") { mais = !mais }
            acoes?.invoke(it)
        }
    }
}

/** Pensamentos: as avaliações do tipo pensamento e reflexão (a reflexão leva a pílula "reflexão de domingo"). */
@Composable
private fun Pensamentos(j: JSONObject, fuso: String?) {
    val itens = j.arr("avaliacoes").objs().filter { it.str("tipo") == "pensamento" || it.str("tipo") == "reflexao" }
    if (itens.isEmpty()) { Vazio("Nenhum pensamento da Nutri ainda.", Pose.CorgiLupa); return }
    itens.forEachIndexed { i, it ->
        CartaoItem(it, it.str("texto") ?: "", fuso, (i * 30).coerceAtMost(300), pilulaExtra = if (it.str("tipo") == "reflexao") "reflexão de domingo" else null)
    }
}

/** Plano da semana: GET /plano -> { plano: { semana, de, ate, texto, criadoEm } | null }, em Markdown simples. */
@Composable
private fun Plano(vm: AppVM, perfilId: String) {
    val rota = AppVM.rotaPlano(perfilId)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val dados = carga.dados
    val erro = carga.erro
    when {
        dados == null && erro != null -> {
            Text(erro.paraPessoa, style = MaterialTheme.typography.bodyMedium, color = Cores.CuidadoTinta)
            Link("tentar de novo") { vm.carregar(rota, forcar = true) }
        }
        dados == null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Acai, strokeWidth = 2.dp)
            Text(if (carga.acordando) "Acordando o servidor. Leva até 1 minuto." else "Buscando o plano…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        }
        else -> {
            val plano = dados.obj("plano")
            val texto = plano.str("texto")
            if (plano == null || texto == null) {
                Vazio("Sem plano ainda. Peça !plano no WhatsApp.", Pose.DuplaDescansando)
            } else {
                val de = Formato.dia(plano.str("de"))
                val ate = Formato.dia(plano.str("ate"))
                Cartao {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Plano da semana", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                        if (de != null && ate != null) Pilula("${Formato.diaCurto(de)} a ${Formato.diaCurto(ate)}", Cores.Trilho, Cores.LilasTexto)
                    }
                    MarkdownSimples(texto, Modifier.padding(top = 8.dp))
                    plano.str("criadoEm")?.let { c -> Text("enviado ${quandoCurto(c, null) ?: ""}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 8.dp)) }
                }
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

/** Um item com data no Diário: o tipo (pílula), as cores, o item cru e, nas anotações, o fato para o "apagar". */
private data class ItemDiario(val dia: LocalDate, val tipo: String, val fundo: Color, val tinta: Color, val item: JSONObject, val texto: String, val fato: Boolean = false)

/** Tudo o que tem data no /nutri: diário (grupo), pensamentos, reflexões, anotações e hipóteses fechadas. */
private fun itensDoDiario(j: JSONObject, fuso: String?): List<ItemDiario> {
    val saida = ArrayList<ItemDiario>()
    (j.arr("diario").objs() + j.arr("diarioGrupo").objs()).forEach { n ->
        val d = diaDe(n.str("dia"), fuso) ?: return@forEach
        saida += ItemDiario(d, "diário da Nutri (grupo)", Cores.Trilho, Cores.LilasTexto, n, n.str("texto") ?: "")
    }
    j.arr("avaliacoes").objs().forEach { a ->
        val d = diaDe(a.str("dia"), fuso) ?: diaDe(a.str("atualizadoEm"), fuso) ?: return@forEach
        when (a.str("tipo")) {
            "reflexao" -> saida += ItemDiario(d, "reflexão de domingo", Color(0xFFFFF0F5), Color(0xFF8A2448), a, a.str("texto") ?: "")
            "pensamento" -> saida += ItemDiario(d, "pensamento", Cores.AtencaoFundo, Cores.AtencaoTinta, a, a.str("texto") ?: "")
            else -> saida += ItemDiario(d, a.str("tipo") ?: "avaliação", Cores.Lavanda, Cores.Tinta2, a, a.str("texto") ?: "")
        }
    }
    j.arr("fatos").objs().filter { it.str("campo") == "anotacao" }.forEach { f ->
        val d = diaDe(f.str("atualizadoEm"), fuso) ?: return@forEach
        saida += ItemDiario(d, "anotação", Cores.BomFundo, Cores.BomTinta, f, f.str("texto") ?: "", fato = true)
    }
    j.arr("hipoteses").objs().filter { it.str("status") != null && it.str("status") != "aberta" }.forEach { h ->
        val d = diaDe(h.str("atualizadoEm"), fuso) ?: return@forEach
        saida += ItemDiario(d, "hipótese ${h.str("status")}", Color(0xFFFFF0F5), Color(0xFF8A2448), h, h.str("texto") ?: "")
    }
    return saida.filter { it.texto.isNotBlank() }
}

/** Diário: calendário do mês marcando todo item com data; tocar num dia lista os itens, uma pílula por tipo. */
@Composable
private fun Diario(j: JSONObject, fuso: String?, aoEscolher: (AcaoNutri) -> Unit) {
    val itens = itensDoDiario(j, fuso)
    val porDia = itens.groupBy { it.dia }
    val ultimo = itens.maxOfOrNull { it.dia } ?: LocalDate.now()
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
                    val quantos = d?.let { porDia[it]?.size } ?: 0
                    // a célula inteira (cerca de 48 dp) é o alvo do toque; o círculo é só o desenho
                    Box(
                        Modifier.weight(1f).heightIn(min = 48.dp).aspectRatio(1f)
                            .let { m -> if (d != null) m.clickable(role = Role.Button) { selStr = Formato.iso(d) }.semantics { contentDescription = Formato.diaLongo(d) + if (quantos > 0) ", $quantos ${if (quantos == 1) "item" else "itens"}" else "" } else m },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (d != null) {
                            val tem = quantos > 0
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
        Text("Nada anotado neste dia.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
    } else {
        doDia.forEachIndexed { i, it ->
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300)) {
                Pilula(it.tipo, it.fundo, it.tinta, Modifier.padding(bottom = 6.dp))
                Text(it.texto, style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Text(rodape(it.item, fuso), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.weight(1f))
                    if (it.fato) AcoesFato(it.item, aoEscolher)
                }
            }
        }
    }
}
