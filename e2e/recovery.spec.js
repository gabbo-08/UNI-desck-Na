const { test, expect } = require('@playwright/test');

const profile = { id: 'chemical-student', course_id: 'CHEM', course_name: 'Ingegneria Chimica', cohort_year: 2025, current_course_year: 2, channel: 'A' };
const metriche = {
  anagrafica: { nomeCompleto: 'Studente prova', corsoDiLaurea: profile.course_name, annoImmatricolazione: 2025 },
  mediaPonderata: '27.00', esami: [], pianoDiStudiRaw: [], prenotazioni: [],
  tasse: { paid: [{ description: 'Versamento conservato', amount: 42 }], pending: [] },
};

async function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMocks(page, { plan, slow }) {
  await page.route('**/health', route => json(route, { status: 'ok' }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/bootstrap') return json(route, {
      authenticated: true, onboardingRequired: false, profile, metriche,
      sync: { fromCache: true, docenti: { enabled: false } },
    });
    if (url.pathname === '/api/metriche') return json(route, metriche);
    if (url.pathname === '/api/career-plan') return plan(route, url);
    if (url.pathname === '/api/career/slow-data') return slow(route, url);
    if (url.pathname === '/api/timetable') return json(route, { timetable: { events: [] } });
    if (url.pathname === '/api/docenti/preferences') return json(route, []);
    return json(route, {});
  });
}

const ready = { status: 'ready', taxes: metriche.tasse, prenotazioni: [] };
const planData = {
  profile, source: 'segrepass', plan: { course_name: profile.course_name, cohort_year: 2025 },
  summary: { passedCourses: 0, missingCourses: 1, reviewCourses: 0, mandatoryMissingCfu: 9 },
  electiveGroups: [], courses: [{ id: 'CH01', course_name: 'Chimica generale recuperata', cfu: 9, study_year: 1, status: 'missing' }],
};

test('chemical engineering plan retries the personal reading without claiming the course is unsupported', async ({ page }) => {
  let refreshed = false;
  await installMocks(page, {
    slow: route => json(route, ready),
    plan: (route, url) => {
      if (url.searchParams.get('refresh') === '1') { refreshed = true; return json(route, planData); }
      return json(route, { code: 'STUDY_PLAN_NOT_AVAILABLE', error: 'Piano non recuperato da Segrepass.' }, 404);
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Piano di Studi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Piano non ancora recuperato' })).toBeVisible();
  await expect(page.getByText('Corso non ancora supportato', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/manifesto degli studi non è ancora stato importato/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Riprova lettura piano', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chimica generale recuperata' })).toBeVisible();
  expect(refreshed).toBe(true);
});

test('partial synchronization keeps the last taxes and supports an explicit recovery request', async ({ page }) => {
  let refreshed = false;
  await installMocks(page, {
    plan: route => json(route, planData),
    slow: (route, url) => {
      if (url.searchParams.get('refresh') === '1') {
        refreshed = true;
        return json(route, { status: 'ready', taxes: { paid: [], pending: [{ description: 'Nuova tassa recuperata', amount: 11 }] }, prenotazioni: [] });
      }
      return json(route, {
        status: 'partial', taxes: { available: false, paid: [], pending: [] }, prenotazioni: [], retryAfterMs: 120000,
        sections: { taxes: { status: 'error', stale: true }, appelli: { status: 'ready' } },
      });
    },
  });
  await page.goto('/');
  await expect(page.getByText(/Lettura tasse non riuscita\. Gli appelli Segrepass sono aggiornati/)).toBeVisible();
  await page.getByRole('button', { name: 'Tasse & Pagamenti', exact: true }).click();
  await page.getByRole('button', { name: /^Storico Pagati/ }).click();
  await expect(page.getByText('Versamento conservato', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Riprova tasse e appelli', exact: true }).click();
  await page.getByRole('button', { name: /^Da Pagare/ }).click();
  await expect(page.getByText('Nuova tassa recuperata', { exact: true })).toBeVisible();
  expect(refreshed).toBe(true);
});

test('recoverable slow-data errors continue polling after the advertised retry delay', async ({ page }) => {
  let requests = 0;
  await page.clock.install();
  await installMocks(page, {
    plan: route => json(route, planData),
    slow: route => {
      requests += 1;
      return json(route, requests === 1 ? {
        status: 'error', retryAfterMs: 10000,
        sections: { taxes: { status: 'error' }, appelli: { status: 'error' } },
      } : ready);
    },
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Riprova tasse e appelli', exact: true })).toBeVisible();
  await page.clock.fastForward(10001);
  await expect.poll(() => requests).toBeGreaterThan(1);
  await expect(page.getByText(/Tasse e appelli aggiornati/)).toBeVisible();
});
