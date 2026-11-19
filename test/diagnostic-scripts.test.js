const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function runScript(name, env) {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(__dirname, '..', 'scripts', name)], {
      env: { ...process.env, ...env }, timeout: 15000,
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
  });
}

test('live-check fallisce anche quando il login restituisce 401', async t => {
  const base = await fixture(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = req.url === '/health' ? 200 : 401;
    res.end(JSON.stringify(req.url === '/health' ? { status: 'ok' } : { error: 'Accesso rifiutato' }));
  });
  const result = await runScript('live-check.js', {
    API_BASE_URL: base, SEGREPASS_USER: 'diagnostica@studenti.unina.it', SEGREPASS_PASS: 'fake-test-value',
  });
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stdout, /Login non riuscito/);
  assert.doesNotMatch(result.stdout + result.stderr, /fake-test-value/);
});

test('smoke-health verifica entrambi gli endpoint e fallisce se ready restituisce 503', async t => {
  const requests = [];
  const base = await fixture(t, (req, res) => {
    requests.push(req.url);
    res.statusCode = req.url === '/ready' ? 503 : 200;
    res.end('{}');
  });
  const result = await runScript('smoke-health.mjs', { SMOKE_BASE_URL: base });
  assert.equal(result.code, 1, result.stderr);
  assert.deepEqual(requests, ['/health', '/ready']);
});
