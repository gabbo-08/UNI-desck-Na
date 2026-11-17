
const { queueScrapingTask } = require('./pool');
const { scrapeEsamiSostenuti } = require('./esami');
const { scrapeCalendarioAppelli } = require('./prenotazioni');
const { submitAppelloAction } = require('./prenotazioni');
const { scrapeTasse } = require('./tasse');
const { scrapePianoPage } = require('./piano');
const { normalizePianoTable } = require('../lib/piano-normalizer');
const { enableFastMode } = require('./utils');

const NODI_SEGREPASS = ['segrepass1', 'segrepass2', 'segrepass3'];
const NODE_TIMEOUT_MS = 9500;
let lastWorkingNode = null;
// Il portale a volte invia il login via form/XHR senza una navigazione
// completa. Non lasciare il primo accesso bloccato per 60 secondi in quel
// caso: lo stato della pagina viene verificato subito dopo il click.
const LOGIN_NAV_TIMEOUT_MS = Math.min(
  60000,
  Math.max(10000, Number.parseInt(process.env.SEGREPASS_LOGIN_NAV_TIMEOUT_MS || '20000', 10) || 20000)
);
// Il debug dello scraper è escluso in produzione: anche con DEBUG_SCRAPER=1,
// NODE_ENV=production lo disattiva per non esporre dati personali nei log.
const DEBUG = process.env.DEBUG_SCRAPER === '1' && process.env.NODE_ENV !== 'production';

function portalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function classifyLoginPage({ pageText = '', hasLoginForm = false, hasAuthenticatedNavigation = false, hasIdentityMarker = false } = {}) {
  const normalizedText = String(pageText).toLowerCase();
  if (normalizedText.includes('credenziali non valide') || normalizedText.includes('verificare i dati')) {
    return 'INVALID_CREDENTIALS';
  }
  if (!hasLoginForm && (hasAuthenticatedNavigation || hasIdentityMarker)) return 'AUTHENTICATED';
  return 'PORTAL_UNAVAILABLE';
}

function debugLog(...args) {
  if (!DEBUG) return;
  // Gli argomenti funzione sono thunk: valutati solo con debug attivo, così
  // in produzione non serializziamo dati personali a ogni scraping.
  console.log(...args.map(arg => (typeof arg === 'function' ? arg() : arg)));
}

// Oscura i dati personali nei dump di debug: PIN/CNP, anagrafica e tasse sono
// redatti interamente; gli altri identificatori sono mascherati per chiave.
const SENSITIVE_DEBUG_KEYS = new Set([
  'pin', 'cnp', 'codicenumericopersonale', 'password',
  'matricola', 'codicefiscale', 'cf', 'nome', 'nomecompleto', 'cognome',
  'anagrafica', 'tasse'
]);

