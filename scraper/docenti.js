const { queueScrapingTask } = require('./pool');
const { extractTables: extractTablesFromPage, enableFastMode, humanDelay } = require('./utils');
const { getPortalCookies, setPortalCookies, deletePortalCookies } = require('../utils/sessionStore');
const { safeErrorMeta } = require('../lib/safe-log');

const DOCENTI_ORIGIN = 'https://www.docenti.unina.it';
const DOCENTI_API = `${DOCENTI_ORIGIN}/webdocenti-be`;
const DOCENTI_LOGIN_URL = `${DOCENTI_ORIGIN}/login`;
const DOCENTI_SUMMARIES_URL = `${DOCENTI_ORIGIN}/personal-area/student/summaries`;
const DOCENTI_BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HTTP_TIMEOUT_MS = 8000;
const MAX_TEACHER_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_TEACHER_MATERIAL_BYTES = 15 * 1024 * 1024;
const TEACHER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_ANNOUNCEMENT_TEACHERS = 100;
const ANNOUNCEMENTS_PER_TEACHER = 20;
const MAX_PAGINATION_PAGES = Math.min(100, Math.max(1, Number.parseInt(process.env.DOCENTI_MAX_PAGINATION_PAGES || '20', 10) || 20));

function matchesImageSignature(contentType, buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/gif') return /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'));
  if (contentType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

async function readBoundedBody(response, maximumBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= maximumBytes ? buffer : null;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

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

  const d = item?.docente ?? item?.professore ?? item?.titolare ?? item?.teacher;
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
    'denominazione', 'materia', 'nome', 'descrizione', 'courseName', 'course_name'
  ], PLACEHOLDER_COURSE);
  if (raw && typeof raw === 'object') {
    return pick(raw, ['nome', 'denominazione', 'descrizione'], PLACEHOLDER_COURSE);
  }
  return String(raw);
}

