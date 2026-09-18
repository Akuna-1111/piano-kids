/**
 * 排版体检：在真实布局引擎里量「层级是不是真的分开了、有没有被挤坏」。
 *
 * 只回答四个问题：
 *   1. 页面标题 / 区块标题 / 正文 / 辅助文字的实际字号，是否落在层级表的档位上
 *   2. 顶栏高度与正文列分区间距是否全站一致
 *   3. 有没有横向溢出（字号改大会把页面撑宽）
 *   4. 有没有文字被裁掉（overflow 隐藏 + 内容超出）
 *
 * 用法：npm run shot -- "#/settings" --script scripts/flows/typography.js
 *      npm run shot -- "#/settings" --script scripts/flows/typography.js --width 1080 --height 810
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForAny = async (selectors, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      if (document.querySelector(selector)) return selector;
    }
    await sleep(80);
  }
  return null;
};

await waitForAny(['.app', '.page', '.pk', '.chl', '.pp', '.tune']);
await sleep(400);

/** 取一组选择器的实际字号与行高。 */
const measure = (selectors) => {
  const out = {};
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) {
      out[selector] = null;
      continue;
    }
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    out[selector] = {
      fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      lineHeight: Math.round(parseFloat(cs.lineHeight) * 10) / 10,
      weight: cs.fontWeight,
      h: Math.round(rect.height),
    };
  }
  return out;
};

const texts = measure([
  '.page__title',
  '.home__brand-name',
  '.pp__title-name',
  '.chl__title',
  '.tune__title',
  '.settings__group-title',
  '.tune__panel-title',
  '.im__heading',
  '.wardrobe__preview-title',
  '.chl__combo-value',
  '.wardrobe__growth-value',
  '.settings__label',
  '.settings__note',
  'body',
]);

const bars = measure(['.page__bar', '.home__bar', '.pp__top', '.chl__top', '.tune__top']);

/** 顶栏被谁撑高了：把每个栏里最高的子元素报出来。 */
const barChildren = (() => {
  const out = {};
  for (const selector of ['.page__bar', '.home__bar', '.pp__top', '.chl__top', '.tune__top']) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const kids = [...el.children]
      .map((c) => ({
        cls: typeof c.className === 'string' ? c.className : c.tagName,
        h: Math.round(c.getBoundingClientRect().height),
      }))
      .sort((a, b) => b.h - a.h)
      .slice(0, 2);
    out[selector] = kids;
  }
  return out;
})();

const column = (() => {
  const el = document.querySelector('.settings__body, .im, .tune__body, .wardrobe__body, .page__body');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    selector: el.className,
    gap: cs.rowGap,
    maxWidth: cs.maxWidth,
    width: Math.round(rect.width),
    x: Math.round(rect.x),
  };
})();

// 横向溢出
const overflowX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);

// 文字被裁：可见元素里 scrollWidth 明显大于 clientWidth（且没有横向滚动作为出口）
const clipped = [];
for (const el of document.querySelectorAll('h1, h2, h3, p, span, button, dd, dt')) {
  const cs = getComputedStyle(el);
  if (cs.overflowX === 'visible') continue;
  if (el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 2) {
    clipped.push({ tag: el.tagName, cls: el.className, need: el.scrollWidth, have: el.clientWidth });
  }
}

return JSON.stringify({
  route: location.hash,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  texts,
  bars,
  barChildren,
  column,
  overflowX,
  clipped: clipped.slice(0, 8),
  clippedCount: clipped.length,
});
