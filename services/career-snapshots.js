
// services/career-snapshots.js
const TTL_MS = 12 * 60 * 60 * 1000; // 12 ore di validità per la sessione in memoria

const careerSnapshots = new Map();
const docentiSnapshots = new Map();
const taxesSnapshots = new Map(); // Aggiunto store per le tasse
const slowSnapshots = new Map(); // Tasse + appelli caricati in background
const docentiLoading = new Set();
const pianoSnapshots = new Map(); // piano di studi letto da Segrepass nell'ultimo login

function prune(store) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.storedAt > TTL_MS) store.delete(key);
  }
}

function readFresh(store, profileId) {
  const entry = store.get(profileId);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > TTL_MS) {
    store.delete(profileId);
    return null;
  }
  return entry.value;
}

// -- Esami --
function setCareerSnapshot(profileId, esami) {
  prune(careerSnapshots);
  careerSnapshots.set(profileId, { value: Array.isArray(esami) ? esami : [], storedAt: Date.now() });
}

function getCareerSnapshot(profileId) {
  return readFresh(careerSnapshots, profileId);
}

// -- Tasse (Nuovo) --
function setTaxesSnapshot(profileId, data) {
  prune(taxesSnapshots);
  taxesSnapshots.set(profileId, { value: data || null, storedAt: Date.now() });
}

function getTaxesSnapshot(profileId) {
  return readFresh(taxesSnapshots, profileId);
}

// -- Dati lenti (tasse + appelli) --
function setSlowSnapshot(profileId, data) {
  prune(slowSnapshots);
  slowSnapshots.set(profileId, { value: data || null, storedAt: Date.now() });
}

function getSlowSnapshot(profileId) {
  return readFresh(slowSnapshots, profileId);
}

// -- Piano di studi (letto da Segrepass) --
function setPianoSnapshot(profileId, courses) {
  prune(pianoSnapshots);
  pianoSnapshots.set(profileId, { value: Array.isArray(courses) ? courses : [], storedAt: Date.now() });
}

function getPianoSnapshot(profileId) {
  return readFresh(pianoSnapshots, profileId);
}

// -- Docenti --
function setDocentiSnapshot(profileId, data) {
  prune(docentiSnapshots);
  docentiSnapshots.set(profileId, { value: data, storedAt: Date.now() });
}

function getDocentiSnapshot(profileId) {
  return readFresh(docentiSnapshots, profileId);
}

function markDocentiLoading(profileId) {
  docentiLoading.add(profileId);
}

function clearDocentiLoading(profileId) {
  docentiLoading.delete(profileId);
}

function isDocentiLoading(profileId) {
  return docentiLoading.has(profileId);
}

function clearSnapshots(profileId) {
  careerSnapshots.delete(profileId);
  docentiSnapshots.delete(profileId);
  taxesSnapshots.delete(profileId); // Svuota anche le tasse
  slowSnapshots.delete(profileId);
  pianoSnapshots.delete(profileId);
  docentiLoading.delete(profileId);
}

module.exports = {
  setCareerSnapshot,
  getCareerSnapshot,
  setPianoSnapshot,
  getPianoSnapshot,
  setTaxesSnapshot,
  getTaxesSnapshot,
  setSlowSnapshot,
  getSlowSnapshot,
  setDocentiSnapshot,
  getDocentiSnapshot,
  markDocentiLoading,
  clearDocentiLoading,
  isDocentiLoading,
  clearSnapshots
};
