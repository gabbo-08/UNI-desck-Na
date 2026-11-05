process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDocentiRouter } = require('../routes/docenti');
const { db } = require('../db');
const { upsertStudentProfile, saveProfessorPreference } = require('../db/repository');

async function withDocentiApi(t, loadDocenti) {
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: 'profile-test' };
    next();
  }, createDocentiRouter({ loadDocenti }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  return path => fetch(`http://127.0.0.1:${port}/api/docenti${path}`);
}

test('restituisce gli array attesi dal frontend', async t => {
  const request = await withDocentiApi(t, async () => ({
    available: true,
    subscriptions: [{ courseName: 'Analisi I' }],
    bookedExams: [{ courseName: 'Analisi I' }],
    groups: [{ name: 'A' }],
    tests: [{ name: 'Test intermedio' }],
    announcements: [{ title: 'Avviso' }]
  }));

  const subscriptions = await request('/subscriptions');
  assert.equal(subscriptions.status, 200);
  assert.deepEqual(await subscriptions.json(), [{ courseName: 'Analisi I' }]);

  const announcements = await request('/announcements');
  assert.deepEqual(await announcements.json(), [{ title: 'Avviso' }]);

  const groups = await request('/groups');
  assert.deepEqual(await groups.json(), [{ name: 'A' }]);

  const tests = await request('/tests');
  assert.deepEqual(await tests.json(), [{ name: 'Test intermedio' }]);

  const summary = await request('/summary');
  assert.deepEqual(await summary.json(), {
    announcements: [{ title: 'Avviso' }],
    subscriptions: [{ courseName: 'Analisi I' }],
    bookedExams: [{ courseName: 'Analisi I' }],
    groups: [{ name: 'A' }],
    tests: [{ name: 'Test intermedio' }],
    meta: { refreshing: false, fetchedAt: null, stale: false }
  });
});

test('restituisce 502 con codice quando lo scraping fallisce', async t => {
  const request = await withDocentiApi(t, async () => {
    const error = new Error('portale offline');
    error.code = 'DOCENTI_TIMEOUT';
    throw error;
  });

  const response = await request('/booked-exams');
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.code, 'DOCENTI_TIMEOUT');
});

test('segnala con 424 quando i dati Docenti non sono disponibili', async t => {
  const request = await withDocentiApi(t, async () => ({ available: false, reason: 'DOCENTI_DATA_NOT_FOUND' }));

  const response = await request('/subscriptions');
  const body = await response.json();

  assert.equal(response.status, 424);
  assert.equal(body.code, 'DOCENTI_DATA_NOT_FOUND');
  assert.match(body.error, /Nessun dato Docenti/);
});

test('serve gli avvisi preferiti dalla cache e non ripete la richiesta al portale', async t => {
  const profileId = 'favorite-announcement-cache-profile';
  const professorId = 'favorite-announcement-cache-teacher';
  upsertStudentProfile(db, { id: profileId });
  saveProfessorPreference(profileId, {
    courseName: 'Analisi II', courseCode: 'MAT2',
    professorName: 'DOCENTE TEST', professorId
  }, db);

  let calls = 0;
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: profileId };
    next();
  }, createDocentiRouter({ fetchFavoriteAnnouncements: async teachers => {
    calls += 1;
    return [{ professor: teachers[0].name, slug: teachers[0].id, items: [{ id: 'a1', title: 'Avviso test' }] }];
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/api/docenti/favorite-announcements`;
  const first = await fetch(url);
  assert.equal(first.status, 200);
  assert.equal((await first.json())[0].items[0].title, 'Avviso test');
  const second = await fetch(url);
  const cached = await second.json();
  assert.equal(second.status, 200);
  assert.equal(cached[0].courseName, 'Analisi II');
  assert.equal(calls, 1);
});

test('condivide il caricamento del dettaglio docente e serve il secondo hit dalla cache', async t => {
  let calls = 0;
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: 'profile-detail-test' };
    next();
  }, createDocentiRouter({
    fetchTeacherDetail: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return {
        profilo: {
          id: 'teacher-1',
          nome: 'Docente Test',
          fotoUrl: 'data:image/png;base64,iVBORw0KGgo='
        },
        materiali: { pubblico: [], ftp: [], riservato: [] },
        appelli: [],
        iscrizioni: []
      };
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/docenti/teacher/teacher-1`;
  const [first, second] = await Promise.all([fetch(url), fetch(url)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls, 1);
  assert.equal((await first.json()).profilo.fotoUrl, 'data:image/png;base64,iVBORw0KGgo=');

  const started = Date.now();
  const cached = await fetch(url);
  assert.equal(cached.status, 200);
  assert.ok(Date.now() - started < 500);
});

test('valida ID docente, cartella e sezione prima delle richieste upstream', async t => {
  let calls = 0;
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: 'profile-validation-test' };
    next();
  }, createDocentiRouter({
    fetchTeacherDetail: async () => { calls += 1; return null; },
    fetchTeacherFolder: async () => { calls += 1; return []; }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/docenti`;

  assert.equal((await fetch(`${base}/teacher/bad.id`)).status, 400);
  assert.equal((await fetch(`${base}/teacher/teacher-1/folder/folder.id?section=areapubb`)).status, 400);
  assert.equal((await fetch(`${base}/teacher/teacher-1/folder/folder-1?section=unknown`)).status, 400);
  assert.equal(calls, 0);
});
