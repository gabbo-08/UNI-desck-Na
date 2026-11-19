const { test, expect } = require('@playwright/test');
const { extractTables } = require('../scraper/utils');
const { findPaymentTables } = require('../lib/taxes');
const { scrapePianoPage } = require('../scraper/piano');
const { normalizePianoTable } = require('../lib/piano-normalizer');

test('legge il piano personale nel frame con colonne alternative e più tabelle', async ({ page }) => {
  await page.route('https://esis.fixture.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<h1>Insegnamenti del Piano:\nPIANO PERSONALE (IMM. DAL 2020/21) (CH101)</h1>
      <iframe srcdoc="<table><tr><th>Codice insegnamento</th><th>Insegnamento</th><th>Crediti formativi</th><th>Anno</th></tr><tr><td>CH01</td><td>Chimica generale di prova</td><td>9</td><td>I</td></tr></table><table><tr><th>Codice</th><th>Attività formativa</th><th>CFU</th><th>Anno</th></tr><tr><td>CH02</td><td>Laboratorio di prova</td><td>6,5</td><td>II</td></tr></table>"></iframe>`,
  }));
  const result = await scrapePianoPage(page, 'https://esis.fixture.test/esis/index.do', { timeoutMs: 2000 });
  const courses = normalizePianoTable(result.table);
  expect(result.available).toBe(true);
  expect(courses).toHaveLength(2);
  expect(courses[0].courseName).toBe('Chimica generale di prova');
  expect(courses[1].cfu).toBe(6.5);
  expect(courses[1].studyYear).toBe(2);
});

test('legge le vere intestazioni dopo il titolo e ignora le tabelle contenitore', async ({ page }) => {
  await page.setContent(`<table><tr><td>
    <table>
      <tr><th colspan="3">Versamenti effettuati</th></tr>
      <tr><th>Descrizione</th><th>Data pagamento</th><th>Importo</th></tr>
      <tr><td>Prima rata</td><td>01/09/2026</td><td>156,00</td></tr>
    </table>
  </td></tr></table>`);
  const tables = await extractTables(page);
  expect(tables).toHaveLength(1);
  expect(tables[0].headers).toEqual(['Descrizione', 'Data pagamento', 'Importo']);
  expect(findPaymentTables(tables).paid[0].amount).toBe(156);
});

test('legge debiti nel frame e conserva anche tabelle valide senza righe', async ({ page }) => {
  await page.setContent(`<iframe srcdoc="<table><tr><td colspan='3'>Debiti studente</td></tr><tr><th>Causale</th><th>Data di scad.</th><th>Importo</th></tr><tr><td>Contributo</td><td>30/11/2026</td><td>130,00</td></tr></table><table><tr><th>Descrizione</th><th>Data pagamento</th><th>Importo</th></tr></table>"></iframe>`);
  await expect.poll(async () => (await extractTables(page)).length).toBe(2);
  const tables = await extractTables(page);
  const taxes = findPaymentTables(tables.map(table => ({ ...table, source: 'debiti' })));
  expect(taxes.pending[0].dueDate).toBe('2026-11-30');
  expect(tables[1].rowCount).toBe(0);
});
