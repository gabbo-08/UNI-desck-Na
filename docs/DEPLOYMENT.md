# Deploy di UniDesk NA senza tenere acceso il PC

Questa procedura pubblica il frontend e il backend su un servizio cloud. Dopo il deploy, il telefono usa un URL HTTPS e il PC locale non deve restare acceso.

La procedura presuppone un repository Git, un dominio opzionale e accesso al provider scelto. Prima della pubblicazione reale completare Privacy/Termini con il titolare, i contatti e le basi giuridiche applicabili.

## 1. Preparare il repository

Usare Node.js almeno 22.12.0; il Dockerfile usa Node 24. Node 20 non supporta le versioni di Puppeteer e SQLite installate.

1. Eseguire i controlli locali:

   ```powershell
   npm install
   npm run check
   Set-Location frontend
   npm install
   npm run lint
   npm run build
   Set-Location ..
   ```

2. Verificare che `.env` non sia tracciato da Git.
3. Generare una chiave diversa per ogni ambiente:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Fare il push del codice senza `.env`, credenziali, database locali, log o backup.

## 2. Configurazione backend di produzione

Creare nel provider queste variabili segrete/configurazioni:

```env
NODE_ENV=production
CRED_KEY=<64 caratteri esadecimali casuali>
PORT=3001
HOST=0.0.0.0
COOKIE_SECURE=true
# Se app e API hanno domini diversi (es. Vercel + Render), usa none.
COOKIE_SAMESITE=none
FRONTEND_URL=https://app.example.it
PUBLIC_ORIGIN=https://api.example.it
TRUST_PROXY=1
ALLOW_DYNAMIC_ORIGIN=false
AUTO_PURGE_PERSONAL_DATA=true
PERSONAL_DATA_RETENTION_DAYS=30
DOCENTI_CACHE_RETENTION_HOURS=24
TEACHER_CACHE_RETENTION_DAYS=30
DOCENTI_SYNC_ENABLED=false
ALLOW_RESTRICTED_DOCENTI_MATERIALS=false
SUPPORT_ADMIN_TOKEN=<token opzionale per leggere le segnalazioni>
SCRAPER_CONCURRENCY=2
SCRAPER_APPELLI_CONCURRENCY=2
SCRAPER_TASK_TIMEOUT_MS=180000
DOCENTI_MAX_PAGINATION_PAGES=20
PUPPETEER_ALLOW_NO_SANDBOX=
DEBUG_SCRAPER=false
METRICS_TOKEN=<token casuale per l'endpoint /metrics>
```

`DOCENTI_USERNAME` e `DOCENTI_PASSWORD` restano vuoti se l'accesso Docenti viene effettuato con l'opt-in del singolo studente. Non inserire credenziali reali in repository, Dockerfile, log o ticket.

## 3. Opzione consigliata: Render

### Backend

1. Creare un **Web Service** collegato al repository.
2. Selezionare il Dockerfile nella root.
3. Impostare il servizio su una porta pubblica coerente con `PORT`; il server ascolta su `0.0.0.0`.
4. Configurare il percorso di health check su `/ready`.
5. Aggiungere tutte le variabili della sezione precedente nel pannello Environment.
6. Per SQLite, collegare un **Persistent Disk** montato su `/app/data` e mantenere una sola istanza finché il database non viene migrato a PostgreSQL.
7. Eseguire il deploy e verificare:

   ```text
   https://api.example.it/health
   https://api.example.it/ready
   ```

### Frontend

1. Creare un secondo **Web Service** Node nella directory `frontend`.
2. Impostare:

   ```text
   Root Directory: frontend
   Build Command: npm ci && npm run build
   Start Command: npm run start
   ```

3. Impostare la variabile di build:

   ```env
   NODE_ENV=production
   NEXT_PUBLIC_BACKEND_URL=https://api.example.it
   ```

4. Pubblicare il frontend e collegare il dominio `app.example.it`.
5. Aggiornare `FRONTEND_URL` del backend con il dominio definitivo del frontend.
6. Eseguire un nuovo deploy del backend dopo la modifica dell'origine.

### Vercel per il solo frontend

Il progetto Vercel collegato a questo repository usa la directory `frontend`.
Vercel pubblica quindi Next.js, ma non rende persistente il backend Express e
il file SQLite della root. La configurazione preferita usa il rewrite
server-side di Next.js: imposta `BACKEND_URL=https://api.example.it` nelle
variabili di build Vercel e lascia `NEXT_PUBLIC_BACKEND_URL` vuota. Il browser
chiamerà `/api` sullo stesso dominio Vercel e il cookie non sarà trattato come
cookie di terze parti. Se usi invece un URL API pubblico nel frontend, imposta
`NEXT_PUBLIC_BACKEND_URL=https://api.example.it` e `COOKIE_SAMESITE=none` nel
backend. Usa un backend sempre attivo con database persistente (Render con
Persistent Disk, PostgreSQL/Turso gestito o una VPS). Non usare
`http://127.0.0.1:3001` o un'istanza serverless effimera: il cookie di accesso
può restare nel browser mentre sessioni, dati lenti e cache Docenti vengono
persi al cold start.

Nel backend configura anche `PUSH_VAPID_SUBJECT`, `PUSH_VAPID_PUBLIC_KEY` e
`PUSH_VAPID_PRIVATE_KEY`; senza queste tre variabili l'app mostra i promemoria
locali ma le notifiche push restano disattivate.

