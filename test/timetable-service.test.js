const test = require('node:test');
const assert = require('node:assert/strict');
const { getTimetableCached, clearTimetableServiceCache, DEFAULT_TTL_MS } = require('../services/timetable-service');

const filters = { courseId: 'DE3', courseName: null, studyYear: 2, semester: null, academicYear: null, channel: 'A-D', surnameInitial: 'C' };

function fakeFetcher(calls, delayMs = 0) {
  return async f => {
    calls.push(f);
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    return { events: [{ courseName: 'ANALISI MATEMATICA I' }] };
  };
}

test('seconda richiesta uguale usa la cache', async () => {
  clearTimetableServiceCache();
  const calls = [];
  const a = await getTimetableCached(filters, { fetcher: fakeFetcher(calls), now: 1000 });
  const b = await getTimetableCached(filters, { fetcher: fakeFetcher(calls), now: 2000 });
  assert.equal(calls.length, 1);
  assert.equal(a.fromCache, false);
  assert.equal(b.fromCache, true);
});

test('force ignora la cache', async () => {
  clearTimetableServiceCache();
  const calls = [];
  await getTimetableCached(filters, { fetcher: fakeFetcher(calls), now: 1000 });
  await getTimetableCached(filters, { fetcher: fakeFetcher(calls), now: 2000, force: true });
  assert.equal(calls.length, 2);
});

test('dopo la scadenza il dato viene riscaricato', async () => {
  clearTimetableServiceCache();
  const calls = [];
  await getTimetableCached(filters, { fetcher: fakeFetcher(calls), now: 1000 });
  await getTimetableCached(filters, { fetcher: fakeFetcher(calls), now: 1000 + DEFAULT_TTL_MS + 1 });
  assert.equal(calls.length, 2);
});

test('richieste simultanee producono un solo scraping', async () => {
  clearTimetableServiceCache();
  const calls = [];
  const fetcher = fakeFetcher(calls, 30);
  const [x, y] = await Promise.all([
    getTimetableCached(filters, { fetcher, now: 1000 }),
    getTimetableCached(filters, { fetcher, now: 1000 })
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(x.value, y.value);
});

test('gli errori non vengono messi in cache', async () => {
  clearTimetableServiceCache();
  let attempts = 0;
  const failing = async () => { attempts += 1; throw Object.assign(new Error('EasyAcademy giù'), { status: 502 }); };
  await assert.rejects(getTimetableCached(filters, { fetcher: failing, now: 1000 }));
  await assert.rejects(getTimetableCached(filters, { fetcher: failing, now: 1001 }));
  assert.equal(attempts, 2);
});
