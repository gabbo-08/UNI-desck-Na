'use client';

import { useState } from 'react';
import { BellRing, CalendarClock, CheckCircle2, Clock3 } from 'lucide-react';
import type { Prenotazione, TassaSnapshot } from '@/lib/api';
import { calendarDayDifference, parseCalendarDate as parseDate } from '@/lib/calendar-date';

type DeadlineKind = 'exam' | 'booking' | 'tax';
type Deadline = { id: string; kind: DeadlineKind; title: string; date: Date; detail?: string; source: string };

type Props = { exams: Prenotazione[]; taxes?: TassaSnapshot | null; horizonDays?: number };

function dayStart(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

function buildDeadlines(exams: Prenotazione[], taxes?: TassaSnapshot | null): Deadline[] {
  const result: Deadline[] = [];
  exams.forEach((exam, index) => {
    const title = exam.materia || 'Appello';
    const examDate = parseDate(exam.dataAppello);
    if (examDate) result.push({ id: `exam-${exam.id || index}`, kind: 'exam', title, date: examDate, detail: exam.aula || exam.ora || undefined, source: 'Appelli' });
    const bookingDate = parseDate(exam.finePrenotazione);
    if (bookingDate) result.push({ id: `booking-${exam.id || index}`, kind: 'booking', title: `Prenotazione · ${title}`, date: bookingDate, source: 'Prenotazioni' });
  });
  const pending = taxes?.pending || taxes?.inDebito || [];
  pending.forEach((tax, index) => {
    const date = parseDate(tax.dueDate || tax.scadenzaISO || tax.scadenza);
    if (!date) return;
    result.push({ id: `tax-${tax.codice || index}`, kind: 'tax', title: tax.description || tax.causale || tax.descrizione || 'Scadenza pagamento', date, detail: tax.amount || tax.importo ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(tax.amount ?? tax.importo ?? 0) : undefined, source: 'Tasse' });
  });
  const summaryDate = parseDate(taxes?.summary?.nextDeadline);
  if (summaryDate && !result.some(item => item.kind === 'tax' && item.date.getTime() === summaryDate.getTime())) {
    result.push({ id: `tax-summary-${taxes?.summary?.nextDeadline}`, kind: 'tax', title: 'Prossima scadenza tasse', date: summaryDate, source: 'Tasse' });
  }
  return result.sort((a, b) => a.date.getTime() - b.date.getTime());
}

const labels: Record<DeadlineKind, string> = { exam: 'Esame', booking: 'Prenotazione', tax: 'Pagamento' };

export default function DeadlineView({ exams, taxes, horizonDays = 90 }: Props) {
  const [filter, setFilter] = useState<'all' | DeadlineKind>('all');
  const today = dayStart(new Date());
  const limit = new Date(today);
  limit.setDate(limit.getDate() + horizonDays);
  const upcoming = buildDeadlines(exams, taxes).filter(item => item.date >= today && item.date <= limit);
  const visible = filter === 'all' ? upcoming : upcoming.filter(item => item.kind === filter);

  return (
    <section className="space-y-4" aria-label="Scadenziario personale">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Scadenziario personale</p>
          <h2 className="mt-1 text-2xl font-bold text-white">Prossime scadenze</h2>
          <p className="mt-1 text-sm text-slate-400">Appelli, prenotazioni e pagamenti nei prossimi {horizonDays} giorni.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1" role="group" aria-label="Filtra scadenze">
          {(['all', 'exam', 'booking', 'tax'] as const).map(value => <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${filter === value ? 'bg-[#2F7FD0] text-white' : 'text-slate-400 hover:text-white'}`}>{value === 'all' ? 'Tutte' : labels[value]}</button>)}
        </div>
      </header>
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-400"><CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-300" />Nessuna scadenza nei filtri selezionati.</div>
      ) : (
        <div className="grid gap-2.5">
          {visible.map(item => {
            const days = calendarDayDifference(item.date, today);
            return <article key={item.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3.5"><div className="mt-0.5 rounded-lg bg-amber-300/10 p-2 text-amber-200">{item.kind === 'exam' ? <CalendarClock className="h-4 w-4" /> : item.kind === 'booking' ? <BellRing className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><h3 className="truncate text-sm font-semibold text-white">{item.title}</h3><span className="text-[11px] text-amber-200">{days === 0 ? 'Oggi' : days === 1 ? 'Domani' : `Tra ${days} giorni`}</span></div><p className="mt-1 text-xs text-slate-400">{item.date.toLocaleDateString('it-IT')} · {item.source}{item.detail ? ` · ${item.detail}` : ''}</p></div></article>;
          })}
        </div>
      )}
    </section>
  );
}
