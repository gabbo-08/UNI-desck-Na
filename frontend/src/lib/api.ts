// src/lib/api.ts

export type CredenzialiSegrepass = {
  codiceFiscale: string;
  password: string;
  /** Email istituzionale (@studenti.unina.it), necessaria per il portale Docenti. */
  email?: string;
  /** Opt-in esplicito per inviare la credenziale anche al portale Docenti. */
  enableDocentiSync?: boolean;
};

export type Anagrafica = {
  matricola?: string | null;
  nomeCompleto?: string;
  corsoDiLaurea?: string;
  codiceCorso?: string;
  annoCorso?: number;
  annoImmatricolazione?: number;
};

export type ProfiloDocente = {
  id: string;
  nome: string;
  ruolo?: string | null;
  email?: string | null;
  telefono?: string | null;
  paginaWeb?: string | null;
  fotoUrl?: string | null;
};

export type MaterialeDocente = {
  id: string;
  nome: string;
  tipo: 'cartella' | 'file';
  url?: string | null;
  folderId?: string | null;
  section?: 'areapubb' | 'aree-ftp' | 'arearis' | null;
  children?: MaterialeDocente[];
  percorso?: string | null;
};

export type AppelloDocente = {
  id: string;
  insegnamento: string;
  dataEsame: string;
  inizioPrenotazione?: string | null;
  finePrenotazione?: string | null;
  prenotato: boolean;
  courseCode?: string | null;
};

export type IscrizioneDocente = {
  insegnamento: string;
  iscritto: boolean;
  courseCode?: string | null;
};

export type RicevimentoDocente = {
  giorno?: string | null;
  orario?: string | null;
  luogo?: string | null;
  note?: string | null;
};

export type DettaglioDocente = {
  profilo: ProfiloDocente;
  materiali: {
    pubblico: MaterialeDocente[];
    ftp: MaterialeDocente[];
    riservato: MaterialeDocente[];
  };
  ricevimento?: RicevimentoDocente[];
  appelli: AppelloDocente[];
  iscrizioni: IscrizioneDocente[];
};

export type Esame = {
  codice?: string | null;
  materia?: string;
  insegnamento?: string;
  voto?: number | null;
  giudizio?: string | null;
  lode?: boolean;
  cfu: number;
  data?: string | null;
};

export type TassaItem = {
  codice?: string;
  descrizione?: string;
  causale?: string;
  description?: string;
  importo?: number;
  amount?: number;
  scadenza?: string;
  scadenzaISO?: string;
  dueDate?: string;
  paidAt?: string;
  dataPagamento?: string;
  stato?: string;
  status?: string;
  academicYear?: string;
  iuv?: string;
  paymentCode?: string;
  paymentLink?: string;
};

export type TassaSnapshot = {
  paid?: TassaItem[];
  pagati?: TassaItem[];
  pending?: TassaItem[];
  inDebito?: TassaItem[];
  summary?: {
    totalPaid?: number;
    totalPending?: number;
    nextDeadline?: string | null;
  };
};

export type Prenotazione = {
  id?: string;
  materia?: string;
  docente?: string;
  dataAppello?: string;
  ora?: string;
  inizioPrenotazione?: string | null;
  finePrenotazione?: string | null;
  aula?: string;
  isMyProfessor?: boolean;
  note?: string;
  annopri?: string | null;
  numAppello?: string | null;
  bookingAction?: string | null;
  bookingMethod?: string;
  bookingEnabled?: boolean;
};

export type Metriche = {
  anagrafica?: Anagrafica;
  pin?: string | null;
  codiceNumericoPersonale?: string | null;
  esami?: Esame[];
  tasse?: TassaSnapshot;
  prenotazioni?: Prenotazione[];
  mediaPonderata?: string | number;
  mediaAritmetica?: string | number;
  baseLaurea?: string | number;
  cfuAcquisiti?: number;
  cfuTotali?: number;
  pianoDiStudiRaw?: PlanCourse[];
};

export type GlobalUserState = {
  authenticated: boolean;
  profile: ProfiloStudente | null;
  metriche: Metriche | null;
  pin: string | null;
};

