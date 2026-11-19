const test = require('node:test');
const assert = require('node:assert/strict');
const { loginRateLimitKey } = require('../lib/login-rate-limit');

test('il limite per account distingue le email sulla stessa rete e non le espone', () => {
  const first = loginRateLimitKey({ ip: '127.0.0.1', body: { email: 'primo@studenti.unina.it' } });
  const second = loginRateLimitKey({ ip: '127.0.0.1', body: { email: 'secondo@studenti.unina.it' } });
  assert.notEqual(first, second);
  assert.equal(first.includes('primo@studenti.unina.it'), false);
});

test('alias e maiuscole della stessa email condividono il limite', () => {
  const base = { ip: '127.0.0.1' };
  const expected = loginRateLimitKey({ ...base, body: { email: 'studente@studenti.unina.it' } });
  assert.equal(loginRateLimitKey({ ...base, body: { codiceFiscale: ' STUDENTE@STUDENTI.UNINA.IT ' } }), expected);
  assert.equal(loginRateLimitKey({ ...base, body: { identifier: 'studente@studenti.unina.it' } }), expected);
  assert.equal(loginRateLimitKey({ ...base, body: { email: 'studente@studenti.unina.it', codiceFiscale: 'ignored' } }), expected);
});
