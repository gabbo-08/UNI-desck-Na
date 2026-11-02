'use client';

import { useState } from 'react';
import { ExternalLink, Folder, FolderOpen, Mail, Phone, UserRound } from 'lucide-react';
import type { DettaglioDocente, MaterialeDocente } from '@/lib/api';

type DocenteDetailViewProps = {
  data: DettaglioDocente;
  onToggleSubscription: (course: string, subscribed: boolean) => Promise<void>;
  onDownload: (file: MaterialeDocente) => void;
  onLoadFolder: (folder: MaterialeDocente, section: 'pubblico' | 'ftp' | 'riservato') => Promise<MaterialeDocente[]>;
};

const categories = [
  ['pubblico', 'Materiale pubblico'],
  ['ftp', 'Area FTP'],
  ['riservato', 'Materiale riservato'],
] as const;

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('it-IT');
}

function MaterialTree({
  items,
  onDownload,
  onLoadFolder,
  restricted = false,
  section,
  path = 'root',
}: {
  items: MaterialeDocente[];
  onDownload: (file: MaterialeDocente) => void;
  onLoadFolder: (folder: MaterialeDocente, section: 'pubblico' | 'ftp' | 'riservato') => Promise<MaterialeDocente[]>;
  restricted?: boolean;
  section: 'pubblico' | 'ftp' | 'riservato';
  path?: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [folderItems, setFolderItems] = useState<Record<string, MaterialeDocente[]>>({});

  return (
    <div className="space-y-1">
      {items.map((item, index) => {
        const itemKey = `${path}:${item.id}:${index}`;
        const expanded = open[itemKey] ?? false;
        const children = folderItems[itemKey] || item.children || [];
        if (item.tipo === 'file') {
          return (
            <button key={itemKey} type="button" onClick={() => onDownload(item)} className="block w-full rounded px-2 py-1 text-left text-sm text-sky-300 hover:bg-white/5">
              {item.nome}
            </button>
          );
        }
        return (
          <div key={itemKey} className="rounded border border-white/10">
            <button type="button" onClick={() => {
              const next = !expanded;
              setOpen(current => ({ ...current, [itemKey]: next }));
              if (next && !loaded[itemKey]) {
                setLoading(itemKey);
                void onLoadFolder(item, section)
                  .then(value => {
                    setFolderItems(current => ({ ...current, [itemKey]: value }));
                    setLoaded(current => ({ ...current, [itemKey]: true }));
                  })
                  .catch(() => setLoaded(current => ({ ...current, [itemKey]: true })))
                  .finally(() => setLoading(null));
              }
            }} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-slate-200">
              {expanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
              {item.nome}
            </button>
            {expanded && loading === itemKey && <p className="border-t border-white/10 px-2 py-2 text-xs text-slate-400">Caricamento contenuti...</p>}
            {expanded && loading !== itemKey && children.length > 0 && <div className="border-t border-white/10 py-1 pl-5"><MaterialTree items={children} onDownload={onDownload} onLoadFolder={onLoadFolder} restricted={restricted} section={section} path={itemKey} /></div>}
            {expanded && loading !== itemKey && children.length === 0 && (
              <p className="border-t border-white/10 px-2 py-2 text-xs italic text-slate-500">
                {restricted ? 'Contenuto riservato a questo insegnamento.' : 'Nessun file disponibile in questa cartella.'}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function DocenteDetailView({ data, onToggleSubscription, onDownload, onLoadFolder }: DocenteDetailViewProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number][0]>('pubblico');
  const [photoError, setPhotoError] = useState(false);
  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try { await action(); } finally { setBusy(null); }
  };

  return (
    <section className="space-y-6">
      <header className="overflow-hidden rounded-2xl border border-sky-400/25 bg-gradient-to-r from-[#0b2947] to-[#10243b] p-5 shadow-[0_0_30px_-18px_rgba(56,189,248,0.9)]">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">Scheda docente</p>
        <div className="flex items-center gap-4">
          {data.profilo.fotoUrl && !photoError ? (
            <img src={data.profilo.fotoUrl} alt="" onError={() => setPhotoError(true)} className="h-16 w-16 rounded-full border-2 border-sky-300/60 object-cover" />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full border border-sky-300/40 bg-sky-400/10">
              <UserRound className="h-7 w-7 text-sky-300" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold uppercase text-white">{data.profilo.nome}</h1>
            {data.profilo.ruolo && <p className="text-sm text-slate-400">{data.profilo.ruolo}</p>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-300">
          {data.profilo.email && <a href={`mailto:${data.profilo.email}`} className="inline-flex items-center gap-1 hover:text-white"><Mail className="h-4 w-4" />{data.profilo.email}</a>}
          {data.profilo.telefono && <a href={`tel:${data.profilo.telefono}`} className="inline-flex items-center gap-1 hover:text-white"><Phone className="h-4 w-4" />{data.profilo.telefono}</a>}
          {data.profilo.paginaWeb && <a href={data.profilo.paginaWeb} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200"><ExternalLink className="h-4 w-4" />Pagina personale</a>}
        </div>
      </header>

      <section data-testid="teacher-materials" className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Materiale didattico</h2>
        <div className="flex gap-2 overflow-x-auto pb-1 md:hidden">
          {categories.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveCategory(key)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium ${
                activeCategory === key
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                  : 'border-white/10 bg-white/5 text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {categories.map(([key, label]) => (
            <div key={key} className={`${key !== activeCategory ? 'hidden md:block' : ''} rounded-xl border border-white/10 bg-white/5 p-3`}>
              <h3 className="mb-2 font-medium text-slate-200">{label}</h3>
              <MaterialTree items={data.materiali[key]} onDownload={onDownload} onLoadFolder={onLoadFolder} restricted={key === 'riservato'} section={key} />
            </div>
          ))}
        </div>
      </section>

      <section data-testid="teacher-exams" className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Appelli di esame</h2>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase text-slate-400"><tr><th className="p-3">Esame</th><th className="p-3">Data esame</th><th className="p-3">Prenotazioni</th></tr></thead>
            <tbody>{data.appelli.map((exam, index) => {
              const examKey = `${exam.id || exam.insegnamento}-${exam.dataEsame || 'date'}-${index}`;
              return <tr key={examKey} className="border-t border-white/10 text-slate-300">
                <td className="p-3">{exam.insegnamento}</td>
                <td className="p-3">{formatDate(exam.dataEsame)}</td>
                <td className="p-3 text-xs">Da {formatDate(exam.inizioPrenotazione)}<br />A {formatDate(exam.finePrenotazione)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section data-testid="teacher-subscriptions" className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Iscrizioni alle lezioni</h2>
        <div className="space-y-2">{data.iscrizioni.map((item, index) => {
          const subscriptionKey = `${item.courseCode || item.insegnamento}-${index}`;
          return <div data-testid="teacher-subscription-row" key={subscriptionKey} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"><span className="text-sm text-slate-200">{item.insegnamento}</span><button type="button" onClick={() => void run(subscriptionKey, () => onToggleSubscription(item.insegnamento, item.iscritto))} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200">{item.iscritto ? 'Iscritto' : 'Iscriviti'}</button></div>;
        })}</div>
      </section>
    </section>
  );
}
