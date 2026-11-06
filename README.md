# Segrepass Dashboard

Una dashboard web (PWA, mobile-first) che riunisce in un'unica interfaccia carriera, voti, prenotazioni d'esame, tasse, orario delle lezioni e avvisi dei docenti per gli studenti Unina. I dati vengono letti dal portale **Segrepass**, dal **portale Docenti** e da **EasyAcademy**.

> **Progetto indipendente e non ufficiale.** Non è affiliato né approvato dall'Università degli Studi di Napoli Federico II o dai gestori dei portali. I dati mostrati provengono dai portali ufficiali, che restano l'unica fonte valida: in caso di discrepanza fa fede il portale. Le prenotazioni passano da Segrepass: verifica sempre l'esito sul portale.


## Funzionalità

| Sezione | Cosa fa |
| --- | --- |
| **Home** | Riepilogo della carriera, metriche principali, prossime lezioni e scadenze più vicine, con accesso rapido a orario, prenotazioni e pagamenti. |
| **Agenda** | Calendario unico con lezioni (EasyAcademy), appelli, test e prenotazioni, scadenze delle tasse. Vista calendario o elenco, esportazione in formato **ICS**. |
| **Carriera & Voti** | Esami verbalizzati o convalidati con materia, CFU, voto o giudizio e data. Ricerca per materia o codice. Sola lettura: non modifica il libretto ufficiale. |
| **Prenotazioni** | Appelli disponibili su Segrepass e informazioni su prove e prenotazioni dal portale Docenti, raggruppati per insegnamento, con storico. |
| **Tasse & Pagamenti** | Pagamenti in sospeso e pagati, con importo, causale, anno accademico, scadenza e codice IUV. Se il portale lo fornisce, apre il collegamento PagoPA. |
| **Docenti** | Avvisi, corsi seguiti, gruppi, test, ricerca e docenti preferiti, con schede docente (contatti, avvisi, corsi, materiali, quando resi disponibili dal portale). |
| **Orario Lezioni** | Orario letto da EasyAcademy e filtrato in base al profilo studente, con data, ora, insegnamento, docente, aula e stato dell'iscrizione Docenti. |
| **Piano di Studi** | Confronto tra manifesto e carriera: corsi superati, da sostenere, da verificare e CFU obbligatori mancanti, per anno e semestre. |

### Dettagli utili

- **Prenotazioni.** Il pulsante *Prenota* compare solo per gli appelli riconosciuti come prenotabili tramite Segrepass. Test e appelli letti dal portale Docenti sono mostrati come semplici informazioni. Se esistono iscrizioni o preferenze corrispondenti, l'appello del docente selezionato viene evidenziato; gli altri appelli dello stesso insegnamento restano visibili come alternative.
- **Pagamenti.** La dashboard non effettua pagamenti: si limita ad aprire PagoPA quando il portale fornisce il link.
- **Docenti preferiti.** Una preferenza è un'impostazione personale dell'app, collegata a un insegnamento del tuo piano. **Non** crea un'iscrizione ufficiale al corso sul portale Docenti; quando l'iscrizione effettiva è leggibile dal portale, l'app la distingue dalla semplice preferenza. Le preferenze servono a mostrare gli avvisi dei docenti preferiti, includerli nei corsi seguiti, aprirne la scheda ed evidenziarne gli appelli.
- **Profilo studente.** Per personalizzare piano e orario l'app può chiederti di completare il profilo: codice e nome del corso, anno di immatricolazione, anno di corso, canale e iniziale del cognome. I dati mancanti non vengono dedotti dagli esami, per non presentare supposizioni come certezze. Se il manifesto è disponibile puoi indicare anche gli esami a scelta.

## Da dove arrivano i dati

| Fonte | Informazioni principali |
| --- | --- |
| **Segrepass** | Profilo e carriera, esami, PIN, tasse, appelli e prenotazioni |
| **Portale Docenti** | Corsi seguiti, avvisi, docenti, test, materiali e attività |
| **EasyAcademy** | Lezioni, orari, aule e docenti dell'agenda |
| **Database dell'app** | Profilo personalizzato, preferenze docenti, sessioni e cache |

Un dato mancante non significa necessariamente che non esista sul portale: può dipendere da un ritardo, dalla struttura della pagina ufficiale, da un accesso non disponibile o dal fatto che l'informazione non sia pubblicata.

## Come funziona

1. **Accesso.** Si entra con l'email istituzionale `@studenti.unina.it` e la password. L'app apre una sessione sul server e carica subito i dati principali della carriera.
2. **Caricamento progressivo.** Le informazioni più lente (tasse, prenotazioni) arrivano in una seconda fase, quindi la dashboard può mostrare i dati principali prima che il caricamento secondario sia finito.
3. **Ripristino della sessione.** Ricaricando la pagina l'app prova a riprendere la sessione esistente; se è scaduta, chiede di accedere di nuovo.
4. **Cache.** I dati del portale Docenti possono arrivare da cache: le aperture successive sono più rapide e viene mostrato l'ultimo riepilogo disponibile mentre parte l'aggiornamento. L'interfaccia segnala quando i dati sono in aggiornamento o non disponibili.

## Sicurezza e privacy

