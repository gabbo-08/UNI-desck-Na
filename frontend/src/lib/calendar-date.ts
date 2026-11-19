/** Parses a portal calendar date without silently rolling invalid dates forward. */
export function parseCalendarDate(value?: string | null): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{12,14}$/.test(raw)) {
    const date = new Date(Number(raw));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  const italian = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})(?:$|\s)/);
  if (iso || italian) {
    const [year, month, day] = iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [Number(italian![3]), Number(italian![2]), Number(italian![1])];
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }
  // Reject malformed numeric calendar dates rather than falling back to the
  // browser's ambiguous MM/DD parser.
  if (/^\d+[/. -]\d+[/. -]\d+/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function calendarDayDifference(date: Date, from: Date): number {
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
    Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000);
}
