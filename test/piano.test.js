const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePianoHeader } = require('../scraper/piano');

test('ricava coorte e codice corso dall\'intestazione del piano', () => {
  const header = 'Insegnamenti del Piano: PIANO GENERALE (IMM. DAL 2025/26) (DE301)';

  assert.deepEqual(parsePianoHeader(header), {
    annoImmatricolazione: 2025,
    codiceCorso: 'DE3'
  });
});

test('supporta codici corso con lettere e cifre', () => {
  const header = 'Insegnamenti del Piano: PIANO (IMM. DAL 2024/25) (N461)';

  assert.deepEqual(parsePianoHeader(header), {
    annoImmatricolazione: 2024,
    codiceCorso: 'N46'
  });
});

test('restituisce null quando i dati non sono presenti', () => {
  assert.deepEqual(parsePianoHeader(''), {
    annoImmatricolazione: null,
    codiceCorso: null
  });
  assert.deepEqual(parsePianoHeader('Insegnamenti del Piano: PIANO GENERALE'), {
    annoImmatricolazione: null,
    codiceCorso: null
  });
});
