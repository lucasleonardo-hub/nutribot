package br.nutribot.relogio.ui.telas

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.Refeicao
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka
import java.time.LocalDate

/**
 * Agenda (leitura): por dia, as refeições (de /refeicoes) e, hoje, os treinos do relógio (de /hoje).
 * Criar evento para a Nutri é da fase 2: o botão avisa.
 */
@Composable
fun TelaAgenda(vm: AppVM, perfil: Perfil?, voltar: () -> Unit) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val ctx = LocalContext.current
    val hojeCarga by vm.carga(AppVM.rotaHoje(perfil.id)).collectAsStateWithLifecycle()
    val hoje = Formato.hojeDe(hojeCarga.dados.str("dia"), perfil.fuso)
    val ini = hoje.minusDays(6)
    val rota = AppVM.rotaRefeicoes(perfil.id, Formato.iso(ini), Formato.iso(hoje))
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota); vm.carregar(AppVM.rotaHoje(perfil.id)) }
    var selStr by rememberSaveable { mutableStateOf(Formato.iso(hoje)) }
    val sel = minOf(Formato.dia(selStr) ?: hoje, hoje)

    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = { CabecalhoVoltar("Agenda", "${perfil.curto} · o que aconteceu em cada dia", Pose.LontraRelogio, voltar) },
    ) { j ->
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            for (i in 0..6) {
                val d = ini.plusDays(i.toLong())
                val ativo = d == sel
                Column(
                    Modifier.weight(1f).heightIn(min = 56.dp).clip(Formas.Pequeno).background(if (ativo) Cores.Acai else Cores.Branco)
                        .clickable(role = Role.Tab) { selStr = Formato.iso(d) }.padding(vertical = 7.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(Formato.semanaCurta(d), fontSize = 11.sp, color = if (ativo) Cores.Branco else Cores.Tinta3)
                    Text("${d.dayOfMonth}", fontFamily = Fredoka, fontWeight = FontWeight.W600, fontSize = 16.sp, color = if (ativo) Cores.Branco else Cores.Tinta)
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (sel == hoje) "Hoje" else Formato.diaLongo(sel).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            Box(
                Modifier.clip(Formas.Pilula).background(Cores.Trilho).clickable(role = Role.Button) {
                    Toast.makeText(ctx, "Criar eventos para a Nutri chega na próxima versão.", Toast.LENGTH_LONG).show()
                }.heightIn(min = 48.dp).padding(horizontal = 14.dp, vertical = 14.dp),
            ) { Text("Novo evento", color = Cores.LilasTexto, style = MaterialTheme.typography.labelLarge) }
        }

        val dia = j.arr("dias").objs().firstOrNull { Formato.dia(it.str("dia")) == sel }
        val refeicoes = Refeicao.lista(dia)
        val treinos = if (sel == hoje) hojeCarga.dados.obj("relogio").arr("treinos").objs() else emptyList()
        data class Evento(val hora: String?, val tipo: String, val titulo: String, val sub: String?, val fundo: Color, val tinta: Color)
        val eventos = refeicoes.map { Evento(it.hora, "Refeição", it.nome, "≈ ${Formato.kcal(it.kcal)} kcal" + (it.descricao?.let { d -> " · $d" } ?: ""), Color(0xFFFFF1EA), Cores.ProteinaTinta) } +
            treinos.map { Evento(it.str("hora"), "Treino", it.str("nome") ?: "Treino", it.int("min")?.let { m -> "$m min" }, Color(0xFFEEFAF3), Cores.GorduraTinta) }
        if (eventos.isEmpty()) Vazio("Dia livre: nada registrado.", Pose.DuplaDescansando)
        eventos.sortedBy { it.hora ?: "99:99" }.forEach { e ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(e.hora ?: "—", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta2, modifier = Modifier.width(42.dp).padding(top = 14.dp))
                Cartao(Modifier.weight(1f), cor = e.fundo, forma = Formas.Cartao, padding = PaddingValues(12.dp)) {
                    Pilula(e.tipo, Cores.Branco, e.tinta)
                    Text(e.titulo, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 4.dp))
                    e.sub?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 2) }
                }
            }
        }
        Text(
            "Os eventos do Google Agenda e os criados aqui para a Nutri (comer fora, festa, viagem) entram na próxima versão. Os treinos do relógio aparecem só no dia de hoje.",
            style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4,
        )
    }
}
