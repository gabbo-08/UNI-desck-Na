process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const authRoutes = require('../routes/auth');
const { csrfProtection } = require('../lib/csrf');
const { db } = require('../db');
const { upsertStudentProfile, saveBookingReceipt, getLatestBookingReceipt } = require('../db/repository');
const { createServerSession } = require('../services/server-sessions');
const { COOKIE_NAME } = require('../lib/cookies');
const snapshots = require('../services/career-snapshots');

async function requestFor(t, authSession = session) {
  const app = express();
  app.use(express.json());
  app.use(csrfProtection);
  app.use('/api/auth', authRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return path => fetch(`http://127.0.0.1:${server.address().port}/api/auth${path}`, {
    headers: { cookie: `${COOKIE_NAME}=${authSession.token}` }
  });
}

const profileId = 'bootstrap-profile';
const session = createServerSession(profileId, { codiceFiscale: profileId, password: 'secret' });
upsertStudentProfile(db, {
  id: profileId,
  courseId: 'DE3',
  courseName: 'Informatica',
  cohortYear: 2025,
  currentCourseYear: 2,
  channel: 'A-D',
  anagrafica: { nomeCompleto: 'Studente Bootstrap', cognome: 'Bootstrap', pin: '987654', codiceNumericoPersonale: '123456789', password: 'secret-field' },
  esamiSostenuti: [{ materia: 'Algoritmi', cfu: 9, voto: 30 }],
  tasse: { pending: [{ amount: 100 }] }
});

test('bootstrap restituisce dati già presenti senza avviare scraping', async t => {
  const request = await requestFor(t);
  const response = await request('/bootstrap');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.profile.id, profileId);
  assert.equal(body.metriche.esami.length, 1);
  assert.equal(body.metriche.tasse.pending[0].amount, 100);
  assert.equal(body.authenticated, true);
  assert.equal(body.metriche.anagrafica.nomeCompleto, 'Studente Bootstrap');
  for (const key of ['pin', 'codiceNumericoPersonale', 'password', 'token']) assert.equal(Object.hasOwn(body.metriche.anagrafica, key), false);
});

test('bootstrap ripristina il piano Segrepass persistito nella cache RAM', async t => {
  const courses = [{ id: 'MAT-BOOT', courseName: 'Analisi', cfu: 9 }];
  upsertStudentProfile(db, { id: profileId, pianoDiStudiRaw: courses });
  snapshots.clearSnapshots(profileId);
  t.after(() => snapshots.clearSnapshots(profileId));
  const request = await requestFor(t);
  const response = await request('/bootstrap');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.metriche.pianoDiStudiRaw, courses);
  assert.deepEqual(snapshots.getPianoSnapshot(profileId), courses);
});

test('bootstrap ripristina l opt-in Docenti senza esporre le credenziali', async t => {
  const docentiSession = createServerSession(profileId, {
    codiceFiscale: profileId,
    email: 'studente@studenti.unina.it',
    password: 'secret',
    enableDocentiSync: true
  });
  const request = await requestFor(t, docentiSession);
  const response = await request('/bootstrap');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.sync.docenti.enabled, true);
  assert.equal(Object.hasOwn(body.sync.docenti, 'password'), false);
  assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('export restituisce solo dati dell utente e nessuna credenziale', async t => {
  const request = await requestFor(t);
  const response = await request('/export');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.profile.id, profileId);
  assert.equal(body.career.length, 1);
  assert.equal(Object.hasOwn(body, 'password'), false);
  assert.equal(Object.hasOwn(body, 'credentials'), false);
  assert.match(response.headers.get('content-disposition') || '', /attachment/);
});

test('le ricevute di prenotazione sono persistenti e senza credenziali', () => {
  const receipt = saveBookingReceipt(profileId, {
    id: 'receipt-1', annopri: '2026', numAppello: '42', status: 'submitted', message: 'ok'
  });
  assert.equal(receipt.id, 'receipt-1');
  assert.equal(getLatestBookingReceipt(profileId, '2026', '42').id, 'receipt-1');
  assert.equal(Object.hasOwn(receipt, 'password'), false);
});
