// scraper/timetable.js
const fs = require('fs');
const path = require('path');

// 1. Carica dinamicamente la mappa di Unina
const uninaMapPath = path.join(__dirname, '../config/unina-map.json'); // Assicurati di mettere il JSON in una cartella 'config' o adatta il percorso
let uninaMap = { dipartimenti: {}, corsi: {} };

try {
  uninaMap = JSON.parse(fs.readFileSync(uninaMapPath, 'utf-8'));
} catch (error) {
  console.warn("[timetable] Impossibile caricare unina-map.json. Verifica il percorso.", error.message);
}

const EASYACADEMY_BASE_URL = 'https://easyacademy.unina.it/agendastudenti';

/**
 * Recupera l'orario da EasyAcademy in modo modulare
 */
async function getTimetableData({ courseCode, studyYear, channel }) {
  // 2. Traduzione del codice corso tramite la mappa
  const courseCodeUpper = String(courseCode).toUpperCase();
  const courseInfo = uninaMap.corsi[courseCodeUpper];

  if (!courseInfo) {
    throw new Error(`Corso con codice ${courseCodeUpper} non trovato nella mappa.`);
  }

  const deptInfo = uninaMap.dipartimenti[courseInfo.department];
  if (!deptInfo) {
    throw new Error(`Dipartimento ${courseInfo.department} non trovato nella mappa.`);
  }

  // 3. Estrazione dei parametri per EasyAcademy
  const facoltaId = deptInfo.easyacademy_facolta_id; // es. "ingegneria" o "giurisprudenza"
  const corsoId = courseInfo.easyAcademyId; // es. "DE3" o "N31"
  const sediPossibili = [...(deptInfo.sedi_principali || []), ...(deptInfo.campuses_aggiuntivi || [])];

  // 4. Costruzione della richiesta verso le API pubbliche di EasyAcademy
  // (La struttura esatta dei parametri dipende dall'endpoint di Unina, solitamente /ExportData/ o query params)
  const params = new URLSearchParams({
    view: 'easycourse',
    _lang: 'it',
    txt_facolta: facoltaId,
    txt_corso: corsoId,
    anno_corso: String(studyYear || 1),
    // Il canale (A-I, J-Z) viene spesso passato come parametro testuale o id
    txt_canale: channel || '' 
  });

  try {
    // Eseguiamo una fetch (EasyAcademy non richiede autenticazione o login con Puppeteer)
    const requestUrl = `${EASYACADEMY_BASE_URL}/index.php?${params.toString()}`;
    console.log(`[timetable] Fetching orario da: ${requestUrl}`);
    
    // const response = await fetch(requestUrl);
    // const htmlText = await response.text();
    // -> Qui andrebbe l'estrazione con Cheerio (se HTML) o il parsing (se JSON)
    
    // Per ora restituiamo l'oggetto strutturato con i dati della mappa per far comunicare il frontend
    return {
      academicYear: new Date().getFullYear(),
      course: courseInfo.name,
      department: courseInfo.department,
      polo: deptInfo.polo,
      campuses: sediPossibili,
      channel: channel || 'Unico',
      events: [
        /* 
         * Esempio di come il parser formatterà gli eventi estratti:
         * {
         *   date: "2026-10-31",
         *   startTime: "08:30",
         *   endTime: "10:30",
         *   courseName: "Analisi Matematica I",
         *   teachers: ["Prof. Mario Rossi"],
         *   room: "Aula T1",
         *   campus: "Piazzale Tecchio, 80"
         * }
         */
      ]
    };
  } catch (error) {
    console.error("[timetable] Errore durante il recupero da EasyAcademy:", error);
    throw new Error('TIMETABLE_FETCH_FAILED');
  }
}

module.exports = {
  getTimetableData,
  uninaMap
};