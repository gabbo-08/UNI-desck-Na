'use client';

import { useEffect, useState } from 'react';

export default function PwaRuntime() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-[60] rounded-xl border border-amber-300/40 bg-amber-950/95 px-4 py-3 text-center text-xs font-medium text-amber-100 shadow-xl"
    >
      Sei offline. Le funzioni che richiedono il server riprenderanno quando torna la connessione.
    </div>
  );
}
