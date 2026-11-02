// test/slow-sync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startSlowSync,
  ensureSlowSync,
  getSlowStatus,
  resetSlowSync,
  inFlight
} = require('../services/slow-sync');
const { getSlowSnapshot, getTaxesSnapshot, clearSnapshots } = require('../services/career-snapshots');

const CREDENTIALS = { codiceFiscale: 'AAABBB00A00A000A', password: 'test' };

function slowPayload() {
  return {
    tasse: {
      available: true,
      paid: [],
      pending: [{ importo: 130, descrizione: 'Contributo' }],
      summary: { totalPaid: 0, totalPending: 130, nextDeadline: null }
    },
    prenotazioni: [{ id: 'appello_1', materia: 'Analisi I', dataAppello: '10/01/2027' }]
  };
}

test('carica tasse e appelli in background e aggiorna lo stato', async t => {
  const profileId = 'slow-sync-profile-1';
  t.after(() => clearSnapshots(profileId));

  const status = startSlowSync(profileId, CREDENTIALS, {
    getDatiCarriera: async (_credentials, options) => {
      assert.equal(options.phase, 'slow');
      return slowPayload();
    }
  });
  assert.equal(status.state, 'loading');

  if (inFlight.has(profileId)) await inFlight.get(profileId);
  else await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(getSlowStatus(profileId).state, 'ready');
  assert.equal(getSlowSnapshot(profileId).prenotazioni.length, 1);
  assert.equal(getSlowSnapshot(profileId).taxes.available, true);
  assert.equal(getTaxesSnapshot(profileId).available, true);
});

test('non avvia due job contemporanei per lo stesso studente', async t => {
  const profileId = 'slow-sync-profile-2';
  t.after(() => clearSnapshots(profileId));

  let calls = 0;
  const deps = {
    getDatiCarriera: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 50)); // Timeout aumentato per garantire l'overlap
      return slowPayload();
    }
  };

  startSlowSync(profileId, CREDENTIALS, deps);
  startSlowSync(profileId, CREDENTIALS, deps);
  
  if (inFlight.has(profileId)) await inFlight.get(profileId);
  else await new Promise(resolve => setTimeout(resolve, 100)); // Aspetta abbondantemente la fine del job

  assert.equal(calls, 1);
  assert.equal(getSlowStatus(profileId).state, 'ready');
});

test('registra un errore stabile quando lo scraping lento fallisce', async t => {
  const profileId = 'slow-sync-profile-3';
  t.after(() => clearSnapshots(profileId));

  startSlowSync(profileId, CREDENTIALS, {
    getDatiCarriera: async () => {
      const error = new Error('timeout');
      error.code = 'SLOW_TIMEOUT';
      throw error;
    }
  });

  if (inFlight.has(profileId)) await inFlight.get(profileId);
  else await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(getSlowStatus(profileId).state, 'error');
  assert.equal(getSlowStatus(profileId).error, 'SLOW_TIMEOUT');
});

test('ensureSlowSync non riavvia se i dati sono già pronti', async t => {
  const profileId = 'slow-sync-profile-4';
  t.after(() => clearSnapshots(profileId));

  let calls = 0;
  const deps = {
    getDatiCarriera: async () => { calls += 1; return slowPayload(); }
  };

  startSlowSync(profileId, CREDENTIALS, deps);
  
  if (inFlight.has(profileId)) await inFlight.get(profileId);
  else await new Promise(resolve => setTimeout(resolve, 20));
  
  ensureSlowSync(profileId, CREDENTIALS, deps);

  assert.equal(calls, 1);
  assert.equal(getSlowStatus(profileId).state, 'ready');
});

test('resetSlowSync riporta lo stato a idle e svuota lo snapshot', async t => {
  const profileId = 'slow-sync-profile-5';
  t.after(() => clearSnapshots(profileId));

  startSlowSync(profileId, CREDENTIALS, {
    getDatiCarriera: async () => slowPayload()
  });
  
  if (inFlight.has(profileId)) await inFlight.get(profileId);
  else await new Promise(resolve => setTimeout(resolve, 20));
  
  resetSlowSync(profileId);

  assert.equal(getSlowStatus(profileId).state, 'idle');
  assert.equal(getSlowSnapshot(profileId), null);
});

test('resetSlowSync impedisce a un job precedente di sovrascrivere il nuovo login', async t => {
  const profileId = 'slow-sync-profile-race';
  t.after(() => clearSnapshots(profileId));

  let releaseOld;
  const oldJob = new Promise(resolve => { releaseOld = resolve; });
  const old = startSlowSync(profileId, CREDENTIALS, {
    getDatiCarriera: async () => {
      await oldJob;
      return { tasse: { marker: 'old' }, prenotazioni: [] };
    }
  });
  assert.equal(old.state, 'loading');

  resetSlowSync(profileId);
  startSlowSync(profileId, CREDENTIALS, {
    getDatiCarriera: async () => ({ tasse: { marker: 'new' }, prenotazioni: [] })
  });
  await inFlight.get(profileId);
  releaseOld();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(getSlowSnapshot(profileId).taxes.marker, 'new');
});