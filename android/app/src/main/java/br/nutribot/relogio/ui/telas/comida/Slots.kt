package br.nutribot.relogio.ui.telas.comida

import java.time.LocalTime

/** Os slots de refeição do contrato (cafe|lanche_manha|almoco|lanche|jantar|ceia) e o rótulo de cada um. */
object Slots {
    val todos: List<Pair<String, String>> = listOf(
        "cafe" to "Café", "lanche_manha" to "Lanche da manhã", "almoco" to "Almoço", "lanche" to "Lanche", "jantar" to "Jantar", "ceia" to "Ceia",
    )

    fun rotulo(slot: String?): String = todos.firstOrNull { it.first == slot }?.second ?: (slot ?: "Refeição")

    /** O slot mais provável pela hora: 5–10:30 café, 10:30–14:30 almoço, 14:30–18 lanche, 18–22:30 jantar, o resto ceia. */
    fun pelaHora(h: LocalTime = LocalTime.now()): String {
        val min = h.hour * 60 + h.minute
        return when {
            min < 5 * 60 -> "ceia"
            min < 10 * 60 + 30 -> "cafe"
            min < 14 * 60 + 30 -> "almoco"
            min < 18 * 60 -> "lanche"
            min < 22 * 60 + 30 -> "jantar"
            else -> "ceia"
        }
    }

    /** Alguns slots que o servidor usa com outro nome (pendentes do /hoje) caem no chip equivalente. */
    fun normalizar(slot: String?): String? = when (slot?.lowercase()) {
        null -> null
        "cafe", "café", "cafe_da_manha", "desjejum" -> "cafe"
        "almoco", "almoço" -> "almoco"
        "lanche_tarde", "lanche" -> "lanche"
        "lanche_manha" -> "lanche_manha"
        "jantar" -> "jantar"
        "ceia" -> "ceia"
        else -> slot
    }
}
