const test = require('node:test');
const assert = require('node:assert/strict');
const { metricsAuthorized } = require('../lib/metrics-access');

function request(token) {
  return { get: name => name === 'x-metrics-token' ? token : undefined };
}

test('metrics resta disponibile in sviluppo', () => {
  assert.equal(metricsAuthorized(request(), { NODE_ENV: 'development' }), true);
});

test('metrics richiede il token in produzione', () => {
  const env = { NODE_ENV: 'production', METRICS_TOKEN: 'metric-secret' };
  assert.equal(metricsAuthorized(request(), env), false);
  assert.equal(metricsAuthorized(request('wrong'), env), false);
  assert.equal(metricsAuthorized(request('metric-secret'), env), true);
});

test('metrics resta chiuso in produzione senza token configurato', () => {
  assert.equal(metricsAuthorized(request('anything'), { NODE_ENV: 'production' }), false);
});
