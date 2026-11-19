
'use client';

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  House,
  BookOpen,
  Award,
  CalendarDays,
  CalendarRange,
  GraduationCap,
  RefreshCw,
  LogIn,
  LogOut,
  Download,
  Trash2,
  Settings2,
  CheckCircle2,
  ClipboardList,
  Megaphone,
  ChevronRight,
  CreditCard,
  AlertTriangle,
  Clock,
  Search,
  User,
  ShieldCheck,
  TrendingUp,
  CalendarCheck,
  UserCheck,
  X,
  Eye,
  EyeOff,
  MoreHorizontal,
  } from 'lucide-react';
import {
  fetchDocentiSummary,
  fetchMetriche,
  fetchTimetable,
  fetchSlowData,
  bookCareerExam,
  loginAPI,
  logoutAPI,
  deleteAccountAPI,
  fetchBootstrap,
  clearClientCache,
  readBootstrapCache,
  writeBootstrapCache,
  type BookedExamDocenti,
  type TestDocenti,
  type TimetableEvent,
  type CredenzialiSegrepass,
  type Esame,
  type Metriche,
  type Prenotazione,
  type ProfiloRecord,
  type ProfiloStudente,
  type SlowData,
  type TassaItem,
  type SubscriptionDocenti,
  type ProfessorPreference,
  type PlanCourse,
  fetchProfessorPreferences,
  apiUrl,
  updateProfile,
  saveProfilePrefsCache,
  readProfilePrefsCache
} from '@/lib/api';
import { safePaymentUrl } from '@/lib/safe-content';
import { mergeSlowData, slowRetryDelay, slowSectionState, slowStatusMessage, slowSyncOutcome } from '@/lib/slow-data';
import ProfileSetupView from '@/components/ProfileSetupView';
import AgendaView from '@/components/AgendaView';
import ThemeSwitch from '@/components/ThemeSwitch';
import PinReveal from '@/components/PinReveal';
import SupportReportForm from '@/components/SupportReportForm';
import GlobalSearchPanel from '@/components/GlobalSearchPanel';
import DeadlineView from '@/components/DeadlineView';
import NotificationCenter from '@/components/NotificationCenter';
import OfficialServicesPanel, { type OfficialService } from '@/components/OfficialServicesPanel';
import { getTimetableClock, getTimetableEventState, timetableEventSortKey } from '@/lib/timetable-time';

const DeferredStudyPlanView = dynamic(() => import('@/components/StudyPlanView'), { ssr: false });
const DeferredTimetableView = dynamic(() => import('@/components/TimetableView'), { ssr: false });
const DeferredDocentiView = dynamic(() => import('@/components/DocentiView'), { ssr: false });

type View = 'home' | 'agenda' | 'deadlines' | 'career' | 'prenotazioni' | 'taxes' | 'docenti' | 'timetable' | 'plan';

const configuredOfficialServices: OfficialService[] = (() => {
  try {
    const parsed = JSON.parse(process.env.NEXT_PUBLIC_OFFICIAL_SERVICES || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})();

const NAV: { id: View; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'agenda', label: 'Agenda', icon: CalendarRange },
  { id: 'deadlines', label: 'Scadenze', icon: Clock },
  { id: 'career', label: 'Carriera & Voti', icon: BookOpen },
  { id: 'prenotazioni', label: 'Prenotazioni', icon: CalendarCheck },
  { id: 'taxes', label: 'Tasse & Pagamenti', icon: CreditCard },
  { id: 'docenti', label: 'Docenti', icon: Megaphone },
  { id: 'timetable', label: 'Orario Lezioni', icon: CalendarDays },
  { id: 'plan', label: 'Piano di Studi', icon: ClipboardList },
];

const MOBILE_NAV = NAV.filter(({ id }) => ['home', 'agenda', 'deadlines', 'career', 'prenotazioni', 'taxes'].includes(id));

const CARD =
  'dashboard-card rounded-2xl border border-[#3B7BC4]/30 bg-[#0A1B31]/75 shadow-[0_0_28px_-10px_rgba(70,150,230,0.55)] backdrop-blur-sm';
const SECTION_TITLE = 'section-title mb-3 text-sm font-bold tracking-wide text-white flex items-center gap-2';
const GHOST_BTN =
  'inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5AB0F0] disabled:opacity-50';

function academicYearIndex(cohort?: number | string | null) {
  const start = Number(cohort);
  if (!start) return null;
  const now = new Date();
  const currentStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const idx = currentStart - start + 1;
  return idx >= 1 ? idx : null;
}

function formatEuro(val?: number | null) {
  if (val === undefined || val === null) return '0,00 €';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val);
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

// Converte una data dd/mm/yyyy (o yyyy-mm-dd) in timestamp; 0 se non riconosciuta.
function dataItalianaTs(value?: string | null): number {
  if (!value) return 0;
  const testo = String(value);
  // Alcune risposte dei portali riportano il timestamp Unix in millisecondi.
  // Se non lo riconosciamo, l'appello finisce tra quelli futuri e non nello storico.
  if (/^\d{12,14}$/.test(testo)) {
    const timestamp = Number(testo);
    return Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime()) ? timestamp : 0;
  }
  const it = testo.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const separata = it || testo.match(/(\d{1,2})[-.](\d{1,2})[-.](\d{4})/);
  if (separata) {
    const [, day, month, year] = separata;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)
      ? date.getTime()
      : 0;
  }
  const iso = testo.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return date.getFullYear() === Number(iso[1]) && date.getMonth() === Number(iso[2]) - 1 && date.getDate() === Number(iso[3])
      ? date.getTime()
      : 0;
  }
  return 0;
}

function isAppelloPassato(p: Prenotazione): boolean {
  const t = dataItalianaTs(p.dataAppello);
  if (!t) return false;
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  return t < oggi.getTime();
}

// Date leggibili anche quando arrivano come timestamp in millisecondi.
function dataLeggibile(value?: string | null): string {
  if (!value) return '—';
  const testo = String(value).trim();
  if (/^\d{12,14}$/.test(testo)) {
    const data = new Date(Number(testo));
    if (!Number.isNaN(data.getTime())) {
      return data.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
  }
  return formatDate(testo);
}

function normalizeCourseLabel(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\bIII\b/g, '3')
    .replace(/\bII\b/g, '2')
    .replace(/\bIV\b/g, '4')
    .replace(/\bI\b/g, '1')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function canonicalCourseLabel(value: string | undefined, candidates: string[]): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeCourseLabel(value);
  if (!normalized) return value;
  const exact = candidates.find(candidate => normalizeCourseLabel(candidate) === normalized);
  if (exact) return exact;

  const sourceTokens = new Set(normalized.split(' ').filter(token => token.length > 2));
  if (!sourceTokens.size) return value;
  let best: { label: string; score: number } | null = null;
  for (const candidate of candidates) {
    const candidateTokens = new Set(normalizeCourseLabel(candidate).split(' ').filter(token => token.length > 2));
    if (!candidateTokens.size) continue;
    const overlap = [...sourceTokens].filter(token => candidateTokens.has(token)).length;
    const score = overlap / Math.max(sourceTokens.size, candidateTokens.size);
    const safeMatch = overlap >= 2 || (sourceTokens.size === 1 && candidateTokens.size === 1 && score === 1);
    if (safeMatch && (!best || score > best.score)) best = { label: candidate, score };
  }
  return best?.label || value;
}

// Giorno dell'orario in forma lunga, es. "Mercoledì 4 novembre".
function formatGiornoLungo(iso: string): string {
  const [y, m, g] = iso.split('-').map(Number);
  if (!y || !m || !g) return iso;
  const testo = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, g)));
  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

