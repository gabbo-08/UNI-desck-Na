// lib/cookies.js
const COOKIE_NAME = 'segrepass_token';
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
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_MS
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearAuthCookie(res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

function readAuthToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

module.exports = { COOKIE_NAME, setAuthCookie, clearAuthCookie, readAuthToken, parseCookies };
