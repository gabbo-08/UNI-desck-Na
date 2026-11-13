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
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const origins = new Set([...(production ? [] : DEFAULT_ORIGINS), ...configuredOrigins(env)]);
  const publicOrigin = normalizeOrigin(env.PUBLIC_ORIGIN);
  if (publicOrigin) origins.add(publicOrigin);

  // Express applica i forwarded headers solo secondo TRUST_PROXY.
  const host = req.hostname || req.headers.host;
  const protocol = String(req.protocol || 'http').split(',')[0].trim();
  const sameOrigin = normalizeOrigin(`${protocol}://${host}`);
  if (sameOrigin && (String(env.NODE_ENV || '').toLowerCase() !== 'production' || String(env.ALLOW_DYNAMIC_ORIGIN || '').toLowerCase() === 'true')) {
    origins.add(sameOrigin);
  }

  return origins;
}

function requestOrigin(req) {
  // Origin è la fonte affidabile; Referer è il fallback per i browser che lo omettono.
  return normalizeOrigin(req.headers.origin) || normalizeOrigin(req.headers.referer);
}

/**
 * Protezione CSRF per le richieste mutanti autenticate tramite cookie.
 * - I metodi safe non sono interessati.
 * - Tutte le richieste mutanti devono avere Origin o Referer consentiti.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

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
