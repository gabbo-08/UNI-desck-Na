'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Megaphone, BookOpenCheck, Users, ClipboardCheck, ExternalLink, RefreshCw, User, Search, Calendar, X, Star, Trash2 } from 'lucide-react';
import {
  fetchDocentiSummary,
  type DocenteAnnouncementGroup,
  type DocenteAnnouncementItem,
  type SubscriptionDocenti,
  type GroupDocenti,
  type TestDocenti,
  type PlanCourse,
  type ProfessorPreference,
  type DocentiTeacherSearchResult,
  searchDocentiTeachers,
  fetchProfessorPreferences,
  saveProfessorPreference,
  deleteProfessorPreference,
  fetchFavoriteAnnouncements,
} from '@/lib/api';
import DocentePage from '@/components/DocentePage';
import { safeExternalUrl, sanitizeAnnouncementHtml } from '@/lib/safe-content';

interface DocentiViewProps {
  authenticated: boolean;
  coursePrefix?: string | null;
  courseCodes?: string[];
  studentId?: string | null;
  availableCourses?: PlanCourse[];
}

type Tab = 'announcements' | 'subscriptions' | 'groups' | 'tests' | 'favorites';

const CARD =
  'rounded-2xl border border-[#3B7BC4]/30 bg-[#0A1B31]/75 shadow-[0_0_28px_-10px_rgba(70,150,230,0.55)] backdrop-blur-sm';
const EMPTY = `${CARD} p-8 text-center text-sm text-slate-400`;

function readableError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message === 'SESSION_EXPIRED') return 'Sessione scaduta. Esci e accedi di nuovo.';
  if (/CREDENTIALS_REQUIRED/i.test(message)) {
    return 'Credenziali Docenti non disponibili nella sessione. Esci e accedi di nuovo con l\u2019email istituzionale.';
  }
  if (/non valide/i.test(message)) return 'Credenziali Docenti non valide.';
  if (/Nessun dato Docenti/i.test(message)) return 'Nessun dato Docenti trovato sul portale. Riprova più tardi.';
  return message || 'Errore durante il caricamento dei dati Docenti.';
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

function getTimestamp(dateStr?: string | null) {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? 0 : t;
}

function stripTags(html?: string | null) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

