const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBookingResponse, submitAppelloAction } = require('../scraper/prenotazioni');

test('riconosce una prenotazione Segrepass confermata', () => {
  const result = parseBookingResponse('<div class="success">Prenotazione effettuata</div>');
  assert.deepEqual(result, { success: true, message: 'Prenotazione effettuata.' });
});

test('propaga il messaggio di rifiuto restituito da Segrepass', () => {
  const result = parseBookingResponse('<div>Finestra temporale chiusa</div>');
  assert.equal(result.success, false);
  assert.equal(result.message, 'Finestra temporale chiusa');
});

test('invia il form appello come urlencoded senza navigare fuori dalla sessione', async () => {
  let request;
  const page = {
    evaluate: async (_fn, args) => {
      request = args;
      return {
        ok: true,
        status: 200,
        html: '<div>Prenotazione effettuata</div>'
      };
    }
  };

  const result = await submitAppelloAction(page, 'https://www.segrepass1.unina.it', {
    annopri: '2025',
    numAppello: '80737'
  });

  assert.equal(result.success, true);
  assert.deepEqual(request, { annopri: '2025', numAppello: '80737' });
});

