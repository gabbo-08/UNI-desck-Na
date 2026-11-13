const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parsePopupText, getCourseOptions, selectStudyGroup, navigateToAgenda } = require('../services/easyacademy-provider');

test('consente solo il certificato scaduto del dominio EasyAcademy e ripristina TLS dopo la navigazione', async () => {
  const urls = [];
  const commands = [];
  const cdp = new EventEmitter();
  cdp.send = async (method, params) => {
    commands.push({ method, params });
    if (method === 'Security.setOverrideCertificateErrors' && params.override) {
      cdp.emit('Security.certificateError', { eventId: 1, errorType: 'ERR_CERT_DATE_INVALID', requestURL: 'https://easyacademy.unina.it/' });
      cdp.emit('Security.certificateError', { eventId: 2, errorType: 'ERR_CERT_DATE_INVALID', requestURL: 'https://example.com/' });
      cdp.emit('Security.certificateError', { eventId: 3, errorType: 'ERR_CERT_AUTHORITY_INVALID', requestURL: 'https://easyacademy.unina.it/' });
    }
  };
  cdp.detach = async () => {};
  const page = {
    async createCDPSession() { return cdp; },
    async setRequestInterception() {},
    on() {},
    async goto(url, options) {
      urls.push(url);
      assert.deepEqual(options, { waitUntil: 'domcontentloaded', timeout: 30000 });
    },
    async waitForFunction() {}
  };

  await navigateToAgenda(page);

  assert.deepEqual(urls, ['https://easyacademy.unina.it/agendastudenti/index.php?view=easycourse&_lang=it&include=corso']);
  assert.deepEqual(commands.filter(command => command.method === 'Security.handleCertificateError'), [
    { method: 'Security.handleCertificateError', params: { eventId: 1, action: 'continue' } },
    { method: 'Security.handleCertificateError', params: { eventId: 2, action: 'cancel' } },
    { method: 'Security.handleCertificateError', params: { eventId: 3, action: 'cancel' } }
  ]);
  assert.deepEqual(commands.filter(command => command.method === 'Security.setOverrideCertificateErrors'), [
    { method: 'Security.setOverrideCertificateErrors', params: { override: true } },
    { method: 'Security.setOverrideCertificateErrors', params: { override: false } }
  ]);
});

test('propaga gli errori di navigazione e ripristina TLS', async () => {
  const urls = [];
  const commands = [];
  const cdp = new EventEmitter();
  cdp.send = async (method, params) => commands.push({ method, params });
  cdp.detach = async () => {};
  const page = {
    async createCDPSession() { return cdp; },
    async goto(url) {
      urls.push(url);
      throw new Error('net::ERR_NAME_NOT_RESOLVED');
    }
  };

  await assert.rejects(navigateToAgenda(page), /ERR_NAME_NOT_RESOLVED/);
  assert.equal(urls.length, 1);
  assert.equal(commands.some(command => command.method === 'Security.setOverrideCertificateErrors' && !command.params.override), true);
});

test('parses course, teacher, date, time, room and campus from an EasyAcademy event', () => {
  const event = parsePopupText('DettagliNome insegnamentoANALISI MATEMATICA I (FG1:A-DIL)  Argomento lezioneANALISI MATEMATICA I (FG1:A-DIL)DocentiPASSARELLI DI NAPOLI ANTONIAData e Oralunedì 12 ottobre 202608:30 - 10:30AulaNome aula: CL-T-1Capacità: 180Sede: Via Claudio [Via Claudio, 21, 80125 Napoli NA]Google MapsPercorso didatticoINGEGNERIA INFORMATICA [DE3] Laurea - 1 - Corso generico A-DILNumero eventi collegati40 eventi');
  assert.equal(event.courseName, 'ANALISI MATEMATICA I');
  assert.equal(event.channel, 'FG1:A-DIL');
  assert.deepEqual(event.teachers, ['PASSARELLI DI NAPOLI ANTONIA']);
  assert.equal(event.date, '2026-10-12');
  assert.equal(event.startTime, '08:30');
  assert.equal(event.endTime, '10:30');
  assert.equal(event.room, 'CL-T-1');
  assert.equal(event.campus, 'Via Claudio');
});

test('selects the course variant matching the requested study year', () => {
  const options = [
    { value: 'DE3', text: 'INGEGNERIA INFORMATICA (Laurea)' },
    { value: 'N46', text: 'INGEGNERIA INFORMATICA (Terzo Anno) (Laurea)' }
  ];
  assert.equal(getCourseOptions(options, { courseId: 'N46', courseName: 'Ingegneria Informatica', studyYear: 2 }).option.value, 'DE3');
  assert.equal(getCourseOptions(options, { courseId: 'DE3', courseName: 'Ingegneria Informatica', studyYear: 3 }).option.value, 'N46');
});

test('maps surname initials to EasyAcademy groups that vary by study year', () => {
  const firstYear = [
    { value: 'A-DIL|1', text: '1 - Corso generico A-DIL' },
    { value: 'DIM-NES|1', text: '1 - Corso generico DIM-NES' },
    { value: 'NET-Z|1', text: '1 - Corso generico NET-Z' }
  ];
  const secondYear = [
    { value: 'A-I|2', text: '2 - Corso generico A-I' },
    { value: 'J-Z|2', text: '2 - Corso generico J-Z' }
  ];
  assert.equal(selectStudyGroup(firstYear, 1, 'FG1:A-DIL', 'C').value, 'A-DIL|1');
  assert.equal(selectStudyGroup(secondYear, 2, 'A-D', 'C').value, 'A-I|2');
  assert.equal(selectStudyGroup(secondYear, 2, 'A-DIL', 'T').value, 'J-Z|2');
});

test('preferisce il range alfabetico del corso al canale ereditato', () => {
  const groups = [
    { value: 'B-C|1', text: '1 - Cognomi B-C' },
    { value: 'S-A|1', text: '1 - Cognomi S-A' }
  ];
  assert.equal(selectStudyGroup(groups, 1, 'P-Z', 'S').value, 'S-A|1');
});
