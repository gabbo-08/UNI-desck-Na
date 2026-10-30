const { queueScrapingTask } = require('./pool');
const { scrapeEsamiSostenuti } = require('./esami');
const { scrapeCalendarioAppelli } = require('./prenotazioni');
const { scrapeTasse } = require('./tasse');
const { scrapePianoHeader } = require('./piano');
const { enableFastMode } = require('./utils');

const NODI_SEGREPASS = ['segrepass1', 'segrepass2', 'segrepass3'];
const NODE_TIMEOUT_MS = 8000;
const DEBUG = process.env.DEBUG_SCRAPER === '1';

function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

function maskId(value) {
  const text = String(value || '');
  if (text.length <= 5) return '***';
  return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

function safePath(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'n/d';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Estrae il PIN per la verbalizzazione esami e il Codice Numerico Personale
 * scansionando tutti i sotto-frame dell'interfaccia ESIS.
 */
async function scrapePin(context, esisUrl) {
  let page = null;
  try {
    page = await context.newPage();
    await enableFastMode(page).catch(() => {});
    
    const url = new URL(esisUrl);
    const pinUrl = `${url.origin}/esis/caricaMenu.do?azione=visualizzazionePin`;
    
    await page.goto(pinUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(800);

    let pin = null;
    let cnp = null;

    // Ispeziona tutti i frame del frameset ESIS
    for (const frame of page.frames()) {
      try {
        const text = await frame.evaluate(() => (document.body ? document.body.innerText : ''));
        if (!text) continue;

        const pinMatch = text.match(/PIN[^\d]*(\d{4,6})/i);
        const cnpMatch = text.match(/Codice\s+Numerico\s+Personale[^\d]*(\d+)/i);

        if (pinMatch && !pin) pin = pinMatch[1].trim();
        if (cnpMatch && !cnp) cnp = cnpMatch[1].trim();
      } catch {}
    }

    return { pin, codiceNumericoPersonale: cnp };
  } catch (err) {
    debugLog('[Segrepass] Errore durante l\'estrazione del PIN:', err.message);
    return { pin: null, codiceNumericoPersonale: null };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
async function getDatiCarriera({ codiceFiscale, password } = {}, options = {}) {
  if (!codiceFiscale || !password) throw new Error('Credenziali Segrepass mancanti.');

  const phase = ['fast', 'slow'].includes(options.phase) ? options.phase : 'full';

  return await queueScrapingTask({ codiceFiscale, password }, async (page, data) => {
    await enableFastMode(page);
    const context = page.browserContext();

    console.log(`[Segrepass] Avvio scansione nodi su identificazione.do (${maskId(data.codiceFiscale)})...`);
    let nodoAttivo = null;
    let base = '';

    for (const nodo of NODI_SEGREPASS) {
      try {
        console.log(`[Segrepass] Controllo https://www.${nodo}.unina.it/identificazione.do...`);
        const response = await page.goto(`https://www.${nodo}.unina.it/identificazione.do`, {
          waitUntil: 'domcontentloaded',
          timeout: NODE_TIMEOUT_MS
        });

        if (response && response.status() < 400) {
          const hasInputs = await page.waitForSelector('input[type="password"]', { timeout: 3000 }).catch(() => null);
          
          if (hasInputs) {
            nodoAttivo = nodo;
            base = `https://www.${nodo}.unina.it`;
            console.log(`[Segrepass] ✅ Trovato nodo attivo su identificazione: ${nodoAttivo}`);
            break;
          }
        }
      } catch (err) {
        console.log(`[Segrepass] ❌ Nodo ${nodo} non raggiungibile o timeout.`);
      }
    }

    if (!nodoAttivo) {
      throw new Error('Tutti i nodi di Segrepass (1, 2, 3) sono attualmente offline o in manutenzione. Riprova più tardi.');
    }

    const inputs = await page.$$('input[type="text"], input[type="password"]');
    const userInput = inputs[0];
    const passInput = inputs[1];

    if (!userInput || !passInput) {
      throw new Error('Impossibile trovare i campi di input del modulo di login.');
    }

    await userInput.click({ clickCount: 3 });
    await userInput.press('Backspace');
    await userInput.type(data.codiceFiscale.trim(), { delay: 30 });

    await passInput.click({ clickCount: 3 });
    await passInput.press('Backspace');
    await passInput.type(data.password, { delay: 30 });

    console.log(`[Segrepass] Invio credenziali in corso...`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
      page.click('input[type="submit"], button[type="submit"], input[value="Login"], button.btn')
    ]).catch(() => {
      console.log('[Segrepass] Timeout navigazione standard raggiunto, verifico lo stato della pagina...');
    });

    const currentUrl = page.url();
    debugLog(`[Segrepass] URL post-login: ${safePath(currentUrl)}`);

    const pageText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    const isSuccess = pageText.toLowerCase().includes('benvenuto') || pageText.toLowerCase().includes('segreteria online');

    if (!isSuccess && (pageText.toLowerCase().includes('credenziali non valide') || pageText.toLowerCase().includes('verificare i dati'))) {
      throw new Error('Credenziali non valide o errore di autenticazione su Segrepass.');
    }

    const anagraficaDinamica = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const clean = s => (s || '').replace(/\s+/g, ' ').trim();
      const matchMatricola = text.match(/(?:Matricola|Matr\.?)\s*(?:n[°º.]?)?[:\s]*([A-Z0-9]+)/i);      
      const matchNome = text.match(/Benvenut[oa][:?\s]+([A-Z\s']+?)(?=\s*-?\s*Email|$)/i) ||
                        text.match(/(?:Utente|Studente)[:\s]*([A-Z\s']+)/i);
      const matchCorso = text.match(/(?:Corso di Studio|Corso di Laurea|Corso)[\s:]*([^\n\r]+)/i);
      const matchCodiceCorso = text.match(/(?:Codice Corso|Cod\.?\s*Corso)[\s:]*([A-Z0-9]+)/i);
      const matchCognome = text.match(/Cognome[:\s]*([A-Z\s']+?)(?=\s+Nome|$)/i);
      const matchImmatricolazione = text.match(/(?:Anno Accademico di Immatricolazione|Anno di Immatricolazione|Immatricolazion[ei])[:\s]*(\d{4})/i);
      const matchAnnoCorso = text.match(/(?:Anno di Corso|Anno Corso)[:\s]*(\d{1,2})/i);

      return {
        matricola: matchMatricola ? clean(matchMatricola[1]) : null,
        nomeCompleto: matchNome ? clean(matchNome[1]) : null,
        cognome: matchCognome
          ? clean(matchCognome[1])
          : (matchNome ? clean(matchNome[1]).split(/\s+/)[0] : null),
        corsoDiLaurea: matchCorso ? clean(matchCorso[1]) : null,
        codiceCorso: matchCodiceCorso ? clean(matchCodiceCorso[1]) : null,
        annoImmatricolazione: matchImmatricolazione ? Number(matchImmatricolazione[1]) : null,
        annoCorso: matchAnnoCorso ? Number(matchAnnoCorso[1]) : null
      };
    }).catch(() => ({}));

    debugLog('\n--- [DEBUG] ANAGRAFICA ESTRATTA ---');
    debugLog(JSON.stringify(anagraficaDinamica, null, 2));
    debugLog('------------------------------------\n');

    console.log('[Segrepass] Clic su "Segreteria OnLine"...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, span, div'));
        const target = links.find(el => el.textContent.trim() === 'Segreteria OnLine' || el.textContent.trim() === 'Segreteria Online');
        if (target) {
          target.click();
        } else {
          const fallback = links.find(el => el.textContent.includes('Segreteria'));
          if (fallback) fallback.click();
        }
      })
    ]);

    const esisUrl = page.url();
    debugLog(`[Segrepass] URL dopo click Segreteria OnLine: ${safePath(esisUrl)}`);

    if (typeof options.onEsisReady === 'function') {
      await options.onEsisReady({ page, context, esisUrl });
    }

    let pianoHeader = {};
    let tabellaEsami = { headers: [], records: [], rowCount: 0 };
    let esamiList = [];
    let cfuAcquisiti = 0;
    let sommaPonderata = 0;
    let cfuConVoto = 0;
    let pinInfo = { pin: null, codiceNumericoPersonale: null };

    if (phase !== 'slow') {
      console.log('[Segrepass] Inizio estrazione veloce in parallelo (Piano, Esami, PIN)...');

      const [headerRes, esamiRes, pinRes] = await Promise.all([
        scrapePianoHeader(page, esisUrl).catch(() => ({})),
        scrapeEsamiSostenuti(context, esisUrl).catch(() => ({ headers: [], records: [], rowCount: 0 })),
        scrapePin(context, esisUrl)
      ]);

      pianoHeader = headerRes;
      tabellaEsami = esamiRes;
      pinInfo = pinRes;

      debugLog('\n--- [DEBUG] TABELLA ESAMI GREZZA ---');
      debugLog(JSON.stringify(tabellaEsami, null, 2));
      debugLog('-------------------------------------\n');

      esamiList = (tabellaEsami.records || []).map(record => {
        const cfu = parseInt(record['CFU'], 10) || 0;
        const voto = record['Valutazione'] || '';
        const votoNumerico = parseInt(voto, 10) || null;

        return {
          codice: record['Codice'] || '',
          materia: record['Insegnamento'] || '',
          voto: votoNumerico,
          giudizio: votoNumerico ? null : (voto || null),
          // Campi storici, mantenuti per compatibilità.
          votoNumerico: votoNumerico,
          isLode: voto.toLowerCase().includes('lode'),
          cfu: cfu,
          data: record['Data esame'] || ''
        };
      });

      esamiList.forEach(esame => {
        cfuAcquisiti += esame.cfu;
        if (esame.votoNumerico) {
          cfuConVoto += esame.cfu;
          sommaPonderata += (esame.votoNumerico * esame.cfu);
        }
      });
    }

    const mediaPonderata = cfuConVoto > 0 ? (sommaPonderata / cfuConVoto).toFixed(2) : '0.00';
    const baseLaurea = cfuConVoto > 0 ? ((mediaPonderata * 11) / 3).toFixed(2) : '0.00';
      
    const esamiVotati = esamiList.filter(esame => esame.votoNumerico);
    const mediaAritmetica = esamiVotati.length
      ? (esamiVotati.reduce((somma, esame) => somma + esame.votoNumerico, 0) / esamiVotati.length).toFixed(2)
      : '0.00';
    let taxes = null;
    let appelliCalendario = [];

    if (phase !== 'fast') {
      console.log('[Segrepass] Inizio estrazione background in parallelo (Tasse, Appelli)...');

      const [taxesRes, appelliRes] = await Promise.all([
        scrapeTasse(context, esisUrl).catch(() => null),
        scrapeCalendarioAppelli(context, esisUrl).catch(() => [])
      ]);

      taxes = taxesRes;
      appelliCalendario = appelliRes;

      debugLog('\n--- [DEBUG] TASSE ESTRATTE ---');
      debugLog(JSON.stringify(taxes, null, 2));
      debugLog('------------------------------\n');

      debugLog('\n--- [DEBUG] APPELLI ESTRATTI ---');
      debugLog(JSON.stringify(appelliCalendario, null, 2));
      debugLog('--------------------------------\n');
    }

    if (phase !== 'slow') {
      console.log(`[Segrepass] Carriera calcolata: ${cfuAcquisiti} CFU, Media: ${mediaPonderata}, PIN trovato: ${pinInfo.pin ? 'SÌ' : 'NO'}`);
    } else {
      console.log(`[Segrepass] Dati lenti pronti: ${taxes?.pending?.length || 0} debiti, ${appelliCalendario.length} appelli.`);
    }

    const payloadFinale = {
      anagrafica: {
        matricola: anagraficaDinamica.matricola ?? null,
        nomeCompleto: anagraficaDinamica.nomeCompleto ?? null,
        cognome: anagraficaDinamica.cognome ?? null,
        codiceCorso: anagraficaDinamica.codiceCorso ?? pianoHeader.codiceCorso ?? null,
        corsoDiLaurea: anagraficaDinamica.corsoDiLaurea ?? null,
        annoImmatricolazione: anagraficaDinamica.annoImmatricolazione ?? pianoHeader.annoImmatricolazione ?? null,
        annoCorso: anagraficaDinamica.annoCorso ?? null,
        codiceNumericoPersonale: pinInfo.codiceNumericoPersonale ?? null
      },
      pin: pinInfo.pin ?? null,
      codiceNumericoPersonale: pinInfo.codiceNumericoPersonale ?? null,
      cfuAcquisiti,
      mediaPonderata,
      baseLaurea,
      mediaAritmetica,
      totaleEsami: esamiList.length,
      esami: esamiList,
      tasse: taxes,
      prenotazioni: appelliCalendario,
      pianoDiStudiRaw: []
    };

    debugLog('\n=============================================');
    debugLog('[Segrepass] PAYLOAD FINALE:');
    debugLog(JSON.stringify(payloadFinale, null, 2));
    debugLog('=============================================\n');

    return payloadFinale;
  });
}

module.exports = { getDatiCarriera };