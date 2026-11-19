process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createDatabase, SCHEMA_VERSION } = require('../db');
const repository = require('../db/repository');
const snapshots = require('../services/career-snapshots');
const { resolveStudyPlan, getPersistedPiano } = require('../services/study-plan-service');
const { createStudentSession } = require('../services/student-session');
const { clearCareerCache } = require('../services/career-cache');

const courses = [{ id: 'MAT1', courseCode: 'MAT1', courseName: 'Analisi privata', cfu: 9, studyYear: 1, courseType: 'mandatory' }];

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unidesk-plan-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'isolated.sqlite');
}

test('migra lo schema 8 aggiungendo piano_json senza perdere la carriera esistente', t => {
  const filename = temporaryDatabase(t);
  const legacy = new Database(filename);
  legacy.exec(`CREATE TABLE StudentProfile (
    id TEXT PRIMARY KEY, matricola TEXT, course_id TEXT, course_name TEXT,
    cohort_year INTEGER, current_course_year INTEGER, channel TEXT, surname_initial TEXT,
    carriera_json TEXT, tasse_json TEXT, prenotazioni_json TEXT, updated_at TEXT
  ); PRAGMA user_version = 8;`);
  legacy.prepare('INSERT INTO StudentProfile (id, carriera_json) VALUES (?, ?)').run('legacy', JSON.stringify([{ materia: 'Analisi', voto: 28, cfu: 9 }]));
  legacy.close();
  const database = createDatabase(filename);
  try {
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.ok(database.prepare('PRAGMA table_info(StudentProfile)').all().some(column => column.name === 'piano_json'));
    assert.equal(JSON.parse(repository.getStudentProfile(database, 'legacy').carriera_json)[0].voto, 28);
    assert.equal(repository.getStudentProfile(database, 'legacy').piano_json, null);
  } finally { database.close(); }
});

test('piano Segrepass cifrato sopravvive a chiusura e riapertura del database', t => {
  const filename = temporaryDatabase(t);
  let database = createDatabase(filename);
  repository.upsertStudentProfile(database, { id: 'restart-plan', courseId: 'RAW', cohortYear: 2025, pianoDiStudiRaw: courses });
  const raw = database.prepare('SELECT piano_json FROM StudentProfile WHERE id = ?').get('restart-plan').piano_json;
  assert.ok(raw.startsWith('enc:v1:'));
  assert.equal(raw.includes('Analisi privata'), false);
  database.close();
  snapshots.clearSnapshots('restart-plan');
  database = createDatabase(filename);
  try {
    const profile = repository.getStudentProfile(database, 'restart-plan');
    assert.deepEqual(getPersistedPiano(profile), courses);
    const resolved = resolveStudyPlan(database, profile, 'restart-plan');
    assert.equal(resolved.source, 'segrepass');
    assert.deepEqual(resolved.courses, courses);
  } finally { database.close(); }
});

test('salvataggi parziali preservano il piano e cambi corso non riusano il piano precedente', t => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  repository.upsertStudentProfile(database, { id: 'partial-plan', courseId: 'RAW', cohortYear: 2025, pianoDiStudiRaw: courses });
  const profile = repository.upsertStudentProfile(database, { id: 'partial-plan', pianoDiStudiRaw: [] });
  assert.deepEqual(getPersistedPiano(profile), courses);
  snapshots.setPianoSnapshot('partial-plan', courses);
  t.after(() => snapshots.clearSnapshots('partial-plan'));
  const changed = repository.updateStudentProfile(database, 'partial-plan', { courseId: 'OTHER' });
  assert.equal(resolveStudyPlan(database, changed, 'partial-plan'), null);
  repository.saveStudyPlan(database, { courseId: 'OTHER', cohortYear: 2025, courseName: 'Manifesto corretto' }, [
    { courseCode: 'OTHER1', courseName: 'Altro insegnamento', cfu: 6 }
  ]);
  assert.equal(resolveStudyPlan(database, changed, 'partial-plan').source, 'manifest');
});

test('login salva il piano raw e lo mantiene se un successivo scraping non lo restituisce', async t => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const profileId = 'persist-plan@studenti.unina.it';
  t.after(() => { clearCareerCache(profileId); snapshots.clearSnapshots(profileId); });
  let rawPlan = courses;
  let includeName = true;
  const dependencies = {
    database,
    enableDocentiSync: false,
    ensureSlowSync: () => ({ state: 'idle' }),
    getDatiCarriera: async () => ({
      anagrafica: { nomeCompleto: includeName ? 'Nome Login' : null, codiceCorso: 'RAW', corsoDiLaurea: 'Corso Test', annoImmatricolazione: 2025 },
      esami: [],
      pianoDiStudiRaw: rawPlan
    })
  };
  await createStudentSession({ email: profileId, password: 'test-only' }, dependencies);
  assert.deepEqual(getPersistedPiano(repository.getStudentProfile(database, profileId)), courses);
  assert.deepEqual(snapshots.getPianoSnapshot(profileId), courses);
  rawPlan = [];
  includeName = false;
  clearCareerCache(profileId);
  const secondLogin = await createStudentSession({ email: profileId, password: 'test-only' }, dependencies);
  assert.equal(secondLogin.metriche.anagrafica.nomeCompleto, 'Nome Login');
  assert.deepEqual(getPersistedPiano(repository.getStudentProfile(database, profileId)), courses);
  assert.deepEqual(snapshots.getPianoSnapshot(profileId), courses);
});

test('refresh metriche persiste il nuovo piano raw usando la sessione corrente', async t => {
  const express = require('express');
  const { db } = require('../db');
  const { createServerSession, deleteServerSession } = require('../services/server-sessions');
  const profileId = 'refresh-plan@studenti.unina.it';
  repository.upsertStudentProfile(db, { id: profileId, courseId: 'RAW', cohortYear: 2025 });
  const session = createServerSession(profileId, { codiceFiscale: profileId, password: 'test-only' });
  t.after(() => { clearCareerCache(profileId); snapshots.clearSnapshots(profileId); deleteServerSession(session.token); });
  const scraper = require('../scraper/segrepass');
  t.mock.method(scraper, 'getDatiCarriera', async () => ({ esami: [], pianoDiStudiRaw: courses, anagrafica: { nomeCompleto: 'Nome Refresh', pin: '654321' } }));
  const app = express();
  app.use((req, _res, next) => { req.user = { sub: profileId }; req.authSession = { tokenHash: session.tokenHash }; next(); });
  app.use('/api/metriche', require('../routes/metriche'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/metriche?refresh=1`);
  assert.equal(response.status, 200);
  assert.equal(repository.getProfileAnagrafica(repository.getStudentProfile(db, profileId)).nomeCompleto, 'Nome Refresh');
  assert.equal(repository.getStudentProfile(db, profileId).anagrafica_json.includes('654321'), false);
  assert.deepEqual(getPersistedPiano(repository.getStudentProfile(db, profileId)), courses);
  assert.deepEqual(snapshots.getPianoSnapshot(profileId), courses);
});
