# UniDesk NA per Android - versione sperimentale

> **Disclaimer:** UniDesk NA è un progetto indipendente e non ufficiale. Non è affiliato, patrocinato o approvato dall'Università degli Studi di Napoli Federico II. I marchi citati appartengono ai rispettivi proprietari e indicano soltanto la compatibilità del servizio.

L'app Android apre il server UniDesk NA configurato dall'utente in una WebView. Per sicurezza accetta HTTPS; HTTP è consentito solo in debug verso localhost o reti private.

L'app non include credenziali preimpostate e non modifica l'identità grafica dell'asset `logo_prova.jpg` usato dal frontend.

Le notifiche push della PWA richiedono VAPID configurato sul backend. Il wrapper Android non riceve automaticamente Web Push: per notifiche native servono Firebase Cloud Messaging, `google-services.json`, permessi Android e codice Flutter FCM con credenziali del progetto.

Per l'uso quotidiano è consigliata la PWA HTTPS del frontend: dal browser scegli **Installa app**. Il wrapper Android richiede comunque un backend cloud raggiungibile e non esegue il server sul telefono.

La procedura completa per configurazione, deploy e installazione è disponibile in `../PROCEDURA_CASA.md` e `../docs/DEPLOYMENT.md`.

## Firma della release Android

La build `--release` non usa più la chiave debug. Prima di generare un APK
distribuibile configura nel sistema di build i quattro segreti del keystore:

```text
ANDROID_KEYSTORE_FILE
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Senza questi valori la build si interrompe esplicitamente. Il keystore e i
segreti non devono entrare nel repository o nell'APK.

## Notifiche Android con Firebase Cloud Messaging

Il codice include il percorso FCM, ma le notifiche remote diventano operative solo dopo la configurazione di un progetto Firebase del gestore:

1. Installa Flutter e Firebase CLI.
2. Dalla directory `android_app` esegui `dart pub global activate flutterfire_cli`.
3. Esegui `flutterfire configure` e seleziona il progetto Firebase e l'app Android.
4. Verifica che venga generato `lib/firebase_options.dart` e aggiungi la configurazione Android richiesta da Firebase.
5. Ricostruisci con `flutter pub get` e `flutter build apk --release`.
6. In Android 13 o superiore autorizza esplicitamente le notifiche quando l'app lo richiede.

Non committare chiavi private, account service, token FCM o file di credenziali del server. Il token FCM viene richiesto solo dopo il consenso e non viene stampato nei log applicativi.

La configurazione segue la documentazione ufficiale Firebase per [setup Flutter](https://firebase.google.com/docs/flutter/setup) e [messaggistica Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages).
