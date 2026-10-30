process.env.JWT_SECRET = 'test-cookie-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  COOKIE_NAME,
  parseCookies,
  readAuthToken,
  setAuthCookie,
  clearAuthCookie
} = require('../lib/cookies');
const { authMiddleware } = require('../middleware/auth');

test('parseCookies decodifica i cookie e ignora valori malformati', () => {
  const cookies = parseCookies(`a=1; ${COOKIE_NAME}=abc%20def; vuoto; b=2`);

  assert.equal(cookies.a, '1');
  assert.equal(cookies[COOKIE_NAME], 'abc def');
  assert.equal(cookies.b, '2');
  assert.equal(cookies.vuoto, undefined);
});

test('readAuthToken legge solo il cookie dedicato', () => {
  assert.equal(readAuthToken({ headers: { cookie: `x=1; ${COOKIE_NAME}=token-123` } }), 'token-123');
  assert.equal(readAuthToken({ headers: {} }), null);
});

test('il cookie viene impostato httpOnly con path root', () => {
  let stored = null;
  setAuthCookie({ cookie: (name, value, options) => { stored = { name, value, options }; } }, 'token-123');

  assert.equal(stored.name, COOKIE_NAME);
  assert.equal(stored.value, 'token-123');
  assert.equal(stored.options.httpOnly, true);
  assert.equal(stored.options.path, '/');
});

test('clearAuthCookie rimuove il cookie senza maxAge', () => {
  let stored = null;
  clearAuthCookie({ clearCookie: (name, options) => { stored = { name, options }; } }, 'token');

  assert.equal(stored.name, COOKIE_NAME);
  assert.equal('maxAge' in stored.options, false);
});

test('authMiddleware accetta il token dal cookie httpOnly', () => {
  const token = jwt.sign({ sub: 'profile-1' }, 'test-cookie-secret');
  const req = { headers: { cookie: `${COOKIE_NAME}=${token}` } };
  let statusCode = null;

  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; }
  };

  let nextCalled = false;
  authMiddleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user.sub, 'profile-1');
  assert.equal(statusCode, null);
});

test('authMiddleware non accetta token passati in query string', () => {
  const token = jwt.sign({ sub: 'profile-1' }, 'test-cookie-secret');
  let statusCode = null;

  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; }
  };

  authMiddleware({ headers: {}, query: { token } }, res, () => {});
  assert.equal(statusCode, 401);
});
