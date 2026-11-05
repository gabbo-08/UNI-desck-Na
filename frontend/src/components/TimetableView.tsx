'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, LoaderCircle, RefreshCw } from 'lucide-react';
import { fetchTimetable, type ProfiloRecord, type TimetableResponse } from '@/lib/api';

type Props = { authenticated: boolean; profile: ProfiloRecord | null };

function formatLessonDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTime(ts?: number) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

export default function TimetableView({ authenticated, profile }: Props) {
  const extProfile = profile ?? {};
  const [data, setData] = useState<TimetableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // L'orario usa anno, canale e corso del profilo: nessun form da compilare.
  const load = useCallback(async (refresh: boolean) => {
    if (!authenticated) return;
    setLoading(true);
    setError('');
    try {
      setData(await fetchTimetable({}, { refresh }));
    } catch (loadError: unknown) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare l’orario.');
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    void load(false);
  }, [authenticated, load]);

  const timetable = data?.timetable;
  const events = [...(timetable?.events ?? [])].sort((a, b) =>
    `${a.date ?? ''} ${a.startTime ?? ''}`.localeCompare(`${b.date ?? ''} ${b.startTime ?? ''}`)
  );
  const courseLabel = extProfile.course_name || extProfile.courseName || extProfile.course_id || extProfile.courseId || 'non impostato';
  const channelLabel = extProfile.channel || '';

  return (
    <section className="space-y-5 text-zinc-100">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase text-sky-300">EasyAcademy · orario automatico</p>
          <h2 className="mt-1 text-2xl font-bold">Orario personale</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Corso: {courseLabel}{channelLabel ? ` · Canale ${channelLabel}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Aggiorna
        </button>
      </header>

      {error && (
        <div role="alert" className="border-l-2 border-amber-400 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          {error}
        </div>
      )}

      {loading && !timetable && (
        <p className="inline-flex items-center gap-2 py-6 text-sm text-zinc-400">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Consultazione dell’agenda ufficiale… può richiedere fino a un minuto.
        </p>
      )}

      {timetable && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3 text-sm">
            <span className="inline-flex items-center gap-2 font-semibold">
              <CalendarDays className="h-4 w-4 text-sky-300" />
              {timetable.academicYear}
            </span>
            <span className="text-xs text-zinc-500">
              {data?.fromCache && data?.cachedAt
                ? `Dalla cache, aggiornato alle ${formatTime(data.cachedAt)}`
                : 'Aggiornato ora'}
            </span>
          </div>

          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400">Nessuna lezione pubblicata per il tuo canale.</p>
          ) : (
            <div className="divide-y divide-zinc-800">
              {events.map((event, index) => (
                <article
                  key={`${event.date}-${event.startTime}-${event.courseName}-${index}`}
                  className="grid gap-2 py-4 sm:grid-cols-[10rem_1fr_auto] sm:items-center"
                >
                  <div className="text-sm text-sky-300">
                    <p className="font-medium">{formatLessonDate(event.date) || event.dateTime}</p>
                    {(event.startTime || event.endTime) && (
                      <p className="mt-1 text-xs text-zinc-400">
                        {event.startTime || ''}{event.startTime && event.endTime ? ' – ' : ''}{event.endTime || ''}
                      </p>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">{event.courseName}</h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      {event.teachers?.length ? event.teachers.join(', ') : 'Docente non indicato'}
                    </p>
                    <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${event.enrollmentStatus === 'confirmed' ? 'bg-emerald-400/10 text-emerald-300' : event.enrollmentStatus === 'different_teacher' ? 'bg-amber-400/10 text-amber-200' : 'bg-zinc-700/60 text-zinc-300'}`}>
                      {event.enrollmentStatus === 'confirmed' ? `Iscrizione Docenti: ${event.enrolledProfessor || 'confermata'}` : event.enrollmentStatus === 'different_teacher' ? `Docente diverso · iscritto a ${event.enrolledProfessor || 'un altro docente'}` : event.enrollmentStatus === 'not_enrolled' ? 'Nessuna iscrizione Docenti rilevata' : 'Iscrizioni Docenti non disponibili'}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-400 sm:text-right">
                    {event.room || 'Aula non indicata'}{event.campus ? ` · ${event.campus}` : ''}
                  </div>
                </article>
              ))}
            </div>
          )}

          <a
            href="https://easyacademy.unina.it/agendastudenti/index.php?view=easycourse&_lang=it&include=corso"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-zinc-500 hover:text-sky-200"
          >
            Apri l’agenda ufficiale EasyAcademy
          </a>
        </div>
      )}
    </section>
  );
}
