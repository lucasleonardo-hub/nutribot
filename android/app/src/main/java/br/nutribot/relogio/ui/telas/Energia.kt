package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Color
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
import br.nutribot.relogio.ui.Rotas
import br.nutribot.relogio.ui.componentes.BarrasPartes
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.GradeFatores
import br.nutribot.relogio.ui.componentes.LinhaSemana
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.NotaGrande
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.SeletorDia
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.parteDe
import br.nutribot.relogio.ui.componentes.poseDaNota
import br.nutribot.relogio.ui.componentes.semZap
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import org.json.JSONObject
import java.time.LocalDate

/** Fundo do cartão da energia (o mesmo do Hoje): manteiga para rosa. */
internal val PincelEnergia = Brush.linearGradient(listOf(Color(0xFFFFF6DB), Color(0xFFFFE9F0)))

/** As três partes da nota de energia, com as cores de sempre. */
internal fun partesEnergia(p: JSONObject?): List<Triple<String, Double?, Color>> = listOf(
    Triple("Sono", parteDe(p, "sono"), Cores.LilasForte),
    Triple("Recuperação", parteDe(p, "recuperacao"), Cores.Gordura),
    Triple("Carga de ontem", parteDe(p, "carga"), Color(0xFFFFB59A)),
)

/*
 * Tela da Energia (fase 6), dia navegável ‹ ›: GET /perfis/:id/energia?dia= →
 * { dia, nota, rotulo, variacao, partes{sono,recuperacao,carga}, fatores[{id,nome,valor,nivel,explicacao}], semana[{dia,nota}], texto }.
 * A nota é a de sempre (sono, recuperação e a carga de ontem); os fatores explicam o que pesou.
 */
@Composable
fun TelaEnergia(vm: AppVM, perfil: Perfil?, diaArg: String?, voltar: () -> Unit, nav: (String) -> Unit) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val hoje = remember(diaArg, perfil.fuso) { Formato.dia(diaArg) ?: Formato.hojeDe(null, perfil.fuso) }
    var diaStr by rememberSaveable(perfil.id) { mutableStateOf(Formato.iso(hoje)) }
    val dia = Formato.dia(diaStr) ?: hoje
    val minimo = hoje.minusDays(90)
    val rota = AppVM.rotaEnergia(perfil.id, diaStr)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            CabecalhoVoltar("Energia", perfil.curto, null, voltar)
            SeletorDia(dia, hoje, minimo, { diaStr = Formato.iso(it) })
        },
    ) { j ->
        ConteudoEnergia(
            j, dia,
            // dias da semana antes do limite de 90 o servidor recusa: o toque não faz nada
            aoEscolherDia = { d -> if (Formato.dia(d)?.isBefore(minimo) == false) diaStr = d },
            aoVerSono = if (dia == hoje) ({ nav(Rotas.sono(Formato.iso(hoje))) }) else null,
        )
    }
}

@Composable
private fun ConteudoEnergia(j: JSONObject, dia: LocalDate, aoEscolherDia: (String) -> Unit, aoVerSono: (() -> Unit)?) {
    val nota = j.num("nota")
    Cartao(pincel = PincelEnergia, forma = Formas.Grande, padding = PaddingValues(18.dp)) {
        if (nota == null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.DuplaDescansando, 64.dp)
                Text("Sem nota de energia neste dia.", style = MaterialTheme.typography.bodyLarge, color = Cores.Tinta2, modifier = Modifier.weight(1f))
            }
        } else {
            NotaGrande(nota, j.str("rotulo"), j.num("variacao"), nome = "Energia", pose = poseDaNota(nota))
        }
        j.str("texto")?.let { semZap(it) }?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = Color(0xFF4A3B00), modifier = Modifier.padding(top = 10.dp))
        }
    }

    // as três partes da nota
    val partes = partesEnergia(j.obj("partes") ?: j)
    if (partes.any { it.second != null }) {
        Cartao(forma = Formas.Cartao, atraso = 40) {
            Text("De onde vem a nota", style = MaterialTheme.typography.titleMedium)
            BarrasPartes(partes, Modifier.padding(top = 10.dp))
        }
    }

    // fatores (tocar abre a explicação)
    val fatores = j.arr("fatores").objs()
    if (fatores.isNotEmpty()) {
        TituloSecao("Fatores")
        GradeFatores(fatores, "energia-${Formato.iso(dia)}")
    }

    // os 7 dias com o valor em cada ponto (tocar num dia o escolhe)
    val semana = j.arr("semana").objs().mapNotNull { s -> s.str("dia")?.let { it to s.num("nota") } }
    if (semana.isNotEmpty()) {
        val desc = "Energia dos últimos 7 dias: " + semana.joinToString(", ") { (d, v) ->
            (Formato.dia(d)?.let { Formato.semanaCurta(it) } ?: d) + " " + (v?.let { Formato.inteiro(it) } ?: "sem nota")
        }
        Cartao(forma = Formas.Cartao, atraso = 80) {
            Text("Últimos 7 dias", style = MaterialTheme.typography.titleMedium)
            LinhaSemana(semana, desc, Modifier.padding(top = 6.dp), selecionado = Formato.iso(dia), aoEscolher = aoEscolherDia)
        }
    }
    if (aoVerSono != null) Link("ver o sono desta noite", aoVerSono)
}
