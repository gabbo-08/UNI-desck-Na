const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterTimetableEvents,
  sameSubject,
  sameTeacher,
  surnameMatchesRange,
  surnameRange,
  filterEventsBySurnameRange
} = require('../lib/timetable-matching');

const lezione = (courseName, teachers, startTime = '08:30', date = '2026-11-02') =>
  ({ courseName, teachers, date, startTime, endTime: '10:30', room: 'X', campus: null });

test('materie diverse con stesso prefisso non coincidono', () => {
  assert.equal(sameSubject('FISICA GENERALE I', 'FISICA GENERALE II'), false);
  assert.equal(sameSubject('Fisica Generale I', 'FISICA  GENERALE I (P-Z)'), true);
  assert.equal(sameSubject('Diritto del lavoro (05 Cognomi B-C)', 'Diritto del lavoro'), true);
});

test('il range Cognomi viene riconosciuto e confrontato con il cognome dello studente', () => {
  assert.deepEqual(surnameRange('DIRITTO DEL LAVORO (05 Cognomi B-C)'), { start: 'B', end: 'C' });
  assert.equal(surnameMatchesRange('C', 'DIRITTO DEL LAVORO (05 Cognomi B-C)'), true);
  assert.equal(surnameMatchesRange('Z', 'DIRITTO DEL LAVORO (05 Cognomi B-C)'), false);
  assert.equal(surnameMatchesRange('Z', 'DIRITTO DEL LAVORO (05 Cognomi S-A)'), true);
  assert.equal(surnameMatchesRange('M', 'DIRITTO DEL LAVORO (05 Cognomi S-A)'), false);
});

test('docente: richiede nome e cognome, salvo cognome unico nell’elenco del corso', () => {
  assert.equal(sameTeacher(['ZOPPOLI ANTONELLO'], 'ANTONELLO ZOPPOLI'), true);
  assert.equal(sameTeacher(['ZOPPOLI ANTONELLO'], 'OFELIA PISANTI'), false);
  assert.equal(sameTeacher(['ROSSI LUIGI'], 'ROSSI MARIO'), false);
  assert.equal(sameTeacher(['ZOPPOLI'], 'ANTONELLO ZOPPOLI'), false);
  assert.equal(sameTeacher(['ZOPPOLI'], 'ANTONELLO ZOPPOLI', ['ANTONELLO ZOPPOLI']), true);
  assert.equal(sameTeacher(['ROSSI'], 'MARIO ROSSI', ['MARIO ROSSI', 'LUIGI ROSSI']), false);
  assert.equal(sameTeacher(['ZOPPOLI ANTONELLO'], 'Docente non indicato'), false);
});

test('mantiene le cattedre EasyAcademy e marca il docente corrispondente all’iscrizione', () => {
  const events = [
    lezione('DIRITTO DEL LAVORO (05 Cognomi B-C)', ['ZOPPOLI ANTONELLO']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi D-F)', ['DELFINO MASSIMILIANO']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi G-M)', ['VENDITTI LUCIA']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi N-R)', ['TEBANO LAURA']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi S-A)', ['GARGIULO UMBERTO'])
  ];
  const subs = [{ courseName: 'Diritto del lavoro', professor: 'ANTONELLO ZOPPOLI' }];
  const out = filterTimetableEvents(events, subs, { surnameInitial: 'C' });
  assert.equal(out.events.length, 5);
  assert.deepEqual(out.events[0].teachers, ['ZOPPOLI ANTONELLO']);
  assert.equal(out.events[0].enrollmentStatus, 'confirmed');
  assert.equal(out.events.filter(event => event.enrollmentStatus === 'different_teacher').length, 4);
  assert.equal(out.filter.hidden, 0);
  assert.equal(out.filter.applied, true);
});

test('materia seguita ma docente diverso resta visibile e viene segnalata', () => {
  const events = [lezione('DIRITTO DEL LAVORO', ['DELFINO MASSIMILIANO']), lezione('DIRITTO DEL LAVORO', ['VENDITTI LUCIA'])];
  const out = filterTimetableEvents(events, [{ courseName: 'Diritto del lavoro', professor: 'ZOPPOLI ANTONELLO' }]);
  assert.equal(out.events.length, 2);
  assert.ok(out.events.every(event => event.enrollmentStatus === 'different_teacher'));
  assert.equal(out.filter.hidden, 0);
});

test('il range classifica la cattedra dello studente e conserva le alternative', () => {
  const events = [
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE A']), channel: '05 Cognomi B-C' },
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE B']), channel: '05 Cognomi D-F' }
  ];
  const out = filterTimetableEvents(events, [{ courseName: 'Diritto del lavoro', professor: 'PROFESSORE DIVERSO' }],
    { surnameInitial: 'C' });
  assert.equal(out.events.length, 2);
  assert.deepEqual(out.events[0].teachers, ['DOCENTE A']);
  assert.equal(out.events[0].enrollmentStatus, 'confirmed');
  assert.equal(out.events[1].enrollmentStatus, 'different_teacher');
});

test('il range viene applicato anche senza snapshot Docenti', () => {
  const events = [
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE A']), channel: '05 Cognomi B-C' },
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE B']), channel: '05 Cognomi D-F' }
  ];
  const out = filterEventsBySurnameRange(events, 'C');
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].channel, '05 Cognomi B-C');
  assert.equal(out.filter.hidden, 1);
});

test('il gruppo selezionato viene usato come range quando il nome materia è pulito', () => {
  const events = [
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE A']), selectedGroup: '05 Cognomi B-C' },
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE B']), selectedGroup: '05 Cognomi S-A' }
  ];
  const withGroup = events.map(event => ({ ...event, channel: event.selectedGroup }));
  const out = filterEventsBySurnameRange(withGroup, 'S');
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].channel, '05 Cognomi S-A');
});

test('materia non presente nel piano resta visibile con stato non iscritto', () => {
  const out = filterTimetableEvents([lezione('ISTITUZIONI DI DIRITTO PRIVATO', ['ROSSI MARIO'])],
    [{ courseName: 'Diritto del lavoro', professor: 'ZOPPOLI ANTONELLO' }]);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].enrollmentStatus, 'not_enrolled');
  assert.equal(out.filter.hidden, 0);
});

test('senza iscrizioni: lezioni visibili e stato non verificabile', () => {
  const events = [lezione('DIRITTO DEL LAVORO', ['ZOPPOLI ANTONELLO'])];
  const out = filterTimetableEvents(events, []);
  assert.deepEqual(out.events, events.map(event => ({ ...event, enrollmentStatus: 'unknown', enrolledProfessor: null })));
  assert.deepEqual(out.filter, { applied: false, reason: 'NO_ENROLLMENT_DATA', hidden: 0 });
});

test('stesse materie in orari diversi evidenziano docente compatibile e alternativa', () => {
  const events = [
    lezione('DIRITTO DEL LAVORO', ['ZOPPOLI ANTONELLO'], '08:30'),
    lezione('DIRITTO DEL LAVORO', ['DELFINO MASSIMILIANO'], '10:30')
  ];
  const out = filterTimetableEvents(events, [{ courseName: 'Diritto del lavoro', professor: 'ZOPPOLI ANTONELLO' }]);
  assert.equal(out.events.length, 2);
  assert.equal(out.events[0].startTime, '08:30');
  assert.equal(out.events[0].enrollmentStatus, 'confirmed');
  assert.equal(out.events[1].enrollmentStatus, 'different_teacher');
  assert.equal(out.filter.hidden, 0);
});
