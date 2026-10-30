// routes/docenti.js
const express = require('express');
const router = express.Router();
const { getDocentiData, fetchAnnouncementsForProfessors } = require('../scraper/docenti');
const authModule = require('../middleware/auth');
const authMiddleware = authModule.authMiddleware || authModule;
const { db } = require('../db');
const { getStudentProfile } = require('../db/repository');

const CACHE_TTL_MS = 15 * 60 * 1000;
// Una sola acquisizione per studente: le tre rotte chiamate in parallelo dal
// frontend condividono la stessa promise invece di aprire tre sessioni Puppeteer.
const docentiCache = new Map(); // chiave profilo -> { promise, ts }

/**
 * Ricava email Docenti e password dalla sessione autenticata.
 * La password arriva solo dal JWT (req.user.password): mai da body o query string.
 */
function resolveCredentials(req) {
  const user = req.user || {};
  let userEmail = user.email;

  if (!userEmail || !userEmail.includes('@')) {
    const profile = getStudentProfile(db, user.sub);
    userEmail = profile?.email || userEmail;
  }
  // Se l'utente ha fatto login con l'email istituzionale, l'id profilo è l'email stessa.
  if ((!userEmail || !userEmail.includes('@')) && String(user.sub || '').includes('@')) {
    userEmail = String(user.sub).toLowerCase();
  }

  return { userEmail, password: user.password };
}

function isHardFailure(data) {
  return data && data.available === false && data.reason && data.reason !== 'DOCENTI_DATA_NOT_FOUND';
}

function getDocentiCached(profileKey, credentials) {
  const hit = docentiCache.get(profileKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.promise;

  const promise = getDocentiData(credentials)
    .then(data => {
      // Non conservare in cache i fallimenti: il prossimo tentativo deve riprovare.
      if (isHardFailure(data)) docentiCache.delete(profileKey);
      return data;
    })
    .catch(error => {
      docentiCache.delete(profileKey);
      throw error;
    });

  docentiCache.set(profileKey, { promise, ts: Date.now() });
  return promise;
}

/**
 * Carica i dati Docenti per l'utente autenticato.
 * Restituisce i dati, oppure risponde direttamente con l'errore e restituisce null.
 */
async function loadForUser(req, res) {
  const { userEmail, password } = resolveCredentials(req);

  if (!userEmail || !userEmail.includes('@') || !password) {
    res.status(400).json({
      success: false,
      error: 'CREDENTIALS_REQUIRED',
      message: 'Email (@studenti.unina.it) o password non disponibili nella sessione. Esci e accedi di nuovo.'
    });
    return null;
  }

  try {
    const profileKey = String(req.user.sub);
    const data = await getDocentiCached(profileKey, { username: userEmail, password });

    if (isHardFailure(data)) {
      const status = data.reason === 'DOCENTI_EMAIL_REQUIRED' ? 400 : 502;
      const error = data.reason === 'DOCENTI_EMAIL_REQUIRED'
        ? 'CREDENTIALS_REQUIRED'
        : data.reason === 'DOCENTI_PRIVATE_LOGIN_FAILED'
          ? 'Login Docenti non riuscito: credenziali non valide.'
          : `Acquisizione Docenti non riuscita (${data.reason}).`;
      res.status(status).json({ success: false, error, reason: data.reason });
      return null;
    }

    return data;
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Errore Docenti.' });
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 1. /api/docenti/subscriptions (corsi a cui lo studente è iscritto)  */
/* ------------------------------------------------------------------ */
router.get('/subscriptions', authMiddleware, async (req, res) => {
  const data = await loadForUser(req, res);
  if (!data) return;
  res.json({ success: true, subscriptions: data.subscriptions || [] });
});

/* ------------------------------------------------------------------ */
/* 2. /api/docenti/booked-exams (esami prenotati)                      */
/* ------------------------------------------------------------------ */
router.get('/booked-exams', authMiddleware, async (req, res) => {
  const data = await loadForUser(req, res);
  if (!data) return;
  res.json({ success: true, bookedExams: data.bookedExams || [] });
});

/* ------------------------------------------------------------------ */
/* 3. /api/docenti/announcements                                       */
/*    - con ?professori=A,B  -> pubblica (nessun login)                */
/*    - senza parametro      -> area riservata (login obbligatorio)    */
/* ------------------------------------------------------------------ */
router.get(
  '/announcements',
  (req, res, next) => (req.query.professori ? next() : authMiddleware(req, res, next)),
  async (req, res) => {
    const { professori } = req.query;

    if (professori) {
      try {
        const list = String(professori).split(',').map(p => p.trim()).filter(Boolean);
        const data = await fetchAnnouncementsForProfessors(list);
        return res.json({ success: true, announcements: data });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    }

    const data = await loadForUser(req, res);
    if (!data) return;
    return res.json({ success: true, announcements: data.announcements || [] });
  }
);

/* ------------------------------------------------------------------ */
/* 4. GET /api/docenti (sincronizzazione completa)                     */
/* ------------------------------------------------------------------ */
router.get('/', authMiddleware, async (req, res) => {
  const data = await loadForUser(req, res);
  if (!data) return;
  res.json({ success: true, data });
});

module.exports = router;
