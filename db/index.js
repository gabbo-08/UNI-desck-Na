const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const SCHEMA_VERSION = 2;
const DEFAULT_DB_PATH = path.resolve(__dirname, '../data/unicorno.sqlite');

function ensureDataDir() {
  const dataDir = path.dirname(DEFAULT_DB_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function initSchema(database) {
  database.exec(`
    -- Tabella Sessioni Utente (autenticazione opzionale)
    CREATE TABLE IF NOT EXISTS UserSessions (
      token TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
      ON UserSessions (expires_at);

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
  `);

  const profileColumns = database.prepare('PRAGMA table_info(StudentProfile)').all();
  if (!profileColumns.some(column => column.name === 'matricola')) {
    database.exec('ALTER TABLE StudentProfile ADD COLUMN matricola TEXT');
  }
}

/**
 * Crea un'istanza isolata del database (usare ':memory:' nei test).
 */
function createDatabase(filename = DEFAULT_DB_PATH) {
  if (filename !== ':memory:') ensureDataDir();
  const database = new Database(filename);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  initSchema(database);
  database.pragma(`user_version = ${SCHEMA_VERSION}`);
  return database;
}

// Istanza condivisa dall'applicazione. DB_PATH consente di isolare i test.
const db = createDatabase(process.env.DB_PATH || DEFAULT_DB_PATH);

module.exports = { db, createDatabase, SCHEMA_VERSION, DEFAULT_DB_PATH };
