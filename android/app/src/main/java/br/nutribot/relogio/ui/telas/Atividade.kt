package br.nutribot.relogio.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.bool
import br.nutribot.relogio.dados.num
import br.nutribot.relogio.dados.obj
import br.nutribot.relogio.dados.objs
import br.nutribot.relogio.dados.str
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.Formato
import br.nutribot.relogio.ui.componentes.AneisAtividade
import br.nutribot.relogio.ui.componentes.BarrasHora
import br.nutribot.relogio.ui.componentes.Cartao
import br.nutribot.relogio.ui.componentes.ConteudoCarga
import br.nutribot.relogio.ui.componentes.CoresAtividade
import br.nutribot.relogio.ui.componentes.LinhaValor
import br.nutribot.relogio.ui.componentes.Mascote
import br.nutribot.relogio.ui.componentes.NumeroMeta
import br.nutribot.relogio.ui.componentes.Pilula
import br.nutribot.relogio.ui.componentes.Pose
import br.nutribot.relogio.ui.componentes.SemanaAneis
import br.nutribot.relogio.ui.componentes.SeletorDia
import br.nutribot.relogio.ui.componentes.TituloSecao
import br.nutribot.relogio.ui.componentes.Vazio
import br.nutribot.relogio.ui.componentes.duracaoCurta
import br.nutribot.relogio.ui.componentes.fracao
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** Metas padrão do contrato (o servidor manda as do perfil quando existem). */
internal const val META_PASSOS = 8000.0
internal const val META_MIN_ATIVOS = 60.0
internal const val META_KCAL_ATIVAS = 500.0

/** "7.951 passos de 8.000; 112 minutos ativos de 60; 676 kcal ativas de 500." */
internal fun descricaoAneis(passos: Double?, metaP: Double, min: Double?, metaM: Double, kcal: Double?, metaK: Double): String =
    "Anéis de atividade: ${Formato.inteiro(passos)} passos de ${Formato.inteiro(metaP)}; " +
        "${Formato.inteiro(min)} minutos ativos de ${Formato.inteiro(metaM)}; " +
        "${Formato.inteiro(kcal)} kcal ativas de ${Formato.inteiro(metaK)}."

/** Um array de 24 números (horas) em lista; null quando não veio. */
private fun horas(a: JSONArray?): List<Double>? {
    if (a == null || a.length() == 0) return null
    return (0 until minOf(24, a.length())).map { i -> a.optDouble(i, 0.0).takeIf { it.isFinite() && it > 0 } ?: 0.0 }
}

/*
 * Tela da Atividade (fase 6), dia navegável ‹ ›: GET /perfis/:id/atividade?dia= →
 * { dia, passos, metaPassos, minAtivos, metaMin, kcalAtivas, metaKcal, kcalTotal, kcalAtivasEstimada,
 *   porHora{passos[24]|null, kcal[24]|null}, picoHora, exercicios[{nome,hora,min,kcal,fcMedia}], semana[{dia,passosPct,minPct,kcalPct}] }.
 * Fase 7 (só quando vieram): distanciaKm e porHora.kcalAtivas[24]; com as kcal ativas oficiais, kcalAtivasEstimada = false.
 */
@Composable
fun TelaAtividade(vm: AppVM, perfil: Perfil?, diaArg: String?, voltar: () -> Unit) {
    if (perfil == null) { Vazio("Escolha um perfil no Hoje."); return }
    val hoje = remember(diaArg, perfil.fuso) { Formato.dia(diaArg) ?: Formato.hojeDe(null, perfil.fuso) }
    var diaStr by rememberSaveable(perfil.id) { mutableStateOf(Formato.iso(hoje)) }
    val dia = Formato.dia(diaStr) ?: hoje
    val minimo = hoje.minusDays(90)
    val rota = AppVM.rotaAtividade(perfil.id, diaStr)
    val carga by vm.carga(rota).collectAsStateWithLifecycle()
    LaunchedEffect(rota) { vm.carregar(rota) }
    ConteudoCarga(
        carga, { vm.carregar(rota, forcar = true) },
        topo = {
            CabecalhoVoltar("Atividade", perfil.curto, null, voltar)
            SeletorDia(dia, hoje, minimo, { diaStr = Formato.iso(it) })
        },
    ) { j ->
        // a hora de agora no fuso da pessoa, só quando o dia mostrado é o de hoje (dia em andamento)
        val agora = perfil.fuso?.let { f -> runCatching { ZonedDateTime.now(ZoneId.of(f)) }.getOrNull() } ?: ZonedDateTime.now()
        val horaAtual = if (dia == agora.toLocalDate()) agora.hour else null
        // dias da semana antes do limite de 90 o servidor recusa: o toque não faz nada
        ConteudoAtividade(j, dia, horaAtual) { d -> if (Formato.dia(d)?.isBefore(minimo) == false) diaStr = d }
    }
}

