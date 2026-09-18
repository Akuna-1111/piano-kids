/**
 * 流程探针：弹完《玛丽有只小羊羔》→ 量完成页（尤其是「听我弹的」按钮）的布局。
 *
 * 用法（放在 `--script` 后面，配合 `--probe` 的几何输出一起看）：
 *
 * ```bash
 * npm run dev
 * npm run shot -- "#/practice/mary-lamb" --script scripts/flows/result-overlay.js
 * ```
 *
 * 这个脚本能做 `--click` 做不到的事：连续操作 + 模拟真实 pointer 事件。
 * 琴键靠 `elementFromPoint` 命中测试，所以在真实浏览器里派发带坐标的
 * `PointerEvent` 就能走通与真机同一条链路。
 *
 * 这里 return 的对象会原样打印出来。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (selector, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (document.querySelector(selector)) return;
    await sleep(80);
  }
  throw new Error(`等不到 ${selector}`);
};

const clickText = (text) => {
  const el = [...document.querySelectorAll('button, a')].find((node) =>
    (node.textContent ?? '').includes(text),
  );
  if (!el) throw new Error(`找不到「${text}」`);
  el.click();
};

const pressKey = (note) => {
  const container = document.querySelector('.pk');
  const key = document.querySelector(`[data-note="${note}"]`);
  if (!container || !key) throw new Error(`找不到琴键 ${note}`);
  const box = key.getBoundingClientRect();
  const options = {
    pointerId: 1,
    pointerType: 'touch',
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height * 0.8,
    bubbles: true,
    cancelable: true,
  };
  container.dispatchEvent(new PointerEvent('pointerdown', options));
  container.dispatchEvent(new PointerEvent('pointerup', options));
};

const rect = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    bottom: Math.round(r.bottom),
  };
};

/** 《玛丽有只小羊羔》在 8 键键盘上的实际按键顺序（均在 C4–C5 内）。 */
const MARY_LAMB = [
  'E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4',
  'D4', 'D4', 'D4',
  'E4', 'G4', 'G4',
  'E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4',
  'E4', 'D4', 'D4', 'E4', 'D4', 'C4',
];

clickText('开始跟弹');
await waitFor('.pp__note-card');

for (const note of MARY_LAMB) {
  pressKey(note);
  await sleep(30);
}

await waitFor('.pp-result');

const dialog = document.querySelector('.pp-result');
const card = document.querySelector('.pp-result__card');
const actions = document.querySelector('.pp-result__actions');
const buttons = [...document.querySelectorAll('.pp-result__actions .ui-btn')];

// 按钮有没有互相重叠？（换行是对的，叠在一起才是错的）
const boxes = buttons.map((b) => b.getBoundingClientRect());
const overlaps = [];
for (let i = 0; i < boxes.length; i += 1) {
  for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i];
    const b = boxes[j];
    if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
      overlaps.push(`${buttons[i].textContent} × ${buttons[j].textContent}`);
    }
  }
}

const exit = document.querySelector('.pp-result__exit');
const cardBox = card ? card.getBoundingClientRect() : null;
const cardStyle = card ? getComputedStyle(card) : null;
const padBottom = cardStyle ? parseFloat(cardStyle.paddingBottom) : 0;
// 内容能看到的底边 = 卡片下缘 - 下内边距
const contentBottom = cardBox ? cardBox.bottom - padBottom : null;
const lastChildBottom = exit ? exit.getBoundingClientRect().bottom : null;

return JSON.stringify(
  {
    viewport: { w: innerWidth, h: innerHeight },
    card: rect(card),
    cardPaddingBottom: padBottom,
    cardScroll: card
      ? { clientH: card.clientHeight, scrollH: card.scrollHeight, overflowY: cardStyle.overflowY }
      : null,
    actions: rect(actions),
    buttons: buttons.map((b) => ({ text: (b.textContent ?? '').trim(), ...rect(b) })),
    exitButton: rect(exit),
    buttonOverlaps: overlaps,
    /** 最后一个元素是否完整落在卡片的可见区域内 —— 这才是「有没有被切」 */
    contentComplete: lastChildBottom !== null && contentBottom !== null
      ? lastChildBottom <= contentBottom + 1
      : null,
    actionRows: new Set(boxes.map((b) => Math.round(b.top))).size,
  },
  null,
  2,
);
