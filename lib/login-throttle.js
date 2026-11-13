// lib/login-throttle.js
// Limite globale per account, indipendente dall'IP, contro il brute force
// distribuito. La chiave di stato è un HMAC dell'identificatore di login
// normalizzato (codice fiscale o email): matricola e identificatori non
// compaiono mai in chiaro nello stato o nei log.
const crypto = require('node:crypto');
const { deriveKey } = require('./secret-box');

const MAX_FREE_FAILURES = 5;             // fallimenti tollerati prima del cooldown
const BASE_COOLDOWN_MS = 60 * 1000;      // primo cooldown: 1 minuto
const MAX_COOLDOWN_MS = 15 * 60 * 1000;  // tetto massimo: 15 minuti
const FAILURE_RESET_MS = 30 * 60 * 1000; // azzera i fallimenti dopo 30 min senza errori
const PRUNE_INTERVAL_MS = 60 * 1000;

const state = new Map(); // accountKey -> { failures, lockedUntil, lastFailure }
let lastPrune = 0;

function accountKey(identifier) {
  return crypto.createHmac('sha256', deriveKey('login-throttle'))
    .update(String(identifier))
    .digest('hex');
}

function prune(now) {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, entry] of state) {
    if (entry.lockedUntil <= now && now - entry.lastFailure > FAILURE_RESET_MS) {
      state.delete(key);
    }
  }
}

function cooldownFor(failures) {
  // I primi MAX_FREE_FAILURES fallimenti sono tollerati; il cooldown scatta
  // dal fallimento successivo e raddoppia a ogni errore, fino al tetto.
  const over = failures - MAX_FREE_FAILURES;
  if (over <= 0) return 0;
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * Math.pow(2, over - 1));
}

function getStatus(identifier, now = Date.now()) {
  prune(now);
  const entry = state.get(accountKey(identifier));
  if (!entry) return { allowed: true, retryAfterMs: 0 };
  if (entry.lockedUntil <= now && now - entry.lastFailure > FAILURE_RESET_MS) {
    state.delete(accountKey(identifier));
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

// Da chiamare PRIMA di contattare il portale. Solleva un 429 generico se
// l'account è in cooldown: non rivela se l'account esista o meno.
function assertLoginAllowed(identifier, now = Date.now()) {
  const status = getStatus(identifier, now);
  if (status.allowed) return;
  const error = new Error('Troppi tentativi di accesso per questo account. Riprova più tardi.');
  error.status = 429;
  error.code = 'LOGIN_THROTTLED';
  error.retryAfterMs = status.retryAfterMs;
  throw error;
}

function recordLoginFailure(identifier, now = Date.now()) {
  prune(now);
  const key = accountKey(identifier);
  const entry = state.get(key) || { failures: 0, lockedUntil: 0, lastFailure: 0 };
  if (entry.lockedUntil <= now && now - entry.lastFailure > FAILURE_RESET_MS) {
    entry.failures = 0;
  }
  entry.failures += 1;
  entry.lastFailure = now;
  const cooldown = cooldownFor(entry.failures);
  entry.lockedUntil = cooldown > 0 ? now + cooldown : 0;
  state.set(key, entry);
}

function recordLoginSuccess(identifier) {
  state.delete(accountKey(identifier));
}

function clearLoginThrottle() {
  state.clear();
  lastPrune = 0;
}

module.exports = {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  getStatus,
  clearLoginThrottle,
  MAX_FREE_FAILURES,
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS
};