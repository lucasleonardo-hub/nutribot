package br.nutribot.relogio

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.Period
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Lê o Health Connect e monta o JSON que o bot espera em POST /relogio. */
object Leitor {
    val permissoes: Set<String> = setOf(
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(BodyFatRecord::class),
        HealthPermission.getReadPermission(LeanBodyMassRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND,
    )

    fun disponivel(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    suspend fun concedidas(context: Context): Set<String> =
        HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()

    /** Últimos `dias` dias (o servidor funde por dia, então mandar de novo o mesmo dia não duplica nada). */
    suspend fun ler(context: Context, pessoa: String, dias: Long): JSONObject {
        val client = HealthConnectClient.getOrCreate(context)
        val zona = ZoneId.systemDefault()
        val agora = Instant.now()
        val inicio = agora.minus(Duration.ofDays(dias))
        val faixa = TimeRangeFilter.between(inicio, agora)
        val iso = DateTimeFormatter.ISO_INSTANT

        val pesos = JSONArray()
        val gorduraPorHora = HashMap<Long, Double>()
        val magraPorHora = HashMap<Long, Double>()
        for (r in client.readRecords(ReadRecordsRequest(BodyFatRecord::class, faixa)).records) {
            gorduraPorHora[r.time.epochSecond / 3600] = r.percentage.value
        }
        for (r in client.readRecords(ReadRecordsRequest(LeanBodyMassRecord::class, faixa)).records) {
            magraPorHora[r.time.epochSecond / 3600] = r.mass.inKilograms
        }
        for (r in client.readRecords(ReadRecordsRequest(WeightRecord::class, faixa)).records) {
            val h = r.time.epochSecond / 3600
            pesos.put(JSONObject().apply {
                put("t", iso.format(r.time))
                put("kg", arred(r.weight.inKilograms, 2))
                gorduraPorHora[h]?.let { put("gordura", arred(it, 1)) }
                magraPorHora[h]?.let { put("magra", arred(it, 2)) }
                put("fonte", r.metadata.dataOrigin.packageName)
            })
        }

        val sonos = JSONArray()
        for (r in client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, faixa)).records) {
            var leve = 0L; var profundo = 0L; var rem = 0L; var acordado = 0L
            for (s in r.stages) {
                val min = Duration.between(s.startTime, s.endTime).toMinutes()
                when (s.stage) {
                    SleepSessionRecord.STAGE_TYPE_LIGHT, SleepSessionRecord.STAGE_TYPE_SLEEPING -> leve += min
                    SleepSessionRecord.STAGE_TYPE_DEEP -> profundo += min
                    SleepSessionRecord.STAGE_TYPE_REM -> rem += min
                    SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> acordado += min
                    else -> {}
                }
            }
            sonos.put(JSONObject().apply {
                put("inicio", iso.format(r.startTime))
                put("fim", iso.format(r.endTime))
                put("leve", leve); put("profundo", profundo); put("rem", rem); put("acordado", acordado)
                put("fonte", r.metadata.dataOrigin.packageName)
            })
        }

        // passos e gasto total por dia (agregados pelo próprio Health Connect, sem duplicar fontes)
        val diasJson = JSONArray()
        val hoje = LocalDate.now(zona)
        val inicioDia = LocalDateTime.of(hoje.minusDays(dias), LocalTime.MIDNIGHT)
        val fimDia = LocalDateTime.of(hoje.plusDays(1), LocalTime.MIDNIGHT)
        val porDia = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL, TotalCaloriesBurnedRecord.ENERGY_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(inicioDia, fimDia),
                timeRangeSlicer = Period.ofDays(1),
            )
        )
        // Batimento de repouso por dia. O Samsung Health não grava o registro "de repouso" pronto no Health Connect,
        // só a série contínua: então calculamos aqui = média dos 20% menores batimentos durante o sono da noite
        // (ou dos 10% menores do dia inteiro quando não há sono registrado). Se existir o registro pronto, ele vence.
        val fcPorDia = HashMap<LocalDate, Long>()
        for (r in client.readRecords(ReadRecordsRequest(RestingHeartRateRecord::class, faixa)).records) {
            fcPorDia[r.time.atZone(zona).toLocalDate()] = r.beatsPerMinute
        }
        val amostrasPorDia = HashMap<LocalDate, MutableList<Pair<Instant, Long>>>()
        for (r in client.readRecords(ReadRecordsRequest(HeartRateRecord::class, faixa)).records) {
            for (s in r.samples) amostrasPorDia.getOrPut(s.time.atZone(zona).toLocalDate()) { ArrayList() }.add(s.time to s.beatsPerMinute)
        }
        val sessoesSono = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, faixa)).records
        for ((dia, amostras) in amostrasPorDia) {
            if (fcPorDia.containsKey(dia) || amostras.size < 10) continue
            val noite = sessoesSono.filter { it.endTime.atZone(zona).toLocalDate() == dia }.maxByOrNull { Duration.between(it.startTime, it.endTime) }
            val base = if (noite != null) {
                val dentro = amostras.filter { !it.first.isBefore(noite.startTime) && !it.first.isAfter(noite.endTime) }.map { it.second }
                if (dentro.size >= 10) dentro.sorted().let { it.take(maxOf(3, it.size / 5)) } else null
            } else null
            val menores = base ?: amostras.map { it.second }.sorted().let { it.take(maxOf(3, it.size / 10)) }
            val repouso = Math.round(menores.average())
            if (repouso in 30..120) fcPorDia[dia] = repouso
        }
        val hrvPorDia = HashMap<LocalDate, MutableList<Double>>()
        for (r in client.readRecords(ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, faixa)).records) {
            hrvPorDia.getOrPut(r.time.atZone(zona).toLocalDate()) { ArrayList() }.add(r.heartRateVariabilityMillis)
        }
        for (g in porDia) {
            val dia = g.startTime.toLocalDate()
            val passos = g.result[StepsRecord.COUNT_TOTAL]
            val kcal = g.result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories
            val hrv = hrvPorDia[dia]?.takeIf { it.isNotEmpty() }?.average()
            if (passos == null && kcal == null && fcPorDia[dia] == null && hrv == null) continue
            diasJson.put(JSONObject().apply {
                put("dia", dia.toString())
                passos?.let { put("passos", it) }
                kcal?.let { put("calorias", arred(it, 0)) }
                fcPorDia[dia]?.let { put("fcRepouso", it) }
                hrv?.let { put("hrv", arred(it, 0)) }
            })
        }

        val treinos = JSONArray()
        for (r in client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, faixa)).records) {
            // média de batimentos na sessão (passeio ou esforço de verdade?), pelo agregado do próprio Health Connect
            val fcMedia = runCatching {
                client.aggregate(AggregateRequest(setOf(HeartRateRecord.BPM_AVG), TimeRangeFilter.between(r.startTime, r.endTime)))[HeartRateRecord.BPM_AVG]
            }.getOrNull()
            treinos.put(JSONObject().apply {
                put("inicio", iso.format(r.startTime))
                put("fim", iso.format(r.endTime))
                put("tipo", r.title?.takeIf { it.isNotBlank() } ?: nomeDoTipo(r.exerciseType))
                put("fonte", r.metadata.dataOrigin.packageName)
                fcMedia?.let { put("fcMedia", it) }
            })
        }

        return JSONObject().apply {
            put("pessoa", pessoa)
            put("app", "relogio/" + BuildConfig.VERSION_NAME)
            put("fuso", zona.id)
            put("enviadoEm", iso.format(agora))
            put("pesos", pesos); put("sonos", sonos); put("dias", diasJson); put("treinos", treinos)
        }
    }

    private fun arred(v: Double, casas: Int): Double {
        var f = 1.0
        repeat(casas) { f *= 10 }
        return Math.round(v * f) / f
    }

    private fun nomeDoTipo(tipo: Int): String = when (tipo) {
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "Musculação"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Musculação"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "Corrida"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Corrida (esteira)"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Caminhada"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Trilha"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "Bicicleta"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Bicicleta ergométrica"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Natação"
        ExerciseSessionRecord.EXERCISE_TYPE_VOLLEYBALL -> "Vôlei"
        ExerciseSessionRecord.EXERCISE_TYPE_SOCCER -> "Futebol"
        ExerciseSessionRecord.EXERCISE_TYPE_BASKETBALL -> "Basquete"
        ExerciseSessionRecord.EXERCISE_TYPE_TENNIS -> "Tênis"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "HIIT"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "Elíptico"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING, ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "Remo"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_PILATES -> "Pilates"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING, ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE -> "Escada"
        ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS -> "Calistenia"
        ExerciseSessionRecord.EXERCISE_TYPE_BOXING -> "Boxe"
        ExerciseSessionRecord.EXERCISE_TYPE_MARTIAL_ARTS -> "Luta"
        ExerciseSessionRecord.EXERCISE_TYPE_DANCING -> "Dança"
        ExerciseSessionRecord.EXERCISE_TYPE_SURFING -> "Surfe"
        ExerciseSessionRecord.EXERCISE_TYPE_SKATING -> "Patins/skate"
        ExerciseSessionRecord.EXERCISE_TYPE_EXERCISE_CLASS -> "Aula"
        else -> "Exercício (tipo $tipo)"
    }
}
