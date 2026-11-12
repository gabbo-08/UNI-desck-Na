require('dotenv').config();

function isStrongCredentialKey(value) {
  return /^[0-9a-fA-F]{64}$/.test(value)
    && new Set(value.toLowerCase()).size >= 8
    && !/^([0-9a-fA-F])\1+$/.test(value);
}

function parseOrigins(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function validateOrigins(origins, { production = false } = {}) {
  if (!origins.length) return !production;
  return origins.every(value => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || (!production && url.protocol === 'http:'))
        && !url.username && !url.password
        && url.pathname === '/' && !url.search && !url.hash;
    } catch {
      return false;
    }
  });
}

function runChecks(env = process.env) {
  const checks = [];
  const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const check = (name, ok, message) => checks.push({ name, ok, message });

  check('CRED_KEY', isStrongCredentialKey(String(env.CRED_KEY || '')),
    'obbligatoria come chiave esadecimale casuale di 32 byte (64 caratteri; almeno 8 simboli distinti)');

  const username = env.DOCENTI_USERNAME || '';
  const password = env.DOCENTI_PASSWORD || '';
  const hasDocentiCredentials = Boolean(username && password);
  check('DOCENTI_USERNAME', !username || username === username.trim(), 'presenta spazi ai bordi');
  check('DOCENTI_PASSWORD', !password || password === password.trim(), 'presenta spazi ai bordi');

  check('PORT', !env.PORT || /^\d{1,5}$/.test(env.PORT) && Number(env.PORT) > 0 && Number(env.PORT) < 65536,
    'deve essere una porta TCP valida');

  const origins = parseOrigins(env.FRONTEND_URL);
  check('FRONTEND_URL', validateOrigins(origins, { production }),
    production
      ? 'obbligatoria e deve contenere solo origini https valide'
      : 'deve contenere URL http(s) validi separati da virgole');

  const debugEnabled = /^(1|true|yes|on)$/i.test(String(env.DEBUG_SCRAPER || '').trim());
  check('DEBUG_SCRAPER', !production || !debugEnabled, 'deve essere disattivato in produzione');

  if (production) {
    check('TRUST_PROXY', Boolean(String(env.TRUST_PROXY || '').trim()),
      'obbligatorio in produzione: configura solo proxy fidati oppure usa TRUST_PROXY=0');
    check('PUBLIC_ORIGIN', Boolean(String(env.PUBLIC_ORIGIN || '').trim()),
      'obbligatoria in produzione per fissare host e origine pubblici');
    check('COOKIE_SECURE', String(env.COOKIE_SECURE || 'true').toLowerCase() === 'true',
      'deve essere true in produzione');
  }

  return { checks, production, hasDocentiCredentials };
}

function main(env = process.env) {
  const result = runChecks(env);
  for (const { name, ok, message } of result.checks) {
    console.log(`${ok ? '[OK]' : '[!]'} ${name}: ${ok ? 'valida' : message}`);
  }
  console.log(`\nDocenti: ${result.hasDocentiCredentials ? 'credenziali presenti' : 'credenziali assenti (solo avvisi pubblici)'}`);
  console.log(`Ambiente: ${env.NODE_ENV || 'development'}`);
  return result.checks.every(item => item.ok);
}

if (require.main === module) process.exit(main() ? 0 : 1);

module.exports = { isStrongCredentialKey, parseOrigins, validateOrigins, runChecks, main };
