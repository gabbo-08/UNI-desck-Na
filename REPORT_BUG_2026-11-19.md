# Report revisione e correzione bug UniDesk NA

Data: 19 novembre 2026. Progetto: `E:\segrepass-api\segrepass-api`.

La revisione ha interessato API Express, autenticazione, database SQLite, scraper, logica carriera e orari, frontend Next.js, PWA, wrapper Android, configurazione e documentazione. I problemi individuati e corretti sono descritti sotto, insieme alle verifiche effettivamente eseguite.

Il risultato locale è positivo: **245 test backend, 10 test frontend e 7 test browser superati**, lint e build frontend riusciti, audit npm senza vulnerabilità segnalate. Questo risultato copre i casi verificati; non costituisce una garanzia di assenza assoluta di bug o una verifica dei portali universitari reali.

## Situazione iniziale

La prima esecuzione di `npm run check` ha restituito **203 test superati e 4 falliti su 207**. Il test del pool presumeva un comportamento precedente all'inizializzazione automatica; tre test di sessione usavano ancora identificativi diversi dalle email e una pulizia della cache incoerente. Le aspettative sono state aggiornate al comportamento attuale, aggiungendo regressioni per i problemi reali emersi durante la revisione.

L'audit completo iniziale del frontend ha inoltre segnalato **7 problemi moderati**, riconducibili alla dipendenza transitiva `minimatch` negli strumenti TypeScript/ESLint. Sono stati applicati aggiornamenti compatibili, senza aggiornamenti forzati delle dipendenze principali. L'audit finale di entrambi i pacchetti restituisce zero segnalazioni.

## Correzioni backend e persistenza

| Area | Problema corretto e comportamento risultante | File principali |
| --- | --- | --- |
| Piano di studi dopo riavvio | Il piano letto da Segrepass viveva solo in RAM. Ora viene salvato cifrato, ripristinato nel bootstrap e usato anche senza un manifesto locale. | `db/index.js`, `db/repository.js`, `services/study-plan-service.js`, `routes/auth.js` |
| Anagrafica dopo riavvio | Il nome completo scompariva perdendo gli snapshot. Ora l'anagrafica essenziale è persistita cifrata e recuperata da bootstrap, refresh ed export. PIN, CNP, password e token sono esclusi dalla nuova colonna. | `db/repository.js`, `services/student-session.js`, `routes/auth.js`, `routes/metriche.js` |
| Dati parziali | Un caricamento incompleto non cancella l'ultimo piano o nome valido. Il piano è associato a corso e coorte per impedire il riuso dopo un cambio di profilo. | `db/repository.js`, `services/student-session.js`, `services/study-plan-service.js` |
| Modifica profilo | Un errore nella selezione degli esami poteva lasciare salvata metà della richiesta. Profilo e scelte ora vengono aggiornati in un'unica transazione. | `routes/profile.js` |
| Retention | Il confronto testuale fra date SQLite e ISO poteva eliminare dati prima del termine nello stesso giorno. Il confronto ora usa date SQLite normalizzate. | `db/repository.js` |
| Protezione CSRF | Le richieste dalla stessa origine potevano fallire sulle porte non standard. La porta viene conservata; un header Origin invalido non viene sostituito dal Referer. | `lib/csrf.js` |
| Login | Il limite per account non considerava tutti gli alias dell'email. Ora i contatori distinguono correttamente gli account sulla stessa rete, senza esporre gli indirizzi nelle chiavi. Rifiutati anche spazi interni alle email. | `lib/login-rate-limit.js`, `server.js`, `services/student-session.js` |
| Errori login e metriche | Gestite anche eccezioni prive di un oggetto Error; i log delle metriche usano metadati filtrati invece del messaggio grezzo upstream. | `routes/auth.js`, `routes/metriche.js` |
| Cache carriera | Un job precedente poteva ripopolare una cache invalidata o interferire con il nuovo caricamento. Ora solo il job corrente può aggiornare e liberare lo stato. | `services/career-cache.js` |
| Esami e CFU | Esiti come NON IDONEO e voti fuori scala potevano alterare i CFU acquisiti. Il parser condiviso esclude esiti negativi, gestisce CFU decimali e preserva codice, lode e alias. | `services/career-metrics.js`, `lib/metriche.js`, `scraper/segrepass.js` |
| Campi login del portale | Il fallback trattava un ElementHandle come un array. Corrette ricerca e gestione dei campi generici username/password. | `scraper/segrepass.js` |
| Docenti | Un refresh in background poteva produrre rejection non gestite; un dettaglio assente poteva restare in cache. Ora conserva il dettaglio precedente quando il refresh fallisce e consente nuovi tentativi. | `routes/docenti.js` |
| Orario | Senza iniziale del cognome potevano sparire tutte le lezioni. Il refresh forzato ora raggiunge anche la cache interna del provider. | `lib/timetable-matching.js`, `services/timetable-service.js`, `services/easyacademy-provider.js` |
| Chiusura server | Il database poteva essere chiuso mentre una richiesta HTTP era ancora attiva. Ora il server completa le richieste prima di chiudere scraper e database e ferma i timer. | `server.js` |
| Ciclo di vita Chromium | La chiusura durante l'avvio poteva lasciare un browser aperto; due chiusure concorrenti potevano chiuderlo due volte. Ora la chiusura è condivisa, attende l'avvio e blocca nuovi job durante lo spegnimento. | `scraper/pool.js` |
| Subscription push | Accettati in precedenza URL HTTPS non utilizzabili o diretti a reti interne. Ora vengono validati URL e chiavi, controllati gli indirizzi DNS al collegamento e applicato un timeout di invio. | `lib/push-subscription.js`, `routes/notifications.js`, `services/web-push.js` |

