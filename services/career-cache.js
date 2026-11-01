const crypto = require('node:crypto');
const { JWT_SECRET } = require('../lib/config');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const CACHE_VERSION = 'career-v3';
const cache = new Map();
const inFlight = new Map();

function ttlMs() {
  const configured = Number(process.env.CAREER_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_TTL_MS;
}

/**
 * Chiave per studente + credenziale. Della password resta solo un HMAC:
 * una password errata non può quindi riutilizzare i dati in cache.
 */
function cacheKey(profileId, password) {
  const fingerprint = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(String(password || ''))
    .digest('hex');
  return `${CACHE_VERSION}:${profileId}:${fingerprint}`;
}

function prune(now = Date.now()) {
  const ttl = ttlMs();
  for (const [key, entry] of cache) {
    if (now - entry.storedAt > ttl) cache.delete(key);
  }
}

function getCachedCareer(profileId, password, now = Date.now()) {
  const ttl = ttlMs();
  if (ttl <= 0) return null;

  const key = cacheKey(profileId, password);
  const entry = cache.get(key);
  if (!entry) return null;
  if (now - entry.storedAt > ttl) {
    cache.delete(key);
    return null;
  }
  return { value: entry.value, storedAt: entry.storedAt };
}

function setCachedCareer(profileId, password, value, now = Date.now()) {
  if (ttlMs() <= 0) return;
  const key = cacheKey(profileId, password);
  cache.set(key, { value, storedAt: now, profileId });
  prune(now);
}

/**
 * Restituisce i dati di carriera dalla cache oppure esegue il loader una sola
 * volta, anche se arrivano più login contemporanei per lo stesso studente.
 */
async function getOrLoadCareer(profileId, password, loader) {
  const cached = getCachedCareer(profileId, password);
  if (cached) return { value: cached.value, fromCache: true };

  const key = cacheKey(profileId, password);
  if (inFlight.has(key)) {
    return { value: await inFlight.get(key), fromCache: false, shared: true };
  }

  const task = Promise.resolve()
    .then(loader)
    .then(value => {
      setCachedCareer(profileId, password, value);
      return value;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return { value: await task, fromCache: false };
}

function clearCareerCache(profileId) {
  if (!profileId) {
    cache.clear();
    inFlight.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(`:${profileId}:`)) cache.delete(key);
  }
}

module.exports = { getCachedCareer, setCachedCareer, getOrLoadCareer, clearCareerCache };
