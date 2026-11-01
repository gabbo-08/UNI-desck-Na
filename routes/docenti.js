// routes/docenti.js
const express = require('express');
const { getDocentiData, fetchAnnouncementsForProfessors, fetchTeacherDetail, fetchTeacherPhoto, fetchTeacherFolder } = require('../scraper/docenti');
const authModule = require('../middleware/auth');
const authMiddleware = authModule.authMiddleware || authModule;
const { db } = require('../db');
const { getStudentProfile } = require('../db/repository');

const CACHE_TTL_MS = 15 * 60 * 1000;
const docentiCache = new Map(); // chiave profilo -> { value, promise, storedAt, refreshing }
const teacherDetailCache = new Map(); // chiave -> { value, promise, storedAt, refreshing }
const TEACHER_DETAIL_TTL_MS = 15 * 60 * 1000;

function resolveCredentials(req) {
  const user = req.user || {};
  let userEmail = user.email;

  if (!userEmail || !userEmail.includes('@')) {
    const profile = getStudentProfile(db, user.sub);
    userEmail = profile?.email || userEmail;
  }
  if ((!userEmail || !userEmail.includes('@')) && String(user.sub || '').includes('@')) {
    userEmail = String(user.sub).toLowerCase();
  }

  return { userEmail, password: user.password };
}

function isHardFailure(data) {
  return data && data.available === false && data.reason && data.reason !== 'DOCENTI_DATA_NOT_FOUND';
}

function getDocentiCached(profileKey, credentials, dependencies) {
  const hit = docentiCache.get(profileKey);
  if (hit?.value && Date.now() - hit.storedAt < CACHE_TTL_MS) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      void refreshDocentiCache(profileKey, credentials, dependencies).finally(() => {
        const current = docentiCache.get(profileKey);
        if (current) current.refreshing = false;
      });
    }
    return Promise.resolve(hit.value);
  }
  if (hit?.promise) return hit.promise;

  return refreshDocentiCache(profileKey, credentials, dependencies);
}

function refreshDocentiCache(profileKey, credentials, dependencies) {
  const existing = docentiCache.get(profileKey);
  if (existing?.promise) return existing.promise;

  const promise = getDocentiData({ ...credentials, profileKey }, dependencies)
    .then(data => {
      if (isHardFailure(data)) docentiCache.delete(profileKey);
      else docentiCache.set(profileKey, { value: data, storedAt: Date.now() });
      return data;
    })
    .catch(error => {
      docentiCache.delete(profileKey);
      throw error;
    });

  docentiCache.set(profileKey, { ...(existing || {}), promise, storedAt: existing?.storedAt || 0 });
  return promise;
}

function requireAuth(req, res, next) {
  // I test (e un eventuale middleware padre) possono già aver impostato req.user.
  if (req.user && req.user.sub) return next();
  return authMiddleware(req, res, next);
}

function identifierForTeacher(req) {
  const identifier = String(req.params.id);
  return identifier.length >= 24 && !/\s/.test(identifier) ? { id: identifier } : identifier;
}

function refreshTeacherDetail(cacheKey, identifier, coursePrefix, dependencies) {
  const existing = teacherDetailCache.get(cacheKey);
  if (existing?.promise) return existing.promise;

  const loadTeacherDetail = dependencies.fetchTeacherDetail || fetchTeacherDetail;
  const promise = loadTeacherDetail(identifier, { ...dependencies, coursePrefix })
    .then(detail => {
      if (!detail) return null;
      detail.profilo.fotoUrl = `/api/docenti/teacher/${encodeURIComponent(detail.profilo.id)}/photo`;
      teacherDetailCache.set(cacheKey, { value: detail, storedAt: Date.now() });
      return detail;
    })
    .catch(error => {
      teacherDetailCache.delete(cacheKey);
      throw error;
    });

  teacherDetailCache.set(cacheKey, { ...(existing || {}), promise, storedAt: existing?.storedAt || 0 });
  return promise;
}

function clearDocentiRouteCache(profileId) {
  const prefix = profileId ? `${String(profileId)}|` : null;
  for (const key of docentiCache.keys()) {
    if (!prefix || key === String(profileId) || key.startsWith(prefix)) docentiCache.delete(key);
  }
  if (!profileId) {
    docentiCache.clear();
    teacherDetailCache.clear();
    return;
  }
  for (const key of teacherDetailCache.keys()) {
    if (key.startsWith(`${String(profileId)}|`)) teacherDetailCache.delete(key);
  }
}

