// routes/career.js
const express = require('express');
const router = express.Router();
const snapshots = require('../services/career-snapshots');
const slowSync = require('../services/slow-sync');
const { getDatiCarriera } = require('../scraper/segrepass');
const { submitAppelloAction } = require('../scraper/prenotazioni');
const { getSessionCredentials } = require('../services/server-sessions');

/**
 * GET /api/career/slow-data
 * Stato e risultato del caricamento in background di tasse e appelli.
 * Risposta nel formato SlowData del frontend:
 *   { status: 'idle' | 'loading' | 'ready' | 'error', error?, updatedAt?, taxes?, prenotazioni? }
 */
router.get('/slow-data', (req, res) => {
  const profileId = req.user.sub;
  const credentials = getSessionCredentials(req.authSession.tokenHash);
  const codiceFiscale = credentials?.codiceFiscale || profileId;
  const password = credentials?.password;

  // Dati già pronti: restituiscili subito.
  const snapshot = snapshots.getSlowSnapshot(profileId);
  if (snapshot) {
    return res.json({
      status: 'ready',
      taxes: snapshot.taxes ?? null,
      prenotazioni: Array.isArray(snapshot.prenotazioni) ? snapshot.prenotazioni : [],
      updatedAt: snapshot.updatedAt ?? null
    });
  }

  // Le credenziali decifrate servono solo per avviare lo scraping protetto.
  if (!password) {
    return res.json({ status: 'error', error: 'CREDENTIALS_REQUIRED' });
  }

  // Avvia (o riprende, ad esempio dopo un riavvio del server) il caricamento in background.
  const status = slowSync.ensureSlowSync(profileId, { codiceFiscale, password });

  if (status.state === 'error') {
    return res.json({ status: 'error', error: status.error || 'SLOW_SYNC_FAILED' });
  }
  return res.json({ status: 'loading' });
});

router.post('/book', async (req, res) => {
  const { annopri, numAppello } = req.body || {};
  const profileId = req.user.sub;
  const snapshot = snapshots.getSlowSnapshot(profileId);
  const allowed = (snapshot?.prenotazioni || []).some(item =>
    String(item.annopri || '') === String(annopri || '') &&
    String(item.numAppello || '') === String(numAppello || '') &&
    item.bookingEnabled === true
  );
  if (!allowed) {
    return res.status(400).json({
      success: false,
      code: 'APPELLO_NOT_BOOKABLE',
      error: 'Appello non presente tra quelli prenotabili per questa sessione.'
    });
  }

  try {
    const credentials = getSessionCredentials(req.authSession.tokenHash);
    if (!credentials?.password) return res.status(401).json({ error: 'Sessione non valida.', code: 'SESSION_EXPIRED' });
    await getDatiCarriera(
      { codiceFiscale: credentials.codiceFiscale, password: credentials.password },
      {
        phase: 'fast',
        onEsisReady: ({ page, esisUrl }) => submitAppelloAction(
          page,
          new URL(esisUrl).origin,
          { annopri, numAppello }
        )
      }
    );
    return res.json({ success: true, message: 'Prenotazione effettuata.' });
  } catch (error) {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code || 'APPELLO_BOOKING_FAILED',
      error: error.message || 'Prenotazione non riuscita.'
    });
  }
});

module.exports = router;
