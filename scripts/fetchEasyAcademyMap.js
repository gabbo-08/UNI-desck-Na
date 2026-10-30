// scripts/fetchEasyAcademyMap.js
const fs = require('fs');

// Endpoint pubblico dove EasyAcademy mantiene l'elenco di strutture e corsi
const EASYACADEMY_COMBO_URL = 'https://orari.unina.it/apps/now/combo.php'; // o l'URL specifico dell'istanza Unina

async function downloadFullMap() {
  console.log('[EasyAcademy] Scaricamento albero strutture e corsi...');
  
  try {
    // 1. Richiediamo l'elenco delle Aree / Dipartimenti
    const resAree = await fetch(`${EASYACADEMY_COMBO_URL}?sw=ec_&aa=2025&cat=dip`);
    const aree = await resAree.json();

    const resultMap = [];

    // 2. Per ogni area (es. Giurisprudenza, Ingegneria Fuorigrotta, ecc.), scarichiamo i corsi associati
    for (const area of aree) {
      console.log(` -> Recupero corsi per: ${area.label}`);
      
      const resCorsi = await fetch(`${EASYACADEMY_COMBO_URL}?sw=ec_&aa=2025&cat=cor&dip=${area.val}`);
      const corsi = await resCorsi.json();

      resultMap.push({
        areaId: area.val,
        areaName: area.label,
        courses: corsi.map(c => ({
          courseId: c.val,
          courseName: c.label
        }))
      });
    }

    // 3. Salva la mappa completa in locale
    fs.writeFileSync('./easyacademy_structure.json', JSON.stringify(resultMap, null, 2));
    console.log('✅ Mappa salvata con successo in easyacademy_structure.json!');

  } catch (error) {
    console.error('Errore durante il recupero della mappa EasyAcademy:', error);
  }
}

downloadFullMap();