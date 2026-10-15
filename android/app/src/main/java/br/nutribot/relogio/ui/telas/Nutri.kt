package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.DocConhecimento
import br.nutribot.relogio.dados.DocDossie
import br.nutribot.relogio.dados.Licoes
import br.nutribot.relogio.dados.Momento
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.Persona
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
import br.nutribot.relogio.ui.componentes.CartaoExpansivel
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.MarkdownSimples
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TamanhoVisual
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.semZap
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
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

/** As cinco abas da fase 4 mantêm a posição (o índice salvo continua valendo); as da fase 7 vêm depois. */
private val abasNutri = listOf("fatos", "hipóteses", "pensamentos", "plano", "diário", "lições", "quem ela é", "conhecimento", "documentos", "momentos")

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

/**
 * Origem como pílula curta (fase 5): "cadastro", "conversa", "balança", "rótulo", "você" ou "IA". A frase longa do servidor
 * ("reflexão de domingo (IA); sinais dos pensamentos") não aparece no app.
 */
private fun origemPilula(s: String?): String? {
    val o = s?.lowercase() ?: return null
    return when {
        o.contains("pela pessoa") || o.contains("no app") -> "você"
        o.contains("balança") -> "balança"
        o.contains("rótulo") -> "rótulo"
        o.contains("cadastro") -> "cadastro"
        o.contains("conversa") -> "conversa"
        o.contains("ia") || o.contains("nutri") || o.contains("reflexão") -> "IA"
        else -> null
    }
}

/** A data de um item: "14/10 11:30" (dia + hora quando o item tem `dia`; senão `atualizadoEm`), nunca ISO. */
private fun dataDoItem(it: JSONObject, fuso: String?): String? =
    it.str("dia")?.let { d -> Formato.dia(d)?.let { Formato.diaCurto(it) }?.let { q -> q + (it.str("hora")?.let { h -> " $h" } ?: "") } }
        ?: quandoCurto(it.str("atualizadoEm"), fuso)

/**
 * Texto de um cartão da Nutri: 2 linhas por padrão e o resto em "ver mais" (fase 5). `aoTransbordar` avisa se as 2 linhas
 * não bastaram, para o cartão só oferecer "ver mais" quando há mais.
 */
@Composable
private fun TextoDobravel(texto: String, aberto: Boolean, aoTransbordar: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Text(
        texto, style = MaterialTheme.typography.bodyMedium, modifier = modifier,
        maxLines = if (aberto) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis,
        onTextLayout = { if (!aberto) aoTransbordar(it.hasVisualOverflow) },
    )
}

/** Uma ação pendente sobre um fato ou hipótese (fase 3, A4): corrigir o texto, apagar o fato ou descartar a hipótese. */
private sealed class AcaoNutri {
    data class Corrigir(val fid: String, val texto: String) : AcaoNutri()
    data class Apagar(val fid: String) : AcaoNutri()
    data class Descartar(val hid: String) : AcaoNutri()
}

/**
 * O que a Nutri sabe, em abas (fase 4): Fatos | Hipóteses | Pensamentos | Plano | Diário; fase 7: Lições | Quem ela é |
 * Conhecimento | Documentos | Momentos, cada uma lendo a sua rota. Fatos com `editavel` ganham
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
    // puxar atualiza o /nutri e também o Plano e a aba aberta (cada um lê a sua rota)
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true); vm.recarregarVisiveis(perfil.id, AppVM.rotaMomentos(30)) },
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
            4 -> Diario(j, fuso) { acao = it }
            5 -> AbaLicoes(vm)
            6 -> AbaPersona(vm)
            7 -> AbaConhecimento(vm)
            8 -> AbaDocumentos(vm, perfil)
            else -> AbaMomentos(vm, fuso)
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
 * Cartão de fato, hipótese ou avaliação (fase 5): pílulas (natureza, status, origem curta), o texto em 2 linhas, a data e as
 * ações. O resto do texto, como verificar, evidência e sinais ficam dentro de "ver mais".
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CartaoItem(it: JSONObject, texto: String, fuso: String?, atraso: Int = 0, acoes: (@Composable (JSONObject) -> Unit)? = null, pilulaExtra: String? = null) {
    val (fundo, tinta) = corNatureza(it.str("natureza"))
    val comoVerificar = it.str("comoVerificar")
    val evidencia = it.str("evidencia")
    val sinais = it.arr("sinais").objs()
    val temDetalhe = comoVerificar != null || evidencia != null || sinais.isNotEmpty()
    var mais by rememberSaveable(it.str("id") ?: texto) { mutableStateOf(false) }
    var transborda by remember(texto) { mutableStateOf(false) }
    Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = atraso) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Pilula(rotuloNatureza(it.str("natureza")), fundo, tinta)
            it.str("status")?.let { s -> Pilula(s.lowercase(), Cores.Lavanda, Cores.Tinta2) }
            pilulaExtra?.let { p -> Pilula(p, Cores.Lavanda, Cores.Tinta2) }
            origemPilula(it.str("origem"))?.let { o -> Pilula(o, Cores.Trilho, Cores.LilasTexto) }
        }
        TextoDobravel(texto, mais, { transborda = it }, Modifier.padding(top = 6.dp))
        if (temDetalhe && mais) {
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
            Text(dataDoItem(it, fuso) ?: "", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.weight(1f))
            if (temDetalhe || transborda || mais) Link(if (mais) "ver menos" else "ver mais") { mais = !mais }
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
                Vazio("Sem plano desta semana ainda.", Pose.DuplaDescansando)
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
            PedirPlano(vm, perfilId)
        }
    }
}

/**
 * Fase 7 (W28, D13 ajustada pelo dono): pedir um plano novo pelo app. POST /perfis/:id/plano { pedido? } -> 202. O plano
 * sai completo no grupo do WhatsApp também (para quem não usa o app), fica aqui na aba Plano e no Drive. 1 por dia.
 */
