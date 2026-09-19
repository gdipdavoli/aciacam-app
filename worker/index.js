// Remove caches created by the previous PWA policy that could contain private
// responses. Keep only explicitly named legacy caches within this app's origin.
self.addEventListener('activate', event => {
  const legacy = new Set(['apis', 'pages-rsc-prefetch', 'pages-rsc', 'pages', 'cross-origin',
    'next-data', 'static-data-assets', 'next-image', 'static-image-assets', 'start-url']);
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => legacy.has(key)).map(key => caches.delete(key))
  )));
});
