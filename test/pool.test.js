const test = require('node:test');
const assert = require('node:assert/strict');
const { queueScrapingTask, closeCluster } = require('../scraper/pool');

test('queueScrapingTask fallisce in modo esplicito se il cluster non è inizializzato', async () => {
  await assert.rejects(
    queueScrapingTask({ codiceFiscale: 'AAABBB00A00A000A' }, async () => ({ ok: true })),
    /Cluster non inizializzato/
  );
});

test('closeCluster è idempotente e non avvia processi', async () => {
  await assert.doesNotReject(closeCluster());
  await assert.doesNotReject(closeCluster());
});
