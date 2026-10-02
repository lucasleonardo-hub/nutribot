package br.nutribot.relogio

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Tela única: URL do bot, seu primeiro nome, o token, botões de permissão/sincronizar/localização/bateria, o leitor de cupom
 * (1.4) e o status do último envio. O cupom também chega por "Compartilhar" o link do QR ou por "Abrir com" nos links da SEFAZ.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var status: TextView
    private lateinit var web: WebView
    private var lendoCupom = false

    private val pedirPermissoes = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { concedidas ->
        val faltam = Leitor.permissoes - concedidas
        status.text = if (faltam.isEmpty()) "Permissões OK. Sincronizando..." else "Faltaram ${faltam.size} permissões. Toque em Permissões de novo e marque tudo (inclusive 'em segundo plano')."
        if (faltam.isEmpty()) SyncWorker.agora(this)
    }

    // Localização: primeiro "enquanto usa" (fina + aproximada), depois "o tempo todo" (o Android exige em dois passos)
    private val pedirSegundoPlano = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        prefs.localizacao = true
        status.text = if (ok || Local.temSegundoPlano(this)) "Localização ligada. Um ponto vai junto de cada envio (a cada 15 min)."
        else "Localização ligada só com o app aberto. Pra valer em segundo plano, abra as configurações do app e escolha \"Permitir o tempo todo\"."
        SyncWorker.agora(this)
    }
    private val pedirLocalizacao = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        val ok = r[Manifest.permission.ACCESS_COARSE_LOCATION] == true || r[Manifest.permission.ACCESS_FINE_LOCATION] == true
        if (!ok) { status.text = "Sem permissão de localização; os lugares ficam desligados."; prefs.localizacao = false; return@registerForActivityResult }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !Local.temSegundoPlano(this)) pedirSegundoPlano.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        else { prefs.localizacao = true; status.text = "Localização ligada. Um ponto vai junto de cada envio (a cada 15 min)."; SyncWorker.agora(this) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)
        status = findViewById(R.id.status)
        web = findViewById(R.id.web)
        val url = findViewById<EditText>(R.id.url)
        val pessoa = findViewById<EditText>(R.id.pessoa)
        val token = findViewById<EditText>(R.id.token)
        url.setText(prefs.url); pessoa.setText(prefs.pessoa); token.setText(prefs.token)

        fun salvar() {
            prefs.url = url.text.toString(); prefs.pessoa = pessoa.text.toString(); prefs.token = token.text.toString()
        }

        findViewById<Button>(R.id.permissoes).setOnClickListener {
            salvar()
            if (!Leitor.disponivel(this)) {
                status.text = "Health Connect não disponível. No Android 13 instale o app Health Connect na Play Store; no 14+ ele já vem no sistema."
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata")))
                return@setOnClickListener
            }
            pedirPermissoes.launch(Leitor.permissoes)
        }
        findViewById<Button>(R.id.sincronizar).setOnClickListener {
            salvar()
            if (!prefs.configurado) { status.text = "Preencha URL, nome e token."; return@setOnClickListener }
            status.text = "Sincronizando..."
            SyncWorker.agendar(this)
            SyncWorker.agora(this)
        }
        findViewById<Button>(R.id.localizacao).setOnClickListener {
            salvar()
            if (prefs.localizacao) {
                // toque de novo desliga
                prefs.localizacao = false
                status.text = "Localização desligada. O bot para de receber pontos (e apaga os brutos em 7 dias)."
                return@setOnClickListener
            }
            pedirLocalizacao.launch(Local.permissoesBase)
        }
        findViewById<Button>(R.id.bateria).setOnClickListener {
            // sem isso o Samsung "adormece" o app e o envio de 15 min vira uma vez por hora ou nunca
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
        findViewById<Button>(R.id.cupom).setOnClickListener {
            salvar()
            if (!prefs.configurado) { status.text = "Preencha URL, nome e token antes."; return@setOnClickListener }
            lerQrComCamera()
        }

        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData("relogio-agora").observe(this) { infos ->
            val w = infos.firstOrNull() ?: return@observe
            if ((w.state == WorkInfo.State.SUCCEEDED || w.state == WorkInfo.State.FAILED) && !lendoCupom) atualizarStatus()
        }
        // resultado do envio da nota (NotaWorker) aparece na tela assim que terminar
        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData(NotaWorker.NOME).observe(this) { infos ->
            val w = infos.firstOrNull() ?: return@observe
            if ((w.state == WorkInfo.State.SUCCEEDED || w.state == WorkInfo.State.FAILED) && !lendoCupom) atualizarStatus()
        }
        if (prefs.configurado) SyncWorker.agendar(this)
        atualizarStatus()
        // no primeiro uso, confere permissões e avisa
        lifecycleScope.launch {
            if (Leitor.disponivel(this@MainActivity)) {
                val faltam = Leitor.permissoes - Leitor.concedidas(this@MainActivity)
                if (faltam.isNotEmpty() && prefs.ultimoResultado.isBlank()) status.text = "1) Preencha nome e token. 2) Toque em Permissões e marque tudo. 3) Toque em Sincronizar agora."
            }
        }
        tratarIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tratarIntent(intent)
    }

    /** Link da SEFAZ compartilhado ("Compartilhar" no leitor de QR) ou aberto com o app ("Abrir com"). */
    private fun tratarIntent(intent: Intent?) {
        val texto = when (intent?.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        } ?: return
        val link = Regex("https?://\\S+").find(texto)?.value ?: return
        if (!Cupom.ehLinkDeNota(link)) { status.text = "Esse link não parece ser de uma nota fiscal (NFC-e)."; return }
        if (!prefs.configurado) { status.text = "Preencha URL, nome e token e compartilhe o link de novo."; return }
        lerCupom(link)
    }

    /** Leitor de QR do Google (Play Services): não precisa de permissão de câmera nem de tela própria. */
    private fun lerQrComCamera() {
        val opcoes = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
        status.text = "Aponte pro QR do cupom..."
        GmsBarcodeScanning.getClient(this, opcoes).startScan()
            .addOnSuccessListener { barcode ->
                val valor = barcode.rawValue ?: ""
                if (Cupom.ehLinkDeNota(valor)) lerCupom(valor)
                else status.text = "Esse QR não é de nota fiscal (NFC-e). Procure o QR grande no fim do cupom."
            }
            .addOnCanceledListener { atualizarStatus() }
            .addOnFailureListener { e -> status.text = "Leitor de QR indisponível: ${e.message}. Alternativa: leia o QR com a câmera e compartilhe o link com este app." }
    }

    /** Abre a nota no WebView (a verificação do site roda como num navegador), extrai o texto e manda pro bot. */
    private fun lerCupom(link: String) {
        if (lendoCupom) return
        lendoCupom = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // a página da SEFAZ precisa da tela acesa pra carregar
        web.visibility = View.GONE
        status.text = "Abrindo a nota na SEFAZ..."
        Cupom.ler(
            web,
            link,
            mostrar = { web.visibility = View.VISIBLE },
            progresso = { status.text = it },
            pronto = { texto, pagina ->
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                web.visibility = View.GONE
                if (texto == null) {
                    lendoCupom = false
                    status.text = "A SEFAZ não mostrou a nota em 150 s. Mandei um diagnóstico pro bot. Alternativa: manda a FOTO do cupom no grupo que o bot lê pela imagem."
                    // o que a tela mostrava vai pro servidor (fica 3 dias) pra descobrir por que a nota não veio
                    lifecycleScope.launch {
                        withContext(Dispatchers.IO) {
                            runCatching { Cupom.enviarDiagnostico(prefs.url, prefs.token, prefs.pessoa, Cupom.chaveDe(link), link, pagina ?: "", "pagina nao virou nota em 150 s") }
                        }
                    }
                    return@ler
                }
                // 1.5: o envio vai pro WorkManager (NotaWorker): segue com a tela apagada e com o app fechado, e tenta de novo se a
                // rede falhar. Na 1.4 era na hora, preso à tela: apagou, parou, e a nota se perdia.
                NotaWorker.enviar(this@MainActivity, Cupom.chaveDe(link), link, texto)
                lendoCupom = false
                status.text = prefs.notaResultado
            }
        )
    }

    override fun onResume() {
        super.onResume()
        if (!lendoCupom) atualizarStatus()
    }

    private fun atualizarStatus() {
        val r = prefs.ultimoResultado
        val loc = if (prefs.localizacao) (if (Local.temSegundoPlano(this)) "Localização: ligada." else "Localização: ligada só com o app aberto (falta \"o tempo todo\").") else "Localização: desligada (opcional)."
        val nota = prefs.notaResultado
        if (r.isNotBlank() || nota.isNotBlank()) status.text = (if (nota.isNotBlank()) nota + "\n\n" else "") + r + "\nEnvio automático a cada 15 min enquanto houver internet.\n" + loc
    }
}
