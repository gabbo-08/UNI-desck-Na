import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const filename = fileURLToPath(new URL('../src/lib/deadlines.ts', import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports }, { filename });
const { buildDeadlines, parseDeadlineDate, getRomeDateKey } = compiledModule.exports;
const NOW = new Date('2026-11-20T12:00:00.000Z'); // 13:00 in Italy.
const exam = extra => ({ materia: 'Chimica', dataAppello: '2026-11-21', ...extra });
const tax = extra => ({ description: 'Rata', dueDate: '2026-11-20', amount: 130, ...extra });
const snapshot = pending => ({ paid: [], pending });

test('dates are compared with the Rome calendar even when the browser timezone differs', t => {
  const previousTimezone = process.env.TZ;
  t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
  for (const timezone of ['America/Los_Angeles', 'Asia/Tokyo', 'Europe/Rome']) {
    process.env.TZ = timezone;
    const now = new Date('2026-11-19T23:30:00Z');
    const result = buildDeadlines([], snapshot([tax({ dueDate: '2026-11-20' })]), now);
    assert.equal(result.todayKey, '2026-11-20');
    assert.equal(result.items[0].daysDifference, 0);
    assert.equal(result.items[0].status, 'today');
    assert.match(result.todayLabel, /20 novembre 2026/);
  }
});

test('date-only deadlines expire at the next Rome midnight, without disappearing during the due day', () => {
  const parsed = parseDeadlineDate('20/11/2026');
  assert.equal(parsed.expiresAt, Date.parse('2026-11-20T23:00:00Z'));
  assert.equal(buildDeadlines([], snapshot([tax()]), new Date('2026-11-20T22:59:59Z')).items[0].expired, false);
  assert.equal(buildDeadlines([], snapshot([tax()]), new Date('2026-11-20T23:00:00Z')).items[0].expired, true);
});

test('ISO offsets preserve the actual Rome date and time instead of truncating the timestamp', () => {
  const parsed = parseDeadlineDate('2026-11-20T23:30:00.125Z');
  assert.equal(parsed.dateKey, '2026-11-21');
  assert.equal(parsed.timeLabel, '00:30');
  assert.equal(parsed.expiresAt, Date.parse('2026-11-20T23:30:00.125Z'));
  const offset = parseDeadlineDate('2026-11-20T23:30:00-02:00');
  assert.equal(offset.dateKey, '2026-11-21');
  assert.equal(offset.timeLabel, '02:30');
});

test('separate exam clock labels refine date-only values without replacing explicit timestamps or hiding known dates', () => {
  const timestamp = parseDeadlineDate('2026-11-20T23:30:00Z', '08:00');
  assert.equal(timestamp.expiresAt, Date.parse('2026-11-20T23:30:00Z'));
  assert.equal(timestamp.timeLabel, '00:30');
  const unknownHour = parseDeadlineDate('21/11/2026', 'Da definire');
  assert.equal(unknownHour.dateKey, '2026-11-21');
  assert.equal(unknownHour.timeLabel, null);
  assert.equal(unknownHour.hasTime, false);
  assert.equal(parseDeadlineDate('29/03/2026', '02:30').hasTime, false);
  const result = buildDeadlines([exam({ ora: 'Non disponibile' })], null, NOW);
  assert.equal(result.items[0].dateKey, '2026-11-21');
  assert.equal(result.invalidDateCount, 0);
});

test('impossible dates and times are rejected rather than rolled forward', () => {
  for (const value of ['31/11/2026', '2026-02-30', '2026-13-01', '00/12/2026', '20/11/2026 24:00', '2026-11-20T12:61:00Z', '2026-11-20T12:00:00+25:00']) {
    assert.equal(parseDeadlineDate(value), null, value);
  }
  assert.equal(parseDeadlineDate('29/02/2028').dateKey, '2028-02-29');
});

