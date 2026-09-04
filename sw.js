const CACHE = 'stocklog-v19-shell';
const APP_SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    if (request.destination === 'document') {
      try {
        const response = await fetch(request);
        if (response.ok) { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(request,copy)); }
        return response;
      } catch (_) { return caches.match(request).then(c=>c||caches.match('./index.html')); }
    }
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'manifest')) {
        const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(request,copy));
      }
      return response;
    } catch (_) { return caches.match('./index.html'); }
  })());
});
