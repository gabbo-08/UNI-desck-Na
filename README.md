# UniDesk NA

> **Disclaimer:** **UniDesk NA** è un progetto indipendente, **non ufficiale** e sviluppato da studenti per gli studenti dell'Università degli Studi di Napoli Federico II. Non è affiliato, patrocinato, approvato o collegato in alcun modo all'Università degli Studi di Napoli Federico II né ai suoi portali istituzionali. Tutti i marchi citati appartengono ai rispettivi proprietari e sono menzionati esclusivamente per indicare la compatibilità del servizio.

Dashboard web (PWA) e client unificato per consultare in un'unica interfaccia moderna dati di carriera, tasse, appelli, prenotazioni, piano di studi, orario delle lezioni, avvisi e materiale didattico dei docenti.

---

## Funzionalità

- **Autenticazione sicura:** Login con credenziali istituzionali e validazione dell'indirizzo `@studenti.unina.it`, con gestione delle sessioni tramite cookie `HttpOnly` e protezione CSRF.
- **Zero-Persistence delle password:** Le password non vengono mai salvate in chiaro né su disco; le sessioni e i dati sensibili temporanei sono cifrati a riposo tramite **AES-256-GCM** (`CRED_KEY`).
- **Anagrafica e Carriera:** Estrazione automatica della matricola (formati numerici e alfanumerici, es. `DE123456` / `DC234567`), codice corso, anno, coorte, canale, media ponderata e aritmetica, base di laurea e avanzamento CFU verso la laurea.
- **Sincronizzazione asincrona:** Recupero in background dei dati lenti (tasse, appelli e sincronizzazione docenti) senza bloccare la visualizzazione immediata dei dati già disponibili.
- **Integrazione Portale Docenti:** Consultazione di corsi, avvisi, ricevimenti e materiale didattico con consenso esplicito e cache versionata.
- **Piano di studi e Orario:** Visualizzazione strutturata degli insegnamenti e del calendario delle lezioni.
- **Gestione dati & GDPR:** Endpoint dedicati per l'esportazione, la cancellazione immediata del profilo e la pulizia automatica dei dati personali scaduti (*data retention* configurabile).
- **UI/UX & PWA:** Tema Light e Dark con design token CSS (palette blu reale profondo e oro antico), interfaccia responsive desktop/mobile, caricamento dinamico delle sezioni pesanti e installazione come Progressive Web App su Android e iOS.
- **Identità visiva:** Il frontend usa l'asset indipendente `logo_prova.jpg` senza modificarne i colori o presentarlo come stemma istituzionale.
- **Ricerca globale:** Ricerca di esami, appelli, corsi e docenti direttamente dalla Home.
- **Scadenziario:** Prossime scadenze per esami, prenotazioni e pagamenti con filtri e orizzonte di 90 giorni.
- **Pianificatore esami:** Prossimi appelli ordinati e possibili conflitti di data/orario evidenziati.
- **Simulatore carriera:** Stima di media e base di laurea inserendo voto e CFU ipotetici.
- **Privacy mode e stato servizi:** Oscuramento temporaneo dei dati visibili e stato di carriera, tasse, Docenti e orario.
- **Materiali Docenti:** Ricollegamento della sessione, preferiti, ultimi materiali e caricamento progressivo delle cartelle.
- **Supporto integrato:** Segnalazioni tecniche cifrate nel backend, senza password o token nel contenuto restituito; non vengono ancora inoltrate via email o notifica.
- **Promemoria locali:** Centro notifiche per le prossime scadenze; il permesso browser viene richiesto solo su azione esplicita e i dati non vengono persistiti.
- **Web Push:** La PWA può registrare una subscription cifrata e ricevere notifiche in background dopo configurazione VAPID e consenso dell'utente.
- **APK Android:** Il percorso Firebase Cloud Messaging è predisposto, ma richiede un progetto Firebase, `flutterfire configure` e i file generati localmente.
- **Servizi ufficiali configurabili:** Pannello per link HTTPS verificati dal gestore, senza URL inventati o dati istituzionali fittizi.
- **Notifiche push Web:** La PWA può registrare `public/sw.js` e ricevere notifiche in background dopo consenso esplicito e configurazione VAPID del backend. L'APK WebView richiede invece un'integrazione Firebase Cloud Messaging separata.

