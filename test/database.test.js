process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, SCHEMA_VERSION } = require('../db');
const repository = require('../db/repository');

test('creates the versioned local profile and study-plan schema', t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());

  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
  assert.deepEqual(tables.filter(name => ['StudentProfile', 'StudyPlans', 'PlanCourses', 'SelectedElectives', 'DocentiDataCache', 'TeacherAnnouncementsCache'].includes(name)).sort(), [
    'DocentiDataCache', 'PlanCourses', 'SelectedElectives', 'StudentProfile', 'StudyPlans', 'TeacherAnnouncementsCache'
  ]);
});

test('persiste snapshot Docenti senza credenziali e aggiorna la data di sincronizzazione', t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  repository.upsertStudentProfile(db, { id: 'docenti-cache-profile' });
  const data = {
    available: true,
    subscriptions: [{ professor: 'Docente A', courseName: 'Analisi' }],
    announcements: [{ professor: 'Docente A', items: [] }]
  };
  const fetchedAt = new Date('2026-11-05T10:00:00.000Z');

  assert.equal(repository.saveDocentiDataCache('docenti-cache-profile', data, db, fetchedAt), true);
  assert.deepEqual(repository.getDocentiDataCache('docenti-cache-profile', db), {
    data,
    fetchedAt: fetchedAt.getTime()
  });
  const raw = db.prepare('SELECT data_json FROM DocentiDataCache WHERE profile_id = ?').get('docenti-cache-profile').data_json;
  assert.equal(raw.includes('password'), false);
});

test('cache avvisi pubblica per docente e non salva errori temporanei', t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const group = { professor: 'Docente A', slug: 'teacher-1', items: [{ id: '1', title: 'Avviso' }] };
  const fetchedAt = new Date('2026-11-05T10:00:00.000Z');

  assert.equal(repository.saveTeacherAnnouncementsCache('teacher-1', group, db, fetchedAt), true);
  assert.deepEqual(repository.getTeacherAnnouncementsCache('teacher-1', db), { data: group, fetchedAt: fetchedAt.getTime() });
  assert.equal(repository.saveTeacherAnnouncementsCache('teacher-2', { announcementError: true }, db), false);
});

test('upserts profile fields without persisting login credentials', t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());

  repository.upsertStudentProfile(db, {
    id: 'pseudonymous-id', matricola: '01234567', courseId: 'DE3', cohortYear: 2025
  });
  repository.updateStudentProfile(db, 'pseudonymous-id', { channel: 'A-I' });
  const updated = repository.upsertStudentProfile(db, { id: 'pseudonymous-id' });
  assert.equal(updated.course_id, 'DE3');
  assert.equal(updated.matricola, '01234567');
  assert.equal(updated.cohort_year, 2025);
  assert.equal(updated.channel, 'A-I');
  assert.equal(Object.hasOwn(updated, 'password'), false);
  assert.equal(Object.hasOwn(updated, 'codice_fiscale'), false);
});

test('normalizes matricole codificate and scarta falsi positivi', t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());

  repository.upsertStudentProfile(db, { id: 'coded', matricola: 'N46 / 1234' });
  repository.upsertStudentProfile(db, { id: 'false-positive', matricola: 'org/1999' });

  assert.equal(repository.getStudentProfile(db, 'coded').matricola, 'N46/1234');
  assert.equal(repository.getStudentProfile(db, 'false-positive').matricola, null);
});

test('stores plan courses and only permits selecting elective rows', t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  repository.upsertStudentProfile(db, { id: 'p1' });

  const plan = repository.saveStudyPlan(db, {
    courseId: 'DE3', cohortYear: 2025, courseName: 'Ingegneria Informatica', version: '2025.1'
  }, [
    { courseCode: 'MAT1', courseName: 'Analisi Matematica I', cfu: 9, studyYear: 1, semester: 1 },
    { courseName: 'Sistemi Multimediali', cfu: 6, studyYear: 3, semester: 2, courseType: 'elective', electiveGroup: 'free', electiveRequiredCfu: 12 }
  ]);
  const courses = repository.getPlanCourses(db, plan.id);
  assert.equal(courses.length, 2);
  repository.replaceSelectedElectives(db, 'p1', plan.id, [courses[1].id]);
  assert.deepEqual(repository.getSelectedElectiveIds(db, 'p1'), [courses[1].id]);
  assert.throws(() => repository.replaceSelectedElectives(db, 'p1', plan.id, [courses[0].id]), { status: 400 });
});
