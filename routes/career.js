// routes/career.js
const express = require('express');
const router = express.Router();
const { getDatiCarriera } = require('../scraper/segrepass');
const snapshots = require('../services/career-snapshots');
const slowSync = require('../services/slow-sync');

/**
 * GET /api/career/slow-data
 * Stato e risultato del caricamento in background di tasse e appelli.
 * Risposta nel formato SlowData del frontend:
 *   { status: 'idle' | 'loading' | 'ready' | 'error', error?, updatedAt?, taxes?, prenotazioni? }
 */
router.get('/slow-data', (req, res) => {
  const profileId = req.user.sub;
  const codiceFiscale = req.user.codiceFiscale || profileId;
  const { password } = req.user;

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

  // Senza password (token vecchio) non si può avviare lo scraping.
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

// Endpoint legacy: scraping rapido con credenziali nel body.
router.post('/', async (req, res) => {
  const { username, codiceFiscale, password } = req.body;
  const user = codiceFiscale || username;

  if (!user || !password) {
    return res.status(400).json({ success: false, error: 'CREDENTIALS_REQUIRED' });
  }

  try {
    // Phase 'fast': estrae anagrafica, libretto esami e PIN
    const data = await getDatiCarriera(
      { codiceFiscale: user, password },
      { phase: 'fast' }
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.code || 'CAREER_ERROR',
      message: error.message
    });
  }
});

module.exports = router;
