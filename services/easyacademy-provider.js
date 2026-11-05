
const { queueScrapingTask } = require('../scraper/pool');
const { enableFastMode } = require('../scraper/utils');
const { normalizeCourseName, nameSimilarity } = require('../lib/matching');

const AGENDA_URL = 'https://easyacademy.unina.it/agendastudenti/index.php?view=easycourse&_lang=it&include=corso';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 2;
const timetableCache = new Map();
const MONTHS = {
  gennaio: '01', febbraio: '02', marzo: '03', aprile: '04', maggio: '05', giugno: '06',
  luglio: '07', agosto: '08', settembre: '09', ottobre: '10', novembre: '11', dicembre: '12'
};

function normalizeLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function errorWithStatus(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function navigateToAgenda(page) {
  // EasyAcademy currently serves an expired certificate. Intercept certificate
  // errors for this navigation only, and continue only its date-invalid error.
  // All other hosts/errors remain subject to Chromium's normal TLS checks.
  await enableFastMode(page);
  const cdp = await page.createCDPSession();
  const handleCertificateError = async ({ eventId, errorType, requestURL }) => {
    let action = 'cancel';
    try {
      const url = new URL(requestURL);
      const dateInvalid = errorType === 'dateInvalid' || errorType === 'ERR_CERT_DATE_INVALID';
      if (url.protocol === 'https:' && url.hostname === 'easyacademy.unina.it' && dateInvalid) {
        action = 'continue';
      }
    } catch {
      // Invalid URLs are rejected below.
    }
    await cdp.send('Security.handleCertificateError', { eventId, action });
  };

  cdp.on('Security.certificateError', handleCertificateError);
  try {
    await cdp.send('Security.enable');
    await cdp.send('Security.setOverrideCertificateErrors', { override: true });
    await page.goto(AGENDA_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => Array.from(document.querySelector('#cdl_aa')?.options || [])
      .some(option => option.value), { timeout: 15000 });
  } finally {
    cdp.off('Security.certificateError', handleCertificateError);
    await cdp.send('Security.setOverrideCertificateErrors', { override: false }).catch(() => {});
    await cdp.send('Security.disable').catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

function parsePopupText(rawText) {
  const text = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const between = (start, end) => {
    const lower = normalized.toLowerCase();
    const startAt = lower.indexOf(start.toLowerCase());
    if (startAt < 0) return '';
    const valueStart = startAt + start.length;
    const endAt = lower.indexOf(end.toLowerCase(), valueStart);
    return normalized.slice(valueStart, endAt < 0 ? normalized.length : endAt).trim().replace(/^:\s*/, '');
  };

  const rawName = between('Nome insegnamento', 'Argomento lezione') || between('Insegnamento', 'Docenti');
  const teacherText = between('Docenti', 'Data e Ora') || between('Docente', 'Data e Ora');
  const dateTime = (between('Data e Ora', 'Aula') || between('Data e Ora', 'Nome aula')).replace(/\s+/g, ' ').trim();
  const room = (normalized.match(/(?:Nome\s+)?Aula\s*:\s*([\s\S]*?)(?=Capacita:|Capienza:|Sede:|Google Maps|Percorso didattico|Numero eventi|$)/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  // La sede si ferma prima di: [indirizzo], Google Maps, Percorso didattico, Numero eventi.
  const campus = (normalized.match(/Sede:\s*([\s\S]*?)(?=\[|Google Maps|Percorso didattico|Numero eventi|Capacita:|$)/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const coursePath = between('Percorso didattico', 'Numero eventi collegati').replace(/\s+/g, ' ').trim();
  const dateMatch = dateTime.match(/(?:\w+\s+)?(\d{1,2})\s+([a-zà-ù]+)\s+(\d{4})\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/i);
  const month = dateMatch ? MONTHS[normalizeLabel(dateMatch[2])] : null;

  return {
    courseName: rawName.replace(/\s*\([^)]*\)\s*$/, '').trim(),
    channel: rawName.match(/\(([^()]*)\)\s*$/)?.[1] || null,
    teachers: teacherText.split('\n').map(name => name.trim()).filter(Boolean),
    dateTime,
    date: dateMatch && month ? `${dateMatch[3]}-${month}-${dateMatch[1].padStart(2, '0')}` : null,
    startTime: dateMatch?.[4] || null,
    endTime: dateMatch?.[5] || null,
    room: room.replace(/\s+/g, ' ').trim() || null,
    campus: campus || null,
    coursePath: coursePath || null
  };
}

function getCourseOptions(options, { courseId, courseName, studyYear }) {
  const wantedName = normalizeCourseName(String(courseName || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\bL-?\s*8\b/i, ''));
  const candidates = options.map(option => {
    const text = String(option.text || '').trim();
    const isThirdYear = /terzo anno/i.test(text);
    const displayName = normalizeCourseName(text.replace(/\s*\([^)]*\)/g, '').replace(/\s*[-–]\s*terzo anno/i, ''));
    const codeMatch = Boolean(courseId && String(option.value).toLowerCase() === String(courseId).toLowerCase());
    const similarity = wantedName ? nameSimilarity(displayName, wantedName) : 0;
    const yearMatch = (studyYear >= 3) === isThirdYear;
    return { option, text, codeMatch, similarity, score: similarity + (yearMatch ? 0.25 : 0) + (codeMatch ? 0.1 : 0) };
  }).filter(candidate => candidate.option.value && (candidate.codeMatch || candidate.similarity >= 0.72));

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] || null;
}

function extractGroupRange(text) {
  const token = String(text || '').toUpperCase().match(/\b([A-Z])\s*[-–]\s*([A-Z]+)/);
  if (!token) return null;
  return { first: token[1], last: token[2][0] };
}

function matchesStudyGroup(optionText, channel, surnameInitial) {
  const normalizedOption = normalizeLabel(optionText);
  const channelPart = String(surnameInitial || channel || '').toUpperCase().split(':').pop();
  const initial = channelPart.match(/[A-Z]/)?.[0];
  const range = extractGroupRange(optionText);

  // Quando il sito pubblica intervalli alfabetici, l'iniziale dello studente
  // è più affidabile di un canale eventualmente ereditato dal profilo.
  if (surnameInitial && initial && range) {
    return range.first <= range.last
      ? initial >= range.first && initial <= range.last
      : initial >= range.first || initial <= range.last;
  }

  const channelToken = normalizeLabel(String(channel || '').split(':').pop().replace(/corso generico/i, ''));
  if (channelToken && normalizedOption.includes(channelToken)) return true;

  return Boolean(initial && range && (
    range.first <= range.last
      ? initial >= range.first && initial <= range.last
      : initial >= range.first || initial <= range.last
  ));
}

function selectStudyGroup(options, studyYear, channel, surnameInitial) {
  // Se EasyAcademy non riporta l'anno nel testo del gruppo, usa tutti i gruppi disponibili.
  const withYear = options.filter(option => new RegExp(`^\\s*${studyYear}\\s*[-–]`).test(option.text));
  const relevant = withYear.length > 0 ? withYear : options;
  const matches = relevant.filter(option => matchesStudyGroup(option.text, channel, surnameInitial));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const exact = matches.find(option => normalizeLabel(option.text).includes(normalizeLabel(channel || '')));
    if (exact) return exact;
  }
  // Un solo gruppo disponibile per l'anno: è per forza quello dello studente.
  if (matches.length === 0 && relevant.length === 1) return relevant[0];
  return null;
}

function cacheKey(filters) {
  return JSON.stringify({
    version: CACHE_VERSION,
    courseId: filters.courseId,
    courseName: normalizeLabel(filters.courseName),
    academicYear: filters.academicYear,
    studyYear: filters.studyYear,
    semester: filters.semester,
    channel: normalizeLabel(filters.channel),
    surnameInitial: normalizeLabel(filters.surnameInitial)
  });
}

function readCache(key, now = Date.now()) {
  const cached = timetableCache.get(key);
  if (!cached || cached.expiresAt <= now) {
    timetableCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeCache(key, value, now = Date.now()) {
  for (const [entryKey, entry] of timetableCache) {
    if (entry.expiresAt <= now) timetableCache.delete(entryKey);
  }
  timetableCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
}

async function scrapeTimetablePage(page, filters) {
  const { courseId, courseName, academicYear, studyYear, semester, channel, surnameInitial, key } = filters;

  try {
    await navigateToAgenda(page);
    const academicYearOptions = await page.$$eval('#cdl_aa option', options => options.map(option => ({ value: option.value, text: option.text.trim() })));
    const selectedAcademicYear = academicYear
      ? academicYear.match(/\d{4}/)?.[0]
      : academicYearOptions.map(option => option.value).filter(value => /^\d{4}$/.test(value)).sort().at(-1);
    if (!selectedAcademicYear || !academicYearOptions.some(option => option.value === selectedAcademicYear)) {
      throw errorWithStatus('Anno accademico non disponibile in EasyAcademy.', 400, 'ACADEMIC_YEAR_NOT_AVAILABLE');
    }
    await page.select('#cdl_aa', selectedAcademicYear);
    await page.waitForFunction(() => Array.from(document.querySelector('#cdl_scuola')?.options || [])
      .some(option => option.value), { timeout: 15000 });

    let courseOptions = await page.$$eval('#cdl_co option', options => options.map(option => ({ value: option.value, text: option.text.trim() })));
    let course = getCourseOptions(courseOptions, { courseId, courseName, studyYear });
    if (!course) {
      const schools = await page.$$eval('#cdl_scuola option', options => options.map(option => option.value).filter(Boolean));
      const expectedName = normalizeCourseName(String(courseName || '').replace(/\[[^\]]+\]/g, '').replace(/\bL-?\s*8\b/i, ''));
      for (const school of schools) {
        await page.select('#cdl_scuola', school);
        
        // Forza l'evento change per aggiornare i corsi dipendenti dalla struttura
        await page.evaluate(() => {
          const select = document.querySelector('#cdl_scuola');
          if (select) {
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        await page.waitForFunction(criteria => {
          const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          return Array.from(document.querySelector('#cdl_co')?.options || []).some(option =>
            (criteria.courseId && option.value.toLowerCase() === criteria.courseId.toLowerCase()) ||
            (criteria.courseName && normalize(option.text).includes(criteria.courseName)));
        }, { timeout: 4000 }, { courseId, courseName: expectedName }).catch(() => {});

        courseOptions = await page.$$eval('#cdl_co option', options => options.map(option => ({ value: option.value, text: option.text.trim() })));
        course = getCourseOptions(courseOptions, { courseId, courseName, studyYear });
        if (course) break;
      }
    }
    if (!course) throw errorWithStatus('Corso non trovato nell’offerta EasyAcademy.', 404, 'COURSE_NOT_FOUND');

    await page.select('#cdl_co', course.option.value);
    // EasyAcademy sometimes omits the study-year prefix from group labels;
    // wait for the options to load, then let selectStudyGroup handle both formats.
    await page.waitForFunction(() => Array.from(document.querySelector('#cdl_a2_multi')?.options || [])
      .some(option => option.value), { timeout: 15000 });
    const groups = await page.$$eval('#cdl_a2_multi option', options => options.map(option => ({ value: option.value, text: option.text.trim() })));
    const group = selectStudyGroup(groups, studyYear, channel, surnameInitial);
    if (!group) {
      // Elenco dei gruppi reali: serve per capire quale canale usare per questo corso.
      const available = groups.map(option => option.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
      console.warn(`[easyacademy] Canale "${channel}" non trovato per l'anno ${studyYear}. Gruppi: ${available.join(' | ')}`);
      throw errorWithStatus(
        `Canale "${channel}" non trovato per l’anno ${studyYear}. Gruppi disponibili: ${available.slice(0, 10).join('; ') || 'nessuno'}.`,
        400,
        'STUDY_GROUP_NOT_FOUND'
      );
    }
    await page.select('#cdl_a2_multi', group.value);

    if (semester !== null && semester !== undefined) {
      const semesterValue = `S${semester}`;
      const availableSemesters = await page.$$eval('#cdl_pd option', options => options.map(option => option.value));
      if (!availableSemesters.includes(semesterValue)) {
        throw errorWithStatus('Semestre non disponibile per il gruppo selezionato.', 400, 'SEMESTER_NOT_AVAILABLE');
      }
      await page.select('#cdl_pd', semesterValue);
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);
    await page.waitForFunction(() => document.querySelectorAll('[id^="info-popup"]').length > 0 ||
      /nessun evento|nessuna lezione/i.test(document.body.innerText), { timeout: 15000 }).catch(() => {});

    const events = await page.$$eval('[id^="info-popup"]', elements => elements
      .filter(element => /^info-popup\d+$/.test(element.id))
      .map(element => ({ id: element.id, text: element.innerText || '' })));
    const result = {
      source: 'EasyAcademy Unina',
      academicYear: academicYearOptions.find(option => option.value === selectedAcademicYear)?.text || selectedAcademicYear,
      course: course.text,
      studyYear,
      semester: semester ?? null,
      channel: group.text,
      events: events.map(event => ({
        id: event.id,
        ...parsePopupText(event.text),
        courseName: parsePopupText(event.text).courseName || course.text,
        selectedGroup: group.text
      }))
    };
    writeCache(key, result);
    return result;
  } catch (error) {
    if (error.status) throw error;
    throw errorWithStatus(`EasyAcademy non disponibile: ${error.message}`, 502, 'EASYACADEMY_REQUEST_FAILED');
  }
}

async function getTimetable({ courseId, courseName, academicYear, studyYear, semester, channel, surnameInitial }) {
  if (!courseName && !courseId) throw errorWithStatus('Imposta il corso nel profilo.', 409, 'PROFILE_ONBOARDING_REQUIRED');
  const key = cacheKey({ courseId, courseName, academicYear, studyYear, semester, channel, surnameInitial });
  const cached = readCache(key);
  if (cached) return cached;

  return queueScrapingTask({}, page => scrapeTimetablePage(page, {
    courseId, courseName, academicYear, studyYear, semester, channel, surnameInitial, key
  }));
}

function clearTimetableCache() {
  timetableCache.clear();
}

module.exports = {
  getTimetable,
  parsePopupText,
  getCourseOptions,
  selectStudyGroup,
  matchesStudyGroup,
  clearTimetableCache,
  navigateToAgenda,
  CACHE_TTL_MS,
  CACHE_VERSION
};
