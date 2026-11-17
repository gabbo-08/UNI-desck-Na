// pool.js
const { Cluster } = require('puppeteer-cluster');

let cluster = null;
let initPromise = null;

async function initCluster() {
  if (cluster) return cluster;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[Pool] Avvio inizializzazione Puppeteer Cluster...');

    const maxConcurrency = Math.min(4, Math.max(1, Number.parseInt(process.env.SCRAPER_CONCURRENCY || '3', 10) || 3));
    const timeout = Math.min(300000, Math.max(30000, Number.parseInt(process.env.SCRAPER_TASK_TIMEOUT_MS || '180000', 10) || 180000));
    const allowNoSandbox = /^(1|true|yes|on)$/i.test(String(process.env.PUPPETEER_ALLOW_NO_SANDBOX || ''));
    if (process.env.NODE_ENV === 'production' && allowNoSandbox) {
      throw new Error('PUPPETEER_ALLOW_NO_SANDBOX non ? consentito in produzione. Esegui Chromium con un utente non-root.');
    }

    const launched = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency,
      puppeteerOptions: {
        headless: 'new',
        args: [
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      },
      timeout,
    });

    launched.on('taskerror', (err, data) => {
      const profileKey = data?.profileKey || data?.profileId || 'unknown';
      console.error(`[Pool Error] Fallimento task di scraping per ${String(profileKey).slice(0, 3)}?: ${err?.code || err?.name || 'Error'}`);
    });

    cluster = launched;
    console.log(`[Pool] Puppeteer Cluster operativo (Max Concurrency: ${maxConcurrency})`);
    return cluster;
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}

async function queueScrapingTask(data, scrapeLogic) {
  if (!cluster) await initCluster();
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

function isClusterReady() {
  return Boolean(cluster);
}

module.exports = { initCluster, queueScrapingTask, closeCluster, isClusterReady };
