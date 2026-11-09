/* Service worker de la version Firebase : garde l'écran de l'appli et les modules Firebase sur l'appareil.
   Les données sont gardées par Firebase (copie locale), pas ici. */
var CACHE = 'conso-fb-v10';
var FBV = '10.14.1';
var SHELL = ['./', 'index.html', 'metier.js', 'donnees.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'https://www.gstatic.com/firebasejs/' + FBV + '/firebase-app.js',
  'https://www.gstatic.com/firebasejs/' + FBV + '/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/' + FBV + '/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/' + FBV + '/firebase-app-check.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('conso-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    e.respondWith(caches.match(e.request).then(function (r) {
      return r || fetch(e.request).then(function (res) { var c = res.clone(); caches.open(CACHE).then(function (k) { k.put(e.request, c); }); return res; });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return; // Firebase et script Google : réseau direct
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
    var c = res.clone(); caches.open(CACHE).then(function (k) { k.put(e.request, c); }); return res;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); }); }));
});
