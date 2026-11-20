const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDocentiTables,
  getDocentiData,
  mapAnnouncement,
  findTeacher,
  fetchAnnouncementsForProfessors,
  fetchTeacherDetail,
  fetchTeacherPhoto,
  matchesImageSignature,
  dedupeMaterialTree,
  ensureDocentiSessionResponse
} = require('../scraper/docenti');
const { mapSubscription, isUsableSubscription, mapDocentiTest, mapBookedExam } = require('../scraper/docenti');

test('mantiene la mezzanotte esplicita nei confini prenotazione con timestamp e offset', () => {
  const midnight = Date.parse('2026-11-20T00:00:00+01:00');
  const result = mapBookedExam({
    dataEsame: midnight,
    dataInizioPrenotazione: midnight,
    dataFinePrenotazione: '2026-11-21T00:00:00+01:00'
  });

  assert.equal(result.inizioPrenotazione, '20/11/2026 00:00');
  assert.equal(result.finePrenotazione, '2026-11-21T00:00:00+01:00');
  assert.equal(result.examDate, '20/11/2026');
  assert.equal(mapBookedExam({ dataFinePrenotazione: midnight }).finePrenotazione, '20/11/2026 00:00');
});

test('non aggiunge orari ai confini prenotazione che hanno solo la data', () => {
  const result = mapBookedExam({
    dataInizioPrenotazione: '20/11/2026',
    dataFinePrenotazione: '2026-11-21'
  });

  assert.equal(result.inizioPrenotazione, '20/11/2026');
  assert.equal(result.finePrenotazione, '2026-11-21');
});

test('accetta solo firme immagine supportate e coerenti col MIME type', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(matchesImageSignature('image/png', png), true);
  assert.equal(matchesImageSignature('image/jpeg', jpeg), true);
  assert.equal(matchesImageSignature('image/svg+xml', Buffer.from('<svg/>')), false);
  assert.equal(matchesImageSignature('image/png', jpeg), false);
});

test('richiede la foto Docenti con la negoziazione immagini usata dal browser', async t => {
  let requestedHeaders;
  t.mock.method(global, 'fetch', async (_url, options) => {
    requestedHeaders = options.headers;
    return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x00]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' }
    });
  });

  const photo = await fetchTeacherPhoto('teacher-1');

  assert.equal(photo.contentType, 'image/jpeg');
  assert.equal(photo.buffer.length, 4);
  assert.match(requestedHeaders.Accept, /image\/webp/);
  assert.match(requestedHeaders.Accept, /\*\/\*;q=0\.8/);
});

function withoutDocentiEnv(t) {
  const previousUsername = process.env.DOCENTI_USERNAME;
  const previousPassword = process.env.DOCENTI_PASSWORD;
  delete process.env.DOCENTI_USERNAME;
  delete process.env.DOCENTI_PASSWORD;
  t.after(() => {
    if (previousUsername !== undefined) process.env.DOCENTI_USERNAME = previousUsername;
    if (previousPassword !== undefined) process.env.DOCENTI_PASSWORD = previousPassword;
  });
}

function fakePage() {
  const inputs = [
    { click: async () => {}, press: async () => {}, type: async () => {} },
    { click: async () => {}, press: async () => {}, type: async () => {} }
  ];
  return {
    goto: async () => {},
    evaluate: async () => {},
    waitForSelector: async () => inputs[0],
    waitForFunction: async () => {},
    $: async selector => (String(selector).includes('Password') || String(selector).includes('password') ? inputs[1] : inputs[0]),
    $$: async () => inputs,
    click: async () => {},
    waitForNavigation: async () => null,
    url: () => 'https://www.docenti.unina.it/personal-area/student/summaries',
    frames: () => []
  };
}

