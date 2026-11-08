const express = require('express');
const { createStudentSession } = require('../services/student-session');
const { authMiddleware, extractToken } = require('../middleware/auth');
const { getStudentProfile } = require('../db/repository');
const { db } = require('../db');
const { sessionErrorStatus, sessionErrorMessage } = require('../lib/errors');
const { setAuthCookie, clearAuthCookie } = require('../lib/cookies');
const { deleteServerSession } = require('../services/server-sessions');
const { toLoginDto, toSessionDto } = require('../lib/dto');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const session = await createStudentSession(req.body || {});
    setAuthCookie(res, session.token);
    return res.json(toLoginDto(session));
  } catch (error) {
    console.error('[Auth Error]', error.message);
    if (error.retryAfterMs) res.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
    return res.status(sessionErrorStatus(error)).json({ error: sessionErrorMessage(error) });
  }
});

router.get('/session', authMiddleware, (req, res) => {
  const profile = getStudentProfile(db, req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
  return res.json(toSessionDto(profile));
});

router.post('/logout', (req, res) => {
  const token = extractToken(req);
  if (token) deleteServerSession(token);
  clearAuthCookie(res);
  return res.status(204).send();
});

module.exports = router;
