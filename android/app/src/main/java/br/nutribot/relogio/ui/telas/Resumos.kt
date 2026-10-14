package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.LinhaValor
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Segmentado
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import org.json.JSONObject

/**
 * /resumos (formato da frente S): { semana, mes, sequencia }, cada período
 * { de, ate, dias, diasComRegistro, diasComEstimativa, kcalMedia, proteinaMedia, metaProteina{min,max}, diasCompletos, diasProteinaBatida, peso{inicio{dia,peso}, fim{dia,peso}, variacao}, texto }.
 * "Mês" = os últimos 30 dias fechados. O texto que a IA escreve para os resumos fica no Drive e não vem.
 */
@Composable
fun TelaResumos(vm: AppVM, perfil: Perfil?, voltar: () -> Unit) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaResumos(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var aba by rememberSaveable { mutableIntStateOf(0) }
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            CabecalhoVoltar("Resumos", "${perfil.curto} · últimos 7 e 30 dias fechados", Pose.DuplaProgresso, voltar)
            Segmentado(listOf("Semana", "Mês (30 dias)"), aba, { aba = it }, Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp))
        },
    ) { j ->
        CartaoGraficoNutri(vm, perfil.id)
        val p = j.obj(if (aba == 0) "semana" else "mes")
        if (p == null) {
            Vazio("Ainda não há dados para este período.")
        } else {
            Periodo(p)
        }
        j.int("sequencia")?.let { s ->
            Cartao(cor = Cores.BomFundo) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Mascote(if (s >= 20) Pose.LontraTrofeu else Pose.DuplaFeliz, 56.dp)
                    Column {
                        Text("$s ${if (s == 1) "dia" else "dias"} seguidos com registro", style = MaterialTheme.typography.titleMedium)
                        Text("a sequência que rega o brotinho", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
                    }
                }
            }
        }
    }
}

@Composable
private fun Periodo(p: JSONObject) {
    val de = Formato.dia(p.str("de"))
    val ate = Formato.dia(p.str("ate"))
    val dias = p.int("dias")
    Cartao(pincel = Brush.linearGradient(listOf(Cores.Trilho, Cores.BomFundo))) {
        Text(if (de != null && ate != null) "${Formato.diaCurto(de)} a ${Formato.diaCurto(ate)}" else "Período", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3)
        p.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 4.dp)) }
    }
    Cartao(atraso = 60) {
        TituloSecao("Números")
        fun deDias(v: Int?) = if (v == null) "—" else if (dias != null) "$v de $dias" else "$v"
        LinhaValor("Dias com registro", deDias(p.int("diasComRegistro")))
        LinhaValor("Dias completos", deDias(p.int("diasCompletos")))
        LinhaValor("Dias com estimativa", deDias(p.int("diasComEstimativa")))
        LinhaValor("Média de calorias", p.num("kcalMedia")?.let { "${Formato.kcal(it)} kcal/dia" } ?: "—")
        val mp = p.obj("metaProteina")
        LinhaValor(
            "Proteína média",
            (p.num("proteinaMedia")?.let { "${Formato.gramas(it)} g/dia" } ?: "—") + (mp?.let { " (meta ${Formato.gramas(it.num("min"))}–${Formato.gramas(it.num("max"))} g)" } ?: ""),
        )
        LinhaValor("Dias com a proteína batida", deDias(p.int("diasProteinaBatida")))
    }
    p.obj("peso")?.let { w ->
        val ini = w.obj("inicio")
        val fim = w.obj("fim")
        Cartao(atraso = 100) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.CorgiBalanca, 56.dp)
                Column(Modifier.weight(1f)) {
                    Text("Peso no período", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${Formato.decimal(ini.num("peso"))} kg → ${Formato.decimal(fim.num("peso"))} kg" + (w.num("variacao")?.let { " (${Formato.sinal(it, 1)} kg)" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        listOfNotNull(Formato.dia(ini.str("dia"))?.let { Formato.diaCurto(it) }, Formato.dia(fim.str("dia"))?.let { Formato.diaCurto(it) }).joinToString(" a "),
                        style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3,
                    )
                }
            }
        }
    }
}