function redactForDebug(value) {
  if (Array.isArray(value)) return value.map(redactForDebug);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_DEBUG_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactForDebug(val);
    }
    return out;
  }
  return value;
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

    let pin = null;
    let cnp = null;

    // La pagina PIN è un frameset legacy: domcontentloaded può precedere il
    // caricamento del frame che contiene i dati. Riprova per alcuni secondi,
    // leggendo sia il testo sia i valori dei campi (non presenti in innerText).
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && !pin) {
      const sources = await Promise.all(page.frames().map(frame => frame.evaluate(() => {
        const text = document.body?.innerText || '';
        const fields = Array.from(document.querySelectorAll('input, textarea, select'))
          .map(element => `${element.getAttribute('name') || ''} ${element.getAttribute('id') || ''} ${element.getAttribute('aria-label') || ''} ${element.value || element.textContent || ''}`)
          .join('\n');
        return `${text}\n${fields}`;
      }).catch(() => '')));

      for (const source of sources) {
        const pinMatch = source.match(/(?:codice\s+)?PIN[^\d]{0,80}(\d{4,6})/i);
        const cnpMatch = source.match(/Codice\s+Numerico\s+Personale[^\d]{0,80}(\d+)/i);
        if (pinMatch && !pin) pin = pinMatch[1].trim();
        if (cnpMatch && !cnp) cnp = cnpMatch[1].trim();
      }
      if (!pin) await sleep(300);
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

    const orderedNodes = lastWorkingNode ? [lastWorkingNode, ...NODI_SEGREPASS.filter(n => n !== lastWorkingNode)] : NODI_SEGREPASS;
    for (const nodo of orderedNodes) {
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
            lastWorkingNode = nodo;
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
      throw portalError('PORTAL_UNAVAILABLE', 'Il portale Segrepass non è disponibile. Riprova più tardi.');
    }

    const inputs = await page.$$('input[type="text"], input[type="password"]');
    const userInput = inputs[0];
    const passInput = inputs[1];

    if (!userInput || !passInput) {
      throw new Error('Impossibile trovare i campi di input del modulo di login.');
    }

    await userInput.click({ clickCount: 3 });
    await userInput.press('Backspace');
    await userInput.type(data.codiceFiscale.trim());

    await passInput.click({ clickCount: 3 });
    await passInput.press('Backspace');
    await passInput.type(data.password);

    console.log(`[Segrepass] Invio credenziali in corso...`);
    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: LOGIN_NAV_TIMEOUT_MS }).catch(() => null);
    const loginStateChange = page.waitForFunction(() => {
      const text = document.body?.innerText || '';
      return !document.querySelector('input[type="password"]') ||
        /segreteria\s+online|benvenut[oa]|credenziali\s+non\s+valide|verificare\s+i\s+dati/i.test(text);
    }, { timeout: LOGIN_NAV_TIMEOUT_MS }).catch(() => null);
    const clicked = await page.click('input[type="submit"], button[type="submit"], input[value="Login"], button.btn')
      .then(() => true)
      .catch(() => false);
    if (clicked) await Promise.race([navigation, loginStateChange]);

    const currentUrl = page.url();
    debugLog(`[Segrepass] URL post-login: ${safePath(currentUrl)}`);

    const pageText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
    const loginState = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const normalized = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const hasLoginForm = Boolean(document.querySelector('input[type="password"]')) &&
        Boolean(document.querySelector('input[type="submit"], button[type="submit"], input[value="Login"], button.btn'));
      const hasAuthenticatedNavigation = Array.from(document.querySelectorAll('a, span, div'))
        .some(element => normalized(element.textContent) === 'segreteria online');
      const hasIdentityMarker = /\b(?:numero di )?matricola\b|\bmatr\.?\b/i.test(text);
      return { hasLoginForm, hasAuthenticatedNavigation, hasIdentityMarker };
    }).catch(() => ({ hasLoginForm: false, hasAuthenticatedNavigation: false, hasIdentityMarker: false }));
    const loginClassification = classifyLoginPage({ pageText, ...loginState });
    if (loginClassification === 'INVALID_CREDENTIALS') {
      throw portalError('INVALID_CREDENTIALS', 'Credenziali Segrepass non valide.');
    }
    if (loginClassification !== 'AUTHENTICATED') {
      throw portalError('PORTAL_UNAVAILABLE', 'Impossibile verificare l’autenticazione sul portale Segrepass.');
    }

    const anagraficaDinamica = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const clean = s => (s || '').replace(/\s+/g, ' ').trim();
      const matricolaField = Array.from(document.querySelectorAll('input, select, [data-value], [value]'))
        .find(element => /matricola|matr/i.test(
          `${element.getAttribute('name') || ''} ${element.getAttribute('id') || ''} ${element.getAttribute('class') || ''}`
        ));
      const matricolaPattern = '(?:[A-Z]{1,2}\\d{2,4}\\s*[/.-]\\s*\\d{3,8}|[A-Z]{1,4}\\d{5,10}|\\d{6,10})';
      const extractLabeledMatricola = source => {
        const value = clean(source);
        if (!value) return null;
        const labeled = value.match(new RegExp(
          `(?:Numero\\s+di\\s+)?Matricola\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?(${matricolaPattern})`,
          'i'
        )) || value.match(new RegExp(
          `Matr\\.?\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?(${matricolaPattern})`,
          'i'
        ));
        return labeled?.[1] ? clean(labeled[1]).replace(/\s+/g, '') : null;
      };
      const extractFieldMatricola = source => {
        const value = clean(source);
        if (!value) return null;
        const raw = value.match(new RegExp(`\\b(${matricolaPattern})\\b`, 'i'))?.[1];
        return raw ? clean(raw).replace(/\s+/g, '') : null;
      };
      const matricolaLabels = Array.from(document.querySelectorAll('th, td, label, dt, span, strong, p, div'))
        .filter(element => /\b(?:numero\s+di\s+)?matricola\b|\bmatr\.?\b/i.test(clean(element.innerText)))
        .slice(0, 20);
      const matricolaContexts = matricolaLabels.flatMap(element => {
        const container = element.closest('tr, li, p, dl, fieldset, div');
        const siblings = [
          element.nextElementSibling,
          element.parentElement?.nextElementSibling,
          container?.querySelector('td:last-child, dd, input, select')
        ];
        return [
          element.innerText,
          container?.innerText,
          ...siblings.map(sibling => sibling?.textContent || sibling?.getAttribute?.('value') || '')
        ];
      });
      const matchMatricola = extractLabeledMatricola(text) ||
        matricolaContexts.map(extractLabeledMatricola).find(Boolean) ||
        extractFieldMatricola(matricolaField?.getAttribute('value')) ||
        extractFieldMatricola(matricolaField?.getAttribute('data-value')) ||
        matricolaContexts.map(extractFieldMatricola).find(Boolean);
      const matchNome = text.match(/Benvenut[oa][:?\s]+([A-Z\s']+?)(?=\s*-?\s*Email|$)/i) ||
                        text.match(/(?:Utente|Studente)[:\s]*([A-Z\s']+)/i);
      const matchCorso = text.match(/(?:Corso di Studio|Corso di Laurea|Corso)[\s:]*([^\n\r]+)/i);
      const matchCodiceCorso = text.match(/(?:Codice Corso|Cod\.?\s*Corso)[\s:]*([A-Z0-9]+)/i);
      const matchCognome = text.match(/Cognome[:\s]*([A-Z\s']+?)(?=\s+Nome|$)/i);
      const matchImmatricolazione = text.match(/(?:Anno Accademico di Immatricolazione|Anno di Immatricolazione|Immatricolazion[ei])[:\s]*(\d{4})/i);
      const matchAnnoCorso = text.match(/(?:Anno di Corso|Anno Corso)[:\s]*(\d{1,2})/i);

      return {
        matricola: matchMatricola,
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

    // ESIS può mostrare il riepilogo dentro un frame separato dal documento
    // principale: cerca la matricola anche nei frame della pagina autenticata.
    if (!anagraficaDinamica.matricola) {
      const frameSources = await Promise.all(page.frames().map(frame => frame.evaluate(() => ({
        text: document.body?.innerText || '',
        html: document.documentElement?.outerHTML || ''
      })).catch(() => ({ text: '', html: '' }))));
      const frameText = frameSources.map(source => `${source.text} ${source.html}`).join(' ');
      const frameMatricola = frameText.match(new RegExp(
        `(?:Numero\\s+di\\s+)?Matricola\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?((?:[A-Z]{1,2}\\d{2,4}\\s*[/.-]\\s*\\d{3,8}|[A-Z]{1,4}\\d{5,10}|\\d{6,10}))`,
        'i'
      )) || frameText.match(new RegExp(
        `Matr\\.?\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?((?:[A-Z]{1,2}\\d{2,4}\\s*[/.-]\\s*\\d{3,8}|[A-Z]{1,4}\\d{5,10}|\\d{6,10}))`,
        'i'
      ));
      if (frameMatricola) anagraficaDinamica.matricola = frameMatricola[1].replace(/\s+/g, '').trim();
    }

    debugLog('\n--- [DEBUG] ANAGRAFICA ESTRATTA (oscurata) ---');
    debugLog(() => JSON.stringify(redactForDebug({ anagrafica: anagraficaDinamica }), null, 2));
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

    await page.waitForFunction(
      () => /(?:Numero\s+di\s+)?Matricola\s+n?[°º.]?\s*:/i.test(document.body?.innerText || ''),
      { timeout: 10000 }
    ).catch(() => {});

    if (!anagraficaDinamica.matricola) {
      const esisMatricola = await page.evaluate(() => {
        const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
        const pattern = '(?:[A-Z]{1,2}\\d{2,4}\\s*[/.-]\\s*\\d{3,8}|[A-Z]{1,4}\\d{5,10}|\\d{6,10})';
        const sources = [
          ...Array.from(document.querySelectorAll('p.textcontent, p'))
            .filter(element => /matricola|matr/i.test(clean(element.innerText)))
            .map(element => element.innerText),
          document.body?.innerText || '',
          ...Array.from(document.querySelectorAll('th, td, label, dt, span, strong, p, div'))
            .filter(element => /\b(?:numero\s+di\s+)?matricola\b|\bmatr\.?\b/i.test(clean(element.innerText)))
            .flatMap(element => {
              const container = element.closest('tr, li, p, dl, fieldset, div');
              return [element.innerText, container?.innerText, element.nextElementSibling?.textContent || ''];
            }),
          ...Array.from(document.querySelectorAll('input, select, [data-value], [value]')).flatMap(element => {
            const metadata = `${element.getAttribute('name') || ''} ${element.getAttribute('id') || ''} ${element.getAttribute('class') || ''}`;
            return /matricola|matr/i.test(metadata)
              ? [element.getAttribute('value'), element.getAttribute('data-value'), element.textContent]
              : [];
          })
        ];
        for (const source of sources) {
          const value = clean(source);
          const match = value.match(new RegExp(
            `(?:Numero\\s+di\\s+)?Matricola\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?(${pattern})`,
            'i'
          )) || value.match(new RegExp(
            `Matr\\.?\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?(${pattern})`,
            'i'
          ));
          if (match?.[1]) return match[1].replace(/\s+/g, '');
        }
        return null;
      }).catch(() => null);
      if (esisMatricola) anagraficaDinamica.matricola = esisMatricola;
      if (!anagraficaDinamica.matricola) {
        const frameMatricola = await Promise.all(page.frames().map(frame => frame.evaluate(() => {
          const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
          const pattern = '(?:[A-Z]{1,2}\\d{2,4}\\s*[/.-]\\s*\\d{3,8}|[A-Z]{1,4}\\d{5,10}|\\d{6,10})';
          const text = document.body?.innerText || '';
          const contexts = [
            text,
            ...Array.from(document.querySelectorAll('th, td, label, dt, span, strong, p, div'))
              .filter(element => /\b(?:numero\s+di\s+)?matricola\b|\bmatr\.?\b/i.test(clean(element.innerText)))
              .flatMap(element => {
                const container = element.closest('tr, li, p, dl, fieldset, div');
                return [element.innerText, container?.innerText, element.nextElementSibling?.textContent || ''];
              })
          ];
          for (const value of contexts) {
            const match = clean(value).match(new RegExp(
              `(?:Numero\\s+di\\s+)?Matricola\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?(${pattern})`,
              'i'
            )) || clean(value).match(new RegExp(
              `Matr\\.?\\s*(?:n[°º.]?|numero)?\\s*(?:[:\\-]\\s*)?(${pattern})`,
              'i'
            ));
            if (match?.[1]) return match[1].replace(/\s+/g, '');
          }
          return null;
        }).catch(() => null))).then(values => values.find(Boolean) || null);
        if (frameMatricola) anagraficaDinamica.matricola = frameMatricola;
      }
      debugLog(`[Segrepass] Matricola ESIS: ${anagraficaDinamica.matricola ? maskId(anagraficaDinamica.matricola) : 'n/d'}`);
    }

    let pianoHeader = {};
    let tabellaEsami = { headers: [], records: [], rowCount: 0 };
    let esamiList = [];
    let cfuAcquisiti = 0;
    let sommaPonderata = 0;
    let cfuConVoto = 0;
    let pinInfo = { pin: null, codiceNumericoPersonale: null };
    let pianoCourses = [];

    if (phase !== 'slow') {
      console.log('[Segrepass] Inizio estrazione veloce in parallelo (Piano, Esami, PIN)...');

      const [headerRes, esamiRes, pinRes] = await Promise.all([
        scrapePianoPage(page, esisUrl).catch(() => ({ header: {}, table: null })),
        scrapeEsamiSostenuti(context, esisUrl).catch(() => ({ headers: [], records: [], rowCount: 0 })),
        scrapePin(context, esisUrl)
      ]);

      pianoHeader = headerRes.header || {};
      pianoCourses = normalizePianoTable(headerRes.table);
      tabellaEsami = esamiRes;
      pinInfo = pinRes;

      debugLog('\n--- [DEBUG] TABELLA ESAMI GREZZA ---');
      debugLog(() => JSON.stringify(redactForDebug(tabellaEsami), null, 2));
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

      debugLog('\n--- [DEBUG] TASSE ESTRATTE (oscurate) ---');
      debugLog(() => JSON.stringify(redactForDebug({ tasse: taxes }), null, 2));
      debugLog('------------------------------\n');

      debugLog('\n--- [DEBUG] APPELLI ESTRATTI ---');
      debugLog(() => JSON.stringify(redactForDebug(appelliCalendario), null, 2));
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
      pianoDiStudiRaw: pianoCourses
    };

    debugLog('\n=============================================');
    debugLog('[Segrepass] PAYLOAD FINALE (dati personali oscurati):');
    debugLog(() => JSON.stringify(redactForDebug(payloadFinale), null, 2));
    debugLog('=============================================\n');

    return payloadFinale;
  });
}

module.exports = { getDatiCarriera, classifyLoginPage, scrapePin, redactForDebug };
