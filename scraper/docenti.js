const { queueScrapingTask } = require('./pool');

const DOCENTI_ORIGIN = 'https://www.docenti.unina.it';
const DOCENTI_API = `${DOCENTI_ORIGIN}/webdocenti-be`;
const DOCENTI_LOGIN_URL = `${DOCENTI_ORIGIN}/login`;
const DOCENTI_SUMMARIES_URL = `${DOCENTI_ORIGIN}/personal-area/student/summaries`;

const HTTP_TIMEOUT_MS = 8000;
const MAX_ANNOUNCEMENT_TEACHERS = 10;
const ANNOUNCEMENTS_PER_TEACHER = 20;

const PLACEHOLDER_COURSE = 'Insegnamento';
const PLACEHOLDER_PROFESSOR = 'Non specificato';

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.content)) return json.content;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.items)) return json.items;
  return [];
}

function pick(item, keys, fallback = '') {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
}

function professorName(item) {
  const nome = pick(item, ['nomeDocente', 'nome_docente', 'nome']);
  const cognome = pick(item, ['cognomeDocente', 'cognome_docente', 'cognome']);
  const full = `${nome} ${cognome}`.trim();
  if (full && full !== PLACEHOLDER_PROFESSOR) return full;

  const d = item?.docente ?? item?.professore ?? item?.titolare;
  if (d && typeof d === 'object') {
    const fullObj = `${d.nome || ''} ${d.cognome || ''}`.trim();
    if (fullObj) return fullObj;
  }
  if (typeof d === 'string' && d.trim()) return d.trim();

  return PLACEHOLDER_PROFESSOR;
}

function courseNameOf(item) {
  const raw = pick(item, [
    'descrInse', 'descrizioneCorso', 'nomeInse', 'nomeInsegnamento', 'insegnamento', 
    'denominazioneInsegnamento', 'denominazione', 'materia', 'nome', 'descrizione'
  ], PLACEHOLDER_COURSE);
  
  if (raw && typeof raw === 'object') {
    return pick(raw, ['nome', 'denominazione', 'descrizione'], PLACEHOLDER_COURSE);
  }
  return String(raw);
}

// Le date del portale arrivano come millisecondi (es. 1793228400000): le converto
// in formato italiano leggibile (dd/mm/yyyy hh:mm, ora di Roma).
function formatDocenteDate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const text = String(value).trim();
  if (/^\d{12,14}$/.test(text)) {
    const date = new Date(Number(text));
    if (!Number.isNaN(date.getTime())) {
      const giorno = date.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
      const ora = date.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
      return ora === '00:00' ? giorno : `${giorno} ${ora}`;
    }
  }
  return text;
}

// Diagnostica: stampa una sola volta i campi grezzi di una prenotazione,
// utile se il nome dell'insegnamento non viene riconosciuto.
let bookingShapeLogged = false;
function logBookingShapeOnce(item) {
  if (bookingShapeLogged) return;
  bookingShapeLogged = true;
  // Stampa il contenuto (troncato) della prima prenotazione, non solo i nomi dei campi.
  let contenuto;
  try { contenuto = JSON.stringify(item); } catch { contenuto = String(item); }
  console.log('[Docenti] Prima prenotazione grezza:', String(contenuto).slice(0, 1500));
}

