const { readAuthToken } = require('../lib/cookies');
const { resolveServerSession } = require('../services/server-sessions');

function extractToken(req) {
  return readAuthToken(req);
}

function authMiddleware(req, res, next) {
  const token = extractToken(req);
  const session = token ? resolveServerSession(token) : null;
  if (!session) {
    return res.status(401).json({ error: 'Sessione assente o scaduta. Effettua nuovamente il login.', code: 'SESSION_EXPIRED' });
  }

  // req.user è un DTO identificativo; le credenziali si decifrano solo nei
  // servizi che ne hanno bisogno, tramite req.authSession.
  req.user = { sub: session.profileId };
  req.authSession = session;
  return next();
}

module.exports = { authMiddleware, extractToken };