function createDocentiRouter(dependencies = {}) {
  const router = express.Router();

  async function loadForUser(req, res) {
    const { userEmail, password } = resolveCredentials(req);
    const injectedLoader = dependencies.loadDocenti;

    if (!injectedLoader && (!userEmail || !userEmail.includes('@') || !password)) {
      res.status(400).json({
        success: false,
        error: 'DOCENTI_CREDENTIALS_REQUIRED',
        message: 'Email o password non disponibili nella sessione.'
      });
      return null;
    }

    try {
      const profileKey = String(req.user.sub);
      const data = injectedLoader
        ? await injectedLoader({ username: userEmail, password, profileKey })
        : await getDocentiCached(profileKey, { username: userEmail, password }, dependencies);

      if (isHardFailure(data)) {
        const status = data.reason === 'DOCENTI_EMAIL_REQUIRED' ? 400 : 502;
        res.status(status).json({ success: false, error: `Acquisizione Docenti non riuscita (${data.reason}).`, code: data.reason });
        return null;
      }

      if (data && data.available === false) {
        res.status(424).json({ success: false, error: 'Nessun dato Docenti trovato.', code: data.reason });
        return null;
      }

      return data;
    } catch (error) {
      const status = error.status || 502;
      res.status(status).json({ success: false, error: error.message || 'Errore Docenti.', code: error.code || 'DOCENTI_ERROR' });
      return null;
    }
  }

  router.get('/subscriptions', requireAuth, async (req, res) => {
    const data = await loadForUser(req, res);
    if (!data) return;
    res.json(data.subscriptions || []);
  });

  router.get('/booked-exams', requireAuth, async (req, res) => {
    const data = await loadForUser(req, res);
    if (!data) return;
    res.json(data.bookedExams || []);
  });

  router.get('/groups', requireAuth, async (req, res) => {
    const data = await loadForUser(req, res);
    if (!data) return;
    res.json(data.groups || []);
  });

  router.get('/tests', requireAuth, async (req, res) => {
    const data = await loadForUser(req, res);
    if (!data) return;
    res.json(data.tests || []);
  });

  router.get('/summary', requireAuth, async (req, res) => {
    const data = await loadForUser(req, res);
    if (!data) return;
    res.json({
      announcements: data.announcements || [],
      subscriptions: data.subscriptions || [],
      bookedExams: data.bookedExams || [],
      groups: data.groups || [],
      tests: data.tests || []
    });
  });

  router.get('/teacher/:id', requireAuth, async (req, res) => {
    const coursePrefix = typeof req.query.course === 'string' ? req.query.course.trim() : '';
    const cacheKey = `${String(req.user.sub)}|detail-v6|${String(req.params.id)}|${coursePrefix.toLowerCase()}`;
    const cached = teacherDetailCache.get(cacheKey);
    if (cached?.value && Date.now() - cached.storedAt < TEACHER_DETAIL_TTL_MS) {
      if (!cached.refreshing) {
        cached.refreshing = true;
        void refreshTeacherDetail(cacheKey, identifierForTeacher(req), coursePrefix, dependencies)
          .finally(() => {
            const current = teacherDetailCache.get(cacheKey);
            if (current) current.refreshing = false;
          });
      }
      return res.json(cached.value);
    }
    try {
      const detail = await refreshTeacherDetail(cacheKey, identifierForTeacher(req), coursePrefix, dependencies);
      if (!detail) return res.status(404).json({ error: 'Docente non trovato.' });
      return res.json(detail);
    } catch (error) {
      return res.status(502).json({ error: error.message || 'Dettaglio docente non disponibile.' });
    }
  });

  router.get('/teacher/:id/photo', requireAuth, async (req, res) => {
    const photo = await fetchTeacherPhoto(req.params.id, dependencies);
    if (!photo) return res.status(404).end();
    res.set('Content-Type', photo.contentType);
    res.set('Cache-Control', 'private, max-age=900');
    return res.send(photo.buffer);
  });

  router.get('/teacher/:id/folder/:folderId', requireAuth, async (req, res) => {
    try {
      const section = String(req.query.section || 'areapubb');
      if (!['areapubb', 'aree-ftp', 'arearis'].includes(section)) {
        return res.status(400).json({ error: 'Sezione materiale non valida.' });
      }
      const items = await fetchTeacherFolder(
        req.params.id,
        req.params.folderId,
        section,
        typeof req.query.course === 'string' ? req.query.course : '',
        dependencies
      );
      return res.json({ items });
    } catch (error) {
      return res.status(502).json({ error: error.message || 'Contenuto cartella non disponibile.' });
    }
  });

  router.get(
    '/announcements',
    (req, res, next) => (req.query.professori ? next() : requireAuth(req, res, next)),
    async (req, res) => {
      const { professori } = req.query;

      if (professori) {
        try {
          const list = String(professori).split(',').map(p => p.trim()).filter(Boolean);
          const data = await fetchAnnouncementsForProfessors(list, dependencies);
          return res.json(data);
        } catch (error) {
          return res.status(500).json({ success: false, error: error.message });
        }
      }

      const data = await loadForUser(req, res);
      if (!data) return;
      return res.json(data.announcements || []);
    }
  );

  router.get('/', requireAuth, async (req, res) => {
    const data = await loadForUser(req, res);
    if (!data) return;
    res.json({ success: true, data });
  });

  return router;
}

const router = createDocentiRouter();
router.createDocentiRouter = createDocentiRouter;
router.clearDocentiRouteCache = clearDocentiRouteCache;
module.exports = router;