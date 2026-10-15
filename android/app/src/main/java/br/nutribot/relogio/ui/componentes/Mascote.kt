package br.nutribot.relogio.ui.componentes

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.R
import br.nutribot.relogio.ui.tema.LocalReduzirMovimento

/** Catálogo de poses de Caju (corgi) e Lia (lontra), com a largura de cada recorte (altura 440 px), como no Mascote.dc.html. */
enum class Pose(@DrawableRes val img: Int, val largura: Int, val nome: String) {
    CorgiFesta(R.drawable.corgi_festa, 238, "Caju pulando de alegria"),
    LontraFesta(R.drawable.lontra_festa, 275, "Lia batendo palmas"),
    DuplaFeliz(R.drawable.dupla_feliz, 466, "Caju e Lia felizes"),
    DuplaConferindo(R.drawable.dupla_conferindo, 598, "Caju e Lia conferindo"),
    CorgiComendo(R.drawable.corgi_comendo, 331, "Caju comendo"),
    LontraComendo(R.drawable.lontra_comendo, 399, "Lia comendo"),
    DuplaDescansando(R.drawable.dupla_descansando, 775, "Caju e Lia descansando"),
    CorgiLupa(R.drawable.corgi_lupa, 385, "Caju investigando com uma lupa"),
    CorgiHalter(R.drawable.corgi_halter, 316, "Caju treinando com halter"),
    CorgiDormindo(R.drawable.corgi_dormindo, 598, "Caju dormindo"),
    CorgiBalanca(R.drawable.corgi_balanca, 262, "Caju na balança"),
    LontraChef(R.drawable.lontra_chef, 459, "Lia cozinhando"),
    LontraRelogio(R.drawable.lontra_relogio, 332, "Lia mostrando o relógio"),
    LontraTriste(R.drawable.lontra_triste, 429, "Lia triste com o prato vazio"),
    LontraTrofeu(R.drawable.lontra_trofeu, 434, "Lia com um troféu"),
    DuplaTocaqui(R.drawable.dupla_tocaqui, 577, "Caju e Lia batendo as mãos"),
    DuplaCozinhando(R.drawable.dupla_cozinhando, 472, "Caju e Lia preparando uma salada"),
    DuplaCelular(R.drawable.dupla_celular, 657, "Caju e Lia registrando a refeição no celular"),
    DuplaCorrendo(R.drawable.dupla_correndo, 638, "Caju e Lia correndo"),
    DuplaProgresso(R.drawable.dupla_progresso, 671, "Caju e Lia com a barra de progresso"),

    // água e esporte (folhas do dono de 15/10)
    CorgiAgua(R.drawable.corgi_agua, 325, "Caju bebendo água"),
    CorgiCansado(R.drawable.corgi_cansado, 420, "Caju enxugando o suor"),
    CorgiJoinha(R.drawable.corgi_joinha, 399, "Caju fazendo joinha com a garrafinha"),
    LontraAgua(R.drawable.lontra_agua, 418, "Lia bebendo água"),
    LontraGarrafa(R.drawable.lontra_garrafa, 396, "Lia com a garrafinha"),
    LontraMaisUm(R.drawable.lontra_mais1, 392, "Lia comemorando mais um copo"),
    DuplaVolei(R.drawable.dupla_volei, 699, "Caju e Lia jogando vôlei"),
    CorgiSupino(R.drawable.corgi_supino, 455, "Caju levantando a barra"),
    LontraKettlebell(R.drawable.lontra_kettlebell, 506, "Lia treinando com kettlebell"),
    DuplaAgua(R.drawable.dupla_agua, 800, "Caju e Lia se hidratando"),
    DuplaCansados(R.drawable.dupla_cansados, 1092, "Caju e Lia descansando depois do treino");

    val festa: Boolean get() = this == CorgiFesta || this == LontraTrofeu || this == DuplaTocaqui || this == LontraFesta || this == LontraMaisUm
    val dorme: Boolean get() = this == CorgiDormindo || this == LontraTriste || this == DuplaDescansando || this == DuplaCansados
}

enum class Humor { Feliz, Pensando, Sonolento, Comemorando, Comendo }
enum class Quem { Dupla, Corgi, Lontra }

