'use client';

import { useMemo, useState } from 'react';
import { ArrowDownToLine, CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin } from 'lucide-react';
import type { Prenotazione, TassaSnapshot, TimetableEvent } from '@/lib/api';

type AgendaKind = 'lesson' | 'exam' | 'test' | 'deadline' | 'tax';
type AgendaEvent = {
  id: string;
  kind: AgendaKind;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  location?: string;
};

type Props = {
  lessons: TimetableEvent[];
  exams: Prenotazione[];
  taxes?: TassaSnapshot | null;
  timetableLoading?: boolean;
  timetableError?: string;
};

const KIND_LABELS: Record<AgendaKind, string> = {
  lesson: 'Lezione', exam: 'Appello', test: 'Test', deadline: 'Prenotazione', tax: 'Pagamento'
};
const KIND_DOT: Record<AgendaKind, string> = {
  lesson: 'bg-sky-400', exam: 'bg-blue-400', test: 'bg-violet-400', deadline: 'bg-orange-400', tax: 'bg-amber-400'
};
const KIND_CARD: Record<AgendaKind, string> = {
  lesson: 'border-sky-400/30 bg-sky-400/10', exam: 'border-blue-400/30 bg-blue-400/10',
  test: 'border-violet-400/30 bg-violet-400/10', deadline: 'border-orange-400/30 bg-orange-400/10',
  tax: 'border-amber-400/30 bg-amber-400/10'
};
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const source = String(value).trim();
  if (/^\d{12,14}$/.test(source)) {
    const timestamp = new Date(Number(source));
    return Number.isNaN(timestamp.getTime()) ? null : validDate(timestamp.getFullYear(), timestamp.getMonth() + 1, timestamp.getDate());
  }
  const iso = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const italian = source.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})/);
  if (italian) return validDate(Number(italian[3]), Number(italian[2]), Number(italian[1]));
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : validDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

