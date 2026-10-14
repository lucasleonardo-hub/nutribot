package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.BuildConfig
import br.nutribot.relogio.R
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.legado.Prefs
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Carga
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.FaixaEstado
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.iconeVoltar
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Ponte entre a tela Integrações e o que o Relógio antigo fazia na MainActivity (permissões do Health Connect,
 * sincronizar, bateria, localização, cupom). A MainActivity cria e atualiza; a tela só mostra e chama.
 */
class Legado(
    val aoPermissoes: () -> Unit,
    val aoSincronizar: () -> Unit,
    val aoBateria: () -> Unit,
    val aoLocalizacao: () -> Unit,
    val aoLerCupom: () -> Unit,
) {
    var status by mutableStateOf("")
    var localizacaoLigada by mutableStateOf(false)
    var lendoCupom by mutableStateOf(false)
    var webVisivel by mutableStateOf(false)
}

private data class Fonte(val nome: String, val estado: String, val detalhe: String?)
private data class GrupoFontes(val titulo: String?, val fontes: List<Fonte>)

private fun haTexto(iso: String?, haMin: Double? = null): String? {
    Formato.instante(iso)?.let { return Formato.ha(it) }
    if (haMin != null) return Formato.ha(java.time.Instant.now().minusSeconds((haMin * 60).toLong()))
    return iso
}

/**
 * /integracoes (formato da frente S, S-api.md §3):
 * { whatsapp: { estado, conectado, desconectadoHaMin }, drive: { configurado },
 *   perfis: [{ id, nome, relogio: { estado, ultimoEnvio, haMin, app }, hevy: { ativo, ultimoTreino }, agenda: { ativo }, cupom: { ultimaNota: { dia, loja } | null } }] }
 * Campo ausente ou nulo vira "não ligado"; campo a mais é ignorado.
 */
private fun gruposDe(j: JSONObject): List<GrupoFontes> {
    val gerais = ArrayList<Fonte>()
    j.obj("whatsapp")?.let { w ->
        val conectado = w.bool("conectado")
        val min = w.num("desconectadoHaMin")
        gerais.add(
            Fonte(
                "WhatsApp",
                if (conectado == true) "ok" else if (conectado == false) "erro" else (w.str("estado") ?: "não ligado"),
                if (conectado == false) "Desconectado" + (min?.takeIf { it > 0 }?.let { " há ${Formato.inteiro(it)} min" } ?: "") + ". Só escanear o QR religa."
                else w.str("estado")?.let { "Estado: $it" },
            )
        )
    }
    j.obj("drive")?.let { d ->
        val ok = d.bool("configurado") == true
        gerais.add(Fonte("Google Drive", if (ok) "ok" else "não ligado", if (ok) "Configurado. A checagem diária das 07:20 avisa no WhatsApp se a permissão expirar." else "Não configurado no servidor."))
    }
    val out = ArrayList<GrupoFontes>()
    if (gerais.isNotEmpty()) out.add(GrupoFontes(null, gerais))
    j.arr("perfis").objs().forEach { p ->
        val fs = ArrayList<Fonte>()
        val r = p.obj("relogio")
        val er = r.str("estado") ?: "sem_dados"
        fs.add(
            Fonte(
                "Relógio (Health Connect)",
                when (er) { "ok" -> "ok"; "atrasado" -> "atrasado"; "parado" -> "erro"; else -> "não ligado" },
                when (er) {
                    "sem_dados" -> "Nenhum envio ainda."
                    else -> listOfNotNull(haTexto(r.str("ultimoEnvio"), r.num("haMin"))?.let { "Último envio $it" }, r.str("app")?.let { "app $it" }).joinToString(" · ").ifBlank { null }
                },
            )
        )
        val h = p.obj("hevy")
        fs.add(Fonte("Hevy (musculação)", if (h.bool("ativo") == true) "ok" else "não ligado", h.str("ultimoTreino")?.let { "Último treino ${haTexto(it) ?: it}" }))
        fs.add(Fonte("Google Agenda", if (p.obj("agenda").bool("ativo") == true) "ok" else "não ligado", null))
        val nota = p.obj("cupom").obj("ultimaNota")
        fs.add(
            Fonte(
                "Cupom fiscal",
                if (nota != null) "ok" else "não ligado",
                nota?.let { n -> "Última nota em " + (Formato.dia(n.str("dia"))?.let { Formato.diaCurto(it) } ?: n.str("dia") ?: "?") + (n.str("loja")?.let { " ($it)" } ?: "") },
            )
        )
        out.add(GrupoFontes(p.str("nome") ?: "Perfil", fs))
    }
    return out
}

private fun corDoEstado(estado: String): Triple<String, Color, Color> = when {
    estado in setOf("ok", "conectado", "ligado", "ativo", "open") -> Triple("ok", Color(0xFFDDF5E8), Cores.BomTinta)
    estado.contains("atras") || estado.contains("aviso") || estado.contains("lento") -> Triple("atrasado", Cores.AtencaoFundo, Cores.AtencaoTinta)
    estado.contains("erro") || estado.contains("falh") || estado.contains("expir") || estado.contains("descon") || estado.contains("close") -> Triple("com erro", Cores.CuidadoFundo, Color(0xFF8A3418))
    else -> Triple("não ligado", Cores.Lavanda, Cores.Tinta3)
}

