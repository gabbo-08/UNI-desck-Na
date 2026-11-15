const crypto = require('node:crypto');

function metricsAuthorized(request, env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() !== 'production') return true;

  const expected = String(env.METRICS_TOKEN || '');
  const provided = String(request?.get?.('x-metrics-token') || '');
  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  return expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

module.exports = { metricsAuthorized };
