// services/timetable-service.js
// Cache dell'orario con scadenza di alcune ore e deduplica delle richieste in corso.
// Lo scraping di EasyAcademy è lento: più richieste simultanee (Home + sezione Orario)
// devono produrre un solo scraping.

const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;
const CACHE_VERSION = 2;
const cache = new Map();    // chiave -> { value, storedAt }
const inFlight = new Map(); // chiave -> Promise<{ value, storedAt }>

function ttlMs() {
  const configured = Number(process.env.TIMETABLE_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_TTL_MS;
}

function keyOf(filters) {
  return JSON.stringify([
    CACHE_VERSION,
    filters.courseId, filters.courseName, filters.studyYear, filters.semester,
    filters.academicYear, filters.channel, filters.surnameInitial
  ].map(value => (value === null || value === undefined ? null : String(value).trim().toLowerCase())));
}

/**
 * @param {object} filters  - output di buildTimetableFilters
 * @param {object} options  - { fetcher, force, now }; fetcher di default = provider EasyAcademy
 * @returns {Promise<{ value, fromCache, cachedAt }>}
 */
async function getTimetableCached(filters, options = {}) {
  const fetcher = options.fetcher || require('./easyacademy-provider').getTimetable;
  const force = Boolean(options.force);
  const now = options.now ?? Date.now();
  const ttl = ttlMs();
  const key = keyOf(filters);

  if (!force && ttl > 0) {
    const hit = cache.get(key);
    if (hit && now - hit.storedAt < ttl) {
      return { value: hit.value, fromCache: true, cachedAt: hit.storedAt };
    }
  }

  if (inFlight.has(key)) {
    const entry = await inFlight.get(key);
    return { value: entry.value, fromCache: false, cachedAt: entry.storedAt };
  }

  const task = Promise.resolve()
    .then(() => fetcher(filters, { force }))
    .then(value => {
      const entry = { value, storedAt: now };
      if (ttl > 0 && inFlight.get(key) === task) cache.set(key, entry);
      return entry;
    })
    .finally(() => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    });

  inFlight.set(key, task);
  const entry = await task;
  return { value: entry.value, fromCache: false, cachedAt: entry.storedAt };
}

function clearTimetableServiceCache() {
  cache.clear();
  inFlight.clear();
}

module.exports = { getTimetableCached, keyOf, clearTimetableServiceCache, DEFAULT_TTL_MS };
