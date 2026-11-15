/* UniDesk NA Web Push + static shell service worker. It never stores API or personal data. */
const STATIC_CACHE = 'unidesk-static-v2';
const STATIC_ASSETS = ['/', '/manifest.json', '/logo_prova.jpg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('unidesk-static-') && key !== STATIC_CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      void caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = String(payload.title || 'UniDesk NA');
  const options = {
    body: String(payload.body || ''),
    tag: String(payload.tag || 'unidesk-na'),
    renotify: false,
    data: { url: typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/' },
    icon: '/logo_prova.jpg',
    badge: '/logo_prova.jpg'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => 'focus' in client);
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(target);
      return;
    }
    await clients.openWindow(target);
  })());
});
