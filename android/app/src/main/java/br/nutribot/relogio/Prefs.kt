package br.nutribot.relogio

import android.content.Context

/** Configuração e estado do app (URL do bot, pessoa, token, último envio). */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("relogio", Context.MODE_PRIVATE)

    var url: String
        get() = sp.getString("url", "https://nutribot-5gwk.onrender.com/relogio") ?: ""
        set(v) = sp.edit().putString("url", v.trim()).apply()

    var pessoa: String
        get() = sp.getString("pessoa", "") ?: ""
        set(v) = sp.edit().putString("pessoa", v.trim()).apply()

    var token: String
        get() = sp.getString("token", "") ?: ""
        set(v) = sp.edit().putString("token", v.trim()).apply()

    var ultimoEnvio: Long
        get() = sp.getLong("ultimoEnvio", 0L)
        set(v) = sp.edit().putLong("ultimoEnvio", v).apply()

    var ultimoResultado: String
        get() = sp.getString("ultimoResultado", "") ?: ""
        set(v) = sp.edit().putString("ultimoResultado", v).apply()

    val configurado: Boolean get() = url.isNotBlank() && pessoa.isNotBlank() && token.isNotBlank()
}
