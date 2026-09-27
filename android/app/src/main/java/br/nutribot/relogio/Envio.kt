package br.nutribot.relogio

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** POST do JSON pro bot. Devolve o texto da resposta (JSON do servidor) ou lança com a mensagem de erro. */
object Envio {
    fun enviar(url: String, token: String, corpo: JSONObject): String {
        val con = URL(url).openConnection() as HttpURLConnection
        try {
            con.requestMethod = "POST"
            con.connectTimeout = 20_000
            con.readTimeout = 90_000 // o Render grátis pode estar dormindo e demorar pra acordar
            con.doOutput = true
            con.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            con.setRequestProperty("x-relogio-token", token)
            con.setRequestProperty("User-Agent", "NutriBot-Relogio/" + BuildConfig.VERSION_NAME)
            con.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
            val codigo = con.responseCode
            val texto = (if (codigo in 200..299) con.inputStream else con.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (codigo !in 200..299) throw IllegalStateException("HTTP $codigo: ${texto.take(200)}")
            return texto
        } finally {
            con.disconnect()
        }
    }
}
