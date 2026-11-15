# Procedura da casa: avvio, verifica e pubblicazione di UniDesk NA

Questa guida parte dal presupposto che il codice sia giÃ  salvato su GitHub. Il PC serve per installazione, test e deploy; dopo la pubblicazione il servizio cloud resta attivo anche quando il PC Ã¨ spento.

## 1. Preparare il PC

Installa Node.js LTS 20 o superiore, Git for Windows, un browser aggiornato, un account GitHub e un account cloud.

```powershell
node --version
npm --version
git --version
```

## 2. Scaricare il progetto

```powershell
Set-Location "$env:USERPROFILE\Documents"
git clone https://github.com/TUO-ACCOUNT/TUO-REPOSITORY.git unidesk-na
Set-Location .\unidesk-na
```

Sostituisci l'URL con quello reale del repository.

## 3. Installare e verificare

```powershell
npm ci
Set-Location frontend
npm ci
npm run lint
Set-Location ..
```

## 4. Creare la configurazione locale

```powershell
Copy-Item .env.example .env
notepad .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In `.env` imposta almeno:

```env
NODE_ENV=development
CRED_KEY=CHIAVE_GENERATA_DA_64_CARATTERI
PORT=3001
HOST=0.0.0.0
FRONTEND_URL=http://localhost:3000,http://127.0.0.1:3000
COOKIE_SECURE=false
ALLOW_DYNAMIC_ORIGIN=false
DOCENTI_SYNC_ENABLED=false
```

Completa prima `.env` e poi verifica backend e build frontend. Il build Next.js
richiede sempre un `NEXT_PUBLIC_BACKEND_URL` HTTPS; per un controllo locale puoi
usare un URL HTTPS di test:

```powershell
npm run check
Set-Location frontend
$env:NEXT_PUBLIC_BACKEND_URL="https://build.example.invalid"
npm run build
Set-Location ..
```

Per lo sviluppo quotidiano usa `npm run dev` senza rendere pubblico il build
di produzione e senza mettere credenziali nel repository.

Non inserire password o credenziali reali in GitHub.

## 5. Avviare in locale

Apri due finestre PowerShell.

Prima finestra:

```powershell
Set-Location "PERCORSO\unidesk-na"
npm start
```

Seconda finestra:

```powershell
Set-Location "PERCORSO\unidesk-na\frontend"
npm run dev
```

Verifica:

```powershell
Invoke-WebRequest http://127.0.0.1:3001/health
Invoke-WebRequest http://127.0.0.1:3001/ready
```

Apri `http://localhost:3000`.

## 6. Pubblicare senza tenere acceso il PC

### Backend

1. Crea un Web Service Docker sul provider.
2. Usa il `Dockerfile` nella root.
3. Lascia `HOST=0.0.0.0` e usa la porta del provider tramite `PORT`.
4. Imposta il health check su `/ready`.
5. Inserisci le variabili di produzione nel pannello dei segreti.
6. Per SQLite collega un volume persistente su `/app/data` e mantieni una sola istanza.

### Frontend

1. Crea un secondo Web Service Node nella directory `frontend`.
2. Build command: `npm ci && npm run build`.
3. Start command: `npm run start`.
4. Imposta `NEXT_PUBLIC_BACKEND_URL=https://api.tuodominio.it`.

### HTTPS e variabili backend

Configura `app.tuodominio.it` per il frontend e `api.tuodominio.it` per il backend. Nel backend usa:

```env
NODE_ENV=production
COOKIE_SECURE=true
FRONTEND_URL=https://app.tuodominio.it
PUBLIC_ORIGIN=https://api.tuodominio.it
TRUST_PROXY=1
```

Genera una `CRED_KEY` diversa per la produzione.

## 7. Controlli dopo il deploy

```powershell
$env:SMOKE_BASE_URL="https://api.tuodominio.it"
npm run smoke:health
```

Controlla login/logout, apertura PDF Docenti, export, cancellazione dati, `/privacy`, `/terms` e log privi di segreti.

## 8. Installare sul telefono

Apri `https://app.tuodominio.it` da Chrome o Safari e scegli **Installa app** oppure **Aggiungi alla schermata Home**. Il telefono userÃ  il cloud e il PC potrÃ  restare spento.

## 9. Fermare il lavoro locale

Premi `Ctrl+C` nelle finestre dei servizi. Per 50.000 studenti servono in seguito PostgreSQL, Redis/coda condivisa, rate limit distribuiti, backup testati e test di carico; SQLite con una singola istanza non dimostra quella capacità.

## 10. Riprendere le funzioni future

Per vedere cosa aggiungere quando torni a casa, apri
[FUNZIONI_DA_FARE.md](FUNZIONI_DA_FARE.md). Le attività sono ordinate per
priorità e puoi spuntarle man mano che vengono completate.

La roadmap riepilogativa si trova anche in
[AGGIORNAMENTI_OGGI_E_ROADMAP.md](AGGIORNAMENTI_OGGI_E_ROADMAP.md).
