// routes/career.js
const express = require('express');
const router = express.Router();
const snapshots = require('../services/career-snapshots');
const slowSync = require('../services/slow-sync');
const { getDatiCarriera } = require('../scraper/segrepass');
const { submitAppelloAction } = require('../scraper/prenotazioni');
const { getSessionCredentials } = require('../services/server-sessions');
const { safeErrorMeta } = require('../lib/safe-log');
const crypto = require('node:crypto');
const { saveBookingReceipt, getLatestBookingReceipt } = require('../db/repository');
const { getStudentProfile } = require('../db/repository');
const bookingInFlight = new Map();
const bookingDone = new Map();
const BOOKING_RECEIPT_TTL_MS = 10 * 60 * 1000;

/**
 * GET /api/career/slow-data
 * Stato e risultato del caricamento in background di tasse e appelli.
 * Risposta nel formato SlowData del frontend:
 *   { status: 'idle' | 'loading' | 'ready' | 'partial' | 'error', sections,
 *     retryAfterMs, error?, updatedAt?, taxes?, prenotazioni? }
 */
router.get('/slow-data', (req, res) => {
  const profileId = req.user.sub;
  const credentials = getSessionCredentials(req.authSession.tokenHash);
  const password = credentials?.password;
  const persistedProfile = getStudentProfile(profileId);
  let taxes = null;
  let prenotazioni = null;
  try { taxes = JSON.parse(persistedProfile?.tasse_json || 'null'); } catch {}
  try {
    const parsed = JSON.parse(persistedProfile?.prenotazioni_json || 'null');
    if (Array.isArray(parsed)) prenotazioni = parsed;
  } catch {}
  if (taxes?.available === false) taxes = null;
  const persisted = taxes || prenotazioni ? {
    taxes, prenotazioni: prenotazioni || [],
    sections: {
      taxes: { status: taxes ? 'ready' : 'error', stale: Boolean(taxes) },
      appelli: { status: prenotazioni ? 'ready' : 'error', stale: Boolean(prenotazioni) }
    },
    updatedAt: persistedProfile?.updated_at ? Date.parse(persistedProfile.updated_at) || null : null
  } : null;
  const force = req.query.refresh === '1';
  const status = password
    ? slowSync.ensureSlowSync(profileId, {
      codiceFiscale: credentials.codiceFiscale || profileId, password
    }, { force, initialSnapshot: persisted })
    : { state: 'error', error: 'CREDENTIALS_REQUIRED', sections: {
      taxes: { status: 'error', error: 'CREDENTIALS_REQUIRED', stale: Boolean(taxes) },
      appelli: { status: 'error', error: 'CREDENTIALS_REQUIRED', stale: Boolean(prenotazioni) }
    } };
  const snapshot = snapshots.getSlowSnapshot(profileId) || persisted;
  return res.json({
    status: status.state,
    sections: status.sections || snapshot?.sections,
    ...(status.error ? { error: status.error } : {}),
    retryAfterMs: status.retryAfterMs || 0,
    taxes: snapshot?.taxes ?? null,
    prenotazioni: Array.isArray(snapshot?.prenotazioni) ? snapshot.prenotazioni : [],
    updatedAt: snapshot?.updatedAt ?? null,
    ...(snapshot === persisted && persisted ? { fromPersistence: true } : {})
  });
});
router.post('/book', async (req, res) => {
  const { annopri, numAppello } = req.body || {};
  const profileId = req.user.sub;
  if (typeof annopri !== 'string' || typeof numAppello !== 'string' || annopri.length > 80 || numAppello.length > 80) {
    return res.status(400).json({ success: false, code: 'INVALID_BOOKING_TARGET', error: 'Appello non valido.' });
  }
  const bookingKey = `${profileId}:${annopri}:${numAppello}`;
  const persistedReceipt = getLatestBookingReceipt(profileId, annopri, numAppello);
  if (persistedReceipt && persistedReceipt.status === 'submitted') {
    return res.json({ success: true, message: 'Prenotazione già inviata.', receipt: persistedReceipt, alreadySubmitted: true });
  }
  const previous = bookingDone.get(bookingKey);
  if (previous && previous > Date.now()) {
    return res.json({ success: true, message: 'Prenotazione già inviata.' });
  }
  if (bookingInFlight.has(bookingKey)) {
    return res.status(409).json({ success: false, code: 'BOOKING_IN_PROGRESS', error: 'Prenotazione già in corso.' });
  }
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

  bookingInFlight.set(bookingKey, true);
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
    bookingDone.set(bookingKey, Date.now() + BOOKING_RECEIPT_TTL_MS);
    const receipt = saveBookingReceipt(profileId, {
      id: crypto.randomUUID(),
      annopri,
      numAppello,
      status: 'submitted',
      message: 'Prenotazione effettuata.',
      createdAt: new Date().toISOString()
    });
    return res.json({ success: true, message: 'Prenotazione effettuata.', receipt });
  } catch (error) {
    return res.status(error.status || 502).json({
      success: false,
      code: error.code || 'APPELLO_BOOKING_FAILED',
      error: 'Prenotazione non riuscita.'
    });
  } finally {
    bookingInFlight.delete(bookingKey);
    const now = Date.now();
    for (const [key, expiresAt] of bookingDone) if (expiresAt <= now) bookingDone.delete(key);
  }
});

module.exports = router;
