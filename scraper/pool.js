// pool.js
const { Cluster } = require('puppeteer-cluster');

let cluster = null;

async function initCluster() {
  if (cluster) return cluster;

  console.log('[Pool] Avvio inizializzazione Puppeteer Cluster...');
  
  cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT, // Isolamento dei cookie tra utenti
    maxConcurrency: 3, // Limite task simultanei per non sovraccaricare il server
    puppeteerOptions: {
      headless: 'new',
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--ignore-certificate-errors'
      ]
    },
    // Il login Segrepass può richiedere due tentativi di nodo + estrazione
    // esami, tasse e appelli: 120s erano insufficienti e chiudevano sessioni valide.
    timeout: 240000,
  });

  cluster.on('taskerror', (err, data) => {
    console.error(`[Pool Error] Fallimento task di scraping: ${err.message}`);
  });

  console.log('[Pool] Puppeteer Cluster operativo (Max Concurrency: 3)');
  return cluster;
}

async function queueScrapingTask(data, scrapeLogic) {
  if (!cluster) throw new Error("Cluster non inizializzato.");
  return await cluster.execute(data, async ({ page, data }) => {
    return await scrapeLogic(page, data);
  });
}

async function closeCluster() {
  if (cluster) {
    console.log('[Pool] Chiusura cluster in corso...');
    await cluster.idle();
    await cluster.close();
    cluster = null;
    console.log('[Pool] Cluster disattivato.');
  }
}

module.exports = { initCluster, queueScrapingTask, closeCluster };