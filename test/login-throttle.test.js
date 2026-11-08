process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const throttle = require('../lib/login-throttle');
const { createStudentSession } = require('../services/student-session');
const { clearCareerCache } = require('../services/career-cache');
const { clearSnapshots } = require('../services/career-snapshots');

const CF = 'CCCDDD11B11B111B';

test('il cooldown cresce dopo i fallimenti liberi e si azzera al successo', () => {
  throttle.clearLoginThrottle();
  const id = 'unit-test-account';
  const t0 = 1_000_000;

  for (let i = 1; i <= throttle.MAX_FREE_FAILURES; i++) {
    throttle.recordLoginFailure(id, t0);
    assert.equal(throttle.getStatus(id, t0).allowed, true, `il fallimento ${i} è libero`);
  }

  throttle.recordLoginFailure(id, t0);
  let status = throttle.getStatus(id, t0);
  assert.equal(status.allowed, false);
  assert.equal(status.retryAfterMs, throttle.BASE_COOLDOWN_MS);

  const t1 = t0 + throttle.BASE_COOLDOWN_MS + 1;
  throttle.recordLoginFailure(id, t1);
  status = throttle.getStatus(id, t1);
  assert.equal(status.allowed, false);
  assert.equal(status.retryAfterMs, throttle.BASE_COOLDOWN_MS * 2);

  throttle.recordLoginSuccess(id);
  assert.equal(throttle.getStatus(id, t1).allowed, true);
  throttle.clearLoginThrottle();
});

test('il cooldown non supera il tetto massimo', () => {
  throttle.clearLoginThrottle();
  const id = 'cap-account';
  let now = 1_000_000;
  let maxSeen = 0;
  for (let i = 0; i < 30; i++) {
    throttle.recordLoginFailure(id, now);
    const status = throttle.getStatus(id, now);
    assert.ok(status.retryAfterMs <= throttle.MAX_COOLDOWN_MS);
    maxSeen = Math.max(maxSeen, status.retryAfterMs);
    now += status.retryAfterMs + 1;
  }
  assert.equal(maxSeen, throttle.MAX_COOLDOWN_MS);
  throttle.clearLoginThrottle();
});

test('assertLoginAllowed solleva un 429 generico durante il cooldown', () => {
  throttle.clearLoginThrottle();
  const id = 'blocked-account';
  const now = 1_000_000;
  for (let i = 0; i <= throttle.MAX_FREE_FAILURES; i++) throttle.recordLoginFailure(id, now);
  assert.throws(() => throttle.assertLoginAllowed(id, now), { status: 429, code: 'LOGIN_THROTTLED' });
  throttle.clearLoginThrottle();
});

test('il login globale è bloccato prima di contattare il portale', async t => {
  throttle.clearLoginThrottle();
  clearCareerCache(CF);
  t.after(() => {
    clearSnapshots(CF);
    clearCareerCache(CF);
    throttle.clearLoginThrottle();
  });

  let scraperCalls = 0;
  const deps = {
    getDatiCarriera: async () => {
      scraperCalls += 1;
      const error = new Error('Credenziali Segrepass non valide.');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    },
    ensureSlowSync: () => ({ state: 'idle' }),
    findPlan: () => null,
    listPlans: () => [],
    docentiCredentials: {}
  };

  // I fallimenti liberi contattano il portale; il primo oltre la soglia lo
  // contatta e poi attiva il cooldown.
  for (let i = 0; i <= throttle.MAX_FREE_FAILURES; i++) {
    await assert.rejects(
      createStudentSession({ codiceFiscale: CF, password: 'wrong' }, deps),
      { code: 'INVALID_CREDENTIALS' }
    );
  }
  assert.equal(scraperCalls, throttle.MAX_FREE_FAILURES + 1);

  // Il tentativo successivo è respinto dal throttle SENZA aprire il portale.
  await assert.rejects(
    createStudentSession({ codiceFiscale: CF, password: 'wrong' }, deps),
    { status: 429, code: 'LOGIN_THROTTLED' }
  );
  assert.equal(scraperCalls, throttle.MAX_FREE_FAILURES + 1);
});