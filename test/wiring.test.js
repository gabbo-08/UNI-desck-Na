process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

test('i moduli critici si caricano senza dipendenze mancanti', () => {
  assert.doesNotThrow(() => {
    require('../routes/auth');
    require('../routes/docenti');
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

