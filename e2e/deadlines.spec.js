const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const profile = {
  id: 'deadline-student', course_id: 'CHEM', course_name: 'Ingegneria Chimica',
  cohort_year: 2025, current_course_year: 2, channel: 'A',
};
const fixture = {
  anagrafica: {
    nomeCompleto: 'Studente scadenze', corsoDiLaurea: profile.course_name,
    annoImmatricolazione: 2025,
  },
  mediaPonderata: '27.00', esami: [], pianoDiStudiRaw: [],
  prenotazioni: [
    { id: 'tomorrow', materia: 'Chimica generale', dataAppello: '21/11/2026', ora: '09:00' },
    {
      id: 'closed-today', materia: 'Termodinamica', dataAppello: '22/11/2026',
      finePrenotazione: '2026-11-20T12:00:00+01:00',
    },
    { id: 'historical', materia: 'Esame storico da escludere', dataAppello: '19/11/2026' },
  ],
  tasse: {
    paid: [{ codice: 'paid-old', description: 'Pagamento gia effettuato', amount: 50, dueDate: '18/11/2026' }],
    pending: [
      { codice: 'overdue', description: 'Rata di novembre arretrata', amount: 100, dueDate: '19/11/2026' },
      { codice: 'today', description: 'Contributo in scadenza oggi', amount: 25, dueDate: '20/11/2026' },
      { codice: 'paid-status', description: 'Pagamento gia saldato', amount: 12, dueDate: '18/11/2026', status: 'paid' },
      { codice: 'invalid', description: 'Data impossibile da escludere', amount: 99, dueDate: '31/11/2026' },
    ],
  },
};

async function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function openDeadlines(page, {
  now = '2026-11-20T15:30:00.000Z', metriche = fixture,
  docentiEnabled = false, docentiSummary = {}, deferDocentiUntilOpen = false,
} = {}) {
  await page.clock.install({ time: new Date(now) });
  let releaseDocenti;
  const docentiReady = deferDocentiUntilOpen
    ? new Promise(resolve => { releaseDocenti = resolve; })
    : Promise.resolve();
  await page.addInitScript(() => localStorage.setItem('segrepass-theme', 'dark'));
  await page.route('**/health', route => json(route, { status: 'ok' }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/bootstrap') return json(route, {
      authenticated: true, onboardingRequired: false, profile, metriche,
      sync: { fromCache: true, docenti: { enabled: docentiEnabled } },
    });
    if (url.pathname === '/api/metriche') return json(route, metriche);
    if (url.pathname === '/api/career/slow-data') return json(route, {
      status: 'ready', taxes: metriche.tasse, prenotazioni: metriche.prenotazioni,
    });
    if (url.pathname === '/api/timetable') return json(route, { timetable: { events: [] } });
    if (url.pathname === '/api/docenti/summary') return docentiReady.then(() => json(route, docentiSummary));
    if (url.pathname === '/api/docenti/preferences') return json(route, []);
    return json(route, {});
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scadenze', exact: true }).click();
  const section = page.getByRole('region', { name: 'Scadenziario personale' });
  await expect(section.getByRole('heading', { name: 'Le tue scadenze', exact: true })).toBeVisible();
  // Keep a Home request from supplying data before we enter the view under test.
  // Pausing timers before hydration prevents Next's dynamic client from mounting.
  if (releaseDocenti) releaseDocenti();
  return section;
}

function item(section, name) {
  return section.getByRole('article').filter({
    has: section.page().getByRole('heading', { name, level: 3, exact: typeof name === 'string' }),
  });
}

async function screenshot(section, name) {
  const directory = path.resolve('.kombai/deadlines');
  fs.mkdirSync(directory, { recursive: true });
  await section.screenshot({ path: path.join(directory, name), animations: 'disabled' });
}

