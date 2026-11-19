# Documentazione degli aggiornamenti

Questa cartella raccoglie le spiegazioni delle modifiche recenti, delle nuove funzioni e delle attività ancora necessarie prima della pubblicazione.

## Documenti

- [Collegamenti ai servizi ufficiali nella Home](../../AGGIORNAMENTO_SERVIZI_HOME_2026-11-19.md)
- [Recupero piano di studi, tasse e appelli](../../AGGIORNAMENTO_PIANO_TASSE_APPELLI_2026-11-19.md)
- [Report correzione bug del 19 novembre 2026](../../REPORT_BUG_2026-11-19.md)
- [Aggiornamento del 16 novembre 2026](../../AGGIORNAMENTO_2026-11-16.md)
- [Notifiche Web Push e APK Android](PUSH_NOTIFICHE.md)

## Stato generale

- Le funzionalità presenti nel repository sono verificate localmente con test backend e build frontend.
- Il Web Push della PWA è predisposto per funzionare dopo configurazione VAPID e consenso dell'utente.
- L'APK contiene il percorso Firebase Cloud Messaging, ma richiede un progetto Firebase reale e i file generati da FlutterFire.
- L'invio automatico delle scadenze richiede un worker o cron protetto del provider.
- Le segnalazioni inviate da `POST /api/support/report` vengono conservate cifrate nella tabella SQLite `SupportReports`; non vengono inoltrate via email o notifica. La lettura usa il canale protetto `GET /api/support-admin/reports` quando `SUPPORT_ADMIN_TOKEN` è configurato.
- La PWA registra il service worker in produzione, conserva solo asset statici e mostra un banner offline senza memorizzare risposte API personali.
- La dashboard carica le sezioni pesanti on demand e riusa il bootstrap quando la cache è fresca.
- Nessuna password, chiave privata, token o file Firebase reale deve essere salvato nel repository.

## Percorso operativo

Per installazione e deploy usa:

- [Deploy senza PC acceso](../DEPLOYMENT.md)
- [Salvataggio sicuro su GitHub](../GITHUB_SALVATAGGIO_CASA.md)
- [Operazioni di produzione](../OPERATIONS.md)
