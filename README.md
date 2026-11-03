# Segrepass Unina (Non Ufficiale)

> ⚠️ **DISCLAIMER:** Questo progetto **NON è una piattaforma ufficiale**, non è gestito, approvato o sponsorizzato dall'**Università degli Studi di Napoli Federico II**. Si tratta di un'iniziativa **indipendente sviluppata da uno studente per gli studenti**, creata al solo scopo di migliorare la fruizione dei propri dati universitari tramite un'interfaccia moderna.
>
> **Note su Sicurezza e Responsabilità:**
> - L'applicazione interagisce con i servizi universitari tramite automazione e scraping.
> - L'utilizzo dell'applicazione avviene a proprio rischio e pericolo. Lo sviluppatore non si assume alcuna responsabilità per malfunzionamenti, disservizi o per qualsiasi problema derivante dall'uso non corretto delle credenziali.
> - Nessun dato viene ceduto a terzi; le credenziali vengono cifrate e gestite in sessione locale.

---

Dashboard web e PWA per gli studenti dell'Università degli Studi di Napoli Federico II.
L'applicazione aggrega in un'unica interfaccia responsiva carriera accademica, tasse, appelli d'esame, prenotazioni, piano di studi, orario delle lezioni e avvisi dei docenti.

## 🚀 Funzionalità

- **Autenticazione:** Login sicuro tramite credenziali Segrepass e verifica dell'email istituzionale (`@studenti.unina.it`).
- **Anagrafica automatica:** Riconoscimento della matricola sia in formato numerico che alfanumerico (es. `DE123456`, `DC234567`).
- **Dashboard Studente:**
  - Visualizzazione di corsi, canale, anno di corso e coorte.
  - Calcolo dinamico della media ponderata, media aritmetica e base di laurea.
  - Progresso CFU e percentuale di completamento della carriera.
  - Riepilogo esami sostenuti, prenotazioni attive, tasse e storico pagamenti.
- **Caricamento Asincrono:** Recupero in background dei dati più lenti (tasse, appelli) senza bloccare l'interfaccia principale.
- **Integrazione Portale Docenti:** Sincronizzazione automatica di corsi, appelli e avvisi del corpo docente.
- **Piano di Studi & Orari:** Consultazione del piano di studi e dell'orario settimanale delle lezioni.
- **Cache & Persistenza:** Storage locale con SQLite e cache invalidabile per evitare richieste inutili e velocizzare i caricamenti.
- **Sicurezza:** Sessioni gestite tramite token JWT; le password non vengono mai salvate in chiaro nel database.
- **UI & UX:**
  - Tema Light e Dark nativo con design token CSS dedicati.
  - Interfaccia completamente responsive (Desktop e Mobile).
  - Notifiche ed errori richiudibili.
- **PWA (Progressive Web App):** Installabile direttamente su Android e iOS.

---

## 🛠️ Architettura del Progetto

```text
├── frontend/        # Interfaccia utente (Next.js, React, Tailwind CSS)
├── server.js        # Entry point del server API Express
├── scraper/         # Moduli di automazione Puppeteer per i portali Unina
├── services/        # Gestione sessioni JWT, cache ed elaborazione dati
├── routes/          # Endpoint REST API
├── db/              # Gestionale SQLite e repository profili
└── test/            # Suite di test Node.js
Il backend impiega Puppeteer Cluster per parallelizzare le sessioni di scraping. La cache a livello di servizio consente di minimizzare i tempi di risposta ed evitare richieste ridondanti ai server di Ateneo.

📋 Requisiti di Sistema
Node.js >= 20.x

npm >= 10.x

Chromium / Google Chrome (compatibile con Puppeteer)

Credenziali valide per l'accesso ai servizi Unina

📦 Installazione
Clona il repository ed installa le dipendenze sia per il backend che per il frontend:


# Clona il repository
git clone [https://github.com/tuo-username/segrepass-unina.git](https://github.com/tuo-username/segrepass-unina.git)
cd segrepass-unina

# Installa le dipendenze del backend
npm install

# Installa le dipendenze del frontend
Set-Location frontend
npm install
Set-Location ..
⚙️ Configurazione Environment
Crea un file .env nella root principale del progetto (non committare mai questo file su Git):

# Configurazione Server
JWT_SECRET=inserisci_una_chiave_jwt_molto_lunga_e_casuale
PORT=3001
HOST=0.0.0.0
FRONTEND_URL=http://localhost:3000

# Parametri Opzionali / Cache
DB_PATH=./data/segrepass.sqlite
CFU_TOTALI_CORSO=180
CAREER_CACHE_TTL_MS=300000
TIMETABLE_CACHE_TTL_MS=300000
CRED_KEY=chiave_di_cifratura_credenziali_dedicata
DEBUG_SCRAPER=0
TRUST_PROXY=1
Verifica che le variabili d'ambiente siano corrette tramite lo script di controllo:


npm run check:env
💻 Avvio in Sviluppo
Avvia il server backend:


npm run dev
Il backend sarà attivo su http://127.0.0.1:3001.

In un secondo terminale, avvia il frontend Next.js:


Set-Location frontend
npm run dev
Apri il browser su http://127.0.0.1:3000.

🏗️ Build di Produzione e Deployment
Backend (Express + Puppeteer)
PowerShell
npm start
Note per il deploy su Render:
Imposta le seguenti variabili nel pannello di controllo di Render:

Build Command: npm run build:render

Start Command: npm run start:render

Nota: build:render e start:render assicurano la corretta installazione dell'eseguibile Chromium nell'ambiente isolato di Render evitando l'errore Could not find Chrome.

Frontend (Next.js)
PowerShell
Set-Location frontend
npm run build
npm start
Il frontend gestisce le chiamate verso il backend tramite rewrite /api/*, nascondendo gli endpoint interni del server.

📱 Installazione PWA su Dispositivi Mobili
Una volta distribuito il frontend su un dominio con HTTPS:

Android (Chrome): Apri l'URL, premi il menu con i tre pallini ⋮ e seleziona Installa app.

iOS (Safari): Apri l'URL, premi l'icona Condividi e seleziona Aggiungi alla schermata Home.

Nota: La PWA richiede che il server backend sia costantemente raggiungibile via HTTPS (configurando NEXT_PUBLIC_BACKEND_URL).

🔒 Sicurezza e Privacy
Non committare mai credenziali, file .env o chiavi private nel repository.

In ambiente di produzione utilizzare esclusivamente connessioni protette via HTTPS.

Impostare FRONTEND_URL specificando l'origine esatta dell'applicazione web per prevenire attacchi CORS.

Le credenziali utente vengono trattate in memoria ed archiviate localmente previa cifratura.

📄 Licenza
Questo progetto è distribuito sotto licenza ISC
