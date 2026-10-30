// Credenziali Segrepass tenute solo in memoria, per la durata della sessione.
// Non vengono mai inserite nel token né restituite al client.
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const credentials = new Map();

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

module.exports = { setCredentials, getCredentials, deleteCredentials, clearCredentials };
