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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
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
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cabecalho
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Segmentado
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
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

@Composable
fun TelaNutri(vm: AppVM, perfil: Perfil?) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaNutri(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var aba by rememberSaveable { mutableIntStateOf(0) }
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            Cabecalho("O que a Nutri sabe", "sobre ${perfil.curto} · o diário é do grupo todo", Pose.DuplaConferindo, 60.dp)
            Segmentado(listOf("Fatos", "Hipóteses", "Diário", "Avaliações"), aba, { aba = it }, Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp))
        },
    ) { j ->
        when (aba) {
            0 -> ListaItens(j.arr("fatos").objs(), "Nenhum fato guardado ainda.") { f ->
                f.str("texto") ?: f.str("campo") ?: ""
            }
            1 -> ListaItens(j.arr("hipoteses").objs(), "Nenhuma hipótese aberta.") { h ->
                h.str("texto") ?: ""
            }
            2 -> Diario(j)
            else -> ListaItens(j.arr("avaliacoes").objs(), "Nenhuma reflexão ou pensamento recente.") { a -> a.str("texto") ?: "" }
        }
        Text("Corrigir e apagar o que a Nutri sabe chega na próxima versão.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
    }
}

@Composable
private fun ListaItens(itens: List<JSONObject>, vazio: String, texto: (JSONObject) -> String) {
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
            Text(
                listOfNotNull(it.str("origem"), (it.str("dia")?.let { d -> quando(d) + (it.str("hora")?.let { h -> " $h" } ?: "") } ?: quando(it.str("atualizadoEm")))).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, fontSize = 11.sp, modifier = Modifier.padding(top = 6.dp),
            )
        }
    }
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
        Text("Nenhuma nota neste dia. A Nutri escreve à noite quando o grupo conversou.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
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
