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
  esami?: Esame[];
  tasse?: TassaSnapshot;
  prenotazioni?: Prenotazione[];
  mediaPonderata?: string | number;
  mediaAritmetica?: string | number;
  baseLaurea?: string | number;
  cfuAcquisiti?: number;
  cfuTotali?: number;
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
  studyYear: number;
  semester: number | null;
  channel: string;
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
  courseName?: string;
  courseCode?: string;
  professor?: string;
  section?: string;
  academicYear?: string;
};

export type BookedExamDocenti = {
  courseName?: string;
  examDate?: string;
  bookingDate?: string;
  location?: string;
  status?: string;
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

export async function fetchTimetable(token: string, filters: TimetableFilters): Promise<TimetableResponse> {
  const params = new URLSearchParams({
    studyYear: String(filters.studyYear),
    channel: filters.channel,
    ...(filters.semester ? { semester: String(filters.semester) } : {}),
    ...(filters.academicYear ? { academicYear: filters.academicYear } : {})
  });
  return fetchWithAuth(apiUrl(`/api/timetable?${params.toString()}`), token) as Promise<TimetableResponse>;
}

/* ------------------------------------------------------------------ */
/* WebDocenti                                                          */
/* Le credenziali Docenti stanno nel JWT (cifrate): il frontend non    */
/* invia mai la password. Il backend risponde { success, <campo> } e   */
/* qui si estrae l'array corrispondente.                               */
/* ------------------------------------------------------------------ */

export async function fetchDocentiAnnouncements(token: string): Promise<DocenteAnnouncementGroup[]> {
  const res = (await fetchWithAuth(apiUrl('/api/docenti/announcements'), token)) as {
    announcements?: DocenteAnnouncementGroup[];
  };
  return Array.isArray(res.announcements) ? res.announcements : [];
}

export async function fetchDocentiSubscriptions(token: string): Promise<SubscriptionDocenti[]> {
  const res = (await fetchWithAuth(apiUrl('/api/docenti/subscriptions'), token)) as {
    subscriptions?: SubscriptionDocenti[];
  };
  return Array.isArray(res.subscriptions) ? res.subscriptions : [];
}

export async function fetchDocentiBookedExams(token: string): Promise<BookedExamDocenti[]> {
  const res = (await fetchWithAuth(apiUrl('/api/docenti/booked-exams'), token)) as {
    bookedExams?: BookedExamDocenti[];
  };
  return Array.isArray(res.bookedExams) ? res.bookedExams : [];
}
