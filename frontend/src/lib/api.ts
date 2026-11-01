
// src/lib/api.ts

export type CredenzialiSegrepass = {
  codiceFiscale: string;
  password: string;
  /** Email istituzionale (@studenti.unina.it), necessaria per il portale Docenti. */
  email?: string;
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

export type DettaglioDocente = {
  profilo: ProfiloDocente;
  materiali: {
    pubblico: MaterialeDocente[];
    ftp: MaterialeDocente[];
    riservato: MaterialeDocente[];
  };
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
  aula?: string;
  isMyProfessor?: boolean;
  note?: string;
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
  token: string | null;
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
};

export type BookedExamDocenti = {
  courseName?: string;
  descrInse?: string;
  professor?: string;
  docente?: string;
  cognomeDocente?: string;
  examDate?: string;
  dataAppello?: string;
  bookingDate?: string;
  location?: string;
  aula?: string;
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
};

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
  token: string;
  profileId: string;
  profile: ProfiloRecord;
  onboardingRequired: boolean;
  metriche: Metriche;
};

export type RestoreSessionResponse = {
  token: string;
  profile: ProfiloRecord;
  onboardingRequired: boolean;
};

const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchWithAuth(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...authHeaders(token),
      ...(options.headers || {})
    }
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('SESSION_EXPIRED');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Errore di comunicazione con il server.');
  }
  return data;
}

export async function loginAPI(credentials: CredenzialiSegrepass): Promise<LoginResponse> {
  const res = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify(credentials)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Credenziali non valide o login fallito.');
  }

  return data as LoginResponse;
}

export async function restoreSession(): Promise<RestoreSessionResponse | null> {
  const res = await fetch(apiUrl('/api/auth/session'), {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders()
  });
  if (!res.ok) return null;
  return (await res.json()) as RestoreSessionResponse;
}

export async function logoutAPI(): Promise<void> {
  await fetch(apiUrl('/api/auth/logout'), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders()
  }).catch(() => undefined);
}

export async function fetchMetriche(token: string): Promise<Metriche> {
  return fetchWithAuth(apiUrl('/api/metriche'), token) as Promise<Metriche>;
}

export async function fetchSlowData(token: string): Promise<SlowData> {
  return fetchWithAuth(apiUrl('/api/career/slow-data'), token) as Promise<SlowData>;
}

export async function fetchStudyPlan(token: string, courseId: string, cohortYear: number): Promise<StudyPlan> {
  return fetchWithAuth(
    apiUrl(`/api/study-plans/${encodeURIComponent(courseId)}/${encodeURIComponent(String(cohortYear))}`),
    token
  ) as Promise<StudyPlan>;
}

export async function updateProfile(token: string, profileData: ProfileUpdatePayload): Promise<ProfileUpdateResponse> {
  return fetchWithAuth(apiUrl('/api/profile'), token, {
    method: 'PUT',
    body: JSON.stringify(profileData)
  }) as Promise<ProfileUpdateResponse>;
}

export async function fetchCareerPlan(token: string): Promise<CareerPlan> {
  return fetchWithAuth(apiUrl('/api/career-plan'), token) as Promise<CareerPlan>;
}

export async function fetchTimetable(
  token: string,
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
  return fetchWithAuth(apiUrl(`/api/timetable${query ? `?${query}` : ''}`), token) as Promise<TimetableResponse>;
}

/* ------------------------------------------------------------------ */
/* WebDocenti                                                          */
/* Le credenziali Docenti stanno nel JWT (cifrate): il frontend non    */
/* invia mai la password. Il backend risponde direttamente con l'array */
/* o con l'oggetto.                                                    */
/* ------------------------------------------------------------------ */

export async function fetchDocentiAnnouncements(token: string): Promise<DocenteAnnouncementGroup[]> {
  const res = await fetchWithAuth(apiUrl('/api/docenti/announcements'), token);
  // Gestisce sia il ritorno diretto dell'array che il wrap nell'oggetto { announcements: [] }
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.announcements) ? res.announcements : [];
}

export async function fetchDocentiSubscriptions(token: string): Promise<SubscriptionDocenti[]> {
  const res = await fetchWithAuth(apiUrl('/api/docenti/subscriptions'), token);
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.subscriptions) ? res.subscriptions : [];
}

