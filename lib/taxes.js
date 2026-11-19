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
  const italian = text.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (!iso && !italian) return null;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(italian[3]), Number(italian[2]), Number(italian[1])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

function normalizeTaxItem(item = {}) {
  const dueDate = item.dueDate || item.scadenzaISO || parseDate(item.scadenza) || null;
  const description = item.description || item.descrizione || item.causale || '';
  const rawAmount = item.amount ?? item.importo;
  const normalizedAmount = typeof rawAmount === 'string' ? parseAmount(rawAmount) : (Number.isFinite(Number(rawAmount)) ? Number(rawAmount) : 0);
  return {
    ...item,
    descrizione: item.descrizione || description,
    description: item.description || description,
    importo: normalizedAmount,
    amount: normalizedAmount,
    scadenzaISO: item.scadenzaISO || dueDate,
    dueDate,
    status: item.status || item.stato || null,
    academicYear: item.academicYear || item.annoAccademico || null,
    paymentCode: item.paymentCode || item.iuv || null
  };
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

    const hasDueDate = headers.some(header =>
      header.includes('scadenza') || /data\s+(?:di\s+)?scad/.test(header)
    );
    const hasDescription = headers.some(header =>
      header.includes('descrizione') || header.includes('causale')
    );
    const hasAmount = headers.some(header => header.includes('importo'));
    const isPagatiTable = source === 'versamenti' || (source !== 'debiti' && (headers.some(header =>
      header.includes('data versamento') ||
      header.includes('data pagamento') ||
      header.includes('ricevuta') ||
      header.includes('quietanza') ||
      (header === 'data' && !hasDueDate)
    ) || (headers.includes('origine') && !hasDueDate)));
    const isPaymentTable = hasDescription && hasAmount && (
      source === 'debiti' || hasDueDate || isPagatiTable || headers.some(header =>
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
      const scadenzaRaw = getVal('scadenza') || getVal('data scad') || getVal('data di scad') ||
        (source === 'debiti' ? getVal('data') : '');
      const pagamentoRaw = getVal('data pagamento') || getVal('data versamento') || getVal('quietanza') ||
        (!hasDueDate && isPagatiTable ? getVal('data') : '');

      if (numImporto > 0 && descrizione) {
        const item = normalizeTaxItem({
          codice: getVal('codice') || undefined,
          descrizione: anno ? `${descrizione} (${anno})` : descrizione,
          annoAccademico: anno,
          importo: numImporto,
          importoFormatted: rawImporto.includes('€') ? rawImporto : `€${numImporto.toFixed(2).replace('.', ',')}`,
          scadenza: scadenzaRaw || 'In sospeso',
          scadenzaISO: parseDate(scadenzaRaw),
          dataPagamento: pagamentoRaw || null,
          paidAt: pagamentoRaw || null,
          stato: isDebitoTable && !isPagatiTable ? 'DA_PAGARE' : 'PAGATO'
        });

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
  if (!taxes || typeof taxes !== 'object' || Array.isArray(taxes)) taxes = {};
  const paid = dedupePayments((Array.isArray(taxes.paid) ? taxes.paid : (Array.isArray(taxes.pagati) ? taxes.pagati : [])).map(normalizeTaxItem));
  const pending = dedupePayments((Array.isArray(taxes.pending) ? taxes.pending : (Array.isArray(taxes.inDebito) ? taxes.inDebito : [])).map(normalizeTaxItem));
  const sourceSummary = taxes.summary || {};
  const nextDeadline = sourceSummary.nextDeadline || pending
    .map(item => item.dueDate || item.scadenzaISO || parseDate(item.scadenza))
    .filter(Boolean)
    .sort()[0] || null;

  return {
    ...(typeof taxes.available === 'boolean' ? { available: taxes.available } : {}),
    ...(typeof taxes.reason === 'string' ? { reason: taxes.reason } : {}),
    ...(typeof taxes.stale === 'boolean' ? { stale: taxes.stale } : {}),
    paid,
    pending,
    summary: {
      totalPaid: roundAmount(sourceSummary.totalPaid ?? sumAmounts(paid)),
      totalPending: roundAmount(sourceSummary.totalPending ?? sumAmounts(pending)),
      nextDeadline
    }
  };
}

module.exports = { findPaymentTables, buildTaxesSummary, parseAmount, parseDate, dedupePayments, normalizeTaxItem };
