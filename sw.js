/* ==========================================================================
   بيان — Service Worker
   الاستراتيجية: Cache First للأصول المحلية، مع تحديث صامت في الخلفية للصفحة.
   الخطوط الخارجية (Google Fonts / jsDelivr) تُخزَّن عند أول زيارة بالاتصال.
   لا يتدخل أبداً في طلبات Ollama أو أي طلب غير GET.
   لإصدار تحديث: غيّر VERSION أدناه.
   ========================================================================== */
const VERSION = 'v1.0.0';
const STATIC_CACHE = 'bayan-static-' + VERSION;
const RUNTIME_CACHE = 'bayan-runtime-' + VERSION;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const RUNTIME_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      /* نخزّن كل ملف على حدة حتى لا يفشل التثبيت كله بسبب ملف واحد */
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('bayan-') && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isCacheable(response) {
  return response && (response.ok || response.type === 'opaque');
}

async function networkAndStore(request, cacheName) {
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/* صفحة التطبيق: نعرض النسخة المخزنة فوراً ونحدّثها في الخلفية */
async function handleNavigation(request) {
  const cached = (await caches.match('./index.html', { ignoreSearch: true })) ||
                 (await caches.match('./', { ignoreSearch: true }));
  const refresh = networkAndStore(new Request('./index.html', { cache: 'no-cache' }), STATIC_CACHE).catch(() => null);
  if (cached) {
    return cached;
  }
  const fresh = await refresh;
  return fresh || new Response('التطبيق غير متاح دون اتصال بعد. افتحه مرة واحدة بالاتصال بالإنترنت.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) {
    return cached;
  }
  try {
    return await networkAndStore(request, cacheName);
  } catch (error) {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  /* لا نتدخل في Ollama ولا في أي واجهة API */
  if (url.pathname.startsWith('/api/') || url.port === '11434') {
    return;
  }

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (RUNTIME_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
});
