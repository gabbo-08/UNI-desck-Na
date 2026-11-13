const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COOKIE_NAME,
  parseCookies,
  readAuthToken,
  setAuthCookie,
  clearAuthCookie
} = require('../lib/cookies');
const { authMiddleware } = require('../middleware/auth');
const { createServerSession } = require('../services/server-sessions');

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
  assert.equal(stored.options.sameSite, 'lax');
  assert.equal(stored.options.secure, false);
  assert.equal(stored.options.maxAge, 7 * 24 * 60 * 60 * 1000);
});

test('il cookie è Secure in produzione', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    let options;
    setAuthCookie({ cookie: (_name, _value, value) => { options = value; } }, 'opaque-token');
    assert.equal(options.secure, true);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'lax');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('clearAuthCookie rimuove il cookie senza maxAge', () => {
  let stored = null;
  clearAuthCookie({ clearCookie: (name, options) => { stored = { name, options }; } }, 'token');

  assert.equal(stored.name, COOKIE_NAME);
  assert.equal('maxAge' in stored.options, false);
});

test('authMiddleware risolve la sessione opaca dal cookie senza esporre credenziali', () => {
  const session = createServerSession('profile-1', { password: 'must-not-be-in-req-user' });
  const req = { headers: { cookie: `${COOKIE_NAME}=${session.token}` } };
  let statusCode = null;

  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; }
  };

  let nextCalled = false;
  authMiddleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user.sub, 'profile-1');
  assert.equal(Object.hasOwn(req.user, 'password'), false);
  assert.equal(req.authSession.tokenHash, session.tokenHash);
  assert.equal(statusCode, null);
});

test('authMiddleware non accetta token passati in query string', () => {
  let statusCode = null;

  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; }
  };

  authMiddleware({ headers: {}, query: { token: 'A'.repeat(43) } }, res, () => {});
  assert.equal(statusCode, 401);
});

test('authMiddleware rifiuta Bearer e x-session-token', () => {
  let statusCode = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; }
  };
  authMiddleware({ headers: { authorization: 'Bearer token', 'x-session-token': 'opaque-token' } }, res, () => {});
  assert.equal(statusCode, 401);
});
