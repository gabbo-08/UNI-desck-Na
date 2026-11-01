export type Theme = 'light' | 'dark' | 'system';

const KEY = 'segrepass-theme';

export function getSavedTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const v = localStorage.getItem(KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

export function saveTheme(t: Theme) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, t);
}

export function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return t;
}

export function applyTheme(t: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', t === 'dark');
  root.classList.toggle('light', t === 'light');
  root.style.colorScheme = t;
}
