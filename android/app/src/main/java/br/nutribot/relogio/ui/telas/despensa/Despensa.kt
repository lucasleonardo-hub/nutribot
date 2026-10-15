package br.nutribot.relogio.ui.telas.despensa

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.CorposDespensa
import br.nutribot.relogio.dados.ItemDespensa
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.RotasDespensa
import br.nutribot.relogio.dados.SeloValidade
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.ordemCategoria
import br.nutribot.relogio.dados.rotuloCategoria
import br.nutribot.relogio.dados.textoQuantidade
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Segmentado
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate

/*
 * Despensa no app (fase 7, frente E; mapa §1C): Comida › Despensa, tela cheia aberta por cima da Comida (sem rota no NavHost).
 * Três abas: Em casa (por categoria, com quantidade, estado e selos de validade; ações por item), Acabou (serve de lista
 * de compras) e Compras (cupons lidos nos últimos 28 dias). Toda edição vale na próxima resposta da Nutri no WhatsApp,
 * porque a IA lê a mesma coleção.
 */

private val iconeAbrir = icone("M9 6l6 6-6 6")

/**
 * Botão "Despensa" do topo da Comida: quantos itens tem em casa e, quando há, quantos pedem atenção (vencem logo ou
 * passaram do prazo). Busca a mesma rota que a aba Em casa usa, então abrir a tela já mostra o que estava guardado.
 */
@Composable
fun BotaoDespensa(vm: AppVM, perfil: Perfil, hojeIso: String?, aoTocar: () -> Unit) {
    val rota = RotasDespensa.despensa(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val hoje = Formato.hojeDe(hojeIso, perfil.fuso)
    val itens = ItemDespensa.lista(carga.dados).filter { !it.acabou }
    val passou = itens.count { it.selo(hoje) == SeloValidade.Passou }
    val atencao = itens.count { it.selo(hoje) != null }
    val sub = when {
        carga.dados == null -> "o que tem em casa"
        itens.isEmpty() -> "vazia por enquanto"
        itens.size == 1 -> "1 item em casa"
        else -> "${itens.size} itens em casa"
    }
    val selo = when {
        atencao == 0 -> null
        atencao == 1 -> "1 pede atenção"
        else -> "$atencao pedem atenção"
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 4.dp).heightIn(min = 56.dp).clip(Formas.Pequeno).background(Cores.Branco)
            .clickable(role = Role.Button, onClickLabel = "Abrir a despensa", onClick = aoTocar)
            .semantics(mergeDescendants = true) {}
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(Formas.Pequeno).background(Cores.Pessego), contentAlignment = Alignment.Center) {
            Icon(iconeCesta, contentDescription = null, tint = LaranjaTinta, modifier = Modifier.size(22.dp))
        }
        Column(Modifier.weight(1f)) {
            Text("Despensa", style = MaterialTheme.typography.titleMedium)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (selo != null) {
            if (passou > 0) Pilula(selo, Cores.CuidadoFundo, Cores.CuidadoTinta, ponto = true)
            else Pilula(selo, LaranjaFundo, LaranjaTinta, ponto = true)
        }
        Icon(iconeAbrir, contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(18.dp))
    }
}

/**
 * A Despensa por cima da Comida, em tela cheia: entra deslizando da direita (sem animação com "remover animações");
 * o voltar do sistema fecha. Bloqueia o toque na Comida que fica embaixo.
 */
@Composable
fun PainelDespensa(aberta: Boolean, vm: AppVM, perfil: Perfil, hojeIso: String?, aoFechar: () -> Unit) {
    BackHandler(enabled = aberta, onBack = aoFechar)
    val parado = LocalReduzirMovimento.current
    AnimatedVisibility(
        aberta,
        enter = if (parado) EnterTransition.None else slideInHorizontally { it } + fadeIn(),
        exit = if (parado) ExitTransition.None else slideOutHorizontally { it } + fadeOut(),
    ) {
        Box(
            Modifier.fillMaxSize().background(Cores.Lavanda)
                .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } },
        ) { TelaDespensa(vm, perfil, hojeIso, aoFechar) }
    }
}