## Correzioni frontend e PWA

| Area | Comportamento corretto | File principali |
| --- | --- | --- |
| Bootstrap e login | Una risposta tardiva del bootstrap non annulla un login appena riuscito. | `frontend/src/lib/api.ts`, `DashboardView.tsx` |
| Logout e cambio account | Le risposte del vecchio account non ricostruiscono la sessione e non mescolano cache, Docenti, orario o preferenze con il nuovo account. | `api.ts`, `DashboardView.tsx` |
| Errori logout | Gli errori vengono mostrati, mantenendo coerente lo stato locale quando il server non conferma l'uscita. | `api.ts`, `DashboardView.tsx` |
| Profilo e navigazione | L'orario si aggiorna dopo una modifica del profilo; i dati Docenti si caricano cambiando sezione. | `DashboardView.tsx` |
| Promemoria e date | Le scadenze odierne restano visibili dopo mezzanotte. Le date impossibili sono rifiutate e il conteggio giorni gestisce il cambio dell'ora. | `calendar-date.ts`, `NotificationCenter.tsx`, `DeadlineView.tsx` |
| Materiali Docenti | Caricamenti di cartelle indipendenti, possibilità di riprovare dopo un errore, gestione di cartelle vuote e file annidati. | `DocentePage.tsx`, `DocenteDetailView.tsx` |
| Cache offline | Il service worker conserva solo gli asset previsti, escludendo API, health e richieste dinamiche/RSC. | `frontend/public/sw.js` |
| Link delle notifiche | Le destinazioni push restano all'interno dell'origine dell'app, anche quando l'URL inizia con due slash. | `frontend/public/sw.js` |
| Cambio tema | Rimosso il tooltip che usciva dalla pagina; il pulsante non invia accidentalmente un form. Titolo e nome accessibile restano disponibili. | `ThemeSwitch.tsx` |

I percorsi abbreviati della tabella si riferiscono a `frontend/src/lib` o `frontend/src/components`.

## Android e configurazione di avvio

- **Wrapper Android:** il tasto Indietro ora permette di uscire quando non esiste una pagina precedente; aggiunti controlli dopo operazioni asincrone per evitare aggiornamenti di widget già chiusi.
- **Cambio server Android:** gli eventi di una vecchia WebView non alterano lo stato della nuova. Gli URL con credenziali incorporate o porte non valide vengono rifiutati; query e percorsi vengono preservati.
- **HTTP locale in debug:** il manifest consente il collegamento già previsto dal codice e usa il marker di merge necessario. La release mantiene HTTPS.
- **Consenso notifiche Android:** la richiesta di autorizzazione parte dal pulsante dedicato; gli ascoltatori non vengono duplicati a ogni pressione.
- **Versione Node:** il requisito minimo è ora `22.12.0`, coerente con Puppeteer e better-sqlite3 installati. Il Dockerfile usa `node:24-bookworm-slim`.
- **Container:** aggiornato il flag Puppeteer per evitare download inutili; l'health check usa la porta configurata e un timeout.
- **Configurazione:** check iniziale e runtime condividono la validazione di origini e porta. Validati anche SameSite/Secure e valori di retention non numerici, infiniti o fuori intervallo.
- **Script diagnostici:** i fallimenti HTTP 4xx e i timeout producono un codice di uscita di errore. Rimosso il controllo sull'endpoint inesistente `/api/esami`; gli esami sono verificati attraverso `/api/metriche`.
- **Repository e documentazione:** esclusi gli output generati da Playwright, mantenuto condivisibile `.env.example` e sostituiti i collegamenti a documenti mancanti.

