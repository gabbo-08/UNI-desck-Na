# Gate di rilascio legale, privacy e sicurezza

Questo documento è una checklist operativa. Non è un parere legale e non certifica
la conformità. Prima della pubblicazione con utenti reali, il titolare deve far
verificare il servizio da un professionista privacy/legale e, quando applicabile,
dal DPO/RPD dell'organizzazione.

## Regola di go/no-go

La pubblicazione pubblica è **GO** solo quando ogni voce marcata `BLOCCANTE` ha
un responsabile, una prova salvata e una data di riesame. Se manca una prova,
lo stato resta `NO-GO` o `BETA PRIVATA`.

## 1. Identità e responsabilità — BLOCCANTE

- [ ] Sono indicati il titolare del trattamento, indirizzo, contatto privacy e,
  se previsto, DPO/RPD.
- [ ] Sono identificati hosting, database, e-mail, push, analytics, crash
  reporting e ogni altro responsabile/sub-responsabile.
- [ ] Per ogni fornitore esiste un accordo conforme all'art. 28 GDPR o la base
  giuridica contrattuale corretta.
- [ ] Sono documentati eventuali trasferimenti fuori SEE, garanzie applicate e
  paesi coinvolti.
- [ ] Le informazioni pubblicate in `/privacy` e `/terms` corrispondono al
  trattamento realmente attivo; non restano segnaposto o testi dimostrativi.

## 2. Trattamenti e diritti — BLOCCANTE

- [ ] Per ogni dato sono definiti finalità, base giuridica, minimizzazione,
  destinatari e tempi di conservazione.
- [ ] Login istituzionale, segnalazioni, Web Push e notifiche Android hanno
  consenso/opt-in separati quando il consenso è la base applicabile.
- [ ] Revoca del consenso, cancellazione profilo, export, rettifica e richieste
  privacy hanno un flusso testato e un referente operativo.
- [ ] È stata completata una valutazione documentata del rischio e una DPIA
  quando richiesta o prudenziale per larga scala, monitoraggio, dati accademici
  o nuove tecnologie.
- [ ] Esiste una procedura per data breach: rilevazione, registro dell'evento,
  valutazione del rischio, comunicazioni e notifica al Garante entro i termini
  applicabili.

## 3. Autorizzazione del servizio universitario — BLOCCANTE

- [ ] Esiste autorizzazione scritta a usare il portale, le integrazioni e i
  materiali collegati.
- [ ] Sono stati verificati termini d'uso, robot policy, rate limit, copyright,
  licenze dei PDF/immagini e uso dei marchi.
- [ ] È presente un inventario delle licenze open source e dei contenuti di
  terzi; gli avvisi richiesti sono distribuiti con il prodotto.
- [ ] Il servizio dichiara chiaramente l'indipendenza dall'università se non è
  ufficiale; non usa loghi, nomi o colori che possano creare affiliazione senza
  autorizzazione.
- [ ] Il nome, dominio, icona e package ID sono stati controllati rispetto a
  marchi e servizi preesistenti.

## 4. Sicurezza tecnica — BLOCCANTE

- [ ] `npm audit` è stato eseguito sul lockfile di rilascio; ogni vulnerabilità
  è stata risolta o accettata per iscritto con rischio, mitigazione e scadenza.
- [ ] Sono stati eseguiti secret scan, test di autenticazione/autorizzazione,
  CSRF, rate limit, logging e gestione degli errori senza dati personali.
- [ ] HTTPS, cookie `HttpOnly/Secure/SameSite`, CSP, backup cifrati, rotazione
  delle chiavi e ripristino da backup sono stati verificati in produzione.
- [ ] Le chiavi VAPID e Firebase restano nel secret manager; non vengono
  committati `google-services.json`, `firebase_options.dart`, token, cookie,
  password o backup.
- [ ] Il monitoraggio ha alert, contatto reperibile, rollback e piano di
  disattivazione immediata del servizio.

## 5. Qualità e capacità — BLOCCANTE per un lancio pubblico

