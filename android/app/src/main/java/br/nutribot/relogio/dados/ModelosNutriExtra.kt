package br.nutribot.relogio.dados

import org.json.JSONObject

/*
 * Fase 7 (frente F): modelos das rotas novas da frente A (docs/app/2026-10-15-mapa-ecossistema.md, seções 1 e 3), lidos com a
 * mesma tolerância do resto (Json.kt): campo faltando vira null, nunca derruba a tela. Onde o contrato ainda não fixa o nome
 * de um campo, a leitura aceita mais de um nome. Respostas que no mapa são uma lista solta (momentos) são lidas também
 * embrulhadas num objeto, porque o cliente HTTP só entende objeto JSON na raiz.
 */

/** Dias da semana como o servidor guarda (0 = domingo, como o getDay do JavaScript), com o rótulo curto da tela. */
val diasDaSemana: List<Pair<Int, String>> = listOf(0 to "dom", 1 to "seg", 2 to "ter", 3 to "qua", 4 to "qui", 5 to "sex", 6 to "sáb")

fun rotuloDias(dias: List<Int>): String =
    if (dias.size == 7) "todo dia" else dias.sorted().mapNotNull { d -> diasDaSemana.firstOrNull { it.first == d }?.second }.joinToString(", ")

private fun JSONObject.dias(chave: String): List<Int> {
    val a = arr(chave) ?: return emptyList()
    val out = ArrayList<Int>()
    for (i in 0 until a.length()) {
        when (val v = a.opt(i)) {
            is Number -> v.toInt().takeIf { it in 0..6 }?.let { out.add(it) }
            is String -> v.trim().toIntOrNull()?.takeIf { it in 0..6 }?.let { out.add(it) }
        }
    }
    return out.distinct().sorted()
}

// ============================================================
// Atividades fixas (W17–W20): GET/POST /perfis/:id/atividades, DELETE /perfis/:id/atividades/:aid,
// POST /perfis/:id/atividades/:aid/resposta { dia, feita } -> { feita, kcal }
// ============================================================

/** Uma atividade fixa: { id, nome, dias:[0-6], inicio "HH:MM", fim "HH:MM", met, lugar:{nome}|null, kcal }. */
data class AtividadeFixa(val id: String, val nome: String, val dias: List<Int>, val inicio: String?, val fim: String?, val met: Double?, val lugar: String?, val kcal: Double?) {
    companion object {
        fun de(j: JSONObject): AtividadeFixa? {
            val id = j.str("id", "_id") ?: return null
            return AtividadeFixa(id, j.str("nome") ?: "Atividade", j.dias("dias"), j.str("inicio"), j.str("fim"), j.num("met"), j.obj("lugar").str("nome") ?: j.str("lugar"), j.num("kcal"))
        }

        fun lista(j: JSONObject?): List<AtividadeFixa> = j.arr("fixas", "atividades").objs().mapNotNull { de(it) }
    }
}

/** O que já se sabe de hoje: { id, nome, feita: true|false|null, kcal, como: 'localizacao'|'resposta'|... }. */
data class AtividadeDoDia(val id: String, val nome: String, val feita: Boolean?, val kcal: Double?, val como: String?) {
    companion object {
        fun lista(j: JSONObject?): List<AtividadeDoDia> = j.arr("hoje").objs().mapNotNull { a ->
            val id = a.str("id", "_id") ?: return@mapNotNull null
            AtividadeDoDia(id, a.str("nome") ?: "Atividade", a.bool("feita"), a.num("kcal"), a.str("como"))
        }
    }
}

/** Pergunta "teve?" ainda sem resposta: { id, nome, dia }. */
data class AtividadePendente(val id: String, val nome: String, val dia: String) {
    companion object {
        fun lista(j: JSONObject?): List<AtividadePendente> = j.arr("pendentes").objs().mapNotNull { a ->
            val id = a.str("id", "_id") ?: return@mapNotNull null
            val dia = a.str("dia")?.take(10) ?: return@mapNotNull null
            AtividadePendente(id, a.str("nome") ?: "Atividade", dia)
        }
    }
}

