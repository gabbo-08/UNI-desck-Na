require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { loginRateLimitKey } = require('./lib/login-rate-limit');

// Router Modules
const authRoutes = require('./routes/auth');
const careerRoutes = require('./routes/career');
const profileRoutes = require('./routes/profile');
const careerPlanRoutes = require('./routes/career-plan');
const studyPlanRoutes = require('./routes/study-plans');
const timetableRoutes = require('./routes/timetable');
const docentiRoutes = require('./routes/docenti');
const metricheRoutes = require('./routes/metriche');

const authModule = require('./middleware/auth');
const authMiddleware = authModule.authMiddleware || authModule;
const { csrfProtection, normalizeOrigin, isOriginAllowed } = require('./lib/csrf');

const { db } = require('./db');
const { startSessionCleanup } = require('./services/server-sessions');
const { initCluster, closeCluster, isClusterReady } = require('./scraper/pool');
const { assertRuntimeConfig } = require('./lib/runtime-config');
const { purgeExpiredPersonalData } = require('./db/repository');
const { safeErrorMeta } = require('./lib/safe-log');
const { observabilityMiddleware, snapshotMetrics } = require('./lib/observability');
const { metricsAuthorized } = require('./lib/metrics-access');
const supportRoutes = require('./routes/support');
const { createSupportAdminRouter } = require('./routes/support-admin');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const { parseTrustProxy } = require('./lib/proxy-config');
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.use(observabilityMiddleware);

// 🛡️ Sicurezza Intestazioni HTTP
app.use(helmet());

// 🌐 Configurazione CORS
const frontendOrigins = [...new Set([
  ...(String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000']),
  ...String(process.env.FRONTEND_URL || '').split(',').map(normalizeOrigin).filter(Boolean),
  normalizeOrigin(process.env.PUBLIC_ORIGIN)
].filter(Boolean))];

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    if (normalized && (frontendOrigins.includes(normalized) || isOriginAllowed({ headers: { origin: normalized } }, normalized))) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

// 🔑 Protezione CSRF
app.use(csrfProtection);

// 🩺 Health Check (Senza Rate Limit)
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString(), requestId: req.requestId }));
app.get('/ready', (req, res) => {
  const databaseReady = Boolean(db && db.open !== false);
  const scraperReady = isClusterReady();
  const ready = databaseReady && scraperReady;
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'starting',
    checks: { database: databaseReady, scraper: scraperReady },
    requestId: req.requestId
  });
});
app.get('/readiness', (req, res) => {
  const databaseReady = Boolean(db && db.open !== false);
  const scraperReady = isClusterReady();
  const ready = databaseReady && scraperReady;
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'starting',
    checks: { database: databaseReady, scraper: scraperReady },
    requestId: req.requestId
  });
});

// ⏱️ Rate Limiting Generale (Corretto il calcolo del tempo)
app.use(rateLimit({ windowMs: 60 * 1000, max: 100, message: { error: 'Troppe richieste.' } }));
app.get('/metrics', (req, res) => {
  if (!metricsAuthorized(req)) return res.status(404).json({ error: 'Risorsa non disponibile.' });
  return res.json(snapshotMetrics());
});

// 🔒 Rate Limiting Severo per i Login
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi di accesso. Riprova tra qualche minuto.' }
});
const loginAccountIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: loginRateLimitKey,
  message: { error: 'Troppi tentativi per questo account da questa rete. Riprova tra qualche minuto.' }
});

// 📦 Body Parser JSON
app.use(express.json({ limit: '200kb', strict: false }));
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});
app.post('/api/auth/login', loginIpLimiter, loginAccountIpLimiter);

/* ------------------------------------------------------------------ */
/* 🔓 ROTTE PUBBLICHE                                                 */
/* ------------------------------------------------------------------ */
app.use('/api/auth', authRoutes);