---

## Architettura

```text
frontend/       Next.js + React + Tailwind CSS (PWA)
server.js       API REST Express con hardening di sicurezza e rate-limiting
scraper/        Automazione Puppeteer Cluster dei portali universitari
services/       Gestione sessioni, cache cifrata, lifecycle GDPR e sync asincroni
routes/         Endpoint REST (auth, career, docenti, timetable, privacy)
db/             SQLite con cifratura a riposo e migrazioni automatiche
lib/            Configurazione runtime, validazione CSRF/Origin, safe-logging
test/           Suite di test automatizzati Node.js
docs/           Deploy, operazioni, aggiornamenti tecnici e documentazione di supporto
```

Il backend utilizza **Puppeteer Cluster** per gestire le sessioni di scraping con concorrenza controllata, blocco degli asset superflui e caching lato server per ridurre al minimo le richieste verso i server universitari.

---

## Requisiti

- **Node.js** `>= 20`
- **npm**
- **Chromium / Google Chrome** compatibile con Puppeteer
- Credenziali valide di accesso ai portali studenti Federico II

---

## Installazione

Dalla root del progetto:

```powershell
npm install
Set-Location frontend
npm install
Set-Location ..
```

---

## Configurazione

Crea un file `.env` nella root del progetto (partendo da `.env.example`). **Non committare mai il file `.env` nel repository.**

### 1. Genera la chiave di cifratura (`CRED_KEY`)

Genera una chiave esadecimale da 64 caratteri (32 byte per AES-256-GCM):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Configurazione completa per sviluppo locale (`.env`)

```env
# Ambiente di esecuzione (development | production)
NODE_ENV=development

# Chiave AES-256-GCM per cifrare le credenziali e i JSON personali a riposo (64 caratteri esadecimali)
CRED_KEY=inserisci-qui-la-chiave-esadecimale-da-64-caratteri

# Porta e host dell'API
PORT=3001
HOST=0.0.0.0

# Origini autorizzate per CORS e protezione CSRF (separate da virgola)
FRONTEND_URL=http://localhost:3000,http://127.0.0.1:3000

# Public canonical origin; obbligatorio e solo HTTPS in produzione (lasciare vuoto in locale)
PUBLIC_ORIGIN=

# Sicurezza cookie e proxy
COOKIE_SECURE=false
ALLOW_DYNAMIC_ORIGIN=false
TRUST_PROXY=false

# Retention e pulizia automatica dati personali (GDPR)
AUTO_PURGE_PERSONAL_DATA=true
PERSONAL_DATA_RETENTION_DAYS=30
DOCENTI_CACHE_RETENTION_HOURS=24
TEACHER_CACHE_RETENTION_DAYS=30

# Cache dei dati di carriera per studente (ms; 900000 = 15 minuti; 0 = disattivata)
CAREER_CACHE_TTL_MS=900000

# Limiti concurrency e timeout scraper
SCRAPER_CONCURRENCY=3
SCRAPER_APPELLI_CONCURRENCY=3
SCRAPER_APPELLI_MAX_MS=60000
SCRAPER_TASK_TIMEOUT_MS=180000
DOCENTI_MAX_PAGINATION_PAGES=20
DOCENTI_SYNC_ENABLED=false
ALLOW_RESTRICTED_DOCENTI_MATERIALS=false
SUPPORT_ADMIN_TOKEN=

# Credenziali di servizio opzionali per sync docenti (mai committare credenziali reali)
DOCENTI_USERNAME=
DOCENTI_PASSWORD=

# Sandbox e log diagnostici (mantenere vuoto/false in produzione)
PUPPETEER_ALLOW_NO_SANDBOX=
DEBUG_SCRAPER=false
```

> **Nota per la produzione:** Imposta `NODE_ENV=production`, `COOKIE_SECURE=true`, `PUBLIC_ORIGIN=https://tuodominio.it` (solo HTTPS), `TRUST_PROXY` adeguato al tuo reverse proxy e `FRONTEND_URL` sull'origine pubblica reale del frontend.

