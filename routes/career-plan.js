// routes/career-plan.js
const express = require('express');
const { db } = require('../db');
const { getStudentProfile, getSelectedElectiveIds } = require('../db/repository');
const { getCareerSnapshot } = require('../services/career-snapshots');
const { resolveStudyPlan } = require('../services/study-plan-service');
const { matchStudyPlan } = require('../lib/matching');
const { toProfileDto } = require('../lib/dto');
const { recoverPersonalStudyPlan } = require('../services/study-plan-sync');
const { safeErrorMeta } = require('../lib/safe-log');

function createCareerPlanRouter(dependencies = {}) {
  const router = express.Router();
  const database = dependencies.database || db;
  const recoverPlan = dependencies.recoverPersonalStudyPlan || recoverPersonalStudyPlan;

  // Supporta /api/career-plan/plan, /api/career-plan e /api/career-plan/piano-di-studi
  router.get(['/plan', '/', '/piano-di-studi'], async (req, res) => {
    try {
      let profile = getStudentProfile(database, req.user.sub);
      if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
      if (!profile.course_id || !profile.cohort_year) {
        return res.status(409).json({ code: 'PROFILE_ONBOARDING_REQUIRED', error: 'Completa corso e coorte nel profilo.' });
      }

      let passedExams = getCareerSnapshot(req.user.sub);
      // After a restart the encrypted profile remains available while RAM is empty.
      if (!passedExams && profile.carriera_json) {
        try {
          const persisted = JSON.parse(profile.carriera_json);
          if (Array.isArray(persisted)) passedExams = persisted;
        } catch {}
      }
      if (!passedExams) {
        return res.status(409).json({ code: 'CAREER_SYNC_REQUIRED', error: 'Accedi di nuovo a Segrepass per aggiornare gli esami.' });
      }

      let resolved = resolveStudyPlan(database, profile, req.user.sub);
      let sync = null;
      if ((!resolved || req.query.refresh === '1') && req.authSession?.tokenHash) {
        sync = await recoverPlan({ profile, tokenHash: req.authSession.tokenHash, database });
        if (sync?.reason === 'STUDY_PLAN_CONTEXT_CHANGED') {
          return res.status(409).json({ code: 'PROFILE_CHANGED', error: 'Il profilo è cambiato durante il recupero del piano. Riapri la sezione.' });
        }
        profile = getStudentProfile(database, req.user.sub);
        if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });
        resolved = resolveStudyPlan(database, profile, req.user.sub);
      }
      if (!resolved) {
        if (sync?.retryAfterMs) res.set('Retry-After', String(Math.ceil(sync.retryAfterMs / 1000)));
        return res.status(404).json({
          code: 'STUDY_PLAN_NOT_AVAILABLE',
          error: 'Il piano personale non è stato recuperato da Segrepass. Riprova ad aggiornarlo; se il problema persiste verifica il piano nel portale ufficiale.',
          reason: sync?.reason || 'STUDY_PLAN_NOT_READ',
          retryAfterMs: sync?.retryAfterMs || 0
        });
      }

      const result = matchStudyPlan({
        planCourses: resolved.courses,
        passedExams,
        selectedElectiveIds: getSelectedElectiveIds(database, req.user.sub)
      });

      return res.json({ profile: toProfileDto(profile), plan: resolved.plan, source: resolved.source, ...result, ...(sync ? { sync } : {}) });
    } catch (error) {
      console.error('[Career Plan Error]:', safeErrorMeta(error));
      return res.status(500).json({ error: 'Errore interno nel recupero del piano di studi.' });
    }
  });
  return router;
}

module.exports = createCareerPlanRouter();
module.exports.createCareerPlanRouter = createCareerPlanRouter;
