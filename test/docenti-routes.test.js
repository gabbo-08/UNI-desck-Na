const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDocentiRouter } = require('../routes/docenti');

async function withDocentiApi(t, loadDocenti) {
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: 'profile-test' };
    next();
  }, createDocentiRouter({ loadDocenti }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  return path => fetch(`http://127.0.0.1:${port}/api/docenti${path}`);
}

test('restituisce gli array attesi dal frontend', async t => {
  const request = await withDocentiApi(t, async () => ({
    available: true,
    subscriptions: [{ courseName: 'Analisi I' }],
    bookedExams: [{ courseName: 'Analisi I' }],
    groups: [{ name: 'A' }],
    tests: [{ name: 'Test intermedio' }],
    announcements: [{ title: 'Avviso' }]
  }));

  const subscriptions = await request('/subscriptions');
  assert.equal(subscriptions.status, 200);
  assert.deepEqual(await subscriptions.json(), [{ courseName: 'Analisi I' }]);

  const announcements = await request('/announcements');
  assert.deepEqual(await announcements.json(), [{ title: 'Avviso' }]);

  const groups = await request('/groups');
  assert.deepEqual(await groups.json(), [{ name: 'A' }]);

  const tests = await request('/tests');
  assert.deepEqual(await tests.json(), [{ name: 'Test intermedio' }]);

  const summary = await request('/summary');
  assert.deepEqual(await summary.json(), {
    announcements: [{ title: 'Avviso' }],
    subscriptions: [{ courseName: 'Analisi I' }],
    bookedExams: [{ courseName: 'Analisi I' }],
    groups: [{ name: 'A' }],
    tests: [{ name: 'Test intermedio' }]
  });
});

test('restituisce 502 con codice quando lo scraping fallisce', async t => {
  const request = await withDocentiApi(t, async () => {
    const error = new Error('portale offline');
    error.code = 'DOCENTI_TIMEOUT';
    throw error;
  });

  const response = await request('/booked-exams');
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.code, 'DOCENTI_TIMEOUT');
});

test('segnala con 424 quando i dati Docenti non sono disponibili', async t => {
  const request = await withDocentiApi(t, async () => ({ available: false, reason: 'DOCENTI_DATA_NOT_FOUND' }));

  const response = await request('/subscriptions');
  const body = await response.json();

  assert.equal(response.status, 424);
  assert.equal(body.code, 'DOCENTI_DATA_NOT_FOUND');
  assert.match(body.error, /Nessun dato Docenti/);
});

test('condivide il caricamento del dettaglio docente e serve il secondo hit dalla cache', async t => {
  let calls = 0;
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: 'profile-detail-test' };
    next();
  }, createDocentiRouter({
    fetchTeacherDetail: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return {
        profilo: { id: 'teacher-1', nome: 'Docente Test' },
        materiali: { pubblico: [], ftp: [], riservato: [] },
        appelli: [],
        iscrizioni: []
      };
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/docenti/teacher/teacher-1`;
  const [first, second] = await Promise.all([fetch(url), fetch(url)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls, 1);

  const started = Date.now();
  const cached = await fetch(url);
  assert.equal(cached.status, 200);
  assert.ok(Date.now() - started < 500);
});
