// Service worker — rotated per deploy. scripts/deploy.sh stamps the
// CACHE_NAME before FTP upload so every deploy produces a fresh cache
// bucket and the old one gets purged on `activate`.
//
// Strategy:
//   - App shell (HTML, CSS, JS) → stale-while-revalidate
//     Users see the last cached version instantly, the network copy
//     refreshes in the background for the next visit. This is what
//     makes dashboards feel instant even on a bad hotel wifi.
//   - Supabase API (supabase.co) → network only
//     We must never cache personalised data — next user on the same
//     device would see it. The app deals with connection failure by
//     showing "Offline" toasts through its own DB layer.
//   - Cross-origin JS from jsdelivr → cache-first
//     The SDK is pinned to v2 so it's effectively immutable; caching
//     forever is fine, cache-bust comes from the SW name.
//   - Offline fallback navigation → /offline.html
//     When a user hits a page they've never visited AND they're offline,
//     serve a branded "You're offline" page instead of Chrome's dino.

const CACHE_NAME = 'rostr-v4-swr';

// Core shell — precached on install so first offline navigation works.
// Everything else populates the cache as the user visits it (lazy).
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/auth.html',
  '/dashboard.html',
  '/directory.html',
  '/offline.html',
  '/404.html',
  '/assets/css/system.css',
  '/assets/js/app.js',
  '/assets/js/error-logger.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install ─────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Use addAll-with-no-store so a stale proxy doesn't poison the
      // fresh cache on deploy day. Individual request failures don't
      // fail the whole install (addAll is all-or-nothing, so we catch
      // each request separately).
      Promise.all(PRECACHE_ASSETS.map(url =>
        fetch(url, { cache: 'no-store' })
          .then(res => res.ok ? cache.put(url, res) : null)
          .catch(() => null)
      ))
    )
  );
  self.skipWaiting();
});

// ── Activate — clean old caches ─────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// ── Fetch strategy ──────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // 1. Non-GET: never cache, let it pass through (POST/PATCH/DELETE).
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 2. Supabase API calls: network only, never cache. Personalised data
  //    must not leak across users on the same device.
  if (url.hostname.endsWith('supabase.co')) return;

  // 3. Cross-origin assets (jsdelivr SDK, etc.): cache-first.
  //    These are immutable versioned URLs — safe to cache forever.
  if (url.origin !== location.origin) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        }).catch(() => cached || Response.error());
      })
    );
    return;
  }

  // 4. Same-origin navigation / HTML / JS / CSS / images:
  //    Stale-while-revalidate. Serve from cache instantly, refresh in
  //    the background for the next visit. Falls back to /offline.html
  //    for navigations we've never seen (first-time + offline).
  e.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        // Only cache real successful responses (skip opaque redirects,
        // 404s, etc.). type==='basic' guards against caching extension
        // content-scripts that sometimes masquerade as the main page.
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => null);

      // Serve cached immediately if we have it, otherwise wait for network.
      if (cached) {
        // Fire-and-forget the fresh fetch so the cache is warm next time.
        fresh.catch(() => {});
        return cached;
      }

      // No cache — wait for network. If that fails too and this is a
      // navigation, show the offline page.
      return fresh.then(res => {
        if (res) return res;
        if (req.mode === 'navigate') {
          return caches.match('/offline.html') || new Response('Offline', { status: 503 });
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
