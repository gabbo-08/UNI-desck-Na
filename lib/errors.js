// Errori HTTP condivisi tra i due entry point di login.
function sessionErrorStatus(error) {
  if (error?.status) return error.status;
  if (error?.code === 'INVALID_CREDENTIALS') return 401;
  if (error?.code === 'PORTAL_UNAVAILABLE') return 502;
  if (error?.code === 'DOCENTI_AUTH_FAILED') return 502;
  if (/credenziali/i.test(error?.message || '')) return 401;
  return 502;
}

function sessionErrorMessage(error) {
  if (error?.status === 400) return 'Inserisci codice fiscale o email istituzionale e password.';
  const known = {
    INVALID_CREDENTIALS: 'Credenziali non valide.',
    PORTAL_UNAVAILABLE: 'Il portale non è raggiungibile al momento.',
    DOCENTI_AUTH_FAILED: 'Accesso al portale Docenti non riuscito.',
    DOCENTI_SYNC_DISABLED: 'L’integrazione con il portale Docenti non è abilitata.',
    INVALID_LOGIN: 'Dati di accesso non validi.'
  };
  return known[error?.code] || 'Impossibile completare la richiesta.';
}

module.exports = { sessionErrorStatus, sessionErrorMessage };
