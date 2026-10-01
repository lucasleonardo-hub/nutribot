plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.nutribot.relogio"
    compileSdk = 36 // connect-client 1.1.0 exige API 36

    defaultConfig {
        applicationId = "br.nutribot.relogio"
        minSdk = 28
        targetSdk = 36
        versionCode = 5
        versionName = "1.4" // 1.3: alta precisão (GNSS) e envio mais robusto · 1.4: leitor de cupom (QR da NFC-e aberto no celular e texto da nota enviado ao bot)
    }

    // Assinatura estável (mesma chave em todo build, senão o Android recusa atualizar por cima):
    // o GitHub Actions decodifica o keystore do segredo RELOGIO_KEYSTORE_B64 e passa caminho e senha por variável.
    val keystore = System.getenv("RELOGIO_KEYSTORE")
    val senha = System.getenv("RELOGIO_KEYSTORE_PASS")
    if (keystore != null && senha != null) {
        signingConfigs {
            create("release") {
                storeFile = file(keystore)
                storePassword = senha
                keyAlias = "relogio"
                keyPassword = senha
                storeType = "PKCS12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystore != null && senha != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures {
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0") // leitor de QR do Google (sem permissão de câmera)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
