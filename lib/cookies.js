// lib/cookies.js
const COOKIE_NAME = 'segrepass_session';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(header = '') {
  const entries = String(header)
    .split(';')
    .map(part => {
      const separator = part.indexOf('=');
      if (separator === -1) return null;
      const name = part.slice(0, separator).trim();
      if (!name) return null;
      try {
        return [name, decodeURIComponent(part.slice(separator + 1).trim())];
      } catch {
        return [name, part.slice(separator + 1).trim()];
      }
    })
    .filter(Boolean);

  return Object.fromEntries(entries);
}

function cookieOptions() {
  const configuredSameSite = String(process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  const sameSite = ['strict', 'lax', 'none'].includes(configuredSameSite) ? configuredSameSite : 'lax';
  return {
    httpOnly: true,
    // Vercel frontend + backend on another domain needs SameSite=None. Keep
    // Lax as the safe local/default mode and make the cross-site choice
    // explicit in production configuration.
    sameSite,
    secure: String(process.env.COOKIE_SECURE || (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase() === 'true',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS
  };
}

function setAuthCookie(res, token, options = {}) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), ...options });
}

function clearAuthCookie(res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

function readAuthToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

module.exports = { COOKIE_NAME, setAuthCookie, clearAuthCookie, readAuthToken, parseCookies };
