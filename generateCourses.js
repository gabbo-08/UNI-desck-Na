const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURAZIONE
// ==========================================

const CONFIG = {
  baseUrl: 'https://www.corsi.unina.it/?status=attivi&page=',
  startPage: 1,
  endPage: 22,
  timeout: 30000,
  retries: 3,
  delayBetweenPages: 500,
  saveEvery: 5,
  outputFile: path.join(__dirname, 'config', 'courses.json')
};

// ==========================================
// UTILITY
// ==========================================

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function ensureOutputDirectory() {
  const directory = path.dirname(CONFIG.outputFile);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// ==========================================
// INIZIALIZZAZIONE BROWSER
// ==========================================

async function initializeBrowser() {
  console.log('🌐 Inizializzazione browser Puppeteer...');
  return await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
}

// ==========================================
// ESTRAZIONE CORSI DAL DOM
// ==========================================

async function extractCourses(page) {
  return await page.evaluate(() => {
    const courses = [];
    const cardElements = document.querySelectorAll('.card, article, [class*="card"], div.bg-white');

    cardElements.forEach(card => {
      const text = card.innerText || '';
      const codeMatch = text.match(/\(([A-Z0-9]{3,5})\)/);

      if (!codeMatch) return;

      const code = codeMatch[1];
      const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

      const nameLine = lines.find(line => line.includes(`(${code})`));
      if (!nameLine) return;

      const name = nameLine.replace(`(${code})`, '').trim();
      if (!name) return;

      const department = lines.find(line => 
        line !== nameLine && !line.includes(`(${code})`)
      ) || 'DIPARTIMENTO GENERALE';

      courses.push({
        code,
        name,
        department
      });
    });

    return courses;
  });
}

// ==========================================
// NORMALIZZAZIONE DATI
// ==========================================

function normalizeCourse(course) {
  const name = normalizeText(course.name);
  const department = normalizeText(course.department);

  return {
    name: name.toUpperCase(),
    department: department.toUpperCase(),
    areaId: course.code.toLowerCase(),
    easyAcademyId: course.code,
    degreeType: /magistrale|master/i.test(name) ? 'LM' : 'L'
  };
}

// ==========================================
// SALVATAGGIO JSON
// ==========================================

function saveCatalog(catalog) {
  ensureOutputDirectory();
  const temporaryFile = CONFIG.outputFile + '.tmp';

  fs.writeFileSync(temporaryFile, JSON.stringify(catalog, null, 2), 'utf8');
  fs.renameSync(temporaryFile, CONFIG.outputFile);
}

// ==========================================
// SCRAPING SINGOLA PAGINA
// ==========================================

async function scrapePage(page, pageNum) {
  const url = `${CONFIG.baseUrl}${pageNum}`;

  for (let attempt = 1; attempt <= CONFIG.retries; attempt++) {
    try {
      console.log(`📄 Pagina ${pageNum}/${CONFIG.endPage} - Tentativo ${attempt}`);

      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: CONFIG.timeout
      });

      if (!response || !response.ok()) {
        throw new Error(`HTTP ${response ? response.status() : 'nessuna risposta'}`);
      }

      await page.waitForFunction(
        () => document.body && document.body.innerText.length > 0,
        { timeout: 10000 }
      );

      const courses = await extractCourses(page);
      return courses;
    } catch (error) {
      console.error(`⚠️ Errore pagina ${pageNum}: ${error.message}`);

      if (attempt === CONFIG.retries) {
        console.error(`❌ Pagina ${pageNum} non elaborata.`);
        return null;
      }

      await sleep(1000 * attempt);
    }
  }

  return null;
}

// ==========================================
// SCRAPING COMPLETO
// ==========================================

async function scrapeAllCourses() {
  console.log('\n======================================');
  console.log('🚀 UNINA - GENERATORE CATALOGO CORSI (22 PAGINE)');
  console.log('======================================\n');

  let browser;
  const catalog = {};
  const failedPages = [];
  let totalCoursesFound = 0;

  try {
    browser = await initializeBrowser();
    const page = await browser.newPage();

    page.setDefaultNavigationTimeout(CONFIG.timeout);
    await page.setViewport({ width: 1366, height: 768 });

    for (let pageNum = CONFIG.startPage; pageNum <= CONFIG.endPage; pageNum++) {
      const courses = await scrapePage(page, pageNum);

      if (courses === null) {
        failedPages.push(pageNum);
        console.log(`   └─ Pagina ${pageNum} saltata dopo i tentativi disponibili.`);
        continue;
      }

      console.log(`   └─ ${courses.length} corsi trovati`);
      totalCoursesFound += courses.length;

      courses.forEach(course => {
        if (course.code) {
          catalog[course.code] = normalizeCourse(course);
        }
      });

      if (pageNum % CONFIG.saveEvery === 0) {
        saveCatalog(catalog);
        console.log(`💾 Backup completato: ${Object.keys(catalog).length} corsi salvati`);
      }

      await sleep(CONFIG.delayBetweenPages);
    }

    saveCatalog(catalog);

    console.log('\n======================================');
    console.log('✅ SCRAPING COMPLETATO');
    console.log('======================================');
    console.log(`📚 Corsi unici censiti: ${Object.keys(catalog).length}`);
    console.log(`🔎 Corsi complessivamente rilevati: ${totalCoursesFound}`);
    console.log(`📄 Pagine analizzate: ${CONFIG.endPage - CONFIG.startPage + 1}`);
    console.log(`⚠️ Pagine non elaborate: ${failedPages.length}`);
    console.log(`💾 File generato: ${CONFIG.outputFile}`);

    if (failedPages.length > 0) {
      console.log('\nPagine da verificare: ' + failedPages.join(', '));
    }

    console.log('\n======================================\n');
  } catch (error) {
    console.error('\n❌ ERRORE GENERALE:', error);
    if (Object.keys(catalog).length > 0) {
      console.log('💾 Salvataggio dei dati recuperati...');
      saveCatalog(catalog);
    }
  } finally {
    if (browser) {
      await browser.close();
      console.log('🌐 Browser chiuso.');
    }
  }
}

// ==========================================
// AVVIO SCRIPT
// ==========================================

scrapeAllCourses().catch(error => {
  console.error('❌ Errore fatale:', error);
  process.exitCode = 1;
});