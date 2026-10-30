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
    announcements: [{ title: 'Avviso' }]
  }));

  const subscriptions = await request('/subscriptions');
  assert.equal(subscriptions.status, 200);
  assert.deepEqual(await subscriptions.json(), [{ courseName: 'Analisi I' }]);

  const announcements = await request('/announcements');
  assert.deepEqual(await announcements.json(), [{ title: 'Avviso' }]);
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
