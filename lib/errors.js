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
  return error?.message || 'Impossibile aprire la sessione Segrepass.';
}

module.exports = { sessionErrorStatus, sessionErrorMessage };