export type ProfiloStudente = {
  id?: string;
  matricola?: string | null;
  name?: string;
  courseName?: string;
  courseId?: string;
  cohortYear?: number;
  currentCourseYear?: number;
  channel?: string;
  surnameInitial?: string;
};

export type ProfiloRecord = ProfiloStudente & {
  course_name?: string | null;
  course_id?: string | null;
  cohort_year?: number | null;
  current_course_year?: number | null;
  surname_initial?: string | null;
  updated_at?: string;
};

export type PlanCourse = {
  id: number;
  courseCode?: string;
  courseName: string;
  course_name?: string;
  cfu: number;
  studyYear?: number;
  study_year?: number;
  year?: number;
  semester?: number;
  courseType?: string;
  course_type?: string;
  electiveRequiredCfu?: number;
  elective_required_cfu?: number;
  prerequisites?: string[];
};

export type CareerPlanCourse = PlanCourse & {
  course_name?: string;
  study_year?: number;
  status?: string;
  matchMethod?: string;
  selected?: boolean;
  passedExam?: Esame | null;
  prerequisites?: string[];
};

export type ElectiveGroup = {
  id: string;
  requiredCfu: number;
  passedCfu: number;
  selectedPendingCfu: number;
  remainingCfu: number;
  courses: CareerPlanCourse[];
};

export type CareerPlan = {
  profile?: ProfiloRecord;
  plan?: {
    courseName?: string;
    course_name?: string;
    source_name?: string | null;
    source_url?: string | null;
  };
  courses: CareerPlanCourse[];
  electiveGroups: ElectiveGroup[];
  summary: {
    passedCourses: number;
    missingCourses: number;
    reviewCourses: number;
    mandatoryMissingCfu: number;
    electiveRemainingCfu: number;
  };
};

export type StudyPlan = {
  plan?: { courseName?: string; course_name?: string };
  courses: PlanCourse[];
  selectedElectiveIds?: number[];
};

export type TimetableFilters = {
  studyYear?: number;
  semester?: number | null;
  channel?: string;
  academicYear?: string;
};

export type TimetableEvent = {
  date: string | null;
  dateTime?: string;
  startTime?: string | null;
  endTime?: string | null;
  courseName?: string;
  teachers?: string[];
  room?: string | null;
  campus?: string | null;
  enrollmentStatus?: 'confirmed' | 'different_teacher' | 'not_enrolled';
  enrolledProfessor?: string | null;
};

export type Timetable = {
  academicYear?: string;
  course?: string;
  channel?: string;
  events: TimetableEvent[];
};

export type TimetableResponse = {
  filters?: TimetableFilters;
  timetable: Timetable;
  fromCache?: boolean;
  cachedAt?: number;
};

export type DocenteAnnouncementItem = {
  id: string;
  title: string;
  content: string;
  date?: string | null;
  category?: string | null;
  link?: string | null;
};

export type DocenteAnnouncementGroup = {
  professor?: string;
  slug?: string;
  courseName?: string;
  isFavorite?: boolean;
  announcementLoading?: boolean;
  announcementError?: boolean;
  items: DocenteAnnouncementItem[];
  latestDate?: number;
  count?: number;
};

export type SubscriptionDocenti = {
  professorId?: string;
  courseName?: string;
  courseCode?: string;
  professor?: string;
  section?: string;
  academicYear?: string;
  isFavorite?: boolean;
  preferenceId?: number;
};

export type BookedExamDocenti = {
  courseName?: string;
  examName?: string;
  materia?: string;
  name?: string;
  descrInse?: string;
  professor?: string;
  docente?: string;
  cognomeDocente?: string;
  examDate?: string;
  dataAppello?: string;
  bookingDate?: string;
  inizioPrenotazione?: string | null;
  finePrenotazione?: string | null;
  location?: string;
  aula?: string;
  room?: string;
  status?: string;
};

export type GroupDocenti = {
  name?: string;
  courseName?: string;
  professor?: string;
  academicYear?: string;
  status?: string;
};

export type TestDocenti = {
  name?: string;
  courseName?: string;
  professor?: string;
  group?: string;
  date?: string;
  status?: string;
};

export type DocentiSummary = {
  announcements: DocenteAnnouncementGroup[];
  subscriptions: SubscriptionDocenti[];
  bookedExams: BookedExamDocenti[];
  groups: GroupDocenti[];
  tests: TestDocenti[];
  meta?: { refreshing?: boolean; fetchedAt?: string | null; stale?: boolean };
};

