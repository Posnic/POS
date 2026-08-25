/*
 * Posnic service worker — TEMPLATE. The build (gulpfile.js/sw.js) writes the
 * real public/sw.js from this file, stamping __BUILD_HASH__ with a digest of
 * the built bundles. Do not edit public/sw.js by hand.
 *
 * The invalidation contract (the part that matters):
 *  - The cache name carries the build hash. A server deploy changes this
 *    file's bytes; the browser's own service-worker update check (on every
 *    navigation) installs the new worker, and activate() below deletes every
 *    cache from previous builds. Heavy bundles (script/dashboard.js is the
 *    big one) are served instantly from cache, yet can never survive an
 *    update — exactly the versioned-cache pattern Workbox precaching uses.
 *  - Only same-origin STATIC assets are ever cached. Pages and every /api
 *    request always go to the network: a till must never see a stale price,
 *    sale, or permission because of a cache.
 *  - The desktop shell never registers this worker (its assets are local
 *    files owned by the installer/asset-updater); this is for web and LAN
 *    counter clients, where the 10MB bundle otherwise crosses the wire on
 *    every hard load.
 */
'use strict';

const CACHE = 'posnic-static-__BUILD_HASH__';

/* Warmed at install so the first navigation after an update is already fast;
   everything else under the static prefixes is cached on first use. */
/* Injected by the build (gulpfile.js/sw.js) with the FINGERPRINTED names -
   hashed filenames are the cache keys, so this list changes with every
   deploy that changes a bundle. */
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      /* addAll rejects wholesale if one file 404s; precache is an optimisation,
         not a contract, so warm what we can and never fail the install. */
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      /* Pages are network-only, so every navigation used to wait for this
         worker to boot before the request even left. Preload starts the
         fetch in parallel with SW startup - pure latency, no semantics. */
      .then(() => (self.registration.navigationPreload
        ? self.registration.navigationPreload.enable()
        : undefined))
      .then(() => self.clients.claim())
  );
});

/*
 * Web Push (roadmap W4): render what the server sent, focus the app on tap.
 * The payload is built server-side only; this handler invents nothing.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* show the default */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Posnic', {
    body: data.body || '',
    tag: data.tag || 'posnic',
    /*
     * Same-tag notifications REPLACE each other, and a replacement is silent:
     * no sound, no banner, just the text swapping inside a notification
     * centre nobody is looking at. The owner's "send test works but second
     * time not working" was exactly this - the second test replaced the
     * first invisibly. renotify makes every arrival announce itself even
     * when it lands on an existing tag.
     */
    renotify: true,
    icon: 'static/images/logo/posnic-logo.svg',
    data: { url: data.url || '/dashboard.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ('focus' in win) return win.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

/*
 * Reference data: country / state / currency / timezone lists. Anonymous by
 * design, byte-identical for every user, changed only by a release - so they
 * are served STALE-WHILE-REVALIDATE from the versioned cache: the picker gets
 * an instant answer, the network refreshes it in the background, and a deploy
 * invalidates the lot through the cache-name turnover like everything else.
 * This is the ONLY API surface the worker touches; business data never
 * enters a cache the server does not control.
 */
const REFERENCE = /^\/(api\/)?setting\/getJSON(Country|State|Currency|TimeZone|GstState)/;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Navigations: network (preloaded when available); when the network is
     gone entirely, an honest offline page instead of the browser error. */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch (e) {
        const fallback = await caches.match('static/offline.html');
        return fallback || Response.error();
      }
    })());
    return;
  }

  if (REFERENCE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then((hit) => {
          const refresh = fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          });
          if (hit) {
            refresh.catch(() => { /* stale answer already served */ });
            return hit;
          }
          return refresh;
        })
      )
    );
    return;
  }

  /* Static assets only — never pages, never /api. */
  if (!/^\/(static|style|script|fonts|images)\//.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        });
      })
    )
  );
});
