process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildStudentProfile,
  calculateCourseYear,
  determinaCanale
} = require('../services/profile-extractor');

const NOW = new Date('2026-10-15T00:00:00.000Z');

test('costruisce il profilo dai dati anagrafici di Segrepass', () => {
  const profile = buildStudentProfile({
    codiceCorso: 'DE3',
    corsoDiLaurea: 'Ingegneria Informatica',
    annoImmatricolazione: 2025,
    annoCorso: 2
  }, { now: NOW });

  assert.equal(profile.courseId, 'DE3');
  assert.equal(profile.courseName, 'INGEGNERIA INFORMATICA');
  assert.equal(profile.cohortYear, 2025);
  assert.equal(profile.currentCourseYear, 2);
  assert.equal(profile.channel, null);
  assert.equal(profile.surnameInitial, null);
});

test('non inventa valori quando i dati mancano', () => {
  assert.deepEqual(buildStudentProfile({}, { now: NOW }), {
    courseId: null,
    courseName: null,
    cohortYear: null,
    currentCourseYear: null,
    channel: null,
    surnameInitial: null
  });
});

test('calcola anno di corso e canale senza valori di ripiego', () => {
  assert.equal(calculateCourseYear(2025, 3, NOW), 2);
  assert.equal(calculateCourseYear(null, 3, NOW), 1);
  assert.equal(determinaCanale('Cacace'), 'A-D');
  assert.equal(determinaCanale(''), null);
});
