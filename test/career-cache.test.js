const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getCachedCareer,
  setCachedCareer,
  getOrLoadCareer,
  clearCareerCache
} = require('../services/career-cache');

const PROFILE = 'cache-profile-test';

test('salva e rilegge i dati per studente', t => {
  t.after(() => clearCareerCache(PROFILE));
  const data = { esami: [{ materia: 'Analisi I' }] };

  setCachedCareer(PROFILE, 'password-1', data);
  const cached = getCachedCareer(PROFILE, 'password-1');

  assert.deepEqual(cached.value, data);
});

test('una password diversa non accede alla cache', t => {
  t.after(() => clearCareerCache(PROFILE));
  setCachedCareer(PROFILE, 'password-1', { esami: [] });

  assert.equal(getCachedCareer(PROFILE, 'password-2'), null);
});

test('la cache scade dopo il TTL configurato', t => {
  const previous = process.env.CAREER_CACHE_TTL_MS;
  process.env.CAREER_CACHE_TTL_MS = '10';
  t.after(() => {
    clearCareerCache(PROFILE);
    if (previous === undefined) delete process.env.CAREER_CACHE_TTL_MS;
    else process.env.CAREER_CACHE_TTL_MS = previous;
  });

  setCachedCareer(PROFILE, 'password-1', { esami: [] }, Date.now() - 50);
  assert.equal(getCachedCareer(PROFILE, 'password-1'), null);
});

test('getOrLoadCareer esegue il loader una sola volta e poi usa la cache', async t => {
  t.after(() => clearCareerCache(PROFILE));
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return { esami: [{ materia: 'Analisi I' }] };
  };

  const first = await getOrLoadCareer(PROFILE, 'password-1', loader);
  const second = await getOrLoadCareer(PROFILE, 'password-1', loader);

  assert.equal(calls, 1);
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
});

test('getOrLoadCareer deduplica login concorrenti dello stesso studente', async t => {
  t.after(() => clearCareerCache(PROFILE));
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { esami: [] };
  };

  const [first, second] = await Promise.all([
    getOrLoadCareer(PROFILE, 'password-1', loader),
    getOrLoadCareer(PROFILE, 'password-1', loader)
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first.value, second.value);
});

test('clearCareerCache invalida i dati dello studente', async t => {
  t.after(() => clearCareerCache(PROFILE));
  let calls = 0;
  const loader = async () => { calls += 1; return { esami: [] }; };

  await getOrLoadCareer(PROFILE, 'password-1', loader);
  clearCareerCache(PROFILE);
  const afterClear = await getOrLoadCareer(PROFILE, 'password-1', loader);

  assert.equal(calls, 2);
  assert.equal(afterClear.fromCache, false);
});

test('CAREER_CACHE_TTL_MS=0 disattiva la cache', async t => {
  const previous = process.env.CAREER_CACHE_TTL_MS;
  process.env.CAREER_CACHE_TTL_MS = '0';
  t.after(() => {
    clearCareerCache(PROFILE);
    if (previous === undefined) delete process.env.CAREER_CACHE_TTL_MS;
    else process.env.CAREER_CACHE_TTL_MS = previous;
  });

  let calls = 0;
  const loader = async () => { calls += 1; return { esami: [] }; };

  await getOrLoadCareer(PROFILE, 'password-1', loader);
  const second = await getOrLoadCareer(PROFILE, 'password-1', loader);

  assert.equal(calls, 2);
  assert.equal(second.fromCache, false);
});

test('un caricamento invalidato non ripopola la cache e non interrompe il nuovo job', async t => {
  t.after(() => clearCareerCache(PROFILE));
  let releaseOld;
  let releaseNew;
  const oldRequest = getOrLoadCareer(PROFILE, 'password-1', () => new Promise(resolve => { releaseOld = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  clearCareerCache(PROFILE);
  const newRequest = getOrLoadCareer(PROFILE, 'password-1', () => new Promise(resolve => { releaseNew = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  releaseOld({ marker: 'old' });
  await oldRequest;
  assert.equal(getCachedCareer(PROFILE, 'password-1'), null);
  const shared = getOrLoadCareer(PROFILE, 'password-1', () => { throw new Error('new job lost'); });
  releaseNew({ marker: 'new' });
  const [current, concurrent] = await Promise.all([newRequest, shared]);
  assert.equal(current.value.marker, 'new');
  assert.equal(concurrent.shared, true);
  assert.equal(getCachedCareer(PROFILE, 'password-1').value.marker, 'new');
});
