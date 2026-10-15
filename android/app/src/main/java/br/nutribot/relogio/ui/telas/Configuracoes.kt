package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.ConfigBot
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AvisoErro
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.Chip
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.LinhaValor
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** Quanto tempo de silêncio a pessoa pode escolher (o mesmo que o `!silencio 2h` faz no grupo). */
private val opcoesSilencio = listOf(1, 2, 4, 8)

/** Mensagem de erro de uma escrita das configurações (403 = este celular não é o do dono, D14). */
private fun mensagemConfig(e: ErroApi): String = when {
    e.status == 403 -> "Só o celular de quem administra o grupo muda isso."
    e.status == 404 || e.status == 405 -> "O servidor ainda não aceita essa mudança pelo app."
    e.semConexao -> "Sem resposta do servidor. Tente de novo."
    else -> e.paraPessoa
}

/**
 * Configurações do bot (fase 7, W29–W31 e W38; só o dono, D14): voz ligada ou desligada, silêncio por algumas horas, o nome
 * da Nutri (só leitura: rebatizar é no grupo) e a saúde do bot. GET /perfis/:id/config -> { vozLigada, silencioAte,
 * nomeBot }; PUT /perfis/:id/config { vozLigada } ou { silencioAte: ISO | null }; GET /perfis/:id/sistema/status. Vale
 * para o grupo inteiro.
 */
@Composable
fun TelaConfiguracoes(vm: AppVM, perfil: Perfil?, voltar: () -> Unit) {
    if (perfil == null || !perfil.ehDono) {
        Column(Modifier.fillMaxSize()) {
            CabecalhoVoltar("Configurações do bot", null, Pose.DuplaConferindo, voltar)
            Vazio("Só aparece no perfil de quem administra o grupo.", Pose.CorgiLupa)
        }
        return
    }
    val rota = AppVM.rotaConfig(perfil.id)
    val rotaStatus = AppVM.rotaStatus(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val escopo = rememberCoroutineScope()
    var enviando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }

    /** PUT /config com um campo; a resposta (se trouxer a configuração) entra no lugar da guardada. */
    fun mudar(corpo: JSONObject) {
        if (enviando) return
        escopo.launch {
            enviando = true
            erro = null
            try {
                val j = vm.escrever("PUT", rota, corpo)
                if (ConfigBot.de(j)?.let { it.vozLigada != null || it.nomeBot != null } == true) vm.semear(rota, j.optJSONObject("config") ?: j)
                else vm.carregar(rota, forcar = true)
            } catch (e: ErroApi) {
                erro = mensagemConfig(e)
            } catch (e: CancellationException) {
                throw e
            } finally {
                enviando = false
            }
        }
    }

    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true); vm.carregar(rotaStatus, forcar = true) },
        topo = { CabecalhoVoltar("Configurações do bot", "vale para o grupo inteiro", Pose.DuplaConferindo, voltar) },
    ) { j ->
        val c = ConfigBot.de(j)
        erro?.let { AvisoErro(it) }
        if (enviando) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(16.dp), color = Cores.Acai, strokeWidth = 2.dp)
                Text("Salvando…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            }
        }

        Cartao {
            TituloSecao("Notas de voz")
            Text("As de segunda e sexta e as que ela manda por conta própria. Pedir em áudio sempre funciona.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp, bottom = 8.dp))
            val ligada = c?.vozLigada
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("ligadas", ligada == true) { if (ligada != true) mudar(JSONObject().put("vozLigada", true)) }
                Chip("desligadas", ligada == false) { if (ligada != false) mudar(JSONObject().put("vozLigada", false)) }
            }
        }

        Silencio(c?.silencioAte, mudar = { mudar(it) })

        Cartao {
            TituloSecao("Nome da Nutri")
            LinhaValor("Hoje ela se chama", c?.nomeBot ?: "—")
            Text("Para rebatizar, mande !nome NovoNome no grupo.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta4, modifier = Modifier.padding(top = 4.dp))
        }

        Cartao {
            TituloSecao("Saúde do bot")
            CargaEmbutida(vm, rotaStatus, "Conferindo…") { s -> StatusBot(s) }
        }
    }
}