- [ ] Backend, frontend e worker sono stati testati con le variabili reali di
  staging; sono disponibili log e report della build.
- [ ] Sono stati eseguiti smoke test, E2E browser su un browser installato,
  test mobile, accessibilità di base e test di restore.
- [ ] Il carico atteso è stato provato. SQLite e un singolo processo non sono
  una prova di capacità per 50.000 studenti: servono architettura, database,
  code, rate limit e scaling coerenti con il carico reale.
- [ ] Web Push è attivo solo con HTTPS, VAPID validi, consenso esplicito,
  revoca e pulizia delle subscription 404/410.
- [ ] L'APK FCM è considerato pronto solo dopo progetto Firebase reale,
  configurazione Flutter, registrazione token autenticata, build e test su
  dispositivo fisico.
- [ ] Per eventuali store sono pronti URL privacy pubblici, modulo Data Safety,
  dichiarazioni sulle autorizzazioni, classificazione contenuti e procedura di
  cancellazione dell'account coerenti con il comportamento reale dell'app.
- [ ] Sono stati verificati tastiera, contrasto, dimensioni del testo, focus,
  lettori di schermo e reflow sui dispositivi supportati; gli eventuali obblighi
  di accessibilità sono stati valutati in base al soggetto che pubblica il
  servizio e al pubblico servito.

## 6. Procedura di pubblicazione consigliata

1. Congelare il commit di release e creare un backup verificato.
2. Pubblicare in staging con dominio separato e dati sintetici.
3. Far eseguire la revisione privacy/legale e ottenere approvazione scritta.
4. Invitare un gruppo ristretto di tester autorizzati, con canale di supporto.
5. Correggere i blocchi, ripetere i test e registrare le evidenze.
6. Pubblicare con rollout graduale, monitoraggio e rollback pronto.
7. Riesaminare privacy, subfornitori, dipendenze e retention a ogni modifica
   significativa e con cadenza almeno annuale.

## Stato noto del repository alla data del controllo

- I test backend risultano passati: 206/206, inclusi i test di configurazione
  runtime e ciclo di vita Web Push.
- Lint frontend passato senza warning; build Next.js 16.4.6
  superata usando un backend HTTPS di staging.
- L'audit delle dipendenze di produzione è a zero vulnerabilità per backend e
  frontend; l'audit completo del frontend mantiene advisory solo su tool di
  sviluppo e va riesaminato prima di ogni build CI.
- La suite E2E visuale è stata eseguita: 5/5 test passati con Chromium
  Playwright; `playwright.config.js` imposta automaticamente
  `NEXT_ALLOWED_DEV_ORIGINS=127.0.0.1,localhost` per rendere il controllo
  riproducibile anche in CI.
- La consegna FCM dell'APK richiede ancora progetto Firebase, configurazione
  Flutter, registrazione token e build verificata.
- Il worker/cron per l'invio automatico delle scadenze deve essere protetto,
  autenticato, deduplicato e verificato; l'endpoint di test non lo sostituisce.
- Le segnalazioni tecniche sono persistite in `SupportReports` con descrizione
  cifrata; il canale operativo opzionale è `GET /api/support-admin/reports`,
  protetto da `SUPPORT_ADMIN_TOKEN`. Email e ticketing restano da configurare.
- La PWA usa un service worker limitato a shell e asset statici; le risposte API
  personali non vengono memorizzate offline.

## Riferimenti ufficiali

- [Garante Privacy — principi fondamentali del trattamento](https://www.garanteprivacy.it/it/web/guest/home/principi-fondamentali-del-trattamento)
- [Garante Privacy — DPIA](https://www.garanteprivacy.it/it/valutazione-d-impatto-della-protezione-dei-dati-dpia-)
- [Garante Privacy — data breach](https://www.garanteprivacy.it/data-breach)
- [EUIPO — valutazione globale del rischio di confusione tra marchi](https://guidelines.euipo.europa.eu/2319054/1983183/trade-mark-guidelines/1-introduction)
