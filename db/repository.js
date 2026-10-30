// db/repository.js
const dbIndex = require('./index');
const db = dbIndex.db || dbIndex;

// 1. Utility di base
function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
  return db.prepare('SELECT * FROM StudentProfile WHERE id = ?').get(profileId) || null;
}

function upsertStudentProfile(arg1, arg2) {
  const { db, arg: profile } = getDbAndArg(arg1, arg2);
  const targetId = profile.id || profile.profileId || profile.codiceFiscale;

  db.prepare(`
    INSERT INTO StudentProfile (
      id, course_id, course_name, cohort_year, current_course_year, channel, surname_initial,
      carriera_json, tasse_json
    )
    VALUES (@id, @courseId, @courseName, @cohortYear, @currentCourseYear, @channel, @surnameInitial, @carrieraJson, @tasseJson)
    ON CONFLICT(id) DO UPDATE SET
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
    courseId: profile.courseId || profile.anagrafica?.codiceCorso || null,
    courseName: profile.courseName || profile.anagrafica?.corsoDiLaurea || null,
    cohortYear: profile.cohortYear || profile.anagrafica?.annoImmatricolazione || null,
    currentCourseYear: profile.currentCourseYear || profile.anagrafica?.annoCorso || null,
    channel: profile.channel || null,
    surnameInitial: profile.surnameInitial || null,
    carrieraJson: profile.esamiSostenuti ? JSON.stringify(profile.esamiSostenuti) : null,
    tasseJson: profile.tasse ? JSON.stringify(profile.tasse) : null
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
  clearSelectedElectives
};