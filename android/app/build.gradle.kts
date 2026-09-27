plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.nutribot.relogio"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.nutribot.relogio"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
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
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
