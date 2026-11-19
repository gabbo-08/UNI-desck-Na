# Collegamenti ai servizi ufficiali nella Home

Nella sezione **Servizi ufficiali** della Home sono presenti automaticamente:

- [Segrepass](https://www.segrepass1.unina.it/Welcome.do): carriera, tasse e prenotazione degli esami.
- [Docenti](https://www.docenti.unina.it/): avvisi, materiali didattici e ricevimenti.
- [EasyAcademy](https://easyacademy.unina.it/agendastudenti/index.php?view=easycourse&_lang=it&include=corso): orari delle lezioni e aule.

I collegamenti aprono una nuova scheda. Non occorre configurare una variabile d'ambiente per visualizzarli; la configurazione opzionale esistente può aggiungere altri servizi.

Le grafiche sono originali dei portali e sono conservate localmente in `frontend/public/services/`. Il [registro delle fonti](frontend/public/services/SOURCES.md) contiene gli URL degli asset. I loghi bianchi di Docenti ed EasyAcademy hanno un fondo blu leggibile anche in modalità chiara. Logo e palette di UniDesk NA sono conservati.

Verifiche: lint e build frontend superati; suite browser **15/15** superata. I due test dedicati controllano desktop chiaro, mobile scuro, caricamento delle immagini, contrasto delle icone bianche, destinazioni e apertura effettiva in una nuova scheda. Dopo l'ultima regolazione grafica, i due test dedicati sono stati ripetuti con esito positivo.

Anteprime locali: [desktop](.kombai/service-links/servizi-desktop.png) e [mobile](.kombai/service-links/servizi-mobile.png). Le anteprime e i log sono esclusi da Git.

File applicativo modificato: `frontend/src/components/OfficialServicesPanel.tsx`. Non sono necessarie modifiche al backend o al database. Per vedere i collegamenti sul servizio online occorre pubblicare il frontend aggiornato.
