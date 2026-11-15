# Report Tecnico: Branding Sicuro, Configurazione Avvio, Rete (WAF) e Bug Materiali Docenti

Data: 2026-11-13
Progetto: UniDesk NA (`segrepass-api` & `frontend`)

## Parte 0: Rebranding Sicuro e Tutela Legale (`UniDesk NA`)

Per evitare qualsiasi contestazione per contraffazione di marchio, concorrenza sleale o falsa affiliazione legata ai segni distintivi ufficiali **"Segrepass"** e **"UNINA"**, il progetto adotta il nuovo nome **UniDesk NA** seguendo queste linee guida operative e di branding:

* **Nome dell'app / PWA:** **UniDesk NA** (rimuovendo "Segrepass" e "UNINA" dal titolo principale della PWA, dal `manifest.json`, dai metadati HTML e dal README pubblico).

* **Sottotitolo / Tagline:** *"Dashboard non ufficiale per gli studenti dell'Università Federico II"* / *"Client non ufficiale per studenti"* (in diritto dei marchi, citare l'ateneo solo per descrivere la compatibilità del servizio è lecito, purché non compaia nel nome del prodotto).

* **Dominio web:** Evitare domini che contengono `unina` o `segrepass` (utilizzare domini neutri come `unidesk-na.it` o `unideskna.app`).

* **Identità Visiva, Grafica e Colori (Stile Accademico / Territoriale):**
  * Evitare rigorosamente lo stemma ufficiale con l'imperatore Federico II e il sigillo dell'ateneo.
  * **Monogramma originale (`UD`):** Intreccio vettoriale tra le lettere **U** e **D** con una reinterpretazione originale e geometrica dei simboli storici e geografici: un'aquila araldica stilizzata con corona (richiamo storico svevo, privo di elementi copiati dallo stemma ufficiale) fusa con il profilo del Vesuvio e delle onde del mare all'interno della "D" (richiamo territoriale a Napoli / `NA`).
  * **Palette cromatica:** **Blu reale profondo** (ambito accademico) abbinato a **oro antico / ocra** (autorevolezza storica), declinati in uno stile piatto e moderno per icone PWA (`192x192`, `512x512`, favicon) e UI.

  l'icona si trova nella root con il nome logo_prova.jpg
  non bisogna modificare i colori per nessun motivo poi per quello si vede

## Parte 1: Comportamento all'Avvio del Progetto (`injected env (0)` e `"richiesta rifiutata"`)

### 1.1 Descrizione e Sintomo

All'avvio del server backend dopo l'aggiornamento di sicurezza, si sono verificati due comportamenti bloccanti:

1. Il log iniziale mostrava `◇ injected env (0) from .env` (nessuna variabile caricata).

2. Ogni chiamata proveniente dal frontend veniva bloccata dal server con l'errore:

   ```
   [Server Error] { code: 'Error', status: undefined } richiesta rifiutata
   
   ```

### 1.2 È un bug? Diagnosi Tecnica

**Non è un bug del codice**, ma l'effetto combinato di due fattori di configurazione locale e delle nuove regole di sicurezza *fail-closed* introdotte nell'hardening:

1. **Protezione CORS / CSRF Strict (`lib/runtime-config.js` e `lib/csrf.js`):**

   * Con il nuovo hardening, il server rifiuta per sicurezza qualsiasi richiesta la cui `Origin` non sia esplicitamente autorizzata in `FRONTEND_URL` (e con `ALLOW_DYNAMIC_ORIGIN=false` non accetta più origini dinamiche in automatico).

   * Se `FRONTEND_URL` è vuoto o non viene letto dal `.env`, il server blocca legittimamente ogni richiesta con `"richiesta rifiutata"`.

2. **File `.env` vuoto, nella directory errata o con codifica BOM (`injected env (0)`):**

   * `dotenv` restituisce `injected env (0)` quando il file `.env` nella directory di lavoro (`D:\segrepass-api\segrepass-api\.env`) è vuoto, non salvato o salvato con codifica **UTF-16 / BOM** su Windows.

### 1.3 Raccomandazione / Miglioria DX (Developer Experience)

Anche se il comportamento è voluto per sicurezza, è consigliabile migliorare il messaggio di avvio in `check-env.js` / `lib/runtime-config.js`:

* Se in `NODE_ENV=development` `FRONTEND_URL` risulta vuoto e `ALLOW_DYNAMIC_ORIGIN=false`, stampare un **warning esplicito** al boot del server (es. `⚠️ Attenzione: FRONTEND_URL non configurato, tutte le richieste browser verranno rifiutate da CORS/CSRF`) invece di fallire silenziosamente fino alla prima chiamata HTTP.

## Parte 2: Blocco IP Temporaneo / Rate-Limiting sui Portali UNINA

### 2.1 Descrizione e Sintomo

Durante i test di autenticazione e scraping verso `segrepass1.unina.it`, `segrepass2.unina.it` e `segrepass3.unina.it`, le richieste provenienti dall'indirizzo IP della rete domestica fissa andavano sistematicamente in timeout:

```
[Segrepass] ❌ Nodo segrepass1 non raggiungibile o timeout.
[Segrepass] ❌ Nodo segrepass2 non raggiungibile o timeout.
[Segrepass] ❌ Nodo segrepass3 non raggiungibile o timeout.
[Auth Error] { code: 'PORTAL_UNAVAILABLE', status: undefined }

```

Eseguendo il test isolato da terminale (`curl.exe -4 -I https://www.segrepass1.unina.it/identificazione.do --connect-timeout 10`):

* **Da IP rete fissa:** `curl: (28) Connection timed out after 10015 milliseconds`

* **Da IP rete mobile:** `HTTP/1.1 200` con rilascio regolare di `JSESSIONID.tomcat11`

### 2.2 Diagnosi Tecnica

* **Non è un downtime dei server UNINA:** I nodi Tomcat/Apache erano attivi e rispondevano normalmente.

* **Non è un problema di IPv6 o DNS:** Il timeout si verificava anche forzando IPv4 (`-4`).

* **Causa reale (IP Rate-Limiting / Ban Temporaneo WAF):** L'infrastruttura GARR / Università Federico II applica filtri automatici per proteggere Esse3/SegrePass da traffico automatizzato o picchi di richieste ravvicinate dallo stesso IP pubblico, applicando un drop silenzioso dei pacchetti per 12–24 ore.

### 2.3 Fattori Scatenanti e Contromisure

1. **Riconoscimento Headless Browser (`scraper/pool.js`):**

   * Impostare uno `User-Agent` desktop standard e header `Accept-Language: it-IT,it;q=0.9`.

   * Nascondere la proprietà `navigator.webdriver` tramite `evaluateOnNewDocument`.

2. **Moltiplicazione delle richieste per pagina (`scraper/pool.js`):**

   * Abilitare `setRequestInterception(true)` e bloccare risorse non necessarie al parsing (`image`, `stylesheet`, `font`, `media`) per passare da \~20 hit HTTP a **1 sola richiesta HTML** per pagina.

3. **Navigazioni troppo ravvicinate (`scraper/utils.js`):**

   * Introdurre un ritardo casuale (*jitter* di `700ms – 1600ms`) tra una navigazione e l'altra.

4. **Concorrenza e Riuso Sessioni (`.env` / `scraper/`):**

   * Mantenere bassa la concorrenza (`SCRAPER_CONCURRENCY=2`, `SCRAPER_APPELLI_CONCURRENCY=2`).

   * Fermarsi al primo nodo disponibile (`segrepass1`) senza interrogare inutilmente `segrepass2` e `segrepass3`.

   * Sfruttare la cache server (`CAREER_CACHE_TTL_MS=900000`) e l'endpoint `/api/auth/bootstrap`.

## Parte 3: Bug Rilevati nella Sezione Materiali Docenti

### 3.1 Bug 1: Duplicazione delle cartelle e dei file nell'albero materiali

* **Evidenza:** Nella vista materiale didattico (es. cartella `FISICA_GENERALE_II`), la sottocartella `ESERCIZI` e l'intero elenco `Lezione1.pdf` – `Lezione24.pdf` compaiono ripetuti 3 volte consecutivamente nella stessa vista.

* **Causa probabile:**

  1. **Paginazione in `scraper/docenti.js`:** Durante l'iterazione sulle pagine della tabella materiale didattico (`DOCENTI_MAX_PAGINATION_PAGES`), il portale Web Docenti restituisce la stessa struttura ad albero su più richieste/pagine e lo scraper concatena i risultati senza deduplicare.

  2. **Merge Cache / State (`services/docenti-cache.js` / `DocentePage.tsx`):** I nodi vengono accodati invece di essere filtrati tramite chiave univoca.

* **Fix richiesto:** Implementare una deduplicazione ricorsiva di cartelle e file basata su identificativo univoco (`materialId` oppure combinazione `folderPath + fileName + downloadUrl`) sia lato scraper prima del salvataggio in cache, sia lato frontend prima del rendering.

### 3.2 Bug 2: Doppio tab aperto al singolo click su un file PDF

* **Evidenza:** Cliccando una sola volta su un materiale (es. `Lezione1.pdf` verso `/api/docenti/teacher/...`), il browser apre contemporaneamente due schede identiche.

* **Causa probabile:**

  1. **Doppio trigger di apertura:** Coesistenza di un tag `<a href="..." target="_blank">` e di un handler `onClick` con `window.open(...)` privi di `e.preventDefault()`, oppure *event bubbling* verso un elemento contenitore che rilancia l'apertura.

  2. **Doppio listener in React (`useEffect`):** In sviluppo con React StrictMode attivo, un eventuale listener registrato manualmente viene eseguito due volte.

* **Fix richiesto:** Ispezionare il componente di apertura file in `frontend/src/components/DocentePage.tsx` e `DocentiView.tsx`, lasciando un **unico meccanismo di apertura** con `e.preventDefault()`, `e.stopPropagation()` e un debounce/lock di 300ms per prevenire doppi trigger accidentali.

### 3.3 Bug 3: Disconnessione improvvisa della sessione Web Docenti ("si scollega da un momento all'altro")

* **Evidenza:** Durante la navigazione nella sezione Docenti o all'apertura di una pagina docente/materiale, la sessione Docenti risulta improvvisamente scollegata e l'utente perde l'accesso ai dati o al proxy PDF, pur restando loggato su SegrePass.

* **Causa probabile:**

  1. **Scadenza cookie Shibboleth / SSO (`docenti.unina.it`):** I cookie di sessione del portale Web Docenti UNINA hanno un TTL molto breve (spesso 10–15 minuti di inattività) rispetto alla sessione dell'app, oppure vengono invalidati lato server se viene aperta una nuova istanza browser/contesto senza riutilizzare i cookie salvati.

  2. **Mancato auto-refresh / re-login trasparente (`services/student-session.js` / `routes/docenti.js`):** Quando il portale `docenti.unina.it` risponde con un redirect verso la pagina di login SSO (`idp.unina.it`) o `401/403`, il backend/proxy PDF non intercetta il redirect di sessione scaduta e non rigenera la sessione Docenti.

  3. **Reset dello stato opt-in al reload/polling (`services/slow-sync.js` / `DocentiView.tsx`):** Durante il polling lento o il refresh della pagina (`/api/auth/bootstrap`), il flag di sessione attiva Docenti in memoria RAM viene perso o sovrascritto.

* **Fix richiesto:**

  * Intercettare esplicitamente il redirect SSO/login nelle chiamate verso `docenti.unina.it` (`scraper/docenti.js` e proxy PDF in `routes/docenti.js`).

  * Implementare un meccanismo di *session keep-alive* / *transparent re-auth* (se l'opt-in è attivo nella sessione corrente) oppure restituire un errore strutturato `DOCENTI_SESSION_EXPIRED` che nel frontend mostri un prompt rapido per ricollegare Docenti senza perdere il resto della sessione SegrePass.

### 3.4 Bug 4: Lentezza eccessiva al click sul nome del docente

* **Evidenza:** Cliccando sul nome di un docente nella lista (`DocentiView.tsx` -> `DocentePage.tsx`), il caricamento della scheda del docente e dei relativi materiali impiega molti secondi prima di mostrare contenuti.

* **Causa probabile:**

  1. **Scraping sincrono completo on-demand (`scraper/docenti.js`):** Al click, il backend apre una pagina Puppeteer da zero e naviga in sequenza tutte le tab del docente (avvisi, scheda insegnamento, esami, e fino a `DOCENTI_MAX_PAGINATION_PAGES=20` pagine dell'albero materiali) prima di restituire qualsiasi risposta HTTP al frontend (che peraltro causa anche la duplicazione del Bug 1).

  2. **Mancato utilizzo di `fetch` HTTP diretto con i cookie di sessione:** Una volta ottenuto il cookie di sessione `docenti.unina.it`, le sotto-pagine o le chiamate AJAX dell'albero materiali possono essere scaricate via `fetch` / `undici` in pochi millisecondi invece di avviare e renderizzare pagine complete su Chromium/Puppeteer.

  3. **Assenza di cache immediata / caricamento progressivo (`DocentiDataCache` / `DocentePage.tsx`):** Non viene mostrato subito il dato eventualmente già presente in `DocentiDataCache` (pattern *stale-while-revalidate*), né vengono caricati separatamente i dettagli base del docente (veloci) rispetto all'albero completo dei materiali (lento).

* **Fix richiesto:**

  * **Pattern Stale-While-Revalidate:** Se il profilo del docente è già in `DocentiDataCache`, restituirlo istantaneamente (<50ms) e aggiornare in background solo su richiesta esplicita ("Aggiorna") o se scaduto.

  * **Caricamento suddiviso (Split Endpoints / Lazy Tree):** Restituire subito anagrafica, avvisi e cartelle principali del docente, caricando le sottocartelle/paginazione solo quando necessario ed evitando loop inutili fino a 20 pagine quando la risposta è già completa (questo risolverà contemporaneamente anche il **Bug 1**).

  * **Prefetching / HTTP Fetch leggero:** Dove possibile, sostituire la navigazione Puppeteer sulle sotto-pagine del docente con richieste HTTP `fetch` che riutilizzano i cookie di sessione già autenticati.

## Parte 4: Prompt Operativo per Applicare le Correzioni e il Rebranding

```
Analizza e risolvi i seguenti punti in `segrepass-api` e `frontend`:

0. **Rebranding Sicuro e Identità Visiva (`frontend/public/manifest.json`, `frontend/src/app/layout.tsx`, UI, asset icone e `README.md`):**
   - Aggiorna il nome dell'applicazione/PWA in **UniDesk NA**, rimuovendo "Segrepass" e "UNINA" dal nome principale, dai titoli e dalle icone.
   - Imposta come sottotitolo/tagline: "Client non ufficiale per studenti" / "Dashboard non ufficiale per gli studenti dell'Università Federico II" e aggiungi il disclaimer di indipendenza nel footer/login.
   - Aggiorna la palette UI e le icone PWA/favicon usando lo stile **UniDesk NA** (blu reale profondo e oro antico/ocra, con monogramma originale UD che integra aquila araldica stilizzata, Vesuvio e onde del mare, privo di stemmi ufficiali).

1. **Avviso Configurazione Avvio (`check-env.js` / `lib/runtime-config.js`):**
   - Se in `NODE_ENV=development` `FRONTEND_URL` è vuoto e `ALLOW_DYNAMIC_ORIGIN=false`, stampa un warning chiaro all'avvio per avvisare che le richieste browser verranno rifiutate da CORS/CSRF.

2. **Anti-Ban WAF (`scraper/pool.js` e `scraper/utils.js`):**
   - Verifica che `setRequestInterception(true)` blocchi `image`, `stylesheet`, `font` e `media`.
   - Imposta uno `User-Agent` desktop aggiornato, `Accept-Language: it-IT,it;q=0.9` e rimuovi `navigator.webdriver`.
   - Aggiungi una funzione `humanDelay(700, 1600)` tra i cambi pagina dello scraper per evitare pattern di traffico troppo ravvicinati.

3. **Deduplicazione Materiali Docenti (`scraper/docenti.js`, `services/docenti-cache.js`, `frontend/src/components/DocentePage.tsx`):**
   - Risolvi il bug per cui la cartella `ESERCIZI` e i file `Lezione1.pdf..Lezione24.pdf` compaiono duplicati 3 volte nella stessa vista. Interrompi la paginazione quando non ci sono nuovi elementi e aggiungi deduplicazione ricorsiva per ID/URL univoco sia nello scraper sia nel frontend prima del render.

4. **Singola Apertura Tab PDF (`frontend/src/components/DocentePage.tsx` e `DocentiView.tsx`):**
   - Risolvi il bug per cui un singolo click su un file PDF apre due schede browser identiche verso `/api/docenti/teacher/...`. Rimuovi il doppio trigger tra `<a target="_blank">` e `window.open` (o event bubbling sul parent) usando `e.preventDefault()` e `e.stopPropagation()`.

5. **Persistenza e Gestione Scadenza Sessione Docenti (`routes/docenti.js`, `scraper/docenti.js`, `services/student-session.js`, `frontend/src/components/DocentiView.tsx`):**
   - Risolvi il problema per cui la sessione Docenti si scollega improvvisamente durante l'uso.
   - Intercetta i redirect SSO/login di `docenti.unina.it` sia nello scraper sia nel proxy PDF, evita che il polling o `/api/auth/bootstrap` azzerino lo stato attivo di Docenti, e gestisci in modo pulito la scadenza cookie (con rinnovo automatico nella sessione attiva o stato `DOCENTI_SESSION_EXPIRED` gestito dalla UI).

6. **Velocizzazione Apertura Scheda Docente (`routes/docenti.js`, `scraper/docenti.js`, `services/docenti-cache.js`, `frontend/src/components/DocentePage.tsx`):**
   - Risolvi la lentezza eccessiva al click sul nome di un docente.
   - Usa la cache `DocentiDataCache` in modalità *stale-while-revalidate* per rispondere immediatamente se i dati sono già presenti.
   - Evita di navigare inutilmente 20 pagine di paginazione o di aprire nuove istanze Puppeteer quando le chiamate HTTP `fetch` con i cookie di sessione o il caricamento progressivo (dati base prima, albero materiali dopo) possono ridurre i tempi da diversi secondi a pochi millisecondi.

```