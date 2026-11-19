const { enableFastMode } = require('./utils');
const { safeErrorMeta } = require('../lib/safe-log');
const { waitForFinancialPage } = require('./slow-page-state');


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

async function scrapeCalendarioAppelli(context, esisUrl, options = {}) {
  const startedAt = Date.now();
  const listPage = options.page || await context.newPage();
  if (!options.page) await enableFastMode(listPage);

  try {
    if (!options.page) await listPage.goto(esisUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!await clickMenu(listPage)) {
      const target = new URL('/esis/caricaMenu.do?azione=calendarioAppelli', esisUrl);
      await listPage.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }

    const { frame } = await waitForFinancialPage(listPage, 'appelli', options.timeoutMs ?? 5000);

    // Esecuzione in-page simultanea via fetch() native con cookie condivisi
    const result = await frame.evaluate(async ({ concurrency, requestTimeoutMs, maxMs }) => {
      const deadline = Date.now() + maxMs;
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

      if (items.length === 0) return { items: [], failed: 0 };

      let failed = 0;
      const readExam = async exam => {
        try {
          if (!exam.href || exam.href.startsWith('javascript:')) throw new Error('APPELLI_LINK_NOT_SUPPORTED');

          const response = await fetch(exam.href, { credentials: 'include', signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()))) });
          if (!response.ok) throw new Error('APPELLI_REQUEST_FAILED');
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
          const text = cleanText(doc.body ? (doc.body.innerText || doc.body.textContent) : '');
          if (doc.querySelector('input[type="password"]') || /sessione[^.!?]{0,35}scadut|richiesta non valida/i.test(text)) {
            throw new Error('ESIS_SESSION_EXPIRED');
          }

          const noAppelliRegex = /nessun\s+appello|non\s+(?:ci\s+sono|risultano)\s+appelli|nessuna\s+sessione|nessun\s+dato/i;
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
          if (!matchDate) throw new Error('APPELLI_DETAIL_NOT_RECOGNIZED');

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
          failed += 1;
          return null;
        }
      };
      let next = 0;
      const results = [];
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
          if (Date.now() >= deadline) {
            failed += items.length - next;
            next = items.length;
            break;
          }
          const index = next++;
          const value = await readExam(items[index]);
          if (value) results.push(value);
        }
      }));

      return { items: results, failed };
    }, {
      concurrency: Math.min(4, Math.max(1, Number.parseInt(process.env.SCRAPER_APPELLI_CONCURRENCY || '3', 10) || 3)),
      requestTimeoutMs: 10000,
      maxMs: Math.min(120000, Math.max(5000, Number.parseInt(process.env.SCRAPER_APPELLI_MAX_MS || '60000', 10) || 60000))
    });
    const appelli = Array.isArray(result) ? result : result.items;
    if (result.failed) {
      const error = new Error('Alcuni dettagli appello non sono stati letti.');
      error.code = 'APPELLI_DETAILS_UNAVAILABLE';
      throw error;
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[prenotazioni] Appelli attivi: ${appelli.length} in ${seconds}s.`);
    return appelli;
  } catch (error) {
    console.warn('[prenotazioni] Errore lettura appelli:', safeErrorMeta(error));
    throw error;
  } finally {
    if (!options.page) await listPage.close().catch(() => {});
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
