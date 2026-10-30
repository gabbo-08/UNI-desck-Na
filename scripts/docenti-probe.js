/**
 * Strumento diagnostico per il portale Docenti Unina.
 * Uso: impostare DOCENTI_USERNAME / DOCENTI_PASSWORD (o SEGREPASS_USER / SEGREPASS_PASS)
 * e lanciare `node scripts/docenti-probe.js`. Non stampa le credenziali né i dati personali:
 * salva screenshot e riporta URL, campi, voci di menu e intestazioni delle tabelle.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const OUT_DIR = path.join(process.cwd(), '.kombai', 'tmp');
const LOGIN_URL = 'https://www.docenti.unina.it/login';

function short(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function dumpPage(page, label) {
  console.log(`\n--- ${label} ---`);
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());

  const inputs = await page.$$eval('input', elements => elements.map(element => ({
    type: element.type,
    name: element.name,
    id: element.id,
    placeholder: element.placeholder
  })).filter(input => input.type !== 'hidden'));
  console.log('INPUTS:', JSON.stringify(inputs));

  const entries = await page.$$eval('a, button', elements => elements
    .map(element => ({ text: (element.innerText || '').replace(/\s+/g, ' ').trim(), href: element.getAttribute('href') || '' }))
    .filter(entry => entry.text && entry.text.length < 60)
    .slice(0, 80));
  console.log('VOCI:', JSON.stringify(entries));

  const tables = await page.$$eval('table', elements => elements.map(table => ({
    headers: Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(cell => (cell.innerText || '').trim()).filter(Boolean),
    rows: table.querySelectorAll('tbody tr').length
  })));
  console.log('TABELLE:', JSON.stringify(tables));

  const file = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log('SCREENSHOT:', file);
}

async function clickByText(page, text) {
  return page.evaluate(target => {
    const elements = Array.from(document.querySelectorAll('a, button, li, span, div'));
    const match = elements.find(element => (element.textContent || '').trim().toLowerCase() === target);
    if (!match) return false;
    match.click();
    return true;
  }, text);
}

(async () => {
  const username = process.env.DOCENTI_USERNAME || process.env.SEGREPASS_USER;
  const password = process.env.DOCENTI_PASSWORD || process.env.SEGREPASS_PASS;
  if (!username || !password) {
    console.error('Credenziali mancanti: imposta DOCENTI_USERNAME e DOCENTI_PASSWORD.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await dumpPage(page, 'docenti-01-login');

    const clicked = await clickByText(page, 'studente');
    console.log('\nTAB STUDENTE CLICCATA:', clicked);
    await new Promise(resolve => setTimeout(resolve, 800));
    await dumpPage(page, 'docenti-02-tab');

    const inputs = await page.$$('input[type="text"], input[type="email"], input[type="password"]');
    console.log('\nCAMPI USABILI:', inputs.length);
    if (inputs.length >= 2) {
      await inputs[0].click({ clickCount: 3 });
      await inputs[0].type(username, { delay: 25 });
      await inputs[1].click({ clickCount: 3 });
      await inputs[1].type(password, { delay: 25 });

      const submitted = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
        const button = candidates.find(element => {
          const label = (element.textContent || element.value || '').trim().toLowerCase();
          const insideForm = Boolean(element.closest('form')) || element.tagName === 'BUTTON';
          return label === 'accedi' && insideForm && !element.getAttribute('href');
        });
        if (!button) return false;
        button.click();
        return true;
      });
      console.log('SUBMIT CLICCATO:', submitted);

      if (!submitted) await inputs[1].press('Enter').catch(() => {});
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 40000 }).catch(error => {
        console.log('Nessuna navigazione completa:', error.message);
      });
      await new Promise(resolve => setTimeout(resolve, 2500));
      await dumpPage(page, 'docenti-03-post-login');

      const tabs = ['riepilogo iscrizioni', 'libretto elettronico'];
      for (const label of tabs) {
        const opened = await clickByText(page, label);
        if (!opened) continue;
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1500));
        await dumpPage(page, `docenti-tab-${label.replace(/\s+/g, '-')}`);
      }
    }
  } catch (error) {
    console.error('PROBE ERROR:', error.message);
    await page.screenshot({ path: path.join(OUT_DIR, 'docenti-errore.png') }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
})();
