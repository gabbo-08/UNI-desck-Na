# Funzioni da sviluppare in seguito

Questo documento raccoglie le idee concordate per la prossima fase di UniDesk NA.
Le funzioni sono ordinate per utilità e fattibilità, così il lavoro può riprendere
da casa senza dover ricostruire il contesto dalla conversazione.

## Priorità 1: Home intelligente

- [ ] Card **Oggi** con lezione in corso o successiva.
- [ ] Aula, docente e insegnamento della prossima lezione.
- [ ] Prossima scadenza universitaria o rata.
- [ ] Prossimo appello prenotabile.
- [ ] Ultimo avviso dei docenti seguiti.
- [ ] Azioni rapide: apri agenda, prenota, paga, cerca docente.

Questa funzione riutilizza i dati già disponibili di orario, scadenze, appelli,
tasse e Docenti senza aggiungere una nuova voce alla navigazione.

## Priorità 2: Promemoria e notifiche

- [ ] Preferenze separate per lezioni, appelli, tasse, scadenze e Docenti.
- [ ] Promemoria per la lezione imminente.
- [ ] Avviso prima della chiusura di una prenotazione.
- [ ] Avviso per nuove comunicazioni dei docenti preferiti.
- [ ] Centro notifiche con stato letto/non letto.

Il backend Web Push è già predisposto; resta da completare la gestione delle
preferenze e l'esecuzione periodica dei promemoria autorizzati.

## Priorità 3: Calendario e agenda unificata

- [ ] Pulsante “Aggiungi al calendario” per lezioni, esami e scadenze.
- [ ] Export `.ics` compatibile con Google Calendar, Outlook e Apple Calendar.
- [ ] Vista giornaliera e settimanale con filtri per tipo di evento.
- [ ] Segnalazione delle sovrapposizioni tra lezioni ed esami.
- [ ] Aggiunta degli orari di ricevimento dei docenti al calendario.

## Priorità 4: Modalità offline e sincronizzazione

- [ ] Cache dell'ultimo bootstrap, dell'agenda e della carriera.
- [ ] Banner “Ultimo aggiornamento” con data e ora.
- [ ] Stato offline/online chiaro e pulsante per riprovare.
- [ ] Utilizzo dell'ultima versione disponibile senza mostrare dati inventati.

## Priorità 5: Carriera, tasse e prenotazioni

- [ ] CFU mancanti e avanzamento per anno di corso.
- [ ] Simulatore della media e della base di laurea.
- [ ] Export della carriera in CSV o PDF.
- [ ] Timeline delle rate con totale pagato e da pagare.
- [ ] Promemoria e stato aggiornato delle prenotazioni.
- [ ] Ricevuta scaricabile per le prenotazioni, quando fornita dal portale.

## Priorità 6: Docenti e ricerca

- [ ] Docenti preferiti con feed degli avvisi.
- [ ] Ricerca unificata per docenti, corsi, materiali e avvisi.
- [ ] Filtri rapidi e ricerche recenti.
- [ ] Orari di ricevimento con aula, note e aggiunta al calendario.

## Migliorie successive

- [ ] Mappa di edifici e aule con collegamento alla navigazione.
- [ ] Accessibilità avanzata: caratteri ridimensionabili, focus tastiera,
  contrasto, riduzione delle animazioni e messaggi di errore più chiari.
- [ ] Migrazione della cache persistente a una soluzione adatta alla produzione.
- [ ] Valutazione di schermate Flutter native, se il wrapper WebView non sarà
  più sufficiente.

## Ordine consigliato quando si riprende il lavoro

1. Home **Oggi**.
2. Preferenze notifiche e promemoria.
3. Calendario esportabile.
4. Rilevamento conflitti nell'agenda.
5. Modalità offline.
6. Carriera e tasse avanzate.
7. Ricerca e Docenti preferiti.

Prima di pubblicare nuove funzioni, eseguire sempre `npm run check`, `npm run
lint` nella cartella `frontend` e `npm run build` nella stessa cartella.
