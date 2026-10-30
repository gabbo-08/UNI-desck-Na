const snapshots = require('./career-snapshots');
const { getDatiCarriera } = require('../scraper/segrepass');

const statuses = new Map();
const inFlight = new Set();

// Dopo un errore non si ritenta a ogni poll: si evita di martellare il portale
// (e di far risultare offline i nodi Segrepass) con login ripetuti.
const RETRY_COOLDOWN_MS = 2 * 60 * 1000;

function getSlowStatus(profileId) {
  return statuses.get(profileId) || { state: 'idle' };
}

function resetSlowSync(profileId) {
  statuses.delete(profileId);
  snapshots.setSlowSnapshot(profileId, null);
}

/**
 * Carica tasse e appelli in background. Non blocca il login: la UI mostra
 * subito esami/profilo e interroga /api/career/slow-data per il resto.
 */
function startSlowSync(profileId, credentials, dependencies = {}) {
  if (inFlight.has(profileId)) return getSlowStatus(profileId);
  if (snapshots.getSlowSnapshot(profileId)) return getSlowStatus(profileId);

  const scraper = dependencies.getDatiCarriera || getDatiCarriera;
  inFlight.add(profileId);
  statuses.set(profileId, { state: 'loading', startedAt: Date.now() });

  Promise.resolve()
    .then(() => scraper(credentials, { phase: 'slow' }))
    .then(data => {
      const taxes = data?.tasse || null;
      const prenotazioni = Array.isArray(data?.prenotazioni) ? data.prenotazioni : [];

      snapshots.setTaxesSnapshot(profileId, taxes);
      snapshots.setSlowSnapshot(profileId, {
        taxes,
        prenotazioni,
        updatedAt: Date.now()
      });
      statuses.set(profileId, { state: 'ready', finishedAt: Date.now() });
    })
    .catch(error => {
      console.warn(`[slow-sync] Dati lenti non disponibili: ${error?.message || error}`);
      statuses.set(profileId, {
        state: 'error',
        error: error?.code || 'SLOW_SYNC_FAILED',
        finishedAt: Date.now()
      });
    })
    .finally(() => inFlight.delete(profileId));

  return getSlowStatus(profileId);
}

/**
 * Avvia il caricamento se non c'è già un risultato o un job in corso.
 * Utile dopo un riavvio del server: le credenziali sono ancora in memoria.
 */
function ensureSlowSync(profileId, credentials, dependencies = {}) {
  const status = getSlowStatus(profileId);
  if (status.state === 'loading') return status;
  if (snapshots.getSlowSnapshot(profileId)) return status;
  if (status.state === 'error' && Date.now() - (status.finishedAt || 0) < RETRY_COOLDOWN_MS) return status;
  return startSlowSync(profileId, credentials, dependencies);
}

function clearSlowStatus(profileId) {
  statuses.delete(profileId);
}

module.exports = {
  startSlowSync,
  ensureSlowSync,
  getSlowStatus,
  resetSlowSync,
  clearSlowStatus
};
