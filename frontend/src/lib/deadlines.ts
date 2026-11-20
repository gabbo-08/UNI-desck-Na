import type { Prenotazione, TassaItem, TassaSnapshot } from './api';

export const DEADLINE_TIME_ZONE = 'Europe/Rome';
export type DeadlineKind = 'exam' | 'booking' | 'tax';
export type DeadlineStatus = 'overdue' | 'today' | 'tomorrow' | 'upcoming';
export type Deadline = {
  id: string;
  kind: DeadlineKind;
  title: string;
  date: Date;
  dateKey: string;
  dateLabel: string;
  timeLabel: string | null;
  daysDifference: number;
  status: DeadlineStatus;
  expired: boolean;
  source: string;
  eventLabel: string;
  detail?: string;
};
export type DeadlineCollection = {
  items: Deadline[];
  todayKey: string;
  todayLabel: string;
  invalidDateCount: number;
};
export type ParsedDeadlineDate = {
  date: Date;
  dateKey: string;
  timeLabel: string | null;
  hasTime: boolean;
  expiresAt: number;
};

const calendarFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEADLINE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: DEADLINE_TIME_ZONE, day: '2-digit', month: 'long', year: 'numeric',
});
const todayFormatter = new Intl.DateTimeFormat('it-IT', {
  timeZone: DEADLINE_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const currencyFormatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const normalize = (value: unknown) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = (value: number) => String(value).padStart(2, '0');

function romeParts(date: Date) {
  const values = Object.fromEntries(calendarFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) };
}

export function getRomeDateKey(date: Date): string {
  const parts = romeParts(date);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatRomeToday(date: Date): string {
  return todayFormatter.format(date);
}

function validCalendarDate(year: number, month: number, day: number) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Resolve a wall-clock time in Rome, without using the browser's timezone. */
function romeInstant(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number | null {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = romeParts(new Date(instant));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const adjusted = instant + wall - represented;
    if (instant === adjusted) break;
    instant = adjusted;
  }
  const matches = (candidate: number) => {
    const parts = romeParts(new Date(candidate));
    return parts.year === year && parts.month === month && parts.day === day &&
      parts.hour === hour && parts.minute === minute && parts.second === second;
  };
  // During autumn's repeated hour use the earlier possible cutoff, so an
  // ambiguous portal date never promises a later booking opportunity.
  const candidates = [instant - 3_600_000, instant, instant + 3_600_000].filter(matches);
  return candidates.length ? Math.min(...candidates) : null;
}

function parseClock(value: string) {
  const match = value.match(/^(?:(?:ore|alle)\s+)?(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/i);
  if (!match) return null;
  const [hour, minute, second] = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  return hour < 24 && minute < 60 && second < 60 ? { hour, minute, second } : null;
}

function finishDate(instant: number, hasTime: boolean): ParsedDeadlineDate | null {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = romeParts(date);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const expiresAt = hasTime ? instant : romeInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  if (expiresAt === null) return null;
  return { date, dateKey: getRomeDateKey(date), hasTime, timeLabel: hasTime ? `${pad(parts.hour)}:${pad(parts.minute)}` : null, expiresAt };
}

/** Date-only deadlines last all day; explicit times/offsets retain their cutoff. */
export function parseDeadlineDate(value: unknown, extraTime?: unknown): ParsedDeadlineDate | null {
  const raw = typeof value === 'number' ? String(value) : clean(value);
  if (!raw) return null;
  let result: ParsedDeadlineDate | null = null;
  if (/^\d{12,14}$/.test(raw)) {
    result = finishDate(Number(raw), true);
  } else {
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
    const italian = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})(.*)$/);
    if (!iso && !italian) return null;
    const [year, month, day] = iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [Number(italian![3]), Number(italian![2]), Number(italian![1])];
    if (!validCalendarDate(year, month, day)) return null;
    const suffix = (iso ? iso[4] : italian![4]).trim();
    if (!suffix) {
      const instant = romeInstant(year, month, day);
      if (instant !== null) result = finishDate(instant, false);
    } else {
      const timed = suffix.match(/^(?:T|\s)*(?:(?:ore|alle)\s+)?(\d{1,2})[:.](\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/i);
      if (!timed) return null;
      const [hour, minute, second] = [Number(timed[1]), Number(timed[2]), Number(timed[3] || 0)];
      if (hour > 23 || minute > 59 || second > 59) return null;
      const milliseconds = Number((timed[4] || '').padEnd(3, '0'));
      const offset = timed[5];
      let instant: number | null;
      if (offset) {
        const match = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
        if (match && (Number(match[2]) > 23 || Number(match[3]) > 59)) return null;
        const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0;
        instant = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) - offsetMinutes * 60_000;
      } else {
        instant = romeInstant(year, month, day, hour, minute, second);
        if (instant !== null) instant += milliseconds;
      }
      if (instant !== null) result = finishDate(instant, true);
    }
  }
  const clockText = clean(extraTime);
  // A timestamp already states its own instant. Separate portal clock labels
  // only refine date-only values and must not erase a valid known date.
  if (!result || result.hasTime || !clockText) return result;
  const clock = parseClock(clockText);
  if (!clock) return result;
  const parts = romeParts(result.date);
  const instant = romeInstant(parts.year, parts.month, parts.day, clock.hour, clock.minute, clock.second);
  return instant === null ? result : finishDate(instant, true);
}

function firstDate(values: unknown[], extraTime?: unknown) {
  for (const value of values) {
    const parsed = parseDeadlineDate(value, extraTime);
    if (parsed) return parsed;
  }
  return null;
}

function calendarDifference(dateKey: string, todayKey: string) {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000);
}

function amountOf(tax: TassaItem): number | undefined {
  const value: unknown = tax.amount ?? tax.importo;
  if (value === null || value === undefined || value === '') return undefined;
  const text = String(value).replace(/[\s€]/g, '');
  const amount = typeof value === 'number' ? value : Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(amount) ? amount : undefined;
}

function strongPaymentKeys(tax: TassaItem) {
  return [tax.iuv, tax.paymentCode].map(normalize).filter(Boolean);
}

function isPaid(tax: TassaItem, paidKeys: Set<string>) {
  const states = [tax.status, tax.stato].map(value => normalize(value).replace(/[_-]+/g, ' '));
  return states.some(state => /^(?:pagat[oa]|paid|saldat[oa]|completat[oa]|versat[oa])$/.test(state)) ||
    Boolean(firstDate([tax.paidAt, tax.dataPagamento])) || strongPaymentKeys(tax).some(key => paidKeys.has(key));
}

const isBooked = (exam: Prenotazione) => exam.prenotato === true || String(exam.id || '').startsWith('docenti-');

function bookedEventKey(exam: Prenotazione, examDate: ParsedDeadlineDate | null) {
  const title = normalize(exam.materia);
  const professor = normalize(exam.docente);
  // Unknown titles/teachers cannot safely identify the same booking across portals.
  if (!examDate || !title || !professor || /^(?:appello|esame)$/.test(title) || /^(?:docente )?non specificato$/.test(professor)) return null;
  return `${title}|${professor}|${examDate.dateKey}`;
}

