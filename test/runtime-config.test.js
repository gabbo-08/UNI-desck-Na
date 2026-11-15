const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRuntimeConfig } = require('../lib/runtime-config');

const productionBase = {
  NODE_ENV: 'production',
  FRONTEND_URL: 'https://app.example.test',
  PUBLIC_ORIGIN: 'https://app.example.test',
  COOKIE_SECURE: 'true',
  TRUST_PROXY: '1',
  CRED_KEY: '0123456789abcdef'.repeat(4),
};

test('runtime config accetta DEBUG_SCRAPER=false in produzione', () => {
  const result = validateRuntimeConfig({ ...productionBase, DEBUG_SCRAPER: 'false' });
  assert.deepEqual(result.errors, []);
});

test('runtime config rifiuta DEBUG_SCRAPER attivo in produzione', () => {
  const result = validateRuntimeConfig({ ...productionBase, DEBUG_SCRAPER: 'true' });
  assert.ok(result.errors.includes('DEBUG_SCRAPER deve essere disabilitato in produzione'));
});

test('runtime config rifiuta CRED_KEY mancante o TRUST_PROXY globale', () => {
  const result = validateRuntimeConfig({ ...productionBase, CRED_KEY: '', TRUST_PROXY: 'true' });
  assert.ok(result.errors.some(error => error.includes('CRED_KEY')));
  assert.ok(result.errors.some(error => error.includes('TRUST_PROXY')));
});

test('runtime config rifiuta un proxy non interpretabile', () => {
  const result = validateRuntimeConfig({ ...productionBase, TRUST_PROXY: 'trusted-proxy.example' });
  assert.ok(result.errors.some(error => error.includes('TRUST_PROXY')));
});
