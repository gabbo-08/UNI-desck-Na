const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { observabilityMiddleware, snapshotMetrics, resetMetrics, safeRequestId } = require('../lib/observability');

test('genera request id sicuri e aggrega metriche senza conservare URL', async () => {
  resetMetrics();
  assert.notEqual(safeRequestId('short'), 'short');
  const app = express();
  app.use(observabilityMiddleware);
  app.get('/private/:id', (_req, res) => res.status(204).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/private/student-123`);
    assert.equal(response.status, 204);
    assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
    const snapshot = snapshotMetrics();
    assert.equal(snapshot.completed, 1);
    assert.equal(snapshot.statuses['204'], 1);
    assert.equal(Object.hasOwn(snapshot, 'routes'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