/* ------------------------------------------------------------------ */
/* 🔒 ROTTE PROTETTE DA AUTHENTICATION MIDDLEWARE                     */
/* ------------------------------------------------------------------ */
app.use('/api/profile', authMiddleware, profileRoutes);
app.use('/api/career-plan', authMiddleware, careerPlanRoutes);
app.use('/api/career', authMiddleware, careerRoutes);
app.use('/api/metriche', authMiddleware, metricheRoutes);
app.use('/api/study-plans', authMiddleware, studyPlanRoutes);
app.use('/api/timetable', authMiddleware, timetableRoutes);

/* ------------------------------------------------------------------ */
/* 🔀 ROTTE IBRIDE (Avvisi Pubblici + Area Riservata Protetta)        */
/* ------------------------------------------------------------------ */
app.use('/api/docenti', docentiRoutes);
app.use('/api/support', authMiddleware, supportRoutes);
app.use('/api/support-admin', createSupportAdminRouter());
app.use('/api/notifications', authMiddleware, notificationRoutes);

/* ------------------------------------------------------------------ */
/* ❌ HANDLER ERRORE 404 & GLOBALE 500                                */
/* ------------------------------------------------------------------ */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Endpoint API non trovato: ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  // Gli errori di parsing del body possono incorporare frammenti della richiesta
  // (anche credenziali): non logghiamo né restituiamo il loro messaggio grezzo.
  const isParseError = err?.type === 'entity.parse.failed' || err instanceof SyntaxError;
  const status = err.status || 500;
  const clientMessage = 'Richiesta non valida.';
  console.error('[Server Error]', safeErrorMeta(err), isParseError ? '(payload non valido)' : 'richiesta rifiutata');
  res.status(status).json({
    error: status >= 500 ? 'Errore interno del server.' : clientMessage
  });
});

/* ------------------------------------------------------------------ */
/* 🚀 AVVIO ED ESECUZIONE SERVER CON GRACEFUL SHUTDOWN                */
/* ------------------------------------------------------------------ */
let server = null;
let shuttingDown = false;
let retentionTimer = null;
let sessionCleanupTimer = null;

async function start() {
  assertRuntimeConfig();
  sessionCleanupTimer = startSessionCleanup(db);
  purgeExpiredPersonalData(db);
  retentionTimer = setInterval(() => {
    try { purgeExpiredPersonalData(db); } catch (error) { console.error('[Retention Error]', safeErrorMeta(error)); }
  }, 60 * 60 * 1000);
  retentionTimer.unref?.();
  const clusterStartup = initCluster();
  server = app.listen(PORT, HOST, () => {
    const publicOrigin = normalizeOrigin(process.env.PUBLIC_ORIGIN) || `http://${HOST}:${PORT}`;
    console.log(`[System] API attive su ${publicOrigin}`);
  });
  await clusterStartup;
}

async function gracefulShutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[System] ${signal} ricevuto: spegnimento sicuro...`);

  const forceExit = setTimeout(() => {
    console.error('[System] Spegnimento forzato dopo 10s.');
    process.exit(exitCode || 1);
  }, 10000);
  forceExit.unref();

  if (retentionTimer) clearInterval(retentionTimer);
  if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);

  // Ferma prima gli ingressi e attendi le richieste in corso: scraper e DB
  // devono restare disponibili fino all'invio dell'ultima risposta.
  if (server) {
    await new Promise(resolve => server.close(resolve));
    console.log('[System] Server HTTP chiuso.');
  }

  try {
    await closeCluster();
  } catch (error) {
    console.error('[System] Errore chiusura cluster:', safeErrorMeta(error));
  }

  try {
    db.close();
  } catch (error) {
    console.error('[System] Errore chiusura database:', safeErrorMeta(error));
  }

  clearTimeout(forceExit);
  process.exit(exitCode);
}

process.on('uncaughtException', error => {
  console.error('[System] Eccezione non gestita:', safeErrorMeta(error));
  void gracefulShutdown('uncaughtException', 1);
});
process.on('unhandledRejection', reason => {
  console.error('[System] Promise rejection non gestita:', safeErrorMeta(reason));
  void gracefulShutdown('unhandledRejection', 1);
});
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start().catch(error => {
  console.error('[System] Fallimento critico avvio:', safeErrorMeta(error));
  process.exit(1);
});