test('separa corsi sottoscritti e appelli prenotati', () => {
  const result = normalizeDocentiTables([
    {
      headers: ['Codice', 'Insegnamento', 'Docente', 'Anno Accademico'],
      records: [{ Codice: 'INF1', Insegnamento: 'Reti di calcolatori', Docente: 'Docente A', 'Anno Accademico': '2026/2027' }]
    },
    {
      headers: ['Esame', 'Data Appello', 'Stato', 'Aula'],
      records: [
        { Esame: 'Reti di calcolatori', 'Data Appello': '10/01/2027', Stato: 'Prenotato', Aula: 'T1' },
        { Esame: 'Non sono presenti iscrizioni...', 'Data Appello': '', Stato: '', Aula: '' }
      ]
    }
  ]);

  assert.equal(result.subscriptions.length, 1);
  assert.equal(result.subscriptions[0].professor, 'Docente A');
  assert.equal(result.bookedExams.length, 1);
  assert.equal(result.bookedExams[0].courseName, 'Reti di calcolatori');
  assert.equal(result.bookedExams[0].examDate, '10/01/2027');
  assert.equal(result.bookedExams[0].location, 'T1');
});

test('scarta righe senza insegnamento e non interpreta tabelle anagrafiche come iscrizioni', () => {
  const unrelated = normalizeDocentiTables([{
    title: 'Dati studente',
    headers: ['Nome', 'Cognome', 'Corso di laurea'],
    records: [{ Nome: 'Gabriel', Cognome: 'Cacace', 'Corso di laurea': 'Ingegneria Informatica' }]
  }]);
  assert.deepEqual(unrelated.subscriptions, []);

  const professorOnly = mapSubscription({ nomeDocente: 'Flavia', cognomeDocente: 'Giannetti' });
  assert.equal(isUsableSubscription(professorOnly), false);
  assert.equal(isUsableSubscription({ courseName: 'GIANNETTI FLAVIA', professor: 'GIANNETTI FLAVIA' }), false);
});

test('deduplica ricorsivamente cartelle e file ripetuti dal portale', () => {
  const tree = dedupeMaterialTree([
    { id: 'folder-1', nome: 'ESERCIZI', tipo: 'D', children: [
      { id: 'file-1', nome: 'Lezione1.pdf', tipo: 'F', url: 'https://www.docenti.unina.it/file/1' },
      { id: 'file-1', nome: 'Lezione1.pdf', tipo: 'F', url: 'https://www.docenti.unina.it/file/1' }
    ] },
    { id: 'folder-1', nome: 'ESERCIZI', tipo: 'D', children: [] }
  ]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].children.length, 1);
  assert.equal(tree[0].children[0].nome, 'Lezione1.pdf');
});

test('unisce i sottoalberi quando la stessa cartella arriva da pagine diverse', () => {
  const tree = dedupeMaterialTree([
    { materialId: 'folder-1', nome: 'ESERCIZI', tipo: 'D', children: [
      { materialId: 'file-1', nome: 'Lezione1.pdf', tipo: 'F' }
    ] },
    { materialId: 'folder-1', nome: 'ESERCIZI', tipo: 'D', children: [
      { materialId: 'file-2', nome: 'Lezione2.pdf', tipo: 'F' }
    ] }
  ]);

  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0].children.map(item => item.nome), ['Lezione1.pdf', 'Lezione2.pdf']);
});

test('separa test e gruppi dalla tabella personale Docenti', () => {
  const result = normalizeDocentiTables([{
    title: 'Test e gruppi',
    headers: ['Test', 'Gruppo', 'Insegnamento', 'Data Test'],
    records: [{
      Test: 'Test intermedio',
      Gruppo: 'A',
      Insegnamento: 'Analisi I',
      'Data Test': '10/11/2026'
    }]
  }]);

  assert.equal(result.tests.length, 1);
  assert.equal(result.tests[0].name, 'Test intermedio');
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].name, 'A');
});

test('mappa la pagina signin-groups senza confondere test, insegnamento e docente', () => {
  const mapped = mapDocentiTest({
    nome: 'Prima prova intermedia di Geometria e Algebra, Canale I',
    descrInse: 'Geometria ed Algebra',
    nomeDocente: 'Mattia Brescia',
    dataTest: '11/11/2026 10:00'
  });

  assert.equal(mapped.name, 'Prima prova intermedia di Geometria e Algebra, Canale I');
  assert.equal(mapped.courseName, 'Geometria ed Algebra');
  assert.equal(mapped.professor, 'Mattia Brescia');
  assert.match(mapped.date, /11\/11\/2026/);
});

