
// services/student-session.js
const jwt = require('jsonwebtoken');
const { getDatiCarriera } = require('../scraper/segrepass');
const { getDocentiData } = require('../scraper/docenti');
const { buildStudentProfile } = require('./profile-extractor');
const snapshots = require('./career-snapshots');
const careerCache = require('./career-cache');
const slowSync = require('./slow-sync');
const { clearDocentiCache } = require('./docenti-cache');
const dbModule = require('../db');
const { upsertStudentProfile, getStudentProfile, getStudyPlan } = require('../db/repository');
const { setCredentials } = require('../utils/sessionStore');
const { clearDocentiRouteCache } = require('../routes/docenti');
const { JWT_SECRET, JWT_TTL } = require('../lib/config');
const { seal } = require('../lib/secret-box');

const db = dbModule.db || dbModule;
const EMPTY_DOCENTI = Object.freeze({ subscriptions: [], bookedExams: [], announcements: [] });

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

  const credentials = docentiCredentials(dependencies);
  if (!credentials.username || !credentials.password) {
    snapshots.setDocentiSnapshot(profileId, {
      available: false,
      reason: 'DOCENTI_CREDENTIALS_REQUIRED',
      ...EMPTY_DOCENTI
    });
    return Promise.resolve();
  }

  const scraper = dependencies.getDocentiData || getDocentiData;
  snapshots.markDocentiLoading(profileId);

  return Promise.resolve()
    .then(() => scraper(credentials))
    .then(data => snapshots.setDocentiSnapshot(profileId, data))
    .catch(error => {
      console.warn(`[docenti] Acquisizione per ${profileId} non riuscita: ${error?.message}`);
      snapshots.setDocentiSnapshot(profileId, {
        available: false,
        reason: error?.code || 'DOCENTI_SCRAPE_FAILED',
        ...EMPTY_DOCENTI
      });
    })
    .finally(() => snapshots.clearDocentiLoading(profileId));
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

async function createStudentSession({ codiceFiscale, password, email } = {}, dependencies = {}) {
  if (typeof codiceFiscale !== 'string' || !codiceFiscale.trim() || typeof password !== 'string' || !password) {
    const error = new Error('Inserisci codice fiscale e password.');
    error.status = 400;
    throw error;
  }

  const database = dependencies.database || db;
  const scraper = dependencies.getDatiCarriera || getDatiCarriera;
  const jwtSecret = dependencies.jwtSecret || JWT_SECRET;
  const cfClean = codiceFiscale.trim().toUpperCase();

  // Cache per studente: se i dati sono freschi si evita lo scraping completo.
  // La chiave include un HMAC della password, così una password errata non
  // può riutilizzare i dati di un login precedente.
  const careerResult = await careerCache.getOrLoadCareer(
    cfClean,
    password,
    () => scraper({ codiceFiscale: cfClean, password }, { phase: 'fast' })
  );
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
  snapshots.setDocentiSnapshot(cfClean, null);
  clearDocentiCache(cfClean);
  clearDocentiRouteCache(cfClean);
  slowSync.resetSlowSync(cfClean);

  // Tasse e appelli partono in background: il login non li attende.
  const ensureSlow = dependencies.ensureSlowSync || slowSync.ensureSlowSync;
  const slowStatus = ensureSlow(cfClean, { codiceFiscale: cfClean, password }, dependencies);

  // Il portale Docenti richiede l'email istituzionale (@studenti.unina.it),
  // non il codice fiscale.
  const docentiEmail = normalizeEmail(email) || resolveDocentiEmail(storedProfile || profile, cfClean);

  // La password viaggia nel JWT in forma cifrata (campo "pw"), così le rotte
  // /api/docenti la recuperano da req.user.password anche dopo un riavvio del
  // server o una ricarica della pagina.
  const token = jwt.sign(
    { sub: cfClean, codiceFiscale: cfClean, email: docentiEmail || undefined, pw: seal(password) },
    jwtSecret,
    { expiresIn: JWT_TTL }
  );

  // Eventuali credenziali esplicite passate dal chiamante (es. test) hanno
  // la precedenza; non esistono credenziali di servizio globali.
  const configuredDocenti = docentiCredentials(dependencies);
  const credentials = dependencies.docentiCredentials
    || (configuredDocenti.username && configuredDocenti.password
      ? configuredDocenti
      : (docentiEmail ? { username: docentiEmail, password } : {}));

  if (credentials.username && credentials.password) {
    setCredentials(cfClean, credentials);
  }

  const docentiSnapshot = snapshots.getDocentiSnapshot(cfClean);
  const alreadyLoading = snapshots.isDocentiLoading(cfClean);
  if (!docentiSnapshot && !alreadyLoading) {
    loadDocentiInBackground(cfClean, { ...dependencies, docentiCredentials: credentials });
  }

  const docentiLoading = !docentiSnapshot && (alreadyLoading || Boolean(credentials.username && credentials.password));
  const docentiReason = docentiSnapshot
    ? (docentiSnapshot.available ? null : docentiSnapshot.reason || 'DOCENTI_SCRAPE_FAILED')
    : (docentiLoading ? null : 'DOCENTI_CREDENTIALS_REQUIRED');
  const metriche = {
    ...datiCarriera,
    anagrafica: {
      ...(datiCarriera.anagrafica || {}),
      matricola: datiCarriera.anagrafica?.matricola || storedProfile?.matricola || null
    }
  };

  return {
    token,
    expiresIn: JWT_TTL,
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
  listPlansForCohort,
  hasProfileSetup
};
