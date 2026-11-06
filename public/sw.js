// Keeps the app shell cached so the icon opens instantly; data always comes from the network.
const CACHE = 'ledger-shell-v20';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/sheets.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];
const isShell = (p) => p === '/' || p === '/index.html';
const isShellFile = (p) => ['/app.css', '/app.js', '/sheets.js'].includes(p);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;          // fonts etc.: browser default
  if (url.pathname.startsWith('/api/') || ['/siri', '/pay', '/sms'].includes(url.pathname)) return; // never cache data
  if (e.request.mode === 'navigate' || isShell(url.pathname)) {
    // network first; only a good HTML reply for the shell itself replaces the cached shell (never an error page or an endpoint's text)
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && isShell(url.pathname) && (r.headers.get('content-type') || '').includes('text/html')) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/index.html', copy)); }
      return r;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  if (isShellFile(url.pathname)) {
    // the page's own script and styles: network first so they always match the HTML that asked for them; cache for offline
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); } return r; }).catch(() => caches.match(url.pathname)));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
});
