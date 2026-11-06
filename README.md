# 🎓 Segrepass Unina

### La tua carriera universitaria, in un'unica dashboard.

Segrepass Unina è una dashboard web e Progressive Web App (PWA), sviluppata per gli studenti dell'Università degli Studi di Napoli Federico II.

Il progetto nasce con l'obiettivo di centralizzare e semplificare la consultazione delle informazioni universitarie, raccogliendo in un'unica interfaccia moderna e responsive i dati normalmente distribuiti tra i diversi portali e servizi dell'Ateneo.

---

> [!WARNING]
> **DISCLAIMER – PROGETTO NON UFFICIALE**
>
> Segrepass Unina è un progetto indipendente, sviluppato da uno studente per gli studenti. Non è una piattaforma ufficiale, né è gestito, approvato, affiliato o sponsorizzato dall'Università degli Studi di Napoli Federico II.
>
> **Sicurezza e responsabilità**
> - L'applicazione interagisce con i servizi universitari attraverso strumenti di automazione e tecniche di scraping.
> - L'utilizzo è volontario e sotto la responsabilità dell'utente.
> - Lo sviluppatore non garantisce la disponibilità, la correttezza o la continuità dei dati recuperati dai servizi esterni.
> - L'utente è responsabile della corretta gestione delle proprie credenziali.
> - Nessun dato viene intenzionalmente ceduto a terzi. Le credenziali sono gestite attraverso meccanismi di cifratura e sessioni applicative.
>
> L'applicazione non sostituisce i portali ufficiali dell'Ateneo, che rimangono gli unici riferimenti per le comunicazioni e gli adempimenti universitari.

## 📑 Indice

