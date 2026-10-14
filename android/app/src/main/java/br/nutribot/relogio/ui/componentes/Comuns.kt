package br.nutribot.relogio.ui.componentes

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.layout.layout
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.ui.Carga
import br.nutribot.relogio.ui.Escrita
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento
import org.json.JSONObject

/** Cartão arredondado que sobe e aparece ao entrar (sem animação com "remover animações"). */
@Composable
fun Cartao(
    modifier: Modifier = Modifier,
    cor: Color = Cores.Branco,
    pincel: Brush? = null,
    forma: Shape = Formas.Medio,
    padding: PaddingValues = PaddingValues(16.dp),
    atraso: Int = 0,
    aoTocar: (() -> Unit)? = null,
    rotuloToque: String? = null,
    conteudo: @Composable ColumnScope.() -> Unit,
) {
    val parado = LocalReduzirMovimento.current
    val anim = remember { Animatable(if (parado) 1f else 0f) }
    LaunchedEffect(Unit) { if (!parado) anim.animateTo(1f, tween(450, delayMillis = atraso, easing = FastOutSlowInEasing)) }
    var m = modifier
        .graphicsLayer {
            alpha = anim.value
            translationY = (1f - anim.value) * 10f * density
        }
        .clip(forma)
        .let { if (pincel != null) it.background(pincel) else it.background(cor) }
    if (aoTocar != null) m = m.clickable(role = Role.Button, onClickLabel = rotuloToque, onClick = aoTocar)
    Column(m.padding(padding), content = conteudo)
}

/** Pílula de texto (veredito, tom, estado). */
@Composable
fun Pilula(texto: String, fundo: Color, tinta: Color, modifier: Modifier = Modifier, ponto: Boolean = false) {
    Row(
        modifier.clip(Formas.Pilula).background(fundo).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (ponto) Box(Modifier.size(8.dp).clip(CircleShape).background(tinta))
        Text(texto, color = tinta, style = MaterialTheme.typography.labelMedium)
    }
}

/** Cabeçalho das telas: título em Fredoka, subtítulo, e mascote à direita. */
@Composable
fun Cabecalho(titulo: String, sub: String?, pose: Pose? = null, alturaMascote: Dp = 64.dp, acao: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        acao?.invoke()
        Column(Modifier.weight(1f)) {
            Text(titulo, style = MaterialTheme.typography.headlineLarge)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        }
        if (pose != null) Mascote(pose, alturaMascote)
    }
}

@Composable
fun TituloSecao(texto: String, modifier: Modifier = Modifier, direita: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(texto, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        direita?.invoke()
    }
}

@Composable
fun Link(texto: String, aoTocar: () -> Unit) {
    Text(
        texto,
        color = Cores.AcaiEscuro,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier.minimumInteractiveComponentSize().clip(Formas.Pilula).clickable(role = Role.Button, onClick = aoTocar).padding(horizontal = 6.dp, vertical = 8.dp),
    )
}

/** Botão em pílula (açaí escuro) ou suave. */
@Composable
fun Botao(texto: String, modifier: Modifier = Modifier, suave: Boolean = false, habilitado: Boolean = true, aoTocar: () -> Unit) {
    val fundo = when {
        !habilitado -> Cores.Trilho
        suave -> Cores.Trilho
        else -> Cores.AcaiEscuro
    }
    val tinta = when {
        !habilitado -> Cores.Tinta4
        suave -> Cores.LilasTexto
        else -> Cores.Branco
    }
    Box(
        modifier.heightIn(min = 48.dp).clip(Formas.Pequeno).background(fundo).clickable(enabled = habilitado, role = Role.Button, onClick = aoTocar).padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(texto, color = tinta, fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 15.sp)
    }
}