@Composable
private fun ConteudoAtividade(j: JSONObject, dia: LocalDate, horaAtual: Int?, aoEscolherDia: (String) -> Unit) {
    val passos = j.num("passos")
    val metaP = j.num("metaPassos")?.takeIf { it > 0 } ?: META_PASSOS
    val minAtivos = j.num("minAtivos")
    val metaM = j.num("metaMin")?.takeIf { it > 0 } ?: META_MIN_ATIVOS
    val kcalAtivas = j.num("kcalAtivas")
    val metaK = j.num("metaKcal")?.takeIf { it > 0 } ?: META_KCAL_ATIVAS
    val semDado = passos == null && minAtivos == null && kcalAtivas == null

    // anéis grandes e os três números com a meta
    Cartao(forma = Formas.Grande, padding = PaddingValues(18.dp)) {
        if (semDado) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Mascote(Pose.DuplaCorrendo, 64.dp)
                Text("O relógio não mandou atividade neste dia.", style = MaterialTheme.typography.bodyLarge, color = Cores.Tinta2, modifier = Modifier.weight(1f))
            }
        } else {
            val tamanho = 184.dp * LocalDensity.current.fontScale.coerceIn(1f, 1.2f)
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                AneisAtividade(
                    fracao(passos, metaP), fracao(minAtivos, metaM), fracao(kcalAtivas, metaK), tamanho,
                    descricaoAneis(passos, metaP, minAtivos, metaM, kcalAtivas, metaK),
                )
            }
            Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NumeroMeta("Passos", passos, metaP, null, CoresAtividade.PassosTinta, Modifier.weight(1f))
                NumeroMeta("Tempo ativo", minAtivos, metaM, "min", CoresAtividade.MinutosTinta, Modifier.weight(1f))
                NumeroMeta("Kcal ativas", kcalAtivas, metaK, null, CoresAtividade.KcalTinta, Modifier.weight(1f))
            }
            // fase 7: distância só com a permissão (a chave não vem sem ela)
            j.num("distanciaKm")?.let { LinhaValor("Distância", "${Formato.decimal(it, 1)} km", Modifier.padding(top = 10.dp)) }
            j.num("kcalTotal")?.let { LinhaValor("Gasto total do dia", "${Formato.kcal(it)} kcal", Modifier.padding(top = if (j.num("distanciaKm") != null) 4.dp else 10.dp)) }
            if (j.bool("kcalAtivasEstimada") == true) Pilula("kcal ativas estimadas", Cores.Trilho, Cores.LilasTexto, Modifier.padding(top = 4.dp))
        }
    }

    // por hora: passos e calorias da atividade (o gasto acima da hora mais parada do dia)
    // No dia em andamento, o piso só olha as horas já fechadas: a hora atual está pela metade e não é o repouso de uma
    // hora inteira. Sem nenhuma hora fechada ainda, as calorias por hora não aparecem.
    // Fase 7: com as calorias ativas por hora do Health Connect (permissão opcional), elas entram no lugar da estimativa.
    val ph = j.obj("porHora")
    val passosHora = horas(ph.arr("passos"))
    val ativasHora = horas(ph.arr("kcalAtivas"))
    val kcalHora = if (ativasHora != null) null else horas(ph.arr("kcal"))?.let { v ->
        val fechadas = v.filterIndexed { h, x -> x > 0 && (horaAtual == null || h < horaAtual) }
        val piso = fechadas.minOrNull()
        if (piso == null && horaAtual != null) null
        else v.map { if (it > 0) (it - (piso ?: 0.0)).coerceAtLeast(0.0) else 0.0 }
    }
    if (!semDado) {
        Cartao(forma = Formas.Cartao, atraso = 40) {
            if (passosHora == null && kcalHora == null && ativasHora == null) {
                Text("Por hora", style = MaterialTheme.typography.titleMedium)
                Text("Sem dados por hora neste dia: o relógio mandou só o total do dia.", style = MaterialTheme.typography.bodySmall, color = Cores.Tinta3)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    passosHora?.let { BarrasHora("Passos", it, CoresAtividade.Passos, "passos", j.str("picoHora")) }
                    ativasHora?.let { BarrasHora("Calorias ativas", it, CoresAtividade.Kcal, "kcal", null) }
                    kcalHora?.let { BarrasHora("Calorias da atividade (estimativa)", it, CoresAtividade.Kcal, "kcal", null) }
                }
            }
        }
    }

    // exercícios do dia
    val exercicios = j.arr("exercicios").objs()
    if (exercicios.isNotEmpty()) {
        TituloSecao("Exercícios")
        exercicios.forEachIndexed { i, e ->
            val nome = e.str("nome") ?: "Exercício"
            val detalhe = listOfNotNull(
                e.num("min")?.takeIf { it > 0 }?.let { duracaoCurta(it) },
                e.num("kcal")?.takeIf { it > 0 }?.let { "${Formato.kcal(it)} kcal" },
                e.num("fcMedia")?.takeIf { it > 0 }?.let { "FC média ${Formato.inteiro(it)} bpm" },
            ).joinToString(" · ")
            Cartao(Modifier.semantics(mergeDescendants = true) {}, forma = Formas.Cartao, padding = PaddingValues(14.dp), atraso = 60 + i * 40) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Mascote(Pose.CorgiSupino, 44.dp)
                    Column(Modifier.weight(1f)) {
                        Text(nome, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (detalhe.isNotBlank()) Text(detalhe, style = MaterialTheme.typography.bodySmall, color = Cores.Tinta2)
                    }
                    e.str("hora")?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = Cores.Tinta3) }
                }
            }
        }
    }

    // a semana em mini-anéis (tocar escolhe o dia)
    val semana = j.arr("semana").objs()
    if (semana.isNotEmpty()) {
        Cartao(forma = Formas.Cartao, atraso = 80) {
            Text("Semana", style = MaterialTheme.typography.titleMedium)
            SemanaAneis(semana, Formato.iso(dia), Modifier.padding(top = 8.dp), aoEscolher = aoEscolherDia)
        }
    }
}
