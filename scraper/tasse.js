const { enableFastMode, extractTables } = require('./utils');
const { findPaymentTables } = require('../lib/taxes');
const { safeErrorMeta } = require('../lib/safe-log');
const { waitForFinancialPage } = require('./slow-page-state');

// Come per segrepass.js: il debug è escluso in produzione e non stampa mai
// le tabelle finanziarie grezze, che contengono dati personali dello studente.
const DEBUG = process.env.DEBUG_SCRAPER === '1' && process.env.NODE_ENV !== 'production';

async function scrapeTasse(context, esisUrl, options = {}) {
  const page = options.page || await context.newPage();
  if (!options.page) await enableFastMode(page);
  
  try {
    console.log('[tasse] Caricamento pagina ESIS...');
    if (!options.page) await page.goto(esisUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // Ricaviamo il dominio base (es. https://www.segrepass3.unina.it)
    const urlObj = new URL(options.page ? esisUrl : page.url());
    const baseUrl = urlObj.origin;

    console.log('[tasse] Lettura URL ufficiali versamenti e debiti...');

    const versamentiUrl = `${baseUrl}/esis/caricaMenu.do?azione=versamenti&currentParent=link_1`;
    const debitiUrl = `${baseUrl}/esis/caricaMenu.do?azione=debiti&currentParent=link_1`;

    await page.goto(versamentiUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await waitForFinancialPage(page, 'taxes', options.timeoutMs ?? 5000);
    const paymentTables = await extractTables(page);

    await page.goto(debitiUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    await waitForFinancialPage(page, 'taxes', options.timeoutMs ?? 5000);
    const debtTables = await extractTables(page);

    const tables = [
      ...paymentTables.map(table => ({ ...table, source: 'versamenti' })),
      ...debtTables.map(table => ({ ...table, source: 'debiti' }))
    ];

    if (DEBUG) {
      console.log(`[DEBUG TASSE] Tabelle grezze acquisite: ${tables.length} (contenuto finanziario oscurato)`);
    }
    console.log(`[tasse] Tabelle lette: ${tables.length}`);

    const result = findPaymentTables(tables);
    // La pagina è stata letta con successo: anche senza debiti i dati sono validi.
    result.available = true;
    return result;

  } catch (err) {
    console.warn('[tasse] Errore estrazione:', safeErrorMeta(err));
    return {
      available: false,
      reason: err?.code || 'TAXES_DATA_NOT_AVAILABLE',
      paid: [],
      pending: [],
      summary: { totalPaid: 0, totalPending: 0, nextDeadline: null }
    };
  } finally {
    if (!options.page) await page.close().catch(() => {});
  }
}

module.exports = { scrapeTasse };