/**
 * Tela cheia da Despensa. `hojeIso` = o dia da pessoa (do /hoje); sem ele, a data no fuso dela.
 * Servidor que ainda não tem as rotas (404 rota_inexistente) mostra o aviso da atualização em vez do erro.
 */
@Composable
fun TelaDespensa(vm: AppVM, perfil: Perfil, hojeIso: String?, aoVoltar: () -> Unit) {
    var aba by rememberSaveable(perfil.id) { mutableIntStateOf(0) }
    val rota = when (aba) {
        0 -> RotasDespensa.despensa(perfil.id)
        1 -> RotasDespensa.despensa(perfil.id, acabou = true)
        else -> RotasDespensa.compras(perfil.id)
    }
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val hoje = Formato.hojeDe(hojeIso, perfil.fuso)

    val topo: @Composable () -> Unit = {
        Row(
            Modifier.fillMaxWidth().padding(start = 14.dp, end = 18.dp, top = 12.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            BotaoVoltar(aoVoltar)
            Column(Modifier.weight(1f)) {
                Text("Despensa", style = MaterialTheme.typography.headlineLarge)
                Text("${perfil.curto} · o que tem em casa", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            }
            Mascote(Pose.LontraChef, 60.dp)
        }
        Segmentado(
            listOf("Em casa", "Acabou", "Compras"), aba, { aba = it },
            Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 4.dp),
        )
    }

    if (carga.dados == null && carga.erro.rotaAusente()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            topo()
            Vazio("A despensa chega no app com a próxima atualização do servidor.", Pose.LontraChef)
        }
        return
    }
    ConteudoCarga(carga, { vm.carregar(rota, forcar = true) }, topo = topo) { j ->
        when (aba) {
            0 -> EmCasa(vm, perfil, j, hoje)
            1 -> Acabou(vm, perfil, j)
            else -> AbaCompras(j)
        }
    }
}

/**
 * Tira o item da lista: DELETE no item. Servidor sem essa rota (404 rota_inexistente): com `senaoAcabou`, marca "acabou",
 * que também tira o item da lista de casa.
 */
private suspend fun tirarItem(vm: AppVM, perfilId: String, k: String, senaoAcabou: Boolean) {
    try {
        vm.escrever("DELETE", RotasDespensa.item(perfilId, k), null)
    } catch (e: ErroApi) {
        if (senaoAcabou && e.rotaAusente()) vm.escrever("PUT", RotasDespensa.item(perfilId, k), CorposDespensa.acao("acabou"))
        else throw e
    }
}

private fun quantidadeFeita(q: Double, unidade: String?): String = textoQuantidade(q, unidade) ?: "mais"

