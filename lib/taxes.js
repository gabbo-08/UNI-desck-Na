function parseAmount(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const text = String(raw ?? '').replace(/[€\s]/g, '');
  if (!text) return 0;

  let normalized = text;
  if (text.includes(',') && text.includes('.')) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes(',')) {
    normalized = text.replace(',', '.');
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

function parseDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const italian = text.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (italian) {
    return `${italian[3]}-${italian[2].padStart(2, '0')}-${italian[1].padStart(2, '0')}`;
  }
  return null;
}

function roundAmount(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function sumAmounts(items) {
  return roundAmount(items.reduce((total, item) => total + (Number(item?.importo) || 0), 0));
}

function dedupePayments(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = [
      item.codice,
      item.dataPagamento || item.scadenzaISO || item.scadenza,
      item.descrizione,
      item.importo,
      item.stato
    ].map(value => String(value ?? '').trim().toLowerCase()).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findPaymentTables(tables) {
  const result = {
    paid: [],
    pending: [],
    summary: {
      totalPaid: 0,
      totalPending: 0,
      nextDeadline: null
    }
  };

  if (!Array.isArray(tables)) return result;

  tables.forEach(table => {
    const headers = (table.headers || []).map(header => String(header).toLowerCase());
    const records = table.records || [];
    const source = String(table.source || '').toLowerCase();

    const hasDueDate = headers.some(header => header.includes('data scadenza'));
    const hasDescription = headers.some(header =>
      header.includes('descrizione') || header.includes('causale')
    );
    const hasAmount = headers.some(header => header.includes('importo'));
    const isPagatiTable = source === 'versamenti' || headers.some(header =>
      header.includes('data versamento') ||
      header.includes('data pagamento') ||
      header.includes('ricevuta') ||
      header.includes('quietanza') ||
      (header === 'data' && !hasDueDate)
    ) || (headers.includes('origine') && !hasDueDate);
    const isPaymentTable = hasDescription && hasAmount && (
      hasDueDate || isPagatiTable || headers.some(header =>
        header.includes('codice versamento') || header.includes('paga')
      )
    );
    const isDebitoTable = source === 'debiti' || (isPaymentTable && !isPagatiTable);
    if (!isPaymentTable) return;

    records.forEach(record => {
      const keys = Object.keys(record);
      const getVal = term => {
        const key = keys.find(candidate => candidate.toLowerCase().includes(term));
        return key ? record[key] : '';
      };

      const rawImporto = getVal('importo') || '0';
      const descrizione = getVal('descrizione') || getVal('causale');
      const anno = getVal('anno') || '';
      const numImporto = parseAmount(rawImporto);
      const scadenzaRaw = getVal('scadenza');
      const pagamentoRaw = getVal('data pagamento') || getVal('data versamento') || getVal('quietanza') ||
        (!hasDueDate && isPagatiTable ? getVal('data') : '');

      if (numImporto > 0 && descrizione) {
        const item = {
          codice: getVal('codice') || '7001',
          descrizione: anno ? `${descrizione} (${anno})` : descrizione,
          annoAccademico: anno,
          importo: numImporto,
          importoFormatted: rawImporto.includes('€') ? rawImporto : `€${numImporto.toFixed(2).replace('.', ',')}`,
          scadenza: scadenzaRaw || 'In sospeso',
          scadenzaISO: parseDate(scadenzaRaw),
          dataPagamento: pagamentoRaw || null,
          paidAt: pagamentoRaw || null,
          stato: isDebitoTable && !isPagatiTable ? 'DA_PAGARE' : 'PAGATO'
        };

        if (isPagatiTable) {
          result.paid.push(item);
        } else if (isDebitoTable) {
          result.pending.push(item);
        }
      }
    });
  });

  result.paid = dedupePayments(result.paid);
  result.pending = dedupePayments(result.pending);
  result.summary.totalPaid = sumAmounts(result.paid);
  result.summary.totalPending = sumAmounts(result.pending);
  result.summary.nextDeadline = result.pending
    .map(item => item.scadenzaISO)
    .filter(Boolean)
    .sort()[0] || null;

  return result;
}

/**
 * Normalizza lo snapshot tasse nel formato atteso dalle rotte e dal frontend.
 * Accetta sia { paid, pending } sia { pagati, inDebito }.
 */
function buildTaxesSummary(taxes = {}) {
  const paid = dedupePayments(Array.isArray(taxes.paid) ? taxes.paid : (Array.isArray(taxes.pagati) ? taxes.pagati : []));
  const pending = dedupePayments(Array.isArray(taxes.pending) ? taxes.pending : (Array.isArray(taxes.inDebito) ? taxes.inDebito : []));
  const sourceSummary = taxes.summary || {};

  return {
    paid,
    pending,
    summary: {
      totalPaid: roundAmount(sourceSummary.totalPaid ?? sumAmounts(paid)),
      totalPending: roundAmount(sourceSummary.totalPending ?? sumAmounts(pending)),
      nextDeadline: sourceSummary.nextDeadline ?? null
    }
  };
}

module.exports = { findPaymentTables, buildTaxesSummary, parseAmount, parseDate, dedupePayments };