@Composable
fun TelaIntegracoes(vm: AppVM, legado: Legado, voltar: () -> Unit) {
    val pareado by vm.pareado.collectAsStateWithLifecycle()
    val carga: Carga by vm.carga(AppVM.ROTA_INTEGRACOES).collectAsStateWithLifecycle()
    LaunchedEffect(pareado) { if (pareado) vm.carregar(AppVM.ROTA_INTEGRACOES) }
    val ctx = LocalContext.current
    val prefs = remember { Prefs(ctx) }
    var url by remember { mutableStateOf(prefs.url) }
    var pessoa by remember { mutableStateOf(prefs.pessoa) }
    // o token é cifrado pelo Keystore (2.1): lê e grava em IO, e grava só depois de a pessoa parar de digitar
    var token by remember { mutableStateOf("") }
    var tokenLido by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        token = withContext(Dispatchers.IO) { prefs.token }
        tokenLido = true
    }
    LaunchedEffect(token, tokenLido) {
        if (!tokenLido) return@LaunchedEffect
        delay(600)
        withContext(Dispatchers.IO) { if (prefs.token != token.trim()) prefs.token = token }
    }

    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding().verticalScroll(rememberScrollState())) {
        CabecalhoVoltar("De onde vêm os dados", "Integrações e o relógio deste celular", Pose.LontraRelogio, voltar)
        if (pareado) FaixaEstado(carga)
        Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (pareado) {
                val grupos = carga.dados?.let { gruposDe(it) }.orEmpty()
                if (grupos.isEmpty() && carga.dados != null) Text("O servidor ainda não mandou o estado das fontes.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta3)
                grupos.forEach { g ->
                g.titulo?.let { Text(it, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 6.dp)) }
                g.fontes.forEachIndexed { i, f ->
                    val (rotulo, fundo, tinta) = corDoEstado(f.estado)
                    Cartao(forma = Formas.Cartao, atraso = i * 40, padding = PaddingValues(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(f.nome, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Pilula(rotulo, fundo, tinta)
                        }
                        if (f.detalhe != null) Text(f.detalhe, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 4.dp))
                    }
                }
                }
                Text(
                    "Quando o servidor está dormindo, o app mostra o que já tinha guardado e avisa \"acordando o servidor…\" (pode levar até 1 minuto).",
                    style = MaterialTheme.typography.bodySmall,
                    color = Cores.Tinta3,
                )
            }

            // O Relógio antigo, inteiro: o que este celular manda para o bot
            Cartao(forma = Formas.Medio, padding = PaddingValues(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Relógio deste celular", style = MaterialTheme.typography.titleLarge)
                        Text("Health Connect → bot a cada 15 min · app ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    }
                    Mascote(Pose.LontraRelogio, 54.dp)
                }
                Spacer(Modifier.height(6.dp))
                Text(stringResource(R.string.explicacao), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(url, { url = it; prefs.url = it }, label = { Text(stringResource(R.string.rotulo_url)) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(pessoa, { pessoa = it; prefs.pessoa = it }, label = { Text(stringResource(R.string.rotulo_pessoa)) }, placeholder = { Text(stringResource(R.string.dica_pessoa)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    token, { token = it },
                    label = { Text(stringResource(R.string.rotulo_token)) }, placeholder = { Text(stringResource(R.string.dica_token)) },
                    singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Botao(stringResource(R.string.botao_permissoes), Modifier.fillMaxWidth()) { legado.aoPermissoes() }
                    Botao(stringResource(R.string.botao_sincronizar), Modifier.fillMaxWidth()) { legado.aoSincronizar() }
                    Botao(stringResource(R.string.botao_bateria), Modifier.fillMaxWidth(), suave = true) { legado.aoBateria() }
                    Botao(stringResource(R.string.botao_localizacao) + if (legado.localizacaoLigada) " · ligada" else " · desligada", Modifier.fillMaxWidth(), suave = true) { legado.aoLocalizacao() }
                    Botao(stringResource(R.string.botao_cupom), Modifier.fillMaxWidth(), suave = true, habilitado = !legado.lendoCupom) { legado.aoLerCupom() }
                }
                if (legado.status.isNotBlank()) {
                    Spacer(Modifier.height(10.dp))
                    Box(Modifier.fillMaxWidth().clip(Formas.Pequeno).background(Cores.Lavanda).padding(12.dp)) {
                        Text(legado.status, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
                    }
                }
            }

            if (pareado) {
                Cartao(forma = Formas.Cartao, padding = PaddingValues(16.dp)) {
                    Text("Este aparelho no app", style = MaterialTheme.typography.titleMedium)
                    Text("Servidor: ${vm.base}", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
                    Spacer(Modifier.height(8.dp))
                    Botao("Desparear este celular", Modifier.fillMaxWidth(), suave = true) { vm.sair("Aparelho despareado. Para voltar, mande !app no privado do bot.") }
                    Text("Apaga o token e os dados guardados no celular. O relógio continua mandando os dados normalmente.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

/** Cabeçalho das telas do menu do nome: voltar, título, subtítulo e mascote. */
@Composable
fun CabecalhoVoltar(titulo: String, sub: String?, pose: Pose?, voltar: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 18.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(48.dp).clip(Formas.Pilula).clickable(role = Role.Button, onClickLabel = "Voltar", onClick = voltar),
            contentAlignment = Alignment.Center,
        ) { Icon(iconeVoltar, contentDescription = "Voltar", tint = Cores.AcaiEscuro) }
        Column(Modifier.weight(1f)) {
            Text(titulo, style = MaterialTheme.typography.headlineMedium)
            if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        }
        if (pose != null) Mascote(pose, 56.dp)
    }
}

