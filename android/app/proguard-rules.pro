# Regras do R8 pro release do app NutriBot (fase 2, A7). O objetivo é ENCOLHER (tirar classes e recursos que ninguém usa:
# o APK de 36 MB é quase só DEX de biblioteca), não esconder: -dontobfuscate mantém os nomes, então o stack trace de um
# erro no celular do dono continua legível e nada que use reflexão por nome quebra.
-dontobfuscate
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# O app inteiro fica como está (é pequeno; o ganho é todo nas bibliotecas). Workers do WorkManager e o FileProvider são
# achados pelo nome da classe.
-keep class br.nutribot.relogio.** { *; }

# Health Connect (AIDL + protobuf), Play Services (localização e leitor de QR) e coroutines já trazem as próprias regras
# de consumo; estas só reforçam o que o lintVital costuma apontar.
-keep class androidx.health.connect.** { *; }
-keep class androidx.health.platform.** { *; }
-dontwarn androidx.health.**
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**
-dontwarn kotlinx.coroutines.**
-dontwarn org.jetbrains.annotations.**
