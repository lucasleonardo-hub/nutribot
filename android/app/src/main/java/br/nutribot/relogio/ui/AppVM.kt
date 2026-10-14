package br.nutribot.relogio.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import br.nutribot.relogio.dados.Perfil
import br.nutribot.relogio.dados.Sessao
import br.nutribot.relogio.dados.api.Api
import br.nutribot.relogio.dados.api.ErroApi
import br.nutribot.relogio.dados.arr
import br.nutribot.relogio.dados.cache.Cache
import br.nutribot.relogio.dados.str
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Estado de uma rota da API na tela: o que está guardado (cache ou última resposta) e o andamento da busca.
 * acordando = a resposta está demorando (Render grátis acordando, até ~1 min): a tela avisa e segue mostrando o cache.
 */
data class Carga(
    val dados: JSONObject? = null,
    val salvoEm: Long? = null,
    val carregando: Boolean = false,
    val acordando: Boolean = false,
    val erro: ErroApi? = null,
    val doCache: Boolean = false,
)

/** Andamento de uma escrita (POST/PUT/DELETE): a tela mostra "enviando" e, passados 4 s, "acordando o servidor". */
data class Escrita(val ativa: Boolean = false, val acordando: Boolean = false)

/** Um ViewModel para o app todo: sessão, perfis, perfil ativo e o estado de cada rota (com cache em arquivo). */
class AppVM(app: Application) : AndroidViewModel(app) {
    private val sessao = Sessao(app)
    private val cache = Cache(app)

    // só confere se HÁ token guardado (sem decifrar): o Keystore não é consultado na criação do VM, na thread principal
    private val _pareado = MutableStateFlow(sessao.temToken)
    val pareado: StateFlow<Boolean> = _pareado.asStateFlow()

    /** Recado mostrado na tela de pareamento (ex.: o token foi revogado). */
    private val _recado = MutableStateFlow<String?>(null)
    val recado: StateFlow<String?> = _recado.asStateFlow()

    private val _perfilAtivo = MutableStateFlow(sessao.perfilAtivo)
    val perfilAtivo: StateFlow<String?> = _perfilAtivo.asStateFlow()

    private val cargas = ConcurrentHashMap<String, MutableStateFlow<Carga>>()
    private val buscas = ConcurrentHashMap<String, Job>()

    private val _escrita = MutableStateFlow(Escrita())
    val escrita: StateFlow<Escrita> = _escrita.asStateFlow()

    val base: String get() = sessao.base

    fun carga(rota: String): StateFlow<Carga> = fluxo(rota)

    /**
     * O fluxo de uma rota começa vazio e o cache em disco entra logo depois, lido em IO (nunca durante a composição).
     * Se a rede responder antes do disco, o cache não sobrescreve a resposta nova.
     */
    private fun fluxo(rota: String): MutableStateFlow<Carga> = cargas.getOrPut(rota) {
        MutableStateFlow(Carga()).also { f ->
            viewModelScope.launch {
                val c = withContext(Dispatchers.IO) { cache.ler(rota) } ?: return@launch
                f.update { if (it.dados == null) it.copy(dados = c.dados, salvoEm = c.salvoEm, doCache = true) else it }
            }
        }
    }

