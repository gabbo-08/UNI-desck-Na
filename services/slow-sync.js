// Tasse e appelli sono sincronizzati separatamente: un errore non cancella
// l'ultimo risultato valido dell'altra sezione.
const snapshots = require('./career-snapshots');
const { getDatiCarriera } = require('../scraper/segrepass');
const { safeErrorMeta } = require('../lib/safe-log');
const { saveStudentSlowData } = require('../db/repository');

const statuses = new Map();
const inFlight = new Map();
const generations = new Map();
const RETRY_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_AUTO_ATTEMPTS = 3;

function getSlowStatus(profileId, now = Date.now()) {
  const status = statuses.get(profileId) || { state: 'idle' };
  const failed = status.state === 'error' || status.state === 'partial';
  return {
    ...status,
    ...(failed ? { retryAfterMs: Math.max(0, RETRY_COOLDOWN_MS - (now - status.finishedAt)) } : {})
  };
}

function resetSlowSync(profileId) {
  statuses.delete(profileId);
  snapshots.setSlowSnapshot(profileId, null);
  generations.set(profileId, (generations.get(profileId) || 0) + 1);
  inFlight.delete(profileId);
}

function normalizeSections(data) {
  const explicit = data?.slowSections || data?.sections || {};
  const taxesReady = explicit.taxes?.status
    ? explicit.taxes.status === 'ready'
    : Boolean(data?.tasse && data.tasse.available !== false);
  const appelliReady = explicit.appelli?.status
    ? explicit.appelli.status === 'ready'
    : Array.isArray(data?.prenotazioni);
  return {
    taxes: taxesReady ? { status: 'ready' } : { status: 'error', error: explicit.taxes?.error || data?.tasse?.reason || 'TAXES_DATA_NOT_AVAILABLE' },
    appelli: appelliReady ? { status: 'ready' } : { status: 'error', error: explicit.appelli?.error || 'APPELLI_DATA_NOT_AVAILABLE' }
  };
}

function startSlowSync(profileId, credentials, dependencies = {}) {
  if (inFlight.has(profileId)) return getSlowStatus(profileId);
  const previous = snapshots.getSlowSnapshot(profileId) || dependencies.initialSnapshot || null;
  const before = getSlowStatus(profileId);
  if (previous && before.state === 'ready' && !dependencies.force) return before;

  const scraper = dependencies.getDatiCarriera || getDatiCarriera;
  const generation = generations.get(profileId) || 0;
  const startedAt = Date.now();
  const attempts = (before.attempts || 0) + 1;
  const hasTaxes = Boolean(previous?.taxes && previous.taxes.available !== false);
  const previousAppelli = previous?.sections?.appelli;
  const hasAppelli = Array.isArray(previous?.prenotazioni) &&
    (!previousAppelli || previousAppelli.status === 'ready' || previousAppelli.stale === true);
  statuses.set(profileId, {
    state: 'loading', startedAt, attempts,
    sections: {
      taxes: { status: 'loading', stale: hasTaxes },
      appelli: { status: 'loading', stale: hasAppelli }
    }
  });
  if (previous && !snapshots.getSlowSnapshot(profileId)) snapshots.setSlowSnapshot(profileId, previous);

  function finish(data, failure) {
    if ((generations.get(profileId) || 0) !== generation) return getSlowStatus(profileId);
    const sections = failure
      ? { taxes: { status: 'error', error: failure }, appelli: { status: 'error', error: failure } }
      : normalizeSections(data);
    const taxesReady = sections.taxes.status === 'ready';
    const appelliReady = sections.appelli.status === 'ready';
    const taxes = taxesReady ? data.tasse : (hasTaxes ? previous.taxes : null);
    const prenotazioni = appelliReady ? data.prenotazioni : (hasAppelli ? previous.prenotazioni : []);
    if (!taxesReady) sections.taxes.stale = hasTaxes;
    if (!appelliReady) sections.appelli.stale = hasAppelli;
    const state = taxesReady && appelliReady ? 'ready' : taxesReady || appelliReady ? 'partial' : 'error';
    const finishedAt = Date.now();
    snapshots.setSlowSnapshot(profileId, {
      taxes, prenotazioni, sections,
      updatedAt: taxesReady || appelliReady ? finishedAt : previous?.updatedAt || null
    });
    if (taxesReady) snapshots.setTaxesSnapshot(profileId, taxes);
    const updates = {};
    if (taxesReady) updates.taxes = taxes;
    if (appelliReady) updates.prenotazioni = prenotazioni;
    if (Object.keys(updates).length) {
      try { (dependencies.saveStudentSlowData || saveStudentSlowData)(profileId, updates); }
      catch (error) { console.warn('[slow-sync] Snapshot persistente non aggiornato:', safeErrorMeta(error)); }
    }
    statuses.set(profileId, {
      state, startedAt, finishedAt, attempts, sections,
      ...(state === 'error' ? { error: failure || 'SLOW_SYNC_FAILED' } : {})
    });
    return getSlowStatus(profileId);
  }

  const syncPromise = Promise.resolve()
    .then(() => scraper(credentials, { phase: 'slow' }))
    .then(data => finish(data))
    .catch(error => {
      console.warn('[slow-sync] Aggiornamento non riuscito:', safeErrorMeta(error));
      return finish(null, error?.code || 'SLOW_SYNC_FAILED');
    })
    .finally(() => {
      if (inFlight.get(profileId) === syncPromise) inFlight.delete(profileId);
    });
  inFlight.set(profileId, syncPromise);
  return getSlowStatus(profileId);
}

function ensureSlowSync(profileId, credentials, dependencies = {}) {
  const status = getSlowStatus(profileId);
  if (inFlight.has(profileId) || status.state === 'loading') return status;
  const failed = status.state === 'error' || status.state === 'partial';
  if (failed && status.retryAfterMs > 0) return status;
  if (failed && !dependencies.force && status.attempts >= MAX_AUTO_ATTEMPTS) return status;
  if (!dependencies.force && status.state === 'ready' && snapshots.getSlowSnapshot(profileId)) return status;
  return startSlowSync(profileId, credentials, dependencies);
}

function clearSlowStatus(profileId) {
  resetSlowSync(profileId);
}

module.exports = { startSlowSync, ensureSlowSync, getSlowStatus, resetSlowSync, clearSlowStatus, normalizeSections, RETRY_COOLDOWN_MS, inFlight };
