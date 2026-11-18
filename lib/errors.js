// lib/errors.js
function sessionErrorStatus(error) {
  if (error?.status) return error.status;
  if (error?.retryAfterMs) return 429;
  if (error?.code === 'INVALID_CREDENTIALS') return 401;
  if (error?.code === 'CF_RESOLUTION_FAILED') return 422;
  if (error?.code === 'PORTAL_UNAVAILABLE') return 502;
  if (error?.code === 'DOCENTI_AUTH_FAILED') return 502;
  if (/credenziali/i.test(error?.message || '')) return 401;
  return 502;
}

function sessionErrorMessage(error) {
  if (error?.status === 400) {
    return 'Inserisci la tua email istituzionale (@studenti.unina.it) e la password.';
  }
  if (error?.status === 429 || error?.retryAfterMs) {
    return error?.message || 'Troppi tentativi ravvicinati. Attendi qualche secondo e riprova.';
  }
  const known = {
    INVALID_CREDENTIALS: 'Credenziali non valide. Verifica email @studenti.unina.it e password.',
    CF_RESOLUTION_FAILED: 'Accesso verificato, ma impossibile recuperare il Codice Fiscale dal portale Docenti.',
    PORTAL_UNAVAILABLE: 'I portali UNINA non sono raggiungibili al momento. Riprova tra poco.',
    DOCENTI_AUTH_FAILED: 'Accesso al portale Docenti non riuscito.',
    DOCENTI_SYNC_DISABLED: 'L’integrazione con il portale Docenti non è abilitata.',
    INVALID_LOGIN: 'Inserisci un indirizzo @studenti.unina.it valido.'
  };
  if (known[error?.code]) return known[error.code];
  if (/Cluster non inizializzato/i.test(error?.message || '')) {
    return 'Il server si sta avviando. Riprova tra qualche secondo.';
  }
  return 'Impossibile completare la richiesta. Riprova tra qualche secondo.';
}

module.exports = { sessionErrorStatus, sessionErrorMessage };
