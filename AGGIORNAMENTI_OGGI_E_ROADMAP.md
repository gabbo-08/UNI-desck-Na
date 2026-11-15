# Aggiornamenti di oggi e roadmap pubblica

Data aggiornamento: 14 novembre 2026

## Modifiche completate oggi

### FunzionalitÃ  studente

- Ricerca globale di esami, appelli, corsi e docenti.
- Scadenziario personale per esami, prenotazioni e pagamenti entro 90 giorni.
- Pianificatore esami con prossimi appelli e possibili conflitti di data/orario.
- Simulatore carriera per voto, CFU, media e base di laurea stimata.
- Stato dei servizi per carriera, tasse, Docenti e orario.
- ModalitÃ  privacy effimera: oscura i dati visibili senza salvarli nel browser.
- Agenda con export `.ics`.
- Centro promemoria locale per prossime scadenze, senza persistenza personale nel browser.
- Pannello di servizi ufficiali configurabile solo con URL HTTPS verificati dal gestore.
- Web Push PWA con service worker, subscription cifrate, VAPID e test esplicito.
- Percorso FCM per APK Android con consenso e permesso `POST_NOTIFICATIONS`.

### Portale Docenti

- Stato esplicito della connessione Docenti.
- Ricollegamento senza logout completo dalla dashboard.
- Deduplicazione ricorsiva di cartelle e materiali.
- Caricamento lazy delle cartelle.
- Preferiti e ultimi cinque materiali in memoria di sessione.
- Gestione dei redirect SSO e della scadenza cookie.
- Apertura PDF in una sola scheda senza cambiare pagina corrente.

### Sicurezza, privacy e operazioni

- Pagine pubbliche `/privacy` e `/terms`.
- Content Security Policy e intestazioni di sicurezza frontend.
- Cookie `HttpOnly`, protezione CSRF/CORS e cifratura AES-256-GCM lato server.
- Endpoint `/health`, `/ready`, `/readiness` e metriche aggregate privacy-safe.
- `X-Request-Id` per diagnosi senza conservare URL o dati personali.
- Segnalazione problemi tramite `POST /api/support/report`, salvata nella tabella SQLite `SupportReports`.
- Descrizione della segnalazione cifrata con `CRED_KEY`, con retention e cancellazione insieme ai dati del profilo.
- Nessun invio automatico via email/notifica; la lettura operativa usa il canale protetto `GET /api/support-admin/reports` quando `SUPPORT_ADMIN_TOKEN` è configurato.
- Service worker PWA con cache limitata a shell/asset statici, fallback di navigazione offline e banner accessibile di connessione assente.
- Dashboard ottimizzata: niente richiesta metriche duplicata con cache fresca e caricamento dinamico delle sezioni Docenti, Orario e Piano di studi.
- Procedure per deploy cloud, backup, rollback e salvataggio GitHub.
- Layout responsive per smartphone, tablet e desktop.

## Verifiche eseguite

- Backend: 206 test superati su 206.
- Frontend: build Next.js 16.4.6 superata.
- Lint frontend: nessun errore e nessun warning.
- E2E visuale: 5 test superati su 5 con Chromium Playwright. La configurazione Playwright imposta automaticamente le origini locali di sviluppo consentite.
- Audit dipendenze di produzione: 0 vulnerabilitÃ  backend e 0 vulnerabilitÃ  frontend.
- Smoke test backend: `/health` e `/ready` restituiscono `200` con database e scraper pronti.

## Roadmap futura

Il dettaglio operativo delle nuove funzioni è raccolto in [Funzioni da sviluppare in seguito](FUNZIONI_DA_FARE.md), con priorità, checkbox e ordine consigliato per riprendere il lavoro da casa.

### PrioritÃ  alta

- Worker/cron protetto per trasformare scadenze autorizzate in notifiche automatiche.
- Integrazione con dati ufficiali di campus, aule, biblioteche, mense e trasporti.
- Estendere i test E2E responsive a viewport mobile, tablet e desktop.
- Test di carico realistico prima di dichiarare capacitÃ  per 50.000 studenti.

### ScalabilitÃ 

- Migrazione da SQLite singolo a PostgreSQL gestito.
- Redis condiviso per cache e rate limit distribuiti.
- Coda di lavoro separata per Puppeteer e scraping Docenti.
- Autoscaling, monitoraggio esterno, alert e backup/restore periodici.

### Pubblicazione e conformitÃ 

- Completare Privacy e Termini con titolare, contatti, basi giuridiche, retention definitiva e subfornitori.
- Verificare condizioni d'uso dei portali sorgente prima della pubblicazione pubblica.
- Eseguire revisione legale del branding e dei flussi di trattamento dati.

## Stato pubblico

Il codice e la documentazione sono aggiornati nel repository locale. Il progetto non Ã¨ automaticamente pubblicato online: deploy cloud, dominio, account provider e repository GitHub devono essere configurati separatamente seguendo [PROCEDURA_CASA.md](PROCEDURA_CASA.md) e [DEPLOYMENT.md](docs/DEPLOYMENT.md).


