// lib/timetable-matching.js
// Confronta le lezioni EasyAcademy con le iscrizioni Docenti dello studente.
// Regole:
// - materia: uguaglianza dopo normalizzazione (niente "includes": "FISICA GENERALE I" non deve
//   coincidere con "FISICA GENERALE II");
// - docente: il cognome deve comparire nei docenti della lezione (ordine indifferente,
//   "ZOPPOLI ANTONELLO" = "ANTONELLO ZOPPOLI").
// - le lezioni sono mantenute e marcate per rendere visibili discrepanze e mancate iscrizioni.
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

function sameTeacher(eventTeachers, professor, knownProfessors = []) {
  if (!isUsableProfessor(professor)) return false;
  const wanted = [...new Set(nameTokens(professor))];
  if (wanted.length === 0) return false;

  return (eventTeachers || []).some(teacher => {
    const present = new Set(nameTokens(teacher));
    if (wanted.length === 1) return present.has(wanted[0]);
    const identityTokens = [...new Set([wanted[0], wanted[wanted.length - 1]])];
    if (identityTokens.every(token => present.has(token))) return true;

    // Il portale a volte mostra il solo cognome. Accettalo soltanto quando
    // esiste una lista esplicita dei docenti del corso e quel cognome è unico.
    if (present.size !== 1 || knownProfessors.length === 0 || !identityTokens.some(token => present.has(token))) return false;
    const competing = knownProfessors.filter(other => normalizeText(other) !== normalizeText(professor))
      .some(other => nameTokens(other).some(token => present.has(token)));
    return !competing;
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
  events = Array.isArray(events) ? events : [];
  if (!surnameInitial(studentSurname)) {
    return { events, filter: { applied: false, reason: 'SURNAME_INITIAL_MISSING', hidden: 0 } };
  }
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
    return { events: (events || []).map(event => ({ ...event, enrollmentStatus: 'unknown', enrolledProfessor: null })), filter: { applied: false, reason: 'NO_ENROLLMENT_DATA', hidden: 0 } };
  }

  const studentSurname = options.surnameInitial || '';
  const kept = events.map(event => {
    const matchingSubject = usable.filter(subscription => sameSubject(event.courseName, subscription.courseName));
    if (matchingSubject.length === 0) return { ...event, enrollmentStatus: 'not_enrolled', enrolledProfessor: null };
    const match = matchingSubject.find(subscription => {
      const rangeSource = `${event.courseName || ''} ${event.channel || ''} ${event.selectedGroup || ''} ${event.coursePath || ''}`;
      if (surnameMatchesRange(studentSurname, rangeSource)) return true;
      return !surnameRange(rangeSource) && sameTeacher(
        event.teachers,
        subscription.professor,
        matchingSubject.map(item => item.professor).filter(isUsableProfessor)
      );
    });
    return match
      ? { ...event, enrollmentStatus: 'confirmed', enrolledProfessor: match.professor || null }
      : { ...event, enrollmentStatus: 'different_teacher', enrolledProfessor: matchingSubject.map(s => s.professor).filter(Boolean).join(', ') || null };
  });

  return {
    events: kept,
    filter: { applied: true, reason: 'ANNOTATED', hidden: 0 }
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
