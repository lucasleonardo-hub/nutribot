package br.nutribot.relogio

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.launch

/** Tela única: URL do bot, seu primeiro nome, o token, botões de permissão e sincronizar, e o status do último envio. */
class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var status: TextView

    private val pedirPermissoes = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { concedidas ->
        val faltam = Leitor.permissoes - concedidas
        status.text = if (faltam.isEmpty()) "Permissões OK. Sincronizando..." else "Faltaram ${faltam.size} permissões. Toque em Permissões de novo e marque tudo (inclusive 'em segundo plano')."
        if (faltam.isEmpty()) SyncWorker.agora(this)
    }

    // Localização: primeiro "enquanto usa" (fina + aproximada), depois "o tempo todo" (o Android exige em dois passos)
    private val pedirSegundoPlano = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        prefs.localizacao = true
        status.text = if (ok || Local.temSegundoPlano(this)) "Localização ligada. Um ponto aproximado vai junto de cada envio (a cada 15 min)."
        else "Localização ligada só com o app aberto. Pra valer em segundo plano, abra as configurações do app e escolha \"Permitir o tempo todo\"."
        SyncWorker.agora(this)
    }
    private val pedirLocalizacao = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r ->
        val ok = r[Manifest.permission.ACCESS_COARSE_LOCATION] == true || r[Manifest.permission.ACCESS_FINE_LOCATION] == true
        if (!ok) { status.text = "Sem permissão de localização; os lugares ficam desligados."; prefs.localizacao = false; return@registerForActivityResult }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !Local.temSegundoPlano(this)) pedirSegundoPlano.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        else { prefs.localizacao = true; status.text = "Localização ligada. Um ponto aproximado vai junto de cada envio (a cada 15 min)."; SyncWorker.agora(this) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)
        status = findViewById(R.id.status)
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

        WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData("relogio-agora").observe(this) { infos ->
            val w = infos.firstOrNull() ?: return@observe
            if (w.state == WorkInfo.State.SUCCEEDED || w.state == WorkInfo.State.FAILED) atualizarStatus()
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
    }

    override fun onResume() {
        super.onResume()
        atualizarStatus()
    }

    private fun atualizarStatus() {
        val r = prefs.ultimoResultado
        val loc = if (prefs.localizacao) (if (Local.temSegundoPlano(this)) "Localização: ligada." else "Localização: ligada só com o app aberto (falta \"o tempo todo\").") else "Localização: desligada (opcional)."
        if (r.isNotBlank()) status.text = r + "\nEnvio automático a cada 15 min enquanto houver internet.\n" + loc
    }
}