export type DocentiTeacherSearchResult = { id: string; name: string; role?: string | null };
export type ProfessorPreference = { id: number; courseKey: string; courseCode?: string | null; courseName: string; professorId: string; professorName: string; createdAt: string };

export type ProfileUpdatePayload = {
  courseId?: string;
  courseName?: string;
  cohortYear?: number;
  currentCourseYear?: number;
  channel?: string;
  surnameInitial?: string;
  selectedElectiveIds?: number[];
};

export type ProfileUpdateResponse = {
  profile: ProfiloRecord;
  selectedElectiveIds: number[];
  onboardingRequired: boolean;
};

export type SlowSyncStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SlowData = {
  status: SlowSyncStatus;
  error?: string | null;
  updatedAt?: number | null;
  taxes?: TassaSnapshot | null;
  prenotazioni?: Prenotazione[];
};

export type LoginResponse = {
  authenticated: true;
  profileId: string;
  profile: ProfiloRecord;
  onboardingRequired: boolean;
  metriche: Metriche;
  docentiReason?: string | null;
  docentiLoading?: boolean;
};

export type RestoreSessionResponse = {
  authenticated: true;
  profile: ProfiloRecord;
  onboardingRequired: boolean;
};

export type BootstrapResponse = RestoreSessionResponse & {
  metriche: Metriche;
  sync?: {
    slow?: { state?: SlowSyncStatus; finishedAt?: number; startedAt?: number };
    docenti?: { enabled?: boolean; available?: boolean; fetchedAt?: number | null; stale?: boolean };
    fromCache?: boolean;
  };
};

/* ------------------------------------------------------------------ */
/* Errori                                                              */
/* ------------------------------------------------------------------ */

/**
 * Errore di una chiamata al backend. `status` è il codice HTTP, oppure 0 se il
 * backend non è raggiungibile (rete assente, server spento, CORS).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/** Sessione scaduta o token non valido: serve un nuovo login. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof Error && error.message === 'SESSION_EXPIRED';
}

/**
 * Il backend funziona ma un servizio esterno (EasyAcademy, Segrepass, Docenti)
 * non risponde, oppure il backend stesso non è raggiungibile.
 * Sono i casi in cui ha senso mostrare l'ultima copia salvata.
 */
function defaultErrorMessage(status: number): string {
  if (status === 424 || status === 502 || status === 503 || status === 504) {
    return 'Servizio esterno temporaneamente non disponibile. Riprova tra poco.';
  }
  if (status >= 500) return 'Errore interno del server.';
  return 'Errore di comunicazione con il server.';
}

/* ------------------------------------------------------------------ */
/* Pulizia delle vecchie cache locali sensibili                        */
/* ------------------------------------------------------------------ */

// Rimuove i dati personali salvati dalle versioni precedenti dell'app.
const CACHE_PREFIX = 'segrepass:cache:';
const LEGACY_CACHE_PREFIX = 'segrepass:docenti-summary';

/** Cancella dal dispositivo le copie locali dei dati personali. Chiamata al logout. */
export function clearClientCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key && (key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX))) {
        storage.removeItem(key);
      }
    }
  } catch {
    /* storage non disponibile */
  }
}

// Non cancellare la cache all'import del modulo: il caricamento della pagina
// avviene a ogni riapertura della PWA e una pulizia automatica qui eliminava
// proprio i dati che l'utente aveva scelto di conservare sul dispositivo.
// La pulizia resta esplicita su logout/cancellazione account.

/* ------------------------------------------------------------------ */
/* Base                                                                */
/* ------------------------------------------------------------------ */

const BOOTSTRAP_CACHE_KEY = 'segrepass:cache:bootstrap:v1';

export type CachedBootstrapSnapshot = {
  savedAt: number;
  profile: ProfiloRecord;
  onboardingRequired: boolean;
  docentiEnabled: boolean;
  metriche: Metriche | null;
};

export function readBootstrapCache(): CachedBootstrapSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBootstrapSnapshot;
    if (!parsed || typeof parsed !== 'object' || !parsed.profile) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBootstrapCache(snapshot: Omit<CachedBootstrapSnapshot, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({ ...snapshot, savedAt: Date.now() }));
  } catch {
    /* storage non disponibile */
  }
}

