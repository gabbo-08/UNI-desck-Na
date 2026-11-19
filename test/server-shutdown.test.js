const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');

test('lo shutdown mantiene DB e scraper aperti fino al completamento delle richieste', { timeout: 10000 }, async t => {
  const child = fork(path.join(__dirname, 'fixtures/shutdown-server.js'), {
    env: {
      ...process.env, DB_PATH: ':memory:', PORT: '30011', HOST: '127.0.0.1', NODE_ENV: 'development',
      CRED_KEY: '0123456789abcdef'.repeat(4), FRONTEND_URL: 'http://localhost:3000', TRUST_PROXY: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const messages = [];
  const waiters = [];
  child.on('message', message => {
    messages.push(message);
    for (const waiter of waiters) {
      if (message.type === waiter.type) waiter.resolve(message);
    }
  });
  child.on('exit', code => {
    for (const waiter of waiters) waiter.reject(new Error(`Server terminato (${code}): ${output}`));
  });
  function messageOfType(type) {
    const existing = messages.find(message => message.type === type);
    return existing ? Promise.resolve(existing) : new Promise((resolve, reject) => waiters.push({ type, resolve, reject }));
  }

  const ready = await messageOfType('ready');
  const pending = fetch(`http://127.0.0.1:${ready.port}/shutdown-probe`);
  await messageOfType('request-started');
  child.send('shutdown');
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { databaseOpen: true, scraperOpen: true });
  const [code] = await exited;
  assert.equal(code, 0, output);
});
