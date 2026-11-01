const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimetableFilters } = require('../lib/timetable-filters');

const profile = {
  course_id: 'DE3', course_name: 'INGEGNERIA INFORMATICA',
  current_course_year: 2, channel: 'FG1:A-DIL', surname_initial: 'C'
};

test('senza parametri usa anno, canale e corso del profilo', () => {
  const f = buildTimetableFilters(profile, {});
  assert.equal(f.studyYear, 2);
  assert.equal(f.channel, 'FG1:A-DIL');
  assert.equal(f.courseId, 'DE3');
  assert.equal(f.semester, null);
  assert.equal(f.academicYear, null);
  assert.equal(f.surnameInitial, 'C');
});

test('i parametri della richiesta prevalgono sul profilo', () => {
  const f = buildTimetableFilters(profile, { studyYear: '3', semester: '2', channel: ' A-D ', academicYear: '2025/26' });
  assert.equal(f.studyYear, 3);
  assert.equal(f.semester, 2);
  assert.equal(f.channel, 'A-D');
  assert.equal(f.academicYear, '2025/26');
});

test('canale mancante ma iniziale presente: usa EasyAcademy', () => {
  const f = buildTimetableFilters({ ...profile, channel: null }, {});
  assert.equal(f.channel, '');
  assert.equal(f.surnameInitial, 'C');
});

test('canale e iniziale mancanti: 409 onboarding', () => {
  assert.throws(() => buildTimetableFilters({ ...profile, channel: null, surname_initial: null }, {}), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'PROFILE_ONBOARDING_REQUIRED');
    return true;
  });
});

test('valori non validi: 400', () => {
  assert.throws(() => buildTimetableFilters(profile, { semester: '3' }), error => error.status === 400);
  assert.throws(() => buildTimetableFilters(profile, { studyYear: '0' }), error => error.status === 400);
  assert.throws(() => buildTimetableFilters(profile, { academicYear: 'abc' }), error => error.status === 400);
});

test('senza corso nel profilo: 409', () => {
  assert.throws(() => buildTimetableFilters({ channel: 'A-D', current_course_year: 1 }, {}), error => error.status === 409);
});
