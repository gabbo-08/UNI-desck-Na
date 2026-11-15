'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import {
  fetchCareerPlan,
  type CareerPlan,
  type CareerPlanCourse,
  type ProfiloRecord
} from '@/lib/api';
import { safeExternalUrl } from '@/lib/safe-content';

type Props = { authenticated: boolean; profile: ProfiloRecord | null };

function statusLabel(status?: string) {
  if (status === 'passed') return 'Superato';
  if (status === 'needs_review') return 'Da verificare';
  if (status === 'elective_available') return 'Opzionale';
  return 'Da sostenere';
}

export default function StudyPlanView({ authenticated, profile }: Props) {
  const [data, setData] = useState<CareerPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const extProfile = profile ?? {};
  const sourceUrl = safeExternalUrl(data?.plan?.source_url);

  const loadPlan = async () => {
    if (!authenticated) return;
    setLoading(true);
    setError('');
    try {
      setData(await fetchCareerPlan());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare il piano.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    if (!authenticated) return;
    fetchCareerPlan()
      .then(result => { if (active) setData(result); })
      .catch(loadError => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare il piano.');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [authenticated]);

  const isUnsupportedCourse = error.toLowerCase().includes('manifesto') ||
    error.toLowerCase().includes('non disponibile') ||
    error.toLowerCase().includes('supportato');

  const groups = new Map<string, CareerPlanCourse[]>();
  for (const course of data?.courses || []) {
    const studyYear = course.study_year ?? course.studyYear ?? course.year;
    const semesterVal = course.semester;
    const year = studyYear ? `Anno ${studyYear}` : 'Altre attività';
    const semester = semesterVal ? `Semestre ${semesterVal}` : 'Senza semestre';
    const key = `${year} · ${semester}`;
    groups.set(key, [...(groups.get(key) || []), course]);
  }

  return (
    <section className="space-y-6 text-zinc-100">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Piano di studi</p>
          <h2 className="mt-1 text-2xl font-bold">{extProfile.course_name || extProfile.courseName || 'Il tuo corso'}</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Coorte {extProfile.cohort_year || extProfile.cohortYear || 'non impostata'} · anno {extProfile.current_course_year || extProfile.currentCourseYear || 'non impostato'}
          </p>
        </div>
        <button
          onClick={loadPlan}
          disabled={loading}
          aria-label="Aggiorna piano"
          className="rounded-md border border-zinc-700 p-2 transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-sky-400" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </header>

      {error && isUnsupportedCourse && (
        <div role="alert" className="rounded-r-md border-l-4 border-amber-500 bg-amber-950/30 p-4 text-amber-100 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <h3 className="font-semibold text-amber-300">Corso non ancora supportato</h3>
              <p className="mt-1 text-sm text-zinc-300 leading-relaxed">
                I dati di carriera per <strong className="text-zinc-100">{extProfile.course_name || extProfile.courseName || 'questo corso'}</strong> (Coorte {extProfile.cohort_year || extProfile.cohortYear || 'non impostata'}) sono stati letti correttamente da Segrepass, ma il manifesto degli studi non è ancora stato importato nel database dell&apos;app.
              </p>
            </div>
          </div>
        </div>
      )}

      {error && !isUnsupportedCourse && (
        <div role="alert" className="border-l-2 border-red-500 bg-red-950/20 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-4">
          <LoaderCircle className="h-4 w-4 animate-spin text-sky-400" />
          <span>Caricamento del piano personale…</span>
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Superati', data.summary.passedCourses],
              ['Da sostenere', data.summary.missingCourses],
              ['Da verificare', data.summary.reviewCourses],
              ['CFU obbligatori mancanti', data.summary.mandatoryMissingCfu]
            ].map(([label, value]) => (
              <div key={label} className="border border-zinc-800 bg-zinc-900/70 p-3 rounded-sm">
                <p className="text-xs text-zinc-400">{label}</p>
                <p className="mt-1 text-xl font-semibold text-sky-200">{value}</p>
              </div>
            ))}
          </div>

          {data.electiveGroups.map(group => (
            <section key={group.id} className="border-l-2 border-[#043B6B] bg-zinc-900/60 px-4 py-3 rounded-r-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">Crediti a scelta libera</h3>
                <span className="text-sm text-sky-200">{group.passedCfu}/{group.requiredCfu} CFU · ne mancano {group.remainingCfu}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">Le opzioni disponibili non sono tutte obbligatorie: valgono gli insegnamenti selezionati nel tuo profilo.</p>
              {group.courses.filter(course => course.status !== 'passed').map(course => (
                <div key={course.id} className="mt-2 flex justify-between gap-3 text-sm text-zinc-300">
                  <span>{course.course_name || course.courseName}</span><span>{course.cfu} CFU</span>
                </div>
              ))}
            </section>
          ))}

          <div className="space-y-5">
            {[...groups.entries()].map(([groupName, courses]) => (
              <section key={groupName}>
                <h3 className="mb-2 border-b border-zinc-800 pb-2 text-sm font-semibold text-sky-200">{groupName}</h3>
                <div className="divide-y divide-zinc-800">
                  {courses.map(course => {
                    const prerequisites = course.prerequisites || [];
                    const passedExam = course.passedExam || null;

                    return (
                      <article key={course.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div>
                          <h4 className="font-medium">{course.course_name || course.courseName}</h4>
                          <p className="mt-1 text-xs text-zinc-500">
                            {course.cfu} CFU{prerequisites.length ? ` · Propedeuticità: ${prerequisites.join(', ')}` : ''}
                          </p>
                          {passedExam && (
                            <p className="mt-1 text-xs text-zinc-400">
                              {passedExam.voto ? `${passedExam.voto}/30` : passedExam.giudizio || 'IDONEO'} · {passedExam.data || 'verbalizzato'}
                            </p>
                          )}
                        </div>
                        <span className={`rounded-sm border px-2 py-1 text-xs ${
                          course.status === 'passed'
                            ? 'border-emerald-800 text-emerald-300 bg-emerald-950/20'
                            : course.status === 'needs_review'
                            ? 'border-amber-800 text-amber-200 bg-amber-950/20'
                            : 'border-[#043B6B] text-sky-200 bg-sky-950/20'
                        }`}>
                          {statusLabel(course.status)}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-sky-200 transition-colors"
            >
              Fonte: {data.plan?.source_name || 'manifesto ufficiale'} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </>
      )}
    </section>
  );
}
