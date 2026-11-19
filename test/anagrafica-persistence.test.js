process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createDatabase, SCHEMA_VERSION } = require('../db');
const { upsertStudentProfile, getStudentProfile, getProfileAnagrafica } = require('../db/repository');

function isolatedFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unidesk-anagrafica-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'isolated.sqlite');
}

test('migra schema 9 senza perdere il piano persistito', t => {
  const filename = isolatedFile(t);
  const legacy = new Database(filename);
  legacy.exec(`CREATE TABLE StudentProfile (
    id TEXT PRIMARY KEY, matricola TEXT, course_id TEXT, course_name TEXT,
    cohort_year INTEGER, current_course_year INTEGER, channel TEXT, surname_initial TEXT,
    carriera_json TEXT, tasse_json TEXT, prenotazioni_json TEXT, piano_json TEXT, updated_at TEXT
  ); PRAGMA user_version = 9;`);
  legacy.prepare('INSERT INTO StudentProfile (id, piano_json) VALUES (?, ?)').run('legacy', JSON.stringify([{ courseName: 'Analisi' }]));
  legacy.close();
  const database = createDatabase(filename);
  try {
    const profile = getStudentProfile(database, 'legacy');
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(profile.anagrafica_json, null);
    assert.equal(JSON.parse(profile.piano_json)[0].courseName, 'Analisi');
  } finally { database.close(); }
});

test('nome e anagrafica cifrati sopravvivono al riavvio senza PIN o credenziali', t => {
  const filename = isolatedFile(t);
  let database = createDatabase(filename);
  upsertStudentProfile(database, {
    id: 'anagrafica-restart',
    anagrafica: {
      nomeCompleto: 'Studente Riservato', cognome: 'Riservato', matricola: '01234567',
      codiceCorso: 'DE3', corsoDiLaurea: 'Ingegneria Informatica', annoImmatricolazione: 2025, annoCorso: 2,
      pin: '987654', PIN: '987654', codiceNumericoPersonale: '123456789',
      password: 'private-password', token: 'private-token', extra: { password: 'nested-password' }
    }
  });
  const raw = database.prepare('SELECT anagrafica_json FROM StudentProfile WHERE id = ?').get('anagrafica-restart').anagrafica_json;
  assert.ok(raw.startsWith('enc:v1:'));
  assert.equal(raw.includes('Studente Riservato'), false);
  database.close();
  database = createDatabase(filename);
  try {
    const profile = getStudentProfile(database, 'anagrafica-restart');
    const stored = JSON.parse(profile.anagrafica_json);
    assert.deepEqual(Object.keys(stored).sort(), ['nomeCompleto', 'cognome', 'matricola', 'codiceCorso', 'corsoDiLaurea', 'annoImmatricolazione', 'annoCorso'].sort());
    assert.equal(getProfileAnagrafica(profile).nomeCompleto, 'Studente Riservato');
    assert.equal(getProfileAnagrafica(profile).matricola, '01234567');
    for (const secret of ['987654', '123456789', 'private-password', 'private-token', 'nested-password']) assert.equal(profile.anagrafica_json.includes(secret), false);
  } finally { database.close(); }
});

test('scraping anagrafica parziale non cancella nome e campi gia disponibili', t => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  upsertStudentProfile(database, { id: 'partial', anagrafica: { nomeCompleto: 'Nome Conservato', cognome: 'Conservato', corsoDiLaurea: 'Corso Test' } });
  upsertStudentProfile(database, { id: 'partial', anagrafica: { nomeCompleto: null, cognome: '', annoCorso: 2, password: 'ignored' } });
  const result = getProfileAnagrafica(getStudentProfile(database, 'partial'));
  assert.equal(result.nomeCompleto, 'Nome Conservato');
  assert.equal(result.cognome, 'Conservato');
  assert.equal(result.corsoDiLaurea, 'Corso Test');
  assert.equal(result.annoCorso, 2);
  assert.equal(Object.hasOwn(result, 'password'), false);
});
