package br.nutribot.relogio.dados

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cifra o token do aparelho com uma chave AES-256 do Android Keystore (AES/GCM, IV aleatório por gravação).
 * A chave nunca sai do Keystore; no SharedPreferences fica só "iv:cifrado" em Base64.
 * (EncryptedSharedPreferences está depreciado; isto é o mesmo princípio, sem a biblioteca.)
 */
object Cofre {
    private const val ALIAS = "nutribot_app_token"
    private const val PROVEDOR = "AndroidKeyStore"
    private const val TRANSFORMACAO = "AES/GCM/NoPadding"

    private fun chave(): SecretKey {
        val ks = KeyStore.getInstance(PROVEDOR).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gerador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVEDOR)
        gerador.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gerador.generateKey()
    }

    fun cifrar(texto: String): String {
        val c = Cipher.getInstance(TRANSFORMACAO)
        c.init(Cipher.ENCRYPT_MODE, chave())
        val cifrado = c.doFinal(texto.toByteArray(Charsets.UTF_8))
        return b64(c.iv) + ":" + b64(cifrado)
    }

    /** null se não der para decifrar (chave apagada, dado corrompido): o app pede para parear de novo. */
    fun decifrar(guardado: String?): String? {
        if (guardado.isNullOrBlank()) return null
        return try {
            val (iv, cifrado) = guardado.split(":", limit = 2).let { Base64.decode(it[0], Base64.NO_WRAP) to Base64.decode(it[1], Base64.NO_WRAP) }
            val c = Cipher.getInstance(TRANSFORMACAO)
            c.init(Cipher.DECRYPT_MODE, chave(), GCMParameterSpec(128, iv))
            String(c.doFinal(cifrado), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
}
