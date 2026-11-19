// lib/piano-normalizer.js
// Converte la tabella "Insegnamenti del Piano" letta da Segrepass nel formato canonico
// usato dal matching. Le colonne vengono riconosciute dal nome dell'intestazione,
// non dalla posizione, così eventuali cambi di ordine non rompono lo scraper.

const COLUMN_RULES = [
  ['code', /^(?:codice|cod\.?)(?:\s+(?:insegnamento|attivita(?: formativa)?|corso))?$/i],
  ['name', /^(?:descrizione|denominazione|insegnamento|attivita(?: formativa)?|materia)(?:\s+.*)?$/i],
  ['year', /^anno/i],
  ['outcome', /^esito$/i],
  ['grade', /^voto$/i],
  ['cfu', /^(?:c\.?f\.?u\.?|crediti)(?:\s+.*)?$/i],
  ['sector', /^(?:settore|ssd)(?:\s+.*)?$/i]
];

const YEAR_BY_WORD = { PRIMO: 1, SECONDO: 2, TERZO: 3, QUARTO: 4, QUINTO: 5, SESTO: 6 };
const FREE_CHOICE = /\bA\s+SCELTA\b/i;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function mapColumns(headers = []) {
  const map = {};
  (Array.isArray(headers) ? headers : []).map(normalizeHeader).forEach((header, index) => {
    for (const [key, rule] of COLUMN_RULES) {
      if (map[key] === undefined && rule.test(header)) {
        map[key] = index;
        break;
      }
    }
  });
  return map;
}

/**
 * @param {{headers: string[], rows: string[][]}} table
 * @returns {Array<object>} insegnamenti nel formato canonico (vedi README in fondo al file)
 */
function normalizePianoTable(table) {
  if (!table || !Array.isArray(table.rows)) return [];

  const col = mapColumns(table.headers);
  if (col.code === undefined || col.name === undefined || col.cfu === undefined) return [];

  const get = (cells, key) => (col[key] === undefined ? '' : clean(cells[col[key]]));
  const seen = new Set();
  const courses = [];

  for (const cells of table.rows) {
    if (!Array.isArray(cells)) continue;
    const repeatedHeader = mapColumns(cells);
    if (repeatedHeader.code !== undefined && repeatedHeader.name !== undefined && repeatedHeader.cfu !== undefined) continue;
    const code = get(cells, 'code');
    const name = get(cells, 'name');
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);

    const yearText = get(cells, 'year').toUpperCase();
    const grade = parseInt(get(cells, 'grade'), 10);
    const sector = get(cells, 'sector');
    const freeChoice = FREE_CHOICE.test(name);
    const wordYear = yearText.split(/\s+/)[0];
    const romanYears = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
    const studyYear = YEAR_BY_WORD[wordYear] ?? romanYears[wordYear] ?? (parseInt(yearText, 10) || null);
    const credits = Number.parseFloat(get(cells, 'cfu').replace(',', '.'));

    courses.push({
      id: code,
      code,
      courseCode: code,
      name,
      courseName: name,
      cfu: Number.isFinite(credits) && credits >= 0 ? credits : 0,
      // Stesso valore del manifesto in DB: la UI raggruppa su studyYear/study_year, non su year.
      year: studyYear,
      studyYear,
      study_year: studyYear,
      semester: null,
      // Euristica: gli insegnamenti "A SCELTA ..." sono a scelta libera.
      courseType: freeChoice ? 'elective' : 'mandatory',
      electiveGroup: freeChoice ? 'free_choice' : null,
      electiveRequiredCfu: null,
      sector: sector && sector !== '0' ? sector : null,
      // Esito e voto sono dello studente che ha letto la pagina: vanno usati solo per visualizzazione.
      outcome: get(cells, 'outcome') || null,
      grade: Number.isFinite(grade) ? grade : null
    });
  }

  return courses;
}

module.exports = { normalizePianoTable, mapColumns, COLUMN_RULES };

/*
 * Formato canonico di un insegnamento:
 * { id, code, courseCode, name, courseName, cfu, year, studyYear, study_year, semester,
 *   courseType: 'mandatory' | 'elective', electiveGroup, electiveRequiredCfu,
 *   sector, outcome, grade }
 */
