'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ArrowUpRight, Search, UserRound } from 'lucide-react';
import { searchDocentiTeachers, teacherPhotoUrl, type Esame, type PlanCourse, type Prenotazione, type SubscriptionDocenti } from '@/lib/api';

type Props = {
  exams?: Esame[];
  bookings?: Prenotazione[];
  courses?: PlanCourse[];
  teachers?: SubscriptionDocenti[];
  onNavigate?: (view: 'career' | 'prenotazioni' | 'plan' | 'docenti') => void;
  onTeacherSelect?: (teacher: SubscriptionDocenti) => void;
};

type Result = {
  kind: 'Esame' | 'Appello' | 'Corso' | 'Docente';
  title: string;
  detail?: string;
  teacher?: SubscriptionDocenti;
  view: 'career' | 'prenotazioni' | 'plan' | 'docenti';
};

function normalized(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it');
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(token => token[0]).join('').toUpperCase() || 'D';
}

function TeacherSearchAvatar({ teacher }: { teacher: SubscriptionDocenti }) {
  const [failed, setFailed] = useState(false);
  const name = teacher.professor || 'Docente';
  if (!teacher.professorId || failed) {
    return <span className="global-search-teacher-avatar global-search-teacher-avatar-fallback"><UserRound className="h-8 w-8" /><b>{initials(name)}</b></span>;
  }
  return <Image className="global-search-teacher-avatar" src={teacherPhotoUrl(teacher.professorId)} alt={`Foto di ${name}`} width={40} height={40} unoptimized loading="lazy" onError={() => setFailed(true)} />;
}

export default function GlobalSearchPanel({ exams = [], bookings = [], courses = [], teachers = [], onNavigate, onTeacherSelect }: Props) {
  const [query, setQuery] = useState('');
  const [remoteTeachers, setRemoteTeachers] = useState<SubscriptionDocenti[]>([]);
  const [teacherLoading, setTeacherLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 3) {
      setRemoteTeachers([]);
      setTeacherLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setTeacherLoading(true);
      void searchDocentiTeachers(term)
        .then(result => { if (active) setRemoteTeachers(result.map(item => ({ professorId: item.id, professor: item.name, academicYear: item.role || undefined }))); })
        .catch(() => { if (active) setRemoteTeachers([]); })
        .finally(() => { if (active) setTeacherLoading(false); });
    }, 280);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  const results = useMemo<Result[]>(() => {
    const term = normalized(query.trim());
    if (term.length < 2) return [];
    const matches = (value: unknown) => normalized(value).includes(term);
    const found: Result[] = [];
    for (const exam of exams) {
      const title = exam.materia || exam.insegnamento || 'Esame';
      if (matches(title) || matches(exam.codice)) found.push({ kind: 'Esame', title, detail: exam.voto ? `${exam.voto}/30 · ${exam.cfu} CFU` : `${exam.cfu} CFU`, view: 'career' });
    }
    for (const booking of bookings) {
      const title = booking.materia || 'Appello';
      if (matches(title) || matches(booking.docente) || matches(booking.aula)) found.push({ kind: 'Appello', title, detail: [booking.docente, booking.dataAppello].filter(Boolean).join(' · '), view: 'prenotazioni' });
    }
    for (const course of courses) {
      const title = course.courseName || course.course_name || 'Corso';
      if (matches(title) || matches(course.courseCode)) found.push({ kind: 'Corso', title, detail: `${course.cfu} CFU`, view: 'plan' });
    }
    const allTeachers = [...teachers, ...remoteTeachers].filter((teacher, index, all) => all.findIndex(item => `${item.professorId || ''}|${item.professor || ''}` === `${teacher.professorId || ''}|${teacher.professor || ''}`) === index);
    for (const teacher of allTeachers) {
      const title = teacher.professor || 'Docente';
      if (matches(title) || matches(teacher.courseName)) found.push({ kind: 'Docente', title, detail: teacher.courseName, teacher, view: 'docenti' });
    }
    return found.filter((item, index, all) => all.findIndex(other => `${other.kind}|${other.title}|${other.detail}` === `${item.kind}|${item.title}|${item.detail}`) === index).slice(0, 12);
  }, [bookings, courses, exams, query, remoteTeachers, teachers]);

  const teacherResults = results.filter(result => result.kind === 'Docente');
  const otherResults = results.filter(result => result.kind !== 'Docente');

  return (
    <section className="global-search-panel rounded-2xl border border-white/10 bg-[#0A1B31]/75 p-4" aria-label="Ricerca globale">
      <label htmlFor="global-search" className="mb-2 block text-sm font-semibold text-white">Ricerca globale</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
        <input id="global-search" type="search" role="combobox" aria-autocomplete="list" aria-controls="global-search-results" aria-expanded={query.trim().length >= 2} value={query} onChange={event => setQuery(event.target.value)} placeholder="Cerca esami, corsi, docenti o appelli…" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-400 focus:border-[#5AB0F0] focus:outline-none" />
      </div>
      {query.trim().length >= 2 && (
        <div id="global-search-results" className="mt-3 space-y-2" role="listbox" aria-label="Risultati ricerca">
          {teacherLoading && <p className="text-xs text-slate-400">Cerco anche nel portale Docenti…</p>}
          {results.length === 0 ? (teacherLoading ? null : <p className="text-xs text-slate-400">Nessun risultato nei dati disponibili.</p>) : (
            <>
              {teacherResults.length > 0 && <div className="global-search-teacher-grid" aria-label="Docenti trovati">
                {teacherResults.map((result, index) => result.teacher && (
                  <button key={`${result.kind}-${result.title}-${index}`} type="button" role="option" aria-selected={false} onClick={() => { onTeacherSelect?.(result.teacher!); onNavigate?.('docenti'); }} className="global-search-teacher-card">
                    <TeacherSearchAvatar teacher={result.teacher} />
                    <span className="global-search-teacher-name">{result.title}</span>
                    {result.detail && <span className="global-search-teacher-detail">{result.detail}</span>}
                    <span className="global-search-teacher-open"><ArrowUpRight className="h-3.5 w-3.5" />Apri scheda</span>
                  </button>
                ))}
              </div>}
              {otherResults.map((result, index) => (
                <button key={`${result.kind}-${result.title}-${index}`} type="button" role="option" aria-selected={false} onClick={() => onNavigate?.(result.view)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/10">
                  <span className="min-w-0"><strong className="block truncate text-sm text-slate-100">{result.title}</strong>{result.detail && <span className="block truncate text-xs text-slate-400">{result.detail}</span>}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-sky-300">{result.kind}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
