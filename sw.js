/* ============================================================
   BearBear PWA — Service Worker
   策略：Cache First（靜態資源）+ Network First（API 資料）
   ============================================================ */

const CACHE_NAME = 'bearbear-v1.2.0';
const IMG_CACHE  = 'bearbear-img-v1';
const IMG_MAX    = 120;
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

/* ── 安裝：預快取核心靜態資源 ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] 預快取靜態資源');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

/* ── 啟動：清除舊版快取 ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== IMG_CACHE)
          .map(key => {
            console.log('[SW] 清除舊快取:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── 攔截請求 ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* TDX / Open Data API：Network First，失敗回傳快取 */
  if (url.hostname.includes('tdx.transportdata.gov.tw') ||
      url.hostname.includes('data.gov.tw')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  /* 圖片資源：Cache First，加速載入 */
  if (request.destination === 'image') {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  /* 其他：Stale While Revalidate */
  event.respondWith(staleWhileRevalidate(request));
});

/* ── Cache First（圖片專用快取桶 + 120 張上限） ── */
async function cacheFirstStrategy(request) {
  const cache  = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      cache.keys().then(keys => {
        if (keys.length > IMG_MAX)
          keys.slice(0, keys.length - IMG_MAX).forEach(k => cache.delete(k));
      });
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

/* ── Network First：先請求網路，失敗才讀快取 ── */
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ error: '離線模式，請檢查網路連線', offline: true }),
      { headers: { 'Content-Type': 'application/json' }, status: 503 }
    );
  }
}

/* ── Stale While Revalidate：回傳快取同時背景更新 ── */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await networkFetch || new Response('', { status: 503 });
}

/* ── 接收來自主執行緒的訊息 ── */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
