import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const requireModule = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
process.env.TZ = 'Europe/Rome';

function loadTs(relativePath, globals = {}) {
  const filename = fileURLToPath(new URL(relativePath, root));
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(source, {
    module: compiledModule, exports: compiledModule.exports, require: requireModule,
    process: { env: {} }, AbortSignal, Headers, DOMException, Event,
    ...globals,
  }, { filename });
  return compiledModule.exports;
}

function apiHarness(fetch) {
  const storage = new Map();
  const window = Object.assign(new EventTarget(), {
    location: { hostname: 'localhost' },
    localStorage: {
      get length() { return storage.size; },
      key: index => [...storage.keys()][index],
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  return { api: loadTs('src/lib/api.ts', { window, fetch }), window, storage };
}

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('explicit plan and slow-data recovery requests bypass the ordinary read URL', async () => {
  const urls = [];
  const { api } = apiHarness(url => { urls.push(url); return Promise.resolve(jsonResponse({})); });
  await api.fetchCareerPlan({ refresh: true });
  await api.fetchSlowData({ refresh: true });
  assert.deepEqual(urls, ['/api/career-plan?refresh=1', '/api/career/slow-data?refresh=1']);
});

test('plan errors retain stable codes and retry information instead of inferring unsupported courses', async () => {
  const { api } = apiHarness(() => Promise.resolve(jsonResponse({
    code: 'STUDY_PLAN_NOT_AVAILABLE', error: 'Lettura non riuscita', retryAfterMs: 45000,
  }, 404)));
  await assert.rejects(api.fetchCareerPlan(), error => error.code === 'STUDY_PLAN_NOT_AVAILABLE' && error.retryAfterMs === 45000);
});

test('partial slow synchronization preserves the failed section and updates the successful one', () => {
  const { mergeSlowData, slowStatusMessage } = loadTs('src/lib/slow-data.ts');
  const previous = { tasse: { paid: [{ amount: 42 }] }, prenotazioni: [{ materia: 'Vecchio appello' }] };
  const partial = {
    status: 'partial', taxes: { available: false, paid: [] }, prenotazioni: [{ materia: 'Nuovo appello' }],
    sections: { taxes: { status: 'error', stale: true }, appelli: { status: 'ready' } },
  };
  const merged = mergeSlowData(previous, partial);
  assert.equal(merged.tasse, previous.tasse);
  assert.equal(merged.prenotazioni[0].materia, 'Nuovo appello');
  assert.match(slowStatusMessage(partial), /Gli appelli Segrepass sono aggiornati/);
  assert.match(slowStatusMessage(partial), /ultimi dati disponibili/);
});

test('empty successful appelli clears old events while failed appelli does not', () => {
  const { mergeSlowData, slowRetryDelay } = loadTs('src/lib/slow-data.ts');
  const previous = { prenotazioni: [{ materia: 'Precedente' }] };
  const failed = { status: 'error', prenotazioni: [], sections: { appelli: { status: 'error' } }, retryAfterMs: 120000 };
  assert.equal(mergeSlowData(previous, failed).prenotazioni, previous.prenotazioni);
  assert.equal(mergeSlowData(previous, { status: 'ready', prenotazioni: [] }).prenotazioni.length, 0);
  assert.equal(slowRetryDelay(failed, 3000), 120000);
  assert.ok(slowRetryDelay({ status: 'partial', retryAfterMs: 1 }, 3000) >= 10000);
});

test('legacy ready payload with unavailable taxes remains partial and cannot turn into a zero balance', () => {
  const { mergeSlowData, slowSyncOutcome } = loadTs('src/lib/slow-data.ts');
  const incoming = { status: 'ready', taxes: { available: false, paid: [], pending: [] }, prenotazioni: [] };
  assert.equal(slowSyncOutcome(incoming), 'partial');
  assert.equal(mergeSlowData({ tasse: incoming.taxes }, incoming).tasse, undefined);
});

test('a late 401 from bootstrap cannot expire a newly logged-in account', async () => {
  let finishBootstrap;
  const { api, window } = apiHarness(url => url.endsWith('/bootstrap')
    ? new Promise(resolve => { finishBootstrap = resolve; })
    : Promise.resolve(jsonResponse({ authenticated: true, profile: { id: 'new-user' } })));
  let expiredEvents = 0;
  window.addEventListener('segrepass:session-expired', () => { expiredEvents += 1; });
  const bootstrap = api.fetchBootstrap();
  await api.loginAPI({ codiceFiscale: 'new@example.test', password: 'test' });
  finishBootstrap(jsonResponse({ code: 'SESSION_EXPIRED' }, 401));
  await assert.rejects(bootstrap, error => error.name === 'AbortError');
  assert.equal(expiredEvents, 0);
});

test('personal requests are not reused across account changes', async () => {
  const finish = [];
  const { api } = apiHarness(url => url.endsWith('/metriche')
    ? new Promise(resolve => { finish.push(resolve); })
    : Promise.resolve(jsonResponse({ authenticated: true })));
  const oldMetrics = api.fetchMetriche();
  await api.loginAPI({ codiceFiscale: 'next@example.test', password: 'test' });
  const newMetrics = api.fetchMetriche();
  assert.equal(finish.length, 2);
  finish[0](jsonResponse({ anagrafica: { matricola: 'old' } }));
  finish[1](jsonResponse({ anagrafica: { matricola: 'new' } }));
  await assert.rejects(oldMetrics, error => error.name === 'AbortError');
  assert.equal((await newMetrics).anagrafica.matricola, 'new');
});

test('logout failures remain visible and preserve the current snapshot', async () => {
  const { api, storage } = apiHarness(() => Promise.resolve(jsonResponse({ error: 'unavailable' }, 503)));
  storage.set('segrepass:cache:bootstrap:v1', 'snapshot');
  await assert.rejects(api.logoutAPI(), error => error.status === 503);
  assert.equal(storage.get('segrepass:cache:bootstrap:v1'), 'snapshot');
});

test('explicit cache cleanup removes profile preferences as well as bootstrap data', () => {
  const { api, storage } = apiHarness(() => Promise.resolve(jsonResponse({})));
  storage.set('segrepass:cache:bootstrap:v1', 'private');
  storage.set('unidesk_profile_prefs_v1:USER', 'private');
  storage.set('theme', 'dark');
  api.clearClientCache();
  assert.deepEqual([...storage.keys()], ['theme']);
});

test('calendar dates reject impossible dates and retain Italian day/month order', () => {
  const { parseCalendarDate } = loadTs('src/lib/calendar-date.ts');
  for (const invalid of ['2026-02-30', '31/04/2026', '2026-13-01', '99/11/2026']) assert.equal(parseCalendarDate(invalid), null);
  const date = parseCalendarDate('05/11/2026');
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 5);
  assert.equal(parseCalendarDate('2028-02-29').getDate(), 29);
});

test('day counts remain calendar days across the autumn daylight-saving change', () => {
  const { calendarDayDifference } = loadTs('src/lib/calendar-date.ts');
  // Dates with different UTC offsets reproduce the extra hour in the Rome autumn transition.
  assert.equal(calendarDayDifference(new Date('2026-10-26T12:00:00+01:00'), new Date('2026-10-25T12:00:00+01:00')), 1);
  assert.equal(calendarDayDifference(new Date(2026, 9, 26), new Date(2026, 9, 24)), 2);
});

test('reminders retain exams and payments due today after midnight', async () => {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 10, 19, 15, 30])); }
  }
  const react = requireModule('react');
  const { renderToStaticMarkup } = requireModule('react-dom/server');
  const calendar = loadTs('src/lib/calendar-date.ts', { Date: FixedDate });
  const { default: NotificationCenter } = loadTs('src/components/NotificationCenter.tsx', {
    Date: FixedDate,
    require: name => name === '@/lib/calendar-date' ? calendar : name === '@/lib/api' ? {} : requireModule(name),
  });
  const html = renderToStaticMarkup(react.createElement(NotificationCenter, {
    exams: [{ id: 'today', materia: 'Esame oggi', dataAppello: '19/11/2026' }],
    taxes: { pending: [{ description: 'Pagamento oggi', dueDate: '2026-11-19' }] },
  }));
  assert.match(html, /Esame oggi/);
  assert.match(html, /Pagamento oggi/);
});