/** Em casa: resumo dos selos, adicionar, e os itens por categoria. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmCasa(vm: AppVM, perfil: Perfil, j: JSONObject, hoje: LocalDate) {
    val escopo = rememberCoroutineScope()
    val itens = ItemDespensa.lista(j).filter { !it.acabou }
    var aberto by rememberSaveable(perfil.id) { mutableStateOf<String?>(null) }
    // diálogo aberto: "adicionar", "usei:<k>", "comprei:<k>" ou "tirar:<k>"
    var dialogo by rememberSaveable(perfil.id) { mutableStateOf<String?>(null) }
    var recado by rememberSaveable(perfil.id) { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var erroDialogo by remember { mutableStateOf<String?>(null) }
    var ocupado by remember { mutableStateOf<String?>(null) }
    var erroItem by remember { mutableStateOf<Pair<String, String>?>(null) }

    /** Uma escrita: no diálogo (trava o diálogo) ou direto no item (trava as ações do item). */
    fun executar(k: String?, emDialogo: Boolean, feito: String, acao: suspend () -> Unit) {
        escopo.launch {
            recado = null
            if (emDialogo) {
                enviando = true
                erroDialogo = null
            } else {
                ocupado = k
                erroItem = null
            }
            try {
                acao()
                recado = feito
                dialogo = null
                vm.invalidar(perfil.id)
            } catch (e: ErroApi) {
                val msg = mensagemErroDespensa(e)
                if (emDialogo) erroDialogo = msg else erroItem = (k ?: "") to msg
            } finally {
                enviando = false
                ocupado = null
            }
        }
    }

    fun ajustar(item: ItemDespensa, acao: String, qtd: Double?, feito: String, emDialogo: Boolean) =
        executar(item.k, emDialogo, feito) { vm.escrever("PUT", RotasDespensa.item(perfil.id, item.k), CorposDespensa.acao(acao, qtd)) }

    // resumo: passou do prazo, vence logo e acabando
    val passou = itens.count { it.selo(hoje) == SeloValidade.Passou }
    val venceLogo = itens.count { it.selo(hoje) == SeloValidade.VenceLogo }
    val acabando = itens.count { it.acabando }
    if (passou + venceLogo + acabando > 0) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (passou > 0) Pilula(if (passou == 1) "1 passou do prazo" else "$passou passaram do prazo", Cores.CuidadoFundo, Cores.CuidadoTinta, ponto = true)
            if (venceLogo > 0) Pilula(if (venceLogo == 1) "1 vence logo" else "$venceLogo vencem logo", LaranjaFundo, LaranjaTinta, ponto = true)
            if (acabando > 0) Pilula("$acabando acabando", Cores.AtencaoFundo, Cores.AtencaoTinta, ponto = true)
        }
    }
    recado?.let { RecadoFeito(it) }
    Botao("Adicionar item", Modifier.fillMaxWidth()) {
        erroDialogo = null
        dialogo = "adicionar"
    }

    if (itens.isEmpty()) {
        Vazio("Nada na despensa ainda. Adicione aqui ou leia um cupom na aba Compras.", Pose.LontraChef)
    } else {
        val grupos = itens.groupBy { it.categoria }.toList()
            .sortedWith(compareBy<Pair<String, List<ItemDespensa>>>({ ordemCategoria(it.first) }, { rotuloCategoria(it.first) }))
        grupos.forEach { (categoria, lista) ->
            val ordenados = lista.sortedWith(compareBy<ItemDespensa>({ ordemSelo(it.selo(hoje)) }, { it.item.lowercase() }))
            Text(
                "${rotuloCategoria(categoria)} · ${lista.size}",
                style = MaterialTheme.typography.titleMedium, color = Cores.Tinta2,
                modifier = Modifier.padding(top = 4.dp),
            )
            Cartao(forma = Formas.Cartao, padding = PaddingValues(vertical = 4.dp)) {
                ordenados.forEachIndexed { i, item ->
                    if (i > 0) Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).height(1.dp).background(Cores.Trilho))
                    LinhaItem(
                        item, hoje, aberto = aberto == item.k,
                        aoTocar = { aberto = if (aberto == item.k) null else item.k },
                    ) {
                        val livre = ocupado == null && !enviando
                        val selo = item.selo(hoje)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (selo == SeloValidade.Passou) {
                                BotaoAcao("Ainda tem", destaque = true, habilitado = livre, rotulo = "Ainda tem ${item.item}") {
                                    ajustar(item, "tem", null, "Anotado: ainda tem ${item.item}.", false)
                                }
                                BotaoAcao("Acabou", habilitado = livre, rotulo = "Acabou ${item.item}") {
                                    ajustar(item, "acabou", null, "${item.item} foi para Acabou.", false)
                                }
                            } else {
                                BotaoAcao("Usei", habilitado = livre, rotulo = "Usei ${item.item}") {
                                    if (item.granel) {
                                        ajustar(item, "usei", null, "Anotado: usou ${item.item}.", false)
                                    } else {
                                        erroDialogo = null
                                        dialogo = "usei:${item.k}"
                                    }
                                }
                                if (!item.acabando) {
                                    BotaoAcao("Acabando", habilitado = livre, rotulo = "${item.item} está acabando") {
                                        ajustar(item, "acabando", null, "Anotado: ${item.item} está acabando.", false)
                                    }
                                }
                                BotaoAcao("Acabou", habilitado = livre, rotulo = "Acabou ${item.item}") {
                                    ajustar(item, "acabou", null, "${item.item} foi para Acabou.", false)
                                }
                                BotaoAcao("Comprei", habilitado = livre, rotulo = "Comprei mais ${item.item}") {
                                    erroDialogo = null
                                    dialogo = "comprei:${item.k}"
                                }
                            }
                            BotaoAcao("Tirar", habilitado = livre, rotulo = "Tirar ${item.item} da lista") {
                                erroDialogo = null
                                dialogo = "tirar:${item.k}"
                            }
                        }
                        erroItem?.takeIf { it.first == item.k }?.let { AvisoErro(it.second) }
                    }
                }
            }
        }
    }

    // diálogos
    val d = dialogo
    val alvo = d?.substringAfter(':', "")?.takeIf { it.isNotEmpty() }?.let { k -> itens.firstOrNull { it.k == k } }
    when {
        d == "adicionar" -> DialogoAdicionar(enviando, erroDialogo, aoFechar = { dialogo = null }) { nome, qtd, unidade, categoria ->
            executar(null, true, "$nome entrou na despensa.") {
                vm.escrever("POST", RotasDespensa.novoItem(perfil.id), CorposDespensa.novoItem(nome, qtd, unidade, categoria))
            }
        }
        d != null && d.startsWith("usei:") && alvo != null -> DialogoQuantidade(
            "Quanto usou de ${alvo.item}?",
            alvo.quantidadeTexto?.let { "Em casa: $it." } ?: "A quantidade sai da despensa.",
            alvo.unidade, "Dar baixa", enviando, erroDialogo, aoFechar = { dialogo = null },
        ) { q -> ajustar(alvo, "usei", q, "Baixa feita: ${quantidadeFeita(q, alvo.unidade)} de ${alvo.item}.", true) }
        d != null && d.startsWith("comprei:") && alvo != null -> DialogoQuantidade(
            "Comprou mais ${alvo.item}?",
            "A quantidade soma ao que já tem e a validade recomeça.",
            alvo.unidade, "Somar", enviando, erroDialogo, aoFechar = { dialogo = null },
        ) { q -> ajustar(alvo, "comprei", q, "${alvo.item}: entrou ${quantidadeFeita(q, alvo.unidade)}.", true) }
        d != null && d.startsWith("tirar:") && alvo != null -> DialogoConfirmar(
            "Tirar ${alvo.item}?", "O item sai da lista da despensa.", "Tirar", enviando, erroDialogo, aoFechar = { dialogo = null },
        ) { executar(alvo.k, true, "${alvo.item} saiu da lista.") { tirarItem(vm, perfil.id, alvo.k, senaoAcabou = true) } }
        d != null && d != "adicionar" && alvo == null -> LaunchedEffect(d) { dialogo = null } // o item sumiu da lista
    }
}

