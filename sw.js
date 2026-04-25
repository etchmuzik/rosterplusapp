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
//   - Web Push — handlers at the bottom of this file. Receives payloads
//     from send-push edge function and surfaces them via Notification API.

const CACHE_NAME = 'rostr-v6-swr-push';

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

  // 3. Cross-origin requests: do NOT intercept.
  //    The previous version cached cross-origin GETs (jsdelivr SDK,
  //    fontshare, googleapis), but the SW re-issuing the fetch
  //    triggers CSP `connect-src` enforcement against URLs the page
  //    is allowed to load directly under script-src/style-src/font-src.
  //    Result: the Supabase SDK + webfonts get blocked and the app
  //    breaks. Letting these pass through means the browser uses the
  //    page's normal request path with the page's CSP, which already
  //    permits them. We lose offline caching of cross-origin assets,
  //    which is a nice-to-have, not load-bearing for first-paint.
  if (url.origin !== location.origin) return;

  // 4. Same-origin navigation / HTML / JS / CSS / images:
  //    Stale-while-revalidate. Serve from cache instantly, refresh in
  //    the background for the next visit. Falls back to /offline.html
  //    for navigations we've never seen (first-time + offline).
  //
  //    ignoreSearch: true — deploy.sh appends ?v=<sha> to every
  //    /assets/*.{css,js} reference in the HTML. Without ignoreSearch
  //    the SW would see /app.js and /app.js?v=abc123 as distinct keys
  //    and never hit its own precache. The cache-bust story is still
  //    intact because CACHE_NAME itself rotates per deploy — all old
  //    cache entries get wiped on `activate`.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
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

// ─── Web Push ───
//
// The `push` event fires when the browser receives a payload from the
// push service. Our send-push edge function (or a future web-push
// dispatcher) posts JSON like:
//
//   { title, body, data: { href, type, ... } }
//
// We surface it via the Notification API. Click → focus the tab and
// navigate to data.href if present.

self.addEventListener('push', (e) => {
  let payload = {};
  try {
    payload = e.data ? e.data.json() : {};
  } catch (_) {
    payload = { title: 'ROSTR+', body: e.data ? e.data.text() : '' };
  }
  const title = payload.title || 'ROSTR+';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data || {},
    tag: payload.tag,            // de-dupes when same tag fires twice
    renotify: !!payload.renotify,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const href = (e.notification.data && e.notification.data.href) || '/dashboard.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // If a ROSTR+ tab is already open, focus + navigate it.
        for (const c of clients) {
          if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
            c.navigate(href);
            return c.focus();
          }
        }
        // Otherwise open a new tab.
        if (self.clients.openWindow) {
          return self.clients.openWindow(href);
        }
      })
  );
});
