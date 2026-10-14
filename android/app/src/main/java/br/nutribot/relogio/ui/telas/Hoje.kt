package br.nutribot.relogio.ui.telas

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.Refeicao
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Carga
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.Rotas
import br.nutribot.relogio.ui.componentes.AnelKcal
import br.nutribot.relogio.ui.componentes.AnelNumero
import br.nutribot.relogio.ui.componentes.BarraFaixa
import br.nutribot.relogio.ui.componentes.BarraMacro
import br.nutribot.relogio.ui.componentes.Brotinho
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.CartaoResumo
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Humor
import br.nutribot.relogio.ui.componentes.LinhaValor
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.MascoteHumor
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TamanhoVisual
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.alturaResumo
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.componentes.sangrar
import br.nutribot.relogio.ui.componentes.semZap
import br.nutribot.relogio.ui.componentes.tracejado
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento
import org.json.JSONObject
import kotlin.math.max

private val coresPerfil = listOf(Color(0xFFC9B8FF), Color(0xFFFFC9B0), Color(0xFFB8EBD0), Color(0xFFFFE08A), Color(0xFFBFE0FF))

/** Cores do ícone de prato por slot (só enfeite; o mesmo esquema do protótipo). */
fun coresDoPrato(slot: String?): List<Color> = when (slot?.lowercase()) {
    "cafe", "café", "cafe_da_manha", "desjejum" -> listOf(Color(0xFFFFE3D3), Color(0xFFF4A261), Color(0xFFE9C46A), Color(0xFF8ECAE6))
    "almoco", "almoço" -> listOf(Color(0xFFE3F6EC), Color(0xFFE9C46A), Color(0xFF6A994E), Color(0xFFF4A261))
    "lanche", "lanche_tarde", "lanche_manha" -> listOf(Color(0xFFFFF4CC), Color(0xFFF4A261), Color(0xFFFFFFFF), Color(0xFFB5838D))
    "jantar" -> listOf(Color(0xFFEEE9FF), Color(0xFFB5838D), Color(0xFF6A994E), Color(0xFFE9C46A))
    else -> listOf(Color(0xFFFFF0F5), Color(0xFFFF8FB0), Color(0xFFE9C46A), Color(0xFF8ECAE6))
}

@Composable
fun IconePrato(slot: String?, tamanho: androidx.compose.ui.unit.Dp = 56.dp) {
    val c = coresDoPrato(slot)
    Box(Modifier.size(tamanho).clip(RoundedCornerShape(18.dp)).background(c[0]), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(tamanho * 0.6f)) {
            val s = size.minDimension / 40f
            drawCircle(Color.White, 15f * s, Offset(20f * s, 20f * s))
            drawCircle(c[1], 5f * s, Offset(15f * s, 17f * s))
            drawCircle(c[2], 4f * s, Offset(24f * s, 15f * s))
            drawCircle(c[3], 5.5f * s, Offset(23f * s, 25f * s))
        }
    }
}

private fun tomDe(tom: String?): Triple<String, Color, Color> = when (tom) {
    "bom" -> Triple("EVOLUINDO BEM", Cores.BomFundo, Cores.BomTinta)
    "cuidado" -> Triple("CUIDE DISSO", Cores.CuidadoFundo, Cores.CuidadoTinta)
    else -> Triple("ATENÇÃO", Cores.AtencaoFundo, Cores.AtencaoTinta)
}

/** A primeira frase de um texto (até o primeiro ponto, exclamação ou interrogação seguido de espaço). */
private fun primeiraFrase(texto: String): String = texto.trim().split(Regex("(?<=[.!?])\\s+")).firstOrNull()?.ifBlank { texto } ?: texto

private val itensMenu = listOf(
    Triple(Rotas.PERFIL, "Perfil", "dados, objetivo e meta"),
    Triple(Rotas.AGENDA, "Agenda", "treinos e refeições por dia"),
    Triple(Rotas.RESUMOS, "Resumos", "semana e mês"),
    Triple(Rotas.INTEGRACOES, "Integrações", "de onde vêm os dados"),
    Triple(Rotas.NUTRI, "O que a Nutri sabe", "fatos, diário, avaliações"),
)
private val iconesMenu = mapOf(
    Rotas.PERFIL to icone("M12 4a4 4 0 1 0 0.01 0Z", "M4 21a8 8 0 0 1 16 0"),
    Rotas.AGENDA to icone("M4 6h16v14H4z", "M4 10h16M9 3v4M15 3v4"),
    Rotas.RESUMOS to icone("M5 4h14v16H5z", "M9 9h6M9 13h6M9 17h3"),
    Rotas.INTEGRACOES to icone("M8 3v4M16 3v4M6 7h12v4a6 6 0 0 1-12 0z", "M12 17v4"),
    Rotas.NUTRI to icone("M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"),
)
private val fundosMenu = listOf(Color(0xFFF5F1FF), Color(0xFFFFF0F5), Color(0xFFE3F6EC), Color(0xFFEEFAF3), Color(0xFFFFF8E1))
private val tintasMenu = listOf(Cores.AcaiEscuro, Color(0xFF8A2448), Cores.BomTinta, Cores.GorduraTinta, Cores.AtencaoTinta)

