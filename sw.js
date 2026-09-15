/* sw.js — offline shell.
 *
 * BUMP `VERSION` ON EVERY DEPLOY, together with APP_VERSION in js/config.js.
 * Forget, and the pinned vendor bundles below keep being served from the old cache.
 */

const VERSION = '1.0.0';
const CACHE = `macro-tracker-${VERSION}`;

const APP_SHELL = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/config.js', './js/firebase.js', './js/auth.js', './js/state.js', './js/store.js',
  './js/dates.js', './js/macros.js', './js/off.js', './js/scanner.js', './js/charts.js',
  './js/main.js', './js/entryModel.js',
  './js/ui/dom.js', './js/ui/router.js', './js/ui/toast.js', './js/ui/sheet.js',
  './js/ui/signInView.js', './js/ui/entryPage.js', './js/ui/viewerPage.js',
  './js/ui/settingsPage.js', './js/ui/addFoodSheet.js', './js/ui/scanView.js', './js/ui/mealEditor.js',
  './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-512.png', './assets/apple-touch-icon-180.png', './assets/favicon-32.png',
];

/* Version is in the path, so these bytes can never change under a given URL. */
const VENDOR = [
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/auto/+esm',
  'https://cdn.jsdelivr.net/npm/@undecaf/zbar-wasm@0.11.0/dist/inlined/index.mjs',
];

/* Never touch live backend traffic. The Firebase SDK owns its own retry and
 * offline semantics, and a cached auth or Firestore response is a disaster. */
const BYPASS_HOSTS = [
  'firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com',
  'www.googleapis.com', 'apis.google.com', 'accounts.google.com',
  'firebaseinstallations.googleapis.com', 'firebaselogging-pa.googleapis.com',
  'world.openfoodfacts.org', 'images.openfoodfacts.org',
];
const isBypassed = (url) =>
  BYPASS_HOSTS.includes(url.hostname) || url.hostname.endsWith('.firebaseapp.com');

const NETWORK_TIMEOUT = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is all-or-nothing; one 404 during a deploy would abort the whole
    // install, so cache each independently and let stragglers fill in later.
    await Promise.all([...APP_SHELL, ...VENDOR].map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
        console.warn('[sw] skipped', url, err?.message);
      })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE && n.startsWith('macro-tracker-')).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isBypassed(url)) return;

  const sameOrigin = url.origin === self.location.origin;

  // Our own code has no content hashes (there is no build step), so cache-first
  // would pin the app to a stale bundle. Network-first with a short timeout
  // keeps deploys honest while still launching instantly offline.
  if (request.mode === 'navigate' || (sameOrigin && /\.(js|css|html|json)$/.test(url.pathname))) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (VENDOR.includes(url.href) || (sameOrigin && /\.(png|jpg|jpeg|svg|webp|woff2?)$/.test(url.pathname))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (sameOrigin) event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: false })
                || await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); },
                 (e) => { clearTimeout(timer); reject(e); });
  });
}
