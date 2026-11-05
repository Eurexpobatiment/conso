/* Service worker : met en cache l'enveloppe de la PWA pour qu'elle s'ouvre sans réseau.
   Les données (appels Apps Script) ne passent pas par ici : elles sont gérées dans index.html. */
var CACHE = 'conso-halls-v3';
var FICHIERS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FICHIERS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Réseau d'abord (pour avoir la dernière version), cache si pas de réseau. */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // no-cache : redemande toujours la dernière version (sinon le navigateur peut garder l'ancienne 10 min)
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) {
      var copie = r.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copie); });
      return r;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
    })
  );
});
