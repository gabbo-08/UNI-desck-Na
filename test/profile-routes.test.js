process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { db } = require('../db');
const { upsertStudentProfile, getStudentProfile, saveStudyPlan, getPlanCourses, replaceSelectedElectives, getSelectedElectiveIds } = require('../db/repository');
const router = require('../routes/profile');

async function profileApi(t, profileId) {
  upsertStudentProfile(db, { id: profileId, courseId: 'OLD', cohortYear: 2025, channel: 'A' });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { sub: profileId }; next(); });
  app.use('/profile', router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return body => fetch(`http://127.0.0.1:${server.address().port}/profile`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
}

test('un piano mancante non salva modifiche parziali del profilo', async t => {
  const profileId = 'profile-no-plan';
  const request = await profileApi(t, profileId);
  const response = await request({ courseId: 'MISSING', channel: 'B', selectedElectiveIds: [999] });
  assert.equal(response.status, 409);
  assert.equal(getStudentProfile(db, profileId).course_id, 'OLD');
  assert.equal(getStudentProfile(db, profileId).channel, 'A');
});

test('scelte non valide ripristinano il profilo e le scelte precedenti', async t => {
  const profileId = 'profile-invalid-electives';
  const request = await profileApi(t, profileId);
  const plan = saveStudyPlan(db, { courseId: 'OLD', cohortYear: 2025 }, [
    { courseName: 'Facoltativo', courseType: 'elective', cfu: 6 },
    { courseName: 'Obbligatorio', courseType: 'mandatory', cfu: 6 }
  ]);
  const courses = getPlanCourses(db, plan.id);
  const elective = courses.find(course => course.course_type === 'elective');
  const mandatory = courses.find(course => course.course_type === 'mandatory');
  replaceSelectedElectives(db, profileId, plan.id, [elective.id]);

  const response = await request({ channel: 'B', selectedElectiveIds: [mandatory.id] });
  assert.equal(response.status, 400);
  assert.equal(getStudentProfile(db, profileId).channel, 'A');
  assert.deepEqual(getSelectedElectiveIds(db, profileId), [elective.id]);
});

test('una selezione vuota consente di salvare un profilo senza un piano importato', async t => {
  const profileId = 'profile-empty-electives';
  const request = await profileApi(t, profileId);
  const response = await request({ courseId: 'NEW', selectedElectiveIds: [] });
  assert.equal(response.status, 200);
  assert.equal(getStudentProfile(db, profileId).course_id, 'NEW');
  assert.deepEqual(getSelectedElectiveIds(db, profileId), []);
});
