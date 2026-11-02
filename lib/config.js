// Configurazione condivisa: un'unica fonte per il segreto JWT.
const JWT_TTL = '7d';

function resolveJwtSecret(env = process.env) {
  const configured = env.JWT_SECRET && env.JWT_SECRET.trim();
  const isTest = env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT ||
    process.execArgv.includes('--test') || process.argv.some(argument => /\.test\.js$/.test(argument));
  if (configured && (configured.length >= 32 || isTest)) return configured;
  if (isTest) {
    return 'test-only-jwt-secret-must-not-be-used-in-production';
  }
  throw new Error('JWT_SECRET è obbligatorio e deve contenere almeno 32 caratteri.');
}

const JWT_SECRET = resolveJwtSecret();

module.exports = { JWT_SECRET, JWT_TTL, resolveJwtSecret };
