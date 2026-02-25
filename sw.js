/* ─────────────────────────────────────────────────────────
   SiteVault Service Worker
   Storage strategy:
     • sitevault-shell-v2  → app shell (index.html, manifest, icons)
     • sitevault-user-v2   → user's uploaded HTML, served at /_sv_site_
   ───────────────────────────────────────────────────────── */

const SHELL_CACHE = 'sitevault-shell-v2';
const USER_CACHE  = 'sitevault-user-v2';
const USER_URL    = '/_sv_site_';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: cache app shell ──────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: claim all clients immediately ───────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Remove stale caches (but never touch user cache from old versions)
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== USER_CACHE)
            .map((k) => caches.delete(k))
        )
      ),
      // Immediately control all open tabs
      self.clients.claim(),
    ])
  );
});

// ── Message: store or clear user HTML ────────────────────
// (Called from main thread as a fallback for the Cache API write)
self.addEventListener('message', async (event) => {
  if (event.data?.type === 'STORE_HTML') {
    const cache = await caches.open(USER_CACHE);
    await cache.put(
      USER_URL,
      new Response(event.data.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
    // Confirm back to client
    event.source?.postMessage({ type: 'STORE_HTML_OK' });
  }

  if (event.data?.type === 'CLEAR_HTML') {
    const cache = await caches.open(USER_CACHE);
    await cache.delete(USER_URL);
    event.source?.postMessage({ type: 'CLEAR_HTML_OK' });
  }
});

// ── Fetch ─────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // ① Serve user site from dedicated user cache
  if (url.pathname === USER_URL) {
    event.respondWith(
      caches.open(USER_CACHE).then((cache) =>
        cache.match(USER_URL).then((res) =>
          res || new Response('<h1>No site cached</h1>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        )
      )
    );
    return;
  }

  // ② Shell assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        }).catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
    );
    return;
  }

  // ③ External (fonts, CDN): network with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