/** Seletor dos perfis no topo do Hoje: tocar noutro troca; tocar no ativo abre o menu (Perfil, Agenda, Resumos, Integrações). */
@Composable
private fun SeletorPerfis(perfis: List<Perfil>, ativo: Perfil?, relogioEm: String?, aoEscolher: (String) -> Unit, nav: (String) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                perfis.forEachIndexed { i, p ->
                    val eAtivo = p.id == ativo?.id
                    Row(
                        Modifier.heightIn(min = 48.dp).clip(Formas.Pilula).background(if (eAtivo) Cores.Branco else Color.Transparent)
                            .clickable(role = Role.Button, onClickLabel = if (eAtivo) "Abrir menu" else "Ver ${p.curto}") {
                                if (eAtivo) menu = true else { aoEscolher(p.id); menu = false }
                            }
                            .padding(start = 5.dp, end = 12.dp, top = 5.dp, bottom = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(32.dp).clip(CircleShape).background(coresPerfil[i % coresPerfil.size]), contentAlignment = Alignment.Center) {
                            Text(p.inicial, fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, color = Cores.Tinta)
                        }
                        if (eAtivo || perfis.size <= 3) Text(p.curto, fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, maxLines = 1)
                        if (eAtivo) Icon(icone("M6 9l6 6 6-6"), contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(14.dp))
                    }
                }
            }
            if (relogioEm != null) {
                Row(
                    Modifier.minimumInteractiveComponentSize().clip(Formas.Pilula).background(Cores.BomFundo).clickable(role = Role.Button, onClickLabel = "Estado da sincronização") { nav(Rotas.INTEGRACOES) }.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(icone("M20 12a8 8 0 1 1-2.3-5.6", "M20 4v5h-5"), contentDescription = null, tint = Cores.BomTinta, modifier = Modifier.size(14.dp))
                    Text(relogioEm, color = Cores.BomTinta, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        if (menu) Popup(
            alignment = Alignment.TopStart,
            offset = with(LocalDensity.current) { IntOffset(14.dp.roundToPx(), 64.dp.roundToPx()) },
            onDismissRequest = { menu = false },
            properties = PopupProperties(focusable = true),
        ) {
            Column(
                Modifier.width(280.dp).shadow(20.dp, RoundedCornerShape(26.dp), spotColor = Color(0x385B3FC4)).clip(RoundedCornerShape(26.dp)).background(Cores.Branco).padding(8.dp),
            ) {
                itensMenu.forEachIndexed { i, (rota, nome, sub) ->
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(18.dp)).clickable(role = Role.Button) { menu = false; nav(rota) }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(Modifier.size(38.dp).clip(RoundedCornerShape(13.dp)).background(fundosMenu[i]), contentAlignment = Alignment.Center) {
                            Icon(iconesMenu[rota] ?: icone("M4 12h16"), contentDescription = null, tint = tintasMenu[i], modifier = Modifier.size(19.dp))
                        }
                        Column {
                            Text(nome, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp)
                            Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TelaHoje(vm: AppVM, perfisCarga: Carga, perfis: List<Perfil>, perfil: Perfil?, nav: (String) -> Unit) {
    if (perfil == null) {
        Column {
            SeletorPerfis(perfis, null, null, vm::escolherPerfil, nav)
            ConteudoCarga(perfisCarga, { vm.carregar(AppVM.ROTA_PERFIS, forcar = true) }) {
                Vazio("Nenhum perfil liberado para este celular.")
            }
        }
        return
    }
    val rota = AppVM.rotaHoje(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val relogioEm = carga.dados.obj("relogio").str("atualizadoEm")?.let { Formato.instante(it)?.let { i -> Formato.ha(i) } }

    ConteudoCarga(
        carga,
        aoRecarregar = { vm.carregar(rota, forcar = true) },
        topo = { SeletorPerfis(perfis, perfil, relogioEm, vm::escolherPerfil, nav) },
    ) { j -> ConteudoHoje(vm, j, perfil, nav) }
}

/**
 * Ordem do Hoje (fase 5): saudação → Como você está? → Calorias (o cartão-herói) → recados (carrossel) → Macros → Energia →
 * Notas → Brotinho → Refeições → Resumo da semana → Peso → relógio. Os cartões de resumo têm a mesma altura fechados.
 */
@Composable
private fun ConteudoHoje(vm: AppVM, j: JSONObject, perfil: Perfil, nav: (String) -> Unit) {
    val dia = Formato.dia(j.str("dia")) ?: java.time.LocalDate.now()
    val horaAgora = Formato.hora(j.str("agora"))
    val broto = j.obj("brotinho")
    val murcho = broto.bool("murcho") ?: false
    val brotoDias = broto.int("dias") ?: 0
    val kcal = j.obj("kcal")

    // saudação e mascote
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("${Formato.saudacao(horaAgora)}, ${perfil.primeiroNome}", style = MaterialTheme.typography.headlineLarge)
            Text(
                Formato.diaLongo(dia) + (horaAgora?.let { " · $it" } ?: "") + (j.str("fuso")?.takeIf { it != perfil.fuso && perfil.fuso != null }?.let { " · fuso $it" } ?: ""),
                style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3,
            )
        }
        MascoteHumor(if (murcho) Humor.Sonolento else Humor.Feliz, 70.dp)
    }

    // como você está? (humor, energia e sono de hoje, que a Nutri lê na conversa)
    // Fase 4: respondeu, o cartão grande some e fica a linha pequena; "mudar" (ou mexer no cartão) mantém o cartão aberto hoje
    val humorJ = j.obj("humor")
    var editandoHumor by rememberSaveable(Formato.iso(dia)) { mutableStateOf(false) }
    if (humorJ.int("humor") != null && !editandoHumor) {
        LinhaHumor(humorJ) { editandoHumor = true }
    } else {
        CartaoHumor(vm, perfil.id, Formato.iso(dia), humorJ, aoTocar = { editandoHumor = true }, aoFechar = { editandoHumor = false })
    }

    // calorias: o cartão-herói do Hoje (anel grande com o número no centro)
    val consumido = kcal.num("consumido") ?: 0.0
    val faixa = kcal.obj("faixa")
    val fMin = faixa.num("min")
    val fMax = faixa.num("max")
    val refsDia = Refeicao.lista(j)
    CartaoCalorias(kcal, consumido, fMin, fMax, refsDia)

    // recados (avisos): até 3, em carrossel horizontal; tocar mostra o texto inteiro logo abaixo (fase 5)
    Recados(j.arr("avisos").objs().take(3), nav)

    // macros (cores fixas)
    CartaoMacros(j.obj("macros"))

    // nota de energia
    j.obj("energia")?.let { CartaoEnergia(it) }

    // notas do dia em anéis
    NotasDoDia(j, consumido, fMin, fMax)

    // brotinho
    CartaoBrotinho(brotoDias, murcho)

    // refeições do dia (lista de linhas compactas; não é cartão de resumo)
    val refeicoes = refsDia
    TituloSecao("Refeições") { Link("ver diário") { nav(Rotas.comida(Formato.iso(dia))) } }
    if (refeicoes.isEmpty()) Text("Nada registrado hoje ainda.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
    val escalaRef = max(1100.0, refeicoes.maxOfOrNull { it.faixaMax ?: it.kcal ?: 0.0 } ?: 0.0)
    refeicoes.forEachIndexed { i, r ->
        Cartao(forma = Formas.Cartao, padding = PaddingValues(12.dp), atraso = 160 + i * 40, aoTocar = { nav(Rotas.comida(Formato.iso(dia), r.id)) }, rotuloToque = "Abrir ${r.nome}") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                IconePrato(r.slot)
                Column(Modifier.weight(1f)) {
                    Row {
                        Text(r.nome, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        r.hora?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3) }
                    }
                    Text(
                        "≈ ${Formato.kcal(r.kcal)} kcal" + (if (r.faixaMin != null && r.faixaMax != null) " · ${Formato.kcal(r.faixaMin)} a ${Formato.kcal(r.faixaMax)}" else ""),
                        style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp, bottom = 6.dp),
                    )
                    BarraFaixa(r.kcal, r.faixaMin, r.faixaMax, escalaRef)
                }
            }
        }
    }
    // pendentes
    j.arr("pendentes").objs().forEach { p ->
        Row(
            Modifier.fillMaxWidth().tracejado().clip(RoundedCornerShape(24.dp)).clickable(role = Role.Button) { nav(Rotas.comida(Formato.iso(dia))) }.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(32.dp).clip(CircleShape).background(Cores.Trilho), contentAlignment = Alignment.Center) {
                Icon(icone("M12 5v14M5 12h14"), contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(16.dp))
            }
            Text("${p.str("nome") ?: p.str("slot") ?: "Refeição"} ainda não registrado", color = Cores.AcaiEscuro, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp)
        }
    }

    // resumo da semana
    j.obj("resumoSemana").str("texto")?.let { semZap(it) }?.takeIf { it.isNotBlank() }?.let { texto ->
        CartaoResumo(
            "resumoSemana", "Resumo da semana", valor = null, resumo = primeiraFrase(texto),
            pincel = Brush.linearGradient(listOf(Cores.Trilho, Cores.BomFundo)), atraso = 200,
            visual = { Mascote(Pose.DuplaProgresso, TamanhoVisual) },
        ) {
            Text(texto, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
            Link("ver resumos") { nav(Rotas.RESUMOS) }
        }
    }

    // peso com mini gráfico
    j.obj("peso")?.let { peso -> CartaoPeso(peso) { nav(Rotas.PROGRESSO) } }

    // relógio: sono, passos, treino (três blocos pequenos, da mesma altura entre si); o Sono abre a folha das 14 noites (fase 4)
    var mostrarSono by rememberSaveable { mutableStateOf(false) }
    j.obj("relogio")?.let { r ->
        val treinos = r.arr("treinos").objs()
        val treino = treinos.firstOrNull()?.let { t ->
            listOfNotNull(t.str("nome"), t.int("min")?.let { "$it min" }, t.str("hora")?.let { "às $it" }).joinToString(" · ")
        } ?: "—"
        val alturaBloco = 72.dp * LocalDensity.current.fontScale.coerceAtMost(1.3f)
        val sonoTxt = Formato.sono(r.num("sonoMin"))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(
                Triple("Sono", sonoTxt, Cores.Trilho),
                Triple("Passos", Formato.inteiro(r.num("passos")), Cores.BomFundo),
                Triple("Treino", treino, Cores.Pessego),
            ).forEach { (nome, valor, fundo) ->
                val tocavel = nome == "Sono"
                Column(
                    Modifier.weight(1f).height(alturaBloco).clip(RoundedCornerShape(22.dp)).background(fundo)
                        .let { m -> if (tocavel) m.clickable(role = Role.Button, onClickLabel = "Ver as últimas noites") { mostrarSono = true }.semantics { contentDescription = "Sono $sonoTxt. Toque para ver as últimas noites." } else m }
                        .padding(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(nome, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        if (tocavel) Icon(icone("M9 6l6 6-6 6"), contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(14.dp))
                    }
                    Text(valor, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = if (valor.length > 10) 14.sp else 18.sp)
                }
            }
        }
    }
    if (mostrarSono) FolhaSono(vm, perfil.id, dia) { mostrarSono = false }
    Spacer(Modifier.height(4.dp))
}

/**
 * Calorias: kcal.err é a margem da incerteza da META (S-api §3), não da comida. A estimativa da comida (min–max) vem da soma
 * das faixas das refeições do dia; é a banda listrada do anel.
 */
@Composable
private fun CartaoCalorias(kcal: JSONObject?, consumido: Double, fMin: Double?, fMax: Double?, refsDia: List<Refeicao>) {
    val folgaMeta = kcal.num("err")
    val situacao = kcal.str("situacao")
    val somaMin = refsDia.sumOf { it.faixaMin ?: it.kcal ?: 0.0 }
    val somaMax = refsDia.sumOf { it.faixaMax ?: it.kcal ?: 0.0 }
    val err = if (refsDia.isEmpty() || somaMax <= somaMin) null else maxOf(consumido - somaMin, somaMax - consumido)
    val temFaixa = fMin != null && fMax != null
    val (txtSemana, fundoSemana, tintaSemana) = when (situacao) {
        // situacao = julgamento da última semana de dias completos contra a meta (não o parcial de hoje)
        "abaixo" -> Triple("semana abaixo da faixa", Color(0xFFFFE9D6), Color(0xFF8A4B12))
        "dentro" -> Triple("semana na faixa", Color(0xFFDDF5E8), Cores.BomTinta)
        "acima" -> Triple("semana acima da faixa", Cores.CuidadoFundo, Cores.CuidadoTinta)
        else -> Triple("poucos dados", Cores.Trilho, Cores.LilasTexto)
    }
    // fase 5: o cartão-herói do Hoje. Anel grande com o número no centro; à direita o que resta, a faixa e a semana;
    // "ver mais" abre a margem da meta, a estimativa da comida e o resto.
    var aberto by rememberSaveable("calorias") { mutableStateOf(false) }
    val parado = LocalReduzirMovimento.current
    val giroAlvo = if (aberto) 180f else 0f
    val giro = if (parado) giroAlvo else animateFloatAsState(giroAlvo, label = "setaCalorias").value
    val restam = if (temFaixa) max((fMin!! + fMax!!) / 2 - consumido, 0.0) else null
    val tamanhoAnel = 150.dp * LocalDensity.current.fontScale.coerceAtMost(1.2f)
    Cartao(
        Modifier.semantics { stateDescription = if (aberto) "aberto" else "fechado" },
        pincel = Brush.linearGradient(listOf(Cores.Branco, Cores.Trilho)),
        forma = Formas.Grande, padding = PaddingValues(18.dp), atraso = 60,
        aoTocar = { aberto = !aberto }, rotuloToque = if (aberto) "Ver menos" else "Ver mais",
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            AnelKcal(
                consumido, fMin, fMax, err, tamanho = tamanhoAnel, mostrarCentro = true,
                legenda = if (temFaixa) "de ${Formato.kcal(fMin)}–${Formato.kcal(fMax)}" else "kcal comidas",
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Calorias", style = MaterialTheme.typography.titleMedium, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (restam != null) {
                    Text("restam", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    Text("≈ ${Formato.kcal(restam)} kcal", style = MaterialTheme.typography.headlineMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("meta ${Formato.kcal(fMin)}–${Formato.kcal(fMax)} kcal", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 2)
                } else {
                    Text("${Formato.kcal(consumido)} kcal", style = MaterialTheme.typography.headlineMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("sem faixa de meta ainda", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 2)
                }
                Pilula(txtSemana, fundoSemana, tintaSemana, ponto = true)
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (aberto) "ver menos" else "ver mais", style = MaterialTheme.typography.labelLarge, color = Cores.AcaiEscuro, modifier = Modifier.weight(1f))
            Icon(icone("M6 9l6 6 6-6"), contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(20.dp).rotate(giro))
        }
        val detalhe: @Composable ColumnScope.() -> Unit = {
            if (temFaixa) LinhaValor("Faixa da meta", "${Formato.kcal(fMin)}–${Formato.kcal(fMax)} kcal")
            if (folgaMeta != null && folgaMeta > 0) LinhaValor("Margem da meta", "±${Formato.kcal(folgaMeta)} kcal")
            if (err != null && err > 0) LinhaValor("Estimativa da comida", "${Formato.kcal(somaMin)} a ${Formato.kcal(somaMax)} kcal")
            LinhaValor("Comidas hoje", "${Formato.kcal(consumido)} kcal")
            if (refsDia.isNotEmpty()) LinhaValor("Refeições", "${refsDia.size}")
            Text(
                "A faixa é a meta do dia; a margem é a incerteza dela. A estimativa vem das faixas das refeições registradas.",
                style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (parado) {
            if (aberto) Column(Modifier.padding(top = 6.dp), content = detalhe)
        } else {
            AnimatedVisibility(aberto, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Column(Modifier.padding(top = 6.dp), content = detalhe)
            }
        }
    }
}

/**
 * Recados da Nutri (fase 5): carrossel horizontal (cartões de 286 dp, altura padrão, de borda a borda) e, logo abaixo,
 * o detalhe do recado tocado num cartão da cor do tom. Tocar de novo no mesmo recado fecha o detalhe.
 */
@Composable
private fun Recados(avisos: List<JSONObject>, nav: (String) -> Unit) {
    if (avisos.isEmpty()) return
    var escolhido by rememberSaveable { mutableIntStateOf(-1) }
    if (escolhido >= avisos.size) escolhido = -1
    val estado = rememberLazyListState()
    val alturaRecado = alturaResumo()
    val parado = LocalReduzirMovimento.current
    LazyRow(
        state = estado,
        flingBehavior = rememberSnapFlingBehavior(estado),
        contentPadding = PaddingValues(horizontal = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.sangrar(18.dp).semantics { contentDescription = "Recados da Nutri" },
    ) {
        itemsIndexed(avisos) { i, a ->
            val tom = a.str("tom")
            val (rotulo, fundo, tinta) = tomDe(tom)
            val titulo = a.str("titulo")?.let { semZap(it) }?.takeIf { it.isNotBlank() }
            val texto = a.str("texto")?.let { semZap(it) }?.takeIf { it.isNotBlank() }
            val ativo = escolhido == i
            Cartao(
                Modifier.width(286.dp).semantics { selected = ativo },
                cor = fundo, forma = RoundedCornerShape(26.dp),
                padding = PaddingValues(start = 8.dp, end = 14.dp, top = 12.dp, bottom = 12.dp), atraso = 40 + i * 40,
                aoTocar = { escolhido = if (ativo) -1 else i }, rotuloToque = if (ativo) "Fechar o recado" else "Ler o recado inteiro",
            ) {
                Row(Modifier.height(alturaRecado), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(TamanhoVisual), contentAlignment = Alignment.Center) {
                        when (tom) {
                            "bom" -> Mascote(Pose.LontraTrofeu, TamanhoVisual)
                            "cuidado" -> Mascote(Pose.CorgiDormindo, 48.dp)
                            else -> Mascote(Pose.CorgiLupa, TamanhoVisual)
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Pilula(rotulo, Cores.Branco, tinta)
                        titulo?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp)) }
                        texto?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFF3B3352), maxLines = if (titulo == null) 2 else 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp)) }
                    }
                }
            }
        }
    }
    val detalhe: @Composable () -> Unit = {
        val a = avisos[escolhido.coerceIn(0, avisos.size - 1)]
        val (rotulo, fundo, tinta) = tomDe(a.str("tom"))
        val titulo = a.str("titulo")?.let { semZap(it) }?.takeIf { it.isNotBlank() }
        val texto = a.str("texto")?.let { semZap(it) }?.takeIf { it.isNotBlank() }
        Cartao(cor = fundo, forma = RoundedCornerShape(26.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Pilula(rotulo, Cores.Branco, tinta)
                Spacer(Modifier.weight(1f))
                Link("fechar") { escolhido = -1 }
            }
            titulo?.let { Text(it, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp)) }
            Text(texto ?: "Sem mais detalhes.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2, modifier = Modifier.padding(top = 4.dp))
            Link("ver mais na Nutri") { nav(Rotas.NUTRI) }
        }
    }
    if (parado) {
        if (escolhido >= 0) detalhe()
    } else {
        AnimatedVisibility(escolhido >= 0, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) { detalhe() }
    }
}

