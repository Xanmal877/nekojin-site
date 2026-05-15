const CACHE_NAME = 'nekojin-v2';
const STATIC_ASSETS = [
  '/style.css',
  '/manifest.json',
  '/covers/game-cover-1772952121717.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never cache API calls
  if (e.request.url.includes('/content') || e.request.url.includes('/data') || e.request.url.includes('/chat') || e.request.url.includes('/newsletter')) return;

  const isHTML = e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';
  const isStatic = e.request.method === 'GET' && (url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.jpeg') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.webp') || url.pathname.endsWith('.ico'));

  if (isHTML) {
    // Network-first for HTML: always try server, fall back to cache only if offline
    e.respondWith(
      fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  if (isStatic) {
    // Cache-first for CSS/JS/images
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        });
      })
    );
  }
});
