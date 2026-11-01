// Credenziali Segrepass tenute solo in memoria, per la durata della sessione.
// Non vengono mai inserite nel token né restituite al client.
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const credentials = new Map();
const portalCookies = new Map();

function setCredentials(profileId, { username, password } = {}, ttlMs = DEFAULT_TTL_MS) {
  if (!profileId || !username || !password) return false;
  credentials.set(profileId, { username, password, expiresAt: Date.now() + ttlMs });
  return true;
}

function getCredentials(profileId) {
  const entry = credentials.get(profileId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    credentials.delete(profileId);
    return null;
  }
  return { username: entry.username, password: entry.password };
}

function deleteCredentials(profileId) {
  credentials.delete(profileId);
}

function clearCredentials() {
  credentials.clear();
}

function setPortalCookies(profileId, cookies, ttlMs = DEFAULT_TTL_MS) {
  if (!profileId || !Array.isArray(cookies) || cookies.length === 0) return false;
  portalCookies.set(String(profileId), {
    cookies: cookies.map(cookie => ({ ...cookie })),
    expiresAt: Date.now() + ttlMs
  });
  return true;
}

function getPortalCookies(profileId) {
  const entry = portalCookies.get(String(profileId));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    portalCookies.delete(String(profileId));
    return null;
  }
  return entry.cookies.map(cookie => ({ ...cookie }));
}

function deletePortalCookies(profileId) {
  portalCookies.delete(String(profileId));
}

function clearPortalCookies() {
  portalCookies.clear();
}

module.exports = {
  setCredentials,
  getCredentials,
  deleteCredentials,
  clearCredentials,
  setPortalCookies,
  getPortalCookies,
  deletePortalCookies,
  clearPortalCookies
};
