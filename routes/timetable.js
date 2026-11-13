// routes/timetable.js
// GET /api/timetable              -> orario filtrato sulle iscrizioni dello studente
// GET /api/timetable?refresh=1    -> ignora la cache e rifà lo scraping
const express = require('express');
const { db } = require('../db');
const { getStudentProfile } = require('../db/repository');
const { getDocentiSnapshot } = require('../services/career-snapshots');
const { buildTimetableFilters } = require('../lib/timetable-filters');
const { getTimetableCached } = require('../services/timetable-service');
const { filterTimetableEvents, filterEventsBySurnameRange } = require('../lib/timetable-matching');
const { safeErrorMeta } = require('../lib/safe-log');

const router = express.Router();
const refreshRequests = new Map();
const REFRESH_COOLDOWN_MS = Math.max(5000, Number(process.env.TIMETABLE_REFRESH_COOLDOWN_MS || 30000));

function enrollmentsFor(profileId) {
  const snapshot = getDocentiSnapshot(profileId);
  if (!snapshot) return { subscriptions: null, reason: 'DOCENTI_NOT_READY' };
  if (snapshot.available === false) return { subscriptions: null, reason: 'DOCENTI_UNAVAILABLE' };
  return { subscriptions: snapshot.subscriptions || [], reason: null };
}

router.get('/', async (req, res) => {
  if (req.query.refresh === '1') {
    const now = Date.now();
    const previous = refreshRequests.get(req.user.sub) || 0;
    if (now - previous < REFRESH_COOLDOWN_MS) {
      return res.status(429).json({ code: 'TIMETABLE_REFRESH_COOLDOWN', error: 'Aggiornamento già richiesto. Riprova tra poco.' });
    }
    refreshRequests.set(req.user.sub, now);
    for (const [profileId, timestamp] of refreshRequests) {
      if (now - timestamp > REFRESH_COOLDOWN_MS * 4) refreshRequests.delete(profileId);
    }
  }
  const profile = getStudentProfile(db, req.user.sub);
  if (!profile) return res.status(404).json({ error: 'Profilo non trovato.' });

  let filters;
  try {
    filters = buildTimetableFilters(profile, req.query);
  } catch (error) {
    return res.status(error.status || 400).json({ code: error.code || 'INVALID_FILTERS', error: error.message });
  }

  try {
    const { value, fromCache, cachedAt } = await getTimetableCached(filters, {
      force: req.query.refresh === '1'
    });

    const { subscriptions, reason } = enrollmentsFor(req.user.sub);
    const filtered = reason
      ? filterEventsBySurnameRange(value.events || [], profile.surname_initial)
      : filterTimetableEvents(value.events || [], subscriptions, {
        surnameInitial: profile.surname_initial
      });
    const filterResult = reason
      ? { ...filtered.filter, reason: `${reason}:${filtered.filter.reason}` }
      : filtered.filter;

    return res.json({
      filters: {
        ...filters,
        channel: value.channel || filters.channel
      },
      timetable: { ...value, events: filtered.events },
      filter: filterResult,
      fromCache,
      cachedAt
    });
  } catch (error) {
    console.error('[Timetable Error]', safeErrorMeta(error));
    const status = error.status && error.status < 600 ? error.status : 502;
    return res.status(status).json({
      code: error.code || 'TIMETABLE_FAILED',
      error: 'Orario non disponibile al momento.'
    });
  }
});

module.exports = router;
