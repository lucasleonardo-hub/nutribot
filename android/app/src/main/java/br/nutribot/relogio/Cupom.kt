package br.nutribot.relogio

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * Cupom do mercado (NFC-e): o QR traz um link da SEFAZ. Pelo servidor esse link cai na verificação anti-robô do site; pelo
 * celular abre normal, porque é um navegador de verdade. Então o app abre o link num WebView, espera a página da nota
 * aparecer (a verificação invisível roda sozinha; se pedir um toque, o WebView é mostrado pra pessoa tocar) e manda o
 * TEXTO da página pro bot, que extrai os itens. Nada é resolvido "por fora": é a própria pessoa abrindo a própria nota.
 */
object Cupom {
    private val RE_CHAVE = Regex("\\d{44}")
    // sinais de que a página da nota carregou (modelo usado por SC, SP, RS, PR, MG...)
    private val RE_NOTA = Regex("(Qtde\\.?|Quantidade|Vl\\. ?Unit|Valor unit|Vl\\. ?Total|Código:)", RegexOption.IGNORE_CASE)
    private val RE_DESAFIO = Regex("(SecurityVerify|turnstile|Verificando|verifying|cf-chl|Checking your browser)", RegexOption.IGNORE_CASE)

    fun chaveDe(texto: String?): String? = texto?.replace(" ", "")?.let { RE_CHAVE.find(it)?.value }
    fun ehLinkDeNota(texto: String?): Boolean = texto != null && texto.startsWith("http", ignoreCase = true) && chaveDe(texto) != null

    /**
     * Abre o link no WebView e devolve o texto da nota via callback (ou null se não veio em 90 s).
     * mostrar() é chamado se a página pedir interação (checkbox): aí o WebView precisa ficar visível.
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun ler(web: WebView, url: String, mostrar: () -> Unit, progresso: (String) -> Unit, pronto: (String?) -> Unit) {
        val handler = Handler(Looper.getMainLooper())
        val inicio = System.currentTimeMillis()
        var terminou = false
        var mostrado = false
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.loadWithOverviewMode = true
        web.settings.useWideViewPort = true
        web.webViewClient = object : WebViewClient() {}
        fun conferir() {
            if (terminou) return
            web.evaluateJavascript("(function(){return document.body ? document.body.innerText : ''})()") { bruto ->
                val texto = decodificar(bruto)
                val passou = System.currentTimeMillis() - inicio
                when {
                    RE_NOTA.containsMatchIn(texto) && texto.length > 200 -> { terminou = true; pronto(texto) }
                    passou > 90_000 -> { terminou = true; pronto(null) }
                    else -> {
                        if (!mostrado && passou > 6_000 && (RE_DESAFIO.containsMatchIn(texto) || texto.length < 80)) {
                            mostrado = true
                            mostrar()
                            progresso("A SEFAZ pediu uma confirmação: toque na caixa que apareceu abaixo.")
                        } else if (!mostrado) progresso("Abrindo a nota na SEFAZ... ${passou / 1000}s")
                        handler.postDelayed({ conferir() }, 1500)
                    }
                }
            }
        }
        web.loadUrl(url)
        handler.postDelayed({ conferir() }, 2500)
    }

    /** evaluateJavascript devolve uma string JSON ("..." com escapes): desfaz. */
    private fun decodificar(bruto: String?): String {
        if (bruto == null || bruto == "null") return ""
        return try { JSONObject("{\"t\":$bruto}").getString("t") } catch (_: Exception) { bruto.trim('"') }
    }

    /** POST do texto da nota pro bot (rota /nota, mesmo token do relógio). Devolve o JSON de resposta. */
    fun enviar(urlRelogio: String, token: String, pessoa: String, chave: String?, link: String, texto: String): String {
        val url = urlRelogio.replace(Regex("/relogio/?$"), "/nota")
        val corpo = JSONObject().apply {
            put("pessoa", pessoa)
            put("app", "relogio/" + BuildConfig.VERSION_NAME)
            put("chave", chave ?: JSONObject.NULL)
            put("url", link)
            put("texto", texto.take(60_000))
        }
        return Envio.enviar(url, token, corpo)
    }
}
