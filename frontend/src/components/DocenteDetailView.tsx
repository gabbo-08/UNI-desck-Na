'use client';

import { useState } from 'react';
import Image from 'next/image';
import { BookOpen, CalendarDays, CheckCircle2, Clock3, ExternalLink, Files, Folder, FolderOpen, Mail, MapPin, Phone, Star, UserRound } from 'lucide-react';
import type { DettaglioDocente, MaterialeDocente } from '@/lib/api';
import { safeExternalUrl } from '@/lib/safe-content';

type DocenteDetailViewProps = {
  data: DettaglioDocente;
  onToggleSubscription: (course: string, subscribed: boolean) => Promise<void>;
  onDownload: (file: MaterialeDocente) => void;
  onLoadFolder: (folder: MaterialeDocente, section: 'pubblico' | 'ftp' | 'riservato') => Promise<MaterialeDocente[]>;
  favoriteMaterialIds: Set<string>;
  recentMaterials: string[];
  onToggleFavorite: (file: MaterialeDocente) => void;
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
  favoriteMaterialIds,
  onToggleFavorite,
  restricted = false,
  section,
  path = 'root',
}: {
  items: MaterialeDocente[];
  onDownload: (file: MaterialeDocente) => void;
  onLoadFolder: (folder: MaterialeDocente, section: 'pubblico' | 'ftp' | 'riservato') => Promise<MaterialeDocente[]>;
  favoriteMaterialIds: Set<string>;
  onToggleFavorite: (file: MaterialeDocente) => void;
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
      {items.length === 0 && <p className="teacher-empty-state">Nessun materiale disponibile in questa sezione.</p>}
      {items.map((item, index) => {
        const itemKey = `${path}:${item.id}:${index}`;
        const expanded = open[itemKey] ?? false;
        const children = folderItems[itemKey] || item.children || [];
        if (item.tipo === 'file') {
          return (
            <div key={itemKey} className="teacher-file-row flex min-w-0 items-start gap-1 rounded hover:bg-white/5">
              <button type="button" onClick={() => onDownload(item)} className="min-w-0 flex-1 rounded px-2 py-1 text-left text-sm text-sky-300">
                <span className="block break-words whitespace-normal leading-5">{item.nome}</span>
              </button>
              <button
                type="button"
                aria-label={favoriteMaterialIds.has(item.id) ? `Rimuovi ${item.nome} dai preferiti` : `Aggiungi ${item.nome} ai preferiti`}
                title={favoriteMaterialIds.has(item.id) ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
                onClick={() => onToggleFavorite(item)}
                className="rounded p-1.5 text-amber-300 hover:bg-white/10"
              >
                <Star className={`h-3.5 w-3.5 ${favoriteMaterialIds.has(item.id) ? 'fill-current' : ''}`} />
              </button>
            </div>
          );
        }
        return (
          <div key={itemKey} className="teacher-folder-row min-w-0 rounded border border-white/10">
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
            }} className="flex w-full min-w-0 items-start gap-2 px-2 py-2 text-left text-sm text-slate-200">
              {expanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
              <span className="min-w-0 flex-1 break-words whitespace-normal leading-5">{item.nome}</span>
            </button>
            {expanded && loading === itemKey && <p className="border-t border-white/10 px-2 py-2 text-xs text-slate-400">Caricamento contenuti...</p>}
            {expanded && loading !== itemKey && children.length > 0 && <div className="border-t border-white/10 py-1 pl-5"><MaterialTree items={children} onDownload={onDownload} onLoadFolder={onLoadFolder} favoriteMaterialIds={favoriteMaterialIds} onToggleFavorite={onToggleFavorite} restricted={restricted} section={section} path={itemKey} /></div>}
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

export default function DocenteDetailView({ data, onToggleSubscription, onDownload, onLoadFolder, favoriteMaterialIds, recentMaterials, onToggleFavorite }: DocenteDetailViewProps) {
  const personalUrl = safeExternalUrl(data.profilo.paginaWeb);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<(typeof categories)[number][0]>('pubblico');
  const [photoError, setPhotoError] = useState(false);
  const [followedCourseKeys, setFollowedCourseKeys] = useState<Set<string>>(new Set());
  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try { await action(); } finally { setBusy(null); }
  };

  const materialCount = categories.reduce((total, [key]) => total + (data.materiali[key]?.length || 0), 0);
  const examCount = data.appelli?.length || 0;
  const subscribedCount = data.iscrizioni?.filter(item => item.iscritto).length || 0;

  return (
    <section className="teacher-detail-modern space-y-8">
      <header className="teacher-profile-header teacher-profile-hero overflow-hidden rounded-2xl border border-sky-400/25 bg-gradient-to-r from-[#0b2947] to-[#10243b] p-5 shadow-[0_0_30px_-18px_rgba(56,189,248,0.9)] sm:p-7">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">Scheda docente</p>
        <div className="teacher-profile-identity flex items-start gap-4">
          {data.profilo.fotoUrl && !photoError ? (
            <Image src={data.profilo.fotoUrl} alt={`Foto di ${data.profilo.nome}`} width={64} height={64} unoptimized onError={() => setPhotoError(true)} className="teacher-profile-avatar h-16 w-16 rounded-full border-2 border-sky-300/60 object-cover" />
          ) : (
            <div className="teacher-profile-avatar grid h-16 w-16 place-items-center rounded-full border border-sky-300/40 bg-sky-400/10">
              <UserRound className="h-7 w-7 text-sky-300" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold uppercase text-white">{data.profilo.nome}</h1>
            {data.profilo.ruolo && <p className="text-sm text-slate-400">{data.profilo.ruolo}</p>}
          </div>
        </div>
        <div className="teacher-profile-contacts mt-4 flex flex-col gap-2 text-sm text-slate-300">
          {data.profilo.email && <a href={`mailto:${data.profilo.email}`} className="inline-flex items-center gap-1 hover:text-white"><Mail className="h-4 w-4" />{data.profilo.email}</a>}
          {data.profilo.telefono && <a href={`tel:${data.profilo.telefono}`} className="inline-flex items-center gap-1 hover:text-white"><Phone className="h-4 w-4" />{data.profilo.telefono}</a>}
          {personalUrl && <a href={personalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200"><ExternalLink className="h-4 w-4" />Pagina personale</a>}
        </div>
        <div className="teacher-profile-stats mt-6 grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
          <div><Files className="h-4 w-4" /><strong>{materialCount}</strong><span>sezioni materiali</span></div>
          <div><CalendarDays className="h-4 w-4" /><strong>{examCount}</strong><span>appelli pubblicati</span></div>
          <div><CheckCircle2 className="h-4 w-4" /><strong>{subscribedCount}</strong><span>iscrizioni attive</span></div>
        </div>
      </header>

      <section data-testid="teacher-office-hours" className="teacher-detail-block space-y-4">
        <div className="teacher-section-title"><h2><Clock3 className="h-5 w-5" />Orari di ricevimento</h2><span>Informazioni pubblicate dal portale</span></div>
        {data.ricevimento && data.ricevimento.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.ricevimento.map((slot, index) => (
              <div key={`${slot.giorno || 'slot'}-${slot.orario || index}`} className="teacher-office-slot">
                <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-sky-500" /><strong>{slot.giorno || 'Ricevimento'}</strong></div>
                {slot.orario && <p className="mt-1 text-sm">{slot.orario}</p>}
                {slot.luogo && <p className="mt-1 inline-flex items-center gap-1 text-xs"><MapPin className="h-3.5 w-3.5" />{slot.luogo}</p>}
                {slot.note && <p className="mt-1 text-xs">{slot.note}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="teacher-empty-state">Il portale Docenti non pubblica orari di ricevimento per questo profilo.</p>
        )}
      </section>

      <section data-testid="teacher-materials" className="teacher-detail-block space-y-4">
        <div className="teacher-section-title"><h2><BookOpen className="h-5 w-5" />Materiale didattico</h2><span>{materialCount} sezioni disponibili</span></div>
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
            <div key={key} className={`${key !== activeCategory ? 'hidden md:block' : ''} teacher-material-panel rounded-xl border border-white/10 bg-white/5 p-3`}>
              <h3 className="mb-2 font-medium text-slate-200">{label}</h3>
              <MaterialTree items={data.materiali[key]} onDownload={onDownload} onLoadFolder={onLoadFolder} favoriteMaterialIds={favoriteMaterialIds} onToggleFavorite={onToggleFavorite} restricted={key === 'riservato'} section={key} />
            </div>
          ))}
        </div>
        {recentMaterials.length > 0 && <p className="text-xs text-slate-400">Recenti in questa sessione: {recentMaterials.join(' · ')}</p>}
      </section>

      <section data-testid="teacher-exams" className="teacher-detail-block space-y-4">
        <div className="teacher-section-title"><h2><CalendarDays className="h-5 w-5" />Appelli di esame</h2><span>{examCount} pubblicati</span></div>
        <div className="teacher-table-shell overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase text-slate-400"><tr><th className="p-3">Esame</th><th className="p-3">Data esame</th><th className="p-3">Prenotazioni</th></tr></thead>
            <tbody>{data.appelli.map((exam, index) => {
              const examKey = `${exam.id || exam.insegnamento}-${exam.dataEsame || 'date'}-${index}`;
              return <tr key={examKey} className="border-t border-white/10 text-slate-300 transition-colors hover:bg-white/5">
                <td className="p-3">{exam.insegnamento}</td>
                <td className="p-3">{formatDate(exam.dataEsame)}</td>
                <td className="p-3 text-xs">Da {formatDate(exam.inizioPrenotazione)}<br />A {formatDate(exam.finePrenotazione)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section data-testid="teacher-subscriptions" className="teacher-detail-block space-y-4">
        <div className="teacher-section-title"><h2><CheckCircle2 className="h-5 w-5" />Iscrizioni alle lezioni</h2><span>{subscribedCount} attive</span></div>
        <div className="space-y-2">{data.iscrizioni.map((item, index) => {
          const subscriptionKey = `${item.courseCode || item.insegnamento}-${index}`;
          const followed = item.iscritto || followedCourseKeys.has(subscriptionKey);
          return <div data-testid="teacher-subscription-row" key={subscriptionKey} className="docenti-list-row flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"><span className="text-sm text-slate-200">{item.insegnamento}</span>{followed ? <span className="teacher-status-active inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold"><CheckCircle2 className="h-3.5 w-3.5" />{item.iscritto ? 'Iscritto al portale' : 'Seguito in app'}</span> : <button type="button" disabled={busy === subscriptionKey} aria-busy={busy === subscriptionKey} onClick={() => void run(subscriptionKey, async () => { await onToggleSubscription(item.insegnamento, item.iscritto); setFollowedCourseKeys(current => new Set(current).add(subscriptionKey)); })} className="teacher-status-follow rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-wait disabled:opacity-60">{busy === subscriptionKey ? 'Salvataggio…' : 'Segui in app'}</button>}</div>;
        })}</div>
      </section>
    </section>
  );
}