const API_BASE = (
  typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? ''
    : (process.env.NEXT_PUBLIC_BACKEND_URL || '')
).trim().replace(/\/+$/, '');
const API_TIMEOUT_MS = 260_000;

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function teacherPhotoUrl(teacherId: string): string {
  return apiUrl(`/api/docenti/teacher/${encodeURIComponent(teacherId)}/photo`);
}

function jsonHeaders(options: RequestInit = {}): Headers {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return headers;
}

async function fetchWithAuthUncached(url: string, options: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers: jsonHeaders(options),
      signal: options.signal || AbortSignal.timeout(API_TIMEOUT_MS)
    });
  } catch (error) {
    // Se il chiamante ha annullato la richiesta, l'annullamento passa invariato.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Server non raggiungibile. Controlla la connessione.', 0, 'NETWORK');
  }

  // Un proxy o un 502 possono rispondere con HTML: in quel caso il corpo è vuoto.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'SESSION_EXPIRED') {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('segrepass:session-expired'));
      throw new ApiError('SESSION_EXPIRED', res.status, 'SESSION_EXPIRED');
    }
    throw new ApiError(data?.error || data?.message || defaultErrorMessage(res.status), res.status, data?.code);
  }
  return data;
}

// Deduplicate simultaneous read requests (for example dashboard + mobile
// navigation mounting together) without caching personal data in the browser.
const inFlightReads = new Map<string, Promise<unknown>>();

function fetchWithAuth(url: string, options: RequestInit = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET' || options.signal) return fetchWithAuthUncached(url, options);
  const existing = inFlightReads.get(url);
  if (existing) return existing;
  const request = fetchWithAuthUncached(url, options).finally(() => {
    if (inFlightReads.get(url) === request) inFlightReads.delete(url);
  });
  inFlightReads.set(url, request);
  return request;
}

/* ------------------------------------------------------------------ */
/* Autenticazione                                                      */
/* ------------------------------------------------------------------ */

export async function loginAPI(credentials: CredenzialiSegrepass): Promise<LoginResponse> {
  return fetchWithAuth(apiUrl('/api/auth/login'), {
    method: 'POST',
    body: JSON.stringify(credentials)
  }) as Promise<LoginResponse>;
}

