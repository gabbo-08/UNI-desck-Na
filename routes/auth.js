const express = require('express');
const { createStudentSession } = require('../services/student-session');
const { authMiddleware, extractToken } = require('../middleware/auth');
const { getStudentProfile, updateStudentProfile, getDocentiDataCache, getProfessorPreferences, getBookingReceipts } = require('../db/repository');
const { readProfilePrefsCookie, writeProfilePrefsCookie } = require('../lib/profile-cookie');
const { db } = require('../db');
const { sessionErrorStatus, sessionErrorMessage } = require('../lib/errors');
const { setAuthCookie, clearAuthCookie } = require('../lib/cookies');
const { deleteServerSession, deleteServerSessionsForProfile, resolveServerSession, getSessionCredentials } = require('../services/server-sessions');
const { toLoginDto, toSessionDto } = require('../lib/dto');
const { clearProfileRuntime } = require('../services/profile-lifecycle');
const { deleteStudentData } = require('../db/repository');
const { safeErrorMeta } = require('../lib/safe-log');
const snapshots = require('../services/career-snapshots');
const { getSlowStatus } = require('../services/slow-sync');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const session = await createStudentSession(req.body || {});
    setAuthCookie(res, session.token);
    return res.json(toLoginDto(session));
  } catch (error) {
    console.error('[Auth Error]', safeErrorMeta(error));
    if (error.retryAfterMs) res.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
    return res.status(sessionErrorStatus(error)).json({ error: sessionErrorMessage(error) });
  }
});

router.get('/session', authMiddleware, (req, res) => {
  const profile = getStudentProfile(db, req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
  return res.json(toSessionDto(profile));
});

function parsePersonalJson(value) {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

router.get('/bootstrap', authMiddleware, (req, res) => {
  const profile = getStudentProfile(db, req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
  const persistedCareer = parsePersonalJson(profile.carriera_json) || [];
  const persistedTaxes = parsePersonalJson(profile.tasse_json);
  const persistedPrenotazioni = parsePersonalJson(profile.prenotazioni_json) || [];
  const career = snapshots.getCareerSnapshot(req.user.sub) || persistedCareer;
  const slow = snapshots.getSlowSnapshot(req.user.sub);
  const taxes = slow?.taxes ?? persistedTaxes;
  const prenotazioni = slow?.prenotazioni ?? persistedPrenotazioni;
  const docentiCache = getDocentiDataCache(req.user.sub);
  // L'opt-in Docenti è memorizzato cifrato nella sessione server-side.  Dopo
  // un reload il frontend deve poter ripristinare lo stato della sezione,
  // anche quando il riepilogo è ancora in aggiornamento e quindi la cache è
  // temporaneamente vuota.
  const sessionCredentials = getSessionCredentials(req.authSession?.tokenHash) || {};
  const docentiEnabled = sessionCredentials.enableDocentiSync === true;
  return res.json({
    authenticated: true,
    profile: toSessionDto(profile).profile,
    onboardingRequired: toSessionDto(profile).onboardingRequired,
    metriche: {
      anagrafica: {
        matricola: profile.matricola || null,
        corsoDiLaurea: profile.course_name || null,
        codiceCorso: profile.course_id || null,
        annoCorso: profile.current_course_year || null,
        annoImmatricolazione: profile.cohort_year || null
      },
      esami: Array.isArray(career) ? career : [],
      tasse: taxes,
      prenotazioni: Array.isArray(prenotazioni) ? prenotazioni : []
    },
    sync: {
      slow: getSlowStatus(req.user.sub),
      docenti: {
        enabled: docentiEnabled,
        available: Boolean(docentiCache),
        fetchedAt: docentiCache?.fetchedAt || null,
        stale: Boolean(docentiCache && Date.now() - docentiCache.fetchedAt > 5 * 60 * 1000)
      },
      // Anche i dati cifrati nel profilo sono una cache valida: dopo un
      // riavvio non forzare uno scraping che potrebbe sostituire il riepilogo
      // disponibile con un errore temporaneo del portale.
      fromCache: Boolean(snapshots.getCareerSnapshot(req.user.sub) || docentiCache || persistedCareer.length || persistedTaxes || persistedPrenotazioni.length)
    }
  });
});

router.get('/export', authMiddleware, (req, res) => {
  const profile = getStudentProfile(db, req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
  const docentiCache = getDocentiDataCache(req.user.sub);
  const payload = {
    exportedAt: new Date().toISOString(),
    profile: toSessionDto(profile).profile,
    career: parsePersonalJson(profile.carriera_json) || [],
    taxes: parsePersonalJson(profile.tasse_json),
    prenotazioni: parsePersonalJson(profile.prenotazioni_json) || [],
    preferences: getProfessorPreferences(req.user.sub),
    bookingReceipts: getBookingReceipts(req.user.sub),
    docenti: docentiCache?.data || null
  };
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', 'attachment; filename="segrepass-export.json"');
  return res.json(payload);
});

router.post('/logout', (req, res) => {
  const token = extractToken(req);
  const session = token ? resolveServerSession(token) : null;
  if (token) deleteServerSession(token);
  if (session?.profileId) clearProfileRuntime(session.profileId);
  clearAuthCookie(res);
  return res.status(204).send();
});

router.post('/logout-all', authMiddleware, (req, res) => {
  deleteServerSessionsForProfile(req.user.sub);
  clearProfileRuntime(req.user.sub);
  clearAuthCookie(res);
  return res.status(204).send();
});

router.delete('/account', authMiddleware, (req, res) => {
  deleteStudentData(req.user.sub, db);
  clearProfileRuntime(req.user.sub);
  clearAuthCookie(res);
  return res.status(204).send();
});

module.exports = router;
