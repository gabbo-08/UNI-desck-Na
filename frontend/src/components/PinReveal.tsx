'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PinRevealProps = {
  pin?: string | null;
};

export default function PinReveal({ pin }: PinRevealProps) {
  const [visible, setVisible] = useState(false);
  // Il portale ESIS può restituire PIN di 4, 5 o 6 cifre.
  const validPin = pin && /^\d{4,6}$/.test(pin) ? pin : null;

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [visible]);

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
    </div>
  );
}