export async function restoreSession(): Promise<RestoreSessionResponse | null> {
  try {
    return await fetchWithAuth(apiUrl('/api/auth/session')) as RestoreSessionResponse;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function fetchBootstrap(options: { timeoutMs?: number } = {}): Promise<BootstrapResponse | null> {
  try {
    const signal = options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined;
    return await fetchWithAuth(apiUrl('/api/auth/bootstrap'), { signal }) as BootstrapResponse;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function logoutAPI(): Promise<void> {
  clearClientCache();
  await fetchWithAuth(apiUrl('/api/auth/logout'), {
    method: 'POST',
  }).catch(() => undefined);
}

export async function deleteAccountAPI(): Promise<void> {
  clearClientCache();
  await fetchWithAuth(apiUrl('/api/auth/account'), { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Carriera                                                            */
/* ------------------------------------------------------------------ */

export async function fetchMetriche(options: { refresh?: boolean } = {}): Promise<Metriche> {
  return fetchWithAuth(apiUrl(`/api/metriche${options.refresh ? '?refresh=1' : ''}`)) as Promise<Metriche>;
}

export async function fetchSlowData(): Promise<SlowData> {
  return fetchWithAuth(apiUrl('/api/career/slow-data')) as Promise<SlowData>;
}

export async function fetchStudyPlan(courseId: string, cohortYear: number): Promise<StudyPlan> {
  return fetchWithAuth(
    apiUrl(`/api/study-plans/${encodeURIComponent(courseId)}/${encodeURIComponent(String(cohortYear))}`)
  ) as Promise<StudyPlan>;
}

export async function updateProfile(profileData: ProfileUpdatePayload): Promise<ProfileUpdateResponse> {
  return fetchWithAuth(apiUrl('/api/profile'), {
    method: 'PUT',
    body: JSON.stringify(profileData)
  }) as Promise<ProfileUpdateResponse>;
}

export async function fetchCareerPlan(): Promise<CareerPlan> {
  return fetchWithAuth(apiUrl('/api/career-plan')) as Promise<CareerPlan>;
}

/* ------------------------------------------------------------------ */
/* Orario (EasyAcademy)                                                */
/* ------------------------------------------------------------------ */

function normalizeTimetable(res: unknown): TimetableResponse {
  const raw = (res ?? {}) as Partial<TimetableResponse>;
  const events = Array.isArray(raw.timetable?.events) ? raw.timetable!.events : [];
  return { ...raw, timetable: { ...raw.timetable, events } } as TimetableResponse;
}

/**
 * I dati personali non vengono conservati nel browser: gli errori arrivano al chiamante.
 */
export async function fetchTimetable(
  filters: TimetableFilters = {},
  options: { refresh?: boolean } = {}
): Promise<TimetableResponse> {
  // Senza parametri il backend usa anno, canale e corso del profilo.
  const params = new URLSearchParams();
  if (filters.studyYear !== undefined) params.set('studyYear', String(filters.studyYear));
  if (filters.semester) params.set('semester', String(filters.semester));
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.academicYear) params.set('academicYear', filters.academicYear);

  if (options.refresh) params.set('refresh', '1');
  const query = params.toString();
  const res = await fetchWithAuth(apiUrl(`/api/timetable${query ? `?${query}` : ''}`));
  return normalizeTimetable(res);
}

/* ------------------------------------------------------------------ */
/* WebDocenti                                                          */
/* Le credenziali Docenti restano cifrate nel database server-side.    */
/* Il browser invia solo il cookie HttpOnly e riceve i DTO dell'API.    */
/* o con l'oggetto.                                                    */
/* ------------------------------------------------------------------ */

async function fetchDocentiList<T>(path: string, wrapperKey: string): Promise<T[]> {
  const res = await fetchWithAuth(apiUrl(path));
  // Gestisce sia il ritorno diretto dell'array che il wrap nell'oggetto { [wrapperKey]: [] }
  if (Array.isArray(res)) return res as T[];
  return Array.isArray(res?.[wrapperKey]) ? (res[wrapperKey] as T[]) : [];
}

export function fetchDocentiAnnouncements(): Promise<DocenteAnnouncementGroup[]> {
  return fetchDocentiList<DocenteAnnouncementGroup>('/api/docenti/announcements', 'announcements');
}

export function fetchDocentiSubscriptions(): Promise<SubscriptionDocenti[]> {
  return fetchDocentiList<SubscriptionDocenti>('/api/docenti/subscriptions', 'subscriptions');
}

export function fetchDocentiBookedExams(): Promise<BookedExamDocenti[]> {
  return fetchDocentiList<BookedExamDocenti>('/api/docenti/booked-exams', 'bookedExams');
}

export function fetchDocentiGroups(): Promise<GroupDocenti[]> {
  return fetchDocentiList<GroupDocenti>('/api/docenti/groups', 'groups');
}

export function fetchDocentiTests(): Promise<TestDocenti[]> {
  return fetchDocentiList<TestDocenti>('/api/docenti/tests', 'tests');
}

function normalizeDocentiSummary(value: unknown): DocentiSummary {
  const v = (value ?? {}) as Partial<DocentiSummary>;
  return {
    announcements: Array.isArray(v.announcements) ? v.announcements : [],
    subscriptions: Array.isArray(v.subscriptions) ? v.subscriptions : [],
    bookedExams: Array.isArray(v.bookedExams) ? v.bookedExams : [],
    groups: Array.isArray(v.groups) ? v.groups : [],
    tests: Array.isArray(v.tests) ? v.tests : [],
    meta: v.meta
  };
}

/**
 * Non persiste le risposte Docenti nel browser.
 */
export async function fetchDocentiSummary(options: { refresh?: boolean } = {}): Promise<DocentiSummary> {
  const res = await fetchWithAuth(apiUrl(`/api/docenti/summary${options.refresh ? '?refresh=1' : ''}`));
  return normalizeDocentiSummary(res);
}

export type DocentiStatus = {
  enabled: boolean;
  state: 'ready' | 'stale' | 'refreshing' | 'disconnected' | 'disabled';
  refreshing?: boolean;
  stale?: boolean;
  fetchedAt?: string | null;
  canReconnect?: boolean;
};

export async function fetchDocentiStatus(): Promise<DocentiStatus> {
  return fetchWithAuth(apiUrl('/api/docenti/status')) as Promise<DocentiStatus>;
}

export async function reconnectDocenti(): Promise<{ connected: boolean; status: DocentiStatus }> {
  return fetchWithAuth(apiUrl('/api/docenti/reconnect'), { method: 'POST', body: JSON.stringify({}) }) as Promise<{ connected: boolean; status: DocentiStatus }>;
}

export async function fetchPushVapidKey(): Promise<{ configured: boolean; publicKey?: string }> {
  try {
    return await fetchWithAuth(apiUrl('/api/notifications/vapid-public-key')) as Promise<{ configured: boolean; publicKey?: string }>;
  } catch (error) {
    // Il backend usa 503 per segnalare esplicitamente che il canale push è
    // disabilitato. Non trasformarlo in un generico errore di rete nella UI:
    // i promemoria locali possono comunque funzionare.
    if (error instanceof ApiError && error.code === 'PUSH_NOT_CONFIGURED') {
      return { configured: false };
    }
    throw error;
  }
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  await fetchWithAuth(apiUrl('/api/notifications/subscribe'), {
    method: 'POST',
    body: JSON.stringify({ subscription })
  });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await fetchWithAuth(apiUrl('/api/notifications/subscribe'), {
    method: 'DELETE',
    body: JSON.stringify({ endpoint })
  });
}

export async function sendPushTest(): Promise<{ sent: number; subscriptions: number }> {
  return fetchWithAuth(apiUrl('/api/notifications/test'), { method: 'POST', body: JSON.stringify({}) }) as Promise<{ sent: number; subscriptions: number }>;
}

export async function fetchFavoriteAnnouncements(): Promise<DocenteAnnouncementGroup[]> {
  const result = await fetchWithAuth(apiUrl('/api/docenti/favorite-announcements'));
  return Array.isArray(result) ? result : [];
}

export async function searchDocentiTeachers(query: string): Promise<DocentiTeacherSearchResult[]> {
  const result = await fetchWithAuth(apiUrl(`/api/docenti/teachers/search?q=${encodeURIComponent(query)}`));
  return Array.isArray(result) ? result : [];
}
export async function fetchProfessorPreferences(): Promise<ProfessorPreference[]> {
  const result = await fetchWithAuth(apiUrl('/api/docenti/preferences'));
  return Array.isArray(result) ? result : [];
}
export async function saveProfessorPreference(value: Omit<ProfessorPreference, 'id' | 'courseKey' | 'createdAt'>): Promise<ProfessorPreference> {
  return fetchWithAuth(apiUrl('/api/docenti/preferences'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}
export async function deleteProfessorPreference(id: number): Promise<void> {
  await fetchWithAuth(apiUrl(`/api/docenti/preferences/${id}`), { method: 'DELETE' });
}

export type SupportReportCategory = 'bug' | 'materiali' | 'docenti' | 'carriera' | 'privacy' | 'altro';

export async function submitSupportReport(payload: {
  category: SupportReportCategory;
  description: string;
  context?: { screen?: string; appVersion?: string; route?: string; code?: string };
}): Promise<{ accepted: boolean; reportId: string }> {
  return fetchWithAuth(apiUrl('/api/support/report'), {
    method: 'POST',
    body: JSON.stringify(payload)
  }) as Promise<{ accepted: boolean; reportId: string }>;
}

export async function fetchTeacherDetail(
  professorIdentifier: string,
  course?: string | null
): Promise<DettaglioDocente> {
  const query = course ? `?course=${encodeURIComponent(course)}` : '';
  return fetchWithAuth(apiUrl(`/api/docenti/teacher/${encodeURIComponent(professorIdentifier)}${query}`)) as Promise<DettaglioDocente>;
}

export async function fetchTeacherFolder(
  teacherId: string,
  folderId: string,
  section: 'areapubb' | 'aree-ftp' | 'arearis',
  course?: string | null
): Promise<unknown[]> {
  const query = new URLSearchParams({ section });
  if (course) query.set('course', course);
  const res = await fetchWithAuth(
    apiUrl(`/api/docenti/teacher/${encodeURIComponent(teacherId)}/folder/${encodeURIComponent(folderId)}?${query}`)
  );
  return Array.isArray(res?.items) ? res.items : [];
}

export function teacherMaterialUrl(
  teacherId: string,
  folderId: string,
  fileId: string,
  section: 'areapubb' | 'aree-ftp' | 'arearis',
  course?: string | null
): string {
  const query = new URLSearchParams({ section });
  if (course) query.set('course', course);
  return apiUrl(`/api/docenti/teacher/${encodeURIComponent(teacherId)}/folder/${encodeURIComponent(folderId)}/file/${encodeURIComponent(fileId)}?${query}`);
}

/* ------------------------------------------------------------------ */
/* Prenotazioni                                                        */
/* ------------------------------------------------------------------ */

export async function fetchAllPrenotazioni(): Promise<Prenotazione[]> {
  // Le due fonti sono indipendenti: se una fallisce, l'altra si vede lo stesso.
  const [slowData, docentiExams] = await Promise.all([
    fetchSlowData().catch(() => null),
    fetchDocentiBookedExams().catch(() => [] as BookedExamDocenti[])
  ]);

  const prenotazioniSegrepass = slowData?.prenotazioni || [];

  // Mappa le prenotazioni di Docenti nel formato standard
  const prenotazioniDocentiMappate: Prenotazione[] = docentiExams.map((exam, index) => ({
    id: `docenti_${index}`,
    materia: exam.courseName || 'Esame Docenti',
    dataAppello: exam.examDate,
    aula: exam.location,
    docente: 'Da WebDocenti',
    note: exam.status ? `Stato: ${exam.status}` : undefined
  }));

  return [...prenotazioniSegrepass, ...prenotazioniDocentiMappate];
}

export async function bookCareerExam(
  appello: Pick<Prenotazione, 'annopri' | 'numAppello'>
): Promise<{ success: boolean; message?: string }> {
  return fetchWithAuth(apiUrl('/api/career/book'), {
    method: 'POST',
    body: JSON.stringify({
      annopri: appello.annopri,
      numAppello: appello.numAppello
    })
  }) as Promise<{ success: boolean; message?: string }>;
}


const PROFILE_PREFS_PREFIX = 'unidesk_profile_prefs_v1:';

export function saveProfilePrefsCache(profileId: string, profile: Partial<ProfiloRecord> | ProfiloStudente): void {
  if (typeof window === 'undefined' || !profileId) return;
  try {
    const rawProfile = profile as Record<string, unknown>;
    const payload = {
      courseId: (rawProfile.courseId ?? rawProfile.course_id ?? null) as string | null,
      courseName: (rawProfile.courseName ?? rawProfile.course_name ?? null) as string | null,
      cohortYear: (rawProfile.cohortYear ?? rawProfile.cohort_year ?? null) as number | null,
      currentCourseYear: (rawProfile.currentCourseYear ?? rawProfile.current_course_year ?? null) as number | null,
      channel: (rawProfile.channel ?? null) as string | null,
      surnameInitial: (rawProfile.surnameInitial ?? rawProfile.surname_initial ?? null) as string | null
    };
    window.localStorage.setItem(`${PROFILE_PREFS_PREFIX}${profileId.toUpperCase()}`, JSON.stringify(payload));
  } catch {}
}

export function readProfilePrefsCache(profileId?: string | null): ProfileUpdatePayload | null {
  if (typeof window === 'undefined' || !profileId) return null;
  try {
    const raw = window.localStorage.getItem(`${PROFILE_PREFS_PREFIX}${String(profileId).toUpperCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: ProfileUpdatePayload = {};
    if (parsed.courseId) out.courseId = String(parsed.courseId);
    if (parsed.courseName) out.courseName = String(parsed.courseName);
    if (parsed.cohortYear) out.cohortYear = Number(parsed.cohortYear);
    if (parsed.currentCourseYear) out.currentCourseYear = Number(parsed.currentCourseYear);
    if (parsed.channel) out.channel = String(parsed.channel);
    if (parsed.surnameInitial) out.surnameInitial = String(parsed.surnameInitial);
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
