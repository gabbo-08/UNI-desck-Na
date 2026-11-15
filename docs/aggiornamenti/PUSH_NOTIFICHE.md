# Notifiche push Web e Android

Questa guida descrive esattamente cosa è già presente nel repository e quali credenziali esterne servono per attivare l'invio reale. L'indice degli aggiornamenti è in [README.md](README.md).

Le notifiche sono opzionali e richiedono consenso esplicito dell'utente. Il browser o l'APK non devono ricevere password, token di sessione o dati personali nei payload.

## Web Push per PWA e scorciatoia browser

### 1. Generare le chiavi VAPID

Esegui una sola volta su una macchina amministrativa:

```powershell
node -e "const p=require('web-push'); console.log(p.generateVAPIDKeys())"
```

Conserva la chiave privata solo nel secret manager del provider. Non inserirla nel repository, nei log o nel frontend.

### 2. Configurare il backend

```env
PUSH_VAPID_SUBJECT=mailto:contatto@tuodominio.it
PUSH_VAPID_PUBLIC_KEY=<chiave-pubblica-vapid>
PUSH_VAPID_PRIVATE_KEY=<chiave-privata-vapid>
```

Il frontend deve essere pubblicato in HTTPS. Il service worker è `frontend/public/sw.js`.

### 3. Attivare dal browser

1. Apri la PWA su HTTPS.
2. Accedi all'account.
3. Premi **Attiva notifiche push** nella Home.
4. Accetta il permesso del browser.
5. Il browser invia una subscription al backend; il contenuto viene cifrato nel database.

Per verificare il canale premi **Invia notifica di test**. Il test invia solo un messaggio generico e non parte automaticamente.

Per disattivare il browser usa **Disattiva** nella stessa sezione oppure cancella i dati del sito.

### 4. Invio dei promemoria

La registrazione, la cifratura e l'invio Web Push sono presenti nel repository. La pianificazione automatica deve essere eseguita da un worker/cron protetto del provider, non da un endpoint pubblico senza autenticazione. Il worker deve leggere solo eventi autorizzati, inviare payload minimi, eliminare subscription 404/410, rispettare retention e revoca del consenso e non registrare payload personali.

## Notifiche nell'APK Android

L'APK include il percorso Firebase Cloud Messaging e la richiesta del permesso Android `POST_NOTIFICATIONS`. Per renderlo operativo servono un progetto Firebase del gestore e la configurazione FlutterFire:

```powershell
Set-Location android_app
dart pub global activate flutterfire_cli
flutterfire configure
flutter pub get
flutter build apk --release
```

La configurazione genera i file Firebase necessari per il progetto scelto. Non committare file di credenziali del server, service account o token FCM.

Prima di inviare notifiche APK in produzione occorre collegare il token FCM dell'installazione a un endpoint backend autenticato e aggiungere un worker di invio. Il token non deve essere stampato nei log.

## Verifica e sicurezza

- Web Push funziona solo su HTTPS, salvo localhost in sviluppo.
- Il permesso viene richiesto soltanto dopo un'azione esplicita.
- La disiscrizione rimuove l'endpoint dal backend.
- La cancellazione del profilo elimina le subscription associate.
- Il backend restituisce `503 PUSH_NOT_CONFIGURED` se VAPID non è configurato.
- Il payload contiene soltanto titolo, testo breve, URL locale e tag.

## Smoke test prima del rilascio

Esegui i controlli dalla root del repository:

```powershell
npm run check:env
node --test test/notifications-routes.test.js test/web-push-config.test.js
Set-Location frontend
npm run lint
npm run build
Set-Location ..
```

Con un backend gia pubblicato, verifica anche `GET /health` e `GET /ready`. Per una prova end-to-end autenticata, apri la PWA su HTTPS, abilita il consenso dal **Centro notifiche** e premi **Invia notifica di test**. Il browser deve ricevere il messaggio generico anche dopo aver chiuso la scheda, se il provider push e il service worker sono operativi.

## Scheduler e cron

Il repository espone il canale di registrazione e invio, ma non crea da solo un processo cron. Prima di attivare promemoria automatici serve un worker separato del provider (o un job schedulato con autenticazione forte) che:

1. selezioni soltanto scadenze gia autorizzate dall'utente;
2. deduplichi gli invii con una chiave evento/data;
3. invii un payload minimo senza matricola, email, voti, password o token;
4. elimini le subscription che rispondono `404` o `410`;
5. rispetti revoca del consenso, cancellazione profilo e retention;
6. registri solo esito, latenza e conteggi aggregati.

Non esporre mai un endpoint cron pubblico senza autenticazione, firma o allowlist di rete. Il job deve poter essere disattivato senza modificare il consenso gia espresso e deve usare un timeout e un limite di retry; in caso di errore ripetuto va segnalato al gestore senza scrivere il payload nei log.
