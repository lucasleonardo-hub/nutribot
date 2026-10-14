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

/** Um ViewModel para o app todo: sessão, perfis, perfil ativo e o estado de cada rota (com cache em arquivo). */
class AppVM(app: Application) : AndroidViewModel(app) {
    private val sessao = Sessao(app)
    private val cache = Cache(app)

    private val _pareado = MutableStateFlow(sessao.token != null)
    val pareado: StateFlow<Boolean> = _pareado.asStateFlow()

    /** Recado mostrado na tela de pareamento (ex.: o token foi revogado). */
    private val _recado = MutableStateFlow<String?>(null)
    val recado: StateFlow<String?> = _recado.asStateFlow()

    private val _perfilAtivo = MutableStateFlow(sessao.perfilAtivo)
    val perfilAtivo: StateFlow<String?> = _perfilAtivo.asStateFlow()

    private val cargas = ConcurrentHashMap<String, MutableStateFlow<Carga>>()
    private val buscas = ConcurrentHashMap<String, Job>()

    val base: String get() = sessao.base

    fun carga(rota: String): StateFlow<Carga> = fluxo(rota)

    private fun fluxo(rota: String): MutableStateFlow<Carga> = cargas.getOrPut(rota) {
        val c = cache.ler(rota)
        MutableStateFlow(Carga(dados = c?.dados, salvoEm = c?.salvoEm, doCache = c != null))
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
                // token que não deu para decifrar agora (Keystore ocupado, por exemplo): não pede sem token nem desfaz o pareamento
                val token = withContext(Dispatchers.IO) { sessao.token }
                    ?: throw ErroApi(0, "token_local", "Não consegui ler o token guardado neste celular. Puxe para tentar de novo; se continuar, desparear em Integrações e parear de novo.")
                val j = withContext(Dispatchers.IO) { Api.get(sessao.base, rota, token) }
                val agora = System.currentTimeMillis()
                withContext(Dispatchers.IO) { cache.salvar(rota, j, agora) }
                f.value = Carga(dados = j, salvoEm = agora)
                if (rota == ROTA_PERFIS) escolherPadraoSePreciso(Perfil.lista(j))
            } catch (e: ErroApi) {
                f.update { it.copy(carregando = false, acordando = false, erro = e) }
                // só o servidor dizendo que o token é inválido ou revogado desfaz o pareamento (nunca sem_token ou falha local)
                if (e.naoAutorizado && (e.codigo == "token_invalido" || e.codigo == "token_revogado")) sair("Este aparelho não está mais autorizado (o token foi revogado ou expirou). Mande !app no privado do bot para parear de novo.")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                f.update { it.copy(carregando = false, acordando = false, erro = ErroApi(0, "falha", e.message ?: "Falha inesperada.")) }
            } finally {
                aviso.cancel()
            }
        }
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
                val token = j.str("token") ?: throw ErroApi(200, "sem_token", "O servidor não devolveu o token.")
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
                    e.status == 401 || e.codigo == "codigo_invalido" -> "Código inválido ou vencido (vale 10 minutos e uma vez só). Mande !app de novo no privado do bot."
                    e.status == 429 || e.codigo == "muitas_tentativas" -> "Muitas tentativas. Espere um pouco (são 5 por hora) e tente de novo."
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
        fun rotaHoje(id: String, dia: String? = null) = "/perfis/$id/hoje" + (dia?.let { "?dia=$it" } ?: "")
        fun rotaRefeicoes(id: String, de: String, ate: String) = "/perfis/$id/refeicoes?de=$de&ate=$ate"
        fun rotaProgresso(id: String) = "/perfis/$id/progresso"
        fun rotaCorpo(id: String) = "/perfis/$id/corpo"
        fun rotaNutri(id: String) = "/perfis/$id/nutri"
        fun rotaResumos(id: String) = "/perfis/$id/resumos"
        const val ROTA_INTEGRACOES = "/integracoes"
    }
}
