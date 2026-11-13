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
  const origins = configuredOrigins(env);

  if (production) {
    if (!origins.length || origins.some(origin => !isHttpsOrigin(origin))) {
      errors.push('FRONTEND_URL deve contenere solo origini HTTPS in produzione');
    }
    if (String(env.COOKIE_SECURE || 'true').toLowerCase() !== 'true') {
      errors.push('COOKIE_SECURE deve essere true in produzione');
    }
    if (!String(env.TRUST_PROXY || '').trim()) {
      errors.push('TRUST_PROXY deve essere configurato in produzione');
    }
    if (!isHttpsOrigin(String(env.PUBLIC_ORIGIN || '').trim())) {
      errors.push('PUBLIC_ORIGIN deve essere HTTPS in produzione');
    }
    if (String(env.DEBUG_SCRAPER || '').trim()) {
      errors.push('DEBUG_SCRAPER deve essere disabilitato in produzione');
    }
  }

  return { production, errors, origins };
}

function assertRuntimeConfig(env = process.env) {
  const result = validateRuntimeConfig(env);
  if (result.errors.length) {
    const error = new Error(`Configurazione non sicura: ${result.errors.join('; ')}`);
    error.code = 'UNSAFE_RUNTIME_CONFIG';
    error.status = 500;
    throw error;
  }
  return result;
}

module.exports = { configuredOrigins, isHttpsOrigin, validateRuntimeConfig, assertRuntimeConfig };
