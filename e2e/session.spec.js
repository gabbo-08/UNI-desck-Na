const { test, expect } = require('@playwright/test');

function account(id, name) {
  const profile = {
    id, name, matricola: id === 'alice' ? 'A12345' : 'B67890',
    courseId: 'L-31', courseName: 'Informatica', cohortYear: 2025,
    currentCourseYear: 1, channel: 'A',
  };
  const metriche = {
    anagrafica: { nomeCompleto: name, matricola: profile.matricola, corsoDiLaurea: profile.courseName },
    mediaPonderata: 27, mediaAritmetica: 27, baseLaurea: 99,
    cfuAcquisiti: 6, cfuTotali: 180, esami: [], pianoDiStudiRaw: [],
    tasse: { paid: [], pending: [] }, prenotazioni: [],
  };
  return { authenticated: true, profileId: id, profile, onboardingRequired: false, metriche };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMocks(page, { bootstrap, loginAccount, personalDataForAlice = false }) {
  let activeAccount = personalDataForAlice ? 'alice' : null;
  await page.route('**/health', route => fulfillJson(route, { status: 'ok' }));
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/auth/bootstrap') return bootstrap(route);
    if (pathname === '/api/auth/login') {
      activeAccount = loginAccount.profile.id;
      return fulfillJson(route, loginAccount);
    }
    if (pathname === '/api/auth/logout') return fulfillJson(route, { success: true });
    if (pathname === '/api/metriche') return fulfillJson(route, loginAccount.metriche);
    if (pathname === '/api/career/slow-data') return fulfillJson(route, { status: 'ready', prenotazioni: [] });
    if (pathname === '/api/timetable') return fulfillJson(route, {
      timetable: { events: personalDataForAlice && activeAccount === 'alice' ? [{
        date: '2030-01-10', startTime: '09:00', endTime: '11:00',
        courseName: 'Lezione personale Alice', teachers: [],
      }] : [] },
    });
    if (pathname === '/api/docenti/summary') return fulfillJson(route, {
      announcements: [], subscriptions: [], groups: [], tests: [],
      bookedExams: personalDataForAlice && activeAccount === 'alice' ? [{ courseName: 'Appello segreto Alice', examDate: '2030-01-10' }] : [],
    });
    if (pathname === '/api/docenti/preferences') return fulfillJson(route, []);
    return fulfillJson(route, {});
  });
}

async function login(page, email = 'prova@studenti.unina.it') {
  await page.getByPlaceholder('Email @studenti.unina.it').fill(email);
  await page.getByPlaceholder('Password del portale studenti').fill('password-di-test');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
}

async function settleResponse(page, response) {
  await response.finished();
  // Let the fetch continuation and React commit finish before checking the
  // state changed by a deliberately delayed response.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('a delayed bootstrap 401 cannot log out an account that just signed in', async ({ page }) => {
  const alice = account('alice', 'Alice Prova');
  let releaseBootstrap;
  let bootstrapStarted;
  const started = new Promise(resolve => { bootstrapStarted = resolve; });
  const gate = new Promise(resolve => { releaseBootstrap = resolve; });
  await page.addInitScript(() => {
    window.sessionExpiredEvents = 0;
    window.addEventListener('segrepass:session-expired', () => { window.sessionExpiredEvents += 1; });
  });
  await installMocks(page, {
    loginAccount: alice,
    bootstrap: async route => {
      bootstrapStarted();
      await gate;
      await fulfillJson(route, { code: 'SESSION_EXPIRED', error: 'Sessione scaduta.' }, 401);
    },
  });
  try {
    await page.goto('/');
    await started;
    await login(page);
    await expect(page.getByRole('heading', { name: 'Alice Prova', exact: true })).toBeVisible();
    const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/bootstrap');
    releaseBootstrap();
    await settleResponse(page, await lateResponse);
    await expect(page.getByRole('heading', { name: 'Alice Prova', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Email @studenti.unina.it')).toHaveCount(0);
    expect(await page.evaluate(() => window.sessionExpiredEvents)).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('segrepass:cache:bootstrap:v1')).profile.id)).toBe('alice');
  } finally {
    releaseBootstrap();
  }
});

test('logout and account switching clear personal state despite a late successful bootstrap', async ({ page }) => {
  const alice = account('alice', 'Alice Prova');
  const bob = account('bob', 'Bob Prova');
  let releaseBootstrap;
  let bootstrapStarted;
  const started = new Promise(resolve => { bootstrapStarted = resolve; });
  const gate = new Promise(resolve => { releaseBootstrap = resolve; });
  await page.addInitScript(snapshot => {
    localStorage.setItem('segrepass:cache:bootstrap:v1', JSON.stringify(snapshot));
    localStorage.setItem('unidesk_profile_prefs_v1:ALICE', JSON.stringify({ courseId: 'L-31' }));
  }, { savedAt: Date.now(), profile: alice.profile, metriche: alice.metriche, onboardingRequired: false, docentiEnabled: true });
  await installMocks(page, {
    loginAccount: bob,
    personalDataForAlice: true,
    bootstrap: async route => {
      bootstrapStarted();
      await gate;
      await fulfillJson(route, { ...alice, sync: { fromCache: true, docenti: { enabled: true } } });
    },
  });
  try {
    await page.goto('/');
    await started;
    await expect(page.getByRole('heading', { name: 'Alice Prova', exact: true })).toBeVisible();
    await expect(page.getByText('Appello segreto Alice', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Lezione personale Alice', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Esci', exact: true }).click();
    await expect(page.getByPlaceholder('Email @studenti.unina.it')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('unidesk_profile_prefs_v1:ALICE'))).toBeNull();
    const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/bootstrap');
    releaseBootstrap();
    await settleResponse(page, await lateResponse);
    await expect(page.getByPlaceholder('Email @studenti.unina.it')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('segrepass:cache:bootstrap:v1'))).toBeNull();
    const bobTimetable = page.waitForResponse(response => new URL(response.url()).pathname === '/api/timetable');
    await login(page, 'bob@studenti.unina.it');
    await expect(page.getByRole('heading', { name: 'Bob Prova', exact: true })).toBeVisible();
    await settleResponse(page, await bobTimetable);
    await expect(page.getByRole('heading', { name: 'Alice Prova', exact: true })).toHaveCount(0);
    await expect(page.getByText('Appello segreto Alice', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Lezione personale Alice', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('segrepass:cache:bootstrap:v1')).profile.id)).toBe('bob');
  } finally {
    releaseBootstrap();
  }
});
