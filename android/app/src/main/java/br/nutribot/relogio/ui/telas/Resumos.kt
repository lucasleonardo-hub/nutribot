package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.DiaSerie
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.int
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.CartaoExpansivel
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.Link
import br.nutribot.relogio.ui.componentes.MarkdownSimples
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.MiniGrafico
import br.nutribot.relogio.ui.componentes.ModoGrafico
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.Segmentado
import br.nutribot.relogio.ui.componentes.TamanhoVisual
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import org.json.JSONObject

/**
 * /resumos (formato da frente S): { semana, mes, sequencia, relatorio }, cada período
 * { de, ate, dias, diasComRegistro, diasComEstimativa, kcalMedia, proteinaMedia, metaProteina{min,max}, diasCompletos, diasProteinaBatida, peso{inicio{dia,peso}, fim{dia,peso}, variacao}, texto }.
 * "Mês" = os últimos 30 dias fechados. Fase 4: os números em cartões curtos, mini-gráficos do /dias do período e o relatório
 * que a Nutri escreveu (`relatorio.semana` / `relatorio.mes`, nulos quando ainda não há).
 */
@Composable
fun TelaResumos(vm: AppVM, perfil: Perfil?, voltar: () -> Unit) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val rota = AppVM.rotaResumos(perfil.id)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    var aba by rememberSaveable { mutableIntStateOf(0) }
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            CabecalhoVoltar("Resumos", "${perfil.curto} · últimos 7 e 30 dias fechados", Pose.DuplaProgresso, voltar)
            Segmentado(listOf("Semana", "Mês (30 dias)"), aba, { aba = it }, Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp))
        },
    ) { j ->
        val chave = if (aba == 0) "semana" else "mes"
        val p = j.obj(chave)
        if (p == null) {
            Vazio("Ainda não há dados para este período.")
        } else {
            Periodo(vm, perfil.id, p)
            Graficos(vm, perfil.id, p, chave)
        }
        Relatorio(j.obj("relatorio").obj(chave), chave)
        j.int("sequencia")?.let { s ->
            Cartao(cor = Cores.BomFundo) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Mascote(if (s >= 20) Pose.LontraTrofeu else Pose.DuplaFeliz, 56.dp)
                    Column {
                        Text("$s ${if (s == 1) "dia" else "dias"} seguidos com registro", style = MaterialTheme.typography.titleMedium)
                        Text("a sequência que rega o brotinho", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
                    }
                }
            }
        }
    }
}

