process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const authRoutes = require('../routes/auth');
const { csrfProtection } = require('../lib/csrf');
const { db } = require('../db');
const { upsertStudentProfile } = require('../db/repository');
const { createServerSession } = require('../services/server-sessions');
const { COOKIE_NAME } = require('../lib/cookies');
const { toLoginDto } = require('../lib/dto');

const ORIGIN = 'http://localhost:3000';

test('il DTO login non espone il token opaco né campi interni del profilo', () => {
  const body = toLoginDto({
    token: 'opaque-secret',
    profileId: 'profile-1',
    profile: {
      id: 'profile-1', course_id: 'DE3', course_name: 'Informatica',
      carriera_json: '[private]', tasse_json: '[private]', email: 'private@example.test'
    },
    metriche: { esami: [] }
  });
  assert.equal(Object.hasOwn(body, 'token'), false);
  assert.equal(Object.hasOwn(body.profile, 'carriera_json'), false);
  assert.equal(Object.hasOwn(body.profile, 'email'), false);
});

async function withAuthApi(t) {
  const app = express();
  app.use(express.json());
  app.use(csrfProtection);
  app.use('/api/auth', authRoutes);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  return (path, options = {}) => fetch(`http://127.0.0.1:${port}/api/auth${path}`, options);
}

test('GET /session richiede il cookie httpOnly', async t => {
  const request = await withAuthApi(t);
  const response = await request('/session');
  assert.equal(response.status, 401);
});

test('GET /session restituisce un DTO profilo dal cookie senza token nel body', async t => {
  const request = await withAuthApi(t);
  const profileId = 'route-profile-1';
  upsertStudentProfile(db, {
    id: profileId,
    courseId: 'DE3',
    courseName: 'INGEGNERIA INFORMATICA',
    cohortYear: 2025,
    currentCourseYear: 2,
    channel: 'A-D'
  });

  const session = createServerSession(profileId, { codiceFiscale: profileId, password: 'secret' });
  const response = await request('/session', {
    headers: { cookie: `${COOKIE_NAME}=${session.token}` }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.profile.id, profileId);
  assert.equal(body.onboardingRequired, false);
  assert.equal(body.authenticated, true);
  assert.equal(Object.hasOwn(body, 'token'), false);
  assert.equal(Object.hasOwn(body.profile, 'carriera_json'), false);
});

test('GET /session risponde 404 se il profilo non esiste', async t => {
  const request = await withAuthApi(t);
  const cookieToken = createServerSession('missing-profile', { password: 'secret' });

  const response = await request('/session', {
    headers: { cookie: `${COOKIE_NAME}=${cookieToken.token}` }
  });
  assert.equal(response.status, 404);
});

test('POST /logout elimina la sessione e cancella il cookie', async t => {
  const request = await withAuthApi(t);
  const session = createServerSession('logout-profile', { password: 'secret' });
  const response = await request('/logout', {
    method: 'POST',
    headers: { Origin: ORIGIN, cookie: `${COOKIE_NAME}=${session.token}` }
  });

  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie') || '', new RegExp(`${COOKIE_NAME}=;`));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM Sessions WHERE token_hash = ?').get(session.tokenHash).count, 0);
});

test('POST /login senza Origin viene bloccato dal CSRF', async t => {
  const request = await withAuthApi(t);
  const response = await request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codiceFiscale: 'AAABBB00A00A000A', password: 'x' })
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, 'CSRF_ORIGIN_REQUIRED');
});

test('POST /login con Origin e body vuoto risponde 400 senza scraping', async t => {
  const request = await withAuthApi(t);
  const response = await request('/login', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /codice fiscale/i);
});

test('POST /login con Origin non consentito risponde 403', async t => {
  const request = await withAuthApi(t);
  const response = await request('/login', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 403);
});