function dedupe(list, keyFn) {
  const seen = new Set();
  return list.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Mapping payload API                                                 */
/* ------------------------------------------------------------------ */

function mapSubscription(item) {
  return {
    courseName: courseNameOf(item),
    courseCode: String(pick(item, ['codInse', 'codiceInsegnamento', 'codInsegnamento', 'cod', 'codice'])),
    academicYear: String(pick(item, ['annoAccademico', 'aa', 'anno', 'annoBd'], '')),
    professor: professorName(item),
    section: String(pick(item, ['canale', 'sezione'], ''))
  };
}

function mapBookedExam(item) {
  logBookingShapeOnce(item);
  return {
    courseName: courseNameOf(item) === PLACEHOLDER_COURSE ? 'Esame' : courseNameOf(item),
    courseCode: String(pick(item, ['codInse', 'codiceInsegnamento', 'codInsegnamento', 'cod', 'codcorso', 'codice'])),
    academicYear: String(pick(item, ['annoAccademico', 'aa', 'anno', 'annoBd'], '')),
    professor: professorName(item),
    examDate: formatDocenteDate(pick(item, ['dataEsame', 'dataAppello', 'data'])),
    bookingDate: formatDocenteDate(pick(item, ['dataPrenotazione', 'dataIscrizione'])),
    session: String(pick(item, ['sessione'], '')),
    status: 'Prenotato',
    location: String(pick(item, ['aula', 'luogo'], ''))
  };
}

/* ------------------------------------------------------------------ */
/* Avvisi docenti (REST pubblico)                                      */
/* ------------------------------------------------------------------ */

function teacherBoardUrl(teacherId) {
  return `${DOCENTI_ORIGIN}/teacher/${encodeURIComponent(teacherId)}/dashboard/advices`;
}

async function fetchDocentiJson(path) {
  try {
    const response = await fetch(`${DOCENTI_API}${path}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'it-IT,it;q=0.9',
        Origin: DOCENTI_ORIGIN,
        Referer: `${DOCENTI_ORIGIN}/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function findTeacher(fullName, dependencies = {}) {
  const query = String(fullName || '').trim();
  if (query.length < 3) return null;

  const fetchJson = dependencies.fetchJson || fetchDocentiJson;
  const tokens = normalizeLabel(query).split(/\s+/).filter(t => t.length > 2);
  const attempts = [query, ...[...tokens].reverse()];

  let candidates = [];
  for (const attempt of [...new Set(attempts)]) {
    const data = await fetchJson(`/docenti?nome=${encodeURIComponent(attempt)}&p=0&s=10`);
    candidates = Array.isArray(data?.content) ? data.content : [];
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) return null;

  const scored = candidates
    .map(candidate => {
      const label = normalizeLabel(`${candidate.nome || ''} ${candidate.cognome || ''}`);
      const score = tokens.filter(t => label.includes(t)).length;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return null;

  const tied = scored.filter(s => s.score === best.score);
  if (tied.length > 1) return null;

  return best.candidate;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapAnnouncement(item, teacherId) {
  const rawAttachments = Array.isArray(item?.allegati) ? item.allegati : [];
  const attachments = rawAttachments
    .filter(a => a && a.id)
    .map(a => ({
      id: String(a.id),
      name: String(pick(a, ['nomeFile', 'nome', 'filename', 'titolo', 'descrizione'], `Allegato ${a.id}`)),
      url: `${DOCENTI_API}/allegati/avvisi/${a.id}`
    }));

  let category = pick(item, ['categoria', 'tipologia', 'tipo'], null);
  if (category && typeof category === 'object') {
    category = pick(category, ['descrizione', 'nome', 'label'], null);
  }

  const content = String(pick(item, ['testo', 'descrizione', 'contenuto', 'messaggio', 'corpo'], ''));

  return {
    id: String(item?.id ?? ''),
    title: String(pick(item, ['titolo', 'oggetto', 'title'], 'Avviso')),
    content,
    contentText: stripHtml(content),
    date: pick(item, ['dataPubb', 'dataPubblicazione', 'dataInserimento', 'dataAgg'], null),
    updatedAt: pick(item, ['dataAgg', 'dataAggiornamento', 'dataModifica'], null),
    category: category ? String(category) : null,
    attachments,
    link: attachments[0]?.url || null,
    boardUrl: teacherId ? teacherBoardUrl(teacherId) : null
  };
}

async function fetchAnnouncementDetail(teacherId, announcementId, dependencies = {}) {
  const fetchJson = dependencies.fetchJson || fetchDocentiJson;
  const tid = encodeURIComponent(teacherId);
  const aid = encodeURIComponent(announcementId);
  const candidates = [
    `/docenti/${tid}/avvisi/${aid}`,
    `/avvisi/${aid}`,
    `/docenti/avvisi/${aid}`
  ];

  for (const path of candidates) {
    const data = await fetchJson(path);
    const isSingleObject = data && typeof data === 'object' && !Array.isArray(data) && !Array.isArray(data.content);
    if (isSingleObject) return data;
  }
  return null;
}

function timestampOf(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

async function fetchAnnouncementsForProfessors(professors = [], dependencies = {}) {
  const fetchJson = dependencies.fetchJson || fetchDocentiJson;
  const names = [...new Set(
    professors
      .map(p => String(p || '').trim())
      .filter(p => p && !/non specificato/i.test(p))
  )].slice(0, MAX_ANNOUNCEMENT_TEACHERS);

  const groups = await Promise.all(names.map(async professor => {
    const teacher = await findTeacher(professor, { fetchJson });
    if (!teacher?.id) return null;

    const data = await fetchJson(
      `/docenti/${encodeURIComponent(teacher.id)}/avvisi?p=0&s=${ANNOUNCEMENTS_PER_TEACHER}`
    );
    const raw = toArray(data);
    if (raw.length === 0) return null;

    const items = await Promise.all(raw.map(async rawItem => {
      let mapped = mapAnnouncement(rawItem, teacher.id);
      if (!mapped.content && mapped.id) {
        const detail = await fetchAnnouncementDetail(teacher.id, mapped.id, { fetchJson });
        if (detail) mapped = mapAnnouncement({ ...rawItem, ...detail }, teacher.id);
      }
      return mapped;
    }));
    items.sort((a, b) => timestampOf(b.date) - timestampOf(a.date));

    return {
      professor: `${teacher.nome || ''} ${teacher.cognome || ''}`.trim() || professor,
      slug: String(teacher.id),
      boardUrl: teacherBoardUrl(teacher.id),
      items
    };
  }));

  return groups.filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Browser: login e navigazione                                        */
/* ------------------------------------------------------------------ */

function maskValue(value) {
  const v = String(value || '');
  return v.length <= 5 ? '***' : `${v.slice(0, 3)}***${v.slice(-2)}`;
}

async function loginStudente(page, username, password) {
  username = String(username || '').trim();
  console.log(`[Docenti] Accesso area riservata come ${maskValue(username)}...`);

  await page.goto(DOCENTI_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1000);

  // 1. Seleziona espressamente la scheda Studente
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('a, button, li, .nav-link, span, div'));
    const studentEl = elements.find(el => (el.textContent || '').trim().toLowerCase() === 'studente');
    if (studentEl) {
      (studentEl.closest('a, button, li') || studentEl).click();
    }
  });
  await sleep(1000);

  // 2. Digitazione credenziali e sblocco pulsante Angular
  await page.waitForSelector('input[placeholder="Username"], input[type="text"]', { timeout: 15000 });
  const uInput = await page.$('input[placeholder="Username"], input[type="text"]');
  const pInput = await page.$('input[placeholder="Password"], input[type="password"]');

  await uInput.click({ clickCount: 3 });
  await uInput.type(username, { delay: 15 });
  await pInput.click({ clickCount: 3 });
  await pInput.type(password, { delay: 15 });

  await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    inputs.forEach(i => {
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await sleep(500);

  // 3. Invio form
  const submitted = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    const btn = btns.find(b => (b.textContent || b.value || '').trim().toLowerCase().startsWith('accedi'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (!submitted) {
    await pInput.press('Enter');
  }

  // 4. Attesa redirect in area personale
  await page.waitForFunction(
    () => window.location.pathname.includes('/personal-area/'),
    { timeout: 20000 }
  ).catch(() => {});

  if (!page.url().includes('/personal-area/')) {
    const error = new Error('Login non riuscito: verificare che l\'email inserita sia @studenti.unina.it.');
    error.code = 'DOCENTI_PRIVATE_LOGIN_FAILED';
    throw error;
  }

  await sleep(1000);
}

function startApiCollector(page) {
  const captured = [];
  const pending = [];

  const onResponse = response => {
    const url = response.url();
    if (!url.includes('/webdocenti-be/')) return;
    if (response.request().method() !== 'GET' || !response.ok()) return;
    if (!(response.headers()['content-type'] || '').includes('json')) return;

    pending.push(
      response.json()
        .then(json => { captured.push({ url, json }); })
        .catch(() => {})
    );
  };

  page.on('response', onResponse);

  return {
    async settle() {
      await Promise.all(pending);
      return captured;
    },
    find(pattern) {
      const hit = captured.find(c => pattern.test(c.url));
      return hit ? hit.json : null;
    },
    findAll(pattern) {
      return captured.filter(c => pattern.test(c.url)).map(c => c.json);
    },
    stop() {
      page.off('response', onResponse);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

function emptyResult(reason) {
  return {
    available: false,
    reason,
    retrievedAt: new Date().toISOString(),
    subscriptions: [],
    bookedExams: [],
    announcements: []
  };
}

async function getDocentiData(userCredentials = {}, dependencies = {}) {
  let username = userCredentials.username || userCredentials.email;
  const password = userCredentials.password;
  const runScrapingTask = dependencies.queueScrapingTask || queueScrapingTask;
  const loadAnnouncements = dependencies.fetchAnnouncements || fetchAnnouncementsForProfessors;

  // Rifiuta immediatamente se lo username è un Codice Fiscale
  if (!username || !username.includes('@') || !password) {
    return emptyResult('DOCENTI_EMAIL_REQUIRED');
  }

  try {
    return await runScrapingTask({ username, password }, async (page, data) => {
      console.log('[Docenti] Accesso al portale docenti...');

      await loginStudente(page, data.username, data.password);
      console.log('[Docenti] Login eseguito. Navigazione a RIEPILOGO ISCRIZIONI...');

      const api = startApiCollector(page);

      await page.goto(DOCENTI_SUMMARIES_URL, { waitUntil: 'networkidle2', timeout: 30000 })
        .catch(err => console.warn('[Docenti] goto summaries:', err.message));

      await sleep(3000);
      await api.settle();
      api.stop();

      const allIscrizioni = api.findAll(/\/exernal\/iscrizioni|\/external\/iscrizioni|\/iscrizioni/i);
      const iscrizioniJson = allIscrizioni.find(json => 
        Array.isArray(json) && json.some(item => item.nomeInse || item.idIscrizione || item.codInse)
      ) || api.find(/\/exernal\/iscrizioni|\/external\/iscrizioni/i);

      const prenotazioniJson = api.find(/prenotazioniesami|prenotazion/i);

      let subscriptions = toArray(iscrizioniJson).map(mapSubscription);

      subscriptions = dedupe(
        subscriptions,
        s => `${s.courseCode}|${s.courseName}|${s.professor}`
      );

      let bookedExams = toArray(prenotazioniJson).map(mapBookedExam);

      bookedExams = dedupe(
        bookedExams,
        e => `${e.courseCode}|${e.examDate}|${e.bookingDate}|${e.professor}`
      );

      const profList = subscriptions.map(s => s.professor);
      console.log(`[Docenti] Recupero avvisi per ${profList.length} docenti trovati dalle iscrizioni`);
      const announcements = await loadAnnouncements(profList);

      const hasData = subscriptions.length > 0 || bookedExams.length > 0 || announcements.length > 0;

      console.log(
        `[Docenti] Completato -> Corsi: ${subscriptions.length}, ` +
        `Prenotazioni: ${bookedExams.length}, Avvisi: ${announcements.length}`
      );

      return {
        available: hasData,
        reason: hasData ? null : 'DOCENTI_DATA_NOT_FOUND',
        retrievedAt: new Date().toISOString(),
        announcements,
        subscriptions,
        bookedExams
      };
    });
  } catch (err) {
    console.warn('[Docenti] Errore scraping:', err.message || err);
    return emptyResult(err.code || 'DOCENTI_PRIVATE_LOGIN_FAILED');
  }
}

module.exports = {
  getDocentiData,
  fetchAnnouncementsForProfessors,
  findTeacher,
  mapAnnouncement,
  fetchAnnouncementDetail,
  stripHtml,
  DOCENTI_LOGIN_URL,
  DOCENTI_SUMMARIES_URL,
  DOCENTI_API
};