## Verifiche eseguite

| Controllo | Risultato |
| --- | --- |
| `npm run check` | **245/245 test backend**, configurazione valida |
| `npm --prefix frontend test` | **10/10 test frontend** |
| `npm --prefix frontend run lint` | Superato, nessun warning |
| `npm --prefix frontend run build` | Build Next.js e controllo TypeScript superati |
| `npm run test:visual` | **7/7 test browser Chromium** |
| `npm audit`, backend e frontend | **0 vulnerabilità segnalate**, incluse dipendenze di sviluppo |
| Controllo sintassi JavaScript | 75 file applicativi e diagnostici, zero errori |
| Migrazioni SQLite | Verificate su database di prova delle versioni precedenti |
| Persistenza dopo riapertura DB | Piano e anagrafica recuperati e cifrati a riposo |
| Avvio API e Chromium reali su DB in memoria | `/health`, `/ready`, `/readiness`: **200** |
| Endpoint senza autenticazione | Sessione e notifiche: **401**; support-admin non configurato: **404** |
| Spegnimento reale API e Chromium | Completato con **exit 0** |
| Manifest Android | XML validi; revisione statica dei cambiamenti |
| `git diff --check` | Superato |
| Collegamenti locali della documentazione | Nessun collegamento mancante dopo le correzioni |

La suite browser comprende due regressioni dedicate alle risposte tardive del bootstrap, al logout e al cambio account. La foto docente di prova ora è un PNG valido e viene verificata anche la decodifica nel browser. L'immagine di riferimento è stata aggiornata dopo ispezione visiva, escludendo l'indicatore di compilazione di Next.js e i messaggi transitori.

Il precedente test che dichiarava una risposta del backend in meno di 250 ms misurava API simulate: è stato sostituito con una verifica funzionale, senza attribuire ai mock prestazioni del server reale.

Le prove di avvio hanno usato la porta locale 3011 e un database in memoria. Le prove di migrazione e riapertura usano database temporanei dedicati. `.env` e i database personali non sono stati modificati per eseguire queste prove. I processi di prova sono stati chiusi.

I log dell'ultima suite backend, dei test browser e dello smoke test sono conservati localmente in `.kombai/audit-2026-11-19/`, esclusa da Git.

## Migrazione e utilizzo delle correzioni

Il database passa allo **schema 10** con aggiunta delle colonne cifrate `piano_json` e `anagrafica_json`. La migrazione conserva i dati esistenti ed è idempotente. Alla ripartenza il backend applica lo schema; piano e nome precedentemente non salvati verranno acquisiti al successivo login o refresh riuscito. Le sessioni esistenti continuano a usare il database e la stessa `CRED_KEY`.

Per ripetere i controlli da CMD:

```bat
cd /d "E:\segrepass-api\segrepass-api"
npm.cmd run check
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
npm.cmd run test:visual
npm.cmd audit
npm.cmd --prefix frontend audit
```

Ambiente della verifica: Windows, Node `26.13.1`, npm `11.20.0`, Next.js `16.4.6`. Git è stato eseguito tramite una copia portatile temporanea; nessun commit o push è stato eseguito.

## Verifiche che richiedono altri ambienti

- **Portali universitari:** login reale, prenotazione effettiva, download riservati e variazioni delle pagine upstream richiedono una prova con un account autorizzato. I test automatici usano dati sintetici e API simulate.
- **Android:** Flutter/Dart non sono disponibili su questo PC. Compilazione APK, firma, navigazione su dispositivo e consegna FCM restano da verificare; le modifiche Android sono state controllate staticamente.
- **Container:** Docker non è disponibile; il Dockerfile è stato corretto e rivisto, ma l'immagine non è stata costruita o eseguita.
- **Push e infrastruttura:** consegna reale VAPID/FCM, registrazione dei token nativi, worker dei promemoria, deploy remoto e ripristino dei backup richiedono i rispettivi servizi configurati.
- **Carico:** i controlli locali non misurano capacità multiutenza o tempi dei portali universitari.

Riferimenti tecnici usati per i controlli specifici: [advisory minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249), [merge dei manifest Android](https://developer.android.com/build/manage-manifests), [gestione Indietro Flutter](https://api.flutter.dev/flutter/widgets/PopScope-class.html), [configurazione Firebase Flutter](https://firebase.google.com/docs/flutter/setup).
