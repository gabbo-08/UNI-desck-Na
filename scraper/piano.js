// Legge il piano personale dalla sessione ESIS esistente, anche nei frame.
const PIANO_PATH = '/esis/caricaMenu.do?azione=pianiStudio';
const TABLE_READY_TIMEOUT_MS = 6000;
const { safeErrorMeta } = require('../lib/safe-log');
const { COLUMN_RULES, mapColumns, normalizePianoTable } = require('../lib/piano-normalizer');

function parsePianoHeader(text = '') {
  const source = String(text || '').replace(/\s+/g, ' ');
  const cohort = source.match(/IMM(?:ATRICOLATI)?\.?\s*DAL\s*(\d{4})/i);
  // Il suffisso identifica il piano; i codici ESIS storici sono i primi tre caratteri.
  const code = source.match(/Insegnamenti\s+del\s+Piano\s*:[\s\S]*?\(([A-Z0-9]{3})[A-Z0-9]*\)/i);
  return {
    annoImmatricolazione: cohort ? Number(cohort[1]) : null,
    codiceCorso: code ? code[1].toUpperCase() : null
  };
}

async function readFrame(frame) {
  return frame.evaluate(rules => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const normalized = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const matchHeaders = cells => {
      const columns = {};
      cells.forEach((cell, index) => {
        for (const [key, source, flags] of rules) {
          if (columns[key] === undefined && new RegExp(source, flags).test(normalized(cell))) {
            columns[key] = index;
            break;
          }
        }
      });
      return columns.code !== undefined && columns.name !== undefined && columns.cfu !== undefined;
    };
    const tables = [];
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const rows = Array.from(table.querySelectorAll('tr'))
        .filter(row => row.closest('table') === table)
        .map(row => Array.from(row.children).filter(cell => /^(TH|TD)$/.test(cell.tagName)).map(cell => clean(cell.innerText || cell.textContent)));
      const headerIndex = rows.findIndex(matchHeaders);
      if (headerIndex === -1) continue;
      tables.push({ headers: rows[headerIndex], rows: rows.slice(headerIndex + 1).filter(cells => cells.some(Boolean)) });
    }
    const text = document.body?.innerText || document.body?.textContent || '';
    return {
      text,
      tables,
      sessionExpired: Boolean(document.querySelector('input[type="password"]')) || /sessione\s+scaduta|richiesta\s+non\s+valida/i.test(text)
    };
  }, COLUMN_RULES.map(([key, rule]) => [key, rule.source, rule.flags]));
}

function mergePianoTables(tables) {
  const keys = ['code', 'name', 'year', 'outcome', 'grade', 'cfu', 'sector'];
  const rows = [];
  for (const table of tables) {
    const columns = mapColumns(table.headers);
    for (const row of table.rows) rows.push(keys.map(key => columns[key] === undefined ? '' : row[columns[key]]));
  }
  return { headers: ['Codice', 'Descrizione', 'Anno', 'Esito', 'Voto', 'CFU', 'Settore'], rows };
}

async function scrapePianoPage(page, esisUrl, options = {}) {
  try {
    const origin = new URL(esisUrl).origin;
    try {
      await page.goto(`${origin}${PIANO_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (error) {
      // Dopo un timeout la pagina può comunque aver caricato i dati.
      if (error?.name !== 'TimeoutError') throw error;
      console.warn('[piano] Navigazione lenta:', safeErrorMeta(error));
    }
    const deadline = Date.now() + (options.timeoutMs ?? TABLE_READY_TIMEOUT_MS);
    let header = { annoImmatricolazione: null, codiceCorso: null };
    let sessionExpired = false;
    do {
      const frames = typeof page.frames === 'function' ? page.frames() : [page];
      const results = await Promise.all(frames.map(frame => readFrame(frame).catch(() => null)));
      const valid = results.filter(Boolean);
      const ordered = [...valid.filter(result => result.tables.length), ...valid.filter(result => !result.tables.length)];
      header = parsePianoHeader(ordered.map(result => result.text).join('\n'));
      sessionExpired = valid.some(result => result.sessionExpired);
      const table = mergePianoTables(valid.flatMap(result => result.tables));
      if (normalizePianoTable(table).length) {
        console.log(`[piano] Piano personale acquisito: ${table.rows.length} righe.`);
        return { header, table, available: true };
      }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (true);
    return { header, table: null, available: false, reason: sessionExpired ? 'STUDY_PLAN_SESSION_EXPIRED' : 'STUDY_PLAN_TABLE_NOT_FOUND' };
  } catch (error) {
    console.warn('[piano] Piano non recuperato:', safeErrorMeta(error));
    return { header: { annoImmatricolazione: null, codiceCorso: null }, table: null, available: false, reason: 'STUDY_PLAN_NAVIGATION_FAILED' };
  }
}

async function scrapePianoHeader(page, esisUrl) {
  const { header } = await scrapePianoPage(page, esisUrl);
  return header;
}

module.exports = { parsePianoHeader, scrapePianoPage, scrapePianoHeader, mergePianoTables };
