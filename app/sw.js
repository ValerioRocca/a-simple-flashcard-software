// Service worker: keeps a copy of the app's own files so that the installed
// app also opens when the local server is not running.
//
// The server always wins: every file is fetched from it when it answers, so an
// update (git pull) shows at once. The copy is used only when it does not.
// Only the app's code is kept here, never any of the user's cards.

const CACHE = 'flashcards-app-v1';

async function addToCache(cache, url) {
  try {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (response.ok) await cache.put(url, response);
  } catch {
    // Picked up later, when the page asks for the file.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch('__files', { cache: 'no-store' });
      const { files } = await response.json();
      await Promise.all(['./', ...files].map((url) => addToCache(cache, url)));
    } catch {
      // Served by something other than serve.py: files are kept as they are used.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Server questions and the test page always go to the server.
  if (url.pathname.startsWith('/__') || url.pathname.startsWith('/tests/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      return response;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const page = await cache.match('./');
        if (page) return page;
      }
      return Response.error();
    }
  })());
});
