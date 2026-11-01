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
  assert.equal(result.paid[0].dataPagamento, '10/10/2024');
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

  test('findPaymentTables riconosce la tabella reale dei versamenti effettuati', () => {
    const result = findPaymentTables([
      {
        headers: ['Anno Accademico', 'Data', 'Codice', 'Descrizione', 'Importo', 'Origine', 'Iscrizioni'],
        records: [
          {
            'Anno Accademico': '2026/2027',
            Data: '01/09/2026',
            Codice: 'P001',
            Descrizione: 'ISCRIZIONE I RATA',
            Importo: '€ 16,00',
            Origine: 'Banca',
            Iscrizioni: 'vedi'
          }
        ]
      },
      {
        headers: ['Anno Accademico', 'Data Scadenza', 'Codice', 'Descrizione', 'Importo', 'Iscrizioni'],
        records: [
          {
            'Anno Accademico': '2026/2027',
            'Data Scadenza': '31/10/2026',
            Codice: '7001',
            Descrizione: 'CONTRIBUTO REGIONALE',
            Importo: '€ 130,00',
            Iscrizioni: 'vedi'
          }
        ]
      }
    ]);

    assert.equal(result.paid.length, 1);
    assert.equal(result.paid[0].dataPagamento, '01/09/2026');
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].stato, 'DA_PAGARE');
  });

  test('findPaymentTables elimina righe duplicate provenienti da pagine ESIS ripetute', () => {
    const table = {
      headers: ['Anno Accademico', 'Data', 'Codice', 'Descrizione', 'Importo', 'Origine'],
      records: [{
        'Anno Accademico': '2026/2027',
        Data: '01/09/2026',
        Codice: 'P001',
        Descrizione: 'ISCRIZIONE I RATA',
        Importo: '€ 16,00',
        Origine: 'Banca'
      }]
    };
    const result = findPaymentTables([table, table]);
    assert.equal(result.paid.length, 1);
    assert.equal(result.summary.totalPaid, 16);
  });

  test('findPaymentTables ignora tabelle generiche con importo ma senza dati di pagamento', () => {
    const result = findPaymentTables([
      {
        headers: ['Importo', 'Descrizione'],
        records: [
          { Importo: '130,00', Descrizione: '' },
          { Importo: '218,00', Descrizione: 'Contributo generico' }
        ]
      }
    ]);
    assert.equal(result.paid.length, 0);
    assert.equal(result.pending.length, 0);
  });

  assert.equal(summary.paid.length, 2);
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.summary.totalPaid, 125.5);
  assert.equal(summary.summary.totalPending, 10);
});
