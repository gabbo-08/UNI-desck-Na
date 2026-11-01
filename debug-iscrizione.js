const puppeteer = require('puppeteer');
const fs = require('fs');

const USERNAME = process.env.UNINA_USER;
const PASSWORD = process.env.UNINA_PASS;

if (!USERNAME || !PASSWORD) {
  console.error('Credenziali mancanti: imposta UNINA_USER e UNINA_PASS.');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  console.log('🚀 Avvio debug iscrizioni WebDocenti...');
  const browser = await puppeteer.launch({ headless: false, defaultViewport: { width: 1280, height: 800 } });
  const page = await browser.newPage();

  const interceptedRequests = [];

  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/webdocenti-be/')) {
      let body = '';
      try { body = await response.text(); } catch (e) {}
      interceptedRequests.push({
        url,
        status: response.status(),
        bodyPreview: body.slice(0, 300)
      });
    }
  });

  // 1. Pagina di Login
  await page.goto('https://www.docenti.unina.it/login', { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  // 2. Seleziona ed esegui il click sul tab "STUDENTE"
  console.log('🔄 Selezione tab Studente...');
  const tabClicked = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('a, button, li, .nav-link, span, div'));
    const studentEl = elements.find(el => (el.textContent || '').trim().toLowerCase() === 'studente');
    if (studentEl) {
      (studentEl.closest('a, button, li') || studentEl).click();
      return true;
    }
    return false;
  });

  console.log(`Tab studente cliccato: ${tabClicked}`);
  await sleep(1500);

  // 3. Compilazione credenziali
  await page.waitForSelector('input[placeholder="Username"], input[type="text"]', { timeout: 10000 });
  await page.type('input[placeholder="Username"], input[type="text"]', USERNAME, { delay: 20 });
  await page.type('input[placeholder="Password"], input[type="password"]', PASSWORD, { delay: 20 });

  // 4. Click Accedi
  console.log('🔑 Invio form di login...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    const btn = btns.find(b => (b.textContent || b.value || '').trim().toLowerCase().startsWith('accedi'));
    if (btn) btn.click();
  });

  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await sleep(2000);

  console.log(`📍 URL post-login: ${page.url()}`);

  // 5. Navigazione a RIEPILOGO
  console.log('📌 Navigazione a /personal-area/student/summaries...');
  await page.goto('https://www.docenti.unina.it/personal-area/student/summaries', { waitUntil: 'networkidle2' });
  await sleep(3000);

  await page.screenshot({ path: 'iscrizioni-debug.png', fullPage: true });
  fs.writeFileSync('iscrizioni-debug.html', await page.content());

  console.log('\n📡 --- CHIAMATE API INTERCETTATE IN BACKGROUND ---');
  interceptedRequests.forEach(req => {
    console.log(`\n[${req.status}] ${req.url}`);
    console.log(`   Body: ${req.bodyPreview}`);
  });

  await browser.close();
})();