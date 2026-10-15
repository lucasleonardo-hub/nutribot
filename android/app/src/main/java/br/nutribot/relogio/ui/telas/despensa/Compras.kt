package br.nutribot.relogio.ui.telas.despensa

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.dados.NotaCompra
import br.nutribot.relogio.dados.ResumoCompras
import br.nutribot.relogio.dados.dinheiro
import br.nutribot.relogio.dados.textoQuantidade
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento
import org.json.JSONObject

/*
 * Compras (fase 7, frente E; mapa W16): os cupons lidos nos últimos 28 dias, quanto foi gasto nos itens lidos, o que a
 * pessoa compra sempre e o que passou do prazo sem baixa. Ler um cupom novo continua em Integrações (o app abre a página
 * da SEFAZ no celular para pegar o texto da nota) ou pela foto no WhatsApp; os dois caem na mesma despensa.
 */

/** Aba Compras da Despensa. `j` = { notas, resumo } de GET /perfis/:id/compras?dias=28. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun AbaCompras(j: JSONObject) {
    val resumo = ResumoCompras.de(j)
    val notas = NotaCompra.lista(j).sortedByDescending { it.dia ?: "" }

    Cartao(pincel = Brush.linearGradient(listOf(Cores.Branco, Cores.BomFundo)), forma = Formas.Grande, padding = PaddingValues(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Últimos 28 dias", style = MaterialTheme.typography.titleMedium, color = Cores.Tinta3)
                Text(
                    when {
                        resumo.gasto != null -> dinheiro(resumo.gasto)
                        resumo.cupons == 0 -> "nenhum cupom"
                        else -> "sem preço nos cupons"
                    },
                    style = MaterialTheme.typography.headlineMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    when (resumo.cupons) {
                        0 -> "Leia um cupom para ver o gasto."
                        1 -> "em 1 cupom lido"
                        else -> "em ${resumo.cupons} cupons lidos"
                    },
                    style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2,
                )
            }
            Mascote(Pose.DuplaConferindo, 64.dp)
        }
        if (resumo.recorrentes.isNotEmpty()) {
            Text("Compra sempre", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 12.dp, bottom = 6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                resumo.recorrentes.forEach { Pilula(it, Cores.Branco, Cores.LilasTexto) }
            }
        }
        if (resumo.vencidos.isNotEmpty()) {
            Text("Passaram do prazo sem baixa", style = MaterialTheme.typography.labelLarge, color = Cores.CuidadoTinta, modifier = Modifier.padding(top = 12.dp))
            Text(resumo.vencidos.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
        }
    }

    // como ler um cupom novo (o envio pelo app precisa do texto da página da nota, que só a leitura em Integrações pega)
    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Mascote(Pose.CorgiLupa, 52.dp)
        Text(
            "Cupom novo: em Integrações, toque em Ler cupom. Ou mande a foto do cupom no WhatsApp. Os dois entram aqui.",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.weight(1f),
        )
    }

    TituloSecao("Cupons lidos")
    if (notas.isEmpty()) {
        Vazio("Nenhum cupom lido nos últimos 28 dias.", Pose.CorgiLupa)
    } else {
        notas.forEachIndexed { i, n -> CartaoNota(n, "${n.dia}|${n.loja}|$i") }
    }
}

/** Um cupom: loja, dia, total e número de itens; tocar abre a lista de itens. */
@Composable
private fun CartaoNota(n: NotaCompra, chave: String) {
    var aberto by rememberSaveable(chave) { mutableStateOf(false) }
    val parado = LocalReduzirMovimento.current
    val giroAlvo = if (aberto) 180f else 0f
    val giro = if (parado) giroAlvo else animateFloatAsState(giroAlvo, label = "setaCupom").value
    val sub = listOfNotNull(
        Formato.dia(n.dia)?.let { Formato.diaCurto(it) },
        if (n.itens.size == 1) "1 item" else "${n.itens.size} itens",
        n.total?.let { dinheiro(it) },
    ).joinToString(" · ")
    Cartao(
        Modifier.semantics { stateDescription = if (aberto) "aberto" else "fechado" },
        forma = Formas.Cartao, padding = PaddingValues(14.dp),
        aoTocar = { aberto = !aberto }, rotuloToque = if (aberto) "Fechar itens" else "Ver itens",
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(n.loja ?: "Mercado", style = MaterialTheme.typography.labelLarge, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, fontSize = 12.sp)
            }
            Icon(iconeSetaDespensa, contentDescription = null, tint = Cores.Acai, modifier = Modifier.size(18.dp).rotate(giro))
        }
        AnimatedVisibility(
            aberto,
            enter = if (parado) EnterTransition.None else fadeIn() + expandVertically(),
            exit = if (parado) ExitTransition.None else fadeOut() + shrinkVertically(),
        ) {
            Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (n.itens.isEmpty()) Text("Nenhum alimento neste cupom.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                n.itens.forEach { it2 ->
                    Row(verticalAlignment = Alignment.Top) {
                        Text(it2.item.replaceFirstChar { c -> c.uppercase() }, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(
                            listOfNotNull(textoQuantidade(it2.qtd, it2.unidade), it2.preco?.let { dinheiro(it) }).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                }
            }
        }
    }
}