## 4. Opzione VPS con Docker

1. Creare una VPS Linux aggiornata con almeno 2 vCPU e 4 GB RAM per una prima installazione.
2. Installare Docker e Docker Compose.
3. Clonare il repository in una directory non esposta pubblicamente.
4. Creare `.env` con i valori di produzione e una directory persistente per `data/`.
5. Avviare il backend:

   ```bash
   docker build -t unidesk-na-api .
   docker run -d --name unidesk-api --restart unless-stopped \
     --env-file .env \
     -p 127.0.0.1:3001:3001 \
     -v /srv/unidesk/data:/app/data \
     unidesk-na-api
   ```

6. Avviare il frontend con `npm ci`, `npm run build` e `npm start`, oppure usare un container Node separato.
7. Mettere davanti a entrambi un reverse proxy HTTPS fidato (Caddy, Nginx o equivalente).
8. Configurare il proxy per inoltrare `X-Forwarded-Proto` e `X-Forwarded-Host`, quindi impostare `TRUST_PROXY` solo per quel proxy.
9. Limitare il backend a `127.0.0.1`; esporre pubblicamente solo il reverse proxy.

## 5. Dominio e HTTPS

1. Creare i record DNS `app` e `api` verso i servizi cloud o il reverse proxy.
2. Attivare certificati TLS automatici.
3. Verificare che HTTP rediriga a HTTPS.
4. Impostare `COOKIE_SECURE=true` soltanto quando il frontend usa HTTPS.
5. Controllare che le richieste API dal browser ricevano `Access-Control-Allow-Origin` solo per il dominio frontend configurato.

## 6. Backup e ripristino

Per SQLite:

1. Eseguire un backup online coerente o fermare temporaneamente il backend.
2. Copiare il database e, se presenti, i file `-wal` e `-shm` insieme.
3. Cifrare il backup e conservarlo con accesso limitato e retention definita.
4. Testare il restore in un ambiente isolato.
5. Non usare un backup copiato durante una scrittura senza verificare l'integrità.

Per 50.000 studenti, pianificare la migrazione a PostgreSQL gestito, Redis condiviso e una coda per gli scraper prima di abilitare più istanze backend.

## 7. Verifica dopo ogni deploy

Dal terminale:

```powershell
$env:SMOKE_BASE_URL="https://api.example.it"
npm run smoke:health
```

Controllare inoltre:

- pagina frontend raggiungibile;
- login e logout con cookie `HttpOnly`;
- `/health` con `200`;
- `/ready` con `200` e controlli database/scraper positivi;
- apertura di un PDF Docenti in una sola scheda;
- export e cancellazione dati;
- `/privacy` e `/terms` raggiungibili;
- log privi di password, token, cookie e payload personali.

`/metrics` è protetto in produzione dall'header `X-Metrics-Token`. Se il token
non è configurato, l'endpoint resta non disponibile; `/health` e `/ready`
restano pubblici per i controlli del provider.

## 8. Aggiornamento e rollback

1. Eseguire test e build prima del push.
2. Pubblicare prima il backend e attendere `/ready`.
3. Pubblicare il frontend con `NEXT_PUBLIC_BACKEND_URL` già definitivo.
4. Controllare i log e le metriche per almeno un ciclo di health check.
5. In caso di errore, tornare al commit precedente dal provider o ripristinare l'immagine Docker precedente.
6. Non cambiare `CRED_KEY` durante un rollback senza una procedura di re-encryption compatibile.

## 9. Installazione sul telefono

1. Aprire `https://app.example.it` da Chrome o Safari.
2. Usare **Installa app** / **Aggiungi alla schermata Home**.
3. Abilitare le notifiche solo dopo aver configurato un provider push autorizzato.
4. Su Android, impostare la batteria su **Senza restrizioni** per la PWA o l'app wrapper, se si desidera ridurre la sospensione in background.

L'app installata sul telefono non esegue il backend: il servizio cloud deve rimanere attivo e raggiungibile.

## 10. Notifiche push Web e APK

La procedura completa di consenso, smoke test, privacy, VAPID, FCM e worker/cron e in [PUSH_NOTIFICHE.md](aggiornamenti/PUSH_NOTIFICHE.md).

Per la PWA/browser shortcut, genera le chiavi VAPID una sola volta:

```powershell
npm run push:generate-vapid
```

Inserisci `PUSH_VAPID_SUBJECT`, `PUSH_VAPID_PUBLIC_KEY` e `PUSH_VAPID_PRIVATE_KEY` nei segreti del backend. La chiave privata resta solo nel provider e non va mai inserita nel frontend o in GitHub.

L'utente abilita le notifiche dalla dashboard. Il browser registra `public/sw.js`, salva la sottoscrizione cifrata lato server e può ricevere notifiche anche con la PWA chiusa quando il provider invia il messaggio. L'endpoint `/api/notifications/test` serve solo a verificare una sottoscrizione già autorizzata.

L'APK Flutter/WebView non riceve automaticamente le notifiche Web Push. Per notifiche native Android serve un progetto Firebase Cloud Messaging, `google-services.json`, permesso Android per le notifiche e un'integrazione Flutter FCM separata; questi file e credenziali vanno forniti dal gestore dell'app.
