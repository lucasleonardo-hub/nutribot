package br.nutribot.relogio.ui.telas

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val DESCRICAO_GRAFICO = "Gráfico da Nutri dos últimos 30 dias: calorias comidas por dia, gasto do relógio, faixa da meta, peso e massa magra"

/**
 * "Gráfico da Nutri" (2.3): o PNG que ela manda no `!grafico` e no resumo de domingo, vindo de `/perfis/:id/grafico.png`.
 * Guardado por 1 h pelo AppVM; decodificado fora da thread principal. Tocar abre em tela cheia (pode girar o aparelho).
 * Usado no Progresso (abaixo do gráfico) e no topo dos Resumos.
 */
@Composable
fun CartaoGraficoNutri(vm: AppVM, perfilId: String, atraso: Int = 0) {
    val rota = AppVM.rotaGrafico(perfilId)
    var imagem by remember(rota) { mutableStateOf<ImageBitmap?>(null) }
    var erro by remember(rota) { mutableStateOf<String?>(null) }
    var tentativa by remember(rota) { mutableIntStateOf(0) }
    var aberto by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(rota, tentativa) {
        erro = null
        try {
            val bytes = vm.imagem(rota, forcar = tentativa > 0)
            val bmp = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
            if (bmp == null) erro = "O gráfico veio quebrado. Tente de novo." else imagem = bmp.asImageBitmap()
        } catch (e: ErroApi) {
            erro = e.paraPessoa
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            erro = "Falha inesperada. Tente de novo."
        }
    }
    Cartao(atraso = atraso) {
        TituloSecao("Gráfico da Nutri")
        Box(
            Modifier.fillMaxWidth().padding(top = 10.dp).aspectRatio(1000f / 520f).clip(Formas.Pequeno).background(Cores.Trilho),
            contentAlignment = Alignment.Center,
        ) {
            val img = imagem
            val e = erro
            when {
                img != null -> Image(
                    img, contentDescription = DESCRICAO_GRAFICO, contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().clickable(role = Role.Button, onClickLabel = "Ampliar") { aberto = true },
                )
                e != null -> Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(e, style = MaterialTheme.typography.bodySmall, color = Cores.CuidadoTinta, textAlign = TextAlign.Center)
                    Botao("Tentar de novo", suave = true) { tentativa++ }
                }
                else -> Text("Carregando…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            }
        }
        Text("O mesmo gráfico que ela manda no domingo.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 6.dp))
    }
    val img = imagem
    if (aberto && img != null) DialogoImagem(img) { aberto = false }
}

/** A imagem em tela cheia, ajustada à tela (em pé ou deitada); sem zoom por gesto. Tocar fora ou no × fecha. */
@Composable
private fun DialogoImagem(imagem: ImageBitmap, fechar: () -> Unit) {
    Dialog(onDismissRequest = fechar, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xF21A1430)).clickable(role = Role.Button, onClickLabel = "Fechar", onClick = fechar), contentAlignment = Alignment.Center) {
            Image(imagem, contentDescription = DESCRICAO_GRAFICO, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(8.dp))
            Box(
                Modifier.align(Alignment.TopEnd).padding(14.dp).size(48.dp).clip(CircleShape).background(Cores.Branco)
                    .clickable(role = Role.Button, onClickLabel = "Fechar", onClick = fechar).semantics { contentDescription = "Fechar" },
                contentAlignment = Alignment.Center,
            ) { Text("×", color = Cores.AcaiEscuro, fontSize = 22.sp, fontWeight = FontWeight.W700) }
        }
    }
}
