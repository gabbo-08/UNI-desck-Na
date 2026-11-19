const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { scrapePianoPage } = require('../scraper/piano');
const { normalizePianoTable } = require('../lib/piano-normalizer');

function frameWith({ text = '', rows = [], password = false } = {}) {
  const tables = rows.map(values => {
    const table = { querySelectorAll: selector => selector === 'tr' ? table.rows : [] };
    table.rows = values.map(cells => ({
      closest: () => table,
      children: cells.map(value => ({ tagName: 'TD', innerText: value, textContent: value }))
    }));
    return table;
  });
  const document = {
    body: { innerText: text },
    querySelectorAll: selector => selector === 'table' ? tables : [],
    querySelector: selector => selector === 'input[type="password"]' && password ? {} : null
  };
  return { evaluate: async (fn, rules) => vm.runInNewContext(`(${fn.toString()})(rules)`, { document, rules }) };
}

test('legge e unisce le tabelle del piano nei frame con intestazioni varianti', async () => {
  const page = {
    goto: async url => assert.match(url, /azione=pianiStudio/),
    frames: () => [frameWith({ text: 'Menu della carriera' }), frameWith({
      text: 'Insegnamenti del Piano:\n PIANO (IMM. DAL 2025/26) (N391)',
      rows: [
        [['Codice insegnamento', 'Insegnamento', 'Crediti', 'Anno'], ['CH01', 'Chimica generale', '9', 'PRIMO']],
        [['Codice', 'Denominazione', 'CFU', 'Anno corso'], ['CH02', 'Chimica organica', '6', 'SECONDO']]
      ]
    })]
  };
  const result = await scrapePianoPage(page, 'https://example.test/esis/', { timeoutMs: 0 });
  assert.equal(result.available, true);
  assert.equal(result.header.codiceCorso, 'N39');
  assert.deepEqual(normalizePianoTable(result.table).map(course => course.code), ['CH01', 'CH02']);
});

test('un timeout non elimina una tabella comunque disponibile, un errore di rete resta esplicito', async () => {
  const frame = frameWith({ rows: [[['Codice', 'Descrizione', 'CFU'], ['CH01', 'Chimica', '9']]] });
  const page = { goto: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }, frames: () => [frame] };
  assert.equal((await scrapePianoPage(page, 'https://example.test/esis/', { timeoutMs: 0 })).available, true);
  page.goto = async () => { throw Object.assign(new Error('network'), { code: 'ERR_NETWORK' }); };
  assert.equal((await scrapePianoPage(page, 'https://example.test/esis/', { timeoutMs: 0 })).reason, 'STUDY_PLAN_NAVIGATION_FAILED');
});

test('distingue una sessione ESIS scaduta da un piano senza tabella riconosciuta', async () => {
  const page = { goto: async () => {}, frames: () => [frameWith({ password: true })] };
  assert.equal((await scrapePianoPage(page, 'https://example.test/esis/', { timeoutMs: 0 })).reason, 'STUDY_PLAN_SESSION_EXPIRED');
  page.frames = () => [frameWith({ text: 'Piano di studi' })];
  assert.equal((await scrapePianoPage(page, 'https://example.test/esis/', { timeoutMs: 0 })).reason, 'STUDY_PLAN_TABLE_NOT_FOUND');
});