Verifica la correttezza della configurazione prima dell'avvio con:

```powershell
npm run check:env
```

---

## Avvio in sviluppo

Avvia il backend dalla root del progetto:

```powershell
npm start
# Per il solo sviluppo con watch:
npm run dev
```

Il backend ascolterà su `http://0.0.0.0:3001`.

In un secondo terminale, avvia il frontend Next.js:

```powershell
Set-Location frontend
npm run dev
```

Apri quindi il browser su `http://localhost:3000`.

Per puntare a un backend remoto durante lo sviluppo del frontend:

```powershell
$env:NEXT_PUBLIC_BACKEND_URL="https://api.tuodominio.it"
npm run dev
```

---

## Build e Deploy di produzione

### Docker

Il repository include un `Dockerfile` configurato per l'esecuzione sicura con utente non-root e sandbox Chromium attiva:

```bash
docker build -t unidesk-na-api .
docker run -d --env-file .env -p 3001:3001 unidesk-na-api
```

### Render / Hosting Linux

```text
Build Command: npm run build:render
Start Command: npm run start:render
```

`build:render` installa esplicitamente Chrome per Puppeteer tramite il percorso CLI della versione installata, evitando problemi di permessi su ambienti Linux. `start:render` verifica la disponibilità del browser nel container runtime.

### Frontend Next.js

```powershell
Set-Location frontend
npm run build
npm start
```

Il frontend espone un rewrite `/api/*` verso `NEXT_PUBLIC_BACKEND_URL` per mantenere le chiamate sullo stesso dominio e preservare i cookie di sessione `HttpOnly`.

---

## Test e Controlli

Dalla root del progetto:

```powershell
npm test
npm run check
```

Lint e build del frontend:

```powershell
Set-Location frontend
npm run lint
npm run build
```

Per attivare temporaneamente i log diagnostici dello scraper in sviluppo:

```powershell
$env:DEBUG_SCRAPER="true"
node server.js
```

Smoke test di liveness e readiness:

```powershell
$env:SMOKE_BASE_URL="http://127.0.0.1:3001"
npm run smoke:health
```

---

## Funzionalità e sicurezza aggiornate