    /**
     * Busca a rota no servidor. Mostra o cache enquanto isso; depois de 4 s sem resposta marca "acordando".
     * Sem forcar, não repete uma busca feita há menos de 60 s.
     */
    fun carregar(rota: String, forcar: Boolean = false) {
        val f = fluxo(rota)
        if (!_pareado.value) return
        if (buscas[rota]?.isActive == true) return
        val atual = f.value
        if (!forcar && !atual.doCache && atual.salvoEm != null && System.currentTimeMillis() - atual.salvoEm < 60_000) return
        buscas[rota] = viewModelScope.launch {
            f.update { it.copy(carregando = true, acordando = false, erro = null) }
            val aviso = launch {
                delay(4_000)
                f.update { it.copy(acordando = true) }
            }
            try {
                val token = lerToken()
                val j = withContext(Dispatchers.IO) { Api.get(sessao.base, rota, token) }
                val agora = System.currentTimeMillis()
                withContext(Dispatchers.IO) { cache.salvar(rota, j, agora) }
                f.value = Carga(dados = j, salvoEm = agora)
                if (rota == ROTA_PERFIS) escolherPadraoSePreciso(Perfil.lista(j))
            } catch (e: ErroApi) {
                f.update { it.copy(carregando = false, acordando = false, erro = e) }
                tratarNaoAutorizado(e)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                f.update { it.copy(carregando = false, acordando = false, erro = ErroApi(0, "falha", e.message ?: "Falha inesperada.")) }
            } finally {
                aviso.cancel()
            }
        }
    }

    /** O token guardado, decifrado em IO. Não ter como ler agora (Keystore ocupado) não desfaz o pareamento. */
    private suspend fun lerToken(): String = withContext(Dispatchers.IO) { sessao.token }
        ?: throw ErroApi(0, "token_local", "Não consegui ler o acesso guardado. Puxe para tentar de novo.")

    /** Só o servidor dizendo que o token é inválido ou revogado desfaz o pareamento (nunca sem_token ou falha local). */
    private fun tratarNaoAutorizado(e: ErroApi) {
        if (e.naoAutorizado && (e.codigo == "token_invalido" || e.codigo == "token_revogado")) sair("Este celular foi desconectado. Mande !app no privado do bot para ligar de novo.")
    }

    /**
     * Escrita na API (POST, PUT ou DELETE), em IO, com o token do aparelho. Lança ErroApi para a tela mostrar a mensagem
     * (422 nao_e_refeicao, 503 acordando etc.). Quem chama invalida as rotas do perfil depois do sucesso.
     */
    suspend fun escrever(metodo: String, rota: String, corpo: JSONObject?): JSONObject {
        _escrita.value = Escrita(ativa = true)
        val aviso = viewModelScope.launch {
            delay(4_000)
            _escrita.update { it.copy(acordando = true) }
        }
        try {
            val token = lerToken()
            return withContext(Dispatchers.IO) {
                when (metodo) {
                    "POST" -> Api.post(sessao.base, rota, token, corpo ?: JSONObject())
                    "PUT" -> Api.put(sessao.base, rota, token, corpo ?: JSONObject())
                    "DELETE" -> Api.delete(sessao.base, rota, token)
                    else -> throw ErroApi(0, "metodo_invalido", "Método $metodo não existe.")
                }
            }
        } catch (e: ErroApi) {
            tratarNaoAutorizado(e)
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw ErroApi(0, "falha", e.message ?: "Falha inesperada.")
        } finally {
            aviso.cancel()
            _escrita.value = Escrita()
        }
    }

    /**
     * Depois de uma escrita: tudo o que estava guardado desse perfil ficou velho. As rotas que alguma tela está observando
     * (hoje, refeições da semana, progresso, eventos...) são buscadas de novo; as outras são esquecidas (e o cache delas apagado).
     */
    fun invalidar(perfilId: String) {
        val prefixo = "/perfis/$perfilId/"
        val rotas = cargas.keys.filter { it.startsWith(prefixo) }
        viewModelScope.launch(Dispatchers.IO) {
            rotas.forEach { cache.apagar(it) }
            cache.apagar(rotaGrafico(perfilId)) // o gráfico da Nutri guardado também ficou velho
        }
        rotas.forEach { rota ->
            val f = cargas[rota] ?: return@forEach
            if (f.subscriptionCount.value > 0) {
                f.update { it.copy(doCache = true) }
                carregar(rota, forcar = true)
            } else {
                buscas.remove(rota)?.cancel()
                cargas.remove(rota)
            }
        }
    }

