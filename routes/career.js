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

  // Dopo un riavvio il risultato lento può essere ancora solo nel profilo
  // cifrato. Restituiscilo subito mentre un eventuale refresh può proseguire.
  const persistedProfile = getStudentProfile(profileId);
  let persistedPrenotazioni = [];
  try {
    const parsed = JSON.parse(persistedProfile?.prenotazioni_json || '[]');
    if (Array.isArray(parsed)) persistedPrenotazioni = parsed;
  } catch {}
  if (persistedPrenotazioni.length || persistedProfile?.tasse_json) {
    let persistedTaxes = null;
    try { persistedTaxes = JSON.parse(persistedProfile?.tasse_json || 'null'); } catch {}
    if (password) {
      // Restituisci subito il dato persistito e aggiorna in background senza
      // lasciare la dashboard vuota dopo il riavvio del processo.
      slowSync.ensureSlowSync(profileId, { codiceFiscale, password });
    }
    return res.json({
      status: 'ready',
      taxes: persistedTaxes,
      prenotazioni: persistedPrenotazioni,
      updatedAt: persistedProfile?.updated_at ? Date.parse(persistedProfile.updated_at) || null : null,
      fromPersistence: true
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
