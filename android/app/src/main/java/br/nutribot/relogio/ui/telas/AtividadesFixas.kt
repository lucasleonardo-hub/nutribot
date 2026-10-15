package br.nutribot.relogio.ui.telas

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.AtividadeDoDia
import br.nutribot.relogio.dados.AtividadeFixa
import br.nutribot.relogio.dados.AtividadePendente
import br.nutribot.relogio.dados.CorposDespensa
import br.nutribot.relogio.dados.FixaProxima
import br.nutribot.relogio.dados.RotasDespensa
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.diasDaSemana
import br.nutribot.relogio.dados.intensidades
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.rotuloDias
import br.nutribot.relogio.dados.rotuloIntensidade
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Esperando
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private val iconeLixeira = icone("M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13")

/**
 * A hora digitada como "HH:MM", ou null. O teclado numérico (Gboard) não tem ":", então "2000" vira "20:00", "930" vira
 * "09:30" e "20" vira "20:00"; com ":" vale o que a pessoa escreveu ("8:05" vira "08:05").
 */
private fun horaDigitada(s: String): String? {
    val t = s.trim()
    val (h, m) = if (':' in t) {
        val p = t.split(':')
        if (p.size != 2 || p[0].isEmpty() || p[1].length != 2 || !p.all { it.all(Char::isDigit) }) return null
        p[0].toInt() to p[1].toInt()
    } else {
        if (t.isEmpty() || !t.all(Char::isDigit)) return null
        when (t.length) {
            1, 2 -> t.toInt() to 0
            3 -> t.substring(0, 1).toInt() to t.substring(1).toInt()
            4 -> t.substring(0, 2).toInt() to t.substring(2).toInt()
            else -> return null
        }
    }
    if (h !in 0..23 || m !in 0..59) return null
    return "%02d:%02d".format(h, m)
}

/** "08:00" (ou "0800") -> 480; inválida = null. */
private fun minutos(h: String): Int? = horaDigitada(h)?.split(':')?.let { it[0].toInt() * 60 + it[1].toInt() }

/** "seg, 14/10" para a pergunta "teve?". */
private fun diaDaPergunta(dia: String): String = Formato.dia(dia)?.let { Formato.semanaCurta(it) + ", " + Formato.diaCurto(it) } ?: dia

/**
 * "Vai ter?" de uma ocorrência (hoje ou até 13 dias pra frente), usado no Hoje, na Agenda e aqui: Vai / Não vai, e tocar de
 * novo no marcado desfaz. POST /perfis/:id/atividades/:aid/aviso. A Nutri lê na hora: "não vai" tira a atividade do gasto
 * previsto do dia (e da faixa de calorias) e ela não pergunta no grupo; "vai" deixa somar sem perguntar. Dia que já foi
 * registrado (localização, "teve / não teve") mostra só o que aconteceu.
 */
@Composable
internal fun AvisoAtividade(vm: AppVM, perfilId: String, p: FixaProxima, mostrarDia: Boolean, modifier: Modifier = Modifier) {
    val escopo = rememberCoroutineScope()
    var marcado by remember(p.dia, p.id, p.aviso) { mutableStateOf(p.aviso) }
    var mudando by remember(p.dia, p.id) { mutableStateOf(false) }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    fun marcar(v: String?) {
        if (enviando) return
        escopo.launch {
            enviando = true
            erro = null
            try {
                vm.escrever("POST", RotasDespensa.avisoAtividade(perfilId, p.id), CorposDespensa.aviso(p.dia, v))
                marcado = v
                mudando = false
                vm.invalidar(perfilId) // o gasto previsto e a faixa do Hoje mudam
            } catch (e: ErroApi) {
                erro = if (e.semConexao) "Sem resposta do servidor. Tente de novo." else e.paraPessoa
            } catch (e: CancellationException) {
                throw e
            } finally {
                enviando = false
            }
        }
    }

    val horario = if (p.inicio != null && p.fim != null) "${p.inicio} às ${p.fim}" else p.inicio
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
                Text(p.nome.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = listOfNotNull(if (mostrarDia) diaDaPergunta(p.dia) else null, horario).joinToString(" · ")
                if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            }
            if (p.registrada) {
                if (p.feita == true) Pilula("teve", Cores.BomFundo, Cores.BomTinta) else Pilula("não teve", Cores.Lavanda, Cores.Tinta2)
            } else if (marcado != null && !mudando) {
                // marcado: vira um selo (o toque de novo desfazia sem querer, 15/10); "mudar" abre as opções
                if (marcado == "vai") Pilula("vai ter", Cores.BomFundo, Cores.BomTinta) else Pilula("não vai ter", Cores.Lavanda, Cores.Tinta2)
                Text(
                    "mudar", style = MaterialTheme.typography.labelMedium, color = Cores.LilasTexto,
                    modifier = Modifier.clip(Formas.Pilula).clickable(role = Role.Button, onClickLabel = "Mudar o aviso de ${p.nome}") { mudando = true }.padding(horizontal = 10.dp, vertical = 14.dp),
                )
            } else {
                Chip(if (enviando) "…" else "Vai", marcado == "vai", papel = Role.RadioButton) { if (marcado == "vai") mudando = false else marcar("vai") }
                Chip("Não vai", marcado == "nao", papel = Role.RadioButton) { if (marcado == "nao") mudando = false else marcar("nao") }
            }
        }
        if (mudando && marcado != null) {
            Text(
                "tirar o aviso", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3,
                modifier = Modifier.clip(Formas.Pilula).clickable(role = Role.Button) { marcar(null) }.padding(vertical = 8.dp),
            )
        }
        erro?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.CuidadoTinta, modifier = Modifier.padding(top = 4.dp)) }
    }
}