function workerHarness() {
  const listeners = new Map();
  const notifications = [];
  const opened = [];
  const origin = 'https://unidesk.example.test';
  const self = {
    location: { origin },
    addEventListener: (name, listener) => listeners.set(name, listener),
    registration: { showNotification: async (title, options) => notifications.push({ title, options }) },
  };
  vm.runInNewContext(readFileSync(new URL('public/sw.js', root), 'utf8'), {
    self, URL, Response,
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) },
  });
  return { listeners, notifications, opened, origin };
}

test('the service worker leaves health, API, dynamic and RSC requests outside static caching', () => {
  const { listeners, origin } = workerHarness();
  for (const path of ['/api/profile', '/health', '/future-private-route', '/?_rsc=state']) {
    let intercepted = false;
    listeners.get('fetch')({
      request: { url: `${origin}${path}`, method: 'GET', mode: 'cors' },
      respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, false, path);
  }
});

test('push links cannot navigate outside the app, including protocol-relative URLs', async () => {
  const { listeners, notifications, origin } = workerHarness();
  for (const url of ['//evil.example/path', 'https://evil.example/path', '/\\evil.example/path', 'javascript:alert(1)']) {
    let completion;
    listeners.get('push')({ data: { json: () => ({ url }) }, waitUntil: promise => { completion = promise; } });
    await completion;
    assert.equal(notifications.at(-1).options.data.url, `${origin}/`);
  }
});

test('notification clicks validate older saved notification targets again', async () => {
  const { listeners, opened, origin } = workerHarness();
  let completion;
  listeners.get('notificationclick')({
    notification: { close() {}, data: { url: '//evil.example' } },
    waitUntil: promise => { completion = promise; },
  });
  await completion;
  assert.equal(opened[0], `${origin}/`);
});
