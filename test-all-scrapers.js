/**
 * Test Diagnostico Unificato per tutti gli Scraper UNINA (Segrepass + WebDocenti)
 * Uso: node test-all-scrapers.js
 */

const { initCluster, closeCluster } = require('./scraper/pool');
const { getDatiCarriera } = require('./scraper/segrepass');
const { getDocentiData, fetchAnnouncementsForProfessors } = require('./scraper/docenti');

// Impostare le credenziali nell'ambiente prima di eseguire lo script.
const USER_CREDENTIALS = {
  codiceFiscale: process.env.UNINA_CF,
  username: process.env.UNINA_USER,
  password: process.env.UNINA_PASS
};

if (!USER_CREDENTIALS.codiceFiscale || !USER_CREDENTIALS.username || !USER_CREDENTIALS.password) {
  console.error('Credenziali mancanti: imposta UNINA_CF, UNINA_USER e UNINA_PASS.');
  process.exit(1);
}

async function runDiagnosticTest() {
  console.log('======================================================================');
  console.log('🧪   AVVIO DIAGNOSTICA COMPLETA ALL-IN-ONE DEGLI SCRAPER UNINA       ');
  console.log('======================================================================\n');

  const report = {
    timestamp: new Date().toISOString(),
    credentials: {
      username: USER_CREDENTIALS.username,
      passwordLength: USER_CREDENTIALS.password ? USER_CREDENTIALS.password.length : 0
    },
    scrapers: {}
  };

  const startTime = Date.now();

  try {
    console.log('⚙️  Inizializzazione Puppeteer Cluster...');
    await initCluster();
    console.log('✅ Cluster Puppeteer pronto.\n');

    // ------------------------------------------------------------------
    // 1. TEST SCRAPER SEGREPASS (Carriera, Esami, Tasse, Appelli)
    // ------------------------------------------------------------------
    console.log('----------------------------------------------------------------------');
    console.log('📌 [1/3] Test Scraper SEGREPASS...');
    console.log('----------------------------------------------------------------------');
    const segrepassStart = Date.now();

    try {
      const segrepassData = await getDatiCarriera({
        codiceFiscale: USER_CREDENTIALS.codiceFiscale,
        password: USER_CREDENTIALS.password
      }, { phase: 'full' });

      const segrepassDuration = ((Date.now() - segrepassStart) / 1000).toFixed(2);
      console.log(`✅ Segrepass completato in ${segrepassDuration}s.`);

      report.scrapers.segrepass = {
        status: 'OK',
        durationSeconds: Number(segrepassDuration),
        extractedCounts: {
          esami: segrepassData?.esami?.length || 0,
          cfuAcquisiti: segrepassData?.cfuAcquisiti || 0,
          mediaPonderata: segrepassData?.mediaPonderata || '0.00',
          tasseInDebito: segrepassData?.tasse?.pending?.length || 0,
          tassePagate: segrepassData?.tasse?.paid?.length || 0,
          appelliDisponibili: segrepassData?.prenotazioni?.length || 0
        },
        rawData: segrepassData
      };
    } catch (err) {
      const segrepassDuration = ((Date.now() - segrepassStart) / 1000).toFixed(2);
      console.error(`❌ Errore durante lo scraping di Segrepass: ${err.message}`);

      report.scrapers.segrepass = {
        status: 'ERROR',
        durationSeconds: Number(segrepassDuration),
        error: err.message,
        stack: err.stack,
        rawData: null
      };
    }

    // ------------------------------------------------------------------
    // 2. TEST SCRAPER WEBDOCENTI PRIVATO (Login + Iscrizioni/Appelli)
    // ------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------------');
    console.log('📌 [2/3] Test Scraper WEBDOCENTI PRIVATO (Puppeteer)...');
    console.log('----------------------------------------------------------------------');
    const docentiStart = Date.now();

    try {
      const docentiData = await getDocentiData({
        username: USER_CREDENTIALS.username,
        password: USER_CREDENTIALS.password
      });

      const docentiDuration = ((Date.now() - docentiStart) / 1000).toFixed(2);

      if (docentiData && docentiData.available !== false) {
        console.log(`✅ WebDocenti Privato completato in ${docentiDuration}s.`);
        report.scrapers.webdocentiPrivato = {
          status: 'OK',
          durationSeconds: Number(docentiDuration),
          extractedCounts: {
            iscrizioniCorsi: docentiData?.subscriptions?.length || 0,
            esamiPrenotati: docentiData?.bookedExams?.length || 0,
            gruppiAvvisiDocenti: docentiData?.announcements?.length || 0
          },
          rawData: docentiData
        };
      } else {
        console.warn(`⚠️ WebDocenti Privato ha terminato con esito negativo: ${docentiData?.reason}`);
        report.scrapers.webdocentiPrivato = {
          status: 'FAILED_NO_DATA',
          durationSeconds: Number(docentiDuration),
          reason: docentiData?.reason || 'UNKNOWN_REASON',
          rawData: docentiData
        };
      }
    } catch (err) {
      const docentiDuration = ((Date.now() - docentiStart) / 1000).toFixed(2);
      console.error(`❌ Errore durante lo scraping di WebDocenti Privato: ${err.message}`);

      report.scrapers.webdocentiPrivato = {
        status: 'ERROR',
        durationSeconds: Number(docentiDuration),
        error: err.message,
        stack: err.stack,
        rawData: null
      };
    }

    // ------------------------------------------------------------------
    // 3. TEST WEBDOCENTI AVVISI REST PUBBLICI (No Browser)
    // ------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------------');
    console.log('📌 [3/3] Test WEBDOCENTI AVVISI REST PUBBLICI...');
    console.log('----------------------------------------------------------------------');
    const restStart = Date.now();

    const sampleProfessors = [
      'DAVIDE MASSAROTTI',
      'VALERIA VITTORINI',
      'MARCO LOPS',
      'OFELIA PISANTI',
      'MATTIA BRESCIA'
    ];

    try {
      const avvisiData = await fetchAnnouncementsForProfessors(sampleProfessors);
      const restDuration = ((Date.now() - restStart) / 1000).toFixed(2);

      console.log(`✅ WebDocenti Avvisi REST completato in ${restDuration}s.`);

      const totalAnnouncements = avvisiData.reduce((acc, g) => acc + (g.items?.length || 0), 0);

      report.scrapers.webdocentiRestAvvisi = {
        status: 'OK',
        durationSeconds: Number(restDuration),
        extractedCounts: {
          professoriRichiesti: sampleProfessors.length,
          professoriTrovati: avvisiData.length,
          totaleAvvisiScaricati: totalAnnouncements
        },
        rawData: avvisiData
      };
    } catch (err) {
      const restDuration = ((Date.now() - restStart) / 1000).toFixed(2);
      console.error(`❌ Errore durante il recupero REST degli Avvisi: ${err.message}`);

      report.scrapers.webdocentiRestAvvisi = {
        status: 'ERROR',
        durationSeconds: Number(restDuration),
        error: err.message,
        rawData: null
      };
    }

  } finally {
    console.log('\n🧹 Chiusura Puppeteer Cluster...');
    await closeCluster();
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  // ------------------------------------------------------------------
  // REPORT DIAGNOSTICO FINALE IN CONSOLE
  // ------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log('📊                   STATO DIAGNOSTICO FINALE                         ');
  console.log('======================================================================');
  console.log(`⏱️  Tempo totale diagnostica: ${totalDuration}s\n`);

  for (const [key, val] of Object.entries(report.scrapers)) {
    const icon = val.status === 'OK' ? '🟢' : (val.status === 'FAILED_NO_DATA' ? '🟡' : '🔴');
    console.log(`${icon} [${key.toUpperCase()}] -> Stato: ${val.status} (${val.durationSeconds}s)`);

    if (val.extractedCounts) {
      console.log('   📦 Dati estratti:', JSON.stringify(val.extractedCounts));
    }
    if (val.error) {
      console.log(`   🚨 Errore: ${val.error}`);
    }
    if (val.reason) {
      console.log(`   ⚠️ Motivo fallimento: ${val.reason}`);
    }
  }

  console.log('\n======================================================================');
  console.log('🔍                 DETTAGLIO COMPLETO DEI DATI ESTRATTI               ');
  console.log('======================================================================\n');

  console.log(JSON.stringify(report, null, 2));
}

runDiagnosticTest().catch(err => {
  console.error('💥 Errore fatale nello script di diagnostica:', err);
  process.exit(1);
});