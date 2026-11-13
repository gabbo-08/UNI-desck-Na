const test = require('node:test');
const assert = require('node:assert/strict');
const { isStrongCredentialKey, validateOrigins, runChecks } = require('../check-env');

test('check-env rifiuta chiavi deboli e accetta una chiave esadecimale sufficientemente casuale', () => {
  assert.equal(isStrongCredentialKey('a'.repeat(64)), false);
  assert.equal(isStrongCredentialKey('0123456789abcdef'.repeat(4)), true);
});

test('check-env richiede HTTPS e origini esplicite in produzione', () => {
  assert.equal(validateOrigins(['http://localhost:3000'], { production: true }), false);
  assert.equal(validateOrigins(['https://app.example.test'], { production: true }), true);
  const result = runChecks({
    NODE_ENV: 'production',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'https://app.example.test',
    TRUST_PROXY: '1',
    PUBLIC_ORIGIN: 'https://app.example.test'
  });
  assert.equal(result.checks.every(item => item.ok), true);
});

test('check-env consente sviluppo locale con HTTP ma non abilita debug in produzione', () => {
  const development = runChecks({
    NODE_ENV: 'development',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'http://localhost:3000'
  });
  assert.equal(development.checks.every(item => item.ok), true);

  const production = runChecks({
    NODE_ENV: 'production',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'https://app.example.test',
    TRUST_PROXY: '1',
    PUBLIC_ORIGIN: 'https://app.example.test',
    DEBUG_SCRAPER: '1'
  });
  assert.equal(production.checks.find(item => item.name === 'DEBUG_SCRAPER').ok, false);
});
