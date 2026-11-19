process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../db');
const {
  upsertStudentProfile,
  saveDocentiDataCache,
  getDocentiDataCache,
  savePushSubscription,
  deleteStudentData,
  purgeExpiredPersonalData
} = require('../db/repository');
const { createServerSession } = require('../services/server-sessions');

test('i JSON personali sono cifrati a riposo e leggibili solo dal repository', () => {
  const database = createDatabase(':memory:');
  try {
    const profileId = 'lifecycle-profile';
    upsertStudentProfile(database, {
      id: profileId,
      esamiSostenuti: [{ materia: 'Esame riservato', voto: 30 }],
      tasse: { pending: [{ importo: 999 }] }
    });
    saveDocentiDataCache(profileId, { available: true, subscriptions: [{ courseName: 'Corso riservato' }] }, database);

    const rawProfile = database.prepare('SELECT carriera_json, tasse_json FROM StudentProfile WHERE id = ?').get(profileId);
    const rawCache = database.prepare('SELECT data_json FROM DocentiDataCache WHERE profile_id = ?').get(profileId);
    assert.equal(rawProfile.carriera_json.includes('Esame riservato'), false);
    assert.equal(rawProfile.tasse_json.includes('999'), false);
    assert.equal(rawCache.data_json.includes('Corso riservato'), false);
    assert.deepEqual(getDocentiDataCache(profileId, database).data.subscriptions[0].courseName, 'Corso riservato');
  } finally {
    database.close();
  }
});

test('la cancellazione profilo elimina sessioni, cache e preferenze collegate', () => {
  const database = createDatabase(':memory:');
  try {
    const profileId = 'delete-profile';
    upsertStudentProfile(database, { id: profileId });
    saveDocentiDataCache(profileId, { available: true, subscriptions: [{ courseName: 'Corso' }] }, database);
    savePushSubscription(profileId, {
      endpoint: 'https://push.example.test/lifecycle',
      keys: { p256dh: 'p256dh-lifecycle', auth: 'auth-lifecycle' }
    }, database);
    createServerSession(profileId, { password: 'test-only' }, { database });
    assert.equal(deleteStudentData(profileId, database), 1);
    assert.equal(database.prepare('SELECT 1 FROM StudentProfile WHERE id = ?').get(profileId), undefined);
    assert.equal(database.prepare('SELECT 1 FROM Sessions WHERE profile_id = ?').get(profileId), undefined);
    assert.equal(database.prepare('SELECT 1 FROM DocentiDataCache WHERE profile_id = ?').get(profileId), undefined);
    assert.equal(database.prepare('SELECT 1 FROM PushSubscriptions WHERE profile_id = ?').get(profileId), undefined);
  } finally {
    database.close();
  }
});

test('il purge elimina cache scadute senza cancellare profili per default', () => {
  const database = createDatabase(':memory:');
  try {
    const profileId = 'retention-profile';
    upsertStudentProfile(database, { id: profileId });
    saveDocentiDataCache(profileId, { available: true, subscriptions: [{ courseName: 'Vecchio' }] }, database, new Date('2020-01-01T00:00:00.000Z'));
    const result = purgeExpiredPersonalData(database, Date.parse('2026-11-12T00:00:00.000Z'));
    assert.equal(result.docenti, 1);
    assert.equal(result.profiles, 0);
    assert.ok(database.prepare('SELECT 1 FROM StudentProfile WHERE id = ?').get(profileId));
  } finally {
    database.close();
  }
});

test('la retention confronta correttamente timestamp SQLite e ISO nello stesso giorno', t => {
  const database = createDatabase(':memory:');
  const previous = process.env.AUTO_PURGE_PERSONAL_DATA;
  process.env.AUTO_PURGE_PERSONAL_DATA = 'true';
  t.after(() => {
    database.close();
    if (previous === undefined) delete process.env.AUTO_PURGE_PERSONAL_DATA;
    else process.env.AUTO_PURGE_PERSONAL_DATA = previous;
  });
  upsertStudentProfile(database, { id: 'within-retention' });
  upsertStudentProfile(database, { id: 'past-retention' });
  database.prepare('UPDATE StudentProfile SET updated_at = ? WHERE id = ?')
    .run('2026-10-20 13:00:00', 'within-retention');
  database.prepare('UPDATE StudentProfile SET updated_at = ? WHERE id = ?')
    .run('2026-10-20 11:00:00', 'past-retention');

  const result = purgeExpiredPersonalData(database, Date.parse('2026-11-19T12:00:00.000Z'));
  assert.equal(result.profiles, 1);
  assert.ok(database.prepare('SELECT 1 FROM StudentProfile WHERE id = ?').get('within-retention'));
  assert.equal(database.prepare('SELECT 1 FROM StudentProfile WHERE id = ?').get('past-retention'), undefined);
});