private fun ordemSelo(s: SeloValidade?): Int = when (s) {
    SeloValidade.Passou -> 0
    SeloValidade.VenceLogo -> 1
    null -> 2
}

/** Uma linha da despensa: nome, quantidade e estado, selo de validade; tocar abre as ações. */
@Composable
private fun LinhaItem(item: ItemDespensa, hoje: LocalDate, aberto: Boolean, aoTocar: () -> Unit, acoes: @Composable () -> Unit) {
    val parado = LocalReduzirMovimento.current
    val giroAlvo = if (aberto) 180f else 0f
    val giro = if (parado) giroAlvo else animateFloatAsState(giroAlvo, label = "setaItem").value
    val selo = item.selo(hoje)
    val sub = listOfNotNull(
        item.quantidadeTexto,
        if (item.acabando) "acabando" else null,
        Formato.dia(item.compradoEm)?.let { "comprado em ${Formato.diaCurto(it)}" },
    ).joinToString(" · ")
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp)
                .clickable(role = Role.Button, onClickLabel = if (aberto) "Fechar ações" else "Ver ações", onClick = aoTocar)
                .semantics { stateDescription = if (aberto) "aberto" else "fechado" }
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(item.item.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodySmall, color = if (item.acabando) Cores.AtencaoTinta else Cores.Tinta3, fontSize = 12.sp)
                if (selo != null) SeloDeValidade(selo, item.diasParaVencer(hoje), Modifier.padding(top = 3.dp))
            }
            Icon(iconeSetaDespensa, contentDescription = null, tint = Cores.Acai, modifier = Modifier.size(18.dp).rotate(giro))
        }
        AnimatedVisibility(
            aberto,
            enter = if (parado) EnterTransition.None else fadeIn() + expandVertically(),
            exit = if (parado) ExitTransition.None else fadeOut() + shrinkVertically(),
        ) {
            Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item.kcal100?.let { k ->
                    Text(
                        "Por 100 g: ${Formato.kcal(k)} kcal" + (item.p100?.let { " · proteína ${Formato.gramas(it)} g" } ?: ""),
                        style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3,
                    )
                }
                item.loja?.let { Text("Comprado em: $it", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                acoes()
            }
        }
    }
}

