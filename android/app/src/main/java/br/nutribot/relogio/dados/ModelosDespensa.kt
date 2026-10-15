package br.nutribot.relogio.dados

import org.json.JSONObject
import java.net.URLEncoder
import java.text.NumberFormat
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Locale

/*
 * Fase 7 (frente E): despensa, compras, água e álcool e as atividades fixas do dia, lidos do contrato da seção 1 do mapa
 * (docs/app/2026-10-15-mapa-ecossistema.md, W12-W16, W20, W51, W61). A leitura é tolerante: campo faltando vira null e a tela
 * esconde o pedaço; rota que o servidor ainda não tem (404 rota_inexistente) some da tela.
 */

private val BR = Locale.forLanguageTag("pt-BR")

/** Os caminhos das rotas novas (sob /api/v1). O `k` do item vem do servidor com espaços: vai codificado no caminho. */
object RotasDespensa {
    private fun cod(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    /** GET → { itens: [ItemDespensa], vencendo, acabando }. acabou = true traz também o que acabou. */
    fun despensa(perfilId: String, acabou: Boolean = false) = "/perfis/$perfilId/despensa?acabou=${if (acabou) 1 else 0}"

    /** POST { item, qtd?, unidade? } → { item }. */
    fun novoItem(perfilId: String) = "/perfis/$perfilId/despensa"

    /** PUT { acao: acabou|acabando|usei|tem|comprei, qtd? } → { item }; DELETE tira da lista → { apagado }. */
    fun item(perfilId: String, k: String) = "/perfis/$perfilId/despensa/${cod(k)}"

    /** GET → { notas: [{ loja, dia, origem, itens: [{ item, qtd, unidade, preco }], total }], resumo: { cupons, gasto, recorrentes, desperdicio } }. */
    fun compras(perfilId: String, dias: Int = 28) = "/perfis/$perfilId/compras?dias=$dias"

    /** POST { dia, aguaMl?, alcoolDoses? } (soma ao dia; só valores positivos) → { dia, aguaMl, alcoolDoses }. */
    fun habitos(perfilId: String) = "/perfis/$perfilId/habitos"

    /** GET → { dia, aguaMl, alcoolDoses }. */
    fun habitosDoDia(perfilId: String, dia: String) = "/perfis/$perfilId/habitos?dia=$dia"

    /** GET → { fixas: [...], hoje: [{ id, nome, feita, kcal, como }], pendentes: [{ id, nome, dia }] }. */
    fun atividades(perfilId: String) = "/perfis/$perfilId/atividades"

    /** POST { dia, feita } → { feita, kcal }. */
    fun respostaAtividade(perfilId: String, aid: String) = "/perfis/$perfilId/atividades/${cod(aid)}/resposta"

    /** POST { dia, valor: 'vai'|'nao'|null } → { dia, aviso }; 409 ja_registrada quando o dia já foi registrado. */
    fun avisoAtividade(perfilId: String, aid: String) = "/perfis/$perfilId/atividades/${cod(aid)}/aviso"

    /** PUT { nome, dias, inicio, fim, met } → { atividade } (mesmo id; o lugar continua o que era). */
    fun atividade(perfilId: String, aid: String) = "/perfis/$perfilId/atividades/${cod(aid)}"
}

/** Os corpos das escritas da despensa, dos hábitos e das atividades fixas. */
object CorposDespensa {
    fun acao(acao: String, qtd: Double? = null): JSONObject = JSONObject().put("acao", acao).also { if (qtd != null) it.put("qtd", qtd) }

    fun novoItem(item: String, qtd: Double?, unidade: String?, categoria: String? = null): JSONObject = JSONObject().put("item", item.trim()).also { j ->
        if (qtd != null) j.put("qtd", qtd)
        if (!unidade.isNullOrBlank()) j.put("unidade", unidade)
        // carne, frango, laticínio...: o servidor marca perecível e a validade da categoria (sem ela, "outro")
        if (!categoria.isNullOrBlank()) j.put("categoria", categoria)
    }

    fun habito(dia: String, aguaMl: Int? = null, alcoolDoses: Int? = null): JSONObject = JSONObject().put("dia", dia).also { j ->
        if (aguaMl != null) j.put("aguaMl", aguaMl)
        if (alcoolDoses != null) j.put("alcoolDoses", alcoolDoses)
    }

    fun resposta(dia: String, feita: Boolean): JSONObject = JSONObject().put("dia", dia).put("feita", feita)

