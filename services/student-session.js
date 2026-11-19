// services/student-session.js
const { getDatiCarriera } = require('../scraper/segrepass');
const { getDocentiData, resolveCodiceFiscaleFromDocenti } = require('../scraper/docenti');
const { buildStudentProfile } = require('./profile-extractor');
const snapshots = require('./career-snapshots');
const careerCache = require('./career-cache');
const slowSync = require('./slow-sync');
const { clearDocentiCache, sanitizeDocentiSnapshot, SNAPSHOT_VERSION: DOCENTI_SNAPSHOT_VERSION, TTL_MS: DOCENTI_CACHE_TTL_MS } = require('./docenti-cache');
const dbModule = require('../db');
const { upsertStudentProfile, getStudentProfile, getProfileAnagrafica, getStudyPlan, getDocentiDataCache, saveDocentiDataCache } = require('../db/repository');
const { clearDocentiRouteCache } = require('../routes/docenti');
const { createServerSession } = require('./server-sessions');
const { assertLoginAllowed, recordLoginFailure, recordLoginSuccess } = require('../lib/login-throttle');
const { sessionErrorStatus } = require('../lib/errors');
const { safeErrorMeta, safeProfileRef } = require('../lib/safe-log');
const { getPersistedPiano } = require('./study-plan-service');

const db = dbModule.db || dbModule;
const EMPTY_DOCENTI = Object.freeze({ subscriptions: [], bookedExams: [], announcements: [] });

function docentiSyncEnabled(dependencies = {}) {
  if (dependencies.enableDocentiSync === false) return false;
  return dependencies.enableDocentiSync === true
    || dependencies.docentiCredentials !== undefined
    || String(process.env.DOCENTI_SYNC_ENABLED || '').toLowerCase() === 'true'
    || process.env.NODE_ENV === 'test';
}

function hasProfileSetup(profile) {
  const course = profile?.course_id || profile?.courseId;
  const cohort = profile?.cohort_year || profile?.cohortYear;
  return Boolean(course && cohort);
}

function listPlansForCohort(cohortYear, database = db) {
  if (!cohortYear) return [];
  for (const columns of ['course_id, course_code, course_name', 'course_id, course_name']) {
    try {
      return database.prepare(`SELECT ${columns} FROM StudyPlans WHERE cohort_year = ?`).all(cohortYear);
    } catch {}
  }
  return [];
}

function docentiCredentials(dependencies = {}) {
  return dependencies.docentiCredentials || {};
}

function loadDocentiInBackground(profileId, dependencies = {}) {
  if (snapshots.isDocentiLoading(profileId)) return Promise.resolve();

  if (!docentiSyncEnabled(dependencies)) {
    snapshots.setDocentiSnapshot(profileId, { available: false, reason: 'DOCENTI_SYNC_DISABLED', ...EMPTY_DOCENTI });
    return Promise.resolve();
  }

  const credentials = docentiCredentials(dependencies);
  const database = dependencies.database || db;
  const persisted = getDocentiDataCache(profileId, database);
  if (persisted && Date.now() - persisted.fetchedAt < DOCENTI_CACHE_TTL_MS) {
    const sanitized = sanitizeDocentiSnapshot(persisted.data);
    if (sanitized.available && persisted.data._cacheVersion !== DOCENTI_SNAPSHOT_VERSION) {
      try { saveDocentiDataCache(profileId, sanitized, database, new Date(persisted.fetchedAt)); } catch {}
    }
    if (sanitized.available) {
      snapshots.setDocentiSnapshot(profileId, sanitized);
      return Promise.resolve(sanitized);
    }
  }

  if (!credentials.username || !credentials.password) {
    snapshots.setDocentiSnapshot(profileId, {
      available: false,
      reason: 'DOCENTI_CREDENTIALS_REQUIRED',
      ...EMPTY_DOCENTI
    });
    return Promise.resolve();
  }

  const scraper = dependencies.getDocentiData || getDocentiData;
  const generation = snapshots.markDocentiLoading(profileId);

  return Promise.resolve()
    .then(() => scraper({ ...credentials, profileKey: profileId }))
    .then(data => {
      if (snapshots.isCurrentDocentiLoad(profileId, generation)) {
        const sanitized = data?.available === false ? data : sanitizeDocentiSnapshot(data);
        if (sanitized?.available !== false) {
          try {
            saveDocentiDataCache(profileId, sanitized, database);
          } catch (error) {
            console.warn('[docenti-cache] Snapshot persistente non aggiornato:', safeErrorMeta(error));
          }
          clearDocentiCache(profileId);
        }
        snapshots.setDocentiSnapshot(profileId, sanitized);
      }
    })
    .catch(error => {
      if (!snapshots.isCurrentDocentiLoad(profileId, generation)) return;
      console.warn(`[docenti] Acquisizione per ${safeProfileRef(profileId)} non riuscita:`, safeErrorMeta(error));
      const previous = snapshots.getDocentiSnapshot(profileId);
      if (previous?.available) {
        snapshots.setDocentiSnapshot(profileId, {
          ...previous,
          stale: true,
          lastError: error?.code || 'DOCENTI_SCRAPE_FAILED'
        });
      } else {
        snapshots.setDocentiSnapshot(profileId, {
          available: false,
          reason: error?.code || 'DOCENTI_SCRAPE_FAILED',
          ...EMPTY_DOCENTI
        });
      }
    })
    .finally(() => snapshots.clearDocentiLoading(profileId, generation));
}