test('non interpreta lo stato del corso come prenotazione d\'esame', () => {
  const result = normalizeDocentiTables([{
    headers: ['Corso di laurea', 'Insegnamento', 'Docente', 'Stato corso'],
    records: [{
      'Corso di laurea': 'Ingegneria Informatica',
      Insegnamento: 'Reti di calcolatori',
      Docente: 'Docente A',
      'Stato corso': 'Attivo'
    }]
  }]);

  assert.equal(result.subscriptions.length, 1);
  assert.equal(result.subscriptions[0].courseName, 'Reti di calcolatori');
  assert.equal(result.bookedExams.length, 0);
});

test('mappa un avviso del backend webdocenti-be nel formato del frontend', () => {
  const mapped = mapAnnouncement({
    id: 26963614,
    categoria: 'Esami',
    titolo: 'Calendario esami',
    testo: '<p>21 dicembre</p>',
    dataPubb: '2026-10-20T00:00:00+0200',
    allegati: [{ id: 'abc123' }]
  });

  test('normalizza le varianti dei campi delle iscrizioni senza scartarle', () => {
    const mapped = mapSubscription({
      teacherId: 'teacher-42',
      course_code: 'U6966',
      course_name: 'Fisica generale II',
      academicYear: '2026/2027',
      teacher: { nome: 'Davide', cognome: 'Massarotti' },
      channel: 'A'
    });

    assert.equal(mapped.professorId, 'teacher-42');
    assert.equal(mapped.courseCode, 'U6966');
    assert.equal(mapped.courseName, 'Fisica generale II');
    assert.equal(mapped.professor, 'Davide Massarotti');
    assert.equal(isUsableSubscription(mapped), true);
  });

  assert.equal(mapped.id, '26963614');
  assert.equal(mapped.title, 'Calendario esami');
  assert.equal(mapped.content, '<p>21 dicembre</p>');
  assert.equal(mapped.date, '2026-10-20T00:00:00+0200');
  assert.equal(mapped.link, 'https://www.docenti.unina.it/webdocenti-be/allegati/avvisi/abc123');
});

test('findTeacher ignora nomi troppo corti senza fare richieste', async () => {
  let called = false;
  const teacher = await findTeacher('ab', {
    fetchJson: async () => { called = true; return null; }
  });

  assert.equal(teacher, null);
  assert.equal(called, false);
});

test('findTeacher rifiuta il solo cognome quando la ricerca contiene nome e cognome', async () => {
  const teacher = await findTeacher('MARIA ROSSI', {
    fetchJson: async () => ({ content: [{ id: 't-rossi', nome: 'ANNA', cognome: 'ROSSI' }] })
  });
  assert.equal(teacher, null);
});

test('fetchAnnouncementsForProfessors raggruppa gli avvisi per docente', async () => {
  const calls = [];
  const groups = await fetchAnnouncementsForProfessors(
    ['BOCCARUSSO LUCA', 'BOCCARUSSO LUCA', 'Docente Ignoto'],
    {
      fetchJson: async path => {
        calls.push(path);
        if (path.startsWith('/docenti?')) {
          return path.includes('Ignoto')
            ? { content: [] }
            : { content: [{ id: 't1', nome: 'LUCA', cognome: 'BOCCARUSSO' }] };
        }
        if (path.includes('/avvisi')) {
          return {
            content: [{
              id: 1,
              titolo: 'Calendario esami',
              testo: '<p>21 dicembre</p>',
              dataPubb: '2026-10-20',
              allegati: []
            }]
          };
        }
        return null;
      }
    }
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].professor, 'LUCA BOCCARUSSO');
  assert.equal(groups[0].items[0].title, 'Calendario esami');
  // Il nome duplicato produce una sola ricerca; il docente inesistente viene scartato.
  assert.equal(calls.filter(path => path.startsWith('/docenti?')).length, 3);
});

