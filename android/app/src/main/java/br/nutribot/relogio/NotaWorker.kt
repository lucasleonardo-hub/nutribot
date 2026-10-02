package br.nutribot.relogio

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Envia a nota lida (texto da página da SEFAZ) pro bot em segundo plano, pelo WorkManager: continua com a tela apagada
 * e com o app fechado, e tenta de novo sozinho se a rede falhar. Na 1.4 o envio era feito na hora, preso à tela: a tela
 * apagou, o envio parou e a nota se perdeu. A nota fica guardada em Prefs.notaPendente até o servidor confirmar.
 */
class NotaWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        val pendente = prefs.notaPendente
        if (pendente.isBlank()) return Result.success(workDataOf("msg" to "nada pendente"))
        val j = runCatching { JSONObject(pendente) }.getOrNull()
        if (j == null) {
            prefs.notaPendente = ""
            return Result.success(workDataOf("msg" to "nota pendente inválida, descartada"))
        }
        return try {
            val resposta = Cupom.enviar(prefs.url, prefs.token, prefs.pessoa, j.optString("chave").takeIf { it.isNotBlank() }, j.optString("url"), j.optString("texto"))
            val resumo = runCatching { JSONObject(resposta).optString("resumo") }.getOrNull()?.takeIf { it.isNotBlank() } ?: resposta.take(160)
            prefs.notaPendente = ""
            prefs.notaResultado = "Cupom enviado ✅ ${hora()} · $resumo"
            Result.success(workDataOf("msg" to prefs.notaResultado))
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            val semRede = e is UnknownHostException || e is SocketTimeoutException || e is ConnectException || msg.contains("HTTP 502") || msg.contains("HTTP 503")
            if (runAttemptCount < (if (semRede) 6 else 2)) {
                prefs.notaResultado = "Cupom lido; aguardando conexão pra enviar (tentativa ${runAttemptCount + 1}: $msg)"
                Result.retry()
            } else {
                prefs.notaPendente = ""
                prefs.notaResultado = "Falha ao enviar o cupom ${hora()} · $msg. Manda a foto do cupom no grupo que o bot lê pela imagem."
                Result.failure(workDataOf("msg" to prefs.notaResultado))
            }
        }
    }

    private fun hora() = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date())

    companion object {
        const val NOME = "relogio-nota"

        /** Guarda a nota e agenda o envio (uma pendente por vez: a nova substitui a anterior). */
        fun enviar(context: Context, chave: String?, url: String, texto: String) {
            val prefs = Prefs(context)
            prefs.notaPendente = JSONObject().apply {
                put("chave", chave ?: "")
                put("url", url)
                put("texto", texto.take(60_000))
                put("lidaEm", System.currentTimeMillis())
            }.toString()
            prefs.notaResultado = "Nota lida (${texto.length} caracteres). Enviando pro bot em segundo plano: pode apagar a tela, ele avisa no grupo quando entrar."
            agendar(context)
        }

        /** (Re)agenda o envio da nota pendente, com internet; tenta de novo a cada minuto se falhar. */
        fun agendar(context: Context) {
            val req = OneTimeWorkRequestBuilder<NotaWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOME, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
