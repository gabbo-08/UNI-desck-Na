# Aggiornamento progetto Segrepass

Data: 16 novembre 2026

## Modifiche completate

### Persistenza dati

- Tasse e prenotazioni lente vengono salvate cifrate nel profilo (`prenotazioni_json`) oltre alla cache in memoria.
- Dopo un riavvio del backend, `/api/auth/bootstrap` e `/api/career/slow-data` riutilizzano i dati persistiti invece di mostrare una dashboard vuota.
- Il bootstrap considera validi anche i dati presenti nel database e non forza uno scraping aggiuntivo quando non serve.
- La pulizia automatica della cache browser non viene piu eseguita all'import del modulo; resta attiva su logout e cancellazione account.

### Accesso e primo caricamento

- Il login Segrepass controlla in parallelo navigazione e cambio stato della pagina.
- L'attesa massima del cambio stato e passata a 20 secondi, configurabile con `SEGREPASS_LOGIN_NAV_TIMEOUT_MS`.
- La Home carica prima il riepilogo principale; orario, Docenti e preferenze partono dopo il primo rendering per evitare richieste concorrenti durante l'accesso.
- Il primo caricamento non salta PIN, piano di studi o altri dati: vengono mantenuti nel flusso normale.

### Portale Docenti

- Un 401/403 dopo cold start, quando i cookie del portale non sono piu nella memoria del processo, viene riconosciuto come sessione scaduta.
- Il backend prova automaticamente un nuovo collegamento Docenti prima di restituire errore.
- Il login Docenti riconosce piu varianti dei campi e dei pulsanti del portale.
- Il riepilogo Docenti dalla Home viene avviato dopo circa 1,2 secondi; entrando nella sezione parte subito.

### Tema e notifiche

- Aggiunto il selettore tema nella schermata di accesso.
- Il tema salvato viene applicato prima del rendering per evitare il flash chiaro/scuro.
- La subscription Web Push viene ripristinata e ri-registrata alla riapertura della PWA.
- I messaggi distinguono pagina non HTTPS, backend HTTP, VAPID non configurato e sessione scaduta.

### Cookie e deploy Vercel

- Aggiunta la variabile `COOKIE_SAMESITE` (`lax` predefinito, `none` per frontend e API su domini diversi).
- Configurazione consigliata su Vercel: impostare `BACKEND_URL=https://...` e lasciare vuota `NEXT_PUBLIC_BACKEND_URL`, usando il rewrite `/api` sullo stesso dominio.
- Se si usa un URL API pubblico nel browser, usare `COOKIE_SAMESITE=none` e `COOKIE_SECURE=true`.
- Il backend non deve usare un filesystem serverless effimero: SQLite, sessioni e cache richiedono Persistent Disk o un database gestito.
- Per le notifiche push il backend deve avere `PUSH_VAPID_SUBJECT`, `PUSH_VAPID_PUBLIC_KEY` e `PUSH_VAPID_PRIVATE_KEY`.

## Verifiche eseguite

- Backend: `npm test` -> 207 test superati.
- Frontend: `npm run lint` -> superato.
- Frontend: `NEXT_PUBLIC_BACKEND_URL=https://api.example.test npm run build` -> superato.
- Test mirati Docenti/login: superati, incluso il caso di cold start senza cookie Docenti in memoria.

## Prima del push da casa

1. Controllare `git diff` e `git status`.
2. Verificare le variabili Vercel/backend indicate sopra.
3. Eseguire di nuovo `npm test` nella root.
4. Eseguire `npm run lint` e `npm run build` dentro `frontend` con un backend HTTPS di build.
5. Fare commit e push solo dopo aver verificato che `.env`, database e token Vercel non siano inclusi.

Comandi rapidi:

```powershell
git status
git diff --stat
npm test
Set-Location frontend
npm run lint
$env:NEXT_PUBLIC_BACKEND_URL = 'https://api.example.test'
npm run build
Set-Location ..
git add .
git commit -m "Migliora persistenza accesso Docenti e primo caricamento"
git push
```

