package br.nutribot.relogio

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/**
 * Lê o Health Connect e manda pro bot. Roda a cada 15 min (mínimo do Android pra trabalho periódico) com internet,
 * e na hora quando a pessoa toca em "Sincronizar agora". Primeiro envio leva 14 dias; os seguintes, 3 (o servidor funde).
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        if (!prefs.configurado) return Result.success(workDataOf("msg" to "não configurado"))
        // periódico, "agora" e repetição podem cair juntos: se acabou de mandar (menos de 60 s), não manda de novo
        val manual = inputData.getBoolean("manual", false)
        if (!manual && System.currentTimeMillis() - prefs.ultimoEnvio < 60_000) return Result.success(workDataOf("msg" to "já enviado há pouco"))
        if (!Leitor.disponivel(applicationContext)) return falha(prefs, "Health Connect indisponível neste aparelho")
        val faltando = Leitor.permissoes - Leitor.concedidas(applicationContext)
        if (faltando.any { !it.endsWith("READ_HEALTH_DATA_IN_BACKGROUND") }) return falha(prefs, "faltam permissões do Health Connect (abra o app e toque em Permissões)")
        return try {
            val dias = if (prefs.ultimoEnvio == 0L) 14L else 3L
            val corpo = Leitor.ler(applicationContext, prefs.pessoa, dias)
            // localização aproximada, só se a pessoa ligou (botão 4) e deu a permissão; um ponto por envio
            if (prefs.localizacao && Local.temPermissao(applicationContext)) {
                val p = runCatching { Local.ponto(applicationContext) }.getOrNull()
                if (p != null) corpo.put("locais", Local.lista(p))
            }
            val resposta = Envio.enviar(prefs.url, prefs.token, corpo)
            val j = runCatching { JSONObject(resposta) }.getOrNull()
            val resumo = j?.optString("resumo")?.takeIf { it.isNotBlank() } ?: resposta.take(120)
            prefs.ultimoEnvio = System.currentTimeMillis()
            prefs.ultimoResultado = "OK ${hora()} · $resumo"
            Result.success(workDataOf("msg" to prefs.ultimoResultado))
        } catch (e: Exception) {
            val msg = e.message ?: e.javaClass.simpleName
            val semRede = e is UnknownHostException || e is SocketTimeoutException || e is ConnectException || msg.contains("HTTP 502") || msg.contains("HTTP 503")
            // sem rede ou servidor reiniciando: não é erro do app; tenta de novo em 2 min (até 5 vezes), e o status diz isso
            prefs.ultimoResultado = if (semRede) "SEM CONEXÃO ${hora()} · tento de novo em 2 min ($msg)" else "ERRO ${hora()} · $msg"
            if (runAttemptCount < (if (semRede) 5 else 3)) Result.retry() else falha(prefs, msg)
        }
    }

    private fun falha(prefs: Prefs, msg: String): Result {
        prefs.ultimoResultado = "ERRO ${hora()} · $msg"
        return Result.failure(workDataOf("msg" to msg))
    }

    private fun hora() = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date())

    companion object {
        private const val PERIODICO = "relogio-periodico"
        private const val AGORA = "relogio-agora"

        fun agendar(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 2, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODICO, ExistingPeriodicWorkPolicy.UPDATE, req)
        }

        fun agora(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 2, TimeUnit.MINUTES)
                .setInputData(workDataOf("manual" to true))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(AGORA, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
