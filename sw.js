const CACHE_NAME = 'pulse-v9';
const BASE = self.registration.scope; // بيتحسب تلقائي حسب مكان السكربت

// 🛠️ app.js القديم اتقسّم لـ 13 ملف (شوف README) وده كان لسه متسجل هنا
// لوحده، فكان بيسبب فشل cache.addAll() بالكامل بصمت (لأن الملف ده بقى
// راجع 404) — يعني التطبيق ما كانش بيعمل precache لأي حاجة عند أول تثبيت،
// وكان معتمد بس على الـ cache التدريجي جوه 'fetch' تحت.
const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'config.js',
  BASE + 'state.js',
  BASE + 'utils.js',
  BASE + 'auth.js',
  BASE + 'registration.js',
  BASE + 'profile.js',
  BASE + 'algorithm.js',
  BASE + 'media.js',
  BASE + 'posts.js',
  BASE + 'reactions.js',
  BASE + 'rooms.js',
  BASE + 'messages.js',
  BASE + 'zaps.js',
  BASE + 'bookmarks-mute.js',
  BASE + 'ui.js',
  BASE + 'main.js',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match(BASE + 'index.html')))
  );
});
