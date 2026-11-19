const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  csrfProtection,
  normalizeOrigin,
  requestOrigin,
  allowedOrigins
} = require('../lib/csrf');

function execute(overrides = {}) {
  const req = { method: 'POST', headers: {}, protocol: 'http', ...overrides };
  const result = { statusCode: 200, body: null, nextCalled: false };

  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };

  csrfProtection(req, res, () => { result.nextCalled = true; });
  return result;
}

test('normalizeOrigin accetta solo origini http(s)', () => {
  assert.equal(normalizeOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeOrigin('https://app.example.com/path?x=1'), 'https://app.example.com');
  assert.equal(normalizeOrigin('javascript:alert(1)'), null);
  assert.equal(normalizeOrigin('non-un-url'), null);
  assert.equal(normalizeOrigin(undefined), null);
});

test('requestOrigin preferisce Origin e ricade su Referer', () => {
  assert.equal(requestOrigin({ headers: { origin: 'https://a.example' } }), 'https://a.example');
  assert.equal(requestOrigin({ headers: { referer: 'https://b.example/page' } }), 'https://b.example');
  assert.equal(requestOrigin({ headers: {} }), null);
  assert.equal(requestOrigin({ headers: { origin: 'null', referer: 'http://localhost:3000/' } }), null);
  assert.equal(requestOrigin({ headers: { origin: 'invalid', referer: 'http://localhost:3000/' } }), null);
});

test('i metodi safe non richiedono Origin', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const result = execute({ method });
    assert.equal(result.nextCalled, true);
    assert.equal(result.statusCode, 200);
  }
});

test('le richieste con Bearer non sono esenti dai controlli CSRF', () => {
  const result = execute({ headers: { authorization: 'bearer abc123' } });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
});

test('una richiesta mutante senza Origin/Referer viene bloccata', () => {
  const result = execute();
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.code, 'CSRF_ORIGIN_REQUIRED');
});

test('un origine non consentita viene bloccata', () => {
  const result = execute({ headers: { origin: 'https://evil.example' } });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.code, 'CSRF_ORIGIN_INVALID');
});

test('le origini del frontend e same-origin sono consentite', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
    assert.equal(execute({ headers: { origin } }).nextCalled, true, origin);
  }

  const sameOrigin = execute({
    headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' }
  });
  assert.equal(sameOrigin.nextCalled, true);
});

test('il Referer con path è un fallback valido', () => {
  const result = execute({ headers: { referer: 'http://localhost:3000/dashboard' } });
  assert.equal(result.nextCalled, true);
});

test('FRONTEND_URL aggiunge origini consentite', t => {
  const previous = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://app.example.com,https://second.example';
  t.after(() => {
    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
  });

  assert.equal(execute({ headers: { origin: 'https://app.example.com' } }).nextCalled, true);
  assert.equal(execute({ headers: { origin: 'https://second.example' } }).nextCalled, true);
  assert.equal(execute({ headers: { origin: 'https://other.example' } }).statusCode, 403);
});

test('X-Forwarded-Host non è fidato senza TRUST_PROXY', () => {
  const result = execute({
    headers: {
      host: '127.0.0.1:3001',
      'x-forwarded-host': 'evil.example',
      origin: 'http://evil.example'
    }
  });
  assert.equal(result.statusCode, 403);
});

test('TRUST_PROXY=0 non abilita X-Forwarded-Host', t => {
  const previous = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '0';
  t.after(() => {
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });

  const result = execute({
    headers: {
      host: '127.0.0.1:3001',
      'x-forwarded-host': 'evil.example',
      origin: 'http://evil.example'
    }
  });
  assert.equal(result.statusCode, 403);
});

test('allowedOrigins include default, configurazione e same-origin', t => {
  const previous = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://app.example.com';
  t.after(() => {
    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
  });

  const origins = allowedOrigins({ headers: { host: 'api.local:4000' }, protocol: 'http' });
  assert.equal(origins.has('http://localhost:3000'), true);
  assert.equal(origins.has('https://app.example.com'), true);
  assert.equal(origins.has('http://api.local:4000'), true);
});

test('il middleware è realmente applicato in una app Express', async t => {
  const app = express();
  app.use(express.json());
  app.use(csrfProtection);
  app.post('/mutate', (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/mutate`;

  const blocked = await fetch(url, { method: 'POST' });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'CSRF_ORIGIN_REQUIRED');

  const allowed = await fetch(url, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { ok: true });

  const withBearer = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(withBearer.status, 403);

  const sameOrigin = await fetch(url, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(sameOrigin.status, 200);
});