/** Silêncio: em silêncio até uma hora (com "voltar a falar") ou as opções de 1 a 8 horas. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Silencio(silencioAte: String?, mudar: (JSONObject) -> Unit) {
    val ate = Formato.instante(silencioAte)?.takeIf { it.isAfter(Instant.now()) }
    Cartao {
        TituloSecao("Silêncio") { if (ate != null) Pilula("em silêncio", Cores.AtencaoFundo, Cores.AtencaoTinta) }
        if (ate != null) {
            val local = ate.atZone(ZoneId.systemDefault())
            val hoje = local.toLocalDate() == java.time.LocalDate.now()
            val quando = "%02d:%02d".format(local.hour, local.minute) + if (hoje) "" else " de " + Formato.diaCurto(local.toLocalDate())
            Text("Ela não entra em papo no grupo até $quando. Ainda responde quem chamar por ela.", style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp, bottom = 8.dp))
            Botao("Voltar a falar", Modifier.fillMaxWidth()) { mudar(JSONObject().put("silencioAte", JSONObject.NULL)) }
        } else {
            Text("Ela não entra em papo no grupo por um tempo. Ainda responde quem chamar por ela.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, modifier = Modifier.padding(top = 2.dp, bottom = 8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                opcoesSilencio.forEach { h ->
                    Chip(if (h == 1) "1 hora" else "$h horas", false, papel = Role.Button) {
                        mudar(JSONObject().put("silencioAte", Instant.now().plus(h.toLong(), ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS).toString()))
                    }
                }
            }
        }
    }
}

/** Rótulo de cada campo do /sistema/status (o resto aparece com o nome do campo). */
// as chaves do GET /sistema/status (api-lacunas-montadores.montarStatus); as antigas ficam para servidor mais velho
private val rotulosStatus = mapOf(
    "uptimeMin" to "No ar há", "uptime" to "No ar há", "dia" to "Dia", "mensagensHoje" to "Mensagens hoje",
    "chamadas" to "Chamadas à IA", "tokensEntrada" to "Lido pela IA", "tokensCache" to "Reaproveitado", "tokensSaida" to "Escrito pela IA",
    "tokens" to "Tokens", "modelos" to "Modelos", "castigos" to "Modelos em pausa", "reservas" to "Modelos reserva",
    "voz" to "Voz", "revisoes" to "Revisões", "whatsapp" to "WhatsApp", "gemini" to "IA", "estado" to "Conexão",
    "desconectadoHaMin" to "Fora do ar há", "hoje" to "Hoje", "erros" to "Erros", "fila" to "Na fila",
)

/** Segundos no ar como "3 dias 4 h" ou "2 h 10 min". */
private fun duracao(seg: Double): String {
    val m = (seg / 60).toLong()
    return when {
        m < 60 -> "$m min"
        m < 60 * 24 -> "${m / 60} h ${m % 60} min"
        else -> "${m / (60 * 24)} dias ${m / 60 % 24} h"
    }
}

/** A lista de modelos do status: cada um pelo nome, livre ou em pausa. */
private fun modelosStatus(v: JSONArray): String = (0 until v.length()).mapNotNull { i ->
    when (val m = v.opt(i)) {
        is JSONObject -> m.optString("modelo").takeIf { it.isNotBlank() }?.let { nome -> if (m.optBoolean("livre", true)) "$nome (livre)" else "$nome (em pausa)" }
        is String -> m
        else -> null
    }
}.joinToString(", ").ifBlank { "${v.length()}" }

/** Um valor do status em texto curto: número com separador, lista vira "a, b, c" (ou a contagem), objeto vira a contagem. */
private fun valorStatus(chave: String, v: Any?): String? = when (v) {
    null, JSONObject.NULL -> null
    is Boolean -> if (v) "sim" else "não"
    is Number -> when (chave) {
        "uptime" -> duracao(v.toDouble())
        "uptimeMin" -> duracao(v.toDouble() * 60)
        "desconectadoHaMin" -> if (v.toDouble() <= 0) null else duracao(v.toDouble() * 60) // conectado: a linha some
        else -> Formato.inteiro(v.toDouble())
    }
    // modelos: { modelo, papel, livre, voltaEm } vira "nome (livre)" ou "nome (em pausa)"
    is JSONArray -> if (v.length() == 0) "nenhum" else if (chave == "modelos") modelosStatus(v) else (0 until v.length()).map { v.opt(it) }.filter { it is String || it is Number }.takeIf { it.size == v.length() && it.size <= 4 }?.joinToString(", ") ?: "${v.length()}"
    is JSONObject -> "${v.length()}"
    else -> v.toString().takeIf { it.isNotBlank() }?.take(60)
}

/** A saúde do bot sem layout fixo: cada campo simples numa linha; objetos (ex.: gemini) abrem um nível, com o nome em pílula. */
@Composable
private fun StatusBot(s: JSONObject) {
    val chaves = s.keys().asSequence().toList()
    if (chaves.isEmpty()) { Text("Sem informações agora.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3); return }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        chaves.filter { s.opt(it) !is JSONObject }.forEach { k -> valorStatus(k, s.opt(k))?.let { LinhaValor(rotulosStatus[k] ?: k, it) } }
        chaves.filter { s.opt(it) is JSONObject }.forEach { k ->
            val o = s.optJSONObject(k) ?: return@forEach
            Pilula(rotulosStatus[k] ?: k, Cores.Trilho, Cores.LilasTexto, Modifier.padding(top = 8.dp, bottom = 2.dp))
            o.keys().asSequence().toList().forEach { sub -> valorStatus(sub, o.opt(sub))?.let { LinhaValor(rotulosStatus[sub] ?: sub, it) } }
        }
    }
}
