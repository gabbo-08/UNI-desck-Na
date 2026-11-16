'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { getSavedTheme, saveTheme, resolveTheme, applyTheme, type Theme } from '@/lib/theme';

export default function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  const apply = useCallback((t: Theme) => {
    saveTheme(t);
    const r = resolveTheme(t);
    setTheme(t);
    setResolved(r);
    applyTheme(r);
  }, []);

  useEffect(() => {
    apply(getSavedTheme());
  }, [apply]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
      const next = event.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const labels: Record<Theme, string> = { light: 'Chiaro', dark: 'Scuro', system: 'Sistema' };
  const icons: Record<Theme, React.ReactNode> = {
    light: <Sun className="h-5 w-5" />,
    dark: <Moon className="h-5 w-5" />,
    system: <Monitor className="h-5 w-5" />,
  };

  const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';

  return (
    <button
      onClick={() => apply(next)}
      aria-label={`Tema: ${labels[theme]} (${resolved})`}
      title={`Tema: ${labels[theme]} → ${resolved === 'dark' ? 'scuro' : 'chiaro'}`}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--app-line)] bg-[var(--app-card)] text-[var(--app-text)] transition hover:bg-[var(--app-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5AB0F0] group"
    >
      {icons[theme]}
      <span className="absolute -right-8 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap text-[10px] font-medium text-slate-400 bg-zinc-900/90 px-2 py-1 rounded border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
        {labels[theme]} ({resolved === 'dark' ? 'scuro' : 'chiaro'})
      </span>
      <span className="sr-only">Cambia tema: {labels[theme]}</span>
    </button>
  );
}
