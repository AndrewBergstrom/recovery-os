/* sw.js — caches the app shell so Recovery OS loads offline after the first visit.
   Only static assets are cached. No data ever passes through here.
   Bump CACHE_VERSION whenever any file in ASSETS changes. */

const CACHE_VERSION = 'recovery-os-v0.4.9';
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
  './js/config.js',
  './js/db.js',
  './js/events.js',
  './js/exercise-guides.js',
  './js/exercises.js',
  './js/export-import.js',
  './js/medications.js',
  './js/prefs.js',
  './js/push.js',
  './js/reminders.js',
  './js/reminders-due.js',
  './js/safety-rules.js',
  './js/sample-data.js',
  './js/schedule.js',
  './js/seed.js',
  './js/sync.js',
  './js/time.js',
  './js/ui.js',
  './js/views/calendar.js',
  './js/views/care-ui.js',
  './js/views/medications.js',
  './js/views/more.js',
  './js/views/movement.js',
  './js/views/onboarding.js',
  './js/views/plan.js',
  './js/views/progress.js',
  './js/views/quick-log.js',
  './js/views/shared.js',
  './js/views/sync-ui.js',
];

// GitHub Pages serves files with a 10-minute HTTP cache. Always revalidate with the
// server so a deploy lands on the next load instead of after a stale window.
const fresh = (req) => fetch(req, { cache: 'no-cache' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
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
      fresh(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: network first (so a deploy lands on the very next load), cached copy when offline.
  event.respondWith(
    fresh(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// ---------- Push reminders ----------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Recovery OS', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Recovery OS';
  const options = {
    body: data.body || '',
    tag: data.tag || 'recovery-os',
    renotify: false,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { url: data.url || './#today' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './#today', self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.startsWith(self.registration.scope)) {
          c.focus();
          if ('navigate' in c) c.navigate(target).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
