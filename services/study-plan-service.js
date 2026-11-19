// services/study-plan-service.js
// Sceglie da dove prendere il piano di studi:
//   1. manifesto locale (DB), se esiste per corso e coorte;
//   2. altrimenti la tabella letta da Segrepass (Dati Carriera > Piano di Studi) nell'ultimo login;
//   3. altrimenti null: la rotta risponde che il piano non è disponibile.

const { getStudyPlan, getPlanCourses } = require('../db/repository');
const { getPianoSnapshot } = require('./career-snapshots');

function getPersistedPiano(profile) {
  if (!profile?.piano_json) return null;
  try {
    const payload = JSON.parse(profile.piano_json);
    const courses = Array.isArray(payload) ? payload : payload?.courses;
    if (!Array.isArray(courses)) return null;
    if (!Array.isArray(payload) && (
      (payload.courseId && String(payload.courseId) !== String(profile.course_id || '')) ||
      (payload.cohortYear && Number(payload.cohortYear) !== Number(profile.cohort_year))
    )) return null;
    return courses;
  } catch {
    return null;
  }
}

function resolveStudyPlan(db, profile, profileId) {
  const manifest = getStudyPlan(db, profile.course_id, profile.cohort_year);
  if (manifest) {
    const courses = getPlanCourses(db, manifest.id);
    // An imported header without any courses must not hide the personal plan.
    if (courses.length) return { source: 'manifest', plan: manifest, courses };
  }

  // Persisted plans are bound to their original course/cohort. If the profile
  // changed, do not fall back to a snapshot from the previous course in RAM.
  const fromSegrepass = profile.piano_json ? getPersistedPiano(profile) : getPianoSnapshot(profileId);
  if (Array.isArray(fromSegrepass) && fromSegrepass.length > 0) {
    return {
      source: 'segrepass',
      plan: {
        id: null,
        course_id: profile.course_id,
        cohort_year: profile.cohort_year,
        course_name: profile.course_name || null
      },
      courses: fromSegrepass
    };
  }

  return null;
}

module.exports = { resolveStudyPlan, getPersistedPiano };