test('fetchAnnouncementsForProfessors scarta risposte senza contenuto valido', async () => {
  const groups = await fetchAnnouncementsForProfessors(['Docente Test'], {
    fetchJson: async path => (path.includes('/avvisi') ? { content: [] } : { content: [{ id: 't1', nome: 'A', cognome: 'TEST' }] })
  });

  test('recupera e normalizza il dettaglio pubblico del docente', async () => {
    const detail = await fetchTeacherDetail({ id: 'teacher-1' }, {
      fetchJson: async path => {
        if (path === '/docenti/teacher-1') {
          return { id: 'teacher-1', nome: 'LUCA', cognome: 'ROSSI', email: 'luca.rossi@unina.it' };
        }
        if (path.endsWith('/insegnamenti')) {
          return { content: [{ nomeInse: 'Analisi I', codInse: 'A1' }, { nomeInse: 'Analisi I', codInse: 'A1' }] };
        }
        if (path.includes('/materiale-didattico/')) {
          return [{ id: 1, nome: 'Materiale', tipo: 'D' }];
        }
        if (path.includes('/insegnamenti-appelli')) {
          return { content: [{ id: 8, nomeInse: 'Analisi I', dataAppello: '2027-01-10' }] };
        }
        if (path.includes('/orari-ricevimento')) {
          return { content: [{ giorno: 'Mercoledì', oraInizio: '10:00', oraFine: '12:00', sede: 'Studio 12' }] };
        }
        return null;
      }
    });

    assert.equal(detail.profilo.email, 'luca.rossi@unina.it');
    assert.equal(detail.profilo.nome, 'LUCA ROSSI');
    assert.equal(detail.materiali.pubblico[0].tipo, 'cartella');
    assert.equal(detail.appelli[0].dataEsame, '2027-01-10');
    assert.equal(detail.iscrizioni[0].insegnamento, 'Analisi I');
    assert.equal(detail.iscrizioni.length, 1);
    assert.equal(detail.ricevimento[0].luogo, 'Studio 12');
    assert.equal(detail.ricevimento[0].orario, '10:00 - 12:00');
  });

  assert.deepEqual(groups, []);
});

test('senza credenziali non avvia il browser e non inventa avvisi', async t => {
  withoutDocentiEnv(t);

  const result = await getDocentiData({}, {
    fetchAnnouncements: async () => { throw new Error('non deve essere chiamato'); },
    queueScrapingTask: async () => { throw new Error('non deve essere chiamato'); }
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'DOCENTI_CREDENTIALS_REQUIRED');
  assert.deepEqual(result.subscriptions, []);
  assert.deepEqual(result.announcements, []);
});

test('con credenziali raccoglie iscrizioni e avvisi per docente', async () => {
  const result = await getDocentiData({ username: 'u', password: 'p' }, {
    queueScrapingTask: async (data, logic) => logic(fakePage(), data),
    extractTables: async () => [{
      headers: ['Insegnamento', 'Docente'],
      records: [{ Insegnamento: 'Reti di calcolatori', Docente: 'Docente A' }]
    }],
    fetchAnnouncements: async professors => {
      assert.deepEqual(professors, ['Docente A']);
      return [{
        professor: 'Docente A',
        slug: 'teacher-1',
        items: [{ id: '1', title: 'Avviso', content: '<p>Testo</p>', date: '2026-10-01' }]
      }];
    }
  });

  assert.equal(result.available, true);
  assert.equal(result.reason, null);
  assert.equal(result.subscriptions.length, 1);
  assert.equal(result.announcements.length, 1);
  assert.equal(result.announcements[0].professor, 'Docente A');
});

test('segnala l\'assenza di dati quando la pagina non contiene tabelle utili', async () => {
  const result = await getDocentiData({ username: 'u', password: 'p' }, {
    queueScrapingTask: async (data, logic) => logic(fakePage(), data),
    extractTables: async () => [],
    fetchAnnouncements: async () => []
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'DOCENTI_DATA_NOT_FOUND');
  assert.deepEqual(result.subscriptions, []);
});

test('classifica un redirect SSO come sessione Docenti scaduta', () => {
  assert.throws(
    () => ensureDocentiSessionResponse({ status: 200, url: 'https://idp.unina.it/login' }),
    error => error?.code === 'DOCENTI_SESSION_EXPIRED' && error?.status === 401
  );
});

test('classifica un 401 come sessione scaduta anche senza cookie in memoria', async t => {
  t.mock.method(global, 'fetch', async () => new Response(null, { status: 401 }));
  await assert.rejects(
    fetchTeacherPhoto('teacher-1', { sessionKey: 'profile-cold-start' }),
    error => error?.code === 'DOCENTI_SESSION_EXPIRED' && error?.status === 401
  );
});
