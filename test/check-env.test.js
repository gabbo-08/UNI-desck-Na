const test = require('node:test');
const assert = require('node:assert/strict');
const { isStrongCredentialKey, validateOrigins, runChecks } = require('../check-env');
const { validateRuntimeConfig } = require('../lib/runtime-config');

test('check-env e runtime rifiutano le stesse configurazioni di origini, cookie e porta', () => {
  const base = {
    NODE_ENV: 'production', CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'https://app.example.test', PUBLIC_ORIGIN: 'https://app.example.test', TRUST_PROXY: '1'
  };
  for (const override of [
    { PUBLIC_ORIGIN: 'http://app.example.test' },
    { PUBLIC_ORIGIN: 'https://app.example.test/path' },
    { PUBLIC_ORIGIN: 'https://user:password@app.example.test' },
    { COOKIE_SAMESITE: 'invalid' },
    { PORT: '65536' },
    { PORT: 'not-a-port' },
    { PERSONAL_DATA_RETENTION_DAYS: 'invalid' },
    { PERSONAL_DATA_RETENTION_DAYS: '0' },
    { DOCENTI_CACHE_RETENTION_HOURS: 'Infinity' },
    { TEACHER_CACHE_RETENTION_DAYS: '1e300' },
    { NODE_ENV: 'development', FRONTEND_URL: 'https://app.example.test/path' },
    { NODE_ENV: 'development', COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }
  ]) {
    const env = { ...base, ...override };
    assert.ok(runChecks(env).checks.some(item => !item.ok), JSON.stringify(override));
    assert.ok(validateRuntimeConfig(env).errors.length > 0, JSON.stringify(override));
  }
  assert.equal(runChecks({ ...base, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }).checks.every(item => item.ok), true);
});

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

test('check-env segnala FRONTEND_URL assente in sviluppo fail-closed', () => {
  const result = runChecks({
    NODE_ENV: 'development',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    ALLOW_DYNAMIC_ORIGIN: 'false'
  });
  assert.ok(result.warnings.some(warning => warning.includes('FRONTEND_URL')));
});

test('check-env rifiuta TRUST_PROXY globale in produzione', () => {
  const result = runChecks({
    NODE_ENV: 'production',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'https://app.example.test',
    TRUST_PROXY: 'true',
    PUBLIC_ORIGIN: 'https://app.example.test'
  });
  assert.equal(result.checks.find(item => item.name === 'TRUST_PROXY').ok, false);
});

test('check-env accetta solo proxy espliciti e reti valide', () => {
  const valid = runChecks({
    NODE_ENV: 'production',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'https://app.example.test',
    TRUST_PROXY: '10.0.0.0/8,127.0.0.1',
    PUBLIC_ORIGIN: 'https://app.example.test'
  });
  assert.equal(valid.checks.find(item => item.name === 'TRUST_PROXY').ok, true);

  const invalid = runChecks({
    NODE_ENV: 'production',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'https://app.example.test',
    TRUST_PROXY: 'trusted-proxy.example',
    PUBLIC_ORIGIN: 'https://app.example.test'
  });
  assert.equal(invalid.checks.find(item => item.name === 'TRUST_PROXY').ok, false);

  const excessiveHopCount = runChecks({
    NODE_ENV: 'production',
    CRED_KEY: '0123456789abcdef'.repeat(4),
    FRONTEND_URL: 'https://app.example.test',
    TRUST_PROXY: '99',
    PUBLIC_ORIGIN: 'https://app.example.test'
  });
  assert.equal(excessiveHopCount.checks.find(item => item.name === 'TRUST_PROXY').ok, false);
});
