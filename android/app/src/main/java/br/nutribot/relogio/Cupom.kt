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
    // desafio anti-robô (Cloudflare Turnstile e parentes), em inglês e em português
    private val RE_DESAFIO = Regex("(SecurityVerify|turnstile|Verificando|verifying|cf-chl|Checking your browser|humano|human|Confirme|Um momento|Just a moment|cloudflare|captcha|challenge|Ray ID)", RegexOption.IGNORE_CASE)

    fun chaveDe(texto: String?): String? = texto?.replace(" ", "")?.let { RE_CHAVE.find(it)?.value }
    fun ehLinkDeNota(texto: String?): Boolean = texto != null && texto.startsWith("http", ignoreCase = true) && chaveDe(texto) != null

    /**
     * Abre o link no WebView e devolve o texto da nota via callback pronto(texto, pagina): texto = nota lida, ou null se não veio
     * em 150 s (aí `pagina` traz o que a tela mostrava, pro diagnóstico). mostrar() é chamado quando a nota não vem em 5 s:
     * a página fica visível pra pessoa ver o que há (desafio pra tocar, erro da SEFAZ, nota carregando).
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun ler(web: WebView, url: String, mostrar: () -> Unit, progresso: (String) -> Unit, pronto: (String?, String?) -> Unit) {
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
                val desafio = RE_DESAFIO.containsMatchIn(texto)
                when {
                    RE_NOTA.containsMatchIn(texto) && texto.length > 200 -> { terminou = true; pronto(texto, null) }
                    passou > 150_000 -> { terminou = true; pronto(null, texto) }
                    else -> {
                        // 1.6: a nota não veio em 5 s? mostra a página seja o que for (desafio pra tocar, erro, carregando): escondida ninguém resolve
                        if (!mostrado && passou > 5_000) { mostrado = true; mostrar() }
                        progresso(
                            when {
                                desafio -> "A SEFAZ pediu uma confirmação: toque na caixa que apareceu abaixo. ${passou / 1000}s"
                                mostrado && texto.length < 80 -> "A página da SEFAZ ainda está em branco... ${passou / 1000}s"
                                mostrado -> "A página abriu, mas a nota ainda não apareceu. Se pedir confirmação, toque nela. ${passou / 1000}s"
                                else -> "Abrindo a nota na SEFAZ... ${passou / 1000}s"
                            }
                        )
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

    /** Quando a página não virou nota: manda ao bot o motivo e o começo do que a tela mostrava (fica 3 dias no servidor pra diagnóstico). */
    fun enviarDiagnostico(urlRelogio: String, token: String, pessoa: String, chave: String?, link: String, pagina: String, motivo: String): String {
        val url = urlRelogio.replace(Regex("/relogio/?$"), "/nota")
        val corpo = JSONObject().apply {
            put("pessoa", pessoa)
            put("app", "relogio/" + BuildConfig.VERSION_NAME)
            put("diagnostico", true)
            put("motivo", motivo)
            put("chave", chave ?: JSONObject.NULL)
            put("url", link)
            put("texto", pagina.take(4000))
        }
        return Envio.enviar(url, token, corpo)
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
