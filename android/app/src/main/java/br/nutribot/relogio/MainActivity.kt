package br.nutribot.relogio

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import br.nutribot.relogio.legado.Cupom
import br.nutribot.relogio.legado.Leitor
import br.nutribot.relogio.legado.Local
import br.nutribot.relogio.legado.Prefs
import br.nutribot.relogio.ui.AppVM
import br.nutribot.relogio.ui.NutriApp
import br.nutribot.relogio.ui.Rotas
import br.nutribot.relogio.ui.componentes.Botao
import br.nutribot.relogio.ui.telas.Legado
import br.nutribot.relogio.ui.tema.Cores
import br.nutribot.relogio.ui.tema.Formas
import br.nutribot.relogio.ui.tema.NutriTema
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 2.0: o app NutriBot (Compose) e, dentro dele, tudo o que o Relógio fazia. O nome da classe não muda: o atalho na tela inicial,
 * o activity-alias do Health Connect e os "Abrir com" dos links das SEFAZ apontam para .MainActivity.
 * A lógica do Relógio (permissões, sincronizar, localização, bateria, cupom no WebView) é a mesma da 1.6, só que o status vai
 * para a tela Integrações (objeto Legado) em vez do TextView.
 */
class MainActivity : ComponentActivity() {
    private val vm: AppVM by viewModels()
    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var legado: Legado
    private var leitura = 0 // cada leitura de cupom tem um número; a cancelada não mexe mais na tela

    private val pedirPermissoes = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { concedidas ->
        val faltam = Leitor.permissoes - concedidas
        legado.status = if (faltam.isEmpty()) "Permissões OK. Sincronizando..." else "Faltaram ${faltam.size} permissões. Toque em Permissões de novo e marque tudo (inclusive 'em segundo plano')."
        if (faltam.isEmpty()) SyncWorker.agora(this)
    }

