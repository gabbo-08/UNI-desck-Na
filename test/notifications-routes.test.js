process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const router = require('../routes/notifications');
const { db } = require('../db');
const { upsertStudentProfile } = require('../db/repository');

async function appFor(t) {
  upsertStudentProfile(db, { id: 'push-profile' });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { sub: 'push-profile' }; next(); });
  app.use('/api/notifications', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/notifications`;
}

test('rifiuta una sottoscrizione push priva di chiavi', async t => {
  const base = await appFor(t);
  const response = await fetch(`${base}/subscribe`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: { endpoint: 'https://push.example.test/x' } })
  });
  assert.equal(response.status, 400);
});

test('salva e cancella una sottoscrizione push senza restituire il payload', async t => {
  const base = await appFor(t);
  const subscription = { endpoint: 'https://push.example.test/subscription-1', keys: { p256dh: 'p256dh-value', auth: 'auth-value' } };
  const created = await fetch(`${base}/subscribe`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription })
  });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { subscribed: true });
  const stored = db.prepare('SELECT subscription_ciphertext FROM PushSubscriptions WHERE profile_id = ?').get('push-profile');
  assert.ok(stored?.subscription_ciphertext);
  assert.equal(stored.subscription_ciphertext.includes('p256dh-value'), false);
  assert.equal(stored.subscription_ciphertext.includes('auth-value'), false);
  const deleted = await fetch(`${base}/subscribe`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint })
  });
  assert.equal(deleted.status, 204);
});
