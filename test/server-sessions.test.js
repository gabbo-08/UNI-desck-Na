process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../db');
const {
  ABSOLUTE_TTL_MS,
  IDLE_TTL_MS,
  createServerSession,
  resolveServerSession,
  getSessionCredentials,
  deleteServerSession,
  cleanupExpiredSessions
} = require('../services/server-sessions');

test('persiste solo hash del token e credenziali cifrate e applica idle e scadenza assoluta', () => {
  const database = createDatabase(':memory:');
  const now = Date.UTC(2026, 0, 1);
  const session = createServerSession('AAABBB00A00A000A', {
    codiceFiscale: 'AAABBB00A00A000A', email: 'studente@studenti.unina.it', password: 'password-segreta'
  }, { database, now });
  const row = database.prepare('SELECT * FROM Sessions').get();

  assert.equal(Buffer.from(session.token, 'base64url').length, 32);
  assert.equal(row.token_hash.length, 64);
  assert.equal(row.token_hash.includes(session.token), false);
  assert.equal(row.credentials_ciphertext.includes('password-segreta'), false);
  assert.equal(session.absoluteExpiresAt, new Date(now + ABSOLUTE_TTL_MS).toISOString());
  assert.equal(session.idleExpiresAt, new Date(now + IDLE_TTL_MS).toISOString());

  const resolved = resolveServerSession(session.token, { database, now: now + 1000 });
  assert.equal(resolved.profileId, 'AAABBB00A00A000A');
  assert.equal(getSessionCredentials(session.tokenHash, { database, now: now + 1000 }).password, 'password-segreta');
  assert.equal(resolveServerSession('token-invalido', { database, now }), null);

  assert.equal(resolveServerSession(session.token, { database, now: now + IDLE_TTL_MS + 2000 }), null);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM Sessions').get().count, 0);
  database.close();
});

test('elimina sessioni scadute e supporta logout per token opaco', () => {
  const database = createDatabase(':memory:');
  const now = Date.UTC(2026, 0, 1);
  const session = createServerSession('profile', { password: 'secret' }, { database, now });
  assert.equal(deleteServerSession(session.token, { database }), true);
  createServerSession('expired', { password: 'secret' }, { database, now: now - ABSOLUTE_TTL_MS - 1 });
  assert.equal(cleanupExpiredSessions(database, now), 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM Sessions').get().count, 0);
  database.close();
});
