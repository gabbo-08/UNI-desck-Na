'use client';

import { useState, useMemo } from 'react';
import { Mail, Users, GraduationCap, Search, RefreshCw, ChevronRight, Clock } from 'lucide-react';

type EmailCategory = 'tutte' | 'ateneo' | 'teams';

interface MockEmail {
  id: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  preview: string;
  date: string;
  category: 'ateneo' | 'teams';
  read: boolean;
}

// Dati finti per testare la UI prima di collegare le API di Microsoft
const MOCK_EMAILS: MockEmail[] = [
  {
    id: '1',
    senderName: 'Rettore Federico II',
    senderEmail: 'rettore@unina.it',
    subject: 'Sospensione attività didattiche per allerta meteo',
    preview: 'Si comunica che, a causa dell\'allerta meteo diramata dalla Protezione Civile, tutte le attività didattiche in presenza sono sospese per la giornata di domani...',
    date: '2026-10-24T18:30:00Z',
    category: 'ateneo',
    read: false,
  },
  {
    id: '2',
    senderName: 'Microsoft Teams',
    senderEmail: 'noreply@email.teams.microsoft.com',
    subject: 'Prof. De Simone ha avviato una riunione in Fondamenti di Informatica',
    preview: 'Partecipa ora alla riunione "Lezione 12 - Strutture Dati". La riunione è iniziata da 5 minuti nel canale Generale.',
    date: '2026-10-23T08:15:00Z',
    category: 'teams',
    read: true,
  },
  {
    id: '3',
    senderName: 'Segreteria Studenti',
    senderEmail: 'segreteria@studenti.unina.it',
    subject: 'Scadenza presentazione ISEE Universitario',
    preview: 'Gentile studente, ti ricordiamo che la scadenza per la presentazione dell\'attestazione ISEE per il ricalcolo delle tasse è fissata al...',
    date: '2026-10-20T10:00:00Z',
    category: 'ateneo',
    read: true,
  },
  {
    id: '4',
    senderName: 'Microsoft Teams',
    senderEmail: 'noreply@email.teams.microsoft.com',
    subject: 'Nuovo materiale caricato in Fisica Generale I',
    preview: 'Prof. Ofelia Pisanti ha caricato un nuovo file "Esercizi_Dinamica.pdf" nella cartella Materiale del corso.',
    date: '2026-10-18T15:45:00Z',
    category: 'teams',
    read: true,
  }
];

const CARD = 'rounded-2xl border border-[#3B7BC4]/30 bg-[#0A1B31]/75 shadow-[0_0_28px_-10px_rgba(70,150,230,0.55)] backdrop-blur-sm';

function formatEmailDate(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function CommunicationsView() {
  const [activeTab, setActiveTab] = useState<EmailCategory>('tutte');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Filtro delle email in base a tab e ricerca
  const filteredEmails = useMemo(() => {
    let filtered = MOCK_EMAILS;
    
    if (activeTab !== 'tutte') {
      filtered = filtered.filter(email => email.category === activeTab);
    }
    
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(e => 
        e.subject.toLowerCase().includes(q) || 
        e.senderName.toLowerCase().includes(q) ||
        e.preview.toLowerCase().includes(q)
      );
    }
    
    return filtered;
  }, [activeTab, search]);

  const simulateRefresh = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 800);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">Anteprima comunicazioni (demo)</h2>
          <p className="text-xs text-amber-200">Dati dimostrativi: questa vista non è collegata alla casella istituzionale o a Microsoft Teams.</p>
        </div>
        <button
          onClick={simulateRefresh}
          disabled={loading}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/5 text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5AB0F0] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex gap-2">
          {[
            { id: 'tutte', label: 'Tutte le comunicazioni', icon: Mail },
            { id: 'ateneo', label: 'Ateneo & Segreteria', icon: GraduationCap },
            { id: 'teams', label: 'Microsoft Teams', icon: Users }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as EmailCategory)}
              className={`flex min-h-10 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition ${
                activeTab === id
                  ? 'bg-[#2F7FD0] text-white shadow-[0_0_16px_-4px_rgba(47,127,208,0.8)]'
                  : 'border border-white/10 bg-white/5 text-slate-300 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Cerca in posta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-400 focus:border-[#5AB0F0] focus:outline-none"
          />
        </div>
      </div>

      <div className="grid gap-3">
        {loading ? (
          <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>
           Simulazione di aggiornamento demo in corso...
          </div>
        ) : filteredEmails.length > 0 ? (
          filteredEmails.map((email) => (
            <button
              key={email.id}
              className={`${CARD} group flex flex-col items-start gap-2 p-4 text-left transition hover:border-[#5AB0F0]/50 sm:flex-row sm:items-center sm:gap-4`}
            >
              {/* Icona laterale basata sulla categoria */}
              <div className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid ${
                email.category === 'teams' ? 'bg-[#5B5FC7]/20 text-[#7B83EB]' : 'bg-[#E0B25A]/20 text-[#E0B25A]'
              }`}>
                {email.category === 'teams' ? <Users className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />}
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {!email.read && <div className="h-2 w-2 rounded-full bg-[#5AB0F0]" />}
                    <span className={`text-xs font-bold ${!email.read ? 'text-white' : 'text-slate-300'}`}>
                      {email.senderName}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                    <Clock className="h-3 w-3" />
                    {formatEmailDate(email.date)}
                  </span>
                </div>
                <h3 className={`truncate text-sm ${!email.read ? 'font-bold text-[#5AB0F0]' : 'font-semibold text-white'}`}>
                  {email.subject}
                </h3>
                <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">
                  {email.preview}
                </p>
              </div>

              <div className="hidden shrink-0 pl-2 sm:block">
                <ChevronRight className="h-5 w-5 text-slate-500 transition group-hover:translate-x-1 group-hover:text-[#5AB0F0]" />
              </div>
            </button>
          ))
        ) : (
          <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>
            Nessuna comunicazione trovata per i filtri selezionati.
          </div>
        )}
      </div>
    </section>
  );
}
