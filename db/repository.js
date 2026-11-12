// db/repository.js
const dbIndex = require('./index');
const db = dbIndex.db || dbIndex;
const { seal, open } = require('../lib/secret-box');

const PROFILE_RETENTION_MS = Math.max(1, Number(process.env.PERSONAL_DATA_RETENTION_DAYS || 30)) * 24 * 60 * 60 * 1000;
const DOCENTI_CACHE_RETENTION_MS = Math.max(1, Number(process.env.DOCENTI_CACHE_RETENTION_HOURS || 720)) * 60 * 60 * 1000;
const TEACHER_CACHE_RETENTION_MS = Math.max(1, Number(process.env.TEACHER_CACHE_RETENTION_DAYS || 30)) * 24 * 60 * 60 * 1000;

function sealJson(value, associatedData) {
  if (value === null || value === undefined) return null;
  return `enc:v1:${seal(JSON.stringify(value), associatedData)}`;
}

function openJson(value, associatedData) {
  if (!value) return null;
  const raw = String(value);
  if (!raw.startsWith('enc:v1:')) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  try {
    return JSON.parse(open(raw.slice('enc:v1:'.length), associatedData) || 'null');
  } catch {
    return null;
  }
}

function decryptProfileJson(row, column, associatedData) {
  if (!row) return row;
  const parsed = openJson(row[column], associatedData);
  return { ...row, [column]: parsed === null ? null : JSON.stringify(parsed) };
}

// 1. Utility di base
function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeMatricola(value) {
  const normalized = String(value || '').replace(/\s+/g, '').trim().toUpperCase();
  if (/^\d{6,10}$/.test(normalized)) return normalized;
  if (/^[A-Z]{1,4}\d{5,10}$/.test(normalized)) return normalized;
  const coded = normalized.match(/^([A-Z]{1,2}\d{2,4})[/.-](\d{3,8})$/);
  return coded ? `${coded[1]}/${coded[2]}` : null;
}

function parsePlanCourse(row) {
  if (!row) return null;
  let prerequisites = [];
  try {
    prerequisites = JSON.parse(row.prerequisites_json || '[]');
  } catch {}
  
  return {
    ...row,
    courseCode: row.course_code,
    courseName: row.course_name,
    studyYear: row.study_year,
    courseType: row.course_type,
    electiveGroup: row.elective_group,
    electiveRequiredCfu: row.elective_required_cfu,
    prerequisites
  };
}

// 2. Risolutore DB e Parametri (DRY)
function resolveDb(possibleDb) {
  if (possibleDb?.prepare) return possibleDb;
  if (possibleDb?.db?.prepare) return possibleDb.db;
  if (dbIndex?.prepare) return dbIndex;
  if (dbIndex?.db?.prepare) return dbIndex.db;
  throw new Error("Istanza Database SQLite non trovata.");
}

/**
 * Estrae l'istanza DB e il parametro reale, supportando la doppia firma:
 * func(db, arg) oppure func(arg)
 */
function getDbAndArg(arg1, arg2) {
  try {
    const database = resolveDb(arg1);
    return { db: database, arg: database === arg1 ? arg2 : arg1 };
  } catch {
    return { db: resolveDb(), arg: arg1 };
  }
}

// 3. Modelli Profilo
function getStudentProfile(arg1, arg2) {
  const { db, arg: profileId } = getDbAndArg(arg1, arg2);
  const row = db.prepare('SELECT * FROM StudentProfile WHERE id = ?').get(profileId) || null;
  if (!row) return null;
  const withCareer = decryptProfileJson(row, 'carriera_json', `${profileId}:carriera`);
  return decryptProfileJson(withCareer, 'tasse_json', `${profileId}:tasse`);
}

