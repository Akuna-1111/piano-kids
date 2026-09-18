/**
 * 「这块内容是不是偏左 / 多宽」探针。
 *
 * 布局问题（偏左、孤立一张卡片、右侧一大片空白）在 jsdom 里永远看不出来，
 * 而读 CSS 猜也容易猜错。这里只报数字：每个候选块的 x / 宽度 / 右边缘，
 * 以及**容器**的宽度 —— 一眼就能判断是「块本身窄」还是「块没居中」。
 *
 * 用法：npm run shot -- "#/settings" --script scripts/flows/block-alignment.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !document.querySelector('.app'); i += 1) await sleep(100);
await sleep(350);

const rect = (el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) };
};

/** 找页面里「承载内容的那一层」：优先用显式的 body 类名，退化为最大的直接子块 */
const bodySelectors = ['.page__body', '.settings', '.free', '.home__body', '.im'];
const body = bodySelectors.map((s) => document.querySelector(s)).find(Boolean) ?? null;

// 候选块：各类卡片/分组容器的通用类名
const blockSelector = [
  '.settings__card',
  '.settings__group',
  '.settings__row',
  '.home__card',
  '.song-card',
  '.im__field',
].join(',');

const blocks = [...document.querySelectorAll(blockSelector)].slice(0, 6).map((el) => {
  const style = getComputedStyle(el);
  const box = rect(el);
  const parent = el.parentElement ? rect(el.parentElement) : null;
  return (
    `${String(el.className).split(' ')[0]}(x${box.x} w${box.w} right${box.right}` +
    ` | 父${parent ? `${parent.x}+${parent.w}` : '?'} maxw:${style.maxWidth} ml:${style.marginLeft})`
  );
});

const parentStyle = body ? getComputedStyle(body.parentElement ?? body) : null;

return (
  `视口${innerWidth}×${innerHeight} | 容器 ${body ? `${body.className}(x${rect(body).x} w${rect(body).w})` : '无'}` +
  ` | 容器对齐 maxw:${body ? getComputedStyle(body).maxWidth : '?'} mx:${body ? getComputedStyle(body).marginLeft : '?'}` +
  ` | 容器父 ${body && body.parentElement ? `w${rect(body.parentElement).w} maxw:${parentStyle?.maxWidth} align:${parentStyle?.alignItems}` : '?'}\n` +
  `    块：${blocks.join('\n      ')}`
);
