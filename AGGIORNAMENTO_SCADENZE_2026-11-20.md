# Correzione delle scadenze e del confronto con oggi

La sezione **Scadenze** confronta date e orari con il giorno corrente nel fuso `Europe/Rome`. Le tasse ancora da pagare restano visibili anche dopo la scadenza; gli esami passati vengono esclusi. La pagina si aggiorna automaticamente mentre rimane aperta e quando si torna sulla scheda.

## Come usare la sezione

La data di oggi è sempre visibile nell'intestazione. I riquadri **Tutte le scadenze**, **Oggi** e **Scadute** filtrano l'elenco; i pulsanti **Esami**, **Prenotazioni** e **Pagamenti** permettono di scegliere il tipo. I contatori seguono il tipo selezionato.

Le voci sono raggruppate in Scadute, Oggi, Domani, Nei prossimi 7 giorni e Più avanti. Ogni voce mostra data, eventuale orario, origine e distanza da oggi. Il filtro Oggi comprende anche le prenotazioni chiuse durante la giornata, chiaramente indicate come **Chiusa oggi**.

Esempio con oggi impostato al 20 novembre 2026, ore 16:30 italiane:

| Dato di esempio | Indicazione nella pagina |
| --- | --- |
| Rata non pagata del 19 novembre | Scaduta da 1 giorno |
| Rata del 20 novembre senza orario | Oggi, valida fino a fine giornata |
| Prenotazione che chiude il 20 novembre alle 12:00 | Chiusa oggi |
| Esame del 21 novembre | Domani |
| Pagamento già saldato o esame passato | Escluso dall'elenco |

## Correzioni applicate

- Date italiane, ISO e timestamp vengono interpretati senza dipendere dal fuso del dispositivo. Il cambio di ora legale non altera il conteggio dei giorni.
- Una data senza orario vale per tutta la giornata; un orario esplicito conserva l'istante di scadenza. Anche la mezzanotte delle finestre Docenti viene preservata durante la lettura.
- Date impossibili vengono escluse e segnalate. Se un campo data non è valido, viene cercato un alias valido prima di scartare la voce.
- Tasse saldate e duplicati vengono esclusi. Importi pari a zero restano visibili. Il codice tributo non viene usato da solo per considerare pagata una rata diversa.
- Gli esami già prenotati su Docenti non producono falsi avvisi di chiusura, anche quando Segrepass usa una rappresentazione diversa della stessa data.
- Aprire direttamente Scadenze carica anche i dati Docenti. Una ricerca effettuata in Prenotazioni non filtra lo scadenziario.
- Errori o dati non aggiornati mostrano un avviso. Le prenotazioni Docenti già caricate restano disponibili in caso di errore e **Riprova** aggiorna anche quella fonte.

L'orizzonte futuro resta di 90 giorni. I pagamenti arretrati non vengono nascosti da questo limite. Le finestre di prenotazione già chiuse rimangono pertinenti soltanto finché l'esame associato non è passato.

## Verifiche locali

- Backend: **278/278 test superati**, con database di test isolato.
- Frontend: **35/35 test superati**, di cui 20 dedicati al calcolo delle scadenze.
- Browser: **21/21 test superati**, di cui 6 dedicati allo scadenziario. Coprono filtri, fuso estero, cambio di giorno senza ricaricare la pagina, ricerca indipendente, recupero Docenti e conservazione dei dati dopo un errore.
- ESLint e build di produzione Next.js superati.

Anteprime controllate: [desktop scuro](.kombai/deadlines/desktop.png), [desktop chiaro](.kombai/deadlines/desktop-light.png) e [mobile](.kombai/deadlines/mobile.png). Le immagini usano dati di esempio e restano escluse da Git.

I controlli delle date usano dati di esempio e un orologio simulato. La completezza dei dati personali dipende dalla disponibilità delle sessioni e dei portali ufficiali; gli stati incompleti sono segnalati nella pagina.

## Avvio e pubblicazione

Il progetto corrente si trova in `E:\segrepass-api\uni-desck`. L'istanza frontend rimasta attiva dalla cartella precedente è stata fermata perché restituiva errori nel caricamento dei file JavaScript.

Frontend e backend sono stati riavviati dalla cartella corretta. Verificati `http://localhost:3000` con risposta HTTP 200 e `http://localhost:3001/health` con stato `ok`. I log locali sono in `.kombai/runtime/`.

Le modifiche al sito online richiedono la pubblicazione del frontend e del backend aggiornati. Non sono necessarie nuove variabili d'ambiente o modifiche allo schema del database.
