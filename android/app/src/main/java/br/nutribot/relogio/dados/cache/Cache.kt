package br.nutribot.relogio.dados.cache

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Cache local simples: um arquivo JSON por rota da API em filesDir/cache_api. Serve para abrir o app sem rede e
 * para mostrar algo enquanto o servidor acorda. Sem Room nesta fase.
 * 2.3: imagens (o gráfico da Nutri) ficam como bytes em cacheDir/cache_imagens, que o sistema pode limpar quando faltar espaço.
 */
class Cache(context: Context) {
    private val pasta = File(context.filesDir, "cache_api").apply { mkdirs() }
    private val pastaImagens = File(context.cacheDir, "cache_imagens")

    data class Entrada(val dados: JSONObject, val salvoEm: Long)

    data class Bytes(val dados: ByteArray, val salvoEm: Long)

    private fun nome(chave: String): String {
        val limpo = chave.replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)
        val hash = MessageDigest.getInstance("SHA-1").digest(chave.toByteArray()).take(4).joinToString("") { "%02x".format(it) }
        return "${limpo}_$hash"
    }

    private fun arquivo(chave: String): File = File(pasta, nome(chave) + ".json")

    private fun arquivoBytes(chave: String): File = File(pastaImagens, nome(chave) + ".bin")

    /** Os bytes guardados de uma rota e quando foram gravados (data do arquivo), ou null. */
    fun lerBytes(chave: String): Bytes? = try {
        val f = arquivoBytes(chave)
        if (!f.exists()) null else Bytes(f.readBytes(), f.lastModified())
    } catch (e: Exception) {
        null
    }

    fun salvarBytes(chave: String, dados: ByteArray) {
        try {
            pastaImagens.mkdirs()
            val f = arquivoBytes(chave)
            val tmp = File(f.path + ".tmp")
            tmp.writeBytes(dados)
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
        } catch (_: Exception) {
            // cache é só conveniência: falhar ao gravar não pode derrubar a tela
        }
    }

    fun ler(chave: String): Entrada? = try {
        val f = arquivo(chave)
        if (!f.exists()) null else {
            val j = JSONObject(f.readText(Charsets.UTF_8))
            Entrada(j.getJSONObject("dados"), j.optLong("salvoEm", f.lastModified()))
        }
    } catch (e: Exception) {
        null
    }

    fun salvar(chave: String, dados: JSONObject, agora: Long = System.currentTimeMillis()) {
        try {
            val f = arquivo(chave)
            val tmp = File(f.path + ".tmp")
            tmp.writeText(JSONObject().put("salvoEm", agora).put("dados", dados).toString(), Charsets.UTF_8)
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
        } catch (_: Exception) {
            // cache é só conveniência: falhar ao gravar não pode derrubar a tela
        }
    }

    /** Apaga uma rota (depois de uma escrita: o que estava guardado ficou velho). */
    fun apagar(chave: String) {
        runCatching { arquivo(chave).delete() }
        runCatching { arquivoBytes(chave).delete() }
    }

    /** Apaga tudo (ao desparear: os dados das pessoas não ficam no aparelho sem token). */
    fun limpar() {
        pasta.listFiles()?.forEach { it.delete() }
        pastaImagens.listFiles()?.forEach { it.delete() }
    }
}
