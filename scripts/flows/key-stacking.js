/**
 * 跟弹模式的黑白键层叠检查。
 *
 * 要回答的问题：**被引导的那个白键有没有翻到黑键上面去？**
 * 复现路径：进入跟弹模式 → 点「开始跟弹」→ 第一个音被强引导（本项目的曲库都是白键）。
 *
 * 判据是 `elementFromPoint`：如果黑键的中心点命中的不是黑键自己，
 * 说明它被别的元素盖住了 —— 这既是**视觉**问题（白键压在黑键上，黑白交叉），
 * 也是**功能**问题（那个黑键按不下去）。
 *
 * 用法：npm run shot -- "#/practice/mary-lamb" --click 开始跟弹 --script scripts/flows/key-stacking.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !document.querySelector('.pk'); i += 1) await sleep(100);

// 自己点开始按钮，进入有引导的 playing 状态（比依赖 --click 的顺序更稳）
const startButton = [...document.querySelectorAll('button')].find((button) =>
  /^开始/.test((button.textContent ?? '').trim()),
);
if (!startButton) throw new Error('找不到开始按钮');
startButton.click();
await sleep(1200); // 等引导与弱提示出现

const container = document.querySelector('.pk');
if (!container) throw new Error('找不到 .pk');

const rect = (el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};

const guideKey = container.querySelector('.pk-key.is-guide');
const nextKey = container.querySelector('.pk-key.is-next');
const blacks = [...container.querySelectorAll('.pk-key--black')];
const whites = [...container.querySelectorAll('.pk-key--white')];

/** 黑键中心点命中的是谁 */
const blackHits = blacks.map((el) => {
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const owner = at?.closest?.('[data-note]') ?? null;
  return {
    note: el.dataset.note,
    hitNote: owner?.dataset?.note ?? null,
    hitIsSelf: owner === el,
    hitClasses: at ? String(at.className).slice(0, 60) : null,
  };
});

/** 引导键与黑键是否在几何上相交（相交 + 引导键在上 = 视觉交叉） */
const guideBox = guideKey ? guideKey.getBoundingClientRect() : null;
const overlaps = guideBox
  ? blacks
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return !(r.right <= guideBox.left || r.left >= guideBox.right || r.bottom <= guideBox.top || r.top >= guideBox.bottom);
      })
      .map((el) => el.dataset.note)
  : [];

/** 引导提示点（手指圆点）有没有落进黑键带里 */
const dot = guideKey?.querySelector('.pk-key__finger') ?? null;
const dotRect = dot ? dot.getBoundingClientRect() : null;
const dotOverlapsBlack = dotRect
  ? blacks
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return !(r.right <= dotRect.left || r.left >= dotRect.right || r.bottom <= dotRect.top || r.top >= dotRect.bottom);
      })
      .map((el) => el.dataset.note)
  : [];

const zIndexOf = (el) => (el ? getComputedStyle(el).zIndex : null);
/** 提示点的**计算后**位置：判断「CSS 没生效」还是「我算错了」 */
const dotComputed = dot ? getComputedStyle(dot) : null;
const keyboardRect = container.getBoundingClientRect();
const blackRect = blacks[0]
  ? blacks[0].getBoundingClientRect()
  : { y: 0, height: 0, bottom: 0 };
const layerZ = (selector) => {
  const el = container.querySelector(selector);
  return el ? { position: getComputedStyle(el).position, zIndex: getComputedStyle(el).zIndex } : null;
};

const broken = blackHits.filter((entry) => !entry.hitIsSelf);

return (
  `引导键=${guideKey?.dataset?.note ?? '无'}(${guideKey?.className?.includes('pk-key--black') ? '黑' : '白'}) ` +
  `z=${zIndexOf(guideKey)} | 弱提示=${nextKey?.dataset?.note ?? '无'} | ` +
  `.pk__whites=${JSON.stringify(layerZ('.pk__whites'))} .pk__blacks=${JSON.stringify(layerZ('.pk__blacks'))} | ` +
  `引导键与黑键几何相交=${overlaps.join(',') || '无'} | ` +
  `键盘y${keyboardRect.y}/h${keyboardRect.height} 黑键y${blackRect.y}/h${blackRect.height} | ` +
  `提示点=${dotRect ? `y${Math.round(dotRect.y)}/h${Math.round(dotRect.height)} bottom:${dotComputed?.bottom} 黑键下沿${Math.round(blackRect.bottom)} 相交=${dotOverlapsBlack.join(',') || '无'}` : '无'} | ` +
  `黑键被盖住=${broken.length}${broken.length ? ' → ' + broken.map((entry) => `${entry.note}被${entry.hitNote ?? '未知元素'}盖住`).join(' ') : ''}`
);
