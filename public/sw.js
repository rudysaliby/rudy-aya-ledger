// Keeps the app shell cached so the icon opens instantly; data always comes from the network.
const CACHE = 'ledger-shell-v17';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/icon-512-rounded.png'];
const isShell = (p) => p === '/' || p === '/index.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;          // fonts etc.: browser default
  if (url.pathname.startsWith('/api/') || ['/siri', '/pay', '/sms'].includes(url.pathname) || url.pathname.startsWith('/.netlify/')) return; // never cache data
  if (e.request.mode === 'navigate' || isShell(url.pathname)) {
    // network first; only a good HTML reply for the shell itself replaces the cached shell (never an error page or an endpoint's text)
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && isShell(url.pathname) && (r.headers.get('content-type') || '').includes('text/html')) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/index.html', copy)); }
      return r;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
});
