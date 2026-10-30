// Cache breve per i dati del portale Docenti: evita di riaprire un browser
// a ogni chiamata del frontend (dashboard + annunci + iscrizioni + appelli).
const crypto = require('node:crypto');
const { getDocentiSnapshot, isDocentiLoading } = require('./career-snapshots');
const { JWT_SECRET } = require('../lib/config');

const TTL_MS = 5 * 60 * 1000;
// Il login avvia l'acquisizione in background: le richieste che arrivano nel
// frattempo attendono lo stesso job invece di avviare altri browser.
const LOADING_WAIT_MS = 60000;
const LOADING_POLL_MS = 500;
const cache = new Map();
const inFlight = new Map();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function credentialFingerprint(credentials) {
  if (!credentials) return '';
  const username = credentials.username || credentials.codiceFiscale || '';
  const password = credentials.password || '';
  if (!username && !password) return '';
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${username}\u0000${password}`)
    .digest('hex')
    .slice(0, 16);
}

function cacheKey(profileId, credentials) {
  const fingerprint = credentialFingerprint(credentials);
  return fingerprint ? `${profileId}:${fingerprint}` : String(profileId);
}

async function waitForBackground(profileId) {
  const deadline = Date.now() + LOADING_WAIT_MS;
  while (Date.now() < deadline) {
    const snapshot = getDocentiSnapshot(profileId);
    if (snapshot) return snapshot;
    if (!isDocentiLoading(profileId)) return null;
    await delay(LOADING_POLL_MS);
  }
  return getDocentiSnapshot(profileId);
}

function normalizeArgs(profileId, second, third, fourth) {
  if (typeof second === 'function') {
    return { credentials: fourth || third || null, loader: second };
  }
  return { credentials: second || null, loader: third };
}

async function getDocentiCached(profileId, second, third, fourth) {
  const { credentials, loader } = normalizeArgs(profileId, second, third, fourth);
  const key = cacheKey(profileId, credentials);

  const entry = cache.get(key);
  if (entry && Date.now() - entry.storedAt < TTL_MS) return entry.value;

  // Il login carica già i dati in background: se ci sono, usali subito.
  const background = getDocentiSnapshot(profileId);
  if (background) {
    cache.set(key, { value: background, storedAt: Date.now() });
    return background;
  }

  if (isDocentiLoading(profileId)) {
    const loaded = await waitForBackground(profileId);
    if (loaded) {
      cache.set(key, { value: loaded, storedAt: Date.now() });
      return loaded;
    }
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const task = Promise.resolve()
    .then(loader)
    .then(value => {
      cache.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, task);
  return task;
}

function clearDocentiCache(profileId) {
  if (profileId) {
    const prefix = String(profileId);
    for (const key of [...cache.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}:`)) cache.delete(key);
    }
    for (const key of [...inFlight.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}:`)) inFlight.delete(key);
    }
  } else {
    cache.clear();
    inFlight.clear();
  }
}

module.exports = { getDocentiCached, clearDocentiCache, TTL_MS, cacheKey };
