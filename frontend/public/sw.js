// Service worker do App Munaretto (PWA offline-first leve).
//
// VERSÃO DO CACHE: incremente `CACHE` (ex.: munaretto-v2, v3...) a cada deploy
// do frontend — o activate remove as versões antigas automaticamente.

const CACHE = 'munaretto-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/logo-munaretto.png', '/boneco-munaretto.png', '/favicon.ico', '/pwa-192.png', '/pwa-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Pré-cache tolerante: se um asset falhar (ex.: png temporariamente
      // ausente), os demais continuam sendo cacheados — o addAll antigo
      // derrubava o install inteiro por causa de um único arquivo.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Requisições da API nunca são cacheadas: os dados são dinâmicos e
  // autenticados, e uma cópia antiga em cache ficaria servida por tempo
  // indeterminado durante uma queda de rede.
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('/index.html'))
      )
  );
});
