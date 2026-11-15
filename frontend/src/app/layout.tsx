import type { Metadata, Viewport } from 'next';
import './globals.css';
import PwaRuntime from '@/components/PwaRuntime';

export const metadata: Metadata = {
  title: 'UniDesk NA',
  description: 'Dashboard non ufficiale per gli studenti dell\'Università Federico II',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'UniDesk NA',
  },
};

export const viewport: Viewport = {
  themeColor: '#0A1C35',
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
    <html lang="it" suppressHydrationWarning className="light" data-theme="light">
      <head>
        <link rel="icon" href="/logo_prova.jpg" type="image/jpeg" />
        <link rel="apple-touch-icon" href="/logo_prova.jpg" />
      </head>
      <body suppressHydrationWarning className="min-h-screen bg-white text-slate-900 dark:bg-zinc-950 dark:text-zinc-100">
        <PwaRuntime />
        {children}
      </body>
    </html>
  );
}
