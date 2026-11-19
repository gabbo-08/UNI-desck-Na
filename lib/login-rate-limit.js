const crypto = require('node:crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const { deriveKey } = require('./secret-box');

function loginRateLimitKey(req) {
  // Stessa precedenza usata dal login: i client attuali inviano email, quelli
  // precedenti possono inviarla in codiceFiscale o identifier.
  const account = String(req.body?.email ?? req.body?.codiceFiscale ?? req.body?.identifier ?? '')
    .trim().toLowerCase();
  const accountHash = crypto.createHmac('sha256', deriveKey('login-rate-limit'))
    .update(account).digest('hex').slice(0, 20);
  return `${ipKeyGenerator(req.ip)}:${accountHash}`;
}

module.exports = { loginRateLimitKey };
