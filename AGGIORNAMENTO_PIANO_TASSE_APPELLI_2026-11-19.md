# Recupero piano di studi tasse e appelli

Aggiornamento del 19 novembre 2026, successivo alla revisione generale descritta in [REPORT_BUG_2026-11-19.md](REPORT_BUG_2026-11-19.md).

## Problemi segnalati

Una studentessa di Ingegneria Chimica, coorte 2025, vedeva il messaggio secondo cui i dati erano stati letti correttamente ma il manifesto non era stato importato. Questa frase veniva mostrata anche quando il piano personale non era stato recuperato: non dimostrava che i dati del piano fossero stati letti. Sono stati inoltre segnalati errori di lettura di tasse e appelli.

## Recupero del piano personale

Il manifesto locale non è più necessario per tentare il recupero. Se manca un piano utilizzabile, `/api/career-plan` prova a leggere il piano personale dalla sessione Segrepass, lo salva cifrato e lo associa al corso e alla coorte correnti. Un manifesto senza insegnamenti permette lo stesso recupero.

Il lettore ora riconosce intestazioni come **Codice insegnamento**, **Insegnamento**, **Attività formativa**, **Crediti formativi** e **CFU**. Cerca anche nei frame, unisce le tabelle del piano e gestisce intestazioni su più righe, anni romani e crediti decimali.

L'indicazione **IMM. DAL** nel titolo del piano non sostituisce la coorte personale già impostata: può indicare da quando si applica quel piano. Il recupero non modifica automaticamente la coorte 2025 della studentessa.

Il pulsante **Riprova lettura piano** richiede davvero una nuova lettura tramite `?refresh=1`. Le richieste concorrenti vengono condivise e i tentativi sono limitati da un intervallo di 60 secondi. Il salvataggio viene annullato se la sessione non è più valida o il profilo è cambiato durante il caricamento.

Se la lettura continua a fallire, l'interfaccia mostra **Piano non ancora recuperato** con istruzioni coerenti, senza dichiarare che il corso non è supportato o che il manifesto sicuramente manca. Non è stato creato un manifesto generico di Ingegneria Chimica usando dati inventati o dati personali.

File principali: `scraper/piano.js`, `lib/piano-normalizer.js`, `services/study-plan-service.js`, nuovo `services/study-plan-sync.js`, `routes/career-plan.js`, `frontend/src/components/StudyPlanView.tsx`.

## Lettura indipendente di tasse e appelli

Le due fonti hanno ora stati separati. Un errore sulle tasse non nasconde gli appelli riusciti; un errore sugli appelli non elimina le tasse già disponibili. Vengono salvate soltanto le sezioni lette correttamente e viene conservata l'ultima copia valida delle altre.

Una pagina non riconosciuta o una sessione ESIS scaduta non diventano più automaticamente **zero tasse** o **nessun appello**. Sono distinti i risultati vuoti autentici, le letture parziali e gli errori. Le tabelle vengono cercate nei frame pertinenti, senza scambiare una tabella anagrafica per un elenco di appelli.

Se una lettura in una nuova scheda fallisce, viene eseguito un solo tentativo nella scheda ESIS già autenticata. Questi tentativi avvengono in sequenza, senza navigazioni concorrenti o chiusura della scheda condivisa. I dettagli degli appelli hanno concorrenza e timeout limitati.

Il frontend mostra quale fonte non è stata aggiornata, continua a controllare dopo un errore recuperabile e offre **Riprova tasse e appelli**. Il backend rispetta un intervallo di due minuti dopo un errore, con un massimo di tre tentativi automatici; resta disponibile il tentativo esplicito dopo l'intervallo.

Il contratto `/api/career/slow-data` rimane compatibile con i vecchi campi e aggiunge:

```text
status: idle | loading | ready | partial | error
sections.taxes: stato della lettura tasse
sections.appelli: stato della lettura appelli
retryAfterMs: attesa prima di un nuovo tentativo
```

Ogni sezione contiene `status`, eventuale codice `error` e `stale` quando viene mostrata una copia precedente valida. `?refresh=1` richiede il refresh anche in presenza di cache.

File principali: `services/slow-sync.js`, `routes/career.js`, `scraper/tasse.js`, `scraper/prenotazioni.js`, nuovi `scraper/slow-data.js` e `scraper/slow-page-state.js`, integrazione lenta in `scraper/segrepass.js`, `frontend/src/lib/slow-data.ts`, `DashboardView.tsx` e `api.ts`.

## Tabelle fiscali e scadenze

- Le intestazioni vengono cercate dopo eventuali righe di titolo; le tabelle contenitore non duplicano i dati delle tabelle interne.
- Le tabelle valide senza righe restano riconoscibili come risultati vuoti.
- La provenienza dalla pagina **debiti** prevale sull'euristica della colonna generica **Data**, evitando di classificare una rata da pagare come già pagata.
- Sono gestite le scadenze con intestazioni abbreviate e vengono rifiutate date impossibili.
- Quando manca un codice tributo non viene più inserito il valore fisso `7001`.
- La normalizzazione conserva i metadati di indisponibilità e di copia precedente.

File principali: `scraper/utils.js`, `lib/taxes.js`, `scripts/live-check.js`.

## Verifiche finali

| Controllo | Risultato |
| --- | --- |
| Suite backend completa e configurazione | **276/276 test superati** |
| Test frontend | **15/15 superati** |
| Test browser Chromium | **13/13 superati** |
| Lint frontend | Superato senza warning |
| Build Next.js e TypeScript | Superata |
| Avvio con database in memoria e Chromium reale | `/health`, `/ready`, `/readiness`: **200** |
| Spegnimento del processo di prova | **exit 0** |
| `git diff --check` | Superato |

I test comprendono il caso simulato **Ingegneria Chimica coorte 2025 senza manifesto**, il recupero esplicito dalla schermata, la persistenza cifrata, la deduplica e il cambio profilo durante un caricamento. Nel browser sono state provate anche tabelle HTML reali di fixture dentro frame, con colonne alternative e più sezioni. Per tasse e appelli sono coperti errori parziali, dati precedenti conservati, risultati vuoti validi, tentativi successivi e attese.

Le prove usano dati sintetici, database in memoria o temporanei e pagine simulate. Non sono state usate le credenziali della studentessa e non è stata verificata una lettura del suo account universitario reale. `.env` e i database personali non sono stati modificati per queste prove.

I log della suite backend, dei test browser e dell'avvio sono in `.kombai/recovery-2026-11-19/`, esclusa da Git.

## Applicazione sul servizio online

Queste correzioni sono nella copia locale del progetto. Per renderle disponibili alla studentessa occorre aggiornare **sia backend sia frontend** sul servizio che utilizza. Non sono stati eseguiti commit, push o deploy durante questo intervento.

Dopo l'aggiornamento del servizio, aprire **Piano di studi** e usare **Riprova lettura piano** se necessario; per le altre due sezioni usare **Riprova tasse e appelli**, rispettando l'attesa indicata. Corso e coorte corretti non devono essere cambiati per aggirare un errore di lettura.
