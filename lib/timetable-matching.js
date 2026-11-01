// lib/timetable-matching.js
// Confronta le lezioni EasyAcademy con le iscrizioni Docenti dello studente.
// Regole:
// - materia: uguaglianza dopo normalizzazione (niente "includes": "FISICA GENERALE I" non deve
//   coincidere con "FISICA GENERALE II");
// - docente: il cognome deve comparire nei docenti della lezione (ordine indifferente,
//   "ZOPPOLI ANTONELLO" = "ANTONELLO ZOPPOLI").
// - con dati di iscrizione disponibili, le lezioni non presenti nel piano o senza docente
//   compatibile vengono rimosse, non solo marcate.
// - se non ci sono dati di iscrizione, nessuna lezione viene nascosta.

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function subjectWithoutSurnameRange(value) {
  return String(value ?? '')
    .replace(/\(\s*\d+\s+cognomi?\s+[A-ZÀ-Ü](?:\s*[-–]\s*[A-ZÀ-Ü])?\s*\)/iu, '')
    .trim();
}

function sameSubject(eventName, subscriptionName) {
  const a = normalizeText(subjectWithoutSurnameRange(eventName));
  return a !== '' && a === normalizeText(subscriptionName);
}

function nameTokens(value) {
  return normalizeText(value).split(' ').filter(token => token.length >= 3);
}

function isUsableProfessor(value) {
  const text = normalizeText(value);
  return text !== '' && !/NON INDICATO|NON SPECIFICATO|DOCENTE/.test(text);
}

function sameTeacher(eventTeachers, professor) {
  if (!isUsableProfessor(professor)) return false;
  const wanted = [...new Set(nameTokens(professor))];
  if (wanted.length === 0) return false;
  const surnameCandidates = wanted.length === 1
    ? wanted
    : [wanted[0], wanted[wanted.length - 1]];

  return (eventTeachers || []).some(teacher => {
    const present = new Set(nameTokens(teacher));
    return surnameCandidates.some(token => present.has(token));
  });
}

function surnameInitial(value) {
  return normalizeText(value).replace(/[^A-Z]/g, '').slice(0, 1);
}

function surnameRange(value) {
  const match = String(value ?? '').match(
    /\(?\s*\d+\s+cognomi?\s+([A-ZÀ-Ü])(?:\s*[-–]\s*([A-ZÀ-Ü]))?\s*\)?/iu
  );
  if (!match) return null;

  const start = surnameInitial(match[1]);
  const end = surnameInitial(match[2] || match[1]);
  if (!start || !end) return null;
  return { start, end };
}

function surnameMatchesRange(studentSurname, eventName) {
  const initial = surnameInitial(studentSurname);
  const range = surnameRange(eventName);
  if (!initial || !range) return false;
  return range.start <= range.end
    ? initial >= range.start && initial <= range.end
    : initial >= range.start || initial <= range.end;
}

function filterEventsBySurnameRange(events, studentSurname) {
  const kept = (events || []).filter(event => {
    const rangeSource = `${event.courseName || ''} ${event.channel || ''} ${event.selectedGroup || ''} ${event.coursePath || ''}`;
    return !surnameRange(rangeSource) || surnameMatchesRange(studentSurname, rangeSource);
  });

  return {
    events: kept,
    filter: {
      applied: Boolean(studentSurname),
      reason: studentSurname ? 'SURNAME_RANGE' : 'SURNAME_INITIAL_MISSING',
      hidden: events.length - kept.length
    }
  };
}

/**
 * @param {Array} events        - lezioni EasyAcademy (courseName, teachers, date, startTime...)
 * @param {Array} subscriptions - iscrizioni Docenti (courseName, professor)
 * @param {object} options      - { surnameInitial } iniziale del cognome dello studente
 * @returns {{ events: Array, filter: { applied: boolean, reason: string, hidden: number } }}
 */
function filterTimetableEvents(events, subscriptions, options = {}) {
  const usable = (subscriptions || []).filter(s => s && normalizeText(s.courseName) !== '');
  if (usable.length === 0) {
    return { events, filter: { applied: false, reason: 'NO_ENROLLMENT_DATA', hidden: 0 } };
  }

  const studentSurname = options.surnameInitial || '';
  const kept = events
    .filter(event => usable.some(subscription => {
      if (!sameSubject(event.courseName, subscription.courseName)) return false;
      const rangeSource = `${event.courseName || ''} ${event.channel || ''} ${event.selectedGroup || ''} ${event.coursePath || ''}`;
      if (surnameMatchesRange(studentSurname, rangeSource)) return true;
      return !surnameRange(rangeSource) && sameTeacher(event.teachers, subscription.professor);
    }))
    .map(event => ({ ...event, enrollmentStatus: 'confirmed' }));

  return {
    events: kept,
    filter: { applied: true, reason: 'OK', hidden: events.length - kept.length }
  };
}

module.exports = {
  filterTimetableEvents,
  normalizeText,
  sameSubject,
  sameTeacher,
  surnameRange,
  surnameMatchesRange,
  subjectWithoutSurnameRange,
  filterEventsBySurnameRange
};
