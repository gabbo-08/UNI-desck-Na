process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supportRoutes = require('../routes/support');
const { db } = require('../db');
const { upsertStudentProfile } = require('../db/repository');

test('accetta una segnalazione tecnica senza esporre il contenuto nella risposta', async t => {
  const profileId = 'support-profile';
  upsertStudentProfile(db, { id: profileId });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: profileId };
    req.requestId = 'request-1234';
    next();
  });
  app.use('/api/support', supportRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/support/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'bug', description: 'Il calendario non si aggiorna dopo il refresh.', context: { route: '/agenda', code: 'SYNC_TIMEOUT' } })
  });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.accepted, true);
  assert.equal(body.requestId, 'request-1234');
  assert.equal(Object.hasOwn(body, 'description'), false);
  assert.ok(db.prepare('SELECT 1 FROM SupportReports WHERE profile_id = ?').get(profileId));
});

test('rifiuta segnalazioni troppo corte o categorie non previste', async t => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { sub: 'support-invalid' }; next(); });
  app.use('/api/support', supportRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/support/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'credential', description: 'ciao' })
  });
  assert.equal(response.status, 400);
});
