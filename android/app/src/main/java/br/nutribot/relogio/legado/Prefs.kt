package br.nutribot.relogio.legado

import android.content.Context
import br.nutribot.relogio.dados.Cofre

/** Configuração e estado do app (URL do bot, pessoa, token, último envio). */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("relogio", Context.MODE_PRIVATE)

    var url: String
        get() = sp.getString("url", "https://nutribot-5gwk.onrender.com/relogio") ?: ""
        set(v) = sp.edit().putString("url", v.trim()).apply()

    var pessoa: String
        get() = sp.getString("pessoa", "") ?: ""
        set(v) = sp.edit().putString("pessoa", v.trim()).apply()

    /**
     * Token do Relógio (x-relogio-token), guardado cifrado pelo Cofre (a mesma chave AES do Keystore do token do app),
     * com o prefixo "cofre:" para não confundir com o valor antigo em texto puro. Um valor antigo é devolvido como está e
     * regravado cifrado uma vez (migração transparente na 2.1). Ler e gravar passam pelo Keystore: chame fora da thread principal.
     */
    var token: String
        get() {
            val guardado = sp.getString("token", "") ?: ""
            if (guardado.isBlank()) return ""
            if (guardado.startsWith(PREFIXO_COFRE)) return Cofre.decifrar(guardado.removePrefix(PREFIXO_COFRE)) ?: ""
            // valor antigo em texto puro: migra para cifrado (se o Keystore falhar agora, fica como está e tenta na próxima leitura)
            runCatching { sp.edit().putString("token", PREFIXO_COFRE + Cofre.cifrar(guardado)).apply() }
            return guardado
        }
        set(v) {
            val limpo = v.trim()
            if (limpo.isBlank()) { sp.edit().putString("token", "").apply(); return }
            val cifrado = runCatching { PREFIXO_COFRE + Cofre.cifrar(limpo) }.getOrElse { limpo }
            sp.edit().putString("token", cifrado).apply()
        }

    var ultimoEnvio: Long
        get() = sp.getLong("ultimoEnvio", 0L)
        set(v) = sp.edit().putLong("ultimoEnvio", v).apply()

    var ultimoResultado: String
        get() = sp.getString("ultimoResultado", "") ?: ""
        set(v) = sp.edit().putString("ultimoResultado", v).apply()

    /** Localização ligada pela pessoa (botão 4). Desligada por padrão. */
    var localizacao: Boolean
        get() = sp.getBoolean("localizacao", false)
        set(v) = sp.edit().putBoolean("localizacao", v).apply()

    /** Nota do cupom lida e ainda não confirmada pelo bot (JSON: chave, url, texto). O NotaWorker envia e limpa. */
    var notaPendente: String
        get() = sp.getString("notaPendente", "") ?: ""
        set(v) = sp.edit().putString("notaPendente", v).apply()

    /** Último estado do envio da nota (pra tela). */
    var notaResultado: String
        get() = sp.getString("notaResultado", "") ?: ""
        set(v) = sp.edit().putString("notaResultado", v).apply()

    /** URL, nome e token preenchidos (confere só se HÁ token guardado, sem decifrar: serve na thread principal). */
    val configurado: Boolean get() = url.isNotBlank() && pessoa.isNotBlank() && !(sp.getString("token", "") ?: "").isBlank()

    private companion object {
        const val PREFIXO_COFRE = "cofre:"
    }
}
