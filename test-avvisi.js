const { fetchAnnouncementsForProfessors } = require('./scraper/docenti');

// Uso:
//   node test-avvisi.js                       → ultimi 3 avvisi di ogni docente, TESTO COMPLETO
//   node test-avvisi.js "MARCO LOPS"          → solo quel docente
//   node test-avvisi.js --tutti               → tutti gli avvisi (non solo gli ultimi 3)
const DEFAULT_PROFESSORS = [
  'DAVIDE MASSAROTTI',
  'VALERIA VITTORINI',
  'MARCO LOPS',
  'OFELIA PISANTI',
  'MATTIA BRESCIA'
];

const args = process.argv.slice(2);
const showAll = args.includes('--tutti');
const names = args.filter(a => !a.startsWith('--'));
const professors = names.length ? names : DEFAULT_PROFESSORS;
const LIMIT = showAll ? Infinity : 3;

(async () => {
  const start = Date.now();
  const groups = await fetchAnnouncementsForProfessors(professors);

  console.log(`\n===== AVVISI (${groups.length}/${professors.length} docenti trovati) =====`);

  for (const group of groups) {
    console.log(`\n${'='.repeat(70)}\n${group.professor} — ${group.items.length} avvisi\nBacheca: ${group.boardUrl}\n${'='.repeat(70)}`);

    for (const item of group.items.slice(0, LIMIT)) {
      console.log(`\n▶ ${item.title}`);
      console.log(`  Data: ${item.date}${item.updatedAt && item.updatedAt !== item.date ? ` (aggiornato ${item.updatedAt})` : ''}`);
      if (item.category) console.log(`  Categoria: ${item.category}`);

      console.log('  ' + '-'.repeat(60));
      console.log(item.contentText
        ? item.contentText.split('\n').map(l => '  ' + l).join('\n')
        : '  (testo non presente: apri la bacheca per leggerlo)');
      console.log('  ' + '-'.repeat(60));

      if (item.attachments.length) {
        console.log('  Allegati:');
        item.attachments.forEach(a => console.log(`   - ${a.name}: ${a.url}`));
      }
    }
  }

  console.log(`\nCompletato in ${((Date.now() - start) / 1000).toFixed(1)}s`);
})().catch(err => {
  console.error('Errore nel test:', err);
  process.exit(1);
});