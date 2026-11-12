// Cache breve per i dati del portale Docenti: evita di riaprire un browser
// a ogni chiamata del frontend (dashboard + annunci + iscrizioni + appelli).
const crypto = require('node:crypto');
const { getDocentiSnapshot, isDocentiLoading } = require('./career-snapshots');
const { deriveKey } = require('../lib/secret-box');
const { getDocentiDataCache, saveDocentiDataCache } = require('../db/repository');
const { isUsableSubscription } = require('../scraper/docenti');
const { safeErrorMeta } = require('../lib/safe-log');

const TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_VERSION = 2;
const cache = new Map();
const inFlight = new Map();

function credentialFingerprint(credentials) {
  if (!credentials) return '';
  const username = credentials.username || credentials.codiceFiscale || '';
  const password = credentials.password || '';
  if (!username && !password) return '';
  return crypto
    .createHmac('sha256', deriveKey('docenti-cache'))
    .update(`${username}\u0000${password}`)
    .digest('hex')
    .slice(0, 16);
}

function cacheKey(profileId, credentials) {
  const fingerprint = credentialFingerprint(credentials);
  return fingerprint ? `${profileId}:${fingerprint}` : String(profileId);
}

function normalizedKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('it').replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

function sanitizeDocentiSnapshot(data) {
  const subscriptions = (Array.isArray(data?.subscriptions) ? data.subscriptions : []).filter(isUsableSubscription);
  const teacherIds = new Set(subscriptions.map(item => String(item.professorId || '')).filter(Boolean));
  const teacherNames = new Set(subscriptions.map(item => normalizedKey(item.professor)).filter(Boolean));
  const courseNames = new Set(subscriptions.map(item => normalizedKey(item.courseName)).filter(Boolean));
  const announcements = (Array.isArray(data?.announcements) ? data.announcements : []).filter(group => {
    if (group?.slug && teacherIds.has(String(group.slug))) return true;
    return Boolean(group?.professor && teacherNames.has(normalizedKey(group.professor)));
  });
  const groups = (Array.isArray(data?.groups) ? data.groups : []).filter(group =>
    group?.name && courseNames.has(normalizedKey(group.courseName))
  );
  const tests = (Array.isArray(data?.tests) ? data.tests : []).filter(test =>
    test?.name && test?.courseName && courseNames.has(normalizedKey(test.courseName))
  );
  const bookedExams = (Array.isArray(data?.bookedExams) ? data.bookedExams : []).filter(exam => {
    const course = String(exam?.courseName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleUpperCase('it').replace(/[^A-Z0-9]+/g, ' ').trim();
    return course.length >= 4 && !/^(?:ESAME|INSEGNAMENTO|MATERIA|NON SPECIFICATO|NON INDICATO)$/.test(course) &&
      Boolean(exam.examDate || exam.bookingDate || exam.courseCode);
  });
  const available = Boolean(data?.available !== false && (subscriptions.length || announcements.length || groups.length || tests.length || bookedExams.length));
  return {
    ...data,
    available,
    ...(available ? {} : { reason: data?.reason || 'DOCENTI_DATA_NOT_FOUND' }),
    subscriptions,
    announcements,
    groups,
    tests,
    bookedExams,
    _cacheVersion: SNAPSHOT_VERSION
  };
}

function normalizeArgs(profileId, second, third, fourth) {
  if (typeof second === 'function') {
    return { credentials: fourth || third || null, loader: second };
  }
  return { credentials: second || null, loader: third };
}

function startLoad(key, profileId, loader) {
  if (inFlight.has(key)) return inFlight.get(key);
  const task = Promise.resolve()
    .then(loader)
    .then(value => {
      if (inFlight.get(key) === task && value && value.available !== false) {
        const sanitized = sanitizeDocentiSnapshot(value);
        try { saveDocentiDataCache(profileId, sanitized); } catch (error) {
          console.warn('[docenti-cache] Snapshot persistente non aggiornato:', safeErrorMeta(error));
        }
        cache.set(key, { value: sanitized, storedAt: Date.now() });
        return sanitized;
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    });
  inFlight.set(key, task);
  return task;
}

async function getDocentiCached(profileId, second, third, fourth) {
  const { credentials, loader } = normalizeArgs(profileId, second, third, fourth);
  const key = cacheKey(profileId, credentials);

  const entry = cache.get(key);
  if (entry && Date.now() - entry.storedAt < TTL_MS) return entry.value;

  // Snapshot persistente: rispondi subito anche dopo il riavvio del server.
  // Se è scaduto, restituiscilo comunque e aggiorna in background.
  const persisted = getDocentiDataCache(profileId);
  if (persisted) {
    const sanitized = sanitizeDocentiSnapshot(persisted.data);
    if (persisted.data._cacheVersion !== SNAPSHOT_VERSION) {
      try { saveDocentiDataCache(profileId, sanitized, undefined, new Date(persisted.fetchedAt)); } catch {}
    }
    if (!sanitized.available) {
      if (!isDocentiLoading(profileId)) void startLoad(key, profileId, loader).catch(() => {});
      return { available: true, loading: true, subscriptions: [], bookedExams: [], groups: [], tests: [], announcements: [] };
    }
    cache.set(key, { value: sanitized, storedAt: persisted.fetchedAt });
    if (Date.now() - persisted.fetchedAt >= TTL_MS && !isDocentiLoading(profileId)) {
      void startLoad(key, profileId, loader).catch(() => {});
    }
    return sanitized;
  }

  // Il login carica già i dati in background: se ci sono, usali subito.
  const background = getDocentiSnapshot(profileId);
  // Uno snapshot con errore non è un risultato valido a vita: riusa eventuali
  // risultati, ma consenti un nuovo tentativo quando il portale torna online.
  if (background && background.available !== false) {
    cache.set(key, { value: background, storedAt: Date.now() });
    return background;
  }
  if (background?.available === false) return background;

  if (isDocentiLoading(profileId)) {
    // Primo accesso senza snapshot: la UI mostra il caricamento e interroga
    // questo endpoint finché il job del login non completa, senza bloccare 60s.
    return { available: true, loading: true, subscriptions: [], bookedExams: [], groups: [], tests: [], announcements: [] };
  }

  return startLoad(key, profileId, loader);
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

function isDocentiCacheLoading(profileId, credentials) {
  return inFlight.has(cacheKey(profileId, credentials));
}

module.exports = { getDocentiCached, clearDocentiCache, isDocentiCacheLoading, sanitizeDocentiSnapshot, SNAPSHOT_VERSION, TTL_MS, cacheKey };
