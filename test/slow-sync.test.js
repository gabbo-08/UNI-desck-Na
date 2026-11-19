// test/slow-sync.test.js
process.env.DB_PATH = ':memory:';
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
const { setSlowSnapshot } = require('../services/career-snapshots');
const { RETRY_COOLDOWN_MS } = require('../services/slow-sync');

const CREDENTIALS = { codiceFiscale: 'AAABBB00A00A000A', password: 'test' };

test('un errore tasse non cancella le tasse precedenti e salva gli appelli riusciti', async t => {
  const id = 'partial-taxes';
  t.after(() => { resetSlowSync(id); clearSnapshots(id); });
  setSlowSnapshot(id, { taxes: { available: true, pending: [{ importo: 150 }] }, prenotazioni: [{ id: 'old' }] });
  const saved = [];
  startSlowSync(id, CREDENTIALS, {
    getDatiCarriera: async () => ({ tasse: { available: false, reason: 'TAXES_TIMEOUT' }, prenotazioni: [{ id: 'fresh' }] }),
    saveStudentSlowData: (_profile, data) => saved.push(data)
  });
  await inFlight.get(id);
  assert.equal(getSlowStatus(id).state, 'partial');
  assert.equal(getSlowStatus(id).sections.taxes.stale, true);
  assert.equal(getSlowStatus(id).sections.taxes.error, 'TAXES_TIMEOUT');
  assert.equal(getSlowSnapshot(id).taxes.pending[0].importo, 150);
  assert.deepEqual(getSlowSnapshot(id).prenotazioni, [{ id: 'fresh' }]);
  assert.deepEqual(saved, [{ prenotazioni: [{ id: 'fresh' }] }]);
});

test('un errore appelli non viene trasformato in nessun appello e conserva lo snapshot', async t => {
  const id = 'partial-appelli';
  t.after(() => { resetSlowSync(id); clearSnapshots(id); });
  setSlowSnapshot(id, { taxes: { available: true }, prenotazioni: [{ id: 'keep' }] });
  const saved = [];
  startSlowSync(id, CREDENTIALS, {
    getDatiCarriera: async () => ({
      tasse: { available: true, pending: [] }, prenotazioni: [],
      slowSections: { taxes: { status: 'ready' }, appelli: { status: 'error', error: 'APPELLI_TIMEOUT' } }
    }),
    saveStudentSlowData: (_profile, data) => saved.push(data)
  });
  await inFlight.get(id);
  assert.equal(getSlowStatus(id).state, 'partial');
  assert.equal(getSlowStatus(id).sections.appelli.status, 'error');
  assert.deepEqual(getSlowSnapshot(id).prenotazioni, [{ id: 'keep' }]);
  assert.equal(Object.hasOwn(saved[0], 'prenotazioni'), false);
});

test('il refresh esplicito aggiorna la cache pronta ma rispetta il cooldown dopo un errore', async t => {
  const id = 'explicit-slow-refresh';
  t.after(() => { resetSlowSync(id); clearSnapshots(id); });
  let calls = 0;
  const dependencies = {
    getDatiCarriera: async () => { calls += 1; return slowPayload(); },
    saveStudentSlowData: () => {}
  };
  ensureSlowSync(id, CREDENTIALS, dependencies);
  await inFlight.get(id);
  ensureSlowSync(id, CREDENTIALS, { ...dependencies, force: true });
  await inFlight.get(id);
  assert.equal(calls, 2);
  ensureSlowSync(id, CREDENTIALS, { ...dependencies, force: true, getDatiCarriera: async () => { calls += 1; throw new Error('offline'); } });
  await inFlight.get(id);
  const status = ensureSlowSync(id, CREDENTIALS, { ...dependencies, force: true });
  assert.equal(status.state, 'error');
  assert.ok(status.retryAfterMs > 0);
  assert.equal(calls, 3);
  assert.equal(getSlowSnapshot(id).taxes.available, true);
  assert.equal(status.sections.taxes.stale, true);
});

test('un elenco persistito vuoto non trasforma il successivo errore appelli in una lettura riuscita', async t => {
  const id = 'persisted-empty-appelli';
  t.after(() => { resetSlowSync(id); clearSnapshots(id); });
  startSlowSync(id, CREDENTIALS, {
    initialSnapshot: { taxes: { available: true }, prenotazioni: [], sections: { taxes: { status: 'ready' }, appelli: { status: 'ready' } } },
    getDatiCarriera: async () => ({ tasse: { available: true }, prenotazioni: [], slowSections: { taxes: { status: 'ready' }, appelli: { status: 'error', error: 'APPELLI_TIMEOUT' } } }),
    saveStudentSlowData: () => {}
  });
  await inFlight.get(id);
  assert.equal(getSlowStatus(id).state, 'partial');
  assert.equal(getSlowStatus(id).sections.appelli.status, 'error');
  assert.equal(getSlowSnapshot(id).sections.appelli.status, 'error');
});

test('due errori appelli distinguono placeholder mai letto e precedente cache valida', async t => {
  for (const wasRead of [false, true]) {
    const id = `consecutive-appelli-${wasRead}`;
    t.after(() => { resetSlowSync(id); clearSnapshots(id); });
    setSlowSnapshot(id, {
      taxes: { available: true },
      prenotazioni: wasRead ? [{ id: 'known-exam' }] : [],
      sections: { taxes: { status: 'ready' }, appelli: { status: wasRead ? 'ready' : 'error', stale: false } }
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      startSlowSync(id, CREDENTIALS, {
        force: true,
        getDatiCarriera: async () => ({ tasse: { available: true }, prenotazioni: [], slowSections: {
          taxes: { status: 'ready' }, appelli: { status: 'error', error: 'APPELLI_TIMEOUT' }
        } }),
        saveStudentSlowData: () => {}
      });
      await inFlight.get(id);
      assert.equal(getSlowStatus(id).sections.appelli.stale, wasRead);
      assert.deepEqual(getSlowSnapshot(id).prenotazioni, wasRead ? [{ id: 'known-exam' }] : []);
    }
  }
});

test('i retry automatici sono limitati e quello esplicito riparte dopo il cooldown', async t => {
  const id = 'limited-auto-retries';
  t.after(() => { resetSlowSync(id); clearSnapshots(id); });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const dependencies = { getDatiCarriera: async () => { calls += 1; throw Object.assign(new Error('timeout'), { code: 'SLOW_TIMEOUT' }); } };
  for (let attempt = 0; attempt < 3; attempt++) {
    ensureSlowSync(id, CREDENTIALS, dependencies);
    await inFlight.get(id);
    assert.equal(getSlowStatus(id).sections.appelli.stale, false);
    now += RETRY_COOLDOWN_MS + 1;
  }
  ensureSlowSync(id, CREDENTIALS, dependencies);
  assert.equal(calls, 3);
  ensureSlowSync(id, CREDENTIALS, { ...dependencies, force: true });
  await inFlight.get(id);
  assert.equal(calls, 4);
});

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
