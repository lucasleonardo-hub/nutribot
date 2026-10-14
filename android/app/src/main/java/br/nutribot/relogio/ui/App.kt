package br.nutribot.relogio.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.ui.telas.Legado
import br.nutribot.relogio.ui.telas.TelaAgenda
import br.nutribot.relogio.ui.telas.TelaComida
import br.nutribot.relogio.ui.telas.TelaCorpo
import br.nutribot.relogio.ui.telas.TelaHoje
import br.nutribot.relogio.ui.telas.TelaIntegracoes
import br.nutribot.relogio.ui.telas.TelaNutri
import br.nutribot.relogio.ui.telas.TelaPareamento
import br.nutribot.relogio.ui.telas.TelaPerfil
import br.nutribot.relogio.ui.telas.TelaProgresso
import br.nutribot.relogio.ui.telas.TelaResumos
import br.nutribot.relogio.ui.tema.Cores

object Rotas {
    const val HOJE = "hoje"
    const val COMIDA = "comida"
    const val PROGRESSO = "progresso"
    const val CORPO = "corpo"
    const val NUTRI = "nutri"
    const val PERFIL = "perfil"
    const val AGENDA = "agenda"
    const val RESUMOS = "resumos"
    const val INTEGRACOES = "integracoes"
    /** Comida aberta num dia e numa refeição (vinda do Hoje). */
    fun comida(dia: String? = null, refeicao: String? = null) = "comida?dia=${dia ?: ""}&ref=${refeicao ?: ""}"
}

/** Ícone a partir de um "d" de SVG 24x24 com traço (os mesmos da barra do protótipo). */
fun icone(vararg caminhos: String): ImageVector {
    val b = ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
    caminhos.forEach { d ->
        b.addPath(
            pathData = PathParser().parsePathString(d).toNodes(),
            stroke = androidx.compose.ui.graphics.SolidColor(Color.Black),
            strokeLineWidth = 2.2f,
            strokeLineCap = androidx.compose.ui.graphics.StrokeCap.Round,
            strokeLineJoin = androidx.compose.ui.graphics.StrokeJoin.Round,
        )
    }
    return b.build()
}

private data class Aba(val rota: String, val nome: String, val icone: ImageVector)

private val abas = listOf(
    Aba(Rotas.HOJE, "Hoje", icone("M12 4a8 8 0 1 0 0.01 0Z", "M12 4a8 8 0 0 1 8 8")),
    Aba(Rotas.COMIDA, "Comida", icone("M12 6a7 7 0 1 0 0.01 0Z", "M5 5v4M3 5v4M7 5v4M5 9v11")),
    Aba(Rotas.PROGRESSO, "Progresso", icone("M3 17l5-5 4 3 8-8", "M15 7h5v5")),
    Aba(Rotas.CORPO, "Corpo", icone("M12 2.5a2.5 2.5 0 1 0 0.01 0Z", "M7 9h10M12 9v6M9 21l3-6 3 6")),
    Aba(Rotas.NUTRI, "Nutri", icone("M12 6a7 7 0 1 0 0.01 0Z", "M12 6c0-2 1-3 3-3", "M9.5 11a1 1 0 1 0 0.01 0Z", "M14.5 11a1 1 0 1 0 0.01 0Z")),
)

val iconeVoltar = icone("M15 5l-7 7 7 7")

