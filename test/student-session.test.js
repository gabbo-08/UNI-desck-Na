process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../db');
const { createStudentSession, normalizeLoginIdentifier, loadDocentiInBackground } = require('../services/student-session');
const { clearSnapshots, getCareerSnapshot, getTaxesSnapshot, getDocentiSnapshot } = require('../services/career-snapshots');
const { clearCareerCache } = require('../services/career-cache');
const { getDocentiDataCache } = require('../db/repository');

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
  const storedProfile = db.prepare('SELECT * FROM StudentProfile WHERE id = ?').get(CF);
  const storedSession = db.prepare('SELECT * FROM Sessions WHERE token_hash = ?').get(
    require('../services/server-sessions').sessionTokenHash(session.token)
  );

  assert.equal(Buffer.from(session.token, 'base64url').length, 32);
  assert.equal(session.profileId, CF);
  assert.equal(session.onboardingRequired, false);
  assert.equal(session.docentiReason, 'DOCENTI_CREDENTIALS_REQUIRED');
  assert.equal(storedProfile.course_id, 'DE3');
  assert.equal(storedProfile.matricola, '01234567');
  assert.equal(storedProfile.cohort_year, 2025);
  assert.equal(Object.hasOwn(storedProfile, 'password'), false);
  assert.equal(Object.hasOwn(storedProfile, 'codice_fiscale'), false);
  assert.ok(storedSession);
  assert.equal(storedSession.token_hash.includes(session.token), false);
  assert.equal(storedSession.credentials_ciphertext.includes('do-not-store'), false);

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

test('salva il riepilogo Docenti riuscito nel database per il prossimo accesso', async t => {
  const db = createDatabase(':memory:');
  clearCareerCache(CF);
  t.after(() => {
    clearSnapshots(CF);
    clearCareerCache(CF);
    db.close();
  });

  let docentiCalls = 0;
  const deps = dependencies(db, {
    docentiCredentials: { username: 'studente@studenti.unina.it', password: 'test-password' },
    getDocentiData: async () => {
      docentiCalls += 1;
      return { available: true, subscriptions: [{ courseName: 'Analisi II', professor: 'Docente A' }], announcements: [] };
    }
  });
  await createStudentSession({ codiceFiscale: CF, password: 'test-password' }, deps);
  await new Promise(resolve => setTimeout(resolve, 10));

  const saved = getDocentiDataCache(CF, db);
  assert.deepEqual(saved?.data.subscriptions, [{ courseName: 'Analisi II', professor: 'Docente A' }]);
  assert.ok(saved?.fetchedAt > 0);
  await createStudentSession({ codiceFiscale: CF, password: 'test-password' }, deps);
  assert.equal(docentiCalls, 1);
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

test('normalizza solo email istituzionali e codici fiscali validi', () => {
  assert.equal(normalizeLoginIdentifier(' aaabbb00a00a000a '), CF);
  assert.equal(normalizeLoginIdentifier(' Nome.Cognome@STUDENTI.UNINA.IT '), 'nome.cognome@studenti.unina.it');
  assert.equal(normalizeLoginIdentifier('utente@example.com'), null);
  assert.equal(normalizeLoginIdentifier('123'), null);
});

test('un vecchio scraping Docenti non sovrascrive i dati del login più recente', async t => {
  const profileId = 'docenti-generation-profile';
  clearSnapshots(profileId);
  t.after(() => clearSnapshots(profileId));

  let resolveOld;
  const oldJob = loadDocentiInBackground(profileId, {
    docentiCredentials: { username: 'studente@studenti.unina.it', password: 'old' },
    getDocentiData: () => new Promise(resolve => { resolveOld = resolve; })
  });
  await new Promise(resolve => setImmediate(resolve));

  clearSnapshots(profileId);
  await loadDocentiInBackground(profileId, {
    docentiCredentials: { username: 'studente@studenti.unina.it', password: 'new' },
    getDocentiData: async () => ({ available: true, subscriptions: [{ courseName: 'Analisi II', professor: 'Docente nuovo' }] })
  });
  resolveOld({ available: true, subscriptions: [{ courseName: 'Analisi II', professor: 'Docente vecchio' }] });
  await oldJob;

  assert.equal(getDocentiSnapshot(profileId).subscriptions[0].professor, 'Docente nuovo');
});
