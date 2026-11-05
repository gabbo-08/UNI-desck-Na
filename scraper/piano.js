// scraper/piano.js
// Legge dalla pagina "Dati Carriera > Piano di Studi" (ESIS) intestazione e tabella degli insegnamenti.

const PIANO_PATH = '/esis/caricaMenu.do?azione=pianiStudio';
const TABLE_READY_TIMEOUT_MS = 1200;

/**
 * Estrae corso e coorte dall'intestazione del Piano di Studi ESIS.
 * Esempio: "Insegnamenti del Piano: PIANO GENERALE (IMM. DAL 2025/26) (DE301)"
 */
function parsePianoHeader(text = '') {
  const source = String(text || '');
  const cohort = source.match(/IMM\.?\s*DAL\s*(\d{4})/i);
  const code = source.match(/Insegnamenti del Piano:[^\n]*?\(([A-Z0-9]{3})[A-Z0-9]*\)/i);

  return {
    annoImmatricolazione: cohort ? Number(cohort[1]) : null,
    codiceCorso: code ? code[1] : null
  };
}

async function openPianoPage(page, esisUrl) {
  const origin = new URL(esisUrl).origin;
  // ESIS può completare il rendering dopo il timeout: il contenuto resta leggibile.
  await page.goto(`${origin}${PIANO_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(error => console.warn('[piano] Navigazione lenta:', error.message));

  await page.waitForFunction(
    () => /Insegnamenti del Piano|Piano di Studi/i.test(document.body ? document.body.innerText : ''),
    { timeout: 6000 }
  ).catch(() => {});
  await page.waitForFunction(() => Array.from(document.querySelectorAll('table')).some(table => {
    const text = table.innerText || '';
    return /\bCodice\b/i.test(text) && /\bCFU\b/i.test(text) && /Descrizione/i.test(text);
  }), { timeout: TABLE_READY_TIMEOUT_MS }).catch(() => {});
}

/**
 * Trova la tabella degli insegnamenti: è quella la cui intestazione contiene
 * Codice, Descrizione e CFU. Restituisce intestazioni e righe come testo.
 */
async function extractPianoTable(page) {
  return page.evaluate(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();

    for (const table of Array.from(document.querySelectorAll('table'))) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const headerIndex = rows.findIndex(row => {
        const text = clean(row.innerText);
        return /\bCodice\b/i.test(text) && /\bCFU\b/i.test(text) && /Descrizione/i.test(text);
      });
      if (headerIndex === -1) continue;

      const headers = Array.from(rows[headerIndex].children).map(cell => clean(cell.innerText));
      const body = rows
        .slice(headerIndex + 1)
        .map(row => Array.from(row.children).map(cell => clean(cell.innerText)))
        .filter(cells => cells.some(Boolean));

      return { headers, rows: body };
    }
    return null;
  });
}

/**
 * Usa la stessa scheda della sessione ESIS (una nuova scheda riceve "richiesta non valida").
 * @returns {Promise<{header: object, table: {headers: string[], rows: string[][]} | null}>}
 */
async function scrapePianoPage(page, esisUrl) {
  try {
    await openPianoPage(page, esisUrl);
    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    const header = parsePianoHeader(text);
    const table = await extractPianoTable(page).catch(() => null);

    console.log(
      `[piano] Intestazione: corso=${header.codiceCorso || 'n/d'} coorte=${header.annoImmatricolazione || 'n/d'}; ` +
      `tabella: ${table ? `${table.rows.length} righe` : 'non trovata'}`
    );
    return { header, table };
  } catch (error) {
    console.warn('[piano] Piano non disponibile:', error.message);
    return { header: { annoImmatricolazione: null, codiceCorso: null }, table: null };
  }
}

// Compatibilità: restituisce solo l'intestazione.
async function scrapePianoHeader(page, esisUrl) {
  const { header } = await scrapePianoPage(page, esisUrl);
  return header;
}

module.exports = { parsePianoHeader, scrapePianoPage, scrapePianoHeader };
