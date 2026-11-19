const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const profile = { id: 'service-links-test', course_id: 'TEST', course_name: 'Corso di prova', cohort_year: 2025, current_course_year: 2, channel: 'A' };
const metriche = {
  anagrafica: { nomeCompleto: 'Studente prova', corsoDiLaurea: profile.course_name },
  mediaPonderata: '27.00', esami: [], pianoDiStudiRaw: [], prenotazioni: [],
  tasse: { available: true, paid: [], pending: [] },
};

for (const scenario of [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, theme: 'light' },
  { name: 'mobile', viewport: { width: 390, height: 844 }, theme: 'dark' },
]) {
  test(`i collegamenti ufficiali hanno icone originali leggibili su ${scenario.name}`, async ({ page }) => {
    await page.setViewportSize(scenario.viewport);
    await page.addInitScript(theme => window.localStorage.setItem('segrepass-theme', theme), scenario.theme);
    await page.route('**/health', route => route.fulfill({ json: { status: 'ok' } }));
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/auth/bootstrap') return route.fulfill({ json: {
        authenticated: true, onboardingRequired: false, profile, metriche,
        sync: { fromCache: true, docenti: { enabled: false } },
      } });
      if (pathname === '/api/career/slow-data') return route.fulfill({ json: { status: 'ready', taxes: metriche.tasse, prenotazioni: [] } });
      if (pathname === '/api/metriche') return route.fulfill({ json: metriche });
      return route.fulfill({ json: {} });
    });
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Servizi ufficiali', exact: true });
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('link')).toHaveCount(3);
    for (const [name, href] of [
      ['Segrepass', 'https://www.segrepass1.unina.it/Welcome.do'],
      ['Docenti', 'https://www.docenti.unina.it/'],
      ['EasyAcademy', 'https://easyacademy.unina.it/agendastudenti/index.php?view=easycourse&_lang=it&include=corso'],
    ]) {
      const link = section.getByRole('link', { name: `Apri ${name} in una nuova scheda`, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect.poll(() => link.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      if (name !== 'Segrepass') {
        const background = await link.locator('img').evaluate(image => getComputedStyle(image.parentElement.parentElement).backgroundColor);
        const channels = background.match(/\d+/g).slice(0, 3).map(Number);
        expect(channels.every(channel => channel < 150)).toBe(true);
      }
      const bounds = await link.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(scenario.viewport.width);
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
    const directory = path.resolve('.kombai/service-links');
    fs.mkdirSync(directory, { recursive: true });
    await section.screenshot({ path: path.join(directory, `servizi-${scenario.name}.png`) });

    // Verify a real click opens a new tab without contacting the external site.
    await page.context().route('https://www.docenti.unina.it/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Portale ufficiale di prova</title>' }));
    const popupPromise = page.waitForEvent('popup');
    await section.getByRole('link', { name: 'Apri Docenti in una nuova scheda', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL('https://www.docenti.unina.it/');
    await popup.close();
  });
}
