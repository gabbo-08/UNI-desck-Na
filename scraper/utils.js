// utils.js
const { safeErrorMeta } = require('../lib/safe-log');

function humanDelay(minMs = 700, maxMs = 1600) {
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'test') return Promise.resolve();
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);
  const delay = min + Math.floor(Math.random() * (max - min + 1));
  return new Promise(resolve => setTimeout(resolve, delay));
}
async function enableFastMode(page) {
  if (!page || typeof page.setRequestInterception !== 'function') return;
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.isInterceptResolutionHandled()) return;
      // Blocca risorse inutili per velocizzare il caricamento
      if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });
  } catch (err) {
    console.error('[Utils] Errore in enableFastMode:', safeErrorMeta(err));
  }
}

async function extractTables(targetPage) {
  const results = [];
  for (const frame of targetPage.frames()) {
    try {
      const tables = await frame.evaluate(() => {
        const cleanStr = s => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        return Array.from(document.querySelectorAll('table')).map(t => {
          const rows = Array.from(t.querySelectorAll('tr')).map(tr => ({
            cells: Array.from(tr.querySelectorAll('th, td')).map(td => cleanStr(td.innerText)),
          }));
          
          if (rows.length < 2) return null;
          
          const headers = rows[0].cells;
          const records = rows.slice(1)
            .map(row => row.cells)
            .filter(row => row.some(cell => cell !== ''))
            .map(row => Object.fromEntries(headers.map((h, i) => [h || `col_${i}`, row[i] ?? ''])));
            
          const caption = t.querySelector('caption')?.innerText || '';
          const previousHeading = t.previousElementSibling?.matches?.('h1,h2,h3,h4,h5,h6,legend')
            ? t.previousElementSibling.innerText 
            : '';
          return {
            title: cleanStr(caption || previousHeading),
            headers,
            records,
            rowCount: records.length
          };
        }).filter(Boolean);
      });
      if (tables && tables.length > 0) results.push(...tables);
    } catch {}
  }
  return results;
}

async function typeFast(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 4000 });
  await page.type(selector, value, { delay: 10 }); // API nativa Puppeteer per maggiore stabilità
}

module.exports = { enableFastMode, extractTables, typeFast, humanDelay };
