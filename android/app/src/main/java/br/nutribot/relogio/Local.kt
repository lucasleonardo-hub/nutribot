package br.nutribot.relogio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.coroutines.resume

/**
 * Localização (opcional): um ponto por sincronização (a cada 15 min).
 * 1.3: primeiro tenta ALTA precisão (GNSS de dupla frequência, L1+L5, mais Wi-Fi) por até 25 s; ao ar livre dá poucos metros,
 * o suficiente pra separar o prédio de aula do restaurante da frente. Se não vier a tempo ou vier ruim (> 100 m), usa o modo
 * equilibrado (Wi-Fi/celular), que dentro de prédio é o que existe. Vai junto a precisão (acc), a velocidade (vel, m/s) e
 * a origem (prov), pro bot saber se o ponto é confiável e se a pessoa estava em movimento.
 * O bot agrupa os pontos em lugares (casa, trabalho, academia, restaurante) e apaga os pontos brutos em 7 dias.
 */
object Local {
    val permissoesBase = arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
    private const val BOA_M = 100f

    fun temPermissao(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun temPrecisa(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun temSegundoPlano(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Ponto atual como JSON {lat, lon, acc, vel, prov, ts}; null sem permissão ou sem posição utilizável. */
    suspend fun ponto(context: Context): JSONObject? {
        if (!temPermissao(context)) return null
        val cliente = LocationServices.getFusedLocationProviderClient(context)
        var origem = "alta"
        val loc: Location = try {
            var l: Location? = if (temPrecisa(context)) atual(cliente, Priority.PRIORITY_HIGH_ACCURACY, 25_000) else null
            if (l == null || (l.hasAccuracy() && l.accuracy > BOA_M)) {
                val eq = atual(cliente, Priority.PRIORITY_BALANCED_POWER_ACCURACY, 10_000)
                // fica com o melhor dos dois
                if (eq != null && (l == null || !l.hasAccuracy() || (eq.hasAccuracy() && eq.accuracy < l.accuracy))) { l = eq; origem = "equilibrada" }
            }
            if (l == null) { l = ultima(cliente); origem = "ultima" }
            l
        } catch (_: SecurityException) {
            null
        } ?: return null
        // último conhecido muito velho (celular parado há horas) não vale como "agora"
        if (System.currentTimeMillis() - loc.time > 30 * 60_000) return null
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return JSONObject().apply {
            put("lat", Math.round(loc.latitude * 1e6) / 1e6)
            put("lon", Math.round(loc.longitude * 1e6) / 1e6)
            put("acc", if (loc.hasAccuracy()) Math.round(loc.accuracy.toDouble()) else JSONObject.NULL)
            put("vel", if (loc.hasSpeed()) Math.round(loc.speed * 10.0) / 10.0 else JSONObject.NULL)
            put("prov", origem + (loc.provider?.let { "/$it" } ?: ""))
            put("ts", iso.format(Date(loc.time)))
        }
    }

    fun lista(vararg pontos: JSONObject?): JSONArray = JSONArray().apply { pontos.filterNotNull().forEach { put(it) } }

    /** Fix novo na prioridade pedida; null se não vier dentro do prazo. */
    private suspend fun atual(cliente: FusedLocationProviderClient, prioridade: Int, prazoMs: Long): Location? = withTimeoutOrNull(prazoMs) {
        suspendCancellableCoroutine<Location?> { cont ->
            val cts = CancellationTokenSource()
            cliente.getCurrentLocation(prioridade, cts.token)
                .addOnSuccessListener { l -> if (cont.isActive) cont.resume(l) }
                .addOnFailureListener { if (cont.isActive) cont.resume(null) }
            cont.invokeOnCancellation { cts.cancel() }
        }
    }

    /** Última posição conhecida pelo sistema (pode ser velha; quem chama confere a idade). */
    private suspend fun ultima(cliente: FusedLocationProviderClient): Location? = suspendCancellableCoroutine { cont ->
        cliente.lastLocation
            .addOnSuccessListener { l -> if (cont.isActive) cont.resume(l) }
            .addOnFailureListener { if (cont.isActive) cont.resume(null) }
    }
}
