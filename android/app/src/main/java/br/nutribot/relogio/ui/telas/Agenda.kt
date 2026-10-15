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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.DiaSerie
import br.nutribot.relogio.dados.Evento
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.Refeicao
import br.nutribot.relogio.dados.EventoGoogle
import br.nutribot.relogio.dados.FixaProxima
import br.nutribot.relogio.dados.RotasDespensa
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Esperando
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate

private val iconeSetaAgenda = icone("M6 9l6 6 6-6")

/** Um item da lista do dia: refeição, treino do relógio ou evento criado pela pessoa (apagável). */
private data class ItemDia(val hora: String?, val tipo: String, val titulo: String, val sub: String?, val fundo: Color, val tinta: Color, val eventoId: String? = null)

private fun corDoTipo(tipo: String): Pair<Color, Color> = when (tipo) {
    "comer_fora", "festa" -> Color(0xFFFFF0F5) to Color(0xFF8A2448)
    "viagem" -> Color(0xFFE8F3FF) to Color(0xFF1F4E8A)
    "treino" -> Color(0xFFEEFAF3) to Cores.GorduraTinta
    "consulta" -> Cores.AtencaoFundo to Cores.AtencaoTinta
    else -> Cores.Trilho to Cores.LilasTexto
}

/**
 * Agenda: por dia, as refeições (de /refeicoes), os treinos do relógio (hoje, de /hoje) e os eventos que a pessoa criou
 * para a Nutri ler (de /eventos, numa janela de 14 dias em volta da semana). A semana anda para trás e para a frente
 * (até 60 dias); dias futuros mostram só eventos.
 */
