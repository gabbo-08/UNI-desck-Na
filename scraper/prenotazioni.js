const { enableFastMode } = require('./utils');

const DEBUG = process.env.DEBUG_SCRAPER === '1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function clickMenu(page) {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate(() => {
        const link = Array.from(document.querySelectorAll('a')).find(a =>
          (a.innerText || '').toLowerCase().includes('calendario appelli') ||
          (a.href || '').includes('calendarioAppelli')
        );
        if (link) { link.click(); return true; }
        return false;
      });
      if (clicked) return true;
    } catch {}
  }
  return false;
}

async function getTargetFrame(page) {
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const frame of page.frames()) {
      try {
        const table = await frame.$('table');
        if (!table) continue;
        const rows = await frame.$$eval('table tr', elements => elements.length);
        if (rows > 2) return frame;
      } catch {}
    }
    await sleep(120);
  }
  return page.mainFrame();
}

async function scrapeCalendarioAppelli(context, esisUrl) {
  const startedAt = Date.now();
  const listPage = await context.newPage();
  await enableFastMode(listPage);

  try {
    await listPage.goto(esisUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!await clickMenu(listPage)) {
      console.log('[prenotazioni] Link Calendario Appelli non trovato.');
      return [];
    }

    const frame = await getTargetFrame(listPage);

    // Esecuzione in-page simultanea via fetch() native con cookie condivisi
    const appelli = await frame.evaluate(async () => {
      const clean = s => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('table tr'));
      const items = [];

      for (const tr of rows) {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 2) continue;
        const link = cells[0].querySelector('a');
        const code = clean(cells[0].innerText);
        const name = clean(cells[1].innerText);
        const year = cells[2] ? clean(cells[2].innerText) : '';
        if (link && code && name) {
          const href = link.getAttribute('href') || link.href || '';
          items.push({ code, name, year, href });
        }
      }

      if (items.length === 0) return [];

      // Esegue tutte le chiamate di dettaglio in parallelo direttamente dal browser
      const results = await Promise.all(items.map(async (exam) => {
        try {
          if (!exam.href || exam.href.startsWith('javascript:')) return null;

          const response = await fetch(exam.href, { credentials: 'include' });
          if (!response.ok) return null;
          const html = await response.text();

          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          // Il testo della pagina contiene anche frammenti di script (es. document.write):
          // li rimuovo prima di estrarre aula e note.
          const cleanText = raw => (raw || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/document\.\w+\s*\([^)]*\)\s*;?/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const text = cleanText(doc.body ? doc.body.innerText : '');

          const noAppelliRegex = /nessun\s+appello|non\s+(?:ci\s+sono|risultano)\s+appelli|nessuna\s+sessione|impossibile\s+prenotare|nessun\s+dato/i;
          if (noAppelliRegex.test(text)) return null;

          let docente = '';
          let cattedra = '';
          for (const tr of Array.from(doc.querySelectorAll('table tr'))) {
            const tds = Array.from(tr.querySelectorAll('td')).map(td => clean(td.innerText));
            if (tds.length >= 4 && !tds[0].includes('A.A.')) {
              cattedra = tds[2] || '';
              docente = tds[3] || '';
            }
          }

          const matchDocente = text.match(/Docente\s+([A-Z\s\.'-]+?)(?=\s+Appello|\s+Data|\s+Note|$)/i);
          if (matchDocente && matchDocente[1]) docente = clean(matchDocente[1]);

          const matchDate = text.match(/(?:Appello del|Data Appello|Data)[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
          if (!matchDate) return null;

          // Aula: si ferma prima del campo successivo (Ora, Note, Data...).
          const matchAula = text.match(/Aula(?:\s*\/?\s*Sede)?\s*[:\-]?\s*(.+?)(?=\s+(?:Ora|Note|Data|Docente|Appello|Uscita)\b|$)/i);
          // Note: prende il testo fino ai frammenti di script residui (HomePage, Uscita).
          const matchNote = text.match(/Note\s*[:\-]?\s*([\s\S]+)/i);
          const note = matchNote
            ? matchNote[1].split(/\b(?:HomePage|Uscita)\b/i)[0].replace(/[;\s]+$/, '').trim().slice(0, 400) || null
            : null;
          const matchOra = text.match(/(?:Ora Appello|Ora)[:\s]*(\d{1,2}:\d{2})/i);

          return {
            id: `appello_${exam.code}`,
            codice: exam.code,
            materia: clean(exam.name),
            anno: clean(exam.year),
            docente: docente || 'Docente non specificato',
            cattedra,
            dataAppello: matchDate[1],
            ora: matchOra ? matchOra[1] : null,
            aula: matchAula ? matchAula[1].trim().slice(0, 80) || null : null,
            note
          };
        } catch {
          return null;
        }
      }));

      return results.filter(Boolean);
    });

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[prenotazioni] Appelli attivi: ${appelli.length} in ${seconds}s.`);
    return appelli;
  } catch (error) {
    console.warn('[prenotazioni] Errore lettura appelli:', error.message);
    return [];
  } finally {
    await listPage.close().catch(() => {});
  }
}

module.exports = { scrapeCalendarioAppelli };
