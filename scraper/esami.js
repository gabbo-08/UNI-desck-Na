const { enableFastMode, extractTables } = require('./utils');
const { safeErrorMeta } = require('../lib/safe-log');

async function scrapeEsamiSostenuti(context, esisUrl) {
  const page = await context.newPage();
  await enableFastMode(page);
  
  try {
    await page.goto(esisUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    let clicked = false;
    for (const frame of page.frames()) {
      const hasLink = await frame.evaluate(() => {
        const link = Array.from(document.querySelectorAll('a')).find(a => 
          a.href.includes('esamiSostenuti') || (a.innerText || '').toLowerCase().includes('esami sostenuti')
        );
        return !!link;
      });

      if (hasLink) {
        const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await frame.evaluate(() => {
          const link = Array.from(document.querySelectorAll('a')).find(a => 
            a.href.includes('esamiSostenuti') || (a.innerText || '').toLowerCase().includes('esami sostenuti')
          );
          if (link) link.click();
        });
        await navPromise;
        clicked = true;
        break;
      }
    }
    
    if (clicked) {
      for (let i = 0; i < 20; i++) {
        let ready = false;
        for (const frame of page.frames()) {
          if (await frame.$('table').catch(() => null)) { ready = true; break; }
        }
        if (ready) break;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    
    const tables = await extractTables(page);
    return tables[0] || { headers: [], records: [], rowCount: 0 };
  } catch (err) {
    console.warn('[esami] Errore estrazione:', safeErrorMeta(err));
    return { headers: [], records: [], rowCount: 0 };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeEsamiSostenuti };
