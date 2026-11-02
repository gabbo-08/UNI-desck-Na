const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLoginPage } = require('../scraper/segrepass');

test('classifica come credenziali errate il rifiuto esplicito del portale', () => {
  assert.equal(classifyLoginPage({
    pageText: 'Credenziali non valide',
    hasLoginForm: true
  }), 'INVALID_CREDENTIALS');
});

test('non considera una pagina generica una prova di autenticazione', () => {
  assert.equal(classifyLoginPage({
    pageText: 'Benvenuto nella segreteria',
    hasLoginForm: false
  }), 'PORTAL_UNAVAILABLE');
});

test('richiede un indicatore autenticato verificabile', () => {
  assert.equal(classifyLoginPage({
    pageText: 'Matricola: 01234567',
    hasLoginForm: false,
    hasIdentityMarker: true
  }), 'AUTHENTICATED');
});
