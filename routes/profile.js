const express = require('express');
const { db } = require('../db');
const {
  getStudentProfile,
  updateStudentProfile,
  getStudyPlan,
  getSelectedElectiveIds,
  replaceSelectedElectives,
  clearSelectedElectives
} = require('../db/repository');

const router = express.Router();
const { toProfileDto } = require('../lib/dto');
const { writeProfilePrefsCookie } = require('../lib/profile-cookie');

function isConfigured(profile) {
  return Boolean(
    profile?.course_id && profile?.course_name && profile?.cohort_year
    && profile?.current_course_year && (profile?.channel || profile?.surname_initial)
  );
}

function parseProfileUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Il profilo deve essere un oggetto JSON.' };
  }
  const updates = {};
  const stringFields = ['courseId', 'courseName', 'channel', 'surnameInitial'];
  for (const field of stringFields) {
    if (!Object.hasOwn(body, field)) continue;
    if (body[field] !== null && (typeof body[field] !== 'string' || body[field].length > 120)) {
      return { error: `${field} deve essere una stringa di massimo 120 caratteri o null.` };
    }
    const value = typeof body[field] === 'string' ? body[field].trim() || null : null;
    updates[field] = field === 'courseId' || field === 'surnameInitial' ? value?.toUpperCase() || null : value;
  }

  for (const [field, min, max] of [['cohortYear', 1900, 2200], ['currentCourseYear', 1, 20]]) {
    if (!Object.hasOwn(body, field)) continue;
    if (body[field] !== null && (!Number.isInteger(Number(body[field])) || Number(body[field]) < min || Number(body[field]) > max)) {
      return { error: `${field} non valido.` };
    }
    updates[field] = body[field] === null ? null : Number(body[field]);
  }

  if (Object.hasOwn(body, 'selectedElectiveIds') &&
    (!Array.isArray(body.selectedElectiveIds) || body.selectedElectiveIds.length > 100 ||
      body.selectedElectiveIds.some(id => !Number.isInteger(Number(id)) || Number(id) < 1))) {
    return { error: 'selectedElectiveIds deve essere un array di identificativi positivi.' };
  }

  return { updates, selectedElectiveIds: body.selectedElectiveIds };
}

router.get('/', (req, res) => {
  const profile = getStudentProfile(db, req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
  return res.json({
    profile: toProfileDto(profile),
    selectedElectiveIds: getSelectedElectiveIds(db, req.user.sub),
    onboardingRequired: !isConfigured(profile)
  });
});

router.put('/', (req, res, next) => {
  try {
    const parsed = parseProfileUpdate(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const current = getStudentProfile(db, req.user.sub);
    if (!current) return res.status(404).json({ error: 'Profilo non trovato.' });
    const courseChanged = (Object.hasOwn(parsed.updates, 'courseId') && parsed.updates.courseId !== current.course_id) ||
      (Object.hasOwn(parsed.updates, 'cohortYear') && parsed.updates.cohortYear !== current.cohort_year);

    // Profilo e scelte sono un'unica modifica: un piano mancante o una scelta
    // non valida devono lasciare intatti entrambi, anche in caso di errore.
    const profile = db.transaction(() => {
      const updated = updateStudentProfile(db, req.user.sub, parsed.updates);
      if (courseChanged && !parsed.selectedElectiveIds) clearSelectedElectives(db, req.user.sub);

      if (parsed.selectedElectiveIds) {
        if (parsed.selectedElectiveIds.length === 0) {
          clearSelectedElectives(db, req.user.sub);
        } else {
          const plan = getStudyPlan(db, updated.course_id, updated.cohort_year);
          if (!plan) {
            const error = new Error('Carica prima il piano di studi per salvare gli esami a scelta.');
            error.status = 409;
            throw error;
          }
          replaceSelectedElectives(db, req.user.sub, plan.id, parsed.selectedElectiveIds.map(Number));
        }
      }
      return updated;
    })();

    return res.json({
      profile: toProfileDto(profile),
      selectedElectiveIds: getSelectedElectiveIds(db, req.user.sub),
      onboardingRequired: !isConfigured(profile)
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
