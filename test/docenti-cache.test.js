const test = require('node:test');
const assert = require('node:assert/strict');
const { getDocentiCached, clearDocentiCache } = require('../services/docenti-cache');
const { setDocentiSnapshot } = require('../services/career-snapshots');

function emptyData(available = true) {
  return { available, subscriptions: [], bookedExams: [], announcements: [] };
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
