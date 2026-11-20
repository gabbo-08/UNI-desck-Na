'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BellRing, CalendarClock, CheckCircle2, Clock3, RefreshCw, Wallet } from 'lucide-react';
import type { Prenotazione, SlowSectionState, TassaSnapshot } from '@/lib/api';
import { buildDeadlines, type Deadline, type DeadlineKind } from '@/lib/deadlines';

type Props = {
  exams: Prenotazione[];
  taxes?: TassaSnapshot | null;
  horizonDays?: number;
  sourceStates?: { taxes: SlowSectionState; appelli: SlowSectionState; docenti?: SlowSectionState };
  onRetry?: () => void;
};
type Scope = 'all' | 'today' | 'overdue';

const categories = [
  { value: 'all', label: 'Tutte' },
  { value: 'exam', label: 'Esami' },
  { value: 'booking', label: 'Prenotazioni' },
  { value: 'tax', label: 'Pagamenti' },
] as const;

function relativeLabel(item: Deadline) {
  if (item.expired) {
    const prefix = item.kind === 'booking' ? 'Chiusa' : 'Scaduta';
    const days = Math.abs(item.daysDifference);
    return days === 0 ? `${prefix} oggi` : `${prefix} da ${days} ${days === 1 ? 'giorno' : 'giorni'}`;
  }
  return item.daysDifference === 0 ? 'Oggi' : item.daysDifference === 1 ? 'Domani' : `Tra ${item.daysDifference} giorni`;
}

function groupFor(item: Deadline) {
  if (item.expired) return 'Scadute';
  if (item.daysDifference === 0) return 'Oggi';
  if (item.daysDifference === 1) return 'Domani';
  return item.daysDifference <= 7 ? 'Nei prossimi 7 giorni' : 'Più avanti';
}

