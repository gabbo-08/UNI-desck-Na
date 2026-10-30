// utils.js
async function enableFastMode(page) {
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
    console.error('[Utils] Errore in enableFastMode:', err.message);
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
            
          return { headers, records, rowCount: records.length };
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

module.exports = { enableFastMode, extractTables, typeFast };