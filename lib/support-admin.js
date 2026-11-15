const crypto = require('node:crypto');

function supportAdminAuthorized(request, env = process.env) {
  const expected = String(env.SUPPORT_ADMIN_TOKEN || '');
  if (!expected) return false;
  const header = String(request?.get?.('x-support-admin-token') || '');
  const authorization = String(request?.get?.('authorization') || '');
  const provided = header || (authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '');
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  return expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

module.exports = { supportAdminAuthorized };
