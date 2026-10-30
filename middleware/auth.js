// middleware/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../lib/config');
const { readAuthToken } = require('../lib/cookies');
const { open } = require('../lib/secret-box');

function extractToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  // Il token persistente vive in un cookie httpOnly, non in localStorage.
  return readAuthToken(req) || req.headers['x-session-token'] || null;
}

function authMiddleware(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Accesso negato: token di sessione mancante.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const profileId = payload.sub || payload.codiceFiscale;
    if (!profileId) {
      return res.status(401).json({ error: 'Sessione non valida: profilo assente.' });
    }

    req.user = {
      sub: payload.sub || payload.codiceFiscale,
      codiceFiscale: payload.codiceFiscale || payload.sub,
      email: payload.email || undefined,
      // La password viaggia cifrata nel JWT (campo "pw"): qui viene decifrata.
      password: payload.pw ? open(payload.pw) || undefined : undefined
    };
    return next();
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Sessione scaduta. Effettua nuovamente il login.' : 'Sessione non valida.'
    });
  }
}

module.exports = { authMiddleware };
