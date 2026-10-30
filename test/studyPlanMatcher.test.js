const test = require('node:test');
const assert = require('node:assert/strict');
const {
  matchStudyPlan,
  normalizeCourseName,
  nameSimilarity,
  DEFAULT_THRESHOLD
} = require('../lib/matching');

test('normalizeCourseName converte in minuscolo, rimuove accenti e numerali romani', () => {
  assert.equal(normalizeCourseName('CÀLCOLO DÌFFERENZIALE'), 'calcolo differenziale');
  assert.equal(normalizeCourseName('Analisi Matematica III'), 'analisi matematica 3');
  assert.equal(normalizeCourseName('Fisica Generale II'), 'fisica generale 2');
  assert.equal(normalizeCourseName('Istituzioni di Diritto I'), 'istituzioni di diritto 1');
  assert.equal(normalizeCourseName('Programmazione & Algoritmi (A-K)'), 'programmazione algoritmi a k');
});

test('nameSimilarity confronta nomi identici, simili e diversi', () => {
  assert.equal(nameSimilarity('Fisica 1', 'Fisica 1'), 1);
  assert.ok(nameSimilarity('SISTEMI OPERATIVI', 'Sistemi Operativi e Reti') > 0.5);
  assert.ok(nameSimilarity('Chimica', 'Diritto Privato') < DEFAULT_THRESHOLD);
  assert.equal(nameSimilarity('', null), 0);
});

const planCourses = [
  { id: 1, courseCode: 'DE1001', courseName: 'Analisi Matematica I', cfu: 9, courseType: 'mandatory' },
  { id: 2, courseCode: 'DE1002', courseName: 'Fisica I', cfu: 9, courseType: 'mandatory' },
  {
    id: 3,
    courseCode: 'DE1003',
    courseName: 'Reti di Calcolatori',
    cfu: 6,
    courseType: 'elective',
    electiveGroup: 'grp1',
    electiveRequiredCfu: 6
  }
];

test('associa un esame tramite codice corso', () => {
  const result = matchStudyPlan({
    planCourses,
    passedExams: [{ codice: 'DE1001', materia: 'Analisi Matematica I', cfu: 9, voto: 28 }]
  });
  const matched = result.courses.find(course => course.id === 1);

  assert.equal(matched.status, 'passed');
  assert.equal(matched.matchMethod, 'course_code');
  assert.equal(result.summary.passedCourses, 1);
});

test('usa il fuzzy name quando il codice manca', () => {
  const result = matchStudyPlan({
    planCourses,
    passedExams: [{ materia: 'ANALISI MATEMATICA 1', cfu: 9, voto: 30 }]
  });
  const matched = result.courses.find(course => course.id === 1);

  assert.equal(matched.status, 'passed');
  assert.equal(matched.matchMethod, 'fuzzy_name');
});

test('segnala needs_review quando i CFU non corrispondono', () => {
  const result = matchStudyPlan({
    planCourses,
    passedExams: [{ codice: 'DE1001', materia: 'Analisi Matematica I', cfu: 6, voto: 25 }]
  });
  const matched = result.courses.find(course => course.id === 1);

  assert.equal(matched.status, 'needs_review');
  assert.equal(result.summary.reviewCourses, 1);
});

test('calcola il riepilogo degli esami a scelta', () => {
  const result = matchStudyPlan({
    planCourses,
    passedExams: [{ codice: 'DE1003', materia: 'Reti di Calcolatori', cfu: 6, voto: 30 }],
    selectedElectiveIds: [3]
  });
  const group = result.electiveGroups.find(item => item.id === 'grp1');

  assert.equal(group.passedCfu, 6);
  assert.equal(group.remainingCfu, 0);
});
