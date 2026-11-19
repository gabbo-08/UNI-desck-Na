process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDocentiRouter, clearDocentiRouteCache } = require('../routes/docenti');
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

async function withTeacherDetailApi(t, profileId, loader) {
  const app = express();
  app.use('/api/docenti', (req, _res, next) => { req.user = { sub: profileId }; next(); },
    createDocentiRouter({ fetchTeacherDetail: loader }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => clearDocentiRouteCache(profileId));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return () => fetch(`http://127.0.0.1:${server.address().port}/api/docenti/teacher/teacher-1`);
}

test('mantiene il dettaglio precedente se il refresh in background fallisce', async t => {
  let calls = 0;
  const initialTime = Date.now();
  let currentTime = initialTime;
  t.mock.method(Date, 'now', () => currentTime);
  const request = await withTeacherDetailApi(t, 'profile-stale-detail', async () => {
    calls += 1;
    if (calls > 1) throw Object.assign(new Error('timeout'), { code: 'DOCENTI_TIMEOUT' });
    return { profilo: { id: 'teacher-1', nome: 'Docente Test' }, iscrizioni: [{ courseName: 'Analisi' }] };
  });
  assert.equal((await request()).status, 200);
  currentTime += 16 * 60 * 1000;
  const stale = await request();
  assert.equal(stale.status, 200);
  assert.equal((await stale.json()).profilo.nome, 'Docente Test');
  await new Promise(resolve => setImmediate(resolve));
  currentTime = initialTime;
  assert.equal((await request()).status, 200);
  assert.equal(calls, 2);
});

test('un dettaglio assente viene ritentato alla richiesta successiva', async t => {
  let calls = 0;
  const request = await withTeacherDetailApi(t, 'profile-null-detail', async () => {
    calls += 1;
    return calls === 1 ? null : { profilo: { id: 'teacher-1', nome: 'Docente Test' }, iscrizioni: [{ courseName: 'Analisi' }] };
  });
  assert.equal((await request()).status, 404);
  assert.equal((await request()).status, 200);
  assert.equal(calls, 2);
});

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

test('streamma un materiale PDF nello stesso origin con header privati', async t => {
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: 'profile-material-test' };
    next();
  }, createDocentiRouter({
    fetchMaterial: async () => ({
      contentType: 'application/pdf',
      filename: 'lezione.pdf',
      buffer: Buffer.from('%PDF-1.7\nmock')
    })
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/api/docenti/teacher/teacher-1/folder/folder-1/file/file-1?section=areapubb`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-disposition') || '', /inline/);
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '%PDF-1.7\nmock');
});

test('rifiuta materiali riservati nel proxy se non abilitati', async t => {
  const app = express();
  app.use('/api/docenti', (req, _res, next) => {
    req.user = { sub: 'profile-material-private-test' };
    next();
  }, createDocentiRouter({
    fetchMaterial: async () => ({ contentType: 'application/pdf', filename: 'private.pdf', buffer: Buffer.from('%PDF-') })
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/api/docenti/teacher/teacher-1/folder/folder-1/file/file-1?section=arearis`;
  const response = await fetch(url);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'RESTRICTED_MATERIALS_DISABLED');
});
