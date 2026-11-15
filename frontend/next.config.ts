import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_URL = (process.env.BACKEND_URL?.trim() || process.env.BACKEND_URL?.trim() || process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Il telefono usa l'IP LAN del PC invece di localhost durante lo sviluppo.
  allowedDevOrigins: ['192.168.1.101'],
  // Il backend ha un proprio lockfile nella root del repository.
  turbopack: {
    root: FRONTEND_ROOT,
  },
  // In sviluppo React esegue due volte gli effetti: ogni chiamata al backend partiva doppia.
  reactStrictMode: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
  httpAgentOptions: {
    keepAlive: true,
  },
  experimental: {
    proxyTimeout: 270000, // Leggermente oltre il timeout client e quello del pool Puppeteer.
  },
};

export default nextConfig;
