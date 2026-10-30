// lib/secret-box.js
// Cifratura simmetrica (AES-256-GCM) per tenere la password dentro il JWT
// senza renderla leggibile a chi possiede il token.
const crypto = require('crypto');
const { JWT_SECRET } = require('./config');

function key() {
  // CRED_KEY è consigliata (chiave dedicata); in sua assenza si deriva da JWT_SECRET.
  const material = process.env.CRED_KEY || `cred:${JWT_SECRET}`;
  return crypto.createHash('sha256').update(material).digest();
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
