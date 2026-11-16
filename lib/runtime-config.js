const { isStrongCredentialKey } = require('./security-config');
const { isExplicitTrustProxy } = require('./proxy-config');

function configuredOrigins(env = process.env) {
  return String(env.FRONTEND_URL || '').split(',').map(item => item.trim()).filter(Boolean);
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validateRuntimeConfig(env = process.env) {
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const errors = [];
  const warnings = [];
  const origins = configuredOrigins(env);

  if (!isStrongCredentialKey(env.CRED_KEY)) {
    errors.push('CRED_KEY deve essere una chiave esadecimale casuale di 32 byte (64 caratteri; almeno 8 simboli distinti)');
  }

  if (!production && origins.length === 0 && String(env.ALLOW_DYNAMIC_ORIGIN || '').toLowerCase() !== 'true') {
    warnings.push('FRONTEND_URL non configurato: in sviluppo sono consentite solo le origini locali predefinite e le richieste browser da altre origini saranno rifiutate da CORS/CSRF');
  }

  if (production) {
    if (!origins.length || origins.some(origin => !isHttpsOrigin(origin))) {
      errors.push('FRONTEND_URL deve contenere solo origini HTTPS in produzione');
    }
    if (String(env.COOKIE_SECURE || 'true').toLowerCase() !== 'true') {
      errors.push('COOKIE_SECURE deve essere true in produzione');
    }
    const cookieSameSite = String(env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
    if (!['strict', 'lax', 'none'].includes(cookieSameSite)) {
      errors.push('COOKIE_SAMESITE deve essere strict, lax oppure none');
    }
    if (cookieSameSite === 'none' && String(env.COOKIE_SECURE || 'true').toLowerCase() !== 'true') {
      errors.push('COOKIE_SAMESITE=none richiede COOKIE_SECURE=true');
    }
    if (!isExplicitTrustProxy(env.TRUST_PROXY)) {
      errors.push('TRUST_PROXY deve essere esplicito in produzione (usa 0, un numero di hop o IP/CIDR; non true/on/yes)');
    }
    if (!isHttpsOrigin(String(env.PUBLIC_ORIGIN || '').trim())) {
      errors.push('PUBLIC_ORIGIN deve essere HTTPS in produzione');
    }
    const debugEnabled = /^(1|true|yes|on)$/i.test(String(env.DEBUG_SCRAPER || '').trim());
    if (debugEnabled) {
      errors.push('DEBUG_SCRAPER deve essere disabilitato in produzione');
    }
  }

  return { production, errors, warnings, origins };
}

function assertRuntimeConfig(env = process.env) {
  const result = validateRuntimeConfig(env);
  if (result.errors.length) {
    const error = new Error(`Configurazione non sicura: ${result.errors.join('; ')}`);
    error.code = 'UNSAFE_RUNTIME_CONFIG';
    error.status = 500;
    throw error;
  }
  for (const warning of result.warnings) console.warn(`[Configurazione] ${warning}`);
  return result;
}

module.exports = { configuredOrigins, isHttpsOrigin, validateRuntimeConfig, assertRuntimeConfig };
