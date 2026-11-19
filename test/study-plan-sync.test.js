process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../db');
const { upsertStudentProfile, getStudentProfile, updateStudentProfile, saveStudyPlan } = require('../db/repository');
const { recoverPersonalStudyPlan } = require('../services/study-plan-sync');
const { getPersistedPiano, resolveStudyPlan } = require('../services/study-plan-service');
const snapshots = require('../services/career-snapshots');

function profileFor(t, extra = {}) {
  const database = createDatabase(':memory:');
  const profile = upsertStudentProfile(database, {
    id: 'chemical-student', courseId: 'CHEMICAL-TEST', courseName: 'Ingegneria Chimica', cohortYear: 2025,
    esamiSostenuti: [], ...extra
  });
  t.after(() => { snapshots.clearSnapshots(profile.id); database.close(); });
  return { database, profile, tokenHash: 'test-session-hash' };
}
const course = { id: 'CH01', courseCode: 'CH01', courseName: 'Chimica generale', cfu: 9, studyYear: 1 };
const credentials = { email: 'synthetic@studenti.unina.it', password: 'synthetic-value' };

test('recupera il piano personale di Chimica senza manifesto, deduplica e conserva la coorte verificata', async t => {
  const context = profileFor(t);
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const dependencies = {
    getSessionCredentials: () => credentials,
    getDatiCarriera: async (_credentials, options) => {
      calls++;
      assert.equal(options.phase, 'fast');
      await gate;
      return {
        // IMM. DAL describes plan validity and must not replace the personal cohort.
        anagrafica: { annoImmatricolazione: 2020 }, pianoDiStudiRaw: [course]
      };
    }
  };
  const one = recoverPersonalStudyPlan(context, dependencies);
  const two = recoverPersonalStudyPlan(context, dependencies);
  release();
  const results = await Promise.all([one, two]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.refreshed));
  const saved = getStudentProfile(context.database, context.profile.id);
  assert.equal(saved.cohort_year, 2025);
  assert.equal(getPersistedPiano(saved)[0].courseName, 'Chimica generale');
  const raw = context.database.prepare('SELECT piano_json FROM StudentProfile WHERE id = ?').get(saved.id).piano_json;
  assert.ok(raw.startsWith('enc:v1:'));
  assert.equal(raw.includes('Chimica generale'), false);
  assert.equal(resolveStudyPlan(context.database, saved, saved.id).source, 'segrepass');
});

test('un refresh fallito preserva il piano precedente e applica il cooldown', async t => {
  const context = profileFor(t, { pianoDiStudiRaw: [course] });
  let calls = 0;
  const dependencies = {
    getSessionCredentials: () => credentials,
    getDatiCarriera: async () => { calls++; throw Object.assign(new Error('private upstream data'), { code: 'TIMEOUT' }); }
  };
  assert.equal((await recoverPersonalStudyPlan(context, dependencies)).reason, 'STUDY_PLAN_UPSTREAM_ERROR');
  const repeated = await recoverPersonalStudyPlan(context, dependencies);
  assert.equal(calls, 1);
  assert.ok(repeated.retryAfterMs > 0);
  assert.equal(getPersistedPiano(getStudentProfile(context.database, context.profile.id))[0].id, course.id);
});

test('un recupero tardivo non salva dati dopo logout o cambio corso', async t => {
  for (const action of ['logout', 'profile-change']) {
    const context = profileFor(t);
    let valid = true;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const dependencies = {
      getSessionCredentials: () => valid ? credentials : null,
      getDatiCarriera: async () => { await gate; return { pianoDiStudiRaw: [course] }; }
    };
    const job = recoverPersonalStudyPlan(context, dependencies);
    if (action === 'logout') valid = false;
    else updateStudentProfile(context.database, context.profile.id, { courseId: 'OTHER' });
    release();
    assert.equal((await job).reason, 'STUDY_PLAN_CONTEXT_CHANGED');
    assert.equal(getStudentProfile(context.database, context.profile.id).piano_json, null);
  }
});

test('non attribuisce un piano di un altro corso al profilo corrente', async t => {
  const context = profileFor(t);
  const result = await recoverPersonalStudyPlan(context, {
    getSessionCredentials: () => credentials,
    getDatiCarriera: async () => ({ pianoDiStudiRaw: [course], anagrafica: { codiceCorso: 'OTHER', corsoDiLaurea: 'Altro corso' } })
  });
  assert.equal(result.reason, 'STUDY_PLAN_PROFILE_MISMATCH');
  assert.equal(getStudentProfile(context.database, context.profile.id).piano_json, null);
});

test('un manifesto importato senza insegnamenti non nasconde il piano personale', t => {
  const context = profileFor(t, { pianoDiStudiRaw: [course] });
  saveStudyPlan(context.database, { courseId: context.profile.course_id, cohortYear: 2025, courseName: 'Ingegneria Chimica' }, []);
  assert.equal(resolveStudyPlan(context.database, context.profile, context.profile.id).source, 'segrepass');
});