/** Barra de macro: nome colorido, atual / meta g, barra que enche. */
@Composable
fun BarraMacro(nome: String, atual: Double?, meta: Double?, cor: Color, trilho: Color, tinta: Color, metaMax: Double? = null) {
    val parado = LocalReduzirMovimento.current
    val alvo = if (atual == null || meta == null || meta <= 0) (if ((atual ?: 0.0) > 0) 1f else 0f) else (atual / meta).toFloat().coerceIn(0f, 1f)
    val anim = remember { Animatable(if (parado) alvo else 0f) }
    LaunchedEffect(alvo) { if (parado) anim.snapTo(alvo) else anim.animateTo(alvo, tween(900, delayMillis = 200, easing = FastOutSlowInEasing)) }
    Column(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(Modifier.fillMaxWidth()) {
            Text(nome, color = tinta, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            Text(
                Formato.gramas(atual) + when {
                    meta != null && metaMax != null && metaMax > meta -> " / ${Formato.gramas(meta)}–${Formato.gramas(metaMax)} g"
                    meta != null -> " / ${Formato.gramas(meta)} g"
                    else -> " g · sem meta"
                },
                style = MaterialTheme.typography.bodySmall,
                color = Cores.Tinta3,
            )
        }
        Box(Modifier.fillMaxWidth().height(12.dp).clip(Formas.Pilula).background(trilho)) {
            Box(Modifier.fillMaxWidth(anim.value).height(12.dp).clip(Formas.Pilula).background(cor))
        }
    }
}

/** A faixa (assinatura): trilho, faixa listrada min–max e o ponto do valor. escala = valor do fim da barra. */
@Composable
fun BarraFaixa(valor: Double?, min: Double?, max: Double?, escala: Double, modifier: Modifier = Modifier, altura: Dp = 6.dp, corFaixa: Color = Cores.LilasMedio, corPonto: Color = Cores.Acai) {
    BoxWithConstraints(modifier.fillMaxWidth().height(altura + 6.dp)) {
        val w = maxWidth
        fun pos(v: Double) = w * (v / escala).toFloat().coerceIn(0f, 1f)
        Box(Modifier.align(Alignment.CenterStart).fillMaxWidth().height(altura).clip(Formas.Pilula).background(Cores.Trilho))
        if (min != null && max != null && max > min) {
            Box(Modifier.align(Alignment.CenterStart).offset(x = pos(min)).width(pos(max) - pos(min)).height(altura).clip(Formas.Pilula).background(corFaixa))
        }
        if (valor != null) {
            val d = altura + 6.dp
            Box(Modifier.align(Alignment.CenterStart).offset(x = pos(valor) - d / 2).size(d).clip(CircleShape).background(Cores.Branco).padding(2.dp).clip(CircleShape).background(corPonto))
        }
    }
}

/** Esqueleto pulsando enquanto carrega (sem cache). */
@Composable
fun Esqueleto(modifier: Modifier = Modifier, blocos: List<Dp> = listOf(180.dp, 96.dp, 140.dp, 72.dp, 72.dp)) {
    val parado = LocalReduzirMovimento.current
    // o valor animado só é lido no graphicsLayer (fase de desenho), para não recompor a cada quadro
    val a: State<Float> = if (parado) remember { mutableFloatStateOf(0.7f) } else {
        val t = rememberInfiniteTransition(label = "esqueleto")
        t.animateFloat(0.45f, 0.9f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "pulsa")
    }
    Column(modifier.fillMaxWidth().padding(horizontal = 18.dp).semantics { contentDescription = "Carregando" }, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        blocos.forEach { h -> Box(Modifier.fillMaxWidth().height(h).graphicsLayer { alpha = a.value }.clip(Formas.Medio).background(Cores.Branco)) }
    }
}

/** Faixa no topo: "acordando o servidor" (Render grátis) ou "mostrando dados de há X". */
@Composable
fun FaixaEstado(carga: Carga) {
    AnimatedVisibility(carga.acordando || (carga.erro != null && carga.dados != null) || (carga.carregando && carga.dados != null), enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        val (fundo, tinta, texto) = when {
            carga.acordando -> Triple(Cores.AtencaoFundo, Cores.AtencaoTinta, "Acordando o servidor. Leva até 1 minuto." + (carga.salvoEm?.let { " Mostrando dados de ${Formato.haMs(it)}." } ?: ""))
            carga.erro != null -> Triple(Cores.CuidadoFundo, Cores.CuidadoTinta, carga.erro.paraPessoa + (carga.salvoEm?.let { " Mostrando dados de ${Formato.haMs(it)}." } ?: ""))
            else -> Triple(Cores.Trilho, Cores.LilasTexto, "Atualizando…")
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 4.dp).clip(Formas.Pequeno).background(fundo).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (carga.carregando) CircularProgressIndicator(Modifier.size(16.dp), color = tinta, strokeWidth = 2.dp)
            Text(texto, color = tinta, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Erro sem nada guardado: mascote, explicação e ação. */
@Composable
fun ErroComAcao(texto: String, acao: String = "Tentar de novo", aoTocar: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Mascote(Pose.LontraTriste, 110.dp)
        Text(texto, style = MaterialTheme.typography.bodyLarge, color = Cores.Tinta2)
        Botao(acao, aoTocar = aoTocar)
    }
}

/** Estado vazio (sem dados ainda). */
@Composable
fun Vazio(texto: String, pose: Pose = Pose.DuplaDescansando, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Mascote(pose, 90.dp)
        Text(texto, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
    }
}

/** Acordando sem cache: mascote e a explicação, em vez de um esqueleto que parece travado. */
@Composable
private fun AcordandoSemCache() {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Mascote(Pose.DuplaDescansando, 100.dp)
        Text("Acordando o servidor…", style = MaterialTheme.typography.titleLarge)
        Text("Leva até 1 minuto. Já já aparece.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
        CircularProgressIndicator(color = Cores.Acai)
    }
}

/**
 * Corpo padrão das telas que leem uma rota: puxar para atualizar, faixa de estado, esqueleto, erro com ação, e o conteúdo
 * (com o cache enquanto o servidor responde).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConteudoCarga(
    carga: Carga,
    aoRecarregar: () -> Unit,
    modifier: Modifier = Modifier,
    topo: (@Composable () -> Unit)? = null,
    conteudo: @Composable ColumnScope.(JSONObject) -> Unit,
) {
    PullToRefreshBox(isRefreshing = carga.carregando && carga.dados != null && !carga.acordando, onRefresh = aoRecarregar, modifier = modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            topo?.invoke()
            FaixaEstado(carga)
            val dados = carga.dados
            when {
                dados != null -> Column(
                    Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 120.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) { conteudo(dados) }
                carga.acordando -> AcordandoSemCache()
                carga.erro != null -> ErroComAcao(carga.erro.paraPessoa, aoTocar = aoRecarregar)
                else -> Esqueleto()
            }
        }
    }
}

/**
 * Linha "rótulo ........ valor". Valor longo (mais de `quebraEm` caracteres) vai para a linha de baixo, inteiro,
 * em vez de dividir a largura com o rótulo e cortar (fase 4: fuso, objetivo).
 */
@Composable
fun LinhaValor(rotulo: String, valor: String, modifier: Modifier = Modifier, quebraEm: Int = 18) {
    if (valor.length > quebraEm) {
        Column(modifier.fillMaxWidth().padding(vertical = 3.dp)) {
            Text(rotulo, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
            Text(valor, style = MaterialTheme.typography.labelLarge, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        return
    }
    Row(modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(rotulo, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Text(valor, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** Segmentado em pílula (frente/costas, gordura/massa magra, semana/mês). */
@Composable
fun Segmentado(opcoes: List<String>, selecionada: Int, aoEscolher: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.clip(Formas.Pilula).background(Color(0xFFF3EEFF)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        opcoes.forEachIndexed { i, o ->
            val ativo = i == selecionada
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(Formas.Pilula).background(if (ativo) Cores.Branco else Color.Transparent)
                    .clickable(role = Role.Tab) { aoEscolher(i) }.padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(o, fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, color = if (ativo) Cores.AcaiEscuro else Cores.Tinta3)
            }
        }
    }
}

/**
 * Chip em pílula para escolher uma opção (slot da refeição, tipo de evento, nota de 1 a 5). Alvo de toque de 48 dp.
 * Com `papel = Role.Switch` vira um liga/desliga (o "Cruzar" do Progresso).
 */
@Composable
fun Chip(texto: String, ativo: Boolean, modifier: Modifier = Modifier, papel: Role = Role.RadioButton, aoTocar: () -> Unit) {
    Box(
        modifier.heightIn(min = 48.dp).clip(Formas.Pilula).background(if (ativo) Cores.Acai else Cores.Trilho)
            .clickable(role = papel, onClick = aoTocar).semantics { selected = ativo }.padding(horizontal = 14.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(texto, fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, color = if (ativo) Cores.Branco else Cores.LilasTexto, maxLines = 1)
    }
}

/** Recado de erro de uma escrita (dentro de uma folha ou diálogo). */
@Composable
fun AvisoErro(texto: String, modifier: Modifier = Modifier) {
    Text(
        texto, color = Cores.CuidadoTinta, style = MaterialTheme.typography.bodySmall,
        modifier = modifier.fillMaxWidth().clip(Formas.Pequeno).background(Cores.CuidadoFundo).padding(horizontal = 12.dp, vertical = 8.dp),
    )
}

/** Enquanto uma escrita espera o servidor: mascote, a explicação e, passados 4 s, o aviso de que ele está acordando. */
@Composable
fun Esperando(texto: String, escrita: Escrita, pose: Pose = Pose.CorgiLupa) {
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Mascote(pose, 96.dp)
        Text(texto, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (escrita.acordando) Text("Acordando o servidor. Leva até 1 minuto.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, textAlign = TextAlign.Center)
        CircularProgressIndicator(color = Cores.Acai)
    }
}

/** Caixa tracejada (pendente). */
fun Modifier.tracejado(cor: Color = Color(0xFFC9BDF2), raio: Dp = 22.dp): Modifier = this.drawBehind {
    val w = 2.dp.toPx()
    drawRoundRect(
        color = cor,
        topLeft = androidx.compose.ui.geometry.Offset(w / 2, w / 2),
        size = androidx.compose.ui.geometry.Size(size.width - w, size.height - w),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(raio.toPx()),
        style = androidx.compose.ui.graphics.drawscope.Stroke(width = w, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx(), 6.dp.toPx()))),
    )
}

/** Faz o elemento passar por cima do respiro lateral da tela (o carrossel de recados vai de borda a borda). */
fun Modifier.sangrar(lado: Dp): Modifier = this.layout { medida, restricoes ->
    val extra = (lado * 2).roundToPx()
    val p = medida.measure(restricoes.copy(minWidth = restricoes.minWidth + extra, maxWidth = restricoes.maxWidth + extra))
    layout(p.width - extra, p.height) { p.place(-extra / 2, 0) }
}
