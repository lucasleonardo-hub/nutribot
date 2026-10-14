package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.telas.comida.Slots
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import org.json.JSONObject

/*
 * "Próxima refeição" (fase 4): GET /perfis/:id/sugestao-refeicao →
 * { slot, nome, hora, restam, geradaEm, opcoes: [{ nome, porque, kcal, proteina, onde: casa|levar|fora, preparo }], levar, dica }.
 * A rota é cara (IA, até 1 min): a tela só busca como as outras; "outra ideia" é o único pedido forçado.
 */

/** O `onde` de uma opção como pílula: em casa (verde), levar (âmbar), fora (pêssego). */
private fun pilulaOnde(onde: String?): Triple<String, Color, Color>? = when (onde) {
    "casa" -> Triple("em casa", Cores.BomFundo, Cores.BomTinta)
    "levar" -> Triple("levar", Cores.AtencaoFundo, Cores.AtencaoTinta)
    "fora" -> Triple("fora", Cores.Pessego, Cores.CuidadoTinta)
    else -> null
}

@Composable
fun CartaoProximaRefeicao(vm: AppVM, perfilId: String) {
    val rota = AppVM.rotaSugestaoRefeicao(perfilId)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val j = carga.dados
    val erro = carga.erro
    Cartao(atraso = 40) {
        TituloSecao("Próxima refeição") {
            if (j != null && !carga.carregando) Link("outra ideia") { vm.carregar(rota, forcar = true) }
        }
        when {
            j == null && erro != null -> {
                Text(erro.paraPessoa, style = MaterialTheme.typography.bodySmall, color = Cores.CuidadoTinta, modifier = Modifier.padding(top = 6.dp))
                Botao("Tentar de novo", Modifier.padding(top = 8.dp), suave = true) { vm.carregar(rota, forcar = true) }
            }
            j == null -> Pensando()
            else -> {
                if (carga.carregando) Pensando(compacto = true)
                Sugestao(j)
            }
        }
    }
}

/** Enquanto a IA pensa: mascote e o aviso de que pode demorar. Compacto = só a linha, por cima da sugestão anterior. */
@Composable
private fun Pensando(compacto: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (!compacto) Mascote(Pose.LontraChef, 56.dp)
        CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Acai, strokeWidth = 2.dp)
        Column(Modifier.weight(1f)) {
            Text("Pensando na sua próxima refeição…", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
            if (!compacto) Text("Pode levar até 1 minuto.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
        }
    }
}

@Composable
private fun Sugestao(j: JSONObject) {
    val nome = j.str("nome") ?: Slots.rotulo(j.str("slot"))
    val cabecalho = listOfNotNull(nome, j.str("hora")?.let { Formato.hora(it) }, j.num("restam")?.let { "restam ≈ ${Formato.kcal(it)} kcal" }).joinToString(" · ")
    Text(cabecalho, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp))
    val opcoes = j.arr("opcoes").objs().take(3)
    // qual opção está com o preparo aberto (−1 = nenhuma); sobrevive à rotação
    var aberta by rememberSaveable { mutableIntStateOf(-1) }
    opcoes.forEachIndexed { i, o ->
        Column(Modifier.fillMaxWidth().padding(top = 10.dp).clip(Formas.Pequeno).background(Color(0xFFF9F7FF)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(o.str("nome") ?: "Opção ${i + 1}", style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, modifier = Modifier.weight(1f))
                pilulaOnde(o.str("onde"))?.let { (rot, fundo, tinta) -> Pilula(rot, fundo, tinta) }
            }
            val macro = listOfNotNull(o.num("kcal")?.let { "≈ ${Formato.kcal(it)} kcal" }, o.num("proteina")?.let { "${Formato.gramas(it)} g de proteína" }).joinToString(" · ")
            if (macro.isNotBlank()) Text(macro, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
            o.str("porque")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2) }
            o.str("preparo")?.let { preparo ->
                val estaAberta = aberta == i
                Box(
                    Modifier.heightIn(min = 48.dp).clip(Formas.Pilula)
                        .clickable(role = Role.Button, onClickLabel = if (estaAberta) "Esconder o preparo" else "Ver o preparo") { aberta = if (estaAberta) -1 else i }
                        .semantics { stateDescription = if (estaAberta) "aberto" else "fechado" }
                        .padding(horizontal = 6.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { Text(if (estaAberta) "ver menos" else "ver mais", color = Cores.AcaiEscuro, style = MaterialTheme.typography.labelLarge) }
                if (estaAberta) Text(preparo, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
            }
        }
    }
    j.str("levar")?.let { Text("Levar: $it", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 10.dp)) }
    j.str("dica")?.let { dica ->
        Row(Modifier.fillMaxWidth().padding(top = 10.dp).clip(Formas.Pequeno).background(Cores.Trilho).padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(dica, style = MaterialTheme.typography.bodySmall, color = Cores.LilasTexto)
        }
    }
}