/** Raiz: pareamento (sem token) ou o app com as 5 abas. */
@Composable
fun NutriApp(vm: AppVM, legado: Legado, rotaInicial: String?) {
    val pareado by vm.pareado.collectAsStateWithLifecycle()
    // um NavController por grafo: ao parear/desparear, a pilha e o estado salvo das abas recomeçam do zero
    val nav = key(pareado) { rememberNavController() }
    if (!pareado) {
        // Sem token: a tela do código. As Integrações (botões do Relógio antigo) continuam a um toque.
        NavHost(nav, startDestination = "parear", modifier = Modifier.fillMaxSize().background(Cores.Lavanda).statusBarsPadding()) {
            composable("parear") { TelaPareamento(vm, aoAbrirRelogio = { nav.navigate(Rotas.INTEGRACOES) }) }
            composable(Rotas.INTEGRACOES) { TelaIntegracoes(vm, legado, voltar = { nav.popBackStack() }) }
        }
        LaunchedEffect(rotaInicial) { if (rotaInicial == Rotas.INTEGRACOES) nav.navigate(Rotas.INTEGRACOES) }
        return
    }

    val perfisCarga by vm.carga(AppVM.ROTA_PERFIS).collectAsStateWithLifecycle()
    val perfilId by vm.perfilAtivo.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.carregar(AppVM.ROTA_PERFIS) }
    val perfis = Perfil.lista(perfisCarga.dados)
    val perfil = perfis.firstOrNull { it.id == perfilId } ?: perfis.firstOrNull { it.ehDono } ?: perfis.firstOrNull()

    LaunchedEffect(rotaInicial) { if (rotaInicial != null && rotaInicial != Rotas.HOJE) nav.navigate(rotaInicial) }

    val entrada by nav.currentBackStackEntryAsState()
    val rotaAtual = entrada?.destination?.route?.substringBefore('?')
    val mostrarAbas = abas.any { it.rota == rotaAtual }

    Box(Modifier.fillMaxSize().background(Cores.Lavanda)) {
        NavHost(nav, startDestination = Rotas.HOJE, modifier = Modifier.fillMaxSize().statusBarsPadding()) {
            composable(Rotas.HOJE) { TelaHoje(vm, perfisCarga, perfis, perfil, nav = { nav.navigate(it) }) }
            composable(
                "comida?dia={dia}&ref={ref}",
                arguments = listOf(navArgument("dia") { defaultValue = "" }, navArgument("ref") { defaultValue = "" }),
            ) { e ->
                TelaComida(vm, perfil, diaInicial = e.arguments?.getString("dia")?.takeIf { it.isNotBlank() }, refeicaoAberta = e.arguments?.getString("ref")?.takeIf { it.isNotBlank() })
            }
            composable(Rotas.COMIDA) { TelaComida(vm, perfil, null, null) }
            composable(Rotas.PROGRESSO) { TelaProgresso(vm, perfil) }
            composable(Rotas.CORPO) { TelaCorpo(vm, perfil) }
            composable(Rotas.NUTRI) { TelaNutri(vm, perfil) }
            composable(Rotas.PERFIL) { TelaPerfil(vm, perfil, voltar = { nav.popBackStack() }, nav = { nav.navigate(it) }) }
            composable(Rotas.AGENDA) { TelaAgenda(vm, perfil, voltar = { nav.popBackStack() }) }
            composable(Rotas.RESUMOS) { TelaResumos(vm, perfil, voltar = { nav.popBackStack() }) }
            composable(Rotas.INTEGRACOES) { TelaIntegracoes(vm, legado, voltar = { nav.popBackStack() }) }
        }
        AnimatedVisibility(
            mostrarAbas,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = fadeIn() + slideInVertically { it / 2 },
            exit = fadeOut() + slideOutVertically { it / 2 },
        ) {
            BarraAbas(nav, rotaAtual)
        }
    }
}

@Composable
private fun BarraAbas(nav: NavHostController, rotaAtual: String?) {
    Row(
        Modifier
            .navigationBarsPadding()
            .padding(start = 12.dp, end = 12.dp, bottom = 14.dp)
            .fillMaxWidth()
            .shadow(16.dp, RoundedCornerShape(30.dp), ambientColor = Color(0x295B3FC4), spotColor = Color(0x295B3FC4))
            .clip(RoundedCornerShape(30.dp))
            .background(Cores.Branco)
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        abas.forEach { a ->
            val ativa = a.rota == rotaAtual
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(if (ativa) Cores.Trilho else Color.Transparent)
                    .semantics { selected = ativa }
                    .clickable(role = Role.Tab) {
                        if (!ativa) nav.navigate(a.rota) {
                            popUpTo(Rotas.HOJE) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                val tinta = if (ativa) Cores.AcaiEscuro else Cores.Tinta3
                Icon(a.icone, contentDescription = null, tint = tinta, modifier = Modifier.size(22.dp))
                Text(a.nome, color = tinta, style = MaterialTheme.typography.labelMedium, fontWeight = if (ativa) FontWeight.W700 else FontWeight.W600, fontSize = 12.sp)
            }
        }
    }
}
