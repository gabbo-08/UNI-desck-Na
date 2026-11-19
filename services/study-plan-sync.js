const { db: defaultDb } = require('../db');
const { getStudentProfile, upsertStudentProfile, normalizeName } = require('../db/repository');
const { getSessionCredentials } = require('./server-sessions');
const { getDatiCarriera } = require('../scraper/segrepass');
const snapshots = require('./career-snapshots');
const { getPersistedPiano } = require('./study-plan-service');
const { safeErrorMeta } = require('../lib/safe-log');

const RETRY_COOLDOWN_MS = 60_000;
const stores = new WeakMap();

function storeFor(database) {
  if (!stores.has(database)) stores.set(database, new Map());
  return stores.get(database);
}

function sameProfile(left, right) {
  return Boolean(left && right && String(left.course_id) === String(right.course_id) && Number(left.cohort_year) === Number(right.cohort_year));
}

function matchesUpstream(profile, anagrafica = {}) {
  const upstreamCourse = String(anagrafica.codiceCorso || '').trim().toUpperCase();
  const expectedCourse = String(profile.course_id || '').trim().toUpperCase();
  if (upstreamCourse && upstreamCourse !== expectedCourse) {
    const expectedName = normalizeName(profile.course_name || '');
    const upstreamName = normalizeName(anagrafica.corsoDiLaurea || '');
    // Aliases (for example DE3/N46) can identify the same course. A matching
    // explicit name is required before accepting different identifiers.
    if (!expectedName || !upstreamName || expectedName !== upstreamName) return false;
  }
  return true;
}

async function recoverPersonalStudyPlan({ profile, tokenHash, database = defaultDb }, dependencies = {}) {
  const credentialsFor = dependencies.getSessionCredentials || ((hash) => getSessionCredentials(hash, { database }));
  const credentials = credentialsFor(tokenHash);
  if (!credentials?.password) return { refreshed: false, reason: 'SESSION_CREDENTIALS_REQUIRED' };
  const profileId = profile.id;
  const key = `${profileId}\0${profile.course_id}\0${profile.cohort_year}\0${tokenHash}`;
  const store = storeFor(database);
  // Drop expired entries so the retry state cannot grow with every session.
  const now = Date.now();
  for (const [candidate, entry] of store) {
    if (!entry.promise && now - entry.finishedAt >= RETRY_COOLDOWN_MS) store.delete(candidate);
  }
  const previous = store.get(key);
  if (previous?.promise) return previous.promise;
  if (previous && now - previous.finishedAt < RETRY_COOLDOWN_MS) {
    return { refreshed: false, reason: previous.reason, retryAfterMs: RETRY_COOLDOWN_MS - (now - previous.finishedAt) };
  }

  const entry = { promise: null, finishedAt: 0, reason: null };
  const scraper = dependencies.getDatiCarriera || getDatiCarriera;
  entry.promise = Promise.resolve().then(() => scraper(credentials, { phase: 'fast' })).then(data => {
    const current = getStudentProfile(database, profileId);
    if (!sameProfile(profile, current) || !credentialsFor(tokenHash)) {
      return { refreshed: false, reason: 'STUDY_PLAN_CONTEXT_CHANGED' };
    }
    if (!matchesUpstream(profile, data?.anagrafica)) {
      return { refreshed: false, reason: 'STUDY_PLAN_PROFILE_MISMATCH' };
    }
    const courses = data?.pianoDiStudiRaw;
    if (!Array.isArray(courses) || !courses.length) {
      return { refreshed: false, reason: data?.studyPlanSync?.reason || 'STUDY_PLAN_NOT_READ' };
    }
    // Only the personal plan is updated. A generic manifesto is never inferred
    // from an individual's results, curriculum or elective choices.
    const updated = upsertStudentProfile(database, {
      id: profileId,
      courseId: profile.course_id,
      cohortYear: profile.cohort_year,
      pianoDiStudiRaw: courses
    });
    snapshots.setPianoSnapshot(profileId, getPersistedPiano(updated) || []);
    return { refreshed: true, reason: null };
  }).catch(error => {
    console.warn('[study-plan] Recupero personale non riuscito:', safeErrorMeta(error));
    return { refreshed: false, reason: 'STUDY_PLAN_UPSTREAM_ERROR' };
  }).then(result => {
    entry.finishedAt = Date.now();
    entry.reason = result.reason;
    return { ...result, retryAfterMs: RETRY_COOLDOWN_MS };
  }).finally(() => { entry.promise = null; });
  store.set(key, entry);
  return entry.promise;
}

module.exports = { recoverPersonalStudyPlan, RETRY_COOLDOWN_MS };