function resolveDocentiEmail(profile, profileId) {
  const fromProfile = profile?.email;
  if (typeof fromProfile === 'string' && fromProfile.includes('@')) return fromProfile.trim().toLowerCase();
  if (String(profileId).includes('@')) return String(profileId).trim().toLowerCase();
  return null;
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || /\s/.test(email) || !email.endsWith('@studenti.unina.it')) return null;
  const local = email.slice(0, -'@studenti.unina.it'.length);
  return local.length > 0 && !local.includes('@') ? email : null;
}

function normalizeLoginIdentifier(value) {
  return normalizeEmail(value);
}

async function createStudentSession({ codiceFiscale, password, email, identifier, enableDocentiSync } = {}, dependencies = {}) {
  const cleanEmail = normalizeEmail(email ?? codiceFiscale ?? identifier);
  if (!cleanEmail || typeof password !== 'string' || !password) {
    const error = new Error('Inserisci la tua email istituzionale (@studenti.unina.it) e la password.');
    error.status = 400;
    throw error;
  }

  const database = dependencies.database || db;
  const scraper = dependencies.getDatiCarriera || getDatiCarriera;

  assertLoginAllowed(cleanEmail);

  const cfClean = cleanEmail;

  let careerResult;
  try {
    careerResult = await careerCache.getOrLoadCareer(
      cfClean,
      password,
      () => scraper({ email: cleanEmail, password }, { phase: 'fast' })
    );
  } catch (error) {
    if (sessionErrorStatus(error) === 401) {
      recordLoginFailure(cleanEmail);
    }
    throw error;
  }

  recordLoginSuccess(cleanEmail);
  recordLoginSuccess(cfClean);

  const datiCarriera = careerResult.value;
  const fromCache = careerResult.fromCache;

  const esami = Array.isArray(datiCarriera.esami) ? datiCarriera.esami : [];
  const tasse = datiCarriera.tasse || null;

  const existing = getStudentProfile(database, cfClean);
  const profile = buildStudentProfile(datiCarriera.anagrafica || {}, {
    taxes: tasse,
    existing,
    findPlan: dependencies.findPlan || ((courseId, cohortYear) => getStudyPlan(database, courseId, cohortYear)),
    listPlans: dependencies.listPlans || (cohortYear => listPlansForCohort(cohortYear, database))
  });

  if (profile.courseId && profile.cohortYear && !profile.courseName) {
    const plan = getStudyPlan(database, profile.courseId, profile.cohortYear);
    if (plan?.course_name) profile.courseName = plan.course_name;
  }

  const storedProfile = upsertStudentProfile(database, {
    id: cfClean,
    anagrafica: datiCarriera.anagrafica,
    ...profile,
    email: cleanEmail,
    esamiSostenuti: esami,
    pianoDiStudiRaw: datiCarriera.pianoDiStudiRaw,
    tasse
  });

  snapshots.setCareerSnapshot(cfClean, esami);
  snapshots.setPianoSnapshot(cfClean, getPersistedPiano(storedProfile) || []);
  snapshots.setTaxesSnapshot(cfClean, tasse);
  snapshots.invalidateDocentiSnapshot(cfClean);
  clearDocentiCache(cfClean);
  clearDocentiRouteCache(cfClean);
  slowSync.resetSlowSync(cfClean);

  const ensureSlow = dependencies.ensureSlowSync || slowSync.ensureSlowSync;
  const slowStatus = ensureSlow(cfClean, { codiceFiscale: cfClean, password }, dependencies);

  const docentiEmail = cleanEmail || resolveDocentiEmail(storedProfile || profile, cfClean);

  const docentiDependencies = enableDocentiSync === undefined
    ? dependencies
    : { ...dependencies, enableDocentiSync: enableDocentiSync === true };
  const docentiEnabled = docentiSyncEnabled(docentiDependencies);

  const serverSession = createServerSession(cfClean, {
    codiceFiscale: cfClean,
    email: docentiEmail,
    password,
    enableDocentiSync: docentiEnabled
  }, { database });

  const configuredDocenti = docentiCredentials(dependencies);
  const credentials = dependencies.docentiCredentials
    || (configuredDocenti.username && configuredDocenti.password
      ? configuredDocenti
      : (docentiEmail ? { username: docentiEmail, password } : {}));

  const docentiSnapshot = snapshots.getDocentiSnapshot(cfClean);
  const alreadyLoading = snapshots.isDocentiLoading(cfClean);
  if (docentiEnabled && !docentiSnapshot && !alreadyLoading) {
    loadDocentiInBackground(cfClean, { ...docentiDependencies, docentiCredentials: credentials });
  }

  const docentiLoading = docentiEnabled && !docentiSnapshot && (alreadyLoading || Boolean(credentials.username && credentials.password));
  const docentiReason = docentiSnapshot
    ? (docentiSnapshot.available ? null : docentiSnapshot.reason || 'DOCENTI_SCRAPE_FAILED')
    : (docentiLoading ? null : (docentiEnabled ? 'DOCENTI_CREDENTIALS_REQUIRED' : 'DOCENTI_SYNC_DISABLED'));
  const metriche = {
    ...datiCarriera,
    anagrafica: {
      ...(datiCarriera.anagrafica || {}),
      ...getProfileAnagrafica(storedProfile),
      matricola: datiCarriera.anagrafica?.matricola || storedProfile?.matricola || null
    }
  };

  return {
    token: serverSession.token,
    expiresIn: '7d',
    profileId: cfClean,
    profile: storedProfile || profile,
    onboardingRequired: !hasProfileSetup(storedProfile || profile),
    fromCache,
    slowSync: slowStatus.state,
    docentiLoading,
    docentiReason,
    metriche
  };
}

module.exports = {
  createStudentSession,
  loadDocentiInBackground,
  docentiSyncEnabled,
  listPlansForCohort,
  hasProfileSetup,
  normalizeEmail,
  normalizeLoginIdentifier
};

