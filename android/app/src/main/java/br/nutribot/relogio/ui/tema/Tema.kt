package br.nutribot.relogio.ui.tema

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.nutribot.relogio.R

/** Paleta da identidade aprovada (Identidade.dc.html). */
object Cores {
    val Acai = Color(0xFF7C5CE0)          // marca e ações
    val AcaiEscuro = Color(0xFF5B3FC4)    // botões e links
    val Lavanda = Color(0xFFF7F5FF)       // fundo
    val Tinta = Color(0xFF2B2340)         // texto
    val Tinta2 = Color(0xFF4A4260)
    val Tinta3 = Color(0xFF5E5577)        // texto secundário
    val Tinta4 = Color(0xFF6E6587)
    val Branco = Color(0xFFFFFFFF)
    val Trilho = Color(0xFFEEE9FF)
    val Lilas = Color(0xFFE5DCFF)
    val LilasMedio = Color(0xFFCBBDF7)
    val LilasForte = Color(0xFFB39DF5)
    val LilasTexto = Color(0xFF4B3A8C)
    val MetaVerde = Color(0xFFCFF1DF)
    val Cinza = Color(0xFFC9C3D9)

    // macros: cores fixas
    val Proteina = Color(0xFFFF9F80)      // pêssego
    val Carbo = Color(0xFFFFD166)         // manteiga
    val Gordura = Color(0xFF7DD3A8)       // menta
    val Fibra = Color(0xFF8EC5FF)         // céu (fase 2)
    val ProteinaTrilho = Color(0xFFFFEDE6)
    val CarboTrilho = Color(0xFFFFF6DB)
    val GorduraTrilho = Color(0xFFE3F6EC)
    val ProteinaTinta = Color(0xFFB4472A)
    val CarboTinta = Color(0xFF8A6100)
    val GorduraTinta = Color(0xFF1F7A50)

    // tons dos recados
    val BomFundo = Color(0xFFE3F6EC)
    val BomTinta = Color(0xFF1F6B47)
    val AtencaoFundo = Color(0xFFFFF6DB)
    val AtencaoTinta = Color(0xFF7A5600)
    val CuidadoFundo = Color(0xFFFFEDE6)
    val CuidadoTinta = Color(0xFFB4472A)
    val Pessego = Color(0xFFFFE3D3)
    val Verde = Color(0xFF5FBF8B)
    val Laranja = Color(0xFFF4A261)
}

private val esquema = lightColorScheme(
    primary = Cores.Acai,
    onPrimary = Cores.Branco,
    primaryContainer = Cores.Trilho,
    onPrimaryContainer = Cores.AcaiEscuro,
    secondary = Cores.AcaiEscuro,
    onSecondary = Cores.Branco,
    background = Cores.Lavanda,
    onBackground = Cores.Tinta,
    surface = Cores.Branco,
    onSurface = Cores.Tinta,
    surfaceVariant = Cores.Trilho,
    onSurfaceVariant = Cores.Tinta3,
    outline = Cores.LilasMedio,
    error = Cores.CuidadoTinta,
)

@OptIn(ExperimentalTextApi::class)
private fun fredoka(peso: Int) = Font(R.font.fredoka, FontWeight(peso), variationSettings = FontVariation.Settings(FontVariation.weight(peso)))

@OptIn(ExperimentalTextApi::class)
private fun atkinson(peso: Int) = Font(R.font.atkinson_next, FontWeight(peso), variationSettings = FontVariation.Settings(FontVariation.weight(peso)))

/** Fredoka: títulos e números grandes (arredondada). */
val Fredoka = FontFamily(fredoka(400), fredoka(500), fredoka(600), fredoka(700))

/** Atkinson Hyperlegible Next: texto, rótulos e tabelas. */
val Atkinson = FontFamily(atkinson(400), atkinson(600), atkinson(700))

private val tipografia = Typography(
    displayLarge = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 44.sp, lineHeight = 46.sp),
    displayMedium = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 34.sp, lineHeight = 36.sp),
    displaySmall = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 30.sp, lineHeight = 32.sp),
    headlineLarge = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 26.sp, lineHeight = 30.sp),
    headlineMedium = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 22.sp, lineHeight = 26.sp),
    headlineSmall = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 20.sp, lineHeight = 24.sp),
    titleLarge = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 18.sp, lineHeight = 22.sp),
    titleMedium = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 16.sp, lineHeight = 20.sp),
    titleSmall = TextStyle(fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 14.sp, lineHeight = 18.sp),
    bodyLarge = TextStyle(fontFamily = Atkinson, fontWeight = FontWeight.W400, fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = Atkinson, fontWeight = FontWeight.W400, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Atkinson, fontWeight = FontWeight.W400, fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = Atkinson, fontWeight = FontWeight.W700, fontSize = 14.sp, lineHeight = 18.sp),
    labelMedium = TextStyle(fontFamily = Atkinson, fontWeight = FontWeight.W700, fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontFamily = Atkinson, fontWeight = FontWeight.W700, fontSize = 11.sp, lineHeight = 14.sp),
)

/** Cartão grande 32, médio 24, pequeno 16; botões e chips em pílula. */
object Formas {
    val Grande = RoundedCornerShape(32.dp)
    val Medio = RoundedCornerShape(28.dp)
    val Cartao = RoundedCornerShape(24.dp)
    val Pequeno = RoundedCornerShape(16.dp)
    val Pilula = RoundedCornerShape(999.dp)
}

/** true quando a pessoa desligou as animações no sistema ("remover animações"). */
val LocalReduzirMovimento = staticCompositionLocalOf { false }

@Composable
fun NutriTema(reduzirMovimento: Boolean, conteudo: @Composable () -> Unit) {
    CompositionLocalProvider(LocalReduzirMovimento provides reduzirMovimento) {
        MaterialTheme(
            colorScheme = esquema,
            typography = tipografia,
            shapes = Shapes(small = Formas.Pequeno, medium = Formas.Cartao, large = Formas.Grande),
            content = conteudo,
        )
    }
}
