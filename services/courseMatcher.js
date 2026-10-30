const coursesMap = require('../config/courses.json');

/**
 * Risolve istantaneamente le informazioni del corso partendo dal codice Segrepass
 * @param {string} courseCode - Es. "DE3", "D76", "N46"
 * @param {string} [fallbackName] - Nome estratto come riserva
 */
function resolveCourse(courseCode, fallbackName = '') {
  if (!courseCode) {
    return getFallbackCourse(fallbackName);
  }

  const cleanCode = String(courseCode).trim().toUpperCase();

  if (coursesMap[cleanCode]) {
    return {
      code: cleanCode,
      ...coursesMap[cleanCode]
    };
  }

  return getFallbackCourse(fallbackName, cleanCode);
}

function getFallbackCourse(fallbackName, code = 'UNKNOWN') {
  const cleanName = String(fallbackName).toUpperCase();

  for (const [key, course] of Object.entries(coursesMap)) {
    if (cleanName.includes(course.name)) {
      return { code: key, ...course };
    }
  }

  return {
    code,
    name: fallbackName || 'CORSO GENERICO',
    department: 'DIPARTIMENTO GENERALE',
    areaId: 'generale',
    easyAcademyId: code,
    degreeType: 'L'
  };
}

module.exports = { resolveCourse };