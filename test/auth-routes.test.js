process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'route-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const authRoutes = require('../routes/auth');
const { csrfProtection } = require('../lib/csrf');
const { db } = require('../db');
const { upsertStudentProfile } = require('../db/repository');

const ORIGIN = 'http://localhost:3000';

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

test('GET /session restituisce un nuovo token dal cookie', async t => {
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

  const cookieToken = jwt.sign({ sub: profileId }, 'route-test-secret', { expiresIn: '5m' });
  const response = await request('/session', {
    headers: { cookie: `segrepass_token=${cookieToken}` }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.profile.id, profileId);
  assert.equal(body.onboardingRequired, false);
  assert.equal(typeof body.token, 'string');
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i);
});

test('GET /session risponde 404 se il profilo non esiste', async t => {
  const request = await withAuthApi(t);
  const cookieToken = jwt.sign({ sub: 'missing-profile' }, 'route-test-secret');

  const response = await request('/session', {
    headers: { cookie: `segrepass_token=${cookieToken}` }
  });
  assert.equal(response.status, 404);
});

test('POST /logout cancella il cookie', async t => {
  const request = await withAuthApi(t);
  const response = await request('/logout', {
    method: 'POST',
    headers: { Origin: ORIGIN }
  });

  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie') || '', /segrepass_token=;/);
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
