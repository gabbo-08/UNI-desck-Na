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

## Avvio in locale

**Prerequisiti:** Node.js (LTS) e un account studente Unina valido.

```bash
git clone <url-del-repository>
cd segrepass-api

# Backend
npm install
# crea un file .env con CRED_KEY=<chiave segreta casuale> e le altre variabili richieste
npm start

# Frontend (in un altro terminale)
cd frontend
npm install
npm run dev
```

Apri poi l'indirizzo mostrato dal frontend e accedi con le tue credenziali istituzionali.

## Stato del progetto

Progetto personale in sviluppo attivo, pensato per essere usato e testato prima di tutto dal suo autore. Segnalazioni e suggerimenti sono benvenuti tramite le *issue* del repository.
