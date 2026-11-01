// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { createStudentSession } = require('../services/student-session');
const { authMiddleware } = require('../middleware/auth');
const { getStudentProfile } = require('../db/repository');
const { db } = require('../db');
const { sessionErrorStatus, sessionErrorMessage } = require('../lib/errors');
const { setAuthCookie, clearAuthCookie } = require('../lib/cookies');
const { JWT_SECRET, JWT_TTL } = require('../lib/config');
const { seal } = require('../lib/secret-box');

const router = express.Router();

function isConfigured(profile) {
  return Boolean(
    profile?.course_id && profile?.course_name && profile?.cohort_year &&
    profile?.current_course_year && (profile?.channel || profile?.surname_initial)
  );
}

router.post('/login', async (req, res) => {
  try {
    const session = await createStudentSession(req.body || {});
    // Il token viene anche salvato in un cookie httpOnly, così non serve
    // conservarlo in localStorage. Il campo `token` resta per l'uso in memoria.
    setAuthCookie(res, session.token);
    return res.json(session);
  } catch (error) {
    console.error('[Auth Error]', error.message);
    return res.status(sessionErrorStatus(error)).json({ error: sessionErrorMessage(error) });
  }
});

router.get('/session', authMiddleware, (req, res) => {
  const profile = getStudentProfile(db, req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });

  // Il token rigenerato deve conservare email e password cifrata,
  // altrimenti dopo ogni ricarica pagina le rotte Docenti perdono le credenziali.
  const token = jwt.sign(
    {
      sub: req.user.sub,
      codiceFiscale: req.user.codiceFiscale,
      email: req.user.email,
      pw: req.user.password ? seal(req.user.password) : undefined
    },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
  setAuthCookie(res, token);

  return res.json({
    token,
    profile,
    onboardingRequired: !isConfigured(profile)
  });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  return res.status(204).send();
});

module.exports = router;