export default function DashboardView() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionSyncState, setSessionSyncState] = useState<'idle' | 'syncing' | 'synced' | 'offline'>('idle');
  const lastBootstrapSyncRef = useRef<number>(0);
  const sessionGenerationRef = useRef(0);
  const bootstrapSequenceRef = useRef(0);
  const bootstrapRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [profile, setProfile] = useState<ProfiloStudente | null>(null);
  const [credentials, setCredentials] = useState<CredenzialiSegrepass>({ codiceFiscale: '', password: '' });
  const [enableDocentiSync, setEnableDocentiSync] = useState(false);
  const [docentiEnabled, setDocentiEnabled] = useState(false);
  const [data, setData] = useState<Metriche | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginStep, setLoginStep] = useState('');
  const [error, setError] = useState('');
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [activeView, setActiveView] = useState<View>('home');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const [searchExam, setSearchExam] = useState('');
  const [searchPrenotazione, setSearchPrenotazione] = useState('');
  const [simulatorGrade, setSimulatorGrade] = useState('');
  const [simulatorCfu, setSimulatorCfu] = useState('6');
  const [taxTab, setTaxTab] = useState<'pending' | 'paid'>('pending');
  const [slowNotice, setSlowNotice] = useState<'loading' | 'ready' | 'partial' | 'error' | null>(null);
  const [dismissedSlowNotice, setDismissedSlowNotice] = useState<'loading' | 'ready' | 'partial' | 'error' | null>(null);
  const [slowData, setSlowData] = useState<SlowData | null>(null);
  const [slowReload, setSlowReload] = useState(0);
  const slowForceRefreshRef = useRef(false);
  const [bookingReceipt, setBookingReceipt] = useState<{ id: string; message: string; at: string } | null>(null);
  const [timetableReady, setTimetableReady] = useState(false);
  // Stato solo in memoria: non persiste dati personali nel browser.
  const [privacyMode, setPrivacyMode] = useState(false);
  const timetableLoadedRef = useRef(false);
  const [timetableEvents, setTimetableEvents] = useState<TimetableEvent[]>([]);
  const [timetableLoading, setTimetableLoading] = useState(false);
  const [timetableError, setTimetableError] = useState('');
  const [clockNow, setClockNow] = useState(() => new Date());
  const [docentiBookings, setDocentiBookings] = useState<BookedExamDocenti[]>([]);
  const [docentiTests, setDocentiTests] = useState<TestDocenti[]>([]);
  const [docentiSubscriptions, setDocentiSubscriptions] = useState<SubscriptionDocenti[]>([]);
  const [professorPreferences, setProfessorPreferences] = useState<ProfessorPreference[]>([]);
  const [teacherFromSearch, setTeacherFromSearch] = useState<SubscriptionDocenti | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    bootstrapSequenceRef.current += 1;
    if (bootstrapRetryRef.current) clearTimeout(bootstrapRetryRef.current);
    clearClientCache();
    setAuthenticated(false);
    setProfile(null);
    setData(null);
    setOnboardingRequired(false);
    setEditingProfile(false);
    setActiveView('home');
    setCredentials({ codiceFiscale: '', password: '', email: '' });
    setEnableDocentiSync(false);
    setDocentiEnabled(false);
    setBookingReceipt(null);
    setTimetableReady(false);
    setTimetableEvents([]);
    setTimetableError('');
    setTimetableLoading(false);
    setDocentiBookings([]);
    setDocentiTests([]);
    setDocentiSubscriptions([]);
    setProfessorPreferences([]);
    setTeacherFromSearch(null);
    setCheckingSession(false);
    setLoading(false);
    setLoginStep('');
    setSessionSyncState('idle');
    setSlowData(null);
    setSlowNotice(null);
    setDismissedSlowNotice(null);
    slowForceRefreshRef.current = false;
    timetableLoadedRef.current = false;
  }, []);

  useEffect(() => {
    const onSessionExpired = () => {
      clearSession();
      setError('Sessione scaduta. Inserisci di nuovo le credenziali.');
    };
    window.addEventListener('segrepass:session-expired', onSessionExpired);
    return () => window.removeEventListener('segrepass:session-expired', onSessionExpired);
  }, [clearSession]);

  const caricaDati = useCallback(async (refresh = false) => {
    const generation = sessionGenerationRef.current;
    await Promise.resolve();
    if (generation !== sessionGenerationRef.current) return;
    setLoading(true);
    setError('');
    try {
      const metriche = await fetchMetriche({ refresh });
      if (generation !== sessionGenerationRef.current) return;
      setData(prev => {
        const merged = { ...prev, ...metriche };
        const cached = readBootstrapCache();
        if (cached?.profile) {
          writeBootstrapCache({
            profile: cached.profile,
            onboardingRequired: cached.onboardingRequired,
            docentiEnabled: cached.docentiEnabled,
            metriche: merged
          });
        }
        return merged;
      });
    } catch (err: unknown) {
      if (generation !== sessionGenerationRef.current) return;
      if (err instanceof Error && err.message === 'SESSION_EXPIRED') {
        clearSession();
        setError('Sessione scaduta. Inserisci di nuovo le credenziali.');
      } else {
        setError(err instanceof Error ? err.message : 'Impossibile sincronizzare i dati.');
      }
    } finally {
      if (generation === sessionGenerationRef.current) setLoading(false);
    }
  }, [clearSession]);

  const revalidateBootstrap = useCallback(async function revalidate(hasLocalSnapshot: boolean, attempt = 0): Promise<void> {
    const generation = sessionGenerationRef.current;
    const sequence = ++bootstrapSequenceRef.current;
    if (bootstrapRetryRef.current) clearTimeout(bootstrapRetryRef.current);
    setSessionSyncState('syncing');
    try {
      const bootstrap = await fetchBootstrap({ timeoutMs: hasLocalSnapshot ? 20_000 : 45_000 });
      if (generation !== sessionGenerationRef.current || sequence !== bootstrapSequenceRef.current) return;
      if (!bootstrap) {
        clearSession();
        setCheckingSession(false);
        return;
      }
      const nextDocentiEnabled = Boolean(bootstrap.sync?.docenti?.enabled);
      setAuthenticated(true);
      setProfile(bootstrap.profile);
      setOnboardingRequired(bootstrap.onboardingRequired);
      setDocentiEnabled(nextDocentiEnabled);
      setSessionSyncState('synced');
      lastBootstrapSyncRef.current = Date.now();
      const cached = readBootstrapCache();
      const previous = bootstrap.profile.id && cached?.profile.id === bootstrap.profile.id ? cached?.metriche : null;
      const mergedMetriche: Metriche | null = bootstrap.metriche
        ? { ...previous, ...bootstrap.metriche, anagrafica: { ...previous?.anagrafica, ...bootstrap.metriche.anagrafica } }
        : previous || null;
      setData(mergedMetriche);
      writeBootstrapCache({ profile: bootstrap.profile, onboardingRequired: bootstrap.onboardingRequired, docentiEnabled: nextDocentiEnabled, metriche: mergedMetriche });
      setCheckingSession(false);
      const needsSummaryMetrics = mergedMetriche?.mediaPonderata === undefined;
      if (!bootstrap.metriche || !bootstrap.sync?.fromCache || needsSummaryMetrics) {
        void caricaDati(false);
      }
    } catch {
      if (generation !== sessionGenerationRef.current || sequence !== bootstrapSequenceRef.current) return;
      if (hasLocalSnapshot) {
        setSessionSyncState('offline');
        setCheckingSession(false);
        if (attempt === 0) {
          bootstrapRetryRef.current = setTimeout(() => {
            if (generation === sessionGenerationRef.current) void revalidate(true, 1);
          }, 6000);
        }
        return;
      }
      setCheckingSession(false);
    }
  }, [caricaDati, clearSession]);

  useEffect(() => {
    let active = true;
    const cached = readBootstrapCache();
    Promise.resolve().then(() => {
      if (!active) return;
      if (cached) {
        setAuthenticated(true);
        setProfile(cached.profile);
        setOnboardingRequired(cached.onboardingRequired);
        setDocentiEnabled(cached.docentiEnabled);
        if (cached.metriche) setData(cached.metriche);
        setCheckingSession(false);
        void revalidateBootstrap(true);
      } else {
          setCheckingSession(false);
          void revalidateBootstrap(false);
        }
    });
    return () => {
      active = false;
      sessionGenerationRef.current += 1;
      if (bootstrapRetryRef.current) clearTimeout(bootstrapRetryRef.current);
    };
  }, [revalidateBootstrap]);

  useEffect(() => {
    if (!authenticated) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastBootstrapSyncRef.current < 10 * 60 * 1000) return;
      void revalidateBootstrap(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [authenticated, revalidateBootstrap]);

  useEffect(() => {
    setDismissedSlowNotice(null);
  }, [slowNotice]);

  useEffect(() => {
    if (authenticated || checkingSession) return;
    fetch(apiUrl('/health'), { cache: 'no-store' }).catch(() => {});
  }, [authenticated, checkingSession]);

  useEffect(() => {
    if (!authenticated) {
      Promise.resolve().then(() => setSlowNotice(null));
      return;
    }

    let active = true;
    const generation = sessionGenerationRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let nextDelay = 3000;
    let forceRefresh = slowForceRefreshRef.current;
    slowForceRefreshRef.current = false;

    const poll = async () => {
      try {
        const refresh = forceRefresh;
        forceRefresh = false;
        const slow: SlowData = await fetchSlowData({ refresh });
        if (!active || generation !== sessionGenerationRef.current) return;
        setSlowData(slow);
        const outcome = slowSyncOutcome(slow);
        setData(prev => {
          const merged = mergeSlowData(prev, slow);
          const cached = readBootstrapCache();
          if (merged && cached && cached.profile.id && cached.profile.id === profile?.id) {
            writeBootstrapCache({ profile: cached.profile, onboardingRequired: cached.onboardingRequired, docentiEnabled: cached.docentiEnabled, metriche: merged });
          }
          return merged;
        });

        if (outcome === 'ready') {
          setSlowNotice('ready');
          nextDelay = 3000;
          timer = setTimeout(() => { if (active) setSlowNotice(null); }, 5000);
          return;
        }

        if (outcome === 'error' || outcome === 'partial') {
          setSlowNotice(outcome);
          timer = setTimeout(poll, slowRetryDelay({ ...slow, status: outcome }, Math.max(30_000, nextDelay)));
          nextDelay = Math.min(60_000, nextDelay * 2);
          return;
        }

        setSlowNotice('loading');
        timer = setTimeout(poll, slowRetryDelay(slow, nextDelay));
        nextDelay = Math.min(60000, nextDelay * 2);
      } catch (error) {
        if (!active || generation !== sessionGenerationRef.current) return;
        if (error instanceof Error && error.message === 'SESSION_EXPIRED') return;
        setSlowNotice('error');
        setSlowData(previous => ({
          ...previous,
          status: 'error',
          sections: {
            taxes: { status: 'error', stale: Boolean(previous?.taxes) },
            appelli: { status: 'error', stale: Array.isArray(previous?.prenotazioni) },
          },
        }));
        nextDelay = Math.min(60000, Math.max(10000, nextDelay * 2));
        timer = setTimeout(poll, nextDelay);
      }
    };

    Promise.resolve().then(() => {
      if (!active) return;
      setSlowNotice('loading');
      return poll();
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [authenticated, profile?.id, slowReload]);

  const retrySlowData = () => {
    slowForceRefreshRef.current = true;
    setDismissedSlowNotice(null);
    setSlowReload(value => value + 1);
  };

const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailIstituzionale = credentials.email?.trim() || credentials.codiceFiscale.trim();

    // 1. Il login usa un solo identificativo: l'email istituzionale.
    if (!emailIstituzionale || !credentials.password) {
      setError('Inserisci email istituzionale e password.');
      return;
    }

    if (!/^[^\s@]+@studenti\.unina\.it$/i.test(emailIstituzionale)) {
      setError('Inserisci una email valida @studenti.unina.it.');
      return;
    }

    const generation = ++sessionGenerationRef.current;
    if (bootstrapRetryRef.current) clearTimeout(bootstrapRetryRef.current);
    setLoading(true);
    setError('');
    setLoginStep('Connessione ai servizi Unina...');
    
    const steps = [
      'Connessione a Segrepass...',
      'Lettura carriera e profilo...',
      'Estrazione esami e metriche...',
      'Preparazione dashboard...'
    ];
    if (enableDocentiSync) steps.push('Avvio acquisizione dati Docenti...');
    let stepIndex = 0;
    const stepTimer = setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, steps.length - 1);
      setLoginStep(steps[stepIndex]);
    }, 2200);

    try {
      const access = await loginAPI({
        codiceFiscale: emailIstituzionale,
        password: credentials.password,
        email: emailIstituzionale,
        enableDocentiSync
      });
      if (generation !== sessionGenerationRef.current) return;
      
      setLoginStep('Finalizzazione sessione...');
      setAuthenticated(true);
      let resolvedProfile = access.profile;
      let resolvedOnboarding = access.onboardingRequired;
      const resolvedId = (access as { profileId?: string }).profileId || access.profile?.id;
      const localPrefs = readProfilePrefsCache(resolvedId);
      if (resolvedOnboarding && localPrefs) {
        resolvedOnboarding = false;
        resolvedProfile = {
          ...resolvedProfile,
          ...(localPrefs.courseId ? { courseId: localPrefs.courseId } : {}),
          ...(localPrefs.courseName ? { courseName: localPrefs.courseName } : {}),
          ...(localPrefs.cohortYear ? { cohortYear: localPrefs.cohortYear } : {}),
          ...(localPrefs.currentCourseYear ? { currentCourseYear: localPrefs.currentCourseYear } : {}),
          ...(localPrefs.channel ? { channel: localPrefs.channel } : {}),
          ...(localPrefs.surnameInitial ? { surnameInitial: localPrefs.surnameInitial } : {})
        } as ProfiloStudente;
        void updateProfile(localPrefs).then((res: { profile: ProfiloStudente; onboardingRequired: boolean }) => {
          if (generation !== sessionGenerationRef.current) return;
          setProfile(res.profile);
          setOnboardingRequired(res.onboardingRequired);
        }).catch(() => {});
      }
      setProfile(resolvedProfile);
      setOnboardingRequired(resolvedOnboarding);
      setData(access.metriche);
      const nextDocenti = enableDocentiSync && access.docentiReason !== 'DOCENTI_SYNC_DISABLED';
      setDocentiEnabled(nextDocenti);
      setSessionSyncState('synced');
      lastBootstrapSyncRef.current = Date.now();
      writeBootstrapCache({ profile: resolvedProfile, onboardingRequired: resolvedOnboarding, docentiEnabled: nextDocenti, metriche: access.metriche });
      setCredentials({ codiceFiscale: '', password: '', email: '' });
      setEnableDocentiSync(false);
    } catch (err: unknown) {
      if (generation !== sessionGenerationRef.current) return;
      setError(err instanceof Error ? err.message : 'Accesso non riuscito. Controlla le credenziali.');
    } finally {
      clearInterval(stepTimer);
      if (generation === sessionGenerationRef.current) {
        setLoginStep('');
        setLoading(false);
      }
    }
  };
  const handleLogout = async () => {
    try {
      await logoutAPI();
      clearSession();
      setError('');
    } catch {
      setError('Uscita non completata. Controlla la connessione e riprova.');
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('Eliminare profilo, cache e sessioni locali? L’azione non è annullabile.')) return;
    try {
      await deleteAccountAPI();
      clearSession();
      setError('Profilo e dati associati eliminati.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossibile eliminare i dati.');
    }
  };

  const handleProfileSaved = (savedProfile: ProfiloStudente) => {
    timetableLoadedRef.current = false;
    setTimetableReady(false);
    setTimetableEvents([]);
    setProfile(savedProfile);
    setOnboardingRequired(false);
    setEditingProfile(false);
    const cached = readBootstrapCache();
    writeBootstrapCache({
      profile: savedProfile,
      onboardingRequired: false,
      docentiEnabled: cached?.docentiEnabled ?? docentiEnabled,
      metriche: cached?.metriche ?? data
    });
    if (savedProfile?.id) {
      saveProfilePrefsCache(String(savedProfile.id), savedProfile);
    }
  };

  const extProfile: ProfiloRecord = profile ?? {};
  const anagrafica = data?.anagrafica;

  const matricola = anagrafica?.matricola || extProfile?.matricola || null;
  const nomeCompleto = anagrafica?.nomeCompleto || extProfile?.name || 'Studente';
  const corsoDiLaurea = anagrafica?.corsoDiLaurea || extProfile?.courseName || extProfile?.course_name || 'Corso non specificato';
  const codiceCorso = anagrafica?.codiceCorso || extProfile?.courseId || extProfile?.course_id || null;
  const annoCorso = anagrafica?.annoCorso || academicYearIndex(extProfile?.cohortYear || extProfile?.cohort_year);
  const coorte = anagrafica?.annoImmatricolazione || extProfile?.cohortYear || extProfile?.cohort_year || '—';
  const canale = extProfile?.channel || 'Da impostare';

  const taxesObj = data?.tasse?.available === false ? undefined : data?.tasse;
  const taxesState = slowSectionState(slowData, 'taxes');
  const appelliState = slowSectionState(slowData, 'appelli');
  const taxesUnavailable = taxesState.status === 'error' && !taxesObj;
  const paidTaxes: TassaItem[] = taxesObj?.paid || taxesObj?.pagati || [];
  const pendingTaxes: TassaItem[] = taxesObj?.pending || taxesObj?.inDebito || [];

  const totalPaid = taxesObj?.summary?.totalPaid ?? paidTaxes.reduce((sum, item) => sum + (item.amount ?? item.importo ?? 0), 0);
  const totalPending = taxesObj?.summary?.totalPending ?? pendingTaxes.reduce((sum, item) => sum + (item.amount ?? item.importo ?? 0), 0);
  const nextDeadline = taxesObj?.summary?.nextDeadline || pendingTaxes.map(t => t.dueDate || t.scadenzaISO || t.scadenza).filter(Boolean).sort()[0];

  // Orario per la Home: caricato una volta; la cache del backend evita scraping ripetuti.

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!authenticated || !['home', 'agenda', 'timetable'].includes(activeView) || timetableLoadedRef.current) return;
    let active = true;
    // La Home deve comparire subito: l'orario è utile appena dopo il primo
    // rendering, ma non deve competere con il recupero iniziale di carriera,
    // tasse e Docenti.
    const delay = activeView === 'home' ? 1200 : 0;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setTimetableLoading(true);
      setTimetableError('');
      fetchTimetable()
        .then((res) => { if (active) { setTimetableEvents(res.timetable?.events ?? []); timetableLoadedRef.current = true; setTimetableReady(true); } })
        .catch((err: unknown) => {
          if (!active) return;
          setTimetableEvents([]);
          setTimetableReady(false);
          setTimetableError(err instanceof Error ? err.message : 'Orario non disponibile.');
        })
        .finally(() => { if (active) setTimetableLoading(false); });
    }, delay);
    return () => { active = false; window.clearTimeout(timer); };
  }, [authenticated, activeView, profile]);

  // Prossima lezione: il primo giorno con lezioni da oggi in avanti.
  // Per oggi conta solo ciò che non è ancora finito.
  const prossimoGiorno = useMemo(() => {
    const clock = getTimetableClock(clockNow);
    const annotated = timetableEvents.map(event => ({
      event,
      state: getTimetableEventState(event, clockNow)
    }));
    const active = annotated
      .filter(item => item.state === 'active' && item.event.date === clock.dateKey)
      .sort((a, b) => timetableEventSortKey(a.event).localeCompare(timetableEventSortKey(b.event)))
      .map(item => item.event);
    const future = annotated
      .filter(item => (item.state === 'upcoming' || item.state === 'unknown') && item.event.date && item.event.date >= clock.dateKey)
      .map(item => item.event)
      .sort((a, b) => timetableEventSortKey(a).localeCompare(timetableEventSortKey(b)));

    if (active.length > 0) {
      return { data: clock.dateKey, oggi: true, inCorso: true, lezioni: active };
    }
    if (future.length === 0) return null;
    const data = future[0].date as string;
    return {
      data,
      oggi: data === clock.dateKey,
      inCorso: false,
      lezioni: future.filter((e) => e.date === data)
    };
  }, [timetableEvents, clockNow]);

  // Prenotazioni del portale Docenti: caricate subito dopo il primo rendering
  // e mostrate insieme agli appelli Segrepass.

  useEffect(() => {
    if (!authenticated || !docentiEnabled || !['home', 'docenti', 'prenotazioni'].includes(activeView)) return;

    let active = true;
    const delay = activeView === 'home' ? 1200 : 0;
    const timer = window.setTimeout(() => {
      if (!active) return;

      fetchDocentiSummary()
        .then(({ bookedExams: bookings, tests, subscriptions }) => {
          if (active) {
            setDocentiBookings(bookings);
            setDocentiTests(tests);
            setDocentiSubscriptions(subscriptions);
          }
        })
        .catch(() => {
          if (active) {
            setDocentiBookings([]);
            setDocentiTests([]);
            setDocentiSubscriptions([]);
          }
        });
    }, delay);

    return () => { active = false; window.clearTimeout(timer); };
  }, [authenticated, activeView, docentiEnabled]);

  useEffect(() => {
    if (!authenticated || !docentiEnabled || !['home', 'docenti', 'prenotazioni'].includes(activeView)) return;
    let active = true;
    const delay = activeView === 'home' ? 1200 : 0;
    const timer = window.setTimeout(() => {
      void fetchProfessorPreferences().then(value => { if (active) setProfessorPreferences(value); }).catch(() => { if (active) setProfessorPreferences([]); });
    }, delay);
    return () => { active = false; window.clearTimeout(timer); };
  }, [authenticated, activeView, docentiEnabled]);

  const listaPrenotazioni = useMemo<Prenotazione[]>(() => {
    const daPortale: Prenotazione[] = docentiBookings.map((b, idx) => ({
      id: `docenti-${idx}`,
      materia: b.courseName || b.descrInse || b.examName || b.materia || b.name || 'Esame Docenti',
      docente: b.professor || b.docente || b.cognomeDocente || 'Non specificato',
      dataAppello: b.examDate || b.dataAppello,
      inizioPrenotazione: b.inizioPrenotazione,
      finePrenotazione: b.finePrenotazione,
      aula: b.location || b.aula || b.room,
      note: b.bookingDate ? `Prenotato il ${b.bookingDate}` : undefined,
      isMyProfessor: true,
    }));
    const testPortale: Prenotazione[] = docentiTests.map((test, idx) => ({
      id: `docenti-test-${idx}`,
      materia: test.name || test.courseName || 'Test',
      docente: test.group ? `Gruppo ${test.group}` : 'Portale Docenti',
      dataAppello: test.date,
      note: test.status ? `Stato: ${test.status}` : undefined,
      isMyProfessor: true,
    }));

    const visti = new Set<string>();
    const unite = [...(data?.prenotazioni || []), ...daPortale, ...testPortale].filter((p) => {
      const chiave = `${(p.materia || '').toLowerCase()}|${p.dataAppello || ''}|${(p.docente || '').toLowerCase()}`;
      if (visti.has(chiave)) return false;
      visti.add(chiave);
      return true;
    });

    // Prima le prenotazioni future (dalla più vicina), poi quelle passate (dalla più recente).
    return unite.sort((a, b) => {
      const passataA = isAppelloPassato(a);
      const passataB = isAppelloPassato(b);
      if (passataA !== passataB) return passataA ? 1 : -1;
      const tA = dataItalianaTs(a.dataAppello);
      const tB = dataItalianaTs(b.dataAppello);
      return passataA ? tB - tA : tA - tB;
    });
  }, [data, docentiBookings, docentiTests]);

  const canonicalCourseNames = useMemo(() => [...new Set([
    ...timetableEvents.map(event => event.courseName || ''),
    ...(data?.pianoDiStudiRaw || []).map(course => course.courseName || course.course_name || '')
  ].map(value => value.trim()).filter(Boolean))], [data?.pianoDiStudiRaw, timetableEvents]);
  const displayMateria = (value?: string | null) => canonicalCourseLabel(value || undefined, canonicalCourseNames) || 'Esame';
  const displayedPrenotazioni = useMemo(
    () => listaPrenotazioni.map(item => ({
      ...item,
      materia: canonicalCourseLabel(item.materia || undefined, canonicalCourseNames) || item.materia
    })),
    [listaPrenotazioni, canonicalCourseNames]
  );

  // Per la home: solo le prenotazioni ancora future.
  const prossimePrenotazioni = useMemo(
    () => displayedPrenotazioni.filter((p) => !isAppelloPassato(p)),
    [displayedPrenotazioni]
  );

  const examPlanner = useMemo(() => {
    const upcoming = prossimePrenotazioni
      .map(item => ({ item, timestamp: dataItalianaTs(item.dataAppello) }))
      .filter(entry => entry.timestamp > 0)
      .sort((left, right) => left.timestamp - right.timestamp);
    const bySlot = new Map<string, Prenotazione[]>();
    for (const entry of upcoming) {
      const day = new Date(entry.timestamp).toISOString().slice(0, 10);
      const time = String(entry.item.ora || '').trim();
      if (!time) continue;
      const key = `${day}|${time}`;
      bySlot.set(key, [...(bySlot.get(key) || []), entry.item]);
    }
    const conflicts = [...bySlot.values()].filter(items => items.length > 1);
    return { upcoming: upcoming.slice(0, 5), conflicts };
  }, [prossimePrenotazioni]);

  const mediaPond = data?.mediaPonderata ?? '--';
  const mediaArit = data?.mediaAritmetica ?? '--';
  const baseLaurea = data?.baseLaurea ?? '--';
  const cfuConseguiti = data?.cfuAcquisiti ?? 0;
  const cfuTotali = data?.cfuTotali ?? 180;
  const percCFU = Math.min(100, Math.round((Number(cfuConseguiti) / cfuTotali) * 100)) || 0;
  const simulatedCareer = useMemo(() => {
    const grade = Number(simulatorGrade);
    const cfu = Number(simulatorCfu);
    const currentAverage = Number(mediaPond);
    if (!Number.isFinite(grade) || grade < 18 || grade > 30 || !Number.isFinite(cfu) || cfu <= 0 || !Number.isFinite(currentAverage)) return null;
    const totalCfu = Number(cfuConseguiti) || 0;
    const average = totalCfu > 0 ? ((currentAverage * totalCfu) + (grade * cfu)) / (totalCfu + cfu) : grade;
    return { average, base: average * (110 / 30) };
  }, [cfuConseguiti, mediaPond, simulatorCfu, simulatorGrade]);
  const listaEsami = useMemo<Esame[]>(() => (Array.isArray(data?.esami) ? data.esami : []), [data]);
  const examCourseCodes = useMemo(
    () => [...new Set(listaEsami
      .map(exam => String(exam.codice || '').trim())
      .filter(Boolean))],
    [listaEsami]
  );
  const teacherCourseCodes = useMemo(
    () => [...new Set([
      ...(data?.pianoDiStudiRaw || []).map(course => String(course.courseCode || '').trim()),
      ...examCourseCodes
    ].filter(Boolean))],
    [data?.pianoDiStudiRaw, examCourseCodes]
  );

  const esamiFiltrati = useMemo(() => {
    if (!searchExam.trim()) return listaEsami;
    const query = searchExam.toLowerCase();
    return listaEsami.filter(esame => {
      const mat = (esame.materia || esame.insegnamento || '').toLowerCase();
      const cod = (esame.codice || '').toLowerCase();
      return mat.includes(query) || cod.includes(query);
    });
  }, [listaEsami, searchExam]);

  const prenotazioniFiltrate = useMemo(() => {
    if (!searchPrenotazione.trim()) return displayedPrenotazioni;
    const query = searchPrenotazione.toLowerCase();
    return displayedPrenotazioni.filter(p => {
      const mat = (p.materia || '').toLowerCase();
      const doc = (p.docente || '').toLowerCase();
      return mat.includes(query) || doc.includes(query);
    });
  }, [displayedPrenotazioni, searchPrenotazione]);

  // Gli appelli passati di Segrepass non sono prenotazioni personali: lo storico
  // deve provenire esclusivamente dalle prenotazioni lette dal portale Docenti.
  const appelliDisponibili = useMemo(
    () => prenotazioniFiltrate.filter(p => !isAppelloPassato(p) && !p.id?.startsWith('docenti-')),
    [prenotazioniFiltrate]
  );
  const appelliPerCorso = useMemo(() => {
    const key = (value?: string) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\bII\b/g, '2').replace(/\bIII\b/g, '3').replace(/\bIV\b/g, '4').replace(/\bI\b/g, '1').trim();
    const teacherMatch = (a?: string, b?: string) => {
      const tokens = (value?: string) => key(value).split(' ').filter(token => token.length > 2);
      const left = tokens(a); const right = new Set(tokens(b));
      if (!left.length || !right.size) return false;
      if (left.length === 1) return right.has(left[0]);
      return right.has(left[0]) && right.has(left[left.length - 1]);
    };
    const groups = new Map<string, { title: string; items: Prenotazione[] }>();
    for (const item of appelliDisponibili) {
      const title = canonicalCourseLabel(item.materia || 'Esame senza titolo', canonicalCourseNames) || 'Esame senza titolo';
      const k = key(title);
      const group = groups.get(k) || { title, items: [] };
      group.items.push(item); groups.set(k, group);
    }
    return [...groups.values()].map(group => {
      const enrolled = docentiSubscriptions.filter(sub => key(sub.courseName) === key(group.title));
      const preferred = professorPreferences.filter(pref => key(pref.courseName) === key(group.title));
      const targetTeachers = enrolled.length ? enrolled.map(s => s.professor || '').filter(Boolean) : preferred.map(p => p.professorName);
      const primary = targetTeachers.length ? group.items.find(item => targetTeachers.some(name => teacherMatch(name, item.docente))) : undefined;
      return { ...group, primary, targetName: targetTeachers.join(', '), hasEnrollment: enrolled.length > 0, alternatives: group.items.filter(item => item !== primary) };
    });
  }, [appelliDisponibili, canonicalCourseNames, docentiSubscriptions, professorPreferences]);
  const storicoPrenotazioni = useMemo(
    () => prenotazioniFiltrate.filter(p => !appelliDisponibili.includes(p)),
    [prenotazioniFiltrate, appelliDisponibili]
  );
  const testPrenotazioni = useMemo(
    () => storicoPrenotazioni.filter(p => p.id?.startsWith('docenti-test-')),
    [storicoPrenotazioni]
  );
  const storicoEsami = useMemo(
    () => prenotazioniFiltrate.filter(p => p.id?.startsWith('docenti-') && !p.id?.startsWith('docenti-test-')),
    [prenotazioniFiltrate]
  );

  const handleBookCareerExam = async (appello: Prenotazione) => {
    if (!authenticated || !appello.annopri || !appello.numAppello || !appello.bookingEnabled || !appello.id) return;
    setBookingId(appello.id);
    try {
      const receipt = await bookCareerExam(appello);
      setBookingReceipt({
        id: appello.id,
        message: receipt.message || 'Prenotazione inviata al portale.',
        at: new Date().toISOString()
      });
      setData(current => current ? {
        ...current,
        prenotazioni: (current.prenotazioni || []).map(item =>
          item.id === appello.id ? { ...item, note: 'Prenotazione effettuata.' } : item
        )
      } : current);
    } finally {
      setBookingId(null);
    }
  };

  const exportPersonalData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      profile,
      metriche: data,
      timetable: timetableEvents,
      docenti: { bookings: docentiBookings, tests: docentiTests, subscriptions: docentiSubscriptions },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `segrepass-dati-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pageBg =
    'app-shell min-h-screen bg-[radial-gradient(ellipse_at_top,#0B3A6B_0%,#061426_45%,#030912_100%)] text-slate-100';

  if (checkingSession) {
    return (
      <main className={`${pageBg} login-shell flex items-center justify-center p-4`}>
        <p className="text-sm text-slate-400">Verifica della sessione…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className={`${pageBg} login-shell flex items-center justify-center p-4`}>
        <div className="absolute right-4 top-4 z-10">
          <ThemeSwitch />
        </div>
        <form onSubmit={handleLogin} className="login-card w-full max-w-sm space-y-4 p-6">
          <div className="space-y-1 text-center">
            <div className="mx-auto mb-3 grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border-2 border-[#E6C887]/70 bg-white/95 p-1">
              <Image src="/logo_prova.jpg" alt="UniDesk NA" width={80} height={80} className="h-full w-full object-contain" priority />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#E6C887]">UniDesk NA</h1>
            <p className="text-sm text-slate-400">Client non ufficiale per studenti. Nessuna affiliazione con l&apos;ateneo.</p>
          </div>
          {error && <p role="alert" className="text-center text-xs font-medium text-red-400">{error}</p>}
          {loading && loginStep && (
            <p className="text-center text-xs font-medium text-[#5AB0F0]">{loginStep}</p>
          )}

          <input
            type="email"
            name="emailIstituzionale"
            autoComplete="username"
            placeholder="Email @studenti.unina.it"
            value={credentials.email ?? credentials.codiceFiscale}
            onChange={(e) => setCredentials((c) => ({ ...c, email: e.target.value, codiceFiscale: e.target.value }))}
            className="login-input w-full rounded-xl border py-2.5 px-3 text-xs focus:border-[#5AB0F0] focus:outline-none"
          />
          <label className="login-label flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={enableDocentiSync}
              onChange={(e) => setEnableDocentiSync(e.target.checked)}
              className="mt-0.5 accent-[#2F7FD0]"
            />
            <span className="min-w-0">
              Attiva anche il portale Docenti dopo il login (opt-in separato).
            </span>
          </label>
          <input
            type="password"
            name="passwordSegrepass"
            autoComplete="current-password"
              placeholder="Password del portale studenti"
            value={credentials.password}
            onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
            className="login-input w-full rounded-xl border py-2.5 px-3 text-xs focus:border-[#5AB0F0] focus:outline-none"
          />
          <p className="text-center text-xs text-slate-500">Le credenziali restano cifrate sul server; Docenti richiede opt-in esplicito.</p>
          <button
            type="submit"
            disabled={loading}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2F7FD0] px-4 font-semibold text-white transition hover:bg-[#3D8FE2] disabled:opacity-50"
          >
            <LogIn className="h-4 w-4" />
            {loading ? 'Accesso in corso...' : 'Accedi'}
          </button>
        </form>
      </main>
    );
  }




  if (profile && editingProfile) {
    return (
      <main className={`${pageBg} px-4 py-8 sm:px-8`}>
        <ProfileSetupView
          initialProfile={profile}
          onSaved={handleProfileSaved}
          onCancel={() => setEditingProfile(false)}
        />
      </main>
    );
  }

  const refresh = () => {
    if (!authenticated) return;
    void caricaDati(true);
    retrySlowData();
  };
  const serviceStatuses: Array<{ label: string; ready: boolean; status: string }> = [
    { label: 'Carriera', ready: Boolean(data), status: data ? 'Disponibile' : 'In caricamento' },
    {
      label: 'Tasse e appelli',
      ready: taxesState.status === 'ready' && appelliState.status === 'ready',
      status: taxesState.status === 'error' ? 'Tasse da aggiornare' : appelliState.status === 'error' ? 'Appelli da aggiornare' : slowNotice === 'loading' ? 'In aggiornamento' : 'Disponibile'
    },
    { label: 'Portale Docenti', ready: docentiEnabled, status: docentiEnabled ? 'Opt-in attivo' : 'Non collegato' },
    { label: 'Orario', ready: timetableReady, status: timetableError ? 'Non disponibile' : timetableLoading ? 'In caricamento' : timetableReady ? 'Disponibile' : 'Su richiesta' },
  ];

  return (
    <div className={`${pageBg}${privacyMode ? ' privacy-mode' : ''}`} data-privacy-mode={privacyMode ? 'true' : 'false'}>
      {slowNotice && dismissedSlowNotice !== slowNotice && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed right-4 top-4 z-50 max-w-xs rounded-xl border px-4 py-3 text-xs shadow-lg backdrop-blur ${
            slowNotice === 'loading'
              ? 'border-[#3B7BC4]/50 bg-[#0A1B31]/95 text-slate-200'
              : slowNotice === 'ready'
              ? 'border-emerald-600/60 bg-emerald-950/95 text-emerald-200'
              : 'border-amber-600/60 bg-amber-950/95 text-amber-100'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              {slowStatusMessage(slowData)}
              {(slowNotice === 'error' || slowNotice === 'partial') && <button type="button" onClick={retrySlowData} className="mt-2 block rounded border border-current/40 px-2 py-1 font-semibold">Riprova tasse e appelli</button>}
            </span>
            <button
              type="button"
              onClick={() => setDismissedSlowNotice(slowNotice)}
              aria-label="Nascondi messaggio"
              title="Nascondi messaggio"
              className="shrink-0 rounded p-0.5 text-current/80 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex flex-col gap-3 border-b border-white/10 bg-[#0A3260]/60 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-[#E6C887]/70 bg-white/95 p-0.5 sm:h-14 sm:w-14">
            <Image src="/logo_prova.jpg" alt="UniDesk NA" width={56} height={56} className="h-full w-full object-contain" priority />
          </div>
          <div className="min-w-0">
            <h1 className="privacy-sensitive truncate text-lg font-bold text-[#E6C887] sm:text-2xl">{nomeCompleto}</h1>
            <p className="privacy-sensitive truncate text-xs text-slate-300">
              {corsoDiLaurea} {matricola ? `• Matr. ${matricola}` : ''}
            </p>
          </div>
        </div>
        <div className="flex w-full flex-nowrap justify-start gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
          <button
            type="button"
            onClick={() => setPrivacyMode(current => !current)}
            aria-pressed={privacyMode}
            aria-label={privacyMode ? 'Disattiva modalità privacy' : 'Attiva modalità privacy'}
            title={privacyMode ? 'Disattiva modalità privacy' : 'Attiva modalità privacy'}
            className={GHOST_BTN}
          >
            {privacyMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden sm:inline">Privacy</span>
          </button>
          {sessionSyncState === 'syncing' && (<span className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[#3B7BC4]/40 bg-[#2F7FD0]/15 px-2.5 text-xs text-[#9CCBF5]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#5AB0F0]" /><span className="hidden sm:inline">Sincronizzazione...</span></span>)}
          {sessionSyncState === 'offline' && (<button type="button" onClick={() => void revalidateBootstrap(true)} title="Server in avvio o non raggiungibile. Clicca per sincronizzare." className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 text-xs text-amber-200 hover:bg-amber-500/25"><span className="h-2 w-2 rounded-full bg-amber-400" /><span className="hidden sm:inline">Cache locale ? Riprova</span></button>)}
          <PinReveal pin={data?.pin} />
          <ThemeSwitch />
          <button onClick={refresh} disabled={loading} aria-label="Aggiorna carriera" title="Aggiorna carriera" className={GHOST_BTN}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Aggiorna</span>
          </button>
          <button onClick={exportPersonalData} aria-label="Esporta dati" title="Esporta dati" className={GHOST_BTN}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Esporta</span>
          </button>
          <button onClick={() => setEditingProfile(true)} aria-label="Impostazioni" title="Impostazioni" className={GHOST_BTN}>
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Impostazioni</span>
          </button>
          <button onClick={handleLogout} aria-label="Esci" title="Esci" className={GHOST_BTN}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
          <button onClick={() => void handleDeleteAccount()} aria-label="Elimina dati" title="Elimina dati" className={`${GHOST_BTN} text-red-300 hover:text-red-200`}>
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Elimina dati</span>
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl">
        {/* SIDEBAR (desktop) */}
        <nav aria-label="Sezioni" className="hidden w-60 shrink-0 flex-col gap-1 border-r border-white/10 p-4 md:flex">
          {NAV.map(({ id, label, icon: Icon }) => {
            const selected = activeView === id;
            return (
              <button
                key={id}
                onClick={() => setActiveView(id)}
                aria-current={selected ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5AB0F0] ${
                  selected
                    ? 'bg-[#2F7FD0]/25 font-semibold text-white shadow-[inset_0_0_0_1px_rgba(90,176,240,0.35)]'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>

        {/* CONTENUTO */}
        <main className="min-w-0 flex-1 space-y-6 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-6 sm:px-8 md:pb-10">
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

          {bookingReceipt && (
            <div role="status" className="rounded-xl border border-emerald-600/40 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
              <strong>Prenotazione inviata.</strong> {bookingReceipt.message} · {new Date(bookingReceipt.at).toLocaleString('it-IT')}
              <span className="ml-1 text-emerald-300/80">Verifica comunque l’esito su Segrepass.</span>
            </div>
          )}

          {onboardingRequired && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6C887]/40 bg-[#E6C887]/10 px-4 py-3 text-xs text-[#F0D9A6]">
              <span>Completa corso, coorte e canale per sbloccare piano di studi e orario. Gli esami sono già disponibili.</span>
              <button
                type="button"
                onClick={() => setEditingProfile(true)}
                className="rounded-lg border border-[#E6C887]/60 px-3 py-1.5 font-semibold text-[#E6C887] hover:bg-[#E6C887]/10"
              >
                Completa profilo
              </button>
            </div>
          )}

          {/* HOME VIEW */}
          {activeView === 'home' && (
            <>
              <div className="grid gap-6 lg:grid-cols-3">
                <section className="lg:col-span-1">
                  <h2 className={SECTION_TITLE}>
                    <User className="h-4 w-4 text-[#5AB0F0]" /> Profilo Studente
                  </h2>
                  <div className={`${CARD} profile-card space-y-3 p-5`}>
                    <div className="flex items-center gap-2 border-b border-white/10 pb-3">
                      <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-emerald-400">Carriera Attiva</p>
                        <p className="profile-secondary text-[11px] text-slate-400">Dati acquisiti da Segrepass; il portale ufficiale resta la fonte valida.</p>
                      </div>
                    </div>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <dt className="profile-label text-slate-400">Matricola</dt>
                        <dd className="profile-value font-mono font-bold text-white">{matricola || '—'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="profile-label text-slate-400">Codice Corso</dt>
                        <dd className="profile-value font-mono font-bold text-white">{codiceCorso || '—'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="profile-label text-slate-400">Anno di Corso</dt>
                        <dd className="profile-value font-semibold text-white">
                          {annoCorso ? `${annoCorso}° Anno` : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="profile-label text-slate-400">Coorte</dt>
                        <dd className="profile-value font-semibold text-white">{coorte}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="profile-label text-slate-400">Canale</dt>
                        <dd className="profile-value font-semibold text-white">{canale}</dd>
                      </div>
                    </dl>
                  </div>
                </section>

                <section className="lg:col-span-2">
                  <h2 className={SECTION_TITLE}>
                    <TrendingUp className="h-4 w-4 text-[#5AB0F0]" /> Metriche Carriera
                  </h2>
                  <div className={`${CARD} metric-card overflow-hidden`}>
                    <div className="grid grid-cols-1 divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                      <div className="space-y-1 p-4">
                        <p className="metric-label flex items-center gap-1.5 text-xs text-slate-400">
                          <Award className="h-3.5 w-3.5 text-[#5AB0F0]" /> Media Ponderata
                        </p>
                        <p className="metric-value metric-average text-2xl font-bold text-[#5AB0F0]">{mediaPond}</p>
                        <p className="metric-secondary text-[11px] text-slate-500">Aritmetica: {mediaArit}</p>
                      </div>
                      <div className="space-y-1 p-4">
                        <p className="metric-label flex items-center gap-1.5 text-xs text-slate-400">
                          <GraduationCap className="h-3.5 w-3.5 text-[#B9A2F5]" /> Base Laurea stimata
                        </p>
                        <p className="metric-value metric-degree text-2xl font-bold text-[#B9A2F5]">
                          {baseLaurea}
                          <span className="metric-secondary text-sm font-normal text-slate-500">/110</span>
                        </p>
                      </div>
                      <div className="space-y-1 p-4">
                        <p className="metric-label flex items-center gap-1.5 text-xs text-slate-400">
                          <BookOpen className="h-3.5 w-3.5 text-[#E0B25A]" /> CFU Acquisiti
                        </p>
                        <p className="metric-value metric-credits text-2xl font-bold text-[#E0B25A]">
                          {cfuConseguiti}
                          <span className="metric-secondary text-sm font-normal text-slate-500"> /{cfuTotali}</span>
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2 border-t border-white/10 p-4">
                      <div className="metric-label flex justify-between text-xs text-slate-400">
                        <span>Progresso Laurea</span>
                        <span className="metric-value font-semibold text-white">{percCFU}%</span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={percCFU}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Progresso laurea"
                        className="metric-progress h-2.5 w-full overflow-hidden rounded-full bg-white/10"
                      >
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#2F7FD0] via-[#5AD0E8] to-emerald-400 transition-all duration-500"
                          style={{ width: `${percCFU}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <section className={`${CARD} p-4`} aria-label="Stato servizi">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">Stato servizi</h2>
                  <span className="text-[11px] text-slate-500">Aggiornamento in tempo reale</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  {serviceStatuses.map(({ label, ready, status }) => (
                    <div key={String(label)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-200"><span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-400' : 'bg-amber-300'}`} />{label}</div>
                      <p className="mt-1 text-[11px] text-slate-400">{status}</p>
                    </div>
                  ))}
                </div>
              </section>

              <GlobalSearchPanel
                exams={listaEsami}
                bookings={displayedPrenotazioni}
                courses={(data?.pianoDiStudiRaw || []) as PlanCourse[]}
                teachers={docentiSubscriptions}
                onNavigate={view => setActiveView(view)}
                onTeacherSelect={teacher => { setTeacherFromSearch(teacher); setActiveView('docenti'); }}
              />

              <NotificationCenter exams={displayedPrenotazioni} taxes={data?.tasse} />

              <OfficialServicesPanel services={configuredOfficialServices} />

              <section>
                <div className="flex items-center justify-between">
                  <h2 className={SECTION_TITLE}>
                    <CalendarDays className="h-4 w-4 text-[#5AB0F0]" /> {prossimoGiorno?.inCorso ? 'Lezione in corso' : 'Prossima lezione'}
                  </h2>
                  <button onClick={() => setActiveView('timetable')} className="mb-3 text-xs font-semibold text-[#5AB0F0] hover:underline flex items-center gap-1">
                    Orario completo <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                {timetableLoading && !prossimoGiorno ? (
                  <div className={`${CARD} p-4 text-xs text-slate-400`}>Caricamento orario in corso…</div>
                ) : timetableError && !prossimoGiorno ? (
                  <div className={`${CARD} p-4 text-xs text-amber-200`}>{timetableError}</div>
                ) : !prossimoGiorno ? (
                  <div className={`${CARD} p-4 text-xs text-slate-400`}>Nessuna lezione in calendario.</div>
                ) : (
                  <div className={`${CARD} ${prossimoGiorno.inCorso ? 'lesson-active-card' : 'lesson-next-card'} p-4 space-y-3 border-l-4 border-l-[#3B7BC4]`}>
                    <p className="text-sm font-bold text-white">
                      {prossimoGiorno.inCorso ? `In corso · ${formatGiornoLungo(prossimoGiorno.data)}` : prossimoGiorno.oggi ? `Oggi · ${formatGiornoLungo(prossimoGiorno.data)}` : formatGiornoLungo(prossimoGiorno.data)}
                    </p>
                    <ul className="divide-y divide-white/10">
                      {prossimoGiorno.lezioni.map((e, idx) => (
                        <li key={`${e.startTime}-${idx}`} className="grid gap-1 py-2 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
                          <span className="text-xs font-semibold text-[#5AB0F0]">
                            {e.startTime}{e.endTime ? ` – ${e.endTime}` : ''}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold text-white">{e.courseName}</span>
                            <span className="block truncate text-[11px] text-slate-300">
                              {e.teachers?.length ? e.teachers.join(', ') : 'Docente non indicato'}
                            </span>
                          </span>
                          <span className="text-[11px] text-slate-400">
                            📍 {e.room || 'Aula non indicata'}{e.campus ? ` · ${e.campus}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h2 className={SECTION_TITLE}>
                    <CalendarCheck className="h-4 w-4 text-[#5AB0F0]" /> Prossimi Appelli & Prenotazioni
                  </h2>
                  <button onClick={() => setActiveView('prenotazioni')} className="mb-3 text-xs font-semibold text-[#5AB0F0] hover:underline flex items-center gap-1">
                    Vedi tutte ({listaPrenotazioni.length}) <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                {prossimePrenotazioni.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {prossimePrenotazioni.slice(0, 3).map((p: Prenotazione, idx: number) => (
                      <div key={idx} className={`${CARD} p-4 space-y-2 border-l-4 ${p.isMyProfessor ? 'border-l-emerald-400' : 'border-l-[#3B7BC4]'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-bold text-white">{p.materia}</span>
                          {p.isMyProfessor && (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 shrink-0">
                              <UserCheck className="h-3 w-3" /> Tuo Docente
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300">Prof. {p.docente || 'Non specificato'}</p>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-white/10">
                          <span>📅 {formatDate(p.dataAppello)} {p.ora ? `• ${p.ora}` : ''}</span>
                          {p.aula && <span>📍 {p.aula}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`${CARD} p-4 text-center text-xs text-slate-400`}>
                    {appelliState.status === 'loading' ? 'Appelli in preparazione…' : appelliState.status === 'error' ? 'Lettura appelli Segrepass non riuscita. Puoi riprovare l’aggiornamento.' : 'Nessuna prenotazione d’esame attiva al momento.'}
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h2 className={SECTION_TITLE}>
                    <CreditCard className="h-4 w-4 text-[#5AB0F0]" /> Situazione Tasse
                  </h2>
                  <button onClick={() => setActiveView('taxes')} className="mb-3 text-xs font-semibold text-[#5AB0F0] hover:underline flex items-center gap-1">
                    Vedi dettaglio <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                {(taxesState.status === 'loading' || taxesUnavailable) && !taxesObj && (
                  <div className={`${CARD} p-4 text-center text-xs text-slate-400`}>
                    {taxesUnavailable ? 'Lettura tasse non riuscita. Riprova l’aggiornamento.' : 'Dati tasse in preparazione…'}
                  </div>
                )}
                <div className={`grid gap-4 sm:grid-cols-3 ${(taxesState.status === 'loading' || taxesUnavailable) && !taxesObj ? 'hidden' : ''}`}>
                  <div className={`${CARD} p-4 flex items-center gap-3`}>
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400 shrink-0">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Totale Versato</p>
                      <p className="text-lg font-bold text-emerald-400">{formatEuro(totalPaid)}</p>
                    </div>
                  </div>
                  <div className={`${CARD} p-4 flex items-center gap-3`}>
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/15 text-amber-400 shrink-0">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">In Debito / Da Pagare</p>
                      <p className="text-lg font-bold text-amber-400">{formatEuro(totalPending)}</p>
                    </div>
                  </div>
                  <div className={`${CARD} p-4 flex items-center gap-3`}>
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/15 text-[#5AB0F0] shrink-0">
                      <Clock className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Prossima Scadenza</p>
                      <p className="text-sm font-bold text-white">{formatDate(nextDeadline)}</p>
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-3">
                {[
                  { id: 'agenda' as const, title: 'Agenda', text: 'Lezioni, appelli e scadenze in un calendario', cta: 'Apri Agenda', icon: CalendarRange },
                  { id: 'timetable' as const, title: 'Orario Lezioni', text: 'Consulta aule, orari e docenti', cta: 'Apri Orario', icon: CalendarDays },
                  { id: 'plan' as const, title: 'Piano di Studi', text: 'Esami superati e materie da sostenere', cta: 'Apri Piano', icon: ClipboardList },
                  { id: 'docenti' as const, title: 'Avvisi Docenti', text: 'Bacheche, ricevimenti e contatti', cta: 'Apri Avvisi', icon: Megaphone },
                ].map(({ id, title, text, cta, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveView(id)}
                    className={`${CARD} group flex items-center gap-4 p-5 text-left transition hover:border-[#5AB0F0]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5AB0F0]`}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#2F7FD0]/20 text-[#5AB0F0]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-white">{title}</span>
                      <span className="block truncate text-xs text-slate-400">{text}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium text-[#5AB0F0]">
                      {cta}
                      <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* PRENOTAZIONI VIEW */}
          {activeView === 'agenda' && (
            <AgendaView
              lessons={timetableEvents}
              exams={displayedPrenotazioni}
              taxes={data?.tasse}
              timetableLoading={timetableLoading}
              timetableError={timetableError}
            />
          )}

          {activeView === 'deadlines' && (
            <DeadlineView exams={prenotazioniFiltrate} taxes={data?.tasse} />
          )}

          {activeView === 'prenotazioni' && (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Prenotazione Esami & Appelli</h2>
                  <p className="text-xs text-slate-400">
                    Appelli su Segrepass e prenotazioni dal portale Docenti, incluse quelle passate
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Cerca materia o docente..."
                    value={searchPrenotazione}
                    onChange={(e) => setSearchPrenotazione(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-400 focus:border-[#5AB0F0] focus:outline-none"
                  />
                </div>
              </div>

              {appelliState.status === 'error' && (
                <div role="status" className={`${CARD} border-amber-500/30 p-3 text-xs text-amber-200`}>
                  <p>Lettura appelli Segrepass non riuscita. Restano visibili gli ultimi dati disponibili e le prenotazioni del portale Docenti.</p>
                  <button type="button" onClick={retrySlowData} className="mt-2 rounded border border-amber-500/40 px-2 py-1 font-semibold">Riprova lettura appelli</button>
                </div>
              )}

              <div className={`${CARD} space-y-3 p-4`} aria-label="Pianificatore esami">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Pianificatore esami</h3>
                    <p className="text-[11px] text-slate-400">Prossimi appelli ordinati per data e possibili sovrapposizioni di orario.</p>
                  </div>
                  <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-semibold text-sky-200">{examPlanner.upcoming.length} prossimi</span>
                </div>
                {examPlanner.conflicts.length > 0 && (
                  <div role="status" className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                    Possibili conflitti: {examPlanner.conflicts.map(group => group.map(item => displayMateria(item.materia)).join(' e ')).join('; ')}.
                  </div>
                )}
                {examPlanner.upcoming.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {examPlanner.upcoming.map(({ item }) => (
                      <div key={`${item.id || item.materia}-${item.dataAppello}-${item.ora || ''}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <p className="truncate text-xs font-semibold text-slate-100">{displayMateria(item.materia)}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{dataLeggibile(item.dataAppello)}{item.ora ? ` · ${item.ora}` : ''}</p>
                        {item.aula && <p className="truncate text-[11px] text-slate-500">{item.aula}</p>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-500">{appelliState.status === 'error' ? 'Le date degli appelli Segrepass non sono state aggiornate.' : 'Nessun appello futuro con data disponibile.'}</p>}
              </div>

              {prenotazioniFiltrate.length === 0 ? (
                <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>
                  {appelliState.status === 'loading' ? 'Caricamento appelli in corso...' : appelliState.status === 'error' ? 'Appelli Segrepass temporaneamente non disponibili. Riprova la lettura.' : 'Nessun appello o prenotazione trovata.'}
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[#5AB0F0]">Appelli Disponibili</h3>
                    {appelliDisponibili.length === 0 ? (
                      <div className={`${CARD} p-5 text-center text-xs text-slate-400`}>
                        {appelliState.status === 'error' ? 'Gli appelli Segrepass non sono stati aggiornati.' : 'Nessun appello aperto al momento.'}
                      </div>
                    ) : (
                      appelliPerCorso.map((group, idx) => (
                        <div key={`group-${group.title}-${idx}`} className="space-y-2 rounded-2xl border border-white/10 bg-[#071426]/50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                            <h4 className="text-sm font-bold text-white">{group.title}</h4>
                            {group.targetName && <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${group.primary ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-200'}`}>{group.hasEnrollment ? `Iscritto a: ${group.targetName}` : `Preferito: ${group.targetName}`}</span>}
                          </div>
                          {!group.primary && group.targetName && <p className="px-1 text-[11px] text-amber-200/80">L?appello del docente selezionato non risulta pubblicato; gli altri appelli sono mostrati sotto.</p>}
                          {[...(group.primary ? [group.primary] : []), ...group.alternatives].map((p, appelloIndex) => (
                            <div key={`disp-${p.id ?? appelloIndex}`} className={`flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between ${p === group.primary ? 'border-2 border-emerald-400 bg-[#0A2238]/90' : 'border border-white/10 bg-white/[0.03]'}`}>
                              <div className="min-w-0 space-y-1"><p className="text-sm font-bold text-white">Prof. {p.docente || 'Non specificato'}{p === group.primary ? ' ? docente selezionato' : ''}</p><div className="flex flex-wrap gap-3 text-[11px] text-slate-400">{p.dataAppello && <span>{dataLeggibile(p.dataAppello)}</span>}{p.ora && <span>{p.ora}</span>}{p.aula && <span>{p.aula}</span>}</div></div>
                              {p.bookingEnabled ? <button type="button" disabled={bookingId === p.id} onClick={() => void handleBookCareerExam(p)} className="shrink-0 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-[#042016] disabled:opacity-50">{bookingId === p.id ? 'Prenotazione...' : 'Prenota'}</button> : <span className="shrink-0 text-[10px] text-slate-400">Appello disponibile</span>}
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>

                  {testPrenotazioni.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[#5AB0F0]">Test e prove Docenti</h3>
                      {testPrenotazioni.map((p, idx) => (
                        <div key={`test-${p.id ?? idx}`} className={`${CARD} space-y-1.5 p-3.5`}>
                          <p className="text-sm font-semibold text-slate-100">{displayMateria(p.materia)}</p>
                          <p className="text-xs text-slate-400">
                            {p.docente}{p.dataAppello ? ` · ${dataLeggibile(p.dataAppello)}` : ''}
                          </p>
                          {p.note && <p className="text-[11px] text-slate-500">{p.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  {storicoEsami.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Storico prenotazioni Docenti</h3>
                      {storicoEsami.map((p, idx) => (
                        <div
                          key={`st-${p.id ?? idx}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3.5 opacity-60"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium text-slate-400">{displayMateria(p.materia)}</p>
                            <p className="text-[11px] text-slate-500">
                              {p.docente && p.docente !== 'Non specificato' ? `Prof. ${p.docente} · ` : ''}
                              {dataLeggibile(p.dataAppello)}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-500">
                            {isAppelloPassato(p) ? 'Passata' : 'Prenotato'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* CARRIERA & VOTI VIEW */}
          {activeView === 'career' && (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Libretto & Esami Sostenuti</h2>
                  <p className="text-xs text-slate-400">{listaEsami.length} esami verbalizzati o convalidati</p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Cerca materia o codice..."
                    value={searchExam}
                    onChange={(e) => setSearchExam(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-400 focus:border-[#5AB0F0] focus:outline-none"
                  />
                </div>
              </div>

              <div className={`${CARD} grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end`}>
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Simulatore voto</h3>
                  <p className="mt-1 text-xs text-slate-400">Stima l’effetto di un nuovo esame sulla media e sulla base di laurea.</p>
                </div>
                <label className="text-xs text-slate-400">Voto
                  <input aria-label="Voto da simulare" type="number" min="18" max="30" step="1" value={simulatorGrade} onChange={event => setSimulatorGrade(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white sm:w-24" />
                </label>
                <label className="text-xs text-slate-400">CFU
                  <input aria-label="CFU da simulare" type="number" min="1" max="30" step="1" value={simulatorCfu} onChange={event => setSimulatorCfu(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white sm:w-24" />
                </label>
                {simulatedCareer && <p className="text-xs text-emerald-300 sm:col-span-3">Media stimata: <strong>{simulatedCareer.average.toFixed(2)}</strong> · Base stimata: <strong>{simulatedCareer.base.toFixed(2)}/110</strong></p>}
              </div>

              <div className="grid gap-2 sm:gap-3">
                {esamiFiltrati.length > 0 ? (
                  esamiFiltrati.map((esame: Esame, idx: number) => {
                    const materia = esame.materia || esame.insegnamento || 'Esame';
                    const codice = esame.codice;
                    const cfu = esame.cfu || 0;
                    const voto = esame.voto;
                    const giudizio = esame.giudizio;
                    const dataEsame = esame.data || '';
                    return (
                      <div key={idx} className={`${CARD} flex items-center justify-between gap-3 p-4`}>
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm font-semibold text-slate-100">{materia}</p>
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            {codice && <span className="font-mono rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">{codice}</span>}
                            <span>{cfu} CFU</span>
                            {dataEsame && <span>{formatDate(dataEsame)}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {voto ? (
                            <span className="inline-block rounded-lg border border-[#3B7BC4]/50 bg-[#2F7FD0]/20 px-3 py-1.5 text-xs font-bold text-[#9CCBF5]">
                              {voto}/30 {esame.lode ? 'e Lode' : ''}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-700/60 bg-emerald-950/60 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {giudizio || 'IDONEO'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>
                    {loading ? 'Caricamento esami in corso...' : 'Nessun esame trovato.'}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* TASSE & PAGAMENTI VIEW */}
          {activeView === 'taxes' && (
            <section className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Tasse & Contributi Universitari</h2>
                  <p className="text-xs text-slate-400">Posizione amministrativa e scadenze PagoPA</p>
                </div>
                <div className="flex rounded-lg border border-white/10 bg-white/5 p-1 self-start sm:self-auto">
                  <button
                    onClick={() => setTaxTab('pending')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      taxTab === 'pending' ? 'bg-[#2F7FD0] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Da Pagare ({taxesUnavailable ? '—' : pendingTaxes.length})
                  </button>
                  <button
                    onClick={() => setTaxTab('paid')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                      taxTab === 'paid' ? 'bg-[#2F7FD0] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Storico Pagati ({taxesUnavailable ? '—' : paidTaxes.length})
                  </button>
                </div>
              </div>

              {taxesState.status === 'error' && (
                <div role="status" className={`${CARD} border-amber-500/30 p-3 text-xs text-amber-200`}>
                  <p>{taxesObj ? 'Lettura tasse non riuscita: stai consultando gli ultimi dati disponibili.' : 'Lettura tasse non riuscita. I pagamenti non possono essere verificati al momento.'}</p>
                  <button type="button" onClick={retrySlowData} className="mt-2 rounded border border-amber-500/40 px-2 py-1 font-semibold">Riprova lettura tasse</button>
                </div>
              )}

              {taxTab === 'pending' && (
                <div className="grid gap-3">
                  {pendingTaxes.length > 0 ? (
                    pendingTaxes.map((tax: TassaItem, idx: number) => {
                      const desc = tax.description || tax.causale || tax.descrizione || 'Contributo universitario';
                      const amount = tax.amount ?? tax.importo ?? 0;
                      const dueDate = tax.dueDate || tax.scadenzaISO || tax.scadenza;
                      const isExpired = tax.status === 'scaduto';
                      const iuv = tax.iuv || tax.paymentCode;
                      const paymentLink = safePaymentUrl(tax.paymentLink);

                      return (
                        <div key={idx} className={`${CARD} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                isExpired ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              }`}>
                                {isExpired ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                                {isExpired ? 'SCADUTO' : 'IN ATTESA'}
                              </span>
                              {tax.academicYear && <span className="text-xs text-slate-400">A.A. {tax.academicYear}</span>}
                            </div>
                            <p className="text-sm font-semibold text-white">{desc}</p>
                            {dueDate && <p className="text-xs text-slate-400">Scadenza: <span className="font-medium text-slate-200">{formatDate(dueDate)}</span></p>}
                            {iuv && <p className="text-[11px] font-mono text-slate-500">IUV / Codice: {iuv}</p>}
                          </div>
                          <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 border-t sm:border-t-0 border-white/10 pt-2 sm:pt-0">
                            <span className="text-lg font-bold text-amber-400">{formatEuro(amount)}</span>
                            {paymentLink && (
                              <a
                                href={paymentLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2F7FD0] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3D8FE2]"
                              >
                                Paga con PagoPA <ChevronRight className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>
                      {taxesState.status === 'loading' && !taxesObj
                        ? 'Dati tasse in preparazione…'
                        : taxesUnavailable
                        ? 'Tasse non disponibili in questo momento.'
                        : 'Nessuna tassa in sospeso o in debito.'}
                    </div>
                  )}
                </div>
              )}

              {taxTab === 'paid' && (
                <div className="grid gap-3">
                  {paidTaxes.length > 0 ? (
                    paidTaxes.map((tax: TassaItem, idx: number) => {
                      const desc = tax.description || tax.causale || tax.descrizione || 'Versamento universitario';
                      const amount = tax.amount ?? tax.importo ?? 0;
                      const paidAt = tax.paidAt || tax.dataPagamento;
                      const iuv = tax.iuv || tax.paymentCode;

                      return (
                        <div key={idx} className={`${CARD} p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold">
                                <CheckCircle2 className="h-3 w-3" /> PAGATO
                              </span>
                              {tax.academicYear && <span className="text-xs text-slate-400">A.A. {tax.academicYear}</span>}
                            </div>
                            <p className="text-sm font-semibold text-white">{desc}</p>
                            {paidAt && <p className="text-xs text-slate-400">Data Versamento: <span className="font-medium text-slate-200">{formatDate(paidAt)}</span></p>}
                            {iuv && <p className="text-[11px] font-mono text-slate-500">IUV: {iuv}</p>}
                          </div>
                          <div className="text-right">
                            <span className="text-lg font-bold text-emerald-400">{formatEuro(amount)}</span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>
                      {taxesState.status === 'loading' && !taxesObj ? 'Dati tasse in preparazione…' : taxesUnavailable ? 'Storico versamenti non disponibile: la lettura delle tasse non è riuscita.' : 'Nessun versamento storico registrato.'}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {activeView === 'docenti' && (
              <DeferredDocentiView
              authenticated={authenticated}
              coursePrefix={codiceCorso || null}
              courseCodes={teacherCourseCodes}
              studentId={matricola}
              availableCourses={(data?.pianoDiStudiRaw || []) as PlanCourse[]}
              openProfessor={teacherFromSearch}
            />
          )}
          {activeView === 'plan' && profile && <DeferredStudyPlanView authenticated={authenticated} profile={profile} />}
          {activeView === 'timetable' && profile && <DeferredTimetableView authenticated={authenticated} profile={profile} />}
        </main>
      </div>

      <footer className="border-t border-white/10 px-4 py-5 text-center text-[11px] leading-relaxed text-slate-500 sm:px-8">
        UniDesk NA è un client indipendente e non ufficiale per studenti. I dati mostrati sono una copia di servizio: per verifiche, pagamenti e scadenze fa fede sempre il portale ufficiale.
        <span className="mt-2 block space-x-3">
          <a href="/privacy" className="text-slate-400 underline-offset-2 hover:text-white hover:underline">Privacy</a>
          <a href="/terms" className="text-slate-400 underline-offset-2 hover:text-white hover:underline">Termini d’uso</a>
          <SupportReportForm />
        </span>
      </footer>

      {/* TAB BAR (mobile) */}
      <nav
        aria-label="Sezioni"
        className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-20 grid grid-cols-7 border-t border-white/10 bg-[#061426]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {MOBILE_NAV.map(({ id, label, icon: Icon }) => {
          const selected = activeView === id;
          const short = label.split(' ')[0];
          return (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              aria-current={selected ? 'page' : undefined}
                className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[9px] transition ${
                selected ? 'text-[#5AB0F0]' : 'text-slate-400'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate max-w-[48px]">{short}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={mobileMoreOpen}
          aria-label="Apri altre sezioni"
          onClick={() => setMobileMoreOpen(current => !current)}
          className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[9px] transition ${mobileMoreOpen || ['docenti', 'timetable', 'plan'].includes(activeView) ? 'text-[#5AB0F0]' : 'text-slate-400'}`}
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="truncate max-w-[48px]">Altro</span>
        </button>
      </nav>

      {mobileMoreOpen && (
        <div className="mobile-more-overlay fixed inset-0 z-30 md:hidden" role="presentation" onClick={() => setMobileMoreOpen(false)}>
          <div className="mobile-more-sheet absolute inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] rounded-2xl border border-white/15 p-3 shadow-2xl" role="dialog" aria-label="Altre sezioni" onClick={event => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">Altre sezioni</p>
              <button type="button" onClick={() => setMobileMoreOpen(false)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-white/10">Chiudi</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.filter(({ id }) => ['docenti', 'timetable', 'plan'].includes(id)).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setActiveView(id); setMobileMoreOpen(false); }}
                  className={`mobile-more-option ${activeView === id ? 'mobile-more-option-active' : ''}`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