test('Rome day differences remain correct across both daylight-saving transitions', () => {
  for (const [now, due] of [
    ['2026-03-28T11:00:00Z', '30/03/2026'],
    ['2026-10-24T10:00:00Z', '26/10/2026'],
  ]) {
    const result = buildDeadlines([], snapshot([tax({ dueDate: due })]), new Date(now));
    assert.equal(result.items[0].daysDifference, 2);
  }
  assert.equal(parseDeadlineDate('29/03/2026 02:30'), null);
  assert.equal(parseDeadlineDate('25/10/2026 02:30').expiresAt, Date.parse('2026-10-25T00:30:00Z'));
});

test('booking closing times are precise, including already-closed deadlines today', () => {
  const result = buildDeadlines([exam({ finePrenotazione: '20/11/2026 alle 12:30' })], null, NOW);
  const booking = result.items.find(item => item.kind === 'booking');
  assert.equal(booking.daysDifference, 0);
  assert.equal(booking.timeLabel, '12:30');
  assert.equal(booking.status, 'overdue');
  assert.equal(booking.expired, true);
});

test('explicit exam hours use Rome time and already-finished exams do not become overdue alarms', () => {
  const result = buildDeadlines([
    exam({ materia: 'Trascorso', dataAppello: '20/11/2026', ora: '12:00', finePrenotazione: '19/11/2026' }),
    exam({ materia: 'Oggi pomeriggio', dataAppello: '20/11/2026', ora: '18:00' }),
    exam({ materia: 'Storico', dataAppello: '19/11/2026' }),
  ], null, NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Oggi pomeriggio');
  assert.equal(result.items[0].timeLabel, '18:00');
  assert.equal(result.items[0].status, 'today');
});

test('unpaid overdue taxes remain visible beyond the future horizon', () => {
  const result = buildDeadlines([], snapshot([tax({ dueDate: '2025-11-20' })]), NOW, 7);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'overdue');
  assert.equal(result.items[0].daysDifference, -365);
});

test('paid rows and matching IUV/payment identifiers are excluded from outstanding taxes', () => {
  const result = buildDeadlines([], {
    paid: [{ iuv: 'paid-iuv' }, { paymentCode: 'payment-2' }],
    pending: [
      tax({ status: 'pending', stato: 'PAGATO' }), tax({ paidAt: '19/11/2026' }),
      tax({ iuv: 'paid-iuv' }), tax({ paymentCode: 'payment-2' }),
      tax({ description: 'Non pagata', stato: 'NON_PAGATO' }),
    ],
    summary: { nextDeadline: '2026-11-20' },
  }, NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Non pagata');
});

test('a tax category code shared with historical paid records does not clear a new installment', () => {
  const result = buildDeadlines([], {
    paid: [tax({ codice: '7001', academicYear: '2025/2026', paidAt: '10/10/2025' })],
    pending: [tax({ codice: '7001', academicYear: '2026/2027' })],
  }, NOW);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, 'tax');
});

test('identical events and alias arrays are deduplicated without merging separate payments', () => {
  const first = tax({ codice: '7001' });
  const second = tax({ codice: '7001', description: 'Rata successiva', dueDate: '2026-11-21' });
  const result = buildDeadlines([exam(), exam()], { pending: [first, second], inDebito: [first, second] }, NOW);
  assert.equal(result.items.filter(item => item.kind === 'exam').length, 1);
  assert.equal(result.items.filter(item => item.kind === 'tax').length, 2);
  assert.equal(new Set(result.items.map(item => item.id)).size, 3);
});

test('tax aliases missing an IUV collapse, while separate IUVs remain separate payments', () => {
  const alias = tax({ codice: '7001' });
  const result = buildDeadlines([], {
    pending: [alias],
    inDebito: [{ ...alias, iuv: 'payment-1' }, { ...alias, iuv: 'payment-2' }],
  }, NOW);
  assert.equal(result.items.length, 2);
  assert.equal(new Set(result.items.map(item => item.id)).size, 2);
});