@Composable
private fun PedirPlano(vm: AppVM, perfilId: String) {
    val escopo = rememberCoroutineScope()
    var aberto by rememberSaveable { mutableStateOf(false) }
    var pedido by rememberSaveable { mutableStateOf("") }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    var feito by rememberSaveable(perfilId) { mutableStateOf(false) }
    Cartao(cor = Cores.Trilho) {
        Text("Plano novo", style = MaterialTheme.typography.titleMedium)
        Text(
            if (feito) "Pedido feito. Em alguns minutos o plano aparece aqui e chega no grupo do WhatsApp. Puxe a tela para atualizar."
            else "O plano chega aqui, no Drive e no grupo do WhatsApp, para quem não usa o app. Toda sexta a Nutri também oferece no grupo.",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 4.dp),
        )
        if (!feito) Botao("Pedir plano novo", Modifier.padding(top = 10.dp).fillMaxWidth()) { erro = null; aberto = true }
    }
    if (aberto) {
        AlertDialog(
            onDismissRequest = { if (!enviando) aberto = false },
            containerColor = Cores.Branco,
            title = { Text("Pedir plano novo", style = MaterialTheme.typography.headlineSmall) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Leva alguns minutos. Sai um plano por dia.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                    OutlinedTextField(pedido, { pedido = it.take(200) }, label = { Text("Algum pedido? (opcional)") }, placeholder = { Text("ex.: orçamento apertado, mais peixe") }, minLines = 1, maxLines = 4, modifier = Modifier.fillMaxWidth())
                    erro?.let { AvisoErro(it) }
                }
            },
            confirmButton = {
                Botao(if (enviando) "Enviando…" else "Pedir", habilitado = !enviando) {
                    escopo.launch {
                        enviando = true
                        erro = null
                        try {
                            val corpo = JSONObject()
                            pedido.trim().takeIf { it.isNotBlank() }?.let { corpo.put("pedido", it) }
                            vm.escrever("POST", AppVM.rotaGerarPlano(perfilId), corpo)
                            feito = true
                            aberto = false
                            pedido = ""
                        } catch (e: ErroApi) {
                            erro = when {
                                e.codigo == "whatsapp_desconectado" -> "O WhatsApp do bot está fora do ar agora. Peça de novo quando ele voltar."
                                e.status == 429 -> "Já saiu um plano hoje. Amanhã dá para pedir outro."
                                e.status == 403 -> "Este celular não pode pedir o plano desse perfil."
                                e.status == 404 || e.status == 405 -> "O servidor ainda não aceita esse pedido pelo app."
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
            },
            dismissButton = { Botao("Cancelar", suave = true, habilitado = !enviando) { aberto = false } },
        )
    }
}

/**
 * Uma rota lida dentro de uma aba do /nutri (o mesmo jeito do Plano): roda enquanto busca, aviso de servidor acordando,
 * erro com "tentar de novo" e, quando há dados, o conteúdo. Fase 7: Lições, Quem ela é, Conhecimento, Documentos e Momentos.
 */
@Composable
internal fun CargaEmbutida(vm: AppVM, rota: String, buscando: String, conteudo: @Composable (JSONObject) -> Unit) {
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
            Text(if (carga.acordando) "Acordando o servidor. Leva até 1 minuto." else buscando, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        }
        else -> conteudo(dados)
    }
}

/** Lições (W34): as regras que a Nutri adotou depois de errar, e o caderno inteiro num cartão que abre. */
@Composable
private fun AbaLicoes(vm: AppVM) {
    CargaEmbutida(vm, AppVM.ROTA_LICOES, "Buscando as lições…") { j ->
        val l = Licoes.de(j)
        val regras = l?.regras.orEmpty().map { semZap(it) }.filter { it.isNotBlank() }
        if (regras.isEmpty() && l?.documento.isNullOrBlank()) { Vazio("A Nutri ainda não anotou lições.", Pose.CorgiLupa); return@CargaEmbutida }
        Text("O que ela aprendeu com os próprios erros e passou a seguir.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
        regras.forEachIndexed { i, r ->
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("${i + 1}", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 16.sp, color = Cores.AcaiEscuro)
                    Text(r, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
            }
        }
        l?.dia?.let { d -> quandoCurto(d, null)?.let { Text("atualizado em $it", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp) } }
        l?.documento?.takeIf { it.isNotBlank() }?.let { doc ->
            CartaoExpansivel(
                "licoes-caderno", atraso = 120,
                cabecalho = {
                    Mascote(Pose.CorgiLupa, TamanhoVisual)
                    Column(Modifier.weight(1f)) {
                        Text("Caderno completo", style = MaterialTheme.typography.titleMedium)
                        Text("erros, causas e regras", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    }
                },
            ) { MarkdownSimples(semZap(doc)) }
        }
    }
}

/** Quem ela é (W33): a persona de hoje e como ela mudou (as versões anteriores, em trechos). */
@Composable
private fun AbaPersona(vm: AppVM) {
    CargaEmbutida(vm, AppVM.ROTA_PERSONA, "Buscando quem ela é…") { j ->
        val p = Persona.de(j)
        val texto = p?.texto?.let { semZap(it) }?.takeIf { it.isNotBlank() }
        if (p == null || texto == null) { Vazio("Ela ainda está se conhecendo. Volta depois do primeiro resumo do dia.", Pose.DuplaDescansando); return@CargaEmbutida }
        Cartao(pincel = Brush.linearGradient(listOf(Cores.Trilho, Cores.BomFundo))) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.DuplaFeliz, 56.dp)
                Column(Modifier.weight(1f)) {
                    Text("Quem a Nutri é hoje", style = MaterialTheme.typography.titleLarge)
                    p.atualizado?.let { a -> quandoCurto(a, null)?.let { Text("reescrita em $it", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3) } }
                }
            }
            MarkdownSimples(texto, Modifier.padding(top = 10.dp))
        }
        if (p.versoes.isNotEmpty()) {
            TituloSecao("Como ela mudou")
            p.versoes.take(10).forEachIndexed { i, (em, trecho) ->
                Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300)) {
                    em?.let { e -> quandoCurto(e, null)?.let { Pilula(it, Cores.Lavanda, Cores.Tinta2) } }
                    Text(semZap(trecho), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

/** Tira acentos e caixa, para a busca achar "proteina" em "Proteína". */
private fun semAcento(s: String): String = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()

/**
 * Base de conhecimento (W35) com busca: o termo (3 letras ou mais, meio segundo depois de parar de digitar) vai para o
 * servidor como `?q=`; se a resposta trouxer `trecho`, vale a busca do servidor (no texto); senão, a tela filtra pelo título
 * e pelo foco. Tocar num documento abre o texto inteiro numa folha.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AbaConhecimento(vm: AppVM) {
    var termo by rememberSaveable { mutableStateOf("") }
    var busca by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(termo) {
        delay(500)
        busca = termo.trim().takeIf { it.length >= 3 } ?: ""
    }
    var aberto by rememberSaveable { mutableStateOf<String?>(null) }
    OutlinedTextField(
        termo, { termo = it.take(60) },
        label = { Text("Buscar na base") }, placeholder = { Text("ex.: proteína, sono, creatina") },
        singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = Modifier.fillMaxWidth(),
    )
    val rota = if (busca.isBlank()) AppVM.ROTA_CONHECIMENTO else AppVM.ROTA_CONHECIMENTO + "?q=" + URLEncoder.encode(busca, "UTF-8")
    CargaEmbutida(vm, rota, "Buscando a base…") { j ->
        val todos = DocConhecimento.lista(j)
        val doServidor = busca.isNotBlank() && todos.any { it.trecho != null }
        val alvo = semAcento(termo.trim())
        val docs = when {
            doServidor -> todos
            alvo.isBlank() -> todos
            else -> todos.filter { semAcento(it.titulo).contains(alvo) || semAcento(it.foco ?: "").contains(alvo) }
        }
        if (docs.isEmpty()) {
            Vazio(if (termo.isBlank()) "A base de conhecimento ainda está vazia." else "Nada encontrado para \"${termo.trim()}\".", Pose.CorgiLupa)
            return@CargaEmbutida
        }
        Text("${docs.size} ${if (docs.size == 1) "documento" else "documentos"} que a Nutri estudou", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        docs.forEachIndexed { i, d ->
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300), aoTocar = { aberto = d.id }, rotuloToque = "Ler ${d.titulo}") {
                Text(d.titulo, style = MaterialTheme.typography.titleMedium)
                d.foco?.let { Text(semZap(it), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp)) }
                d.trecho?.let { Text("… ${semZap(it)} …", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp)) }
                val rodape = listOfNotNull(d.versao?.let { "versão $it" }, d.atualizado?.let { a -> quandoCurto(a, null)?.let { "atualizado $it" } }).joinToString(" · ")
                if (rodape.isNotBlank()) Text(rodape, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
    val id = aberto
    if (id != null) {
        ModalBottomSheet(onDismissRequest = { aberto = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Cores.Lavanda) {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(start = 18.dp, end = 18.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CargaEmbutida(vm, AppVM.rotaConhecimentoDoc(id), "Abrindo o documento…") { j ->
                    Text(j.str("titulo") ?: "Documento", style = MaterialTheme.typography.headlineSmall)
                    val texto = j.str("texto")
                    if (texto.isNullOrBlank()) Text("Documento vazio.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
                    else MarkdownSimples(texto)
                }
            }
        }
    }
}

/**
 * Documentos (W32): o dossiê da pessoa, ou seja, os arquivos da pasta dela no Drive que a Nutri lê, com o resumo de cada um.
 * "Abrir a pasta" só abre endereço https.
 */
@Composable
private fun AbaDocumentos(vm: AppVM, perfil: Perfil) {
    val abrir = LocalUriHandler.current
    CargaEmbutida(vm, AppVM.rotaDocumentos(perfil.id), "Buscando os documentos…") { j ->
        val docs = DocDossie.lista(j)
        val pasta = j.str("pastaUrl")?.takeIf { it.startsWith("https://") }
        Text("Arquivos da pasta de ${perfil.curto} no Drive. A Nutri lê e usa nas dicas.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
        if (pasta != null) Link("Abrir a pasta no Drive") { runCatching { abrir.openUri(pasta) } }
        if (docs.isEmpty()) { Vazio("Nenhum documento na pasta ainda. Exames e planos de treino entram aqui.", Pose.CorgiLupa); return@CargaEmbutida }
        docs.forEachIndexed { i, d ->
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300)) {
                Text(d.nome, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                    d.rotulo?.let { Pilula(it, Cores.Lavanda, Cores.Tinta2) }
                    when (d.lido) {
                        true -> Pilula("lido pela Nutri", Cores.BomFundo, Cores.BomTinta)
                        false -> Pilula("ainda não lido", Cores.AtencaoFundo, Cores.AtencaoTinta)
                        null -> {}
                    }
                }
                d.resumo?.let { Text(semZap(it), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp)) }
                d.modificadoEm?.let { m -> quandoCurto(m, perfil.fuso)?.let { Text("mudou em $it", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)) } }
            }
        }
    }
}

/** Momentos (W57): o que a Nutri guardou como marcante no grupo, nos últimos 30 dias, o mais novo primeiro. */
@Composable
private fun AbaMomentos(vm: AppVM, fuso: String?) {
    CargaEmbutida(vm, AppVM.rotaMomentos(30), "Buscando os momentos…") { j ->
        val momentos = Momento.lista(j).sortedByDescending { it.dia ?: "" }
        if (momentos.isEmpty()) { Vazio("Nenhum momento guardado nos últimos 30 dias.", Pose.DuplaDescansando); return@CargaEmbutida }
        Text("O que ficou marcado no grupo, nos últimos 30 dias.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
        momentos.forEachIndexed { i, m ->
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    m.pessoa?.let { Pilula(it, Cores.Trilho, Cores.LilasTexto) }
                    m.tipo?.let { Pilula(it.lowercase(), Cores.Lavanda, Cores.Tinta2) }
                }
                Text(semZap(m.texto), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))
                m.dia?.let { d -> quandoCurto(d, fuso)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)) } }
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
            var mais by rememberSaveable(selStr, i) { mutableStateOf(false) }
            var transborda by remember(it.texto) { mutableStateOf(false) }
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = (i * 30).coerceAtMost(300)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 6.dp)) {
                    Pilula(it.tipo, it.fundo, it.tinta)
                    origemPilula(it.item.str("origem"))?.let { o -> Pilula(o, Cores.Trilho, Cores.LilasTexto) }
                }
                TextoDobravel(it.texto, mais, { transborda = it })
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Text(dataDoItem(it.item, fuso) ?: "", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.weight(1f))
                    if (transborda || mais) Link(if (mais) "ver menos" else "ver mais") { mais = !mais }
                    if (it.fato) AcoesFato(it.item, aoEscolher)
                }
            }
        }
    }
}
