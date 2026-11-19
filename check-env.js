require('dotenv').config();
const { isStrongCredentialKey } = require('./lib/security-config');
const { isExplicitTrustProxy } = require('./lib/proxy-config');
const { validateOrigins, isValidPort, isHttpsOrigin, invalidRetentionSettings } = require('./lib/runtime-config');

function parseOrigins(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function runChecks(env = process.env) {
  const checks = [];
  const warnings = [];
  const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const check = (name, ok, message) => checks.push({ name, ok, message });

  check('CRED_KEY', isStrongCredentialKey(String(env.CRED_KEY || '')),
    'obbligatoria come chiave esadecimale casuale di 32 byte (64 caratteri; almeno 8 simboli distinti)');

  const username = env.DOCENTI_USERNAME || '';
  const password = env.DOCENTI_PASSWORD || '';
  const hasDocentiCredentials = Boolean(username && password);
  check('DOCENTI_USERNAME', !username || username === username.trim(), 'presenta spazi ai bordi');
  check('DOCENTI_PASSWORD', !password || password === password.trim(), 'presenta spazi ai bordi');

  check('PORT', isValidPort(env.PORT),
    'deve essere una porta TCP valida');

  const origins = parseOrigins(env.FRONTEND_URL);
  const invalidRetention = invalidRetentionSettings(env);
  for (const name of ['PERSONAL_DATA_RETENTION_DAYS', 'DOCENTI_CACHE_RETENTION_HOURS', 'TEACHER_CACHE_RETENTION_DAYS']) {
    check(name, !invalidRetention.includes(name), 'deve essere un numero finito almeno pari a 1 entro il limite delle date JavaScript');
  }
  check('FRONTEND_URL', validateOrigins(origins, { production }),
    production
      ? 'obbligatoria e deve contenere solo origini https valide'
      : 'deve contenere URL http(s) validi separati da virgole');

  if (!production && origins.length === 0 && !/^(1|true|yes|on)$/i.test(String(env.ALLOW_DYNAMIC_ORIGIN || '').trim())) {
    warnings.push('FRONTEND_URL non configurato: in sviluppo sono consentite solo le origini locali predefinite; le altre richieste browser verranno rifiutate da CORS/CSRF');
  }

  const debugEnabled = /^(1|true|yes|on)$/i.test(String(env.DEBUG_SCRAPER || '').trim());
  check('DEBUG_SCRAPER', !production || !debugEnabled, 'deve essere disattivato in produzione');

  const cookieSameSite = String(env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  const secureCookie = String(env.COOKIE_SECURE || (production ? 'true' : 'false')).toLowerCase() === 'true';
  check('COOKIE_SAMESITE', ['strict', 'lax', 'none'].includes(cookieSameSite) && (cookieSameSite !== 'none' || secureCookie),
    'deve essere strict, lax oppure none; none richiede COOKIE_SECURE=true');

  if (production) {
    check('TRUST_PROXY', isExplicitTrustProxy(env.TRUST_PROXY),
      'obbligatorio in produzione: usa 0, un numero di hop o IP/CIDR; non true/on/yes');
    check('PUBLIC_ORIGIN', isHttpsOrigin(String(env.PUBLIC_ORIGIN || '').trim()),
      'obbligatoria come origine HTTPS in produzione, senza percorso o credenziali');
    check('COOKIE_SECURE', String(env.COOKIE_SECURE || 'true').toLowerCase() === 'true',
      'deve essere true in produzione');
  }

  return { checks, warnings, production, hasDocentiCredentials };
}

function main(env = process.env) {
  const result = runChecks(env);
  for (const { name, ok, message } of result.checks) {
    console.log(`${ok ? '[OK]' : '[!]'} ${name}: ${ok ? 'valida' : message}`);
  }
  console.log(`\nDocenti: ${result.hasDocentiCredentials ? 'credenziali presenti' : 'credenziali assenti (solo avvisi pubblici)'}`);
  console.log(`Ambiente: ${env.NODE_ENV || 'development'}`);
  for (const warning of result.warnings) console.warn(`[WARN] ${warning}`);
  return result.checks.every(item => item.ok);
}

if (require.main === module) process.exit(main() ? 0 : 1);

module.exports = { isStrongCredentialKey, parseOrigins, validateOrigins, runChecks, main };