@Composable
fun TelaAgenda(vm: AppVM, perfil: Perfil?, voltar: () -> Unit) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val escopo = rememberCoroutineScope()
    val hojeCarga by vm.carga(AppVM.rotaHoje(perfil.id)).collectAsStateWithLifecycle()
    val hoje = Formato.hojeDe(hojeCarga.dados.str("dia"), perfil.fuso)
    var fimSemanaStr by rememberSaveable { mutableStateOf(Formato.iso(hoje)) }
    val fimSemana = Formato.dia(fimSemanaStr) ?: hoje
    val ini = fimSemana.minusDays(6)
    val limiteFuturo = hoje.plusDays(60)
    // refeições só até hoje (o servidor recusa "ate" no futuro); numa semana toda futura não há o que pedir
    val fimRef = minOf(fimSemana, hoje)
    val rotaRef = if (ini.isAfter(hoje)) null else AppVM.rotaRefeicoes(perfil.id, Formato.iso(ini), Formato.iso(fimRef))
    val rotaEv = AppVM.rotaEventos(perfil.id, Formato.iso(ini.minusDays(3)), Formato.iso(minOf(fimSemana.plusDays(4), limiteFuturo)))
    val cargaEv by vm.carga(rotaEv).collectAsStateWithLifecycle()
    val cargaRef by (rotaRef?.let { vm.carga(it) } ?: vm.carga(rotaEv)).collectAsStateWithLifecycle()
    // fase 4: o sono de cada dia vem do /dias (uma chamada por semana visível; só até hoje)
    val rotaDias = if (ini.isAfter(hoje)) null else AppVM.rotaDias(perfil.id, Formato.iso(ini), Formato.iso(fimRef))
    val cargaDias by (rotaDias?.let { vm.carga(it) } ?: vm.carga(rotaEv)).collectAsStateWithLifecycle()
    LaunchedEffect(rotaEv, rotaRef) {
        vm.carregar(rotaEv)
        rotaRef?.let { vm.carregar(it) }
        rotaDias?.let { vm.carregar(it) }
        vm.carregar(AppVM.rotaHoje(perfil.id))
    }
    // fase 7 (W26): a agenda do Google, só leitura e só do dono da credencial. As Integrações dizem de quem é; sem essa
    // informação ainda, pede assim mesmo e esconde o erro (403/404 = este perfil não tem agenda ligada).
    val integracoes by vm.carga(AppVM.ROTA_INTEGRACOES).collectAsStateWithLifecycle()
    val agendaLigada = integracoes.dados.arr("perfis").objs().firstOrNull { it.str("id") == perfil.id }?.obj("agenda")?.bool("ativo")
    val rotaGoogle = if (agendaLigada == false) null else AppVM.rotaAgendaGoogle(perfil.id)
    val cargaGoogle by (rotaGoogle?.let { vm.carga(it) } ?: vm.carga(rotaEv)).collectAsStateWithLifecycle()
    LaunchedEffect(rotaGoogle) { rotaGoogle?.let { vm.carregar(it) } }
    val doGoogle = if (rotaGoogle == null) emptyList() else EventoGoogle.lista(cargaGoogle.dados)
    val rotaFixas = RotasDespensa.atividades(perfil.id)
    val cargaFixas by vm.carga(rotaFixas).collectAsStateWithLifecycle()
    LaunchedEffect(rotaFixas) { vm.carregar(rotaFixas) }
    var selStr by rememberSaveable { mutableStateOf(Formato.iso(hoje)) }
    val sel = Formato.dia(selStr) ?: hoje
    var novo by rememberSaveable { mutableStateOf(false) }
    var apagar by rememberSaveable { mutableStateOf<String?>(null) }
    var erroApagar by remember { mutableStateOf<String?>(null) }
    var apagando by remember { mutableStateOf(false) }

    ConteudoCarga(
        cargaEv, {
            vm.carregar(rotaEv, forcar = true); rotaRef?.let { vm.carregar(it, forcar = true) }; rotaDias?.let { vm.carregar(it, forcar = true) }
            rotaGoogle?.let { vm.carregar(it, forcar = true) }; vm.carregar(rotaFixas, forcar = true)
        },
        topo = { CabecalhoVoltar("Agenda", "${perfil.curto} · o que aconteceu e o que vem", Pose.LontraRelogio, voltar) },
    ) { jEv ->
        val alturaChip = 56.dp * LocalDensity.current.fontScale.coerceAtMost(1.3f)
        Row(verticalAlignment = Alignment.CenterVertically) {
            BotaoSetaAgenda("Semana anterior", 90f) { fimSemanaStr = Formato.iso(fimSemana.minusDays(7)); selStr = Formato.iso(fimSemana.minusDays(7)) }
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (i in 0..6) {
                    val d = ini.plusDays(i.toLong())
                    val ativo = d == sel
                    val futuro = d.isAfter(hoje)
                    Column(
                        Modifier.weight(1f).heightIn(min = alturaChip).clip(Formas.Pequeno).background(if (ativo) Cores.Acai else Cores.Branco)
                            .let { if (d == hoje && !ativo) it.border(2.dp, Cores.LilasForte, Formas.Pequeno) else it }
                            .clickable(role = Role.Tab) { selStr = Formato.iso(d) }
                            .semantics { contentDescription = Formato.diaLongo(d) + if (futuro) " (futuro)" else "" }
                            .padding(vertical = 7.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(Formato.semanaCurta(d), fontSize = 11.sp, color = if (ativo) Cores.Branco else Cores.Tinta3)
                        Text("${d.dayOfMonth}", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 16.sp, color = if (ativo) Cores.Branco else if (futuro) Cores.Tinta3 else Cores.Tinta)
                    }
                }
            }
            BotaoSetaAgenda("Próxima semana", -90f, habilitado = ini.plusDays(7).isBefore(limiteFuturo)) { fimSemanaStr = Formato.iso(fimSemana.plusDays(7)); selStr = Formato.iso(ini.plusDays(7)) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (sel == hoje) "Hoje" else Formato.diaLongo(sel).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            Botao("Novo evento", suave = true, habilitado = !sel.isAfter(limiteFuturo)) { novo = true }
        }
        // sono da noite de que a pessoa acordou neste dia (fase 4)
        if (rotaDias != null) {
            DiaSerie.lista(cargaDias.dados).firstOrNull { it.dia == Formato.iso(sel) }?.let { d ->
                val min = d.sonoMin?.takeIf { it > 0 }
                if (min != null) {
                    val horas = listOfNotNull(d.sonoInicio, d.sonoFim).takeIf { it.size == 2 }?.let { " (${it[0]}–${it[1]})" } ?: ""
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Pilula("Sono", Cores.Trilho, Cores.LilasTexto)
                        Text("${Formato.sono(min)}$horas", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                    }
                }
            }
        }

        // atividades fixas do dia (hoje e as próximas duas semanas): marcar aqui se vai ter, e a Nutri já adapta o dia
        val fixasDoDia = FixaProxima.lista(cargaFixas.dados).filter { it.dia == Formato.iso(sel) }
        if (fixasDoDia.isNotEmpty()) {
            Cartao(cor = Color(0xFFFFF6E5), forma = Formas.Cartao, padding = PaddingValues(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pilula("Atividade fixa", Cores.Branco, Color(0xFF8A4B12))
                    Spacer(Modifier.weight(1f))
                    Mascote(Pose.DuplaVolei, 36.dp)
                }
                fixasDoDia.forEach { AvisoAtividade(vm, perfil.id, it, mostrarDia = false, modifier = Modifier.padding(top = 6.dp)) }
            }
        }

        val diaRef = cargaRef.dados.arr("dias").objs().firstOrNull { Formato.dia(it.str("dia")) == sel }
        val refeicoes = if (sel.isAfter(hoje)) emptyList() else Refeicao.lista(diaRef)
        val treinos = if (sel == hoje) hojeCarga.dados.obj("relogio").arr("treinos").objs() else emptyList()
        // eventos: a janela do /eventos mais os que vêm em cada dia do /refeicoes (o mesmo evento pode vir nos dois: fica um)
        val eventos = (Evento.lista(jEv) + Evento.lista(diaRef)).filter { it.dia == Formato.iso(sel) }.distinctBy { it.id }
        val google = doGoogle.filter { it.dia == Formato.iso(sel) }
        val itens = refeicoes.map { ItemDia(it.hora, "Refeição", it.nome, "≈ ${Formato.kcal(it.kcal)} kcal" + (it.descricao?.let { d -> " · $d" } ?: ""), Color(0xFFFFF1EA), Cores.ProteinaTinta) } +
            treinos.map { ItemDia(it.str("hora"), "Treino", it.str("nome") ?: "Treino", it.int("min")?.let { m -> "$m min" }, Color(0xFFEEFAF3), Cores.GorduraTinta) } +
            eventos.map { e -> val (f, t) = corDoTipo(e.tipo); ItemDia(e.hora, Evento.rotulo(e.tipo), e.titulo, e.nota, f, t, eventoId = e.id) } +
            google.map { g -> ItemDia(g.inicio, "Google", g.titulo, g.fim?.let { f -> "até $f" } ?: if (g.inicio == null) "o dia todo" else null, Color(0xFFE8F3FF), Color(0xFF1F4E8A)) }
        if (itens.isEmpty() && fixasDoDia.isEmpty()) Vazio(if (sel.isAfter(hoje)) "Nada marcado. Conte o que vem: jantar fora, viagem, festa." else "Dia livre: nada registrado.", Pose.DuplaDescansando)
        itens.sortedBy { it.hora ?: "99:99" }.forEach { e ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(e.hora ?: "—", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta2, modifier = Modifier.width(42.dp).padding(top = 14.dp))
                Cartao(Modifier.weight(1f), cor = e.fundo, forma = Formas.Cartao, padding = PaddingValues(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Pilula(e.tipo, Cores.Branco, e.tinta)
                        Spacer(Modifier.weight(1f))
                        if (e.eventoId != null) {
                            Box(
                                Modifier.size(48.dp).clip(Formas.Pilula).clickable(role = Role.Button, onClickLabel = "Apagar ${e.titulo}") { erroApagar = null; apagar = e.eventoId }
                                    .semantics { contentDescription = "Apagar ${e.titulo}" },
                                contentAlignment = Alignment.Center,
                            ) { Icon(icone("M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"), contentDescription = null, tint = e.tinta, modifier = Modifier.size(18.dp)) }
                        }
                    }
                    Text(e.titulo, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 4.dp))
                    e.sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 2) }
                }
            }
        }
        Text(
            if (doGoogle.isNotEmpty()) "A Nutri lê seus eventos e adapta as dicas. Os do Google só aparecem aqui; para mudar, use o Google Agenda."
            else "A Nutri lê seus eventos e adapta as dicas.",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4,
        )
    }

    if (novo) {
        FolhaNovoEvento(vm, perfil.id, Formato.iso(sel), aoFechar = { novo = false }) {
            novo = false
            vm.invalidar(perfil.id)
        }
    }
    val idApagar = apagar
    if (idApagar != null) {
        AlertDialog(
            onDismissRequest = { if (!apagando) apagar = null },
            containerColor = Cores.Branco,
            title = { Text("Apagar este evento?", style = MaterialTheme.typography.headlineSmall) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("A Nutri deixa de contar com ele.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                    erroApagar?.let { AvisoErro(it) }
                }
            },
            confirmButton = {
                Botao(if (apagando) "Apagando…" else "Apagar", habilitado = !apagando) {
                    escopo.launch {
                        apagando = true
                        try {
                            vm.escrever("DELETE", AppVM.rotaEvento(perfil.id, idApagar), null)
                            vm.invalidar(perfil.id)
                            apagar = null
                        } catch (e: ErroApi) {
                            erroApagar = if (e.semConexao) "Sem resposta do servidor. Tente de novo." else e.paraPessoa
                        } catch (e: CancellationException) {
                            throw e
                        } finally {
                            apagando = false
                        }
                    }
                }
            },
            dismissButton = { Botao("Cancelar", suave = true, habilitado = !apagando) { apagar = null } },
        )
    }
}

