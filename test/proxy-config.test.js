const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTrustProxy } = require('../lib/proxy-config');

test('TRUST_PROXY è disattivato per default e può essere esplicitamente disabilitato', () => {
  for (const value of [undefined, '', 'false', 'off', '0']) assert.equal(parseTrustProxy(value), false);
});

test('TRUST_PROXY supporta booleani, hop e reti fidate esplicite', () => {
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.deepEqual(parseTrustProxy('10.0.0.0/8, 192.168.0.0/16'), ['10.0.0.0/8', '192.168.0.0/16']);
});
