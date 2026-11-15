'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bug, X } from 'lucide-react';
import { submitSupportReport, type SupportReportCategory } from '@/lib/api';

const categories: Array<{ value: SupportReportCategory; label: string }> = [
  { value: 'bug', label: 'Problema generale' },
  { value: 'materiali', label: 'Materiali Docenti' },
  { value: 'docenti', label: 'Portale Docenti' },
  { value: 'carriera', label: 'Carriera o esami' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'altro', label: 'Altro' },
];

export default function SupportReportForm() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportReportCategory>('bug');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>('#support-category')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (description.trim().length < 10) return;
    setBusy(true);
    setMessage('');
    try {
      await submitSupportReport({ category, description: description.trim(), context: { route: window.location.pathname, screen: 'dashboard' } });
      setDescription('');
      setMessage('Segnalazione ricevuta. Non sono state inviate password o token.');
    } catch {
      setMessage('Segnalazione non inviata. Riprova tra poco.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => { setOpen(true); setMessage(''); }} className="text-slate-400 underline-offset-2 hover:text-white hover:underline">Segnala un problema</button>
      {open && (
        <div ref={dialogRef} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="support-title" aria-describedby="support-description">
          <form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-2xl border border-white/15 bg-[#0A1B31] p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 id="support-title" className="flex items-center gap-2 text-base font-semibold text-white"><Bug className="h-4 w-4 text-[#E6C887]" /> Segnala un problema</h2>
              <button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} aria-label="Chiudi" className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <p id="support-description" className="text-xs leading-5 text-slate-400">Descrivi il problema senza inserire password, token, codici fiscali o documenti.</p>
            <label htmlFor="support-category" className="block text-xs text-slate-300">Categoria
              <select id="support-category" value={category} onChange={event => setCategory(event.target.value as SupportReportCategory)} className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                {categories.map(item => <option key={item.value} value={item.value} className="bg-[#0A1B31]">{item.label}</option>)}
              </select>
            </label>
            <label htmlFor="support-description-input" className="block text-xs text-slate-300">Descrizione
              <textarea id="support-description-input" value={description} onChange={event => setDescription(event.target.value)} minLength={10} maxLength={2000} required rows={5} className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" placeholder="Cosa è successo? Quale schermata stavi usando?" />
            </label>
            {message && <p role="status" aria-live="polite" className="text-xs text-slate-300">{message}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-300">Chiudi</button>
              <button type="submit" disabled={busy || description.trim().length < 10} className="rounded-lg bg-[#2F7FD0] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Invio…' : 'Invia segnalazione'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
