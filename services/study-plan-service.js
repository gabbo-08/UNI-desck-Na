// services/study-plan-service.js
// Sceglie da dove prendere il piano di studi:
//   1. manifesto locale (DB), se esiste per corso e coorte;
//   2. altrimenti la tabella letta da Segrepass (Dati Carriera > Piano di Studi) nell'ultimo login;
//   3. altrimenti null: la rotta risponde che il piano non è disponibile.

const { getStudyPlan, getPlanCourses } = require('../db/repository');
const { getPianoSnapshot } = require('./career-snapshots');

function resolveStudyPlan(db, profile, profileId) {
  const manifest = getStudyPlan(db, profile.course_id, profile.cohort_year);
  if (manifest) {
    return { source: 'manifest', plan: manifest, courses: getPlanCourses(db, manifest.id) };
  }

  const fromSegrepass = getPianoSnapshot(profileId);
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

module.exports = { resolveStudyPlan };
