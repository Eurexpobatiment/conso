/* Ancien service worker de /v2/ : se désinstalle (l'appli est à la racine) */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.registration.unregister()); });
