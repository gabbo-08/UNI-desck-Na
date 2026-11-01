// routes/career-plan.js
const express = require('express');
const { db } = require('../db');
const { getStudentProfile, getSelectedElectiveIds } = require('../db/repository');
const { getCareerSnapshot } = require('../services/career-snapshots');
const { resolveStudyPlan } = require('../services/study-plan-service');
const { matchStudyPlan } = require('../lib/matching');

const router = express.Router();

// Supporta /api/career-plan/plan, /api/career-plan e /api/career-plan/piano-di-studi
router.get(['/plan', '/', '/piano-di-studi'], (req, res) => {
  try {
    const profile = getStudentProfile(db, req.user.sub);
    if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
    if (!profile.course_id || !profile.cohort_year) {
      return res.status(409).json({ code: 'PROFILE_ONBOARDING_REQUIRED', error: 'Completa corso e coorte nel profilo.' });
    }

    const passedExams = getCareerSnapshot(req.user.sub);
    if (!passedExams) {
      return res.status(409).json({ code: 'CAREER_SYNC_REQUIRED', error: 'Accedi di nuovo a Segrepass per aggiornare gli esami.' });
    }

    const resolved = resolveStudyPlan(db, profile, req.user.sub);
    if (!resolved) {
      // Il frontend riconosce "non disponibile" e mostra il messaggio di corso non supportato.
      return res.status(404).json({
        code: 'STUDY_PLAN_NOT_AVAILABLE',
        error: 'Piano di studi non disponibile per questo corso.'
      });
    }

    const result = matchStudyPlan({
      planCourses: resolved.courses,
      passedExams,
      selectedElectiveIds: getSelectedElectiveIds(db, req.user.sub)
    });

    return res.json({ profile, plan: resolved.plan, source: resolved.source, ...result });
  } catch (error) {
    console.error('[Career Plan Error]:', error.message);
    return res.status(500).json({ error: 'Errore interno nel recupero del piano di studi.' });
  }
});

module.exports = router;
