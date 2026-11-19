const test = require('node:test');
const assert = require('node:assert/strict');
const { calcolaMetriche, simulaBaseLaurea, normalizzaEsame } = require('../lib/metriche');
const { normalizeEsami, buildMetriche, parseGrade } = require('../services/career-metrics');

test('esclude giudizi negativi e voti fuori scala dai CFU acquisiti', () => {
  const records = [
    { Insegnamento: 'Analisi', Voto: '30L', CFU: '6' },
    { Insegnamento: 'Lingua', Voto: 'NON IDONEO', CFU: '3' },
    { Insegnamento: 'Fisica', Voto: 'NON SUPERATO', CFU: '9' },
    { Insegnamento: 'Informatica', Voto: '230', CFU: '12' },
    null,
    { Insegnamento: 'Tirocinio', Esito: 'IDONEO', CFU: '2,5' }
  ];
  assert.deepEqual(normalizeEsami(records).map(exam => exam.materia), ['Analisi', 'Tirocinio']);
  assert.equal(calcolaMetriche(records).cfuAcquisiti, 8.5);
  assert.equal(buildMetriche(records).cfuAcquisiti, 8.5);
  assert.equal(normalizeEsami(records)[0].lode, true);
});

test('gestisce CFU negativi, input assenti e totale CFU non valido', () => {
  assert.equal(normalizeEsami(null).length, 0);
  assert.equal(normalizeEsami([{ Insegnamento: 'Analisi', Voto: '28', CFU: '-6' }])[0].cfu, 0);
  assert.equal(buildMetriche([], { cfuTotali: 0 }).avanzamentoCFU, 0);
  assert.equal(calcolaMetriche([], 0).cfuTotali, 180);
  for (const raw of ['230', '-28', '17', '31', 'NON SUPERATO 28']) assert.equal(parseGrade(raw).voto, null);
  assert.equal(parseGrade('28/30').voto, 28);
});

test('mantiene codice, lode e alias dei record gia normalizzati', () => {
  const result = calcolaMetriche([{ Nome: 'Analisi', codice: 'A1', voto: 30, isLode: true, cfu: 9 }]);
  assert.equal(result.esami[0].codice, 'A1');
  assert.equal(result.esami[0].lode, true);
  assert.equal(result.esami[0].data, null);
});

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
