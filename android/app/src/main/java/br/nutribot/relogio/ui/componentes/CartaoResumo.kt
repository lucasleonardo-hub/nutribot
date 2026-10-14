package br.nutribot.relogio.ui.componentes

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.ui.icone
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento

/*
 * Cartões de resumo do Hoje (fase 3, A1): fechados, todos têm a MESMA altura; tocar abre o detalhe no próprio cartão.
 * Cabeçalho = visual à esquerda (56 dp), título + valor + uma linha de resumo no meio, seta à direita (gira ao abrir).
 */

/** Padding igual em todos os cartões de resumo. */
val PaddingResumo = PaddingValues(16.dp)

/** Tamanho do visual à esquerda (anel pequeno, mascote, brotinho). */
val TamanhoVisual: Dp = 56.dp

/** Altura do cabeçalho (o conteúdo do cartão fechado): 80 dp, crescendo com a fonte do sistema até 1,3x para o texto não cortar. */
@Composable
fun alturaResumo(): Dp = 80.dp * LocalDensity.current.fontScale.coerceAtMost(1.3f)

private val seta = icone("M6 9l6 6 6-6")

/**
 * Cartão com cabeçalho de altura fixa e detalhe que abre ao tocar. O estado aberto/fechado sobrevive à rotação (chave = nome
 * do cartão). Sem animação quando a pessoa desligou as animações do sistema.
 */
@Composable
fun CartaoExpansivel(
    chave: String,
    modifier: Modifier = Modifier,
    cor: Color = Cores.Branco,
    pincel: Brush? = null,
    forma: Shape = Formas.Medio,
    atraso: Int = 0,
    cabecalho: @Composable RowScope.() -> Unit,
    detalhe: @Composable ColumnScope.() -> Unit,
) {
    // a chave entra como input (não como key): cada cartão tem o seu estado, que sobrevive à rotação e zera se a chave mudar
    var aberto by rememberSaveable(chave) { mutableStateOf(false) }
    val parado = LocalReduzirMovimento.current
    val giroAlvo = if (aberto) 180f else 0f
    val giro = if (parado) giroAlvo else animateFloatAsState(giroAlvo, label = "seta").value
    val altura = alturaResumo()
    Cartao(
        modifier.semantics { stateDescription = if (aberto) "aberto" else "fechado" },
        cor = cor,
        pincel = pincel,
        forma = forma,
        padding = PaddingResumo,
        atraso = atraso,
        aoTocar = { aberto = !aberto },
        rotuloToque = if (aberto) "Ver menos" else "Ver mais",
    ) {
        Row(Modifier.fillMaxWidth().height(altura), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            cabecalho()
            Icon(seta, contentDescription = null, tint = Cores.AcaiEscuro, modifier = Modifier.size(22.dp).rotate(giro))
        }
        if (parado) {
            if (aberto) Column(Modifier.padding(top = 12.dp), content = detalhe)
        } else {
            AnimatedVisibility(aberto, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Column(Modifier.padding(top = 12.dp), content = detalhe)
            }
        }
    }
}

/**
 * Cartão de resumo padrão: visual (56 dp) + título (1 linha) + valor principal (1 linha) + resumo (1 linha; 2 quando não há
 * valor) + seta. Nada de parágrafo fechado: o texto longo vai no detalhe.
 */
@Composable
fun CartaoResumo(
    chave: String,
    titulo: String,
    valor: String?,
    resumo: String?,
    modifier: Modifier = Modifier,
    cor: Color = Cores.Branco,
    pincel: Brush? = null,
    atraso: Int = 0,
    visual: @Composable () -> Unit,
    detalhe: @Composable ColumnScope.() -> Unit,
) {
    CartaoExpansivel(
        chave, modifier, cor = cor, pincel = pincel, atraso = atraso,
        cabecalho = {
            Box(Modifier.size(TamanhoVisual), contentAlignment = Alignment.Center) { visual() }
            Column(Modifier.weight(1f)) {
                Text(titulo, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (valor != null) Text(valor, style = MaterialTheme.typography.headlineMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (resumo != null) Text(resumo, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = if (valor == null) 2 else 1, overflow = TextOverflow.Ellipsis)
            }
        },
        detalhe = detalhe,
    )
}
