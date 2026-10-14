package br.nutribot.relogio.ui.telas

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Humor
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.MascoteHumor
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.componentes.tracejado
import br.nutribot.relogio.ui.componentes.sangrar
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
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

private val itensMenu = listOf(
    Triple(Rotas.PERFIL, "Perfil", "dados, objetivo e meta"),
    Triple(Rotas.AGENDA, "Agenda", "treinos e refeições por dia"),
    Triple(Rotas.RESUMOS, "Resumos", "semana (domingo) e mês (dia 1º)"),
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
                Vazio("Nenhum perfil liberado para este aparelho ainda.")
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

@Composable
private fun ConteudoHoje(vm: AppVM, j: JSONObject, perfil: Perfil, nav: (String) -> Unit) {
    val dia = Formato.dia(j.str("dia")) ?: java.time.LocalDate.now()
    val horaAgora = Formato.hora(j.str("agora"))
    val broto = j.obj("brotinho")
    val murcho = broto.bool("murcho") ?: false
    val brotoDias = broto.int("dias") ?: 0
    val kcal = j.obj("kcal")
    val situacao = kcal.str("situacao")

    // saudação e mascote
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("${Formato.saudacao(horaAgora)}, ${perfil.primeiroNome}", style = MaterialTheme.typography.headlineLarge)
            Text(
                Formato.diaLongo(dia) + (horaAgora?.let { " · $it" } ?: "") + (j.str("fuso")?.takeIf { it != perfil.fuso && perfil.fuso != null }?.let { " (fuso $it)" } ?: ""),
                style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3,
            )
        }
        MascoteHumor(if (murcho) Humor.Sonolento else Humor.Feliz, 70.dp)
    }

    // como você está? (humor, energia e sono de hoje, que a Nutri lê na conversa)
    CartaoHumor(vm, perfil.id, Formato.iso(dia), j.obj("humor"))

    // recados (avisos) em carrossel
    val avisos = j.arr("avisos").objs()
    if (avisos.isNotEmpty()) {
        val estado = rememberLazyListState()
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
                Cartao(Modifier.width(286.dp).heightIn(min = 96.dp), cor = fundo, forma = RoundedCornerShape(26.dp), padding = PaddingValues(start = 8.dp, end = 14.dp, top = 12.dp, bottom = 12.dp), atraso = i * 60, aoTocar = { nav(Rotas.NUTRI) }) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        when (tom) {
                            "bom" -> Mascote(Pose.LontraTrofeu, 64.dp)
                            "cuidado" -> Mascote(Pose.CorgiDormindo, 50.dp)
                            else -> Mascote(Pose.CorgiLupa, 62.dp)
                        }
                        Column(Modifier.weight(1f)) {
                            Pilula(rotulo, Cores.Branco, tinta)
                            a.str("titulo")?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontSize = 15.sp, modifier = Modifier.padding(top = 3.dp)) }
                            a.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFF3B3352), modifier = Modifier.padding(top = 2.dp)) }
                        }
                    }
                }
            }
        }
    }

    // anel de kcal com faixa da meta e banda de incerteza
    val consumido = kcal.num("consumido") ?: 0.0
    val faixa = kcal.obj("faixa")
    val fMin = faixa.num("min")
    val fMax = faixa.num("max")
    // kcal.err é a folga da incerteza da META (S-api §3), não da comida. A banda listrada em volta do consumido vem
    // da soma das faixas das refeições do dia (cada refeição traz faixa {min,max}); é a incerteza da estimativa.
    val folgaMeta = kcal.num("err")
    val refsDia = Refeicao.lista(j)
    val somaMin = refsDia.sumOf { it.faixaMin ?: it.kcal ?: 0.0 }
    val somaMax = refsDia.sumOf { it.faixaMax ?: it.kcal ?: 0.0 }
    val err = if (refsDia.isEmpty() || somaMax <= somaMin) null else maxOf(consumido - somaMin, somaMax - consumido)
    Cartao(forma = Formas.Grande, padding = PaddingValues(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            AnelKcal(consumido, fMin, fMax, err)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (fMin != null && fMax != null) {
                    Column {
                        Text("Restam", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                        Text("≈ ${Formato.kcal(max((fMin + fMax) / 2 - consumido, 0.0))} kcal", style = MaterialTheme.typography.headlineMedium)
                    }
                    Column {
                        Text("Faixa da meta", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                        Text("${Formato.kcal(fMin)}–${Formato.kcal(fMax)} kcal", style = MaterialTheme.typography.labelLarge)
                        if (folgaMeta != null && folgaMeta > 0) Text("folga ±${Formato.kcal(folgaMeta)} kcal", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp)
                    }
                } else {
                    Text("Ainda sem faixa de meta.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
                if (err != null && err > 0) Text("comida entre ${Formato.kcal(somaMin)} e ${Formato.kcal(somaMax)}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
                val (txt, fundo, tinta) = when (situacao) {
                    // situacao = julgamento da última semana de dias completos contra a meta (não o parcial de hoje)
                    "abaixo" -> Triple("semana abaixo da faixa", Color(0xFFFFE9D6), Color(0xFF8A4B12))
                    "dentro" -> Triple("semana na faixa", Color(0xFFDDF5E8), Cores.BomTinta)
                    "acima" -> Triple("semana acima da faixa", Cores.CuidadoFundo, Cores.CuidadoTinta)
                    else -> Triple("incerto: poucos dados", Cores.Trilho, Cores.LilasTexto)
                }
                Pilula(txt, fundo, tinta, ponto = true)
            }
        }
    }

    // macros (cores fixas)
    val macros = j.obj("macros")
    Cartao(atraso = 80) {
        Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
            // meta vem como {min,max} (proteína 1,6 a 2,2 g/kg) ou null (carbo e gordura: o bot não tem meta para eles)
            @Composable fun macro(nome: String, chave: String, cor: Color, trilho: Color, tinta: Color) {
                val m = macros.obj(chave)
                val metaObj = m.obj("meta")
                BarraMacro(nome, m.num("g"), metaObj.num("min") ?: m.num("meta"), cor, trilho, tinta, metaMax = metaObj.num("max"))
            }
            macro("Proteína", "proteina", Cores.Proteina, Cores.ProteinaTrilho, Cores.ProteinaTinta)
            macro("Carboidrato", "carbo", Cores.Carbo, Cores.CarboTrilho, Cores.CarboTinta)
            macro("Gordura", "gordura", Cores.Gordura, Cores.GorduraTrilho, Cores.GorduraTinta)
        }
    }

    // nota de energia
    j.obj("energia")?.let { CartaoEnergia(it) }

    // notas do dia em anéis
    NotasDoDia(j, consumido, fMin, fMax)

    // brotinho
    Cartao(cor = if (murcho) Color(0xFFFFF1E8) else Cores.BomFundo, padding = PaddingValues(start = 6.dp, end = 6.dp, top = 14.dp, bottom = 8.dp), atraso = 140) {
        Column(Modifier.padding(horizontal = 10.dp)) {
            Text(if (murcho) "O brotinho murchou um pouco" else "$brotoDias ${if (brotoDias == 1) "dia" else "dias"} regando o brotinho", style = MaterialTheme.typography.titleMedium, fontSize = 17.sp)
            Text(
                if (murcho) "Ficou um dia sem registro. Caju e Lia estão tristes: registre hoje pra ele se recuperar."
                else "Caju rega, Lia cuida: cada dia com as refeições registradas faz ele crescer.",
                style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2,
            )
        }
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Brotinho(brotoDias, murcho) }
    }

    // refeições do dia
    val refeicoes = Refeicao.lista(j)
    TituloSecao("Refeições") { Link("ver diário") { nav(Rotas.comida(Formato.iso(dia))) } }
    if (refeicoes.isEmpty()) Text("Nenhuma refeição registrada hoje ainda.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
    val escalaRef = max(1100.0, refeicoes.maxOfOrNull { it.faixaMax ?: it.kcal ?: 0.0 } ?: 0.0)
    refeicoes.forEachIndexed { i, r ->
        Cartao(forma = Formas.Cartao, padding = PaddingValues(12.dp), atraso = 160 + i * 40, aoTocar = { nav(Rotas.comida(Formato.iso(dia), r.id)) }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                IconePrato(r.slot)
                Column(Modifier.weight(1f)) {
                    Row {
                        Text(r.nome, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        r.hora?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3) }
                    }
                    Text(
                        "≈ ${Formato.kcal(r.kcal)} kcal" + (if (r.faixaMin != null && r.faixaMax != null) " (${Formato.kcal(r.faixaMin)}–${Formato.kcal(r.faixaMax)})" else ""),
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
    j.obj("resumoSemana").str("texto")?.let { texto ->
        Cartao(pincel = Brush.linearGradient(listOf(Cores.Trilho, Cores.BomFundo)), padding = PaddingValues(horizontal = 16.dp, vertical = 14.dp), atraso = 200, aoTocar = { nav(Rotas.RESUMOS) }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.DuplaProgresso, 54.dp)
                Column(Modifier.weight(1f)) {
                    Text("Resumo da semana", style = MaterialTheme.typography.titleMedium)
                    Text(texto, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
                Icon(icone("M9 5l7 7-7 7"), contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(20.dp))
            }
        }
    }

    // peso com mini gráfico
    j.obj("peso")?.let { peso -> CartaoPeso(peso) { nav(Rotas.PROGRESSO) } }

    // relógio: sono, passos, treino
    j.obj("relogio")?.let { r ->
        val treinos = r.arr("treinos").objs()
        val treino = treinos.firstOrNull()?.let { t ->
            listOfNotNull(t.str("nome"), t.int("min")?.let { "$it min" }, t.str("hora")?.let { "às $it" }).joinToString(" · ")
        } ?: "—"
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            listOf(
                Triple("Sono", Formato.sono(r.num("sonoMin")), Cores.Trilho),
                Triple("Passos", Formato.inteiro(r.num("passos")), Cores.BomFundo),
                Triple("Treino", treino, Cores.Pessego),
            ).forEach { (nome, valor, fundo) ->
                Column(Modifier.weight(1f).clip(RoundedCornerShape(22.dp)).background(fundo).padding(12.dp)) {
                    Text(nome, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, fontSize = 12.sp)
                    Text(valor, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = if (valor.length > 10) 14.sp else 18.sp)
                }
            }
        }
    }
    Spacer(Modifier.height(4.dp))
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
    Cartao(pincel = Brush.linearGradient(listOf(Color(0xFFFFF6DB), Color(0xFFFFE9F0))), forma = Formas.Grande, atraso = 80) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            AnelNumero(
                fracao = (total / 100).toFloat(), centro = nota?.let { Formato.inteiro(it) } ?: "—",
                selo = if (nota == null) null else if (boa) "ENERGIA ALTA" else if (media) "MODERADA" else "BAIXA",
                cor = cor, trilho = Color.White.copy(alpha = 0.8f), miolo = Color.White, tinta = tinta,
                rotulo = "Nota de energia ${nota?.let { Formato.inteiro(it) } ?: "sem dado"} de 100", tamanho = 120.dp, espessuraRel = 0.11f,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("Nota de energia", style = MaterialTheme.typography.titleLarge)
                listOf(Triple("Sono", "sono", Cores.LilasForte), Triple("Recuperação", "recuperacao", Cores.Gordura), Triple("Carga de ontem", "carga", Color(0xFFFFB59A))).forEach { (nome, chave, c) ->
                    val (v, txt) = parte(chave)
                    if (v != null || txt != null) {
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
            }
        }
        e.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A3B00), modifier = Modifier.padding(top = 12.dp)) }
    }
}

/**
 * Notas do dia: três anéis com o número no centro, todos tirados do /hoje (nenhuma nota inventada no app):
 * comida (kcal contra o meio da faixa), gasto (relógio contra o previsto) e treino (minutos de hoje).
 */
@Composable
private fun NotasDoDia(j: JSONObject, consumido: Double, fMin: Double?, fMax: Double?) {
    val r = j.obj("relogio")
    val gasto = r.num("gastoKcal")
    val previsto = r.num("gastoPrevisto")
    val treinos = r.arr("treinos").objs()
    val minTreino = treinos.sumOf { it.num("min") ?: 0.0 }
    if (fMin == null && gasto == null && treinos.isEmpty()) return
    Cartao(atraso = 100) {
        TituloSecao("Notas do dia")
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            if (fMin != null && fMax != null && fMin + fMax > 0) {
                val meio = (fMin + fMax) / 2
                val pct = (consumido / meio * 100)
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

/** peso: { atual, kgSemana, ic: {min,max}, veredito, texto } — mini gráfico da tendência com a faixa de 95%. */
@Composable
private fun CartaoPeso(peso: JSONObject, aoTocar: () -> Unit) {
    val k = peso.num("kgSemana")
    val ic = peso.obj("ic")
    Cartao(padding = PaddingValues(16.dp), atraso = 260, aoTocar = aoTocar) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Peso · tendência de 28 dias", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(Formato.decimal(peso.num("atual")), style = MaterialTheme.typography.headlineLarge, fontSize = 24.sp)
                    Text(" kg", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
                }
                Text(
                    k?.let { "${Formato.sinal(it)} kg/sem" + (if (ic != null) " (${Formato.sinal(ic.num("min"))} a ${Formato.sinal(ic.num("max"))})" else "") } ?: "tendência ainda incerta",
                    style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2,
                )
                peso.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.AcaiEscuro, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp)) }
            }
            if (k != null) {
                val f = animaAte(1f, 1200)
                Canvas(Modifier.size(130.dp, 56.dp)) {
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
            }
        }
    }
}
