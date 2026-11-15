# UniDesk NA

Client web indipendente e non ufficiale per studenti. L'applicazione raccoglie dati dal proprio account e li presenta in una dashboard locale; non rappresenta, non è affiliata e non è approvata dall'Università degli Studi di Napoli Federico II.

## Avvio locale

```bash
npm install
npm run dev
```

Configura `NEXT_PUBLIC_BACKEND_URL` in `.env.local` se il backend non è esposto sulla stessa origine. Per una build di verifica:

```bash
npm run lint
npm run build
```

Il logo `public/logo_prova.jpg` viene usato senza alterazioni cromatiche. I contenuti visualizzati sono indicativi: per autenticazione, pagamenti, scadenze e comunicazioni fa sempre fede il portale ufficiale.

## Funzionalità aggiornate

- Ricerca globale di esami, appelli, corsi e docenti.
- Scadenziario personale e pianificatore esami.
- Simulatore carriera per voto e CFU.
- Stato dei servizi, modalità privacy e materiali Docenti preferiti/recenti.
- Layout adattivo per smartphone, tablet e desktop.
- Pagine pubbliche `/privacy` e `/terms` e invio di segnalazioni cifrate al backend tramite `POST /api/support/report`. Le segnalazioni vengono registrate nel database del backend; il frontend non invia email e non offre una console amministrativa.

## Sicurezza

Il frontend non salva password, token o dati personali in `localStorage`. Le chiamate usano cookie `HttpOnly` gestiti dal backend; per deploy pubblici usa sempre HTTPS, configura `NEXT_PUBLIC_BACKEND_URL` su un'origine HTTPS e verifica il disclaimer indipendente prima della pubblicazione.
