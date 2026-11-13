const test = require('node:test');
const assert = require('node:assert/strict');
const { redactForDebug } = require('../scraper/segrepass');

test('redactForDebug oscura PIN, CNP, anagrafica e tasse nel payload', () => {
  const payload = {
    anagrafica: { matricola: '01234567', nomeCompleto: 'Mario Rossi', codiceNumericoPersonale: '99999' },
    pin: '12345',
    codiceNumericoPersonale: '99999',
    cfuAcquisiti: 30,
    mediaPonderata: 27.5,
    tasse: { paid: [{ importo: 156 }], pending: [{ importo: 50 }] },
    esami: [{ materia: 'Analisi I', voto: 28 }]
  };

  const redacted = redactForDebug(payload);
  assert.equal(redacted.anagrafica, '[REDACTED]');
  assert.equal(redacted.pin, '[REDACTED]');
  assert.equal(redacted.codiceNumericoPersonale, '[REDACTED]');
  assert.equal(redacted.tasse, '[REDACTED]');
  // Le statistiche aggregate non identificative restano utili per il debug.
  assert.equal(redacted.cfuAcquisiti, 30);
  assert.equal(redacted.mediaPonderata, 27.5);
  // L'oggetto originale non viene modificato.
  assert.equal(payload.pin, '12345');
  assert.equal(payload.anagrafica.matricola, '01234567');
});

test('redactForDebug maschera gli identificatori annidati negli array', () => {
  const redacted = redactForDebug({
    records: [{ matricola: '01234567', codiceFiscale: 'RSSMRA00A00H501Z', materia: 'Analisi' }]
  });
  assert.equal(redacted.records[0].matricola, '[REDACTED]');
  assert.equal(redacted.records[0].codiceFiscale, '[REDACTED]');
  assert.equal(redacted.records[0].materia, 'Analisi');
});