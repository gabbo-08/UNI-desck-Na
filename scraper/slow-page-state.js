// Classify the actual ESIS content rather than equating a successful HTTP
// navigation with a successfully read financial page.
function classifyFinancialDocument(content, kind) {
  const text = String(content?.text || '').replace(/\s+/g, ' ').trim();
  const headers = Array.isArray(content?.headers) ? content.headers : [];
  const validTable = headers.some(row => {
    const line = row.join(' ').toLowerCase();
    return kind === 'taxes'
      ? /importo/.test(line) && /descrizione|causale/.test(line)
      : /codice/.test(line) && /insegnamento|materia|descrizione|attivit/.test(line);
  });
  const empty = kind === 'taxes'
    ? /(?:nessun[oaie]?|non (?:ci sono|risultano|sono presenti))\s+(?:\w+\s+){0,4}(?:debit|versament|pagament|tass)|(?:debit|versament|pagament|tass)[^.!?]{0,45}(?:non presenti|assenti)/i.test(text)
    : /nessun\s+appello|non\s+(?:ci\s+sono|risultano|sono presenti)\s+appelli|nessuna\s+sessione|nessun\s+dato/i.test(text);
  const expired = Boolean(content?.passwordForm) || /sessione[^.!?]{0,35}scadut|richiesta non valida|autenticazione[^.!?]{0,35}(?:richiesta|necessaria)/i.test(text);
  return { valid: validTable || empty, validTable, empty, expired };
}

async function inspectFinancialPage(page, kind) {
  const frames = typeof page.frames === 'function' ? page.frames() : [page];
  let expired = false;
  for (const frame of frames) {
    try {
      const content = await frame.evaluate(() => ({
        text: document.body?.innerText || document.body?.textContent || '',
        passwordForm: Boolean(document.querySelector('input[type="password"]')),
        headers: Array.from(document.querySelectorAll('table tr')).map(row =>
          Array.from(row.children).filter(cell => /^(TH|TD)$/.test(cell.tagName)).map(cell => cell.innerText || cell.textContent || '')
        )
      }));
      const state = classifyFinancialDocument(content, kind);
      if (state.valid && !state.expired) return { ...state, frame };
      expired ||= state.expired;
    } catch {}
  }
  return { valid: false, expired };
}

async function waitForFinancialPage(page, kind, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await inspectFinancialPage(page, kind);
    if (state.valid) return state;
    if (state.expired) {
      const error = new Error('Sessione ESIS non disponibile.');
      error.code = 'ESIS_SESSION_EXPIRED';
      throw error;
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() <= deadline);
  const error = new Error('La pagina ESIS non contiene i dati attesi.');
  error.code = kind === 'taxes' ? 'TAXES_PAGE_NOT_RECOGNIZED' : 'APPELLI_PAGE_NOT_RECOGNIZED';
  throw error;
}

module.exports = { classifyFinancialDocument, inspectFinancialPage, waitForFinancialPage };
