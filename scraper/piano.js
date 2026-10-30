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

/**
 * Usa la stessa scheda della sessione ESIS: una nuova scheda riceve
 * "richiesta non valida" perché il menu è legato alla finestra corrente.
 */
async function scrapePianoHeader(page, esisUrl) {
  try {
    const origin = new URL(esisUrl).origin;
    // ESIS può completare il rendering dopo il timeout di navigazione:
    // in tal caso il contenuto è comunque leggibile, quindi non abortiamo.
    await page.goto(`${origin}/esis/caricaMenu.do?azione=pianiStudio`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    }).catch(error => {
      console.warn('[piano] Navigazione lenta:', error.message);
    });

    await page.waitForFunction(
      () => /Insegnamenti del Piano|Piano di Studi/i.test(document.body ? document.body.innerText : ''),
      { timeout: 6000 }
    ).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1200));

    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    const header = parsePianoHeader(text);
    console.log(`[piano] Intestazione: corso=${header.codiceCorso || 'n/d'} coorte=${header.annoImmatricolazione || 'n/d'}`);
    return header;
  } catch (error) {
    console.warn('[piano] Intestazione non disponibile:', error.message);
    return { annoImmatricolazione: null, codiceCorso: null };
  }
}

module.exports = { parsePianoHeader, scrapePianoHeader };
