# Segrepass Unina

Dashboard web per studenti dell'Universita degli Studi di Napoli Federico II.
L'applicazione raccoglie in un'unica interfaccia dati di carriera, tasse,
appelli, prenotazioni, piano di studi, orario delle lezioni e avvisi dei
docenti.

## Funzionalita

- Login con credenziali Segrepass e validazione dell'email istituzionale
  `@studenti.unina.it`.
- Estrazione automatica dell'anagrafica, inclusa la matricola nei formati
  numerici e alfanumerici, ad esempio `DE3000397` o `DC9000930`.
- Persistenza locale dei profili con SQLite e migrazioni automatiche dello
  schema.
- Dashboard con:
  - matricola, codice corso, anno, coorte e canale;
  - media ponderata e aritmetica;
  - base di laurea;
  - CFU acquisiti e progresso verso la laurea;
  - esami, prenotazioni, tasse e pagamenti.
- Recupero asincrono dei dati lenti, come tasse e appelli, senza bloccare la
  visualizzazione dei dati gia disponibili.
- Integrazione con il portale Docenti per corsi, prenotazioni e avvisi.
- Piano di studi e orario delle lezioni.
- Cache della carriera versionata e invalidabile per evitare dati obsoleti dopo
  modifiche allo scraper.
- Sessioni JWT con credenziali Segrepass cifrate; la password non viene
  salvata in chiaro.
- Messaggi di stato ed errore richiudibili tramite il pulsante `X`.
- Tema Light e Dark con design token CSS:
  - sfondo Light `#F4F6F9`;
  - superfici bianche;
  - header navy `#0A1C35`;
  - testo secondario `#6B7280`;
  - accenti verde, viola e oro;
  - barra progresso blu-verde.
- Interfaccia responsive con navigazione desktop e mobile.
- PWA installabile su Android e iOS dalla versione web.

## Architettura

```text
frontend/       Next.js + React + Tailwind CSS
server.js       API Express
scraper/        Automazione Puppeteer dei portali Unina
services/       Sessioni, cache e sincronizzazioni
routes/         Endpoint REST
db/             SQLite e repository dei profili
test/           Test Node.js
```

Il backend usa Puppeteer Cluster per gestire le sessioni di scraping in
parallelo. La cache riduce le richieste ripetute e la scansione lenta viene
eseguita separatamente dalla risposta iniziale.

## Requisiti

- Node.js `>= 20`
- npm
- Chromium compatibile con Puppeteer
- Credenziali valide per i portali Unina

## Installazione

Dalla root del progetto:

```powershell
npm install
Set-Location frontend
npm install
Set-Location ..
```

## Configurazione

Creare un file `.env` nella root del progetto. Non committare mai questo file.

Configurazione minima:

```env
JWT_SECRET=una-chiave-lunga-e-casuale
PORT=3001
HOST=0.0.0.0
FRONTEND_URL=http://localhost:3000
```

Variabili opzionali:

```env
DB_PATH=./data/segrepass.sqlite
CFU_TOTALI_CORSO=180
CAREER_CACHE_TTL_MS=300000
TIMETABLE_CACHE_TTL_MS=300000
CRED_KEY=una-chiave-di-cifratura-dedicata
DEBUG_SCRAPER=1
TRUST_PROXY=1
```

Le credenziali dello studente vengono inserite dalla dashboard. Gli script
diagnostici possono usare, quando necessario, variabili come
`SEGREPASS_USER`, `SEGREPASS_PASS`, `UNINA_USER` e `UNINA_PASS`; usarle solo
localmente e mai nel repository.

Verificare la configurazione con:

```powershell
npm run check:env
```

## Avvio in sviluppo

Avviare il backend dalla root:

```powershell
npm run dev
```

Il backend ascolta normalmente su `http://127.0.0.1:3001` e, con
`HOST=0.0.0.0`, è raggiungibile anche dalla rete locale.

In un secondo terminale avviare il frontend:

```powershell
Set-Location frontend
npm run dev
```

Aprire quindi `http://127.0.0.1:3000`.

Per usare un backend diverso dal default:

```powershell
$env:NEXT_PUBLIC_BACKEND_URL="https://backend.example.com"
npm run dev
```

## Build di produzione

Backend:

```powershell
npm start
```

Frontend:

```powershell
Set-Location frontend
npm run build
npm start
```

Il frontend usa un rewrite `/api/*` verso `NEXT_PUBLIC_BACKEND_URL`, così il
browser non deve conoscere direttamente gli endpoint interni del backend.

## Test e controlli

Dalla root:

```powershell
npm test
npm run check
```

Build e lint del frontend:

```powershell
Set-Location frontend
npm run build
npm run lint
```

Per attivare i log diagnostici dello scraper:

```powershell
$env:DEBUG_SCRAPER="1"
npm start
```

## Installazione sul telefono

Il frontend include un manifest PWA e un'icona applicativa. Dopo aver
pubblicato il frontend su HTTPS:

- Android: aprire il sito in Chrome, menu `⋮` e scegliere **Installa app**.
- iPhone: aprire il sito in Safari, `Condividi` e scegliere
  **Aggiungi alla schermata Home**.

La PWA funziona come un'app installata, ma il backend resta eseguito su un
server remoto o sul PC. Il backend attuale usa Node.js, SQLite e Puppeteer e
non viene eseguito automaticamente dentro una normale PWA Android/iOS.
Per un uso stabile da telefono è quindi necessario mantenere il backend
online e configurare:

```env
NEXT_PUBLIC_BACKEND_URL=https://backend.example.com
```

## Sicurezza

- Non inserire credenziali, JWT secret o chiavi di cifratura nel repository.
- Usare HTTPS in produzione.
- Impostare `FRONTEND_URL` sull'origine reale del frontend.
- Usare una `JWT_SECRET` casuale e persistente.
- Limitare l'accesso al backend tramite firewall o reverse proxy quando
  necessario.
- Le credenziali devono essere utilizzate solo per l'accesso autorizzato ai
  portali istituzionali.

## Licenza

ISC