/** Macros: três mini-barras no cabeçalho; as barras completas (com meta) no detalhe. */
@Composable
private fun CartaoMacros(macros: JSONObject?) {
    data class Macro(val nome: String, val g: Double?, val meta: Double?, val metaMax: Double?, val cor: Color, val trilho: Color, val tinta: Color)
    fun macro(nome: String, chave: String, cor: Color, trilho: Color, tinta: Color): Macro {
        val m = macros.obj(chave)
        // meta vem como {min,max} (proteína 1,6 a 2,2 g/kg) ou null (carbo e gordura: o bot não tem meta para eles)
        val metaObj = m.obj("meta")
        return Macro(nome, m.num("g"), metaObj.num("min") ?: m.num("meta"), metaObj.num("max"), cor, trilho, tinta)
    }
    val lista = listOf(
        macro("Proteína", "proteina", Cores.Proteina, Cores.ProteinaTrilho, Cores.ProteinaTinta),
        macro("Carboidrato", "carbo", Cores.Carbo, Cores.CarboTrilho, Cores.CarboTinta),
        macro("Gordura", "gordura", Cores.Gordura, Cores.GorduraTrilho, Cores.GorduraTinta),
    )
    val p = lista[0]
    val resumo = listOfNotNull(
        p.meta?.let { "meta ${Formato.gramas(it)}${p.metaMax?.let { mx -> "–${Formato.gramas(mx)}" } ?: ""} g" },
        "carbo ${Formato.gramas(lista[1].g)} g",
        "gordura ${Formato.gramas(lista[2].g)} g",
    ).joinToString(" · ")
    CartaoResumo(
        "macros", "Macros", "${Formato.gramas(p.g)} g de proteína", resumo, atraso = 80,
        visual = {
            Column(Modifier.size(TamanhoVisual), verticalArrangement = Arrangement.SpaceEvenly) {
                lista.forEach { m ->
                    val alvo = if (m.g == null || m.meta == null || m.meta <= 0) (if ((m.g ?: 0.0) > 0) 1f else 0f) else (m.g / m.meta).toFloat().coerceIn(0f, 1f)
                    val f = animaAte(alvo, 900, 200)
                    Box(Modifier.fillMaxWidth().height(10.dp).clip(Formas.Pilula).background(m.trilho)) {
                        Box(Modifier.fillMaxWidth(f).height(10.dp).clip(Formas.Pilula).background(m.cor))
                    }
                }
            }
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
            lista.forEach { m -> BarraMacro(m.nome, m.g, m.meta, m.cor, m.trilho, m.tinta, metaMax = m.metaMax) }
        }
    }
}

