/* sw.js — caches the app shell so Recovery OS loads offline after the first visit.
   Only static assets are cached. No data ever passes through here.
   Bump CACHE_VERSION whenever any file in ASSETS changes. */

const CACHE_VERSION = 'recovery-os-v0.2.0';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-512-maskable.png',
  './js/app.js',
  './js/db.js',
  './js/events.js',
  './js/exercises.js',
  './js/export-import.js',
  './js/medications.js',
  './js/prefs.js',
  './js/reminders.js',
  './js/safety-rules.js',
  './js/sample-data.js',
  './js/schedule.js',
  './js/seed.js',
  './js/time.js',
  './js/ui.js',
  './js/views/calendar.js',
  './js/views/medications.js',
  './js/views/more.js',
  './js/views/movement.js',
  './js/views/onboarding.js',
  './js/views/plan.js',
  './js/views/progress.js',
  './js/views/quick-log.js',
  './js/views/shared.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so updates land quickly; fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache first, then network (and keep a copy).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});