export default function DocentiView({ authenticated, coursePrefix, courseCodes, studentId, availableCourses = [] }: DocentiViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('announcements');
  const [announcements, setAnnouncements] = useState<DocenteAnnouncementGroup[]>([]);
  const [favoriteAnnouncements, setFavoriteAnnouncements] = useState<DocenteAnnouncementGroup[]>([]);
  const [favoriteAnnouncementsLoading, setFavoriteAnnouncementsLoading] = useState(false);
  const [favoriteAnnouncementsError, setFavoriteAnnouncementsError] = useState(false);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDocenti[]>([]);
  const [docentiRefreshing, setDocentiRefreshing] = useState(false);
  const [docentiFetchedAt, setDocentiFetchedAt] = useState<string | null>(null);
  const [docentiStale, setDocentiStale] = useState(false);
  const [groups, setGroups] = useState<GroupDocenti[]>([]);
  const [tests, setTests] = useState<TestDocenti[]>([]);
  const [selectedProfessor, setSelectedProfessor] = useState<SubscriptionDocenti | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [dismissedErrors, setDismissedErrors] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [preferences, setPreferences] = useState<ProfessorPreference[]>([]);
  const [favoriteCourse, setFavoriteCourse] = useState('');
  const [teacherQuery, setTeacherQuery] = useState('');
  const [teacherResults, setTeacherResults] = useState<DocentiTeacherSearchResult[]>([]);
  const [teacherSearchLoading, setTeacherSearchLoading] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<DocentiTeacherSearchResult | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteActionError, setFavoriteActionError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Una sola richiesta aggregata evita di ripetere il caricamento del portale.
  const loadData = useCallback(async (forceRefresh = false) => {
    await Promise.resolve();
    if (!mounted.current) return;
    setLoading(true);
    setErrors([]);
    setDismissedErrors(new Set());

    const result = await fetchDocentiSummary({ refresh: forceRefresh }).then(value => ({ status: 'fulfilled' as const, value }))
      .catch(reason => ({ status: 'rejected' as const, reason }));

    if (!mounted.current) return;

    const found: string[] = [];

    if (result.status === 'fulfilled') {
      setAnnouncements(result.value.announcements);
      setSubscriptions(result.value.subscriptions);
      setGroups(result.value.groups);
      setTests(result.value.tests);
      setDocentiRefreshing(Boolean(result.value.meta?.refreshing));
      setDocentiFetchedAt(result.value.meta?.fetchedAt || null);
      setDocentiStale(Boolean(result.value.meta?.stale));
    } else {
      found.push(readableError(result.reason));
      setDocentiRefreshing(false);
    }

    setErrors([...new Set(found)]);
    setLoading(false);
  }, []);

  // Se il server sta aggiornando uno snapshot persistente, interroga il
  // riepilogo ogni pochi secondi e sostituisci i dati appena termina.
  useEffect(() => {
    if (!authenticated || !docentiRefreshing) return;
    let active = true;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void fetchDocentiSummary().then(value => {
        if (!active) return;
        setAnnouncements(value.announcements);
        setSubscriptions(value.subscriptions);
        setGroups(value.groups);
        setTests(value.tests);
        setDocentiRefreshing(Boolean(value.meta?.refreshing));
        setDocentiFetchedAt(value.meta?.fetchedAt || null);
        setDocentiStale(Boolean(value.meta?.stale));
      }).catch(() => {}).finally(() => { polling = false; });
    }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [authenticated, docentiRefreshing]);

  const refreshFavoriteAnnouncements = useCallback(async () => {
    setFavoriteAnnouncementsLoading(true);
    setFavoriteAnnouncementsError(false);
    try {
      setFavoriteAnnouncements(await fetchFavoriteAnnouncements());
    } catch {
      setFavoriteAnnouncementsError(true);
    } finally {
      setFavoriteAnnouncementsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void loadData();
  }, [authenticated, loadData]);

  useEffect(() => {
    if (!authenticated) return;
    void fetchProfessorPreferences().then(setPreferences).catch(() => setPreferences([]));
    void refreshFavoriteAnnouncements();
  }, [authenticated, refreshFavoriteAnnouncements]);

  useEffect(() => {
    if (teacherQuery.trim().length < 3) { setTeacherResults([]); setTeacherSearchLoading(false); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setTeacherSearchLoading(true);
      void searchDocentiTeachers(teacherQuery.trim()).then(result => { if (active) setTeacherResults(result); }).catch(() => { if (active) setTeacherResults([]); }).finally(() => { if (active) setTeacherSearchLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [teacherQuery]);

  const safeAnnouncements = useMemo(() => {
    const merged = new Map<string, DocenteAnnouncementGroup>();
    const activeFavoriteIds = new Set(preferences.map(preference => preference.professorId));
    const normalizeProfessorName = (value?: string | null) => String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleUpperCase('it').replace(/\b(PROF|PROFESSOR|PROFESSORE|DOTT|DOTTOR|DOTTSSA)\.?\b/g, ' ')
      .split(/[^A-Z0-9]+/).filter(Boolean).sort().join(' ');
    const preferenceByIdentity = new Map<string, ProfessorPreference>();
    for (const preference of preferences) {
      preferenceByIdentity.set(`id:${preference.professorId}`, preference);
      preferenceByIdentity.set(`name:${normalizeProfessorName(preference.professorName)}`, preference);
    }
    const favoriteSeeds: DocenteAnnouncementGroup[] = preferences.map(preference => ({
      professor: preference.professorName,
      slug: preference.professorId,
      courseName: preference.courseName,
      isFavorite: true,
      announcementLoading: favoriteAnnouncementsLoading,
      announcementError: favoriteAnnouncementsError,
      items: []
    }));
    const currentFavoriteAnnouncements = favoriteAnnouncements.filter(group => !group.isFavorite || activeFavoriteIds.has(group.slug || ''));
    for (const originalGroup of [...announcements, ...favoriteSeeds, ...currentFavoriteAnnouncements]) {
      // La ricerca Docenti restituisce spesso "COGNOME NOME", mentre gli
      // avvisi usano "Nome Cognome" e possono avere uno slug differente.
      // Usa l'ID quando coincide, altrimenti il nome normalizzato per riunire
      // gli avvisi nello stesso gruppo del docente seguito.
      const matchedPreference = originalGroup.slug
        ? preferenceByIdentity.get(`id:${originalGroup.slug}`)
        : preferenceByIdentity.get(`name:${normalizeProfessorName(originalGroup.professor)}`);
      const group = matchedPreference ? {
        ...originalGroup,
        professor: matchedPreference.professorName,
        slug: originalGroup.slug || matchedPreference.professorId,
        courseName: [matchedPreference.courseName, originalGroup.courseName].filter(Boolean).filter((name, index, all) => all.indexOf(name) === index).join(', '),
        isFavorite: true
      } : originalGroup;
      const key = matchedPreference
        ? `favorite:${matchedPreference.professorId}`
        : group.slug || `name:${normalizeProfessorName(group.professor)}`;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, group);
        continue;
      }
      const items = [...(current.items || []), ...(group.items || [])];
      const uniqueItems = [...new Map(items.map(item => [item.id || `${item.title}|${item.date || ''}`, item])).values()];
      merged.set(key, {
        ...current,
        ...group,
        professor: current.professor || group.professor,
        items: uniqueItems,
        isFavorite: Boolean(current.isFavorite || group.isFavorite),
        courseName: group.courseName || current.courseName,
        announcementLoading: Boolean((group.announcementLoading ?? current.announcementLoading) && !uniqueItems.length),
        announcementError: Boolean((group.announcementError ?? current.announcementError) && !uniqueItems.length)
      });
    }
    return [...merged.values()];
  }, [announcements, favoriteAnnouncements, preferences, favoriteAnnouncementsLoading, favoriteAnnouncementsError]);

  const followedCourses = useMemo<SubscriptionDocenti[]>(() => {
    const normalize = (value?: string | null) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('it').replace(/\bII\b/g, '2').replace(/\bIII\b/g, '3').replace(/\bIV\b/g, '4').replace(/\bI\b/g, '1').replace(/[^A-Z0-9]+/g, ' ').trim();
    const sameProfessor = (a?: string, b?: string) => {
      const tokens = (value?: string) => normalize(value).split(' ').filter(Boolean).sort();
      const left = tokens(a);
      return left.length > 0 && left.join(' ') === tokens(b).join(' ');
    };
    const manual = preferences
      .filter(pref => !subscriptions.some(sub =>
        sameProfessor(pref.professorName, sub.professor) && (
          (pref.courseCode && normalize(pref.courseCode) === normalize(sub.courseCode)) ||
          normalize(pref.courseName) === normalize(sub.courseName)
        )
      ))
      .map(pref => ({
        professorId: pref.professorId,
        professor: pref.professorName,
        courseName: pref.courseName,
        courseCode: pref.courseCode || undefined,
        isFavorite: true,
        preferenceId: pref.id
      } satisfies SubscriptionDocenti));
    return [...subscriptions, ...manual];
  }, [preferences, subscriptions]);

  const removeFavorite = useCallback(async (preferenceId: number) => {
    setFavoriteActionError('');
    try {
      await deleteProfessorPreference(preferenceId);
      setPreferences(current => current.filter(pref => pref.id !== preferenceId));
      void refreshFavoriteAnnouncements();
    } catch (error) {
      setFavoriteActionError(error instanceof Error ? error.message : 'Impossibile rimuovere il docente dai preferiti. Riprova.');
    }
  }, [refreshFavoriteAnnouncements]);

  const sortedAnnouncements = useMemo(() => {
    const list = safeAnnouncements.map(doc => {
      const sortedItems = [...(doc.items || [])].sort(
        (a, b) => getTimestamp(b.date) - getTimestamp(a.date)
      );
      const latestDate = sortedItems.length > 0 ? getTimestamp(sortedItems[0].date) : 0;
      return {
        ...doc,
        items: sortedItems,
        latestDate
      };
    });

    list.sort((a, b) => b.latestDate - a.latestDate);

    if (!search.trim()) return list;

    const query = search.toLowerCase();
    return list
      .map(doc => ({
        ...doc,
        items: (doc.items || []).filter(
          (item: DocenteAnnouncementItem) =>
            (doc.professor || '').toLowerCase().includes(query) ||
            stripTags(item.title).toLowerCase().includes(query) ||
            stripTags(item.content).toLowerCase().includes(query)
        )
      }))
      .filter(doc => doc.items.length > 0);
  }, [safeAnnouncements, search]);

  const totalAnnouncementsCount = useMemo(() => {
    let count = 0;
    for (const curr of safeAnnouncements) {
      if (Array.isArray(curr.items)) {
        count += curr.items.length;
      } else if (typeof curr.count === 'number') {
        count += curr.count;
      }
    }
    return count;
  }, [safeAnnouncements]);

  const tabs: { id: Tab; label: string; count: number; icon: typeof Megaphone }[] = [
    { id: 'announcements', label: 'Avvisi', count: totalAnnouncementsCount, icon: Megaphone },
    { id: 'subscriptions', label: 'Corsi seguiti', count: followedCourses.length, icon: BookOpenCheck },
    { id: 'groups', label: 'Gruppi', count: groups.length, icon: Users },
    { id: 'tests', label: 'Test', count: tests.length, icon: ClipboardCheck },
    { id: 'favorites', label: 'Cerca e preferiti', count: preferences.length, icon: Star },
  ];

  if (selectedProfessor) {
    return (
      <section className="space-y-4">
        <button type="button" onClick={() => setSelectedProfessor(null)} className="text-sm text-sky-300 hover:text-sky-200">
          ← Torna a Docenti
        </button>
        <DocentePage
          authenticated={authenticated}
          professorIdentifier={selectedProfessor.professorId || selectedProfessor.professor || ''}
          coursePrefix={coursePrefix}
          courseCodes={courseCodes}
          studentId={studentId}
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-white">Portale Docenti</h2>
          <p className="text-xs text-slate-400">Avvisi, corsi seguiti ed esami prenotati da docenti.unina.it</p>
          {docentiRefreshing && <p className="mt-1 text-[11px] text-sky-300">Mostro i dati salvati mentre aggiorno il portale{docentiFetchedAt ? ` · ultimo aggiornamento ${formatDate(docentiFetchedAt)}` : ''}.</p>}
          {!docentiRefreshing && docentiStale && <p className="mt-1 text-[11px] text-amber-200">Mostro gli ultimi dati salvati{docentiFetchedAt ? ` del ${formatDate(docentiFetchedAt)}` : ''}; il portale non ha fornito un aggiornamento recente.</p>}
        </div>
        <button
          onClick={() => { void loadData(true); void refreshFavoriteAnnouncements(); }}
          disabled={loading}
          aria-label="Ricarica dati docenti"
          title="Ricarica dati docenti"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/5 text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5AB0F0] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/30 bg-amber-400/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Star className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <h3 className="text-sm font-bold text-white">Vuoi seguire un docente?</h3>
            <p className="mt-1 text-xs text-slate-300">Cercalo nel portale Docenti, scegli il corso e aggiungilo ai preferiti per evidenziare i suoi appelli.</p>
          </div>
        </div>
        <button type="button" onClick={() => setActiveTab('favorites')} className="shrink-0 rounded-lg bg-amber-300 px-4 py-2.5 text-xs font-bold text-[#172033] transition hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          Cerca docente e aggiungi ai preferiti
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 overflow-x-auto border-b border-white/10 pb-3">
        <div className="flex gap-2">
          {tabs.map(({ id, label, count, icon: Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-pressed={selected}
                className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5AB0F0] ${
                  selected
                    ? 'bg-[#2F7FD0] text-white shadow-[0_0_16px_-4px_rgba(47,127,208,0.8)]'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label} ({count})</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'announcements' && (
          <div className="relative w-48 sm:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Cerca avviso o docente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-400 focus:border-[#5AB0F0] focus:outline-none"
            />
          </div>
        )}
      </div>

      {errors.some(message => !dismissedErrors.has(message)) && (
        <div role="alert" className="space-y-2 rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-xs text-red-300">
          {errors.filter(message => !dismissedErrors.has(message)).map((message) => (
            <div key={message} className="flex items-start gap-3">
              <p className="min-w-0 flex-1">{message}</p>
              <button
                type="button"
                onClick={() => setDismissedErrors(current => new Set(current).add(message))}
                aria-label="Nascondi messaggio"
                title="Nascondi messaggio"
                className="shrink-0 rounded p-0.5 text-red-300 transition hover:bg-red-400/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {favoriteActionError && <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{favoriteActionError}</div>}

      {loading && <div className={EMPTY}>Sincronizzazione dei dati docenti in corso (può richiedere fino a un minuto)...</div>}

      {!loading && activeTab === 'announcements' && (
        <div className="space-y-4">
          {sortedAnnouncements.length === 0 ? (
            <div className={EMPTY}>{docentiRefreshing ? 'Sto caricando gli avvisi Docenti…' : 'Nessun avviso trovato con i filtri correnti.'}</div>
          ) : (
            sortedAnnouncements.map((doc, idx) => (
              <div key={doc.slug || doc.professor || idx} className={`${CARD} space-y-3 p-4`}>
                <div className="flex items-center gap-2 border-b border-white/10 pb-2.5 text-sm font-semibold text-[#5AB0F0]">
                  <User className="h-4 w-4 shrink-0" />
          <button type="button" onClick={() => {
            const followed = followedCourses.find(sub => sub.professorId === doc.slug) || followedCourses.find(sub => sub.professor === doc.professor);
            if (followed) setSelectedProfessor(followed);
          }} className="min-w-0 truncate text-left hover:underline">{doc.professor}</button>
          {doc.isFavorite && <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">Preferito{doc.courseName ? ` · ${doc.courseName}` : ''}</span>}
                  <span className="ml-auto text-[11px] font-normal text-slate-400">
                    {doc.items?.length || 0} {(doc.items?.length || 0) === 1 ? 'avviso' : 'avvisi'}
                  </span>
                </div>

                {doc.isFavorite && doc.announcementLoading && !doc.items?.length ? (
                  <p className="text-xs italic text-slate-400">Caricamento avvisi del docente preferito…</p>
                ) : doc.isFavorite && doc.announcementError && !doc.items?.length ? (
                  <p className="text-xs italic text-amber-200">Bacheca non raggiungibile in questo momento. Riprova con Aggiorna.</p>
                ) : doc.items && doc.items.length > 0 ? (
                  <div className="space-y-2.5">
                    {doc.items.map((item: DocenteAnnouncementItem, itemIdx: number) => (
                      <div key={itemIdx} className="space-y-1.5 rounded-xl border border-white/10 bg-[#050E1C]/70 p-3.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <h4 className="text-sm font-medium text-slate-100">{stripTags(item.title)}</h4>
                          {item.date && (
                            <span suppressHydrationWarning className="inline-flex items-center gap-1 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                              <Calendar className="h-3 w-3" />
                              {formatDate(item.date)}
                            </span>
                          )}
                        </div>
                        {item.content && (
                          <div
                            className="text-xs text-slate-400 leading-relaxed [&_p]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-slate-100"
                            dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementHtml(item.content) }}
                          />
                        )}
                        {safeExternalUrl(item.link) && (
                          <a
                            href={safeExternalUrl(item.link) || undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 pt-1 text-[11px] font-semibold text-[#5AB0F0] hover:underline"
                          >
                            <span>Apri avviso originale / allegato</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs italic text-slate-500">Nessun avviso presente in bacheca.</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {!loading && activeTab === 'subscriptions' && (
        <div className="grid gap-2.5">
          {followedCourses.length === 0 ? (
            <div className={EMPTY}>{docentiRefreshing ? 'Sto caricando i corsi seguiti…' : 'Nessun corso iscritto o docente preferito. Puoi aggiungerne uno con il pulsante qui sopra.'}</div>
          ) : (
            followedCourses.map((sub, idx) => (
              <div key={`${sub.professorId || sub.professor}-${sub.courseCode || sub.courseName}-${idx}`} className={`${CARD} flex items-center gap-3 p-3.5`}>
                <button type="button" onClick={() => setSelectedProfessor(sub)} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium text-slate-100">{sub.courseName || 'Corso'}</p>
                    <p className="text-xs text-slate-400">Docente: <span className="font-medium text-slate-200">{sub.professor || 'Non specificato'}</span>{sub.section ? ` • Canale ${sub.section}` : ''}</p>
                  </div>
                  <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold ${sub.isFavorite ? 'bg-amber-300/10 text-amber-200' : 'bg-sky-500/15 text-sky-300'}`}>{sub.isFavorite ? 'Preferito' : sub.academicYear || 'Iscritto'} · Apri scheda</span>
                </button>
                {sub.isFavorite && sub.preferenceId && <button type="button" title="Rimuovi dai preferiti" aria-label={`Rimuovi ${sub.professor} dai preferiti`} onClick={() => void removeFavorite(sub.preferenceId!)} className="rounded-lg p-2 text-slate-400 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))
          )}
        </div>
      )}

      {!loading && activeTab === 'groups' && (
        <div className="grid gap-2.5">
          {groups.length === 0 ? (
            <div className={EMPTY}>Nessun gruppo trovato sul portale Docenti.</div>
          ) : (
            groups.map((group, idx) => (
              <div key={idx} className={`${CARD} space-y-1.5 p-3.5`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-slate-100">{group.name || 'Gruppo'}</p>
                  {group.status && <span className="shrink-0 text-[10px] text-slate-400">{group.status}</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  {group.courseName && <span>Corso: <strong className="text-slate-200">{group.courseName}</strong></span>}
                  {group.professor && <span>Docente: <strong className="text-slate-200">{group.professor}</strong></span>}
                  {group.academicYear && <span>{group.academicYear}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!loading && activeTab === 'favorites' && (
        <div className="space-y-4">
          <div className={`${CARD} space-y-3 p-4`}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Star className="h-4 w-4 text-amber-300" />Segui un docente per un insegnamento</h3>
            <p className="text-xs text-slate-400">Se non puoi iscriverti al corso sul portale Docenti, aggiungi una preferenza: gli appelli Segrepass del docente saranno evidenziati appena pubblicati.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <input
                  list="student-plan-courses"
                  value={favoriteCourse}
                  onChange={e => setFavoriteCourse(e.target.value)}
                  placeholder="Scrivi o seleziona un insegnamento (es. Analisi Matematica II)"
                  className="w-full rounded-lg border border-white/10 bg-[#071426] px-3 py-2 text-sm text-white placeholder-slate-500"
                />
                <datalist id="student-plan-courses">
                  {availableCourses.map(course => <option key={`${course.courseCode || ''}-${course.courseName}`} value={course.courseName} />)}
                </datalist>
                {availableCourses.length === 0 && <p className="mt-1 text-[11px] text-slate-500">Piano di studi non disponibile: puoi inserire il nome del corso manualmente.</p>}
              </div>
              <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={teacherQuery} onChange={e => { setTeacherQuery(e.target.value); setSelectedTeacher(null); }} placeholder="Cerca docente (nome o cognome)" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500" />
                {teacherResults.length > 0 && !selectedTeacher && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-white/10 bg-[#071426] shadow-xl">{teacherResults.map(teacher => <button type="button" key={teacher.id} onClick={() => { setSelectedTeacher(teacher); setTeacherQuery(teacher.name); setTeacherResults([]); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"><span className="block">{teacher.name}</span>{teacher.role && <span className="text-xs text-slate-400">{teacher.role}</span>}</button>)}</div>}
              </div>
              {teacherSearchLoading && <p className="text-xs text-slate-400">Ricerca nel portale Docenti…</p>}
              {!teacherSearchLoading && teacherQuery.trim().length >= 3 && !selectedTeacher && teacherResults.length === 0 && <p className="text-xs text-slate-400">Nessun risultato trovato. Prova con il cognome del docente.</p>}
            </div>
            <button type="button" disabled={!favoriteCourse.trim() || !selectedTeacher || favoriteBusy} onClick={() => {
              const matchingCourse = availableCourses.find(course => course.courseName.trim().toLocaleLowerCase('it') === favoriteCourse.trim().toLocaleLowerCase('it'));
              setFavoriteBusy(true);
              void saveProfessorPreference({ courseCode: matchingCourse?.courseCode || null, courseName: favoriteCourse.trim(), professorId: selectedTeacher!.id, professorName: selectedTeacher!.name })
                .then(async saved => {
                  setPreferences(current => [...current.filter(item => item.id !== saved.id), saved]);
                  setFavoriteCourse('');
                  setSelectedTeacher(null);
                  setTeacherQuery('');
                  setSearch('');
                  setActiveTab('announcements');
                  await refreshFavoriteAnnouncements();
                })
                .finally(() => setFavoriteBusy(false));
            }} className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{favoriteBusy ? 'Salvataggio…' : 'Aggiungi ai preferiti'}</button>
          </div>
          {preferences.length === 0 ? <div className={EMPTY}>Nessun docente preferito ancora. Scegli un corso e cerca il professore.</div> : <p className="text-xs text-slate-400">I docenti preferiti compaiono anche in <strong className="text-slate-200">Corsi seguiti</strong> e i loro avvisi sono nella sezione <strong className="text-slate-200">Avvisi</strong>.</p>}
        </div>
      )}

      {!loading && activeTab === 'tests' && (
        <div className="grid gap-2.5">
          {tests.length === 0 ? (
            <div className={EMPTY}>Nessun test trovato sul portale Docenti.</div>
          ) : (
            tests.map((test, idx) => (
              <div key={`${test.name || 'test'}-${test.courseName || 'course'}-${test.date || idx}`} className={`${CARD} space-y-1.5 p-3.5`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-slate-100">{test.name || 'Test'}</p>
                  {test.status && <span className="shrink-0 text-[10px] text-slate-400">{test.status}</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  {test.courseName && <span>Insegnamento: <strong className="text-slate-200">{test.courseName}</strong></span>}
                  {test.professor && <span>Docente: <strong className="text-slate-200">{test.professor}</strong></span>}
                  {test.group && <span>Gruppo: <strong className="text-slate-200">{test.group}</strong></span>}
                  {test.date && <span>Data: <strong className="text-slate-200">{formatDate(test.date)}</strong></span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
