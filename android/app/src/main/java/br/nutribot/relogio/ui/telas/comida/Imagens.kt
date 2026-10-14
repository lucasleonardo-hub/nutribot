package br.nutribot.relogio.ui.telas.comida

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.ByteArrayOutputStream
import java.io.File

/** Uma foto pronta para enviar: o JPEG reduzido (1280 px, qualidade 80) e a prévia para a tela. */
class FotoPronta(val jpeg: ByteArray, val previa: ImageBitmap) {
    val base64: String get() = Base64.encodeToString(jpeg, Base64.NO_WRAP)
}

/**
 * Reduz a foto antes de mandar (o servidor aceita até 2 MB por foto; 1280 px em JPEG 80 fica em 200–400 KB) e faz a miniatura
 * (160 px, JPEG 70, ≤ 24 KB) que o diário mostra. Tudo aqui é CPU e disco: chame fora da thread principal.
 * Nada da foto vai para log.
 */
object Imagens {
    const val LADO_MAX = 1280
    const val LADO_MINIATURA = 160

    /** Pasta do cacheDir exposta ao app de câmera pelo FileProvider (res/xml/caminhos.xml). */
    fun pastaFotos(ctx: Context): File = File(ctx.cacheDir, "fotos").apply { mkdirs() }

    /** Lê, reduz e corrige a rotação pelo EXIF. null quando o arquivo não é uma imagem que dê para decodificar. */
    fun reduzir(ctx: Context, uri: Uri, ladoMax: Int = LADO_MAX, qualidade: Int = 80): FotoPronta? {
        val resolver = ctx.contentResolver
        // 1) só as medidas, para escolher o inSampleSize (decodificar a foto inteira de 12 MP estouraria a memória)
        val medidas = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, medidas) } ?: return null
        val w = medidas.outWidth
        val h = medidas.outHeight
        if (w <= 0 || h <= 0) return null
        var amostra = 1
        while (maxOf(w, h) / (amostra * 2) >= ladoMax) amostra *= 2
        // 2) decodifica reduzido e redimensiona para no máximo ladoMax no lado maior
        val opcoes = BitmapFactory.Options().apply { inSampleSize = amostra; inPreferredConfig = Bitmap.Config.ARGB_8888 }
        var bmp = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opcoes) } ?: return null
        val maior = maxOf(bmp.width, bmp.height)
        if (maior > ladoMax) {
            val fator = ladoMax.toFloat() / maior
            val novo = Bitmap.createScaledBitmap(bmp, (bmp.width * fator).toInt().coerceAtLeast(1), (bmp.height * fator).toInt().coerceAtLeast(1), true)
            if (novo !== bmp) bmp.recycle()
            bmp = novo
        }
        // 3) rotação do EXIF (a câmera grava a foto deitada e anota a orientação; sem isto a IA e a prévia veem o prato de lado)
        val orientacao = runCatching {
            resolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
        }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
        val girado = girar(bmp, orientacao)
        if (girado !== bmp) bmp.recycle()
        val saida = ByteArrayOutputStream()
        girado.compress(Bitmap.CompressFormat.JPEG, qualidade, saida)
        val jpeg = saida.toByteArray()
        // prévia pequena para a folha (1/4 do reduzido: ~320 px)
        val previa = Bitmap.createScaledBitmap(girado, (girado.width / 4).coerceAtLeast(1), (girado.height / 4).coerceAtLeast(1), true)
        if (previa !== girado) girado.recycle()
        return FotoPronta(jpeg, previa.asImageBitmap())
    }

    private fun girar(bmp: Bitmap, orientacao: Int): Bitmap {
        val m = Matrix()
        when (orientacao) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.preScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.preScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.preScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.preScale(-1f, 1f) }
            else -> return bmp
        }
        return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    }

    /** Miniatura em base64 (sem o prefixo data:), 160 px no lado maior, JPEG 70; baixa a qualidade se passar de 24 KB. */
    fun miniatura(jpegReduzido: ByteArray): String? {
        val bmp = BitmapFactory.decodeByteArray(jpegReduzido, 0, jpegReduzido.size) ?: return null
        val maior = maxOf(bmp.width, bmp.height)
        val fator = LADO_MINIATURA.toFloat() / maior
        val peq = if (maior > LADO_MINIATURA) Bitmap.createScaledBitmap(bmp, (bmp.width * fator).toInt().coerceAtLeast(1), (bmp.height * fator).toInt().coerceAtLeast(1), true) else bmp
        var qualidade = 70
        var bytes: ByteArray
        do {
            val s = ByteArrayOutputStream()
            peq.compress(Bitmap.CompressFormat.JPEG, qualidade, s)
            bytes = s.toByteArray()
            qualidade -= 15
        } while (bytes.size > 24 * 1024 && qualidade >= 25)
        if (peq !== bmp) peq.recycle()
        bmp.recycle()
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    /** A miniatura que vem da API ("data:image/jpeg;base64,..." ou só o base64) como imagem para a tela. */
    fun deDataUri(s: String?): ImageBitmap? {
        if (s.isNullOrBlank()) return null
        val b64 = s.substringAfter("base64,", s)
        return runCatching {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()
    }

    /** Apaga as fotos temporárias da câmera (depois do envio ou ao fechar a folha). */
    fun limparTemporarias(ctx: Context) {
        runCatching { pastaFotos(ctx).listFiles()?.forEach { it.delete() } }
    }
}
