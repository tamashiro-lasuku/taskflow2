const CACHE_NAME = "taskflow-v3.6";
const ASSETS = [
  "./index.html",
  "./app.js",
  "./calendar.js",
  "./firebase-sync.js",
  "./firebase-app-compat.js",
  "./firebase-database-compat.js",
  "./styles.css",
  "./icons/icon128.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Network first for everything, fall back to cache
  e.respondWith(
    fetch(e.request).then((res) => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
