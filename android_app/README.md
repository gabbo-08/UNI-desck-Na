# Segrepass per Android — versione sperimentale

L'APK è un contenitore WebView che salva l'indirizzo del frontend e lo riapre ai successivi avvii. Backend Node.js e browser automatizzati restano sul PC/server: non vengono eseguiti sul telefono. L'APK release accetta solo URL HTTPS; HTTP è ammesso esclusivamente in debug verso una rete privata.

Per l'avvio completo da PC e il test via Wi-Fi, inclusi `FRONTEND_URL`, `allowedDevOrigins` e il riavvio dei servizi, segui la sezione **Test da telefono Android — versione sperimentale** nel [README principale](../README.md).

## Ricompilare

Serve Flutter, Android SDK e JDK 21. Dalla cartella `android_app`, esegui:

```powershell
flutter pub get
flutter build apk --release --target-platform=android-arm64
```

Il file generato è `android_app/build/app/outputs/flutter-apk/app-release.apk` relativo alla root del repository. La build è per telefoni Android `arm64`.
