process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createDatabase } = require('../db');
const { createStudentSession } = require('../services/student-session');
const { clearSnapshots, getCareerSnapshot, getTaxesSnapshot, getDocentiSnapshot } = require('../services/career-snapshots');
const { clearCareerCache } = require('../services/career-cache');

const CF = 'AAABBB00A00A000A';

function careerData() {
  return {
    anagrafica: {
      matricola: '01234567',
      codiceCorso: 'DE3',
      corsoDiLaurea: 'Ingegneria Informatica',
      annoImmatricolazione: 2025,
      annoCorso: 2
    },
    esami: [{ materia: 'Analisi I', cfu: 9, voto: 28 }],
    tasse: { paid: [{ importo: 156 }], pending: [] }
  };
}

function dependencies(db, overrides = {}) {
  return {
    database: db,
    jwtSecret: 'test-jwt-secret',
    getDatiCarriera: async () => careerData(),
    ensureSlowSync: () => ({ state: 'idle' }),
    findPlan: () => null,
    listPlans: () => [],
    docentiCredentials: {},
    ...overrides
  };
}

test('crea la sessione, salva profilo ed esami senza memorizzare credenziali', async t => {
  const db = createDatabase(':memory:');
  clearCareerCache(CF);
  t.after(() => {
    clearSnapshots(CF);
    clearCareerCache(CF);
    db.close();
  });

  const session = await createStudentSession({ codiceFiscale: CF, password: 'do-not-store' }, dependencies(db));
  assert.equal(session.fromCache, false);
  const claims = jwt.verify(session.token, 'test-jwt-secret');
  const storedProfile = db.prepare('SELECT * FROM StudentProfile WHERE id = ?').get(claims.sub);

  assert.equal(claims.sub, CF);
  assert.equal(session.profileId, CF);
  assert.equal(session.onboardingRequired, false);
  assert.equal(session.docentiReason, 'DOCENTI_CREDENTIALS_REQUIRED');
  assert.equal(storedProfile.course_id, 'DE3');
  assert.equal(storedProfile.matricola, '01234567');
  assert.equal(storedProfile.cohort_year, 2025);
  assert.equal(Object.hasOwn(storedProfile, 'password'), false);
  assert.equal(Object.hasOwn(storedProfile, 'codice_fiscale'), false);
  assert.equal(Object.hasOwn(JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url').toString()), 'password'), false);

  assert.equal(getCareerSnapshot(CF).length, 1);
  assert.equal(getTaxesSnapshot(CF).paid.length, 1);
});

test('registra un motivo stabile quando lo scraper Docenti fallisce', async t => {
  const db = createDatabase(':memory:');
  clearCareerCache(CF);
  t.after(() => {
    clearSnapshots(CF);
    clearCareerCache(CF);
    db.close();
  });

  await createStudentSession({ codiceFiscale: CF, password: 'test-password' }, dependencies(db, {
    docentiCredentials: { username: 'docenti-user', password: 'docenti-pass' },
    getDocentiData: async () => { throw null; }
  }));

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(getDocentiSnapshot(CF).reason, 'DOCENTI_SCRAPE_FAILED');
});

test('riusa i dati in cache al secondo login dello stesso studente', async t => {
  const db = createDatabase(':memory:');
  clearCareerCache(CF);
  t.after(() => {
    clearSnapshots(CF);
    clearCareerCache(CF);
    db.close();
  });

  let calls = 0;
  const deps = dependencies(db, {
    getDatiCarriera: async () => { calls += 1; return careerData(); }
  });

  const first = await createStudentSession({ codiceFiscale: CF, password: 'cache-pass' }, deps);
  const second = await createStudentSession({ codiceFiscale: CF, password: 'cache-pass' }, deps);

  assert.equal(calls, 1);
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
});

test('una password diversa non riusa la cache', async t => {
  const db = createDatabase(':memory:');
  clearCareerCache(CF);
  t.after(() => {
    clearSnapshots(CF);
    clearCareerCache(CF);
    db.close();
  });

  let calls = 0;
  const deps = dependencies(db, {
    getDatiCarriera: async () => { calls += 1; return careerData(); }
  });

  await createStudentSession({ codiceFiscale: CF, password: 'first-pass' }, deps);
  const second = await createStudentSession({ codiceFiscale: CF, password: 'second-pass' }, deps);

  assert.equal(calls, 2);
  assert.equal(second.fromCache, false);
});

test('rifiuta credenziali vuote prima di invocare lo scraper', async () => {
  let scraperCalled = false;
  await assert.rejects(
    createStudentSession({}, { getDatiCarriera: async () => { scraperCalled = true; } }),
    { status: 400 }
  );
  assert.equal(scraperCalled, false);
});