function upsertStudentProfile(arg1, arg2) {
  const { db, arg: profile } = getDbAndArg(arg1, arg2);
  const targetId = profile.id || profile.profileId || profile.codiceFiscale;
  const existing = getStudentProfile(db, targetId);
  const matricola = normalizeMatricola(profile.matricola || profile.anagrafica?.matricola)
    || normalizeMatricola(existing?.matricola);
  if (existing?.matricola && !normalizeMatricola(existing.matricola)) {
    db.prepare('UPDATE StudentProfile SET matricola = NULL WHERE id = ?').run(targetId);
  }

  db.prepare(`
    INSERT INTO StudentProfile (
      id, matricola, course_id, course_name, cohort_year, current_course_year, channel, surname_initial,
      carriera_json, tasse_json
    )
    VALUES (@id, @matricola, @courseId, @courseName, @cohortYear, @currentCourseYear, @channel, @surnameInitial, @carrieraJson, @tasseJson)
    ON CONFLICT(id) DO UPDATE SET
      matricola = COALESCE(excluded.matricola, StudentProfile.matricola),
      course_id = COALESCE(excluded.course_id, StudentProfile.course_id),
      course_name = COALESCE(excluded.course_name, StudentProfile.course_name),
      cohort_year = COALESCE(excluded.cohort_year, StudentProfile.cohort_year),
      current_course_year = COALESCE(excluded.current_course_year, StudentProfile.current_course_year),
      channel = COALESCE(excluded.channel, StudentProfile.channel),
      surname_initial = COALESCE(excluded.surname_initial, StudentProfile.surname_initial),
      carriera_json = COALESCE(excluded.carriera_json, StudentProfile.carriera_json),
      tasse_json = COALESCE(excluded.tasse_json, StudentProfile.tasse_json),
      updated_at = CURRENT_TIMESTAMP
  `).run({
    id: targetId,
    matricola,
    courseId: profile.courseId || profile.anagrafica?.codiceCorso || null,
    courseName: profile.courseName || profile.anagrafica?.corsoDiLaurea || null,
    cohortYear: profile.cohortYear || profile.anagrafica?.annoImmatricolazione || null,
    currentCourseYear: profile.currentCourseYear || profile.anagrafica?.annoCorso || null,
    channel: profile.channel || null,
    surnameInitial: profile.surnameInitial || null,
    carrieraJson: sealJson(profile.esamiSostenuti, `${targetId}:carriera`),
    tasseJson: sealJson(profile.tasse, `${targetId}:tasse`)
  });

  return getStudentProfile(db, targetId);
}

