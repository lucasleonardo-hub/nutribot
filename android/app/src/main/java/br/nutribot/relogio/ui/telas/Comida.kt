package br.nutribot.relogio.ui.telas

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
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
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cabecalho
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.componentes.tracejado
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import org.json.JSONObject
import java.time.LocalDate

/** Um dia de /refeicoes: { dia, completo, kcal, p, c, g, refeicoes: [Refeicao] } */
private data class DiaComida(val dia: LocalDate, val completo: Boolean, val kcal: Double?, val p: Double?, val c: Double?, val g: Double?, val refeicoes: List<Refeicao>)

private fun diasDe(j: JSONObject?): Map<LocalDate, DiaComida> = j.arr("dias").objs().mapNotNull { d ->
    val dia = Formato.dia(d.str("dia")) ?: return@mapNotNull null
    DiaComida(dia, d.bool("completo") ?: false, d.num("kcal"), d.num("p"), d.num("c"), d.num("g"), Refeicao.lista(d))
}.associateBy { it.dia }

private val iconeSeta = icone("M6 9l6 6 6-6")

@Composable
fun TelaComida(vm: AppVM, perfil: Perfil?, diaInicial: String?, refeicaoAberta: String?) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val ctx = LocalContext.current
    // "hoje" é o dia da pessoa (do /hoje guardado); sem ele, o do celular
    val hojeCarga by vm.carga(AppVM.rotaHoje(perfil.id)).collectAsStateWithLifecycle()
    LaunchedEffect(perfil.id) { vm.carregar(AppVM.rotaHoje(perfil.id)) }
    val hoje = Formato.hojeDe(hojeCarga.dados.str("dia"), perfil.fuso)
    var diaSel by rememberSaveable { mutableStateOf(diaInicial ?: Formato.iso(hoje)) }
    var fimSemana by rememberSaveable {
        val d = Formato.dia(diaInicial)
        mutableStateOf(Formato.iso(if (d != null && d.isBefore(hoje.minusDays(6))) d else hoje))
    }
    var aberta by rememberSaveable { mutableStateOf(refeicaoAberta) }
    // nunca pede "ate" depois do hoje da pessoa (o servidor responde 400 intervalo_invalido)
    val fim = minOf(Formato.dia(fimSemana) ?: hoje, hoje)
    val ini = fim.minusDays(6)
    val rota = AppVM.rotaRefeicoes(perfil.id, Formato.iso(ini), Formato.iso(fim))
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val dias = diasDe(carga.dados)
    val sel = minOf(Formato.dia(diaSel) ?: hoje, hoje)

    ConteudoCarga(
        carga,
        { vm.carregar(rota, forcar = true) },
        topo = {
            Cabecalho("Comida", "${perfil.curto} · diário por dia", Pose.DuplaCozinhando, 66.dp)
            SemanaTopo(ini, sel, hoje, dias, aoEscolher = { diaSel = Formato.iso(it) }, aoMudarSemana = { delta ->
                // o servidor recusa "ate" no futuro (400 intervalo_invalido): a semana nunca passa de hoje
                val novo = minOf(fim.plusDays(7L * delta), hoje)
                fimSemana = Formato.iso(novo)
                diaSel = Formato.iso(novo)
            })
        },
    ) { _ ->
        val d = dias[sel]
        val ehHoje = sel == hoje
        val kcalHoje = hojeCarga.dados.obj("kcal")
        val faixa = if (ehHoje) kcalHoje.obj("faixa") else null
        val total = d?.kcal ?: d?.refeicoes?.sumOf { it.kcal ?: 0.0 }
        Cartao(forma = Formas.Medio, padding = PaddingValues(horizontal = 16.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(if (ehHoje) "Hoje" else Formato.diaLongo(sel).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Text(
                    when { d == null -> "sem registro"; d.completo -> "dia completo"; else -> "dia incompleto" },
                    style = MaterialTheme.typography.labelMedium,
                    color = when { d == null -> Cores.Tinta3; d.completo -> Cores.BomTinta; else -> Cores.AtencaoTinta },
                )
            }
            Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 4.dp)) {
                Text("≈ ${Formato.kcal(total ?: 0.0)}", style = MaterialTheme.typography.displaySmall, fontSize = 28.sp)
                Text(
                    faixa?.let { f -> " de ${Formato.kcal(f.num("min"))}–${Formato.kcal(f.num("max"))} kcal" } ?: " kcal",
                    style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3,
                )
            }
            val fMax = faixa.num("max")
            val fMin = faixa.num("min")
            val escala = maxOf((fMax ?: total ?: 1.0) * 1.15, total ?: 0.0, 1.0)
            val f = animaAte(((total ?: 0.0) / escala).toFloat().coerceIn(0f, 1f), 900)
            Box(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp).height(12.dp).clip(Formas.Pilula).background(Cores.Trilho)) {
                if (fMin != null && fMax != null) Row(Modifier.fillMaxWidth()) {
                    Spacer(Modifier.weight((fMin / escala).toFloat().coerceAtLeast(0.001f)))
                    Box(Modifier.weight(((fMax - fMin) / escala).toFloat().coerceAtLeast(0.001f)).height(12.dp).background(Cores.MetaVerde))
                    Spacer(Modifier.weight((1 - fMax / escala).toFloat().coerceAtLeast(0.001f)))
                }
                Box(Modifier.fillMaxWidth(f).height(12.dp).clip(Formas.Pilula).background(Brush.horizontalGradient(listOf(Cores.LilasForte, Cores.Acai))))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    Triple("Proteína", d?.p ?: d?.refeicoes?.sumOf { it.p ?: 0.0 }, Cores.ProteinaTrilho to Cores.ProteinaTinta),
                    Triple("Carboidrato", d?.c ?: d?.refeicoes?.sumOf { it.c ?: 0.0 }, Cores.CarboTrilho to Cores.CarboTinta),
                    Triple("Gordura", d?.g ?: d?.refeicoes?.sumOf { it.g ?: 0.0 }, Cores.GorduraTrilho to Cores.GorduraTinta),
                ).forEach { (nome, g, cores) ->
                    Column(Modifier.weight(1f).clip(Formas.Pequeno).background(cores.first).padding(horizontal = 10.dp, vertical = 8.dp)) {
                        Text(nome, style = MaterialTheme.typography.labelSmall, color = cores.second)
                        Text("${Formato.gramas(g)} g", style = MaterialTheme.typography.titleMedium, fontSize = 17.sp)
                    }
                }
            }
        }

        val refeicoes = d?.refeicoes.orEmpty()
        if (refeicoes.isEmpty()) Vazio(if (ehHoje) "Nada registrado hoje ainda." else "Nenhuma refeição registrada neste dia.", Pose.LontraTriste)
        refeicoes.forEach { r ->
            LinhaDoTempo(r.hora) { CartaoRefeicao(r, r.id == aberta) { aberta = if (aberta == r.id) null else r.id } }
        }
        if (ehHoje) {
            hojeCarga.dados.arr("pendentes").objs().forEach { p ->
                LinhaDoTempo(null) {
                    Row(
                        Modifier.fillMaxWidth().tracejado().padding(start = 4.dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Mascote(Pose.LontraTriste, 56.dp)
                        Column(Modifier.weight(1f)) {
                            Text(p.str("nome") ?: p.str("slot") ?: "Refeição", style = MaterialTheme.typography.labelLarge, fontSize = 15.sp)
                            Text("ainda não registrado", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                        }
                        Box(
                            Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(14.dp)).background(Cores.AcaiEscuro)
                                .clickable(role = Role.Button) { Toast.makeText(ctx, "Registrar pelo app chega na próxima versão. Por enquanto, mande foto, texto ou áudio no WhatsApp.", Toast.LENGTH_LONG).show() }
                                .padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text("Registrar", color = Cores.Branco, style = MaterialTheme.typography.labelLarge, fontSize = 13.sp) }
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Cores.Branco).padding(start = 6.dp, end = 14.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Mascote(Pose.DuplaCelular, 54.dp)
            Text("Registre pelo WhatsApp (foto, texto ou áudio). Registrar e ajustar pelo app chega na próxima versão.", style = MaterialTheme.typography.bodySmall, color = Color(0xFF3B3352))
        }
    }
}

@Composable
private fun SemanaTopo(ini: LocalDate, sel: LocalDate, hoje: LocalDate, dias: Map<LocalDate, DiaComida>, aoEscolher: (LocalDate) -> Unit, aoMudarSemana: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        BotaoSeta("Semana anterior", 90f) { aoMudarSemana(-1) }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            for (i in 0..6) {
                val d = ini.plusDays(i.toLong())
                val ativo = d == sel
                val futuro = d.isAfter(hoje)
                val info = dias[d]
                val ponto = when { info == null -> Cores.Trilho; info.completo -> Cores.Verde; else -> Cores.Carbo }
                Column(
                    Modifier.weight(1f).heightIn(min = 60.dp).clip(Formas.Pequeno)
                        .background(if (ativo) Cores.Acai else Cores.Branco)
                        .let { if (d == hoje && !ativo) it.border(2.dp, Cores.LilasForte, Formas.Pequeno) else it }
                        .clickable(enabled = !futuro, role = Role.Tab) { aoEscolher(d) }
                        .semantics { contentDescription = Formato.diaLongo(d) + (info?.let { if (it.completo) ", completo" else ", incompleto" } ?: ", sem registro") }
                        .padding(vertical = 7.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(Formato.semanaCurta(d), fontSize = 11.sp, color = if (ativo) Cores.Branco.copy(alpha = 0.85f) else Cores.Tinta3)
                    Text("${d.dayOfMonth}", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 16.sp, color = if (ativo) Cores.Branco else if (futuro) Cores.Cinza else Cores.Tinta)
                    Box(Modifier.size(8.dp).clip(CircleShape).background(if (futuro) Color.Transparent else ponto))
                }
            }
        }
        BotaoSeta("Próxima semana", -90f, habilitado = ini.plusDays(6).isBefore(hoje)) { aoMudarSemana(1) }
    }
}

@Composable
private fun BotaoSeta(rotulo: String, giro: Float, habilitado: Boolean = true, aoTocar: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(Formas.Pilula).clickable(enabled = habilitado, role = Role.Button, onClickLabel = rotulo, onClick = aoTocar).semantics { contentDescription = rotulo },
        contentAlignment = Alignment.Center,
    ) { Icon(iconeSeta, contentDescription = null, tint = if (habilitado) Cores.AcaiEscuro else Cores.Cinza, modifier = Modifier.size(18.dp).rotate(giro)) }
}

