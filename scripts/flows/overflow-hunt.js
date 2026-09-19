/**
 * 横向溢出定位：谁把页面撑宽了。
 *
 * 窄屏上最难受的故障是「按钮被挤出屏幕」—— 看不见也点不到。
 * 这个探针直接列出右边缘越过视口的元素（按越界程度排序），
 * 并给出它的宽度与直接父级，方便定位是哪一环不肯收缩。
 *
 * 用法：npm run shot -- "#/practice/mary-lamb" --script scripts/flows/overflow-hunt.js --width 320 --height 568
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

await waitFor('.app');
await sleep(500);

const vw = window.innerWidth;
const name = (el) => {
  if (!el) return null;
  const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : '';
  const text = (el.textContent ?? '').trim().slice(0, 10);
  return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}「${text}」`;
};

/** scrollWidth 大于 clientWidth 且没有横向滚动出口的容器，就是「撑宽页面」的元凶。 */
const culprits = [];
for (const el of document.querySelectorAll('*')) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) continue;
  const over = Math.round(r.right - vw);
  if (over <= 1) continue;
  const cs = getComputedStyle(el);
  culprits.push({
    元素: name(el),
    越界: over,
    宽: Math.round(r.width),
    x: Math.round(r.x),
    自己可否横滚: cs.overflowX === 'auto' || cs.overflowX === 'scroll' ? '可横向滚动（出口）' : '无出口',
    父级: name(el.parentElement),
  });
}

culprits.sort((a, b) => b.越界 - a.越界);

/**
 * 元凶 = 「自己越界、但父级还在视口内」的最外层元素。
 * 键盘的琴键必然越界（它们在可横滚的 `.pk-frame` 里），所以只看这一层才分得清
 * 「设计如此」与「真的把页面撑宽了」。
 */
const rootCulprits = [];
for (const el of document.querySelectorAll('*')) {
  const r = el.getBoundingClientRect();
  if (r.width <= vw + 1) continue;
  const p = el.parentElement;
  const pr = p?.getBoundingClientRect();
  if (pr && pr.width > vw + 1) continue; // 父级也越界 → 继续往上找
  // 父级自己能横向滚动 → 这是**设计如此**（键盘宽出屏幕、由 `.pk-frame` 横向拖动），
  // 不是把页面撑宽的元凶。
  if (p && ['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) continue;
  const cs = getComputedStyle(el);
  rootCulprits.push({
    元素: name(el),
    宽: Math.round(r.width),
    越界: Math.round(r.right - vw),
    自己能否横滚: cs.overflowX,
    minWidth: cs.minWidth,
    父级: name(p),
  });
}

// 被挤出视口的可点元素（真正的功能损失）
const unclickable = [...document.querySelectorAll('button, a, [role="button"]')]
  .map((el) => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.width > 0 && (r.right > vw + 1 || r.left < -1))
  .map(({ el }) => name(el));

return JSON.stringify(
  {
    viewport: `${vw}x${window.innerHeight}`,
    route: location.hash,
    documentScrollWidth: document.documentElement.scrollWidth,
    overflowX: Math.max(0, document.documentElement.scrollWidth - vw),
    越界元素数: culprits.length,
    越界元素: culprits.slice(0, 12),
    元凶: rootCulprits.slice(0, 8),
    点不到的元素: unclickable,
  },
  null,
  2,
);
