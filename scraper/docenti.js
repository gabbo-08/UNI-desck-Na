const { queueScrapingTask } = require('./pool');
const { extractTables: extractTablesFromPage } = require('./utils');
const { getPortalCookies, setPortalCookies, deletePortalCookies } = require('../utils/sessionStore');

const DOCENTI_ORIGIN = 'https://www.docenti.unina.it';
const DOCENTI_API = `${DOCENTI_ORIGIN}/webdocenti-be`;
const DOCENTI_LOGIN_URL = `${DOCENTI_ORIGIN}/login`;
const DOCENTI_SUMMARIES_URL = `${DOCENTI_ORIGIN}/personal-area/student/summaries`;

const HTTP_TIMEOUT_MS = 8000;
const MAX_ANNOUNCEMENT_TEACHERS = 100;
const ANNOUNCEMENTS_PER_TEACHER = 20;

function absoluteDocentiUrl(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/')) return `${DOCENTI_ORIGIN}${text}`;
  return text;
}

function materialFileUrl(id) {
  return id ? `${DOCENTI_API}/allegati/materiale-didattico/${encodeURIComponent(id)}` : null;
}

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
    'descrInse', 'nomeInse', 'nomeInsegnamento', 'insegnamento', 'denominazioneInsegnamento',
    'denominazione', 'materia', 'nome', 'descrizione'
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
    professorId: String(pick(item, ['idDocente', 'id_docente', 'professorId'], '')),
    courseName: courseNameOf(item),
    courseCode: String(pick(item, ['codInse', 'codiceInsegnamento', 'codInsegnamento', 'cod', 'codice'])),
    academicYear: String(pick(item, ['annoAccademico', 'aa', 'anno', 'annoBd'], '')),
    professor: professorName(item),
    section: String(pick(item, ['canale', 'sezione'], ''))
  };
}

