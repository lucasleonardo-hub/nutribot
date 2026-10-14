package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.Fredoka

/** Primeira tela: o código de 6 dígitos que o bot manda quando o dono escreve !app no privado. */
@Composable
fun TelaPareamento(vm: AppVM, aoAbrirRelogio: () -> Unit) {
    val estado by vm.pareando.collectAsStateWithLifecycle()
    val recado by vm.recado.collectAsStateWithLifecycle()
    var codigo by rememberSaveable { mutableStateOf("") }
    var base by rememberSaveable { mutableStateOf(vm.base) }
    var mostrarServidor by rememberSaveable { mutableStateOf(false) }
    val pronto = codigo.length == 6 && !estado.enviando
    fun enviar() { if (pronto) vm.parear(codigo, base) }

    Column(
        Modifier.fillMaxSize().imePadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("NutriBot", style = MaterialTheme.typography.displayLarge)
        Text("Seu acompanhamento do NutriBot no celular.", style = MaterialTheme.typography.bodyLarge, color = Cores.Tinta2)
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Mascote(Pose.DuplaTocaqui, 130.dp) }

        if (recado != null) {
            Cartao(cor = Cores.AtencaoFundo, forma = Formas.Cartao) { Text(recado!!, color = Cores.AtencaoTinta, style = MaterialTheme.typography.bodyMedium) }
        }

        Cartao(forma = Formas.Grande, padding = androidx.compose.foundation.layout.PaddingValues(20.dp)) {
            Text("Parear este celular", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(6.dp))
            Text(
                "No WhatsApp, mande !app no privado do bot. Ele responde com um código de 6 dígitos, que vale 10 minutos e uma vez só.",
                style = MaterialTheme.typography.bodyMedium,
                color = Cores.Tinta2,
            )
            Spacer(Modifier.height(16.dp))
            BasicTextField(
                value = codigo,
                onValueChange = { v -> codigo = v.filter { it.isDigit() }.take(6) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { enviar() }),
                singleLine = true,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Código de 6 dígitos" },
                decorationBox = { _ ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        repeat(6) { i ->
                            val c = codigo.getOrNull(i)?.toString() ?: ""
                            val ativo = i == codigo.length
                            Box(
                                Modifier.weight(1f).height(58.dp).clip(Formas.Pequeno).background(Cores.Lavanda)
                                    .border(2.dp, if (ativo) Cores.Acai else Cores.Trilho, Formas.Pequeno),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(c, fontFamily = Fredoka, fontWeight = FontWeight.W700, fontSize = 28.sp, color = Cores.Tinta)
                            }
                        }
                    }
                },
            )
            Spacer(Modifier.height(16.dp))
            Botao(if (estado.enviando) "Pareando…" else "Parear", Modifier.fillMaxWidth(), habilitado = pronto) { enviar() }
            if (estado.enviando) {
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Acai, strokeWidth = 2.dp)
                    Text(
                        if (estado.acordando) "Acordando o servidor… o gratuito dorme e pode levar até 1 minuto." else "Conferindo o código…",
                        style = MaterialTheme.typography.bodySmall,
                        color = Cores.Tinta2,
                    )
                }
            }
            if (estado.erro != null) {
                Spacer(Modifier.height(12.dp))
                Text(estado.erro!!, color = Cores.CuidadoTinta, style = MaterialTheme.typography.bodyMedium)
            }
        }

        Link(if (mostrarServidor) "Esconder o endereço do servidor" else "Endereço do servidor") { mostrarServidor = !mostrarServidor }
        if (mostrarServidor) {
            OutlinedTextField(
                value = base,
                onValueChange = { base = it.trim() },
                label = { Text("Endereço da API") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Padrão: o mesmo servidor do Relógio, em /api/v1.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        }
        Link("Ajustes do relógio (Health Connect, localização, cupom)") { aoAbrirRelogio() }
        Spacer(Modifier.height(24.dp))
    }
}