- [Funzionalità](#-funzionalità)
- [Tecnologie utilizzate](#-tecnologie-utilizzate)
- [Architettura del progetto](#-architettura-del-progetto)
- [Requisiti](#-requisiti)
- [Installazione](#-installazione)
- [Configurazione](#-configurazione)
- [Avvio in sviluppo](#-avvio-in-sviluppo)
- [Build e deployment](#-build-e-deployment)
- [Installazione PWA](#-installazione-pwa)
- [Sicurezza e privacy](#-sicurezza-e-privacy)
- [Licenza](#-licenza)

---

## 🚀 Funzionalità

### 👤 Autenticazione e profilo
- Accesso tramite credenziali Segrepass.
- Verifica dell'indirizzo email istituzionale (`@studenti.unina.it`).
- Riconoscimento automatico della matricola, sia numerica sia alfanumerica (es. `DE123456`, `DC234567`).
- Gestione delle sessioni tramite token JWT.

### 📊 Dashboard studente
- Visualizzazione di corso di laurea, canale, anno di corso e coorte.
- Calcolo dinamico della media ponderata e aritmetica.
- Calcolo della base di laurea.
- Monitoraggio dei CFU acquisiti e della percentuale di completamento della carriera.
- Riepilogo degli esami sostenuti.
- Consultazione delle prenotazioni attive.
- Riepilogo delle tasse universitarie e dello storico dei pagamenti.

### 📚 Carriera universitaria
- Consultazione del piano di studi.
- Visualizzazione degli esami e delle attività formative.
- Recupero delle informazioni relative agli appelli.
- Sincronizzazione delle informazioni provenienti dai servizi universitari.

### 👨‍🏫 Integrazione Portale Docenti
- Recupero delle informazioni sui docenti.
- Associazione tra insegnamenti e relativi docenti.
- Consultazione degli appelli e degli avvisi pubblicati.
- Integrazione dei dati provenienti dal Portale Docenti.

### 📅 Orario delle lezioni
- Consultazione dell'orario settimanale.
- Organizzazione delle attività didattiche.
- Visualizzazione delle informazioni relative agli insegnamenti.

### ⚡ Prestazioni e caricamento asincrono
- Recupero in background delle informazioni più lente, come tasse e appelli.
- Caricamento progressivo dei dati senza bloccare l'interfaccia principale.
- Cache a livello di servizio per ridurre le richieste ripetute.
- Persistenza locale tramite SQLite.
- Meccanismi di invalidazione della cache per mantenere aggiornate le informazioni.

### 🎨 Interfaccia e accessibilità
- Design moderno e responsive.
- Tema Light e Dark.
- Design token CSS dedicati.
- Notifiche ed errori richiudibili.
- Ottimizzazione per desktop, tablet e smartphone.

### 📱 Progressive Web App
- Installazione direttamente su dispositivi Android e iOS.
- Accesso tramite icona nella schermata Home.
- Esperienza di utilizzo simile a un'applicazione nativa.

---

## 🧰 Tecnologie utilizzate

| Area | Tecnologie |
|---|---|
| Frontend | Next.js, React, Tailwind CSS |
| Backend | Node.js, Express.js |
| Automazione | Puppeteer, Puppeteer Cluster |
| Database | SQLite |
| Autenticazione | JWT |
| Caching | Cache applicativa |
| Distribuzione | Render |
| Applicazione mobile | Progressive Web App (PWA) |

---

## 🏗️ Architettura del progetto

Il progetto adotta un'architettura client-server, separando l'interfaccia utente dalla logica applicativa e dai moduli di acquisizione dei dati.

```text
segrepass-unina/
│
├── frontend/             # Frontend Next.js e React
│
├── scraper/              # Moduli Puppeteer per i portali Unina
│
├── services/             # Servizi applicativi
│   ├── sessioni          # Gestione sessioni JWT
│   ├── cache             # Gestione della cache
│   └── elaborazione      # Elaborazione e normalizzazione dati
│
├── routes/               # Endpoint REST API
│
├── db/                   # Database SQLite e repository
│
├── test/                 # Suite di test Node.js
│
├── server.js             # Entry point backend Express
│
├── package.json          # Dipendenze e script backend
│
└── .env                  # Variabili d'ambiente (non versionato)
```

### Flusso di elaborazione

Il backend utilizza Puppeteer Cluster per gestire le operazioni di automazione e recupero delle informazioni dai portali universitari.

I dati recuperati vengono successivamente elaborati dai servizi applicativi, che si occupano della loro normalizzazione, memorizzazione e restituzione al frontend attraverso API REST.

La presenza di una cache a livello di servizio consente di limitare le richieste ridondanti e migliorare i tempi di risposta.

---

## 📋 Requisiti

Prima di procedere con l'installazione, assicurarsi di disporre di:

- **Node.js:** versione `20.x` o superiore.
- **npm:** versione `10.x` o superiore.
- **Chromium / Google Chrome:** compatibile con Puppeteer.
- **Credenziali valide:** account abilitato all'accesso ai servizi universitari.

---

## 📦 Installazione

### 1. Clonazione del repository

```bash
git clone https://github.com/tuo-username/segrepass-unina.git

cd segrepass-unina
```

### 2. Installazione delle dipendenze backend

```bash
npm install
```

### 3. Installazione delle dipendenze frontend

Da PowerShell:

```powershell
Set-Location frontend
npm install
Set-Location ..
```

---

## ⚙️ Configurazione

Creare un file `.env` nella directory principale del progetto.

> [!IMPORTANT]
> Il file `.env` contiene informazioni sensibili e non deve essere caricato o condiviso pubblicamente su GitHub.

### Variabili d'ambiente

```env
# =====================================
# SERVER
# =====================================

PORT=3001
HOST=0.0.0.0
FRONTEND_URL=http://localhost:3000

# =====================================
# AUTENTICAZIONE E SICUREZZA
# =====================================

JWT_SECRET=inserisci_una_chiave_lunga_e_casuale
CRED_KEY=chiave_di_cifratura_dedicata

# =====================================
# DATABASE
# =====================================

DB_PATH=./data/segrepass.sqlite

# =====================================
# PARAMETRI CARRIERA
# =====================================

CFU_TOTALI_CORSO=180

# =====================================
# CACHE
# =====================================

CAREER_CACHE_TTL_MS=300000
TIMETABLE_CACHE_TTL_MS=300000

# =====================================
# DEBUG E PROXY
# =====================================

DEBUG_SCRAPER=0
TRUST_PROXY=1
```

### Verifica della configurazione

Dopo aver configurato le variabili, eseguire:

```bash
npm run check:env
```

Lo script verifica la presenza e la configurazione delle variabili d'ambiente richieste dal progetto.

---

## 💻 Avvio in sviluppo

L'applicazione richiede l'avvio separato di backend e frontend.

### 1. Backend

Dalla directory principale:

```bash
npm run dev
```

Il server API sarà disponibile all'indirizzo:

`http://127.0.0.1:3001`

### 2. Frontend

Aprire un secondo terminale:

```powershell
Set-Location frontend
npm run dev
```

Il frontend Next.js sarà disponibile all'indirizzo:

`http://localhost:3000`

A questo punto sarà possibile accedere alla dashboard tramite il browser.

---

## 🏗️ Build e deployment

### Backend – Express + Puppeteer

Per avviare il backend in modalità produzione:

```bash
npm start
```

### Deployment su Render

Per distribuire il backend su Render, configurare i seguenti parametri:

| Parametro | Valore |
|---|---|
| Build Command | `npm run build:render` |
| Start Command | `npm run start:render` |

Gli script dedicati al deployment gestiscono l'installazione e la configurazione di Chromium nell'ambiente di esecuzione, evitando problemi legati all'assenza del browser richiesto da Puppeteer.

Configurare inoltre tutte le variabili d'ambiente necessarie direttamente dal pannello di Render.

### Frontend – Next.js

Per generare la build di produzione:

```powershell
Set-Location frontend

npm run build

npm start
```

Il frontend gestisce le comunicazioni con il backend attraverso le rewrite `/api/*`, evitando di esporre direttamente gli endpoint interni dell'API.

---

## 📱 Installazione PWA

Segrepass Unina può essere installata su dispositivi mobili come una normale applicazione.

È necessario che il frontend sia distribuito tramite una connessione HTTPS.

### Android – Google Chrome

1. Aprire il sito tramite Chrome.
2. Selezionare il menu con i tre puntini (⋮).
3. Premere **Installa app** oppure **Aggiungi alla schermata Home**.

### iOS – Safari

1. Aprire il sito tramite Safari.
2. Premere l'icona **Condividi**.
3. Selezionare **Aggiungi alla schermata Home**.

> [!NOTE]
> Per il corretto funzionamento delle funzionalità che richiedono dati aggiornati, il backend deve essere raggiungibile dall'applicazione tramite HTTPS. Verificare anche la configurazione di `NEXT_PUBLIC_BACKEND_URL`, se utilizzata dal progetto.

---

## 🔒 Sicurezza e privacy

La sicurezza delle informazioni personali e delle credenziali universitarie è un aspetto centrale del progetto.

Alcune indicazioni fondamentali:

- Non caricare mai credenziali, token, chiavi private o file `.env` nel repository.
- Utilizzare esclusivamente connessioni HTTPS in produzione.
- Configurare `FRONTEND_URL` con l'origine effettiva del frontend per limitare le richieste CORS.
- Utilizzare chiavi JWT robuste e non riutilizzate.
- Mantenere separate le chiavi dedicate alla cifratura delle credenziali.
- Evitare di registrare password e dati sensibili nei log applicativi.

Le modalità effettive di trattamento, conservazione e cifratura dei dati dipendono dalla configurazione dell'istanza distribuita.

---

## 📄 Licenza

Il progetto è distribuito sotto licenza **ISC**.

Per maggiori informazioni, consultare il file `LICENSE` presente nel repository.

---

## 👨‍💻 Autore

**Segrepass Unina** nasce come progetto indipendente realizzato da uno studente per gli studenti.

L'obiettivo è rendere più semplice, immediata e accessibile la consultazione della propria carriera universitaria, attraverso un'esperienza digitale unificata.

**Un solo spazio. Tutta la tua carriera universitaria.**

---

<sub>Segrepass Unina è un progetto indipendente e non ufficiale. I servizi universitari originali rimangono gli unici riferimenti ufficiali per le informazioni e le procedure accademiche.</sub>
