process.env.DB_PATH = ':memory:';
process.env.CRED_KEY ||= '0123456789abcdef'.repeat(4);
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const router = require('../routes/career');
const slowSync = require('../services/slow-sync');
const snapshots = require('../services/career-snapshots');
const { db } = require('../db');
const { upsertStudentProfile, saveStudentSlowData } = require('../db/repository');
const { createServerSession } = require('../services/server-sessions');

async function serverFor(t, id) {
  upsertStudentProfile(db, { id });
  const session = createServerSession(id, { codiceFiscale: id, password: 'fake-test-password' });
  const app = express();
  app.use((req, _res, next) => { req.user = { sub: id }; req.authSession = { tokenHash: session.tokenHash }; next(); });
  app.use('/api/career', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => { slowSync.resetSlowSync(id); snapshots.clearSnapshots(id); });
  return `http://127.0.0.1:${server.address().port}/api/career/slow-data`;
}

test('slow-data espone stato parziale e conserva i dati disponibili con retryAfter', async t => {
  const id = 'slow-route-partial';
  const base = await serverFor(t, id);
  snapshots.setSlowSnapshot(id, { taxes: { available: true, pending: [{ importo: 80 }] }, prenotazioni: [{ id: 'saved' }], updatedAt: 123 });
  const original = slowSync.ensureSlowSync;
  t.after(() => { slowSync.ensureSlowSync = original; });
  slowSync.ensureSlowSync = () => ({ state: 'partial', retryAfterMs: 5000, sections: { taxes: { status: 'ready' }, appelli: { status: 'error', stale: true, error: 'APPELLI_TIMEOUT' } } });
  const response = await fetch(base);
  const body = await response.json();
  assert.equal(body.status, 'partial');
  assert.equal(body.retryAfterMs, 5000);
  assert.equal(body.taxes.pending[0].importo, 80);
  assert.equal(body.prenotazioni[0].id, 'saved');
  assert.equal(body.sections.appelli.error, 'APPELLI_TIMEOUT');
});

test('refresh esplicito non e ignorato dalla cache persistita e restituisce i dati precedenti', async t => {
  const id = 'slow-route-refresh';
  const base = await serverFor(t, id);
  saveStudentSlowData(id, { taxes: { available: true, paid: [{ importo: 90 }], pending: [] }, prenotazioni: [] });
  const original = slowSync.ensureSlowSync;
  t.after(() => { slowSync.ensureSlowSync = original; });
  let options;
  slowSync.ensureSlowSync = (_id, _credentials, configuration) => {
    options = configuration;
    return { state: 'loading', sections: { taxes: { status: 'loading', stale: true }, appelli: { status: 'loading', stale: true } } };
  };
  const body = await (await fetch(`${base}?refresh=1`)).json();
  assert.equal(options.force, true);
  assert.equal(options.initialSnapshot.taxes.paid[0].importo, 90);
  assert.equal(body.status, 'loading');
  assert.equal(body.taxes.paid[0].importo, 90);
  assert.equal(body.fromPersistence, true);
});
