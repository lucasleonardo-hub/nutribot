// Projeto raiz do app NutriBot (antigo "Relógio": lê o Health Connect e manda pro bot; desde a 2.0 também mostra os dados do bot).
// Compilado pelo GitHub Actions (android.yml publica a release "relogio"; android-app.yml publica a release "app").
plugins {
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    // Compose: desde o Kotlin 2.0 o compilador do Compose vem no próprio Kotlin (mesma versão do plugin acima)
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
