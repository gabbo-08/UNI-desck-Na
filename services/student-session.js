
// services/student-session.js
const { getDatiCarriera } = require('../scraper/segrepass');
const { getDocentiData } = require('../scraper/docenti');
const { buildStudentProfile } = require('./profile-extractor');
const snapshots = require('./career-snapshots');
const careerCache = require('./career-cache');
const slowSync = require('./slow-sync');
const { clearDocentiCache, sanitizeDocentiSnapshot, SNAPSHOT_VERSION: DOCENTI_SNAPSHOT_VERSION, TTL_MS: DOCENTI_CACHE_TTL_MS } = require('./docenti-cache');
const dbModule = require('../db');
const { upsertStudentProfile, getStudentProfile, getStudyPlan, getDocentiDataCache, saveDocentiDataCache } = require('../db/repository');
const { clearDocentiRouteCache } = require('../routes/docenti');
const { createServerSession } = require('./server-sessions');
const { assertLoginAllowed, recordLoginFailure, recordLoginSuccess } = require('../lib/login-throttle');
const { sessionErrorStatus } = require('../lib/errors');
const { safeErrorMeta, safeProfileRef } = require('../lib/safe-log');

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
  // Nessun fallback globale: in produzione non esistono credenziali Docenti
  // condivise. I servizi possono ancora ricevere credenziali esplicite per
  // test o integrazioni, ma il default resta vuoto.
  return dependencies.docentiCredentials || {};
}

function loadDocentiInBackground(profileId, dependencies = {}) {
  // Un solo job per studente: due login ravvicinati non devono aprire due
  // sessioni sullo stesso account (il portale invaliderebbe la prima).
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
      // Un refresh fallito non deve cancellare dati Docenti già validi:
      // manteniamo lo snapshot utilizzabile e lasciamo al client lo stato
      // stale, così bootstrap/polling non scollegano l'integrazione.
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

/**
 * Email da usare per il portale Docenti: quella del profilo, oppure l'id
 * stesso se l'utente ha fatto login con l'email istituzionale.
 */
function resolveDocentiEmail(profile, profileId) {
  const fromProfile = profile?.email;
  if (typeof fromProfile === 'string' && fromProfile.includes('@')) return fromProfile.trim().toLowerCase();
  if (String(profileId).includes('@')) return String(profileId).trim().toLowerCase();
  return null;
}

/**
 * Accetta solo email ben formate (es. nome.cognome@studenti.unina.it).
 */
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^\s@]+@studenti\.unina\.it$/.test(email) ? email : null;
}

function normalizeLoginIdentifier(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalizeEmail(normalized)) return normalized.toLowerCase();
  const codiceFiscale = normalized.toUpperCase();
  return /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(codiceFiscale)
    ? codiceFiscale
    : null;
}

async function createStudentSession({ codiceFiscale, password, email, enableDocentiSync } = {}, dependencies = {}) {
  const normalizedIdentifier = normalizeLoginIdentifier(codiceFiscale);
  if (!normalizedIdentifier || typeof password !== 'string' || !password) {
    const error = new Error('Inserisci codice fiscale o email istituzionale e password.');
    error.status = 400;
    throw error;
  }

  const database = dependencies.database || db;
  const scraper = dependencies.getDatiCarriera || getDatiCarriera;
  const cfClean = normalizedIdentifier;

  // Limite globale per account (indipendente dall'IP): va verificato prima
  // di contattare il portale, così un account in cooldown non genera scraping.
  assertLoginAllowed(cfClean);

  // Cache per studente: se i dati sono freschi si evita lo scraping completo.
  // La chiave include un HMAC della password, così una password errata non
  // può riutilizzare i dati di un login precedente.
  let careerResult;
  try {
    careerResult = await careerCache.getOrLoadCareer(
      cfClean,
      password,
      () => scraper({ codiceFiscale: cfClean, password }, { phase: 'fast' })
    );
  } catch (error) {
    // Solo i fallimenti di credenziali (401) alimentano il cooldown: un portale
    // irraggiungibile (502) non deve bloccare gli utenti legittimi.
    if (sessionErrorStatus(error) === 401) recordLoginFailure(cfClean);
    throw error;
  }
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

  // Se il piano è già a database, completa il nome corso mancante.
  if (profile.courseId && profile.cohortYear && !profile.courseName) {
    const plan = getStudyPlan(database, profile.courseId, profile.cohortYear);
    if (plan?.course_name) profile.courseName = plan.course_name;
  }

  const storedProfile = upsertStudentProfile(database, {
    id: cfClean,
    anagrafica: datiCarriera.anagrafica,
    ...profile,
    esamiSostenuti: esami,
    tasse
  });

  snapshots.setCareerSnapshot(cfClean, esami);
  snapshots.setPianoSnapshot(cfClean, datiCarriera.pianoDiStudiRaw || []);
  snapshots.setTaxesSnapshot(cfClean, tasse);
  // Ogni login invalida i dati Docenti precedenti e forza un refresh completo:
  // niente dati stale di sessioni precedenti, anche a parità di credenziali.
  snapshots.invalidateDocentiSnapshot(cfClean);
  clearDocentiCache(cfClean);
  clearDocentiRouteCache(cfClean);
  slowSync.resetSlowSync(cfClean);

  // Tasse e appelli partono in background: il login non li attende.
  const ensureSlow = dependencies.ensureSlowSync || slowSync.ensureSlowSync;
  const slowStatus = ensureSlow(cfClean, { codiceFiscale: cfClean, password }, dependencies);

  // Il portale Docenti richiede l'email istituzionale (@studenti.unina.it),
  // non il codice fiscale.
  const docentiEmail = normalizeEmail(email) || resolveDocentiEmail(storedProfile || profile, cfClean);

  const docentiDependencies = enableDocentiSync === undefined
    ? dependencies
    : { ...dependencies, enableDocentiSync: enableDocentiSync === true };
  const docentiEnabled = docentiSyncEnabled(docentiDependencies);

  const serverSession = createServerSession(cfClean, {
    codiceFiscale: cfClean,
    email: docentiEmail || null,
    password,
    enableDocentiSync: docentiEnabled
  }, { database });

  // Eventuali credenziali esplicite passate dal chiamante (es. test) hanno
  // la precedenza; non esistono credenziali di servizio globali.
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