function validDate(year: number, month: number, day: number): Date | null {
  const result = new Date(year, month - 1, day);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result : null;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toEventDate(value?: string | null) {
  const parsed = parseDate(value);
  return parsed ? dateKey(parsed) : null;
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsDate(date: string) {
  return date.replace(/-/g, '');
}

function icsTimestamp(date: string, time: string) {
  const [hour, minute] = time.split(':');
  return `${icsDate(date)}T${hour}${minute}00`;
}

function stableUid(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}@unidesk-na`;
}

function buildCalendarFile(events: AgendaEvent[]) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UniDesk NA//Agenda Studente//IT', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Agenda UniDesk NA', 'X-WR-TIMEZONE:Europe/Rome',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Rome', 'X-LIC-LOCATION:Europe/Rome',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
    'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
    'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE'
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${stableUid(event.id)}`, `DTSTAMP:${stamp}`);
    if (event.startTime && /^\d{2}:\d{2}$/.test(event.startTime)) {
      lines.push(`DTSTART;TZID=Europe/Rome:${icsTimestamp(event.date, event.startTime)}`);
      const endTime = event.endTime && /^\d{2}:\d{2}$/.test(event.endTime) ? event.endTime : null;
      if (endTime) lines.push(`DTEND;TZID=Europe/Rome:${icsTimestamp(event.date, endTime)}`);
      else {
        const [hour, minute] = event.startTime.split(':').map(Number);
        const end = new Date(2000, 0, 1, hour, minute + 60);
        lines.push(`DTEND;TZID=Europe/Rome:${icsTimestamp(event.date, `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`)}`);
      }
    } else {
      const nextDay = new Date(Number(event.date.slice(0, 4)), Number(event.date.slice(5, 7)) - 1, Number(event.date.slice(8, 10)) + 1);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`, `DTEND;VALUE=DATE:${icsDate(dateKey(nextDay))}`);
    }
    lines.push(`SUMMARY:${escapeIcs(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function makeEvents(lessons: TimetableEvent[], exams: Prenotazione[], taxes?: TassaSnapshot | null): AgendaEvent[] {
  const events: AgendaEvent[] = [];
  lessons.forEach((lesson, index) => {
    const date = toEventDate(lesson.date);
    if (!date) return;
    events.push({
      id: `lesson|${date}|${lesson.startTime || ''}|${lesson.courseName || ''}|${index}`,
      kind: 'lesson', title: lesson.courseName || 'Lezione', date,
      startTime: lesson.startTime || undefined, endTime: lesson.endTime || undefined,
      description: lesson.teachers?.length ? `Docente: ${lesson.teachers.join(', ')}` : undefined,
      location: [lesson.room, lesson.campus].filter(Boolean).join(' · ') || undefined
    });
  });

  exams.forEach((exam, index) => {
    const date = toEventDate(exam.dataAppello);
    if (!date) return;
    const isTest = exam.id?.startsWith('docenti-test-');
    const title = exam.materia || (isTest ? 'Test' : 'Appello');
    events.push({
      id: `${isTest ? 'test' : 'exam'}|${date}|${title}|${index}`,
      kind: isTest ? 'test' : 'exam', title: `${isTest ? 'Test' : 'Appello'} · ${title}`, date,
      startTime: exam.ora || undefined,
      description: exam.docente ? `Docente: ${exam.docente}` : exam.note || undefined,
      location: exam.aula || undefined
    });

    const deadline = toEventDate(exam.finePrenotazione);
    if (deadline) {
      const opening = toEventDate(exam.inizioPrenotazione);
      events.push({
        id: `deadline|${deadline}|${title}|${index}`, kind: 'deadline',
        title: `Scadenza prenotazione · ${title}`, date: deadline,
        description: opening ? `Prenotazioni aperte dal ${new Intl.DateTimeFormat('it-IT').format(parseDate(exam.inizioPrenotazione) as Date)}.` : undefined
      });
    }
  });

  const pending = taxes?.pending || taxes?.inDebito || [];
  const datedTaxEvents = new Set<string>();
  pending.forEach((tax, index) => {
    const date = toEventDate(tax.dueDate || tax.scadenzaISO || tax.scadenza);
    if (!date) return;
    datedTaxEvents.add(date);
    events.push({
      id: `tax|${date}|${tax.codice || tax.description || tax.descrizione || index}`,
      kind: 'tax', title: tax.description || tax.causale || tax.descrizione || 'Scadenza pagamento', date,
      description: tax.amount || tax.importo ? `Importo: ${new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(tax.amount ?? tax.importo ?? 0)}` : undefined
    });
  });

  const nextDeadline = toEventDate(taxes?.summary?.nextDeadline);
  if (nextDeadline && !datedTaxEvents.has(nextDeadline)) {
    events.push({ id: `tax|${nextDeadline}|summary`, kind: 'tax', title: 'Prossima scadenza tasse', date: nextDeadline });
  }

  return events.sort((left, right) => `${left.date} ${left.startTime || ''}`.localeCompare(`${right.date} ${right.startTime || ''}`));
}

export default function AgendaView({ lessons, exams, taxes, timetableLoading, timetableError }: Props) {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today));
  const events = useMemo(() => makeEvents(lessons, exams, taxes), [lessons, exams, taxes]);
  const eventsByDate = useMemo(() => {
    const result = new Map<string, AgendaEvent[]>();
    for (const event of events) result.set(event.date, [...(result.get(event.date) || []), event]);
    return result;
  }, [events]);
  const monthDates = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);
  const selectedEvents = eventsByDate.get(selectedDate) || [];
  const monthLabel = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(month);

  const changeMonth = (amount: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(next);
    setSelectedDate(dateKey(next));
  };

  const exportCalendar = () => {
    if (events.length === 0) return;
    const blob = new Blob([buildCalendarFile(events)], { type: 'text/calendar;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'agenda-unidesk-na.ics';
    link.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className="space-y-5 text-slate-100">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Agenda personale</p>
          <h2 className="mt-1 text-2xl font-bold">Calendario universitario</h2>
          <p className="mt-1 text-sm text-slate-400">Lezioni, appelli, prenotazioni e scadenze di pagamento.</p>
        </div>
        <button type="button" onClick={exportCalendar} disabled={events.length === 0}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-sky-300/30 bg-sky-400/10 px-3 text-sm font-medium text-sky-200 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40">
          <ArrowDownToLine className="h-4 w-4" /> Esporta .ics
        </button>
      </header>

      {timetableLoading && <p role="status" className="text-xs text-slate-400">Aggiornamento dell’orario in corso…</p>}
      {timetableError && <p role="status" className="text-xs text-amber-300">Orario lezioni non disponibile: {timetableError}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <section className="rounded-2xl border border-white/10 bg-[#0A1B31]/75 p-4 sm:p-5" aria-label="Calendario mensile">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-sky-300" />
              <h3 className="text-lg font-semibold capitalize">{monthLabel}</h3>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDate(dateKey(now)); }}
                className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">Oggi</button>
              <button type="button" onClick={() => changeMonth(-1)} aria-label="Mese precedente" className="rounded-md p-2 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => changeMonth(1)} aria-label="Mese successivo" className="rounded-md p-2 hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-white/10 pb-2 text-center text-[11px] font-semibold text-slate-500">
            {WEEKDAYS.map(day => <div key={day}>{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {monthDates.map(date => {
              const key = dateKey(date);
              const dayEvents = eventsByDate.get(key) || [];
              const inMonth = date.getMonth() === month.getMonth();
              const isToday = key === dateKey(today);
              const selected = key === selectedDate;
              return (
                <button key={key} type="button" onClick={() => setSelectedDate(key)} aria-pressed={selected}
                  aria-label={`${new Intl.DateTimeFormat('it-IT', { dateStyle: 'full' }).format(date)}, ${dayEvents.length} impegni`}
                  className={`flex min-h-[4.25rem] flex-col items-center gap-1 border-b border-white/5 py-2 text-xs transition sm:min-h-[5rem] ${selected ? 'bg-sky-400/10 ring-1 ring-inset ring-sky-300/40' : 'hover:bg-white/5'} ${inMonth ? 'text-slate-200' : 'text-slate-600'}`}>
                  <span className={`grid h-7 w-7 place-items-center rounded-full ${isToday ? 'bg-sky-400 font-bold text-slate-950' : ''}`}>{date.getDate()}</span>
                  <span className="flex h-2 items-center gap-1">
                    {[...new Set(dayEvents.map(event => event.kind))].slice(0, 4).map(kind => <span key={kind} className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[kind]}`} />)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-slate-400">
            {(Object.keys(KIND_LABELS) as AgendaKind[]).map(kind => (
              <span key={kind} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${KIND_DOT[kind]}`} />{KIND_LABELS[kind]}</span>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0A1B31]/75 p-4 sm:p-5" aria-live="polite">
          <h3 className="mb-4 font-semibold">
            {new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(selectedDate) || today)}
            <span className="ml-2 text-xs font-normal text-slate-500">{selectedEvents.length} impegni</span>
          </h3>
          {selectedEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">Nessun impegno in questa giornata.</div>
          ) : (
            <div className="space-y-2.5">
              {selectedEvents.map(event => (
                <article key={event.id} className={`rounded-xl border p-3 ${KIND_CARD[event.kind]}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[event.kind]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <h4 className="text-sm font-semibold">{event.title}</h4>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{KIND_LABELS[event.kind]}</span>
                      </div>
                      {event.startTime && <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-300"><Clock3 className="h-3 w-3" />{event.startTime}{event.endTime ? ` – ${event.endTime}` : ''}</p>}
                      {event.location && <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400"><MapPin className="h-3 w-3" />{event.location}</p>}
                      {event.description && <p className="mt-1 text-xs text-slate-400">{event.description}</p>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">Il file .ics include tutti gli eventi disponibili, anche quelli fuori dal mese selezionato.</p>
        </section>
      </div>
    </section>
  );
}
