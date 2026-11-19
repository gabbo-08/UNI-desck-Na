const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAmount, parseDate, findPaymentTables, buildTaxesSummary } = require('../lib/taxes');

test('normalizzare tasse non trasforma una lettura fallita in un riepilogo valido', () => {
  const result = buildTaxesSummary({ available: false, reason: 'TAXES_DATA_NOT_AVAILABLE', stale: true, paid: [{ importo: 16 }] });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'TAXES_DATA_NOT_AVAILABLE');
  assert.equal(result.stale, true);
  assert.equal(result.summary.totalPaid, 16);
  assert.deepEqual(buildTaxesSummary(null).pending, []);
});

test('legge scadenze con intestazioni abbreviate usate dalle tabelle del portale', () => {
  const result = findPaymentTables([{
    source: 'debiti', headers: ['Causale', 'Data di scad.', 'Importo'],
    records: [{ Causale: 'Contributo', 'Data di scad.': '30/11/2026', Importo: '130,00' }],
  }]);
  assert.equal(result.pending[0].dueDate, '2026-11-30');
});

test('la pagina debiti prevale sulla colonna Data e non inventa un codice tributo', () => {
  const result = findPaymentTables([{
    source: 'debiti', headers: ['Causale', 'Importo', 'Data'],
    records: [{ Causale: 'Rata ancora da pagare', Importo: '123,45', Data: '15/12/2026' }],
  }]);
  assert.equal(result.paid.length, 0);
  assert.equal(result.pending.length, 1);
  assert.equal(result.summary.totalPending, 123.45);
  assert.equal(result.pending[0].dueDate, '2026-12-15');
  assert.equal(result.pending[0].codice, undefined);
});

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

test('le scadenze impossibili non diventano date di pagamento valide', () => {
  for (const invalid of ['31/11/2026', '2026-02-30', '2026-00-10', '00/12/2026']) assert.equal(parseDate(invalid), null);
  assert.equal(parseDate('29/02/2028'), '2028-02-29');
});

test('findPaymentTables riconosce le varianti dell’intestazione della scadenza', () => {
  const result = findPaymentTables([
    {
      source: 'debiti',
      headers: ['Causale', 'Data di scadenza', 'Importo da pagare'],
      records: [{
        Causale: 'Contributo regionale',
        'Data di scadenza': '30/11/2026',
        'Importo da pagare': '130,00'
      }]
    },
    {
      source: 'debiti',
      headers: ['Descrizione', 'Scadenza pagamento', 'Importo'],
      records: [{
        Descrizione: 'Seconda rata',
        'Scadenza pagamento': '15/12/2026',
        Importo: '200,00'
      }]
    }
  ]);

  assert.equal(result.pending.length, 2);
  assert.deepEqual(result.pending.map(item => item.dueDate), ['2026-11-30', '2026-12-15']);
  assert.equal(result.pending[0].description, 'Contributo regionale');
  assert.equal(result.pending[0].amount, 130);
  assert.equal(result.summary.nextDeadline, '2026-11-30');
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

test('buildTaxesSummary crea gli alias usati da Agenda e Scadenze', () => {
  const result = buildTaxesSummary({
    inDebito: [{ descrizione: 'Tassa', importo: '90,00', scadenzaISO: '2026-12-01' }]
  });

  assert.equal(result.pending[0].description, 'Tassa');
  assert.equal(result.pending[0].amount, 90);
  assert.equal(result.pending[0].dueDate, '2026-12-01');
  assert.equal(result.summary.nextDeadline, '2026-12-01');
});