export default function DeadlineView({ exams, taxes, horizonDays = 90, sourceStates, onRetry }: Props) {
  const [filter, setFilter] = useState<'all' | DeadlineKind>('all');
  const [scope, setScope] = useState<Scope>('all');
  const [now, setNow] = useState(() => new Date());
  const model = useMemo(() => buildDeadlines(exams, taxes, now, horizonDays), [exams, taxes, now, horizonDays]);

  // Refresh the calendar while it stays open, including exact closing times.
  useEffect(() => {
    const timestamp = Date.now();
    const nextMinute = Math.floor(timestamp / 60_000) * 60_000 + 60_000;
    const nextDeadline = model.items.reduce((next, item) => {
      const time = item.date.getTime();
      return item.timeLabel && time > timestamp ? Math.min(next, time) : next;
    }, nextMinute);
    const timer = window.setTimeout(() => setNow(new Date()), Math.max(25, nextDeadline - timestamp + 25));
    return () => window.clearTimeout(timer);
  }, [model.items]);

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const byCategory = model.items.filter(item => filter === 'all' || item.kind === filter);
  const visible = byCategory.filter(item => scope === 'all' || (scope === 'today' ? item.daysDifference === 0 : item.expired));
  const scopes = [
    { value: 'all', label: 'Tutte le scadenze', aria: 'Mostra tutte le scadenze', count: byCategory.length, Icon: CalendarClock },
    { value: 'today', label: 'Oggi', aria: 'Mostra scadenze di oggi', count: byCategory.filter(item => item.daysDifference === 0).length, Icon: Clock3 },
    { value: 'overdue', label: 'Scadute', aria: 'Mostra scadenze scadute', count: byCategory.filter(item => item.expired).length, Icon: AlertCircle },
  ] as const;
  const incompleteSources = sourceStates ? [
    { label: 'Tasse', state: sourceStates.taxes },
    { label: 'Appelli Segrepass', state: sourceStates.appelli },
    ...(sourceStates.docenti ? [{ label: 'Prenotazioni Docenti', state: sourceStates.docenti }] : []),
  ].filter(({ state }) => state.status !== 'ready' || state.stale) : [];
  const canRetry = incompleteSources.some(({ state }) => state.status === 'error' || (state.status === 'ready' && state.stale));
  const groups = ['Scadute', 'Oggi', 'Domani', 'Nei prossimi 7 giorni', 'Più avanti'];

  return (
    <section className="space-y-5 text-app-text" aria-label="Scadenziario personale">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-app-line pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-app-accent">Scadenziario personale</p>
          <h2 className="mt-1 text-2xl font-bold">Le tue scadenze</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-app-muted">Esami, chiusure delle prenotazioni e pagamenti dei prossimi {horizonDays} giorni. I pagamenti arretrati restano in evidenza.</p>
        </div>
        <div className="rounded-xl border border-app-line bg-app-card px-4 py-3 text-sm">
          <p className="mb-1 text-xs text-app-muted">Oggi · ora italiana</p>
          <time data-testid="deadline-today" dateTime={model.todayKey} className="font-semibold capitalize">{model.todayLabel}</time>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" role="group" aria-label="Filtra per periodo">
        {scopes.map(({ value, label, aria, count, Icon }) => (
          <button key={value} type="button" aria-label={aria} aria-pressed={scope === value} onClick={() => setScope(value)}
            className={`min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent sm:p-4 ${scope === value ? 'border-app-accent bg-app-accent/10' : 'border-app-line bg-app-card hover:bg-app-raised'}`}>
            <Icon className={`mb-2 h-4 w-4 ${value === 'overdue' && count > 0 ? 'text-red-500' : 'text-app-accent'}`} aria-hidden="true" />
            <span className="block text-2xl font-bold tabular-nums">{count}</span>
            <span className="mt-1 block text-xs leading-snug text-app-muted sm:text-sm">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtra per tipo">
        {categories.map(({ value, label }) => (
          <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}
            className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${filter === value ? 'border-app-accent bg-app-accent/10 text-app-text' : 'border-app-line bg-app-card text-app-muted hover:text-app-text'}`}>
            {label}
          </button>
        ))}
      </div>

      {incompleteSources.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-line bg-app-card p-4 text-sm">
          <p className="min-w-0 flex-1 text-app-muted">{incompleteSources.map(({ label, state }) => <span key={label} className="block">{label}: {state.status === 'loading' ? 'aggiornamento in corso' : 'dati da aggiornare'}.</span>)}<span className="mt-1 block">Le scadenze già disponibili restano visibili; l’elenco potrebbe essere incompleto.</span></p>
          {onRetry && canRetry && <button type="button" aria-label="Aggiorna dati scadenze" onClick={onRetry} className="flex items-center gap-2 rounded-lg border border-app-line px-3 py-2 font-semibold hover:bg-app-raised"><RefreshCw className="h-4 w-4" aria-hidden="true" />Riprova</button>}
        </div>
      )}
      {model.invalidDateCount > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-relaxed">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Alcune scadenze non hanno una data valida e non possono essere ordinate. Verifica la data nel portale di origine.</span>
        </p>
      )}

      <p className="text-xs text-app-muted" aria-live="polite" aria-atomic="true">{visible.length} {visible.length === 1 ? 'scadenza nel filtro selezionato' : 'scadenze nei filtri selezionati'}</p>
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-app-line bg-app-card p-8 text-center text-sm text-app-muted">
          <CheckCircle2 className="mx-auto mb-3 h-7 w-7 text-app-accent" aria-hidden="true" />
          <p className="font-semibold text-app-text">Nessuna scadenza nei filtri selezionati</p>
          <p className="mt-2">{scope !== 'all' || filter !== 'all' ? 'Seleziona Tutte e Tutte le scadenze per consultare l’elenco completo.' : 'Qui compariranno le scadenze con una data valida lette dai portali.'}</p>
        </div>
      ) : groups.map(group => {
        const items = visible.filter(item => groupFor(item) === group);
        if (!items.length) return null;
        return <div key={group} className="space-y-2.5">
          <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{group}</h3><span className="rounded-full bg-app-raised px-2 py-0.5 text-xs tabular-nums text-app-muted">{items.length}</span></div>
          {items.map(item => {
            const Icon = item.kind === 'exam' ? CalendarClock : item.kind === 'booking' ? BellRing : Wallet;
            return <article key={item.id} className={`flex items-start gap-3 rounded-xl border bg-app-card p-3.5 sm:p-4 ${item.expired ? 'border-red-500/40' : 'border-app-line'}`}>
              <div className={`mt-0.5 shrink-0 rounded-lg p-2.5 ${item.expired ? 'bg-red-500/10' : 'bg-app-accent/10'}`}><Icon className="h-4 w-4" aria-hidden="true" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words text-sm font-semibold">{item.title}</h3>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${item.expired ? 'bg-red-500/15' : item.daysDifference === 0 ? 'bg-app-accent/20' : 'bg-app-raised'}`}>{relativeLabel(item)}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-app-muted"><time dateTime={item.timeLabel ? item.date.toISOString() : item.dateKey}>{item.dateLabel}{item.timeLabel ? ` · ore ${item.timeLabel}` : ''}</time></p>
                <p className="mt-1 break-words text-xs leading-relaxed text-app-muted">{item.eventLabel} · {item.source}{item.detail ? ` · ${item.detail}` : ''}</p>
              </div>
            </article>;
          })}
        </div>;
      })}
      <p className="border-t border-app-line pt-4 text-xs leading-relaxed text-app-muted">Le date sono confrontate con oggi nel fuso di Roma. Se il portale indica solo il giorno, la scadenza resta valida fino alla fine di quel giorno; se indica un orario, viene rispettato anche quello.</p>
    </section>
  );
}