/** Coluna da hora com o fio da linha do tempo à esquerda. */
@Composable
private fun LinhaDoTempo(hora: String?, conteudo: @Composable () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.width(42.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(hora ?: "—", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta2, modifier = Modifier.padding(top = 12.dp))
            Box(Modifier.padding(top = 4.dp).width(3.dp).height(40.dp).clip(Formas.Pilula).background(Cores.Lilas))
        }
        Box(Modifier.weight(1f)) { conteudo() }
    }
}

@Composable
private fun CartaoRefeicao(r: Refeicao, aberta: Boolean, aoTocar: () -> Unit) {
    val giro by animateFloatAsState(if (aberta) 180f else 0f, label = "giro")
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Cores.Branco).border(2.dp, if (aberta) Cores.LilasMedio else Color.Transparent, RoundedCornerShape(22.dp))) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (aberta) "Fechar detalhes" else "Ver detalhes", onClick = aoTocar).padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            IconePrato(r.slot, 52.dp)
            Column(Modifier.weight(1f)) {
                Row {
                    Text(r.nome, style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("≈ ${Formato.kcal(r.kcal)}", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 15.sp)
                }
                r.descricao?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp) }
                Text(
                    listOfNotNull(r.origem, if (r.faixaMin != null && r.faixaMax != null) "faixa ${Formato.kcal(r.faixaMin)}–${Formato.kcal(r.faixaMax)}" else null).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp,
                )
            }
            Icon(iconeSeta, contentDescription = null, tint = Cores.Acai, modifier = Modifier.size(18.dp).rotate(giro))
        }
        AnimatedVisibility(aberta, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(Triple("P", r.p, Cores.ProteinaTrilho to Cores.ProteinaTinta), Triple("C", r.c, Cores.CarboTrilho to Cores.CarboTinta), Triple("G", r.g, Cores.GorduraTrilho to Cores.GorduraTinta)).forEach { (l, v, c) ->
                        Row(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(c.first).padding(horizontal = 8.dp, vertical = 6.dp)) {
                            Text(l, color = c.second, style = MaterialTheme.typography.labelMedium)
                            Text(" ${Formato.gramas(v)} g", style = MaterialTheme.typography.bodySmall, fontSize = 12.sp)
                        }
                    }
                }
                if (r.descricao != null) Text(r.descricao, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
                val maxG = r.itens.mapNotNull { it.gramas }.maxOrNull()
                r.itens.forEach { it2 ->
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(it2.nome, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                            if (it2.gramas != null) Text("${Formato.gramas(it2.gramas)} g", fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 16.sp)
                            if (it2.kcal != null) Text(" · ${Formato.kcal(it2.kcal)} kcal", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
                        }
                        // barra em gramas só quando o servidor manda as gramas (fase 2); só leitura nesta versão
                        if (it2.gramas != null && maxG != null && maxG > 0) {
                            Box(Modifier.fillMaxWidth().height(10.dp).clip(Formas.Pilula).background(Cores.Trilho)) {
                                Box(Modifier.fillMaxWidth((it2.gramas / (maxG * 1.25)).toFloat().coerceIn(0.02f, 1f)).height(10.dp).clip(Formas.Pilula).background(Brush.horizontalGradient(listOf(Color(0xFFD9CEFA), Cores.LilasForte))))
                            }
                        }
                    }
                }
                if (r.itens.none { it.gramas != null }) {
                    Text(
                        "Ajuste por gramas chega na próxima versão. Por enquanto os itens vêm da descrição da refeição.",
                        style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A3B00),
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Cores.AtencaoFundo).padding(horizontal = 10.dp, vertical = 8.dp),
                    )
                }
            }
        }
    }
}
