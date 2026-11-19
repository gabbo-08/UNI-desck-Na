process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const careerPlan = require('../routes/career-plan');
const { db } = require('../db');
const { upsertStudentProfile, saveStudyPlan } = require('../db/repository');
const { clearSnapshots } = require('../services/career-snapshots');

async function recoveryRoute(t, profileId, recoverPersonalStudyPlan) {
  const app = express();
  app.use((req, _res, next) => { req.user = { sub: profileId }; req.authSession = { tokenHash: 'synthetic-hash' }; next(); });
  app.use('/api/career-plan', careerPlan.createCareerPlanRouter({ recoverPersonalStudyPlan }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return suffix => fetch(`http://127.0.0.1:${server.address().port}/api/career-plan${suffix || ''}`);
}

test('recupera automaticamente il piano personale per Chimica 2025 e supporta il refresh esplicito', async t => {
  const profileId = 'chemical-plan-recovery';
  upsertStudentProfile(db, { id: profileId, courseId: 'CHEMICAL', courseName: 'Ingegneria Chimica', cohortYear: 2025, esamiSostenuti: [] });
  let calls = 0;
  const request = await recoveryRoute(t, profileId, async ({ profile }) => {
    calls++;
    upsertStudentProfile(db, { id: profile.id, pianoDiStudiRaw: [{ id: 'CH01', courseCode: 'CH01', courseName: 'Chimica generale', cfu: 9 }] });
    return { refreshed: true };
  });
  const initial = await request();
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).source, 'segrepass');
  await request();
  assert.equal(calls, 1);
  assert.equal((await request('?refresh=1')).status, 200);
  assert.equal(calls, 2);
});

test('un piano non letto non viene descritto come corso non supportato', async t => {
  const profileId = 'chemical-plan-unavailable';
  upsertStudentProfile(db, { id: profileId, courseId: 'CHEMICAL-NO-PLAN', courseName: 'Ingegneria Chimica', cohortYear: 2025, esamiSostenuti: [] });
  const request = await recoveryRoute(t, profileId, async () => ({ refreshed: false, reason: 'STUDY_PLAN_NOT_READ', retryAfterMs: 60000 }));
  const response = await request();
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.code, 'STUDY_PLAN_NOT_AVAILABLE');
  assert.match(body.error, /personale.*recuperato/);
  assert.doesNotMatch(body.error, /corso non supportato|manifesto.*importato/i);
  assert.equal(response.headers.get('retry-after'), '60');
});

test('piano di studi usa gli esami persistiti dopo la perdita della cache RAM', async t => {
  const profileId = 'persisted-career-plan';
  upsertStudentProfile(db, {
    id: profileId,
    courseId: 'TEST-PERSISTED',
    cohortYear: 2025,
    esamiSostenuti: [{ codice: 'MAT1', materia: 'Analisi Matematica I', cfu: 9, voto: 28 }]
  });
  saveStudyPlan(db, { courseId: 'TEST-PERSISTED', cohortYear: 2025, courseName: 'Corso Test' }, [
    { courseCode: 'MAT1', courseName: 'Analisi Matematica I', cfu: 9, studyYear: 1, courseType: 'mandatory' }
  ]);
  clearSnapshots(profileId);

  const app = express();
  app.use((req, _res, next) => { req.user = { sub: profileId }; next(); });
  app.use('/api/career-plan', careerPlan);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/career-plan`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.courses[0].status, 'passed');
  assert.equal(body.source, 'manifest');
});

test('piano raw persistito resta disponibile via API senza manifesto dopo riavvio', async t => {
  const profileId = 'persisted-raw-plan';
  upsertStudentProfile(db, {
    id: profileId,
    courseId: 'RAW-PERSISTED',
    cohortYear: 2025,
    esamiSostenuti: [{ codice: 'MAT1', materia: 'Analisi Matematica I', cfu: 9, voto: 28 }],
    pianoDiStudiRaw: [{ id: 'MAT1', courseCode: 'MAT1', courseName: 'Analisi Matematica I', cfu: 9, studyYear: 1, courseType: 'mandatory' }]
  });
  clearSnapshots(profileId);
  const app = express();
  app.use((req, _res, next) => { req.user = { sub: profileId }; next(); });
  app.use('/api/career-plan', careerPlan);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/career-plan`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, 'segrepass');
  assert.equal(body.courses[0].status, 'passed');
});
