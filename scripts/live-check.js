#!/usr/bin/env node
/**
 * Verifica end-to-end dell'API con le credenziali di uno studente.
 *
 * Le credenziali NON sono salvate: si leggono dalle variabili d'ambiente
 *   SEGREPASS_USER (oppure SEGREPASS_CF) e SEGREPASS_PASS
 * e lo script esce senza fare nulla se non sono presenti.
 *
 * Esempio:
 *   $env:SEGREPASS_USER='...'; $env:SEGREPASS_PASS='...'; node scripts/live-check.js
 */
const BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';
const USER = process.env.SEGREPASS_USER || process.env.SEGREPASS_CF;
const PASSWORD = process.env.SEGREPASS_PASS;

if (!USER || !PASSWORD) {
  console.log('[live-check] Credenziali assenti: impostare SEGREPASS_USER/SEGREPASS_CF e SEGREPASS_PASS. Nessuna richiesta eseguita.');
  process.exit(0);
}

const results = [];
let token = null;

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(path, { method = 'GET', body, cookie, timeout = 30000 } = {}) {
  const headers = { Origin: ORIGIN, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;

  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

async function main() {
  console.log(`[live-check] API ${BASE_URL}`);

  const health = await fetch(`${BASE_URL}/health`);
  record('GET /health', health.status);

  async function performLogin() {
    const startedAt = Date.now();
    const response = await call('/api/auth/login', {
      method: 'POST',
      body: { codiceFiscale: USER, password: PASSWORD },
      timeout: 240000
    });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const login = await response.json().catch(() => ({}));
    return { response, login, seconds, setCookie: response.headers.get('set-cookie') || '' };
  }

  let first;
  try {
    first = await performLogin();
  } catch (error) {
    record('POST /api/auth/login (freddo)', 'ERRORE', error.message);
    return;
  }

  const cookie = first.setCookie.split(';')[0];
  record(
    'POST /api/auth/login (freddo)',
    first.response.status,
    `${first.seconds}s fromCache=${Boolean(first.login.fromCache)} httpOnly=${/HttpOnly/i.test(first.setCookie)}`
  );

  if (!first.response.ok) {
    console.log(`[live-check] Login non riuscito: ${first.login.error || 'errore sconosciuto'}`);
    return;
  }

  token = first.login.token;
  record('login payload', 'OK', `profilo=${Boolean(first.login.profile)} onboarding=${Boolean(first.login.onboardingRequired)} metriche=${Boolean(first.login.metriche)}`);

  // Secondo login: deve usare la cache e non riaprire il browser.
  try {
    const warm = await performLogin();
    record(
      'POST /api/auth/login (caldo)',
      warm.response.status,
      `${warm.seconds}s fromCache=${Boolean(warm.login.fromCache)}`
    );
  } catch (error) {
    record('POST /api/auth/login (caldo)', 'ERRORE', error.message);
  }

  // Attende i dati lenti (tasse + appelli) caricati in background.
  const slowStartedAt = Date.now();
  let slowReady = process.env.SKIP_SLOW === '1';
  if (slowReady) record('GET /api/career/slow-data', 'SALTATO', 'SKIP_SLOW=1');
  for (let attempt = 0; !slowReady && attempt < 50; attempt++) {
    const response = await call('/api/career/slow-data');
    const payload = await response.json().catch(() => ({}));
    if (payload.status === 'ready' || payload.status === 'error') {
      const seconds = ((Date.now() - slowStartedAt) / 1000).toFixed(1);
      record(
        'GET /api/career/slow-data',
        response.status,
        `stato=${payload.status} debiti=${count(payload.taxes?.pending)} appelli=${count(payload.prenotazioni)} (${seconds}s)`
      );
      slowReady = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  if (!slowReady) {
    record('GET /api/career/slow-data', 'TIMEOUT', 'dati lenti non pronti entro 150s');
  }

  if (cookie) {
    const session = await call('/api/auth/session', { cookie, timeout: 20000 });
    record('GET /api/auth/session (cookie)', session.status);
  }

  const profileResponse = await call('/api/profile');
  const profile = await profileResponse.json().catch(() => ({}));
  record('GET /api/profile', profileResponse.status, `corso=${Boolean(profile?.profile?.course_id)} coorte=${Boolean(profile?.profile?.cohort_year)} canale=${Boolean(profile?.profile?.channel)}`);

  const esami = await call('/api/esami');
  const esamiBody = await esami.json().catch(() => ({}));
  record('GET /api/esami', esami.status, `esami=${count(esamiBody.esami)}`);

  const metriche = await call('/api/metriche');
  const metricheBody = await metriche.json().catch(() => ({}));
  record('GET /api/metriche', metriche.status, `cfu=${metricheBody.cfuAcquisiti ?? 'n/d'}`);

  const careerPlan = await call('/api/career-plan');
  const careerPlanBody = await careerPlan.json().catch(() => ({}));
  record('GET /api/career-plan', careerPlan.status, `corsi=${count(careerPlanBody.courses)} superati=${careerPlanBody?.summary?.passedCourses ?? 'n/d'}`);

  const courseId = profile?.profile?.course_id;
  const cohortYear = profile?.profile?.cohort_year;
  if (courseId && cohortYear) {
    const plan = await call(`/api/study-plans/${encodeURIComponent(courseId)}/${cohortYear}`);
    const planBody = await plan.json().catch(() => ({}));
    record('GET /api/study-plans/:course/:cohort', plan.status, `insegnamenti=${count(planBody.courses)}`);
  } else {
    record('GET /api/study-plans/:course/:cohort', 'SALTATO', 'profilo incompleto');
  }

  const taxes = await call('/api/career-taxes/taxes');
  const taxesBody = await taxes.json().catch(() => ({}));
  record('GET /api/career-taxes/taxes', taxes.status, `pagati=${count(taxesBody.paid)} debiti=${count(taxesBody.pending)}`);

  const studyYear = profile?.profile?.current_course_year;
  const channel = profile?.profile?.channel;
  if (studyYear && channel) {
    const timetable = await call(`/api/timetable?studyYear=${studyYear}&channel=${encodeURIComponent(channel)}`, { timeout: 90000 });
    const timetableBody = await timetable.json().catch(() => ({}));
    record('GET /api/timetable', timetable.status, `eventi=${count(timetableBody?.timetable?.events)}`);
  } else {
    record('GET /api/timetable', 'SALTATO', 'anno/canale mancanti');
  }

  const announcements = await call('/api/docenti/announcements', { timeout: 90000 });
  const announcementsBody = await announcements.json().catch(() => []);
  record('GET /api/docenti/announcements', announcements.status, `docenti=${count(announcementsBody)}`);

  const subscriptions = await call('/api/docenti/subscriptions', { timeout: 90000 });
  const subscriptionsBody = await subscriptions.json().catch(() => []);
  record('GET /api/docenti/subscriptions', subscriptions.status, `corsi=${count(subscriptionsBody)}`);

  const booked = await call('/api/docenti/booked-exams', { timeout: 90000 });
  const bookedBody = await booked.json().catch(() => []);
  record('GET /api/docenti/booked-exams', booked.status, `appelli=${count(bookedBody)}`);

  const failures = results.filter(result => result.status === 'ERRORE' || (typeof result.status === 'number' && result.status >= 500));
  console.log(`\n[live-check] Completato: ${results.length} controlli, ${failures.length} errori gravi.`);
  if (failures.length) process.exitCode = 1;
}

main().catch(error => {
  console.error('[live-check] Errore inatteso:', error.message);
  process.exitCode = 1;
});
