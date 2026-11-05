const test = require('node:test');
const assert = require('node:assert/strict');
const { scrapePin } = require('../scraper/segrepass');

test('scrapePin aspetta il caricamento del frameset ESIS e legge anche i valori dei campi', async () => {
  let reads = 0;
  let closed = false;
  const frame = {
    evaluate: async () => {
      reads += 1;
      return reads < 2 ? '' : 'PIN: 482731\nCodice Numerico Personale: 1234567890';
    }
  };
  const page = {
    setRequestInterception: async () => {},
    on: () => {},
    goto: async url => assert.match(url, /\/esis\/caricaMenu\.do\?azione=visualizzazionePin$/),
    frames: () => [frame],
    close: async () => { closed = true; }
  };
  const context = { newPage: async () => page };

  const result = await scrapePin(context, 'https://www.segrepass1.unina.it/esis/home.do');
  assert.deepEqual(result, { pin: '482731', codiceNumericoPersonale: '1234567890' });
  assert.ok(reads >= 2);
  assert.equal(closed, true);
});
