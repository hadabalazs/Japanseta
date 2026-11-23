const CACHE = 'lepes-v1';
const ASSETS = ['./', './index.html', './style.css', './app.js', './engine.js', './audio-worker.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './install-android-1.svg', './install-android-2.svg', './install-android-3.svg', './install-ios-1.svg', './install-ios-2.svg', './install-ios-3.svg'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    if (!self.registration.active) await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('lepes-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CACHE_STATUS') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const ready = (await Promise.all(ASSETS.map(asset => cache.match(asset)))).every(Boolean);
    event.ports[0]?.postMessage({ ready });
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(event.request);
    return fetch(event.request);
  })());
});
