// Fixture costruita dalle righe visibili nello screenshot di ESIS (dati non personali).
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePianoTable } = require('../lib/piano-normalizer');
const { matchStudyPlan } = require('../lib/matching');

const table = {
  headers: ['Codice', 'Descrizione insegnamento', 'Anno corso', 'Esito', 'Voto', 'CFU', 'Propedeuticità - Data', 'Settore'],
  rows: [
    ['00102', 'ANALISI MATEMATICA I', 'PRIMO', 'Superato', '25', '9', 'Prop: No - 24/02/2026', 'MAT/05'],
    ['00103', 'FISICA GENERALE I', 'PRIMO', '', '', '6', 'Prop: No -', 'FIS/01'],
    ['00499', 'FONDAMENTI DI INFORMATICA', 'PRIMO', 'Superato', '20', '12', 'Prop: No - 30/03/2026', ''],
    ['16588', 'A SCELTA AUTONOMA DELLO STUDENTE', 'TERZO', '', '', '18', 'Prop: No -', '0'],
    ['00117', 'FISICA GENERALE II', 'SECONDO', '', '', '6', 'Prop: Si -', 'FIS/01'],
    ['', '', '', '', '', '', '', ''],
    ['00102', 'ANALISI MATEMATICA I', 'PRIMO', '', '', '9', '', 'MAT/05']
  ]
};

test('normalizza gli insegnamenti dalle intestazioni', () => {
  const courses = normalizePianoTable(table);
  assert.equal(courses.length, 5);
  const fisica = courses.find(c => c.code === '00103');
  assert.equal(fisica.name, 'FISICA GENERALE I');
  assert.equal(fisica.cfu, 6);
  assert.equal(fisica.year, 1);
  assert.equal(fisica.studyYear, 1);
  assert.equal(fisica.study_year, 1);
  assert.equal(fisica.sector, 'FIS/01');
  assert.equal(fisica.courseType, 'mandatory');
});

test('anni in parole e settore 0 gestiti', () => {
  const courses = normalizePianoTable(table);
  assert.equal(courses.find(c => c.code === '00117').year, 2);
  assert.equal(courses.find(c => c.code === '00117').studyYear, 2);
  assert.equal(courses.find(c => c.code === '16588').sector, null);
  assert.equal(courses.find(c => c.code === '00499').sector, null);
});

test('scelta libera riconosciuta come elettivo', () => {
  const free = normalizePianoTable(table).find(c => c.code === '16588');
  assert.equal(free.courseType, 'elective');
  assert.equal(free.electiveGroup, 'free_choice');
});

test('tabella senza colonne necessarie: nessun insegnamento', () => {
  assert.deepEqual(normalizePianoTable({ headers: ['Foo', 'Bar'], rows: [['a', 'b']] }), []);
  assert.deepEqual(normalizePianoTable(null), []);
});

test('matching: esame superato in carriera segna l insegnamento come passato', () => {
  const courses = normalizePianoTable(table);
  const passedExams = [{ codice: '00102', materia: 'ANALISI MATEMATICA I', cfu: 9, voto: 25 }];
  const result = matchStudyPlan({ planCourses: courses, passedExams, selectedElectiveIds: [] });
  assert.equal(result.courses.find(c => c.code === '00102').status, 'passed');
  assert.equal(result.courses.find(c => c.code === '00103').status, 'missing');
});
