const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function normalizeOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins(env = process.env) {
  return String(env.FRONTEND_URL || '')
    .split(',')
    .map(value => normalizeOrigin(value.trim()))
    .filter(Boolean);
}

function allowedOrigins(req, env = process.env) {
  const origins = new Set([...DEFAULT_ORIGINS, ...configuredOrigins(env)]);

  // X-Forwarded-Host è attendibile solo se il proxy è dichiarato esplicitamente.
  const trustProxy = env.TRUST_PROXY && !['0', 'false', 'off'].includes(String(env.TRUST_PROXY).toLowerCase());
  const forwardedHost = trustProxy ? req.headers['x-forwarded-host'] : null;
  const host = forwardedHost || req.headers.host;
  const protocol = String(req.protocol || 'http').split(',')[0].trim();
  const sameOrigin = normalizeOrigin(`${protocol}://${host}`);
  if (sameOrigin) origins.add(sameOrigin);

  return origins;
}

function requestOrigin(req) {
  // Origin è la fonte affidabile; Referer è il fallback per i browser che lo omettono.
  return normalizeOrigin(req.headers.origin) || normalizeOrigin(req.headers.referer);
}

/**
 * Protezione CSRF per le richieste mutanti autenticate tramite cookie.
 * - I metodi safe non sono interessati.
 * - Le richieste con Bearer esplicito sono immuni al CSRF (l'header non è
 *   impostabile da una pagina di terze parti senza preflight CORS).
 * - Tutte le altre richieste mutanti devono avere Origin o Referer consentiti.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const authorization = req.headers.authorization || '';
  if (/^Bearer\s+\S+/i.test(authorization)) return next();

  const origin = requestOrigin(req);
  if (!origin) {
    return res.status(403).json({
      code: 'CSRF_ORIGIN_REQUIRED',
      error: 'Richiesta bloccata: manca l’intestazione Origin o Referer.'
    });
  }

  if (!allowedOrigins(req).has(origin)) {
    return res.status(403).json({
      code: 'CSRF_ORIGIN_INVALID',
      error: 'Origine della richiesta non consentita.'
    });
  }

  return next();
}

module.exports = {
  csrfProtection,
  normalizeOrigin,
  allowedOrigins,
  requestOrigin,
  configuredOrigins,
  DEFAULT_ORIGINS,
  SAFE_METHODS
};
