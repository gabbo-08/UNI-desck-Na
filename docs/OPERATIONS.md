# UniDesk NA: operazioni di produzione

Questa guida raccoglie i controlli minimi per gestire il servizio. Non sostituisce una revisione infrastrutturale o legale prima di un uso pubblico.

## Readiness

- `/health` misura la liveness del processo.
- `/ready` e `/readiness` rispondono `200` solo dopo l’inizializzazione del database e del cluster Puppeteer.
- Il container usa `/ready` nel proprio `HEALTHCHECK`.

## Segreti

- Generare `CRED_KEY` casualmente per ogni ambiente e non committare `.env`.
- Conservare la chiave in un secret manager del provider.
- Una rotazione richiede una procedura di migrazione: i dati cifrati già presenti non sono leggibili con una chiave nuova senza una fase di re-encryption controllata.
- Non stampare credenziali, token, cookie o payload personali nei log.

## Backup SQLite

Fermare il processo o usare il backup online SQLite del proprio provider; copiare anche i file `-wal` e `-shm` quando presenti. Il backup deve essere cifrato, con accesso limitato e retention definita. Testare periodicamente un restore in un ambiente isolato prima di considerarlo valido.

## Deploy

- Terminare TLS su un reverse proxy fidato e impostare `COOKIE_SECURE=true`.
- Configurare `FRONTEND_URL`, `PUBLIC_ORIGIN` e `TRUST_PROXY` con valori espliciti.
- Pubblicare il frontend dietro HTTPS e mantenere il backend non esposto direttamente a Internet quando possibile.
- Eseguire `npm run check`, il lint/build del frontend e una smoke test su `/health` e `/ready` dopo ogni release.
- Usare metriche e alert per errori 5xx, latenza, cache, ricollegamenti Docenti e disponibilità dei portali esterni.

## Scala

Il supporto a 50.000 studenti richiede un test di carico realistico, un database e una coda condivisi, rate limit distribuiti, osservabilità e un piano di autoscaling. Il server locale e SQLite non dimostrano da soli questa capacità.

## Segnalazioni di supporto

- Il form autenticato invia `POST /api/support/report`.
- Le segnalazioni vengono conservate nella tabella SQLite `SupportReports`; la descrizione è cifrata con `CRED_KEY`.
- Il canale operativo `GET /api/support-admin/reports` è disabilitato senza `SUPPORT_ADMIN_TOKEN` e restituisce solo dati decifrati lato server.
- La cancellazione del profilo e la retention eliminano le segnalazioni collegate.

## Notifiche push

- Mantieni `PUSH_VAPID_SUBJECT`, `PUSH_VAPID_PUBLIC_KEY` e `PUSH_VAPID_PRIVATE_KEY` nel secret manager del provider; non stamparli nei log e non inserirli nel frontend.
- Dopo ogni deploy controlla che `GET /api/notifications/vapid-public-key` risponda `200` solo con una sessione autenticata e `503 PUSH_NOT_CONFIGURED` quando il canale non e configurato.
- Esegui il test esplicito dalla dashboard con **Invia notifica di test** dopo aver dato il consenso. Non inviare messaggi automatici finche il worker/cron protetto non e stato validato.
- Monitora solo conteggi aggregati di invii, errori e subscription rimosse; elimina gli endpoint che restituiscono `404` o `410`.
- Per FCM Android conserva la configurazione Firebase nell'ambiente di build e associa i token a un endpoint autenticato prima di attivare un worker di invio.

