/*
 * QubitOS service worker.
 *
 * Makes the installed app launch without a network: navigations are network-first with the cached
 * shell as the fallback, and same-origin static files (the hashed Expo bundle, icons, fonts) are
 * served cache-first and refreshed in the background.
 *
 * Cross-origin requests are deliberately left alone — the QubitOS network stack (qpm, curl, wget)
 * must keep talking to the real internet, and its failures should be its own.
 */
const VERSION = 'v1';
const SHELL = `qubitos-shell-${VERSION}`;
const RUNTIME = `qubitos-runtime-${VERSION}`;
const KEEP = [SHELL, RUNTIME];

/* Everything is scope-relative, so the same worker serves https://host/ and https://host/Repo/. */
const SHELL_URLS = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One miss (an icon renamed, say) must not fail the whole install.
      await Promise.all(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('qubitos-') && !KEEP.includes(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** The cached start page, used when a navigation cannot reach the network. */
async function shellFallback() {
  const cache = await caches.open(SHELL);
  return (await cache.match('./')) || (await cache.match('./index.html')) || Response.error();
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL);
      await cache.put('./', response.clone());
    }
    return response;
  } catch (err) {
    return shellFallback();
  }
}

/** Cache-first for static files; the Expo bundle is content-hashed, so a hit is always current. */
async function handleAsset(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);
  const fetching = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') cache.put(request, response.clone()).catch(() => undefined);
      return response;
    })
    .catch(() => undefined);
  if (hit) return hit;
  const fresh = await fetching;
  return fresh || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let QubitOS's own network stack through
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith(new URL('./', self.location.href).pathname)) event.respondWith(handleAsset(request));
});
