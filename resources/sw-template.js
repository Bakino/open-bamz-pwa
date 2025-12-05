/*global workbox, importScripts, clients*/
//https://github.com/GoogleChrome/workbox
importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.4.0/workbox-sw.js');

// Ensure Workbox is loaded
if (workbox) {
  console.log('Workbox is loaded');
} else {
  console.log('Workbox failed to load');
}

// Use Workbox libraries
const { precacheAndRoute,/* createHandlerBoundToURL*/ } = workbox.precaching;
//const { clientsClaim, skipWaiting } = workbox.core;

// This is the service worker's precache manifest.
precacheAndRoute(self.__WB_MANIFEST);

// Allow the new service worker to take control immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Notify the user of a new service worker
self.addEventListener('install', (/*event*/) => {
  self.skipWaiting(); // Skip waiting to activate immediately
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim()
    /*.then(() => {
      // Notify all clients about the new service worker
      const message = {
        type: 'NEW_VERSION_AVAILABLE',
        text: 'A new version of this application is available. Please refresh the page to update.',
      };
      return clients.matchAll({ type: 'window' }).then(clientsArray => {
        clientsArray.forEach(client => client.postMessage(message));
      });
    })*/
  );
});

self.addEventListener('fetch', (/*event*/) => {
  // Custom fetch handler if needed
});
