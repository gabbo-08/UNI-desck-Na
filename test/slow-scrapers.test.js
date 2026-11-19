process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFinancialDocument, inspectFinancialPage, waitForFinancialPage } = require('../scraper/slow-page-state');
const { readSlowData } = require('../scraper/slow-data');
const { scrapeTasse } = require('../scraper/tasse');
const { scrapeCalendarioAppelli } = require('../scraper/prenotazioni');

test('distingue pagine tasse vuote autentiche, sessioni scadute e dati non leggibili', () => {
  assert.equal(classifyFinancialDocument({ text: 'Nessun debito presente' }, 'taxes').valid, true);
  assert.equal(classifyFinancialDocument({ text: 'Debiti non disponibili' }, 'taxes').valid, false);
  assert.equal(classifyFinancialDocument({ text: 'Sessione scaduta', passwordForm: true }, 'taxes').expired, true);
  assert.equal(classifyFinancialDocument({ text: 'Portale studenti' }, 'taxes').valid, false);
  assert.equal(classifyFinancialDocument({ headers: [['Causale', 'Importo', 'Scadenza']] }, 'taxes').valid, true);
});

test('trova la pagina appelli nel frame corretto invece della prima tabella anagrafica', async () => {
  const generic = { evaluate: async () => ({ text: 'Anagrafica', headers: [['Nome', 'Matricola']] }) };
  const exams = { evaluate: async () => ({ text: 'Calendario appelli', headers: [['Codice', 'Insegnamento', 'Anno']] }) };
  const found = await inspectFinancialPage({ frames: () => [generic, exams] }, 'appelli');
  assert.equal(found.frame, exams);
  await assert.rejects(waitForFinancialPage({ frames: () => [generic] }, 'appelli', 0), error => error.code === 'APPELLI_PAGE_NOT_RECOGNIZED');
});

test('ritenta una sola volta sulla pagina ESIS principale senza sovrapporre le navigazioni', async () => {
  const page = {};
  const fallbackOrder = [];
  let active = false;
  const result = await readSlowData({}, page, 'https://example.test/esis', {
    scrapeTasse: async (_context, _url, options) => {
      if (!options?.page) return { available: false, reason: 'ESIS_SESSION_EXPIRED' };
      assert.equal(active, false);
      active = true;
      fallbackOrder.push('taxes');
      await new Promise(resolve => setImmediate(resolve));
      active = false;
      return { available: true, paid: [], pending: [] };
    },
    scrapeCalendarioAppelli: async (_context, _url, options) => {
      if (!options?.page) throw Object.assign(new Error('expired'), { code: 'ESIS_SESSION_EXPIRED' });
      assert.equal(active, false);
      fallbackOrder.push('appelli');
      return [];
    }
  });
  assert.deepEqual(fallbackOrder, ['taxes', 'appelli']);
  assert.equal(result.slowSections.taxes.status, 'ready');
  assert.equal(result.slowSections.appelli.status, 'ready');
  assert.deepEqual(result.prenotazioni, []);
});

test('una fonte indisponibile non nasconde il risultato valido dell altra', async () => {
  let taxCalls = 0;
  let examCalls = 0;
  const result = await readSlowData({}, {}, 'https://example.test/esis', {
    scrapeTasse: async () => { taxCalls += 1; return { available: false, reason: 'TAXES_PAGE_NOT_RECOGNIZED' }; },
    scrapeCalendarioAppelli: async () => { examCalls += 1; return [{ id: 'valid' }]; }
  });
  assert.equal(result.slowSections.taxes.status, 'error');
  assert.equal(result.slowSections.appelli.status, 'ready');
  assert.deepEqual(result.prenotazioni, [{ id: 'valid' }]);
  assert.equal(taxCalls, 2);
  assert.equal(examCalls, 1);
});

test('la pagina tasse senza contenuto riconosciuto non viene dichiarata disponibile', async () => {
  let closed = false;
  const page = {
    goto: async () => {}, url: () => 'https://example.test/esis',
    frames: () => [{ evaluate: async () => ({ text: 'Portale studenti', headers: [] }) }],
    close: async () => { closed = true; }
  };
  const result = await scrapeTasse({ newPage: async () => page }, 'https://example.test/esis', { timeoutMs: 0 });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'TAXES_PAGE_NOT_RECOGNIZED');
  assert.equal(closed, true);
});

test('la pagina appelli non riconosciuta genera errore e non un elenco vuoto', async () => {
  let closed = false;
  const page = {
    goto: async () => {},
    frames: () => [{ evaluate: async fn => String(fn).includes('const link') ? false : { text: 'Portale studenti', headers: [] } }],
    close: async () => { closed = true; }
  };
  await assert.rejects(scrapeCalendarioAppelli({ newPage: async () => page }, 'https://example.test/esis', { timeoutMs: 0 }), error => error.code === 'APPELLI_PAGE_NOT_RECOGNIZED');
  assert.equal(closed, true);
});

test('il fallback usa la scheda autenticata senza ricaricare l entry ESIS e senza chiuderla', async () => {
  const visited = [];
  const frame = {
    evaluate: async (fn, args) => {
      if (args?.concurrency) return { items: [], failed: 0 };
      if (String(fn).includes('const link')) return false;
      if (String(fn).includes('passwordForm')) return { text: '', headers: [['Descrizione', 'Importo', 'Codice', 'Insegnamento']] };
      return [];
    }
  };
  const page = {
    frames: () => [frame],
    goto: async url => { visited.push(url); },
    close: async () => { throw new Error('La pagina condivisa non va chiusa'); }
  };
  const context = { newPage: async () => { throw new Error('Non aprire nuove schede nel fallback'); } };
  const entry = 'https://example.test/esis/entry-with-session';
  const taxes = await scrapeTasse(context, entry, { page, timeoutMs: 0 });
  const appelli = await scrapeCalendarioAppelli(context, entry, { page, timeoutMs: 0 });
  assert.equal(taxes.available, true);
  assert.deepEqual(appelli, []);
  assert.equal(visited.includes(entry), false);
  assert.equal(visited.length, 3);
});