/** Intensidade em palavras (o MET que o servidor usa para estimar o gasto). */
val intensidades: List<Triple<String, Double, String>> = listOf(
    Triple("leve", 3.0, "caminhada, alongamento"),
    Triple("moderada", 5.0, "vôlei, dança, bike leve"),
    Triple("forte", 7.0, "futebol, corrida leve"),
    Triple("muito forte", 9.0, "corrida, luta"),
)

fun rotuloIntensidade(met: Double?): String? = met?.let { m -> intensidades.minByOrNull { kotlin.math.abs(it.second - m) }?.first }

// ============================================================
// Lugares do dono (W23–W25): GET /perfis/:id/lugares, PUT /perfis/:id/lugares/:lid, DELETE /perfis/:id/lugares?confirmar=sim
// ============================================================

/** { id, tipo, nome, bairro, papel: 'casa'|'trabalho'|null, visitas, padrao, ultimaVez }. */
data class Lugar(val id: String, val tipo: String?, val nome: String?, val bairro: String?, val papel: String?, val visitas: Int?, val padrao: String?, val ultimaVez: String?) {
    val titulo: String get() = nome ?: when (papel) { "casa" -> "Casa"; "trabalho" -> "Trabalho"; else -> tipo?.replaceFirstChar { it.uppercase() } ?: "Lugar" }

    companion object {
        /** Tipos que a pessoa pode escolher (os mesmos que lugares.js reconhece). */
        val tipos: List<String> = listOf("residência", "trabalho", "academia", "mercado", "restaurante", "padaria", "café", "bar", "parque", "praia", "escola", "faculdade", "saúde", "loja", "shopping", "outro")

        /** Papel do lugar: casa e trabalho mudam a conta das atividades e da cobrança. */
        val papeis: List<Pair<String?, String>> = listOf("casa" to "casa", "trabalho" to "trabalho", null to "nenhum")

        fun de(j: JSONObject): Lugar? {
            val id = j.str("id", "_id") ?: return null
            return Lugar(id, j.str("tipo"), j.str("nome"), j.str("bairro"), j.str("papel"), j.int("visitas"), j.str("padrao"), j.str("ultimaVez"))
        }

        fun lista(j: JSONObject?): List<Lugar> = j.arr("lugares").objs().mapNotNull { de(it) }
    }
}

/**
 * Onde a pessoa está agora: { estado (casa | lugar | fora | sem_sinal), tipo, nome, desde ("HH:MM" no fuso dela) } ou null.
 * Em sem_sinal, `desde` é a hora do último sinal.
 */
data class LugarAgora(val tipo: String?, val nome: String?, val desde: String?, val estado: String? = null) {
    companion object {
        fun de(j: JSONObject?): LugarAgora? {
            val a = j.obj("agora") ?: return null
            val estado = a.str("estado")
            if (estado == null && a.str("tipo") == null && a.str("nome") == null) return null
            return LugarAgora(a.str("tipo"), a.str("nome"), a.str("desde"), estado)
        }
    }
}

// ============================================================
// Configurações do bot (W29–W31, W38; só o celular do dono, D14): GET/PUT /config, GET /sistema/status
// ============================================================

/** { vozLigada, silencioAte: ISO|null, nomeBot }. */
data class ConfigBot(val vozLigada: Boolean?, val silencioAte: String?, val nomeBot: String?) {
    companion object {
        fun de(j: JSONObject?): ConfigBot? {
            if (j == null) return null
            val c = j.obj("config") ?: j
            return ConfigBot(c.bool("vozLigada", "voz"), c.str("silencioAte"), c.str("nomeBot", "nome"))
        }
    }
}

// ============================================================
// Agenda do Google (W26), só leitura: GET /perfis/:id/agenda-google?dias= -> { eventos:[{ dia, inicio, fim, titulo, tipo }], janelas }
// ============================================================

private val horaRe = Regex("(\\d{1,2}):(\\d{2})")

/** "2026-10-15T14:00:00-03:00" ou "14:00" viram "14:00"; sem hora (evento do dia todo) = null. */
private fun soHora(s: String?): String? = s?.let { horaRe.find(if (it.length > 10 && it[10] == 'T') it.substring(11) else it) }?.let { m ->
    "%02d:%s".format(m.groupValues[1].toInt(), m.groupValues[2])
}

