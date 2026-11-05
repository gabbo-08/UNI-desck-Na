'use client';

import { useEffect, useState } from 'react';
import { Check, Clipboard, Eye, EyeOff } from 'lucide-react';

type PinRevealProps = {
  pin?: string | null;
};

export default function PinReveal({ pin }: PinRevealProps) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  // Il portale ESIS può restituire PIN di 4, 5 o 6 cifre.
  const validPin = pin && /^\d{4,6}$/.test(pin) ? pin : null;

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  const copyPin = async () => {
    if (!validPin) return;
    try {
      await navigator.clipboard.writeText(validPin);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
      window.setTimeout(() => setCopyError(false), 3000);
    }
  };

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs">
      {validPin ? <button
        type="button"
        onClick={() => setVisible(current => !current)}
        aria-label={visible ? 'Nascondi PIN' : 'Mostra PIN'}
        className="inline-flex items-center gap-1.5 text-slate-200 hover:text-white"
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        <span>PIN: {visible ? validPin : '•••••'}</span>
      </button> : <span className="text-slate-400">PIN: non disponibile</span>}
      <button
        type="button"
        onClick={() => void copyPin()}
        disabled={!validPin}
        aria-label="Copia PIN"
        title={copyError ? 'Impossibile copiare il PIN' : 'Copia PIN'}
        className="rounded p-1 text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Clipboard className="h-3.5 w-3.5" />}
      </button>
      {copyError && <span role="alert" className="sr-only">Impossibile copiare il PIN.</span>}
    </div>
  );
}
