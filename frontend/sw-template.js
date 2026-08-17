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
const PRECACHE = [
  'script/dashboard.js',
  'style/dashboard.css',
  'script/login.js',
  'style/login.css',
];

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
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
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
