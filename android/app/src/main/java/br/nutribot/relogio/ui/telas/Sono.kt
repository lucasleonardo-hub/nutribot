package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.DiaSerie
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.animaAte
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import java.time.LocalDate

/** Cor da noite pela duração: menos de 6 h coral, 6 a 7 h âmbar, 7 h ou mais verde. */
private fun corDoSono(min: Double): Pair<Color, Color> = when {
    min < 6 * 60 -> Cores.Proteina to Cores.ProteinaTinta
    min < 7 * 60 -> Cores.Carbo to Cores.CarboTinta
    else -> Cores.Verde to Cores.GorduraTinta
}

/**
 * Folha do sono (fase 4): as últimas 14 noites do `/dias` em barras (uma por noite, cor pela faixa), a média da semana e,
 * da noite tocada, "deitou 23:40 · acordou 06:50". `hoje` = o dia da pessoa (o `dia` do /hoje).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolhaSono(vm: AppVM, perfilId: String, hoje: LocalDate, aoFechar: () -> Unit) {
    val de = hoje.minusDays(13)
    val rota = AppVM.rotaDias(perfilId, Formato.iso(de), Formato.iso(hoje))
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val lista = DiaSerie.lista(carga.dados)
    // uma posição por dia do intervalo, mesmo que o servidor pule algum
    val noites = (0..13).map { i -> val d = Formato.iso(de.plusDays(i.toLong())); d to lista.firstOrNull { it.dia == d } }
    val ultimaComSono = noites.indexOfLast { (it.second?.sonoMin ?: 0.0) > 0 }
    var selStr by rememberSaveable { mutableStateOf<String?>(null) }
    val sel = noites.indexOfFirst { it.first == selStr }.takeIf { it >= 0 } ?: ultimaComSono

    ModalBottomSheet(onDismissRequest = aoFechar, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Cores.Lavanda) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(start = 18.dp, end = 18.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Sono", style = MaterialTheme.typography.headlineMedium)
                    Text("últimas 14 noites", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
                Mascote(Pose.CorgiDormindo, 56.dp)
            }
            val erro = carga.erro
            when {
                carga.dados == null && erro != null -> {
                    Text(erro.paraPessoa, style = MaterialTheme.typography.bodyMedium, color = Cores.CuidadoTinta)
                    Link("tentar de novo") { vm.carregar(rota, forcar = true) }
                }
                carga.dados == null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Acai, strokeWidth = 2.dp)
                    Text(if (carga.acordando) "Acordando o servidor. Leva até 1 minuto." else "Buscando as noites…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                }
                ultimaComSono < 0 -> Text("Nenhuma noite registrada pelo relógio nestes 14 dias.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
                else -> {
                    val semana = noites.takeLast(7).mapNotNull { it.second?.sonoMin?.takeIf { m -> m > 0 } }
                    val media = if (semana.isEmpty()) null else semana.average()
                    val (fundoMedia, tintaMedia) = media?.let { corDoSono(it) } ?: (Cores.Trilho to Cores.LilasTexto)
                    Cartao {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Média da semana", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                                Text(Formato.sono(media), style = MaterialTheme.typography.headlineMedium)
                            }
                            Pilula("${semana.size} de 7 noites", fundoMedia, tintaMedia)
                        }
                        BarrasSono(noites, sel) { selStr = it }
                        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Pilula("< 6 h", Cores.ProteinaTrilho, Cores.ProteinaTinta)
                            Pilula("6 a 7 h", Cores.CarboTrilho, Cores.CarboTinta)
                            Pilula("7 h ou mais", Cores.GorduraTrilho, Cores.GorduraTinta)
                        }
                    }
                    noites.getOrNull(sel)?.let { (diaStr, d) ->
                        val dia = Formato.dia(diaStr)
                        val min = d?.sonoMin?.takeIf { it > 0 }
                        Cartao(atraso = 60) {
                            Text(dia?.let { Formato.diaLongo(it).replaceFirstChar { c -> c.uppercase() } } ?: diaStr, style = MaterialTheme.typography.titleMedium)
                            if (min == null) {
                                Text("Sem registro de sono nesta noite.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
                            } else {
                                val (_, tinta) = corDoSono(min)
                                Text(Formato.sono(min), style = MaterialTheme.typography.headlineMedium, color = tinta)
                                val ini = d.sonoInicio
                                val fim = d.sonoFim
                                if (ini != null || fim != null) {
                                    Text(listOfNotNull(ini?.let { "deitou $it" }, fim?.let { "acordou $it" }).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
                                }
                            }
                        }
                    }
                }
            }
            Botao("Fechar", Modifier.fillMaxWidth(), suave = true, aoTocar = aoFechar)
        }
    }
}

/** 14 colunas tocáveis (a coluna inteira é o alvo); a barra cresce de baixo; noite sem dado fica um traço cinza. */
@Composable
private fun BarrasSono(noites: List<Pair<String, DiaSerie?>>, sel: Int, aoEscolher: (String) -> Unit) {
    val f = animaAte(1f, 900)
    val alturaMax = 120.dp
    val teto = maxOf(9.0 * 60, noites.maxOfOrNull { it.second?.sonoMin ?: 0.0 } ?: 0.0)
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
        noites.forEachIndexed { i, (diaStr, d) ->
            val min = d?.sonoMin?.takeIf { it > 0 }
            val dia = Formato.dia(diaStr)
            val ativo = i == sel
            val rotulo = (dia?.let { Formato.diaLongo(it) } ?: diaStr) + ": " + (min?.let { Formato.sono(it) } ?: "sem registro")
            Column(
                Modifier.weight(1f).height(alturaMax + 48.dp).clip(Formas.Pequeno).background(if (ativo) Cores.Trilho else Color.Transparent)
                    .clickable(role = Role.RadioButton, onClickLabel = "Ver esta noite") { aoEscolher(diaStr) }
                    .semantics { selected = ativo; contentDescription = rotulo },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Bottom,
            ) {
                if (min == null) {
                    Box(Modifier.fillMaxWidth().padding(horizontal = 2.dp).height(3.dp).clip(Formas.Pilula).background(Cores.Cinza))
                } else {
                    val (cor, _) = corDoSono(min)
                    val h = alturaMax * (min / teto).toFloat().coerceIn(0.04f, 1f) * f
                    Box(Modifier.fillMaxWidth().padding(horizontal = 2.dp).height(h).clip(RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp, bottomStart = 3.dp, bottomEnd = 3.dp)).background(cor))
                }
                Text(
                    dia?.let { "${it.dayOfMonth}" } ?: "", fontFamily = Fredoka, fontWeight = if (ativo) FontWeight.W700 else FontWeight.W500, fontSize = 11.sp,
                    color = if (ativo) Cores.AcaiEscuro else Cores.Tinta3, modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
                )
            }
        }
    }
}