- Le **credenziali** sono conservate **cifrate** sul server e recuperate solo per i servizi che devono interrogare i portali. La password non compare mai nello stato del profilo visibile al frontend: il browser non contiene le credenziali per interrogare direttamente i siti.
- Le **sessioni** sono lato server, con token casuali: nel database è salvato solo l'**hash** del token. Il cookie di sessione è opaco e **HttpOnly**.
- Una sessione dura **al massimo 7 giorni** o scade dopo **12 ore di inattività**; il logout la elimina. Le sessioni scadute vengono ripulite periodicamente.
- Le richieste che modificano dati sono protette da controlli dedicati e il login ha un limite di tentativi.
- Nel database dell'app restano solo profilo personalizzato, preferenze docenti, sessioni e cache.

> **Se ospiti l'app per altre persone**, ne custodisci le credenziali istituzionali (in forma cifrata ma recuperabile). Proteggi con cura la chiave di cifratura (`CRED_KEY`) e il server, e informa gli utenti di cosa viene salvato.

## Limitazioni note

- **Piano di Studi:** la copertura dipende dai manifesti importati nell'app. Se manca il manifesto del tuo corso o della tua coorte, la sezione spiega che non può costruire il confronto, anche se la carriera è leggibile.
- **Orario Lezioni:** se i dati del canale non corrispondono a quelli pubblicati, o EasyAcademy non risponde, l'orario può risultare vuoto o mostrare un errore. È disponibile un aggiornamento manuale e il link all'agenda ufficiale.
- **Scraping:** i portali non espongono API pubbliche, quindi un cambio nella struttura delle loro pagine può interrompere temporaneamente una sezione.

## Architettura

```
Browser (PWA Next.js) ⇄ Backend Node.js / Express ⇄ Segrepass · Docenti · EasyAcademy
                                  │
                                  └─ Database dell'app (profilo, preferenze, sessioni, cache)
```

- **Frontend:** Next.js (React, Tailwind), mobile-first, installabile come PWA.
- **Backend:** Node.js + Express. Gestisce login, sessioni, interrogazione dei portali (tramite browser automatizzato **Puppeteer**), cache e dati salvati.
- **Server-side only:** chiamate ai portali e cache vivono lato server.
- **EasyAcademy:** il backend gestisce in modo specifico il problema del certificato TLS scaduto incontrato dal browser automatizzato.

### Struttura del repository

```
segrepass-api/        backend Node.js / Express
├── frontend/         frontend Next.js
├── scraper/          scraper Puppeteer (portale Docenti, orario EasyAcademy, ...)
├── services/         provider e servizi con cache (es. timetable)
├── middleware/       autenticazione e controlli sulle richieste
├── config/           configurazioni (es. mappa codici corso Unina → EasyAcademy)
└── test/
```

## Avvio in locale dal PC

**Prerequisiti:** Node.js 20 o successivo e un account studente Unina valido.

```powershell
git clone <url-del-repository>
cd segrepass-api
Copy-Item .env.example .env
```

Imposta nel file `.env` una `CRED_KEY` casuale di 64 caratteri esadecimali e le altre variabili richieste. Non condividere né committare `.env`.

Apri due terminali PowerShell:

```powershell
# Terminale 1 — dalla root del repository
npm install
npm start
```

```powershell
# Terminale 2 — dalla root del repository
cd frontend
npm install
npm run dev
```

Sul PC apri <http://localhost:3000> e accedi con le tue credenziali istituzionali. Lascia entrambi i terminali aperti mentre usi l'app.

## Test da telefono Android — versione sperimentale

In questa versione l'app Android è un contenitore WebView: **frontend e backend continuano a girare sul PC**. Il telefono deve essere sulla stessa rete Wi-Fi; non avvia i servizi da solo e il PC deve rimanere acceso.

1. Avvia backend e frontend seguendo i passaggi sopra. Il frontend è configurato per accettare connessioni dalla rete locale.
2. Sul PC esegui `ipconfig` e annota l'indirizzo IPv4 della scheda collegata alla Wi-Fi (per esempio `192.168.1.101`). Non usare `0.0.0.0`: è solo l'indirizzo su cui il server si mette in ascolto.
3. In `.env`, imposta `FRONTEND_URL=http://IP-DEL-PC:3000` usando lo stesso IP. Riavvia il backend dopo la modifica. Questo consente al controllo CSRF e a CORS di accettare il frontend aperto dal telefono.
4. In [frontend/next.config.ts](frontend/next.config.ts), aggiorna `allowedDevOrigins` con l'IP del PC se è diverso da quello già configurato. Riavvia `npm run dev` dopo la modifica.
5. Installa l'APK `arm64` sul telefono Android. Puoi generarlo come descritto in [android_app/README.md](android_app/README.md) e trasferirlo con USB o un altro metodo locale.
6. Collega telefono e PC alla stessa Wi-Fi. Al primo avvio dell'app inserisci `http://IP-DEL-PC:3000`; l'indirizzo verrà salvato e riaperto ai successivi tocchi sull'icona.

Se Windows Firewall lo chiede, consenti Node.js sulla rete privata. Se non riesci a collegarti, verifica che PC e telefono siano sulla stessa rete e che frontend e backend siano ancora attivi. Questa configurazione HTTP è per prove in rete locale: non esporre il server a Internet. Per usarlo da reti esterne serve un server raggiungibile con HTTPS e una configurazione dedicata.

Il file `.env` contiene segreti e configurazioni personali: resta locale e non va aggiunto a Git.

## Stato del progetto

Progetto personale in sviluppo attivo, pensato per essere usato e testato prima di tutto dal suo autore. Segnalazioni e suggerimenti sono benvenuti tramite le *issue* del repository.