test('the first valid date alias is used, and a zero amount stays visible', () => {
  const result = buildDeadlines([], snapshot([tax({ dueDate: 'invalid', scadenzaISO: '31/11/2026', scadenza: '21/11/2026', amount: 0, importo: 99 })]), NOW);
  assert.equal(result.items[0].dateKey, '2026-11-21');
  assert.equal(result.items[0].daysDifference, 1);
  assert.match(result.items[0].detail, /0,00/);
  assert.equal(result.invalidDateCount, 0);
});

test('decimal amounts are displayed correctly for numeric and locale string representations', () => {
  for (const amount of [130.5, '130.50', '130,50']) {
    assert.match(buildDeadlines([], snapshot([tax({ amount })]), NOW).items[0].detail, /130,50/);
  }
});

test('summary dates are only a fallback, and cleared detailed lists stay cleared', () => {
  assert.equal(buildDeadlines([], { summary: { nextDeadline: '2026-11-21', totalPending: 100 } }, NOW).items.length, 1);
  assert.equal(buildDeadlines([], { pending: [], summary: { nextDeadline: '2026-11-21', totalPending: 100 } }, NOW).items.length, 0);
  assert.equal(buildDeadlines([], { summary: { nextDeadline: '2026-11-21', totalPending: 0 } }, NOW).items.length, 0);
  assert.equal(buildDeadlines([], { pending: [tax()], summary: { nextDeadline: '2026-11-21' } }, NOW).items.length, 1);
});

test('missing dates are reported once, while expired booking dates without a future exam are omitted', () => {
  const invalid = tax({ dueDate: 'data da definire' });
  const result = buildDeadlines([exam({ dataAppello: '', finePrenotazione: '19/11/2026' })], { pending: [invalid], inDebito: [invalid] }, NOW);
  assert.equal(result.items.length, 0);
  assert.equal(result.invalidDateCount, 2);
});

test('future horizon includes the whole final calendar day and booked Docenti rows do not warn about closure', () => {
  const result = buildDeadlines([
    exam({ id: 'docenti-booked', finePrenotazione: '19/11/2026' }),
    exam({ id: 'segrepass-booked', materia: 'Analisi', prenotato: true, finePrenotazione: '20/11/2026' }),
  ], snapshot([tax({ dueDate: '2027-02-18' }), tax({ dueDate: '2027-02-19' })]), NOW);
  assert.equal(result.items.filter(item => item.kind === 'booking').length, 0);
  assert.equal(result.items.filter(item => item.kind === 'tax').length, 1);
  assert.equal(getRomeDateKey(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
});

test('a booked exam also clears its matching portal closure across date formats, preserving other teachers and days', () => {
  const result = buildDeadlines([
    exam({ id: 'appello-1', docente: 'Professoressa Rossi', dataAppello: '21/11/2026', finePrenotazione: '20/11/2026' }),
    exam({ id: 'docenti-1', materia: ' CHIMICA ', docente: 'professoressa rossi', dataAppello: '2026-11-21' }),
    exam({ id: 'appello-2', docente: 'Professore Bianchi', dataAppello: '21/11/2026', finePrenotazione: '20/11/2026' }),
    exam({ id: 'appello-3', docente: 'Professoressa Rossi', dataAppello: '22/11/2026', finePrenotazione: '21/11/2026' }),
  ], null, NOW);
  const closures = result.items.filter(item => item.kind === 'booking');
  assert.equal(closures.length, 2);
  assert.deepEqual(Array.from(closures, item => item.dateKey), ['2026-11-20', '2026-11-21']);
});

test('unknown teachers do not suppress another portal booking closure by assumption', () => {
  const result = buildDeadlines([
    exam({ id: 'appello-1', docente: 'Non specificato', finePrenotazione: '20/11/2026' }),
    exam({ id: 'docenti-1', docente: 'Non specificato' }),
  ], null, NOW);
  assert.equal(result.items.filter(item => item.kind === 'booking').length, 1);
});
