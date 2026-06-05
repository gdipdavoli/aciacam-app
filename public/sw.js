// Service Worker básico para permitir la instalación de la PWA
self.addEventListener('install', (event) => {
  console.log('Service Worker: Instalado');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activado');
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignore API requests so they don't get stripped of headers or cached incorrectly
  if (event.request.url.includes('/api/')) {
    return;
  }
  // Estrategia de red por defecto para este SW básico
  event.respondWith(fetch(event.request));
});
