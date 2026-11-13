// routes/docenti.js
const express = require('express');
const { getDocentiData, fetchAnnouncementsForProfessors, fetchAnnouncementsForTeacherIds, fetchTeacherDetail, fetchTeacherPhoto, fetchTeacherFolder, fetchTeacherMaterial, matchesImageSignature, searchTeachers } = require('../scraper/docenti');
const authModule = require('../middleware/auth');
const authMiddleware = authModule.authMiddleware || authModule;
const { db } = require('../db');
const {
  getStudentProfile,
  getProfessorPreferences,
  saveProfessorPreference,
  deleteProfessorPreference,
  getDocentiDataCache,
  getTeacherAnnouncementsCache,
  saveTeacherAnnouncementsCache
} = require('../db/repository');
const { getSessionCredentials } = require('../services/server-sessions');
const { getDocentiCached: getSharedDocentiCached, clearDocentiCache, isDocentiCacheLoading, TTL_MS: DOCENTI_CACHE_TTL_MS } = require('../services/docenti-cache');
const { isDocentiLoading, invalidateDocentiSnapshot } = require('../services/career-snapshots');
const { safeErrorMeta } = require('../lib/safe-log');

const teacherDetailCache = new Map(); // chiave -> { value, promise, storedAt, refreshing }
const TEACHER_DETAIL_TTL_MS = 15 * 60 * 1000;
const TEACHER_ANNOUNCEMENT_TTL_MS = 10 * 60 * 1000;
const teacherAnnouncementLoads = new Map();
const restrictedMaterialsEnabled = () => String(process.env.ALLOW_RESTRICTED_DOCENTI_MATERIALS || '').toLowerCase() === 'true';
const DOCENTI_FAILURE_MESSAGES = {
  DOCENTI_CREDENTIALS_REQUIRED: 'Le credenziali Docenti non sono disponibili. Esci e accedi di nuovo.',
  DOCENTI_EMAIL_REQUIRED: 'Per accedere al portale Docenti serve l’email istituzionale @studenti.unina.it. Esci e accedi di nuovo inserendo quell’indirizzo.',
  DOCENTI_AUTH_REJECTED: 'Il portale Docenti ha rifiutato l’accesso. Verifica email istituzionale e password, poi accedi di nuovo.',
  DOCENTI_LOGIN_FLOW_FAILED: 'Il portale Docenti non ha completato l’accesso. Riprova tra poco; se continua, il portale potrebbe essere cambiato.',
  DOCENTI_LOGIN_FORM_UNAVAILABLE: 'Il modulo di accesso Studente del portale Docenti non è disponibile al momento.',
  DOCENTI_PRIVATE_LOGIN_FAILED: 'Accesso al portale Docenti non riuscito. Verifica email istituzionale e password.'
};

function resolveCredentials(req) {
  const credentials = getSessionCredentials(req.authSession?.tokenHash) || {};
  let userEmail = credentials.email;

  if (!userEmail || !userEmail.includes('@')) {
    const profile = getStudentProfile(db, req.user.sub);
    userEmail = profile?.email || userEmail;
  }
  if ((!userEmail || !userEmail.includes('@')) && String(req.user.sub || '').includes('@')) {
    userEmail = String(req.user.sub).toLowerCase();
  }

  return {
    userEmail,
    password: credentials.password,
    enableDocentiSync: credentials.enableDocentiSync === true
  };
}

function isHardFailure(data) {
  return data && data.available === false && data.reason && data.reason !== 'DOCENTI_DATA_NOT_FOUND';
}

function requireAuth(req, res, next) {
  // I test (e un eventuale middleware padre) possono già aver impostato req.user.
  if (req.user && req.user.sub) return next();
  return authMiddleware(req, res, next);
}

function docentiSyncEnabled(dependencies = {}) {
  return dependencies.enableDocentiSync === true
    || typeof dependencies.loadDocenti === 'function'
    || typeof dependencies.fetchFavoriteAnnouncements === 'function'
    || typeof dependencies.fetchTeacherDetail === 'function'
    || typeof dependencies.fetchTeacherFolder === 'function'
    || typeof dependencies.fetchMaterial === 'function'
    || typeof dependencies.fetchTeacherPhoto === 'function'
    || typeof dependencies.searchTeachers === 'function'
    || String(process.env.DOCENTI_SYNC_ENABLED || '').toLowerCase() === 'true'
    || process.env.NODE_ENV === 'test';
}