// Le date del portale arrivano come millisecondi (es. 1793228400000): le converto
// in formato italiano leggibile (dd/mm/yyyy hh:mm, ora di Roma).
function formatDocenteDate(value, { preserveTime = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const text = String(value).trim();
  if (/^\d{12,14}$/.test(text)) {
    const date = new Date(Number(text));
    if (!Number.isNaN(date.getTime())) {
      const giorno = date.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
      const ora = date.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
      return !preserveTime && ora === '00:00' ? giorno : `${giorno} ${ora}`;
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

function materialIdentity(item, parentPath = '') {
  const id = String(item?.materialId ?? item?.idMateriale ?? item?.uuid ?? item?.id ?? item?.idDirectory ?? item?.idFile ?? '').trim();
  if (id) return `id:${id}`;
  const url = absoluteDocentiUrl(item?.url || item?.downloadUrl || item?.link || '');
  if (url) return `url:${url}`;
  const path = String(item?.percorso || item?.path || item?.folderPath || parentPath || '').trim();
  const name = String(item?.nome || item?.name || item?.nomeFile || item?.filename || '').trim();
  const type = String(item?.tipo || '').trim();
  return `fallback:${path}|${name}|${type}`;
}

/**
 * Removes repeated folders/files without changing the order supplied by the
 * portal. Some Web Docenti responses repeat the same tree on every page; the
 * identity prefers the portal id, then the download URL, then a scoped path.
 */
function dedupeMaterialTree(items, parentPath = '') {
  const byKey = new Map();
  for (const item of toArray(items)) {
    if (!item || typeof item !== 'object') continue;
    const key = materialIdentity(item, parentPath);
    const name = String(item.nome || item.name || item.nomeFile || item.filename || '').trim();
    const nextPath = parentPath ? `${parentPath}/${name}` : name;
    const children = item.children ?? item.files ?? item.figli ?? item.contenuto;
    const normalized = {
      ...item,
      children: dedupeMaterialTree(children, nextPath)
    };
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, normalized);
      continue;
    }
    // La stessa cartella può essere restituita più volte con figli diversi:
    // unisci i sottoalberi prima di deduplicarli, senza perdere materiale.
    previous.children = dedupeMaterialTree([
      ...toArray(previous.children),
      ...toArray(normalized.children)
    ], nextPath);
  }
  return [...byKey.values()];
}

/* ------------------------------------------------------------------ */
/* Mapping payload API                                                 */
/* ------------------------------------------------------------------ */

function mapSubscription(item) {
  const nestedTeacher = [item?.docente, item?.professore, item?.teacher, item?.titolare]
    .find(value => value && typeof value === 'object') || {};
  const nestedCourse = [item?.insegnamento, item?.course, item?.materia]
    .find(value => value && typeof value === 'object') || {};
  return {
    professorId: String(pick(item, [
      'idDocente', 'id_docente', 'professorId', 'professor_id', 'docenteId',
      'idProfessore', 'idDocenteWeb', 'teacherId', 'idTeacher'
    ], pick(nestedTeacher, ['id', 'idDocente', 'id_docente', 'teacherId'], ''))),
    courseName: courseNameOf(item),
    courseCode: String(pick(item, [
      'codInse', 'codiceInsegnamento', 'codInsegnamento', 'courseCode',
      'course_code', 'codiceCorso', 'codCorso', 'cod', 'codice'
    ], pick(nestedCourse, ['codInse', 'codice', 'courseCode', 'code'], ''))),
    academicYear: String(pick(item, ['annoAccademico', 'anno_accademico', 'academicYear', 'aa', 'anno', 'annoBd'], '')),
    professor: professorName(item),
    section: String(pick(item, ['canale', 'sezione', 'section', 'channel'], ''))
  };
}

function isUsableSubscription(subscription) {
  const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('it').replace(/[^A-Z0-9]+/g, ' ').trim();
  const courseName = clean(subscription?.courseName);
  const professorName = clean(subscription?.professor);
  const courseCode = clean(subscription?.courseCode);
  const placeholder = /^(?:CORSO|INSEGNAMENTO|MATERIA|ESAME|DOCENTE|NON SPECIFICATO|NON INDICATO|N D|ND|[-]+)$/;
  const hasCourseName = courseName.length >= 4 && !placeholder.test(courseName) && courseName !== professorName;
  const hasCourseCode = courseCode.length >= 2 && !placeholder.test(courseCode);
  return hasCourseName || hasCourseCode;
}

function mapTeacherDetail(teacher, teachings = [], materials = {}, exams = [], receiveTimes = [], options = {}) {
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
    id: String(item?.materialId ?? item?.idMateriale ?? item?.uuid ?? item?.id ?? item?.idDirectory ?? item?.idFile ?? item?.nome ?? ''),
    nome: String(pick(item, ['nome', 'name', 'nomeFile', 'filename'], 'Materiale')),
    tipo: item?.tipo === 'D' || item?.idDirectory ||
      [item?.children, item?.files, item?.figli, item?.contenuto].some(value => Array.isArray(value) && value.length > 0)
      ? 'cartella' : 'file',
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
    return dedupeMaterialTree(mapped.filter(item => !nestedIds.has(item.id)));
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
  const receiveTimeItems = toArray(receiveTimes);
  const rawOfficeHours = receiveTimeItems.length > 0 ? receiveTimes : pick(teacher, [
    'ricevimento', 'ricevimenti', 'orariRicevimento', 'orarioRicevimento',
    'officeHours', 'office_hours', 'disponibilita'
  ], null);
  const mapOfficeHour = item => {
    if (typeof item === 'string') return { giorno: null, orario: item.trim(), luogo: null, note: null };
    const value = item && typeof item === 'object' ? item : {};
    return {
      giorno: String(pick(value, ['giorno', 'day', 'giornata', 'weekday'], '') || '').trim() || null,
      orario: (() => {
        const start = String(pick(value, ['oraInizio', 'orarioInizio', 'startTime'], '') || '').trim();
        const end = String(pick(value, ['oraFine', 'orarioFine', 'endTime'], '') || '').trim();
        const range = start && end ? `${start} - ${end}` : start || end || String(pick(value, ['orario', 'ora', 'ore', 'time', 'fasciaOraria'], '') || '').trim();
        return range || null;
      })(),
      luogo: String(pick(value, ['luogo', 'aula', 'stanza', 'ufficio', 'sede', 'location'], '') || '').trim() || null,
      note: String(pick(value, ['note', 'descrizione', 'description'], '') || '')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim() || null
    };
  };
  const officeHourItems = toArray(rawOfficeHours);
  const normalizedOfficeHours = officeHourItems.length > 0
    ? officeHourItems
    : rawOfficeHours && typeof rawOfficeHours === 'object' ? [rawOfficeHours] : [];
  const ricevimento = normalizedOfficeHours.map(mapOfficeHour)
    .filter(item => item.giorno || item.orario || item.luogo || item.note);
  const photoValue = pick(teacher, ['fotoUrl', 'foto', 'photoUrl', 'avatarUrl', 'immagine', 'fotoDocente', 'immagineProfilo'], null);
  const photo = typeof photoValue === 'object'
    ? absoluteDocentiUrl(pick(photoValue, ['url', 'href', 'src'], null))
    : absoluteDocentiUrl(photoValue);
  const mappedSubscriptions = toArray(teachings).map(item => ({
    insegnamento: String(pick(item, ['nomeInse', 'nomeInsegnamento', 'courseName'], 'Insegnamento')),
    courseCode: String(pick(item, ['codInse', 'codiceInsegnamento'], '')) || null,
    iscritto: Boolean(item?.iscritto ?? item?.isSubscribed ?? false)
  }));
  const subscriptionsByCourse = new Map();
  for (const item of mappedSubscriptions) {
    const normalizedName = normalizeLabel(item.insegnamento);
    const normalizedCode = String(item.courseCode || '').trim().toUpperCase();
    const key = normalizedName && normalizedName !== 'INSEGNAMENTO'
      ? `name:${normalizedName}`
      : `code:${normalizedCode || normalizedName}`;
    const previous = subscriptionsByCourse.get(key);
    subscriptionsByCourse.set(key, previous
      ? { ...previous, courseCode: previous.courseCode || item.courseCode, iscritto: previous.iscritto || item.iscritto }
      : item);
  }
  return {
    profilo: {
      id: String(pick(teacher, ['id', 'idDocente', 'id_docente', 'professorId'], '')),
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
    ricevimento,
    appelli: toArray(exams).map(mapExam),
    iscrizioni: [...subscriptionsByCourse.values()]
  };
}

async function fetchTeacherDetail(professor, dependencies = {}) {
  const fetchJson = dependencies.fetchJson || (path => fetchDocentiJson(path, dependencies));
  const teacher = typeof professor === 'object' && professor?.id
    ? professor
    : await findTeacher(String(professor || ''), { fetchJson });
  if (!teacher?.id) return null;

  const id = encodeURIComponent(teacher.id);
  const [detail, teachings, pubblico, ftp, riservato, exams, receiveTimes, photo] = await Promise.all([
    fetchJson(`/docenti/${id}`),
    fetchJson(`/docenti/${id}/insegnamenti`),
    fetchJson(`/docenti/${id}/materiale-didattico/areapubb`),
    fetchJson(`/docenti/${id}/materiale-didattico/aree-ftp?p=0&s=500`),
    fetchJson(`/docenti/${id}/materiale-didattico/arearis?p=0&s=500`),
    fetchJson(`/docenti/${id}/insegnamenti-appelli?p=0&s=99`),
    fetchJson(`/docenti/${id}/orari-ricevimento?p=0&s=10`).catch(() => null),
    fetchTeacherPhoto(teacher.id, dependencies)
  ]);

  // Restituisci il primo livello subito. I contenuti delle cartelle vengono
  // richiesti dall'endpoint folder solo quando l'utente le apre: evita di
  // attraversare ricorsivamente fino a quattro livelli durante il click sul
  // docente e riduce il traffico verso il portale.
  const publicContents = dedupeMaterialTree(pubblico, 'pubblico');
  const ftpContents = dedupeMaterialTree(ftp, 'ftp');
  const privateContents = dedupeMaterialTree(riservato, 'riservato');

  const mergedTeacher = {
    ...teacher,
    ...(detail && typeof detail === 'object' ? detail : {})
  };
  const profilePhoto = pick(mergedTeacher, [
    'fotoUrl', 'foto', 'photoUrl', 'avatarUrl', 'immagine', 'fotoDocente', 'immagineProfilo'
  ], null);
  const profilePhotoUrl = typeof profilePhoto === 'object'
    ? absoluteDocentiUrl(pick(profilePhoto, ['url', 'href', 'src'], null))
    : absoluteDocentiUrl(profilePhoto);

  return mapTeacherDetail(
    {
      ...mergedTeacher,
      fotoUrl: photo?.buffer
        ? `data:${photo.contentType};base64,${photo.buffer.toString('base64')}`
        : photo?.url || photo?.src || profilePhotoUrl
    },
    toArray(teachings),
    { pubblico: publicContents || [], ftp: ftpContents || [], riservato: privateContents || [] },
    toArray(exams),
    toArray(receiveTimes),
    { coursePrefix: dependencies.coursePrefix }
  );
}

async function fetchTeacherPhoto(teacherId, dependencies = {}) {
  if (dependencies.fetchPhoto) return dependencies.fetchPhoto(teacherId);
  if (dependencies.fetchJson) return null;
  try {
    const cookie = portalCookieHeader(dependencies.sessionKey);
    const response = await fetch(`${DOCENTI_API}/docenti/${encodeURIComponent(teacherId)}/foto`, {
      headers: {
        // The portal rejects the bare `image/*` value with HTTP 406; its page
        // sends a browser image negotiation header and returns JPEG correctly.
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: `${DOCENTI_ORIGIN}/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...(cookie ? { Cookie: cookie } : {})
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    ensureDocentiSessionResponse(response, { hasSession: hasPortalSession(dependencies.sessionKey, cookie) });
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TEACHER_IMAGE_TYPES.has(contentType)) return null;
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_TEACHER_PHOTO_BYTES) return null;
    const buffer = await readBoundedBody(response, MAX_TEACHER_PHOTO_BYTES);
    if (!buffer || !matchesImageSignature(contentType, buffer)) return null;
    return { contentType, buffer };
  } catch (error) {
    if (error?.code === 'DOCENTI_SESSION_EXPIRED') {
      if (dependencies.sessionKey) deletePortalCookies(dependencies.sessionKey);
      throw error;
    }
    return null;
  }

}

async function fetchTeacherFolder(teacherId, folderId, section, coursePrefix, dependencies = {}) {
  const fetchJson = dependencies.fetchJson || (path => fetchDocentiJson(path, dependencies));
  const codes = String(coursePrefix || '').split(',').map(value => value.trim()).filter(Boolean);
  const responses = await Promise.all((codes.length ? codes : ['']).map(code =>
    fetchJson(`/docenti/${encodeURIComponent(teacherId)}/materiale-didattico/${encodeURIComponent(section)}/${encodeURIComponent(folderId)}?codIns=${encodeURIComponent(code)}`)
  ));
  return dedupeMaterialTree(
    responses.flatMap(value => toArray(value?.contenutoCartella ?? value)).filter(Boolean),
    String(folderId)
  );
}

function materialById(items, fileId) {
  for (const item of toArray(items)) {
    const id = String(item?.materialId ?? item?.idMateriale ?? item?.uuid ?? item?.id ?? item?.idFile ?? item?.idDirectory ?? '');
    if (id === String(fileId)) return item;
    const nested = materialById(item?.children ?? item?.files ?? item?.figli ?? item?.contenuto, fileId);
    if (nested) return nested;
  }
  return null;
}

function isPdfSignature(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

async function fetchTeacherMaterial(teacherId, folderId, fileId, section, coursePrefix, dependencies = {}) {
  if (typeof dependencies.fetchMaterial === 'function') return dependencies.fetchMaterial({ teacherId, folderId, fileId, section, coursePrefix });
  const items = await fetchTeacherFolder(teacherId, folderId, section, coursePrefix, dependencies);
  const material = materialById(items, fileId);
  if (!material || material?.tipo === 'D') return null;
  const target = absoluteDocentiUrl(pick(material, ['url', 'downloadUrl', 'link'], null)) || materialFileUrl(fileId);
  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== DOCENTI_ORIGIN) return null;

  const cookie = portalCookieHeader(dependencies.sessionKey);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/pdf,image/jpeg,image/png,image/gif,image/webp;q=0.9,*/*;q=0.1',
      Referer: `${DOCENTI_ORIGIN}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ...(cookie ? { Cookie: cookie } : {})
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  try {
    ensureDocentiSessionResponse(response, { hasSession: hasPortalSession(dependencies.sessionKey, cookie) });
  } catch (error) {
    if (error?.code === 'DOCENTI_SESSION_EXPIRED' && dependencies.sessionKey) {
      deletePortalCookies(dependencies.sessionKey);
    }
    throw error;
  }
  if (!response.ok) return null;
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const allowed = contentType === 'application/pdf' || TEACHER_IMAGE_TYPES.has(contentType);
  if (!allowed) return null;
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_TEACHER_MATERIAL_BYTES) return null;
  const buffer = await readBoundedBody(response, MAX_TEACHER_MATERIAL_BYTES);
  if (!buffer) return null;
  if (contentType === 'application/pdf' && !isPdfSignature(buffer)) return null;
  if (TEACHER_IMAGE_TYPES.has(contentType) && !matchesImageSignature(contentType, buffer)) return null;
  const name = String(pick(material, ['nome', 'name', 'nomeFile', 'filename'], `materiale-${fileId}`))
    .replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 120) || `materiale-${fileId}`;
  return { contentType, buffer, filename: name };
}

function mapBookedExam(item) {
  return {
    courseName: courseNameOf(item) === PLACEHOLDER_COURSE ? 'Esame' : courseNameOf(item),
    courseCode: String(pick(item, ['codInse', 'codiceInsegnamento', 'codInsegnamento', 'cod', 'codcorso', 'codice'])),
    academicYear: String(pick(item, ['annoAccademico', 'aa', 'anno', 'annoBd'], '')),
    professor: professorName(item),
    examDate: formatDocenteDate(pick(item, ['dataEsame', 'dataAppello', 'data'])),
    bookingDate: formatDocenteDate(pick(item, ['dataPrenotazione', 'dataIscrizione'])),
    inizioPrenotazione: formatDocenteDate(pick(item, ['dataInizioPrenotazione', 'inizioPrenotazione', 'startBooking'], ''), { preserveTime: true }) || null,
    finePrenotazione: formatDocenteDate(pick(item, ['dataFinePrenotazione', 'finePrenotazione', 'endBooking'], ''), { preserveTime: true }) || null,
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
  const nestedCourse = [item?.insegnamento, item?.materia, item?.course]
    .find(value => value && typeof value === 'object') || {};
  const nestedTeacher = [item?.docente, item?.professore, item?.teacher]
    .find(value => value && typeof value === 'object') || {};
  const name = pick(item, [
    'titoloTest', 'nomeTest', 'testName', 'test_name', 'descrizioneTest',
    'Test', 'test', 'Prova', 'Nome test', 'Titolo', 'title', 'nome'
  ], '');
  const courseName = pick(item, [
    'nomeInsegnamento', 'nomeInse', 'insegnamentoNome', 'courseName',
    'course_name', 'materiaNome', 'Insegnamento', 'Materia', 'descrInse', 'nomeInse'
  ], pick(nestedCourse, ['nome', 'denominazione', 'descrizione', 'name'], ''));
  const teacher = pick(item, [
    'nomeDocente', 'docenteNome', 'professorName', 'teacherName', 'Docente'
  ], '');
  const professor = teacher || (
    typeof nestedTeacher === 'object'
      ? `${nestedTeacher.nome || ''} ${nestedTeacher.cognome || ''}`.trim()
      : ''
  );
  return {
    name: String(name),
    courseName: String(courseName),
    professor: String(professor),
    group: String(pick(item, ['Gruppo', 'gruppo', 'group'], '')),
    date: formatDocenteDate(pick(item, ['Data Test', 'Data prova', 'dataTest', 'data'], '')),
    status: String(pick(item, ['Stato test', 'Stato', 'status'], ''))
  };
}

function isUsableDocentiTest(test) {
  return Boolean(
    test.name &&
    !/^(test|insegnamento|non specificato|—)$/i.test(test.name.trim())
  );
}

function normalizeCollectedTest(test, subscription) {
  const genericName = /^(test|prova|insegnamento|—)$/i.test(String(test.name || '').trim());
  const candidateTitle = genericName && test.courseName && test.courseName !== PLACEHOLDER_COURSE
    ? test.courseName
    : test.name;
  const sameAsTitle = String(test.professor || '').trim().toLowerCase() === String(candidateTitle || '').trim().toLowerCase();
  return {
    ...test,
    name: String(candidateTitle || '').trim(),
    courseName: genericName ? subscription.courseName : (test.courseName || subscription.courseName),
    professor: !test.professor || test.professor === PLACEHOLDER_PROFESSOR || sameAsTitle
      ? subscription.professor
      : test.professor
  };
}

async function collectTeacherTests(page, subscriptions, extractTables) {
  const teachers = new Map();
  for (const subscription of subscriptions) {
    const id = String(subscription.professorId || '');
    if (!id || id === 'undefined') continue;
    const items = teachers.get(id) || [];
    items.push(subscription);
    teachers.set(id, items);
  }
  // I test sono supplementari al riepilogo. Limita il numero di pagine e
  // lavorale in parallelo: una navigazione networkidle per ogni iscritto
  // rendeva il login lento fino a due minuti.
  const entries = [...teachers.entries()].slice(0, 9);
  const results = new Array(entries.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < entries.length) {
      const index = nextIndex++;
      const [teacherId, teacherSubscriptions] = entries[index];
      let testPage = page;
      let ownsPage = false;
      let api = null;
      try {
        const context = page.browserContext?.();
        if (context?.newPage) {
          testPage = await context.newPage();
          ownsPage = true;
        }
        api = startApiCollector(testPage);
        const matchingResponse = testPage.waitForResponse?.(
          response => response.ok() && /\/webdocenti-be\//i.test(response.url()) && /test|prove|signin|grupp/i.test(response.url()),
          { timeout: 3500 }
        ).catch(() => null);
        const url = `${DOCENTI_ORIGIN}/teacher/${encodeURIComponent(teacherId)}/didactics/signin-groups`;
        await testPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        if (matchingResponse) await matchingResponse;
        await api.settle();

        const tables = await extractTables(testPage).catch(() => []);
        const fromTables = normalizeDocentiTables(tables);
        const jsonTests = api.findAll(/\/(?:test|prove|prova|signin-groups)/i).flatMap(toArray);
        const source = [...fromTables.tests, ...jsonTests.map(mapDocentiTest)].filter(isUsableDocentiTest);
        const normalized = value => normalizeLabel(value).replace(/[^a-z0-9]+/g, ' ').trim();
        results[index] = source.flatMap(rawTest => {
          const test = rawTest.courseName ? rawTest : null;
          const matches = test
            ? teacherSubscriptions.filter(subscription => normalized(subscription.courseName) === normalized(test.courseName))
            : teacherSubscriptions.length === 1 ? teacherSubscriptions : [];
          if (matches.length === 0) return [];
          const subscription = matches[0];
          return [normalizeCollectedTest(rawTest, subscription)];
        });
      } catch (error) {
        console.warn(`[Docenti] Test non disponibili per ${teacherId}:`, safeErrorMeta(error));
        results[index] = [];
      } finally {
        api?.stop();
        if (ownsPage) await testPage.close().catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker));

  return dedupe(results.flat(), test =>
    `${test.name}|${test.courseName}|${test.professor}|${test.date}|${test.group}`
  );
}

/* ------------------------------------------------------------------ */
/* Avvisi docenti (REST pubblico)                                      */
/* ------------------------------------------------------------------ */

function teacherBoardUrl(teacherId) {
  return `${DOCENTI_ORIGIN}/teacher/${encodeURIComponent(teacherId)}/dashboard/advices`;
}

function portalCookieHeader(sessionKey) {
  const cookies = sessionKey ? getPortalCookies(sessionKey) : null;
  return cookies?.length ? cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ') : '';
}

// On a Vercel cold start the in-memory cookie jar may be empty even though
// the request still belongs to an authenticated student. Keep that context
// so routes/docenti.js can reconnect the portal instead of treating a 401/403
// as an ordinary empty response.
function hasPortalSession(sessionKey, cookieHeader) {
  return Boolean(sessionKey || cookieHeader);
}

function docentiSessionExpiredError() {
  const error = new Error('La sessione del portale Docenti è scaduta.');
  error.code = 'DOCENTI_SESSION_EXPIRED';
  error.status = 401;
  return error;
}

function ensureDocentiSessionResponse(response, { hasSession = true } = {}) {
  const finalUrl = String(response?.url || '');
  if ((hasSession && [401, 403].includes(Number(response?.status))) || /(?:\/login|\/sso|idp\.)/i.test(finalUrl)) {
    throw docentiSessionExpiredError();
  }
  return response;
}

async function fetchDocentiJson(path, dependencies = {}) {
  try {
    const cookie = portalCookieHeader(dependencies.sessionKey);
    const response = await fetch(`${DOCENTI_API}${path}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'it-IT,it;q=0.9',
        Origin: DOCENTI_ORIGIN,
        Referer: `${DOCENTI_ORIGIN}/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...(cookie ? { Cookie: cookie } : {})
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    ensureDocentiSessionResponse(response, { hasSession: hasPortalSession(dependencies.sessionKey, cookie) });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) return null;
    return await response.json();
  } catch (error) {
    if (error?.code === 'DOCENTI_SESSION_EXPIRED') {
      if (dependencies.sessionKey) deletePortalCookies(dependencies.sessionKey);
      throw error;
    }
    return null;
  }
}

async function findTeacher(fullName, dependencies = {}) {
  const query = String(fullName || '').trim();
  if (query.length < 3) return null;

  const fetchJson = dependencies.fetchJson || fetchDocentiJson;
  const tokens = normalizeLabel(query).split(/\s+/).filter(t => t.length > 2);
  // Il portale ricerca in modo più affidabile sul cognome singolo se la query
  // completa non produce risultati; evita richieste ripetute per ogni token.
  const attempts = [...new Set([query, tokens[tokens.length - 1]].filter(Boolean))];

  let candidates = [];
  for (const attempt of [...new Set(attempts)]) {
    const data = await fetchJson(`/docenti?nome=${encodeURIComponent(attempt)}&p=0&s=10`);
    if (data == null) continue;
    const found = Array.isArray(data?.content) ? data.content : [];
    if (found.length > 0) {
      candidates = found;
      break;
    }
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
  // Con un nome completo non accettare una corrispondenza basata solo su un
  // token comune: potrebbe collegare l'avviso alla persona sbagliata.
  const minimumScore = tokens.length > 1 ? 2 : 1;
  if (!best || best.score < minimumScore) return null;

  const tied = scored.filter(s => s.score === best.score && s.score >= minimumScore);
  if (tied.length > 1) return null;

  return best.candidate;
}

async function searchTeachers(query, dependencies = {}) {
  const searchText = String(query || '').trim();
  if (searchText.length < 3 || searchText.length > 100) return [];

  const fetchJson = dependencies.fetchJson || (path => fetchDocentiJson(path, dependencies));
  const tokens = normalizeLabel(searchText).split(/\s+/).filter(token => token.length >= 3);
  const attempts = [...new Set([searchText, ...tokens.slice().reverse(), ...tokens])];
  const candidates = new Map();

  for (const attempt of attempts.slice(0, 6)) {
    const data = await fetchJson(`/docenti?nome=${encodeURIComponent(attempt)}&p=0&s=30`);
    for (const candidate of (Array.isArray(data?.content) ? data.content : [])) {
      if (candidate?.id) candidates.set(String(candidate.id), candidate);
    }
  }

  return [...candidates.values()]
    .map(candidate => {
      // Il portale Docenti mostra il cognome prima del nome nelle schede.
      const name = `${candidate.cognome || ''} ${candidate.nome || ''}`.trim();
      const normalizedName = normalizeLabel(name);
      const matchedTokens = tokens.filter(token => normalizedName.includes(token));
      return {
        id: String(candidate.id),
        name: name || 'Docente',
        role: pick(candidate, ['ruolo', 'role', 'qualifica'], null),
        score: matchedTokens.length
      };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'it'))
    .slice(0, 20)
    .map(({ score, ...teacher }) => teacher);
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

async function fetchAnnouncementGroup(teacher, fallbackName, dependencies = {}, options = {}) {
  const fetchJson = dependencies.fetchJson || fetchDocentiJson;
  const teacherId = String(teacher?.id || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(teacherId)) return null;
  const data = await fetchJson(
    `/docenti/${encodeURIComponent(teacherId)}/avvisi?p=0&s=${ANNOUNCEMENTS_PER_TEACHER}`
  );
  const raw = toArray(data);
  if (raw.length === 0 && !options.includeEmpty) return null;

  const items = await Promise.all(raw.map(async rawItem => {
    let mapped = mapAnnouncement(rawItem, teacherId);
    if (!mapped.content && mapped.id) {
      const detail = await fetchAnnouncementDetail(teacherId, mapped.id, { fetchJson });
      if (detail) mapped = mapAnnouncement({ ...rawItem, ...detail }, teacherId);
    }
    return mapped;
  }));
  items.sort((a, b) => timestampOf(b.date) - timestampOf(a.date));

  return {
    professor: `${teacher.nome || ''} ${teacher.cognome || ''}`.trim() || fallbackName,
    slug: teacherId,
    boardUrl: teacherBoardUrl(teacherId),
    ...(options.courseName ? { courseName: options.courseName } : {}),
    ...(options.isFavorite ? { isFavorite: true } : {}),
    ...(options.isFavorite && data == null ? { announcementError: true } : {}),
    items
  };
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
    return fetchAnnouncementGroup(teacher, professor, { ...dependencies, fetchJson });
  }));

  return groups.filter(Boolean);
}

async function fetchAnnouncementsForTeacherIds(teachers = [], dependencies = {}) {
  const unique = new Map();
  for (const teacher of teachers) {
    const id = String(teacher?.id || '').trim();
    if (!id || unique.has(id)) continue;
    unique.set(id, teacher);
  }
  const groups = await Promise.all([...unique.values()].slice(0, MAX_ANNOUNCEMENT_TEACHERS).map(async teacher => {
    try {
      return await fetchAnnouncementGroup(teacher, teacher.name, dependencies, {
        includeEmpty: true,
        isFavorite: true,
        courseName: teacher.courseName
      });
    } catch {
      return {
        professor: teacher.name || 'Docente preferito',
        slug: String(teacher.id || ''),
        courseName: teacher.courseName,
        isFavorite: true,
        announcementError: true,
        items: []
      };
    }
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
        deletePortalCookies(sessionKey);
      } catch {
        deletePortalCookies(sessionKey);
      }
    }
  }

  await page.goto(DOCENTI_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 1. Seleziona la scheda Studente e aspetta lo stato attivo prima di usare il form.
  await page.waitForFunction(() => Array.from(document.querySelectorAll('a, button, li, .nav-link, span, div'))
    .some(element => (element.textContent || '').trim().toLowerCase() === 'studente'), { timeout: 15000 }).catch(() => {
      const error = new Error('La scheda Studente del portale Docenti non è stata caricata.');
      error.code = 'DOCENTI_LOGIN_FORM_UNAVAILABLE';
      throw error;
    });
  const selectedStudentTab = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('a, button, li, .nav-link, span, div'));
    const studentEl = elements.find(element => (element.textContent || '').trim().toLowerCase() === 'studente');
    if (!studentEl) return false;
    const tab = studentEl.closest('a, button, li') || studentEl;
    if (!tab.closest('.active')) tab.click();
    return true;
  });
  if (selectedStudentTab === false) {
    const error = new Error('La scheda Studente del portale Docenti non è disponibile.');
    error.code = 'DOCENTI_LOGIN_FORM_UNAVAILABLE';
    throw error;
  }
  // Il portale aggiorna il tab con classi diverse tra i deploy Angular. Non
  // vincoliamo il login alla presenza di `.active`: è sufficiente che il form
  // studente diventi disponibile, verificato dal selettore subito sotto.
  // 2. Digitazione credenziali e sblocco pulsante Angular
  const usernameSelector = 'input[placeholder="Username"], input[placeholder="username"], input[autocomplete="username"], input[type="email"], input[type="text"]';
  const passwordSelector = 'input[placeholder="Password"], input[placeholder="password"], input[autocomplete="current-password"], input[type="password"]';
  await page.waitForSelector(usernameSelector, { timeout: 15000 });
  const uInput = await page.$(usernameSelector);
  const pInput = await page.$(passwordSelector);
  if (!uInput || !pInput) {
    const error = new Error('Il modulo di accesso Studente del portale Docenti non è disponibile.');
    error.code = 'DOCENTI_LOGIN_FORM_UNAVAILABLE';
    throw error;
  }

  await uInput.click({ clickCount: 3 });
  await uInput.type(username);
  await pInput.click({ clickCount: 3 });
  await pInput.type(password);

  await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    inputs.forEach(i => {
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
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
  await page.waitForFunction(() => {
    const path = window.location.pathname;
    const privateArea = /\/personal-area(?:\/|$)/.test(path);
    const alerts = Array.from(document.querySelectorAll('[role="alert"], .alert-danger, .invalid-feedback, .error, [class*="error"]'))
      .map(element => element.textContent || '').join(' ').trim();
    return privateArea || alerts.length > 5;
  }, { timeout: 30000 }).catch(() => {});

  if (!/\/personal-area(?:\/|$)/.test(new URL(page.url()).pathname)) {
    const portalError = await page.evaluate(() => Array.from(document.querySelectorAll(
      '[role="alert"], .alert-danger, .invalid-feedback, .error, [class*="error"]'
    )).map(element => (element.textContent || '').trim()).filter(Boolean).join(' ').slice(0, 300)).catch(() => '');
    const rejectedCredentials = /credenzial|password|username|email|autenticazione|non valid|non corrett|errat/i.test(portalError);
    const error = new Error(rejectedCredentials
      ? 'Il portale Docenti ha rifiutato l’accesso. Verifica email @studenti.unina.it e password usate per quel portale.'
      : 'Il portale Docenti non ha completato l’accesso. La pagina di login potrebbe essere cambiata o non aver risposto in tempo.');
    error.code = rejectedCredentials ? 'DOCENTI_AUTH_REJECTED' : 'DOCENTI_LOGIN_FLOW_FAILED';
    throw error;
  }

  if (sessionKey) {
    setPortalCookies(sessionKey, await page.cookies(DOCENTI_ORIGIN));
  }
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

    const seen = new Set(toArray(entry.json).map(item => {
      if (item && typeof item === 'object') {
        return String(item.id ?? item.idIscrizione ?? item.idAppello ?? JSON.stringify(item));
      }
      return String(item);
    }));

    for (let pageIndex = start + 1; pageIndex < start + MAX_PAGINATION_PAGES; pageIndex += 1) {
      url.searchParams.set('p', String(pageIndex));
      const next = await page.evaluate(async requestUrl => {
        const response = await fetch(requestUrl, { credentials: 'include' });
        if (!response.ok) return null;
        return response.json();
      }, url.toString()).catch(() => null);
      const values = toArray(next);
      if (values.length === 0) break;
      const newValues = values.filter(item => {
        const key = item && typeof item === 'object'
          ? String(item.id ?? item.idIscrizione ?? item.idAppello ?? JSON.stringify(item))
          : String(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (newValues.length === 0) break;
      all.push({ url: url.toString(), json: next });
      if (values.length < size) break;
      await humanDelay();
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
  if (!/^[^\s@]+@studenti\.unina\.it$/i.test(String(username)) && !injectedScraper) {
    return emptyResult('DOCENTI_EMAIL_REQUIRED');
  }

  try {
    return await runScrapingTask({ username, password, profileKey: userCredentials.profileKey }, async (page, data) => {
      console.log('[Docenti] Accesso al portale docenti...');

      // Riduce il traffico inutile (immagini/font/CSS) senza alterare la
      // fingerprint del browser o tentare di eludere controlli anti-bot.
      if (typeof page.setUserAgent === 'function') {
        await page.setUserAgent(DOCENTI_BROWSER_USER_AGENT);
      }
      if (typeof page.setExtraHTTPHeaders === 'function') {
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'it-IT,it;q=0.9' });
      }
      await enableFastMode(page);

      await loginStudente(page, data.username, data.password, data.profileKey || null);
      console.log('[Docenti] Login eseguito. Navigazione a RIEPILOGO ISCRIZIONI...');

      const api = startApiCollector(page);

      await page.goto(DOCENTI_SUMMARIES_URL, { waitUntil: 'networkidle2', timeout: 30000 })
        .catch(err => console.warn('[Docenti] goto summaries:', safeErrorMeta(err)));

      await api.settle();
      api.stop();

      const iscrizioniEntries = await collectPaginatedEntries(
        page,
        api.findEntries(/\/exernal\/iscrizioni|\/external\/iscrizioni|\/iscrizioni/i)
      );
      const iscrizioniJson = iscrizioniEntries.flatMap(entry => toArray(entry.json));

      const prenotazioniJson = api.findAll(/prenotazioniesami|prenotazion/i).flatMap(toArray);

      let subscriptions = iscrizioniJson.map(mapSubscription).filter(isUsableSubscription);

      subscriptions = dedupe(
        subscriptions,
        s => `${s.courseCode}|${s.courseName}|${s.professor}`
      );

      let bookedExams = toArray(prenotazioniJson).map(mapBookedExam).filter(exam => {
        const course = String(exam.courseName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .toLocaleUpperCase('it').replace(/[^A-Z0-9]+/g, ' ').trim();
        return course.length >= 4 && !/^(?:ESAME|INSEGNAMENTO|MATERIA|NON SPECIFICATO|NON INDICATO)$/.test(course) &&
          Boolean(exam.examDate || exam.bookingDate || exam.courseCode);
      });
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

      // Il portale carica spesso gruppi e test con richieste JSON separate
      // dalla tabella HTML iniziale. Recuperiamo anche quelle risposte già
      // catturate, senza aprire una nuova sessione o duplicare richieste.
      const jsonGroups = api.findAll(/\/(?:gruppi|groups|gruppo)/i).flatMap(toArray);
      const jsonTests = api.findAll(/\/(?:test|prove|prova)/i).flatMap(toArray);
      if (jsonGroups.length > 0) {
        groups = dedupe(
          [...groups, ...jsonGroups.map(mapDocentiGroup)],
          item => `${item.name}|${item.courseName}|${item.professor}`
        );
      }
      if (jsonTests.length > 0) {
        tests = dedupe(
          [...tests, ...jsonTests.map(mapDocentiTest).filter(isUsableDocentiTest)],
          item => `${item.name}|${item.courseName}|${item.date}|${item.group}`
        );
      }
      if (subscriptions.some(item => item.professorId)) {
        const teacherTests = await collectTeacherTests(page, subscriptions, extract);
        tests = dedupe(
          [...tests, ...teacherTests],
          item => `${item.name}|${item.courseName}|${item.professor}|${item.date}|${item.group}`
        );
      }

      const profList = subscriptions.map(s => s.professor);
      console.log(`[Docenti] Recupero avvisi per ${profList.length} docenti trovati dalle iscrizioni`);
      const announcements = await loadAnnouncements(profList);

      const hasData = subscriptions.length > 0 || bookedExams.length > 0 ||
        groups.length > 0 || tests.length > 0 || announcements.length > 0;

      // Una sessione cookie apparentemente valida può comunque restituire
      // la pagina personale vuota. Non conservarla: il tentativo successivo
      // deve eseguire un login completo.
      if (!hasData && userCredentials.profileKey) {
        deletePortalCookies(userCredentials.profileKey);
      }

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
    console.warn('[Docenti] Errore scraping:', safeErrorMeta(err));
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
    const hasCourseColumn = headers.some(h => /insegnamento|materia|nome corso/i.test(h));
    const hasSubscriptionColumn = headers.some(h => /docente|professore|titolare|anno accademico|codice.*insegnamento|codice corso|stato corso/i.test(h));

    const isTestTable = /test|prova/i.test(tableLabel);
    const isGroupTable = /grupp/i.test(tableLabel);
    const isExamTable = !isTestTable && !isGroupTable &&
      headers.some(h => /data appello|esame|aula|stato/i.test(h)) &&
      !headers.some(h => h.toLowerCase() === 'stato corso');
    const isSubscriptionTable = !isTestTable && !isGroupTable && !isExamTable && hasCourseColumn && hasSubscriptionColumn;

    for (const record of records) {
      if (isTestTable && Object.keys(record).some(key => /test|prova/i.test(key))) {
        const test = mapDocentiTest(record);
        if (isUsableDocentiTest(test)) tests.push(test);
      }
      if (isGroupTable && Object.keys(record).some(key => /grupp/i.test(key))) {
        groups.push(mapDocentiGroup(record));
      }
      if (isExamTable) {
        const courseName = record.Esame || record.Insegnamento || record['Nome insegnamento'] || record.Materia || '';
        const examDate = record['Data Appello'] || record.Data || '';
        const location = record.Aula || record.Luogo || '';
        const status = record.Stato || '';
        const meaningful = isUsableSubscription({ courseName }) && Boolean(String(examDate || '').trim() || String(record['Data Prenotazione'] || '').trim());
        if (meaningful) bookedExams.push({
          courseName: courseName || 'Esame',
          examDate,
          location,
          professor: record.Docente || record.Professore || '',
          status
        });
      } else if (isSubscriptionTable) {
        const subscription = {
          courseCode: record.Codice || '',
          courseName: record.Insegnamento || record['Nome insegnamento'] || record.Materia || '',
          professor: record.Docente || '',
          academicYear: record['Anno Accademico'] || record['Anno accademico'] || '',
          status: record['Stato corso'] || record.Stato || ''
        };
        if (isUsableSubscription(subscription)) subscriptions.push(subscription);
      }
    }
  }

  return {
    subscriptions: dedupe(subscriptions, s => `${s.courseCode}|${s.courseName}|${s.professor}`),
    bookedExams: dedupe(bookedExams, e => `${e.courseName}|${e.examDate}|${e.location}|${e.status}`),
    groups: dedupe(groups, g => `${g.name}|${g.courseName}|${g.professor}`),
    tests: dedupe(tests, t => `${t.name}|${t.courseName}|${t.date}|${t.group}`)
  };
}


async function resolveCodiceFiscaleFromDocenti({ email, password } = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail.endsWith('@studenti.unina.it') || cleanEmail.length <= '@studenti.unina.it'.length || !password) {
    const err = new Error('Inserisci la tua email istituzionale (@studenti.unina.it) e la password.');
    err.status = 400;
    throw err;
  }

  return await queueScrapingTask({ username: cleanEmail, password }, async (page, data) => {
    if (typeof page.setUserAgent === 'function') await page.setUserAgent(DOCENTI_BROWSER_USER_AGENT);
    if (typeof page.setExtraHTTPHeaders === 'function') {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'it-IT,it;q=0.9' });
    }
    await enableFastMode(page);

    const api = startApiCollector(page);
    try {
      await loginStudente(page, data.username, data.password, null);
    } catch (loginErr) {
      api.stop();
      if (/credenziali|password|non valide|401|403/i.test(loginErr?.message || '')) {
        const err = new Error('Credenziali non valide su WebDocenti.');
        err.code = 'INVALID_CREDENTIALS';
        err.status = 401;
        throw err;
      }
      const err = new Error(loginErr?.message || 'Portale Docenti non raggiungibile.');
      err.code = 'PORTAL_UNAVAILABLE';
      err.status = 502;
      throw err;
    }

    const cfRegex = new RegExp('([A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z])', 'i');

    const extractCf = async () => {
      const rawPayloads = JSON.stringify(api.entries || []);
      const fromApi = rawPayloads.match(cfRegex);
      if (fromApi) return fromApi[1].toUpperCase();

      const bodyText = await page.evaluate(
        () => (document.body?.innerText || '') + ' ' + (document.body?.innerHTML || '')
      ).catch(() => '');
      const fromDom = bodyText.match(cfRegex);
      return fromDom ? fromDom[1].toUpperCase() : null;
    };

    try {
      await page.goto(DOCENTI_SUMMARIES_URL, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
      await api.settle();
      let cf = await extractCf();
      if (cf) return cf;

      for (const profileUrl of [
        'https://www.docenti.unina.it/#!/studenti/profilo',
        'https://www.docenti.unina.it/#!/profilo',
        'https://www.docenti.unina.it/#!/studenti/anagrafica'
      ]) {
        await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        await api.settle();
        cf = await extractCf();
        if (cf) return cf;
      }

      return null;
    } finally {
      api.stop();
    }
  });
}
module.exports = {
  resolveCodiceFiscaleFromDocenti,
  getDocentiData,
  fetchAnnouncementsForProfessors,
  fetchAnnouncementsForTeacherIds,
  findTeacher,
  searchTeachers,
  mapAnnouncement,
  mapDocentiGroup,
  mapDocentiTest,
  mapBookedExam,
  mapTeacherDetail,
  dedupeMaterialTree,
  fetchTeacherDetail,
  fetchTeacherPhoto,
  matchesImageSignature,
  readBoundedBody,
  fetchTeacherFolder,
  fetchTeacherMaterial,
  normalizeDocentiTables,
  mapSubscription,
  isUsableSubscription,
  fetchAnnouncementDetail,
  stripHtml,
  DOCENTI_LOGIN_URL,
  DOCENTI_SUMMARIES_URL,
  DOCENTI_API,
  docentiSessionExpiredError,
  ensureDocentiSessionResponse
};