    /**
     * Uma imagem da API (2.3: o gráfico da Nutri), em bytes. Devolve a cópia guardada no cacheDir quando tem menos de 1 h;
     * senão busca (em IO) e guarda. Se a busca falhar e houver uma cópia velha, devolve a velha em vez de lançar.
     * Lança ErroApi (503 grafico_indisponivel, 401, 404, sem rede) quando não há o que mostrar.
     */
    suspend fun imagem(rota: String, forcar: Boolean = false): ByteArray = withContext(Dispatchers.IO) {
        val guardada = cache.lerBytes(rota)
        if (!forcar && guardada != null && System.currentTimeMillis() - guardada.salvoEm < UMA_HORA_MS) return@withContext guardada.dados
        val token = sessao.token ?: throw ErroApi(0, "token_local", "Não consegui ler o acesso guardado. Tente de novo.")
        try {
            val bytes = Api.getBytes(sessao.base, rota, token)
            cache.salvarBytes(rota, bytes)
            bytes
        } catch (e: ErroApi) {
            tratarNaoAutorizado(e)
            if (guardada != null && !e.naoAutorizado) guardada.dados else throw e
        }
    }

    /** Guarda uma resposta que já veio pronta numa escrita (ex.: o `hoje` recalculado que o POST da refeição devolve). */
    fun semear(rota: String, dados: JSONObject) {
        val agora = System.currentTimeMillis()
        viewModelScope.launch(Dispatchers.IO) { cache.salvar(rota, dados, agora) }
        fluxo(rota).value = Carga(dados = dados, salvoEm = agora)
    }

    fun escolherPerfil(id: String) {
        sessao.perfilAtivo = id
        _perfilAtivo.value = id
    }

    private fun escolherPadraoSePreciso(perfis: List<Perfil>) {
        if (perfis.isEmpty()) return
        val atual = _perfilAtivo.value
        if (atual == null || perfis.none { it.id == atual }) escolherPerfil((perfis.firstOrNull { it.ehDono } ?: perfis.first()).id)
    }

    /** Estado do pareamento (tela do código). */
    data class Pareando(val enviando: Boolean = false, val acordando: Boolean = false, val erro: String? = null)

    private val _pareando = MutableStateFlow(Pareando())
    val pareando: StateFlow<Pareando> = _pareando.asStateFlow()

    /** POST /parear { codigo, aparelho } -> { token, perfis }. */
    fun parear(codigo: String, base: String) {
        if (_pareando.value.enviando) return
        viewModelScope.launch {
            _pareando.value = Pareando(enviando = true)
            val aviso = launch {
                delay(4_000)
                _pareando.update { it.copy(acordando = true) }
            }
            try {
                if (!Api.ehSeguro(Api.baseDe(base))) throw ErroApi(0, "url_insegura", "O endereço do servidor precisa começar com https://.")
                sessao.base = base
                val nomeAparelho = listOfNotNull(Build.MANUFACTURER?.replaceFirstChar { it.uppercase() }, Build.MODEL).joinToString(" ").ifBlank { "Android" }
                val corpo = JSONObject().put("codigo", codigo).put("aparelho", nomeAparelho)
                val j = withContext(Dispatchers.IO) { Api.post(sessao.base, "/parear", null, corpo) }
                val token = j.str("token") ?: throw ErroApi(200, "sem_token", "O servidor não devolveu o acesso.")
                withContext(Dispatchers.IO) {
                    sessao.guardarToken(token)
                    if (j.arr("perfis") != null) cache.salvar(ROTA_PERFIS, JSONObject().put("perfis", j.arr("perfis")))
                }
                cargas.clear()
                escolherPadraoSePreciso(Perfil.lista(j))
                _recado.value = null
                _pareando.value = Pareando()
                _pareado.value = true
                carregar(ROTA_PERFIS, forcar = true)
            } catch (e: ErroApi) {
                val msg = when {
                    e.status == 401 || e.codigo == "codigo_invalido" -> "Código inválido ou vencido. Mande !app de novo."
                    e.status == 429 || e.codigo == "muitas_tentativas" -> "Muitas tentativas. Espere um pouco."
                    else -> e.paraPessoa
                }
                _pareando.value = Pareando(erro = msg)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _pareando.value = Pareando(erro = e.message ?: "Falha inesperada.")
            } finally {
                aviso.cancel()
            }
        }
    }