/** Um compromisso do Google: dia AAAA-MM-DD, hora de início e fim (HH:MM ou null) e o título. Sem local (privacidade). */
data class EventoGoogle(val dia: String, val inicio: String?, val fim: String?, val titulo: String, val tipo: String?) {
    companion object {
        fun lista(j: JSONObject?): List<EventoGoogle> = j.arr("eventos").objs().mapNotNull { e ->
            val dia = (e.str("dia") ?: e.str("inicio")?.takeIf { it.length >= 10 })?.take(10) ?: return@mapNotNull null
            EventoGoogle(dia, soHora(e.str("inicio")), soHora(e.str("fim")), e.str("titulo") ?: "Compromisso", e.str("tipo"))
        }
    }
}

// ============================================================
// O que a Nutri é e sabe (W32–W35, W57)
// ============================================================

/** Documento da pasta da pessoa no Drive (dossiê): { nome, tipo, lido, modificadoEm, resumo }. */
/**
 * Um arquivo da pasta da pessoa: `tipo` é o MIME do Drive ("application/pdf"); `tipoDocumento` é o que a Nutri entendeu
 * (bioimpedância, exame...). A pílula mostra `rotulo`: o tipo do documento ou, sem ele, o formato em palavra simples.
 */
data class DocDossie(val nome: String, val tipo: String?, val lido: Boolean?, val modificadoEm: String?, val resumo: String?, val tipoDocumento: String? = null) {
    val rotulo: String? get() = tipoDocumento?.takeIf { it.isNotBlank() }?.let { nomesTipo[it.lowercase()] ?: it.lowercase().replace('_', ' ') } ?: formato(tipo)

    companion object {
        /** Os tipos que a Nutri extrai (gemini.js, leitura de documento), em português de gente. */
        private val nomesTipo = mapOf(
            "bioimpedancia" to "bioimpedância", "exame_sangue" to "exame de sangue", "avaliacao_fisica" to "avaliação física",
            "receita_ou_prescricao" to "receita", "plano_alimentar" to "plano alimentar", "outro" to "documento",
        )

        /** MIME do Drive (o servidor troca "application/vnd.google-apps." por "google-") em palavra simples; null sem saber. */
        fun formato(mime: String?): String? {
            val m = mime?.lowercase()?.trim() ?: return null
            return when {
                m == "application/pdf" -> "PDF"
                m.startsWith("image/") -> "imagem"
                m.contains("spreadsheet") || m.contains("excel") || m == "text/csv" -> "planilha"
                m.startsWith("text/") || m == "google-document" || m.contains("wordprocessing") -> "texto"
                else -> null
            }
        }

        fun lista(j: JSONObject?): List<DocDossie> = j.arr("arquivos", "documentos").objs().mapNotNull { d ->
            val nome = d.str("nome", "titulo") ?: return@mapNotNull null
            DocDossie(nome, d.str("tipo"), d.bool("lido"), d.str("modificadoEm", "atualizado"), d.str("resumo"), d.str("tipoDocumento"))
        }
    }
}

/** Persona: { texto, atualizado, versoes: [{ em, trecho }] }. */
data class Persona(val texto: String?, val atualizado: String?, val versoes: List<Pair<String?, String>>) {
    companion object {
        fun de(j: JSONObject?): Persona? {
            if (j == null) return null
            val p = j.obj("persona") ?: j
            val versoes = p.arr("versoes").objs().mapNotNull { v -> v.str("trecho", "texto")?.let { v.str("em", "dia") to it } }
            return Persona(p.str("texto"), p.str("atualizado", "atualizadoEm"), versoes)
        }
    }
}

/** Lições: { regras: [texto], documento, dia }. */
data class Licoes(val regras: List<String>, val documento: String?, val dia: String?) {
    companion object {
        fun de(j: JSONObject?): Licoes? {
            if (j == null) return null
            return Licoes(j.arr("regras").textos(), j.str("documento"), j.str("dia", "atualizado"))
        }
    }
}

/**
 * Um documento da base de conhecimento: { id, titulo, versao, atualizado, foco }. Na busca (`?q=`), o servidor pode mandar
 * também `trecho` (onde o termo aparece); sem `trecho`, a tela filtra só pelo título e pelo foco.
 */