/** energia: { nota, sono, recuperacao, carga, texto } — sono/recuperacao/carga podem vir como número (0–100) ou objeto { nota, texto }. */
@Composable
private fun CartaoEnergia(e: JSONObject) {
    val nota = e.num("nota")
    fun parte(chave: String): Pair<Double?, String?> {
        val o = e.obj(chave)
        return if (o != null) (o.num("nota", "valor", "pct") to o.str("texto", "rotulo")) else (e.num(chave) to null)
    }
    val total = nota ?: 0.0
    val boa = total >= 75
    val media = total >= 60
    val tinta = if (boa) Cores.GorduraTinta else if (media) Cores.CarboTinta else Cores.ProteinaTinta
    val cor = if (boa) Cores.Verde else if (media) Color(0xFFFFC23D) else Cores.Proteina
    val partes = listOf(Triple("Sono", "sono", Cores.LilasForte), Triple("Recuperação", "recuperacao", Cores.Gordura), Triple("Carga de ontem", "carga", Color(0xFFFFB59A)))
        .map { (nome, chave, c) -> val (v, txt) = parte(chave); Triple(nome, v to txt, c) }
        .filter { it.second.first != null || it.second.second != null }
    val resumo = partes.joinToString(" · ") { (nome, vt, _) -> "${nome.substringBefore(" ").lowercase()} ${vt.second ?: vt.first?.let { Formato.inteiro(it) } ?: ""}" }.ifBlank { "sem detalhes hoje" }
    val valor = nota?.let { "${Formato.inteiro(it)} de 100" + (if (boa) " · alta" else if (media) " · moderada" else " · baixa") } ?: "sem nota"
    CartaoResumo(
        "energia", "Energia", valor, resumo,
        pincel = Brush.linearGradient(listOf(Color(0xFFFFF6DB), Color(0xFFFFE9F0))), atraso = 100,
        visual = {
            AnelNumero(
                fracao = (total / 100).toFloat(), centro = nota?.let { Formato.inteiro(it) } ?: "—", selo = null,
                cor = cor, trilho = Color.White.copy(alpha = 0.8f), miolo = Color.White, tinta = tinta,
                rotulo = "Nota de energia ${nota?.let { Formato.inteiro(it) } ?: "sem dado"} de 100", tamanho = TamanhoVisual, espessuraRel = 0.14f,
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            partes.forEach { (nome, vt, c) ->
                val (v, txt) = vt
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row {
                        Text(nome, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                        Text(txt ?: v?.let { Formato.inteiro(it) } ?: "", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp)
                    }
                    val f = animaAte(((v ?: 0.0) / 100).toFloat().coerceIn(0f, 1f), 900, 200)
                    Box(Modifier.fillMaxWidth().height(8.dp).clip(Formas.Pilula).background(Color.White)) {
                        Box(Modifier.fillMaxWidth(f).height(8.dp).clip(Formas.Pilula).background(c))
                    }
                }
            }
        }
        e.str("texto")?.let { semZap(it) }?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A3B00), modifier = Modifier.padding(top = 10.dp)) }
    }
}

