const crypto = require('crypto');
const { db: defaultDb } = require('../db');
const { seal, open } = require('../lib/secret-box');

const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDLE_TTL_MS = 12 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function validToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    return Buffer.from(token, 'base64url').length === 32;
  } catch {
    return false;
  }
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createServerSession(profileId, credentials, options = {}) {
  const database = options.database || defaultDb;
  const now = options.now ?? Date.now();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sessionTokenHash(token);
  const createdAt = new Date(now).toISOString();
  const absoluteExpiresAt = new Date(now + ABSOLUTE_TTL_MS).toISOString();
  const idleExpiresAt = new Date(now + IDLE_TTL_MS).toISOString();
  const credentialsCiphertext = seal(JSON.stringify(credentials), `${profileId}:${tokenHash}`);

  database.prepare(`
    INSERT INTO Sessions (
      token_hash, profile_id, credentials_ciphertext, created_at,
      last_seen_at, absolute_expires_at, idle_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tokenHash, profileId, credentialsCiphertext, createdAt, createdAt, absoluteExpiresAt, idleExpiresAt);

  return { token, tokenHash, profileId, createdAt, absoluteExpiresAt, idleExpiresAt };
}

function resolveServerSession(token, options = {}) {
  if (!validToken(token)) return null;
  const database = options.database || defaultDb;
  const now = options.now ?? Date.now();
  const computedHash = hashToken(token);
  const stored = database.prepare('SELECT * FROM Sessions WHERE token_hash = ?').get(computedHash.toString('hex'));
  if (!stored) return null;

  const storedHash = Buffer.from(stored.token_hash, 'hex');
  if (storedHash.length !== computedHash.length || !crypto.timingSafeEqual(storedHash, computedHash)) return null;
  if (Date.parse(stored.absolute_expires_at) <= now || Date.parse(stored.idle_expires_at) <= now) {
    database.prepare('DELETE FROM Sessions WHERE token_hash = ?').run(stored.token_hash);
    return null;
  }

  const lastSeenAt = new Date(now).toISOString();
  const idleExpiresAt = new Date(Math.min(now + IDLE_TTL_MS, Date.parse(stored.absolute_expires_at))).toISOString();
  const updated = database.prepare(`
    UPDATE Sessions SET last_seen_at = ?, idle_expires_at = ?
    WHERE token_hash = ? AND absolute_expires_at > ? AND idle_expires_at > ?
  `).run(lastSeenAt, idleExpiresAt, stored.token_hash, lastSeenAt, lastSeenAt);
  if (!updated.changes) return null;

  return {
    tokenHash: stored.token_hash,
    profileId: stored.profile_id,
    absoluteExpiresAt: stored.absolute_expires_at,
    idleExpiresAt
  };
}

function getSessionCredentials(tokenHash, options = {}) {
  const database = options.database || defaultDb;
  const now = options.now ?? Date.now();
  if (typeof tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHash)) return null;
  const stored = database.prepare(`
    SELECT profile_id, credentials_ciphertext FROM Sessions
    WHERE token_hash = ? AND absolute_expires_at > ? AND idle_expires_at > ?
  `).get(tokenHash, new Date(now).toISOString(), new Date(now).toISOString());
  if (!stored) return null;
  try {
    const credentials = JSON.parse(open(stored.credentials_ciphertext, `${stored.profile_id}:${tokenHash}`) || 'null');
    return credentials && typeof credentials === 'object' ? credentials : null;
  } catch {
    return null;
  }
}

function deleteServerSession(token, options = {}) {
  if (!validToken(token)) return false;
  const database = options.database || defaultDb;
  return database.prepare('DELETE FROM Sessions WHERE token_hash = ?').run(sessionTokenHash(token)).changes > 0;
}

function cleanupExpiredSessions(database = defaultDb, now = Date.now()) {
  const instant = new Date(now).toISOString();
  return database.prepare('DELETE FROM Sessions WHERE absolute_expires_at <= ? OR idle_expires_at <= ?')
    .run(instant, instant).changes;
}

function startSessionCleanup(database = defaultDb) {
  cleanupExpiredSessions(database);
  const timer = setInterval(() => cleanupExpiredSessions(database), CLEANUP_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  ABSOLUTE_TTL_MS,
  IDLE_TTL_MS,
  createServerSession,
  resolveServerSession,
  getSessionCredentials,
  deleteServerSession,
  cleanupExpiredSessions,
  startSessionCleanup,
  sessionTokenHash,
  validToken
};
