process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSupportAdminRouter } = require('../routes/support-admin');
const { db } = require('../db');
const { upsertStudentProfile, saveSupportReport } = require('../db/repository');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/support-admin', createSupportAdminRouter({ SUPPORT_ADMIN_TOKEN: 'admin-secret' }));
  return app;
}

test('support admin resta disabilitato senza token corretto e restituisce descrizioni decifrate con token', async t => {
  const profileId = 'support-admin-profile';
  upsertStudentProfile(db, { id: profileId });
  saveSupportReport({
    id: 'support-report-1',
    profileId,
    category: 'bug',
    description: 'Il calendario non si aggiorna.',
    context: { route: '/agenda', screen: 'dashboard' }
  }, db);

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/support-admin/reports`;

  const hidden = await fetch(url);
  assert.equal(hidden.status, 404);
  const wrong = await fetch(url, { headers: { 'x-support-admin-token': 'wrong' } });
  assert.equal(wrong.status, 404);

  const response = await fetch(url, { headers: { authorization: 'Bearer admin-secret' } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].description, 'Il calendario non si aggiorna.');
  assert.equal(body.reports[0].context.route, '/agenda');
  assert.equal(body.reports[0].decryptable, true);
  assert.equal(Object.hasOwn(body.reports[0], 'description_ciphertext'), false);
});