/**
 * Notas do dia: três anéis com o número no centro, todos tirados do /hoje (nenhuma nota inventada no app):
 * comida (kcal contra o meio da faixa), gasto (relógio contra o previsto) e treino (minutos de hoje).
 * No cabeçalho: "Comida 85%" e "gasto 1.900 kcal · treino 45 min"; os anéis ficam no detalhe.
 */
@Composable
private fun NotasDoDia(j: JSONObject, consumido: Double, fMin: Double?, fMax: Double?) {
    val r = j.obj("relogio")
    val gasto = r.num("gastoKcal")
    val previsto = r.num("gastoPrevisto")
    val treinos = r.arr("treinos").objs()
    val minTreino = treinos.sumOf { it.num("min") ?: 0.0 }
    if (fMin == null && gasto == null && treinos.isEmpty()) return
    val temComida = fMin != null && fMax != null && fMin + fMax > 0
    val meio = if (temComida) (fMin!! + fMax!!) / 2 else 0.0
    val pct = if (temComida) consumido / meio * 100 else 0.0
    val partes = listOfNotNull(
        if (temComida) "Comida ${Formato.inteiro(pct)}%" else null,
        gasto?.let { "Gasto ${Formato.kcal(it)} kcal" },
        "Treino ${Formato.inteiro(minTreino)} min",
    )
    CartaoResumo(
        "notas", "Notas do dia", partes.first(), partes.drop(1).joinToString(" · ").lowercase().ifBlank { null }, atraso = 120,
        visual = {
            if (temComida) AnelNumero((pct / 100).toFloat().coerceIn(0f, 1f), "${Formato.inteiro(pct)}%", null, Cores.Acai, Color(0xFFF3EEFF), Color(0xFFF7F3FF), Cores.AcaiEscuro, "Comida ${Formato.inteiro(pct)}% da meta", TamanhoVisual, espessuraRel = 0.14f)
            else if (gasto != null) AnelNumero(if (previsto != null && previsto > 0) (gasto / previsto).toFloat().coerceIn(0f, 1f) else 1f, Formato.kcal(gasto), null, Cores.Proteina, Color(0xFFFFF1E8), Color(0xFFFFF8F2), Cores.ProteinaTinta, "Gasto ${Formato.kcal(gasto)} kcal", TamanhoVisual, espessuraRel = 0.14f)
            else AnelNumero(if (minTreino > 0) 1f else 0f, Formato.inteiro(minTreino), null, Cores.Verde, Cores.BomFundo, Color(0xFFF2FBF5), Cores.GorduraTinta, "Treino ${Formato.inteiro(minTreino)} min", TamanhoVisual, espessuraRel = 0.14f)
        },
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            if (temComida) {
                NotaAnel(
                    "Comida", pct.toFloat() / 100f, "${Formato.inteiro(pct)}%", "DA META",
                    "${Formato.kcal(consumido)} de ~${Formato.kcal(meio)} kcal",
                    Cores.Acai, Cores.LilasMedio, Color(0xFFF3EEFF), Color(0xFFF7F3FF), Cores.AcaiEscuro,
                )
            }
            if (gasto != null) {
                val f = if (previsto != null && previsto > 0) (gasto / previsto).toFloat() else 1f
                NotaAnel(
                    "Gasto", f, Formato.kcal(gasto), "KCAL",
                    previsto?.let { "de ~${Formato.kcal(it)} previstas · saldo ${Formato.sinal(consumido - gasto, 0)}" } ?: "até agora",
                    Cores.Proteina, Cores.Carbo, Color(0xFFFFF1E8), Color(0xFFFFF8F2), Cores.ProteinaTinta,
                )
            }
            NotaAnel(
                "Treino", if (minTreino > 0) 1f else 0f, if (minTreino > 0) Formato.inteiro(minTreino) else "0", "MIN",
                if (treinos.isEmpty()) "sem treino hoje" else treinos.firstOrNull()?.str("nome") ?: "treino",
                Cores.Verde, Cores.Verde, Cores.BomFundo, Color(0xFFF2FBF5), Cores.GorduraTinta,
            )
        }
    }
}