- `/health` verifica la liveness del processo; `/ready` e `/readiness` verificano database e cluster scraper.
- `/metrics` espone solo conteggi aggregati, metodi, codici HTTP e ultima latenza: non conserva URL, query o dati personali; in produzione richiede `METRICS_TOKEN`.
- Ogni risposta riceve un `X-Request-Id` per diagnosi privacy-safe.
- Le segnalazioni tecniche passano da `POST /api/support/report` e vengono salvate nella tabella SQLite `SupportReports`; la descrizione viene cifrata con `CRED_KEY` e i dati vengono cancellati insieme al profilo o durante la retention. Il canale operativo opzionale `GET /api/support-admin/reports` richiede `SUPPORT_ADMIN_TOKEN`; senza token resta disabilitato.
- Le pagine pubbliche `/privacy` e `/terms` descrivono uso autorizzato, retention e controlli disponibili all'utente.
- Il frontend usa CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` e `nosniff`.
- L'integrazione Docenti non usa tecniche per aggirare CAPTCHA, WAF, rate limit o controlli di accesso.
- Le credenziali non vanno mai inserite in GitHub, Dockerfile, log, screenshot o ticket.
- Il service worker offline conserva solo shell e asset statici; le risposte API personali non vengono messe in cache.

La documentazione operativa è raccolta in:

- [Procedura da casa](PROCEDURA_CASA.md)
- [Deploy senza PC acceso](docs/DEPLOYMENT.md)
- [Salvataggio sicuro su GitHub](docs/GITHUB_SALVATAGGIO_CASA.md)
- [Aggiornamenti di oggi e roadmap](AGGIORNAMENTI_OGGI_E_ROADMAP.md)
- [Funzioni da sviluppare in seguito](FUNZIONI_DA_FARE.md)
- [Operazioni di produzione](docs/OPERATIONS.md)
- [Configurazione notifiche Web Push e APK](docs/aggiornamenti/PUSH_NOTIFICHE.md)
- [Gate di rilascio legale, privacy e sicurezza](docs/RELEASE_LEGALE_PRIVACY.md)

---

## Installazione come PWA su Smartphone

Una volta pubblicato il frontend su dominio HTTPS:

- **Android (Chrome):** Apri il sito, tocca il menu `⋮` e seleziona **Installa app**.
- **iOS (Safari):** Apri il sito, tocca l'icona **Condividi** e seleziona **Aggiungi alla schermata Home**.

*(La PWA fornisce l'interfaccia nativa su smartphone, mentre il backend Node.js/Puppeteer continua a girare sul server configurato tramite `NEXT_PUBLIC_BACKEND_URL`).*

---

## Sicurezza e Privacy

- **Cifratura a riposo:** I dati sensibili e i token di sessione salvati temporaneamente in SQLite sono cifrati tramite `CRED_KEY` (AES-256-GCM).
- **Log anonimizzati:** I log applicativi mascherano automaticamente matricole, email istituzionali e percorsi personali (`lib/safe-log.js`).
- **Protezione CORS / CSRF:** Le richieste mutative sono accettate esclusivamente dalle origini esplicitamente dichiarate in `FRONTEND_URL` / `PUBLIC_ORIGIN`.
- **Uso responsabile:** L'applicazione agisce esclusivamente su richiesta diretta dell'utente autenticato con le proprie credenziali istituzionali.
- **Uso autorizzato dei portali:** L'integrazione Docenti va usata solo per il proprio account e nel rispetto delle condizioni d'uso e delle istruzioni dei portali. Non sono previste tecniche per aggirare CAPTCHA, WAF, rate limit o altri controlli di accesso.

---

## Verifica completa e limiti conosciuti

Verifica locale eseguita il 14 novembre 2026:

- `npm run check`: configurazione valida e 206 test backend superati.
- `frontend/npm run lint`: nessun errore e nessun warning.
- `frontend/npm run build`: compilazione TypeScript e pagine statiche completata con `NEXT_PUBLIC_BACKEND_URL` HTTPS.
- `npm run smoke:health`: `/health` e `/ready` rispondono 200.
- La dashboard evita la seconda richiesta metriche quando il bootstrap ha già una cache fresca e carica Docenti, Orario e Piano di studi on demand.

I punti da controllare prima di una pubblicazione reale sono:

- I portali universitari possono cambiare endpoint, campi, sessioni o tempi di risposta. Gli orari di ricevimento vengono mostrati solo quando il portale li pubblica.
- SQLite e le cache locali richiedono un filesystem persistente. I piani gratuiti con filesystem effimero possono perdere profili, sessioni e dati dopo un riavvio.
- Puppeteer/Chromium richiede memoria e CPU; un piano gratuito può andare in timeout o sospendere il servizio dopo inattività.
- In produzione sono obbligatori `NODE_ENV=production`, `CRED_KEY` forte, `COOKIE_SECURE=true`, `PUBLIC_ORIGIN` e `FRONTEND_URL` HTTPS coerenti.
- Il build production del frontend richiede `NEXT_PUBLIC_BACKEND_URL` valorizzato con un URL HTTPS.
- `DOCENTI_SYNC_ENABLED` resta un opt-in: senza configurazione il backend non avvia la sincronizzazione privata del portale Docenti.
- `scraper/timetable.js` è uno stub storico; la route reale dell'orario usa `services/easyacademy-provider.js`.

La procedura unica per rientrare a casa, salvare tutto su GitHub e preparare una demo gratuita è nel file [PUBBLICAZIONE_GITHUB_SERVER_GRATUITO.txt](PUBBLICAZIONE_GITHUB_SERVER_GRATUITO.txt).

Per Render, la configurazione consigliata è un Web Service Docker per il backend e un secondo Web Service Node nella directory `frontend`. Il piano gratuito è adatto a demo e test, non a conservare dati personali: il filesystem è effimero e il servizio può andare in sleep. Consultare la documentazione ufficiale del provider prima del deploy.

## Licenza

ISC
