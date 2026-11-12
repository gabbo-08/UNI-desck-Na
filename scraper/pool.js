// pool.js
const { Cluster } = require('puppeteer-cluster');

let cluster = null;

async function initCluster() {
  if (cluster) return cluster;

  console.log('[Pool] Avvio inizializzazione Puppeteer Cluster...');

  const maxConcurrency = Math.min(4, Math.max(1, Number.parseInt(process.env.SCRAPER_CONCURRENCY || '3', 10) || 3));
  const timeout = Math.min(300000, Math.max(30000, Number.parseInt(process.env.SCRAPER_TASK_TIMEOUT_MS || '180000', 10) || 180000));
  const allowNoSandbox = /^(1|true|yes|on)$/i.test(String(process.env.PUPPETEER_ALLOW_NO_SANDBOX || ''));
  if (process.env.NODE_ENV === 'production' && allowNoSandbox) {
    throw new Error('PUPPETEER_ALLOW_NO_SANDBOX non è consentito in produzione. Esegui Chromium con un utente non-root.');
  }
  
  cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT, // Isolamento dei cookie tra utenti
    maxConcurrency, // Limite task simultanei per non sovraccaricare il server
    puppeteerOptions: {
      headless: 'new',
      args: [
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    },
    // Il login Segrepass può richiedere due tentativi di nodo + estrazione
    // esami, tasse e appelli: 120s erano insufficienti e chiudevano sessioni valide.
    timeout,
  });

  cluster.on('taskerror', (err, data) => {
    const profileKey = data?.profileKey || data?.profileId || 'unknown';
    console.error(`[Pool Error] Fallimento task di scraping per ${String(profileKey).slice(0, 3)}…: ${err?.code || err?.name || 'Error'}`);
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