/**
 * Atividades fixas (fase 7, W17–W20; das três pessoas, D15): esporte ou aula sem relógio, com dias, horário e intensidade.
 * O "teve?" ainda sem resposta fica no topo (responder aqui cancela a pergunta no grupo); depois, o que já se sabe de hoje
 * e a lista com criar e apagar. GET/POST /perfis/:id/atividades, DELETE /perfis/:id/atividades/:aid,
 * POST /perfis/:id/atividades/:aid/resposta { dia, feita }.
 */
@Composable
fun TelaAtividadesFixas(vm: AppVM, perfil: Perfil?, voltar: () -> Unit) {
    if (perfil == null) {
        Column(Modifier.fillMaxSize()) {
            CabecalhoVoltar("Atividades fixas", null, Pose.DuplaVolei, voltar)
            Vazio("Escolha um perfil no Hoje.")
        }
        return
    }
    val rota = AppVM.rotaAtividades(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val escopo = rememberCoroutineScope()
    var nova by rememberSaveable { mutableStateOf(false) }
    var apagar by remember { mutableStateOf<AtividadeFixa?>(null) }
    var editar by remember { mutableStateOf<AtividadeFixa?>(null) }
    var respondendo by remember { mutableStateOf<String?>(null) }
    var recado by remember { mutableStateOf<String?>(null) }
    var erro by remember { mutableStateOf<String?>(null) }

    fun responder(p: AtividadePendente, feita: Boolean) {
        if (respondendo != null) return
        escopo.launch {
            respondendo = p.id + p.dia
            erro = null
            try {
                val j = vm.escrever("POST", AppVM.rotaRespostaAtividade(perfil.id, p.id), JSONObject().put("dia", p.dia).put("feita", feita))
                val kcal = j.num("kcal")?.takeIf { it > 0 }
                recado = if (feita) "Anotado: teve ${p.nome}" + (kcal?.let { " (≈ ${Formato.kcal(it)} kcal no gasto do dia)" } ?: "") + "." else "Anotado: não teve ${p.nome}."
                vm.invalidar(perfil.id) // o gasto do dia muda o Hoje e a lista recarrega
            } catch (e: ErroApi) {
                erro = if (e.semConexao) "Sem resposta do servidor. Tente de novo." else e.paraPessoa
            } catch (e: CancellationException) {
                throw e
            } finally {
                respondendo = null
            }
        }
    }

    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = { CabecalhoVoltar("Atividades fixas", "${perfil.curto} · esporte e aula sem relógio", Pose.DuplaVolei, voltar) },
    ) { j ->
        val fixas = AtividadeFixa.lista(j)
        val hoje = AtividadeDoDia.lista(j)
        val pendentes = AtividadePendente.lista(j)
        recado?.let { Pilula(it, Cores.BomFundo, Cores.BomTinta) }
        erro?.let { AvisoErro(it) }

        pendentes.forEachIndexed { i, p ->
            Cartao(cor = Cores.AtencaoFundo, atraso = (i * 30).coerceAtMost(300)) {
                Text("Teve ${p.nome}?", style = MaterialTheme.typography.titleMedium)
                Text(diaDaPergunta(p.dia), style = MaterialTheme.typography.bodySmall, color = Cores.AtencaoTinta)
                val ocupado = respondendo == p.id + p.dia
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 10.dp)) {
                    Botao(if (ocupado) "Enviando…" else "Teve", Modifier.weight(1f), habilitado = respondendo == null) { responder(p, true) }
                    Botao("Não teve", Modifier.weight(1f), suave = true, habilitado = respondendo == null) { responder(p, false) }
                }
            }
        }

        // hoje e as próximas duas semanas: marcar antes se vai ter (a Nutri adapta comida e gasto do dia)
        val proximas = FixaProxima.lista(j)
        if (proximas.isNotEmpty()) {
            TituloSecao("Vai ter?")
            Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp)) {
                proximas.take(10).forEachIndexed { i, p ->
                    if (i > 0) Box(Modifier.fillMaxWidth().padding(vertical = 8.dp).height(1.dp).background(Cores.Trilho))
                    AvisoAtividade(vm, perfil.id, p, mostrarDia = true)
                }
                Text(
                    "Marque antes e a Nutri já sabe: \"não vai\" tira a atividade do gasto previsto do dia e ela não pergunta no grupo.",
                    style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, modifier = Modifier.padding(top = 10.dp),
                )
            }
        } else if (hoje.isNotEmpty()) {
            TituloSecao("Hoje")
            hoje.forEach { a ->
                val (texto, fundo, tinta) = when (a.feita) {
                    true -> Triple("feita" + (a.kcal?.takeIf { it > 0 }?.let { " · ≈ ${Formato.kcal(it)} kcal" } ?: ""), Cores.BomFundo, Cores.BomTinta)
                    false -> Triple("não teve", Cores.Lavanda, Cores.Tinta2)
                    null -> Triple("a conferir", Cores.AtencaoFundo, Cores.AtencaoTinta)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(a.nome, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                    Pilula(texto, fundo, tinta)
                }
            }
        }

        TituloSecao("Toda semana") { Botao("Nova", suave = true) { nova = true } }
        if (fixas.isEmpty()) {
            Vazio("Nenhuma atividade fixa. Ex.: vôlei, segunda e quarta, 20:00 às 22:00.", Pose.DuplaVolei)
        } else {
            fixas.forEachIndexed { i, a -> CartaoAtividade(a, (i * 30).coerceAtMost(300), aoEditar = { editar = a }) { apagar = a } }
        }
        Text(
            "Toque numa atividade para editar. Sem relógio, a Nutri soma um gasto estimado quando ela acontece: confere pela localização ou pergunta se teve.",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4,
        )
    }

    if (nova) FolhaNovaAtividade(vm, perfil.id, aoFechar = { nova = false }) {
        nova = false
        recado = null
        vm.invalidar(perfil.id)
    }
    editar?.let { a ->
        FolhaNovaAtividade(vm, perfil.id, editando = a, aoFechar = { editar = null }) {
            editar = null
            recado = "Atividade atualizada. A Nutri já usa o horário novo."
            vm.invalidar(perfil.id)
        }
    }
    apagar?.let { a ->
        DialogoApagarAtividade(vm, perfil.id, a, aoFechar = { apagar = null }) {
            recado = null
            vm.invalidar(perfil.id)
        }
    }
}