/** Cartão curto com um número: título pequeno, valor grande, uma linha de apoio. Cabe dois por linha. */
@Composable
private fun RowScope.CartaoNumero(titulo: String, valor: String, sub: String?, cor: Color = Cores.Branco, atraso: Int = 0) {
    Cartao(Modifier.weight(1f), cor = cor, forma = Formas.Cartao, padding = PaddingValues(12.dp), atraso = atraso) {
        Text(titulo, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(valor, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Periodo(vm: AppVM, perfilId: String, p: JSONObject) {
    val de = Formato.dia(p.str("de"))
    val ate = Formato.dia(p.str("ate"))
    val dias = p.int("dias")
    Cartao(pincel = Brush.linearGradient(listOf(Cores.Trilho, Cores.BomFundo))) {
        Text(if (de != null && ate != null) "${Formato.diaCurto(de)} a ${Formato.diaCurto(ate)}" else "Período", style = MaterialTheme.typography.labelMedium, color = Cores.Tinta3)
        p.str("texto")?.let { Text(it, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 4.dp)) }
    }
    fun deDias(v: Int?) = if (v == null) "—" else if (dias != null) "$v de $dias" else "$v"
    val mp = p.obj("metaProteina")
    val metaProt = mp?.let { "meta ${Formato.gramas(it.num("min"))}–${Formato.gramas(it.num("max"))} g" }
    val w = p.obj("peso")
    val ini = w.obj("inicio").num("peso")
    val fim = w.obj("fim").num("peso")
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        CartaoNumero("Dias com registro", deDias(p.int("diasComRegistro")), p.int("diasComEstimativa")?.let { "$it com estimativa" }, atraso = 40)
        CartaoNumero("Dias completos", deDias(p.int("diasCompletos")), "as refeições principais", atraso = 60)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        CartaoNumero("Média de calorias", p.num("kcalMedia")?.let { "${Formato.kcal(it)} kcal" } ?: "—", "por dia com registro", cor = Cores.Trilho, atraso = 80)
        CartaoNumero("Proteína média", p.num("proteinaMedia")?.let { "${Formato.gramas(it)} g" } ?: "—", listOfNotNull(metaProt, p.int("diasProteinaBatida")?.let { "${deDias(it)} dias batida" }).joinToString(" · ").ifBlank { null }, cor = Cores.ProteinaTrilho, atraso = 100)
    }
    if (w != null && (ini != null || fim != null)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CartaoNumero(
                "Peso no período", "${Formato.decimal(ini)} → ${Formato.decimal(fim)} kg",
                listOfNotNull(w.num("variacao")?.let { "${Formato.sinal(it, 1)} kg" }, listOfNotNull(Formato.dia(w.obj("inicio").str("dia"))?.let { Formato.diaCurto(it) }, Formato.dia(w.obj("fim").str("dia"))?.let { Formato.diaCurto(it) }).joinToString(" a ").ifBlank { null }).joinToString(" · ").ifBlank { null },
                cor = Cores.BomFundo, atraso = 120,
            )
        }
    }
}

/** Mini-gráficos do período, a partir do GET /dias?de=&ate= (kcal com a faixa da meta, peso, sono, passos). */
@Composable
private fun Graficos(vm: AppVM, perfilId: String, p: JSONObject, chave: String) {
    val de = p.str("de")?.take(10) ?: return
    val ate = p.str("ate")?.take(10) ?: return
    val rota = AppVM.rotaDias(perfilId, de, ate)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    val dados = carga.dados
    val erro = carga.erro
    when {
        dados == null && erro != null -> {
            Text("Os gráficos não vieram: ${erro.paraPessoa}", style = MaterialTheme.typography.bodySmall, color = Cores.CuidadoTinta)
            Link("tentar de novo") { vm.carregar(rota, forcar = true) }
        }
        dados == null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CircularProgressIndicator(Modifier.size(18.dp), color = Cores.Acai, strokeWidth = 2.dp)
            Text(if (carga.acordando) "Acordando o servidor. Leva até 1 minuto." else "Montando os gráficos…", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
        }
        else -> {
            val serie = DiaSerie.lista(dados)
            if (serie.isEmpty()) return
            val meta = dados.obj("meta")
            val faixa = meta.num("min")?.let { mn -> meta.num("max")?.let { mx -> if (mx > mn) mn to mx else null } }
            val kcal = serie.map { it.kcal }
            val peso = serie.map { it.peso }
            val sono = serie.map { it.sonoMin?.takeIf { m -> m > 0 }?.div(60.0) }
            val passos = serie.map { it.passos?.takeIf { v -> v > 0 } }
            fun media(l: List<Double?>): Double? = l.filterNotNull().takeIf { it.isNotEmpty() }?.average()
            val pesos = peso.filterNotNull()
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MiniGrafico(
                    "Calorias por dia", media(kcal)?.let { "${Formato.kcal(it)} kcal" } ?: "—", kcal, ModoGrafico.Barras, Cores.Acai, Modifier.weight(1f),
                    faixa = faixa, descricao = "Calorias por dia: média ${Formato.kcal(media(kcal))} kcal" + (faixa?.let { " (meta ${Formato.kcal(it.first)} a ${Formato.kcal(it.second)})" } ?: ""), atraso = 140,
                )
                MiniGrafico(
                    "Peso", if (pesos.size >= 2) "${Formato.sinal(pesos.last() - pesos.first(), 1)} kg" else pesos.lastOrNull()?.let { "${Formato.decimal(it)} kg" } ?: "—",
                    peso, ModoGrafico.Linha, Cores.AcaiEscuro, Modifier.weight(1f), descricao = "Peso: ${pesos.size} pesagens no período", atraso = 160,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MiniGrafico("Sono por noite", media(sono)?.let { Formato.sono(it * 60) } ?: "—", sono, ModoGrafico.Barras, Cores.LilasForte, Modifier.weight(1f), faixa = 7.0 to 9.0, corFaixa = Cores.Trilho, descricao = "Sono: média ${Formato.sono(media(sono)?.times(60))} por noite", atraso = 180)
                MiniGrafico("Passos por dia", media(passos)?.let { Formato.inteiro(it) } ?: "—", passos, ModoGrafico.Barras, Cores.Verde, Modifier.weight(1f), descricao = "Passos: média ${Formato.inteiro(media(passos))} por dia", atraso = 200)
            }
        }
    }
}

/** O relatório da Nutri do período ({ titulo, texto, criadoEm } | null) num cartão que abre com o texto inteiro. */
@Composable
private fun Relatorio(r: JSONObject?, chave: String) {
    val texto = r.str("texto") ?: return
    val titulo = r.str("titulo") ?: if (chave == "semana") "Resumo da semana" else "Relatório do mês"
    val quando = Formato.dia(r.str("criadoEm"))?.let { Formato.diaCurto(it) }
    CartaoExpansivel(
        "relatorio-$chave", pincel = Brush.linearGradient(listOf(Cores.Trilho, Cores.BomFundo)), atraso = 220,
        cabecalho = {
            Mascote(Pose.DuplaConferindo, TamanhoVisual)
            Column(Modifier.weight(1f)) {
                Text("O que a Nutri escreveu", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(titulo, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(quando, "sobre o grupo").joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
    ) {
        MarkdownSimples(texto)
    }
}
