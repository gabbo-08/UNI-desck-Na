process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDocentiCached, clearDocentiCache, sanitizeDocentiSnapshot } = require('../services/docenti-cache');
const { setDocentiSnapshot, markDocentiLoading, clearDocentiLoading } = require('../services/career-snapshots');
const { db } = require('../db');
const { upsertStudentProfile, saveDocentiDataCache } = require('../db/repository');

function emptyData(available = true) {
  return {
    available,
    subscriptions: available ? [{ courseName: 'Corso di prova', professor: 'Docente di prova' }] : [],
    bookedExams: [], announcements: [], groups: [], tests: []
  };
}

test('usa lo snapshot caricato in background senza chiamare lo scraper', async t => {
  const profileId = 'cache-background-1';
  t.after(() => clearDocentiCache(profileId));
  setDocentiSnapshot(profileId, emptyData(true));

  let loaderCalled = false;
  const value = await getDocentiCached(profileId, async () => {
    loaderCalled = true;
    return emptyData(false);
  });

  assert.equal(loaderCalled, false);
  assert.equal(value.available, true);
});

test('deduplica richieste concorrenti e poi usa la cache', async t => {
  const profileId = 'cache-dedupe-1';
  t.after(() => clearDocentiCache(profileId));

  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return emptyData(true);
  };

  const [first, second] = await Promise.all([
    getDocentiCached(profileId, loader),
    getDocentiCached(profileId, loader)
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);

  const third = await getDocentiCached(profileId, loader);
  assert.equal(calls, 1);
  assert.deepEqual(third, first);
});

test('clearDocentiCache forza un nuovo caricamento', async t => {
  const profileId = 'cache-clear-1';
  t.after(() => clearDocentiCache(profileId));

  let calls = 0;
  const loader = async () => {
    calls += 1;
    return emptyData(true);
  };

  await getDocentiCached(profileId, loader);
  clearDocentiCache(profileId);
  await getDocentiCached(profileId, loader);

  assert.equal(calls, 2);
});

test('un errore del loader non viene messo in cache', async t => {
  const profileId = 'cache-error-1';
  t.after(() => clearDocentiCache(profileId));

  await assert.rejects(getDocentiCached(profileId, async () => {
    throw new Error('scrape failed');
  }), /scrape failed/);

  const value = await getDocentiCached(profileId, async () => emptyData(true));
  assert.equal(value.available, true);
});

test('un caricamento invalidato non può ripopolare la cache con dati vecchi', async t => {
  const profileId = 'cache-generation-1';
  const credentials = { username: 'studente@studenti.unina.it', password: 'secret' };
  t.after(() => clearDocentiCache(profileId));

  let resolveOld;
  const oldRequest = getDocentiCached(profileId, credentials, () => new Promise(resolve => { resolveOld = resolve; }));
  await new Promise(resolve => setImmediate(resolve));

  clearDocentiCache(profileId);
  const current = await getDocentiCached(profileId, credentials, async () => ({ ...emptyData(true), marker: 'current' }));
  resolveOld({ ...emptyData(true), marker: 'stale' });
  await oldRequest;

  const cached = await getDocentiCached(profileId, credentials, async () => { throw new Error('cache miss'); });
  assert.equal(current.marker, 'current');
  assert.equal(cached.marker, 'current');
});

test('serve subito lo snapshot persistente e aggiorna in background quello scaduto', async t => {
  const profileId = 'cache-persistent-1';
  t.after(() => clearDocentiCache(profileId));
  upsertStudentProfile(db, { id: profileId });
  const oldData = { ...emptyData(true), marker: 'saved' };
  saveDocentiDataCache(profileId, oldData, db, new Date(Date.now() - 10 * 60 * 1000));

  let calls = 0;
  const loader = async () => {
    calls += 1;
    return { ...emptyData(true), marker: 'refreshed' };
  };
  const first = await getDocentiCached(profileId, loader);
  assert.equal(first.marker, 'saved');

  for (let attempt = 0; attempt < 30 && calls === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(calls, 1);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await getDocentiCached(profileId, loader);
    if (current.marker === 'refreshed') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal((await getDocentiCached(profileId, loader)).marker, 'refreshed');
});

test('non blocca la sezione Docenti durante il primo caricamento in background', async t => {
  const profileId = 'cache-first-load-1';
  t.after(() => {
    clearDocentiCache(profileId);
    clearDocentiLoading(profileId);
  });
  markDocentiLoading(profileId);
  const startedAt = Date.now();
  const result = await getDocentiCached(profileId, async () => emptyData(true));

  assert.equal(result.loading, true);
  assert.deepEqual(result.subscriptions, []);
  assert.ok(Date.now() - startedAt < 1000);
});

test('ripulisce snapshot storici eliminando iscrizioni e avvisi non collegati', () => {
  const clean = sanitizeDocentiSnapshot({
    available: true,
    subscriptions: [
      { professor: 'Flavia Giannetti' },
      { professorId: 't1', professor: 'FLAVIA GIANNETTI', courseName: 'Analisi Matematica II' }
    ],
    announcements: [
      { professor: 'Flavia Giannetti', slug: 't1', items: [{ id: 'a1' }] },
      { professor: 'Docente omonimo', slug: 't2', items: [{ id: 'a2' }] }
    ],
    groups: [{ name: 'A', courseName: 'Materia inventata' }],
    tests: [{ name: 'Test', courseName: 'Materia inventata' }],
    bookedExams: []
  });
  assert.equal(clean.subscriptions.length, 1);
  assert.equal(clean.announcements.length, 1);
  assert.equal(clean.groups.length, 0);
  assert.equal(clean.tests.length, 0);
  assert.equal(clean._cacheVersion, 2);
});