/** Acabou: o que acabou, para lembrar de comprar. Comprei devolve o item para Em casa. */
@Composable
private fun Acabou(vm: AppVM, perfil: Perfil, j: JSONObject) {
    val escopo = rememberCoroutineScope()
    val itens = ItemDespensa.lista(j).filter { it.acabou }.sortedBy { it.item.lowercase() }
    var dialogo by rememberSaveable(perfil.id) { mutableStateOf<String?>(null) }
    var recado by rememberSaveable(perfil.id) { mutableStateOf<String?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var erroDialogo by remember { mutableStateOf<String?>(null) }

    fun executar(feito: String, acao: suspend () -> Unit) {
        escopo.launch {
            recado = null
            enviando = true
            erroDialogo = null
            try {
                acao()
                recado = feito
                dialogo = null
                vm.invalidar(perfil.id)
            } catch (e: ErroApi) {
                erroDialogo = mensagemErroDespensa(e)
            } finally {
                enviando = false
            }
        }
    }

    Text("O que acabou fica aqui. Serve de lista de compras.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
    recado?.let { RecadoFeito(it) }
    if (itens.isEmpty()) {
        Vazio("Nada acabou por enquanto.", Pose.DuplaFeliz)
    } else {
        Cartao(forma = Formas.Cartao, padding = PaddingValues(vertical = 4.dp)) {
            itens.forEachIndexed { i, item ->
                if (i > 0) Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).height(1.dp).background(Cores.Trilho))
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(item.item.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(rotuloCategoria(item.categoria), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                    }
                    BotaoAcao("Comprei", destaque = true, habilitado = !enviando, rotulo = "Comprei ${item.item}") {
                        erroDialogo = null
                        dialogo = "comprei:${item.k}"
                    }
                    BotaoAcao("Tirar", habilitado = !enviando, rotulo = "Tirar ${item.item} da lista") {
                        erroDialogo = null
                        dialogo = "tirar:${item.k}"
                    }
                }
            }
        }
    }

    val d = dialogo
    val alvo = d?.substringAfter(':', "")?.takeIf { it.isNotEmpty() }?.let { k -> itens.firstOrNull { it.k == k } }
    when {
        d != null && d.startsWith("comprei:") && alvo != null -> DialogoQuantidade(
            "Comprou ${alvo.item}?", "O item volta para Em casa com essa quantidade.",
            alvo.unidade, "Comprei", enviando, erroDialogo, aoFechar = { dialogo = null },
        ) { q ->
            executar("${alvo.item} voltou para Em casa.") {
                vm.escrever("PUT", RotasDespensa.item(perfil.id, alvo.k), CorposDespensa.acao("comprei", q))
            }
        }
        d != null && d.startsWith("tirar:") && alvo != null -> DialogoConfirmar(
            "Tirar ${alvo.item}?", "O item sai de vez da lista.", "Tirar", enviando, erroDialogo, aoFechar = { dialogo = null },
        ) { executar("${alvo.item} saiu da lista.") { tirarItem(vm, perfil.id, alvo.k, senaoAcabou = false) } }
        d != null && alvo == null -> LaunchedEffect(d) { dialogo = null }
    }
}
