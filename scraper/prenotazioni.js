const { enableFastMode } = require('./utils');
const { safeErrorMeta } = require('../lib/safe-log');

const DEBUG = process.env.DEBUG_SCRAPER === '1' && process.env.NODE_ENV !== 'production';
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
          const bookingForm = doc.querySelector('form#appello, form[action*="azione=prenota"]');
          const bookingAction = bookingForm?.getAttribute('action') || null;
          const annopri = bookingForm?.querySelector('input[name="annopri"]')?.getAttribute('value') || null;
          const numAppello = bookingForm?.querySelector('input[name="num_appello"]')?.getAttribute('value') || null;
          const bookingButton = bookingForm?.querySelector('input[type="submit"], button[type="submit"]');
          const bookingEnabled = Boolean(
            bookingForm &&
            annopri &&
            numAppello &&
            bookingButton &&
            !bookingButton.hasAttribute('disabled')
          );

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
            note,
            annopri,
            numAppello,
            bookingAction,
            bookingMethod: bookingForm?.getAttribute('method')?.toUpperCase() || 'GET',
            bookingEnabled
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
    console.warn('[prenotazioni] Errore lettura appelli:', safeErrorMeta(error));
    return [];
  } finally {
    await listPage.close().catch(() => {});
  }
}

function parseBookingResponse(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const success = /prenotazione\s+(?:effettuata|confermata)|iscrizione\s+(?:effettuata|confermata)/i.test(text);
  const failureMatch = text.match(/(?:finestra temporale chiusa|mancano[^.]{0,180}|esame già superato|già prenotato|non è possibile[^.]{0,180}|errore[^.]{0,180})/i);
  return {
    success,
    message: success ? 'Prenotazione effettuata.' : (failureMatch?.[0]?.trim() || 'Il portale non ha confermato la prenotazione.')
  };
}

async function submitAppelloAction(page, esisOrigin, { annopri, numAppello, action = 'prenota' } = {}) {
  if (!page || !annopri || !numAppello) {
    const error = new Error('Identificativi appello mancanti.');
    error.code = 'APPELLO_IDENTIFIERS_REQUIRED';
    throw error;
  }
  if (action !== 'prenota') {
    const error = new Error('Annullamento Segrepass non ancora mappato.');
    error.code = 'APPELLO_CANCEL_NOT_MAPPED';
    throw error;
  }

  const result = await page.evaluate(async ({ annopri: year, numAppello: appointment }) => {
    const form = new URLSearchParams();
    form.set('annopri', String(year));
    form.set('num_appello', String(appointment));
    const response = await fetch('/esis/prenotazioni.do?azione=prenota', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    return { ok: response.ok, status: response.status, html: await response.text() };
  }, { annopri, numAppello });

  const parsed = parseBookingResponse(result.html);
  if (!result.ok || !parsed.success) {
    const error = new Error(parsed.message);
    error.code = 'APPELLO_BOOKING_REJECTED';
    error.status = result.status >= 400 ? result.status : 400;
    throw error;
  }
  return parsed;
}

module.exports = { scrapeCalendarioAppelli, parseBookingResponse, submitAppelloAction };
