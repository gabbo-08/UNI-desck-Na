/**
 * Verifica dal vivo dell'acquisizione Docenti.
 * Uso: DOCENTI_USERNAME=... DOCENTI_PASSWORD=... node scripts/docenti-check.js
 * Stampa solo conteggi e campi vuoti: nessun dato personale.
 */
require('dotenv').config();
const { initCluster, closeCluster } = require('../scraper/pool');
const { getDocentiData } = require('../scraper/docenti');

(async () => {
  const username = process.env.DOCENTI_USERNAME || process.env.SEGREPASS_USER;
  const password = process.env.DOCENTI_PASSWORD || process.env.SEGREPASS_PASS;
  if (!username || !password) {
    console.error('Credenziali mancanti: imposta DOCENTI_USERNAME e DOCENTI_PASSWORD.');
    process.exit(1);
  }

  await initCluster();
  try {
    const startedAt = Date.now();
    const data = await getDocentiData({ username, password });
    const subscriptions = data.subscriptions || [];
    const bookedExams = data.bookedExams || [];
    const announcements = data.announcements || [];

    console.log(JSON.stringify({
      seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      available: data.available,
      reason: data.reason,
      subscriptions: subscriptions.length,
      bookedExams: bookedExams.length,
      announcements: announcements.length,
      subscriptionsWithProfessor: subscriptions.filter(item => item.professor && item.professor !== 'Non specificato').length,
      bookedWithExamDate: bookedExams.filter(item => item.examDate).length,
      bookedWithBookingDate: bookedExams.filter(item => item.bookingDate).length,
      announcementsWithLink: announcements.filter(group => group.items.some(item => item.link)).length
    }, null, 2));
  } finally {
    await closeCluster();
  }
})();