export function buildDeadlines(exams: Prenotazione[] = [], taxes?: TassaSnapshot | null, now = new Date(), horizonDays = 90): DeadlineCollection {
  const todayKey = getRomeDateKey(now);
  const horizon = Number.isFinite(horizonDays) && horizonDays >= 0 ? Math.floor(horizonDays) : 90;
  const items: Deadline[] = [];
  const seen = new Set<string>();
  const invalid = new Set<string>();
  const add = (kind: DeadlineKind, title: string, parsed: ParsedDeadlineDate, identity: string, detail?: string) => {
    const daysDifference = calendarDifference(parsed.dateKey, todayKey);
    const expired = now.getTime() >= parsed.expiresAt;
    if (daysDifference > horizon || (kind === 'exam' && expired)) return;
    const id = `${kind}:${identity}`;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({
      id, kind, title, date: parsed.date, dateKey: parsed.dateKey, dateLabel: dateFormatter.format(parsed.date), timeLabel: parsed.timeLabel,
      daysDifference, expired, status: expired ? 'overdue' : daysDifference === 0 ? 'today' : daysDifference === 1 ? 'tomorrow' : 'upcoming',
      source: kind === 'tax' ? 'Tasse' : kind === 'exam' ? 'Appelli' : 'Prenotazioni',
      eventLabel: kind === 'tax' ? 'Scadenza pagamento' : kind === 'booking' ? 'Chiusura prenotazioni' : 'Data esame',
      ...(detail ? { detail } : {}),
    });
  };

  const examRows = (Array.isArray(exams) ? exams : []).flatMap((exam, index) =>
    exam && typeof exam === 'object' ? [{ exam, index, examDate: firstDate([exam.dataAppello], exam.ora) }] : []);
  const bookedEvents = new Set(examRows.filter(({ exam }) => isBooked(exam))
    .map(({ exam, examDate }) => bookedEventKey(exam, examDate)).filter((key): key is string => key !== null));
  for (const { exam, index, examDate } of examRows) {
    const title = clean(exam.materia) || 'Appello';
    const courseIdentity = `${normalize(title)}|${normalize(exam.docente)}`;
    if (examDate) {
      add('exam', title, examDate, `${courseIdentity}|${examDate.expiresAt}`, clean(exam.aula) || undefined);
    } else {
      invalid.add(`exam:${courseIdentity || exam.id || index}`);
    }
    const bookingDate = firstDate([exam.finePrenotazione]);
    // Docenti booked records do not need a warning about booking closure.
    const matchingBookedEvent = bookedEventKey(exam, examDate);
    const alreadyBooked = isBooked(exam) || Boolean(matchingBookedEvent && bookedEvents.has(matchingBookedEvent));
    const examPassed = Boolean(examDate && now.getTime() >= examDate.expiresAt);
    const relevantBooking = Boolean(bookingDate && (now.getTime() < bookingDate.expiresAt || (examDate && !examPassed)));
    if (bookingDate && !alreadyBooked && !examPassed && relevantBooking) {
      add('booking', `Prenotazione · ${title}`, bookingDate, `${courseIdentity}|${bookingDate.expiresAt}`);
    } else if (clean(exam.finePrenotazione) && !bookingDate) {
      invalid.add(`booking:${courseIdentity || exam.id || index}`);
    }
  }

  const paid = [...(Array.isArray(taxes?.paid) ? taxes.paid : []), ...(Array.isArray(taxes?.pagati) ? taxes.pagati : [])];
  const paidKeys = new Set(paid.filter(Boolean).flatMap(strongPaymentKeys));
  const pending = [...(Array.isArray(taxes?.pending) ? taxes.pending : []), ...(Array.isArray(taxes?.inDebito) ? taxes.inDebito : [])];
  // Process rows with identifiers first, so an alias missing its IUV can be
  // collapsed without merging two separate, explicitly identified payments.
  pending.sort((left, right) => strongPaymentKeys(right || {}).length - strongPaymentKeys(left || {}).length);
  const seenPayments = new Set<string>();
  const seenPaymentDetails = new Set<string>();
  for (const [index, tax] of pending.entries()) {
    if (!tax || typeof tax !== 'object' || isPaid(tax, paidKeys)) continue;
    const title = clean(tax.description) || clean(tax.causale) || clean(tax.descrizione) || 'Scadenza pagamento';
    const parsed = firstDate([tax.dueDate, tax.scadenzaISO, tax.scadenza]);
    const amount = amountOf(tax);
    const keys = strongPaymentKeys(tax);
    const paymentDetails = `${normalize(tax.codice)}|${normalize(tax.academicYear)}|${normalize(title)}|${amount ?? ''}|${parsed?.dateKey || ''}`;
    const identity = keys[0] || paymentDetails;
    if (parsed) {
      if (keys.some(key => seenPayments.has(key)) || (!keys.length && seenPaymentDetails.has(paymentDetails))) continue;
      keys.forEach(key => seenPayments.add(key));
      seenPaymentDetails.add(paymentDetails);
      add('tax', title, parsed, identity, amount !== undefined ? currencyFormatter.format(amount) : undefined);
    }
    else invalid.add(`tax:${identity || index}`);
  }
  // An aggregate is only a fallback when no detailed pending list exists.
  // A stale summary must never re-create an already paid/cleared obligation.
  if (!Array.isArray(taxes?.pending) && !Array.isArray(taxes?.inDebito) && taxes?.summary?.totalPending !== 0) {
    const summary = firstDate([taxes?.summary?.nextDeadline]);
    if (summary) add('tax', 'Prossima scadenza tasse', summary, `summary:${summary.dateKey}`);
    else if (clean(taxes?.summary?.nextDeadline)) invalid.add('tax:summary');
  }
  items.sort((left, right) => left.dateKey.localeCompare(right.dateKey) ||
    (left.timeLabel || '23:59').localeCompare(right.timeLabel || '23:59') || left.title.localeCompare(right.title, 'it'));
  return { items, todayKey, todayLabel: formatRomeToday(now), invalidDateCount: invalid.size };
}
