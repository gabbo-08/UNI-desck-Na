// pool.js
const { Cluster } = require('puppeteer-cluster');

let cluster = null;
let initPromise = null;
let closePromise = null;

function closingError() {
  const error = new Error('Il servizio di scraping è in chiusura. Riprova tra poco.');
  error.code = 'SCRAPER_SHUTTING_DOWN';
  error.status = 503;
  return error;
}

async function initCluster() {
  if (closePromise) throw closingError();
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
  if (closePromise) throw closingError();
  const active = cluster || await initCluster();
  // La chiusura può iniziare mentre attendiamo il lancio del browser.
  if (closePromise || active !== cluster) throw closingError();
  return await active.execute(data, async ({ page, data }) => {
    return await scrapeLogic(page, data);
  });
}

async function closeCluster() {
  if (closePromise) return closePromise;
  if (!cluster && !initPromise) return;

  const starting = initPromise;
  closePromise = (async () => {
    if (starting) {
      // Anche un browser ancora in avvio appartiene al lifecycle corrente.
      // Un errore di lancio resta a carico del chiamante di initCluster.
      try { await starting; } catch {}
    }
    const active = cluster;
    if (!active) return;
    cluster = null;
    console.log('[Pool] Chiusura cluster in corso...');
    try {
      await active.idle();
    } finally {
      await active.close();
    }
    console.log('[Pool] Cluster disattivato.');
  })().finally(() => {
    closePromise = null;
  });
  return closePromise;
}

function isClusterReady() {
  return Boolean(cluster) && !closePromise;
}

module.exports = { initCluster, queueScrapingTask, closeCluster, isClusterReady };