function mapTeacherDetail(teacher, teachings = [], materials = {}, exams = [], options = {}) {
  const coursePrefix = options.coursePrefix || null;
  const normalizedCourses = String(coursePrefix || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const matchesCourse = item => {
    if (normalizedCourses.length === 0) return true;
    const value = pick(item, [
      'course', 'courseCode', 'course_id', 'courseId', 'codCorso',
      'codiceCorso', 'codiceCorsoLaurea', 'corsoDiLaurea',
      'codInse', 'codiceInsegnamento', 'codInsegnamento'
    ], '');
    if (!value) return true;
    const normalizedValue = String(value).trim().toLowerCase();
    return normalizedCourses.some(course => normalizedValue === course || normalizedValue.startsWith(`${course}-`));
  };
  teachings = teachings.filter(matchesCourse);
  exams = exams.filter(matchesCourse);
  const mapMaterial = item => ({
    id: String(item?.id ?? item?.idDirectory ?? item?.idFile ?? item?.nome ?? ''),
    nome: String(pick(item, ['nome', 'name', 'nomeFile', 'filename'], 'Materiale')),
    tipo: item?.tipo === 'D' || item?.idDirectory || item?.children ? 'cartella' : 'file',
    url: absoluteDocentiUrl(pick(item, ['url', 'downloadUrl', 'link'], null))
      || (item?.tipo === 'F' ? materialFileUrl(item?.id ?? item?.idFile) : null),
    percorso: absoluteDocentiUrl(pick(item, ['percorso', 'path', 'folderPath'], null)),
    children: toArray(item?.children ?? item?.files ?? item?.figli ?? item?.contenuto).map(mapMaterial)
  });
  const mapMaterials = items => {
    const mapped = toArray(items).map(mapMaterial);
    const byId = new Map(mapped.map(item => [item.id, item]));
    const nestedIds = new Set();
    for (const [index, raw] of toArray(items).entries()) {
      const parentId = pick(raw, ['parentId', 'idParent', 'idDirectoryPadre', 'cartellaId'], '');
      if (parentId && byId.has(String(parentId))) {
        const child = mapped[index];
        const parent = byId.get(String(parentId));
        parent.children = [...(parent.children || []), child];
        nestedIds.add(child.id);
      }
    }
    return mapped.filter(item => !nestedIds.has(item.id));
  };
  const mapExam = item => ({
    id: String(item?.id ?? item?.idAppello ?? `${item?.codInse || ''}-${item?.dataAppello || ''}`),
    insegnamento: String(pick(item, ['nomeInse', 'nomeInsegnamento', 'courseName'], 'Esame')),
    dataEsame: String(pick(item, ['dataEsame', 'dataAppello', 'date'], '')),
    inizioPrenotazione: pick(item, ['dataInizioPrenotazione', 'inizioPrenotazione', 'startBooking'], null),
    finePrenotazione: pick(item, ['dataFinePrenotazione', 'finePrenotazione', 'endBooking'], null),
    prenotato: Boolean(item?.prenotato ?? item?.booked ?? false),
    courseCode: String(pick(item, ['courseCode', 'course_id', 'codCorso', 'codInse'], '')) || null
  });
  const photoValue = pick(teacher, ['fotoUrl', 'foto', 'photoUrl', 'avatarUrl', 'immagine', 'fotoDocente', 'immagineProfilo'], null);
  const photo = typeof photoValue === 'object'
    ? absoluteDocentiUrl(pick(photoValue, ['url', 'href', 'src'], null))
    : absoluteDocentiUrl(photoValue);
  return {
    profilo: {
      id: String(teacher?.id || ''),
      nome: `${teacher?.nome || ''} ${teacher?.cognome || ''}`.trim() || 'Docente',
      ruolo: (() => {
        const value = pick(teacher, ['ruolo', 'role', 'qualifica'], null);
        return typeof value === 'string' && !/^\d+$/.test(value.trim()) ? value : null;
      })(),
      email: pick(teacher, ['email', 'mail'], null),
      telefono: pick(teacher, ['telefono', 'telefonoUfficio', 'phone'], null),
      paginaWeb: pick(teacher, ['paginaWeb', 'sitoWeb', 'web', 'url'], null),
      fotoUrl: photo || null
    },
    materiali: {
      pubblico: mapMaterials(toArray(materials.pubblico).filter(matchesCourse)),
      ftp: mapMaterials(toArray(materials.ftp).filter(matchesCourse)),
      riservato: mapMaterials(toArray(materials.riservato).filter(matchesCourse))
    },
    appelli: toArray(exams).map(mapExam),
    iscrizioni: toArray(teachings).map(item => ({
      insegnamento: String(pick(item, ['nomeInse', 'nomeInsegnamento', 'courseName'], 'Insegnamento')),
      courseCode: String(pick(item, ['codInse', 'codiceInsegnamento'], '')) || null,
      iscritto: Boolean(item?.iscritto ?? item?.isSubscribed ?? false)
    }))
  };
}

async function fetchTeacherDetail(professor, dependencies = {}) {
  const fetchJson = dependencies.fetchJson || fetchDocentiJson;
  const teacher = typeof professor === 'object' && professor?.id
    ? professor
    : await findTeacher(String(professor || ''), { fetchJson });
  if (!teacher?.id) return null;

  const id = encodeURIComponent(teacher.id);
  const [detail, teachings, pubblico, ftp, riservato, exams, photo] = await Promise.all([
    fetchJson(`/docenti/${id}`),
    fetchJson(`/docenti/${id}/insegnamenti`),
    fetchJson(`/docenti/${id}/materiale-didattico/areapubb`),
    fetchJson(`/docenti/${id}/materiale-didattico/aree-ftp?p=0&s=500`),
    fetchJson(`/docenti/${id}/materiale-didattico/arearis?p=0&s=500`),
    fetchJson(`/docenti/${id}/insegnamenti-appelli?p=0&s=99`),
    fetchTeacherPhoto(teacher.id, dependencies)
  ]);

  const courseCodes = String(dependencies.coursePrefix || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const loadFolderContents = async (items, section, depth = 0) => {
    if (depth >= 4) return items;
    const result = [];
    for (const item of toArray(items)) {
      const itemId = item?.id ?? item?.idDirectory;
      if (item?.tipo !== 'D' || !itemId) {
        result.push(item);
        continue;
      }
      const itemCode = pick(item, ['codInse', 'codiceInsegnamento'], '');
      const codes = itemCode ? [itemCode] : courseCodes;
      const responses = await Promise.all((codes.length > 0 ? codes : ['']).map(code => fetchJson(
        `/docenti/${id}/materiale-didattico/${section}/${encodeURIComponent(itemId)}?codIns=${encodeURIComponent(code)}`
      )));
      const children = [...new Map(
        responses
          .flatMap(contents => toArray(contents?.contenutoCartella ?? contents))
          .map(child => [String(child?.id ?? child?.idFile ?? child?.nome ?? JSON.stringify(child)), child])
      ).values()];
      result.push({
        ...item,
        children: await loadFolderContents(children, section, depth + 1)
      });
    }

    return result;
  };
  const [publicContents, ftpContents, privateContents] = await Promise.all([
    loadFolderContents(pubblico, 'areapubb'),
    loadFolderContents(ftp, 'aree-ftp'),
    loadFolderContents(riservato, 'arearis')
  ]);

  return mapTeacherDetail(
    {
      ...teacher,
      ...(detail && typeof detail === 'object' ? detail : {}),
      fotoUrl: photo?.buffer
        ? `data:${photo.contentType};base64,${photo.buffer.toString('base64')}`
        : photo?.url || photo?.src || null
    },
    toArray(teachings),
    { pubblico: publicContents || [], ftp: ftpContents || [], riservato: privateContents || [] },
    toArray(exams),
    { coursePrefix: dependencies.coursePrefix }
  );
}

async function fetchTeacherPhoto(teacherId, dependencies = {}) {
  if (dependencies.fetchPhoto) return dependencies.fetchPhoto(teacherId);
  if (dependencies.fetchJson) return null;
  try {
    const response = await fetch(`${DOCENTI_API}/docenti/${encodeURIComponent(teacherId)}/foto`, {
      headers: {
        Accept: 'image/*',
        Referer: `${DOCENTI_ORIGIN}/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { contentType, buffer };
  } catch {
    return null;
  }

}

async function fetchTeacherFolder(teacherId, folderId, section, coursePrefix, dependencies = {}) {
  const fetchJson = dependencies.fetchJson || fetchDocentiJson;
  const codes = String(coursePrefix || '').split(',').map(value => value.trim()).filter(Boolean);
  const responses = await Promise.all((codes.length ? codes : ['']).map(code =>
    fetchJson(`/docenti/${encodeURIComponent(teacherId)}/materiale-didattico/${encodeURIComponent(section)}/${encodeURIComponent(folderId)}?codIns=${encodeURIComponent(code)}`)
  ));
  return responses.flatMap(value => toArray(value?.contenutoCartella ?? value)).filter(Boolean);
}

function mapBookedExam(item) {
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

function mapDocentiGroup(item) {
  return {
    name: String(pick(item, ['Gruppo', 'Gruppi', 'gruppo', 'group', 'Nome gruppo'], '')),
    courseName: courseNameOf(item),
    professor: professorName(item),
    academicYear: String(pick(item, ['Anno Accademico', 'annoAccademico', 'aa', 'anno'], '')),
    status: String(pick(item, ['Stato gruppo', 'Stato', 'status'], ''))
  };
}

function mapDocentiTest(item) {
  return {
    name: String(pick(item, ['Test', 'test', 'Prova', 'Nome test', 'Titolo'], '')),
    courseName: courseNameOf(item),
    group: String(pick(item, ['Gruppo', 'gruppo', 'group'], '')),
    date: formatDocenteDate(pick(item, ['Data Test', 'Data prova', 'dataTest', 'data'], '')),
    status: String(pick(item, ['Stato test', 'Stato', 'status'], ''))
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
    if (data == null) continue;
    candidates = Array.isArray(data?.content) ? data.content : [];
    break;
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

async function loginStudente(page, username, password, sessionKey = null) {
  username = String(username || '').trim();
  console.log(`[Docenti] Accesso area riservata come ${maskValue(username)}...`);

  if (sessionKey) {
    const cookies = getPortalCookies(sessionKey);
    if (cookies) {
      try {
        await page.setCookie(...cookies);
        await page.goto(DOCENTI_SUMMARIES_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (page.url().includes('/personal-area/')) {
          console.log('[Docenti] Sessione cookie riutilizzata.');
          return;
        }
      } catch {
        deletePortalCookies(sessionKey);
      }
    }
  }

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

  if (sessionKey) {
    setPortalCookies(sessionKey, await page.cookies(DOCENTI_ORIGIN));
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

  if (typeof page.on === 'function') {
    page.on('response', onResponse);
  }

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
    findEntries(pattern) {
      return captured.filter(c => pattern.test(c.url));
    },
    stop() {
      if (typeof page.off === 'function') page.off('response', onResponse);
    }
  };
}

async function collectPaginatedEntries(page, entries) {
  const all = [...entries];
  for (const entry of entries) {
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }
    if (!url.searchParams.has('p')) continue;
    const start = Number(url.searchParams.get('p'));
    const size = Number(url.searchParams.get('s') || 500);
    if (!Number.isFinite(start) || !Number.isFinite(size) || size <= 0) continue;

    for (let pageIndex = start + 1; pageIndex < start + 100; pageIndex += 1) {
      url.searchParams.set('p', String(pageIndex));
      const next = await page.evaluate(async requestUrl => {
        const response = await fetch(requestUrl, { credentials: 'include' });
        if (!response.ok) return null;
        return response.json();
      }, url.toString()).catch(() => null);
      const values = toArray(next);
      if (values.length === 0) break;
      all.push({ url: url.toString(), json: next });
      if (values.length < size) break;
    }
  }
  return all;
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
    groups: [],
    tests: [],
    announcements: []
  };
}

async function getDocentiData(userCredentials = {}, dependencies = {}) {
  let username = userCredentials.username || userCredentials.email;
  const password = userCredentials.password;
  const injectedScraper = dependencies.queueScrapingTask;
  const runScrapingTask = injectedScraper || queueScrapingTask;
  const loadAnnouncements = dependencies.fetchAnnouncements || fetchAnnouncementsForProfessors;

  if (!username || !password) {
    return emptyResult('DOCENTI_CREDENTIALS_REQUIRED');
  }
  if (!String(username).includes('@') && !injectedScraper) {
    return emptyResult('DOCENTI_EMAIL_REQUIRED');
  }

  try {
    return await runScrapingTask({ username, password }, async (page, data) => {
      console.log('[Docenti] Accesso al portale docenti...');

      await loginStudente(page, data.username, data.password, data.profileKey || null);
      console.log('[Docenti] Login eseguito. Navigazione a RIEPILOGO ISCRIZIONI...');

      const api = startApiCollector(page);

      await page.goto(DOCENTI_SUMMARIES_URL, { waitUntil: 'networkidle2', timeout: 30000 })
        .catch(err => console.warn('[Docenti] goto summaries:', err.message));

      await sleep(3000);
      await api.settle();
      api.stop();

      const iscrizioniEntries = await collectPaginatedEntries(
        page,
        api.findEntries(/\/exernal\/iscrizioni|\/external\/iscrizioni|\/iscrizioni/i)
      );
      const iscrizioniJson = iscrizioniEntries
        .flatMap(entry => toArray(entry.json))
        .filter(item => item.nomeInse || item.idIscrizione || item.codInse);

      const prenotazioniJson = api.find(/prenotazioniesami|prenotazion/i);

      let subscriptions = iscrizioniJson.map(mapSubscription);

      subscriptions = dedupe(
        subscriptions,
        s => `${s.courseCode}|${s.courseName}|${s.professor}`
      );

      let bookedExams = toArray(prenotazioniJson).map(mapBookedExam);
      let groups = [];
      let tests = [];

      bookedExams = dedupe(
        bookedExams,
        e => `${e.courseCode}|${e.examDate}|${e.bookingDate}|${e.professor}`
      );

      const extract = dependencies.extractTables || extractTablesFromPage;
      const tables = await extract(page).catch(() => []);
      const fromTables = normalizeDocentiTables(tables);
      if (subscriptions.length === 0 && bookedExams.length === 0) {
        subscriptions = fromTables.subscriptions;
        bookedExams = fromTables.bookedExams;
      }
      groups = fromTables.groups;
      tests = fromTables.tests;

      const profList = subscriptions.map(s => s.professor);
      console.log(`[Docenti] Recupero avvisi per ${profList.length} docenti trovati dalle iscrizioni`);
      const announcements = await loadAnnouncements(profList);

      const hasData = subscriptions.length > 0 || bookedExams.length > 0 ||
        groups.length > 0 || tests.length > 0 || announcements.length > 0;

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
        bookedExams,
        groups,
        tests
      };
    });
  } catch (err) {
    console.warn('[Docenti] Errore scraping:', err.message || err);
    return emptyResult(err.code || 'DOCENTI_PRIVATE_LOGIN_FAILED');
  }
}

function normalizeDocentiTables(tables) {
  const subscriptions = [];
  const bookedExams = [];
  const groups = [];
  const tests = [];

  for (const table of (tables || [])) {
    const headers = (table.headers || []).map(h => String(h || '').trim());
    const records = table.records || [];
    const tableLabel = `${table.title || ''} ${headers.join(' ')}`;

    const isTestTable = /test|prova/i.test(tableLabel);
    const isGroupTable = /grupp/i.test(tableLabel);
    const isExamTable = !isTestTable && !isGroupTable &&
      headers.some(h => /data appello|esame|aula|stato/i.test(h)) &&
      !headers.some(h => h.toLowerCase() === 'stato corso');

    for (const record of records) {
      if (isTestTable && Object.keys(record).some(key => /test|prova/i.test(key))) {
        tests.push(mapDocentiTest(record));
      }
      if (isGroupTable && Object.keys(record).some(key => /grupp/i.test(key))) {
        groups.push(mapDocentiGroup(record));
      }
      if (isExamTable) {
        bookedExams.push({
          examName: record.Esame || record.Insegnamento || record['Nome insegnamento'] || '',
          examDate: record['Data Appello'] || record.Data || '',
          room: record.Aula || '',
          status: record.Stato || ''
        });
      } else if (!isTestTable && !isGroupTable) {
        subscriptions.push({
          courseCode: record.Codice || '',
          courseName: record.Insegnamento || record['Corso di laurea'] || '',
          professor: record.Docente || '',
          academicYear: record['Anno Accademico'] || record['Anno accademico'] || '',
          status: record['Stato corso'] || record.Stato || ''
        });
      }
    }
  }

  return {
    subscriptions: dedupe(subscriptions, s => `${s.courseCode}|${s.courseName}|${s.professor}`),
    bookedExams: dedupe(bookedExams, e => `${e.examName}|${e.examDate}|${e.room}|${e.status}`),
    groups: dedupe(groups, g => `${g.name}|${g.courseName}|${g.professor}`),
    tests: dedupe(tests, t => `${t.name}|${t.courseName}|${t.date}|${t.group}`)
  };
}

module.exports = {
  getDocentiData,
  fetchAnnouncementsForProfessors,
  findTeacher,
  mapAnnouncement,
  mapDocentiGroup,
  mapDocentiTest,
  mapTeacherDetail,
  fetchTeacherDetail,
  fetchTeacherPhoto,
  fetchTeacherFolder,
  normalizeDocentiTables,
  fetchAnnouncementDetail,
  stripHtml,
  DOCENTI_LOGIN_URL,
  DOCENTI_SUMMARIES_URL,
  DOCENTI_API
};