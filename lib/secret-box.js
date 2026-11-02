// lib/secret-box.js
// Cifratura simmetrica AES-256-GCM per le credenziali mantenute lato server.
const crypto = require('crypto');

function key() {
  const configured = process.env.CRED_KEY || '';
  const isTest = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT ||
    process.argv.some(argument => /\.test\.js$/.test(argument));
  if (isTest && !configured) return Buffer.alloc(32);
  if (!/^[0-9a-fA-F]{64}$/.test(configured)) {
    throw new Error('CRED_KEY è obbligatoria e deve essere esadecimale di 32 byte.');
  }
  return Buffer.from(configured, 'hex');
}

function seal(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}

function open(sealed) {
  try {
    const [iv, tag, enc] = String(sealed).split('.').map(part => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { seal, open };
