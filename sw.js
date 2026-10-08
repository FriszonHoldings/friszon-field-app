const CACHE = 'ff-shell-v1';
const SHELL = ['./', './index.html', './app.js', './sync.js', './styles.css', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

importScripts('./sync.js');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html')))
  );
});

self.addEventListener('sync', e => {
  if (e.tag === 'ff-outbox') e.waitUntil(ffSyncOutbox().then(() => self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({type: 'synced'})))));
});
