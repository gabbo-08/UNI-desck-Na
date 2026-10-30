process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

test('i moduli critici si caricano senza dipendenze mancanti', () => {
  assert.doesNotThrow(() => {
    require('../routes/auth');
    require('../routes/session');
    require('../routes/docenti');
    require('../routes/career-taxes');
    require('../middleware/auth');
    require('../services/student-session');
    require('../scraper/docenti');
  });
});

test('buildTaxesSummary normalizza paid/pending e calcola i totali', () => {
  const { buildTaxesSummary } = require('../lib/taxes');
  const result = buildTaxesSummary({
    paid: [{ importo: '100' }, { importo: 25.5 }],
    inDebito: [{ importo: 10 }]
  });

  assert.equal(result.paid.length, 2);
  assert.equal(result.pending.length, 1);
  assert.equal(result.summary.totalPaid, 125.5);
  assert.equal(result.summary.totalPending, 10);
});

test('le credenziali di sessione scadono e non vengono restituite dopo il TTL', () => {
  const store = require('../utils/sessionStore');
  store.setCredentials('profile-test', { username: 'u', password: 'p' }, 1);

  return new Promise(resolve => setTimeout(resolve, 10)).then(() => {
    assert.equal(store.getCredentials('profile-test'), null);
  });
});
