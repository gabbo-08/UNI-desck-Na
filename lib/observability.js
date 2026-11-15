const crypto = require('node:crypto');

const startedAt = Date.now();
const state = {
  requests: 0,
  completed: 0,
  errors: 0,
  statuses: new Map(),
  methods: new Map(),
  lastLatencyMs: 0
};

function safeRequestId(value) {
  const candidate = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{8,100}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function observabilityMiddleware(req, res, next) {
  const requestId = safeRequestId(req.get('X-Request-Id'));
  const started = process.hrtime.bigint();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  state.requests += 1;

  res.once('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    state.completed += 1;
    if (res.statusCode >= 500) state.errors += 1;
    increment(state.statuses, String(res.statusCode));
    increment(state.methods, String(req.method || 'GET').toUpperCase());
    // Keep only a bounded aggregate: no URL, user id or query string is kept.
    state.lastLatencyMs = Math.round(elapsedMs);
  });
  next();
}

function snapshotMetrics() {
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: state.requests,
    completed: state.completed,
    errors: state.errors,
    lastLatencyMs: state.lastLatencyMs,
    statuses: Object.fromEntries(state.statuses),
    methods: Object.fromEntries(state.methods)
  };
}

function resetMetrics() {
  state.requests = 0;
  state.completed = 0;
  state.errors = 0;
  state.lastLatencyMs = 0;
  state.statuses.clear();
  state.methods.clear();
}

module.exports = { observabilityMiddleware, snapshotMetrics, resetMetrics, safeRequestId };
