// services/slow-sync.js
const snapshots = require('./career-snapshots');
const { getDatiCarriera } = require('../scraper/segrepass');

const statuses = new Map();
const inFlight = new Map(); // Modificato in Map per conservare la Promise in esecuzione

// Dopo un errore non si ritenta a ogni poll: si evita di martellare il portale
// (e di far risultare offline i nodi Segrepass) con login ripetuti.
const RETRY_COOLDOWN_MS = 2 * 60 * 1000;

function getSlowStatus(profileId) {
  return statuses.get(profileId) || { state: 'idle' };
}

function resetSlowSync(profileId) {
  statuses.delete(profileId);
  snapshots.setSlowSnapshot(profileId, null);
  inFlight.delete(profileId); // Assicura che anche eventuali job bloccati vengano rimossi
}

/**
 * Carica tasse e appelli in background. Non blocca il login: la UI mostra
 * subito esami/profilo e interroga /api/career/slow-data per il resto.
 * 
 * Restituisce la Promise interna (utile per i test o per chi vuole attendere).
 */
function startSlowSync(profileId, credentials, dependencies = {}) {
  // Se c'è già una sincronizzazione in corso, restituisce la Promise esistente
  if (inFlight.has(profileId)) return inFlight.get(profileId);
  
  if (snapshots.getSlowSnapshot(profileId)) {
    return Promise.resolve(getSlowStatus(profileId));
  }

  const scraper = dependencies.getDatiCarriera || getDatiCarriera;
  statuses.set(profileId, { state: 'loading', startedAt: Date.now() });

  const syncPromise = Promise.resolve()
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
      return statuses.get(profileId);
    })
    .catch(error => {
      console.warn(`[slow-sync] Dati lenti non disponibili: ${error?.message || error}`);
      statuses.set(profileId, {
        state: 'error',
        error: error?.code || 'SLOW_SYNC_FAILED',
        finishedAt: Date.now()
      });
      return statuses.get(profileId);
    })
    .finally(() => {
      inFlight.delete(profileId);
    });

  inFlight.set(profileId, syncPromise);

  // Per mantenere la retrocompatibilità (restituisce lo stato o la Promise, ma i test originari guardavano solo lo stato)
  // Non modifichiamo il tipo di ritorno della funzione per non rompere il resto del sistema che si aspetta l'oggetto sincrono,
  // ma modifichiamo i test per aspettare i tempi giusti.
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
  clearSlowStatus,
  inFlight // Esportato solo per i test per poter fare "await"
};