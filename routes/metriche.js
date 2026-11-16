// routes/metriche.js
// GET /api/metriche -> dati di carriera (anagrafica, esami, medie, CFU) per l'utente autenticato.
// Serve al frontend dopo una ricarica pagina: la sessione opaca resta nel cookie HttpOnly.
const express = require('express');
const { getDatiCarriera } = require('../scraper/segrepass');
const careerCache = require('../services/career-cache');
const snapshots = require('../services/career-snapshots');
const { sessionErrorMessage } = require('../lib/errors');
const { getSessionCredentials } = require('../services/server-sessions');

const router = express.Router();

router.get('/', async (req, res) => {
  const profileId = req.user.sub;
  const credentials = getSessionCredentials(req.authSession.tokenHash);
  const codiceFiscale = credentials?.codiceFiscale || profileId;
  const password = credentials?.password;

  // Una sessione priva delle credenziali cifrate non può avviare lo scraping.
  if (!password) {
    return res.status(401).json({ error: 'Sessione non più valida: accedi di nuovo.' });
  }

  try {
    // Il pulsante Aggiorna deve poter ritentare anche un PIN non estratto al
    // login, altrimenti la cache di carriera conserverebbe il dato incompleto.
    if (req.query.refresh === '1') careerCache.clearCareerCache(profileId);
    const { value } = await careerCache.getOrLoadCareer(
      profileId,
      password,
      () => getDatiCarriera({ codiceFiscale, password }, { phase: 'fast' })
    );

    // Se i dati lenti (tasse, appelli) sono già pronti li uniamo subito.
    const slow = snapshots.getSlowSnapshot(profileId);
    const profile = require('../db/repository').getStudentProfile(req.user.sub);
    let persistedPrenotazioni = [];
    try {
      const parsed = JSON.parse(profile?.prenotazioni_json || '[]');
      if (Array.isArray(parsed)) persistedPrenotazioni = parsed;
    } catch {}
    return res.json({
      ...value,
      anagrafica: {
        ...(value?.anagrafica || {}),
        matricola: value?.anagrafica?.matricola || profile?.matricola || null
      },
      tasse: slow?.taxes ?? value?.tasse ?? null,
      prenotazioni: slow?.prenotazioni ?? value?.prenotazioni ?? persistedPrenotazioni
    });
  } catch (error) {
    console.error('[Metriche Error]', error.message);
    // 502 (non 401/403): un errore del portale non deve azzerare la sessione.
    return res.status(502).json({ error: sessionErrorMessage(error) });
  }
});

module.exports = router;
