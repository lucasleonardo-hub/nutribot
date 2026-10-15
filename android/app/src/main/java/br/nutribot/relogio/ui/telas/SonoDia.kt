package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.BarraFase
import br.nutribot.relogio.ui.componentes.BarrasSemana
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.CartaoMedida
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.CoresFase
import br.nutribot.relogio.ui.componentes.GradeFatores
import br.nutribot.relogio.ui.componentes.Hipnograma
import br.nutribot.relogio.ui.componentes.LegendaTipica
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.NotaGrande
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.SeletorDia
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.duracaoCurta
import br.nutribot.relogio.ui.componentes.linhaDormiu
import br.nutribot.relogio.ui.componentes.semZap
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import org.json.JSONObject
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.roundToInt

/*
 * Tela do Sono (fase 6), dia navegável ‹ ›: GET /perfis/:id/sono?dia= →
 * { dia, nota, rotulo, variacao, inicio, fim, emCamaMin, dormidoMin, latenciaMin, fases{acordado,rem,leve,profundo:{min,pct}},
 *   tipicas{...:{min,max}}, etapas[{ini,fim,t}], fcMedia, fcMin, hrv, fatores[{id,nome,valor,nivel,explicacao}],
 *   semana[{dia,nota,dormidoMin}], texto }.
 * `dia` de uma noite = o dia em que a pessoa acordou. A folha antiga das 14 noites (Sono.kt) fica a um toque, no fim.
 */
@Composable
fun TelaSono(vm: AppVM, perfil: Perfil?, diaArg: String?, voltar: () -> Unit) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val hoje = remember(diaArg, perfil.fuso) { Formato.dia(diaArg) ?: Formato.hojeDe(null, perfil.fuso) }
    var diaStr by rememberSaveable(perfil.id) { mutableStateOf(Formato.iso(hoje)) }
    val dia = Formato.dia(diaStr) ?: hoje
    val minimo = hoje.minusDays(90)
    val rota = AppVM.rotaSono(perfil.id, diaStr)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var folha by rememberSaveable { mutableStateOf(false) }
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            CabecalhoVoltar("Sono", perfil.curto, null, voltar)
            SeletorDia(dia, hoje, minimo, { diaStr = Formato.iso(it) })
        },
    ) { j ->
        // a semana mostrada pode ir até 6 dias antes do limite de 90: esses dias o servidor recusa, então o toque não faz nada
        ConteudoSono(j, dia, aoEscolherDia = { d -> if (Formato.dia(d)?.isBefore(minimo) == false) diaStr = d }, aoVer14 = { folha = true })
    }
    if (folha) FolhaSono(vm, perfil.id, dia) { folha = false }
}

