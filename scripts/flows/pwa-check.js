/**
 * 上线自检：验证生产构建里的 PWA 与键盘（`vite preview` 或真实域名都适用）。
 *
 * 为什么单独写一个：这几件事**只在生产构建里成立** ——
 * Service Worker 在 `main.tsx` 里按 `import.meta.env.PROD` 注册，开发环境永远不注册，
 * 所以「开发环境正常」不能说明线上正常。
 *
 * 用法：
 *   npm run build
 *   npx vite preview --host 127.0.0.1 --port 5173 --strictPort   # 另开一个终端
 *   npm run shot -- "#/" --script scripts/flows/pwa-check.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (selector, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (document.querySelector(selector)) return true;
    await sleep(80);
  }
  return false;
};

const mounted = await waitFor('.app, .pk, .page');
await sleep(1200); // 等 Service Worker 注册完成

const manifestHref = document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null;

let manifestOk = false;
if (manifestHref) {
  try {
    const res = await fetch(manifestHref);
    const json = await res.json();
    manifestOk = Boolean(json.name && json.icons?.length);
  } catch {
    manifestOk = false;
  }
}

const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
const cacheNames = 'caches' in window ? await caches.keys() : [];

// 键盘：真机上「白 15 / 黑 10」才算画出来了（见 AGENTS §7）
const whites = document.querySelectorAll('.pk-key--white').length;
const blacks = document.querySelectorAll('.pk-key--black').length;
const firstWhite = document.querySelector('.pk-key--white');
const keyBox = firstWhite?.getBoundingClientRect();
const frame = document.querySelector('.pk-frame');
const frameBox = frame?.getBoundingClientRect();

return JSON.stringify({
  url: location.href,
  mounted,
  manifest: { href: manifestHref, ok: manifestOk },
  serviceWorker: {
    supported: 'serviceWorker' in navigator,
    count: registrations.length,
    // scope 必须是根：否则离线只覆盖一部分路径
    scopes: registrations.map((r) => r.scope),
    controller: Boolean(navigator.serviceWorker?.controller),
  },
  caches: cacheNames,
  keyboard: {
    whites,
    blacks,
    keyWidth: keyBox ? Math.round(keyBox.width * 10) / 10 : null,
    keyHeight: keyBox ? Math.round(keyBox.height) : null,
    frameWidth: frameBox ? Math.round(frameBox.width) : null,
    // 键盘宽出容器 = 可以横向拖动选取区域（真 23.5mm 的必然结果）
    scrollable: frame ? frame.scrollWidth - frame.clientWidth : null,
  },
  overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
});
