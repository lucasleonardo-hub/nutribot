package br.nutribot.relogio.dados

import org.json.JSONObject

/*
 * Modelos usados por mais de uma tela, lidos do CONTRATO DA API v1 (docs/app/2026-10-14-plano-fase1.md e, na fase 2,
 * docs/app/2026-10-14-plano-fase2.md). Os nomes de campos são os do contrato. O resto das respostas é lido direto do JSON em cada tela.
 */

/**
 * Perfil = { id, nome, primeiroNome, apelido, fuso, objetivo, metaPeso, metaPrazo, temRelogio, temHevy, ehDono,
 *            altura (cm, fase 3), ritmo ("maximo" | "medio" | "minimo", fase 3) }
 */
data class Perfil(
    val id: String,
    val nome: String,
    val primeiroNome: String,
    val apelido: String?,
    val fuso: String?,
    val objetivo: String?,
    val metaPeso: Double?,
    val metaPrazo: String?,
    val temRelogio: Boolean,
    val temHevy: Boolean,
    val ehDono: Boolean,
    val altura: Double? = null,
    val ritmo: String? = null,
) {
    /** Nome curto para os chips do topo. */
    val curto: String get() = apelido ?: primeiroNome
    val inicial: String get() = curto.take(1).uppercase()

    companion object {
        /** Ritmos que a API aceita (sem acento) e o rótulo para a tela. */
        val ritmos: List<Pair<String, String>> = listOf("maximo" to "máximo", "medio" to "médio", "minimo" to "mínimo")

        fun rotuloRitmo(r: String?): String? = ritmos.firstOrNull { it.first == r }?.second ?: r

        fun de(j: JSONObject): Perfil? {
            val id = j.str("id", "_id") ?: return null
            val nome = j.str("nome") ?: j.str("primeiroNome") ?: "Perfil"
            return Perfil(
                id = id,
                nome = nome,
                primeiroNome = j.str("primeiroNome") ?: nome.substringBefore(' '),
                apelido = j.str("apelido"),
                fuso = j.str("fuso"),
                objetivo = j.str("objetivo"),
                metaPeso = j.num("metaPeso"),
                metaPrazo = j.str("metaPrazo"),
                temRelogio = j.bool("temRelogio") ?: false,
                temHevy = j.bool("temHevy") ?: false,
                ehDono = j.bool("ehDono") ?: false,
                altura = j.num("altura"),
                ritmo = j.str("ritmo"),
            )
        }

        fun lista(j: JSONObject?): List<Perfil> = j.arr("perfis").objs().mapNotNull { de(it) }
    }
}

/** Item de uma refeição: gramas, kcal e macros vêm preenchidos quando a análise foi feita pelo app (fase 2). */
data class Item(val nome: String, val gramas: Double?, val kcal: Double?, val p: Double? = null, val c: Double? = null, val g: Double? = null)

/**
 * Refeicao = { id, dia, slot, nome, hora, kcal, faixa: {min,max}, p, c, g, descricao, origem, incerteza,
 *              itens: [{ nome, gramas|null, kcal|null, p|null, c|null, g|null }], miniatura: "data:image/jpeg;base64,..."|null,
 *              foto: { url } | null (fase 3: a primeira foto fica no Drive) }
 */
data class Refeicao(
    val id: String,
    val dia: String?,
    val slot: String?,
    val nome: String,
    val hora: String?,
    val kcal: Double?,
    val faixaMin: Double?,
    val faixaMax: Double?,
    val p: Double?,
    val c: Double?,
    val g: Double?,
    val descricao: String?,
    val origem: String?,
    val incerteza: String?,
    val miniatura: String?,
    val itens: List<Item>,
    val fotoUrl: String? = null,
) {
    companion object {
        fun de(j: JSONObject, indice: Int = 0): Refeicao {
            val faixa = j.obj("faixa")
            return Refeicao(
                id = j.str("id") ?: "r$indice",
                dia = j.str("dia"),
                slot = j.str("slot"),
                nome = j.str("nome") ?: j.str("slot")?.replaceFirstChar { it.uppercase() } ?: "Refeição",
                hora = j.str("hora"),
                kcal = j.num("kcal"),
                faixaMin = faixa.num("min"),
                faixaMax = faixa.num("max"),
                p = j.num("p"),
                c = j.num("c"),
                g = j.num("g"),
                descricao = j.str("descricao"),
                origem = j.str("origem"),
                incerteza = j.str("incerteza"),
                miniatura = j.str("miniatura"),
                itens = j.arr("itens").objs().mapNotNull { i -> i.str("nome")?.let { Item(it, i.num("gramas"), i.num("kcal"), i.num("p"), i.num("c"), i.num("g")) } },
                fotoUrl = j.obj("foto").str("url"),
            )
        }

        fun lista(j: JSONObject?, chave: String = "refeicoes"): List<Refeicao> =
            j.arr(chave).objs().mapIndexed { i, r -> de(r, i) }.sortedBy { it.hora ?: "99:99" }
    }
}

/**
 * Um dia da série do `/dias` (fase 4): tudo pode ser null quando falta. kcal/proteina = refeições registradas (sem registro =
 * null, não zero); gasto = relógio; peso/gordura/magra = pesagem consolidada do dia; sonoMin = a noite de que acordou nesse dia.
 */
data class DiaSerie(
    val dia: String,
    val kcal: Double?,
    val proteina: Double?,
    val gasto: Double?,
    val peso: Double?,
    val gordura: Double?,
    val magra: Double?,
    val sonoMin: Double?,
    val sonoInicio: String?,
    val sonoFim: String?,
    val passos: Double?,
    val treinoMin: Double?,
) {
    companion object {
        fun de(j: JSONObject): DiaSerie? {
            val dia = j.str("dia") ?: return null
            return DiaSerie(dia, j.num("kcal"), j.num("proteina"), j.num("gasto"), j.num("peso"), j.num("gordura"), j.num("magra"), j.num("sonoMin"), j.str("sonoInicio"), j.str("sonoFim"), j.num("passos"), j.num("treinoMin"))
        }

        /** `{ meta, dias }` → a lista em ordem de dia. */
        fun lista(j: JSONObject?): List<DiaSerie> = j.arr("dias").objs().mapNotNull { de(it) }.sortedBy { it.dia }
    }
}

/** Evento = { id, dia, hora|null, titulo, tipo, nota|null, criadoEm }; tipo em comer_fora|festa|viagem|treino|consulta|outro. */
data class Evento(val id: String, val dia: String, val hora: String?, val titulo: String, val tipo: String, val nota: String?) {
    companion object {
        /** Tipos que a pessoa pode escolher, com o rótulo para a tela. */
        val tipos: List<Pair<String, String>> = listOf(
            "comer_fora" to "Comer fora", "festa" to "Festa", "viagem" to "Viagem", "treino" to "Treino", "consulta" to "Consulta", "outro" to "Outro",
        )

        fun rotulo(tipo: String?): String = tipos.firstOrNull { it.first == tipo }?.second ?: (tipo ?: "Evento")

        fun de(j: JSONObject): Evento? {
            val id = j.str("id", "_id") ?: return null
            val dia = j.str("dia") ?: return null
            return Evento(id, dia.take(10), j.str("hora"), j.str("titulo") ?: "Evento", j.str("tipo") ?: "outro", j.str("nota"))
        }

        fun lista(j: JSONObject?, chave: String = "eventos"): List<Evento> = j.arr(chave).objs().mapNotNull { de(it) }
    }
}