    /** valor: "vai", "nao" ou null (desfaz o aviso). */
    fun aviso(dia: String, valor: String?): JSONObject = JSONObject().put("dia", dia).put("valor", valor ?: JSONObject.NULL)
}

/** Selo de validade de um item: laranja quando vence em até 2 dias, vermelho quando passou do prazo. */
enum class SeloValidade { VenceLogo, Passou }

/**
 * Item da despensa: { k, item, categoria, quantidade, unidade, granel, estado (tem|acabando|acabou), validadeEm, venceEmDias,
 * perecivel, loja, compradoEm, kcal100, p100, perguntar }.
 */
data class ItemDespensa(
    val k: String,
    val item: String,
    val categoria: String,
    val quantidade: Double?,
    val unidade: String?,
    val granel: Boolean,
    val estado: String,
    val validadeEm: String?,
    val venceEmDias: Int?,
    val perecivel: Boolean,
    val loja: String?,
    val compradoEm: String?,
    val kcal100: Double?,
    val p100: Double?,
    val perguntar: Boolean,
    /** O selo que o servidor mandou ("passou" | "vence" | null); `seloVeio` = a chave existe na resposta. */
    val seloServidor: String? = null,
    val seloVeio: Boolean = false,
) {
    val acabou: Boolean get() = estado == "acabou"
    val acabando: Boolean get() = estado == "acabando"

    /** Dias até vencer: o do servidor; sem ele, a conta pela data de validade. */
    fun diasParaVencer(hoje: LocalDate): Int? = venceEmDias
        ?: validadeEm?.take(10)?.let { runCatching { ChronoUnit.DAYS.between(hoje, LocalDate.parse(it)).toInt() }.getOrNull() }

    /**
     * O selo do servidor, quando ele manda ("passou" = vermelho, "vence" = laranja). Sem a chave, a mesma regra do servidor:
     * só perecível; passou do prazo = vermelho; de hoje a 2 dias = laranja.
     */
    fun selo(hoje: LocalDate): SeloValidade? {
        if (acabou) return null
        if (seloVeio) return when (seloServidor) {
            "passou" -> SeloValidade.Passou
            "vence" -> SeloValidade.VenceLogo
            else -> null
        }
        if (!perecivel) return null
        val d = diasParaVencer(hoje) ?: return null
        return when {
            d < 0 -> SeloValidade.Passou
            d <= 2 -> SeloValidade.VenceLogo
            else -> null
        }
    }

    /** "2 kg", "3 unidades", "a granel"; null quando não há o que mostrar. */
    val quantidadeTexto: String? get() = textoQuantidade(quantidade, unidade, granel)

    companion object {
        fun de(j: JSONObject): ItemDespensa? {
            val nome = j.str("item", "nome") ?: return null
            return ItemDespensa(
                k = j.str("k") ?: nome,
                item = nome,
                categoria = (j.str("categoria") ?: "outro").lowercase(BR),
                quantidade = j.num("quantidade", "qtd"),
                unidade = j.str("unidade"),
                granel = j.bool("granel") ?: false,
                estado = (j.str("estado") ?: "tem").lowercase(BR),
                validadeEm = j.str("validadeEm"),
                venceEmDias = j.int("venceEmDias"),
                perecivel = j.bool("perecivel") ?: false,
                loja = j.str("loja"),
                compradoEm = j.str("compradoEm"),
                kcal100 = j.num("kcal100") ?: j.obj("nutri").num("kcal"),
                p100 = j.num("p100") ?: j.obj("nutri").num("p"),
                perguntar = j.bool("perguntar") ?: false,
                seloServidor = j.str("selo")?.lowercase(BR),
                seloVeio = j.has("selo"),
            )
        }

        fun lista(j: JSONObject?): List<ItemDespensa> = j.arr("itens").objs().mapNotNull { de(it) }
    }
}

/** Categorias da despensa (as do servidor) no plural, na mesma ordem de cozinha que o servidor usa. */
private val categorias: List<Pair<String, String>> = listOf(
    "carne" to "Carnes", "frango" to "Frango", "peixe" to "Peixes", "ovo" to "Ovos", "laticínio" to "Laticínios",
    "laticinio" to "Laticínios", "fruta" to "Frutas", "verdura" to "Verduras", "legume" to "Legumes", "pão" to "Pães",
    "pao" to "Pães", "mercearia" to "Mercearia", "congelado" to "Congelados", "bebida" to "Bebidas", "outro" to "Outros",
)

fun rotuloCategoria(c: String): String = categorias.firstOrNull { it.first == c }?.second ?: c.replaceFirstChar { it.uppercase() }

/** Posição da categoria na lista (as desconhecidas vêm antes de "Outros", em ordem alfabética pelo rótulo). */
fun ordemCategoria(c: String): Int {
    val i = categorias.indexOfFirst { it.first == c }
    return when {
        c == "outro" -> 1000
        i >= 0 -> i
        else -> 500
    }
}

private fun numeroCurto(v: Double): String {
    val nf = NumberFormat.getNumberInstance(BR)
    nf.maximumFractionDigits = 2
    nf.minimumFractionDigits = 0
    return nf.format(v)
}

/** Unidades do servidor (un, kg, g, l, ml, pct, cx, dz, lata) com singular e plural para a tela. */
private val nomesUnidade: Map<String, Pair<String, String>> = mapOf(
    "un" to ("unidade" to "unidades"), "und" to ("unidade" to "unidades"), "unid" to ("unidade" to "unidades"),
    "unidade" to ("unidade" to "unidades"), "unidades" to ("unidade" to "unidades"),
    "l" to ("L" to "L"), "pct" to ("pacote" to "pacotes"), "pacote" to ("pacote" to "pacotes"),
    "cx" to ("caixa" to "caixas"), "dz" to ("dúzia" to "dúzias"), "lata" to ("lata" to "latas"),
)

/** "2 kg", "1 unidade", "3 pacotes", "a granel". */
fun textoQuantidade(q: Double?, unidade: String?, granel: Boolean = false): String? {
    if (granel) return "a granel"
    if (q == null || !q.isFinite() || q <= 0) return null
    val u = unidade?.trim()?.lowercase(BR)
    if (u.isNullOrEmpty()) return if (q == 1.0) "1 unidade" else "${numeroCurto(q)} unidades"
    val nome = nomesUnidade[u]?.let { (um, varios) -> if (q == 1.0) um else varios } ?: u
    return "${numeroCurto(q)} $nome"
}

/** Rótulo de uma unidade para chips e campos: "unidade", "kg", "L", "pacote". */
fun rotuloUnidade(u: String?): String = u?.trim()?.lowercase(BR)?.let { nomesUnidade[it]?.first ?: it } ?: "unidade"

/** "R$ 123,45". */
fun dinheiro(v: Double?): String = if (v == null || !v.isFinite()) "—" else NumberFormat.getCurrencyInstance(BR).format(v)

/** Item de um cupom: { item, qtd, unidade, preco }. */
data class ItemCompra(val item: String, val qtd: Double?, val unidade: String?, val preco: Double?)

/** Cupom lido: { loja, dia, origem, itens }. */
data class NotaCompra(val loja: String?, val dia: String?, val origem: String?, val itens: List<ItemCompra>, val totalServidor: Double? = null) {
    /** O total do servidor (soma dos itens lidos); sem ele, a soma aqui. */
    val total: Double? get() = totalServidor?.takeIf { it > 0 } ?: itens.mapNotNull { it.preco }.takeIf { it.isNotEmpty() }?.sum()?.takeIf { it > 0 }

