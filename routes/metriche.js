// routes/metriche.js
// GET /api/metriche -> dati di carriera (anagrafica, esami, medie, CFU) per l'utente autenticato.
// Serve al frontend dopo una ricarica pagina: al login i dati arrivano nella risposta di /api/auth/login,
// ma con restoreSession() il frontend ha solo il token e li richiede qui.
const express = require('express');
const { getDatiCarriera } = require('../scraper/segrepass');
const careerCache = require('../services/career-cache');
const snapshots = require('../services/career-snapshots');
const { sessionErrorMessage } = require('../lib/errors');

const router = express.Router();

router.get('/', async (req, res) => {
  const profileId = req.user.sub;
  const codiceFiscale = req.user.codiceFiscale || profileId;
  const { password } = req.user;

  // Token vecchio, senza password cifrata: serve un nuovo login.
  // 401 => il frontend mostra "Sessione scaduta" e rimanda al form di accesso.
  if (!password) {
    return res.status(401).json({ error: 'Sessione non più valida: accedi di nuovo.' });
  }

  try {
    const { value } = await careerCache.getOrLoadCareer(
      profileId,
      password,
      () => getDatiCarriera({ codiceFiscale, password }, { phase: 'fast' })
    );

    // Se i dati lenti (tasse, appelli) sono già pronti li uniamo subito.
    const slow = snapshots.getSlowSnapshot(profileId);
    return res.json({
      ...value,
      tasse: slow?.taxes ?? value?.tasse ?? null,
      prenotazioni: slow?.prenotazioni ?? value?.prenotazioni ?? []
    });
  } catch (error) {
    console.error('[Metriche Error]', error.message);
    // 502 (non 401/403): un errore del portale non deve azzerare la sessione.
    return res.status(502).json({ error: sessionErrorMessage(error) });
  }
});

module.exports = router;
