import type { NextConfig } from 'next';

const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL?.trim() || 'http://127.0.0.1:3001').replace(/\/+$/, '');

const nextConfig: NextConfig = {
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