@Composable
private fun BotaoSetaAgenda(rotulo: String, giro: Float, habilitado: Boolean = true, aoTocar: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(Formas.Pilula).clickable(enabled = habilitado, role = Role.Button, onClickLabel = rotulo, onClick = aoTocar).semantics { contentDescription = rotulo },
        contentAlignment = Alignment.Center,
    ) { Icon(iconeSetaAgenda, contentDescription = null, tint = if (habilitado) Cores.AcaiEscuro else Cores.Cinza, modifier = Modifier.size(18.dp).rotate(giro)) }
}

/** Folha "Novo evento": título, tipo, o dia escolhido, hora e nota opcionais -> POST /perfis/:id/eventos. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun FolhaNovoEvento(vm: AppVM, perfilId: String, dia: String, aoFechar: () -> Unit, aoCriar: (Evento?) -> Unit) {
    val escopo = rememberCoroutineScope()
    val escrita by vm.escrita.collectAsStateWithLifecycle()
    var titulo by rememberSaveable { mutableStateOf("") }
    var tipo by rememberSaveable { mutableStateOf("comer_fora") }
    var hora by rememberSaveable { mutableStateOf("") }
    var nota by rememberSaveable { mutableStateOf("") }
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    fun criar() {
        val t = titulo.trim()
        if (t.isBlank()) { erro = "Dê um título ao evento (ex.: jantar na casa da Ana)."; return }
        if (t.length > 80) { erro = "O título pode ter até 80 caracteres."; return }
        if (hora.isNotBlank() && !Formato.horaValida(hora)) { erro = "A hora precisa estar no formato HH:MM."; return }
        if (nota.trim().length > 200) { erro = "A nota pode ter até 200 caracteres."; return }
        escopo.launch {
            enviando = true
            erro = null
            try {
                val corpo = JSONObject().put("dia", dia).put("titulo", t).put("tipo", tipo)
                if (hora.isNotBlank()) corpo.put("hora", hora.trim())
                if (nota.trim().isNotBlank()) corpo.put("nota", nota.trim())
                val j = vm.escrever("POST", "/perfis/$perfilId/eventos", corpo)
                aoCriar(j.obj("evento")?.let { Evento.de(it) })
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
            Text("Novo evento", style = MaterialTheme.typography.headlineMedium)
            Text(Formato.dia(dia)?.let { Formato.diaLongo(it) } ?: dia, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            if (enviando) {
                Esperando("Anotando na agenda…", escrita, Pose.LontraRelogio)
                return@Column
            }
            OutlinedTextField(titulo, { titulo = it.take(80) }, label = { Text("Título") }, placeholder = { Text("ex.: jantar fora com amigos") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text("Tipo", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Evento.tipos.forEach { (id, nome) -> Chip(nome, tipo == id) { tipo = id } }
            }
            OutlinedTextField(
                hora, { hora = it.take(5) }, label = { Text("Hora (opcional)") }, placeholder = { Text("HH:MM") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(170.dp),
                isError = hora.isNotBlank() && !Formato.horaValida(hora),
            )
            OutlinedTextField(nota, { nota = it.take(200) }, label = { Text("Nota (opcional)") }, placeholder = { Text("ex.: churrasco, vou tentar maneirar") }, minLines = 1, maxLines = 3, modifier = Modifier.fillMaxWidth())
            erro?.let { AvisoErro(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Botao("Cancelar", Modifier.weight(1f), suave = true) { aoFechar() }
                Botao("Criar", Modifier.weight(1f)) { criar() }
            }
        }
    }
}