export async function fetchDocentiBookedExams(token: string): Promise<BookedExamDocenti[]> {
  const res = await fetchWithAuth(apiUrl('/api/docenti/booked-exams'), token);
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.bookedExams) ? res.bookedExams : [];
}

export async function fetchDocentiGroups(token: string): Promise<GroupDocenti[]> {
  const res = await fetchWithAuth(apiUrl('/api/docenti/groups'), token);
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.groups) ? res.groups : [];
}

export async function fetchDocentiTests(token: string): Promise<TestDocenti[]> {
  const res = await fetchWithAuth(apiUrl('/api/docenti/tests'), token);
  if (Array.isArray(res)) return res;
  return Array.isArray(res?.tests) ? res.tests : [];
}

export async function fetchDocentiSummary(token: string): Promise<DocentiSummary> {
  const cacheKey = `segrepass:docenti-summary:${token}`;
  if (typeof window !== 'undefined') window.localStorage.removeItem('segrepass:docenti-summary');
  const cached = typeof window !== 'undefined' ? window.localStorage.getItem(cacheKey) : null;
  const parseSummary = (value: unknown): DocentiSummary => ({
    announcements: Array.isArray((value as DocentiSummary)?.announcements) ? (value as DocentiSummary).announcements : [],
    subscriptions: Array.isArray((value as DocentiSummary)?.subscriptions) ? (value as DocentiSummary).subscriptions : [],
    bookedExams: Array.isArray((value as DocentiSummary)?.bookedExams) ? (value as DocentiSummary).bookedExams : [],
    groups: Array.isArray((value as DocentiSummary)?.groups) ? (value as DocentiSummary).groups : [],
    tests: Array.isArray((value as DocentiSummary)?.tests) ? (value as DocentiSummary).tests : []
  });
  if (cached) {
    try {
      const stale = parseSummary(JSON.parse(cached));
      void fetchWithAuth(apiUrl('/api/docenti/summary'), token)
        .then(value => {
          if (typeof window !== 'undefined') window.localStorage.setItem(cacheKey, JSON.stringify(value));
        })
        .catch(() => undefined);
      return stale;
    } catch {
      window.localStorage.removeItem(cacheKey);
    }
  }
  const res = await fetchWithAuth(apiUrl('/api/docenti/summary'), token);
  const summary = parseSummary(res);
  if (typeof window !== 'undefined') window.localStorage.setItem(cacheKey, JSON.stringify(summary));
  return summary;
}

export async function fetchTeacherDetail(
  token: string,
  professorIdentifier: string,
  course?: string | null
): Promise<DettaglioDocente> {
  const query = course ? `?course=${encodeURIComponent(course)}` : '';
  return fetchWithAuth(apiUrl(`/api/docenti/teacher/${encodeURIComponent(professorIdentifier)}${query}`), token) as Promise<DettaglioDocente>;
}

export async function fetchTeacherFolder(
  token: string,
  teacherId: string,
  folderId: string,
  section: 'areapubb' | 'aree-ftp' | 'arearis',
  course?: string | null
): Promise<unknown[]> {
  const query = new URLSearchParams({ section });
  if (course) query.set('course', course);
  const res = await fetchWithAuth(
    apiUrl(`/api/docenti/teacher/${encodeURIComponent(teacherId)}/folder/${encodeURIComponent(folderId)}?${query}`),
    token
  );
  return Array.isArray(res?.items) ? res.items : [];
}

export async function fetchAllPrenotazioni(token: string): Promise<Prenotazione[]> {
  // 1. Recupera le prenotazioni da Segrepass (tramite slow-data o metriche)
  const slowData = await fetchSlowData(token).catch(() => null);
  const prenotazioniSegrepass = slowData?.prenotazioni || [];

  // 2. Recupera le prenotazioni da WebDocenti
  const docentiExams = await fetchDocentiBookedExams(token).catch(() => []);

  // 3. Mappa le prenotazioni di Docenti nel formato standard
  const prenotazioniDocentiMappate: Prenotazione[] = docentiExams.map((exam, index) => ({
    id: `docenti_${index}`,
    materia: exam.courseName || 'Esame Docenti',
    dataAppello: exam.examDate,
    aula: exam.location,
    docente: 'Da WebDocenti',
    note: exam.status ? `Stato: ${exam.status}` : undefined
  }));

  // 4. Unisci le due liste
  return [...prenotazioniSegrepass, ...prenotazioniDocentiMappate];
}