test('deadlines compare real dates, preserve overdue payments, and filter by time and type', async ({ page }) => {
  const section = await openDeadlines(page);
  const today = section.getByTestId('deadline-today');
  await expect(today).toHaveAttribute('datetime', '2026-11-20');
  await expect(today).toContainText('20');
  await expect(section.getByRole('article')).toHaveCount(5);
  await expect(item(section, 'Rata di novembre arretrata')).toContainText(/Scaduta da 1 giorn[oi]/);
  await expect(item(section, 'Contributo in scadenza oggi')).toContainText('Oggi');
  await expect(item(section, 'Chimica generale')).toContainText('Domani');
  await expect(item(section, /Prenotazione.*Termodinamica/)).toContainText('Chiusa oggi');
  await expect(section.getByText('Esame storico da escludere', { exact: true })).toHaveCount(0);
  await expect(section.getByText(/Pagamento gia (effettuato|saldato)/)).toHaveCount(0);
  await expect(section.getByText('Data impossibile da escludere', { exact: true })).toHaveCount(0);
  await expect(section.getByText(/Alcune scadenze non hanno una data valida/)).toBeVisible();
  const dismissNotice = page.getByRole('button', { name: 'Nascondi messaggio', exact: true });
  if (await dismissNotice.isVisible()) await dismissNotice.click();
  await screenshot(section, 'desktop.png');
  await page.getByRole('button', { name: /(?:Tema:|Cambia tema:).*Scuro/i }).click();
  await page.getByRole('button', { name: /(?:Tema:|Cambia tema:).*Sistema/i }).click();
  await expect(page.locator('html')).toHaveClass(/(?:^|\s)light(?:\s|$)/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await screenshot(section, 'desktop-light.png');

  await section.getByRole('button', { name: 'Mostra scadenze di oggi', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(2);
  await expect(item(section, 'Contributo in scadenza oggi')).toBeVisible();
  await expect(item(section, /Prenotazione.*Termodinamica/)).toBeVisible();
  await section.getByRole('button', { name: 'Mostra scadenze scadute', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(2);
  await expect(item(section, 'Rata di novembre arretrata')).toBeVisible();
  await expect(item(section, /Prenotazione.*Termodinamica/)).toBeVisible();
  await section.getByRole('button', { name: 'Mostra tutte le scadenze', exact: true }).click();

  const categories = section.getByRole('group', { name: 'Filtra per tipo', exact: true });
  await categories.getByRole('button', { name: 'Esami', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(2);
  await expect(item(section, 'Chimica generale')).toBeVisible();
  await categories.getByRole('button', { name: 'Prenotazioni', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(1);
  await expect(item(section, /Prenotazione.*Termodinamica/)).toBeVisible();
  await categories.getByRole('button', { name: 'Pagamenti', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(2);
  await section.getByRole('button', { name: 'Mostra scadenze scadute', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(1);
  await expect(item(section, 'Rata di novembre arretrata')).toBeVisible();
  await categories.getByRole('button', { name: 'Tutte', exact: true }).click();
  await section.getByRole('button', { name: 'Mostra tutte le scadenze', exact: true }).click();
  await expect(section.getByRole('article')).toHaveCount(5);
});

test.describe('university calendar uses Europe/Rome', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('today remains the Rome date when the browser is still on the previous day', async ({ page }) => {
    const metriche = {
      ...fixture, prenotazioni: [],
      tasse: { paid: [], pending: [{ codice: 'rome', description: 'Contributo del giorno italiano', dueDate: '20/11/2026', amount: 15 }] },
    };
    const section = await openDeadlines(page, { now: '2026-11-19T23:30:00.000Z', metriche });
    expect(await page.evaluate(() => new Date().getDate())).toBe(19);
    await expect(section.getByTestId('deadline-today')).toHaveAttribute('datetime', '2026-11-20');
    await expect(item(section, 'Contributo del giorno italiano')).toContainText('Oggi');
    await section.getByRole('button', { name: 'Mostra scadenze di oggi', exact: true }).click();
    await expect(section.getByRole('article')).toHaveCount(1);
  });
});

test('an open mobile calendar rolls over at Rome midnight without navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const metriche = {
    ...fixture, prenotazioni: [],
    tasse: { paid: [], pending: [
      { codice: 'end-day', description: 'Rata del 20 novembre', amount: 20, dueDate: '20/11/2026' },
      { codice: 'next-day', description: 'Rata del 21 novembre', amount: 21, dueDate: '21/11/2026' },
    ] },
  };
  const section = await openDeadlines(page, { now: '2026-11-20T22:59:30.000Z', metriche });
  await page.evaluate(() => { window.__deadlineDocumentMarker = 'same-open-document'; });
  await expect(section.getByTestId('deadline-today')).toHaveAttribute('datetime', '2026-11-20');
  await expect(item(section, 'Rata del 20 novembre')).toContainText('Oggi');
  await expect(item(section, 'Rata del 21 novembre')).toContainText('Domani');
  await page.clock.runFor(61_000);
  await expect(section.getByTestId('deadline-today')).toHaveAttribute('datetime', '2026-11-21');
  await expect(item(section, 'Rata del 20 novembre')).toContainText(/Scaduta da 1 giorn[oi]/);
  await expect(item(section, 'Rata del 21 novembre')).toContainText('Oggi');
  expect(await page.evaluate(() => window.__deadlineDocumentMarker)).toBe('same-open-document');
  await screenshot(section, 'mobile.png');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('searching bookings does not remove unrelated personal deadlines', async ({ page }) => {
  await openDeadlines(page);
  await page.getByRole('navigation', { name: 'Sezioni', exact: true })
    .getByRole('button', { name: 'Prenotazioni', exact: true }).click();
  await page.getByPlaceholder('Cerca materia o docente...').fill('Termodinamica');
  await page.getByRole('button', { name: 'Scadenze', exact: true }).click();
  const section = page.getByRole('region', { name: 'Scadenziario personale' });
  await expect(item(section, 'Chimica generale')).toBeVisible();
  await expect(section.getByRole('article')).toHaveCount(5);
});

test('opening deadlines fetches Docenti bookings and suppresses closure reminders across date formats', async ({ page }) => {
  const metriche = {
    ...fixture, tasse: { paid: [], pending: [] },
    prenotazioni: [{
      id: 'segrepass-booked-copy', materia: 'Chimica prenotata', docente: 'Ada Rossi',
      dataAppello: '23/11/2026', finePrenotazione: '22/11/2026',
    }],
  };
  const docentiSummary = {
    announcements: [], subscriptions: [], groups: [], tests: [],
    bookedExams: [
      {
        courseName: 'Chimica prenotata', professor: 'Ada Rossi', examDate: '2026-11-23',
        finePrenotazione: '2026-11-22', bookingDate: '2026-11-18',
      },
      {
        courseName: 'Fisica prenotata', professor: 'Bruno Verdi', examDate: '2026-11-24',
        finePrenotazione: '2026-11-23', bookingDate: '2026-11-18',
      },
    ],
  };
  const summaryResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/docenti/summary' && response.ok());
  const section = await openDeadlines(page, {
    metriche, docentiEnabled: true, docentiSummary, deferDocentiUntilOpen: true,
  });
  await summaryResponse;
  await expect(item(section, 'Fisica prenotata')).toBeVisible();
  await expect(item(section, 'Chimica prenotata')).toHaveCount(1);
  await expect(section.getByRole('article')).toHaveCount(2);
  await expect(section.getByRole('heading', { level: 3, name: /^Prenotazione/ })).toHaveCount(0);
});

test('Docenti refresh failures preserve known deadlines and an explicit retry recovers the source', async ({ page }) => {
  const metriche = { ...fixture, prenotazioni: [], tasse: { paid: [], pending: [] } };
  const docentiSummary = {
    announcements: [], subscriptions: [], groups: [], tests: [],
    bookedExams: [{
      courseName: 'Chimica conservata da Docenti', professor: 'Ada Rossi',
      examDate: '2026-11-23', bookingDate: '2026-11-18',
    }],
  };
  const section = await openDeadlines(page, {
    metriche, docentiEnabled: true, docentiSummary, deferDocentiUntilOpen: true,
  });
  await expect(item(section, 'Chimica conservata da Docenti')).toBeVisible();

  let refreshRequests = 0;
  await page.route('**/api/docenti/summary*', route => {
    refreshRequests += 1;
    if (refreshRequests === 1) return route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'Portale Docenti temporaneamente non disponibile' }),
    });
    return json(route, {
      ...docentiSummary,
      bookedExams: [...docentiSummary.bookedExams, {
        courseName: 'Fisica recuperata da Docenti', professor: 'Bruno Verdi',
        examDate: '2026-11-24', bookingDate: '2026-11-19',
      }],
    });
  });
  await page.getByRole('navigation', { name: 'Sezioni', exact: true })
    .getByRole('button', { name: 'Carriera & Voti', exact: true }).click();
  await page.getByRole('navigation', { name: 'Sezioni', exact: true })
    .getByRole('button', { name: 'Scadenze', exact: true }).click();
  const warning = section.getByRole('status').filter({ hasText: /Prenotazioni Docenti.*dati da aggiornare/ });
  await expect(warning).toBeVisible();
  await expect(item(section, 'Chimica conservata da Docenti')).toBeVisible();
  await expect(section.getByRole('article')).toHaveCount(1);
  await section.getByRole('button', { name: 'Aggiorna dati scadenze', exact: true }).click();
  await expect(item(section, 'Fisica recuperata da Docenti')).toBeVisible();
  await expect(item(section, 'Chimica conservata da Docenti')).toBeVisible();
  await expect(section.getByRole('article')).toHaveCount(2);
  await expect(warning).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Aggiorna dati scadenze', exact: true })).toHaveCount(0);
  expect(refreshRequests).toBe(2);
});
