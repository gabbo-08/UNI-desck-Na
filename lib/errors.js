// Errori HTTP condivisi tra i due entry point di login.
function sessionErrorStatus(error) {
  if (error?.status) return error.status;
  if (error?.retryAfterMs) return 429;
  if (error?.code === 'INVALID_CREDENTIALS') return 401;
  if (error?.code === 'PORTAL_UNAVAILABLE') return 502;
  if (error?.code === 'DOCENTI_AUTH_FAILED') return 502;
  if (/credenziali/i.test(error?.message || '')) return 401;
  return 502;
}

function sessionErrorMessage(error) {
  if (error?.status === 400) return 'Inserisci codice fiscale o email istituzionale e password.';
  if (error?.status === 429 || error?.retryAfterMs) {
    return error?.message || 'Troppi tentativi ravvicinati. Attendi qualche secondo e riprova.';
  }
  const known = {
    INVALID_CREDENTIALS: 'Credenziali non valide.',
    PORTAL_UNAVAILABLE: 'Il portale Segrepass non ? raggiungibile al momento. Riprova tra poco.',
    DOCENTI_AUTH_FAILED: 'Accesso al portale Docenti non riuscito.',
    DOCENTI_SYNC_DISABLED: 'L?integrazione con il portale Docenti non ? abilitata.',
    INVALID_LOGIN: 'Dati di accesso non validi.'
  };
  if (known[error?.code]) return known[error.code];
  if (/Cluster non inizializzato/i.test(error?.message || '')) {
    return 'Il server si sta avviando. Riprova tra qualche secondo.';
  }
  return 'Impossibile completare la richiesta. Riprova tra qualche secondo.';
}

module.exports = { sessionErrorStatus, sessionErrorMessage };
