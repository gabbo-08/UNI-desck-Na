const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAmount, parseDate, findPaymentTables, buildTaxesSummary } = require('../lib/taxes');

test('parseAmount converte formati europei e standard', () => {
  assert.equal(parseAmount('1.250,50 €'), 1250.5);
  assert.equal(parseAmount('€ 156,00'), 156);
  assert.equal(parseAmount('140,00'), 140);
  assert.equal(parseAmount('156.50'), 156.5);
  assert.equal(parseAmount(200), 200);
});

test('parseAmount restituisce 0 per valori invalidi', () => {
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('N.D.'), 0);
  assert.equal(parseAmount(null), 0);
});

test('parseDate converte date italiane e mantiene ISO', () => {
  assert.equal(parseDate('15/10/2025'), '2025-10-15');
  assert.equal(parseDate('05.01.2026'), '2026-01-05');
  assert.equal(parseDate('2025-10-15'), '2025-10-15');
  assert.equal(parseDate('non-una-data'), null);
  assert.equal(parseDate(null), null);
});

test('findPaymentTables distingue pagamenti effettuati e debiti', () => {
  const result = findPaymentTables([
    {
      headers: ['Causale Versamento', 'Data Pagamento', 'Importo Euro'],
      records: [
        { 'Causale Versamento': 'I Rata A.A. 2024/2025', 'Data Pagamento': '10/10/2024', 'Importo Euro': '156,00' }
      ]
    },
    {
      headers: ['Causale', 'Data Scadenza', 'Importo da Pagare'],
      records: [
        { Causale: 'II Rata A.A. 2024/2025', 'Data Scadenza': '30/04/2026', 'Importo da Pagare': '300,00' }
      ]
    }
  ]);

  assert.equal(result.paid.length, 1);
  assert.equal(result.pending.length, 1);
  assert.equal(result.paid[0].stato, 'PAGATO');
  assert.equal(result.pending[0].stato, 'DA_PAGARE');
  assert.equal(result.summary.totalPaid, 156);
  assert.equal(result.summary.totalPending, 300);
  assert.equal(result.summary.nextDeadline, '2026-04-30');
});

test('buildTaxesSummary normalizza snapshot paid/pending e alias italiani', () => {
  const summary = buildTaxesSummary({
    paid: [{ importo: '100' }, { importo: 25.5 }],
    inDebito: [{ importo: 10 }]
  });

  assert.equal(summary.paid.length, 2);
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.summary.totalPaid, 125.5);
  assert.equal(summary.summary.totalPending, 10);
});
