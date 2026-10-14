package br.nutribot.relogio.dados

import org.json.JSONArray
import org.json.JSONObject

/*
 * Leitura tolerante do JSON da API v1. O contrato (docs/app/2026-10-14-plano-fase1.md) fixa os nomes dos campos;
 * estes atalhos só tratam ausência, JSONObject.NULL e número vindo como texto, sem quebrar a tela por um campo faltando.
 * Onde o contrato não detalha a forma (/corpo, /resumos, /integracoes), as telas passam mais de um nome possível.
 */

private fun JSONObject.valor(chave: String): Any? = if (!has(chave) || isNull(chave)) null else opt(chave)

fun JSONObject?.obj(vararg chaves: String): JSONObject? {
    if (this == null) return null
    for (c in chaves) (valor(c) as? JSONObject)?.let { return it }
    return null
}

fun JSONObject?.arr(vararg chaves: String): JSONArray? {
    if (this == null) return null
    for (c in chaves) (valor(c) as? JSONArray)?.let { return it }
    return null
}

fun JSONObject?.str(vararg chaves: String): String? {
    if (this == null) return null
    for (c in chaves) {
        val v = valor(c) ?: continue
        if (v is JSONObject || v is JSONArray) continue
        val s = v.toString().trim()
        if (s.isNotEmpty()) return s
    }
    return null
}

fun JSONObject?.num(vararg chaves: String): Double? {
    if (this == null) return null
    for (c in chaves) {
        when (val v = valor(c)) {
            is Number -> return v.toDouble().takeIf { !it.isNaN() }
            is String -> v.replace(',', '.').toDoubleOrNull()?.let { return it }
        }
    }
    return null
}

fun JSONObject?.int(vararg chaves: String): Int? = num(*chaves)?.let { Math.round(it).toInt() }

fun JSONObject?.bool(vararg chaves: String): Boolean? {
    if (this == null) return null
    for (c in chaves) {
        when (val v = valor(c)) {
            is Boolean -> return v
            is Number -> return v.toInt() != 0
            is String -> if (v == "true" || v == "false") return v == "true"
        }
    }
    return null
}

/** Os objetos de um array (pula o que não for objeto). */
fun JSONArray?.objs(): List<JSONObject> {
    if (this == null) return emptyList()
    val out = ArrayList<JSONObject>(length())
    for (i in 0 until length()) (opt(i) as? JSONObject)?.let { out.add(it) }
    return out
}

/** Os textos de um array (objetos viram o primeiro campo de texto que acharem). */
fun JSONArray?.textos(): List<String> {
    if (this == null) return emptyList()
    val out = ArrayList<String>(length())
    for (i in 0 until length()) {
        when (val v = opt(i)) {
            null, JSONObject.NULL -> {}
            is JSONObject -> v.str("texto", "titulo", "valor", "nome")?.let { out.add(it) }
            else -> v.toString().takeIf { it.isNotBlank() }?.let { out.add(it) }
        }
    }
    return out
}