@Composable
private fun NotaAnel(nome: String, f: Float, centro: String, selo: String, sub: String, cor: Color, cor2: Color, trilho: Color, miolo: Color, tinta: Color) {
    Column(Modifier.width(100.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        AnelNumero(f.coerceIn(0f, 1f), centro, selo, cor, trilho, miolo, tinta, "$nome: $centro $selo, $sub", 92.dp, fracao2 = if (f > 1f) 1f else null, cor2 = cor2)
        Text(nome, style = MaterialTheme.typography.labelLarge, fontSize = 13.sp)
        Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 11.sp, lineHeight = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** Brotinho: o vaso pequeno no cabeçalho, os dias como valor; o desenho inteiro (com Caju e Lia) no detalhe. */
@Composable
private fun CartaoBrotinho(dias: Int, murcho: Boolean) {
    val explicacao = if (murcho) "Um dia sem registro. Registre hoje e ele se recupera." else "Cada dia registrado faz ele crescer."
    CartaoResumo(
        "brotinho", if (murcho) "Brotinho murcho" else "Brotinho",
        "$dias ${if (dias == 1) "dia" else "dias"}", if (murcho) "um dia sem registro" else "regando todo dia",
        cor = if (murcho) Color(0xFFFFF1E8) else Cores.BomFundo, atraso = 140,
        visual = { Brotinho(dias, murcho, escala = 0.37f, soVaso = true) },
    ) {
        Text(explicacao, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
        Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) { Brotinho(dias, murcho) }
    }
}

/** peso: { atual, kgSemana, ic: {min,max}, veredito, texto } — valor e tendência no cabeçalho; mini gráfico, faixa e texto no detalhe. */
@Composable
private fun CartaoPeso(peso: JSONObject, aoVerProgresso: () -> Unit) {
    val k = peso.num("kgSemana")
    val ic = peso.obj("ic")
    CartaoResumo(
        "peso", "Peso", "${Formato.decimal(peso.num("atual"))} kg",
        k?.let { "${Formato.sinal(it)} kg/sem · 28 dias" } ?: "tendência ainda incerta", atraso = 260,
        visual = { Mascote(Pose.CorgiBalanca, TamanhoVisual) },
    ) {
        if (k != null) {
            val f = animaAte(1f, 1200)
            Canvas(Modifier.fillMaxWidth().height(56.dp).semantics { contentDescription = "Tendência de ${Formato.sinal(k)} kg por semana" }) {
                // inclinação em 4 semanas: a linha sobe/desce pelo kg/sem; a faixa abre com o IC nas pontas
                val meioY = size.height / 2
                val escala = size.height / 2 / maxOf(0.6, kotlin.math.abs((ic.num("max") ?: k) * 4), kotlin.math.abs((ic.num("min") ?: k) * 4)).toFloat()
                fun y(kg: Double, t: Float) = meioY - (kg * 4 * (t - 0.5f)).toFloat() * escala
                val lo = ic.num("min") ?: k
                val hi = ic.num("max") ?: k
                val banda = Path().apply {
                    moveTo(0f, y(hi, 0f)); lineTo(size.width, y(hi, 1f)); lineTo(size.width, y(lo, 1f)); lineTo(0f, y(lo, 0f)); close()
                }
                drawPath(banda, Cores.Lilas)
                drawLine(Cores.Acai, Offset(0f, y(k, 0f)), Offset(size.width * f, y(k, f)), strokeWidth = 3.dp.toPx(), cap = StrokeCap.Round)
            }
            if (ic != null) LinhaValor("Faixa de 95%", "${Formato.sinal(ic.num("min"))} a ${Formato.sinal(ic.num("max"))} kg/sem")
        }
        peso.str("texto")?.let { semZap(it) }?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.AcaiEscuro, modifier = Modifier.padding(top = 4.dp)) }
        Link("ver progresso", aoVerProgresso)
    }
}
