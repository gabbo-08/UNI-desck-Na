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

test('docente: ordine nome/cognome indifferente e cognome sufficiente', () => {
  assert.equal(sameTeacher(['ZOPPOLI ANTONELLO'], 'ANTONELLO ZOPPOLI'), true);
  assert.equal(sameTeacher(['ZOPPOLI ANTONELLO'], 'OFELIA PISANTI'), false);
  assert.equal(sameTeacher(['ROSSI LUIGI'], 'ROSSI MARIO'), true);
  assert.equal(sameTeacher(['ZOPPOLI ANTONELLO'], 'Docente non indicato'), false);
});

test('5 lezioni di Diritto del Lavoro nello stesso orario: tiene solo quella del docente dello studente', () => {
  const events = [
    lezione('DIRITTO DEL LAVORO (05 Cognomi B-C)', ['ZOPPOLI ANTONELLO']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi D-F)', ['DELFINO MASSIMILIANO']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi G-M)', ['VENDITTI LUCIA']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi N-R)', ['TEBANO LAURA']),
    lezione('DIRITTO DEL LAVORO (05 Cognomi S-A)', ['GARGIULO UMBERTO'])
  ];
  const subs = [{ courseName: 'Diritto del lavoro', professor: 'ANTONELLO ZOPPOLI' }];
  const out = filterTimetableEvents(events, subs, { surnameInitial: 'C' });
  assert.equal(out.events.length, 1);
  assert.deepEqual(out.events[0].teachers, ['ZOPPOLI ANTONELLO']);
  assert.equal(out.events[0].enrollmentStatus, 'confirmed');
  assert.equal(out.filter.hidden, 4);
  assert.equal(out.filter.applied, true);
});

test('materia seguita ma docente diverso viene rimossa', () => {
  const events = [lezione('DIRITTO DEL LAVORO', ['DELFINO MASSIMILIANO']), lezione('DIRITTO DEL LAVORO', ['VENDITTI LUCIA'])];
  const out = filterTimetableEvents(events, [{ courseName: 'Diritto del lavoro', professor: 'ZOPPOLI ANTONELLO' }]);
  assert.equal(out.events.length, 0);
  assert.equal(out.filter.hidden, 2);
});

test('il range seleziona la cattedra anche quando il docente non coincide', () => {
  const events = [
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE A']), channel: '05 Cognomi B-C' },
    { ...lezione('DIRITTO DEL LAVORO', ['DOCENTE B']), channel: '05 Cognomi D-F' }
  ];
  const out = filterTimetableEvents(events, [{ courseName: 'Diritto del lavoro', professor: 'PROFESSORE DIVERSO' }],
    { surnameInitial: 'C' });
  assert.equal(out.events.length, 1);
  assert.deepEqual(out.events[0].teachers, ['DOCENTE A']);
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

test('materia non presente nel piano viene rimossa', () => {
  const out = filterTimetableEvents([lezione('ISTITUZIONI DI DIRITTO PRIVATO', ['ROSSI MARIO'])],
    [{ courseName: 'Diritto del lavoro', professor: 'ZOPPOLI ANTONELLO' }]);
  assert.equal(out.events.length, 0);
  assert.equal(out.filter.hidden, 1);
});

test('senza iscrizioni: lezioni invariate e filtro non applicato', () => {
  const events = [lezione('DIRITTO DEL LAVORO', ['ZOPPOLI ANTONELLO'])];
  const out = filterTimetableEvents(events, []);
  assert.equal(out.events, events);
  assert.deepEqual(out.filter, { applied: false, reason: 'NO_ENROLLMENT_DATA', hidden: 0 });
});

test('stesse materie in orari diversi mantengono solo il docente compatibile', () => {
  const events = [
    lezione('DIRITTO DEL LAVORO', ['ZOPPOLI ANTONELLO'], '08:30'),
    lezione('DIRITTO DEL LAVORO', ['DELFINO MASSIMILIANO'], '10:30')
  ];
  const out = filterTimetableEvents(events, [{ courseName: 'Diritto del lavoro', professor: 'ZOPPOLI ANTONELLO' }]);
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].startTime, '08:30');
  assert.equal(out.filter.hidden, 1);
});