@Composable
private fun ConteudoSono(j: JSONObject, dia: LocalDate, aoEscolherDia: (String) -> Unit, aoVer14: () -> Unit) {
    val nota = j.num("nota")
    val dormido = j.num("dormidoMin")
    val semDado = nota == null && (dormido ?: 0.0) <= 0
    val inicio = j.str("inicio")
    val fim = j.str("fim")

    // nota grande, rótulo, variação e o horário
    Cartao(pincel = Brush.linearGradient(listOf(Cores.Trilho, Cores.Branco)), forma = Formas.Grande, padding = PaddingValues(18.dp)) {
        if (semDado) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.CorgiDormindo, 64.dp)
                Text("Sem sono registrado nesta noite.", style = MaterialTheme.typography.bodyLarge, color = Cores.Tinta2, modifier = Modifier.weight(1f))
            }
        } else {
            NotaGrande(nota, j.str("rotulo"), j.num("variacao"), nome = "Sono", pose = Pose.CorgiDormindo)
            linhaDormiu(dormido, inicio, fim)?.let { Text(it, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp)) }
            val cama = j.num("emCamaMin")
            if (cama != null && cama > 0) Text("na cama ${duracaoCurta(cama)}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            // com nota, a pílula e a linha "dormiu…" já dizem o que o texto do servidor diria
            if (nota == null) j.str("texto")?.let { semZap(it) }?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }

    // fatores da nota (tocar abre a explicação)
    val fatores = j.arr("fatores").objs()
    if (fatores.isNotEmpty()) {
        TituloSecao("Fatores")
        GradeFatores(fatores, "sono-${Formato.iso(dia)}")
    }

    // fases ao longo da noite e as barras de cada fase com a faixa típica
    if (!semDado) CartaoFases(j, inicio, fim)

    // batimento e VFC no sono
    val fc = j.num("fcMedia")
    val fcMin = j.num("fcMin")
    val hrv = j.num("hrv")
    if (fc != null || hrv != null) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (fc != null) CartaoMedida("FC no sono", "${Formato.inteiro(fc)} bpm", fcMin?.let { "mínima ${Formato.inteiro(it)} bpm" }, Modifier.weight(1f))
            if (hrv != null) CartaoMedida("VFC no sono", "${Formato.inteiro(hrv)} ms", "variação entre batimentos", Modifier.weight(1f))
        }
    }

    // os 7 dias até este (tocar escolhe o dia)
    val semana = j.arr("semana").objs().mapNotNull { s -> s.str("dia")?.let { d -> Triple(d, s.num("nota"), s.num("dormidoMin")) } }
    if (semana.isNotEmpty()) {
        Cartao(forma = Formas.Cartao) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Últimos 7 dias", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Link("14 noites", aoVer14)
            }
            BarrasSemana(
                semana.map { it.first to it.second }, Formato.iso(dia),
                descreverDia = { d, v ->
                    val dorm = semana.firstOrNull { it.first == d }?.third
                    (Formato.dia(d)?.let { Formato.diaLongo(it) } ?: d) + ": " + (v?.let { "nota ${Formato.inteiro(it)}" } ?: "sem nota") +
                        (dorm?.takeIf { it > 0 }?.let { ", dormiu ${duracaoCurta(it)}" } ?: "")
                },
                modifier = Modifier.padding(top = 8.dp),
                aoEscolher = aoEscolherDia,
            )
        }
    } else {
        Link("ver as últimas 14 noites", aoVer14)
    }
}

/** Fases da noite: o gráfico em degraus (quando o relógio mandou as etapas) e as barras de cada fase. */
@Composable
private fun CartaoFases(j: JSONObject, inicio: String?, fim: String?) {
    val fases = j.obj("fases")
    val tipicas = j.obj("tipicas")
    val etapas = j.arr("etapas").objs()
    val temFases = fases != null && CoresFase.ordem.any { (fases.obj(it).num("pct") ?: 0.0) > 0 }
    Cartao(forma = Formas.Cartao, atraso = 60) {
        Text("Fases da noite", style = MaterialTheme.typography.titleMedium)
        if (etapas.isNotEmpty()) {
            val desc = "Fases do sono" + (if (inicio != null && fim != null) " das $inicio às $fim" else "") +
                (if (temFases) ": " + CoresFase.ordem.joinToString(", ") { t -> "${CoresFase.nome(t).lowercase()} ${fases.obj(t).num("pct")?.roundToInt() ?: 0}%" } else "") + "."
            Hipnograma(etapas, inicio, fim, desc, Modifier.padding(top = 10.dp))
        } else {
            Text(if (temFases) "sem o gráfico da noite" else "fases não disponíveis nesta noite", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 4.dp))
        }
        if (temFases) {
            val escala = maxOf(60.0, CoresFase.ordem.maxOf { t -> max(fases.obj(t).num("pct") ?: 0.0, tipicas.obj(t).num("max") ?: 0.0) })
            Column(Modifier.fillMaxWidth().padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CoresFase.ordem.forEachIndexed { i, t ->
                    val f = fases.obj(t)
                    val tip = tipicas.obj(t)
                    BarraFase(t, f.num("pct"), f.num("min"), tip.num("min"), tip.num("max"), escala, atraso = 100 + i * 60)
                }
            }
            if (tipicas != null) LegendaTipica(Modifier.align(Alignment.End).padding(top = 8.dp))
        }
    }
}
