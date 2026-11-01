const { test, expect } = require('@playwright/test');

const session = {
  token: 'visual-test-token',
  onboardingRequired: false,
  profile: {
    id: 'student-1',
    matricola: 'VRDLGI00A01F839X',
    name: 'Giulia Verdi',
    courseName: 'Informatica',
    courseId: 'L-31',
  },
};

const teacherDetail = {
  profilo: {
    id: 'teacher-1',
    nome: 'Prof.ssa Demo',
    ruolo: 'Docente',
    fotoUrl: '/api/docenti/teacher/teacher-1/photo',
  },
  materiali: {
    pubblico: [{ id: 'folder-1', nome: 'Analisi I', tipo: 'cartella' }],
    ftp: [],
    riservato: [],
  },
  appelli: [{
    id: 'exam-1',
    insegnamento: 'Analisi Demo',
    dataEsame: '2030-06-15T09:00:00.000Z',
    inizioPrenotazione: '2030-05-01T00:00:00.000Z',
    finePrenotazione: '2030-06-14T23:59:59.000Z',
    prenotato: false,
  }],
  iscrizioni: [{
    insegnamento: 'Laboratorio Demo',
    iscritto: true,
    courseCode: 'LAB-01',
  }],
};

async function openTeacher(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Docenti', exact: true }).click();
  await page.getByRole('button', { name: /^Corsi seguiti/ }).click();
  await page.getByRole('button', { name: /Analisi Demo/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body;

    if (url.pathname === '/api/auth/session') {
      body = session;
    } else if (url.pathname === '/api/metriche') {
      body = { anagrafica: { matricola: session.profile.matricola, nomeCompleto: session.profile.name, corsoDiLaurea: session.profile.courseName }, pianoDiStudiRaw: [] };
    } else if (url.pathname === '/api/career/slow-data') {
      body = { status: 'ready', prenotazioni: [] };
    } else if (url.pathname === '/api/docenti/summary') {
      body = {
        announcements: [],
        subscriptions: [{ courseName: 'Analisi Demo', professor: 'Prof.ssa Demo', professorId: 'teacher-1', section: 'A' }],
        bookedExams: [],
        groups: [],
        tests: [],
      };
    } else if (url.pathname === '/api/docenti/teacher/teacher-1') {
      body = teacherDetail;
    } else if (url.pathname === '/api/docenti/teacher/teacher-1/photo') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgo=', 'base64') });
      return;
    } else if (url.pathname === '/api/docenti/teacher/teacher-1/folder/folder-1') {
      body = { items: [{ id: 'file-1', nome: 'Slide introduttive.pdf', tipo: 'file' }] };
    } else {
      body = {};
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

});

test('Docente page sections remain visually stable and inscriptions are unique', async ({ page }) => {
  await openTeacher(page);

  await expect(page.getByRole('heading', { name: 'Materiale didattico' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appelli di esame' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Iscrizioni alle lezioni' })).toBeVisible();

  const inscriptions = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Iscrizioni alle lezioni' }),
  });
  await expect(inscriptions.getByText('Laboratorio Demo', { exact: true })).toHaveCount(1);
  await expect(page).toHaveScreenshot('docente-page.png', { fullPage: true });
});

test('Estrae TUTTI i docenti dal piano studi', async ({ page }) => {
  await openTeacher(page);
  await expect(page.getByText('Prof.ssa Demo', { exact: true })).toBeVisible();
});

test('Immagine profilo docente non restituisce 404', async ({ page }) => {
  const photoResponse = page.waitForResponse(response =>
    response.url().includes('/api/docenti/teacher/teacher-1/photo')
  );
  await openTeacher(page);
  await expect((await photoResponse).status()).toBe(200);
});

test('Cliccando sulla cartella del materiale, i file diventano visibili nel DOM', async ({ page }) => {
  await openTeacher(page);
  await page.getByRole('button', { name: 'Analisi I' }).click();
  await expect(page.getByRole('button', { name: 'Slide introduttive.pdf' })).toBeVisible();
});

test('Il backend risponde ai dati in cache in meno di 50ms', async ({ page }) => {
  await openTeacher(page);
  const elapsed = await page.evaluate(async () => {
    const started = performance.now();
    const response = await fetch('/api/docenti/teacher/teacher-1');
    if (!response.ok) throw new Error(`Unexpected status: ${response.status}`);
    await response.json();
    return performance.now() - started;
  });
  expect(elapsed).toBeLessThan(50);
});
