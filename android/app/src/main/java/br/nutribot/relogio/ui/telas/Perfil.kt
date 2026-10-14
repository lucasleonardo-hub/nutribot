package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import br.nutribot.relogio.BuildConfig
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.Rotas
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.LinhaValor
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores

/** Perfil (menu do nome): só leitura nesta fase, com o que o /perfis traz. */
@Composable
fun TelaPerfil(vm: AppVM, perfil: Perfil?, voltar: () -> Unit, nav: (String) -> Unit) {
    Column(Modifier.fillMaxSize().navigationBarsPadding().verticalScroll(rememberScrollState())) {
        CabecalhoVoltar("Perfil", perfil?.nome, Pose.DuplaFeliz, voltar)
        if (perfil == null) { Vazio("Nenhum perfil escolhido."); return@Column }
        Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Cartao {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(Modifier.size(64.dp).clip(CircleShape).background(Color(0xFFC9B8FF)), contentAlignment = Alignment.Center) {
                        Text(perfil.inicial, style = MaterialTheme.typography.headlineLarge)
                    }
                    Column {
                        Text(perfil.nome, style = MaterialTheme.typography.headlineMedium)
                        Text(
                            listOfNotNull(perfil.apelido?.let { "\"$it\"" }, perfil.objetivo, if (perfil.ehDono) "você administra o grupo" else null).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3,
                        )
                    }
                }
            }
            Cartao(atraso = 60) {
                TituloSecao("Objetivo e meta")
                LinhaValor("Objetivo", perfil.objetivo ?: "—")
                LinhaValor("Meta de peso", perfil.metaPeso?.let { Formato.decimal(it) + " kg" } ?: "—")
                LinhaValor("Prazo", Formato.dia(perfil.metaPrazo)?.let { Formato.diaCurto(it) + "/" + it.year } ?: perfil.metaPrazo ?: "—")
            }
            Cartao(atraso = 100) {
                TituloSecao("Dados e fontes")
                LinhaValor("Fuso", perfil.fuso ?: "—")
                LinhaValor("Relógio", if (perfil.temRelogio) "ligado" else "não")
                LinhaValor("Hevy", if (perfil.temHevy) "ligado" else "não")
                LinhaValor("App neste celular", BuildConfig.VERSION_NAME)
                Text("O app não mostra lugares nem localização de ninguém.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 6.dp))
            }
            Cartao(atraso = 140, padding = PaddingValues(12.dp)) {
                Link("Agenda") { nav(Rotas.AGENDA) }
                Link("Integrações") { nav(Rotas.INTEGRACOES) }
                Link("O que a Nutri sabe") { nav(Rotas.NUTRI) }
                Link("Resumos") { nav(Rotas.RESUMOS) }
            }
            Text("Editar perfil e meta pelo app chega na próxima versão; hoje é pelo WhatsApp.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4)
        }
    }
}
