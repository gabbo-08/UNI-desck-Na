const { enableFastMode, extractTables } = require('./utils');
const { findPaymentTables } = require('../lib/taxes');

const DEBUG = process.env.DEBUG_SCRAPER === '1';

async function scrapeTasse(context, esisUrl) {
  const page = await context.newPage();
  await enableFastMode(page);
  
  try {
    console.log('[tasse] Caricamento pagina ESIS...');
    await page.goto(esisUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // Ricaviamo il dominio base (es. https://www.segrepass3.unina.it)
    const urlObj = new URL(page.url());
    const baseUrl = urlObj.origin;

    console.log('[tasse] Navigazione specifica su "Pagamenti in debito"...');
    
    // Tentativo di navigazione diretta alla voce di menu "Pagamenti in debito"
    await page.goto(`${baseUrl}/esis/caricaMenu.do?azione=pagamentiDebito&currentParent=link_15`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    }).catch(async () => {
      // Fallback: ricerca ed esecuzione del click sul link "Pagamenti in debito" nel menu laterale
      console.log('[tasse] Fallback: ricerca click su "Pagamenti in debito"...');
      for (const frame of page.frames()) {
        const clicked = await frame.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const linkDebito = links.find(a => 
            (a.innerText || '').toLowerCase().includes('pagamenti in debito') ||
            (a.href || '').includes('azione=pagamentiDebito')
          );
          if (linkDebito) {
            linkDebito.click();
            return true;
          }
          return false;
        });
        if (clicked) break;
      }
    });

    // Verifica presenza del messaggio di assenza debiti
    const pageText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    if (pageText.includes('Non risultano pagamenti da effettuare')) {
      console.log('[tasse] ✅ Riscontro ESIS: Nessun pagamento in debito da effettuare.');
    }

    // Estrazione tabelle da tutti i frame
    const tables = await extractTables(page);

    if (DEBUG) {
      console.log(`\n--- [DEBUG TASSE] TABELLE GREZZE: ${tables ? tables.length : 0} ---`);
      console.log(JSON.stringify(tables, null, 2));
      console.log('-----------------------------------------------------\n');
    }
    console.log(`[tasse] Tabelle lette: ${tables.length}`);

    const result = findPaymentTables(tables);
    // La pagina è stata letta con successo: anche senza debiti i dati sono validi.
    result.available = true;
    return result;

  } catch (err) {
    console.warn('[tasse] Errore estrazione:', err.message);
    return {
      available: false,
      reason: 'TAXES_DATA_NOT_AVAILABLE',
      paid: [],
      pending: [],
      summary: { totalPaid: 0, totalPending: 0, nextDeadline: null }
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeTasse };