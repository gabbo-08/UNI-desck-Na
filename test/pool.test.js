const test = require('node:test');
const assert = require('node:assert/strict');
const { initCluster, queueScrapingTask, closeCluster, isClusterReady } = require('../scraper/pool');
const { Cluster } = require('puppeteer-cluster');

test('queueScrapingTask inizializza una volta il cluster per richieste concorrenti', async t => {
  let launches = 0;
  let executions = 0;
  let closes = 0;
  t.mock.method(Cluster, 'launch', async () => {
    launches += 1;
    await new Promise(resolve => setImmediate(resolve));
    return {
      on() {},
      execute: async (data, logic) => { executions += 1; return logic({ page: {}, data }); },
      idle: async () => {},
      close: async () => { closes += 1; }
    };
  });
  t.after(closeCluster);
  const results = await Promise.all([
    queueScrapingTask({ value: 'first' }, async (_page, data) => data.value),
    queueScrapingTask({ value: 'second' }, async (_page, data) => data.value)
  ]);
  assert.deepEqual(results, ['first', 'second']);
  assert.equal(launches, 1);
  assert.equal(executions, 2);
  await closeCluster();
  await closeCluster();
  assert.equal(closes, 1);
});

test('closeCluster è idempotente e non avvia processi', async () => {
  await assert.doesNotReject(closeCluster());
  await assert.doesNotReject(closeCluster());
});

test('closeCluster attende il lancio pendente e chiude anche il browser appena creato', async t => {
  let resolveLaunch;
  let closes = 0;
  t.mock.method(Cluster, 'launch', () => new Promise(resolve => { resolveLaunch = resolve; }));
  const starting = initCluster();
  const closing = closeCluster();
  await assert.rejects(queueScrapingTask({}, async () => {}), { code: 'SCRAPER_SHUTTING_DOWN' });
  resolveLaunch({ on() {}, idle: async () => {}, close: async () => { closes += 1; } });
  await Promise.all([starting, closing]);
  assert.equal(closes, 1);
  assert.equal(isClusterReady(), false);
});

test('chiusure concorrenti condividono il drain e rifiutano nuovi avvii', async t => {
  let finishIdle;
  let idles = 0;
  let closes = 0;
  t.mock.method(Cluster, 'launch', async () => ({
    on() {},
    idle: () => { idles += 1; return new Promise(resolve => { finishIdle = resolve; }); },
    close: async () => { closes += 1; }
  }));
  await initCluster();
  assert.equal(isClusterReady(), true);
  const first = closeCluster();
  const second = closeCluster();
  assert.equal(isClusterReady(), false);
  await assert.rejects(initCluster(), { code: 'SCRAPER_SHUTTING_DOWN' });
  assert.equal(idles, 1);
  finishIdle();
  await Promise.all([first, second]);
  assert.equal(closes, 1);
  await closeCluster();
  assert.equal(closes, 1);
});

test('un lancio fallito non blocca la chiusura né un successivo tentativo', async t => {
  let rejectLaunch;
  let launches = 0;
  let closes = 0;
  t.mock.method(Cluster, 'launch', () => {
    launches += 1;
    if (launches === 1) return new Promise((_resolve, reject) => { rejectLaunch = reject; });
    return Promise.resolve({ on() {}, idle: async () => {}, close: async () => { closes += 1; } });
  });
  const starting = initCluster();
  const rejected = assert.rejects(starting, /launch failed/);
  const closing = closeCluster();
  rejectLaunch(new Error('launch failed'));
  await Promise.all([rejected, closing]);
  assert.equal(isClusterReady(), false);
  await initCluster();
  assert.equal(isClusterReady(), true);
  await closeCluster();
  assert.equal(closes, 1);
});

test('chiude il browser anche quando il drain segnala un errore', async t => {
  let closes = 0;
  t.mock.method(Cluster, 'launch', async () => ({
    on() {}, idle: async () => { throw new Error('idle failed'); }, close: async () => { closes += 1; }
  }));
  await initCluster();
  await assert.rejects(closeCluster(), /idle failed/);
  assert.equal(closes, 1);
  assert.equal(isClusterReady(), false);
});