    // Localização: primeiro "enquanto usa" (fina + aproximada), depois "o tempo todo" (o Android exige em dois passos)
    private val pedirSegundoPlano = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        prefs.localizacao = true
        legado.localizacaoLigada = true
        legado.status = if (ok || Local.temSegundoPlano(this)) "Localização ligada. Um ponto vai junto de cada envio (a cada 15 min)."
        else "Localização ligada só com o app aberto. Pra valer em segundo plano, abra as configurações do app e escolha \"Permitir o tempo todo\"."
        SyncWorker.agora(this)
    }
    private val pedirLocalizacao = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        val ok = r[Manifest.permission.ACCESS_COARSE_LOCATION] == true || r[Manifest.permission.ACCESS_FINE_LOCATION] == true
        if (!ok) {
            legado.status = "Sem permissão de localização; os lugares ficam desligados."
            prefs.localizacao = false
            legado.localizacaoLigada = false
            return@registerForActivityResult
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !Local.temSegundoPlano(this)) pedirSegundoPlano.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        else {
            prefs.localizacao = true
            legado.localizacaoLigada = true
            legado.status = "Localização ligada. Um ponto vai junto de cada envio (a cada 15 min)."
            SyncWorker.agora(this)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        web = WebView(this)
        legado = Legado(
            aoPermissoes = ::permissoes,
            aoSincronizar = ::sincronizar,
            aoBateria = {
                // sem isso o Samsung "adormece" o app e o envio de 15 min vira uma vez por hora ou nunca
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            },
            aoLocalizacao = ::localizacao,
            aoLerCupom = {
                if (!prefs.configurado) legado.status = "Preencha URL, nome e token antes." else lerQrComCamera()
            },
        )
        legado.localizacaoLigada = prefs.localizacao

        // O Health Connect abre o app para explicar o uso dos dados: vai direto para Integrações (tem a explicação)
        // Só na criação de verdade: numa recriação (rotação, tema) a navegação e o cupom já foram tratados
        val primeiraVez = savedInstanceState == null
        val rotaInicial = if (!primeiraVez) null else when (intent?.action) {
            "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE", "android.intent.action.VIEW_PERMISSION_USAGE" -> Rotas.INTEGRACOES
            else -> null
        }
        val reduzir = runCatching { Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)

        setContent {
            NutriTema(reduzirMovimento = reduzir) {
                Box(Modifier.fillMaxSize().background(Cores.Lavanda)) {
                    NutriApp(vm, legado, rotaInicial)
                    if (legado.lendoCupom) PainelCupom()
                    // "voltar" com o painel do cupom aberto cancela a leitura, em vez de navegar por baixo dele
                    BackHandler(enabled = legado.lendoCupom) { cancelarCupom() }
                }
            }
        }

        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData("relogio-agora").observe(this) { infos ->
            val w = infos.firstOrNull() ?: return@observe
            if ((w.state == WorkInfo.State.SUCCEEDED || w.state == WorkInfo.State.FAILED) && !legado.lendoCupom) atualizarStatus()
        }
        // resultado do envio da nota (NotaWorker) aparece na tela assim que terminar
        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData(NotaWorker.NOME).observe(this) { infos ->
            val w = infos.firstOrNull() ?: return@observe
            if ((w.state == WorkInfo.State.SUCCEEDED || w.state == WorkInfo.State.FAILED) && !legado.lendoCupom) atualizarStatus()
        }
        // o trabalho periódico de 15 min continua registrado como no Relógio (UPDATE: mesmo nome, mesma classe)
        if (prefs.configurado) SyncWorker.agendar(this)
        atualizarStatus()
        lifecycleScope.launch {
            if (Leitor.disponivel(this@MainActivity)) {
                val faltam = Leitor.permissoes - Leitor.concedidas(this@MainActivity)
                if (faltam.isNotEmpty() && prefs.ultimoResultado.isBlank()) legado.status = "1) Preencha nome e token. 2) Toque em Permissões e marque tudo. 3) Toque em Sincronizar agora."
            }
        }
        if (primeiraVez) tratarIntent(intent)
    }

    /** Leitura do cupom por cima de qualquer tela: status e, quando a SEFAZ demora, a própria página para a pessoa tocar. */
    @androidx.compose.runtime.Composable
    private fun PainelCupom() {
        Column(
            Modifier.fillMaxSize().background(Color(0x992B2340)).statusBarsPadding().navigationBarsPadding().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(Modifier.fillMaxWidth().background(Cores.Branco, Formas.Cartao).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Lendo o cupom", style = MaterialTheme.typography.titleLarge)
                Text(legado.status, style = MaterialTheme.typography.bodyMedium, color = Cores.Tinta2)
            }
            if (legado.webVisivel) {
                AndroidView(factory = { web.also { (it.parent as? android.view.ViewGroup)?.removeView(it) } }, modifier = Modifier.fillMaxWidth().weight(1f).background(Cores.Branco, Formas.Cartao))
            }
            Botao("Cancelar", Modifier.fillMaxWidth(), suave = true) { cancelarCupom() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tratarIntent(intent)
    }

    private fun permissoes() {
        if (!Leitor.disponivel(this)) {
            legado.status = "Health Connect não disponível. No Android 13 instale o app Health Connect na Play Store; no 14+ ele já vem no sistema."
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata")))
            return
        }
        pedirPermissoes.launch(Leitor.permissoes)
    }

    private fun sincronizar() {
        if (!prefs.configurado) {
            legado.status = "Preencha URL, nome e token."
            return
        }
        legado.status = "Sincronizando..."
        SyncWorker.agendar(this)
        SyncWorker.agora(this)
    }

    private fun localizacao() {
        if (prefs.localizacao) {
            // toque de novo desliga
            prefs.localizacao = false
            legado.localizacaoLigada = false
            legado.status = "Localização desligada. O bot para de receber pontos (e apaga os brutos em 7 dias)."
            return
        }
        pedirLocalizacao.launch(Local.permissoesBase)
    }

    /** Link da SEFAZ compartilhado ("Compartilhar" no leitor de QR) ou aberto com o app ("Abrir com"). */
    private fun tratarIntent(intent: Intent?) {
        val texto = when (intent?.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        } ?: return
        val link = Regex("https?://\\S+").find(texto)?.value ?: return
        if (!Cupom.ehLinkDeNota(link)) {
            legado.status = "Esse link não parece ser de uma nota fiscal (NFC-e)."
            return
        }
        if (!prefs.configurado) {
            legado.status = "Preencha URL, nome e token (em Integrações) e compartilhe o link de novo."
            return
        }
        lerCupom(link)
    }

    /** Leitor de QR do Google (Play Services): não precisa de permissão de câmera nem de tela própria. */
    private fun lerQrComCamera() {
        val opcoes = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
        legado.status = "Aponte pro QR do cupom..."
        GmsBarcodeScanning.getClient(this, opcoes).startScan()
            .addOnSuccessListener { barcode ->
                val valor = barcode.rawValue ?: ""
                if (Cupom.ehLinkDeNota(valor)) lerCupom(valor)
                else legado.status = "Esse QR não é de nota fiscal (NFC-e). Procure o QR grande no fim do cupom."
            }
            .addOnCanceledListener { atualizarStatus() }
            .addOnFailureListener { e -> legado.status = "Leitor de QR indisponível: ${e.message}. Alternativa: leia o QR com a câmera e compartilhe o link com este app." }
    }

    /** Abre a nota no WebView (a verificação do site roda como num navegador), extrai o texto e manda pro bot. */
    private fun lerCupom(link: String) {
        if (legado.lendoCupom) return
        legado.lendoCupom = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // a página da SEFAZ precisa da tela acesa pra carregar
        legado.webVisivel = false
        legado.status = "Abrindo a nota na SEFAZ..."
        val minha = ++leitura
        Cupom.ler(
            web,
            link,
            mostrar = { if (minha == leitura) legado.webVisivel = true },
            progresso = { if (minha == leitura) legado.status = it },
            pronto = { texto, pagina ->
                if (minha != leitura || !legado.lendoCupom) return@ler // cancelada pela pessoa
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                legado.webVisivel = false
                if (texto == null) {
                    legado.lendoCupom = false
                    legado.status = "A SEFAZ não mostrou a nota em 150 s. Mandei um diagnóstico pro bot. Alternativa: manda a FOTO do cupom no grupo que o bot lê pela imagem."
                    // o que a tela mostrava vai pro servidor (fica 3 dias) pra descobrir por que a nota não veio
                    lifecycleScope.launch {
                        withContext(Dispatchers.IO) {
                            runCatching { Cupom.enviarDiagnostico(prefs.url, prefs.token, prefs.pessoa, Cupom.chaveDe(link), link, pagina ?: "", "pagina nao virou nota em 150 s") }
                        }
                    }
                    return@ler
                }
                // 1.5: o envio vai pro WorkManager (NotaWorker): segue com a tela apagada e com o app fechado, e tenta de novo se a rede falhar.
                NotaWorker.enviar(this@MainActivity, Cupom.chaveDe(link), link, texto)
                legado.lendoCupom = false
                legado.status = prefs.notaResultado
            }
        )
    }

    private fun cancelarCupom() {
        leitura++
        legado.lendoCupom = false
        legado.webVisivel = false
        web.stopLoading()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        legado.status = "Leitura do cupom cancelada."
    }

    override fun onResume() {
        super.onResume()
        if (!legado.lendoCupom) atualizarStatus()
    }

    private fun atualizarStatus() {
        val r = prefs.ultimoResultado
        val loc = if (prefs.localizacao) (if (Local.temSegundoPlano(this)) "Localização: ligada." else "Localização: ligada só com o app aberto (falta \"o tempo todo\").") else "Localização: desligada (opcional)."
        val nota = prefs.notaResultado
        if (r.isNotBlank() || nota.isNotBlank()) legado.status = (if (nota.isNotBlank()) nota + "\n\n" else "") + r + "\nEnvio automático a cada 15 min enquanto houver internet.\n" + loc
    }
}
