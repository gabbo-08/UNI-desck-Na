// Configurazione condivisa: un'unica fonte per il segreto JWT.
const DEV_FALLBACK_SECRET = 'segrepass_secret_key_change_in_prod';
const JWT_TTL = '7d';

function resolveJwtSecret(env = process.env) {
  const configured = env.JWT_SECRET && env.JWT_SECRET.trim();
  if (configured) return configured;
  if (env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET è obbligatorio quando NODE_ENV=production.');
  }
  console.warn('[Config] JWT_SECRET non impostato: uso il segreto di sviluppo.');
  return DEV_FALLBACK_SECRET;
}

const JWT_SECRET = resolveJwtSecret();

module.exports = { JWT_SECRET, JWT_TTL, resolveJwtSecret };
