package br.nutribot.relogio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
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
 * Localização aproximada (opcional): um ponto por sincronização (a cada 15 min), com precisão de quarteirão.
 * O bot agrupa os pontos em lugares (casa, trabalho, academia, restaurante) e apaga os pontos brutos em 7 dias.
 * Só roda se a pessoa ligou no botão 4 e concedeu a permissão "o tempo todo".
 */
object Local {
    val permissoesBase = arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)

    fun temPermissao(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun temSegundoPlano(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Ponto atual (ou o último conhecido) como JSON {lat, lon, acc, ts}; null sem permissão ou sem fix em 25 s. */
    suspend fun ponto(context: Context): JSONObject? {
        if (!temPermissao(context)) return null
        val cliente = LocationServices.getFusedLocationProviderClient(context)
        val loc = try {
            withTimeoutOrNull(25_000) {
                suspendCancellableCoroutine { cont ->
                    val cts = CancellationTokenSource()
                    cliente.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.token)
                        .addOnSuccessListener { l -> if (cont.isActive) cont.resume(l) }
                        .addOnFailureListener { if (cont.isActive) cont.resume(null) }
                    cont.invokeOnCancellation { cts.cancel() }
                }
            } ?: suspendCancellableCoroutine { cont ->
                cliente.lastLocation
                    .addOnSuccessListener { l -> if (cont.isActive) cont.resume(l) }
                    .addOnFailureListener { if (cont.isActive) cont.resume(null) }
            }
        } catch (_: SecurityException) {
            null
        } ?: return null
        // último conhecido muito velho (celular parado há horas) não vale como "agora"
        if (System.currentTimeMillis() - loc.time > 30 * 60_000) return null
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return JSONObject().apply {
            put("lat", Math.round(loc.latitude * 1e5) / 1e5)
            put("lon", Math.round(loc.longitude * 1e5) / 1e5)
            put("acc", if (loc.hasAccuracy()) Math.round(loc.accuracy.toDouble()) else JSONObject.NULL)
            put("ts", iso.format(Date(loc.time)))
        }
    }

    fun lista(vararg pontos: JSONObject?): JSONArray = JSONArray().apply { pontos.filterNotNull().forEach { put(it) } }
}
