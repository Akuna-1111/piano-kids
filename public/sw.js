/**
 * Service Worker —— 离线优先（文档十四）。
 *
 * 策略：
 *  - 导航请求：network-first，失败回落缓存里的 index.html（保证离线仍能打开）
 *  - 同源静态资源：cache-first（Vite 产物带哈希，缓存安全）
 *  - 版本变化时清掉旧缓存
 *
 * 曲谱 / 皮肤 / 音频都不走网络（全部内联在 JS 里，或用 Web Audio 程序生成），
 * 因此只要 App Shell 缓存成功，应用就是完全可离线的。
 */

const CACHE_NAME = 'piano-kids-v3-0-0';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function putInCache(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => putInCache(request, response))
        .catch(() =>
          caches
            .match('./index.html')
            .then((cached) => cached ?? caches.match('./'))
            .then((cached) => cached ?? Response.error()),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => putInCache(request, response));
    }),
  );
});
