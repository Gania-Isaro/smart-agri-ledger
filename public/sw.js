/**
 * Service worker.
 *
 * The point of this file is that the app opens with no network at all. Vite
 * fingerprints its assets, so rather than a hand-written precache list that
 * would go stale on every build, this caches what the app actually asks for
 * and serves it back when the network is gone.
 *
 * Records are never cached here — they live in IndexedDB, which is the real
 * offline store. This only keeps the application itself loadable.
 */

const VERSION = 'agri-ledger-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // A single failed shell URL must not sink the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /*
   * Navigations: try the network first so a deployed update is picked up, and
   * fall back to the cached shell when there is no signal. Hash routing means
   * every in-app route is the same document.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? caches.match('/'))),
    );
    return;
  }

  /* Everything else: serve from cache when we have it, and fill the cache as
     the app asks for things. Hashed filenames make this safe. */
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
    }),
  );
});