fun posesDe(humor: Humor, quem: Quem = Quem.Dupla): List<Pose> = when (quem) {
    Quem.Dupla -> when (humor) {
        Humor.Feliz -> listOf(Pose.DuplaFeliz)
        Humor.Pensando -> listOf(Pose.DuplaConferindo)
        Humor.Sonolento -> listOf(Pose.DuplaDescansando)
        Humor.Comemorando -> listOf(Pose.CorgiFesta, Pose.LontraFesta)
        Humor.Comendo -> listOf(Pose.CorgiComendo, Pose.LontraComendo)
    }
    Quem.Corgi -> when (humor) {
        Humor.Feliz, Humor.Comemorando -> listOf(Pose.CorgiFesta)
        Humor.Pensando -> listOf(Pose.CorgiLupa)
        Humor.Comendo -> listOf(Pose.CorgiComendo)
        Humor.Sonolento -> listOf(Pose.CorgiDormindo)
    }
    Quem.Lontra -> when (humor) {
        Humor.Feliz -> listOf(Pose.LontraFesta)
        Humor.Comemorando -> listOf(Pose.LontraTrofeu)
        Humor.Pensando -> listOf(Pose.LontraChef)
        Humor.Comendo -> listOf(Pose.LontraComendo)
        Humor.Sonolento -> listOf(Pose.LontraTriste)
    }
}

/** Uma pose, boiando devagar (festa: pulando; dormindo: respirando). Para tudo com "remover animações". */
@Composable
fun Mascote(pose: Pose, altura: Dp, modifier: Modifier = Modifier, atraso: Int = 0, descricao: Boolean = false) {
    val parado = LocalReduzirMovimento.current
    val largura = altura * (pose.largura / 440f)
    var mod = modifier.width(largura).height(altura)
    if (descricao) mod = mod.semantics { contentDescription = pose.nome }
    if (!parado) {
        // o valor animado só é lido dentro do graphicsLayer: a animação mexe na camada de desenho, sem recompor a cada quadro
        val t = rememberInfiniteTransition(label = "mascote")
        when {
            pose.festa -> {
                val f = t.animateFloat(
                    0f, 1f,
                    infiniteRepeatable(tween(1500, easing = LinearEasing), RepeatMode.Restart, StartOffset(atraso)),
                    label = "pula",
                )
                mod = mod.graphicsLayer {
                    val v = f.value
                    // pula: sobe 12 px, amassa ao cair, quica pequeno
                    val dy = when {
                        v < 0.25f -> -12f * (v / 0.25f)
                        v < 0.5f -> -12f * (1 - (v - 0.25f) / 0.25f)
                        v < 0.7f -> -4f * ((v - 0.5f) / 0.2f)
                        else -> -4f * (1 - (v - 0.7f) / 0.3f)
                    }
                    val sx = if (v in 0.4f..0.6f) 1.03f else 1f
                    translationY = dy * density
                    scaleX = sx
                    scaleY = 2f - sx
                    transformOrigin = TransformOrigin(0.5f, 1f)
                }
            }
            pose.dorme -> {
                val s = t.animateFloat(1f, 1.025f, infiniteRepeatable(tween(1900, easing = FastOutSlowInEasing), RepeatMode.Reverse, StartOffset(atraso)), label = "respira")
                mod = mod.graphicsLayer {
                    scaleX = s.value
                    scaleY = s.value
                    transformOrigin = TransformOrigin(0.5f, 1f)
                }
            }
            else -> {
                val y = t.animateFloat(0f, -4f, infiniteRepeatable(tween(1700, easing = FastOutSlowInEasing), RepeatMode.Reverse, StartOffset(atraso)), label = "boia")
                mod = mod.graphicsLayer { translationY = y.value * density }
            }
        }
    }
    Image(painterResource(pose.img), contentDescription = null, modifier = mod, contentScale = ContentScale.Fit)
}

/** Mascote por humor (dupla, corgi ou lontra); comemorando com a dupla mostra os dois lado a lado, um pouco encaixados. */
@Composable
fun MascoteHumor(humor: Humor, altura: Dp, modifier: Modifier = Modifier, quem: Quem = Quem.Dupla) {
    val poses = posesDe(humor, quem)
    if (poses.size == 1) {
        Mascote(poses[0], altura, modifier)
        return
    }
    Box(modifier) {
        Row(verticalAlignment = Alignment.Bottom) {
            poses.forEachIndexed { i, p ->
                Mascote(p, altura, Modifier.offset(x = -(altura * 0.08f) * i), atraso = i * 450, descricao = false)
            }
        }
    }
}

