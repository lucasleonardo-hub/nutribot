plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "br.nutribot.relogio"
    compileSdk = 36 // connect-client 1.1.0 exige API 36 (o Compose 1.12 já pede 37 e o AGP 9.1: por isso o BOM 2026.06.01, Compose 1.11)

    defaultConfig {
        // O applicationId e a chave de assinatura continuam os do Relógio: o app novo instala POR CIMA dele no celular do dono
        // e mantém as permissões do Health Connect, a localização e os trabalhos agendados do WorkManager.
        applicationId = "br.nutribot.relogio"
        minSdk = 28
        targetSdk = 36
        versionCode = 9
        versionName = "2.1" // 1.3: alta precisão (GNSS) e envio mais robusto · 1.4: leitor de cupom · 1.5: envio da nota pelo WorkManager · 1.6: página da SEFAZ visível quando a nota demora · 2.0: app NutriBot (Compose): Hoje, Comida, Progresso, Corpo, Nutri, lendo a API v1 do bot; o Relógio vira a tela Integrações · 2.1: registrar e ajustar refeição, humor, eventos, peso e meta pelo app
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
            // 2.1: R8 só pra ENCOLHER (o APK de 36 MB era quase só DEX de biblioteca); -dontobfuscate nas regras mantém os
            // nomes, então o stack trace continua legível e nada que use reflexão por nome quebra
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystore != null && senha != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures {
        buildConfig = true
        compose = true
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
    // o que o Relógio já usava
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0") // leitor de QR do Google (sem permissão de câmera)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // o Play Services traz um Fragment antigo; o registerForActivityResult exige 1.3+ (o lintVital do release barra sem isto)
    implementation("androidx.fragment:fragment-ktx:1.8.9")

    // app novo (2.0): Jetpack Compose + Material 3 + navegação. HTTP e JSON seguem com HttpURLConnection e org.json do Android.
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-text")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.navigation:navigation-compose:2.9.8")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
}
