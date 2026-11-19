const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { seal } = require('../lib/secret-box');

const SCHEMA_VERSION = 10;
const DEFAULT_DB_PATH = path.resolve(__dirname, '../data/unicorno.sqlite');

function ensureDataDir(filename = DEFAULT_DB_PATH) {
  const dataDir = path.dirname(filename);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function initSchema(database) {
  database.exec(`
    -- Le sessioni persistono solo l'hash del token e le credenziali cifrate.
    CREATE TABLE IF NOT EXISTS Sessions (
      token_hash TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      credentials_ciphertext TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      idle_expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expiry
      ON Sessions (absolute_expires_at, idle_expires_at);

    -- Profilo studente (anagrafica e configurazione carriera)
    CREATE TABLE IF NOT EXISTS StudentProfile (
      id TEXT PRIMARY KEY,
      matricola TEXT,
      course_id TEXT,
      course_name TEXT,
      cohort_year INTEGER,
      current_course_year INTEGER,
      channel TEXT,
      surname_initial TEXT,
      carriera_json TEXT,
      tasse_json TEXT,
      prenotazioni_json TEXT,
      piano_json TEXT,
      anagrafica_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Manifesti degli studi
    CREATE TABLE IF NOT EXISTS StudyPlans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id TEXT NOT NULL,
      cohort_year INTEGER NOT NULL,
      course_name TEXT,
      version TEXT DEFAULT '1',
      source_name TEXT,
      source_url TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(course_id, cohort_year, version)
    );

    -- Insegnamenti del piano di studi
    CREATE TABLE IF NOT EXISTS PlanCourses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      course_code TEXT,
      course_name TEXT NOT NULL,
      normalized_name TEXT,
      cfu INTEGER,
      study_year INTEGER,
      semester INTEGER,
      course_type TEXT DEFAULT 'mandatory',
      elective_group TEXT,
      elective_required_cfu INTEGER,
      prerequisites_json TEXT,
      FOREIGN KEY (plan_id) REFERENCES StudyPlans(id) ON DELETE CASCADE
    );

    -- Esami a scelta selezionati
    CREATE TABLE IF NOT EXISTS SelectedElectives (
      profile_id TEXT NOT NULL,
      plan_course_id INTEGER NOT NULL,
      PRIMARY KEY (profile_id, plan_course_id),
      FOREIGN KEY (profile_id) REFERENCES StudentProfile(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_course_id) REFERENCES PlanCourses(id) ON DELETE CASCADE
    );

    -- Docenti preferiti associati a un insegnamento dello studente.
    CREATE TABLE IF NOT EXISTS ProfessorPreferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      course_key TEXT NOT NULL,
      course_code TEXT,
      course_name TEXT NOT NULL,
      professor_id TEXT NOT NULL,
      professor_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, course_key, professor_id),
      FOREIGN KEY (profile_id) REFERENCES StudentProfile(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_professor_preferences_profile
      ON ProfessorPreferences (profile_id, course_key);

    CREATE TABLE IF NOT EXISTS BookingReceipts (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      annopri TEXT NOT NULL,
      num_appello TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES StudentProfile(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_booking_receipts_profile_target
      ON BookingReceipts (profile_id, annopri, num_appello, created_at);

    -- Snapshot senza credenziali del riepilogo Docenti, aggiornato dopo ogni
    -- sincronizzazione riuscita. Permette una risposta immediata al login.
    CREATE TABLE IF NOT EXISTS DocentiDataCache (
      profile_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES StudentProfile(id) ON DELETE CASCADE
    );

    -- Gli avvisi sono pubblici e condivisi: una copia per docente evita di
    -- richiedere la stessa bacheca ad ogni accesso di ogni studente.
    CREATE TABLE IF NOT EXISTS TeacherAnnouncementsCache (
      professor_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    -- Segnalazioni tecniche cifrate: non memorizzano password o token.
    CREATE TABLE IF NOT EXISTS SupportReports (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      category TEXT NOT NULL,
      description_ciphertext TEXT NOT NULL,
      context_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES StudentProfile(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_support_reports_created
      ON SupportReports (created_at);

    -- Web Push: subscription cifrate e legate al profilo, mai restituite al client.
    CREATE TABLE IF NOT EXISTS PushSubscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      endpoint_hash TEXT NOT NULL UNIQUE,
      subscription_ciphertext TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (profile_id) REFERENCES StudentProfile(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile
      ON PushSubscriptions (profile_id, enabled);
  `);

  // Elimina le vecchie sessioni JWT salvate in chiaro: non sono compatibili
  // con il nuovo formato e potrebbero contenere credenziali nel payload.
  database.exec('DROP TABLE IF EXISTS UserSessions');

  const profileColumns = database.prepare('PRAGMA table_info(StudentProfile)').all();
  if (!profileColumns.some(column => column.name === 'matricola')) {
    database.exec('ALTER TABLE StudentProfile ADD COLUMN matricola TEXT');
  }
  if (!profileColumns.some(column => column.name === 'prenotazioni_json')) {
    database.exec('ALTER TABLE StudentProfile ADD COLUMN prenotazioni_json TEXT');
  }
  if (!profileColumns.some(column => column.name === 'piano_json')) {
    database.exec('ALTER TABLE StudentProfile ADD COLUMN piano_json TEXT');
  }
  if (!profileColumns.some(column => column.name === 'anagrafica_json')) {
    database.exec('ALTER TABLE StudentProfile ADD COLUMN anagrafica_json TEXT');
  }
}

function sealLegacyJson(value, associatedData) {
  if (!value || String(value).startsWith('enc:v1:')) return null;
  try {
    const parsed = JSON.parse(String(value));
    return `enc:v1:${seal(JSON.stringify(parsed), associatedData)}`;
  } catch {
    return null;
  }
}

/** Upgrade valid legacy personal JSON rows to encrypted-at-rest storage. */
function migratePersonalJson(database) {
  const profiles = database.prepare('SELECT id, carriera_json, tasse_json, prenotazioni_json, piano_json, anagrafica_json FROM StudentProfile').all();
  const updateProfile = database.prepare('UPDATE StudentProfile SET carriera_json = ?, tasse_json = ?, prenotazioni_json = ?, piano_json = ?, anagrafica_json = ? WHERE id = ?');
  for (const row of profiles) {
    const career = sealLegacyJson(row.carriera_json, `${row.id}:carriera`);
    const taxes = sealLegacyJson(row.tasse_json, `${row.id}:tasse`);
    const bookings = sealLegacyJson(row.prenotazioni_json, `${row.id}:prenotazioni`);
    const plan = sealLegacyJson(row.piano_json, `${row.id}:piano`);
    const anagrafica = sealLegacyJson(row.anagrafica_json, `${row.id}:anagrafica`);
    if (career || taxes || bookings || plan || anagrafica) updateProfile.run(career || row.carriera_json || null, taxes || row.tasse_json || null, bookings || row.prenotazioni_json || null, plan || row.piano_json || null, anagrafica || row.anagrafica_json || null, row.id);
  }

  const docenti = database.prepare('SELECT profile_id, data_json FROM DocentiDataCache').all();
  const updateDocenti = database.prepare('UPDATE DocentiDataCache SET data_json = ? WHERE profile_id = ?');
  for (const row of docenti) {
    const encrypted = sealLegacyJson(row.data_json, `docenti-cache:${row.profile_id}`);
    if (encrypted) updateDocenti.run(encrypted, row.profile_id);
  }

  const announcements = database.prepare('SELECT professor_id, data_json FROM TeacherAnnouncementsCache').all();
  const updateAnnouncements = database.prepare('UPDATE TeacherAnnouncementsCache SET data_json = ? WHERE professor_id = ?');
  for (const row of announcements) {
    const encrypted = sealLegacyJson(row.data_json, `teacher-cache:${row.professor_id}`);
    if (encrypted) updateAnnouncements.run(encrypted, row.professor_id);
  }
}

/**
 * Crea un'istanza isolata del database (usare ':memory:' nei test).
 */
function createDatabase(filename = DEFAULT_DB_PATH) {
  if (filename !== ':memory:') ensureDataDir(filename);
  const database = new Database(filename);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('secure_delete = ON');
  database.pragma('wal_autocheckpoint = 1000');
  const previousSchemaVersion = Number(database.pragma('user_version', { simple: true }) || 0);
  initSchema(database);
  if (previousSchemaVersion < SCHEMA_VERSION) migratePersonalJson(database);
  database.pragma(`user_version = ${SCHEMA_VERSION}`);
  return database;
}

// Istanza condivisa dall'applicazione. DB_PATH consente di isolare i test.
const db = createDatabase(process.env.DB_PATH || DEFAULT_DB_PATH);

module.exports = { db, createDatabase, SCHEMA_VERSION, DEFAULT_DB_PATH };
