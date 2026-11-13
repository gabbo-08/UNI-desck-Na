// Cookie del portale Docenti usati dai servizi backend, distinti dalla sessione app.
// Non vengono mai inserite nel token né restituite al client.
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const portalCookies = new Map();

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
  setPortalCookies,
  getPortalCookies,
  deletePortalCookies,
  clearPortalCookies
};
