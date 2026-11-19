const { isStrongCredentialKey } = require('./security-config');
const { isExplicitTrustProxy } = require('./proxy-config');

const RETENTION_UNITS = {
  PERSONAL_DATA_RETENTION_DAYS: 86_400_000,
  DOCENTI_CACHE_RETENTION_HOURS: 3_600_000,
  TEACHER_CACHE_RETENTION_DAYS: 86_400_000,
};

function invalidRetentionSettings(env = process.env) {
  return Object.entries(RETENTION_UNITS).filter(([name, unit]) => {
    if (env[name] === undefined || env[name] === '') return false;
    const value = Number(env[name]);
    // Leave room for the current timestamp within the JavaScript Date range.
    return !Number.isFinite(value) || value < 1 || value * unit >= 8_000_000_000_000_000;
  }).map(([name]) => name);
}

function configuredOrigins(env = process.env) {
  return String(env.FRONTEND_URL || '').split(',').map(item => item.trim()).filter(Boolean);
}

function validateOrigins(origins, { production = false } = {}) {
  if (!origins.length) return !production;
  return origins.every(value => {
    try {
      const url = new URL(String(value));
      return (url.protocol === 'https:' || (!production && url.protocol === 'http:')) &&
        !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    } catch {
      return false;
    }
  });
}

function isValidPort(value) {
  return !value || /^\d{1,5}$/.test(String(value)) && Number(value) > 0 && Number(value) < 65536;
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
  const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const errors = [];
  const warnings = [];
  const origins = configuredOrigins(env);

  for (const name of invalidRetentionSettings(env)) {
    errors.push(`${name} deve essere un numero finito almeno pari a 1 entro il limite delle date JavaScript`);
  }

  if (!isValidPort(env.PORT)) errors.push('PORT deve essere una porta TCP valida');
  if (!validateOrigins(origins, { production })) {
    errors.push(production ? 'FRONTEND_URL deve contenere solo origini HTTPS in produzione' : 'FRONTEND_URL deve contenere solo origini HTTP(S) valide');
  }
  const cookieSameSite = String(env.COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  if (!['strict', 'lax', 'none'].includes(cookieSameSite)) {
    errors.push('COOKIE_SAMESITE deve essere strict, lax oppure none');
  }
  const secureCookie = String(env.COOKIE_SECURE || (production ? 'true' : 'false')).toLowerCase() === 'true';
  if (cookieSameSite === 'none' && !secureCookie) {
    errors.push('COOKIE_SAMESITE=none richiede COOKIE_SECURE=true');
  }

  if (!isStrongCredentialKey(env.CRED_KEY)) {
    errors.push('CRED_KEY deve essere una chiave esadecimale casuale di 32 byte (64 caratteri; almeno 8 simboli distinti)');
  }

  if (!production && origins.length === 0 && String(env.ALLOW_DYNAMIC_ORIGIN || '').toLowerCase() !== 'true') {
    warnings.push('FRONTEND_URL non configurato: in sviluppo sono consentite solo le origini locali predefinite e le richieste browser da altre origini saranno rifiutate da CORS/CSRF');
  }

  if (production) {
    if (String(env.COOKIE_SECURE || 'true').toLowerCase() !== 'true') {
      errors.push('COOKIE_SECURE deve essere true in produzione');
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

module.exports = { configuredOrigins, validateOrigins, isValidPort, isHttpsOrigin, invalidRetentionSettings, validateRuntimeConfig, assertRuntimeConfig };
