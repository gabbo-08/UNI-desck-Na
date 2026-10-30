# 🎓 Segrepass & Unina Smart Dashboard

Piattaforma web avanzata e orientata allo studente per la gestione della carriera universitaria presso l'**Università degli Studi di Napoli Federico II**, progettata per semplificare l'accesso, monitorare le metriche di carriera e anticipare gli avvisi didattici tramite integrazione intelligente con i portali di Ateneo.

---

## 🚀 Funzionalità Principali

* **Accesso Semplificato e Unificato**: Autenticazione rapida tramite credenziali istituzionali (`@studenti.unina.it`), con ponte automatizzato verso i servizi Segrepass e il portale Docenti.
* **Onboarding Automatico (Zero-Click)**: Riconoscimento istantaneo del corso di laurea, della coorte e del dipartimento dello studente basato sul codice di immatricolazione (es. `DE3`, `D76`, `N46`).
* **Catalogo Ateneo Indicizzato ($O(1)$)**: Mappa completa di tutti i corsi di laurea attivi dell'Ateneo sincronizzata tramite scraping automatizzato in `config/courses.json`.
* **Dashboard Carriera & Metriche**: Visualizzazione in tempo reale di esami superati, media ponderata/aritmetica, CFU acquisiti e storico prenotazioni con tracciamento dello stato.
* **Bacheca Avvisi Intelligente**: Incrocio automatico tra i dati dell'orario delle lezioni (EasyAcademy) e le bacheche dei docenti (Webdocenti) per notificare tempestivamente avvisi e materiali didattici.
* **Smart Alert sui Corsi Mancanti**: Sistema di controllo proattivo che avvisa lo studente qualora stesse seguendo un insegnamento senza risultare ancora iscritto alla relativa pagina del docente.

---

## 🛠️ Stack Tecnologico

* **Frontend**: Next.js, React, Tailwind CSS per un'interfaccia moderna, reattiva e in stile dark mode.
* **Backend & Scraping**: Node.js, Express, **Puppeteer** per l'interazione headless con i portali istituzionali protetti di Unina.
* **Configurazione & Dati**: Moduli di lookup basati su strutture dati statiche in formato JSON per performance istantanee.

---