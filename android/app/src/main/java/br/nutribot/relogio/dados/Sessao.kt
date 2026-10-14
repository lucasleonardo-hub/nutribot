package br.nutribot.relogio.dados

import android.content.Context
import br.nutribot.relogio.dados.api.Api
import br.nutribot.relogio.legado.Prefs

/**
 * Estado do app novo: endereço da API, token do aparelho (cifrado pelo Cofre) e perfil escolhido.
 * Fica num SharedPreferences próprio ("app"), separado do "relogio" do Relógio antigo, que segue intacto.
 */
class Sessao(context: Context) {
    private val sp = context.getSharedPreferences("app", Context.MODE_PRIVATE)
    private val legado = Prefs(context)

    /** Base da API v1. Padrão: derivada do endereço do Relógio (".../relogio" -> ".../api/v1"). */
    var base: String
        get() = sp.getString("base", null)?.takeIf { it.isNotBlank() } ?: Api.baseDe(legado.url)
        set(v) {
            // só https é aceito; um endereço http é ignorado (quem chama confere antes e avisa a pessoa)
            val b = Api.baseDe(v)
            if (Api.ehSeguro(b)) sp.edit().putString("base", b).apply()
        }

    val token: String?
        get() = Cofre.decifrar(sp.getString("token", null))

    fun guardarToken(token: String) {
        sp.edit().putString("token", Cofre.cifrar(token)).apply()
    }

    fun esquecerToken() {
        sp.edit().remove("token").apply()
    }

    var perfilAtivo: String?
        get() = sp.getString("perfil", null)
        set(v) = sp.edit().putString("perfil", v).apply()
}