function updateStudentProfile(arg1, profileIdOrUpdates, optionalUpdates) {
  const { db, arg: profileId } = getDbAndArg(arg1, profileIdOrUpdates);
  const updates = (db === arg1) ? optionalUpdates : profileIdOrUpdates;

  const columns = {
    courseId: 'course_id',
    courseName: 'course_name',
    cohortYear: 'cohort_year',
    currentCourseYear: 'current_course_year',
    channel: 'channel',
    surnameInitial: 'surname_initial'
  };
  
  const entries = Object.entries(columns).filter(([key]) => Object.hasOwn(updates || {}, key));
  if (entries.length === 0) return getStudentProfile(db, profileId);

  const assignments = entries.map(([, column]) => `${column} = @${column}`).join(', ');
  const values = Object.fromEntries(entries.map(([key, column]) => [column, updates[key] ?? null]));
  
  db.prepare(`UPDATE StudentProfile SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run({ ...values, id: profileId });

  return getStudentProfile(db, profileId);
}

// 4. Modelli Piani di Studio
function saveStudyPlan(arg1, planOrCourses, optionalCourses) {
  const { db, arg: plan } = getDbAndArg(arg1, planOrCourses);
  const courses = (db === arg1) ? optionalCourses : planOrCourses;

  return db.transaction(() => {
    db.prepare(`
      INSERT INTO StudyPlans (course_id, cohort_year, course_name, version, source_name, source_url)
      VALUES (@courseId, @cohortYear, @courseName, @version, @sourceName, @sourceUrl)
      ON CONFLICT(course_id, cohort_year, version) DO UPDATE SET
        course_name = excluded.course_name,
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        imported_at = CURRENT_TIMESTAMP
    `).run({
      courseId: plan.courseId,
      cohortYear: plan.cohortYear,
      courseName: plan.courseName,
      version: String(plan.version || '1'),
      sourceName: plan.sourceName || null,
      sourceUrl: plan.sourceUrl || null
    });

    const storedPlan = db.prepare(`
      SELECT * FROM StudyPlans WHERE course_id = ? AND cohort_year = ? AND version = ?
    `).get(plan.courseId, plan.cohortYear, String(plan.version || '1'));

    db.prepare('DELETE FROM PlanCourses WHERE plan_id = ?').run(storedPlan.id);
    
    const insertCourse = db.prepare(`
      INSERT INTO PlanCourses (
        plan_id, course_code, course_name, normalized_name, cfu, study_year, semester,
        course_type, elective_group, elective_required_cfu, prerequisites_json
      ) VALUES (
        @planId, @courseCode, @courseName, @normalizedName, @cfu, @studyYear, @semester,
        @courseType, @electiveGroup, @electiveRequiredCfu, @prerequisitesJson
      )
    `);

    for (const course of (courses || [])) {
      insertCourse.run({
        planId: storedPlan.id,
        courseCode: course.courseCode || null,
        courseName: course.courseName,
        normalizedName: normalizeName(course.courseName),
        cfu: course.cfu,
        studyYear: course.studyYear ?? null,
        semester: course.semester ?? null,
        courseType: course.courseType || 'mandatory',
        electiveGroup: course.electiveGroup || null,
        electiveRequiredCfu: course.electiveRequiredCfu ?? null,
        prerequisitesJson: JSON.stringify(course.prerequisites || [])
      });
    }

    return storedPlan;
  })();
}

function getStudyPlan(arg1, courseOrCohort, optionalCohort) {
  const { db, arg: courseIdOrName } = getDbAndArg(arg1, courseOrCohort);
  const cohortYear = (db === arg1) ? optionalCohort : courseOrCohort;

  if (!courseIdOrName || !cohortYear) return null;

  let plan = db.prepare(`
    SELECT * FROM StudyPlans WHERE course_id = ? AND cohort_year = ?
    ORDER BY imported_at DESC, id DESC LIMIT 1
  `).get(courseIdOrName, cohortYear);

  if (plan) return plan;

  return db.prepare(`
    SELECT * FROM StudyPlans
    WHERE LOWER(REPLACE(course_name, ' ', '')) LIKE '%' || REPLACE(?, ' ', '') || '%'
      AND cohort_year = ?
    ORDER BY imported_at DESC, id DESC LIMIT 1
  `).get(normalizeName(courseIdOrName), cohortYear) || null;
}

function getPlanCourses(arg1, arg2) {
  const { db, arg: planId } = getDbAndArg(arg1, arg2);
  return db.prepare(`
    SELECT * FROM PlanCourses WHERE plan_id = ?
    ORDER BY study_year IS NULL, study_year, semester IS NULL, semester, course_name
  `).all(planId).map(parsePlanCourse);
}

// 5. Modelli Esami a Scelta (Electives)
function getSelectedElectiveIds(arg1, arg2) {
  const { db, arg: profileId } = getDbAndArg(arg1, arg2);
  return db.prepare('SELECT plan_course_id FROM SelectedElectives WHERE profile_id = ?')
    .all(profileId).map(row => row.plan_course_id);
}

function replaceSelectedElectives(arg1, profileIdOrPlanId, planIdOrCourseIds, optionalCourseIds) {
  const { db, arg: profileId } = getDbAndArg(arg1, profileIdOrPlanId);
  const planId = (db === arg1) ? planIdOrCourseIds : profileIdOrPlanId;
  const courseIds = (db === arg1) ? optionalCourseIds : planIdOrCourseIds;

  const uniqueIds = [...new Set(courseIds || [])];
  
  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const valid = db.prepare(`
      SELECT COUNT(*) AS count FROM PlanCourses
      WHERE plan_id = ? AND course_type = 'elective' AND id IN (${placeholders})
    `).get(planId, ...uniqueIds).count;

    if (valid !== uniqueIds.length) {
      const error = new Error('Una o più scelte non appartengono al piano o non sono esami a scelta.');
      error.status = 400;
      throw error;
    }
  }

  db.transaction(() => {
    db.prepare('DELETE FROM SelectedElectives WHERE profile_id = ?').run(profileId);
    const insert = db.prepare('INSERT INTO SelectedElectives (profile_id, plan_course_id) VALUES (?, ?)');
    for (const courseId of uniqueIds) insert.run(profileId, courseId);
  })();

  return uniqueIds;
}

function clearSelectedElectives(arg1, arg2) {
  const { db, arg: profileId } = getDbAndArg(arg1, arg2);
  db.prepare('DELETE FROM SelectedElectives WHERE profile_id = ?').run(profileId);
}

function professorPreferenceCourseKey(courseCode, courseName) {
  const code = String(courseCode || '').trim().toUpperCase();
  return code ? `code:${code}` : `name:${normalizeName(courseName)}`;
}

function getProfessorPreferences(profileId, database = db) {
  return database.prepare(`
    SELECT id, course_key AS courseKey, course_code AS courseCode,
      course_name AS courseName, professor_id AS professorId,
      professor_name AS professorName, created_at AS createdAt
    FROM ProfessorPreferences WHERE profile_id = ?
    ORDER BY course_name COLLATE NOCASE, professor_name COLLATE NOCASE
  `).all(profileId);
}

function saveProfessorPreference(profileId, preference, database = db) {
  const courseKey = professorPreferenceCourseKey(preference.courseCode, preference.courseName);
  database.prepare(`
    INSERT INTO ProfessorPreferences (
      profile_id, course_key, course_code, course_name, professor_id, professor_name
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, course_key, professor_id) DO UPDATE SET
      course_code = excluded.course_code,
      course_name = excluded.course_name,
      professor_name = excluded.professor_name
  `).run(
    profileId,
    courseKey,
    preference.courseCode || null,
    preference.courseName,
    preference.professorId,
    preference.professorName
  );
  return database.prepare(`
    SELECT id, course_key AS courseKey, course_code AS courseCode,
      course_name AS courseName, professor_id AS professorId,
      professor_name AS professorName, created_at AS createdAt
    FROM ProfessorPreferences WHERE profile_id = ? AND course_key = ? AND professor_id = ?
  `).get(profileId, courseKey, preference.professorId);
}

function deleteProfessorPreference(profileId, preferenceId, database = db) {
  return database.prepare('DELETE FROM ProfessorPreferences WHERE profile_id = ? AND id = ?')
    .run(profileId, preferenceId).changes > 0;
}

function getDocentiDataCache(profileId, database = db) {
  const row = database.prepare('SELECT data_json AS dataJson, fetched_at AS fetchedAt FROM DocentiDataCache WHERE profile_id = ?').get(profileId);
  if (!row) return null;
  try {
    const fetchedAt = Date.parse(row.fetchedAt);
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > DOCENTI_CACHE_RETENTION_MS) {
      database.prepare('DELETE FROM DocentiDataCache WHERE profile_id = ?').run(profileId);
      return null;
    }
    const data = openJson(row.dataJson, `docenti-cache:${profileId}`);
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.available === false) return null;
    return { data, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0 };
  } catch {
    database.prepare('DELETE FROM DocentiDataCache WHERE profile_id = ?').run(profileId);
    return null;
  }
}

function saveDocentiDataCache(profileId, data, database = db, fetchedAt = new Date()) {
  if (!profileId || !data || typeof data !== 'object' || Array.isArray(data) || data.available === false) return false;
  if (!database.prepare('SELECT 1 FROM StudentProfile WHERE id = ?').get(profileId)) return false;
  const dataJson = sealJson(data, `docenti-cache:${profileId}`);
  database.prepare(`
    INSERT INTO DocentiDataCache (profile_id, data_json, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at
  `).run(profileId, dataJson, fetchedAt instanceof Date ? fetchedAt.toISOString() : new Date(fetchedAt).toISOString());
  return true;
}

function getTeacherAnnouncementsCache(professorId, database = db) {
  const row = database.prepare('SELECT data_json AS dataJson, fetched_at AS fetchedAt FROM TeacherAnnouncementsCache WHERE professor_id = ?').get(professorId);
  if (!row) return null;
  try {
    const fetchedAt = Date.parse(row.fetchedAt);
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > TEACHER_CACHE_RETENTION_MS) {
      database.prepare('DELETE FROM TeacherAnnouncementsCache WHERE professor_id = ?').run(professorId);
      return null;
    }
    const data = openJson(row.dataJson, `teacher-cache:${professorId}`);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return { data, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0 };
  } catch {
    database.prepare('DELETE FROM TeacherAnnouncementsCache WHERE professor_id = ?').run(professorId);
    return null;
  }
}

function saveTeacherAnnouncementsCache(professorId, data, database = db, fetchedAt = new Date()) {
  if (!professorId || !data || typeof data !== 'object' || Array.isArray(data) || data.announcementError) return false;
  database.prepare('DELETE FROM TeacherAnnouncementsCache WHERE fetched_at < ?')
    .run(new Date(Date.now() - TEACHER_CACHE_RETENTION_MS).toISOString());
  database.prepare(`
    INSERT INTO TeacherAnnouncementsCache (professor_id, data_json, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT(professor_id) DO UPDATE SET data_json = excluded.data_json, fetched_at = excluded.fetched_at
  `).run(professorId, sealJson(data, `teacher-cache:${professorId}`), fetchedAt instanceof Date ? fetchedAt.toISOString() : new Date(fetchedAt).toISOString());
  return true;
}

function saveBookingReceipt(profileId, receipt, database = db) {
  if (!profileId || !receipt?.id || !receipt?.annopri || !receipt?.numAppello) return null;
  database.prepare(`
    INSERT INTO BookingReceipts (id, profile_id, annopri, num_appello, status, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(receipt.id), String(profileId), String(receipt.annopri), String(receipt.numAppello),
    String(receipt.status || 'submitted'), receipt.message ? String(receipt.message).slice(0, 500) : null,
    receipt.createdAt || new Date().toISOString()
  );
  return getBookingReceiptById(receipt.id, database);
}

function getBookingReceiptById(id, database = db) {
  const row = database.prepare(`
    SELECT id, annopri, num_appello AS numAppello, status, message, created_at AS createdAt
    FROM BookingReceipts WHERE id = ?
  `).get(String(id));
  return row ? { ...row } : null;
}

function getLatestBookingReceipt(profileId, annopri, numAppello, database = db) {
  const row = database.prepare(`
    SELECT id, annopri, num_appello AS numAppello, status, message, created_at AS createdAt
    FROM BookingReceipts
    WHERE profile_id = ? AND annopri = ? AND num_appello = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(String(profileId), String(annopri), String(numAppello));
  return row ? { ...row } : null;
}

function getBookingReceipts(profileId, database = db) {
  return database.prepare(`
    SELECT id, annopri, num_appello AS numAppello, status, message, created_at AS createdAt
    FROM BookingReceipts WHERE profile_id = ? ORDER BY created_at DESC
  `).all(String(profileId));
}

function deleteStudentData(profileId, database = db) {
  if (!profileId) return 0;
  return database.transaction(() => {
    database.prepare('DELETE FROM Sessions WHERE profile_id = ?').run(profileId);
    database.prepare('DELETE FROM DocentiDataCache WHERE profile_id = ?').run(profileId);
    database.prepare('DELETE FROM ProfessorPreferences WHERE profile_id = ?').run(profileId);
    database.prepare('DELETE FROM BookingReceipts WHERE profile_id = ?').run(profileId);
    return database.prepare('DELETE FROM StudentProfile WHERE id = ?').run(profileId).changes;
  })();
}

function purgeExpiredPersonalData(database = db, now = Date.now()) {
  const profileCutoff = new Date(now - PROFILE_RETENTION_MS).toISOString();
  const docentiCutoff = new Date(now - DOCENTI_CACHE_RETENTION_MS).toISOString();
  const teacherCutoff = new Date(now - TEACHER_CACHE_RETENTION_MS).toISOString();
  return database.transaction(() => {
    const sessions = database.prepare('DELETE FROM Sessions WHERE absolute_expires_at <= ? OR idle_expires_at <= ?')
      .run(new Date(now).toISOString(), new Date(now).toISOString()).changes;
    const docenti = database.prepare('DELETE FROM DocentiDataCache WHERE fetched_at < ?').run(docentiCutoff).changes;
    const teachers = database.prepare('DELETE FROM TeacherAnnouncementsCache WHERE fetched_at < ?').run(teacherCutoff).changes;
    const profiles = String(process.env.AUTO_PURGE_PERSONAL_DATA || '').toLowerCase() === 'true'
      ? database.prepare(`
          DELETE FROM StudentProfile
          WHERE updated_at < ?
            AND id NOT IN (SELECT profile_id FROM Sessions)
        `).run(profileCutoff).changes
      : 0;
    return { sessions, docenti, teachers, profiles };
  })();
}

module.exports = {
  normalizeName,
  getStudentProfile,
  upsertStudentProfile,
  updateStudentProfile,
  saveStudyPlan,
  getStudyPlan,
  getPlanCourses,
  getSelectedElectiveIds,
  replaceSelectedElectives,
  clearSelectedElectives,
  professorPreferenceCourseKey,
  getProfessorPreferences,
  saveProfessorPreference,
  deleteProfessorPreference,
  getDocentiDataCache,
  saveDocentiDataCache,
  getTeacherAnnouncementsCache,
  saveTeacherAnnouncementsCache,
  saveBookingReceipt,
  getBookingReceiptById,
  getLatestBookingReceipt,
  getBookingReceipts,
  deleteStudentData,
  purgeExpiredPersonalData
};
