import type { TimetableEvent } from '@/lib/api';

export const TIMETABLE_TIME_ZONE = 'Europe/Rome';

export type TimetableClock = {
  dateKey: string;
  minutes: number;
};

export type TimetableEventState = 'past' | 'active' | 'upcoming' | 'unknown';

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find(item => item.type === type)?.value || '';
}

/** Returns the current calendar date and minutes in the timetable timezone. */
export function getTimetableClock(now: Date = new Date()): TimetableClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMETABLE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const year = part(parts, 'year');
  const month = part(parts, 'month');
  const day = part(parts, 'day');
  const hour = Number(part(parts, 'hour'));
  const minute = Number(part(parts, 'minute'));

  return {
    dateKey: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute
  };
}

/** Parses HH:mm values without relying on lexicographic string ordering. */
export function parseTimetableTime(value?: string | null): number | null {
  const match = String(value || '').trim().match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function getTimetableEventState(
  event: Pick<TimetableEvent, 'date' | 'startTime' | 'endTime'>,
  now: Date = new Date()
): TimetableEventState {
  const clock = getTimetableClock(now);
  const date = String(event.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'unknown';
  if (date < clock.dateKey) return 'past';
  if (date > clock.dateKey) return 'upcoming';

  const start = parseTimetableTime(event.startTime);
  const end = parseTimetableTime(event.endTime);
  if (start === null) return 'unknown';
  if (clock.minutes < start) return 'upcoming';
  // When EasyAcademy omits the end time, keep a started lesson visible as
  // active instead of dropping the only lesson scheduled for today.
  if (end === null) return 'active';
  return clock.minutes < end ? 'active' : 'past';
}

export function timetableEventSortKey(event: Pick<TimetableEvent, 'date' | 'startTime'>) {
  const start = parseTimetableTime(event.startTime);
  return `${event.date || '9999-99-99'} ${String(start ?? 9999).padStart(4, '0')}`;
}
