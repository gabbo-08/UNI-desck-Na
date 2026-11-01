import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Segrepass Unina',
  description: 'Gestione carriera, tasse, appelli e orario lezioni - Università Federico II',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Segrepass',
  },
};

export const viewport: Viewport = {
  themeColor: '#0B3A6B',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" suppressHydrationWarning className="light">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body suppressHydrationWarning className="min-h-screen bg-white text-slate-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}