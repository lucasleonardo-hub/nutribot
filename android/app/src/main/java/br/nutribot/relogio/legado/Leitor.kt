package br.nutribot.relogio.legado
import br.nutribot.relogio.BuildConfig

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SkinTemperatureRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
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
import java.time.temporal.ChronoUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlin.reflect.KClass

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

    // Fase 7 (seção 7 do plano da fase 6, autorizadas pelo dono em 15/10): as quatro permissões novas são OPCIONAIS e ficam
    // fora de `permissoes` de propósito. O SyncWorker e a MainActivity tratam `permissoes` como obrigatórias (faltou uma, o
    // envio nem sai); quem não der estas continua mandando todo o resto. A tela Integrações pede todas juntas.
    private val PERM_DISTANCIA = HealthPermission.getReadPermission(DistanceRecord::class)
    private val PERM_KCAL_ATIVAS = HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)
    private val PERM_OXIGENIO = HealthPermission.getReadPermission(OxygenSaturationRecord::class)
    private val PERM_TEMPERATURA = HealthPermission.getReadPermission(SkinTemperatureRecord::class)

    /** Distância, calorias ativas e oxigênio no sangue: existem em todo Health Connect com o connect-client 1.1.0. */
    val permissoesNovas: Set<String> = setOf(PERM_DISTANCIA, PERM_KCAL_ATIVAS, PERM_OXIGENIO)

    /** A temperatura da pele depende de o Health Connect do aparelho ter o recurso (versões antigas não têm). */
    fun temTemperatura(context: Context): Boolean = opcional {
        HealthConnectClient.getOrCreate(context).features
            .getFeatureStatus(HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    } ?: false

    /** As opcionais que este aparelho pode dar (a temperatura só com o recurso). */
    fun permissoesOpcionais(context: Context): Set<String> =
        if (temTemperatura(context)) permissoesNovas + PERM_TEMPERATURA else permissoesNovas

    /** Tudo o que a tela Integrações pede de uma vez: as obrigatórias e as opcionais deste aparelho. */
    fun todasAsPermissoes(context: Context): Set<String> = permissoes + permissoesOpcionais(context)

    /** As opcionais que ainda faltam (vazio sem Health Connect ou se a consulta falhar: aí não há o que pedir). */
    suspend fun opcionaisFaltando(context: Context): Set<String> {
        if (!disponivel(context)) return emptySet()
        return opcional { permissoesOpcionais(context) - concedidas(context) } ?: emptySet()
    }

    /** Máximo de etapas por sessão de sono no envio (o contrato da fase 6 fixa 200). */
    private const val MAX_ETAPAS = 200

    /** Dias mais recentes que levam o detalhe por hora e os minutos ativos (hoje e os 13 anteriores). */
    private const val DIAS_DETALHE = 14L

    /** Cadência mínima (passos por minuto) para o minuto contar como ativo. */
    private const val CADENCIA_ATIVA = 60f

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
        // fase 7: o que a pessoa liberou das permissões opcionais. Cada leitura nova só roda com a sua permissão e dentro de
        // `opcional`: negada, revogada no meio ou com erro, o campo não vai e o resto do envio sai igual
        val dadas = opcional { client.permissionController.getGrantedPermissions() } ?: emptySet()
        val podeTemperatura = PERM_TEMPERATURA in dadas && temTemperatura(context)

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

        // Leituras feitas uma vez só e usadas em mais de um lugar (sono, repouso, dias, minutos ativos).
        val sessoesSono = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, faixa)).records
        val sessoesExercicio = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, faixa)).records
        val amostrasPorDia = HashMap<LocalDate, MutableList<Pair<Instant, Long>>>()
        for (r in lerTodos(client, HeartRateRecord::class, faixa)) {
            for (s in r.samples) amostrasPorDia.getOrPut(s.time.atZone(zona).toLocalDate()) { ArrayList() }.add(s.time to s.beatsPerMinute)
        }
        val registrosHrv = lerTodos(client, HeartRateVariabilityRmssdRecord::class, faixa)
        // séries ordenadas uma vez, para recortar por sessão de sono com busca binária
        val serieFc = amostrasPorDia.values.flatten().let { l ->
            Serie(LongArray(l.size) { l[it].first.toEpochMilli() }, DoubleArray(l.size) { l[it].second.toDouble() })
        }
        val serieHrv = Serie(
            LongArray(registrosHrv.size) { registrosHrv[it].time.toEpochMilli() },
            DoubleArray(registrosHrv.size) { registrosHrv[it].heartRateVariabilityMillis },
        )
        // fase 7 (opcionais): oxigênio no sangue (amostras pontuais) e temperatura da pele (registros com desvios da base)
        val serieSpo2: Serie? = if (PERM_OXIGENIO !in dadas) null else opcional {
            val regs = lerTodos(client, OxygenSaturationRecord::class, faixa)
            Serie(LongArray(regs.size) { regs[it].time.toEpochMilli() }, DoubleArray(regs.size) { regs[it].percentage.value })
        }
        val registrosTemperatura: List<SkinTemperatureRecord> =
            if (!podeTemperatura) emptyList() else (opcional { lerTodos(client, SkinTemperatureRecord::class, faixa) } ?: emptyList())

        val sonos = JSONArray()
        for (r in sessoesSono) {
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
                // fase 6 (opcionais): estágios ao longo da noite, batimento e VFC dentro da sessão
                opcional { etapasDaSessao(r) }?.takeIf { it.isNotEmpty() }?.let { lista ->
                    put("etapas", JSONArray().apply {
                        for (e in lista) put(JSONObject().apply {
                            put("i", iso.format(e.ini.truncatedTo(ChronoUnit.SECONDS)))
                            put("f", iso.format(e.fim.truncatedTo(ChronoUnit.SECONDS)))
                            put("t", e.t)
                        })
                    })
                }
                // batimento e VFC só lidos a partir de `inicio`: sessão que começou antes da faixa daria a média só
                // da cauda da noite, e o servidor trocaria o valor certo guardado por ele (mesmo início)
                if (!r.startTime.isBefore(inicio)) {
                    val fc = serieFc.entre(r.startTime, r.endTime).filter { it in 30.0..200.0 }
                    if (fc.size >= 10) {
                        put("fcMedia", Math.round(fc.average()))
                        put("fcMin", Math.round(fc.min()))
                    }
                    serieHrv.entre(r.startTime, r.endTime).filter { it in 1.0..300.0 }.takeIf { it.isNotEmpty() }?.let {
                        put("hrv", Math.round(it.average()))
                    }
                    // fase 7 (opcionais): pela mesma razão, só nas sessões inteiras dentro da faixa
                    serieSpo2?.let { s -> opcional { oxigenioNoSono(s, r.startTime, r.endTime) } }?.let { put("spo2", it) }
                    if (registrosTemperatura.isNotEmpty()) {
                        opcional { temperaturaNoSono(registrosTemperatura, r.startTime, r.endTime) }?.let { put("temperatura", it) }
                    }
                }
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
        for (r in registrosHrv) {
            hrvPorDia.getOrPut(r.time.atZone(zona).toLocalDate()) { ArrayList() }.add(r.heartRateVariabilityMillis)
        }

        // fase 6 (opcionais): passos e gasto por hora e minutos ativos, só nos dias mais recentes.
        // Uma falha aqui não derruba o envio: os campos antigos saem do mesmo jeito.
        val primeiroDetalhe = hoje.minusDays(minOf(dias, DIAS_DETALHE - 1))
        val iniDetalhe = primeiroDetalhe.atStartOfDay(zona).toInstant()
        val fimDetalhe = hoje.plusDays(1).atStartOfDay(zona).toInstant()
        val porHora: MutableMap<LocalDate, JSONObject> = (opcional { lerPorHora(client, zona, iniDetalhe, fimDetalhe) } ?: emptyMap()).toMutableMap()
        // fase 7 (opcional): calorias ativas por hora, numa leitura à parte (sem a permissão, a de cima não pode falhar junto)
        if (PERM_KCAL_ATIVAS in dadas) {
            opcional { lerAtivasPorHora(client, zona, iniDetalhe, fimDetalhe) }?.forEach { (dia, v) ->
                porHora.getOrPut(dia) { JSONObject() }.put("kcalAtivas", JSONArray().apply { for (x in v) put(maxOf(0L, Math.round(x))) })
            }
        }
        // fase 7 (opcionais): distância e calorias ativas do dia, agregados pelo próprio Health Connect (sem duplicar fontes),
        // cada um na sua leitura: uma permissão negada não derruba a outra
        val distanciaPorDia: Map<LocalDate, Double> = if (PERM_DISTANCIA !in dadas) emptyMap() else
            opcional { porDiaDe(client, DistanceRecord.DISTANCE_TOTAL, inicioDia, fimDia) { it.inMeters } } ?: emptyMap()
        val ativasPorDia: Map<LocalDate, Double> = if (PERM_KCAL_ATIVAS !in dadas) emptyMap() else
            opcional { porDiaDe(client, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, inicioDia, fimDia) { it.inKilocalories } } ?: emptyMap()
        // minutos ativos só nos dias inteiros dentro da faixa lida (os exercícios vêm de `faixa`); um dia cortado
        // mandaria um número menor e o servidor, que funde por dia, trocaria o valor certo pelo errado
        var primeiroMinutos = primeiroDetalhe
        while (primeiroMinutos.atStartOfDay(zona).toInstant().isBefore(inicio)) primeiroMinutos = primeiroMinutos.plusDays(1)
        val minAtivos: Map<LocalDate, Int> = opcional {
            val ini = primeiroMinutos.atStartOfDay(zona).toInstant()
            if (!ini.isBefore(agora)) emptyMap()
            else minutosAtivosPorDia(lerTodos(client, StepsRecord::class, TimeRangeFilter.between(ini, agora)), sessoesExercicio, primeiroMinutos, hoje, zona)
        } ?: emptyMap()

        for (g in porDia) {
            val dia = g.startTime.toLocalDate()
            val passos = g.result[StepsRecord.COUNT_TOTAL]
            val kcal = g.result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories
            val hrv = hrvPorDia[dia]?.takeIf { it.isNotEmpty() }?.average()
            val distancia = distanciaPorDia[dia]?.takeIf { it.isFinite() && it >= 0 }
            val ativas = ativasPorDia[dia]?.takeIf { it.isFinite() && it >= 0 }
            if (passos == null && kcal == null && fcPorDia[dia] == null && hrv == null && distancia == null && ativas == null) continue
            diasJson.put(JSONObject().apply {
                put("dia", dia.toString())
                passos?.let { put("passos", it) }
                kcal?.let { put("calorias", arred(it, 0)) }
                fcPorDia[dia]?.let { put("fcRepouso", it) }
                hrv?.let { put("hrv", arred(it, 0)) }
                porHora[dia]?.let { put("porHora", it) }
                minAtivos[dia]?.let { put("minAtivos", it) }
                // fase 7 (opcionais): metros e kcal ativas do dia
                distancia?.let { put("distanciaM", Math.round(it)) }
                ativas?.let { put("kcalAtivas", Math.round(it)) }
            })
        }

        val treinos = JSONArray()
        for (r in sessoesExercicio) {
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

    /** Lê todas as páginas (o padrão do Health Connect devolve só as 1.000 primeiras). Teto de páginas por segurança. */
    private suspend fun <T : Record> lerTodos(client: HealthConnectClient, tipo: KClass<T>, faixa: TimeRangeFilter, maxPaginas: Int = 20): List<T> {
        val tudo = ArrayList<T>()
        var token: String? = null
        var paginas = 0
        do {
            val resp = client.readRecords(ReadRecordsRequest(recordType = tipo, timeRangeFilter = faixa, pageSize = 5000, pageToken = token))
            tudo.addAll(resp.records)
            token = resp.pageToken?.takeIf { it.isNotEmpty() }
            paginas++
        } while (token != null && paginas < maxPaginas)
        return tudo
    }

    /** Executa um trecho opcional: qualquer erro vira null (o cancelamento da corrotina continua subindo). */
    private inline fun <T> opcional(bloco: () -> T): T? = try {
        bloco()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** Passos e gasto total em fatias de 1 hora, no fuso do celular: { dia: { passos: [24], kcal: [24] } }. */
    private suspend fun lerPorHora(client: HealthConnectClient, zona: ZoneId, ini: Instant, fim: Instant): Map<LocalDate, JSONObject> {
        val grupos = client.aggregateGroupByDuration(
            AggregateGroupByDurationRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL, TotalCaloriesBurnedRecord.ENERGY_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(ini, fim),
                timeRangeSlicer = Duration.ofHours(1),
            )
        )
        val passos = HashMap<LocalDate, LongArray>()
        val kcal = HashMap<LocalDate, DoubleArray>()
        for (g in grupos) {
            // hora local de início da fatia; na troca de horário de verão duas fatias caem na mesma hora e somam
            val local = g.startTime.atZone(zona)
            val dia = local.toLocalDate()
            val h = local.hour
            g.result[StepsRecord.COUNT_TOTAL]?.let { passos.getOrPut(dia) { LongArray(24) }[h] += it }
            g.result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories?.let { kcal.getOrPut(dia) { DoubleArray(24) }[h] += it }
        }
        val saida = HashMap<LocalDate, JSONObject>()
        for (dia in passos.keys + kcal.keys) {
            val p = passos[dia] ?: LongArray(24)
            val k = kcal[dia] ?: DoubleArray(24)
            saida[dia] = JSONObject().apply {
                put("passos", JSONArray().apply { for (v in p) put(maxOf(0L, v)) })
                put("kcal", JSONArray().apply { for (v in k) put(maxOf(0L, Math.round(v))) })
            }
        }
        return saida
    }

    /** Uma métrica agregada por dia (no fuso do celular), convertida para número: { dia: valor }. */
    private suspend fun <T : Any> porDiaDe(
        client: HealthConnectClient,
        metrica: AggregateMetric<T>,
        ini: LocalDateTime,
        fim: LocalDateTime,
        valor: (T) -> Double,
    ): Map<LocalDate, Double> {
        val grupos = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(metrics = setOf(metrica), timeRangeFilter = TimeRangeFilter.between(ini, fim), timeRangeSlicer = Period.ofDays(1))
        )
        val saida = HashMap<LocalDate, Double>()
        for (g in grupos) g.result[metrica]?.let { saida[g.startTime.toLocalDate()] = valor(it) }
        return saida
    }

    /** Calorias ativas (ActiveCaloriesBurnedRecord) em fatias de 1 hora, no fuso do celular: { dia: [24] }. */
    private suspend fun lerAtivasPorHora(client: HealthConnectClient, zona: ZoneId, ini: Instant, fim: Instant): Map<LocalDate, DoubleArray> {
        val grupos = client.aggregateGroupByDuration(
            AggregateGroupByDurationRequest(
                metrics = setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(ini, fim),
                timeRangeSlicer = Duration.ofHours(1),
            )
        )
        val saida = HashMap<LocalDate, DoubleArray>()
        for (g in grupos) {
            val local = g.startTime.atZone(zona)
            g.result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories?.let { saida.getOrPut(local.toLocalDate()) { DoubleArray(24) }[local.hour] += it }
        }
        return saida
    }

    /** Amostras mínimas de oxigênio numa sessão para valer a média. */
    private const val MIN_AMOSTRAS_SPO2 = 3

    /** Cada amostra de oxigênio vale até a próxima, no máximo por este tempo (sem amostra, não se sabe). */
    private const val MAX_INTERVALO_SPO2_MS = 5 * 60_000L

    /**
     * Oxigênio no sangue dentro da sessão: { media, min, minutosAbaixo90 }. Leituras fora de 50–100 % saem. Os minutos abaixo
     * de 90 % somam o tempo de cada amostra abaixo disso até a seguinte (no máximo 5 min por amostra). null com menos de 3.
     */
    private fun oxigenioNoSono(serie: Serie, ini: Instant, fim: Instant): JSONObject? {
        val pts = serie.pontos(ini, fim).filter { it.second in 50.0..100.0 }
        if (pts.size < MIN_AMOSTRAS_SPO2) return null
        val fimMs = fim.toEpochMilli()
        var abaixoMs = 0L
        for (k in pts.indices) {
            if (pts[k].second >= 90.0) continue
            val ate = if (k + 1 < pts.size) pts[k + 1].first else fimMs
            abaixoMs += (ate - pts[k].first).coerceIn(0L, MAX_INTERVALO_SPO2_MS)
        }
        val valores = pts.map { it.second }
        return JSONObject().apply {
            put("media", arred(valores.average(), 1))
            put("min", arred(valores.min(), 1))
            put("minutosAbaixo90", Math.round(abaixoMs / 60_000.0))
        }
    }

    /**
     * Temperatura da pele dentro da sessão: { delta, media? }. `delta` = média dos desvios (°C) que os registros trazem contra
     * a própria linha de base; `media` = base + delta, só quando algum registro trouxe a base. null sem desvio na sessão.
     */
    private fun temperaturaNoSono(registros: List<SkinTemperatureRecord>, ini: Instant, fim: Instant): JSONObject? {
        val deltas = ArrayList<Double>()
        var base: Double? = null
        for (r in registros) {
            if (!r.endTime.isAfter(ini) || !r.startTime.isBefore(fim)) continue
            for (d in r.deltas) {
                if (d.time.isBefore(ini) || d.time.isAfter(fim)) continue
                val c = d.delta.inCelsius
                if (c.isFinite() && c in -5.0..5.0) deltas.add(c)
            }
            if (base == null) base = r.baseline?.inCelsius?.takeIf { it.isFinite() && it in 25.0..42.0 }
        }
        if (deltas.isEmpty()) return null
        val delta = deltas.average()
        val b = base
        return JSONObject().apply {
            put("delta", arred(delta, 2))
            if (b != null) put("media", arred(b + delta, 2))
        }
    }

    /**
     * Minutos ativos por dia: minutos com cadência >= 60 passos/min (dos registros brutos de passos) unidos aos minutos
     * dentro de exercícios. Grade de 1 posição por minuto, de `primeiro` 00:00 até o fim de `ultimo`; custo linear.
     * Cada registro de passos espalha a contagem igualmente pelos minutos que cobre. Com mais de uma fonte (relógio e
     * celular), vale a maior por minuto, para não contar o mesmo passo duas vezes.
     */
    private fun minutosAtivosPorDia(
        registros: List<StepsRecord>,
        exercicios: List<ExerciseSessionRecord>,
        primeiro: LocalDate,
        ultimo: LocalDate,
        zona: ZoneId,
    ): Map<LocalDate, Int> {
        val base = primeiro.atStartOfDay(zona).toInstant().epochSecond / 60
        val n = (ultimo.plusDays(1).atStartOfDay(zona).toInstant().epochSecond / 60 - base).toInt()
        if (n <= 0) return emptyMap()
        val porFonte = HashMap<String, FloatArray>()
        for (r in registros) {
            val s = r.startTime.epochSecond
            val e = r.endTime.epochSecond
            val grade = porFonte.getOrPut(r.metadata.dataOrigin.packageName) { FloatArray(n) }
            if (e <= s) {
                val m = (s / 60 - base).toInt()
                if (m in 0 until n) grade[m] += r.count.toFloat()
                continue
            }
            val total = (e - s).toFloat()
            val m0 = maxOf(s / 60, base)
            val m1 = minOf((e - 1) / 60, base + n - 1)
            var m = m0
            while (m <= m1) {
                val sobre = minOf(e, (m + 1) * 60) - maxOf(s, m * 60)
                if (sobre > 0) grade[(m - base).toInt()] += r.count * (sobre / total)
                m++
            }
        }
        val ativo = BooleanArray(n)
        for (grade in porFonte.values) {
            for (i in 0 until n) if (grade[i] >= CADENCIA_ATIVA - 0.01f) ativo[i] = true
        }
        for (x in exercicios) {
            val m0 = maxOf(x.startTime.epochSecond / 60, base)
            val m1 = minOf((x.endTime.epochSecond - 1) / 60, base + n - 1)
            var m = m0
            while (m <= m1) { ativo[(m - base).toInt()] = true; m++ }
        }
        val saida = HashMap<LocalDate, Int>()
        var dia = primeiro
        while (!dia.isAfter(ultimo)) {
            val a = (dia.atStartOfDay(zona).toInstant().epochSecond / 60 - base).toInt().coerceIn(0, n)
            val b = (dia.plusDays(1).atStartOfDay(zona).toInstant().epochSecond / 60 - base).toInt().coerceIn(0, n)
            var c = 0
            for (i in a until b) if (ativo[i]) c++
            saida[dia] = c.coerceAtMost(1440)
            dia = dia.plusDays(1)
        }
        return saida
    }

    private class Etapa(val ini: Instant, var fim: Instant, var t: String)

    private fun tipoEtapa(estagio: Int): String? = when (estagio) {
        SleepSessionRecord.STAGE_TYPE_LIGHT, SleepSessionRecord.STAGE_TYPE_SLEEPING -> "leve"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "profundo"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "acordado"
        else -> null
    }

    /**
     * Estágios da sessão em ordem, com vizinhos do mesmo tipo juntados. Se passar de MAX_ETAPAS, estágios curtos
     * (2, 4, 8, 16 min) viram o tipo do anterior e juntam de novo; no fim, corta em MAX_ETAPAS.
     */
    private fun etapasDaSessao(r: SleepSessionRecord): List<Etapa> {
        var lista = juntarVizinhas(
            r.stages.sortedBy { it.startTime }.mapNotNull { s ->
                tipoEtapa(s.stage)?.takeIf { s.endTime.isAfter(s.startTime) }?.let { Etapa(s.startTime, s.endTime, it) }
            }
        )
        var limiar = Duration.ofMinutes(2)
        while (lista.size > MAX_ETAPAS && limiar <= Duration.ofMinutes(16)) {
            for (k in 1 until lista.size) {
                if (Duration.between(lista[k].ini, lista[k].fim) < limiar) lista[k].t = lista[k - 1].t
            }
            lista = juntarVizinhas(lista)
            limiar = limiar.multipliedBy(2)
        }
        return lista.take(MAX_ETAPAS)
    }

    /** Junta estágios seguidos do mesmo tipo (tolera 1 min de buraco entre eles). */
    private fun juntarVizinhas(lista: List<Etapa>): List<Etapa> {
        val saida = ArrayList<Etapa>(lista.size)
        for (e in lista) {
            val u = saida.lastOrNull()
            if (u != null && u.t == e.t && !e.ini.isAfter(u.fim.plusSeconds(60))) {
                if (e.fim.isAfter(u.fim)) u.fim = e.fim
            } else {
                saida.add(Etapa(e.ini, e.fim, e.t))
            }
        }
        return saida
    }

    /** Série de valores no tempo, ordenada uma vez; `entre` recorta um intervalo fechado por busca binária. */
    private class Serie(tempos: LongArray, valores: DoubleArray) {
        private val t: LongArray
        private val v: DoubleArray

        init {
            val ordem = tempos.indices.sortedBy { tempos[it] }
            t = LongArray(ordem.size) { tempos[ordem[it]] }
            v = DoubleArray(ordem.size) { valores[ordem[it]] }
        }

        fun entre(ini: Instant, fim: Instant): List<Double> {
            val a = primeiroMaiorOuIgual(ini.toEpochMilli())
            val b = primeiroMaiorOuIgual(fim.toEpochMilli() + 1)
            return if (b > a) v.copyOfRange(a, b).asList() else emptyList()
        }

        /** O mesmo recorte de `entre`, com o instante (epoch ms) de cada valor. */
        fun pontos(ini: Instant, fim: Instant): List<Pair<Long, Double>> {
            val a = primeiroMaiorOuIgual(ini.toEpochMilli())
            val b = primeiroMaiorOuIgual(fim.toEpochMilli() + 1)
            return if (b > a) (a until b).map { t[it] to v[it] } else emptyList()
        }

        private fun primeiroMaiorOuIgual(x: Long): Int {
            var lo = 0
            var hi = t.size
            while (lo < hi) {
                val m = (lo + hi) ushr 1
                if (t[m] < x) lo = m + 1 else hi = m
            }
            return lo
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
