package br.nutribot.relogio.dados.api

import br.nutribot.relogio.BuildConfig
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

/**
 * Erro da API v1. O servidor responde `{ "erro": { "codigo", "mensagem" } }` com o status HTTP (400, 401, 403, 404, 429, 500, 503).
 * status = 0 quando nem chegou resposta (sem rede, servidor dormindo além do prazo).
 */
class ErroApi(val status: Int, val codigo: String, mensagem: String) : Exception(mensagem) {
    /** Sem rede ou servidor fora do ar/acordando: o app mostra o que tem guardado e tenta de novo. */
    val semConexao: Boolean get() = status == 0 || status == 502 || status == 503 || status == 504
    val naoAutorizado: Boolean get() = status == 401

    /** Texto para a pessoa (em português, sem jargão). */
    val paraPessoa: String
        get() = when {
            codigo == "url_insegura" || codigo == "url_invalida" || codigo == "token_local" -> message ?: "Erro no aparelho."
            status in 300..399 -> "O endereço do servidor redirecionou. Confira o endereço."
            status == 0 && codigo == "tempo_esgotado" -> "O servidor não respondeu. Tente de novo."
            status == 0 -> "Sem conexão. Confira a internet."
            codigo == "grafico_indisponivel" -> "O gráfico não saiu. Tente de novo."
            status == 503 || status == 502 || status == 504 -> "Acordando o servidor. Tente de novo em instantes."
            status == 401 -> "Este celular foi desconectado. Mande !app no privado do bot para ligar de novo."
            status == 403 -> "Este celular não pode ver esse perfil."
            status == 404 -> "Ainda não há esses dados."
            status == 429 -> "Muitas tentativas. Espere um pouco."
            else -> message?.takeIf { it.isNotBlank() } ?: "Erro $status no servidor."
        }
}

/**
 * Cliente HTTP da API v1 (`/api/v1`), com HttpURLConnection e org.json do próprio Android (sem dependência nova).
 * Prazos de 90 s: o Render grátis dorme e pode levar perto de 1 minuto para acordar.
 */
object Api {
    private const val PRAZO_MS = 90_000

    /** A base da API a partir do endereço do Relógio (".../relogio" vira ".../api/v1"). */
    fun baseDe(urlRelogio: String): String {
        val u = urlRelogio.trim().trimEnd('/')
        if (u.isEmpty()) return "https://nutribot-5gwk.onrender.com/api/v1"
        if (u.endsWith("/api/v1")) return u
        val raiz = u.replace(Regex("/relogio$"), "").replace(Regex("/nota$"), "")
        return "$raiz/api/v1"
    }

    /** Só https: o token do aparelho nunca sai por http nem para outro endereço por redirecionamento. */
    fun ehSeguro(url: String): Boolean = url.trim().startsWith("https://", ignoreCase = true)

    fun get(base: String, caminho: String, token: String?): JSONObject = pedirJson("GET", base, caminho, token, null)

    fun post(base: String, caminho: String, token: String?, corpo: JSONObject): JSONObject = pedirJson("POST", base, caminho, token, corpo)

    /** Alterar (o HttpURLConnection do Android não manda PATCH; o servidor aceita PUT com só os campos que mudaram). */
    fun put(base: String, caminho: String, token: String?, corpo: JSONObject): JSONObject = pedirJson("PUT", base, caminho, token, corpo)

    /** Apagar: sem corpo; a resposta é `{ apagada: true, ... }`. */
    fun delete(base: String, caminho: String, token: String?): JSONObject = pedirJson("DELETE", base, caminho, token, null)

    /**
     * GET de um arquivo binário (2.3: o gráfico da Nutri em `/perfis/:id/grafico.png`). Mesmos prazos e tratamento de erro do
     * JSON: fora de 2xx o corpo é o `{ erro }` de sempre (503 grafico_indisponivel, 401, 404).
     */
    fun getBytes(base: String, caminho: String, token: String?): ByteArray =
        pedir("GET", base, caminho, token, null, aceita = "image/png") { _, entrada -> entrada.readBytes() }

    private fun pedirJson(metodo: String, base: String, caminho: String, token: String?, corpo: JSONObject?): JSONObject =
        pedir(metodo, base, caminho, token, corpo) { status, entrada ->
            val texto = entrada.bufferedReader(Charsets.UTF_8).use { it.readText() }
            try {
                if (texto.isBlank()) JSONObject() else JSONObject(texto)
            } catch (e: Exception) {
                throw ErroApi(status, "resposta_invalida", "Resposta inesperada do servidor.")
            }
        }

    private fun <T> pedir(metodo: String, base: String, caminho: String, token: String?, corpo: JSONObject?, aceita: String = "application/json", ler: (Int, InputStream) -> T): T {
        val url = base.trimEnd('/') + (if (caminho.startsWith("/")) caminho else "/$caminho")
        if (!ehSeguro(url)) throw ErroApi(0, "url_insegura", "O endereço do servidor precisa começar com https://.")
        val con = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw ErroApi(0, "url_invalida", "Endereço inválido: $url")
        }
        try {
            con.requestMethod = metodo
            con.instanceFollowRedirects = false // um redirecionamento não leva o Bearer para outro host
            con.connectTimeout = PRAZO_MS
            con.readTimeout = PRAZO_MS
            con.setRequestProperty("Accept", aceita)
            con.setRequestProperty("User-Agent", "NutriBot-App/" + BuildConfig.VERSION_NAME)
            if (!token.isNullOrBlank()) con.setRequestProperty("Authorization", "Bearer $token")
            if (corpo != null) {
                con.doOutput = true
                con.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                con.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = con.responseCode
            if (status in 200..299) return con.inputStream.use { ler(status, it) }
            val texto = con.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val erro = runCatching { JSONObject(texto).optJSONObject("erro") }.getOrNull()
            throw ErroApi(
                status,
                erro?.optString("codigo")?.takeIf { it.isNotBlank() } ?: "http_$status",
                erro?.optString("mensagem")?.takeIf { it.isNotBlank() } ?: "HTTP $status",
            )
        } catch (e: ErroApi) {
            throw e
        } catch (e: SocketTimeoutException) {
            throw ErroApi(0, "tempo_esgotado", "O servidor não respondeu.")
        } catch (e: UnknownHostException) {
            throw ErroApi(0, "sem_rede", "Sem internet.")
        } catch (e: ConnectException) {
            throw ErroApi(0, "sem_rede", "Não consegui conectar ao servidor.")
        } catch (e: IOException) {
            throw ErroApi(0, "sem_rede", e.message ?: "Falha de rede.")
        } finally {
            con.disconnect()
        }
    }
}
