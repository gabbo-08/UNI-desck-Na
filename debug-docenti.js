const puppeteer = require('puppeteer');
const { getDocentiData } = require('./scraper/docenti');

// Impostare UNINA_USER e UNINA_PASS nell'ambiente prima di eseguire lo script.
const USERNAME = process.env.UNINA_USER;
const PASSWORD = process.env.UNINA_PASS;

if (!USERNAME || !PASSWORD) {
  console.error('Credenziali mancanti: imposta UNINA_USER e UNINA_PASS.');
  process.exit(1);
}

/**
 * Mock della coda: esegue la funzione dello scraper direttamente 
 * aprendo un browser Puppeteer locale invece di passare per il pool.
 */
async function mockQueueScrapingTask(data, taskFn) {
  console.log('🧪 [TEST] Avvio browser Puppeteer locale...');
  const browser = await puppeteer.launch({
    headless: false, // Imposta a true se non vuoi vedere la finestra del browser
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();

  try {
    return await taskFn(page, data);
  } finally {
    console.log('🧹 [TEST] Chiusura browser...');
    await browser.close();
  }
}

(async () => {
  console.log('🚀 Esecuzione test isolato per getDocentiData...\n');

  const start = Date.now();
  
  const result = await getDocentiData(
    { username: USERNAME, password: PASSWORD },
    { queueScrapingTask: mockQueueScrapingTask }
  );

  const duration = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n✅ Test completato in ${duration}s!`);
  console.log('📊 --- RISULTATO RESTITUITO ---');
  console.log(JSON.stringify(result, null, 2));
})();