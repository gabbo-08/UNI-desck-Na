const test = require('node:test');
const assert = require('node:assert/strict');
const { calcolaMetriche, simulaBaseLaurea, normalizzaEsame } = require('../lib/metriche');

test('normalizzaEsame mappa un record grezzo con sinonimi di chiavi', () => {
  const exam = normalizzaEsame({
    'Codice Insegnamento': 'A123',
    'Denominazione Attività': 'Ingeneria del Software',
    'Valutazione/Voto': '30 e Lode',
    'Crediti CFU': '9',
    'Data Verbalizzazione': '12/02/2025'
  });

  assert.equal(exam.codice, 'A123');
  assert.equal(exam.materia, 'Ingeneria del Software');
  assert.equal(exam.voto, 30);
  assert.equal(exam.lode, true);
  assert.equal(exam.cfu, 9);
  assert.equal(exam.data, '12/02/2025');
});

test('normalizzaEsame gestisce idoneità e giudizi non numerici', () => {
  const exam = normalizzaEsame({ Insegnamento: 'Tirocinio', Esito: 'IDONEO', CFU: '3' });

  assert.equal(exam.voto, null);
  assert.equal(exam.giudizio, 'IDONEO');
  assert.equal(exam.cfu, 3);
});

test('calcolaMetriche restituisce valori di default senza esami', () => {
  const metrics = calcolaMetriche([]);

  assert.equal(metrics.cfuAcquisiti, 0);
  assert.equal(metrics.mediaAritmetica, '--');
  assert.equal(metrics.mediaPonderata, '--');
  assert.equal(metrics.baseLaurea, '--');
});

test('calcola media aritmetica, ponderata e base di laurea', () => {
  const metrics = calcolaMetriche([
    { Insegnamento: 'Esame A', Voto: '24', CFU: '6' },
    { Insegnamento: 'Esame B', Voto: '30', CFU: '12' },
    { Insegnamento: 'Inglese', Voto: 'IDONEO', CFU: '3' }
  ], 180);

  assert.equal(metrics.cfuAcquisiti, 21);
  assert.equal(metrics.mediaAritmetica, 27);
  assert.equal(metrics.mediaPonderata, 28);
  assert.equal(metrics.baseLaurea, 102.67);
  assert.equal(metrics.avanzamentoCFU, 12);
});

test('simulaBaseLaurea proietta gli esami futuri', () => {
  assert.equal(simulaBaseLaurea([{ voto: 24, cfu: 6 }], [{ voto: 30, cfu: 6 }]), 99);
  assert.equal(simulaBaseLaurea([], []), 0);
});