data class DocConhecimento(val id: String, val titulo: String, val versao: String?, val atualizado: String?, val foco: String?, val trecho: String? = null) {
    companion object {
        fun lista(j: JSONObject?): List<DocConhecimento> = j.arr("docs", "documentos").objs().mapNotNull { d ->
            val id = d.str("id", "_id") ?: return@mapNotNull null
            DocConhecimento(id, d.str("titulo") ?: id, d.str("versao"), d.str("atualizado", "atualizadoEm"), d.str("foco"), d.str("trecho"))
        }
    }
}

/** Momento memorável: { dia, pessoa, tipo, texto }. */
data class Momento(val dia: String?, val pessoa: String?, val tipo: String?, val texto: String) {
    companion object {
        fun lista(j: JSONObject?): List<Momento> = j.arr("momentos", "itens").objs().mapNotNull { m ->
            val t = m.str("texto") ?: return@mapNotNull null
            Momento(m.str("dia")?.take(10), m.str("pessoa", "nome"), m.str("tipo"), t)
        }
    }
}

// ============================================================
// Perguntas feitas no app (seção 3): GET /perfis/:id/perguntas?n=, DELETE /perfis/:id/perguntas/:pid,
// DELETE /perfis/:id/perguntas?confirmar=sim
// ============================================================

/** { id, dia, em, pergunta, resposta, tema }. */
data class PerguntaApp(val id: String, val dia: String?, val em: String?, val pergunta: String, val resposta: String, val tema: String?) {
    companion object {
        /** Em ordem de conversa (a mais antiga primeiro), seja qual for a ordem em que o servidor mandou. */
        fun lista(j: JSONObject?): List<PerguntaApp> = j.arr("perguntas", "trocas", "itens").objs().mapNotNull { p ->
            val id = p.str("id", "_id") ?: return@mapNotNull null
            val pergunta = p.str("pergunta") ?: return@mapNotNull null
            PerguntaApp(id, p.str("dia"), p.str("em"), pergunta, p.str("resposta") ?: "", p.str("tema"))
        }.sortedBy { it.em ?: it.dia ?: "" }
    }
}

// ============================================================
// Resumos (W44, W58): GET /perfis/:id/resumos/dia?dia= -> { dia, texto }; /resumos ganha falas:[{ dia, tipo, texto }]
// ============================================================

/** Texto de uma nota de voz da Nutri (segunda e sexta). */
data class Fala(val dia: String, val tipo: String?, val texto: String) {
    companion object {
        fun lista(j: JSONObject?): List<Fala> = j.arr("falas").objs().mapNotNull { f ->
            val dia = f.str("dia")?.take(10) ?: return@mapNotNull null
            val t = f.str("texto") ?: return@mapNotNull null
            Fala(dia, f.str("tipo"), t)
        }.sortedByDescending { it.dia }
    }
}

// ============================================================
// Perfil ampliado (W10, W11): campos que o PUT /perfis/:id passa a aceitar e devolver
// ============================================================

/** O que a tela Perfil edita além do básico: { apelido, cidade, dieta, restricoes, idade, genero }. */
data class PerfilExtra(val apelido: String?, val cidade: String?, val dieta: String?, val restricoes: String?, val idade: Int?, val genero: String?) {
    companion object {
        /** Do JSON do perfil (o de /perfis ou o `perfil` da resposta do PUT); dieta e restrições caem nos fatos do /nutri. */
        fun de(perfil: JSONObject?, nutri: JSONObject? = null): PerfilExtra {
            val fatos = nutri.arr("fatos").objs()
            fun fato(id: String) = fatos.firstOrNull { it.str("id") == id }?.let { it.str("valor") ?: it.str("texto") }
            return PerfilExtra(
                apelido = perfil.str("apelido"),
                cidade = perfil.str("cidade"),
                dieta = perfil.str("dieta") ?: fato("dieta"),
                restricoes = perfil.str("restricoes") ?: fato("restricoes"),
                idade = perfil.int("idade")?.takeIf { it in 1..120 },
                genero = perfil.str("genero"),
            )
        }
    }
}