function docentiSyncEnabledForRequest(req, dependencies = {}) {
  const stored = getSessionCredentials(req.authSession?.tokenHash) || {};
  if (Object.hasOwn(stored, 'enableDocentiSync')) return stored.enableDocentiSync === true;
  return docentiSyncEnabled(dependencies);
}

function identifierForTeacher(req) {
  return { id: String(req.params.id).trim() };
}

function validExternalId(value, maxLength = 100) {
  return typeof value === 'string' && value.length <= maxLength && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function hasValidatedEmbeddedPhoto(value) {
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(value || ''));
  if (!match) return false;
  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  return buffer.length <= 5 * 1024 * 1024 && matchesImageSignature(contentType, buffer);
}

function refreshTeacherDetail(cacheKey, identifier, coursePrefix, dependencies) {
  const existing = teacherDetailCache.get(cacheKey);
  if (existing?.promise) return existing.promise;

  const loadTeacherDetail = dependencies.fetchTeacherDetail || fetchTeacherDetail;
  const promise = loadTeacherDetail(identifier, { ...dependencies, coursePrefix })
    .then(detail => {
      if (!detail) return null;
      if (!restrictedMaterialsEnabled() && detail.materiali) {
        detail.materiali = { ...detail.materiali, riservato: [] };
      }
      if (detail.profilo?.id) {
        // fetchTeacherDetail already downloads and validates the photo. Keep
        // that result instead of triggering a second upstream request from <img>.
        if (!hasValidatedEmbeddedPhoto(detail.profilo.fotoUrl)) {
          detail.profilo.fotoUrl = `/api/docenti/teacher/${encodeURIComponent(detail.profilo.id)}/photo`;
        }
      }
      const hasContent = Boolean(
        detail.profilo?.id &&
        (detail.iscrizioni?.length ||
          detail.appelli?.length ||
          detail.materiali?.pubblico?.length ||
          detail.materiali?.ftp?.length ||
          detail.materiali?.riservato?.length)
      );
      if (hasContent) {
        teacherDetailCache.set(cacheKey, { value: detail, storedAt: Date.now() });
      } else {
        teacherDetailCache.delete(cacheKey);
      }
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
  clearDocentiCache(profileId);
  if (!profileId) {
    teacherDetailCache.clear();
    return;
  }
  for (const key of teacherDetailCache.keys()) {
    if (key.startsWith(`${String(profileId)}|`)) teacherDetailCache.delete(key);
  }
}

function announcementFetcher(dependencies) {
  return dependencies.fetchFavoriteAnnouncements || fetchAnnouncementsForTeacherIds;
}

function startTeacherAnnouncementRefresh(teacher, dependencies) {
  const id = String(teacher.id);
  if (teacherAnnouncementLoads.has(id)) return teacherAnnouncementLoads.get(id);
  const task = Promise.resolve()
    .then(() => announcementFetcher(dependencies)([teacher], dependencies))
    .then(groups => {
      const group = (groups || []).find(item => String(item.slug || '') === id) || groups?.[0];
      if (group && !group.announcementError) {
        const shared = { ...group };
        delete shared.courseName;
        delete shared.isFavorite;
        delete shared.announcementLoading;
        delete shared.announcementError;
        try { saveTeacherAnnouncementsCache(id, shared); } catch (error) {
          console.warn('[docenti-cache] Avvisi persistenti non aggiornati:', safeErrorMeta(error));
        }
      }
      return group || null;
    })
    .finally(() => {
      if (teacherAnnouncementLoads.get(id) === task) teacherAnnouncementLoads.delete(id);
    });
  teacherAnnouncementLoads.set(id, task);
  return task;
}

async function getCachedFavoriteAnnouncements(teachers, dependencies) {
  const groups = await Promise.all(teachers.map(async teacher => {
    const id = String(teacher.id);
    const cached = getTeacherAnnouncementsCache(id);
    if (cached) {
      if (Date.now() - cached.fetchedAt >= TEACHER_ANNOUNCEMENT_TTL_MS) {
        void startTeacherAnnouncementRefresh(teacher, dependencies).catch(() => {});
      }
      return {
        ...cached.data,
        professor: cached.data.professor || teacher.name,
        slug: id,
        courseName: teacher.courseName,
        isFavorite: true
      };
    }
    const loaded = await startTeacherAnnouncementRefresh(teacher, dependencies);
    return loaded ? { ...loaded, courseName: teacher.courseName, isFavorite: true } : {
      professor: teacher.name,
      slug: id,
      courseName: teacher.courseName,
      isFavorite: true,
      announcementError: true,
      items: []
    };
  }));
  return groups.filter(Boolean);
}

function createDocentiRouter(dependencies = {}) {
  const router = express.Router();

  async function loadForUser(req, res) {
    if (!docentiSyncEnabledForRequest(req, dependencies)) {
      res.status(403).json({ success: false, error: 'Integrazione Docenti disabilitata.', code: 'DOCENTI_SYNC_DISABLED' });
      return null;
    }
    const { userEmail, password, enableDocentiSync } = resolveCredentials(req);
    const requestDependencies = { ...dependencies, enableDocentiSync };
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
        : await getSharedDocentiCached(
          profileKey,
          { username: userEmail, password },
          () => getDocentiData({ username: userEmail, password, profileKey }, requestDependencies)
        );

      if (isHardFailure(data)) {
        const status = data.reason === 'DOCENTI_EMAIL_REQUIRED' ? 400
          : data.reason === 'DOCENTI_AUTH_REJECTED' ? 424 : 502;
        res.status(status).json({
          success: false,
          error: DOCENTI_FAILURE_MESSAGES[data.reason] || `Acquisizione Docenti non riuscita (${data.reason}).`,
          code: data.reason
        });
        return null;
      }

      if (data && data.available === false) {
        res.status(424).json({ success: false, error: DOCENTI_FAILURE_MESSAGES[data.reason] || 'Nessun dato Docenti trovato.', code: data.reason });
        return null;
      }

      return data;
    } catch (error) {
      const status = error.status || 502;
      console.warn('[docenti] richiesta non riuscita:', safeErrorMeta(error));
      res.status(status).json({ success: false, error: 'Errore Docenti.', code: error.code || 'DOCENTI_ERROR' });
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
    if (req.query.refresh === '1' && !isDocentiLoading(req.user.sub)) {
      clearDocentiRouteCache(req.user.sub);
      invalidateDocentiSnapshot(req.user.sub);
    }
    const data = await loadForUser(req, res);
    if (!data) return;
    const { userEmail, password } = resolveCredentials(req);
    const persisted = getDocentiDataCache(req.user.sub);
    res.json({
      announcements: data.announcements || [],
      subscriptions: data.subscriptions || [],
      bookedExams: data.bookedExams || [],
      groups: data.groups || [],
      tests: data.tests || [],
      meta: {
        refreshing: isDocentiLoading(req.user.sub) || isDocentiCacheLoading(req.user.sub, { username: userEmail, password }),
        fetchedAt: persisted?.fetchedAt ? new Date(persisted.fetchedAt).toISOString() : null,
        stale: Boolean(persisted && Date.now() - persisted.fetchedAt >= DOCENTI_CACHE_TTL_MS)
      }
    });
  });

  router.get('/teachers/search', requireAuth, async (req, res) => {
    if (!docentiSyncEnabledForRequest(req, dependencies)) return res.status(403).json({ error: 'Integrazione Docenti disabilitata.', code: 'DOCENTI_SYNC_DISABLED' });
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 3 || query.length > 100) return res.status(400).json({ error: 'Inserisci almeno 3 caratteri.' });
    try {
      const search = dependencies.searchTeachers || searchTeachers;
      const results = await search(query, dependencies);
      return res.json((results || []).filter(item => validExternalId(String(item.id || ''), 80)).map(item => ({
        id: String(item.id), name: String(item.name || '').slice(0, 120), role: item.role ? String(item.role).slice(0, 120) : null
      })));
    } catch (error) {
      return res.status(502).json({ error: 'Ricerca Docenti non disponibile.' });
    }
  });

  router.get('/preferences', requireAuth, (req, res) => res.json(getProfessorPreferences(req.user.sub)));
  router.get('/favorite-announcements', requireAuth, async (req, res) => {
    if (!docentiSyncEnabledForRequest(req, dependencies)) {
      return res.status(403).json({ error: 'Integrazione Docenti disabilitata.', code: 'DOCENTI_SYNC_DISABLED' });
    }
    const preferences = getProfessorPreferences(req.user.sub);
    const byId = new Map();
    for (const item of preferences) {
      const teacher = byId.get(item.professorId) || { id: item.professorId, name: item.professorName, courses: [] };
      if (!teacher.courses.includes(item.courseName)) teacher.courses.push(item.courseName);
      byId.set(item.professorId, teacher);
    }
    const teachers = [...byId.values()].map(teacher => ({ ...teacher, courseName: teacher.courses.join(', ') }));
    try {
      const groups = await getCachedFavoriteAnnouncements(teachers, dependencies);
      return res.json(groups);
    } catch {
      return res.status(502).json({ error: 'Avvisi dei docenti preferiti temporaneamente non disponibili.' });
    }
  });
  router.post('/preferences', requireAuth, (req, res) => {
    const body = req.body || {};
    const courseName = typeof body.courseName === 'string' ? body.courseName.trim() : '';
    const courseCode = typeof body.courseCode === 'string' ? body.courseCode.trim() : '';
    const professorName = typeof body.professorName === 'string' ? body.professorName.trim() : '';
    const professorId = typeof body.professorId === 'string' ? body.professorId.trim() : '';
    if (!courseName || courseName.length > 120 || (courseCode && !/^[A-Za-z0-9_-]{1,40}$/.test(courseCode)) ||
        !professorName || professorName.length > 120 || !validExternalId(professorId, 80)) {
      return res.status(400).json({ error: 'Preferenza docente non valida.' });
    }
    return res.status(201).json(saveProfessorPreference(req.user.sub, { courseName, courseCode: courseCode || null, professorName, professorId }));
  });
  router.delete('/preferences/:id', requireAuth, (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Identificativo preferenza non valido.' });
    return deleteProfessorPreference(req.user.sub, Number(req.params.id)) ? res.status(204).end() : res.status(404).end();
  });

  router.get('/teacher/:id', requireAuth, async (req, res) => {
    if (!docentiSyncEnabledForRequest(req, dependencies)) return res.status(403).json({ error: 'Integrazione Docenti disabilitata.', code: 'DOCENTI_SYNC_DISABLED' });
    if (!validExternalId(req.params.id, 80)) return res.status(400).json({ error: 'Identificativo docente non valido.' });
    const coursePrefix = typeof req.query.course === 'string' ? req.query.course.trim() : '';
    if (coursePrefix.length > 200 || !/^[A-Za-z0-9_, -]*$/.test(coursePrefix)) {
      return res.status(400).json({ error: 'Filtro corso non valido.' });
    }
    const cacheKey = `${String(req.user.sub)}|detail-v6|${String(req.params.id)}|${coursePrefix.toLowerCase()}`;
    const cached = teacherDetailCache.get(cacheKey);
    if (cached?.value && Date.now() - cached.storedAt < TEACHER_DETAIL_TTL_MS) {
      if (!cached.refreshing) {
        cached.refreshing = true;
        void refreshTeacherDetail(cacheKey, identifierForTeacher(req), coursePrefix, { ...dependencies, sessionKey: req.user.sub })
          .finally(() => {
            const current = teacherDetailCache.get(cacheKey);
            if (current) current.refreshing = false;
          });
      }
      return res.json(cached.value);
    }
    try {
      const detail = await refreshTeacherDetail(cacheKey, identifierForTeacher(req), coursePrefix, { ...dependencies, sessionKey: req.user.sub });
      if (!detail) return res.status(404).json({ error: 'Docente non trovato.' });
      return res.json(detail);
    } catch (error) {
      console.warn('[docenti] dettaglio non disponibile:', safeErrorMeta(error));
      return res.status(502).json({ error: 'Dettaglio docente non disponibile.' });
    }
  });

  router.get('/teacher/:id/photo', requireAuth, async (req, res) => {
    if (!docentiSyncEnabledForRequest(req, dependencies)) return res.status(403).json({ error: 'Integrazione Docenti disabilitata.', code: 'DOCENTI_SYNC_DISABLED' });
    if (!validExternalId(req.params.id, 80)) return res.status(400).json({ error: 'Identificativo docente non valido.' });
    const photo = await fetchTeacherPhoto(req.params.id, { ...dependencies, sessionKey: req.user.sub });
    if (!photo) return res.status(404).end();
    const contentType = String(photo.contentType || '').split(';')[0].toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType) ||
      !Buffer.isBuffer(photo.buffer) || photo.buffer.length > 5 * 1024 * 1024 ||
      !matchesImageSignature(contentType, photo.buffer)) {
      return res.status(502).json({ error: 'Immagine docente non valida.' });
    }
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, no-store');
    return res.send(photo.buffer);
  });

  router.get('/teacher/:id/folder/:folderId', requireAuth, async (req, res) => {
    if (!docentiSyncEnabledForRequest(req, dependencies)) return res.status(403).json({ error: 'Integrazione Docenti disabilitata.', code: 'DOCENTI_SYNC_DISABLED' });
    try {
      if (!validExternalId(req.params.id, 80)) return res.status(400).json({ error: 'Identificativo docente non valido.' });
      if (!validExternalId(req.params.folderId, 128)) return res.status(400).json({ error: 'Identificativo cartella non valido.' });
      const section = String(req.query.section || 'areapubb');
      if (!['areapubb', 'aree-ftp', 'arearis'].includes(section)) {
        return res.status(400).json({ error: 'Sezione materiale non valida.' });
      }
      if (section === 'arearis' && !restrictedMaterialsEnabled()) {
        return res.status(403).json({ error: 'Materiali riservati disabilitati.', code: 'RESTRICTED_MATERIALS_DISABLED' });
      }
      const items = await fetchTeacherFolder(
        req.params.id,
        req.params.folderId,
        section,
        typeof req.query.course === 'string' ? req.query.course : '',
        { ...dependencies, sessionKey: req.user.sub }
      );
      return res.json({ items });
    } catch (error) {
      console.warn('[docenti] cartella non disponibile:', safeErrorMeta(error));
      return res.status(502).json({ error: 'Contenuto cartella non disponibile.' });
    }
  });

  router.get('/teacher/:id/folder/:folderId/file/:fileId', requireAuth, async (req, res) => {
    if (!docentiSyncEnabledForRequest(req, dependencies)) return res.status(403).json({ error: 'Integrazione Docenti disabilitata.', code: 'DOCENTI_SYNC_DISABLED' });
    try {
      if (!validExternalId(req.params.id, 80)) return res.status(400).json({ error: 'Identificativo docente non valido.' });
      if (!validExternalId(req.params.folderId, 128) || !validExternalId(req.params.fileId, 160)) {
        return res.status(400).json({ error: 'Identificativo materiale non valido.' });
      }
      const section = String(req.query.section || 'areapubb');
      if (!['areapubb', 'aree-ftp', 'arearis'].includes(section)) return res.status(400).json({ error: 'Sezione materiale non valida.' });
      if (section === 'arearis' && !restrictedMaterialsEnabled()) {
        return res.status(403).json({ error: 'Materiali riservati disabilitati.', code: 'RESTRICTED_MATERIALS_DISABLED' });
      }
      const course = typeof req.query.course === 'string' ? req.query.course.trim() : '';
      if (course.length > 200 || !/^[A-Za-z0-9_, -]*$/.test(course)) return res.status(400).json({ error: 'Filtro corso non valido.' });
      const material = await fetchTeacherMaterial(
        req.params.id,
        req.params.folderId,
        req.params.fileId,
        section,
        course,
        { ...dependencies, sessionKey: req.user.sub }
      );
      if (!material) return res.status(404).json({ error: 'Materiale non disponibile.' });
      const safeName = String(material.filename || `materiale-${req.params.fileId}`).replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 120);
      res.set({
        'Content-Type': material.contentType,
        'Content-Disposition': `inline; filename="${safeName || 'materiale'}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.send(material.buffer);
    } catch (error) {
      console.warn('[docenti] materiale non disponibile:', safeErrorMeta(error));
      return res.status(502).json({ error: 'Materiale non disponibile.' });
    }
  });

  router.get('/announcements', requireAuth, async (req, res) => {
    const data = await loadForUser(req, res);
    if (!data) return;
    return res.json(data.announcements || []);
  });

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
