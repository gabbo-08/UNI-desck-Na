import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_URL =(process.env.BACKEND_URL?.trim() || process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const isDevelopment = process.env.NODE_ENV !== 'production';
if (process.env.NODE_ENV === 'production' && !BACKEND_URL.startsWith('https://')) {
  throw new Error('NEXT_PUBLIC_BACKEND_URL deve usare HTTPS in produzione.');
}
const allowedDevOrigins = String(process.env.NEXT_ALLOWED_DEV_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
      "connect-src 'self' https: ws: wss:",
      "worker-src 'self' blob:"
    ].join('; ')
  }
];

const nextConfig: NextConfig = {
  // Origini LAN aggiuntive solo in sviluppo, configurate esplicitamente.
  allowedDevOrigins,
  // Il backend ha un proprio lockfile nella root del repository.
  turbopack: {
    root: FRONTEND_ROOT,
  },
  // In sviluppo React esegue due volte gli effetti: ogni chiamata al backend partiva doppia.
  reactStrictMode: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${BACKEND_URL}/health`,
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
