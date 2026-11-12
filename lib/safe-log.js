const crypto = require('node:crypto');

function safeProfileRef(value) {
  if (!value) return 'anonymous';
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
}

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'ERROR').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
}

function safeErrorMeta(error) {
  return {
    code: safeErrorCode(error),
    status: Number.isInteger(error?.status) ? error.status : undefined
  };
}

module.exports = { safeProfileRef, safeErrorCode, safeErrorMeta };
