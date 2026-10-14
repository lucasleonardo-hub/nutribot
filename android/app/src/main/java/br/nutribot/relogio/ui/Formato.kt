package br.nutribot.relogio.ui

import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** Números e datas no jeito brasileiro (1.904 kcal; 68,2 kg; −0,15 kg/sem; terça, 13 de outubro). */
object Formato {
    val BR: Locale = Locale.forLanguageTag("pt-BR")

    fun inteiro(v: Double?): String = if (v == null || !v.isFinite()) "—" else NumberFormat.getIntegerInstance(BR).format(v.roundToLong())

    fun kcal(v: Double?): String = inteiro(v)

    fun decimal(v: Double?, casas: Int = 1): String {
        if (v == null || !v.isFinite()) return "—"
        val nf = NumberFormat.getNumberInstance(BR)
        nf.minimumFractionDigits = casas
        nf.maximumFractionDigits = casas
        return nf.format(v)
    }

    /** Com sinal (+0,15 / −0,10), com o sinal de menos tipográfico. */
    fun sinal(v: Double?, casas: Int = 2): String {
        if (v == null || !v.isFinite()) return "—"
        val s = decimal(abs(v), casas)
        return (if (v < 0 && s.any { it in '1'..'9' }) "−" else "+") + s
    }

    fun gramas(v: Double?): String = if (v == null || !v.isFinite()) "—" else "${v.roundToInt()}"

    fun sono(min: Double?): String {
        if (min == null || !min.isFinite() || min <= 0) return "—"
        val m = min.roundToInt()
        return "${m / 60}h" + "%02d".format(m % 60)
    }

    fun dia(s: String?): LocalDate? = try {
        s?.take(10)?.let { LocalDate.parse(it) }
    } catch (e: Exception) {
        null
    }

    /**
     * O "hoje" da pessoa: o `dia` do /hoje quando já veio; senão a data no fuso dela (do /perfis); só por último a do celular.
     * Evita pedir ao servidor um dia que, no fuso da pessoa, ainda é futuro (400 intervalo_invalido).
     */
    fun hojeDe(diaApi: String?, fuso: String?): LocalDate =
        dia(diaApi) ?: fuso?.let { runCatching { LocalDate.now(ZoneId.of(it)) }.getOrNull() } ?: LocalDate.now()

    fun iso(d: LocalDate): String = d.format(DateTimeFormatter.ISO_LOCAL_DATE)

    /** "terça, 13 de outubro" */
    fun diaLongo(d: LocalDate): String {
        val sem = d.dayOfWeek.getDisplayName(TextStyle.FULL, BR).replace("-feira", "")
        val mes = d.month.getDisplayName(TextStyle.FULL, BR)
        return "$sem, ${d.dayOfMonth} de $mes"
    }

    /** "13/10" */
    fun diaCurto(d: LocalDate): String = "%02d/%02d".format(d.dayOfMonth, d.monthValue)

    /** "ter" */
    fun semanaCurta(d: LocalDate): String = d.dayOfWeek.getDisplayName(TextStyle.SHORT, BR).trimEnd('.').lowercase()

    fun mesAno(d: LocalDate): String = d.month.getDisplayName(TextStyle.FULL, BR).replaceFirstChar { it.uppercase() } + " " + d.year

    /** Lê instantes vindos da API: ISO com fuso, ISO local, ou milissegundos. */
    fun instante(s: String?): Instant? {
        if (s.isNullOrBlank()) return null
        s.toLongOrNull()?.let { return Instant.ofEpochMilli(if (it < 100_000_000_000L) it * 1000 else it) }
        return try {
            Instant.parse(s)
        } catch (_: Exception) {
            try {
                OffsetDateTime.parse(s).toInstant()
            } catch (_: Exception) {
                try {
                    LocalDateTime.parse(s).atZone(ZoneId.systemDefault()).toInstant()
                } catch (_: Exception) {
                    null
                }
            }
        }
    }

    /** "há 4 min", "há 2 h", "há 3 dias" */
    fun ha(i: Instant?, agora: Instant = Instant.now()): String {
        if (i == null) return "—"
        val min = ((agora.toEpochMilli() - i.toEpochMilli()) / 60_000).coerceAtLeast(0)
        return when {
            min < 1 -> "agora"
            min < 60 -> "há $min min"
            min < 60 * 24 -> "há ${min / 60} h"
            else -> "há ${min / (60 * 24)} dias"
        }
    }

    fun haMs(ms: Long?): String = if (ms == null) "—" else ha(Instant.ofEpochMilli(ms))

    /** "HH:MM" dentro de um texto (o campo agora/hora pode vir como ISO ou só a hora). */
    fun hora(s: String?): String? = s?.let { Regex("(\\d{1,2}):(\\d{2})").find(it)?.value }

    fun saudacao(hora: String?): String {
        val h = hora?.substringBefore(':')?.toIntOrNull() ?: java.time.LocalTime.now().hour
        return when (h) {
            in 5..11 -> "Bom dia"
            in 12..17 -> "Boa tarde"
            else -> "Boa noite"
        }
    }
}