@Composable
private fun CartaoAtividade(a: AtividadeFixa, atraso: Int, aoEditar: () -> Unit, aoApagar: () -> Unit) {
    Cartao(forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = atraso, aoTocar = aoEditar, rotuloToque = "Editar ${a.nome}") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(a.nome, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(rotuloDias(a.dias).ifBlank { null }, if (a.inicio != null && a.fim != null) "${a.inicio} às ${a.fim}" else null).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2,
                )
            }
            Box(
                Modifier.size(48.dp).clip(Formas.Pilula).clickable(role = Role.Button, onClickLabel = "Apagar ${a.nome}", onClick = aoApagar)
                    .semantics { contentDescription = "Apagar ${a.nome}" },
                contentAlignment = Alignment.Center,
            ) { Icon(iconeLixeira, contentDescription = null, tint = Cores.Tinta3, modifier = Modifier.size(18.dp)) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
            rotuloIntensidade(a.met)?.let { Pilula("intensidade $it", Cores.Trilho, Cores.LilasTexto) }
            a.lugar?.let { Pilula(it, Cores.Lavanda, Cores.Tinta2) }
        }
        a.kcal?.takeIf { it > 0 }?.let { Text("≈ ${Formato.kcal(it)} kcal por vez", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)) }
    }
}

/** Folha "Nova atividade" (ou editar, com `editando`): nome, dias, início e fim (HH:MM) e intensidade -> POST /perfis/:id/atividades ou PUT /perfis/:id/atividades/:aid. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun FolhaNovaAtividade(vm: AppVM, perfilId: String, editando: AtividadeFixa? = null, aoFechar: () -> Unit, aoCriar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    val escrita by vm.escrita.collectAsStateWithLifecycle()
    var nome by rememberSaveable { mutableStateOf(editando?.nome ?: "") }
    var dias by rememberSaveable { mutableStateOf(editando?.dias ?: listOf<Int>()) }
    var inicio by rememberSaveable { mutableStateOf(editando?.inicio ?: "") }
    var fim by rememberSaveable { mutableStateOf(editando?.fim ?: "") }
    var met by rememberSaveable { mutableStateOf(editando?.met ?: intensidades[1].second) }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    fun criar() {
        val n = nome.trim()
        val ini = minutos(inicio)
        val f = minutos(fim)
        if (n.isBlank()) { erro = "Dê um nome (ex.: vôlei)."; return }
        if (dias.isEmpty()) { erro = "Escolha pelo menos um dia."; return }
        if (ini == null || f == null) { erro = "Início e fim como 20:00 (ou só 2000)."; return }
        if (f <= ini) { erro = "O fim precisa ser depois do início."; return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                val corpo = JSONObject().put("nome", n).put("dias", JSONArray(dias.sorted())).put("inicio", horaDigitada(inicio)).put("fim", horaDigitada(fim)).put("met", met)
                if (editando != null) vm.escrever("PUT", RotasDespensa.atividade(perfilId, editando.id), corpo) else vm.escrever("POST", AppVM.rotaAtividades(perfilId), corpo)
                aoCriar()
            } catch (e: ErroApi) {
                erro = if (e.semConexao) "Sem resposta do servidor. Tente de novo." else e.paraPessoa
            } catch (e: CancellationException) {
                throw e
            } finally {
                enviando = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = { if (!enviando) aoFechar() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Cores.Lavanda) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(start = 18.dp, end = 18.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(if (editando != null) "Editar ${editando.nome}" else "Nova atividade", style = MaterialTheme.typography.headlineMedium)
            if (enviando) {
                Esperando("Guardando a atividade…", escrita, Pose.DuplaVolei)
                return@Column
            }
            OutlinedTextField(nome, { nome = it.take(40) }, label = { Text("Nome") }, placeholder = { Text("ex.: vôlei, pilates") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text("Dias", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                diasDaSemana.forEach { (d, rotulo) ->
                    val ativo = d in dias
                    Chip(rotulo, ativo, papel = Role.Checkbox) { dias = if (ativo) dias - d else dias + d }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    inicio, { inicio = it.take(5) }, label = { Text("Início") }, placeholder = { Text("ex.: 2000") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), isError = inicio.isNotBlank() && horaDigitada(inicio) == null,
                    modifier = Modifier.width(140.dp),
                )
                OutlinedTextField(
                    fim, { fim = it.take(5) }, label = { Text("Fim") }, placeholder = { Text("ex.: 2200") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), isError = fim.isNotBlank() && horaDigitada(fim) == null,
                    modifier = Modifier.width(140.dp),
                )
            }
            Text("Intensidade", style = MaterialTheme.typography.labelLarge)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                intensidades.forEach { (rotulo, valor, exemplo) ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Chip(rotulo, met == valor) { met = valor }
                        Text(exemplo, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    }
                }
            }
            erro?.let { AvisoErro(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Botao("Cancelar", Modifier.weight(1f), suave = true) { aoFechar() }
                Botao(if (editando != null) "Salvar" else "Criar", Modifier.weight(1f)) { criar() }
            }
        }
    }
}

/** Confirmação antes de apagar uma atividade fixa: DELETE /perfis/:id/atividades/:aid. */
@Composable
private fun DialogoApagarAtividade(vm: AppVM, perfilId: String, a: AtividadeFixa, aoFechar: () -> Unit, aoApagar: () -> Unit) {
    val escopo = rememberCoroutineScope()
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!enviando) aoFechar() },
        containerColor = Cores.Branco,
        title = { Text("Apagar ${a.nome}?", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("A Nutri para de contar com ela e de perguntar se teve.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                erro?.let { AvisoErro(it) }
            }
        },
        confirmButton = {
            Botao(if (enviando) "Apagando…" else "Apagar", habilitado = !enviando) {
                escopo.launch {
                    enviando = true
                    erro = null
                    try {
                        vm.escrever("DELETE", AppVM.rotaAtividadeFixa(perfilId, a.id), null)
                        aoApagar()
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