    companion object {
        fun de(j: JSONObject): NotaCompra = NotaCompra(
            loja = j.str("loja"),
            dia = j.str("dia"),
            origem = j.str("origem"),
            itens = j.arr("itens").objs().mapNotNull { i ->
                val nome = i.str("item", "nome") ?: return@mapNotNull null
                ItemCompra(nome, i.num("qtd", "quantidade"), i.str("unidade"), i.num("preco"))
            },
            totalServidor = j.num("total"),
        )

        fun lista(j: JSONObject?): List<NotaCompra> = j.arr("notas").objs().map { de(it) }
    }
}

/**
 * Resumo das compras do período: gasto, quantos cupons, o que compra sempre e os perecíveis que passaram do prazo.
 * Usa o `resumo` do servidor quando ele vier como objeto; sem ele, faz a conta com os cupons da própria resposta
 * (um `resumo` em texto é ignorado: é o texto do prompt da Nutri, não da tela).
 */
data class ResumoCompras(val gasto: Double?, val cupons: Int, val recorrentes: List<String>, val vencidos: List<String>) {
    companion object {
        fun de(j: JSONObject?): ResumoCompras {
            val notas = NotaCompra.lista(j)
            val r = j.obj("resumo")
            val gastoLocal = notas.mapNotNull { it.total }.takeIf { it.isNotEmpty() }?.sum()
            val contagem = HashMap<String, Pair<String, Int>>()
            notas.forEach { n ->
                n.itens.map { it.item }.distinctBy { it.lowercase(BR) }.forEach { nome ->
                    val chave = nome.lowercase(BR)
                    val atual = contagem[chave]
                    contagem[chave] = (atual?.first ?: nome) to ((atual?.second ?: 0) + 1)
                }
            }
            val recorrentesLocal = contagem.values.filter { it.second >= 2 }.sortedByDescending { it.second }.map { it.first }.take(10)
            return ResumoCompras(
                gasto = (r.num("gasto") ?: gastoLocal)?.takeIf { it > 0 },
                cupons = r.int("cupons", "notas") ?: notas.size,
                recorrentes = r.arr("recorrentes").textos().takeIf { it.isNotEmpty() } ?: recorrentesLocal,
                vencidos = r.arr("desperdicio", "vencidos").textos(),
            )
        }
    }
}

/** Água e álcool do dia: { aguaMl, alcoolDoses }. */
data class HabitosHoje(val aguaMl: Double, val alcoolDoses: Double) {
    companion object {
        /** De `/hoje.habitos`; null quando o /hoje não traz a chave. */
        fun doHoje(hoje: JSONObject?): HabitosHoje? {
            if (hoje == null || !hoje.has("habitos")) return null
            return deObjeto(hoje.obj("habitos"))
        }

        /** De GET/POST /perfis/:id/habitos ({ dia, aguaMl, alcoolDoses }); null sem resposta. */
        fun deResposta(j: JSONObject?): HabitosHoje? = j?.let { deObjeto(it) }

        private fun deObjeto(h: JSONObject?): HabitosHoje = HabitosHoje(h.num("aguaMl", "agua_ml") ?: 0.0, h.num("alcoolDoses", "alcool_doses") ?: 0.0)
    }
}

/**
 * Atividade fixa de hoje: { id, nome, inicio, fim, feita (true|false|null), kcal }. O `como` não é lido: pode vir da
 * localização.
 */
data class FixaDoDia(val id: String, val nome: String, val inicio: String?, val feita: Boolean?, val kcal: Double?, val fim: String? = null, val aviso: String? = null, val passou: Boolean? = null) {
    companion object {
        fun lista(j: JSONObject?): List<FixaDoDia> = j.arr("hoje").objs().mapNotNull { a ->
            val id = a.str("id") ?: return@mapNotNull null
            FixaDoDia(id, a.str("nome") ?: "Atividade", a.str("inicio"), a.bool("feita"), a.num("kcal"), a.str("fim"), a.str("aviso"), a.bool("passou"))
        }
    }
}

/**
 * Uma ocorrência das próximas duas semanas (GET /atividades → proximas): { dia, id, nome, inicio, fim, aviso: 'vai'|'nao'|null,
 * feita: true|false|null, como }. `como` = "aviso" quando o "não vai" foi marcado antes; outro valor = já registrado.
 */
data class FixaProxima(val dia: String, val id: String, val nome: String, val inicio: String?, val fim: String?, val aviso: String?, val feita: Boolean?, val como: String?) {
    /** Já registrada de outro jeito (localização, "teve / não teve"): o aviso não muda mais. */
    val registrada: Boolean get() = feita != null && como != "aviso"

    companion object {
        fun lista(j: JSONObject?): List<FixaProxima> = j.arr("proximas").objs().mapNotNull { a ->
            val id = a.str("id") ?: return@mapNotNull null
            val dia = a.str("dia")?.take(10) ?: return@mapNotNull null
            FixaProxima(dia, id, a.str("nome") ?: "Atividade", a.str("inicio"), a.str("fim"), a.str("aviso"), a.bool("feita"), a.str("como"))
        }
    }
}

/** Atividade fixa esperando resposta ("teve vôlei?"): { id, nome, dia }. */
data class FixaPendente(val id: String, val nome: String, val dia: String?) {
    companion object {
        fun lista(j: JSONObject?): List<FixaPendente> = j.arr("pendentes").objs().mapNotNull { a ->
            val id = a.str("id") ?: return@mapNotNull null
            FixaPendente(id, a.str("nome") ?: "a atividade", a.str("dia"))
        }
    }
}