    /** Desparear este aparelho: apaga o token e o cache (os dados das pessoas não ficam no celular sem token). */
    fun sair(recado: String? = null) {
        sessao.esquecerToken()
        cache.limpar()
        buscas.values.forEach { it.cancel() }
        buscas.clear()
        cargas.clear()
        _recado.value = recado
        _pareado.value = false
    }

    companion object {
        const val ROTA_PERFIS = "/perfis"
        fun rotaPerfil(id: String) = "/perfis/$id"
        fun rotaHoje(id: String, dia: String? = null) = "/perfis/$id/hoje" + (dia?.let { "?dia=$it" } ?: "")
        fun rotaRefeicoes(id: String, de: String, ate: String) = "/perfis/$id/refeicoes?de=$de&ate=$ate"
        fun rotaNovaRefeicao(id: String) = "/perfis/$id/refeicoes"
        fun rotaRefeicao(id: String, rid: String) = "/perfis/$id/refeicoes/$rid"
        fun rotaHumor(id: String) = "/perfis/$id/humor"
        fun rotaEventos(id: String, de: String, ate: String) = "/perfis/$id/eventos?de=$de&ate=$ate"
        fun rotaEvento(id: String, eid: String) = "/perfis/$id/eventos/$eid"
        fun rotaPesagens(id: String) = "/perfis/$id/pesagens"
        /** Pesagens por intervalo (fase 3; até 366 dias): { pesagens: [{ dia, peso, gordura|null, fonte, hora|null }] }. */
        fun rotaPesagensEntre(id: String, de: String, ate: String) = "/perfis/$id/pesagens?de=$de&ate=$ate"
        fun rotaProgresso(id: String) = "/perfis/$id/progresso"
        fun rotaCorpo(id: String) = "/perfis/$id/corpo"
        fun rotaNutri(id: String) = "/perfis/$id/nutri"
        /** Fato que a Nutri sabe (fase 3): PUT { texto } corrige, DELETE apaga; a resposta traz o /nutri recalculado. */
        fun rotaFato(id: String, fid: String) = "/perfis/$id/nutri/fatos/$fid"
        /** Hipótese aberta (fase 3): DELETE descarta; a resposta traz o /nutri recalculado. */
        fun rotaHipotese(id: String, hid: String) = "/perfis/$id/nutri/hipoteses/$hid"
        fun rotaResumos(id: String) = "/perfis/$id/resumos"
        /** O gráfico da Nutri (2.3): PNG 1000×520 dos últimos `dias` dias, o mesmo do `!grafico` e do resumo de domingo. */
        fun rotaGrafico(id: String, dias: Int = 30) = "/perfis/$id/grafico.png?dias=$dias"
        /** Fase 4: série por dia (kcal, gasto, peso, massa magra, sono, passos) e a faixa da meta; até 92 dias. */
        fun rotaDias(id: String, de: String, ate: String) = "/perfis/$id/dias?de=$de&ate=$ate"
        /** Fase 4: o último plano da semana que a Nutri mandou. */
        fun rotaPlano(id: String) = "/perfis/$id/plano"
        /** Fase 4: sugestão da IA para a próxima refeição (slot opcional). */
        fun rotaSugestaoRefeicao(id: String, slot: String? = null) = "/perfis/$id/sugestao-refeicao" + (slot?.let { "?slot=$it" } ?: "")
        const val ROTA_INTEGRACOES = "/integracoes"
        private const val UMA_HORA_MS = 60L * 60 * 1000
    }
}
