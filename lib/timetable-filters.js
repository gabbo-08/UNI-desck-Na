// lib/timetable-filters.js
// Costruisce i filtri dell'orario partendo dal profilo dello studente.
// I parametri della richiesta (studyYear, semester, channel, academicYear) sono opzionali:
// se mancano si usano i valori salvati nel profilo al login.

function httpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function buildTimetableFilters(profile = {}, query = {}) {
  const studyYear = query.studyYear === undefined || query.studyYear === ''
    ? Number(profile.current_course_year) || 1
    : Number(query.studyYear);
  if (!Number.isInteger(studyYear) || studyYear < 1 || studyYear > 20) {
    throw httpError('Anno di corso non valido.', 400, 'INVALID_STUDY_YEAR');
  }

  const semester = query.semester === undefined || query.semester === ''
    ? null
    : Number(query.semester);
  if (semester !== null && ![1, 2].includes(semester)) {
    throw httpError('Il semestre deve essere 1 o 2.', 400, 'INVALID_SEMESTER');
  }

  const channel = String(query.channel === undefined ? profile.channel || '' : query.channel).trim();
  const surnameInitial = String(profile.surname_initial || '').trim().toUpperCase();
  if (!channel && !surnameInitial) {
    throw httpError('Imposta il canale o l’iniziale del cognome nel profilo.', 409, 'PROFILE_ONBOARDING_REQUIRED');
  }

  const academicYear = query.academicYear ? String(query.academicYear).trim() : null;
  if (academicYear && !/^\d{4}(?:\/\d{2,4})?$/.test(academicYear)) {
    throw httpError('Anno accademico non valido.', 400, 'INVALID_ACADEMIC_YEAR');
  }

  const courseId = profile.course_id ? String(profile.course_id).trim() : null;
  const courseName = profile.course_name ? String(profile.course_name).trim() : null;
  if (!courseId && !courseName) {
    throw httpError('Imposta il corso nel profilo.', 409, 'PROFILE_ONBOARDING_REQUIRED');
  }

  return {
    courseId,
    courseName,
    studyYear,
    semester,
    channel,
    academicYear,
    surnameInitial: surnameInitial || null
  };
}

module.exports = { buildTimetableFilters };
