// lib/piano-normalizer.js
// Converte la tabella "Insegnamenti del Piano" letta da Segrepass nel formato canonico
// usato dal matching. Le colonne vengono riconosciute dal nome dell'intestazione,
// non dalla posizione, così eventuali cambi di ordine non rompono lo scraper.

const COLUMN_RULES = [
  ['code', /^codice$/i],
  ['name', /descrizione/i],
  ['year', /^anno/i],
  ['outcome', /^esito$/i],
  ['grade', /^voto$/i],
  ['cfu', /^cfu$/i],
  ['sector', /^settore$/i]
];

const YEAR_BY_WORD = { PRIMO: 1, SECONDO: 2, TERZO: 3, QUARTO: 4, QUINTO: 5, SESTO: 6 };
const FREE_CHOICE = /\bA\s+SCELTA\b/i;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function mapColumns(headers = []) {
  const map = {};
  headers.map(clean).forEach((header, index) => {
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
    const code = get(cells, 'code');
    const name = get(cells, 'name');
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);

    const yearText = get(cells, 'year').toUpperCase();
    const grade = parseInt(get(cells, 'grade'), 10);
    const sector = get(cells, 'sector');
    const freeChoice = FREE_CHOICE.test(name);
    const studyYear = YEAR_BY_WORD[yearText] ?? (parseInt(yearText, 10) || null);

    courses.push({
      id: code,
      code,
      courseCode: code,
      name,
      courseName: name,
      cfu: parseInt(get(cells, 'cfu'), 10) || 0,
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

module.exports = { normalizePianoTable, mapColumns };

/*
 * Formato canonico di un insegnamento:
 * { id, code, courseCode, name, courseName, cfu, year, studyYear, study_year, semester,
 *   courseType: 'mandatory' | 'elective', electiveGroup, electiveRequiredCfu,
 *   sector, outcome, grade }
 */
